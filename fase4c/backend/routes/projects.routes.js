/**
 * Projects Routes — /api/v1/projects
 * ============================================
 * Fitur PRIMARY: Manajemen proyek properti baru dari developer.
 *
 * Akses: superadmin | principal | admin | koordinator
 * Agen: READ ONLY (untuk lihat daftar proyek)
 *
 * Endpoints:
 *   GET    /projects              → List semua proyek
 *   GET    /projects/:id          → Detail proyek
 *   POST   /projects              → Buat proyek baru
 *   PUT    /projects/:id          → Update proyek
 *   DELETE /projects/:id          → Hapus proyek
 *   PATCH  /projects/:id/publish  → Toggle status Publish/Draft
 *   PATCH  /projects/:id/approve  → Approve Pending → Aktif (Principal kantor sama)
 *   PATCH  /projects/:id/koordinator → Ganti koordinator (SA/Admin/Principal)
 *   GET    /projects/:id/shortlink → Get/create shortlink agen ini
 *   GET    /projects/:id/referrals → Stats klik per agen (principal+)
 *   GET    /projects/:id/bundle    → Sosmed caption bundle
 *   POST   /projects/:id/caption   → Regenerate caption
 *   GET    /p/:kode               → Public redirect shortlink (track klik)
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const projectsService = require('../services/projects.service');
const sheetsService   = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// Roles yang bisa input/edit proyek
const MANAGE_ROLES        = ['superadmin', 'principal', 'admin', 'koordinator'];
const MANAGE_ROLES_NO_KOR = ['superadmin', 'principal', 'admin'];

// ── Auth untuk semua internal routes ─────────────────────
router.use(authMiddleware);

// ── GET / — List proyek ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filters = {};
    const { search, status, tipe } = req.query;
    if (search) filters.search = search;
    if (status) filters.status = status;
    if (tipe)   filters.tipe   = tipe;

    // Agen hanya lihat yang Publish
    if (req.user.role === 'agen') {
      filters.status = 'Publish';
    }

    // Koordinator: lihat semua proyek (tidak difilter by koordinator_id)

    const projects = await projectsService.getAll(filters);
    res.json({ success: true, data: projects, count: projects.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id — Detail proyek ─────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
    // Agen hanya lihat yang Publish
    if (req.user.role === 'agen' && project.Status !== 'Publish') {
      return res.status(403).json({ success: false, message: 'Proyek belum dipublikasikan' });
    }
    res.json({ success: true, data: project });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST / — Buat proyek baru ─────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin/principal/koordinator yang bisa menambah proyek.' });
    }

    const { Nama_Proyek, Nama_Developer, Tipe_Properti } = req.body;
    if (!Nama_Proyek)    return res.status(400).json({ success: false, message: 'Nama Proyek wajib diisi' });
    if (!Nama_Developer) return res.status(400).json({ success: false, message: 'Nama Developer wajib diisi' });
    if (!Tipe_Properti)  return res.status(400).json({ success: false, message: 'Tipe Properti wajib diisi' });

    const project = await projectsService.create(req.body, req.user);
    const msg = req.user.role === 'koordinator'
      ? `Proyek "${project.Nama_Proyek}" berhasil diajukan. Menunggu approval Principal. ⏳`
      : `Proyek "${project.Nama_Proyek}" berhasil dibuat`;
    res.status(201).json({ success: true, data: project, message: msg });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PUT /:id — Update proyek ─────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    // Koordinator hanya bisa edit proyeknya sendiri
    if (req.user.role === 'koordinator') {
      const project = await projectsService.getById(req.params.id);
      if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
      if (project.Koordinator_ID !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Anda hanya bisa mengedit proyek milik Anda sendiri' });
      }
    }
    const project = await projectsService.update(req.params.id, req.body);
    res.json({ success: true, data: project, message: 'Proyek berhasil diupdate' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE /:id — Hapus proyek ────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!MANAGE_ROLES_NO_KOR.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    await projectsService.delete(req.params.id);
    res.json({ success: true, message: 'Proyek berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /:id/publish — Toggle Publish/Draft ─────────────
router.patch('/:id/publish', async (req, res) => {
  try {
    if (!MANAGE_ROLES_NO_KOR.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const { status } = req.body; // 'Publish' | 'Draft'
    const project = await projectsService.setStatus(req.params.id, status);
    res.json({
      success: true,
      data: project,
      message: `Proyek berhasil ${status === 'Publish' ? 'dipublikasikan ✅' : 'disembunyikan'}`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /:id/approve — Approve Pending → Aktif ──────────
// Hanya Principal yang bisa approve.
// Logika kantor:
//   - Principal bisa approve proyek koordinator dari kantor yang SAMA
//   - ATAU jika Nama_Kantor koordinator punya Parent_Kantor = Nama_Kantor Principal
//     (misal: Citraland bisa approve proyek dari koordinator Malang)
router.patch('/:id/approve', async (req, res) => {
  try {
    if (!['superadmin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Hanya Principal atau Superadmin yang bisa approve proyek' });
    }

    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
    if (project.Status_Project !== 'Pending') {
      return res.status(400).json({ success: false, message: `Proyek sudah berstatus "${project.Status_Project}", tidak perlu diapprove` });
    }

    // Superadmin bisa approve semua
    if (req.user.role !== 'superadmin') {
      // Load data approver & koordinator dari sheet AGENTS
      const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
      const agentData = agentRows && agentRows.length > 1 ? agentRows.slice(1) : [];

      const toAgent = (row) => COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
      const approverRow = agentData.find(r => toAgent(r).ID === req.user.id);
      const approver    = approverRow ? toAgent(approverRow) : null;
      const approverKantor = approver?.Nama_Kantor || '';

      if (project.Koordinator_ID) {
        const korRow = agentData.find(r => toAgent(r).ID === project.Koordinator_ID);
        const kor    = korRow ? toAgent(korRow) : null;
        const korKantor       = kor?.Nama_Kantor   || '';
        const korParentKantor = kor?.Parent_Kantor || '';

        const sameOffice   = approverKantor && korKantor && approverKantor === korKantor;
        const parentMatch  = approverKantor && korParentKantor && approverKantor === korParentKantor;

        if (!sameOffice && !parentMatch) {
          return res.status(403).json({
            success: false,
            message: `Anda hanya bisa approve proyek dari koordinator kantor Anda (${approverKantor || 'tidak diketahui'})`,
          });
        }
      }
    }

    const updated = await projectsService.update(req.params.id, { Status_Project: 'Aktif' });
    res.json({ success: true, data: updated, message: `Proyek "${updated.Nama_Proyek}" berhasil diapprove ✅` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/koordinator-candidates — List agen kantor principal ──
// Dipakai untuk dropdown pilih koordinator di modal
router.get('/:id/koordinator-candidates', async (req, res) => {
  try {
    if (!MANAGE_ROLES_NO_KOR.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!agentRows || agentRows.length < 2) return res.json({ success: true, data: [] });

    const toAgent = (row) => COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
    let agents = agentRows.slice(1).map(toAgent).filter(a => a.ID && a.Status === 'Aktif');

    // Principal: filter agen/koordinator kantor sendiri + kantor yang punya Parent = kantor principal
    if (req.user.role === 'principal') {
      const meRow = agents.find(a => a.ID === req.user.id);
      const myKantor = meRow?.Nama_Kantor || '';
      agents = agents.filter(a =>
        ['agen', 'koordinator'].includes(a.Role) &&
        (a.Nama_Kantor === myKantor || a.Parent_Kantor === myKantor)
      );
    } else {
      // SA/Admin: semua agen & koordinator aktif
      agents = agents.filter(a => ['agen', 'koordinator'].includes(a.Role));
    }

    const data = agents.map(a => ({
      id:         a.ID,
      nama:       a.Nama,
      role:       a.Role,
      nama_kantor: a.Nama_Kantor || '',
      no_wa:      a.No_WA || '',
    }));

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /:id/koordinator — Set / hapus koordinator slot 1 atau 2 ──
// Body: { slot: 1|2, koordinator_id: "uuid" | "" }
// Kirim koordinator_id kosong ("") untuk menghapus slot tersebut
router.patch('/:id/koordinator', async (req, res) => {
  try {
    if (!MANAGE_ROLES_NO_KOR.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const slot = parseInt(req.body.slot) || 1;
    if (![1, 2].includes(slot)) {
      return res.status(400).json({ success: false, message: 'slot harus 1 atau 2' });
    }

    const koordinator_id = req.body.koordinator_id || '';
    let korNama = '';

    if (koordinator_id) {
      // Validasi user yang dipilih
      const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
      const toAgent   = (row) => COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
      const agentData = agentRows && agentRows.length > 1 ? agentRows.slice(1) : [];
      const korRow    = agentData.find(r => toAgent(r).ID === koordinator_id);
      if (!korRow) return res.status(404).json({ success: false, message: 'Koordinator tidak ditemukan' });
      const kor = toAgent(korRow);
      if (!['koordinator', 'agen'].includes(kor.Role)) {
        return res.status(400).json({ success: false, message: 'User yang dipilih bukan koordinator atau agen' });
      }
      // Cegah orang yang sama di kedua slot
      const existing = await projectsService.getById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
      const otherSlotId = slot === 1 ? existing.Koordinator2_ID : existing.Koordinator_ID;
      if (otherSlotId && otherSlotId === koordinator_id) {
        return res.status(400).json({ success: false, message: `${kor.Nama} sudah menjadi koordinator di slot lain` });
      }
      korNama = kor.Nama;
    }

    const updateData = slot === 1
      ? { Koordinator_ID: koordinator_id, Koordinator_Nama: korNama }
      : { Koordinator2_ID: koordinator_id, Koordinator2_Nama: korNama };

    const updated = await projectsService.update(req.params.id, updateData);

    const msg = koordinator_id
      ? `Koordinator ${slot === 1 ? '1' : '2'} berhasil diubah ke ${korNama}`
      : `Koordinator ${slot === 1 ? '1' : '2'} berhasil dihapus`;

    res.json({ success: true, data: updated, message: msg });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/shortlink — Get/create shortlink untuk agen ini
router.get('/:id/shortlink', async (req, res) => {
  try {
    const ref = await projectsService.getOrCreateShortlink(req.params.id, req.user);
    res.json({ success: true, data: ref });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/referrals — Leaderboard klik per agen ────────
router.get('/:id/referrals', async (req, res) => {
  try {
    if (!['superadmin', 'principal', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const stats = await projectsService.getReferralStats(req.params.id);
    res.json({ success: true, data: stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/bundle — Sosmed caption bundle ───────────────
router.get('/:id/bundle', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
    const bundle = projectsService.getSosmedBundle(project);
    res.json({ success: true, data: bundle });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /:id/caption — Regenerate caption ────────────────
router.post('/:id/caption', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });

    // Save new caption ke sheet
    const newCaption = projectsService.generateCaption(project, 'instagram');
    await projectsService.update(req.params.id, { Caption_Sosmed: newCaption });

    const bundle = projectsService.getSosmedBundle({ ...project, Caption_Sosmed: newCaption });
    res.json({ success: true, data: bundle, message: 'Caption berhasil di-generate ulang' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
