/**
 * Agents Routes — /api/v1/agents
 * ============================================
 * Roles: superadmin | principal | business_manager | admin | agen | koordinator
 * - superadmin: full access
 * - principal: lihat semua agen, buat user
 * - business_manager: lihat agen tim sendiri
 * - admin: buat/edit user (kecuali principal ke atas)
 * - agen: hanya lihat/edit diri sendiri
 */

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole, requireMinRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const canvaService = require('../services/canva.service');
const sharpService = require('../services/sharp.service');

// Multer memory storage untuk Canva profile photo (max 10 MB)
const _photoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Hanya file gambar yang diizinkan'));
    cb(null, true);
  },
});

const VALID_ROLES = ['superadmin', 'principal', 'kantor', 'business_manager', 'admin', 'agen', 'koordinator'];

function rowToAgent(row, headers) {
  const cols = headers || COLUMNS.AGENTS;
  return cols.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
}

// ─── PUBLIC route (no auth) — HARUS sebelum router.use(authMiddleware) ────────
// GET /agents/by-telegram/:id — untuk Telegram Bot auth tanpa JWT
router.get('/by-telegram/:telegram_id', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!rows || rows.length < 2) return res.json({ success: false, data: null });
    const [headers, ...data] = rows;
    const telegramIdx = headers.indexOf('Telegram_ID');
    if (telegramIdx === -1) return res.json({ success: false, message: 'Kolom Telegram_ID belum ada di sheet AGENTS' });
    const found = data.find(r => String(r[telegramIdx] || '').trim() === String(req.params.telegram_id).trim());
    if (!found) return res.json({ success: true, data: null });
    const agent = rowToAgent(found);
    delete agent.Password_Hash;
    res.json({ success: true, data: agent });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Canva OAuth routes (PUBLIC — browser redirect, tidak bisa pakai JWT) ────
// Proteksi: pakai CANVA_AUTH_SECRET sebagai query param agar tidak sembarang orang bisa trigger

// GET /agents/profile-photo/canva/auth?secret=xxx — mulai OAuth flow
router.get('/profile-photo/canva/auth', (req, res) => {
  const secret = process.env.CANVA_AUTH_SECRET || 'mansion-canva-2026';
  if (req.query.secret !== secret) {
    return res.status(403).send('<h2>Forbidden — tambahkan ?secret=xxx di URL</h2>');
  }
  const authUrl = canvaService.getAuthUrl('crm-superadmin');
  res.redirect(authUrl);
});

