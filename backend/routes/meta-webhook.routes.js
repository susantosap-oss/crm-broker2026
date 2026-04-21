/**
 * Webhook Lead dari Meta Ads + Config API
 * ============================================
 * BASE: /api/v1/webhook
 *
 * PUBLIC (tanpa JWT):
 *   GET  /meta              — verifikasi hub.challenge dari Meta App
 *   POST /meta              — terima event leadgen dari Meta (mode: meta)
 *   POST /zapier/:agent_id  — terima lead dari Zapier per-agen (mode: zapier)
 *
 * AUTHENTICATED:
 *   GET  /config            — baca konfigurasi (semua role)
 *   POST /config            — simpan konfigurasi (superadmin|principal|kantor)
 *
 * WEBHOOK_CONFIG keys (Google Sheets tab WEBHOOK_CONFIG):
 *   webhook_type          : 'meta' | 'zapier' | 'none'  (default: none)
 *   base_url              : URL publik CRM (editable, default: APP_URL)
 *   meta_verify_token     : UUID auto-generate (dipakai di Meta App Dashboard)
 *   meta_page_access_token: diisi manual dari Meta App
 *   meta_app_secret       : App Secret dari Meta (untuk verifikasi X-Hub-Signature-256)
 *
 * Zapier Secret: PER-AGEN, disimpan di PA_CREDENTIALS col Zapier_Secret
 *   — generate via: POST /api/v1/pa/zapier-secret/generate
 *   — verify via  : paService.getZapierSecret(agent_id)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');

const sheetsService = require('../services/sheets.service');
const paService     = require('../services/pa.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { createNotification } = require('./notifications.routes');
const { authMiddleware } = require('../middleware/auth.middleware');

const CONFIG_ROLES = ['superadmin', 'principal', 'kantor'];

// ══════════════════════════════════════════════════════════
// WEBHOOK_CONFIG — baca/tulis KV sheet
// ══════════════════════════════════════════════════════════

async function readConfig() {
  try {
    const rows = await sheetsService.getRows(SHEETS.WEBHOOK_CONFIG);
    const cfg  = {};
    for (const r of rows) {
      if (r[0]) cfg[r[0]] = r[1] || '';
    }
    return cfg;
  } catch { return {}; }
}

async function writeConfigKey(key, value, updatedBy = 'system') {
  const rows = await sheetsService.getRows(SHEETS.WEBHOOK_CONFIG);
  const idx  = rows.findIndex(r => r[0] === key);
  const now  = new Date().toISOString();
  const row  = [key, value, now, updatedBy];
  if (idx >= 0) {
    await sheetsService.updateRow(SHEETS.WEBHOOK_CONFIG, idx + 2, row);
  } else {
    await sheetsService.appendRow(SHEETS.WEBHOOK_CONFIG, row);
  }
}

// Auto-init default values saat pertama kali (non-blocking)
async function ensureDefaults() {
  const cfg    = await readConfig();
  const writes = [];
  if (!cfg.webhook_type)         writes.push(writeConfigKey('webhook_type',            'none'));
  if (!cfg.base_url)             writes.push(writeConfigKey('base_url',                process.env.APP_URL || ''));
  if (!cfg.meta_verify_token)    writes.push(writeConfigKey('meta_verify_token',        uuidv4()));
  if (!cfg.meta_page_access_token) writes.push(writeConfigKey('meta_page_access_token', ''));
  if (!cfg.meta_app_secret)      writes.push(writeConfigKey('meta_app_secret',          ''));
  if (writes.length) await Promise.all(writes);
}
setImmediate(() => ensureDefaults().catch(e => console.warn('[WebhookConfig] ensureDefaults:', e.message)));

// ══════════════════════════════════════════════════════════
// CONFIG API (Authenticated)
// ══════════════════════════════════════════════════════════

// GET /config — semua role (baca saja)
router.get('/config', authMiddleware, async (req, res) => {
  try {
    const cfg      = await readConfig();
    const canEdit  = CONFIG_ROLES.includes(req.user.role);
    const baseUrl  = cfg.base_url || process.env.APP_URL || `https://${req.headers.host}`;

    res.json({
      success: true,
      data: {
        webhook_type:   cfg.webhook_type || 'none',
        base_url:       baseUrl,
        // URL template Pipedream — frontend replace {agent_id} dengan user.id
        zapier_url_template: `${baseUrl}/api/v1/webhook/pipedream/{agent_id}`,
        meta_webhook_url:    `${baseUrl}/api/v1/webhook/meta`,
        // Token/secret — tampil penuh untuk CONFIG_ROLES
        meta_verify_token:        cfg.meta_verify_token || '',
        meta_page_access_token:   canEdit
          ? cfg.meta_page_access_token || ''
          : cfg.meta_page_access_token ? '••••••••' : '',
        meta_app_secret:          canEdit
          ? cfg.meta_app_secret || ''
          : cfg.meta_app_secret ? '••••••••' : '',
        can_edit: canEdit,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /config — simpan (superadmin|principal|kantor)
router.post('/config', authMiddleware, async (req, res) => {
  if (!CONFIG_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Hanya superadmin/principal/kantor yang dapat mengubah konfigurasi webhook.' });
  }
  try {
    const {
      webhook_type,
      base_url,
      meta_page_access_token,
      meta_app_secret,
      regenerate_meta_token,
    } = req.body;
    const by = req.user.id;

    if (webhook_type && ['meta', 'zapier', 'none'].includes(webhook_type)) {
      await writeConfigKey('webhook_type', webhook_type, by);
    }
    if (base_url !== undefined && base_url.trim()) {
      // Pastikan tidak ada trailing slash
      await writeConfigKey('base_url', base_url.trim().replace(/\/$/, ''), by);
    }
    if (meta_page_access_token !== undefined) {
      await writeConfigKey('meta_page_access_token', meta_page_access_token, by);
    }
    if (meta_app_secret !== undefined) {
      await writeConfigKey('meta_app_secret', meta_app_secret, by);
    }
    if (regenerate_meta_token) {
      await writeConfigKey('meta_verify_token', uuidv4(), by);
    }

    res.json({ success: true, message: 'Konfigurasi webhook disimpan.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// META DIRECT WEBHOOK (Public)
// ══════════════════════════════════════════════════════════

// GET /meta — verifikasi webhook dari Meta App Dashboard
router.get('/meta', async (req, res) => {
  try {
    const cfg = await readConfig();
    if (cfg.webhook_type !== 'meta') {
      return res.status(400).send('Webhook mode bukan Meta. Ubah di pengaturan PA.');
    }
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === cfg.meta_verify_token) {
      console.log('[MetaWebhook] ✅ Webhook verified');
      return res.status(200).send(challenge);
    }
    console.warn('[MetaWebhook] ❌ Verify token tidak cocok');
    res.status(403).send('Forbidden');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// POST /meta — terima event leadgen dari Meta
router.post('/meta', async (req, res) => {
  // Verifikasi signature
  if (!_verifyMetaSignature(req)) {
    console.warn('[MetaWebhook] ❌ Signature tidak valid');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({ received: true }); // ACK segera

  setImmediate(async () => {
    try {
      const cfg = await readConfig();
      if (cfg.webhook_type !== 'meta') return; // Mode bukan Meta, abaikan

      const body = req.body;
      if (!body || body.object !== 'page') return;

      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          if (change.field === 'leadgen') {
            await _processMetaLead(change.value, cfg).catch(e =>
              console.error('[MetaWebhook] processLead error:', e.message)
            );
          }
        }
      }
    } catch (e) {
      console.error('[MetaWebhook] Unexpected error:', e.message);
    }
  });
});

// ══════════════════════════════════════════════════════════
// ZAPIER WEBHOOK PER-AGEN (Public)
// ══════════════════════════════════════════════════════════

/**
 * POST /zapier/:agent_id
 *
 * URL unik per agen — agent_id embedded di URL sehingga lead
 * langsung di-assign tanpa lookup tambahan.
 *
 * Payload dari Zapier (flexible field names):
 * {
 *   "secret":    "uuid-zapier-secret",   ← wajib, dari PA_CREDENTIALS agen
 *   "name":      "John Doe",             ← atau full_name
 *   "phone":     "628123456789",         ← atau phone_number / mobile
 *   "email":     "john@doe.com",
 *   "form_name": "Form Iklan",           ← opsional
 *   "ad_name":   "Nama Iklan",           ← opsional
 * }
 */
