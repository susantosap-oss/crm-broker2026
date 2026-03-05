/**
 * CRM Broker Properti
 * Server Entry Point — v2.0
 * ============================================
 * Roles: superadmin | principal | business_manager | admin | agen
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.APP_URL, process.env.WEBSITE_URL]
    : '*',
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static Files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Internal API Routes ────────────────────────────────────
app.use('/api/v1/auth',          require('./routes/auth.routes'));
app.use('/api/v1/listings',      require('./routes/listings.routes'));
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
app.use('/api/v1/laporan',       require('./routes/laporan.routes'));

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

  // Ensure new sheets have headers
  for (const { sheet, cols } of [
    { sheet: SHEETS.TEAMS,          cols: COLUMNS.TEAMS },
    { sheet: SHEETS.NOTIFICATIONS,  cols: COLUMNS.NOTIFICATIONS },
    { sheet: SHEETS.KOMISI_REQUEST, cols: COLUMNS.KOMISI_REQUEST },
    { sheet: SHEETS.LAPORAN_HARIAN, cols: COLUMNS.LAPORAN_HARIAN },
  ]) {
    try {
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
app.listen(PORT, async () => {
  console.log(`\n🏢 CRM Broker Properti v2.0`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`👥 Roles: superadmin | principal | business_manager | admin | agen`);
  console.log(`📊 Google Sheets SSoT connected\n`);
  await migrateHeaders();
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
