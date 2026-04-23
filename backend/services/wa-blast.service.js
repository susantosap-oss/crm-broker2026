/**
 * WaBlastService — PA WA Blast via Baileys (pure WebSocket, tanpa Chrome)
 * =========================================================================
 * Satu WA socket per agen (indexed by agentId).
 * Session disimpan di /tmp/wa-sessions/{agentId}/ — ephemeral per container.
 * Jika container restart, agen perlu pair ulang (scan QR / pairing code).
 *
 * Perilaku anti-ban:
 *   - Typing presence  : 3–7 detik sebelum kirim tiap pesan
 *   - Delay antar pesan: 20–60 detik (random)
 *   - Maks 5 nomor / sesi, 2 sesi / hari (enforced di pa.service)
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode   = require('qrcode');
const pino     = require('pino');
const path     = require('path');
const fs       = require('fs');

const AUTH_BASE = '/tmp/wa-sessions';
const TYPING_MIN = 3_000;
const TYPING_MAX = 7_000;
const DELAY_MIN  = 20_000;
const DELAY_MAX  = 60_000;

// Silent logger — hindari output Baileys yang verbose
const logger = pino({ level: 'silent' });

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms)       { return new Promise(r => setTimeout(r, ms)); }

class WaBlastService {
  constructor() {
    // agentId → { sock, status, qrDataUrl, pairingCode }
    this._clients = new Map();
  }

  // ── Public API ──────────────────────────────────────────────

  getStatus(agentId) {
    const s = this._clients.get(agentId);
    return s ? s.status : 'not_initialized';
  }

  /**
   * Inisialisasi socket dan kembalikan QR (data URL).
   * Jika session masih valid → langsung connected (tanpa QR).
   */
  async getQR(agentId) {
    const existing = this._clients.get(agentId);
    if (existing?.status === 'connected') return { status: 'connected', qr: null };
    if (existing?.status === 'qr_pending' && existing.qrDataUrl) {
      return { status: 'qr_pending', qr: existing.qrDataUrl };
    }

    return this._boot(agentId, 'qr');
  }

  /**
   * Minta pairing code (untuk pengguna HP).
   * @param {string} phoneNumber  format 628xxx (tanpa +)
   */
  async requestPairingCode(agentId, phoneNumber) {
    const existing = this._clients.get(agentId);
    if (existing?.status === 'connected') return { status: 'connected', code: null };

    // Destroy client lama jika ada
    await this._destroy(agentId);

    return this._boot(agentId, 'pair', phoneNumber);
  }

  async logout(agentId) {
    const s = this._clients.get(agentId);
    if (s?.sock) {
      try { await s.sock.logout(); } catch (_) {}
    }
    await this._destroy(agentId);
    // Hapus auth files supaya scan ulang dari awal
    const authDir = path.join(AUTH_BASE, agentId);
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
  }

  /**
   * Kirim blast ke daftar recipients dengan delay humanlike.
   * @param {string}   agentId
   * @param {Array<{nomor:string, type:'personal'|'group'}>} recipients
   * @param {string}   message
   * @param {{ onProgress?: Function }} opts
   */
  async sendBlast(agentId, recipients, message, opts = {}) {
    const s = this._clients.get(agentId);
    if (!s || s.status !== 'connected') {
      throw new Error('WA PA belum terhubung. Hubungkan dulu via Pengaturan PA.');
    }

    const { sock } = s;
    const results  = [];

    for (let i = 0; i < recipients.length; i++) {
      const { nomor, type } = recipients[i];
      const jid = this._toJid(nomor, type);

      try {
        // Typing presence (simulasi manusia)
        await sock.sendPresenceUpdate('composing', jid);
        await sleep(rand(TYPING_MIN, TYPING_MAX));
        await sock.sendPresenceUpdate('paused', jid);

        await sock.sendMessage(jid, { text: message });

        results.push({ nomor, status: 'sent' });
        if (opts.onProgress) opts.onProgress({ nomor, status: 'sent' });

      } catch (e) {
        results.push({ nomor, status: 'failed', error: e.message });
        if (opts.onProgress) opts.onProgress({ nomor, status: 'failed', error: e.message });
      }

      // Delay antar pesan (skip setelah yang terakhir)
      if (i < recipients.length - 1) {
        await sleep(rand(DELAY_MIN, DELAY_MAX));
      }
    }

    return results;
  }

  // ── Private ─────────────────────────────────────────────────

  /**
   * Boot Baileys socket.
   * mode: 'qr' → tunggu QR event
   * mode: 'pair' → request pairing code setelah connected ke WA servers
   */
  async _boot(agentId, mode = 'qr', phoneNumber = null) {
    const authDir = path.join(AUTH_BASE, agentId);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version }          = await fetchLatestBaileysVersion();

    const clientState = { status: 'initializing', qrDataUrl: null, pairingCode: null, sock: null };
    this._clients.set(agentId, clientState);

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ['Mansion CRM PA', 'Chrome', '126.0'],
      // Matikan call & story supaya lebih ringan
      shouldIgnoreJid: jid => !jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us'),
    });

    clientState.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    // Kembalikan Promise yang resolve saat QR ready ATAU pairing code ready
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout koneksi ke WA. Coba lagi.'));
      }, 45_000);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // ── QR mode ──
        if (qr && mode === 'qr') {
          try {
            clientState.qrDataUrl = await QRCode.toDataURL(qr);
            clientState.status = 'qr_pending';
            clearTimeout(timeout);
            resolve({ status: 'qr_pending', qr: clientState.qrDataUrl });
          } catch (e) { reject(e); }
        }

        // ── Pairing code mode — QR event = socket sudah reach WA servers ──
        if (qr && mode === 'pair' && phoneNumber) {
          try {
            const num  = phoneNumber.replace(/\D/g, '');
            const code = await sock.requestPairingCode(num);
            clientState.pairingCode = code;
            clientState.status = 'pairing';
            clearTimeout(timeout);
            resolve({ status: 'pairing', code });
          } catch (e) {
            clearTimeout(timeout);
            reject(new Error(`Gagal mendapat pairing code: ${e.message}`));
          }
        }

        // ── Connected ──
        if (connection === 'open') {
          clientState.status = 'connected';
          clientState.qrDataUrl = null;
          clearTimeout(timeout);
          // Jika sudah terpasang dari session cache (tanpa QR/pair)
          if (clientState.status !== 'connected') resolve({ status: 'connected', qr: null, code: null });
          else resolve({ status: 'connected', qr: null, code: null });
        }

        // ── Disconnected ──
        if (connection === 'close') {
          const code     = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode : 0;
          const loggedOut = code === DisconnectReason.loggedOut;

          clientState.status = loggedOut ? 'disconnected' : 'reconnecting';

          if (loggedOut) {
            this._clients.delete(agentId);
            // Bersihkan auth files supaya QR fresh
            if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
          } else if (clientState.status !== 'connected') {
            // Reconnect otomatis hanya jika belum pernah resolve
          }
        }
      });
    });
  }

  async _destroy(agentId) {
    const s = this._clients.get(agentId);
    if (s?.sock) {
      try { s.sock.ev.removeAllListeners(); s.sock.ws?.close(); } catch (_) {}
    }
    this._clients.delete(agentId);
  }

  _toJid(nomor, type) {
    if (type === 'group') {
      return nomor.includes('@') ? nomor : `${nomor}@g.us`;
    }
    let num = nomor.replace(/\D/g, '');
    if (num.startsWith('0')) num = '62' + num.slice(1);
    return `${num}@s.whatsapp.net`;
  }
}

module.exports = new WaBlastService();
