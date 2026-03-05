/**
 * Telegram Bot — Mansion Properti CRM
 * ============================================
 * Fitur:
 *  - /start          → registrasi & sambutan
 *  - /upload_listing → wizard upload listing baru (dengan foto)
 *  - /listing        → lihat listing milik agen (5 terbaru)
 *  - /listing <kota> → cari listing by lokasi/keyword
 *  - /hotleads       → lihat hot leads
 *  - /komisi         → link form request komisi
 *  - /id             → tampilkan Telegram ID
 *  - /batal          → batalkan proses aktif
 *  - /help           → daftar command
 */

const TelegramBot   = require('node-telegram-bot-api');
const path          = require('path');
const fs            = require('fs');
const axios         = require('axios');
const listingsService   = require('./services/listings.service');
const sheetsService     = require('./services/sheets.service');
const cloudinaryService = require('./services/cloudinary.service');
const { SHEETS, COLUMNS } = require('./config/sheets.config');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KOMISI_URL = process.env.KOMISI_FORM_URL || 'https://docs.google.com/forms/d/e/1FAIpQLSde2vDLLWK2sw8j872-iponBxnfzNwU5Z_0IvlDuk2AyqQPiQ/viewform';

if (!TOKEN) {
  console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN tidak diset — bot tidak aktif');
  module.exports = null;
  return;
}

// Webhook mode untuk Cloud Run (polling tidak kompatibel dengan serverless)
// Bot diinit tanpa polling — updates diterima via POST dari Telegram
const bot = new TelegramBot(TOKEN, { polling: false });

// ── State percakapan (per chat_id) ────────────────────────────────────────────
const sessions = new Map();

// Bersihkan sessions idle > 30 menit (prevent memory leak)
setInterval(() => {
  const threshold = Date.now() - 30 * 60 * 1000;
  for (const [chatId, sess] of sessions.entries()) {
    if (!sess.lastActivity || sess.lastActivity < threshold) {
      if (sess.step) console.log(`[Bot] Session timeout: chat ${chatId}`);
      sessions.delete(chatId);
    }
  }
}, 10 * 60 * 1000); // run every 10 min
// sessions[chatId] = {
//   step: string,          // current wizard step
//   agent: object,         // agent data dari sheet
//   data: object,          // data listing yang sedang diisi
//   photoUrls: string[],   // URLs foto yang sudah diupload
//   msgToDelete: number[], // message IDs untuk dihapus setelah selesai
// }

// ── Helper: Cari agen by Telegram ID ─────────────────────────────────────────
async function findAgentByTelegramId(telegramId) {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!rows || rows.length < 2) return null;
    const headers = rows[0];
    const telegramCol = headers.indexOf('Telegram_ID');
    if (telegramCol === -1) return null;

    const found = rows.slice(1).find(row => String(row[telegramCol] || '').trim() === String(telegramId));
    if (!found) return null;

    return COLUMNS.AGENTS.reduce((o, c, i) => { o[c] = found[i] || ''; return o; }, {});
  } catch (e) {
    console.error('[Bot] findAgent error:', e.message);
    return null;
  }
}

// ── Helper: Format rupiah ─────────────────────────────────────────────────────
function fmt(num) {
  const n = parseInt(String(num).replace(/\D/g, '')) || 0;
  if (n >= 1e9)  return 'Rp ' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2).replace('.00','') + ' M';
  if (n >= 1e6)  return 'Rp ' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 0) + ' Jt';
  return 'Rp ' + n.toLocaleString('id-ID');
}

// ── Helper: Auth check ────────────────────────────────────────────────────────
async function requireAuth(chatId, telegramId) {
  const sess = sessions.get(chatId) || {};
  if (sess.agent) return sess.agent;

  const agent = await findAgentByTelegramId(telegramId);
  if (!agent) {
    bot.sendMessage(chatId,
      `⛔ *Telegram ID kamu belum terdaftar di CRM.*\n\n` +
      `Berikan ID berikut ke Admin CRM:\n\`${telegramId}\`\n\n` +
      `Admin akan menambahkan ID ini ke akun agenmu.`,
      { parse_mode: 'Markdown' }
    );
    return null;
  }

  sessions.set(chatId, { ...sess, agent });
  return agent;
}

