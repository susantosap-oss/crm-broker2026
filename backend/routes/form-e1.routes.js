const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware } = require('../middleware/auth.middleware');
const eliteSvc = require('../services/elite.service');
const { rowsToObjects } = eliteSvc;

// Rate limit khusus form: 5 submission per IP per jam
const rateLimit = require('express-rate-limit');
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Terlalu banyak submission, coba lagi dalam 1 jam.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const MANAGE_ROLES = ['superadmin', 'principal', 'kantor', 'admin'];

// Cocokkan submission Form E-1 ke akun AGENTS (via No_WA) dan pastikan draft
// ELITE_PROGRAM ada. Idempotent — no-op kalau draft/aktif sudah ada.
async function ensureEliteProgramDraft(item, actorLabel) {
  const matchedAgent = await eliteSvc.findAgentByPhone(item.No_WA);
  if (!matchedAgent) {
    console.warn('[FormE1] Agen dengan No_WA', item.No_WA, 'tidak ditemukan di AGENTS — draft ELITE_PROGRAM tidak dibuat otomatis');
    return { created: false, agent: null };
  }

  const existing = await eliteSvc.getProgramByAgent(matchedAgent.ID);
  if (existing) return { created: false, agent: matchedAgent, existing: true };

  await eliteSvc.saveChecklist({
    agentId: matchedAgent.ID,
    agenNama: item.Nama_Lengkap,
    namaKantor: matchedAgent.Nama_Kantor,
    formE1Verified: 'TRUE',
    formE1Catatan: item.Catatan_Admin || '',
  }, actorLabel);
  return { created: true, agent: matchedAgent };
}

