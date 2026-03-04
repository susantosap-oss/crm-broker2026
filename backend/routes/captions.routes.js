// captions.routes.js
const express = require('express');
const router  = express.Router();
const captionService = require('../services/caption.service');
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/generate', (req, res) => {
  try {
    const { listing, style } = req.body;
    const caption = captionService.generate(listing, style || 'standard');
    const captionLuxury = captionService.generate(listing, 'luxury');
    const captionInvest = captionService.generate(listing, 'investment');
    res.json({ success: true, data: { standard: caption, luxury: captionLuxury, investment: captionInvest } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
