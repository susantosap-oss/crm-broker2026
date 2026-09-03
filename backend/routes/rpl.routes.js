/**
 * RPL Routes — /api/v1/rpl
 * ============================================
 * Ekstrak data CRM sebagai Berkas Bukti Portofolio
 * RPL (Rekognisi Pembelajaran Lampau) KKNI VI.
 *
 * Akses: superadmin | principal | kantor | admin
 *
 * Endpoints:
 *   GET /rpl/portfolio
 *     Query: agen_id, tanggal_mulai (YYYY-MM-DD), tanggal_selesai (YYYY-MM-DD)
 *     Response: JSON terstruktur 5 unit SKKNI
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const rplService = require('../services/rpl.service');

const ALLOWED = ['superadmin', 'principal', 'kantor', 'admin'];

router.get('/portfolio', authMiddleware, requireRole(ALLOWED), async (req, res) => {
  try {
    const { agen_id, tanggal_mulai, tanggal_selesai } = req.query;

    if (!agen_id || !tanggal_mulai || !tanggal_selesai) {
      return res.status(400).json({
        success: false,
        message: 'Parameter wajib: agen_id, tanggal_mulai, tanggal_selesai (format YYYY-MM-DD)',
      });
    }

    if (isNaN(Date.parse(tanggal_mulai)) || isNaN(Date.parse(tanggal_selesai))) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan YYYY-MM-DD.',
      });
    }

    const portfolio = await rplService.generatePortfolio(agen_id, tanggal_mulai, tanggal_selesai);
    res.json({ success: true, data: portfolio });

  } catch (err) {
    console.error('[RPL] generatePortfolio error:', err);
    if (err.message.includes('tidak ditemukan')) {
      return res.status(404).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
