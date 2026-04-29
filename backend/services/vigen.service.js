/**
 * ViGenService — Video Engine Bridge (CRM → mansion-vidgen)
 * ============================================
 * Flow API mansion-vidgen (FastAPI, session-based):
 *   1. POST /api/login              → dapat Bearer token
 *   2. POST /api/session            → dapat {sid}
 *   3. POST /api/upload/{sid}       → upload tiap foto (multipart)
 *   4. POST /api/render/{sid}       → mulai render
 *   5. GET  /api/status/{sid}       → poll status (via cron)
 *   6. GET  /api/download/{sid}     → download video → upload ke Cloudinary
 *
 * Env vars yang dibutuhkan:
 *   VIGEN_URL       = https://mansion-vidgen-cb5stice7a-et.a.run.app
 *   VIGEN_USERNAME  = username akun di ViGen
 *   VIGEN_PASSWORD  = password akun di ViGen
 */

const axios      = require('axios');
const FormData   = require('form-data');
const { v4: uuidv4 } = require('uuid');
const ffmpeg     = require('fluent-ffmpeg');
const fs         = require('fs');
const os         = require('os');
const path       = require('path');
const sheetsService      = require('./sheets.service');
const cloudinaryService  = require('./cloudinary.service');
const { SHEETS }         = require('../config/sheets.config');

const MAX_PHOTOS_TO_ENGINE     = 6;
const MAX_VIDEOCLIPS_TO_ENGINE = 6;
const VIDEO_MAX_BYTES          = 50 * 1024 * 1024;

const BGM_TRACKS = {
  mewah:     [
    'https://res.cloudinary.com/dqiqatpac/video/upload/v1777441554/bgm_mewah_2_sul3he.mp3',
    'https://res.cloudinary.com/dqiqatpac/video/upload/v1777441553/bgm_mewah_1_l14f6z.mp3',
  ],
  minimalis: [
    'https://res.cloudinary.com/dqiqatpac/video/upload/v1777441553/bgm_minimalis_2_ftwd6s.mp3',
    'https://res.cloudinary.com/dqiqatpac/video/upload/v1777441553/bgm_minimalis_1_eohikb.mp3',
  ],
};
const LOGO_URL = 'https://res.cloudinary.com/dqiqatpac/image/upload/v1777441635/Mansion_Logogram1_Blue_2_z203sl.png';

class ViGenService {

  constructor() {
    this._token       = null;
    this._tokenExpiry = 0;
  }

  // ── Auth token (cached, auto-refresh) ─────────────────────
  async _getToken() {
    if (this._token && Date.now() < this._tokenExpiry) return this._token;

    const url  = process.env.VIGEN_URL;
    const user = process.env.VIGEN_USERNAME;
    const pass = process.env.VIGEN_PASSWORD;
    if (!url || !user || !pass) throw new Error('VIGEN_URL / VIGEN_USERNAME / VIGEN_PASSWORD belum dikonfigurasi');

    const { data } = await axios.post(`${url}/api/login`, { username: user, password: pass }, { timeout: 15000 });
    // ViGen login response: { token: '...' }
    this._token       = data.token || data.access_token;
    this._tokenExpiry = Date.now() + 50 * 60 * 1000; // refresh tiap 50 menit
    return this._token;
  }

  _headers() {
    return { Authorization: `Bearer ${this._token}` };
  }

