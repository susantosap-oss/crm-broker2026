/**
 * CanvaService — Foto Profil via Brand Template
 * ================================================
 * Auth: OAuth2 Authorization Code flow (bukan client_credentials)
 *   - Superadmin buka /canva/auth sekali → Canva redirect ke /canva/callback
 *   - Server simpan refresh_token di Sheets CONFIG
 *   - Selanjutnya getAccessToken() pakai refresh_token otomatis
 *
 * Flow utama:
 *  1. getAccessToken()   — refresh token → access token
 *  2. uploadAsset()      — upload foto ke Canva
 *  3. createAutofill()   — isi template (foto + nama)
 *  4. pollAutofill()     — tunggu design → designId
 *  5. createExport()     — export PNG
 *  6. pollExport()       — tunggu export → download URL
 *  7. downloadBuffer()   — download PNG ke buffer
 */

const axios  = require('axios');
const crypto = require('crypto');

const BASE      = 'https://api.canva.com/rest/v1';
const AUTH_URL  = 'https://www.canva.com/api/oauth/authorize';
const MAX_POLLS = 30;
const POLL_MS   = 2000;

// Scopes sesuai Canva Developer Portal
const SCOPES = [
  'asset:read', 'asset:write',
  'brandtemplate:meta:read', 'brandtemplate:content:read', 'brandtemplate:content:write',
  'design:content:read', 'design:content:write',
].join(' ');

// ── Token cache ─────────────────────────────────────────────
let _cachedToken  = null;
let _tokenExpiry  = 0;
let _refreshToken = process.env.CANVA_REFRESH_TOKEN || null;

// ── PKCE store (state → code_verifier) — in-memory, short-lived ─
const _pkceStore = {};

// ── Helpers ─────────────────────────────────────────────────
function _credentials() {
  const id  = process.env.CANVA_CLIENT_ID;
  const sec = process.env.CANVA_CLIENT_SECRET;
  if (!id || !sec) throw new Error('CANVA_CLIENT_ID / CANVA_CLIENT_SECRET belum dikonfigurasi');
  return Buffer.from(`${id}:${sec}`).toString('base64');
}

function _redirectUri() {
  const base = process.env.APP_URL || 'https://crm.mansionpro.id';
  return `${base}/api/v1/agents/profile-photo/canva/callback`;
}

// ── PKCE helpers ────────────────────────────────────────────
function _generateVerifier() {
  return crypto.randomBytes(32).toString('base64url'); // 43 chars, URL-safe
}