// GET /agents/profile-photo/canva/callback — Canva redirect kesini setelah user izinkan
router.get('/profile-photo/canva/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.send(`<html><body style="font-family:sans-serif;padding:40px;background:#0D1526;color:#fff">
      <h2 style="color:#f87171">❌ Canva OAuth Error</h2>
      <p>${error}: ${error_description}</p>
    </body></html>`);
  }
  if (!code) {
    return res.status(400).send('<h2>Error: tidak ada authorization code dari Canva</h2>');
  }

  try {
    const tokens = await canvaService.exchangeCode(code, req.query.state || 'crm');

    // Simpan refresh_token ke Sheets CONFIG agar persistent lintas restart
    if (tokens.refresh_token) {
      try {
        const rows = await sheetsService.getRange(SHEETS.CONFIG);
        const idx  = (rows || []).findIndex(r => r[0] === 'Canva_Refresh_Token');
        if (idx >= 0) {
          const row = [...rows[idx]]; row[1] = tokens.refresh_token;
          await sheetsService.updateRow(SHEETS.CONFIG, idx + 1, row);
        } else {
          await sheetsService.appendRow(SHEETS.CONFIG, ['Canva_Refresh_Token', tokens.refresh_token, 'OAuth refresh token Canva API']);
        }
        console.log('[Canva] Refresh token tersimpan ke Sheets CONFIG');
      } catch (sheetErr) {
        console.log('[Canva] Gagal simpan ke Sheets:', sheetErr.message);
      }
    }

    res.send(`<html><body style="font-family:sans-serif;padding:40px;background:#0D1526;color:#fff;text-align:center">
      <h2 style="color:#D4A853">✅ Canva Berhasil Diotorisasi!</h2>
      <p style="color:rgba(255,255,255,0.7)">Refresh token tersimpan. Tutup tab ini dan kembali ke CRM.</p>
      <p style="color:rgba(255,255,255,0.3);font-size:12px">Token type: ${tokens.token_type} | Expires in: ${tokens.expires_in}s</p>
      <script>setTimeout(()=>window.close(),3000)</script>
    </body></html>`);
  } catch (e) {
    res.status(500).send(`<html><body style="padding:40px;background:#0D1526;color:#fff">
      <h2 style="color:#f87171">Error saat tukar token</h2><p>${e.message}</p>
    </body></html>`);
  }
});

// ─── Semua route di bawah ini butuh JWT ──────────────────────────────────────
router.use(authMiddleware);

// POST /agents/force-logout-all — superadmin only
router.post('/force-logout-all', requireRole('superadmin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.CONFIG);
    const now  = Date.now().toString();
    const idx  = (rows||[]).findIndex(r => r[0] === 'Force_Logout_All_At');
    if (idx >= 0) {
      const row = [...rows[idx]]; row[1] = now;
      await sheetsService.updateRow(SHEETS.CONFIG, idx + 1, row);
    } else {
      await sheetsService.appendRow(SHEETS.CONFIG, ['Force_Logout_All_At', now, 'Force logout semua token']);
    }
    res.json({ success: true, message: 'Semua device telah di-logout. Agen harus login ulang.' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /agents
router.get('/', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...data] = rows;
    let agents = data
      .map(row => rowToAgent(row))
      .filter(a => a.ID)
      .map(a => { delete a.Password_Hash; return a; });

    const { role, id, team_id } = req.user;

    // BM hanya lihat tim sendiri
    if (role === 'business_manager' && team_id) {
      agents = agents.filter(a => a.Team_ID === team_id || a.ID === id);
    }

    // Filter by role jika ada query
    if (req.query.role) agents = agents.filter(a => a.Role === req.query.role);
    if (req.query.team_id) agents = agents.filter(a => a.Team_ID === req.query.team_id);

    res.json({ success: true, data: agents });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /agents/me — HARUS sebelum /:id
router.get('/me', async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.AGENTS, req.user.id);
    if (!result) return res.json({ success: true, data: {} });
    const agent = rowToAgent(result.data);
    delete agent.Password_Hash;
    res.json({ success: true, data: agent });
  } catch (e) { res.json({ success: true, data: {} }); }
});

// GET /agents/by-role/:role
router.get('/by-role/:role', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...data] = rows;
    const agents = data
      .map(row => rowToAgent(row))
      .filter(a => a.ID && a.Role === req.params.role && a.Status === 'Aktif')
      .map(a => { delete a.Password_Hash; return a; });
    res.json({ success: true, data: agents });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /agents — buat user baru
router.post('/', requireMinRole('admin'), async (req, res) => {
  try {
    const { Nama, Email, Password, No_WA, Role, Status, Telegram_ID, Team_ID, Nomer_LSP } = req.body;
    if (!Nama || !Email || !Password)
      return res.status(400).json({ success: false, message: 'Nama, Email, Password wajib' });

    // Validasi role
    const targetRole = Role || 'agen';
    if (!VALID_ROLES.includes(targetRole))
      return res.status(400).json({ success: false, message: `Role tidak valid. Pilihan: ${VALID_ROLES.join(', ')}` });

    // Hanya superadmin yang bisa buat principal/kantor ke atas
    if (['principal', 'kantor', 'superadmin'].includes(targetRole) && req.user.role !== 'superadmin')
      return res.status(403).json({ success: false, message: 'Hanya superadmin yang bisa membuat role ini' });

    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...data] = rows;
    const emailExists = data.find(r => r[2]?.toLowerCase() === Email.toLowerCase());
    if (emailExists) return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });

    const hash = await bcrypt.hash(Password, 10);
    const now  = new Date().toISOString();
    const id   = uuidv4();

    const row = COLUMNS.AGENTS.map(col => {
      if (col === 'ID')            return id;
      if (col === 'Nama')          return Nama;
      if (col === 'Email')         return Email;
      if (col === 'Password_Hash') return hash;
      if (col === 'No_WA')         return No_WA || '';
      if (col === 'Role')          return targetRole;
      if (col === 'Status')        return Status || 'Aktif';
      if (col === 'Telegram_ID')   return Telegram_ID || '';
      if (col === 'Team_ID')       return Team_ID || '';
      if (col === 'Nomer_LSP')     return Nomer_LSP || '';
      if (col === 'Join_Date')     return now.substring(0,10);
      if (col === 'Created_At')    return now;
      if (col === 'Updated_At')    return now;
      return '';
    });

    await sheetsService.appendRow(SHEETS.AGENTS, row);
    res.status(201).json({ success: true, data: { id }, message: `User ${Nama} berhasil ditambahkan` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /agents/offices — group by Nama_Kantor, return struktur kantor + anggota
router.get('/offices', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });
    const [, ...data] = rows;
    const agents = data
      .map(row => rowToAgent(row))
      .filter(a => a.ID)
      .map(a => { delete a.Password_Hash; return a; });
    const map = {};
    agents.forEach(a => {
      if (a.Status === 'Nonaktif') return;
      if (a.Role === 'kantor') return; // Role kantor tidak ditampilkan di Member (seperti admin)
      const kantor = a.Nama_Kantor || 'MANSION : Kantor Pusat';
      if (!map[kantor]) map[kantor] = { nama_kantor: kantor, members: [] };
      map[kantor].members.push({
        id:          a.ID,
        nama:        a.Nama,
        role:        a.Role,
        no_wa:       a.No_WA,
        foto_url:    a.Foto_URL,
        status:      a.Status,
        listing_count: a.Listing_Count || 0,
        deal_count:    a.Deal_Count    || 0,
        join_date:     a.Join_Date     || '',
      });
    });

    // Rename Kantor Pusat → Administrator
    const PUSAT_KEY = 'MANSION : Kantor Pusat';
    if (map[PUSAT_KEY]) {
      map[PUSAT_KEY].nama_kantor = 'Administrator';
      map['Administrator'] = map[PUSAT_KEY];
      delete map[PUSAT_KEY];
    }

    let offices = Object.values(map).sort((a, b) => a.nama_kantor.localeCompare(b.nama_kantor));

    // Sembunyikan grup Administrator untuk role agen/koordinator/business_manager
    const { role } = req.user;
    if (['agen', 'koordinator', 'business_manager'].includes(role)) {
      offices = offices.filter(o => o.nama_kantor !== 'Administrator');
    }

    res.json({ success: true, data: offices });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PUT /agents/change-password
router.put('/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ success: false, message: 'Password lama dan baru wajib diisi' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'Password baru min. 6 karakter' });

    const result = await sheetsService.findRowById(SHEETS.AGENTS, req.user.id);
    if (!result) return res.status(404).json({ success: false, message: 'Agen tidak ditemukan' });

    const agent = rowToAgent(result.data);
    const bcrypt = require('bcryptjs');
    let valid = false;
    if (agent.Password_Hash && agent.Password_Hash.startsWith('$2')) {
      valid = await bcrypt.compare(oldPassword, agent.Password_Hash);
    } else {
      valid = (oldPassword === agent.Password_Hash);
    }
    if (!valid) return res.status(401).json({ success: false, message: 'Password lama salah' });

    const newHash = await bcrypt.hash(newPassword, 10);
    const merged  = { ...agent, Password_Hash: newHash, Updated_At: new Date().toISOString() };
    const row     = COLUMNS.AGENTS.map(c => merged[c] || '');
    await sheetsService.updateRow(SHEETS.AGENTS, result.rowIndex, row);

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PUT /agents/profile — update profil sendiri
router.put('/profile', async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.AGENTS, req.user.id);
    if (!result) return res.json({ success: true, message: 'Saved locally' });
    const existing = rowToAgent(result.data);
    const { nama, wa, wa_business, status, photoUrl } = req.body;
    if (nama)        existing.Nama           = nama;
    if (wa)          existing.No_WA          = wa;
    if (wa_business !== undefined) existing.No_WA_Business = wa_business;
    if (status)      existing.Status         = status;
    if (photoUrl)    existing.Foto_URL       = photoUrl;
    existing.Updated_At = new Date().toISOString();
    const row = COLUMNS.AGENTS.map(col => existing[col] || '');
    await sheetsService.updateRow(SHEETS.AGENTS, result.rowIndex, row);
    res.json({ success: true, message: 'Profil diupdate' });
  } catch (e) { res.json({ success: true, message: 'Saved locally' }); }
});

// GET /agents/profile-photo/canva/test — superadmin: cek status koneksi Canva
router.get('/profile-photo/canva/test', requireRole('superadmin'), async (req, res) => {
  const result = {
    env: {
      clientId:   process.env.CANVA_CLIENT_ID ? process.env.CANVA_CLIENT_ID.slice(0,10)+'...' : 'MISSING',
      templateId: process.env.CANVA_PROFILE_TEMPLATE_ID || 'MISSING',
      hasRefreshToken: canvaService.hasRefreshToken(),
    },
    token: null, asset: null, error: null,
  };

  // Coba load refresh_token dari Sheets jika belum ada di memory
  if (!canvaService.hasRefreshToken()) {
    try {
      const rows = await sheetsService.getRange(SHEETS.CONFIG);
      const row  = (rows || []).find(r => r[0] === 'Canva_Refresh_Token');
      if (row?.[1]) {
        canvaService.setRefreshToken(row[1]);
        result.env.hasRefreshToken = true;
        result.env.tokenSource = 'sheets';
      }
    } catch (_) {}
  }

  try {
    const axios = require('axios');
    const token = await canvaService.getAccessToken();
    result.token = { ok: true };

    // Test upload asset kecil via POST /asset-uploads binary langsung
    const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AVf/Z', 'base64');
    const nameB64 = Buffer.from('test_crm.jpg').toString('base64');
    try {
      const uploadRes = await axios.post('https://api.canva.com/rest/v1/asset-uploads', tinyJpeg, {
        headers: {
          Authorization:           `Bearer ${token}`,
          'Content-Type':          'application/octet-stream',
          'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameB64 }),
        },
        maxBodyLength: Infinity,
      });
      const jobId = uploadRes.data?.job?.id;
      result.asset = { ok: false, step: 'job_created', jobId, rawResponse: uploadRes.data };

      if (jobId) {
        // Poll 3x untuk test
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const poll = await axios.get(`https://api.canva.com/rest/v1/asset-uploads/${jobId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const job = poll.data?.job;
          if (job?.status === 'success') {
            result.asset = { ok: true, assetId: job.asset?.id, step: 'success' };
            break;
          }
          if (job?.status === 'failed') {
            result.asset = { ok: false, step: 'upload_failed', error: job.error };
            break;
          }
          result.asset.step = `polling_${i+1}`;
          result.asset.jobStatus = job?.status;
        }
      }
    } catch (ae) {
      result.asset = { ok: false, status: ae.response?.status, body: ae.response?.data, rawErr: ae.message };
    }

    res.json({ success: result.asset?.ok, result });
  } catch (e) {
    result.error = e.message;
    res.json({ success: false, result });
  }
});

