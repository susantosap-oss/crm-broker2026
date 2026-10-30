/**
 * Cron Service — Daily scheduled tasks
 *
 * Job 1 — 19:00 WIB (12:00 UTC): reminder jadwal harian agen belum input
 * Job 2 — 08:00 WIB (01:00 UTC): cek reminder masa sewa 90 & 30 hari
 */

const cron          = require('node-cron');
const axios         = require('axios');
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

// ── Rental Reminder ────────────────────────────────────────────────────────────

async function checkRentalReminders() {
  console.log('[CRON] Checking rental reminders...', new Date().toISOString());
  try {
    const rows = await sheetsService.getRange(SHEETS.RENTAL_STATUS);
    if (!rows || rows.length < 2) return;

    const toRental = (row) => COLUMNS.RENTAL_STATUS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
    const rentals  = rows.slice(1).map((r, i) => ({ ...toRental(r), _rowIdx: i + 1 })).filter(r => r.ID);

    const agentRows = await sheetsService.getRange(SHEETS.AGENTS);
    const toAgent   = (row) => COLUMNS.AGENTS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
    const agentMap  = {};
    if (agentRows && agentRows.length > 1) {
      agentRows.slice(1).map(toAgent).filter(a => a.ID).forEach(a => { agentMap[a.ID] = a; });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const rental of rentals) {
      if (rental.Status !== 'aktif') continue;

      const endDate = new Date(rental.Tanggal_Selesai);
      endDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((endDate - today) / (1000 * 60 * 60 * 24));

      if (rental.Periode_Sewa === 'Bulanan') {
        // Bulanan: reminder 10 hari sebelum tiap periode selesai
        if (diffDays <= 10 && diffDays > 0 && rental.Reminder_10_Sent !== 'TRUE') {
          await kirimReminderSewa(agentMap, rental, diffDays, 'bulanan_10');
          const newRow = COLUMNS.RENTAL_STATUS.map(c => c === 'Reminder_10_Sent' ? 'TRUE' : (rental[c] || ''));
          await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rental._rowIdx, newRow);
          console.log(`[CRON] Reminder 10 hari (Bulanan Periode ${rental.Periode_Ke}) dikirim untuk rental ${rental.ID}`);
        }
      } else {
        // Tahunan: reminder 90 hari (agen CRM saja) dan 30 hari (semua pihak)
        if (diffDays <= 90 && diffDays > 30 && rental.Reminder_90_Sent !== 'TRUE') {
          await kirimReminderSewa(agentMap, rental, diffDays, 'normal', true);
          const newRow = COLUMNS.RENTAL_STATUS.map(c => c === 'Reminder_90_Sent' ? 'TRUE' : (rental[c] || ''));
          await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rental._rowIdx, newRow);
          console.log(`[CRON] Reminder 90 hari dikirim untuk rental ${rental.ID} (sisa ${diffDays} hari)`);
        }
        if (diffDays <= 30 && diffDays > 0 && rental.Reminder_30_Sent !== 'TRUE') {
          await kirimReminderSewa(agentMap, rental, diffDays, 'urgent');
          const newRow = COLUMNS.RENTAL_STATUS.map(c => c === 'Reminder_30_Sent' ? 'TRUE' : (rental[c] || ''));
          await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rental._rowIdx, newRow);
          console.log(`[CRON] Reminder 30 hari dikirim untuk rental ${rental.ID} (sisa ${diffDays} hari)`);
        }
      }
    }

    console.log('[CRON] Rental reminder check selesai');
  } catch (e) {
    console.error('[CRON] checkRentalReminders error:', e.message);
  }
}

