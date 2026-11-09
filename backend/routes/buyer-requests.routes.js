/**
 * Buyer Request Matching — /api/v1/buyer-requests
 * ============================================
 * Matching engine: leads yang ditandai "Buyer Request" di-match terhadap
 * semua listing aktif (semua kantor). Jika cocok → notif WA ke agen listing
 * via FONNTE_TOKEN (global admin). Semua request disimpan ke BUYER_REQUESTS.
 *
 * Infrastruktur webhook tersedia di POST /webhook untuk integrasi
 * Web Mansion di masa depan (saat ini hanya CRM yang trigger matching).
 *
 * Trigger dari: leads.routes.js (fire-and-forget saat Is_Buyer_Request → TRUE)
 * Public endpoint: POST /webhook (dilindungi BUYER_REQUEST_WEBHOOK_SECRET)
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios   = require('axios');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware } = require('../middleware/auth.middleware');

function rowToBR(row) {
  return COLUMNS.BUYER_REQUESTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
}

// ── FORMAT HELPER ─────────────────────────────────────────────
function _fmtNum(n) {
  if (!n) return '0';
  const v = parseFloat(n) || 0;
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1).replace('.0', '') + 'M';
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(0) + ' Jt';
  if (v >= 1_000)         return (v / 1_000).toFixed(0) + ' rb';
  return String(v);
}

// ── MATCHING ENGINE ───────────────────────────────────────────
/**
 * runBuyerMatch — cocokkan request buyer vs semua listing aktif.
 * Simpan ke BUYER_REQUESTS. Kirim WA notif jika ada yang cocok.
 *
 * @param {object} params
 *   lead_id, nama_user, area_minat, kategori, tipe_properti,
 *   budget_min, budget_max, jenis, sumber_leads,
 *   agen_input_id, agen_input_nama
 */
async function runBuyerMatch(params) {
  const {
    lead_id        = '',
    nama_user      = '',
    area_minat     = '',
    kategori       = '',
    tipe_properti  = '',
    budget_min     = 0,
    budget_max     = 0,
    jenis          = 'Beli',
    sumber_leads   = '',
    agen_input_id  = '',
    agen_input_nama = '',
  } = params;

  const id  = uuidv4();
  const now = new Date().toISOString();

  // 1. Ambil semua listing aktif
  const listingRows = await sheetsService.getRange(SHEETS.LISTING);
  const toL = r => COLUMNS.LISTING.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {});
  const allListings = listingRows && listingRows.length > 1
    ? listingRows.slice(1).map(toL).filter(l => l.ID && l.Status_Listing === 'Aktif')
    : [];

  // 2. Kriteria matching
  const budMin  = parseFloat(budget_min) || 0;
  const budMax  = parseFloat(budget_max) || 0;
  const lokasiQ = (area_minat || '').toLowerCase().trim();
  const tipeQ   = (tipe_properti || '').toLowerCase().trim();

  const matched = allListings.filter(l => {
    // ── Jenis transaksi ──────────────────────────────────────
    const trx = (l.Status_Transaksi || '').toLowerCase();
    if (jenis === 'Beli' && !trx.includes('jual')) return false;
    if (jenis === 'Sewa' && !trx.includes('sewa')) return false;

    // ── Budget ───────────────────────────────────────────────
    // Hanya cek jika budget diisi; toleransi ±20% di bawah / 15% di atas
    if (budMax > 0 || budMin > 0) {
      const harga = parseFloat(l.Harga) || 0;
      if (harga > 0) {
        if (budMax > 0 && harga > budMax * 1.15) return false;
        if (budMin > 0 && harga < budMin * 0.80) return false;
      }
    }

    // ── Lokasi ───────────────────────────────────────────────
    if (lokasiQ) {
      const kec    = (l.Kecamatan || '').toLowerCase();
      const kota   = (l.Kota || '').toLowerCase();
      const prov   = (l.Provinsi || '').toLowerCase();
      const alamat = (l.Alamat || '').toLowerCase();
      const hit    = kec.includes(lokasiQ) || kota.includes(lokasiQ) ||
                     prov.includes(lokasiQ) || alamat.includes(lokasiQ) ||
                     lokasiQ.includes(kec)  || lokasiQ.includes(kota);
      if (!hit) return false;
    }

    // ── Tipe properti ────────────────────────────────────────
    if (tipeQ) {
      const lt = (l.Tipe_Properti || '').toLowerCase();
      if (!lt.includes(tipeQ) && !tipeQ.includes(lt)) return false;
    }

    return true;
  });

  const statusMatch = matched.length > 0 ? 'Tersedia' : 'Tidak_Tersedia';

  // 3. Simpan ke BUYER_REQUESTS sheet
  const row = COLUMNS.BUYER_REQUESTS.map(col => {
    switch (col) {
      case 'ID':              return id;
      case 'Tanggal':         return now;
      case 'Lead_ID':         return lead_id;
      case 'Nama_User':       return nama_user;
      case 'Area_Minat':      return area_minat;
      case 'Kategori':        return kategori;
      case 'Tipe_Properti':   return tipe_properti;
      case 'Budget_Min':      return String(budget_min || '');
      case 'Budget_Max':      return String(budget_max || '');
      case 'Jenis':           return jenis;
      case 'Sumber_Leads':    return sumber_leads;
      case 'Agen_Input_ID':   return agen_input_id;
      case 'Agen_Input_Nama': return agen_input_nama;
      case 'Status_Match':    return statusMatch;
      case 'Match_Count':     return String(matched.length);
      case 'Match_IDs':       return JSON.stringify(matched.map(l => l.ID));
      case 'Notif_WA_Sent':   return 'FALSE';
      case 'Created_At':      return now;
      default:                return '';
    }
  });

  await sheetsService.appendRow(SHEETS.BUYER_REQUESTS, row);
  console.log(`[BUYER_MATCH] ${statusMatch} — ${matched.length} listing cocok untuk "${nama_user}"`);

  // 4. Jika ada yang cocok, kirim WA notif ke agen pemilik listing (fire-and-forget)
  if (matched.length > 0) {
    _sendMatchNotifications(id, params, matched).catch(e => {
      console.error('[BUYER_MATCH] WA notif error:', e.message);
    });
  }

  return { id, status: statusMatch, match_count: matched.length, matched_ids: matched.map(l => l.ID) };
}

