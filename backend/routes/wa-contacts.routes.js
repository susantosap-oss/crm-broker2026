/**
 * WA Contacts Routes — Buku Kontak WA per agen
 * BASE: /api/v1/wa-contacts
 *
 * Nomor & Group JID disimpan terenkripsi AES-256-GCM di GSheet.
 * Frontend hanya menerima nomor yang sudah di-mask (628****5678).
 * Fonnte menerima nomor asli hanya di backend saat blast.
 *
 * Columns WA_CONTACTS sheet:
 *   A: ID  B: Agen_ID  C: Nama  D: Nomor_Enc  E: Tipe  F: JID_Enc  G: Created_At
 */

const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const axios        = require('axios');
const { authMiddleware: authenticate } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const paService     = require('../services/pa.service');
const { SHEETS }    = require('../config/sheets.config');

// ── Auto-create sheet tab jika belum ada ─────────────────────
const WA_CONTACTS_HEADERS = ['ID','Agen_ID','Nama','Nomor_Enc','Tipe','JID_Enc','Created_At'];
sheetsService.ensureSheet(SHEETS.WA_CONTACTS, WA_CONTACTS_HEADERS).catch(() => {});

// ── AES-256-GCM (same key as PA credentials) ─────────────────
const ENC_KEY = Buffer.from(process.env.PA_ENCRYPTION_KEY || '', 'hex');

function encrypt(plain) {
  if (!plain) return '';
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc     = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return '';
  try {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
  } catch { return ''; }
}

function maskNumber(num) {
  if (!num || num.length < 6) return num;
  return num.slice(0, 3) + '****' + num.slice(-4);
}