// GET /agents/profile-photo/canva/brand-templates — list templates + dataset fields (superadmin debug)
router.get('/profile-photo/canva/brand-templates', requireRole('superadmin'), async (req, res) => {
  try {
    const token = await canvaService.getAccessToken();
    const r = await axios.get('https://api.canva.com/rest/v1/brand-templates?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const items = r.data?.items || [];

    // Fetch dataset untuk setiap template
    const withDataset = await Promise.all(items.map(async (item) => {
      try {
        const ds = await axios.get(`https://api.canva.com/rest/v1/brand-templates/${item.id}/dataset`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return { ...item, dataset: ds.data };
      } catch {
        return { ...item, dataset: null };
      }
    }));

    res.json({ success: true, items: withDataset });
  } catch (e) {
    res.json({ success: false, error: e.response?.data || e.message });
  }
});

// POST /agents/profile-photo/canva — proses foto profil via Canva Brand Template
// 1. Terima foto (multipart) → 2. Kirim ke Canva → 3. Export PNG → 4. Upload Cloudinary
// Frontend bertanggung jawab menyimpan URL ke sheets via PUT /profile
router.post('/profile-photo/canva', _photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Tidak ada foto yang diupload' });

    const agentId   = req.user.id;
    const agentName = req.user.nama || req.user.name || '';
    const { buffer, mimetype } = req.file;

    // Ambil kantor dari Sheets
    let agentKantor = '';
    try {
      const agentRow = await sheetsService.findRowById(SHEETS.AGENTS, agentId);
      if (agentRow) agentKantor = rowToAgent(agentRow.data).Nama_Kantor || '';
    } catch (_) {}

    // ── Step 1: Proses via Sharp ──────────────────────────
    let pngBuffer;
    try {
      pngBuffer = await sharpService.processProfilePhoto(buffer, agentName, agentKantor);
    } catch (sharpErr) {
      console.error('[Sharp] Error:', sharpErr.message);
      return res.status(502).json({
        success: false,
        message: 'Sharp gagal memproses foto: ' + sharpErr.message,
      });
    }

    // ── Step 2: Upload hasil PNG ke Cloudinary ────────────
    const base64DataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    const cloudResult   = await cloudinary.uploader.upload(base64DataUri, {
      folder:        'mansion_profiles',
      public_id:     `agent_${agentId}`,
      overwrite:     true,
      invalidate:    true,
      resource_type: 'image',
      format:        'png',
    });

    const photoUrl = cloudResult.secure_url;

    // ── Step 3: Simpan langsung ke Sheets ────────────────
    try {
      const agentRow = await sheetsService.findRowById(SHEETS.AGENTS, agentId);
      if (agentRow) {
        const existing = rowToAgent(agentRow.data);
        existing.Foto_URL   = photoUrl;
        existing.Updated_At = new Date().toISOString();
        const row = COLUMNS.AGENTS.map(col => existing[col] || '');
        await sheetsService.updateRow(SHEETS.AGENTS, agentRow.rowIndex, row);
      }
    } catch (sheetErr) {
      // Sheets error tidak fatal — URL sudah ada, frontend akan sync via PUT /profile
      console.warn('[Canva] Sheets update gagal (non-fatal):', sheetErr.message);
    }

    res.json({
      success: true,
      message: 'Foto profil berhasil diproses via Canva',
      data:    { photo_url: photoUrl },
    });

  } catch (e) {
    console.error('[Canva Route] Unexpected error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── In-memory migration progress tracker ─────────────────
const _migrateState = {
  running:    false,
  total:      0,
  done:       0,
  skipped:    0,
  failed:     0,
  errors:     [],   // [{ id, nama, error }]
  log:        [],   // [{ id, nama, status, url }]
  startedAt:  null,
  finishedAt: null,
};

// POST /agents/profile-photo/canva/migrate-all — superadmin only
// Download existing Foto_URL → Canva pipeline → Cloudinary → Sheets
router.post('/profile-photo/canva/migrate-all', requireRole('superadmin'), async (req, res) => {
  if (_migrateState.running) {
    return res.status(409).json({
      success: false,
      message: 'Migrasi sedang berjalan',
      progress: _migrateState,
    });
  }

  // Ambil semua agen dengan foto
  let agents;
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...data] = rows;
    const force = req.query.force === 'true';
    agents = data
      .map(row => rowToAgent(row))
      .filter(a => a.ID && a.Foto_URL && (force || !a.Foto_URL.includes('mansion_profiles')));
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Gagal baca Sheets: ' + e.message });
  }

  if (!agents.length) {
    return res.json({ success: true, message: 'Semua foto sudah diproses via Canva, tidak ada yang perlu migrasi.' });
  }

  // Reset state & mulai background job
  Object.assign(_migrateState, {
    running: true, total: agents.length,
    done: 0, skipped: 0, failed: 0,
    errors: [], log: [],
    startedAt: new Date().toISOString(), finishedAt: null,
  });

  res.json({
    success: true,
    message: `Migrasi dimulai untuk ${agents.length} agen. Cek status via GET /agents/profile-photo/canva/migrate-status`,
    total:   agents.length,
  });

  // ── Background processing (sequential) ──────────────────
  (async () => {
    for (const agent of agents) {
      const logEntry = { id: agent.ID, nama: agent.Nama, status: 'processing', url: '' };
      _migrateState.log.push(logEntry);
      try {
        // 1. Download foto existing dari Cloudinary URL — force JPEG via Cloudinary transform
        const jpegUrl   = agent.Foto_URL.replace('/upload/', '/upload/f_jpg,q_90/');
        const imgRes    = await axios.get(jpegUrl, {
          responseType: 'arraybuffer',
          timeout:      30_000,
        });
        const imgBuffer = Buffer.from(imgRes.data);
        const mimeType  = 'image/jpeg'; // selalu JPEG setelah transform

        // 2. Proses via Sharp
        const pngBuffer = await sharpService.processProfilePhoto(imgBuffer, agent.Nama, agent.Nama_Kantor);

        // 3. Upload ke Cloudinary → mansion_profiles/
        const b64   = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        const cloud = await cloudinary.uploader.upload(b64, {
          folder:        'mansion_profiles',
          public_id:     `agent_${agent.ID}`,
          overwrite:     true,
          invalidate:    true,
          resource_type: 'image',
          format:        'png',
        });

        // 4. Update Sheets
        const agentRow = await sheetsService.findRowById(SHEETS.AGENTS, agent.ID);
        if (agentRow) {
          const existing = rowToAgent(agentRow.data);
          existing.Foto_URL   = cloud.secure_url;
          existing.Updated_At = new Date().toISOString();
          const row = COLUMNS.AGENTS.map(col => existing[col] || '');
          await sheetsService.updateRow(SHEETS.AGENTS, agentRow.rowIndex, row);
        }

        logEntry.status = 'done';
        logEntry.url    = cloud.secure_url;
        _migrateState.done++;
        console.log(`[Canva Migrate] ✓ ${agent.Nama} (${agent.ID})`);
      } catch (err) {
        logEntry.status = 'failed';
        logEntry.error  = err.message;
        _migrateState.failed++;
        _migrateState.errors.push({ id: agent.ID, nama: agent.Nama, error: err.message });
        console.error(`[Canva Migrate] ✗ ${agent.Nama}: ${err.message}`);
      }

      // Jeda 2 detik antar agen — hindari rate limit Canva
      await new Promise(r => setTimeout(r, 2000));
    }

    _migrateState.running    = false;
    _migrateState.finishedAt = new Date().toISOString();
    console.log(`[Canva Migrate] Selesai. Done: ${_migrateState.done}, Failed: ${_migrateState.failed}`);
  })();
});

// GET /agents/profile-photo/canva/migrate-status — cek progress migrasi
router.get('/profile-photo/canva/migrate-status', requireRole('superadmin'), (req, res) => {
  const pct = _migrateState.total
    ? Math.round((_migrateState.done + _migrateState.failed) / _migrateState.total * 100)
    : 0;
  res.json({
    success:    true,
    running:    _migrateState.running,
    percent:    pct,
    total:      _migrateState.total,
    done:       _migrateState.done,
    failed:     _migrateState.failed,
    errors:     _migrateState.errors,
    log:        _migrateState.log,
    startedAt:  _migrateState.startedAt,
    finishedAt: _migrateState.finishedAt,
  });
});

// PUT /agents/:id — update user
router.put('/:id', requireMinRole('admin'), async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.AGENTS, req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    const existing = rowToAgent(result.data);
    const { newPassword, ...updates } = req.body;
    // Normalize Nama_Kantor format
    if (updates.Nama_Kantor) {
      const raw = updates.Nama_Kantor.replace(/^MANSION\s*:\s*/i, '').trim();
      updates.Nama_Kantor = raw ? `MANSION : ${raw}` : '';
    }
    // Normalize Parent_Kantor format
    if (updates.Parent_Kantor) {
      const raw = updates.Parent_Kantor.replace(/^MANSION\s*:\s*/i, '').trim();
      updates.Parent_Kantor = raw ? `MANSION : ${raw}` : '';
    }
    const merged = { ...existing, ...updates, Updated_At: new Date().toISOString() };
    if (newPassword && newPassword.length >= 6)
      merged.Password_Hash = await bcrypt.hash(newPassword, 10);
    const row = COLUMNS.AGENTS.map(col => merged[col] || '');
    await sheetsService.updateRow(SHEETS.AGENTS, result.rowIndex, row);
    res.json({ success: true, message: 'User berhasil diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// DELETE /agents/:id
router.delete('/:id', requireMinRole('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ success: false, message: 'Tidak bisa hapus akun sendiri' });
    const result = await sheetsService.findRowById(SHEETS.AGENTS, req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    await sheetsService.deleteRow(SHEETS.AGENTS, result.rowIndex);
    res.json({ success: true, message: 'User dihapus' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
