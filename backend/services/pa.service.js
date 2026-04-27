/**
 * PAService — Personal Assistant
 * ============================================
 * Tanggung jawab:
 *   - Simpan/ambil PA Credentials per agen (enkripsi AES-256)
 *   - Eksekusi IG Post via instagram-private-api (ig-post.service.js)
 *   - Eksekusi WA Blast via Fonnte atau wa.me manual
 *   - Track job di GSheets PA_JOBS
 *   - Real-time activity logs (Server-Sent Events ke frontend)
 */

const crypto   = require('crypto');
const axios    = require('axios');
const cron     = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const SESSION_DELAY_MIN = 180; // menit antar sesi WA Blast
const MAX_SESSIONS_PER_DAY = 4;

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
      id:                 row[0],
      agent_id:           row[1],
      ig_username:        row[2],
      wa_number:          row[4],
      pa_enabled:         row[5] === 'TRUE',
      ig_status:          row[12] || 'not_configured',
      wa_status:          row[13] || 'not_configured',
      last_ig_login:      row[10] || null,
      last_wa_login:      row[11] || null,
      zapier_secret:      row[14] || null,
      fonnte_token:       row[15] ? '***' : null,
      ig_graph_user_id:   row[17] || null,           // col R
      ig_graph_token:     row[18] ? '***' : null,    // col S — sembunyikan nilai asli
    };
  }

  async saveCredentials(agentId, { ig_username, ig_password, wa_number, pa_enabled, zapier_secret, fonnte_token, ig_graph_user_id, ig_graph_token }) {
    const existing = await this._findCredRow(agentId);
    const now      = new Date().toISOString();

    if (existing) {
      const rowIdx = existing.rowIndex;
      const updates = {};

      if (ig_username      !== undefined) updates[2]  = ig_username;
      if (ig_password      !== undefined) updates[3]  = encrypt(ig_password);
      if (wa_number        !== undefined) updates[4]  = wa_number;
      if (pa_enabled       !== undefined) updates[5]  = pa_enabled ? 'TRUE' : 'FALSE';
      if (zapier_secret    !== undefined) updates[14] = zapier_secret;
      if (fonnte_token     !== undefined) updates[15] = fonnte_token;
      if (ig_graph_user_id !== undefined) updates[17] = ig_graph_user_id;  // col R
      if (ig_graph_token   !== undefined) updates[18] = ig_graph_token;    // col S
      updates[9] = now;

      await sheetsService.updateRowCells(SHEETS.PA_CREDENTIALS, rowIdx, updates);
      return { success: true, message: 'Credentials updated' };
    } else {
      const newRow = [
        uuidv4(), agentId,
        ig_username || '', ig_password ? encrypt(ig_password) : '',
        wa_number || '', pa_enabled ? 'TRUE' : 'FALSE',
        '', '', now, now, '', '',
        'not_configured', 'not_configured',
        '',                      // O: Zapier_Secret
        fonnte_token || '',      // P: Fonnte_Token
        '',                      // Q: IG_Session_JSON
        ig_graph_user_id || '',  // R: IG_Graph_User_ID
        ig_graph_token   || '',  // S: IG_Graph_Access_Token
      ];
      await sheetsService.appendRow(SHEETS.PA_CREDENTIALS, newRow);
      return { success: true, message: 'Credentials saved' };
    }
  }

  async getDecryptedCredentials(agentId) {
    const row = await this._findCredRow(agentId);
    if (!row) return null;
    return {
      ig_username:       row.data[2],
      ig_password:       decrypt(row.data[3]),
      wa_number:         row.data[4],
      pa_enabled:        row.data[5] === 'TRUE',
      fonnte_token:      row.data[15] || '',
      ig_graph_user_id:  row.data[17] || '',  // col R
      ig_graph_token:    row.data[18] || '',  // col S
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
  async triggerJob({ agentId, agentNama, type, listingId, listingTitle, videoUrl, recipients, sessionNumber = 1, triggeredBy, messageTemplate }) {
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

    // Dispatch job
    const message = messageTemplate || await this._buildCaption(listingId, listingTitle);

    if (type === 'wa_blast') {
      // Fire-and-forget
      this._runWaBlast(jobId, agentId, recipients, message).catch(err =>
        console.error(`[PA] WA Blast job ${jobId} error:`, err.message)
      );
    } else {
      // IG jobs — eksekusi via instagram-private-api
      this._runIGPost(jobId, agentId, type, videoUrl, message, listingTitle, creds).catch(err =>
        console.error(`[PA] IG job ${jobId} error:`, err.message)
      );
    }

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

  // ════════════════════════════════════════════════════════
  // WA BLAST QUEUE — 4 sesi/hari, jeda 180 menit antar sesi
  // ════════════════════════════════════════════════════════

  /**
   * Terima semua sesi sekaligus, jadwalkan masing-masing.
   * sessions: Array of Array<{nomor, type}> — maks 4 sesi, tiap sesi maks 5 nomor
   */
  async triggerBlastQueue({ agentId, agentNama, listingId, listingTitle, sessions, message, triggeredBy }) {
    const creds = await this.getDecryptedCredentials(agentId);
    if (!creds || !creds.pa_enabled) {
      throw new Error('PA belum dikonfigurasi atau tidak aktif');
    }

    // Cek berapa sesi hari ini yang masih active
    const todayJobs = await this._getTodayBlastJobs(agentId);
    const activeSessions = todayJobs.filter(j => !['expired', 'cancelled'].includes(j[4]));
    const remaining = MAX_SESSIONS_PER_DAY - activeSessions.length;

    if (remaining <= 0) {
      throw new Error(`Batas harian ${MAX_SESSIONS_PER_DAY} sesi sudah tercapai`);
    }

    const toSchedule = sessions.slice(0, remaining);
    const now = new Date();
    const jobIds = [];

    const hasFonnte = !!(creds.fonnte_token);

    for (let i = 0; i < toSchedule.length; i++) {
      const recipients = toSchedule[i];
      if (!recipients || recipients.length === 0) continue;

      const delayMs = i === 0
        ? 5_000
        : i * SESSION_DELAY_MIN * 60 * 1000 + 5_000;

      const scheduledAt = new Date(now.getTime() + delayMs).toISOString();
      const jobId = uuidv4();
      const status = hasFonnte ? 'scheduled' : 'scheduled'; // sama, tapi mode beda

      await sheetsService.appendRow(SHEETS.PA_JOBS, [
        jobId, agentId, agentNama, 'wa_blast', status,
        listingId || '', listingTitle || '', '',
        JSON.stringify(recipients),
        String(i + 1),
        message || '', '',
        now.toISOString(), '', '',
        triggeredBy || agentId,
        scheduledAt,
        hasFonnte ? 'fonnte' : 'manual', // col 17: mode
      ]);

      jobIds.push({ jobId, sessionNumber: i + 1, scheduledAt, mode: hasFonnte ? 'fonnte' : 'manual' });
    }

    this._broadcast(agentId, {
      event:   'blast_queued',
      job_ids: jobIds,
      mode:    hasFonnte ? 'fonnte' : 'manual',
      message: `✅ ${jobIds.length} sesi WA Blast dijadwalkan PA (${hasFonnte ? 'Fully Auto via Fonnte' : 'Semi Manual'})`,
      ts:      now.toISOString(),
    });

    return { success: true, sessions: jobIds, mode: hasFonnte ? 'fonnte' : 'manual' };
  }

  /** Tandai job WA Blast sebagai selesai (dipanggil dari frontend setelah agen kirim semua wa.me) */
  async completeBlastJob(jobId, agentId) {
    await this._updateJobStatus(jobId, 'completed');
    this._broadcast(agentId, {
      event:   'job_done',
      job_id:  jobId,
      type:    'wa_blast',
      message: 'Sesi WA Blast ditandai selesai',
    });
    return { success: true };
  }

  /** Cron tiap menit — cek sesi yang sudah waktunya */
  async _checkScheduledBlasts() {
    try {
      const rows = await sheetsService.getRows(SHEETS.PA_JOBS);
      const now  = new Date();

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        if (row[3] !== 'wa_blast')  continue;
        if (row[4] !== 'scheduled') continue;

        const scheduledAt = row[16] ? new Date(row[16]) : null;
        if (!scheduledAt || scheduledAt > now) continue;

        const jobId      = row[0];
        const agentId    = row[1];
        const recipients = row[8] ? JSON.parse(row[8]) : [];
        const message    = row[10] || '';
        const sessionNum = row[9] || '1';

        // Update status → notified
        await sheetsService.updateRowCells(SHEETS.PA_JOBS, idx + 2, { 4: 'notified' });

        const blastMode = row[17] || 'manual';

        if (blastMode === 'fonnte') {
          // Fonnte: kirim otomatis dari server
          const creds = await this.getDecryptedCredentials(agentId);
          if (creds?.fonnte_token) {
            this._runFontteBlast(jobId, agentId, recipients, message, creds.fonnte_token).catch(console.error);
          } else {
            // Token hilang → fallback ke manual
            this._broadcast(agentId, { event: 'wa_blast_due', job_id: jobId, session_number: parseInt(sessionNum), recipients, message, ts: now.toISOString() });
          }
        } else {
          // Manual: broadcast SSE → trigger frontend buka wa.me
          this._broadcast(agentId, {
            event:          'wa_blast_due',
            job_id:         jobId,
            session_number: parseInt(sessionNum),
            recipients,
            message,
            ts:             now.toISOString(),
          });
        }

        // Push notification ke agent
        try {
          const pushSvc = require('./push.service');
          await pushSvc.sendToUser(agentId, {
            title: `📲 WA Blast Sesi ${sessionNum} Siap`,
            body:  `${recipients.length} nomor menunggu dikirim. Buka CRM sekarang.`,
            data:  { type: 'wa_blast_due', job_id: jobId },
          });
        } catch (_) {}
      }
    } catch (e) {
      console.error('[PA] _checkScheduledBlasts error:', e.message);
    }
  }

  async _getTodayBlastJobs(agentId) {
    const rows  = await sheetsService.getRows(SHEETS.PA_JOBS);
    const today = new Date().toISOString().slice(0, 10);
    return rows.filter(r =>
      r[1] === agentId &&
      r[3] === 'wa_blast' &&
      r[12] && r[12].startsWith(today)
    );
  }

  async _runFontteBlast(jobId, agentId, recipients, message, fontteToken) {
    await this._updateJobStatus(jobId, 'running');
    this._broadcast(agentId, {
      event: 'job_started', job_id: jobId,
      message: `🤖 PA mengirim WA Blast via Fonnte (${recipients.length} nomor)...`,
    });

    const results = [];
    let cumulativeDelay = 0;

    for (let i = 0; i < recipients.length; i++) {
      const { nomor } = recipients[i];
      const num = nomor.replace(/\D/g, '').replace(/^0/, '62');
      // Delay antar nomor: 20–60 detik acak
      const delayThisMsg = i === 0 ? 0 : (20 + Math.floor(Math.random() * 41));
      cumulativeDelay += delayThisMsg;

      try {
        await axios.post('https://api.fonnte.com/send', {
          target:      num,
          message,
          delay:       cumulativeDelay, // Fonnte kirim setelah X detik
          countryCode: '62',
          typing:      true,            // simulasi typing
        }, {
          headers: { Authorization: fontteToken },
          timeout: 10_000,
        });

        results.push({ nomor, status: 'queued' });
        this._broadcast(agentId, {
          event: 'wa_progress', job_id: jobId, nomor,
          status: 'queued',
          message: `⏳ Dijadwalkan ke ${num} (${cumulativeDelay}s)`,
        });
      } catch (e) {
        const errMsg = e.response?.data?.reason || e.message;
        results.push({ nomor, status: 'failed', error: errMsg });
        this._broadcast(agentId, {
          event: 'wa_progress', job_id: jobId, nomor,
          status: 'failed', message: `❌ Gagal ke ${num}: ${errMsg}`,
        });
      }
    }

    const failedCount = results.filter(r => r.status === 'failed').length;
    await this._updateJobStatus(jobId, failedCount === results.length ? 'failed' : 'completed');
    this._broadcast(agentId, {
      event:   'job_done', job_id: jobId, type: 'wa_blast', results,
      message: `✅ Fonnte: ${results.length - failedCount}/${results.length} pesan dijadwalkan`,
    });
  }

  async _runWaBlast(jobId, agentId, recipients, message) {
    const waBlastService = require('./wa-blast.service');

    await this._updateJobStatus(jobId, 'running');
    this._broadcast(agentId, {
      event: 'job_started', job_id: jobId,
      message: `WA Blast dimulai — ${recipients.length} nomor antrian`,
    });

    try {
      const results = await waBlastService.sendBlast(agentId, recipients, message, {
        onProgress: ({ nomor, status, error }) => {
          this._broadcast(agentId, {
            event:   'wa_progress',
            job_id:  jobId,
            nomor, status, error,
            message: status === 'sent'
              ? `✅ Terkirim ke ${nomor}`
              : `❌ Gagal ke ${nomor}: ${error}`,
          });
        },
      });

      const failedCount = results.filter(r => r.status === 'failed').length;
      const finalStatus = failedCount === results.length ? 'failed' : 'completed';
      await this._updateJobStatus(jobId, finalStatus);
      this._broadcast(agentId, {
        event:   'job_done',
        job_id:  jobId, results,
        message: `WA Blast selesai: ${results.length - failedCount}/${results.length} terkirim`,
      });

    } catch (e) {
      await this._updateJobStatus(jobId, 'failed', e.message);
      this._broadcast(agentId, {
        event: 'job_failed', job_id: jobId, message: e.message,
      });
    }
  }

  async _updateJobStatus(jobId, status, errorMsg = '') {
    try {
      const rows   = await sheetsService.getRows(SHEETS.PA_JOBS);
      const rowIdx = rows.findIndex(r => r[0] === jobId);
      if (rowIdx < 0) return;
      const updates = { 4: status };
      if (errorMsg) updates[11] = errorMsg;
      const now = new Date().toISOString();
      if (status === 'running')                        updates[13] = now; // Started_At
      if (status === 'completed' || status === 'failed') updates[14] = now; // Finished_At
      await sheetsService.updateRowCells(SHEETS.PA_JOBS, rowIdx + 2, updates);
    } catch (e) {
      console.error('[PA] _updateJobStatus error:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════
  // IG POST — instagram-private-api
  // ═══════════════════════════════════════════════════

  async _runIGPost(jobId, agentId, type, mediaUrl, caption, listingTitle, creds) {
    const igPostService = require('./ig-post.service');

    await this._updateJobStatus(jobId, 'running');
    this._broadcast(agentId, {
      event:   'job_started',
      job_id:  jobId,
      type,
      message: `PA sedang posting ${_typeLabel(type)} untuk "${listingTitle}"...`,
    });

    try {
      if (!creds.ig_graph_user_id || !creds.ig_graph_token) {
        throw new Error('Instagram User ID / Access Token belum diisi. Buka PA Settings → Instagram → Graph API.');
      }

      const result = await igPostService.post({
        igUserId:    creds.ig_graph_user_id,
        accessToken: creds.ig_graph_token,
        type,
        mediaUrl,
        caption,
      });

      await this._updateJobStatus(jobId, 'completed');
      await this.updateCredStatus(agentId, 'ig', 'active');
      this._broadcast(agentId, {
        event:   'job_done',
        job_id:  jobId,
        type,
        message: `✅ ${_typeLabel(type)} berhasil diposting ke @${result.username}`,
      });
    } catch (e) {
      const igSvc = require('./ig-post.service');
      const { code, message: errMsg } = igSvc.classifyError(e);

      if (code === 'token_expired') {
        await this.updateCredStatus(agentId, 'ig', 'challenge_required'); // pakai status yg ada
      }

      await this._updateJobStatus(jobId, 'failed', errMsg);
      this._broadcast(agentId, {
        event:   'job_failed',
        job_id:  jobId,
        type,
        message: `❌ ${errMsg}`,
      });
    }
  }

  async _getIGSession(agentId) {
    try {
      const row = await this._findCredRow(agentId);
      const val = row?.data?.[16]; // col Q — IG_Session_JSON
      return val || null;
    } catch { return null; }
  }

  async _saveIGSession(agentId, sessionJson) {
    try {
      const row = await this._findCredRow(agentId);
      if (!row) return;
      await sheetsService.updateRowCells(SHEETS.PA_CREDENTIALS, row.rowIndex, {
        16: sessionJson || '',
      });
    } catch (e) {
      console.error('[PA] _saveIGSession error:', e.message);
    }
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

const _paInstance = new PAService();

// Cron: cek scheduled WA Blast tiap menit
cron.schedule('* * * * *', () => _paInstance._checkScheduledBlasts());

module.exports = _paInstance;
