/**
 * PAService — Personal Assistant (OpenClaw) Bridge
 * ============================================
 * Menghubungkan CRM dengan OpenClaw PA worker di Cloud Run.
 *
 * Tanggung jawab:
 *   - Simpan/ambil PA Credentials per agen (enkripsi AES-256)
 *   - Kirim job ke OpenClaw via HTTP (atau Cloud Tasks)
 *   - Track job di GSheets PA_JOBS
 *   - Real-time activity logs (Server-Sent Events ke frontend)
 *   - Handle callback dari OpenClaw (job selesai / gagal)
 *   - Handle QR required notification (WA re-pairing)
 */

const crypto   = require('crypto');
const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// ── Encryption (AES-256-GCM) ─────────────────────────────
const ENC_KEY = Buffer.from(process.env.PA_ENCRYPTION_KEY || '', 'hex'); // 32-byte hex

function encrypt(plaintext) {
  if (!plaintext) return '';
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return '';
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const iv       = Buffer.from(ivHex, 'hex');
  const authTag  = Buffer.from(tagHex, 'hex');
  const enc      = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(enc) + decipher.final('utf8');
}

// ── In-memory SSE clients (untuk PA Activity Logs) ────────
// Map: agentId → Set of res (response streams)
const _sseClients = new Map();

class PAService {

  // ════════════════════════════════════════════════════════
  // CREDENTIALS
  // ════════════════════════════════════════════════════════

  async getCredentials(agentId) {
    const rows = await sheetsService.getRows(SHEETS.PA_CREDENTIALS);
    const row  = rows.find(r => r[1] === agentId); // col B = Agen_ID
    if (!row) return null;

    return {
      id:            row[0],
      agent_id:      row[1],
      ig_username:   row[2],
      // Password tidak dikirim ke frontend
      wa_number:     row[4],
      pa_enabled:    row[5] === 'TRUE',
      ig_status:     row[12] || 'not_configured',
      wa_status:     row[13] || 'not_configured',
      last_ig_login: row[10] || null,
      last_wa_login: row[11] || null,
      zapier_secret: row[14] || null,  // null = belum di-generate
    };
  }

  async saveCredentials(agentId, { ig_username, ig_password, wa_number, pa_enabled, zapier_secret }) {
    const existing = await this._findCredRow(agentId);
    const now      = new Date().toISOString();

    if (existing) {
      // Update row yang sudah ada
      const rowIdx = existing.rowIndex;
      const updates = {};

      if (ig_username   !== undefined) updates[2]  = ig_username;
      if (ig_password   !== undefined) updates[3]  = encrypt(ig_password);
      if (wa_number     !== undefined) updates[4]  = wa_number;
      if (pa_enabled    !== undefined) updates[5]  = pa_enabled ? 'TRUE' : 'FALSE';
      if (zapier_secret !== undefined) updates[14] = zapier_secret;
      updates[9] = now; // Updated_At

      await sheetsService.updateRowCells(SHEETS.PA_CREDENTIALS, rowIdx, updates);
      return { success: true, message: 'Credentials updated' };
    } else {
      // Insert baru
      const newRow = [
        uuidv4(),        // ID
        agentId,         // Agen_ID
        ig_username || '', // IG_Username
        ig_password ? encrypt(ig_password) : '', // IG_Password_Enc
        wa_number || '', // WA_Number
        pa_enabled ? 'TRUE' : 'FALSE', // PA_Enabled
        '',              // IG_Session_GCS
        '',              // WA_Session_GCS
        now,             // Created_At
        now,             // Updated_At
        '',              // Last_IG_Login
        '',              // Last_WA_Login
        'not_configured',// IG_Status
        'not_configured',// WA_Status
        '',              // Zapier_Secret (diisi saat agen generate pertama kali)
      ];
      await sheetsService.appendRow(SHEETS.PA_CREDENTIALS, newRow);
      return { success: true, message: 'Credentials saved' };
    }
  }

  async getDecryptedCredentials(agentId) {
    const row = await this._findCredRow(agentId);
    if (!row) return null;
    return {
      ig_username: row.data[2],
      ig_password: decrypt(row.data[3]),
      wa_number:   row.data[4],
      pa_enabled:  row.data[5] === 'TRUE',
    };
  }

  async updateCredStatus(agentId, platform, status) {
    const existing = await this._findCredRow(agentId);
    if (!existing) return;

    const now     = new Date().toISOString();
    const updates = {};
    if (platform === 'ig') {
      updates[10] = now;    // Last_IG_Login
      updates[12] = status; // IG_Status
    } else {
      updates[11] = now;    // Last_WA_Login
      updates[13] = status; // WA_Status
    }
    await sheetsService.updateRowCells(SHEETS.PA_CREDENTIALS, existing.rowIndex, updates);
  }

