/**
 * Canva Routes — /api/v1/canva
 * ─────────────────────────────────────────────────────────────────
 * GET  /oauth/authorize        — generate Canva OAuth URL (superadmin)
 * GET  /oauth/callback         — handle OAuth callback, simpan refresh token
 * POST /generate-profile-card  — generate profile card agen
 * GET  /config                 — baca konfigurasi Canva
 * POST /config                 — simpan refresh token (principal+)
 * GET  /template-fields        — lihat field dalam brand template
 * POST /test                   — debug step-by-step (superadmin)
 */

const express  = require('express');
const crypto   = require('crypto');
const router   = express.Router();
const { authMiddleware, requireMinRole } = require('../middleware/auth.middleware');
const canva    = require('../services/canva.service');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// ── OAuth state store (in-memory, short-lived) ────────────────────
const _oauthState = new Map(); // state → { verifier, createdAt }

// ── OAuth: GET /oauth/authorize (butuh auth) ──────────────────────
router.get('/oauth/authorize', authMiddleware, requireMinRole('superadmin'), (req, res) => {
  const clientId    = process.env.CANVA_CLIENT_ID;
  const baseUrl     = process.env.BASE_URL || `https://${req.headers.host}`;
  const redirectUri = `${baseUrl}/api/v1/canva/oauth/callback`;

  if (!clientId) return res.status(500).json({ success: false, message: 'CANVA_CLIENT_ID tidak di-set' });

  // PKCE
  const verifier   = crypto.randomBytes(32).toString('base64url');
  const challenge  = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state      = crypto.randomBytes(16).toString('hex');
  _oauthState.set(state, { verifier, createdAt: Date.now() });

  // Bersihkan state lama (>10 menit)
  for (const [k, v] of _oauthState) {
    if (Date.now() - v.createdAt > 600_000) _oauthState.delete(k);
  }

  const url = new URL('https://www.canva.com/api/oauth/authorize');
  url.searchParams.set('client_id',             clientId);
  url.searchParams.set('response_type',         'code');
  url.searchParams.set('redirect_uri',          redirectUri);
  url.searchParams.set('scope',                 'asset:read asset:write design:content:read design:content:write brandtemplate:content:read');
  url.searchParams.set('code_challenge',        challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state',                 state);

  res.json({ success: true, data: { url: url.toString(), redirectUri } });
});

// ── OAuth: GET /oauth/callback (public, no auth — redirect dari Canva) ──
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Canva OAuth error: ${error}`);
  if (!code || !state) return res.status(400).send('Parameter code/state tidak lengkap');

  const stored = _oauthState.get(state);
  if (!stored) return res.status(400).send('OAuth state tidak valid atau sudah expired');
  _oauthState.delete(state);

  const clientId     = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const baseUrl      = process.env.BASE_URL || `https://${req.headers.host}`;
  const redirectUri  = `${baseUrl}/api/v1/canva/oauth/callback`;

  try {
    const axios  = require('axios');
    const creds  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      code_verifier: stored.verifier,
    });
    const tokenRes = await axios.post('https://api.canva.com/rest/v1/oauth/token', params.toString(), {
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const expiry = Date.now() + (expires_in || 3600) * 1000;
    await Promise.all([
      canva.writeConfigKey('canva_refresh_token', refresh_token),
      canva.writeConfigKey('canva_access_token',  access_token),
      canva.writeConfigKey('canva_token_expiry',  expiry.toString()),
    ]);
    res.send('<h2>✅ Canva OAuth berhasil! Refresh token disimpan.</h2><p>Tutup halaman ini dan kembali ke CRM.</p>');
  } catch (e) {
    const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    res.status(500).send(`<h2>❌ OAuth gagal</h2><pre>${msg}</pre>`);
  }
});

router.use(authMiddleware);

// ── Helper: ambil data agen dari sheet ────────────────────────────
function rowToAgent(row) {
  return COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
}

