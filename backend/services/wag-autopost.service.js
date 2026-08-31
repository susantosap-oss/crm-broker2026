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
  Browsers,
} = require('@whiskeysockets/baileys');
const { Boom }   = require('@hapi/boom');
const { Storage } = require('@google-cloud/storage');
const QRCode     = require('qrcode');
const pino       = require('pino');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const BUCKET_NAME  = process.env.GCS_BUCKET || 'mansion-wag-sessions';
const SESSION_DIR  = process.env.WAG_SESSION_DIR || path.join(os.tmpdir(), 'wag-kantor');
const GCS_PREFIX   = 'kantor-session/';
const logger       = pino({ level: 'silent' });

// Cegah MaxListenersExceededWarning dari Baileys media streams
require('events').EventEmitter.defaultMaxListeners = 30;

const ALLOWED_ROLES_MANAGE = ['admin', 'principal', 'superadmin'];

class WagAutopostService {
  constructor() {
    this._sock          = null;
    this._status        = 'disconnected';
    this._pairingCode   = null;
    this._qrDataUrl     = null;
    this._storage       = new Storage();
    this._bucket        = this._storage.bucket(BUCKET_NAME);
    this._sessionLoaded = false;
    this._uploading     = false; // mutex: cegah concurrent upload ke GCS
    this._booting       = false; // guard: cegah concurrent _boot() loop
    this._groupCache    = {};    // cache groupMetadata — bypass IQ query timeout saat sendMessage
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
    if (this._uploading) return; // skip jika sudah ada upload berjalan
    this._uploading = true;
    try {
      if (!fs.existsSync(SESSION_DIR)) return;
      const files = fs.readdirSync(SESSION_DIR);
      for (const f of files) {
        const full = path.join(SESSION_DIR, f);
        if (fs.statSync(full).isFile()) {
          await this._uploadFileToGCS(full);
          // Jeda 150ms antar file — hindari GCS rate limit (429)
          await new Promise(r => setTimeout(r, 150));
        }
      }
    } catch (e) {
      console.error('[WAG] Upload full session GCS gagal:', e.message);
    } finally {
      this._uploading = false;
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

  async autoPost(forceType = null, waitMs = 0, textOnly = false) {
    const config = await this.getConfig();
    const activeGroups = config.filter(g => g.aktif);
    console.log(`[WAG] autoPost: status=${this._status} config=${config.length} aktif=${activeGroups.length}`);
    if (!activeGroups.length) return { skipped: true, reason: 'Tidak ada WAG aktif' };

    // Jika diminta tunggu (dari scheduler), coba reconnect + wait
    if (this._status !== 'connected' && waitMs > 0) {
      await this.connect();
      await this._waitConnected(waitMs);
    }
    // Fail fast — jangan blokir kalau belum connected
    if (this._status !== 'connected') {
      this.connect().catch(() => {}); // trigger reconnect di background
      return { skipped: true, reason: 'WA bot tidak terhubung' };
    }

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

    // Sisipkan URL foto ke caption (text-only, hindari refreshMediaConn timeout)
    if (imageUrl) caption += `\n\n🖼 ${imageUrl}`;

    // Kirim ke semua WAG aktif
    const results = [];
    for (const group of activeGroups) {
      const sent = await this._sendToGroup(group, null, null, caption);
      results.push(sent);
      if (sent.status.startsWith('sent')) await new Promise(r => setTimeout(r, 3000));
    }

    // Log ke sheet WAG_POST_LOG
    await this._logPost(pick, item, results).catch(() => {});

    // Upload semua session files setelah kirim (capture sender-keys baru, non-blocking)
    this._uploadSessionToGCS().catch(() => {});

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

  async _sendToGroup(group, _imgBuffer, _imageUrl, caption) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Simulasi mengetik seperti wa-blast — "wakes up" koneksi sebelum kirim
        await this._sock.sendPresenceUpdate('composing', group.jid);
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
        await this._sock.sendPresenceUpdate('paused', group.jid);

        await this._sock.sendMessage(group.jid, { text: caption });
        console.log(`[WAG] sendMessage OK (attempt ${attempt}) → ${group.nama}`);
        return { jid: group.jid, nama: group.nama, status: 'sent' };
      } catch (e) {
        console.warn(`[WAG] sendMessage attempt ${attempt} GAGAL → ${group.nama}: ${e.message}`);
        if (e.message && (e.message.includes('Bad MAC') || e.message.includes('Connection Closed'))) {
          this._status = 'disconnected';
          setTimeout(() => this._boot(), 5000);
          return { jid: group.jid, nama: group.nama, status: 'failed', error: e.message };
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 10000)); // tunggu 10s sebelum retry
      }
    }
    return { jid: group.jid, nama: group.nama, status: 'failed', error: 'Gagal setelah 2 percobaan' };
  }

  async _downloadImageBuffer(url) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return Buffer.from(buf);
    } catch (_) { return null; }
    finally { clearTimeout(timer); }
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
    // Guard: satu _boot() saja yang boleh jalan (cegah infinite reconnect loop)
    if (this._booting) return { status: this._status };
    this._booting = true;

    // Bersihkan socket lama sebelum buat yang baru
    if (this._sock) {
      try { this._sock.ev.removeAllListeners(); } catch (_) {}
      try { this._sock.ws?.terminate?.(); } catch (_) {}
      this._sock = null;
    }

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
      browser: Browsers.macOS('Desktop'),
      shouldIgnoreJid: () => false,
      maxMsgRetryCount: 2,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 120_000, // sender-key distribution ke banyak anggota butuh waktu
      // Cache groupMetadata — bypass IQ query timeout saat sendMessage ke grup
      cachedGroupMetadata: async (jid) => this._groupCache[jid],
    });

    this._sock = sock;

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      // Hanya upload creds.json — file lain di-upload setelah connect/autoPost
      // (upload semua file sekaligus terlalu sering → GCS rate limit 429)
      const credsPath = path.join(SESSION_DIR, 'creds.json');
      if (fs.existsSync(credsPath)) await this._uploadFileToGCS(credsPath);
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._booting = false;
        if (mode === 'pair' || mode === 'qr') reject(new Error('Timeout koneksi ke WA. Coba lagi.'));
        else resolve({ status: this._status });
      }, 60_000);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && mode === 'qr') {
          try {
            this._qrDataUrl = await QRCode.toDataURL(qr);
            this._status = 'qr_pending';
            this._booting = false;
            clearTimeout(timeout);
            resolve({ status: 'qr_pending', qrDataUrl: this._qrDataUrl });
          } catch (e) {
            this._booting = false;
            clearTimeout(timeout);
            reject(new Error(`Gagal generate QR: ${e.message}`));
          }
        }

        if (qr && mode === 'pair' && phoneNumber) {
          try {
            const num  = phoneNumber.replace(/\D/g, '');
            const code = await sock.requestPairingCode(num);
            this._pairingCode = code;
            this._status = 'pairing';
            this._booting = false;
            clearTimeout(timeout);
            resolve({ status: 'pairing', code });
          } catch (e) {
            this._booting = false;
            clearTimeout(timeout);
            reject(new Error(`Gagal pairing code: ${e.message}`));
          }
        }

        if (connection === 'open') {
          this._status = 'connected';
          this._pairingCode = null;
          this._booting = false;
          clearTimeout(timeout);
          // Cache semua group metadata — bypass IQ query timeout saat sendMessage
          sock.groupFetchAllParticipating().then(groups => {
            this._groupCache = groups;
            console.log(`[WAG] Group cache loaded: ${Object.keys(groups).length} grup`);
          }).catch(() => {});
          // Upload session penuh ke GCS setelah connect (non-blocking)
          this._uploadSessionToGCS().catch(() => {});
          resolve({ status: 'connected' });
        }

        if (connection === 'close') {
          const errCode   = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode : 0;
          const loggedOut = errCode === DisconnectReason.loggedOut;

          this._booting = false;

          if (loggedOut) {
            this._status = 'disconnected';
            await this._clearGCSSession();
            if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            this._sessionLoaded = false;
            clearTimeout(timeout);
            resolve({ status: 'disconnected' });
          } else {
            // Hanya schedule reconnect jika belum ada yang pending
            if (this._status !== 'reconnecting') {
              this._status = 'reconnecting';
              clearTimeout(timeout);
              resolve({ status: 'reconnecting' });
              // Reconnect sekali saja setelah 8 detik
              setTimeout(() => {
                if (this._status === 'reconnecting') {
                  this._boot().catch(e => console.error('[WAG] Reconnect error:', e.message));
                }
              }, 8_000);
            }
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
