/**
 * Media Routes — Upload Foto & Video Listing
 * ============================================
 * Cloudinary folder structure per Listing ID:
 *   mansion_properti/{listing_id}/photos/  ← foto (max 20, 10MB/file)
 *   mansion_properti/{listing_id}/raw/     ← video clips (max 6, output ≤50MB)
 *   mansion_properti/{listing_id}/ads/     ← hasil render ViGen (by callback)
 *
 * Batasan Upload Video:
 *   - > 100MB  → TOLAK langsung (HTTP 413)
 *   - 50–100MB → auto-compress ke ≤50MB (two-pass H.264)
 *   - ≤ 50MB   → upload langsung, tanpa kompresi
 *
 * ENDPOINTS:
 *   POST /upload/photos/:listingId   → upload foto (max 20, 10MB/file)
 *   POST /upload/videos/:listingId   → upload video clips (max 6, auto-compress)
 *   GET  /listing/:listingId         → list semua media per listing
 *   GET  /listing/:listingId/info    → info slots tersisa (sebelum upload)
 *   DELETE /:publicId                → hapus satu media (foto atau video)
 *   POST /upload                     → legacy (backward compat)
 */

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const cloudinaryService  = require('../services/cloudinary.service');
const videoCompressService = require('../services/videoCompress.service');
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

// ── Batas ──────────────────────────────────────────────────
const PHOTO_MAX_BYTES  = 10  * 1024 * 1024;   // 10 MB
const VIDEO_RAW_MAX    = 100 * 1024 * 1024;   // 100 MB — batas raw upload (sebelum compress)
const VIDEO_TARGET_MAX = 50  * 1024 * 1024;   // 50 MB  — batas setelah compress
const MAX_PHOTOS       = 20;
const MAX_VIDEO_CLIPS  = 6;

const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-matroska', 'video/x-msvideo'];
const ALLOWED_VIDEO_EXTS  = ['.mp4', '.mov', '.avi', '.mkv'];

// ── Multer Config ──────────────────────────────────────────

// Foto: max 10MB, max 20 file
const photoUpload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: PHOTO_MAX_BYTES, files: MAX_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PHOTO_MIMES.includes(file.mimetype)) {
      return cb(new Error(`Format foto tidak didukung: ${file.mimetype}. Gunakan jpg, png, webp.`));
    }
    cb(null, true);
  },
});

// Video: multer menerima sampai 100MB (batas raw).
// Kompresi dilakukan di handler jika file 50-100MB.
// File > 100MB ditolak oleh multer (LIMIT_FILE_SIZE).
const videoUpload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: VIDEO_RAW_MAX, files: MAX_VIDEO_CLIPS },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_VIDEO_MIMES.includes(file.mimetype) && !ALLOWED_VIDEO_EXTS.includes(ext)) {
      return cb(new Error(`Format video tidak didukung. Gunakan: mp4, mov, avi, mkv.`));
    }
    cb(null, true);
  },
});

