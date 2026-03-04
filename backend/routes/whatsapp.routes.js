// whatsapp.routes.js
const express = require('express');
const router  = express.Router();
const waService = require('../services/whatsapp.service');
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/send', async (req, res) => {
  try {
    const { noWa, pesan, leadId } = req.body;
    const result = await waService.sendSingle(leadId, noWa, pesan, req.user.id);
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/broadcast', async (req, res) => {
  try {
    const { leads, pesanTemplate, delayMs } = req.body;
    const result = await waService.sendBroadcast(leads, pesanTemplate, req.user.id, delayMs);
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/link', (req, res) => {
  const { noWa, pesan } = req.query;
  const link = waService.generateWaLink(noWa, pesan);
  res.json({ success: true, data: { link } });
});

module.exports = router;