  // ════════════════════════════════════════════════════════
  // JOB MANAGEMENT
  // ════════════════════════════════════════════════════════

  /**
   * Trigger job ke OpenClaw.
   * Kalau ada Cloud Tasks, pakai itu. Fallback ke direct HTTP.
   */
  async triggerJob({ agentId, agentNama, type, listingId, listingTitle, videoUrl, recipients, sessionNumber = 1, triggeredBy }) {
    const creds = await this.getDecryptedCredentials(agentId);
    if (!creds || !creds.pa_enabled) {
      throw new Error('PA belum dikonfigurasi atau tidak aktif untuk agen ini');
    }

    // Cek daily limit
    const todayCount = await this._getTodayJobCount(agentId, type);
    const dailyLimit = type.startsWith('ig_') ? 5 : 2; // 5 IG / 2 WA sessions
    if (todayCount >= dailyLimit) {
      throw new Error(`Daily limit reached: ${todayCount}/${dailyLimit} untuk tipe ${type}`);
    }

    const jobId = uuidv4();
    const now   = new Date().toISOString();

    // Simpan job ke GSheets
    await sheetsService.appendRow(SHEETS.PA_JOBS, [
      jobId,
      agentId,
      agentNama,
      type,
      'queued',
      listingId || '',
      listingTitle || '',
      videoUrl || '',
      recipients ? JSON.stringify(recipients) : '',
      String(sessionNumber),
      '',              // Logs
      '',              // Error_Msg
      now,             // Created_At
      '',              // Started_At
      '',              // Finished_At
      triggeredBy || agentId,
    ]);

    // Kirim ke OpenClaw worker
    const payload = {
      job_id:   jobId,
      agent_id: agentId,
      type,
      payload: {
        video_url:       videoUrl,
        caption:         await this._buildCaption(listingId, listingTitle),
        listing_id:      listingId,
        listing_title:   listingTitle,
        type,
        today_count:     todayCount,
        ig_username:     creds.ig_username,
        ig_password:     creds.ig_password,
        recipients:      recipients || [],
        session_number:  sessionNumber,
      }
    };

    await this._sendToOpenClaw(payload);

    // Broadcast ke SSE clients
    this._broadcast(agentId, {
      event: 'job_queued',
      job_id: jobId,
      type,
      listing_title: listingTitle,
      message: `PA menerima job: ${_typeLabel(type)} untuk "${listingTitle}"`,
      ts: now,
    });

    return { success: true, job_id: jobId };
  }

  async handleCallback({ jobId, status, error }) {
    const rows = await sheetsService.getRows(SHEETS.PA_JOBS);
    const rowIdx = rows.findIndex(r => r[0] === jobId);
    if (rowIdx < 0) return;

    const now     = new Date().toISOString();
    const updates = { 4: status, 14: now }; // Status, Finished_At
    if (error) updates[11] = error;          // Error_Msg
    await sheetsService.updateRowCells(SHEETS.PA_JOBS, rowIdx + 2, updates); // +2 karena header

    const agentId = rows[rowIdx][1];
    this._broadcast(agentId, {
      event: status === 'completed' ? 'job_done' : 'job_failed',
      job_id: jobId,
      status,
      error,
      message: status === 'completed'
        ? `PA berhasil menyelesaikan tugas!`
        : `PA gagal: ${error}`,
      ts: now,
    });

    // Update credential status
    if (error && error.includes('CHALLENGE_REQUIRED')) {
      await this.updateCredStatus(agentId, 'ig', 'challenge_required');
    }
  }

  async handleQRRequired({ agentId, platform, qrImage, message }) {
    await this.updateCredStatus(agentId, platform, 'qr_required');
    this._broadcast(agentId, {
      event: 'qr_required',
      platform,
      qr_image: qrImage,   // base64 PNG
      message,
      ts: new Date().toISOString(),
    });
  }

  async getJobHistory(agentId, limit = 20) {
    const rows = await sheetsService.getRows(SHEETS.PA_JOBS);
    const agentRows = rows.filter(r => r[1] === agentId);
    return agentRows.slice(-limit).reverse().map(r => ({
      id:            r[0],
      type:          r[3],
      status:        r[4],
      listing_title: r[6],
      logs:          r[10],
      error:         r[11],
      created_at:    r[12],
      finished_at:   r[14],
    }));
  }

  // ════════════════════════════════════════════════════════
  // SSE — Real-time Activity Logs
  // ════════════════════════════════════════════════════════

