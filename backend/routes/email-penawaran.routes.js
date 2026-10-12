/**
 * Email Penawaran Routes — /api/v1/email-penawaran
 * =================================================
 * Kirim Surat Penawaran properti via email ke satu atau banyak target,
 * dan simpan log ke sheet EMAIL_LOG.
 */
const express       = require('express');
const router        = express.Router();
const { v4: uuidv4 } = require('uuid');
const sheetsService = require('../services/sheets.service');
const { sendEmail } = require('../services/email.service');
const agentsRouter  = require('./agents.routes');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');

router.use(authMiddleware);

const toObj = r => COLUMNS.EMAIL_LOG.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {});

// ── POST /email-penawaran/send ────────────────────────────────
// Body: { to: string[], subject, html, ref_type, ref_id, ref_judul }
router.post('/send', async (req, res) => {
  const { to, subject, html, ref_type = '', ref_id = '', ref_judul = '' } = req.body;

  if (!Array.isArray(to) || to.length === 0) return res.status(400).json({ error: 'to harus array email tidak kosong' });
  if (!subject) return res.status(400).json({ error: 'subject wajib diisi' });
  if (!html)    return res.status(400).json({ error: 'html body wajib diisi' });

  // Ambil credential Gmail user yang sedang login
  const cred = await agentsRouter._getEmailCredential(req.user.id);
  if (!cred) {
    return res.status(400).json({ error: 'App Password Gmail belum diatur. Buka Profil → Konfigurasi Email untuk mengaturnya.' });
  }

  const now      = new Date().toISOString();
  const agentId  = req.user.id;
  const agentNama= req.user.nama || req.user.id;
  const results  = [];

  for (const email of to) {
    const logId = uuidv4();
    let status = 'Terkirim'; let errMsg = '';

    try {
      await sendEmail({
        fromEmail:    cred.email,
        fromPassword: cred.password,
        fromName:     agentNama + ' — Mansion Properti',
        to: email, subject, html,
      });
    } catch (e) {
      status = 'Gagal';
      errMsg = e.message;
      console.error(`[EmailPenawaran] Gagal kirim ke ${email}:`, e.message);
    }

    const row = COLUMNS.EMAIL_LOG.map(c => ({
      ID: logId, Timestamp: now,
      Agent_ID: agentId, Agent_Nama: agentNama,
      Ref_Type: ref_type, Ref_ID: ref_id, Ref_Judul: ref_judul,
      Email_To: email, Subject: subject,
      Status: status, Error_Msg: errMsg,
    }[c] ?? ''));

    await sheetsService.appendRow(SHEETS.EMAIL_LOG, row).catch(e => console.error('[EmailPenawaran] Log error:', e.message));
    results.push({ email, status, error: errMsg || null });
  }

  const sent   = results.filter(r => r.status === 'Terkirim').length;
  const failed = results.filter(r => r.status === 'Gagal').length;
  res.json({ success: true, sent, failed, results });
});

// ── GET /email-penawaran/log ──────────────────────────────────
// Query: ?ref_id=xxx  → log untuk listing/aset tertentu
//        ?limit=50    → batasi jumlah hasil (default 100)
router.get('/log', async (req, res) => {
  try {
    const { ref_id, limit = 100 } = req.query;
    const { role, id: agentId } = req.user;

    const rows = await sheetsService.getRange(SHEETS.EMAIL_LOG);
    if (!rows || rows.length <= 1) return res.json({ data: [] });

    let logs = rows.slice(1).map(toObj).filter(l => l.ID);

    if (ref_id) logs = logs.filter(l => l.Ref_ID === ref_id);

    // agen hanya lihat log milik sendiri
    if (!['superadmin', 'admin', 'principal', 'kantor', 'business_manager'].includes(role)) {
      logs = logs.filter(l => l.Agent_ID === agentId);
    }

    logs.sort((a, b) => new Date(b.Timestamp || 0) - new Date(a.Timestamp || 0));
    res.json({ data: logs.slice(0, Number(limit)) });
  } catch (e) {
    console.error('[EmailPenawaran] LOG error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /email-penawaran/check-config ────────────────────────
// Cek apakah user sudah set App Password Gmail
router.get('/check-config', async (req, res) => {
  try {
    const cred = await agentsRouter._getEmailCredential(req.user.id);
    res.json({ configured: !!cred, email: cred ? cred.email : null });
  } catch (e) {
    res.json({ configured: false, email: null });
  }
});

module.exports = router;
