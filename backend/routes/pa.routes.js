/**
 * PA Routes — Personal Assistant & ViGen
 * ============================================
 * BASE: /api/v1/pa
 * BASE: /api/v1/vigen
 *
 * PA Endpoints:
 *   GET  /pa/credentials              → ambil kredensial PA milik agen
 *   POST /pa/credentials              → simpan/update kredensial PA
 *   POST /pa/trigger                  → trigger job ke OpenClaw
 *   GET  /pa/jobs                     → history job PA agen
 *   GET  /pa/logs/stream              → SSE stream activity logs real-time
 *   POST /pa/callback                 → callback dari OpenClaw (internal)
 *   POST /pa/qr-required              → notif QR WA (internal dari OpenClaw)
 *   GET  /pa/report/team              → laporan tim (BM/Principal/Kantor)
 *
 * ViGen Endpoints:
 *   POST /vigen/render                → trigger render video
 *   POST /vigen/callback              → callback dari my-video-app (internal)
 *   GET  /vigen/jobs/:listingId       → list jobs per listing
 *   GET  /vigen/status/:jobId         → status satu job
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware: authenticate, requireRole, requireMinRole } = require('../middleware/auth.middleware');
const paService    = require('../services/pa.service');
const vigenService = require('../services/vigen.service');
const sheetsService = require('../services/sheets.service');
const { SHEETS, ROLE_LEVEL } = require('../config/sheets.config');

// ── Internal Secret Middleware (untuk callback dari OpenClaw / ViGen) ───
function internalAuth(req, res, next) {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// ════════════════════════════════════════════════════════
// PA CREDENTIALS
// ════════════════════════════════════════════════════════

// GET /pa/credentials — ambil kredensial agen yang sedang login
router.get('/credentials', authenticate, async (req, res) => {
  try {
    const creds = await paService.getCredentials(req.user.id);
    res.json({ success: true, data: creds });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /pa/credentials — simpan/update kredensial
router.post('/credentials', authenticate, async (req, res) => {
  try {
    const { ig_username, ig_password, wa_number, pa_enabled, fonnte_token } = req.body;
    const result = await paService.saveCredentials(req.user.id, {
      ig_username, ig_password, wa_number, pa_enabled, fonnte_token
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /pa/zapier-secret/generate — generate/regenerate Zapier Secret per agen
router.post('/zapier-secret/generate', authenticate, async (req, res) => {
  try {
    const secret = await paService.generateZapierSecret(req.user.id);
    res.json({ success: true, zapier_secret: secret });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ════════════════════════════════════════════════════════
// PA WA SESSION (whatsapp-web.js)
// ════════════════════════════════════════════════════════

const waBlastService = require('../services/wa-blast.service');
const axios          = require('axios');

// GET /pa/wa/qr — inisialisasi WA client & kembalikan QR code
router.get('/wa/qr', authenticate, async (req, res) => {
  try {
    const result = await waBlastService.getQR(req.user.id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /pa/wa/status — cek status WA session
router.get('/wa/status', authenticate, (req, res) => {
  const status = waBlastService.getStatus(req.user.id);
  res.json({ success: true, status });
});

// POST /pa/wa/pair — minta pairing code (untuk pengguna HP)
router.post('/wa/pair', authenticate, async (req, res) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ success: false, message: 'phone_number wajib diisi' });
    const result = await waBlastService.requestPairingCode(req.user.id, phone_number);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /pa/wa/session — logout WA session
router.delete('/wa/session', authenticate, async (req, res) => {
  try {
    await waBlastService.logout(req.user.id);
    res.json({ success: true, message: 'WA session logout' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/wa/groups', authenticate, async (req, res) => {
  try {
    // Fonnte mode: ambil grup dari device yang sudah terpasang di Fonnte
    const creds = await paService.getDecryptedCredentials(req.user.id);
    if (creds?.fonnte_token) {
      const fRes = await axios.post('https://api.fonnte.com/get-whatsapp-group', {}, {
        headers: { Authorization: creds.fonnte_token },
        timeout: 15_000,
      });
      const raw = fRes.data?.data || fRes.data?.group || [];
      const groups = (Array.isArray(raw) ? raw : Object.values(raw)).map(g => ({
        id:           g.id || g.groupId || '',
        name:         g.name || g.subject || g.id || '',
        participants: g.participant_count || g.participants || 0,
      })).filter(g => g.id).sort((a, b) => a.name.localeCompare(b.name, 'id'));
      return res.json({ success: true, data: groups, mode: 'fonnte' });
    }
    // Baileys mode
    const groups = await waBlastService.getGroups(req.user.id);
    res.json({ success: true, data: groups, mode: 'baileys' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// ════════════════════════════════════════════════════════
// PA JOBS
// ════════════════════════════════════════════════════════

// POST /pa/trigger — trigger job baru
router.post('/trigger', authenticate, async (req, res) => {
  try {
    const { type, listing_id, video_url, recipients, session_number, message_template, sessions } = req.body;

    if (!type || !['ig_reels', 'ig_story', 'wa_blast'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type harus: ig_reels|ig_story|wa_blast' });
    }

    // Ambil judul + foto listing (secondary) atau project (primary)
    let listingTitle  = listing_id || '';
    let autoMediaUrl  = video_url  || '';

    if (listing_id) {
      // Coba LISTING sheet dulu
      const listings = await sheetsService.getRows(SHEETS.LISTING);
      const listing  = listings.find(r => r[0] === listing_id);
      if (listing) {
        listingTitle = listing[6] || listing_id;                          // col G = Judul
        if (!autoMediaUrl) autoMediaUrl = listing[24] || listing[25] || ''; // col Y/Z = Foto_Utama_URL / Foto_2_URL
      } else {
        // Coba PROJECTS sheet (primary)
        const projects = await sheetsService.getRows(SHEETS.PROJECTS);
        const project  = projects.find(r => r[0] === listing_id);
        if (project) {
          listingTitle = project[3] || listing_id;                      // col D = Nama_Proyek
          if (!autoMediaUrl) autoMediaUrl = project[10] || project[11] || ''; // col K/L = Foto_1_URL / Foto_2_URL
        }
      }
    }

    // ── WA Blast: queue system ────────────────────────────
    if (type === 'wa_blast') {
      const sessionList = sessions || (recipients ? [recipients] : []);
      if (sessionList.length === 0 || sessionList.every(s => !s || s.length === 0)) {
        return res.status(400).json({ success: false, message: 'sessions wajib untuk WA Blast' });
      }

      // Resolve contact_id → nomor asli dari WA_CONTACTS sheet
      const { crypto, SHEETS: SH } = { crypto: require('crypto'), SHEETS };
      const ENC_KEY = Buffer.from(process.env.PA_ENCRYPTION_KEY || '', 'hex');
      function decryptNum(ct) {
        if (!ct || !ct.includes(':')) return '';
        try {
          const [ivH, tagH, encH] = ct.split(':');
          const dec = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivH,'hex'));
          dec.setAuthTag(Buffer.from(tagH,'hex'));
          return dec.update(Buffer.from(encH,'hex')) + dec.final('utf8');
        } catch { return ''; }
      }

      const waRows = await sheetsService.getRows(SHEETS.WA_CONTACTS);
      const waMap  = {};
      waRows.filter(r => r[1] === req.user.id).forEach(r => {
        // r[0]=ID, r[3]=Nomor_Enc, r[4]=Tipe, r[5]=JID_Enc
        waMap[r[0]] = {
          nomor: r[4] === 'group' ? decryptNum(r[5]) : decryptNum(r[3]),
          type:  r[4] || 'personal',
        };
      });

      const resolvedSessions = sessionList.map(sess =>
        (sess || []).map(rec => {
          if (rec.contact_id && waMap[rec.contact_id]) {
            return { nomor: waMap[rec.contact_id].nomor, type: waMap[rec.contact_id].type };
          }
          // Fallback: nomor manual (angka saja)
          const num = (rec.nomor || '').replace(/\D/g, '').replace(/^0/, '62');
          return { nomor: num, type: rec.type || 'personal' };
        }).filter(r => r.nomor && r.nomor.length >= 10)
      ).filter(s => s.length > 0);

      if (resolvedSessions.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada nomor valid. Pastikan Buku Kontak sudah terisi.' });
      }

      const result = await paService.triggerBlastQueue({
        agentId:      req.user.id,
        agentNama:    req.user.nama,
        listingId:    listing_id,
        listingTitle,
        sessions:     resolvedSessions,
        message:      message_template || '',
        triggeredBy:  req.user.id,
      });
      return res.json(result);
    }

    // ── IG Jobs ───────────────────────────────────────────
    if (!autoMediaUrl) {
      return res.status(400).json({ success: false, message: 'Media tidak tersedia. Upload foto/video atau pastikan listing memiliki foto.' });
    }

    const result = await paService.triggerJob({
      agentId:         req.user.id,
      agentNama:       req.user.nama,
      type,
      listingId:       listing_id,
      listingTitle,
      videoUrl:        autoMediaUrl,
      recipients,
      sessionNumber:   session_number || 1,
      triggeredBy:     req.user.id,
      messageTemplate: message_template || null,
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// POST /pa/jobs/:jobId/complete — agen konfirmasi sesi WA Blast sudah dikirim
router.post('/jobs/:jobId/complete', authenticate, async (req, res) => {
  try {
    const result = await paService.completeBlastJob(req.params.jobId, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /pa/jobs — history job agen (atau semua jika admin)
router.get('/jobs', authenticate, async (req, res) => {
  try {
    const agentId = req.query.agent_id || req.user.id;

    // Hanya principal/kantor/superadmin bisa lihat job agen lain
    const userLevel = ROLE_LEVEL[req.user.role] || 0;
    if (agentId !== req.user.id && userLevel < 4) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const jobs = await paService.getJobHistory(agentId, parseInt(req.query.limit) || 20);
    res.json({ success: true, data: jobs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ════════════════════════════════════════════════════════
// PA ACTIVITY LOGS — SSE Real-time
// ════════════════════════════════════════════════════════

// GET /pa/logs/stream — SSE stream untuk agent
router.get('/logs/stream', authenticate, (req, res) => {
  // Setup SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: disable buffering

  // Kirim event connected
  res.write(`data: ${JSON.stringify({ event: 'connected', agent_id: req.user.id, ts: new Date().toISOString() })}\n\n`);

  paService.addSSEClient(req.user.id, res);

  // Heartbeat setiap 25 detik (hindari timeout proxy)
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    paService.removeSSEClient(req.user.id, res);
  });
});

// ════════════════════════════════════════════════════════
// INTERNAL CALLBACKS (dari OpenClaw)
// ════════════════════════════════════════════════════════

// POST /pa/callback — callback job selesai/gagal dari OpenClaw
router.post('/callback', internalAuth, async (req, res) => {
  try {
    await paService.handleCallback(req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('[PA Callback]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /pa/qr-required — notif QR WA dibutuhkan
router.post('/qr-required', internalAuth, async (req, res) => {
  try {
    await paService.handleQRRequired(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ════════════════════════════════════════════════════════
// REPORTING (BM / Principal / Kantor)
// ════════════════════════════════════════════════════════

// GET /pa/report/team — laporan kinerja PA seluruh tim
router.get('/report/team', authenticate, async (req, res) => {
  try {
    const userLevel = ROLE_LEVEL[req.user.role] || 0;
    if (userLevel < 3) { // Minimal BM
      return res.status(403).json({ success: false, message: 'Akses ditolak. Minimal Business Manager.' });
    }

    const report = await paService.getTeamReport(req.user.role, req.user.id);
    res.json({ success: true, data: report });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ════════════════════════════════════════════════════════
// VIGEN ROUTES
// ════════════════════════════════════════════════════════

const cloudinaryService = require('../services/cloudinary.service');

// GET /vigen/media/:listingId — preview media listing sebelum render
// Dipakai oleh modal "Create Ads Content" untuk tampilkan foto & video tersedia
router.get('/vigen/media/:listingId', authenticate, async (req, res) => {
  try {
    const media = await vigenService.getListingMedia(req.params.listingId);
    res.json({ success: true, data: media });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /vigen/render — trigger render video (agen klik "Create Ads Content")
router.post('/vigen/render', authenticate, async (req, res) => {
  try {
    const { listing_id, listing_type, mood, duration } = req.body;

    if (!listing_id) return res.status(400).json({ success: false, message: 'listing_id wajib' });

    const validMoods     = ['minimalis', 'mewah'];
    const validDurations = [15, 30, 60];

    if (mood && !validMoods.includes(mood)) {
      return res.status(400).json({ success: false, message: `mood harus: ${validMoods.join('|')}` });
    }
    if (duration && !validDurations.includes(Number(duration))) {
      return res.status(400).json({ success: false, message: `duration harus: ${validDurations.join('|')} detik` });
    }

    // Ambil data listing / proyek dari GSheets
    const { COLUMNS } = require('../config/sheets.config');
    const isPrimary = listing_type === 'primary';
    let listing = {};

    if (isPrimary) {
      // Primary: ambil dari sheet PROJECTS
      const projects   = await sheetsService.getRows(SHEETS.PROJECTS);
      const projectRow = projects.find(r => r[0] === listing_id);
      if (!projectRow) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
      COLUMNS.PROJECTS.forEach((col, i) => { listing[col] = projectRow[i] || ''; });
      // Normalisasi field ViGen agar kompatibel dengan vigenService (pakai nama field LISTING)
      listing.Judul          = listing.Nama_Proyek   || '';
      listing.Harga_Format   = listing.Harga_Format  || listing.Harga_Mulai || '';
      listing.Harga          = listing.Harga_Mulai   || '';
      listing.Kota           = '';  // PROJECTS belum punya Kota
      listing.Kecamatan      = '';
      listing.Tipe_Properti  = listing.Tipe_Properti || '';
      listing.Sertifikat     = '';
      listing.Foto_Utama_URL = listing.Foto_1_URL    || '';
      listing.Foto_2_URL     = listing.Foto_2_URL    || '';
      listing.Foto_3_URL     = listing.Foto_3_URL    || '';
      listing.Foto_4_URL     = listing.Foto_4_URL    || '';
    } else {
      // Secondary: ambil dari sheet LISTING
      const listings   = await sheetsService.getRows(SHEETS.LISTING);
      const listingRow = listings.find(r => r[0] === listing_id);
      if (!listingRow) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });
      COLUMNS.LISTING.forEach((col, i) => { listing[col] = listingRow[i] || ''; });
    }

    // Ambil data agen
    const agents   = await sheetsService.getRows(SHEETS.AGENTS);
    const agentRow = agents.find(r => r[0] === req.user.id);
    const agent    = agentRow
      ? { ID: agentRow[0], Nama: agentRow[1], No_WA: agentRow[4], No_WA_Business: agentRow[16] }
      : { ID: req.user.id, Nama: req.user.nama };

    const result = await vigenService.triggerRender({
      listingId:   listing_id,
      listingType: listing_type || 'secondary',
      mood:        mood || 'mewah',
      duration:    Number(duration) || 30,
      listing,
      agent,
    });

    res.json(result);
  } catch (e) {
    // Pesan error khusus ditampilkan langsung ke user
    const status = e.message.includes('Tidak ada foto') ? 422 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
});

// POST /vigen/callback — callback dari my-video-app
router.post('/vigen/callback', async (req, res) => {
  try {
    const result = await vigenService.handleCallback(req.body);
    res.json(result);
  } catch (e) {
    console.error('[ViGen Callback]', e.message);
    res.status(e.message.includes('secret') ? 401 : 500).json({ success: false, message: e.message });
  }
});

// GET /vigen/jobs/:listingId — list render jobs suatu listing
router.get('/vigen/jobs/:listingId', authenticate, async (req, res) => {
  try {
    const jobs = await vigenService.getJobsByListing(req.params.listingId);
    res.json({ success: true, data: jobs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /vigen/status/:jobId — status satu job
router.get('/vigen/status/:jobId', authenticate, async (req, res) => {
  try {
    const job = await vigenService.getJobStatus(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job tidak ditemukan' });
    res.json({ success: true, data: job });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
