/**
 * Property Search API — Internal (JWT Auth)
 * Base: /api/v1/search
 * ============================================
 * Digunakan oleh CRM internal untuk pencarian listing.
 * Mode internalMode=true: result menyertakan data agen.
 *
 * Endpoints:
 *   GET  /                → Search dengan query params
 *   POST /                → Search dengan JSON body (AI-ready)
 *   GET  /options         → Filter options untuk dropdown UI
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const searchService  = require('../services/search.service');
const { extractFilter } = require('../services/ai-filter.service');

// ── GET /api/v1/search ─────────────────────────────────────
// Query params: keyword, property_type, transaction_type,
//   city, area, cluster, developer, price_min, price_max,
//   bedroom_min, bathroom_min, land_area_min, land_area_max,
//   building_area_min, building_area_max, status, agent_id,
//   featured, page, limit, sort
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await searchService.search(req.query, { internalMode: true });
    res.json({
      success: true,
      ...result,
      meta: {
        query:     req.query,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[SEARCH GET]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/v1/search ────────────────────────────────────
// Body: JSON filter object — endpoint ini dirancang untuk
// integrasi AI Phase 2. AI cukup POST filter JSON ke sini.
router.post('/', authMiddleware, async (req, res) => {
  try {
    // Merge query params + body (body takes precedence)
    const params = { ...req.query, ...req.body };
    const result = await searchService.search(params, { internalMode: true });
    res.json({
      success: true,
      ...result,
      meta: {
        filter:    params,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[SEARCH POST]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/v1/search/options ─────────────────────────────
// Mengembalikan nilai unik semua filter untuk UI dropdown
router.get('/options', authMiddleware, async (req, res) => {
  try {
    const options = await searchService.getFilterOptions({ publicOnly: false });
    res.json({ success: true, data: options });
  } catch (err) {
    console.error('[SEARCH OPTIONS]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/v1/search/ai ─────────────────────────────────
// AI Search: natural language → filter → search (internal, JWT)
router.post('/ai', authMiddleware, async (req, res) => {
  const { query, page = 1, limit = 20, sort = 'terbaru' } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ success: false, message: 'Field "query" wajib diisi' });
  }
  try {
    const { filter, raw_query, ai_extracted, fallback } = await extractFilter(query.trim());
    const params = {
      ...filter,
      page:  Number(page)  || 1,
      limit: Math.min(Number(limit) || 20, 100),
      sort,
    };
    const result = await searchService.search(params, { internalMode: true });
    res.json({
      success: true,
      ...result,
      ai: {
        raw_query,
        extracted_filter: filter,
        ai_raw:           ai_extracted || null,
        fallback:         fallback || false,
      },
    });
  } catch (err) {
    console.error('[AI SEARCH INTERNAL]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
