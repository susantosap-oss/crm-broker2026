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

router.use(authMiddleware);

function rowToPayment(row) {
  return COLUMNS.PAYMENT_STAGES.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
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
      return res.json({ success: true, data: rowToPayment(updated) });
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
      return res.json({ success: true, data: rowToPayment(newRow) });
    }
  } catch (e) {
    console.error('[Payment/upsert]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
