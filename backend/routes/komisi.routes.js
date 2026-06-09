/**
 * Komisi Routes — /api/v1/komisi
 * ============================================
 * Agen submit request komisi → notif ke Principal & BM
 * Admin bisa lihat semua request, update status
 */
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios   = require('axios');
const { authMiddleware, requireMinRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { createNotification } = require('./notifications.routes');

const GFORM_SHEET_ID = process.env.KOMISI_GFORM_SHEET_ID || '';

// Parse CSV baris tunggal (handle quoted fields dengan koma di dalamnya)
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

router.use(authMiddleware);

function rowToKomisi(row) {
  return COLUMNS.KOMISI_REQUEST.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// GET /komisi — list semua request
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.KOMISI_REQUEST);
    if (rows.length < 2) return res.json({ success: true, data: [] });
    let data = rows.slice(1).map(rowToKomisi).filter(k => k.ID);

    const { role, id } = req.user;
    // Agen hanya lihat milik sendiri
    if (role === 'agen') data = data.filter(k => k.Agen_ID === id);
    // Filter status
    if (req.query.status) data = data.filter(k => k.Status === req.query.status);

    data.sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));
    res.json({ success: true, data, count: data.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /komisi/gform — baca dari Google Form responses sheet (publik)
router.get('/gform', async (req, res) => {
  // Hardcode fallback jika env var belum ter-load
  const sheetId = GFORM_SHEET_ID || '193lcLmru7ghRSz-ChZz8sTA7sNTL35a6BYgriaomUU4';
  try {
    // range=A:O agar kolom Status Data (O) ikut ter-export
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&range=A:O`;
    const resp = await axios.get(url, {
      timeout: 12000,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 5,
    });

    const lines = (resp.data || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.json({ success: true, data: [] });

    // Header-based mapping — robust terhadap perubahan urutan kolom
    const header = parseCSVLine(lines[0]);
    const idx = {};
    header.forEach((h, i) => { idx[h.trim()] = i; });
    const col = (row, name) => (row[idx[name]] || '').trim();

    const { role, nama } = req.user;
    const adminRoles = ['superadmin','principal','business_manager','admin','kantor'];
    const isAdmin    = adminRoles.includes(role);
    const userNama   = (nama || '').toLowerCase();

    console.log('[GFORM] headers:', header);
    console.log('[GFORM] total rows:', lines.length - 1, '| user:', userNama, '| isAdmin:', isAdmin);

    const data = lines.slice(1)
      .map(l => parseCSVLine(l))
      .filter(r => r.length >= 5 && r.some(c => c.trim()))
      .filter(r => {
        if (isAdmin) return true;
        const aL = col(r, 'Nama Agen Listing').toLowerCase();
        const aS = col(r, 'Nama Agen Selling').toLowerCase();
        return aL.includes(userNama) || aS.includes(userNama) ||
               userNama.includes(aL.split(' ')[0]) || userNama.includes(aS.split(' ')[0]);
      })
      .map(r => {
        const harga  = parseFloat(col(r, 'Harga Transaksi').replace(/\D/g,'')) || 0;
        const persen = parseFloat(col(r, 'Prosentase Komisi')) || 0;
        const statusData = col(r, 'Status Data');
        return {
          no_transaksi:      col(r, 'Nomer Transaksi'),
          timestamp:         col(r, 'Timestamp'),
          tanggal_transaksi: col(r, 'Tanggal Transaksi'),
          jenis:             col(r, 'Jenis Transaksi'),
          alamat:            col(r, 'Alamat Transaksi'),
          harga,
          status_transaksi:  col(r, 'Status Transaksi'),
          persen_komisi:     persen,
          nama_penjual:      col(r, 'Nama Penjual'),
          agen_listing:      col(r, 'Nama Agen Listing'),
          nama_pembeli:      col(r, 'Nama Pembeli'),
          agen_selling:      col(r, 'Nama Agen Selling'),
          status_data:       statusData || 'Pending',
          komisi_nominal:    Math.round(harga * persen / 100),
        };
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log('[GFORM] data returned:', data.length, 'rows');
    res.json({ success: true, data });
  } catch (e) {
    console.error('[GFORM] fetch error:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ success: false, message: e.message, data: [] });
  }
});

// GET /komisi/stats — untuk admin dashboard
router.get('/stats', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.KOMISI_REQUEST);
    if (rows.length < 2) return res.json({ success: true, data: { pending: 0, total: 0, list: [] } });
    const data = rows.slice(1).map(rowToKomisi).filter(k => k.ID);
    const pending = data.filter(k => ['Pending','Diproses'].includes(k.Status));
    res.json({
      success: true,
      data: {
        total:   data.length,
        pending: pending.length,
        list:    pending.slice(0, 10).map(k => ({
          id:       k.ID,
          agen:     k.Agen_Nama,
          listing:  k.Listing_Judul,
          nominal:  k.Komisi_Nominal,
          tanggal:  k.Tanggal,
          status:   k.Status,
        })),
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /komisi — submit request baru dari agen
router.post('/', async (req, res) => {
  try {
    const { Listing_ID, Listing_Judul, Harga_Deal, Komisi_Persen, Catatan } = req.body;
    if (!Harga_Deal) return res.status(400).json({ success: false, message: 'Harga deal wajib diisi' });

    const id  = uuidv4();
    const now = new Date().toISOString();
    const harga = parseFloat(String(Harga_Deal).replace(/\D/g,'')) || 0;
    const persen = parseFloat(Komisi_Persen) || 2.5;
    const nominal = Math.round(harga * persen / 100);

    const row = COLUMNS.KOMISI_REQUEST.map(col => {
      if (col === 'ID')             return id;
      if (col === 'Tanggal')        return now.substring(0, 10);
      if (col === 'Agen_ID')        return req.user.id;
      if (col === 'Agen_Nama')      return req.user.nama;
      if (col === 'Listing_ID')     return Listing_ID || '';
      if (col === 'Listing_Judul')  return Listing_Judul || '';
      if (col === 'Harga_Deal')     return harga;
      if (col === 'Komisi_Persen')  return persen;
      if (col === 'Komisi_Nominal') return nominal;
      if (col === 'Catatan')        return Catatan || '';
      if (col === 'Status')         return 'Pending';
      if (col === 'Created_At')     return now;
      return '';
    });

    await sheetsService.appendRow(SHEETS.KOMISI_REQUEST, row);

    // Notif ke Principal dan BM
    const nominalFmt = 'Rp ' + nominal.toLocaleString('id-ID');
    await createNotification({
      tipe:           'komisi_request',
      judul:          `💰 Request Komisi — ${req.user.nama}`,
      pesan:          `${req.user.nama} mengajukan komisi ${nominalFmt} untuk ${Listing_Judul || 'listing'}`,
      from_user_id:   req.user.id,
      from_user_nama: req.user.nama,
      to_role:        'principal',
      link_type:      'komisi',
      link_id:        id,
    });
    await createNotification({
      tipe:           'komisi_request',
      judul:          `💰 Request Komisi — ${req.user.nama}`,
      pesan:          `${req.user.nama} mengajukan komisi ${nominalFmt} untuk ${Listing_Judul || 'listing'}`,
      from_user_id:   req.user.id,
      from_user_nama: req.user.nama,
      to_role:        'business_manager',
      link_type:      'komisi',
      link_id:        id,
    });
    // Notif ke admin juga
    await createNotification({
      tipe:           'komisi_request',
      judul:          `💰 Request Komisi Baru`,
      pesan:          `${req.user.nama} mengajukan komisi ${nominalFmt}`,
      from_user_id:   req.user.id,
      from_user_nama: req.user.nama,
      to_role:        'admin',
      link_type:      'komisi',
      link_id:        id,
    });

    res.status(201).json({ success: true, data: { id, nominal, nominalFmt }, message: 'Request komisi berhasil dikirim' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /komisi/:id/status — admin update status
router.patch('/:id/status', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.KOMISI_REQUEST);
    if (rows.length < 2) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    const data = rows.slice(1);
    for (let i = 0; i < data.length; i++) {
      const k = rowToKomisi(data[i]);
      if (k.ID === req.params.id) {
        const allowed = ['Diproses', 'Disetujui', 'Ditolak', 'Selesai'];
        k.Status = allowed.includes(req.body.status) ? req.body.status : 'Diproses';
        k.Reviewed_By  = req.user.nama;
        k.Reviewed_At  = new Date().toISOString();
        await sheetsService.updateRow(SHEETS.KOMISI_REQUEST, i + 2, COLUMNS.KOMISI_REQUEST.map(c => k[c] || ''));
        // Notif balik ke agen
        await createNotification({
          tipe:           'system',
          judul:          `Update Request Komisi`,
          pesan:          `Request komisi kamu: ${k.Status}`,
          from_user_id:   req.user.id,
          from_user_nama: req.user.nama,
          to_user_id:     k.Agen_ID,
          link_type:      'komisi',
          link_id:        k.ID,
        });
        break;
      }
    }
    res.json({ success: true, message: 'Status diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
