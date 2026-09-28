const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const eliteSvc = require('../services/elite.service');

const MANAGE_ROLES = ['superadmin','principal','kantor','admin'];

router.use(authMiddleware);

// GET /:agentId — all TRX + monthly summary
router.get('/:agentId', async (req, res) => {
  try {
    const isAdmin = MANAGE_ROLES.includes(req.user.role);
    if (!isAdmin && req.user.id !== req.params.agentId) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const trxList = await eliteSvc.getTransactionsByAgent(req.params.agentId);

    const monthly = {};
    trxList.forEach(t => {
      const m = t.Bulan || t.Tanggal?.slice(0,7) || '';
      if (!m) return;
      if (!monthly[m]) monthly[m] = { bulan: m, count: 0, totalEfektif: 0, totalKomisi: 0 };
      monthly[m].count++;
      monthly[m].totalEfektif += parseFloat(t.Nilai_Efektif) || 0;
      monthly[m].totalKomisi  += parseFloat(t.Nilai_Komisi) || 0;
    });
    const monthlySummary = Object.values(monthly).sort((a,b) => a.bulan.localeCompare(b.bulan));

    res.json({ success: true, data: trxList, monthlySummary });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST / — add TRX
router.post('/', async (req, res) => {
  const isAdmin = MANAGE_ROLES.includes(req.user.role);
  const isElite = req.user.statusElite === 'ELITE';
  if (!isAdmin && !isElite) {
    // Re-check from sheet
    try {
      const agent = await eliteSvc.getAgentById(req.user.id);
      if (agent?.Status_Elite !== 'ELITE' && !isAdmin) {
        return res.status(403).json({ success: false, message: 'Hanya ELITE Partner yang bisa menambah transaksi' });
      }
    } catch {
      return res.status(403).json({ success: false, message: 'Hanya ELITE Partner yang bisa menambah transaksi' });
    }
  }
  try {
    const trx = await eliteSvc.addTransaction(req.body, req.user);
    res.json({ success: true, data: trx, message: 'Transaksi berhasil ditambahkan' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// PUT /:id — edit TRX
router.put('/:id', async (req, res) => {
  const isAdmin = MANAGE_ROLES.includes(req.user.role);
  try {
    const trx = await eliteSvc.updateTransaction(req.params.id, req.body, isAdmin ? req.body.agentId || req.user.id : req.user.id);
    res.json({ success: true, data: trx, message: 'Transaksi berhasil diperbarui' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// DELETE /:id — delete TRX
router.delete('/:id', async (req, res) => {
  const isAdmin = MANAGE_ROLES.includes(req.user.role);
  try {
    await eliteSvc.deleteTransaction(req.params.id, req.user.id, isAdmin);
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

module.exports = router;