  /**
   * Trigger render video ke mansion-vidgen.
   */
  async triggerRender({ listingId, listingType, mood, duration, listing, agent }) {
    const jobId = uuidv4();
    const now   = new Date().toISOString();

    // ── Ambil media dari Cloudinary ──────────────────────────
    const [cloudPhotos, cloudVideos] = await Promise.all([
      cloudinaryService.listListingPhotos(listingId),
      cloudinaryService.listListingVideos(listingId),
    ]);
    const photos     = _buildPhotoUrls(cloudPhotos, listing);
    const videoClips = _buildVideoUrls(cloudVideos);

    if (photos.length === 0) {
      throw new Error('Tidak ada foto listing. Upload minimal 1 foto sebelum membuat konten iklan.');
    }

    // ── Simpan job ke GSheets (status: pending) ───────────────
    await sheetsService.appendRow(SHEETS.VIGEN_JOBS, [
      jobId, listingId, listing.Judul || listingId,
      'pending', '', mood, String(duration), agent.ID || '',
      now, '', '', 'FALSE',
    ]);

    // ── Jalankan render async (fire-and-forget) ───────────────
    this._executeRender({
      jobId, listingId, listingType, mood, duration, listing, agent, photos, videoClips,
    }).catch(err => console.error(`[ViGen] Job ${jobId} error:`, err.message));

    return {
      success:     true,
      job_id:      jobId,
      message:     `Render video dimulai! ${photos.length} foto akan diproses. Pantau status di Riwayat Render.`,
      media_count: { photos: photos.length, video_clips: videoClips.length },
    };
  }

  async _executeRender({ jobId, listingId, listingType, mood, duration, listing, agent, photos, videoClips }) {
    const url = process.env.VIGEN_URL;
    try {
      await this._updateJobStatus(jobId, 'rendering');

      // 1. Login → dapat token
      await this._getToken();

      // 2. Buat session
      const { data: sess } = await axios.post(`${url}/api/session`, {}, {
        headers: this._headers(), timeout: 15000,
      });
      const sid = sess.sid;
      if (!sid) throw new Error('ViGen tidak mengembalikan session ID');

      // Simpan sid agar bisa di-poll
      await this._updateJobSid(jobId, sid);

      // 3. Upload foto (download dari Cloudinary → upload ke ViGen)
      const photoPaths = [];
      for (const photoUrl of photos.slice(0, MAX_PHOTOS_TO_ENGINE)) {
        try {
          const imgRes = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 30000 });
          const fd     = new FormData();
          const photoIdx = photoPaths.length + 1;
          fd.append('file', Buffer.from(imgRes.data), { filename: `photo_${photoIdx}.jpg`, contentType: 'image/jpeg' });
          fd.append('file_type', 'photo');
          const { data: up } = await axios.post(`${url}/api/upload/${sid}`, fd, {
            headers: { ...this._headers(), ...fd.getHeaders() }, timeout: 30000,
          });
          if (up.path) photoPaths.push(up.path);
        } catch (e) {
          console.warn(`[ViGen] Upload foto gagal (${photoUrl}):`, e.message);
        }
      }

      if (photoPaths.length === 0) throw new Error('Tidak ada foto berhasil diupload ke ViGen');
      console.log(`[ViGen] Upload selesai: ${photoPaths.length} foto berhasil →`, JSON.stringify(photoPaths));

