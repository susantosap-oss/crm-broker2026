/**
 * Cron Service — Daily scheduled tasks
 *
 * Jadwal: setiap hari 19:00 WIB (UTC+7 = 12:00 UTC)
 * Tugas: cek agen/koord/BM yang belum input jadwal harian hari ini
 *        → kirim in-app notification + web push
 */

const cron          = require('node-cron');
const sheetsService = require('./sheets.service');
const pushService   = require('./push.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// Lazy-require untuk menghindari circular dependency
function getCreateNotification() {
  return require('../routes/notifications.routes').createNotification;
}

// Format date WIB ke YYYY-MM-DD
function todayWIB() {
  const now = new Date();
  // Offset WIB = UTC+7
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

async function checkJadwalHarian() {
  console.log('[CRON] Checking jadwal harian...', new Date().toISOString());
  try {
    const today = todayWIB();

    // 1. Ambil semua agen aktif dengan role agen/koordinator/business_manager
    const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!agentRows || agentRows.length < 2) return;

    const toAgent = (row) => COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
    const targetRoles = ['agen', 'koordinator', 'business_manager'];
    const agents = agentRows.slice(1)
      .map(toAgent)
      .filter(a => a.ID && a.Status === 'Aktif' && targetRoles.includes(a.Role));

    if (!agents.length) return;

    // 2. Ambil aktivitas harian hari ini
    const aktRows = await sheetsService.getRange(SHEETS.AKTIVITAS_HARIAN);
    const toAkt = (row) => COLUMNS.AKTIVITAS_HARIAN.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
    const todayAktAgentIds = new Set(
      (aktRows || []).slice(1)
        .map(toAkt)
        .filter(a => a.Tanggal === today)
        .map(a => a.Agen_ID)
    );

    // 3. Filter agen yang BELUM input hari ini
    const missing = agents.filter(a => !todayAktAgentIds.has(a.ID));
    if (!missing.length) {
      console.log('[CRON] Semua agen sudah input jadwal harian');
      return;
    }

    console.log(`[CRON] ${missing.length} agen belum input jadwal harian`);

    const createNotification = getCreateNotification();

    // 4. Kirim notifikasi ke setiap agen yang belum input
    for (const agent of missing) {
      // In-app notification
      try {
        await createNotification({
          tipe: 'reminder',
          judul: 'Reminder: Jadwal Harian',
          pesan: `Halo ${agent.Nama || agent.ID}, kamu belum mengisi jadwal harian hari ini (${today}). Segera isi sekarang!`,
          from_user_id: 'system',
          from_user_nama: 'Sistem CRM',
          to_user_id: agent.ID,
          to_role: '',
          link_type: 'aktivitas_harian',
          link_id: today,
        });
      } catch (e) {
        console.error(`[CRON] Gagal buat notif in-app untuk ${agent.ID}:`, e.message);
      }

      // Web push notification
      try {
        await pushService.sendToUser(agent.ID, {
          title: 'Reminder Jadwal Harian',
          body: `Halo ${agent.Nama || ''}! Segera isi jadwal harian hari ini.`,
          url: '/?page=Aktifitas+Harian',
          tag: `jadwal-harian-${today}`,
        });
      } catch (e) {
        console.error(`[CRON] Gagal kirim push untuk ${agent.ID}:`, e.message);
      }
    }

    console.log('[CRON] Reminder jadwal harian selesai dikirim');
  } catch (e) {
    console.error('[CRON] checkJadwalHarian error:', e.message);
  }
}

function startCronJobs() {
  // Setiap hari pukul 19:00 WIB = 12:00 UTC
  // cron syntax: menit jam hari bulan hari_minggu
  cron.schedule('0 12 * * *', checkJadwalHarian, {
    timezone: 'UTC',
  });
  console.log('[CRON] Jadwal harian reminder scheduled: 19:00 WIB daily');
}

module.exports = { startCronJobs, checkJadwalHarian };
