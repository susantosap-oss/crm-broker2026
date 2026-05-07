/**
 * Export Routes — /api/v1/export
 * Format: Row 1 = Title (left, navy), Row 2 = Headers (navy), Row 3+ = Data (blue alternating)
 *
 * Endpoints:
 *   GET /export/leads
 *   GET /export/listings
 *   GET /export/agents     (admin/principal/kantor/superadmin only)
 *   GET /export/rental
 *   GET /export/payment    (admin/principal/kantor/superadmin/bm only)
 */

const express       = require('express');
const router        = express.Router();
const ExcelJS       = require('exceljs');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');

router.use(authMiddleware);

// ── Helpers ────────────────────────────────────────────────

// dd/mm/yyyy display date for title
const todayDisplay = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear());
  return `${dd}/${mm}/${yy}`;
};

const todayFile = () => new Date().toISOString().slice(0, 10);

// Format ISO date → mm/dd/yy  (untuk kolom data)
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
}

// Hitung tanggal reminder dari Tanggal_Selesai
function reminderDate(tanggalSelesai, minusDays) {
  if (!tanggalSelesai) return '';
  const d = new Date(tanggalSelesai);
  if (isNaN(d)) return '';
  d.setDate(d.getDate() - minusDays);
  return fmtDate(d.toISOString());
}

