/**
 * Public Shortlink Route — /p/:refCode
 * ============================================
 * Redirect shortlink proyek + catat klik untuk tracking agen.
 * Route ini TIDAK butuh auth (public).
 *
 * Flow:
 *   1. User klik shortlink: /p/PRJ-RMH-2026-001?r=AB12CD
 *   2. Server log klik ke PROJECT_REFS
 *   3. Redirect ke halaman detail CRM dengan query agar frontend buka detail
 *
 * Dipasang di server.js SEBELUM authMiddleware:
 *   app.use('/p', require('./routes/shortlink.routes'));
 */

const express = require('express');
const router  = express.Router();
const projectsService = require('../services/projects.service');
const sheetsService   = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// GET /p/:kode?r=refCode
router.get('/:kode', async (req, res) => {
  const { kode } = req.params;
  const { r: refCode } = req.query;

  // Log klik jika ada refCode
  if (refCode) {
    projectsService.logClick(refCode).catch(() => {});
  }

  // Temukan project by kode
  try {
    const rows = await sheetsService.getRange(SHEETS.PROJECTS);
    if (rows && rows.length > 1) {
      const kodeIdx = COLUMNS.PROJECTS.indexOf('Kode_Proyek');
      const idIdx   = COLUMNS.PROJECTS.indexOf('ID');
      const found   = rows.slice(1).find(r => r[kodeIdx] === kode);
      if (found) {
        const projectId = found[idIdx];
        // Redirect ke SPA dengan fragment agar frontend buka detail
        return res.redirect(`/?primary=1&pid=${projectId}${refCode ? '&r=' + refCode : ''}`);
      }
    }
  } catch (_) {}

  // Fallback — redirect ke halaman utama
  res.redirect('/?primary=1');
});

module.exports = router;
