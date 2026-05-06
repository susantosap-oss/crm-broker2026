/**
 * SEO Routes — Bulk Title Generator
 * Base: /api/v1/seo
 * Akses: superadmin | principal
 */
const express  = require('express');
const router   = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const listingsService   = require('../services/listings.service');

const ALLOWED = ['superadmin', 'principal'];

function guard(req, res, next) {
  if (!ALLOWED.includes(req.user?.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  next();
}

const STATUS_MAP = {
  'Jual': 'Dijual', 'Sewa': 'Disewa',
  'Dijual': 'Dijual', 'Disewa': 'Disewa', 'Disewakan': 'Disewa',
};

function buildTitle(l, template, trend = '') {
  const status = STATUS_MAP[l.Status_Transaksi] || l.Status_Transaksi || '';
  const kt     = l.Kamar_Tidur ? `${l.Kamar_Tidur}KT ` : '';
  return template
    .replace(/\{Tipe\}/g,      l.Tipe_Properti || '')
    .replace(/\{Status\}/g,    status)
    .replace(/\{KT\}/g,        kt)
    .replace(/\{Kecamatan\}/g, l.Kecamatan || '')
    .replace(/\{Kota\}/g,      l.Kota || '')
    .replace(/\{Harga\}/g,     l.Harga_Format || l.Harga || '')
    .replace(/\{Trend\}/g,     trend)
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s|\s$/g, '')
    .replace(/\s—/g, ' —')
    .trim();
}

// ── GET /trends — Google Trends properti Indonesia + fallback kurasi ──
router.get('/trends', authMiddleware, guard, async (req, res) => {
  const CURATED = [
    { keyword: 'Harga Terbaik',       score: 95 },
    { keyword: 'Ready Stok',          score: 88 },
    { keyword: 'KPR 2026',            score: 82 },
    { keyword: 'Subsidi',             score: 76 },
    { keyword: 'Cicilan Ringan',       score: 71 },
    { keyword: 'Investasi Properti',   score: 65 },
    { keyword: 'Lokasi Strategis',     score: 62 },
    { keyword: 'SHM',                 score: 58 },
    { keyword: 'Smart Home',          score: 54 },
    { keyword: 'Green Living',        score: 48 },
    { keyword: 'Bebas Banjir',        score: 45 },
    { keyword: 'Cluster Eksklusif',   score: 42 },
  ];

  try {
    const googleTrends = require('google-trends-api');
    const SEEDS = ['rumah dijual', 'properti jakarta', 'KPR murah', 'apartemen dijual', 'ruko dijual'];
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const results = await Promise.allSettled(
      SEEDS.map(kw => googleTrends.interestOverTime({ keyword: kw, geo: 'ID', startTime: since }))
    );

    const live = results
      .map((r, i) => {
        if (r.status !== 'fulfilled') return null;
        try {
          const tl = JSON.parse(r.value).default?.timelineData || [];
          const avg = tl.length
            ? Math.round(tl.reduce((s, t) => s + (t.value?.[0] || 0), 0) / tl.length)
            : 0;
          return { keyword: SEEDS[i], score: avg, source: 'google' };
        } catch { return null; }
      })
      .filter(Boolean);

    const merged = live.length >= 3 ? live : CURATED;
    res.json({ success: true, data: merged.sort((a, b) => b.score - a.score), source: live.length >= 3 ? 'google' : 'curated' });
  } catch {
    res.json({ success: true, data: CURATED, source: 'curated' });
  }
});

// ── GET /bulk-preview?template=...&trend=... ──
router.get('/bulk-preview', authMiddleware, guard, async (req, res) => {
  try {
    const template = (req.query.template || '{Tipe} {Status} {KT}di {Kecamatan} {Kota} — {Harga}').trim();
    const trend    = (req.query.trend || '').trim();
    const onlyBlank = req.query.only_blank === '1';

    const all = await listingsService.getAll({});
    let listings = all.filter(l => !['Terjual','Tersewa'].includes(l.Status_Listing));
    if (onlyBlank) listings = listings.filter(l => !l.Judul?.trim());

    const preview = listings.map(l => ({
      id:         l.ID,
      kode:       l.Kode_Listing || '',
      foto:       l.Foto_Utama_URL || '',
      judul_lama: l.Judul || '',
      judul_baru: buildTitle(l, template, trend),
      tipe:       l.Tipe_Properti || '',
      kota:       l.Kota || '',
      status:     l.Status_Listing || '',
    }));

    res.json({ success: true, data: preview, total: preview.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /bulk-apply — apply judul ke listing yang dipilih ──
router.post('/bulk-apply', authMiddleware, guard, async (req, res) => {
  try {
    const updates = req.body.updates || [];
    if (!updates.length) return res.status(400).json({ success: false, message: 'Tidak ada listing yang dipilih' });

    let ok = 0, fail = 0;
    for (const { id, judul } of updates) {
      if (!id || !judul?.trim()) { fail++; continue; }
      try { await listingsService.update(id, { Judul: judul.trim() }); ok++; }
      catch { fail++; }
    }

    res.json({ success: true, message: `${ok} judul diperbarui${fail ? `, ${fail} gagal` : ''}`, updated: ok, failed: fail });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