// ── WA NOTIFICATION TO LISTING AGENTS ────────────────────────
async function _sendMatchNotifications(reqId, params, matchedListings) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.log('[BUYER_MATCH] FONNTE_TOKEN tidak terset, skip WA notif');
    return;
  }

  // Ambil semua data agen (No_WA)
  const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
  const toA  = r => COLUMNS.AGENTS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {});
  const agentMap = {};
  if (agentRows && agentRows.length > 1) {
    agentRows.slice(1).map(toA).filter(a => a.ID).forEach(a => { agentMap[a.ID] = a; });
  }

  // Ambil co-owner listing
  const laRows = await sheetsService.getRange(SHEETS.LISTING_AGENTS);
  const toLa = r => COLUMNS.LISTING_AGENTS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {});
  const coOwners = {};   // { listing_id: Set<agen_id> }
  if (laRows && laRows.length > 1) {
    laRows.slice(1).map(toLa).filter(la => la.Listing_ID && la.Agen_ID).forEach(la => {
      if (!coOwners[la.Listing_ID]) coOwners[la.Listing_ID] = new Set();
      coOwners[la.Listing_ID].add(la.Agen_ID);
    });
  }

  // Kumpulkan: { agen_id → [listing, ...] }
  const agenListings = {};
  for (const listing of matchedListings) {
    const ids = new Set();
    if (listing.Agen_ID) ids.add(listing.Agen_ID);
    (coOwners[listing.ID] || new Set()).forEach(id => ids.add(id));
    for (const aId of ids) {
      if (!agenListings[aId]) agenListings[aId] = [];
      agenListings[aId].push(listing);
    }
  }

  const budMin  = parseFloat(params.budget_min) || 0;
  const budMax  = parseFloat(params.budget_max) || 0;
  const fmtBudget = (budMin || budMax)
    ? `Rp ${_fmtNum(budMin)}${budMax ? ' – Rp ' + _fmtNum(budMax) : '+'}`
    : 'Fleksibel';

  let notifSent = 0;
  for (const [agenId, listings] of Object.entries(agenListings)) {
    const agen = agentMap[agenId];
    if (!agen) continue;
    const noWa = (agen.No_WA || '').replace(/\D/g, '').replace(/^0/, '62');
    if (noWa.length < 10) continue;

    const jenisLabel = params.jenis === 'Sewa' ? 'penyewa' : 'pembeli';
    const topListings = listings.slice(0, 3);
    const listingsText = topListings.map(l =>
      `• *${l.Judul || l.Kode_Listing || 'Listing'}*\n  ${l.Harga_Format || '-'} | ${[l.Kecamatan, l.Kota].filter(Boolean).join(', ')}`
    ).join('\n');
    const extra = listings.length > 3 ? `\n_...dan ${listings.length - 3} listing lainnya_` : '';

    const message =
      `🔔 *ADA BUYER REQUEST MASUK!*\n\n` +
      `Halo ${agen.Nama}, ada calon *${jenisLabel}* yang mencari properti seperti milik kamu!\n\n` +
      `👤 *Profil Pencari:*\n` +
      `• Jenis: ${params.jenis}\n` +
      (params.tipe_properti  ? `• Tipe Properti: ${params.tipe_properti}\n`  : '') +
      (params.area_minat     ? `• Area Diminati: ${params.area_minat}\n`      : '') +
      `• Budget: ${fmtBudget}\n` +
      `• Sumber: ${params.sumber_leads}\n\n` +
      `🏠 *Listing kamu yang cocok:*\n${listingsText}${extra}\n\n` +
      `Segera follow up di CRM Mansion! 💪\n_crm.mansionpro.id_`;

    try {
      await axios.post('https://api.fonnte.com/send',
        { target: noWa, message },
        { headers: { Authorization: token }, timeout: 10000 }
      );
      notifSent++;
      console.log(`[BUYER_MATCH] WA terkirim → ${agen.Nama} (${noWa})`);
    } catch (e) {
      console.error(`[BUYER_MATCH] WA gagal → ${noWa}:`, e.message);
    }
  }

  // Update Notif_WA_Sent = TRUE di BUYER_REQUESTS
  if (notifSent > 0) {
    try {
      const result = await sheetsService.findRowById(SHEETS.BUYER_REQUESTS, reqId);
      if (result) {
        const r = rowToBR(result.data);
        r.Notif_WA_Sent = 'TRUE';
        await sheetsService.updateRow(SHEETS.BUYER_REQUESTS, result.rowIndex,
          COLUMNS.BUYER_REQUESTS.map(c => r[c] || ''));
      }
    } catch (e) {
      console.error('[BUYER_MATCH] Update Notif_WA_Sent gagal:', e.message);
    }
  }

  console.log(`[BUYER_MATCH] Notif WA: ${notifSent}/${Object.keys(agenListings).length} agen`);
}