function rowToObj(row, cols) {
  return cols.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// Blue Navy theme
const NAVY_TITLE  = 'FF0D1B3E';  // title row bg
const NAVY_HEADER = 'FF1E3A6E';  // header row bg
const BLUE_ROW    = 'FFE8F0FE';  // even row bg
const THIN_BORDER = { style: 'thin', color: { argb: 'FFB0C4DE' } };
const CELL_BORDER = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

async function sendExcel(res, { title, headers, rows, filename }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mansion CRM';
  wb.created = new Date();

  // Worksheet name: max 31 chars, karakter \ / * ? : [ ] tidak diizinkan Excel
  const wsName = title.replace(/[\\/*?:[\]]/g, '-').substring(0, 31).trim();
  const ws = wb.addWorksheet(wsName);
  const colCount = headers.length;

  // Print: A4 landscape, fit all columns to 1 page
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = {
    oddHeader: `&L&B${title}`,
    oddFooter: '&LPage &P of &N  |  &R&D',
  };

  // Column widths
  ws.columns = headers.map((h, i) => {
    const maxData = rows.reduce((mx, r) => Math.max(mx, String(r[i] ?? '').length), 0);
    return { width: Math.min(Math.max(h.length, maxData) + 2, 48) };
  });

  // Row 1: Title — rata kiri, navy bg
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell('A1');
  titleCell.value     = title;
  titleCell.font      = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_TITLE } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;

  // Row 2: Headers — navy bg
  const hRow = ws.addRow(headers);
  hRow.height = 22;
  hRow.eachCell(cell => {
    cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEADER } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = CELL_BORDER;
  });

  // Rows 3+: alternating blue/white
  rows.forEach((row, idx) => {
    const dRow = ws.addRow(row);
    dRow.height = 18;
    const bg = idx % 2 === 0 ? BLUE_ROW : 'FFFFFFFF';
    for (let c = 1; c <= colCount; c++) {
      const cell     = dRow.getCell(c);
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.border    = CELL_BORDER;
      cell.alignment = { vertical: 'middle' };
      cell.font      = { size: 10, name: 'Calibri' };
    }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// ── Scope filter helper ────────────────────────────────────
// Agen/koordinator/BM: selalu filter milik sendiri (Agen_ID)
// Principal: ?scope=mine → milik sendiri, default → semua
// Kantor/admin/superadmin: selalu semua
function resolveScope(role, id, scopeParam) {
  if (['agen', 'koordinator', 'business_manager'].includes(role)) return { filterById: id, label: 'Saya' };
  if (role === 'principal' && scopeParam === 'mine') return { filterById: id, label: 'Saya' };
  return { filterById: null, label: 'Semua' };
}

// ── GET /export/leads ──────────────────────────────────────
router.get('/leads', async (req, res) => {
  try {
    const raw = await sheetsService.getRange(SHEETS.LEADS);
    const [, ...data] = raw;
    let leads = data.map(r => rowToObj(r, COLUMNS.LEADS)).filter(l => l.ID);

    const { role, id, nama } = req.user;
    const { filterById, label } = resolveScope(role, id, req.query.scope);
    if (filterById) leads = leads.filter(l => l.Agen_ID === filterById);

    const headers = [
      'No', 'Tanggal', 'Nama', 'No WA', 'Email', 'Sumber', 'Keterangan',
      'Minat Tipe', 'Tipe Properti', 'Jenis', 'Budget Min', 'Budget Max',
      'Lokasi', 'Status', 'Agen', 'Last Contact', 'Next FU',
      'FU Tanggal', 'FU Keterangan', 'Catatan', 'Closing Tipe',
    ];
    const rows = leads.map((l, i) => [
      i + 1, fmtDate(l.Tanggal), l.Nama, l.No_WA, l.Email, l.Sumber, l.Keterangan,
      l.Minat_Tipe, l.Tipe_Properti, l.Jenis, l.Budget_Min, l.Budget_Max,
      l.Lokasi_Preferred, l.Status_Lead, l.Agen_Nama, fmtDate(l.Last_Contact), fmtDate(l.Next_Follow_Up),
      fmtDate(l.FU_Tanggal), l.FU_Keterangan, l.Catatan, l.Closing_Tipe,
    ]);

    await sendExcel(res, {
      title:    `DATA LEADS - ${nama} ${todayDisplay()}`,
      headers,
      rows,
      filename: `leads-${label.toLowerCase()}-${todayFile()}.xlsx`,
    });
  } catch (e) {
    console.error('[Export/leads]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /export/listings ───────────────────────────────────
router.get('/listings', async (req, res) => {
  try {
    const raw = await sheetsService.getRange(SHEETS.LISTING);
    const [, ...data] = raw;
    let listings = data.map(r => rowToObj(r, COLUMNS.LISTING)).filter(l => l.ID);

    const { role, id, nama } = req.user;
    const { filterById, label } = resolveScope(role, id, req.query.scope);
    if (filterById) listings = listings.filter(l => l.Agen_ID === filterById);

    const headers = [
      'No', 'Tanggal Input', 'Kode', 'Tipe Properti', 'Status Transaksi', 'Status Listing', 'Nama Pemilik',
      'Judul', 'Harga', 'Alamat', 'Kecamatan', 'Kota', 'Provinsi',
      'LT (m²)', 'LB (m²)', 'KT', 'KM', 'Sertifikat', 'Kondisi',
      'Agen', 'Tampil Web',
    ];

    const px = (raw, re) => { const m = (raw || '').match(re); return m ? m[1] : ''; };

    const rows = listings.map((l, i) => {
      const d   = l.Deskripsi || '';
      const lt  = l.Luas_Tanah    || px(d, /LT[:\s]*(\d+)/i);
      const lb  = l.Luas_Bangunan || px(d, /LB[:\s]*(\d+)/i);
      const kt  = l.Kamar_Tidur   || px(d, /(\d+(?:[+\-]\d+)?)\s*KT/i);
      const km  = l.Kamar_Mandi   || px(d, /(\d+(?:[+\-]\d+)?)\s*KM/i);
      const srt = l.Sertifikat    || px(d, /(SHM|HGB|SHGB|AJB|Girik|Strata Title)/i);
      return [
        i + 1, fmtDate(l.Tanggal_Input), l.Kode_Listing, l.Tipe_Properti, l.Status_Transaksi, l.Status_Listing, l.Nama_Pemilik,
        l.Judul, l.Harga_Format, l.Alamat, l.Kecamatan, l.Kota, l.Provinsi,
        lt, lb, kt, km, srt, l.Kondisi,
        l.Agen_Nama, l.Tampilkan_di_Web,
      ];
    });

    await sendExcel(res, {
      title:    `DATA LISTING - ${nama} ${todayDisplay()}`,
      headers,
      rows,
      filename: `listings-${label.toLowerCase()}-${todayFile()}.xlsx`,
    });
  } catch (e) {
    console.error('[Export/listings]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /export/agents ────────────────────────────────────
router.get('/agents', async (req, res) => {
  try {
    const { role } = req.user;
    if (!['superadmin', 'principal', 'kantor', 'admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const raw = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...data] = raw;
    const agents = data.map(r => rowToObj(r, COLUMNS.AGENTS)).filter(a => a.ID);

    const { nama } = req.user;
    const headers = [
      'No', 'Nama', 'Email', 'No WA', 'Role', 'Status',
      'Join Date', 'Listing Count', 'Deal Count', 'Leads Count', 'Konversi Rate (%)', 'Kantor',
    ];
    const rows = agents.map((a, i) => [
      i + 1, a.Nama, a.Email, a.No_WA, a.Role, a.Status,
      fmtDate(a.Join_Date), a.Listing_Count, a.Deal_Count, a.Leads_Count, a.Konversi_Rate, a.Nama_Kantor,
    ]);

    await sendExcel(res, {
      title:    `DATA AGEN - ${nama} ${todayDisplay()}`,
      headers,
      rows,
      filename: `agents-${todayFile()}.xlsx`,
    });
  } catch (e) {
    console.error('[Export/agents]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /export/rental ────────────────────────────────────
router.get('/rental', async (req, res) => {
  try {
    const raw = await sheetsService.getRange(SHEETS.RENTAL_STATUS);
    const [, ...data] = raw;
    let records = data.map(r => rowToObj(r, COLUMNS.RENTAL_STATUS)).filter(r => r.ID);

    const { role, id, nama } = req.user;
    const { filterById, label } = resolveScope(role, id, req.query.scope);
    if (filterById) records = records.filter(r => r.Agen_ID === filterById);

    const headers = [
      'No', 'Nama Penyewa', 'Alamat Sewa', 'Tgl Mulai', 'Durasi (Bln)',
      'Tgl Selesai', 'Status', 'Agen Listing', 'Agen Selling', 'CoBroke',
      'Catatan', 'Reminder 90 Hari', 'Reminder 30 Hari', 'Hasil FU Reminder',
    ];
    const rows = records.map((r, i) => [
      i + 1, r.Nama_Penyewa, r.Alamat_Sewa, fmtDate(r.Tanggal_Mulai), r.Durasi_Bulan,
      fmtDate(r.Tanggal_Selesai), r.Status, r.Agen_Listing_Nama, r.Agen_Selling_Nama, r.CoBroke,
      r.Catatan, reminderDate(r.Tanggal_Selesai, 90), reminderDate(r.Tanggal_Selesai, 30), r.Hasil_FU_Reminder,
    ]);

    await sendExcel(res, {
      title:    `DATA SEWA - ${nama} ${todayDisplay()}`,
      headers,
      rows,
      filename: `rental-${label.toLowerCase()}-${todayFile()}.xlsx`,
    });
  } catch (e) {
    console.error('[Export/rental]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /export/payment ───────────────────────────────────
router.get('/payment', async (req, res) => {
  try {
    const { role, id: userId, nama, team_id } = req.user;

    // Ambil payment stages + leads (untuk enrich nama lead & agen)
    const [payRaw, leadRaw] = await Promise.all([
      sheetsService.getRange(SHEETS.PAYMENT_STAGES),
      sheetsService.getRange(SHEETS.LEADS),
    ]);

    const [, ...payData]  = payRaw;
    const [, ...leadData] = leadRaw;

    let records = payData.map(r => rowToObj(r, COLUMNS.PAYMENT_STAGES)).filter(r => r.ID);

    // Build lead lookup map
    const leadMap = {};
    leadData.forEach(r => {
      const l = rowToObj(r, COLUMNS.LEADS);
      if (l.ID) leadMap[l.ID] = l;
    });

    // Filter by role / scope
    const scopeMine = req.query.scope === 'mine';
    if (role === 'agen' || role === 'koordinator' || scopeMine) {
      records = records.filter(r => {
        const lead = leadMap[r.Lead_ID];
        return lead && lead.Agen_ID === userId;
      });
    } else if (role === 'business_manager') {
      records = records.filter(r => {
        const lead = leadMap[r.Lead_ID];
        return lead && (lead.Team_ID === team_id || lead.Agen_ID === userId);
      });
    }

    const headers = [
      'No', 'Nama Klien', 'Agen', 'Listing',
      'Tanda Jadi (Rp)', 'Tgl Tanda Jadi',
      'DP 1 (Rp)',        'Tgl DP 1',
      'DP 2 (Rp)',        'Tgl DP 2',
      'Pelunasan (Rp)',   'Tgl Pelunasan',
      'Catatan', 'Status', 'Updated At',
    ];

    const rows = records.map((r, i) => {
      const lead = leadMap[r.Lead_ID] || {};
      return [
        i + 1,
        lead.Nama        || r.Lead_ID,
        lead.Agen_Nama   || '',
        lead.Closing_Listing_Nama || lead.Closing_Cobroke || lead.Closing_Proyek || '',
        r.Tanda_Jadi,     fmtDate(r.Tgl_Tanda_Jadi),
        r.DP1,            fmtDate(r.Tgl_DP1),
        r.DP2,            fmtDate(r.Tgl_DP2),
        r.Pelunasan,      fmtDate(r.Tgl_Pelunasan),
        r.Catatan,        r.Status,
        fmtDate(r.Updated_At),
      ];
    });

    await sendExcel(res, {
      title:    `LAPORAN TRANSAKSI - ${nama} ${todayDisplay()}`,
      headers,
      rows,
      filename: `laporan-transaksi-${todayFile()}.xlsx`,
    });
  } catch (e) {
    console.error('[Export/payment]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
