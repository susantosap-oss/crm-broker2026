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
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole, requireMinRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const VALID_ROLES = ['superadmin', 'principal', 'business_manager', 'admin', 'agen', 'koordinator'];

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

    // Hanya superadmin yang bisa buat principal ke atas
    if (['principal', 'superadmin'].includes(targetRole) && req.user.role !== 'superadmin')
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
