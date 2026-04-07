/**
 * ViGenService — Video Engine Bridge (CRM → my-video-app)
 * ============================================
 * Mengirim payload render ke Python Cloud Run (my-video-app)
 * dan menerima callback saat render selesai.
 *
 * ENDPOINT my-video-app: POST /api/render-crm
 * CALLBACK ke CRM:       POST /api/v1/pa/vigen/callback
 *
 * Media yang diikutkan ke payload:
 *   - photos    : maks 6 foto, diambil dari Cloudinary folder photos/
 *   - video_clips: maks 6 video, diambil dari Cloudinary folder raw/ (tiap maks 50MB)
 *
 * Cloudinary folder structure:
 *   mansion_properti/{listing_id}/photos/   ← input foto
 *   mansion_properti/{listing_id}/raw/      ← input video clips
 *   mansion_properti/{listing_id}/ads/      ← output hasil render
 *
 * Flow:
 *   1. CRM: agen klik "Create Ads Content"
 *   2. CRM: ambil foto + video_clips dari Cloudinary listing folder
 *   3. CRM → my-video-app: POST payload render (photos + video_clips)
 *   4. my-video-app: render + upload ke ads/ folder Cloudinary
 *   5. my-video-app → CRM: POST callback URL video
 *   6. CRM: simpan URL video di VIGEN_JOBS + update LISTING
 */

const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');
const sheetsService      = require('./sheets.service');
const cloudinaryService  = require('./cloudinary.service');
const { SHEETS }         = require('../config/sheets.config');

// Batas media yang dikirim ke my-video-app
const MAX_PHOTOS_TO_ENGINE     = 6;
const MAX_VIDEOCLIPS_TO_ENGINE = 6;   // sesuai batasan upload
const VIDEO_MAX_BYTES          = 50 * 1024 * 1024; // 50MB

class ViGenService {

