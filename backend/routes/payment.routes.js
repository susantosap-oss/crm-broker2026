/**
 * Payment Stages Routes — /api/v1/payment
 * 1 row per lead (upsert pattern).
 *
 * GET  /payment/lead/:lead_id  — ambil tahap pembayaran untuk 1 lead
 * PUT  /payment/lead/:lead_id  — upsert (create / update) tahap pembayaran
 *
 * Akses:
 *   agen/koordinator : lead milik sendiri
 *   business_manager : lead tim sendiri
 *   principal/kantor/admin/superadmin : semua
 */

const express       = require('express');
const router        = express.Router();
const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');
const eliteService   = require('../services/elite.service');

router.use(authMiddleware);

function rowToPayment(row) {
  return COLUMNS.PAYMENT_STAGES.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// Auto-push ke ELITE_TRANSACTIONS jika agen berstatus ELITE
async function syncToEliteIfNeeded(lead, payment) {
  try {
    const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...agentData] = agentRows;
    const aRow = agentData.find(r => r[0] === lead.Agen_ID);
    if (!aRow) return;
    const agen = COLUMNS.AGENTS.reduce((o, c, i) => { o[c] = aRow[i] || ''; return o; }, {});
    if (agen.Status_Elite !== 'ELITE') return;

    const totalNilai = ['Tanda_Jadi', 'DP1', 'DP2', 'Pelunasan']
      .reduce((sum, k) => sum + (parseFloat(payment[k]) || 0), 0);

    await eliteService.addTransaction({
      tanggal:          payment.Tgl_Pelunasan || new Date().toISOString().slice(0, 10),
      alamatTransaksi:  lead.Closing_Listing_Nama || lead.Properti_Diminati || lead.Closing_Cobroke || '',
      tipe:             lead.Jenis === 'Sewa' ? 'Sewa' : 'Jual',
      coBroke:          !!lead.Closing_Cobroke,
      nilaiTransaksi:   totalNilai,
      komisiPersen:     0,
    }, { id: lead.Agen_ID, nama: lead.Agen_Nama, nama_kantor: agen.Nama_Kantor || '' });

    console.log(`[Payment→ELITE] Auto-sync: ${agen.Nama} Rp ${totalNilai.toLocaleString('id-ID')}`);
  } catch (e) {
    console.error('[Payment→ELITE] Sync error (non-blocking):', e.message);
  }
}

async function getLeadById(leadId) {
  const rows = await sheetsService.getRange(SHEETS.LEADS);
  const [, ...data] = rows;
  const row = data.find(r => r[0] === leadId);
  if (!row) return null;
  return COLUMNS.LEADS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

function canAccessLead(lead, user) {
  const { role, id, team_id } = user;
  if (['superadmin', 'principal', 'kantor', 'admin'].includes(role)) return true;
  if (role === 'business_manager') {
    return lead.Team_ID === team_id || lead.Agen_ID === id;
  }
  return lead.Agen_ID === id;
}

// ── GET /payment/lead/:lead_id ─────────────────────────────
router.get('/lead/:lead_id', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.lead_id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead tidak ditemukan' });
    if (!canAccessLead(lead, req.user)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const rows = await sheetsService.getRange(SHEETS.PAYMENT_STAGES);
    const [, ...data] = rows;
    const row = data.find(r => r[1] === req.params.lead_id);
    if (!row) return res.json({ success: true, data: null });
    res.json({ success: true, data: rowToPayment(row) });
  } catch (e) {
    console.error('[Payment/get]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PUT /payment/lead/:lead_id ─────────────────────────────
router.put('/lead/:lead_id', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.lead_id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead tidak ditemukan' });
    if (!canAccessLead(lead, req.user)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const { Tanda_Jadi, Tgl_Tanda_Jadi, DP1, Tgl_DP1, DP2, Tgl_DP2,
            Pelunasan, Tgl_Pelunasan, Catatan, Status } = req.body;

    const rows = await sheetsService.getRange(SHEETS.PAYMENT_STAGES);
    const [headers, ...data] = rows;
    const existingIdx = data.findIndex(r => r[1] === req.params.lead_id);
    const now = new Date().toISOString();

    if (existingIdx >= 0) {
      // Update existing row
      const existing = rowToPayment(data[existingIdx]);
      const updated = [
        existing.ID,
        req.params.lead_id,
        lead.Closing_Listing_ID || existing.Listing_ID || '',
        Tanda_Jadi     ?? existing.Tanda_Jadi,
        Tgl_Tanda_Jadi ?? existing.Tgl_Tanda_Jadi,
        DP1            ?? existing.DP1,
        Tgl_DP1        ?? existing.Tgl_DP1,
        DP2            ?? existing.DP2,
        Tgl_DP2        ?? existing.Tgl_DP2,
        Pelunasan      ?? existing.Pelunasan,
        Tgl_Pelunasan  ?? existing.Tgl_Pelunasan,
        Catatan        ?? existing.Catatan,
        Status         ?? existing.Status,
        req.user.id,
        existing.Created_At,
        now,
      ];
      // +2: row 1 = header, existingIdx 0-based → sheet row = existingIdx + 2
      await sheetsService.updateRow(SHEETS.PAYMENT_STAGES, existingIdx + 2, updated);
      const updatedPayment = rowToPayment(updated);
      // Auto-sync ke ELITE_TRANSACTIONS hanya saat status baru berubah menjadi 'Selesai'
      if (existing.Status !== 'Selesai' && updatedPayment.Status === 'Selesai') {
        await syncToEliteIfNeeded(lead, updatedPayment);
      }
      return res.json({ success: true, data: updatedPayment });
    } else {
      // Create new row
      const newRow = [
        uuidv4(),
        req.params.lead_id,
        lead.Closing_Listing_ID || '',
        Tanda_Jadi     || '',
        Tgl_Tanda_Jadi || '',
        DP1            || '',
        Tgl_DP1        || '',
        DP2            || '',
        Tgl_DP2        || '',
        Pelunasan      || '',
        Tgl_Pelunasan  || '',
        Catatan        || '',
        Status         || 'Berjalan',
        req.user.id,
        now,
        now,
      ];
      await sheetsService.appendRow(SHEETS.PAYMENT_STAGES, newRow);
      const newPayment = rowToPayment(newRow);
      // Auto-sync ke ELITE_TRANSACTIONS jika langsung dibuat dengan status Selesai
      if (newPayment.Status === 'Selesai') {
        await syncToEliteIfNeeded(lead, newPayment);
      }
      return res.json({ success: true, data: newPayment });
    }
  } catch (e) {
    console.error('[Payment/upsert]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