// ── POST /generate-profile-card ───────────────────────────────────
router.post('/generate-profile-card', async (req, res) => {
  try {
    const { agentId } = req.body;
    const canEdit     = ['admin', 'principal', 'kantor', 'superadmin'].includes(req.user.role);
    const targetId    = agentId && canEdit ? agentId : req.user.id;

    const result = await sheetsService.findRowById(SHEETS.AGENTS, targetId);
    if (!result) return res.status(404).json({ success: false, message: 'Agen tidak ditemukan' });

    const agent = rowToAgent(result.data);
    if (!agent.Foto_URL)
      return res.status(422).json({ success: false, message: 'Agen belum punya foto profil. Upload foto terlebih dahulu.' });

    const templateId = process.env.CANVA_PROFILE_TEMPLATE_ID;
    if (!templateId)
      return res.status(422).json({ success: false, message: 'CANVA_PROFILE_TEMPLATE_ID belum di-set di environment' });

    const fieldNames = {}; // service akan baca dari ENV VARS

    // Step 1 — upload foto ke Canva sebagai asset
    const assetId  = await canva.uploadAsset(agent.Foto_URL, agent.Nama);

    // Step 2 — autofill template
    const designId = await canva.createAutofill(templateId, {
      nama:   agent.Nama,
      role:   agent.Role,
      wa:     agent.No_WA,
      kantor: agent.Nama_Kantor,
    }, assetId, fieldNames);

    // Step 3 — export sebagai PNG
    const exportUrl = await canva.exportDesign(designId, 'png');

    res.json({
      success: true,
      data: {
        exportUrl,
        agentId: targetId,
        agentNama: agent.Nama,
      },
    });
  } catch (e) {
    console.error('[Canva] generate-profile-card error:', e.message);
    const status = e.response?.status || 500;
    res.status(status >= 500 ? 500 : status).json({ success: false, message: e.message });
  }
});

// ── GET /config ───────────────────────────────────────────────────
router.get('/config', requireMinRole('admin'), async (req, res) => {
  try {
    const cfg = await canva.readConfig();
    res.json({
      success: true,
      data: {
        clientId:        process.env.CANVA_CLIENT_ID || '',
        templateId:      process.env.CANVA_PROFILE_TEMPLATE_ID || '',
        hasClientSecret: !!process.env.CANVA_CLIENT_SECRET,
        hasRefreshToken: !!cfg.canva_refresh_token,
        hasAccessToken:  !!cfg.canva_access_token,
        tokenSource:     'sheets',
        fieldNames: {
          photo:  process.env.CANVA_PHOTO_FIELD_NAME || 'foto_profile',
          name:   process.env.CANVA_NAME_FIELD_NAME  || 'nama_agen',
        },
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /config — hanya untuk simpan refreshToken ke Sheets ─────
router.post('/config', requireMinRole('principal'), async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ success: false, message: 'refreshToken wajib diisi' });
    await Promise.all([
      canva.writeConfigKey('canva_refresh_token', refreshToken),
      canva.writeConfigKey('canva_access_token',  ''),
      canva.writeConfigKey('canva_token_expiry',  ''),
    ]);
    res.json({ success: true, message: 'Canva refresh token disimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /template-fields ──────────────────────────────────────────
router.get('/template-fields', requireMinRole('admin'), async (req, res) => {
  try {
    const cfg = await canva.readConfig();
    if (!cfg.canva_template_id)
      return res.status(422).json({ success: false, message: 'Template ID belum dikonfigurasi' });
    const fields = await canva.getTemplateFields(cfg.canva_template_id);
    res.json({ success: true, data: fields });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(500).json({ success: false, message: msg });
  }
});

// ── POST /test ────────────────────────────────────────────────────
router.post('/test', requireMinRole('superadmin'), async (req, res) => {
  const result = { env: null, token: null, asset: null, error: null };
  try {
    const cfg = await canva.readConfig();
    result.env = {
      clientId:        (process.env.CANVA_CLIENT_ID || '').substring(0, 12) + '...',
      templateId:      process.env.CANVA_PROFILE_TEMPLATE_ID || '',
      hasRefreshToken: !!cfg.canva_refresh_token,
      tokenSource:     'sheets',
    };

    // Test token refresh
    try {
      await canva.getAccessToken();
      result.token = { ok: true };
    } catch (e) {
      result.token = { ok: false, error: e.message };
      return res.json({ success: false, result });
    }

    // Test asset upload jika foto_url dikirim
    const testUrl = req.body.foto_url;
    if (testUrl) {
      try {
        const assetId = await canva.uploadAsset(testUrl, 'test_agent');
        result.asset = { ok: true, assetId };
      } catch (e) {
        const status  = e.response?.status;
        const rawBody = e.response?.data;
        result.asset  = { ok: false, status, body: rawBody, rawErr: e.message };
        return res.json({ success: false, result });
      }
    }

    res.json({ success: true, result });
  } catch (e) {
    result.error = e.message;
    res.json({ success: false, result });
  }
});

module.exports = router;