async function _handlePipedreamWebhook(req, res) {
  const { agent_id } = req.params;

  try {
    // 1. Cek mode webhook global — jika 'none', tolak
    const cfg = await readConfig();
    if (cfg.webhook_type === 'none') {
      return res.status(403).json({ error: 'Webhook tidak aktif. Agen perlu mengaktifkan mode Pipedream di pengaturan PA.' });
    }

    // 2. Verifikasi secret per-agen dari PA_CREDENTIALS
    const storedSecret   = await paService.getZapierSecret(agent_id);
    const incomingSecret = req.body?.secret || req.headers['x-zapier-secret'] || req.headers['x-pipedream-secret'] || '';

    if (!storedSecret || incomingSecret !== storedSecret) {
      console.warn(`[PipedreamWebhook] ❌ Secret tidak valid untuk agen ${agent_id}`);
      return res.status(401).json({ error: 'Invalid secret' });
    }

    // ACK segera
    res.status(200).json({ received: true });

    // 3. Proses lead async — agent_id sudah diketahui dari URL
    setImmediate(() =>
      _processZapierLead(req.body, agent_id).catch(e =>
        console.error('[PipedreamWebhook] processLead error:', e.message)
      )
    );

  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    console.error('[PipedreamWebhook] Error:', e.message);
  }
}