      // 4. Upload BGM — random track + random start trim
      let bgmPath = null;
      try {
        const tracks  = BGM_TRACKS[mood] || BGM_TRACKS.mewah;
        const bgmUrl  = tracks[Math.floor(Math.random() * tracks.length)];
        const bgmRes  = await axios.get(bgmUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const trimmed = await this._trimBgm(Buffer.from(bgmRes.data), duration, sid);
        const bgmFd   = new FormData();
        bgmFd.append('file', trimmed, { filename: 'bgm.mp3', contentType: 'audio/mpeg' });
        bgmFd.append('file_type', 'bgm');
        const { data: bgmUp } = await axios.post(`${url}/api/upload/${sid}`, bgmFd, {
          headers: { ...this._headers(), ...bgmFd.getHeaders() }, timeout: 30000,
        });
        bgmPath = bgmUp.path || null;
        console.log(`[ViGen] BGM uploaded: ${bgmPath}`);
      } catch (e) {
        console.warn('[ViGen] BGM upload gagal (render tetap lanjut):', e.message);
      }

      // 5. Upload Logo
      let logoPath = null;
      try {
        const logoRes = await axios.get(LOGO_URL, { responseType: 'arraybuffer', timeout: 15000 });
        const logoFd  = new FormData();
        logoFd.append('file', Buffer.from(logoRes.data), { filename: 'logo.png', contentType: 'image/png' });
        logoFd.append('file_type', 'logo');
        const { data: logoUp } = await axios.post(`${url}/api/upload/${sid}`, logoFd, {
          headers: { ...this._headers(), ...logoFd.getHeaders() }, timeout: 15000,
        });
        logoPath = logoUp.path || null;
        console.log(`[ViGen] Logo uploaded: ${logoPath}`);
      } catch (e) {
        console.warn('[ViGen] Logo upload gagal (render tetap lanjut):', e.message);
      }

      // 6. Mulai render
      // n_captions = jumlah foto yang dipakai ViGen.
      // description dibagi N baris \n (1 baris per foto) agar tiap foto caption berbeda.
      // Kalau foto < 3, gabungkan sisa info ke baris terakhir.
      const tipeProperti = (listing.Tipe_Properti || '').toUpperCase();
      const tipeListing  = (listingType === 'primary' ? 'PRIMARY' : (listing.Status_Transaksi || 'JUAL')).toUpperCase();
      // Compact price: "Rp 1.4 M" → "1.4M"  |  "Rp 500 Jt" → "500Jt"
      const hargaRaw     = listing.Harga_Format || listing.Harga || '';
      const hargaCompact = hargaRaw.replace(/^Rp\s*/i, '').replace(/\s+/g, '');
      const area         = [listing.Kecamatan, listing.Kota].filter(Boolean).join(' ');

      // 3 info pieces — 1 per foto
      const infoLines = [`${tipeProperti} ${tipeListing}`, hargaCompact, area].filter(Boolean);
      const nCaptions = Math.min(photoPaths.length, infoLines.length);

      // Gabungkan sisa baris ke baris terakhir jika foto < info
      const captionLines = nCaptions < infoLines.length
        ? [...infoLines.slice(0, nCaptions - 1), infoLines.slice(nCaptions - 1).join(' ')]
        : infoLines.slice(0, nCaptions);

      const description = captionLines.join('\n');

      await axios.post(`${url}/api/render/${sid}`, {
        sid,
        photo_paths:     photoPaths,
        clip_paths:      [],
        duration_target: duration,
        resolution:      '720p  (720×1280) Best',
        cta_label:       'Hubungi :',
        cta_nama:        agent.Nama || '',
        cta_wa:          agent.No_WA || agent.No_WA_Business || '',
        description,
        n_captions:      nCaptions,
        caption_align:   'Left',
        ...(bgmPath  ? { bgm_path: bgmPath, bgm_volume: 0.4 } : {}),
        ...(logoPath ? { logo_path: logoPath }                : {}),
      }, { headers: this._headers(), timeout: 30000 });

      console.log(`[ViGen] Job ${jobId} render dimulai sid=${sid} n_captions=${nCaptions} desc="${description.replace(/\n/g,'|')}"`);
      // Status akan di-update oleh cron _pollPendingJobs

    } catch (err) {
      await this._updateJobStatus(jobId, 'failed', null, err.message);
      console.error(`[ViGen] Job ${jobId} _executeRender gagal:`, err.message);
    }
  }

  /**
   * Ambil status satu job render.
   */
  async getJobStatus(jobId) {
    const rows = await sheetsService.getRows(SHEETS.VIGEN_JOBS);
    const row  = rows.find(r => r[0] === jobId);
    if (!row) return null;

    return {
      id:          row[0],
      listing_id:  row[1],
      status:      row[3],   // pending|rendering|done|failed
      video_url:   row[4],
      mood:        row[5],
      duration:    row[6],
      created_at:  row[8],
      finished_at: row[9],
      error:       row[10],
    };
  }

  /**
   * Ambil semua render jobs milik satu listing (terbaru dulu).
   */
  async getJobsByListing(listingId) {
    const rows = await sheetsService.getRows(SHEETS.VIGEN_JOBS);
    return rows
      .filter(r => r[1] === listingId)
      .map(r => ({
        id:          r[0],
        status:      r[3],
        video_url:   r[4],
        mood:        r[5],
        duration:    r[6],
        created_at:  r[8],
        finished_at: r[9],
      }))
      .reverse();
  }

  /**
   * Ambil info media listing dari Cloudinary (untuk tampilkan di form render).
   * Ini yang ditampilkan di modal "Create Ads Content" sebelum agen klik render.
   */
  async getListingMedia(listingId) {
    return cloudinaryService.listAllListingMedia(listingId);
  }

  // ── Polling cron (dipanggil dari server.js tiap 30 detik) ──

  async pollPendingJobs() {
    const url = process.env.VIGEN_URL;
    if (!url) return;
    try {
      const rows = await sheetsService.getRows(SHEETS.VIGEN_JOBS);
      const rendering = rows.filter(r => r[3] === 'rendering' && r[12]); // col M = sid
      if (rendering.length === 0) return;

      await this._getToken();

      for (const row of rendering) {
        const jobId = row[0];
        const sid   = row[12];
        try {
          const { data } = await axios.get(`${url}/api/status/${sid}`, {
            headers: this._headers(), timeout: 10000,
          });

          const st = (data.status || '').toLowerCase();
          if (st === 'done' || st === 'completed' || st === 'finished') {
            // Download video → upload ke Cloudinary
            const videoResp = await axios.get(`${url}/api/download/${sid}`, {
              headers: this._headers(), responseType: 'arraybuffer', timeout: 120000,
            });
            const listingId = row[1];
            const videoUrl  = await cloudinaryService.uploadVideoBuffer(
              Buffer.from(videoResp.data),
              listingId,
              `ads_${jobId}`
            );
            await this._updateJobStatus(jobId, 'done', videoUrl, null);
            if (listingId && videoUrl) await this._updateListingVideoAdsUrl(listingId, videoUrl);
            console.log(`[ViGen] Job ${jobId} DONE → ${videoUrl}`);
          } else if (st === 'failed' || st === 'error') {
            await this._updateJobStatus(jobId, 'failed', null, data.error || 'Render gagal di ViGen');
          }
          // status 'rendering'/'processing' → biarkan, poll lagi berikutnya
        } catch (e) {
          console.warn(`[ViGen] poll job ${jobId} error:`, e.message);
        }
      }
    } catch (e) {
      console.error('[ViGen] pollPendingJobs error:', e.message);
    }
  }

  /**
   * Trim BGM: random start (skip 10s intro, max 90s), durasi = video + 2s, fade in/out 1.5s.
   * Input: raw MP3 buffer. Output: trimmed MP3 buffer.
   */
  _trimBgm(inputBuffer, videoDuration, sid) {
    return new Promise((resolve, reject) => {
      const tmpIn  = path.join(os.tmpdir(), `bgm_in_${sid}.mp3`);
      const tmpOut = path.join(os.tmpdir(), `bgm_out_${sid}.mp3`);
      fs.writeFileSync(tmpIn, inputBuffer);

      // Random start: 10s–90s (skip intro, hindari akhir track)
      const startSec   = 10 + Math.floor(Math.random() * 80);
      const trimDur    = videoDuration + 2;
      const fadeOutAt  = trimDur - 1.5;

      ffmpeg(tmpIn)
        .setStartTime(startSec)
        .setDuration(trimDur)
        .audioFilters(`afade=t=in:ss=0:d=1.5,afade=t=out:st=${fadeOutAt}:d=1.5`)
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .output(tmpOut)
        .on('end', () => {
          try {
            const buf = fs.readFileSync(tmpOut);
            resolve(buf);
          } finally {
            fs.unlink(tmpIn,  () => {});
            fs.unlink(tmpOut, () => {});
          }
        })
        .on('error', (err) => {
          fs.unlink(tmpIn,  () => {});
          fs.unlink(tmpOut, () => {});
          reject(err);
        })
        .run();
    });
  }

  async _updateJobSid(jobId, sid) {
    const rows = await sheetsService.getRows(SHEETS.VIGEN_JOBS);
    const idx  = rows.findIndex(r => r[0] === jobId);
    if (idx < 0) return;
    await sheetsService.updateRowCells(SHEETS.VIGEN_JOBS, idx + 2, { 12: sid }); // col M
  }

  // ── Private Helpers ───────────────────────────────────────

  async _updateJobStatus(jobId, status, videoUrl, error) {
    const rows = await sheetsService.getRows(SHEETS.VIGEN_JOBS);
    const idx  = rows.findIndex(r => r[0] === jobId);
    if (idx < 0) return;

    const now     = new Date().toISOString();
    const updates = {
      3:  status,   // Status
      9:  now,      // Finished_At
      11: 'TRUE',   // Callback_Received
    };
    if (videoUrl) updates[4]  = videoUrl;
    if (error)    updates[10] = error;

    await sheetsService.updateRowCells(SHEETS.VIGEN_JOBS, idx + 2, updates);
  }

  /**
   * Simpan URL video hasil render di LISTING sheet.
   * Disimpan di kolom Notes (idx 40) dengan prefix [VIDEO_ADS].
   * Bisa dipindah ke kolom tersendiri jika schema di-extend.
   */
  async _updateListingVideoAdsUrl(listingId, videoUrl) {
    try {
      const rows = await sheetsService.getRows(SHEETS.LISTING);
      const idx  = rows.findIndex(r => r[0] === listingId);
      if (idx < 0) return;

      const existingNotes = rows[idx][40] || '';  // kolom AO = Notes
      const tag  = '[VIDEO_ADS]';
      const line = `${tag} ${videoUrl}`;

      // Replace baris lama atau tambah baru
      const newNotes = existingNotes.includes(tag)
        ? existingNotes.replace(new RegExp(`\\[VIDEO_ADS\\].*(\n|$)`), line + '\n')
        : (existingNotes ? existingNotes + '\n' : '') + line;

      await sheetsService.updateRowCells(SHEETS.LISTING, idx + 2, { 40: newNotes.trim() });
    } catch (e) {
      console.warn('[ViGen] Gagal update LISTING video URL:', e.message);
    }
  }
}

