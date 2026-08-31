/**
 * WagAutopostService — Auto-share Listing/Aset ke WAG Internal via Baileys
 * =========================================================================
 * - Satu koneksi "kantor" (bukan per-agen)
 * - Session disimpan di GCS supaya persist saat Cloud Run scale-to-0
 * - Trigger: Cloud Scheduler 2x/hari (09:00 + 15:00 WIB)
 * - Target: WAG Internal (admin/principal/BM/koord) sesuai WAG_CONFIG sheet
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const { Boom }   = require('@hapi/boom');
const { Storage } = require('@google-cloud/storage');
const QRCode     = require('qrcode');
const pino       = require('pino');
const path       = require('path');
const fs         = require('fs');
const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const BUCKET_NAME  = process.env.GCS_BUCKET || 'mansion-wag-sessions';
const SESSION_DIR  = '/tmp/wag-kantor';
const GCS_PREFIX   = 'kantor-session/';
const logger       = pino({ level: 'silent' });

const ALLOWED_ROLES_MANAGE = ['admin', 'principal', 'superadmin'];

class WagAutopostService {
  constructor() {
    this._sock        = null;
    this._status      = 'disconnected'; // disconnected|initializing|pairing|qr_pending|connected|reconnecting
    this._pairingCode = null;
    this._qrDataUrl   = null;
    this._storage     = new Storage();
    this._bucket      = this._storage.bucket(BUCKET_NAME);
    this._sessionLoaded = false;
  }

  // ── Status ──────────────────────────────────────────────────

  getStatus() {
    return { status: this._status, pairingCode: this._pairingCode, qrDataUrl: this._qrDataUrl };
  }

  // ── Session GCS sync ────────────────────────────────────────

  async _downloadSessionFromGCS() {
    try {
      if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
      const [files] = await this._bucket.getFiles({ prefix: GCS_PREFIX });
      if (!files.length) return false;
      for (const file of files) {
        const localPath = path.join(SESSION_DIR, file.name.replace(GCS_PREFIX, ''));
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await file.download({ destination: localPath });
      }
      return true;
    } catch (e) {
      console.error('[WAG] Download session GCS gagal:', e.message);
      return false;
    }
  }

  async _uploadFileToGCS(localPath) {
    try {
      const relative = path.relative(SESSION_DIR, localPath);
      await this._bucket.upload(localPath, { destination: GCS_PREFIX + relative });
    } catch (e) {
      console.error('[WAG] Upload session GCS gagal:', e.message);
    }
  }

  async _uploadSessionToGCS() {
    try {
      if (!fs.existsSync(SESSION_DIR)) return;
      const files = fs.readdirSync(SESSION_DIR);
      for (const f of files) {
        const full = path.join(SESSION_DIR, f);
        if (fs.statSync(full).isFile()) {
          await this._uploadFileToGCS(full);
        }
      }
    } catch (e) {
      console.error('[WAG] Upload full session GCS gagal:', e.message);
    }
  }

  async _clearGCSSession() {
    try {
      const [files] = await this._bucket.getFiles({ prefix: GCS_PREFIX });
      await Promise.all(files.map(f => f.delete()));
    } catch (_) {}
  }

  // ── Connect / Pair ──────────────────────────────────────────

  /**
   * Inisialisasi koneksi Baileys menggunakan session yang ada.
   * Dipanggil saat startup atau saat scheduler trigger.
   */
  async connect() {
    if (this._status === 'connected') return { status: 'connected' };
    if (this._status === 'initializing') return { status: 'initializing' };

    this._status = 'initializing';
    this._pairingCode = null;

    // Download session dari GCS ke /tmp jika belum
    if (!this._sessionLoaded) {
      await this._downloadSessionFromGCS();
      this._sessionLoaded = true;
    }

    return this._boot();
  }

  /**
   * Request pairing code untuk nomor kantor.
   * @param {string} phoneNumber  format 628xxx atau 08xxx
   */
  async requestPairingCode(phoneNumber) {
    if (this._status === 'connected') return { status: 'connected', code: null };

    // Reset session lama
    await this._destroySocket();
    await this._clearGCSSession();
    if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    this._sessionLoaded = false;

    this._status = 'initializing';
    this._pairingCode = null;

    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    return this._boot('pair', phoneNumber);
  }

  /**
   * Start QR code mode — lebih reliable dari pairing code untuk WA Business.
   * QR di-refresh otomatis tiap ~20 detik oleh WA.
   */
  async requestQR() {
    if (this._status === 'connected') return { status: 'connected', qrDataUrl: null };

    await this._destroySocket();
    await this._clearGCSSession();
    if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    this._sessionLoaded = false;
    this._qrDataUrl = null;

    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    return this._boot('qr');
  }

  async disconnect() {
    await this._destroySocket();
    await this._clearGCSSession();
    if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    this._sessionLoaded = false;
    this._status = 'disconnected';
    this._pairingCode = null;
  }

  // ── Groups ───────────────────────────────────────────────────

  async getGroups() {
    if (this._status !== 'connected') throw new Error('WAG bot belum terhubung');
    const raw = await this._sock.groupFetchAllParticipating();
    return Object.values(raw)
      .map(g => ({ jid: g.id, nama: g.subject || g.id, anggota: g.participants?.length || 0 }))
      .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  }

  // ── WAG Config (Google Sheets) ───────────────────────────────

  async getConfig() {
    try {
      const rows = await sheetsService.getRows(SHEETS.WAG_CONFIG);
      return (rows || []).map(r => ({
        id:      r[0],
        jid:     r[1],
        nama:    r[2],
        aktif:   r[3] === 'TRUE',
        created: r[4],
      }));
    } catch (_) { return []; }
  }

  async saveConfig(groups) {
    // Hapus semua baris data lama (dari bawah ke atas, skip header row 1)
    const existing = await sheetsService.getRows(SHEETS.WAG_CONFIG);
    for (let i = existing.length; i >= 1; i--) {
      await sheetsService.deleteRow(SHEETS.WAG_CONFIG, i + 1); // +1 karena header di row 1
    }
    // Tulis baris baru
    const newRows = groups.map(g => [
      uuidv4(),
      g.jid,
      g.nama,
      g.aktif ? 'TRUE' : 'FALSE',
      new Date().toISOString(),
    ]);
    if (newRows.length) await sheetsService.appendRows(SHEETS.WAG_CONFIG, newRows);
    return { success: true, total: newRows.length };
  }

  // ── Auto-Post (dipanggil Cloud Scheduler) ────────────────────

  async autoPost(forceType = null) {
    const config = await this.getConfig();
    const activeGroups = config.filter(g => g.aktif);
    if (!activeGroups.length) return { skipped: true, reason: 'Tidak ada WAG aktif' };

    // Pastikan connected
    if (this._status !== 'connected') {
      await this.connect();
      await this._waitConnected(20_000);
    }
    if (this._status !== 'connected') return { skipped: true, reason: 'WA bot tidak terhubung' };

    // Pilih tipe: forceType jika ada, else random 50/50
    const pick = forceType || (Math.random() < 0.5 ? 'listing' : 'aset');
    let item, caption, imageUrl;

    if (pick === 'listing') {
      ({ item, caption, imageUrl } = await this._pickListing());
    } else {
      ({ item, caption, imageUrl } = await this._pickAset());
    }

    if (!item) {
      // Fallback ke tipe lain (hanya jika bukan forceType)
      if (!forceType) {
        if (pick === 'listing') {
          ({ item, caption, imageUrl } = await this._pickAset());
        } else {
          ({ item, caption, imageUrl } = await this._pickListing());
        }
      }
    }
    if (!item) return { skipped: true, reason: `Tidak ada ${pick} yang memenuhi SOP` };

    // Kirim ke semua WAG aktif
    const results = [];
    for (const group of activeGroups) {
      try {
        const msgPayload = imageUrl
          ? { image: { url: imageUrl }, caption }
          : { text: caption };
        await this._sock.sendMessage(group.jid, msgPayload);
        results.push({ jid: group.jid, nama: group.nama, status: 'sent' });
        // Delay 3 detik antar grup
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        results.push({ jid: group.jid, nama: group.nama, status: 'failed', error: e.message });
      }
    }

    // Log ke sheet WAG_POST_LOG
    await this._logPost(pick, item, results).catch(() => {});

    return { success: true, tipe: pick, groups: results };
  }

  // ── Caption builders ─────────────────────────────────────────

  async _pickListing() {
    const rows = await sheetsService.getRows(SHEETS.LISTING);
    const cols = COLUMNS.LISTING;
    const idx  = name => cols.indexOf(name);

    // SOP: Status_Listing=Aktif + Foto_Utama_URL + Harga + Agen_ID
    const eligible = (rows || []).filter(r =>
      r[idx('Status_Listing')] === 'Aktif' &&
      r[idx('Foto_Utama_URL')] &&
      r[idx('Harga')] &&
      r[idx('Agen_ID')]
    );
    if (!eligible.length) return { item: null };

    const r    = eligible[Math.floor(Math.random() * eligible.length)];
    const item = {};
    cols.forEach((c, i) => { item[c] = r[i]; });

    // Ambil No_WA agen dari AGENTS sheet
    let agenWA = item.Agen_ID ? await this._getAgenWA(item.Agen_ID) : '';

    const caption = this._captionListing(item, agenWA);
    const imageUrl = item.Foto_Utama_URL || null;
    return { item, caption, imageUrl };
  }

  async _pickAset() {
    const rows = await sheetsService.getRows(SHEETS.ASSETS);
    const cols = COLUMNS.ASSETS;
    const idx  = name => cols.indexOf(name);

    // SOP: Status=Publish + Foto_1_URL + Harga_Limit_Lelang + Kode_Asset
    const eligible = (rows || []).filter(r =>
      r[idx('Status')] === 'Publish' &&
      r[idx('Foto_1_URL')] &&
      r[idx('Harga_Limit_Lelang')] &&
      r[idx('Kode_Asset')]
    );
    if (!eligible.length) return { item: null };

    const r    = eligible[Math.floor(Math.random() * eligible.length)];
    const item = {};
    cols.forEach((c, i) => { item[c] = r[i]; });

    const caption  = this._captionAset(item);
    const imageUrl = item.Foto_1_URL || null;
    return { item, caption, imageUrl };
  }

  _captionListing(l, agenWA) {
    const aksi   = l.Status_Transaksi === 'Sewa' ? 'DISEWAKAN' : 'DIJUAL';
    const harga  = l.Harga_Format || `Rp ${Number(l.Harga || 0).toLocaleString('id-ID')}`;
    const emoji  = this._emoji(l.Tipe_Properti);
    const spek   = [];
    if (l.Luas_Tanah)    spek.push(`• LT          : ${l.Luas_Tanah} m²`);
    if (l.Luas_Bangunan) spek.push(`• LB          : ${l.Luas_Bangunan} m²`);
    if (l.Kamar_Tidur)   spek.push(`• Kamar Tidur : ${l.Kamar_Tidur} KT`);
    if (l.Kamar_Mandi)   spek.push(`• Kamar Mandi : ${l.Kamar_Mandi} KM`);
    if (l.Garasi)        spek.push(`• Garasi      : ${l.Garasi}`);
    if (l.Sertifikat)    spek.push(`• Sertifikat  : ${l.Sertifikat}`);
    if (l.Lantai)        spek.push(`• Lantai      : ${l.Lantai}`);

    const loc   = [l.Kecamatan, l.Kota].filter(Boolean).join(', ');
    const link  = `https://crm.mansionpro.id`;
    const kode  = l.Kode_Listing || l.ID;

    return `${emoji} *${aksi} ${(l.Tipe_Properti || '').toUpperCase()}* | ${harga}
📍 ${loc}

✨ ${l.Judul || ''}

🏠 *SPESIFIKASI:*
${spek.length ? spek.join('\n') : '• Hubungi kami untuk detail spesifikasi'}

💰 Harga: *${harga}*
🤝 Harga nego untuk pembeli serius!

*Info lebih lanjut:*
👤 ${l.Agen_Nama || ''}${agenWA ? `\n📱 ${agenWA}` : ''}
🔗 ${link}
🏷 Kode: ${kode}`;
  }

  _captionAset(a) {
    const harga  = a.Harga_Limit_Format || `Rp ${Number(a.Harga_Limit_Lelang || 0).toLocaleString('id-ID')}`;
    const emoji  = this._emoji(a.Tipe_Properti);
    const loc    = [a.Kecamatan, a.Kota].filter(Boolean).join(', ');
    const spek   = [];
    if (a.Luas_Tanah)    spek.push(`• LT          : ${a.Luas_Tanah} m²`);
    if (a.Luas_Bangunan) spek.push(`• LB          : ${a.Luas_Bangunan} m²`);
    if (a.Sertifikat)    spek.push(`• Sertifikat  : ${a.Sertifikat}`);

    return `${emoji} *ASET EKSEKUSI* | ${(a.Tipe_Properti || '').toUpperCase()}
📍 ${loc}

✨ ${a.Nama_Asset || ''}

📋 *SPESIFIKASI:*
${spek.length ? spek.join('\n') : '• Hubungi kami untuk detail spesifikasi'}

💰 Harga Limit: *${harga}*

🔗 https://crm.mansionpro.id
🏷 Kode: ${a.Kode_Asset}`;
  }

  _emoji(tipe) {
    const t = (tipe || '').toLowerCase();
    if (t.includes('ruko') || t.includes('komersial')) return '🏪';
    if (t.includes('tanah')) return '🌍';
    if (t.includes('apartemen') || t.includes('apt')) return '🏢';
    if (t.includes('gudang')) return '🏭';
    if (t.includes('villa')) return '🏖';
    return '🏠';
  }

  // ── Helpers ──────────────────────────────────────────────────

  async _getAgenWA(agenId) {
    try {
      const rows = await sheetsService.getRows(SHEETS.AGENTS);
      const cols = COLUMNS.AGENTS;
      const row  = rows.find(r => r[cols.indexOf('ID')] === agenId);
      return row ? (row[cols.indexOf('No_WA')] || '') : '';
    } catch (_) { return ''; }
  }

  async _logPost(tipe, item, results) {
    const row = [
      uuidv4(),
      new Date().toISOString(),
      tipe,
      tipe === 'listing' ? (item.Kode_Listing || item.ID) : (item.Kode_Asset || item.ID),
      results.filter(r => r.status === 'sent').length,
      results.filter(r => r.status === 'failed').length,
      JSON.stringify(results),
    ];
    await sheetsService.appendRow(SHEETS.WAG_POST_LOG, row);
  }

  _waitConnected(ms) {
    return new Promise(resolve => {
      const start = Date.now();
      const check = setInterval(() => {
        if (this._status === 'connected' || Date.now() - start > ms) {
          clearInterval(check);
          resolve();
        }
      }, 500);
    });
  }

  // ── Baileys core ─────────────────────────────────────────────

  async _boot(mode = 'session', phoneNumber = null) {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version }          = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ['Mansion CRM', 'Chrome', '126.0'],
      shouldIgnoreJid: () => false,
    });

    this._sock = sock;

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      // Sync ke GCS
      const credsPath = path.join(SESSION_DIR, 'creds.json');
      if (fs.existsSync(credsPath)) await this._uploadFileToGCS(credsPath);
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (mode === 'pair' || mode === 'qr') reject(new Error('Timeout koneksi ke WA. Coba lagi.'));
        else resolve({ status: this._status });
      }, 60_000);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Mode QR: tangkap QR dan simpan sebagai data URL
        if (qr && mode === 'qr') {
          try {
            this._qrDataUrl = await QRCode.toDataURL(qr);
            this._status = 'qr_pending';
            clearTimeout(timeout);
            resolve({ status: 'qr_pending', qrDataUrl: this._qrDataUrl });
          } catch (e) {
            clearTimeout(timeout);
            reject(new Error(`Gagal generate QR: ${e.message}`));
          }
        }

        // Mode pair: saat QR event → request pairing code
        if (qr && mode === 'pair' && phoneNumber) {
          try {
            const num  = phoneNumber.replace(/\D/g, '');
            const code = await sock.requestPairingCode(num);
            this._pairingCode = code;
            this._status = 'pairing';
            clearTimeout(timeout);
            resolve({ status: 'pairing', code });
          } catch (e) {
            clearTimeout(timeout);
            reject(new Error(`Gagal pairing code: ${e.message}`));
          }
        }

        if (connection === 'open') {
          this._status = 'connected';
          this._pairingCode = null;
          clearTimeout(timeout);
          // Upload session penuh ke GCS setelah connect
          await this._uploadSessionToGCS();
          resolve({ status: 'connected' });
        }

        if (connection === 'close') {
          const errCode  = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode : 0;
          const loggedOut = errCode === DisconnectReason.loggedOut;

          if (loggedOut) {
            this._status = 'disconnected';
            await this._clearGCSSession();
            if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            this._sessionLoaded = false;
            clearTimeout(timeout);
            resolve({ status: 'disconnected' });
          } else {
            this._status = 'reconnecting';
            // Reconnect otomatis
            setTimeout(() => this._boot(), 5000);
          }
        }
      });
    });
  }

  async _destroySocket() {
    if (this._sock) {
      try { this._sock.ev.removeAllListeners(); this._sock.ws?.close(); } catch (_) {}
      this._sock = null;
    }
    this._status = 'disconnected';
  }
}

module.exports = new WagAutopostService();