  /**
   * Trigger render video ke my-video-app.
   * Foto dan video clips diambil langsung dari Cloudinary folder listing.
   *
   * @param {Object} params
   * @param {string} params.listingId
   * @param {string} params.listingType  'secondary' | 'primary'
   * @param {string} params.mood         'minimalis' | 'mewah'
   * @param {number} params.duration     15 | 30 | 60
   * @param {Object} params.listing      Row data dari GSheets LISTING (sebagai objek {key:val})
   * @param {Object} params.agent        Data agen
   */
  async triggerRender({ listingId, listingType, mood, duration, listing, agent }) {
    const jobId = uuidv4();
    const now   = new Date().toISOString();

    // ── Ambil media dari Cloudinary ───────────────────────────
    // Diambil dari folder listing — ini adalah source of truth terbaru
    const [cloudPhotos, cloudVideos] = await Promise.all([
      cloudinaryService.listListingPhotos(listingId),
      cloudinaryService.listListingVideos(listingId),
    ]);

    // Fallback ke GSheets jika Cloudinary belum ada media (listing lama)
    const photos     = _buildPhotoUrls(cloudPhotos, listing);
    const videoClips = _buildVideoUrls(cloudVideos);

    if (photos.length === 0) {
      throw new Error('Tidak ada foto listing. Upload minimal 1 foto sebelum membuat konten iklan.');
    }

    // Log untuk audit
    console.log(`[ViGen] Job ${jobId} | listing ${listingId} | ${photos.length} foto + ${videoClips.length} video clips`);
    if (videoClips.length > 0) {
      const totalMB = videoClips.reduce((sum, v) => sum + (v.size_mb || 0), 0);
      console.log(`[ViGen] Video clips total: ${totalMB.toFixed(1)}MB`);
    }

    // ── Build Payload ─────────────────────────────────────────
    const callbackUrl = `${process.env.APP_URL}/api/v1/pa/vigen/callback`;

    const renderPayload = {
      job_id:       jobId,
      listing_id:   listingId,
      listing_type: listingType,
      mood,
      media: {
        // Kirim URL langsung (Cloudinary secure_url) ke my-video-app
        photos:      photos.slice(0, MAX_PHOTOS_TO_ENGINE),
        video_clips: videoClips.slice(0, MAX_VIDEOCLIPS_TO_ENGINE).map(v => ({
          url:      v.secure_url,
          duration: v.duration || null,    // detik (jika tersedia dari Cloudinary)
          size_mb:  v.size_mb  || null,
        })),
        bgm_preset: mood === 'mewah' ? 'luxury_ambient' : 'minimal_piano',
        has_video_clips: videoClips.length > 0,
      },
      dynamic_text: {
        harga:     listing.Harga_Format    || listing.Harga || '',
        lokasi:    `${listing.Kecamatan || ''}, ${listing.Kota || ''}`.replace(/^, /, ''),
        tipe:      `${listing.Tipe_Properti || ''} · ${listing.Sertifikat || ''}`.trim(),
        agen_nama: agent.Nama || '',
        agen_wa:   agent.No_WA || agent.No_WA_Business || '',
      },
      output: {
        // Output disimpan ke folder ads/ per listing
        cloudinary_folder: `mansion_properti/${listingId}/ads`,
        cloudinary_public_id: `ads_${Date.now()}`,
        resolution:    '1080p',
        aspect_ratio:  '9:16',    // Portrait untuk Reels/Story
        duration_target: duration,
      },
      callback_url:    callbackUrl,
      callback_secret: process.env.VIGEN_CALLBACK_SECRET,
    };

    // ── Simpan job ke GSheets ─────────────────────────────────
    await sheetsService.appendRow(SHEETS.VIGEN_JOBS, [
      jobId,
      listingId,
      listing.Judul || listingId,
      'pending',
      '',                       // Video_URL (belum ada, diisi callback)
      mood,
      String(duration),
      agent.ID || '',
      now,
      '',                       // Finished_At
      '',                       // Error_Msg
      'FALSE',                  // Callback_Received
    ]);

    // ── Kirim ke my-video-app ─────────────────────────────────
    const viGenUrl = process.env.VIGEN_URL;
    if (!viGenUrl) throw new Error('VIGEN_URL tidak dikonfigurasi di environment');

    try {
      const response = await axios.post(`${viGenUrl}/api/render-crm`, renderPayload, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      });

      console.log(`[ViGen] Job ${jobId} diterima oleh my-video-app:`, response.data?.status || 'ok');

      return {
        success:   true,
        job_id:    jobId,
        message:   `Render video dimulai! ${photos.length} foto + ${videoClips.length} video clip akan diproses. Notifikasi muncul saat selesai.`,
        media_count: { photos: photos.length, video_clips: videoClips.length },
      };

    } catch (err) {
      await this._updateJobStatus(jobId, 'failed', null, err.message);
      throw new Error(`ViGen render gagal: ${err.message}`);
    }
  }

  /**
   * Handle callback dari my-video-app saat render selesai.
   * my-video-app sudah upload ke Cloudinary ads/ folder dan mengirim URL-nya.
   */
  async handleCallback({ jobId, videoUrl, listingId, secret, error }) {
    if (secret !== process.env.VIGEN_CALLBACK_SECRET) {
      throw new Error('Invalid callback secret');
    }

    if (error) {
      await this._updateJobStatus(jobId, 'failed', null, error);
      console.error(`[ViGen] Job ${jobId} FAILED:`, error);
      return { success: false };
    }

    await this._updateJobStatus(jobId, 'done', videoUrl, null);

    // Catat URL video ads di LISTING sheet untuk quick access
    if (listingId && videoUrl) {
      await this._updateListingVideoAdsUrl(listingId, videoUrl);
    }

    console.log(`[ViGen] Job ${jobId} DONE. Ads video: ${videoUrl}`);
    return { success: true, video_url: videoUrl };
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
