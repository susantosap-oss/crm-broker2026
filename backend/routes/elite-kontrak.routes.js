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

// Target kuartalan sesuai Pasal 3 Surat Perjanjian ELITE Program
const TARGET_KUARTAL_DEFAULT = 3000000000;

// GET /api/v1/elite-kontrak — list semua submission (manage roles only)
router.get('/', authMiddleware, async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
  try {
    const rows = await sheetsService.getRange(SHEETS.ELITE_KONTRAK);
    const list = rowsToObjects(rows);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/v1/elite-kontrak — public, no auth
router.post('/', formLimiter, async (req, res) => {
  try {
    const b = req.body;

    const required = ['nama_lengkap', 'nomor_ktp', 'alamat_domisili', 'asal_kantor', 'no_wa'];
    for (const f of required) {
      if (!b[f]?.toString().trim()) {
        return res.status(400).json({ success: false, message: `Field wajib tidak lengkap: ${f}` });
      }
    }
    if (b.setuju !== true && b.setuju !== 'true') {
      return res.status(400).json({ success: false, message: 'Anda harus menyetujui Surat Perjanjian untuk melanjutkan.' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const noWa = b.no_wa.trim();

    // Sync ke ELITE_PROGRAM dulu (sebelum simpan submission) supaya kita tahu hasilnya
    let programSynced = false;
    let matchedAgent = null;
    try {
      matchedAgent = await eliteSvc.findAgentByPhone(noWa);
      if (matchedAgent) {
        const program = await eliteSvc.getProgramByAgent(matchedAgent.ID);
        if (program) {
          const today = now.slice(0, 10);
          program.Kontrak_Verified        = 'TRUE';
          program.Kontrak_Tgl             = today;
          program.Target_Kuartal_Nilai    = String(TARGET_KUARTAL_DEFAULT);
          program.Target_Kuartal_Verified = 'TRUE';
          program.Target_Kuartal_Tgl      = today;
          program.Diperbarui_Pada         = now;
          await sheetsService.updateRow(
            SHEETS.ELITE_PROGRAM,
            program._rowIdx,
            COLUMNS.ELITE_PROGRAM.map(c => program[c] || '')
          );
          programSynced = true;
        } else {
          console.warn('[EliteKontrak] Agen', matchedAgent.ID, 'tidak punya draft/aktif ELITE_PROGRAM — kontrak tidak disinkronkan');
        }
      } else {
        console.warn('[EliteKontrak] Agen dengan No_WA', noWa, 'tidak ditemukan di AGENTS — kontrak tidak disinkronkan');
      }
    } catch (syncErr) {
      console.error('[EliteKontrak] Sync ke ELITE_PROGRAM gagal:', syncErr.message);
    }

    const row = COLUMNS.ELITE_KONTRAK.map(col => {
      switch (col) {
        case 'ID':                return id;
        case 'Tanggal_Submit':    return now;
        case 'Nama_Lengkap':      return b.nama_lengkap.trim();
        case 'Nomor_KTP':         return b.nomor_ktp.trim();
        case 'Alamat_Domisili':   return b.alamat_domisili.trim();
        case 'Asal_Kantor':       return b.asal_kantor.trim();
        case 'No_WA':             return noWa;
        case 'Setuju':            return 'TRUE';
        case 'Program_Synced':    return programSynced ? 'TRUE' : 'FALSE';
        case 'IP_Address':        return req.ip || '';
        default:                  return '';
      }
    });
    await sheetsService.appendRow(SHEETS.ELITE_KONTRAK, row);

    // Notif WA (best-effort)
    try {
      const emoji = programSynced ? '✅' : '⚠️';
      const adminMsg =
        `${emoji} *Kontrak ELITE Ditandatangani*\n\n` +
        `Nama: ${b.nama_lengkap.trim()}\n` +
        `No WA: ${noWa}\n` +
        `Asal Kantor: ${b.asal_kantor.trim()}\n` +
        (programSynced
          ? `\nKontrak_Verified + Target Kuartal (Rp 3M) otomatis di-update di ELITE_PROGRAM.`
          : `\n⚠️ Tidak ditemukan draft ELITE_PROGRAM yang cocok — perlu update manual di ELITE Partner Mgmt.`);
      const principalWAs = await eliteSvc.getPrincipalsWA();
      for (const wa of principalWAs) await eliteSvc.sendWA(wa, adminMsg);

      if (matchedAgent?.No_WA) {
        const agentMsg =
          `✅ *Kontrak ELITE Diterima*\n\n` +
          `Halo ${b.nama_lengkap.trim()}, Surat Perjanjian ELITE Program Anda sudah kami terima.\n\n` +
          `Tim kami akan melanjutkan proses verifikasi.`;
        await eliteSvc.sendWA(matchedAgent.No_WA, agentMsg);
      }
    } catch (notifErr) {
      console.warn('[EliteKontrak] WA notif gagal:', notifErr.message);
    }

    res.json({ success: true, message: 'Kontrak berhasil dikirim. Terima kasih.', programSynced });
  } catch (e) {
    console.error('[EliteKontrak] Error:', e.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan kontrak. Coba lagi.' });
  }
});

module.exports = router;