// GET /api/v1/form-e1 — list semua submission (admin/principal/kantor/superadmin)
router.get('/', authMiddleware, async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const rows = await sheetsService.getRange(SHEETS.FORM_E1);
    const list = rowsToObjects(rows);

    // Self-heal: submission yg sudah Disetujui tapi belum punya draft ELITE_PROGRAM
    // (mis. di-approve sebelum auto-create ini ada / sempat gagal). Idempotent.
    const approved = list.filter(f => f.Status === 'Disetujui');
    for (const item of approved) {
      try {
        const { created } = await ensureEliteProgramDraft(item, 'system-heal');
        if (created) {
          const adminMsg =
            `🔄 *Backfill ELITE Program*\n\n` +
            `Form E-1 ${item.Nama_Lengkap} (${item.Kode_Agent}) sudah Disetujui namun draft ELITE_PROGRAM belum ada — sudah dibuat otomatis.\n\n` +
            `Silakan lanjutkan checklist di ELITE Partner Mgmt.`;
          const principalWAs = await eliteSvc.getPrincipalsWA();
          for (const wa of principalWAs) await eliteSvc.sendWA(wa, adminMsg);
        }
      } catch (healErr) {
        console.warn('[FormE1] Self-heal gagal untuk', item.ID, healErr.message);
      }
    }

    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/v1/form-e1/:id — update Status + Catatan_Admin
router.put('/:id', authMiddleware, async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const { status, catatan } = req.body;
    const VALID_STATUS = ['Pending', 'Diproses', 'Disetujui', 'Ditolak'];
    if (status && !VALID_STATUS.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid' });
    }

    const rows = await sheetsService.getRange(SHEETS.FORM_E1);
    const list = rowsToObjects(rows);
    const item = list.find(r => r.ID === req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Submission tidak ditemukan' });

    const headers = rows[0];
    const idxStatus  = headers.indexOf('Status');
    const idxCatatan = headers.indexOf('Catatan_Admin');

    const rowArr = [...(rows[item._rowIdx - 1] || [])];
    while (rowArr.length <= Math.max(idxStatus, idxCatatan)) rowArr.push('');
    if (status  !== undefined && idxStatus  >= 0) rowArr[idxStatus]  = status;
    if (catatan !== undefined && idxCatatan >= 0) rowArr[idxCatatan] = catatan;

    await sheetsService.updateRow(SHEETS.FORM_E1, item._rowIdx, rowArr);

    // Saat Disetujui → auto-buat/update draft di ELITE_PROGRAM agar agen
    // langsung muncul di ELITE Partner Mgmt (tab Partners) sebagai Draft
    let programCreated = false;
    let programNote = '';
    if (status === 'Disetujui') {
      try {
        item.Catatan_Admin = catatan !== undefined ? catatan : item.Catatan_Admin;
        const result = await ensureEliteProgramDraft(item, req.user.nama || req.user.id);
        programCreated = result.created;
        if (result.created) programNote = '\nDraft ELITE_PROGRAM dibuat — lanjutkan checklist di ELITE Partner Mgmt.';
        else if (result.existing) programNote = '';
        else programNote = '\n⚠️ No_WA tidak cocok dengan data AGENTS — draft ELITE_PROGRAM belum dibuat, grant manual diperlukan.';
      } catch (programErr) {
        console.warn('[FormE1] Auto-create ELITE_PROGRAM draft gagal:', programErr.message);
      }
    }

    // Notif WA ke agen + admin jika status berubah ke Disetujui/Ditolak
    if (status === 'Disetujui' || status === 'Ditolak') {
      try {
        const noWa = item.No_WA;
        const emoji = status === 'Disetujui' ? '✅' : '❌';
        if (noWa) {
          const msg =
            `${emoji} *Update Form E-1 Anda*\n\n` +
            `Nama: ${item.Nama_Lengkap}\n` +
            `Status: *${status}*\n` +
            (catatan ? `Catatan: ${catatan}\n` : '') +
            `\nSilakan hubungi admin untuk informasi lebih lanjut.`;
          await eliteSvc.sendWA(noWa, msg);
        }

        const adminMsg =
          `${emoji} *Form E-1 ${status}*\n\n` +
          `Nama: ${item.Nama_Lengkap}\n` +
          `Kode: ${item.Kode_Agent}\n` +
          (catatan ? `Catatan: ${catatan}\n` : '') +
          (status === 'Disetujui' ? programNote : '') +
          `\nDiproses oleh: ${req.user.nama || req.user.id}`;
        const principalWAs = await eliteSvc.getPrincipalsWA();
        for (const wa of principalWAs) await eliteSvc.sendWA(wa, adminMsg);
      } catch (notifErr) {
        console.warn('[FormE1] WA notif update gagal:', notifErr.message);
      }
    }

    res.json({ success: true, message: 'Status diperbarui', programCreated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/v1/form-e1 — public, no auth
router.post('/', formLimiter, async (req, res) => {
  try {
    const b = req.body;

    // Validasi wajib
    const required = ['nama_lengkap', 'no_wa', 'tanggal_bergabung', 'tanggal_pengajuan'];
    for (const f of required) {
      if (!b[f]?.toString().trim()) {
        return res.status(400).json({ success: false, message: `Field wajib tidak lengkap: ${f}` });
      }
    }

    // Validasi semua pernyataan harus dicentang
    const pernyataan = ['pernyataan_target', 'pernyataan_eqt', 'pernyataan_admin', 'pernyataan_sanksi', 'pernyataan_nda'];
    for (const p of pernyataan) {
      if (b[p] !== 'true' && b[p] !== true) {
        return res.status(400).json({ success: false, message: 'Semua pernyataan komitmen wajib disetujui.' });
      }
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const row = COLUMNS.FORM_E1.map(col => {
      switch (col) {
        case 'ID':                  return id;
        case 'Tanggal_Submit':      return now;
        case 'Nama_Lengkap':        return b.nama_lengkap?.trim() || '';
        case 'Kode_Agent':          return b.kode_agent?.trim().toUpperCase() || '';
        case 'No_WA':               return b.no_wa?.trim() || '';
        case 'Email':               return b.email?.trim() || '';
        case 'Team_Leader_BM':      return b.team_leader_bm?.trim() || '';
        case 'Project_Manager_PM':  return b.project_manager_pm?.trim() || '';
        case 'Tanggal_Bergabung':   return b.tanggal_bergabung || '';
        case 'Kriteria_1_MBT':      return b.kriteria_1 || 'Tidak';
        case 'Kriteria_2_Closing':  return b.kriteria_2 || 'Tidak';
        case 'Kriteria_3_SP':       return b.kriteria_3 || 'Tidak';
        case 'Kriteria_4_Biaya':    return b.kriteria_4 || 'Tidak';
        case 'Pernyataan_Target':   return 'TRUE';
        case 'Pernyataan_EQT':      return 'TRUE';
        case 'Pernyataan_Admin':    return 'TRUE';
        case 'Pernyataan_Sanksi':   return 'TRUE';
        case 'Pernyataan_NDA':      return 'TRUE';
        case 'Tanggal_Pengajuan':   return b.tanggal_pengajuan || '';
        case 'Status':              return 'Pending';
        case 'Catatan_Admin':       return '';
        default:                    return '';
      }
    });

    await sheetsService.appendRow(SHEETS.FORM_E1, row);

    // Notif WA ke principals (best-effort)
    try {
      const eliteSvc = require('../services/elite.service');
      const principals = await eliteSvc.getPrincipalsWA();
      const msg =
        `📋 *Form E-1 Baru Masuk*\n\n` +
        `Nama: ${b.nama_lengkap?.trim()}\n` +
        `Kode: ${b.kode_agent?.trim().toUpperCase()}\n` +
        `No WA: ${b.no_wa?.trim()}\n` +
        `Tanggal Pengajuan: ${b.tanggal_pengajuan}\n\n` +
        `Silakan review di CRM → ELITE Partner → Manajemen Program.`;

      for (const wa of principals) {
        await eliteSvc.sendWA(wa, msg);
      }
    } catch (notifErr) {
      console.warn('[FormE1] WA notif gagal:', notifErr.message);
    }

    res.json({ success: true, message: 'Permohonan berhasil dikirim. Tim kami akan menghubungi Anda.' });
  } catch (e) {
    console.error('[FormE1] Error:', e.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan permohonan. Coba lagi.' });
  }
});

module.exports = router;
