/**
 * CRM Broker Properti
 * Server Entry Point — v2.0
 * ============================================
 * Roles: superadmin | principal | business_manager | admin | agen
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Cloud Run / Cloudflare proxy — trust 1 hop supaya rate-limit dapat IP asli
app.set('trust proxy', 1);

// ── Middleware ─────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// General rate limit: 200 req/menit per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak request, coba lagi dalam 1 menit' }
});
app.use('/api/', generalLimiter);
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.APP_URL, process.env.WEBSITE_URL]
    : '*',
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },  // untuk verifikasi signature Meta webhook
}));
app.use(express.urlencoded({ extended: true }));

// ── Static Files ───────────────────────────────────────────
// JS & HTML: no-cache agar browser selalu fetch terbaru saat query string berubah
// Assets (gambar, icon): 7 hari cache aman karena nama file tidak berubah
app.use('/js', express.static(path.join(__dirname, '../frontend/js'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
app.use('/sw.js', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ── Internal API Routes ────────────────────────────────────
app.use('/api/v1/auth',          require('./routes/auth.routes'));
app.use('/api/v1/listings',      require('./routes/listings.routes'));
app.use('/api/v1/favourites',    require('./routes/favourites.routes'));
app.use('/api/v1/leads',         require('./routes/leads.routes'));
app.use('/api/v1/agents',        require('./routes/agents.routes'));
app.use('/api/v1/teams',         require('./routes/teams.routes'));
app.use('/api/v1/notifications', require('./routes/notifications.routes'));
app.use('/api/v1/whatsapp',      require('./routes/whatsapp.routes'));
app.use('/api/v1/media',         require('./routes/media.routes'));
app.use('/api/v1/dashboard',     require('./routes/dashboard.routes'));
app.use('/api/v1/captions',      require('./routes/captions.routes'));
app.use('/api/v1/tasks',         require('./routes/tasks.routes'));
app.use('/api/v1/komisi',        require('./routes/komisi.routes'));
app.use('/api/v1/projects',  require('./routes/projects.routes'));
app.use('/api/v1/laporan',       require('./routes/laporan.routes'));
app.use('/api/v1/share-log',     require('./routes/share-log.routes'));
app.use('/api/v1/listing-agents', require('./routes/listing_agents.routes'));
app.use('/api/v1/aktivitas',      require('./routes/aktivitas.routes'));
app.use('/api/v1/push',           require('./routes/push.routes'));
// ★ Fitur 2 — PA (OpenClaw) + ViGen (Video Engine)
// PA routes: /api/v1/pa/*  |  ViGen routes: /api/v1/pa/vigen/*
app.use('/api/v1/pa',             require('./routes/pa.routes'));
// ★ Fitur 2 — Meta/Zapier Webhook + Config API
// Semua rute webhook (meta, zapier, config) dihandle satu router
const webhookRouter = require('./routes/meta-webhook.routes');
app.use('/api/v1/webhook',        webhookRouter);

// Config endpoints
app.get('/api/v1/config/cloudinary', (req, res) => {
  res.json({
    success: true,
    cloudName:    process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || 'crm_unsigned',
  });
});

// ── PUBLIC API ─────────────────────────────────────────────
const publicApiLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000, max: 60,
  message: { success: false, message: 'Too many requests.' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
});
app.use('/public/api/v1', publicApiLimiter);
app.use('/public/api/v1', require('./routes/public.routes'));

// ── Health Check ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'OK', app: process.env.APP_NAME, timestamp: new Date().toISOString(), version: '2.0.0' });
});

// ── Global Error Handler ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  if (req.path.startsWith('/api/') || req.path.startsWith('/public/')) {
    return res.status(err.status || 500).json({
      success: false, message: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }
  next(err);
});

// ── SPA Fallback ───────────────────────────────────────────
app.use('/p', require('./routes/shortlink.routes'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Auto-migrate: ensure new sheet headers exist ──────────
async function migrateHeaders() {
  const sheetsService = require('./services/sheets.service');
  const { SHEETS, COLUMNS } = require('./config/sheets.config');

  const sheetsToMigrate = [
    { sheet: SHEETS.LEADS,   cols: COLUMNS.LEADS },
    { sheet: SHEETS.LISTING, cols: COLUMNS.LISTING },
    { sheet: SHEETS.AGENTS,  cols: COLUMNS.AGENTS },
  ];

  for (const { sheet, cols } of sheetsToMigrate) {
    try {
      const rows = await sheetsService.getRange(sheet);
      if (!rows?.[0]) continue;
      const existing = rows[0];
      let updated = false;
      const newHeaders = [...existing];
      cols.forEach(col => {
        if (!existing.includes(col)) {
          newHeaders.push(col);
          updated = true;
          console.log(`📊 [Migrate] ${sheet}: +${col}`);
        }
      });
      if (updated) {
        await sheetsService.updateRow(sheet, 1, newHeaders);
        console.log(`✅ [Migrate] ${sheet} headers updated`);
      }
    } catch (e) {
      console.warn(`[Migrate] ${sheet} skipped:`, e.message);
    }
  }

  // Ensure new sheets exist (buat tab + headers jika belum ada)
  for (const { sheet, cols } of [
    { sheet: SHEETS.TEAMS,            cols: COLUMNS.TEAMS },
    { sheet: SHEETS.NOTIFICATIONS,    cols: COLUMNS.NOTIFICATIONS },
    { sheet: SHEETS.KOMISI_REQUEST,   cols: COLUMNS.KOMISI_REQUEST },
    { sheet: SHEETS.LAPORAN_HARIAN,   cols: COLUMNS.LAPORAN_HARIAN },
    { sheet: SHEETS.PROJECTS,         cols: COLUMNS.PROJECTS },
    { sheet: SHEETS.PROJECT_REFS,     cols: COLUMNS.PROJECT_REFS },
    { sheet: SHEETS.LISTING_AGENTS,   cols: COLUMNS.LISTING_AGENTS },
    { sheet: SHEETS.AKTIVITAS_HARIAN, cols: COLUMNS.AKTIVITAS_HARIAN },
    // ★ Fitur 2 — PA + ViGen + Meta Ads + Webhook Config
    { sheet: SHEETS.PA_CREDENTIALS,   cols: COLUMNS.PA_CREDENTIALS },
    { sheet: SHEETS.PA_JOBS,          cols: COLUMNS.PA_JOBS },
    { sheet: SHEETS.META_ADS_LOG,     cols: COLUMNS.META_ADS_LOG },
    { sheet: SHEETS.VIGEN_JOBS,       cols: COLUMNS.VIGEN_JOBS },
    { sheet: SHEETS.WEBHOOK_CONFIG,      cols: COLUMNS.WEBHOOK_CONFIG },
    { sheet: SHEETS.PUSH_SUBSCRIPTIONS, cols: COLUMNS.PUSH_SUBSCRIPTIONS },
  ]) {
    try {
      // Pastikan tab ada di spreadsheet (buat jika belum)
      await sheetsService.ensureSheet(sheet, cols);
      // Jika tab sudah ada tapi headers kosong, isi headers
      const rows = await sheetsService.getRange(sheet);
      if (!rows?.[0] || rows[0].length === 0) {
        await sheetsService.updateRow(sheet, 1, cols);
        console.log(`✅ [Migrate] ${sheet} headers created`);
      }
    } catch (e) {
      console.warn(`[Migrate] ${sheet} skipped:`, e.message);
    }
  }
}

// ── Start Server ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏢 CRM Broker Properti v2.0`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`👥 Roles: superadmin | principal | kantor | business_manager | admin | agen`);
  console.log(`📊 Google Sheets SSoT connected\n`);

  // Jalankan migrasi di background — tidak blocking startup Cloud Run
  setTimeout(() => {
    migrateHeaders().catch(e => console.warn('[Migrate] Error:', e.message));
  }, 3000);

  // Load push subscriptions dari Sheets ke memory cache
  require('./services/push.service').loadSubscriptions().catch(() => {});

  // Mulai cron jobs (jadwal harian reminder, dll)
  require('./services/cron.service').startCronJobs();
});

// ── Telegram Bot Webhook Endpoint ──────────────────────────
// HARUS sebelum SPA fallback, SETELAH semua /api routes
if (process.env.TELEGRAM_BOT_TOKEN) {
  const telegramBot = require('./telegram-bot');
  if (telegramBot) {
    // Endpoint yang menerima update dari Telegram
    app.post('/api/telegram-webhook', (req, res) => {
      try {
        telegramBot.processUpdate(req.body);
        res.sendStatus(200);
      } catch(e) {
        console.error('[Webhook] processUpdate error:', e.message);
        res.sendStatus(200); // tetap 200 agar Telegram tidak retry spam
      }
    });
    console.log('🤖 Telegram Bot aktif (webhook mode) — endpoint: POST /api/telegram-webhook');
  }
}

module.exports = app;