// ── Helper: Download foto dari Telegram ──────────────────────────────────────
async function downloadTelegramPhoto(fileId) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl  = `https://api.telegram.org/file/bot${TOKEN}/${fileInfo.file_path}`;
  const tmpPath  = path.join('/tmp', `tg_${Date.now()}_${fileId.slice(-6)}.jpg`);
  const resp     = await axios({ url: fileUrl, responseType: 'stream' });
  const writer   = fs.createWriteStream(tmpPath);
  await new Promise((res, rej) => { resp.data.pipe(writer); writer.on('finish', res); writer.on('error', rej); });
  return tmpPath;
}

// ── Helper: Kirim listing card ────────────────────────────────────────────────
function listingCard(l, idx, agentWA) {
  const statusEmoji = { Aktif: '✅', Terjual: '🏷️', Tersewa: '🔑', Ditarik: '🚫' };
  const wa = agentWA || l.Agen_WA || '';
  const waLink = wa ? `wa.me/${wa.replace(/\D/g,'')}` : null;
  const lines = [
    `${idx ? `*${idx}.* ` : ''}${statusEmoji[l.Status_Listing] || '📋'} *${l.Judul || '—'}*`,
    `🏷️ \`${l.Kode_Listing || '-'}\`  •  ${l.Tipe_Properti || ''} ${l.Status_Transaksi === 'Disewakan' ? '(Sewa)' : '(Jual)'}`,
    `📍 ${[l.Kecamatan, l.Kota].filter(Boolean).join(', ') || '-'}`,
    `💰 *${fmt(l.Harga)}*`,
    l.Luas_Tanah ? `📐 LT ${l.Luas_Tanah}m²${l.Luas_Bangunan ? ` / LB ${l.Luas_Bangunan}m²` : ''}` : '',
    (l.Kamar_Tidur || l.Kamar_Mandi) ? `🛏 ${l.Kamar_Tidur || 0}KT  🚿 ${l.Kamar_Mandi || 0}KM` : '',
    `👤 *${l.Agen_Nama || '—'}*${waLink ? `  •  📞 [WA](https://${waLink})` : wa ? `  •  📞 ${wa}` : ''}`,
  ].filter(Boolean).join('\n');
  return lines;
}

// ── Helper: Ambil map agenId → No_WA dari AGENTS sheet ──────────────────────
async function getAgentWAMap() {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!rows || rows.length < 2) return {};
    const headers = rows[0];
    const idIdx = headers.indexOf('ID');
    const waIdx = headers.indexOf('No_WA');
    if (idIdx === -1 || waIdx === -1) return {};
    const map = {};
    rows.slice(1).forEach(r => {
      if (r[idIdx]) map[r[idIdx]] = r[waIdx] || '';
    });
    return map;
  } catch { return {}; }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const agent = await requireAuth(chatId, msg.from.id);
    if (!agent) return;
    sessions.set(chatId, { agent, step: null, data: {}, photoUrls: [] });
    bot.sendMessage(chatId,
      `🏠 *Selamat datang, ${agent.Nama}!*\n\n` +
      `Kamu terhubung ke *Mansion Properti CRM* sebagai *${agent.Role}*.\n\n` +
      `Ketik /help untuk melihat daftar perintah.`,
      { parse_mode: 'Markdown' }
    );
  } catch(e) { console.error('[Bot] /start error:', e.message); }
});

// /id — tampilkan Telegram ID
bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🪪 *Telegram ID kamu:*\n\`${msg.from.id}\`\n\nSalin angka ini dan berikan ke Admin CRM.`,
    { parse_mode: 'Markdown' }
  );
});

// /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `📋 *Daftar Perintah Bot CRM*\n\n` +
    `🏠 */upload\\_listing* — Upload listing baru\n` +
    `📋 */listing* — Lihat listing aktifmu (5 terbaru)\n` +
    `🔍 */listing \\<lokasi\\>* — Cari listing by lokasi\n` +
    `   _Contoh: /listing citraland_\n` +
    `🔥 */hotleads* — Lihat hot leads-mu\n` +
    `💰 */komisi* — Request komisi\n` +
    `🪪 */id* — Lihat Telegram ID kamu\n` +
    `❌ */batal* — Batalkan proses aktif\n`,
    { parse_mode: 'MarkdownV2' }
  );
});