// ── Multer Error Handler ───────────────────────────────────
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const isVideo = req.path.includes('video');
      return res.status(413).json({
        success: false,
        message: isVideo
          ? `Video terlalu besar (> ${VIDEO_RAW_MAX/1024/1024}MB). Upload ditolak. Kompres video terlebih dahulu.`
          : `Foto terlalu besar (> ${PHOTO_MAX_BYTES/1024/1024}MB).`,
        code: 'FILE_TOO_LARGE',
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: err.message, code: 'TOO_MANY_FILES' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
}

// ── Cleanup tmpdir files ───────────────────────────────────
function cleanupFiles(files = []) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════
// POST /upload/photos/:listingId
// ═══════════════════════════════════════════════════════════
router.post(
  '/upload/photos/:listingId',
  (req, res, next) => photoUpload.array('files', MAX_PHOTOS)(req, res, err => handleMulterError(err, req, res, next)),
  async (req, res) => {
    const tmpFiles = (req.files || []).map(f => f.path);
    try {
      const { listingId } = req.params;
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada file foto' });
      }

      const existing = await cloudinaryService.listListingPhotos(listingId);
      const startIdx = existing.length;

      const uploads = await Promise.all(
        req.files.map((file, i) =>
          cloudinaryService.uploadListingPhoto(file.path, listingId, startIdx + i, file)
        )
      );

      res.json({
        success:    true,
        listing_id: listingId,
        folder:     `mansion_properti/${listingId}/photos`,
        uploaded:   uploads.length,
        data:       uploads,
      });
    } catch (e) {
      console.error('[Media] Photo upload error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    } finally {
      cleanupFiles(tmpFiles);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /upload/videos/:listingId
// Upload + auto-compress video ke mansion_properti/{id}/raw/
// Alur:
//   1. Multer terima file ke /tmp (max 100MB — ditolak jika lebih)
//   2. videoCompressService.process() per file:
//      - ≤ 50MB  → tidak dikompresi
//      - 50-100MB → two-pass compress ke ≤50MB
//   3. Upload file (compressed atau original) ke Cloudinary /raw/
//   4. Cleanup semua file tmpdir
// ═══════════════════════════════════════════════════════════
router.post(
  '/upload/videos/:listingId',
  (req, res, next) => videoUpload.array('files', MAX_VIDEO_CLIPS)(req, res, err => handleMulterError(err, req, res, next)),
  async (req, res) => {
    // Kumpulkan semua tmp paths untuk cleanup di finally
    const tmpPaths = [];

    try {
      const { listingId } = req.params;
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada file video' });
      }

      // Catat original tmp paths
      req.files.forEach(f => tmpPaths.push(f.path));

      // ── Cek slot tersisa ─────────────────────────────────────
      const existing = await cloudinaryService.listListingVideos(listingId);

      if (existing.length >= MAX_VIDEO_CLIPS) {
        return res.status(400).json({
          success: false,
          message: `Batas ${MAX_VIDEO_CLIPS} video per listing sudah penuh. Hapus video lama terlebih dahulu.`,
          code:    'VIDEO_LIMIT_REACHED',
          current: existing.length,
          limit:   MAX_VIDEO_CLIPS,
        });
      }

      const slotsLeft = MAX_VIDEO_CLIPS - existing.length;
      if (req.files.length > slotsLeft) {
        return res.status(400).json({
          success: false,
          message: `Tidak bisa upload ${req.files.length} video. Slot tersisa: ${slotsLeft}.`,
          code:    'VIDEO_LIMIT_EXCEEDED',
          current: existing.length,
          limit:   MAX_VIDEO_CLIPS,
          slots_remaining: slotsLeft,
        });
      }

      // ── Proses setiap file: compress jika perlu ───────────────
      const processResults = [];
      for (const file of req.files) {
        const result = await videoCompressService.process(file);
        // Catat output path untuk cleanup (bisa beda dari input jika dicompress)
        if (result.outputPath !== file.path) tmpPaths.push(result.outputPath);
        processResults.push({ file, result });
      }

      // ── Upload ke Cloudinary ──────────────────────────────────
      const uploads = await Promise.all(
        processResults.map(({ file, result }, i) =>
          cloudinaryService.uploadListingVideo(
            result.outputPath,
            listingId,
            existing.length + i,
            {
              // Kirim file object dengan size output (bukan original)
              size:         result.outputMB * 1024 * 1024,
              mimetype:     file.mimetype,
              originalname: file.originalname,
            }
          ).then(uploadResult => ({
            ...uploadResult,
            was_compressed:    result.wasCompressed,
            original_mb:       result.originalMB,
            output_mb:         result.outputMB,
            compression_ratio: result.compressionRatio,
          }))
        )
      );

      const totalClips = existing.length + uploads.length;

      res.json({
        success:         true,
        listing_id:      listingId,
        folder:          `mansion_properti/${listingId}/raw`,
        uploaded:        uploads.length,
        total_clips:     totalClips,
        remaining_slots: MAX_VIDEO_CLIPS - totalClips,
        compression_summary: {
          compressed_count: uploads.filter(u => u.was_compressed).length,
          total_saved_mb:   +(uploads.reduce((sum, u) => sum + (u.original_mb - u.output_mb), 0)).toFixed(2),
        },
        data: uploads,
      });

    } catch (e) {
      console.error('[Media] Video upload error:', e.message);
      const status = e.code === 'FILE_TOO_LARGE' || e.status === 413 ? 413 : 500;
      res.status(status).json({ success: false, message: e.message });
    } finally {
      // Cleanup semua file tmpdir — compressed maupun original
      cleanupFiles(tmpPaths);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /listing/:listingId/info  — slot info sebelum upload
// ═══════════════════════════════════════════════════════════
router.get('/listing/:listingId/info', async (req, res) => {
  try {
    const { listingId } = req.params;
    const [photos, videos] = await Promise.all([
      cloudinaryService.listListingPhotos(listingId),
      cloudinaryService.listListingVideos(listingId),
    ]);

    res.json({
      success:    true,
      listing_id: listingId,
      photos: {
        count:           photos.length,
        limit:           MAX_PHOTOS,
        slots_remaining: MAX_PHOTOS - photos.length,
        max_mb_per_file: PHOTO_MAX_BYTES / 1024 / 1024,
      },
      videos: {
        count:             videos.length,
        limit:             MAX_VIDEO_CLIPS,
        slots_remaining:   MAX_VIDEO_CLIPS - videos.length,
        max_raw_mb:        VIDEO_RAW_MAX / 1024 / 1024,
        target_max_mb:     VIDEO_TARGET_MAX / 1024 / 1024,
        auto_compress:     true,
        compress_note:     `File 50–${VIDEO_RAW_MAX/1024/1024}MB akan otomatis dikompres ke ≤${VIDEO_TARGET_MAX/1024/1024}MB`,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /listing/:listingId  — semua media (photos + videos + ads)
// ═══════════════════════════════════════════════════════════
router.get('/listing/:listingId', async (req, res) => {
  try {
    const media = await cloudinaryService.listAllListingMedia(req.params.listingId);
    res.json({ success: true, data: media });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /:publicId  — hapus satu foto atau video
// ═══════════════════════════════════════════════════════════
router.delete('/:publicId', async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    const isVideo  = publicId.includes('/raw/') || publicId.includes('/ads/');
    const result   = isVideo
      ? await cloudinaryService.deleteVideo(publicId)
      : await cloudinaryService.deletePhoto(publicId);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /upload  (LEGACY — backward compat)
// ═══════════════════════════════════════════════════════════
router.post(
  '/upload',
  (req, res, next) => photoUpload.array('files', MAX_PHOTOS)(req, res, err => handleMulterError(err, req, res, next)),
  async (req, res) => {
    const tmpFiles = (req.files || []).map(f => f.path);
    try {
      const listingId = req.body.listingId || 'general';
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada file' });
      }

      if (listingId !== 'general') {
        const existing = await cloudinaryService.listListingPhotos(listingId);
        const uploads  = await Promise.all(
          req.files.map((file, i) =>
            cloudinaryService.uploadListingPhoto(file.path, listingId, existing.length + i, file)
          )
        );
        return res.json({ success: true, data: uploads });
      }

      const uploads = await cloudinaryService.uploadMultiple(req.files, listingId);
      res.json({ success: true, data: uploads });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    } finally {
      cleanupFiles(tmpFiles);
    }
  }
);

module.exports = router;