// ── Module-level Helpers ────────────────────────────────────

/**
 * Susun daftar URL foto untuk dikirim ke my-video-app.
 *
 * GABUNG dua sumber (bukan pilih salah satu):
 *   1. GSheets CRM columns  → foto yang sudah ada di listing (max 3)
 *   2. Cloudinary photos/   → foto extra yang diupload via modal ViGen (max 3)
 *
 * Total max MAX_PHOTOS_TO_ENGINE (6). GSheets diutamakan (urutan pertama).
 * Deduplikasi URL agar tidak ada foto ganda.
 */
function _buildPhotoUrls(cloudPhotos, listing) {
  // Sumber 1: foto dari GSheets CRM (selalu diambil)
  const gSheetsUrls = [];
  if (listing.Foto_Utama_URL) gSheetsUrls.push(listing.Foto_Utama_URL);
  if (listing.Foto_2_URL)     gSheetsUrls.push(listing.Foto_2_URL);
  if (listing.Foto_3_URL)     gSheetsUrls.push(listing.Foto_3_URL);
  if (listing.Foto_Gallery) {
    try {
      const gallery = JSON.parse(listing.Foto_Gallery);
      gSheetsUrls.push(...(Array.isArray(gallery) ? gallery : []));
    } catch {}
  }

  // Sumber 2: foto extra dari Cloudinary photos/ folder (upload via modal ViGen)
  const cloudUrls = cloudPhotos
    .map(p => p.secure_url)
    .filter(Boolean);

  // Gabung, deduplikasi, max 6
  const seen    = new Set();
  const combined = [];
  for (const url of [...gSheetsUrls, ...cloudUrls]) {
    if (url && !seen.has(url) && combined.length < MAX_PHOTOS_TO_ENGINE) {
      seen.add(url);
      combined.push(url);
    }
  }
  return combined;
}

/**
 * Susun daftar video clip untuk dikirim ke my-video-app.
 * Hanya ambil dari Cloudinary folder raw/.
 */
function _buildVideoUrls(cloudVideos) {
  return cloudVideos
    .filter(v => {
      if (v.bytes && v.bytes > _VIDEO_MAX_BYTES) {
        console.warn(`[ViGen] Video ${v.public_id} dilewati: ${(v.bytes/1024/1024).toFixed(1)}MB > 50MB`);
        return false;
      }
      return true;
    })
    .slice(0, MAX_VIDEOCLIPS_TO_ENGINE);
}

const _VIDEO_MAX_BYTES = 50 * 1024 * 1024;

module.exports = new ViGenService();