// agenOnly=true → WA hanya ke Agen_ID; false → semua pihak (Listing, Selling, CoBroke, Customer)
async function kirimReminderSewa(agentMap, rental, hariLagi, tone, agenOnly = false) {
  const tglSelesai  = new Date(rental.Tanggal_Selesai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const fonnteToken = process.env.FONNTE_TOKEN || '';

  const periodInfo = rental.Periode_Ke && rental.Durasi_Total_Bulan
    ? ` (Periode ${rental.Periode_Ke}/${rental.Durasi_Total_Bulan})`
    : '';

  // Helper kirim satu nomor WA via Fonnte global token
  async function sendWA(noWa, pesan) {
    if (!fonnteToken || !noWa) return;
    const target = String(noWa).replace(/^0/, '62');
    try {
      await axios.post('https://api.fonnte.com/send', { target, message: pesan },
        { headers: { Authorization: fonnteToken }, timeout: 10000 });
    } catch (e) {
      console.error(`[CRON] Fonnte error ke ${target}:`, e.message);
    }
  }

  // Pesan untuk agen (nama dinamis)
  const buildPesanAgen = (namaAgen) => tone === 'urgent'
    ? `⚠️ *SEGERA* Halo ${namaAgen}, masa sewa *${rental.Nama_Penyewa}* di ${rental.Alamat_Sewa} akan berakhir dalam *${hariLagi} hari* (${tglSelesai}). Segera hubungi penyewa untuk perpanjangan!`
    : tone === 'bulanan_10'
      ? `🗓️ Halo ${namaAgen}, periode sewa bulanan *${rental.Nama_Penyewa}* di ${rental.Alamat_Sewa}${periodInfo} akan berakhir dalam *${hariLagi} hari* (${tglSelesai}). Harap konfirmasi kelanjutan sewa.`
      : `📋 Halo ${namaAgen}, masa sewa *${rental.Nama_Penyewa}* di ${rental.Alamat_Sewa} akan berakhir dalam ${hariLagi} hari (${tglSelesai}). Silakan hubungi penyewa untuk proses perpanjangan.`;

  // Pesan khusus untuk customer/penyewa
  const pesanCustomer = tone === 'urgent'
    ? `⚠️ Halo *${rental.Nama_Penyewa}*, masa sewa Anda di ${rental.Alamat_Sewa}${periodInfo} akan berakhir dalam *${hariLagi} hari* (${tglSelesai}). Untuk informasi perpanjangan, silakan hubungi agen kami segera.`
    : tone === 'bulanan_10'
      ? `🗓️ Halo *${rental.Nama_Penyewa}*, periode sewa bulanan Anda di ${rental.Alamat_Sewa}${periodInfo} akan berakhir dalam *${hariLagi} hari* (${tglSelesai}). Untuk konfirmasi kelanjutan sewa, silakan hubungi agen kami.`
      : `📋 Halo *${rental.Nama_Penyewa}*, masa sewa Anda di ${rental.Alamat_Sewa} akan berakhir dalam ${hariLagi} hari (${tglSelesai}). Silakan hubungi agen kami untuk proses perpanjangan.`;

  // Kirim WA ke semua pihak — dedup berdasarkan nomor agar tidak double
  const sentNomor = new Set();

  async function kirimKeAgen(agenId) {
    if (!agenId) return;
    const a = agentMap[agenId] || {};
    const noWa = a.No_WA || '';
    if (!noWa || sentNomor.has(noWa)) return;
    sentNomor.add(noWa);
    await sendWA(noWa, buildPesanAgen(a.Nama || agenId));
  }

  await kirimKeAgen(rental.Agen_ID);

  if (!agenOnly) {
    await kirimKeAgen(rental.Agen_Listing_ID);
    await kirimKeAgen(rental.Agen_Selling_ID);

    // CoBroke agent — nomor langsung (bukan CRM agent)
    if (rental.Agen_CoBroke_WA && !sentNomor.has(rental.Agen_CoBroke_WA)) {
      sentNomor.add(rental.Agen_CoBroke_WA);
      await sendWA(rental.Agen_CoBroke_WA, buildPesanAgen(rental.Agen_CoBroke_Nama || 'Agen CoBroke'));
    }

    // Customer/penyewa — pesan berbeda
    if (rental.No_WA_Penyewa) {
      await sendWA(rental.No_WA_Penyewa, pesanCustomer);
    }
  }

  // In-app notification — hanya ke Agen_ID (pemegang record)
  if (rental.Agen_ID) {
    try {
      const createNotification = getCreateNotification();
      const judulNotif = tone === 'urgent'
        ? `⚠️ Sewa berakhir ${hariLagi} hari lagi`
        : tone === 'bulanan_10'
          ? `🗓️ Periode Bulanan berakhir ${hariLagi} hari lagi`
          : `📋 Reminder Sewa — ${hariLagi} hari lagi`;
      await createNotification({
        tipe: 'reminder',
        judul: judulNotif,
        pesan: `Masa sewa ${rental.Nama_Penyewa} di ${rental.Alamat_Sewa}${periodInfo} berakhir pada ${tglSelesai} (${hariLagi} hari lagi). Segera hubungi penyewa.`,
        from_user_id: 'system',
        from_user_nama: 'Sistem CRM',
        to_user_id: rental.Agen_ID,
        to_role: '',
        link_type: 'rental',
        link_id: rental.ID,
      });
    } catch (e) {
      console.error('[CRON] Gagal buat notif in-app rental:', e.message);
    }
  }

  // Web push — hanya ke Agen_ID (pemegang record)
  if (rental.Agen_ID) {
    try {
      const pushTitle = tone === 'urgent'
        ? '⚠️ Reminder Sewa Mendesak'
        : tone === 'bulanan_10'
          ? '🗓️ Reminder Sewa Bulanan'
          : '📋 Reminder Sewa';
      await pushService.sendToUser(rental.Agen_ID, {
        title: pushTitle,
        body:  `Sewa ${rental.Nama_Penyewa}${periodInfo} berakhir ${hariLagi} hari lagi`,
        url:   '/?page=rental',
        tag:   `rental-${rental.ID}-${hariLagi}`,
      });
    } catch (e) {
      console.error('[CRON] push error:', e.message);
    }
  }
}

// ── Start all cron jobs ───────────────────────────────────────────────────────

function startCronJobs() {
  // Job 1: reminder jadwal harian — 19:00 WIB = 12:00 UTC
  cron.schedule('0 12 * * *', checkJadwalHarian, { timezone: 'UTC' });
  console.log('[CRON] Jadwal harian reminder scheduled: 19:00 WIB daily');

  // Job 2: reminder masa sewa — 08:00 WIB = 01:00 UTC
  cron.schedule('0 1 * * *', checkRentalReminders, { timezone: 'UTC' });
  console.log('[CRON] Rental reminder scheduled: 08:00 WIB daily');
}

module.exports = { startCronJobs, checkJadwalHarian, checkRentalReminders };
