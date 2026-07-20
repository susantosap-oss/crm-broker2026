/**
 * AI Script Routes — Voice Over Generator
 * Base: /api/v1/ai-script
 */
const express        = require('express');
const router         = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const aiScriptService    = require('../services/ai-script.service');
const listingsService    = require('../services/listings.service');
const projectsService    = require('../services/projects.service');

const VALID_DURATIONS = [15, 30, 60];
const VALID_STYLES    = ['profesional', 'casual', 'mewah'];

// POST /api/v1/ai-script/generate
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { listing_id, listing_type = 'secondary', duration = 30, style = 'profesional' } = req.body;

    if (!listing_id) {
      return res.status(400).json({ success: false, message: 'listing_id wajib diisi' });
    }
    if (!VALID_DURATIONS.includes(Number(duration))) {
      return res.status(400).json({ success: false, message: 'duration harus 15, 30, atau 60' });
    }
    if (!VALID_STYLES.includes(style)) {
      return res.status(400).json({ success: false, message: 'style tidak valid' });
    }

    let data;
    if (listing_type === 'primary') {
      const projects = await projectsService.getAll();
      data = projects.find(p => p.ID === listing_id);
    } else {
      const listings = await listingsService.getAll({});
      data = listings.find(l => l.ID === listing_id);
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }

    const result = await aiScriptService.generateScript(data, listing_type, Number(duration), style);

    res.json({ success: true, data: result });
  } catch (e) {
    console.error('[AIScript] generate error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