function _generateChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── OAuth Step 1: URL untuk redirect user ke Canva (dengan PKCE) ──
function getAuthUrl(state = 'crm') {
  const verifier   = _generateVerifier();
  const challenge  = _generateChallenge(verifier);
  _pkceStore[state] = verifier; // simpan verifier, dipakai saat exchangeCode

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             process.env.CANVA_CLIENT_ID,
    redirect_uri:          _redirectUri(),
    scope:                 SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ── OAuth Step 2: Tukar authorization code → tokens (dengan PKCE verifier) ──
async function exchangeCode(code, state = 'crm') {
  const verifier = _pkceStore[state] || '';
  delete _pkceStore[state]; // hapus setelah dipakai

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  _redirectUri(),
    code_verifier: verifier,
  });

  let res;
  try {
    res = await axios.post(`${BASE}/oauth/token`, body.toString(), {
      headers: {
        Authorization:  `Basic ${_credentials()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Canva exchangeCode gagal: ${detail}`);
  }

  _cachedToken  = res.data.access_token;
  _tokenExpiry  = Date.now() + res.data.expires_in * 1000;
  _refreshToken = res.data.refresh_token;
  return res.data;
}

// ── Get access token (pakai refresh_token) ──────────────────
async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 30_000) return _cachedToken;

  if (!_refreshToken) {
    throw new Error(
      'Canva belum diotorisasi. Superadmin harus buka: ' +
      '/api/v1/agents/profile-photo/canva/auth'
    );
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: _refreshToken,
  });

  try {
    const res = await axios.post(`${BASE}/oauth/token`, body.toString(), {
      headers: {
        Authorization:  `Basic ${_credentials()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    _cachedToken  = res.data.access_token;
    _tokenExpiry  = Date.now() + res.data.expires_in * 1000;
    if (res.data.refresh_token) _refreshToken = res.data.refresh_token; // rotating token
    return _cachedToken;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Canva refresh token gagal: ${detail}`);
  }
}

// ── Expose untuk route ──────────────────────────────────────
function setRefreshToken(token) { _refreshToken = token; }
function hasRefreshToken()      { return !!_refreshToken; }

// ── Upload foto ke Canva sebagai Asset ──────────────────────────────────────
// POST /rest/v1/asset-uploads: binary body + Asset-Upload-Metadata JSON header
// Poll via GET /rest/v1/asset-uploads/{jobId} → asset.id
async function uploadAsset(imageBuffer, mimeType, agentId) {
  const token    = await getAccessToken();
  const shortId  = agentId.slice(0, 8);                           // max ~20 chars total
  const filename = `p_${shortId}.jpg`;
  const nameB64  = Buffer.from(filename).toString('base64');

  let res;
  try {
    res = await axios.post(`${BASE}/asset-uploads`, imageBuffer, {
      headers: {
        Authorization:           `Bearer ${token}`,
        'Content-Type':          'application/octet-stream',
        'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameB64 }),
      },
      maxBodyLength:    Infinity,
      maxContentLength: Infinity,
    });
    console.log(`[Canva] asset-uploads response: ${JSON.stringify(res.data)}`);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.log(`[Canva] asset-uploads FAILED HTTP ${err.response?.status}: ${detail}`);
    throw new Error(`Canva asset-uploads gagal: ${detail}`);
  }

  const jobId = res.data?.job?.id;
  if (!jobId) throw new Error('Canva asset-uploads tidak mengembalikan job.id: ' + JSON.stringify(res.data));
  console.log(`[Canva] Upload job created: ${jobId}, polling...`);

  // Poll sampai selesai → dapat asset.id
  for (let i = 0; i < MAX_POLLS; i++) {
    const pollRes = await axios.get(`${BASE}/asset-uploads/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const job = pollRes.data?.job;
    if (!job) throw new Error('Canva: response asset-uploads poll tidak valid');

    if (job.status === 'success') {
      const assetId = job.asset?.id;
      if (!assetId) throw new Error('Canva asset upload sukses tapi tidak ada asset.id: ' + JSON.stringify(job));
      console.log(`[Canva] Asset ready: ${assetId}`);
      return assetId;
    }
    if (job.status === 'failed') {
      throw new Error('Canva asset upload gagal: ' + JSON.stringify(job.error || {}));
    }

    await _sleep(POLL_MS);
  }

  throw new Error(`Canva asset upload timeout setelah ${MAX_POLLS * POLL_MS / 1000} detik`);
}

// ── Autofill: isi template dengan foto + nama ───────────────
async function createAutofill(assetId, agentName) {
  const token      = await getAccessToken();
  const templateId = process.env.CANVA_PROFILE_TEMPLATE_ID;
  const photoField = process.env.CANVA_PHOTO_FIELD_NAME || 'foto_profile';
  const nameField  = process.env.CANVA_NAME_FIELD_NAME  || 'nama_agen';

  if (!templateId) throw new Error('CANVA_PROFILE_TEMPLATE_ID belum dikonfigurasi di .env');

  let res;
  try {
    res = await axios.post(
      `${BASE}/autofills`,
      {
        brand_template_id: templateId,
        title: `CRM_Profile_${Date.now()}`,
        data: {
          [photoField]: {
            type:     'image',
            asset_id: assetId,
          },
          [nameField]: {
            type: 'text',
            text: agentName || '',
          },
        },
      },
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[Canva] createAutofill HTTP ${err.response?.status}: ${detail}`);
    throw new Error(`Canva createAutofill ${err.response?.status}: ${detail}`);
  }

  const jobId = res.data?.job?.id;
  if (!jobId) throw new Error('Canva autofill tidak mengembalikan job.id: ' + JSON.stringify(res.data));
  return jobId;
}

// ── Poll autofill sampai selesai → dapat designId ──────────
async function pollAutofill(jobId) {
  const token = await getAccessToken();

  for (let i = 0; i < MAX_POLLS; i++) {
    const res = await axios.get(`${BASE}/autofills/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const job = res.data?.job;
    if (!job) throw new Error('Canva: response autofill poll tidak valid');

    if (job.status === 'success') {
      const designId = job.result?.design?.id;
      if (!designId) throw new Error('Canva autofill sukses tapi tidak ada design.id');
      return designId;
    }
    if (job.status === 'failed') {
      throw new Error('Canva autofill gagal: ' + JSON.stringify(job.error || {}));
    }

    await _sleep(POLL_MS);
  }

  throw new Error(`Canva autofill timeout setelah ${MAX_POLLS * POLL_MS / 1000} detik`);
}

// ── Export design ke PNG ────────────────────────────────────
async function createExport(designId) {
  const token = await getAccessToken();

  const res = await axios.post(
    `${BASE}/exports`,
    {
      design_id: designId,
      format:    { type: 'png', quality: 'regular' },
    },
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const jobId = res.data?.job?.id;
  if (!jobId) throw new Error('Canva export tidak mengembalikan job.id: ' + JSON.stringify(res.data));
  return jobId;
}

// ── Poll export sampai selesai → dapat download URL ────────
async function pollExport(jobId) {
  const token = await getAccessToken();

  for (let i = 0; i < MAX_POLLS; i++) {
    const res = await axios.get(`${BASE}/exports/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const job = res.data?.job;
    if (!job) throw new Error('Canva: response export poll tidak valid');

    if (job.status === 'success') {
      // Canva bisa kembalikan urls sebagai array langsung di job, atau di result
      const url = job.urls?.[0] || job.result?.urls?.[0] || job.result?.url;
      if (!url) throw new Error('Canva export sukses tapi tidak ada download URL');
      return url;
    }
    if (job.status === 'failed') {
      throw new Error('Canva export gagal: ' + JSON.stringify(job.error || {}));
    }

    await _sleep(POLL_MS);
  }

  throw new Error(`Canva export timeout setelah ${MAX_POLLS * POLL_MS / 1000} detik`);
}

// ── Download hasil PNG ke Buffer ────────────────────────────
async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType:       'arraybuffer',
    maxContentLength:   Infinity,
    maxBodyLength:      Infinity,
  });
  return Buffer.from(res.data);
}