  addSSEClient(agentId, res) {
    if (!_sseClients.has(agentId)) _sseClients.set(agentId, new Set());
    _sseClients.get(agentId).add(res);
    console.log(`[PA] SSE client connected for agent ${agentId}`);
  }

  removeSSEClient(agentId, res) {
    _sseClients.get(agentId)?.delete(res);
    console.log(`[PA] SSE client disconnected for agent ${agentId}`);
  }

  _broadcast(agentId, data) {
    const clients = _sseClients.get(agentId);
    if (!clients || clients.size === 0) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch (e) { clients.delete(res); }
    }
  }

  // ════════════════════════════════════════════════════════
  // REPORTING
  // ════════════════════════════════════════════════════════

  async getTeamReport(requestorRole, requestorId) {
    const rows = await sheetsService.getRows(SHEETS.PA_JOBS);
    const today = new Date().toISOString().slice(0, 10);

    // Filter jobs hari ini
    const todayJobs = rows.filter(r => r[12] && r[12].startsWith(today));

    // Group by agen
    const byAgent = {};
    for (const job of todayJobs) {
      const agentId = job[1];
      if (!byAgent[agentId]) {
        byAgent[agentId] = {
          agent_id:   agentId,
          agent_nama: job[2],
          ig_reels:   0,
          ig_story:   0,
          wa_blast:   0,
          total_jobs: 0,
          completed:  0,
        };
      }
      byAgent[agentId].total_jobs++;
      if (job[3] === 'ig_reels')  byAgent[agentId].ig_reels++;
      if (job[3] === 'ig_story')  byAgent[agentId].ig_story++;
      if (job[3] === 'wa_blast')  byAgent[agentId].wa_blast++;
      if (job[4] === 'completed') byAgent[agentId].completed++;
    }

    return Object.values(byAgent).sort((a, b) => b.total_jobs - a.total_jobs);
  }

  // ════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════

  async _sendToOpenClaw(payload) {
    const url = process.env.OPENCLAW_URL;
    if (!url) throw new Error('OPENCLAW_URL not configured');

    await axios.post(`${url}/job`, payload, {
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      timeout: 10000,
    });
  }

  async _getTodayJobCount(agentId, type) {
    const rows  = await sheetsService.getRows(SHEETS.PA_JOBS);
    const today = new Date().toISOString().slice(0, 10);
    return rows.filter(r =>
      r[1] === agentId &&
      r[3] === type &&
      r[12] && r[12].startsWith(today)
    ).length;
  }

  /**
   * Generate (atau regenerate) Zapier Secret per agen.
   * Disimpan di kolom Zapier_Secret (index 14) di PA_CREDENTIALS.
   * Mengembalikan secret baru.
   */
  async generateZapierSecret(agentId) {
    const secret   = uuidv4();
    const existing = await this._findCredRow(agentId);
    const now      = new Date().toISOString();

    if (existing) {
      await sheetsService.updateRowCells(SHEETS.PA_CREDENTIALS, existing.rowIndex, {
        14: secret,  // Zapier_Secret
        9:  now,     // Updated_At
      });
    } else {
      // Buat baris credentials baru jika belum ada
      await this.saveCredentials(agentId, { zapier_secret: secret });
      // Update secret yang baru saja dibuat
      const fresh = await this._findCredRow(agentId);
      if (fresh) {
        await sheetsService.updateRowCells(SHEETS.PA_CREDENTIALS, fresh.rowIndex, { 14: secret });
      }
    }
    return secret;
  }

  /**
   * Ambil Zapier Secret milik agen (untuk verifikasi webhook).
   * Dipakai oleh webhook route — tanpa auth JWT.
   */
  async getZapierSecret(agentId) {
    const rows = await sheetsService.getRows(SHEETS.PA_CREDENTIALS);
    const row  = rows.find(r => r[1] === agentId);
    return row ? (row[14] || null) : null;
  }

  async _findCredRow(agentId) {
    const rows = await sheetsService.getRows(SHEETS.PA_CREDENTIALS);
    const idx  = rows.findIndex(r => r[1] === agentId);
    if (idx < 0) return null;
    return { rowIndex: idx + 2, data: rows[idx] }; // +2 karena header 1-indexed
  }

  async _buildCaption(listingId, listingTitle) {
    // Caption default — bisa dikustomisasi nanti
    return `🏠 ${listingTitle}\n\nProperti eksklusif dari MANSION Realty.\nHubungi kami untuk informasi lebih lanjut.\n\n#propertisurabaya #mansionrealty #rumahsurabaya`;
  }
}

function _typeLabel(type) {
  const labels = { ig_reels: 'Instagram Reels', ig_story: 'Instagram Story', wa_blast: 'WA Blast' };
  return labels[type] || type;
}

module.exports = new PAService();
