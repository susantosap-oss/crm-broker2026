const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const eliteSvc = require('../services/elite.service');

const MANAGE_ROLES = ['superadmin','principal','kantor','admin'];

router.use(authMiddleware);

// GET /agents — list ELITE agents
router.get('/agents', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const programs = await eliteSvc.listElitePrograms();
    const active = programs.filter(p => ['Aktif','Draft'].includes(p.Status));

    const { rowsToObjects } = eliteSvc;
    const sheetsService = require('../services/sheets.service');
    const { SHEETS } = require('../config/sheets.config');
    const trxRows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
    const allTrx = rowsToObjects(trxRows);

    const result = active.map(p => {
      const agentTrx = allTrx.filter(t => t.Agent_ID === p.Agent_ID);
      const totalTrx = agentTrx.reduce((s, t) => s + (parseFloat(t.Nilai_Efektif) || 0), 0);
      const today = new Date();
      const end = new Date(p.Tanggal_Berakhir);
      const sisaHari = p.Tanggal_Berakhir ? Math.floor((end - today) / (24*60*60*1000)) : null;
      const target = parseFloat(p.Target_Kuartal_Nilai) || 0;
      return { ...p, totalTrxEfektif: totalTrx, sisaHari, target80: target * 0.8 };
    });

    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /agent/:agentId — draft/active program for agent
router.get('/agent/:agentId', async (req, res) => {
  try {
    const program = await eliteSvc.getProgramByAgent(req.params.agentId);
    res.json({ success: true, data: program });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /grant — create/update checklist draft
router.post('/grant', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const program = await eliteSvc.saveChecklist(req.body, req.user.nama || req.user.id);
    res.json({ success: true, data: program, message: 'Checklist disimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /activate/:agentId — activate ELITE
router.post('/activate/:agentId', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const program = await eliteSvc.activateElite(req.params.agentId, req.user.nama || req.user.id);
    res.json({ success: true, data: program, message: 'ELITE Partner berhasil diaktifkan' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// PUT /terminate/:id — terminate + reason
router.put('/terminate/:id', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const program = await eliteSvc.terminateProgram(req.params.id, req.body.reason, req.user.nama || req.user.id);
    res.json({ success: true, data: program, message: 'Program dihentikan' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// GET /content — program content (all roles)
router.get('/content', async (req, res) => {
  try {
    const content = await eliteSvc.getContent();
    res.json({ success: true, data: content });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /content — edit content
router.put('/content', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    await eliteSvc.updateContent(req.body, req.user.nama || req.user.id);
    res.json({ success: true, message: 'Konten berhasil diperbarui' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