// ── API ROUTES ────────────────────────────────────────────────

// GET /buyer-requests — list database (superadmin, principal, kantor, business_manager, admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const allowedRoles = ['superadmin', 'principal', 'kantor', 'business_manager', 'admin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const rows = await sheetsService.getRange(SHEETS.BUYER_REQUESTS);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [], count: 0 });

    let data = rows.slice(1).map(rowToBR).filter(r => r.ID);

    // Filter opsional
    if (req.query.status) data = data.filter(r => r.Status_Match === req.query.status);
    if (req.query.jenis)  data = data.filter(r => r.Jenis === req.query.jenis);
    if (req.query.sumber) data = data.filter(r => r.Sumber_Leads === req.query.sumber);

    // Terbaru di atas
    data.sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));

    res.json({ success: true, data, count: data.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /buyer-requests/webhook — webhook dari Web Mansion (future integration)
// Dilindungi header X-Webhook-Secret (nilai = env BUYER_REQUEST_WEBHOOK_SECRET)
router.post('/webhook', async (req, res) => {
  try {
    const secret   = process.env.BUYER_REQUEST_WEBHOOK_SECRET;
    const incoming = req.headers['x-webhook-secret'] || req.headers['x-buyer-secret'];

    // Jika secret terset di env, wajib match
    if (secret && incoming !== secret) {
      return res.status(401).json({ success: false, message: 'Unauthorized: invalid secret' });
    }

    const { nama_user, area_minat, kategori, tipe_properti, budget_min, budget_max, jenis } = req.body;

    if (!nama_user || !jenis) {
      return res.status(400).json({ success: false, message: 'nama_user dan jenis wajib' });
    }
    if (!['Beli', 'Sewa'].includes(jenis)) {
      return res.status(400).json({ success: false, message: 'jenis harus Beli atau Sewa' });
    }

    const result = await runBuyerMatch({
      nama_user,
      area_minat:      area_minat     || '',
      kategori:        kategori       || 'Secondary',
      tipe_properti:   tipe_properti  || '',
      budget_min:      budget_min     || 0,
      budget_max:      budget_max     || 0,
      jenis,
      sumber_leads:    'Web_Mansion',
      agen_input_id:   '',
      agen_input_nama: '',
    });

    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports        = router;
// Export function agar bisa dipanggil dari leads.routes.js (fire-and-forget)
module.exports.triggerBuyerMatch = runBuyerMatch;