function normalizeNumber(raw) {
  let n = (raw || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (!n.startsWith('62')) n = '62' + n;
  return n;
}

function rowToContact(row, masked = true) {
  const nomor = decrypt(row[3]);
  const jid   = decrypt(row[5]);
  return {
    id:     row[0],
    nama:   row[2],
    nomor:  masked ? maskNumber(nomor) : nomor,
    tipe:   row[4] || 'personal',
    jid:    jid || '',
    created_at: row[6],
  };
}

// ── GET /wa-contacts — daftar kontak milik agen ───────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await sheetsService.getRows(SHEETS.WA_CONTACTS);
    const mine = rows
      .filter(r => r[1] === req.user.id)
      .map(r => rowToContact(r, true)); // masked
    res.json({ success: true, data: mine });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /wa-contacts/validate-import ────────────────────────
// Terima array nomor dari frontend, validasi via Fonnte, return yang valid
router.post('/validate-import', authenticate, async (req, res) => {
  try {
    const { numbers } = req.body; // array of { nama, nomor }
    if (!Array.isArray(numbers) || numbers.length === 0)
      return res.status(400).json({ success: false, message: 'numbers wajib diisi' });

    const creds = await paService.getDecryptedCredentials(req.user.id);
    if (!creds?.fonnte_token)
      return res.status(400).json({ success: false, message: 'Fonnte token belum dikonfigurasi di PA Settings' });

    // Normalize semua nomor
    const normalized = numbers.map(c => ({ ...c, nomor: normalizeNumber(c.nomor) }))
      .filter(c => c.nomor.length >= 10);

    // Validasi batch via Fonnte
    const target = normalized.map(c => c.nomor).join(',');
    let validSet = new Set();
    let fontteRaw = null;
    try {
      const fRes = await axios.post('https://api.fonnte.com/validate',
        { target, countryCode: '62' },
        { headers: { Authorization: creds.fonnte_token }, timeout: 20_000 }
      );
      fontteRaw = fRes.data;
      console.log('[WA-CONTACTS] Fonnte validate raw:', JSON.stringify(fontteRaw));

      // Handle berbagai kemungkinan struktur response Fonnte:
      // 1. { valid: ["628xxx"], not_valid: [...] }
      // 2. { data: { valid: [...], not_valid: [...] } }
      // 3. { data: ["628xxx", ...] }
      // 4. { data: { "628xxx": true/false } }
      let validArr = [];
      const d = fontteRaw;
      if (Array.isArray(d?.registered))       validArr = d.registered;       // ← Fonnte actual format
      else if (Array.isArray(d?.valid))       validArr = d.valid;
      else if (Array.isArray(d?.data?.valid)) validArr = d.data.valid;
      else if (Array.isArray(d?.data))        validArr = d.data;
      else if (d?.data && typeof d.data === 'object') {
        validArr = Object.entries(d.data)
          .filter(([, v]) => v === true || v?.registered === true || v?.status === true)
          .map(([k]) => k);
      }

      validArr.forEach(n => validSet.add(String(n).replace(/\D/g, '')));
    } catch (e) {
      return res.status(502).json({ success: false, message: 'Gagal validasi Fonnte: ' + e.message });
    }

    const valid   = normalized.filter(c => validSet.has(c.nomor));
    const invalid = normalized.filter(c => !validSet.has(c.nomor));

    // Jika semua invalid padahal Fonnte status: true → kembalikan raw untuk debug
    if (!valid.length && fontteRaw?.status === true) {
      return res.json({
        success: true, valid: [], invalid,
        total_valid: 0, total_invalid: invalid.length,
        _debug: fontteRaw, // raw response Fonnte untuk debugging
      });
    }

    res.json({ success: true, valid, invalid, total_valid: valid.length, total_invalid: invalid.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /wa-contacts/import — simpan kontak yang sudah divalidasi ─
router.post('/import', authenticate, async (req, res) => {
  try {
    const { contacts } = req.body; // array of { nama, nomor } — sudah WA-valid
    if (!Array.isArray(contacts) || contacts.length === 0)
      return res.status(400).json({ success: false, message: 'contacts kosong' });

    // Ambil existing untuk dedup
    const existing = await sheetsService.getRows(SHEETS.WA_CONTACTS);
    const existingNomors = new Set(
      existing.filter(r => r[1] === req.user.id).map(r => decrypt(r[3]))
    );

    const now    = new Date().toISOString();
    let saved    = 0;
    let skipped  = 0;

    for (const c of contacts) {
      const nomor = normalizeNumber(c.nomor);
      if (!nomor || existingNomors.has(nomor)) { skipped++; continue; }

      const id = `WAC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sheetsService.appendRow(SHEETS.WA_CONTACTS, [
        id, req.user.id, c.nama || nomor, encrypt(nomor), 'personal', '', now
      ]);
      existingNomors.add(nomor);
      saved++;
    }

    res.json({ success: true, saved, skipped });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /wa-contacts/groups/sync — sync grup dari Fonnte ─────
router.post('/groups/sync', authenticate, async (req, res) => {
  try {
    const creds = await paService.getDecryptedCredentials(req.user.id);
    if (!creds?.fonnte_token)
      return res.status(400).json({ success: false, message: 'Fonnte token belum dikonfigurasi' });

    const fRes = await axios.post('https://api.fonnte.com/get-whatsapp-group', {},
      { headers: { Authorization: creds.fonnte_token }, timeout: 15_000 }
    );
    const raw = fRes.data?.data || fRes.data?.group || [];
    const groups = (Array.isArray(raw) ? raw : Object.values(raw))
      .filter(g => g.id)
      .map(g => ({ id: g.id, name: g.name || g.subject || g.id }));

    if (!groups.length)
      return res.json({ success: true, synced: 0, message: 'Tidak ada grup ditemukan' });

    const existing = await sheetsService.getRows(SHEETS.WA_CONTACTS);
    const existingJids = new Set(
      existing.filter(r => r[1] === req.user.id && r[4] === 'group').map(r => decrypt(r[5]))
    );

    const now = new Date().toISOString();
    let synced = 0;

    for (const g of groups) {
      if (existingJids.has(g.id)) continue;
      const id = `WAG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sheetsService.appendRow(SHEETS.WA_CONTACTS, [
        id, req.user.id, g.name, '', 'group', encrypt(g.id), now
      ]);
      existingJids.add(g.id);
      synced++;
    }

    res.json({ success: true, synced, total_groups: groups.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE /wa-contacts/:id ───────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const rows = await sheetsService.getRows(SHEETS.WA_CONTACTS);
    const idx  = rows.findIndex(r => r[0] === req.params.id && r[1] === req.user.id);
    if (idx === -1)
      return res.status(404).json({ success: false, message: 'Kontak tidak ditemukan' });
    await sheetsService.deleteRow(SHEETS.WA_CONTACTS, idx + 2); // +2: header + 1-indexed
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /wa-contacts/for-blast — nomor ASLI untuk backend blast ─
// Internal use: dipanggil saat PA trigger blast, bukan dari frontend
router.get('/for-blast', authenticate, async (req, res) => {
  try {
    const { ids } = req.query; // comma-separated contact IDs
    if (!ids) return res.status(400).json({ success: false, message: 'ids required' });
    const idSet = new Set(ids.split(','));
    const rows  = await sheetsService.getRows(SHEETS.WA_CONTACTS);
    const result = rows
      .filter(r => r[1] === req.user.id && idSet.has(r[0]))
      .map(r => ({
        id:   r[0],
        nama: r[2],
        nomor: r[4] === 'group' ? decrypt(r[5]) : decrypt(r[3]),
        tipe:  r[4] || 'personal',
      }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