// ── Fungsi utama (dipanggil dari route) ────────────────────
/**
 * Proses foto mentah lewat Canva template, kembalikan PNG Buffer.
 * @param {Buffer} imageBuffer  — buffer foto asli dari multer
 * @param {string} mimeType     — MIME type (image/jpeg, image/png, dll)
 * @param {string} agentId      — untuk naming asset
 * @param {string} agentName    — nama agen untuk field nama_agen di template
 * @returns {Buffer}            — PNG hasil Canva
 */
async function processProfilePhoto(imageBuffer, mimeType, agentId, agentName = '') {
  const log = (msg) => console.log(`[Canva] ${msg}`);

  log('Uploading asset...');
  const assetId = await uploadAsset(imageBuffer, mimeType, agentId);

  log(`Asset uploaded: ${assetId} — creating autofill...`);
  const autofillJobId = await createAutofill(assetId, agentName);

  log(`Autofill job: ${autofillJobId} — polling...`);
  const designId = await pollAutofill(autofillJobId);

  log(`Design ready: ${designId} — exporting PNG...`);
  const exportJobId = await createExport(designId);

  log(`Export job: ${exportJobId} — polling...`);
  const downloadUrl = await pollExport(exportJobId);

  log(`Export done, downloading PNG...`);
  const pngBuffer = await downloadBuffer(downloadUrl);

  log(`Done. PNG size: ${(pngBuffer.length / 1024).toFixed(0)}KB`);
  return pngBuffer;
}

// ── Raw HTTPS upload (bypass axios agar Content-Type tidak dimodifikasi) ──────
// Coba PUT + octet-stream → jika 4xx, coba PATCH + TUS offset+octet-stream
async function _rawHttpUpload(uploadUrl, buffer) {
  const https  = require('https');
  const urlObj = new URL(uploadUrl);

  const _doRequest = (method, contentType, extraHeaders = {}) =>
    new Promise((resolve, reject) => {
      const headers = {
        'Content-Type':   contentType,
        'Content-Length': String(buffer.length),
        ...extraHeaders,
      };
      const req = https.request(
        { hostname: urlObj.hostname, port: 443, path: urlObj.pathname + urlObj.search, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            console.log(`[Canva] ${method} upload → HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.statusCode);
            else { const e = new Error(`HTTP ${res.statusCode}: ${body.slice(0,300)}`); e.status = res.statusCode; reject(e); }
          });
        }
      );
      req.on('error', reject);
      req.write(buffer);
      req.end();
    });

  // Attempt 1: PUT + application/octet-stream
  try {
    return await _doRequest('PUT', 'application/octet-stream');
  } catch (e1) {
    console.log(`[Canva] PUT/octet-stream failed (${e1.status}), trying PATCH/TUS...`);
  }

  // Attempt 2: PATCH + TUS application/offset+octet-stream
  return _doRequest('PATCH', 'application/offset+octet-stream', {
    'Tus-Resumable': '1.0.0',
    'Upload-Offset': '0',
  });
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { processProfilePhoto, getAuthUrl, exchangeCode, getAccessToken, setRefreshToken, hasRefreshToken, rawUpload: _rawHttpUpload };
