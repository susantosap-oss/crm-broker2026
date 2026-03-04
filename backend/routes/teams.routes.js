/**
 * Teams Routes — /api/v1/teams
 * ============================================
 * Manajemen tim oleh Principal.
 * - Principal bisa buat tim, assign BM dan anggota
 * - BM bisa lihat tim sendiri
 * - Agen bisa lihat tim sendiri
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

function rowToTeam(row) {
  return COLUMNS.TEAMS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
}

// GET /teams — list semua tim
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.TEAMS);
    if (rows.length < 2) return res.json({ success: true, data: [] });
    const [, ...data] = rows;
    let teams = data.map(rowToTeam).filter(t => t.Team_ID);

    // Filter by role
    const { role, id, team_id } = req.user;
    if (role === 'principal') {
      teams = teams.filter(t => t.Principal_ID === id);
    } else if (role === 'business_manager') {
      teams = teams.filter(t => t.BM_ID === id);
    } else if (role === 'agen' || role === 'admin') {
      teams = teams.filter(t => {
        try {
          const members = JSON.parse(t.Member_IDs || '[]');
          return members.includes(id) || t.BM_ID === id;
        } catch { return false; }
      });
    }

    // Parse member arrays
    teams = teams.map(t => ({
      ...t,
      member_ids:   tryParse(t.Member_IDs, []),
      member_names: tryParse(t.Member_Names, []),
    }));

    res.json({ success: true, data: teams });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /teams/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.TEAMS, req.params.id, 0);
    if (!result) return res.status(404).json({ success: false, message: 'Tim tidak ditemukan' });
    const team = rowToTeam(result.data);
    team.member_ids   = tryParse(team.Member_IDs, []);
    team.member_names = tryParse(team.Member_Names, []);
    res.json({ success: true, data: team });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /teams — buat tim baru (principal only)
router.post('/', requireRole('principal', 'superadmin'), async (req, res) => {
  try {
    const { Nama_Team, BM_ID, member_ids = [] } = req.body;
    if (!Nama_Team) return res.status(400).json({ success: false, message: 'Nama tim wajib diisi' });

    const team_id = uuidv4();
    const now = new Date().toISOString();

    // Get agent data for BM and members
    const allAgents = await getAllAgents();
    const bm = allAgents.find(a => a.ID === BM_ID);
    const members = allAgents.filter(a => member_ids.includes(a.ID));

    const row = COLUMNS.TEAMS.map(col => {
      if (col === 'Team_ID')       return team_id;
      if (col === 'Nama_Team')     return Nama_Team;
      if (col === 'Principal_ID')  return req.user.id;
      if (col === 'Principal_Nama') return req.user.nama;
      if (col === 'BM_ID')         return BM_ID || '';
      if (col === 'BM_Nama')       return bm?.Nama || '';
      if (col === 'Member_IDs')    return JSON.stringify(member_ids);
      if (col === 'Member_Names')  return JSON.stringify(members.map(m => m.Nama));
      if (col === 'Status')        return 'Aktif';
      if (col === 'Created_At')    return now;
      if (col === 'Updated_At')    return now;
      return '';
    });

    await sheetsService.appendRow(SHEETS.TEAMS, row);

    // Update Team_ID di AGENTS untuk BM dan members
    await updateAgentsTeamId([BM_ID, ...member_ids].filter(Boolean), team_id, allAgents);

    res.status(201).json({ success: true, data: { team_id, Nama_Team }, message: `Tim ${Nama_Team} berhasil dibuat` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PUT /teams/:id — update tim
router.put('/:id', requireRole('principal', 'superadmin'), async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.TEAMS, req.params.id, 0);
    if (!result) return res.status(404).json({ success: false, message: 'Tim tidak ditemukan' });

    const existing = rowToTeam(result.data);
    if (existing.Principal_ID !== req.user.id && req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Bukan tim Anda' });
    }

    const { Nama_Team, BM_ID, member_ids, Status } = req.body;
    const allAgents = await getAllAgents();
    const bm = allAgents.find(a => a.ID === (BM_ID || existing.BM_ID));
    const newMemberIds = member_ids || tryParse(existing.Member_IDs, []);
    const members = allAgents.filter(a => newMemberIds.includes(a.ID));

    const merged = {
      ...existing,
      Nama_Team:     Nama_Team     || existing.Nama_Team,
      BM_ID:         BM_ID         || existing.BM_ID,
      BM_Nama:       bm?.Nama      || existing.BM_Nama,
      Member_IDs:    JSON.stringify(newMemberIds),
      Member_Names:  JSON.stringify(members.map(m => m.Nama)),
      Status:        Status        || existing.Status,
      Updated_At:    new Date().toISOString(),
    };

    const row = COLUMNS.TEAMS.map(col => merged[col] || '');
    await sheetsService.updateRow(SHEETS.TEAMS, result.rowIndex, row);

    // Update Team_ID di agents
    const allMemberIds = [merged.BM_ID, ...newMemberIds].filter(Boolean);
    await updateAgentsTeamId(allMemberIds, req.params.id, allAgents);

    res.json({ success: true, message: 'Tim berhasil diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// DELETE /teams/:id
router.delete('/:id', requireRole('principal', 'superadmin'), async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.TEAMS, req.params.id, 0);
    if (!result) return res.status(404).json({ success: false, message: 'Tim tidak ditemukan' });
    await sheetsService.deleteRow(SHEETS.TEAMS, result.rowIndex);
    res.json({ success: true, message: 'Tim dihapus' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /teams/members/available — agen yang belum punya tim
router.get('/members/available', requireRole('principal', 'superadmin'), async (req, res) => {
  try {
    const agents = await getAllAgents();
    const available = agents.filter(a =>
      ['agen', 'business_manager', 'admin'].includes(a.Role) &&
      a.Status === 'Aktif'
    );
    res.json({ success: true, data: available });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Helpers ───────────────────────────────────────────────
async function getAllAgents() {
  const rows = await sheetsService.getRange(SHEETS.AGENTS);
  if (rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(row => COLUMNS.AGENTS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {}))
             .filter(a => a.ID);
}

async function updateAgentsTeamId(agentIds, teamId, allAgents) {
  for (const agentId of agentIds) {
    try {
      const result = await sheetsService.findRowById(SHEETS.AGENTS, agentId);
      if (!result) continue;
      const agent = COLUMNS.AGENTS.reduce((o, c, i) => { o[c] = result.data[i] || ''; return o; }, {});
      agent.Team_ID   = teamId;
      agent.Updated_At = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.AGENTS, result.rowIndex, COLUMNS.AGENTS.map(c => agent[c] || ''));
    } catch (_) {}
  }
}

function tryParse(str, fallback) {
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
}

module.exports = router;
