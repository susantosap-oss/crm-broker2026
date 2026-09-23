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

  _listFilesRecursive(dir) {
    const result = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          result.push(...this._listFilesRecursive(full));
        } else if (entry.isFile()) {
          result.push(full);
        }
      }
    } catch (_) {}
    return result;
  }

  async _uploadSessionToGCS() {
    if (this._uploading) return; // skip jika sudah ada upload berjalan
    this._uploading = true;
    try {
      if (!fs.existsSync(SESSION_DIR)) return;
      // Rekursif — tangkap sender-key/pre-key files di subdirektori juga
      const files = this._listFilesRecursive(SESSION_DIR);
      for (const full of files) {
        try {
          await this._uploadFileToGCS(full);
        } catch (fileErr) {
          console.warn('[WAG] Skip upload file (mungkin sedang ditulis):', fileErr.message);
        }
        // Jeda 150ms antar file — hindari GCS rate limit (429)
        await new Promise(r => setTimeout(r, 150));
      }
      console.log(`[WAG] Session GCS upload selesai: ${files.length} file`);
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
    const VALID_TIPES = new Set(['listing', 'aset', 'all']);
    const VALID_KATS  = new Set(['internal', 'external']);
    try {
      const rows = await sheetsService.getRows(SHEETS.WAG_CONFIG);
      return (rows || []).map(r => {
        // r[4] bisa Tipe (data baru) atau Created_At (data lama 5-kolom)
        const hasTipe = VALID_TIPES.has(r[4]);
        const tipe     = hasTipe ? r[4] : 'all';
        // r[5] bisa Kategori (data baru 7-kolom) atau Created_At (6-kolom)
        const hasKat   = hasTipe && VALID_KATS.has(r[5]);
        const kategori = hasKat ? r[5] : 'internal';
        return {
          id:      r[0],
          jid:     r[1],
          nama:    r[2],
          aktif:   r[3] === 'TRUE',
          tipe,
          kategori,
          created: hasKat ? r[6] : (hasTipe ? r[5] : r[4]),
        };
      });
    } catch (e) {
      console.error('[WAG] getConfig gagal baca sheet:', e.message);
      return [];
    }
  }

  async saveConfig(groups) {
    // Hapus semua baris data (bukan header) dalam 1 API call — jauh lebih cepat dari deleteRow per baris
    await sheetsService.sheets.spreadsheets.values.clear({
      spreadsheetId: sheetsService.spreadsheetId,
      range: `${SHEETS.WAG_CONFIG}!A2:Z`,
    });
    // Tulis baris baru
    const newRows = groups.map(g => [
      uuidv4(),
      g.jid,
      g.nama,
      g.aktif ? 'TRUE' : 'FALSE',
      g.tipe     || 'all',
      g.kategori || 'internal',
      new Date().toISOString(),
    ]);
    if (newRows.length) await sheetsService.appendRows(SHEETS.WAG_CONFIG, newRows);
    return { success: true, total: newRows.length };
  }

  // ── Auto-Post (dipanggil Cloud Scheduler) ────────────────────

  async autoPost(forceType = null, waitMs = 0, textOnly = false, filterKategori = null) {
    const config = await this.getConfig();
    const activeGroups = config.filter(g => g.aktif);
    console.log(`[WAG] autoPost: status=${this._status} config=${config.length} aktif=${activeGroups.length}` +
      (activeGroups.length ? ` [${activeGroups.map(g => `${g.nama}(${g.tipe||'all'}/${g.kategori||'internal'})`).join(', ')}]` : ''));
    if (!activeGroups.length) return { skipped: true, reason: 'Tidak ada WAG aktif' };

    const useFonnte = !!process.env.FONNTE_TOKEN;

    if (!useFonnte) {
      // Tanpa Fonnte: butuh Baileys connected
      if (this._status !== 'connected' && waitMs > 0) {
        await this.connect();
        await this._waitConnected(waitMs);
      }
      if (this._status !== 'connected') {
        this.connect().catch(() => {});
        return { skipped: true, reason: 'WA bot tidak terhubung' };
      }
      // Guard group cache
      if (!Object.keys(this._groupCache).length) {
        try {
          this._groupCache = await this._sock.groupFetchAllParticipating();
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.warn('[WAG] groupFetchAllParticipating gagal:', e.message);
        }
      }
    }

    // Pilih tipe: forceType jika ada, else random 50/50
    const pick = forceType || (Math.random() < 0.5 ? 'listing' : 'aset');
    console.log(`[WAG] pick=${pick} forceType=${forceType || 'null'}`);

    // Kategori efektif: explicit filterKategori > default (listing→internal, aset→tanpa filter)
    const effKategori = filterKategori ?? (pick === 'listing' ? 'internal' : null);
    console.log(`[WAG] filterKategori=${filterKategori ?? 'null'} effKategori=${effKategori ?? 'null'}`);

    // Filter grup berdasarkan tipe konten DAN kategori
    const targetGroups = activeGroups.filter(g => {
      const t = g.tipe || 'all';
      const k = g.kategori || 'internal';
      const tipeMatch = t === 'all' || t === pick;
      const katMatch  = effKategori ? k === effKategori : true;
      return tipeMatch && katMatch;
    });
    console.log(`[WAG] targetGroups=${targetGroups.length} (tipe=${pick} kategori=${effKategori ?? 'semua'}: [${targetGroups.map(g=>g.nama).join(', ')||'none'}])`);
    if (!targetGroups.length) return { skipped: true, reason: `Tidak ada WAG aktif untuk tipe ${pick}` };

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

    // Kirim ke WAG yang sesuai tipe
    const results = [];
    for (const group of targetGroups) {
      const sent = await this._sendToGroup(group, null, imageUrl, caption);
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

    // SOP: Status=Publish + Foto_1_URL + Harga_Limit_Lelang + Kode_Asset + Est_Harga_Pasar (wajib untuk rasio)
    // Rasio = Est_Harga_Pasar / Harga_Limit — jika rasio ≥ 2.0 → ditandai SELLABLE di caption
    const eligible = (rows || []).filter(r =>
      r[idx('Status')] === 'Publish' &&
      r[idx('Foto_1_URL')] &&
      r[idx('Harga_Limit_Lelang')] &&
      r[idx('Kode_Asset')] &&
      r[idx('Est_Harga_Pasar')]
    );
    if (!eligible.length) return { item: null };

    const r    = eligible[Math.floor(Math.random() * eligible.length)];
    const item = {};
    cols.forEach((c, i) => { item[c] = r[i]; });

    const caption = this._captionAset(item);
    return { item, caption, imageUrl: item.Foto_1_URL || null };
  }

  _captionListing(l, agenWA) {
    const aksi   = l.Status_Transaksi === 'Sewa' ? 'DISEWAKAN' : 'DIJUAL';
    const harga  = l.Harga_Format || `Rp ${Number(l.Harga || 0).toLocaleString('id-ID')}`;
    const emoji  = this._emoji(l.Tipe_Properti);
    // Fallback parse Deskripsi jika kolom terstruktur kosong (data lama simpan spek di free text)
    const raw = l.Deskripsi || '';
    const px  = (re) => { const m = raw.match(re); return m ? m[1].trim() : ''; };
    const lt  = l.Luas_Tanah    || px(/LT\s*[:/]?\s*(\d+)/i);
    const lb  = l.Luas_Bangunan || px(/LB\s*[:/]?\s*(\d+)/i);
    const kt  = l.Kamar_Tidur   || px(/(\d+(?:[+\-]\d+)?)\s*KT/i) || px(/KT\s*[:/]?\s*(\d+)/i);
    const km  = l.Kamar_Mandi   || px(/(\d+(?:[+\-]\d+)?)\s*KM/i) || px(/KM\s*[:/]?\s*(\d+)/i);
    const srt = l.Sertifikat    || px(/(SHM|HGB|SHGB|AJB|Girik|Strata Title)/i);

    const spek   = [];
    if (lt)          spek.push(`• LT          : ${lt} m²`);
    if (lb)          spek.push(`• LB          : ${lb} m²`);
    if (kt)          spek.push(`• Kamar Tidur : ${kt} KT`);
    if (km)          spek.push(`• Kamar Mandi : ${km} KM`);
    if (l.Garasi)    spek.push(`• Garasi      : ${l.Garasi}`);
    if (l.Lantai)    spek.push(`• Lantai      : ${l.Lantai}`);
    if (srt)         spek.push(`• Sertifikat  : ${srt}`);
    if (l.Kondisi)   spek.push(`• Kondisi     : ${l.Kondisi}`);
    if (l.Fasilitas) spek.push(`• Fasilitas   : ${l.Fasilitas}`);

    const loc   = [l.Kecamatan, l.Kota].filter(Boolean).join(', ');
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

    // Nilai Rasio = Est_Harga_Pasar / Harga_Limit (multiplier)
    // Contoh: Pasar 2B / Limit 1B = 2.0x → Sellable (min ratio ≥ 2.0)
    let rasioLine = '';
    const limitNum  = Number(a.Harga_Limit_Lelang) || 0;
    const pasarNum  = Number(a.Est_Harga_Pasar)    || 0;
    if (limitNum > 0 && pasarNum > 0) {
      const rasio    = pasarNum / limitNum;
      const rasioFmt = rasio.toFixed(1);
      const sellable = rasio >= 2 ? ' ✅ *SELLABLE*' : '';
      const pasarFmt = a.Est_Harga_Pasar_Format || `Rp ${pasarNum.toLocaleString('id-ID')}`;
      rasioLine = `\n📊 Est. Harga Pasar: ${pasarFmt}\n📊 Nilai Rasio: *${rasioFmt}x*${sellable}`;
    }

    const label = (a.Label_Asset || 'Eksekusi').toUpperCase();
    return `${emoji} *ASET ${label}* | ${(a.Tipe_Properti || '').toUpperCase()}
📍 ${loc}

✨ ${a.Nama_Asset || ''}

📋 *SPESIFIKASI:*
${spek.length ? spek.join('\n') : '• Hubungi kami untuk detail spesifikasi'}

💰 Harga Limit: *${harga}*${rasioLine}

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
      results.filter(r => r.status === 'sent' || r.status === 'sent_fonnte').length,
      results.filter(r => r.status === 'failed' || r.status === 'failed_fonnte').length,
      JSON.stringify(results),
    ];
    await sheetsService.appendRow(SHEETS.WAG_POST_LOG, row);
  }

  // ── Fonnte API sender ────────────────────────────────────────

  async _sendViaFonnte(group, caption, imageUrl = null) {
    const token  = process.env.FONNTE_TOKEN;
    // Kirim full JID (termasuk @g.us) — Fonnte menerima format ini untuk grup
    const target = group.jid;
    const ctrl   = new AbortController();
    const timer  = setTimeout(() => ctrl.abort(), 30_000);
    try {
      // Fonnte API: contoh resmi PHP kirim CURLOPT_POSTFIELDS sebagai array — di PHP-cURL ini
      // SELALU multipart/form-data (bukan x-www-form-urlencoded, terbukti dari Fonnte message
      // history: kirim urlencoded → Type tercatat "text" & kolom Url kosong, field url diabaikan).
      // Harus multipart/form-data agar field 'url' (attachment) dikenali sebagai media.
      const form = new FormData();
      form.append('target', target);
      form.append('message', caption);
      form.append('countryCode', '62');
      if (imageUrl) form.append('url', imageUrl);
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        signal: ctrl.signal,
        // Jangan set Content-Type manual — fetch generate boundary multipart otomatis dari FormData
        headers: { 'Authorization': token },
        body: form,
      });
      const data = await res.json();
      if (!data.status) {
        console.warn(`[WAG] Fonnte GAGAL → ${group.nama} (${target}): ${JSON.stringify(data)}`);
        return { jid: group.jid, nama: group.nama, status: 'failed_fonnte', error: data.reason || 'Fonnte status false' };
      }
      console.log(`[WAG] Fonnte OK → ${group.nama} (${target})${imageUrl ? ' [+foto]' : ' [teks saja]'}: ${JSON.stringify(data)}`);
      return { jid: group.jid, nama: group.nama, status: 'sent_fonnte', note: data.reason || null };
    } catch (e) {
      const errMsg = e.message || String(e);
      console.warn(`[WAG] Fonnte GAGAL → ${group.nama}: ${errMsg}`);
      throw new Error(errMsg);
    } finally {
      clearTimeout(timer);
    }
  }

  async _sendToGroup(group, _imgBuffer, imageUrl, caption) {
    if (process.env.FONNTE_TOKEN) {
      // Fonnte: HTTP POST — tidak butuh Baileys session
      try {
        return await this._sendViaFonnte(group, caption, imageUrl);
      } catch (e) {
        return { jid: group.jid, nama: group.nama, status: 'failed', error: e.message };
      }
    }

    // Fallback Baileys (jika FONNTE_TOKEN tidak di-set)
    if (!this._groupCache[group.jid]) {
      try {
        const meta = await this._sock.groupMetadata(group.jid);
        this._groupCache[group.jid] = meta;
      } catch (e) {
        console.warn(`[WAG] groupMetadata gagal untuk ${group.nama}: ${e.message}`);
      }
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this._sock.sendMessage(group.jid, { text: caption });
        console.log(`[WAG] Baileys sendMessage OK (attempt ${attempt}) → ${group.nama}`);
        this._uploadSessionToGCS().catch(() => {});
        return { jid: group.jid, nama: group.nama, status: 'sent' };
      } catch (e) {
        const errMsg = e.message || String(e);
        console.warn(`[WAG] Baileys attempt ${attempt} GAGAL → ${group.nama}: ${errMsg}`);
        if (errMsg.includes('Bad MAC') || errMsg.includes('Connection Closed')) {
          this._status = 'disconnected';
          setTimeout(() => this._boot(), 5000);
          return { jid: group.jid, nama: group.nama, status: 'failed', error: errMsg };
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 15000));
      }
    }
    return { jid: group.jid, nama: group.nama, status: 'failed', error: 'Baileys gagal setelah 2 percobaan' };
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
      defaultQueryTimeoutMs: 300_000, // 5 menit — distribusi sender-key ke banyak anggota butuh waktu
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
          // Clear timeout segera agar 60s promise timeout tidak balapan dengan operasi async di bawah
          clearTimeout(timeout);
          this._booting = false;

          // STEP 1: Jeda 5s — biarkan WA selesai handshake + sinkronisasi kunci enkripsi grup
          // Langsung kirim pesan setelah 'open' sering gagal karena sender-keys belum terdistribusi
          await new Promise(r => setTimeout(r, 5000));

          // STEP 2: Pre-load group metadata (BLOCKING) — pastikan cache terisi sebelum autoPost
          // Ini juga "warms up" koneksi enkripsi ke setiap grup sebelum sendMessage
          try {
            const groups = await sock.groupFetchAllParticipating();
            this._groupCache = groups;
            console.log(`[WAG] Group cache loaded: ${Object.keys(groups).length} grup`);
          } catch (e) {
            console.warn('[WAG] Group cache load gagal:', e.message);
          }

          this._status = 'connected';
          this._pairingCode = null;

          // STEP 3: Upload session penuh ke GCS (inkl. sender-key files) — non-blocking
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
    this._booting = false; // reset flag agar _boot() berikutnya tidak langsung return
  }
}

module.exports = new WagAutopostService();
