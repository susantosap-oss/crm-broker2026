/**
 * Tasks Routes — /api/v1/tasks
 * ============================================
 * Endpoints untuk manajemen jadwal agen:
 *   Visit, Meeting, Follow-Up, Call, Admin
 *
 * RBAC:
 *   - agen:       baca/buat/edit task SENDIRI saja
 *   - supervisor: baca semua, buat/edit task agen dibawahnya
 *   - admin:      full access
 */

const express    = require('express');
const router     = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const tasksService = require('../services/tasks.service');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

// ── GET /tasks ──────────────────────────────────────────────
// List tasks dengan filter: status, tipe, lead_id, listing_id, date_from, date_to
router.get('/', async (req, res) => {
  try {
    const filters = { ...req.query };

    // Agen hanya lihat task sendiri
    if (req.user.role === 'agen') {
      filters.agen_id = req.user.id;
    }

    const tasks = await tasksService.getAll(filters);
    res.json({ success: true, data: tasks, count: tasks.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /tasks/today ─────────────────────────────────────────
// Jadwal hari ini
router.get('/today', async (req, res) => {
  try {
    const agenId = req.user.role === 'agen' ? req.user.id : (req.query.agen_id || null);
    const tasks  = await tasksService.getToday(agenId);
    res.json({ success: true, data: tasks, count: tasks.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /tasks/upcoming ──────────────────────────────────────
// Jadwal N hari ke depan (default 7 hari)
router.get('/upcoming', async (req, res) => {
  try {
    const agenId = req.user.role === 'agen' ? req.user.id : (req.query.agen_id || null);
    const days   = parseInt(req.query.days) || 7;
    const tasks  = await tasksService.getUpcoming(agenId, days);
    res.json({ success: true, data: tasks, count: tasks.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /tasks/summary ───────────────────────────────────────
// Stats ringkasan: today_total, pending, overdue, this_week
router.get('/summary', async (req, res) => {
  try {
    const agenId  = req.user.role === 'agen' ? req.user.id : (req.query.agen_id || null);
    const summary = await tasksService.getSummary(agenId);
    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /tasks/conversion-stats ───────────────────────────────
router.get('/conversion-stats', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.LEADS);
    const allLeads = rows.slice(1).map((r) =>
      COLUMNS.LEADS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
    );
    const leads = req.user.role === 'agen'
      ? allLeads.filter((l) => l.Agen_ID === req.user.id)
      : allLeads;

    const stats = tasksService.getConversionStats(leads);

    res.json({ success: true, data: {
      funnel: stats.stages,
      overallConversionRate: stats.overall_cr,
      totalLeads: leads.length,
    }});
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /tasks/pipeline ──────────────────────────────────────
// Pipeline stages + conversion stats
router.get('/pipeline', async (req, res) => {
  try {
    // Ambil semua lead (filter by agen jika bukan admin)
    const rows  = await sheetsService.getRange(SHEETS.LEADS);
    const allLeads = rows.slice(1).map((r) =>
      COLUMNS.LEADS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
    );

    const leads = req.user.role === 'agen'
      ? allLeads.filter((l) => l.Agen_ID === req.user.id)
      : allLeads;

    const [stages, funnel] = await Promise.all([
      tasksService.getPipelineStages(),
      Promise.resolve(tasksService.getConversionStats(leads)),
    ]);

    // Hitung jumlah lead per stage
    const stageMap = {};
    leads.forEach((l) => {
      stageMap[l.Status_Lead] = (stageMap[l.Status_Lead] || 0) + 1;
    });

    const stagesWithCount = stages.map((s) => ({
      ...s,
      lead_count: stageMap[s.Nama] || 0,
    }));

    res.json({
      success: true,
      data: {
        stages:     stagesWithCount,
        funnel:     funnel.stages,
        overall_cr: funnel.overall_cr,
        total_leads: leads.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /tasks/:id ───────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const task = await tasksService.getById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task tidak ditemukan' });

    // Agen hanya bisa lihat task sendiri
    if (req.user.role === 'agen' && task.Agen_ID !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    res.json({ success: true, data: task });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /tasks ───────────────────────────────────────────────
// Buat task baru
// Body: { Tipe, Judul, Lead_ID?, Listing_ID?, Scheduled_At, Lokasi?, Catatan_Pre?, Prioritas?, Duration_Menit? }
router.post('/', async (req, res) => {
  try {
    const { Tipe, Scheduled_At } = req.body;

    if (!Scheduled_At) {
      return res.status(400).json({ success: false, message: 'Scheduled_At wajib diisi' });
    }

    const validTypes = ['Visit', 'Meeting', 'Follow_Up', 'Call', 'Admin', 'Other'];
    if (Tipe && !validTypes.includes(Tipe)) {
      return res.status(400).json({
        success: false,
        message: `Tipe tidak valid. Pilihan: ${validTypes.join(', ')}`,
      });
    }

    const task = await tasksService.create(req.body, req.user);
    res.status(201).json({
      success: true,
      data: task,
      message: `Task ${task.Tipe} berhasil dibuat: ${task.Kode_Task}`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /tasks/:id ─────────────────────────────────────────
// Update task (judul, lokasi, catatan_pre, dll)
router.patch('/:id', async (req, res) => {
  try {
    const task = await tasksService.update(req.params.id, req.body, req.user);
    res.json({ success: true, data: task, message: 'Task berhasil diupdate' });
  } catch (e) {
    res.status(e.message.includes('ditolak') ? 403 : 500)
      .json({ success: false, message: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const task = await tasksService.update(req.params.id, req.body, req.user);
    res.json({ success: true, data: task, message: 'Task berhasil diupdate' });
  } catch (e) {
    res.status(e.message.includes('ditolak') ? 403 : 500)
      .json({ success: false, message: e.message });
  }
});

// ── PATCH /tasks/:id/confirm ──────────────────────────────────
// Konfirmasi task: Pending → Confirmed
router.patch('/:id/confirm', async (req, res) => {
  try {
    const task = await tasksService.update(req.params.id, { Status: 'Confirmed' }, req.user);
    res.json({ success: true, data: task, message: `Task dikonfirmasi: ${task.Kode_Task}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /tasks/:id/complete ─────────────────────────────────
// Selesaikan task + catat outcome → otomatis advance lead stage
// Body: { outcome, catatan_post?, attachment_urls? }
// outcome: Lanjut_Negosiasi | Butuh_Followup | Batal | Deal | Reschedule | Proses_Admin
router.patch('/:id/complete', async (req, res) => {
  try {
    const { outcome } = req.body;

    const validOutcomes = [
      'Deal', 'Batal', 'Lanjut_Negosiasi', 'Proses_Admin', 'Butuh_Followup', 'Reschedule',
    ];
    if (!outcome || !validOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: `Outcome wajib diisi. Pilihan: ${validOutcomes.join(', ')}`,
      });
    }

    const task = await tasksService.completeTask(req.params.id, req.body, req.user);

    const stageMsg = task.Pipeline_Stage_After !== task.Pipeline_Stage_Before
      ? ` | Lead stage: ${task.Pipeline_Stage_Before} → ${task.Pipeline_Stage_After}`
      : '';

    res.json({
      success: true,
      data: task,
      message: `Task selesai: ${outcome}${stageMsg}`,
    });
  } catch (e) {
    res.status(e.message.includes('ditolak') ? 403 : 500)
      .json({ success: false, message: e.message });
  }
});

// ── PATCH /tasks/:id/cancel ───────────────────────────────────
// Batalkan task
// Body: { alasan? }
router.patch('/:id/cancel', async (req, res) => {
  try {
    const task = await tasksService.cancelTask(req.params.id, req.body.alasan, req.user);
    res.json({ success: true, data: task, message: 'Task dibatalkan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /tasks/:id/reschedule ───────────────────────────────
// Ganti jadwal task
// Body: { scheduled_at, lokasi?, duration_menit? }
router.patch('/:id/reschedule', async (req, res) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) {
      return res.status(400).json({ success: false, message: 'scheduled_at wajib diisi' });
    }
    const task = await tasksService.rescheduleTask(req.params.id, req.body, req.user);
    res.json({ success: true, data: task, message: `Task dijadwalkan ulang: ${new Date(scheduled_at).toLocaleString('id-ID')}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /tasks/pipeline/seed ────────────────────────────────
// Seed default pipeline stages ke Google Sheets (jalankan sekali)
router.post('/pipeline/seed', requireRole('admin'), async (req, res) => {
  try {
    const result = await tasksService.seedPipelineStages();
    res.json({ success: true, data: result, message: result.skipped ? 'Sudah ada, skip' : `${result.seeded} stages berhasil di-seed` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