// /batal
bot.onText(/\/batal/, (msg) => {
  const chatId = msg.chat.id;
  const sess = sessions.get(chatId);
  if (sess?.step) {
    sessions.set(chatId, { agent: sess.agent, step: null, data: {}, photoUrls: [] });
    bot.sendMessage(chatId, '❌ Proses dibatalkan.');
  } else {
    bot.sendMessage(chatId, 'Tidak ada proses aktif saat ini.');
  }
});

// /komisi
bot.onText(/\/komisi/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const agent = await requireAuth(chatId, msg.from.id);
    if (!agent) return;
    bot.sendMessage(chatId,
      `💰 *Request Komisi*\n\nKlik link di bawah untuk mengisi form request komisi:\n${KOMISI_URL}`,
      { parse_mode: 'Markdown' }
    );
  } catch(e) { console.error('[Bot] /komisi error:', e.message); }
});

// /hotleads
bot.onText(/\/hotleads/, async (msg) => {
  const chatId = msg.chat.id;
  const agent  = await requireAuth(chatId, msg.from.id);
  if (!agent) return;

  try {
    const rows = await sheetsService.getRange(SHEETS.LEADS);
    if (!rows || rows.length < 2) return bot.sendMessage(chatId, 'Belum ada leads.');
    const headers = rows[0];
    const data = rows.slice(1).map(r => headers.reduce((o, h, i) => { o[h] = r[i] || ''; return o; }, {}));

    const hot = data.filter(l => l.Score === 'Hot' && l.Agen_ID === agent.ID)
                    .sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At))
                    .slice(0, 5);

    if (!hot.length) return bot.sendMessage(chatId, '🔥 Tidak ada Hot Leads saat ini.');

    let text = `🔥 *Hot Leads kamu (${hot.length}):*\n\n`;
    hot.forEach((l, i) => {
      text += `*${i + 1}. ${l.Nama || '—'}*\n`;
      text += `📱 ${l.No_WA ? l.No_WA.replace(/(\d{4})(\d+)(\d{4})/, '$1****$3') : '-'}\n`;
      text += `🏠 ${l.Properti_Diminati || l.Tipe_Properti || '-'}\n`;
      text += `💰 ${l.Budget_Max ? fmt(l.Budget_Max) : '-'}\n\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch(e) {
    bot.sendMessage(chatId, '❌ Gagal memuat hot leads: ' + e.message);
  }
});

// /listing [keyword]
bot.onText(/\/listing(.*)/, async (msg, match) => {
  const chatId  = msg.chat.id;
  const keyword = (match[1] || '').trim().toLowerCase();
  const agent   = await requireAuth(chatId, msg.from.id);
  if (!agent) return;

  try {
    const [allListings, agentWAMap] = await Promise.all([
      listingsService.getAll({}),
      getAgentWAMap(),
    ]);
    let results;

    if (keyword) {
      // Cari by keyword (judul, kota, kecamatan, kode)
      results = allListings.filter(l => {
        const haystack = [l.Judul, l.Kota, l.Kecamatan, l.Kode_Listing, l.Deskripsi]
          .join(' ').toLowerCase();
        return haystack.includes(keyword);
      }).slice(0, 8);
    } else {
      // Listing milik agen sendiri, 5 terbaru
      results = allListings
        .filter(l => l.Agen_ID === agent.ID)
        .sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At))
        .slice(0, 5);
    }

    if (!results.length) {
      return bot.sendMessage(chatId,
        keyword
          ? `🔍 Tidak ditemukan listing dengan kata kunci *"${keyword}"*`
          : `📋 Kamu belum punya listing aktif.`,
        { parse_mode: 'Markdown' }
      );
    }

    const title = keyword
      ? `🔍 *Listing ditemukan untuk "${keyword}" (${results.length}):*\n\n`
      : `📋 *Listing kamu (${results.length} terbaru):*\n\n`;

    // Kirim per kartu jika ada foto, atau gabung teks
    await bot.sendMessage(chatId, title + `_Menampilkan ${results.length} listing..._`, { parse_mode: 'Markdown' });

    for (let i = 0; i < results.length; i++) {
      const l    = results[i];
      const text = listingCard(l, i + 1, agentWAMap[l.Agen_ID] || '');

      if (l.Foto_Utama_URL) {
        try {
          await bot.sendPhoto(chatId, l.Foto_Utama_URL, {
            caption: text,
            parse_mode: 'Markdown',
          });
        } catch (_) {
          await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
      } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }
      // Delay kecil supaya tidak flood
      await new Promise(r => setTimeout(r, 300));
    }

    if (keyword && results.length === 8) {
      bot.sendMessage(chatId, `_Menampilkan 8 hasil teratas. Gunakan kata kunci lebih spesifik untuk hasil yang lebih akurat._`, { parse_mode: 'Markdown' });
    }

  } catch(e) {
    bot.sendMessage(chatId, '❌ Gagal memuat listing: ' + e.message);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// WIZARD UPLOAD LISTING
// ═════════════════════════════════════════════════════════════════════════════

const TIPE_OPTIONS = ['Rumah', 'Ruko', 'Kavling', 'Apartemen', 'Gudang', 'Lainnya'];
const TRANSAKSI_OPTIONS = ['Dijual', 'Disewakan'];

const WIZARD_STEPS = [
  'tipe', 'transaksi', 'judul', 'kota', 'kecamatan',
  'harga', 'luas_tanah', 'luas_bangunan', 'kamar_tidur', 'kamar_mandi',
  'deskripsi', 'foto', 'konfirmasi',
];

const STEP_PROMPTS = {
  tipe:          `📌 *Pilih tipe properti:*\n\n1. Rumah\n2. Ruko\n3. Kavling\n4. Apartemen\n5. Gudang\n6. Lainnya\n\n_Ketik angkanya (1-6)_`,
  transaksi:     `💼 *Status transaksi:*\n\n1. Dijual\n2. Disewakan\n\n_Ketik 1 atau 2_`,
  judul:         `✏️ *Judul listing:*\n_Contoh: Rumah Minimalis 2 Lantai Citraland_`,
  kota:          `🌆 *Kota:*\n_Contoh: Surabaya_`,
  kecamatan:     `📍 *Kecamatan / Area:*\n_Contoh: Lakarsantri_`,
  harga:         `💰 *Harga (angka saja, Rp):*\n_Contoh: 850000000_`,
  luas_tanah:    `📐 *Luas Tanah (m²):*\n_Ketik 0 jika tidak ada / tidak tahu_`,
  luas_bangunan: `🏗 *Luas Bangunan (m²):*\n_Ketik 0 jika tidak ada_`,
  kamar_tidur:   `🛏 *Jumlah Kamar Tidur:*\n_Ketik 0 jika tidak ada_`,
  kamar_mandi:   `🚿 *Jumlah Kamar Mandi:*\n_Ketik 0 jika tidak ada_`,
  deskripsi:     `📝 *Deskripsi listing:*\n_Tulis detail properti, kondisi, keunggulan, dll._\n_Ketik /skip untuk lewati_`,
  foto:          `📸 *Upload foto properti (maks. 3):*\n\nKirim foto satu per satu.\nKetik /selesaifoto setelah selesai upload.\nKetik /skip untuk lewati foto.`,
};

// /upload_listing
bot.onText(/\/upload_listing/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const agent = await requireAuth(chatId, msg.from.id);
    if (!agent) return;
    sessions.set(chatId, { agent, step: 'tipe', data: {}, photoUrls: [] });
    bot.sendMessage(chatId,
      `🏠 *Upload Listing Baru*\n\nHalo *${agent.Nama}*! Mari tambahkan listing baru.\nKetik /batal kapan saja untuk membatalkan.\n\n` + STEP_PROMPTS.tipe,
      { parse_mode: 'Markdown' }
    );
  } catch(e) { console.error('[Bot] /upload_listing error:', e.message); }
});

// /skip (di dalam wizard)
bot.onText(/\/skip/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const sess = sessions.get(chatId);
    if (!sess?.step || !['deskripsi', 'foto'].includes(sess.step)) return;
    if (sess.step === 'deskripsi') {
      sess.data.Deskripsi = '';
      sess.step = 'foto';
      sessions.set(chatId, sess);
      bot.sendMessage(chatId, STEP_PROMPTS.foto, { parse_mode: 'Markdown' });
    } else if (sess.step === 'foto') {
      sess.step = 'konfirmasi';
      sessions.set(chatId, sess);
      sendConfirmation(chatId, sess);
    }
  } catch(e) { console.error('[Bot] /skip error:', e.message); }
});

// /selesai_foto (setelah upload foto)
bot.onText(/\/selesai_foto|\/selesaifoto/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const sess = sessions.get(chatId);
    if (!sess || sess.step !== 'foto') return;
    sess.step = 'konfirmasi';
    sessions.set(chatId, sess);
    sendConfirmation(chatId, sess);
  } catch(e) { console.error('[Bot] /selesaifoto error:', e.message); }
});

// Handle foto yang dikirim agen
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const sess   = sessions.get(chatId);
  if (!sess || sess.step !== 'foto') return;

  if (sess.photoUrls.length >= 3) {
    return bot.sendMessage(chatId, '⚠️ Maksimal 3 foto. Ketik /selesai_foto untuk lanjut.');
  }

  const uploadMsg = await bot.sendMessage(chatId, `⏳ Mengupload foto ${sess.photoUrls.length + 1}...`);

  try {
    // Ambil ukuran foto terbesar
    const photoArr = msg.photo;
    const bestPhoto = photoArr[photoArr.length - 1];
    const tmpPath = await downloadTelegramPhoto(bestPhoto.file_id);

    const result = await cloudinaryService.upload(tmpPath, { subfolder: 'listings' });
    fs.unlink(tmpPath, () => {});

    sess.photoUrls.push(result.secure_url);
    sessions.set(chatId, sess);

    // deleteMessage berdiri sendiri — tidak boleh crash-kan flow utama
    bot.deleteMessage(chatId, uploadMsg.message_id).catch(() => {});

    const sisa = 3 - sess.photoUrls.length;
    bot.sendMessage(chatId,
      `✅ *Foto ${sess.photoUrls.length} berhasil diupload!*\n\n` +
      (sisa > 0
        ? `Kirim foto lagi (sisa ${sisa}) atau ketik /selesaifoto untuk lanjut.`
        : `Sudah 3 foto (maks). Ketik /selesaifoto untuk lanjut.`),
      { parse_mode: 'Markdown' }
    );

  } catch(e) {
    console.error('[Bot] Photo upload error:', e.message, e.stack);
    bot.deleteMessage(chatId, uploadMsg.message_id).catch(() => {});
    bot.sendMessage(chatId,
      `❌ *Gagal upload foto.*\nError: ${e.message}\n\n` +
      `Coba kirim ulang, atau ketik /selesaifoto untuk lanjut tanpa foto.`
    );
  }
});

// ── Handler teks umum (wizard steps) ─────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text) return;
  const chatId  = msg.chat.id;
  const text    = msg.text.trim();

  // Skip jika command
  if (text.startsWith('/')) return;

  const sess = sessions.get(chatId);
  if (!sess?.step) return;

  const step = sess.step;
  const d    = sess.data;

  // ── Validasi & simpan per step ──────────────────────────────────────────
  if (step === 'tipe') {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= TIPE_OPTIONS.length) {
      return bot.sendMessage(chatId, `⚠️ Ketik angka 1–${TIPE_OPTIONS.length}. ${STEP_PROMPTS.tipe}`, { parse_mode: 'Markdown' });
    }
    d.Tipe_Properti = TIPE_OPTIONS[idx];
    sess.step = 'transaksi';

  } else if (step === 'transaksi') {
    if (!['1','2'].includes(text)) {
      return bot.sendMessage(chatId, `⚠️ Ketik 1 (Dijual) atau 2 (Disewakan).`);
    }
    d.Status_Transaksi = TRANSAKSI_OPTIONS[parseInt(text) - 1];
    sess.step = 'judul';

  } else if (step === 'judul') {
    if (text.length < 5) return bot.sendMessage(chatId, '⚠️ Judul terlalu pendek (min. 5 karakter).');
    d.Judul = text;
    sess.step = 'kota';

  } else if (step === 'kota') {
    d.Kota = text;
    sess.step = 'kecamatan';

  } else if (step === 'kecamatan') {
    d.Kecamatan = text;
    sess.step = 'harga';

  } else if (step === 'harga') {
    const harga = parseInt(text.replace(/\D/g, ''));
    if (!harga || harga < 1000) return bot.sendMessage(chatId, '⚠️ Masukkan harga yang valid (angka saja).');
    d.Harga       = harga;
    d.Harga_Format = fmt(harga);
    sess.step = 'luas_tanah';

  } else if (step === 'luas_tanah') {
    d.Luas_Tanah = parseInt(text) || 0;
    sess.step = 'luas_bangunan';

  } else if (step === 'luas_bangunan') {
    d.Luas_Bangunan = parseInt(text) || 0;
    sess.step = 'kamar_tidur';

  } else if (step === 'kamar_tidur') {
    d.Kamar_Tidur = parseInt(text) || 0;
    sess.step = 'kamar_mandi';

  } else if (step === 'kamar_mandi') {
    d.Kamar_Mandi = parseInt(text) || 0;
    sess.step = 'deskripsi';

  } else if (step === 'deskripsi') {
    d.Deskripsi = text;
    sess.step = 'foto';

  } else if (step === 'foto') {
    // User kirim teks saat di step foto — ingatkan
    bot.sendMessage(chatId, '📸 Kirim foto sebagai gambar, atau ketik /selesaifoto untuk lanjut tanpa foto.');
    return;

  } else if (step === 'konfirmasi') {
    const jawaban = text.toUpperCase().replace(/[^A-Z]/g, '');
    if (['YA','YES','Y','IYA'].includes(jawaban)) {
      await simpanListing(chatId, sess);
    } else if (['TIDAK','NO','N','BATAL'].includes(jawaban)) {
      sessions.set(chatId, { agent: sess.agent, step: null, data: {}, photoUrls: [] });
      bot.sendMessage(chatId, '❌ Upload dibatalkan. Listing tidak disimpan.');
    } else {
      bot.sendMessage(chatId, 'Ketik *YA* untuk simpan atau *TIDAK* untuk batal.', { parse_mode: 'Markdown' });
      return;
    }
    return;
  }

  sess.lastActivity = Date.now();
  sessions.set(chatId, sess);

  // Kirim prompt step berikutnya
  if (sess.step && sess.step !== 'konfirmasi') {
    bot.sendMessage(chatId, STEP_PROMPTS[sess.step], { parse_mode: 'Markdown' });
  }
});

// ── Konfirmasi ringkasan ──────────────────────────────────────────────────────
function sendConfirmation(chatId, sess) {
  const d = sess.data;
  const text =
    `📋 *RINGKASAN LISTING BARU*\n` +
    `─────────────────────────────\n` +
    `🏠 *Tipe*    : ${d.Tipe_Properti} | ${d.Status_Transaksi}\n` +
    `✏️ *Judul*   : ${d.Judul}\n` +
    `📍 *Lokasi*  : ${d.Kecamatan}, ${d.Kota}\n` +
    `💰 *Harga*   : ${d.Harga_Format}\n` +
    `📐 *LT/LB*   : ${d.Luas_Tanah || 0}m² / ${d.Luas_Bangunan || 0}m²\n` +
    `🛏 *KT/KM*   : ${d.Kamar_Tidur || 0} / ${d.Kamar_Mandi || 0}\n` +
    `📸 *Foto*    : ${sess.photoUrls.length} foto\n` +
    `─────────────────────────────\n\n` +
    `Simpan listing ini?\nKetik *YA* untuk simpan atau *TIDAK* untuk batal.`;

  try { bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }); } catch(e) { console.error('[Bot] sendConfirmation error:', e.message); }
  sess.step = 'konfirmasi';
  sessions.set(chatId, sess);
}

// ── Simpan listing ke sheet ───────────────────────────────────────────────────
async function simpanListing(chatId, sess) {
  // Re-fetch session untuk pastikan dapat photoUrls terbaru
  const freshSess = sessions.get(chatId) || sess;
  const agent = freshSess.agent;
  const d     = freshSess.data;
  const saving = await bot.sendMessage(chatId, '⏳ Menyimpan listing...');

  try {
    const payload = {
      Tipe_Properti:    d.Tipe_Properti,
      Status_Transaksi: d.Status_Transaksi,
      Judul:            d.Judul,
      Kota:             d.Kota,
      Kecamatan:        d.Kecamatan,
      Harga:            d.Harga,
      Harga_Format:     d.Harga_Format,
      Luas_Tanah:       d.Luas_Tanah || '',
      Luas_Bangunan:    d.Luas_Bangunan || '',
      Kamar_Tidur:      d.Kamar_Tidur || '',
      Kamar_Mandi:      d.Kamar_Mandi || '',
      Deskripsi:        d.Deskripsi || '',
      Status_Listing:   'Aktif',
      Tampilkan_di_Web: 'FALSE',
      Foto_Utama_URL:   freshSess.photoUrls[0] || '',
      Foto_2_URL:       freshSess.photoUrls[1] || '',
      Foto_3_URL:       freshSess.photoUrls[2] || '',
    };

    if (!agent?.ID) throw new Error('Data agen tidak valid, coba /start ulang');
    console.log('[Bot] Saving listing:', payload.Judul, '| Agen:', agent.ID, '| Foto:', freshSess.photoUrls.length);

    const result = await listingsService.create(payload, {
      id:   agent.ID,
      nama: agent.Nama || 'Unknown',
    });

    await bot.deleteMessage(chatId, saving.message_id).catch(() => {});

    bot.sendMessage(chatId,
      `✅ *Listing berhasil disimpan!*\n\n` +
      `🏷️ Kode: \`${result.kode}\`\n` +
      `🏠 ${d.Judul}\n` +
      `💰 ${d.Harga_Format}\n\n` +
      `Listing sudah masuk ke CRM dengan status *Aktif*.`,
      { parse_mode: 'Markdown' }
    );

    // Reset session
    sessions.set(chatId, { agent, step: null, data: {}, photoUrls: [] });

  } catch(e) {
    console.error('[Bot] simpanListing error:', e.message, e.stack);
    await bot.deleteMessage(chatId, saving.message_id).catch(() => {});
    bot.sendMessage(chatId,
      `❌ *Gagal menyimpan listing.*\n\`${e.message}\`\n\nHubungi admin atau coba lagi dengan /upload_listing`,
      { parse_mode: 'Markdown' }
    );
    sessions.set(chatId, { agent, step: null, data: {}, photoUrls: [] });
  }
}

// ── Error handler ─────────────────────────────────────────────────────────────
// Setup webhook setelah bot diinisiasi
async function setupWebhook() {
  try {
    const BASE_URL = process.env.BASE_URL || process.env.CLOUD_RUN_URL || '';
    if (!BASE_URL) {
      console.warn('[TelegramBot] BASE_URL tidak diset — webhook tidak terdaftar otomatis');
      console.warn('[TelegramBot] Set manual via: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>/api/telegram-webhook');
      return;
    }
    const webhookUrl = `${BASE_URL}/api/telegram-webhook`;
    const result = await bot.setWebHook(webhookUrl);
    if (result) {
      console.log('[TelegramBot] ✅ Webhook aktif:', webhookUrl);
    } else {
      console.warn('[TelegramBot] ⚠️ Webhook set gagal — cek BASE_URL');
    }
  } catch(e) {
    console.error('[TelegramBot] Webhook setup error:', e.message);
  }
}

setupWebhook();

console.log('🤖 Telegram Bot siap (webhook mode)');
module.exports = bot;