// Route utama: Pipedream
router.post('/pipedream/:agent_id', _handlePipedreamWebhook);

// Alias lama: /zapier/:agent_id (backward-compat untuk yg sudah terlanjur setup)
router.post('/zapier/:agent_id', _handlePipedreamWebhook);

// ══════════════════════════════════════════════════════════
// CORE: Proses lead masuk
// ══════════════════════════════════════════════════════════

async function _processZapierLead(body, agentId) {
  const b = body;
  const fields = {
    full_name:  b.full_name  || b.name  || '',
    phone:      b.phone_number || b.phone || b.mobile || '',
    email:      b.email || '',
    form_name:  b.form_name  || b.form  || '',
    ad_name:    b.ad_name    || b.campaign || '',
  };

  const agenInfo = await _getAgenInfo(agentId);
  await _insertLead(fields, agenInfo, 'zapier');
}

async function _processMetaLead({ leadgen_id, form_id, ad_id, page_id } = {}, cfg) {
  // Fetch detail dari Graph API
  const leadRaw = await _fetchLeadFromMeta(leadgen_id, cfg.meta_page_access_token);
  const fields  = _parseMetaFieldData(leadRaw?.field_data || []);

  // Lookup agen dari META_ADS_LOG via form_id / ad_id
  const agenId   = await _findAgenByFormOrAd(form_id, ad_id);
  const agenInfo = agenId ? await _getAgenInfo(agenId) : null;

  // Extra info ke keterangan
  fields.form_name = fields.form_name || form_id  || '';
  fields.ad_name   = fields.ad_name   || ad_id    || '';

  await _insertLead(fields, agenInfo, 'meta');
}

async function _insertLead(fields, agenInfo, source) {
  const id  = uuidv4();
  const now = new Date().toISOString();

  const row = COLUMNS.LEADS.map(col => {
    switch (col) {
      case 'ID':          return id;
      case 'Tanggal':     return now;
      case 'Nama':        return fields.full_name || 'Lead Meta Ads';
      case 'No_WA':       return fields.phone || '';
      case 'Email':       return fields.email || '';
      case 'Sumber':      return source === 'zapier' ? 'zapier_meta_ads' : 'meta_ads';
      case 'Keterangan':  return [
          fields.form_name ? `Form: ${fields.form_name}` : '',
          fields.ad_name   ? `Iklan: ${fields.ad_name}`  : '',
        ].filter(Boolean).join(' | ') || '';
      case 'Status_Lead': return 'Baru';
      case 'Score':       return 'Warm';
      case 'Agen_ID':     return agenInfo?.ID    || '';
      case 'Agen_Nama':   return agenInfo?.Nama   || '';
      case 'Team_ID':     return agenInfo?.Team_ID || '';
      case 'Created_At':  return now;
      case 'Updated_At':  return now;
      default:            return '';
    }
  });

  await sheetsService.appendRow(SHEETS.LEADS, row);

  const namaLead = fields.full_name || 'Lead Meta';
  console.log(`[WebhookLead:${source}] ✅ "${namaLead}" → agen: ${agenInfo?.Nama || '(unassigned)'}`);

  // 1. Notifikasi in-app CRM
  await createNotification({
    tipe:           'new_lead_meta',
    judul:          '📲 Lead Baru dari Iklan Meta!',
    pesan:          `${namaLead}${fields.phone ? ' · ' + fields.phone : ''} — masuk dari iklan${agenInfo ? ', diteruskan ke ' + agenInfo.Nama : ''}`,
    from_user_id:   'system',
    from_user_nama: source === 'zapier' ? 'Zapier' : 'Meta Ads',
    to_user_id:     agenInfo?.ID || '',
    to_role:        agenInfo ? '' : 'kantor',
    link_type:      'lead',
    link_id:        id,
  });

  // 2. Notifikasi Telegram ke agen (jika Telegram_ID sudah diset)
  if (agenInfo?.Telegram_ID) {
    try {
      const bot = require('../telegram-bot');
      if (bot) {
        const tgMsg = [
          `📲 *Lead Baru dari Iklan!*`,
          ``,
          `👤 *${namaLead}*`,
          fields.phone     ? `📞 ${fields.phone}`          : null,
          fields.email     ? `📧 ${fields.email}`          : null,
          fields.form_name ? `📋 Form: ${fields.form_name}` : null,
          fields.ad_name   ? `📢 Iklan: ${fields.ad_name}` : null,
          ``,
          `_Sumber: ${source === 'zapier' ? 'Zapier' : 'Meta Ads'} · Segera follow up! 🏠_`,
        ].filter(l => l !== null).join('\n');
        await bot.sendMessage(agenInfo.Telegram_ID, tgMsg, { parse_mode: 'Markdown' });
        console.log(`[TelegramNotif] ✅ Lead dikirim ke Telegram agen ${agenInfo.Nama}`);
      }
    } catch (e) {
      console.warn('[TelegramNotif] Gagal kirim notifikasi lead:', e.message);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function _verifyMetaSignature(req) {
  const appSecret = req._webhookCfg?.meta_app_secret || process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn('[MetaWebhook] meta_app_secret belum diset — skip signature check');
    return true;
  }
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !req.rawBody) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}

async function _fetchLeadFromMeta(leadgenId, pageToken) {
  if (!leadgenId || !pageToken) return null;
  try {
    const res = await axios.get(`https://graph.facebook.com/v19.0/${leadgenId}`, {
      params: { fields: 'field_data,created_time', access_token: pageToken },
      timeout: 8000,
    });
    return res.data;
  } catch (e) {
    console.error('[MetaWebhook] Graph API error:', e.response?.data?.error?.message || e.message);
    return null;
  }
}

function _parseMetaFieldData(fieldData) {
  const r = {};
  for (const f of fieldData) {
    r[f.name] = Array.isArray(f.values) ? f.values[0] : (f.values || '');
  }
  // Normalisasi key names
  return {
    full_name:  r.full_name  || r.name  || '',
    phone:      r.phone_number || r.phone || r.mobile || '',
    email:      r.email || '',
    form_name:  r.form_name || '',
    ad_name:    r.ad_name   || '',
  };
}

async function _findAgenByFormOrAd(formId, adId) {
  if (!formId && !adId) return null;
  try {
    const rows = await sheetsService.getRows(SHEETS.META_ADS_LOG);
    // META_ADS_LOG: Ad_ID(6), Form_ID(7), Created_By(11)
    let row;
    if (formId) row = rows.find(r => r[7] === formId);
    if (!row && adId) row = rows.find(r => r[6] === adId);
    return row ? row[11] : null;
  } catch { return null; }
}

async function _getAgenInfo(agenId) {
  if (!agenId) return null;
  try {
    const rows = await sheetsService.getRows(SHEETS.AGENTS);
    const row  = rows.find(r => r[0] === agenId);
    return row ? {
      ID:          row[0],
      Nama:        row[1],
      Team_ID:     row[14] || '',
      Telegram_ID: row[13] || '',  // col N — diisi agen via /id di Telegram bot
    } : null;
  } catch { return null; }
}

module.exports = router;
