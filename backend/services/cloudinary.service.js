/**
 * CloudinaryService - Media Storage
 * ============================================
 * Folder structure per Listing ID:
 *
 *   mansion_properti/{listing_id}/photos/   ← foto listing (foto_1..N)
 *   mansion_properti/{listing_id}/raw/      ← video mentah dari agen (clip_1..N)
 *   mansion_properti/{listing_id}/ads/      ← hasil render ViGen (ads_{timestamp})
 *
 * Batasan upload:
 *   - Foto  : max 20 file, tiap file max 10MB, format: jpg|jpeg|png|webp
 *   - Video : max 6 file, tiap file max 50MB, format: mp4|mov|avi|mkv
 *   - Ads   : diupload oleh my-video-app via URL Cloudinary (bukan file langsung)
 */

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Root folder di Cloudinary
const ROOT = 'mansion_properti';

// ── Size & Format Limits ───────────────────────────────────
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;   // 50 MB
const MAX_PHOTOS      = 20;
const MAX_VIDEO_CLIPS = 6;

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-matroska', 'video/x-msvideo'];
const ALLOWED_VIDEO_EXTS  = ['.mp4', '.mov', '.avi', '.mkv'];

class CloudinaryService {

  // ═══════════════════════════════════════════════════════════
  // FOTO LISTING  →  mansion_properti/{listing_id}/photos/
  // ═══════════════════════════════════════════════════════════

  /**
   * Upload satu foto listing.
   * @param {string} filePath    Path lokal file (dari multer /tmp)
   * @param {string} listingId   ID listing (dipakai sebagai sub-folder)
   * @param {number} idx         Index (0-based) → public_id = foto_1, foto_2, ...
   * @param {Object} file        File object dari multer (untuk cek mimetype & size)
   */
  async uploadListingPhoto(filePath, listingId, idx, file = {}) {
    _validatePhoto(file);

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'image',
      folder:        `${ROOT}/${listingId}/photos`,
      public_id:     `foto_${idx + 1}`,
      overwrite:     true,
      transformation: [
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
        { width: 1920, crop: 'limit' },   // Batasi ukuran max
      ],
    });

    return _mapImageResult(result);
  }

  /**
   * Upload beberapa foto sekaligus (batch), max MAX_PHOTOS.
   * @param {Array}  files      Array file dari multer
   * @param {string} listingId
   */
  async uploadListingPhotos(files, listingId) {
    if (!files || files.length === 0) throw new Error('Tidak ada file foto');
    if (files.length > MAX_PHOTOS) throw new Error(`Maksimal ${MAX_PHOTOS} foto per upload`);

    const results = await Promise.all(
      files.map((file, i) =>
        this.uploadListingPhoto(file.path, listingId, i, file)
      )
    );
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // VIDEO CLIPS (RAW)  →  mansion_properti/{listing_id}/raw/
  // ═══════════════════════════════════════════════════════════

  /**
   * Upload satu video mentah dari agen.
   * Max 50MB per file, max MAX_VIDEO_CLIPS file per listing.
   * @param {string} filePath
   * @param {string} listingId
   * @param {number} idx         → public_id = clip_1, clip_2, ...
   * @param {Object} file        File object multer
   */
  async uploadListingVideo(filePath, listingId, idx, file = {}) {
    _validateVideo(file);

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder:        `${ROOT}/${listingId}/raw`,
      public_id:     `clip_${idx + 1}`,
      overwrite:     true,
      chunk_size:    6_000_000,     // 6MB chunks untuk upload stabil
      eager: [
        // Generate thumbnail untuk preview di CRM
        { format: 'jpg', transformation: [{ width: 480, crop: 'scale' }] },
      ],
    });

    return _mapVideoResult(result);
  }

  /**
   * Upload beberapa video sekaligus (batch), max MAX_VIDEO_CLIPS.
   * Cek total existing clips sebelum upload agar tidak melebihi limit.
   * @param {Array}  files
   * @param {string} listingId
   * @param {number} existingCount  Jumlah clip yang sudah ada di Cloudinary
   */
  async uploadListingVideos(files, listingId, existingCount = 0) {
    if (!files || files.length === 0) throw new Error('Tidak ada file video');

    const totalAfter = existingCount + files.length;
    if (totalAfter > MAX_VIDEO_CLIPS) {
      throw new Error(
        `Maksimal ${MAX_VIDEO_CLIPS} video per listing. ` +
        `Sudah ada ${existingCount}, ingin upload ${files.length} → total ${totalAfter}.`
      );
    }

    const results = await Promise.all(
      files.map((file, i) =>
        this.uploadListingVideo(file.path, listingId, existingCount + i, file)
      )
    );
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // ADS VIDEO (HASIL RENDER)  →  mansion_properti/{listing_id}/ads/
  // ═══════════════════════════════════════════════════════════

  /**
   * Upload hasil render video dari my-video-app ke folder ads/.
   * Menerima URL publik (Cloudinary URL atau URL lain).
   * Dipakai oleh my-video-app setelah render selesai.
   * @param {string} videoUrl    URL sumber video
   * @param {string} listingId
   */
  async uploadAdsVideo(videoUrl, listingId) {
    const publicId = `ads_${Date.now()}`;

    const result = await cloudinary.uploader.upload(videoUrl, {
      resource_type: 'video',
      folder:        `${ROOT}/${listingId}/ads`,
      public_id:     publicId,
      tags:          [listingId, 'meta_ads', 'vigen_render'],
      // Tidak ada eager transforms — video sudah dirender final
    });

    return _mapVideoResult(result);
  }

  // ═══════════════════════════════════════════════════════════
  // LIST MEDIA PER LISTING (dari Cloudinary API)
  // ═══════════════════════════════════════════════════════════

  /**
   * Ambil semua foto listing dari Cloudinary folder photos/.
   * @returns Array of { public_id, secure_url, format, bytes, created_at }
   */
  async listListingPhotos(listingId) {
    return _listFolder(`${ROOT}/${listingId}/photos`, 'image');
  }

  /**
   * Ambil semua video clips dari Cloudinary folder raw/.
   */
  async listListingVideos(listingId) {
    return _listFolder(`${ROOT}/${listingId}/raw`, 'video');
  }

  /**
   * Ambil semua video ads hasil render dari Cloudinary folder ads/.
   */
  async listAdsVideos(listingId) {
    return _listFolder(`${ROOT}/${listingId}/ads`, 'video');
  }

  /**
   * Ambil semua media (photos + raw videos + ads) dalam satu call.
   * Dipakai oleh frontend untuk menampilkan media library listing.
   */
  async listAllListingMedia(listingId) {
    const [photos, videos, ads] = await Promise.all([
      this.listListingPhotos(listingId),
      this.listListingVideos(listingId),
      this.listAdsVideos(listingId),
    ]);

    return {
      listing_id: listingId,
      photos:     photos,
      videos:     videos,       // raw clips dari agen
      ads:        ads,          // hasil render ViGen
      counts: {
        photos: photos.length,
        videos: videos.length,
        ads:    ads.length,
      },
      limits: {
        photos_max: MAX_PHOTOS,
        videos_max: MAX_VIDEO_CLIPS,
        video_max_mb: VIDEO_MAX_BYTES / 1024 / 1024,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════

  async deletePhoto(publicId) {
    return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }

  async deleteVideo(publicId) {
    return cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
  }

  // ═══════════════════════════════════════════════════════════
  // LEGACY — Backward Compat (dipakai media.routes.js lama)
  // ═══════════════════════════════════════════════════════════

  async upload(filePath, options = {}) {
    const folder = options.subfolder
      ? `mansion_properti/${options.subfolder}`
      : `mansion_properti/general`;
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      public_id: options.public_id,
      overwrite: true,
      transformation: [{ quality: 'auto:good' }, { fetch_format: 'auto' }],
      ...options,
    });
    return _mapImageResult(result);
  }

  async uploadMultiple(files, listingId) {
    return this.uploadListingPhotos(files, listingId);
  }

  async delete(publicId) {
    return cloudinary.uploader.destroy(publicId);
  }

  // ═══════════════════════════════════════════════════════════
  // URL TRANSFORMS (untuk UI)
  // ═══════════════════════════════════════════════════════════

  getThumbnailUrl(url, width = 400, height = 300) {
    if (!url || url.includes('/video/')) {
      // Video thumbnail — ambil dari eager transform atau generate
      return url ? url.replace('/upload/', `/upload/c_fill,w_${width},h_${height},so_0,f_jpg/`) : null;
    }
    return url?.replace('/upload/', `/upload/c_fill,w_${width},h_${height},q_auto,f_auto/`) || null;
  }

  getOptimizedUrl(url, width = 1200) {
    if (!url) return null;
    return url.replace('/upload/', `/upload/w_${width},q_auto,f_auto/`);
  }

  getInstagramUrl(url, size = 1080) {
    if (!url) return null;
    return url.replace('/upload/', `/upload/c_fill,w_${size},h_${size},q_auto,f_auto/`);
  }

  getStoryUrl(url) {
    if (!url) return null;
    return url.replace('/upload/', `/upload/c_fill,w_1080,h_1920,q_auto,f_auto/`);
  }

  getDownloadUrl(url, filename = 'media') {
    if (!url) return null;
    return url.replace('/upload/', `/upload/fl_attachment:${filename}/`);
  }

  getWatermarkedUrl(url, text = 'MANSION Realty') {
    if (!url) return null;
    const encoded = encodeURIComponent(text);
    return url.replace('/upload/', `/upload/l_text:Arial_28_bold:${encoded},co_white,o_50,g_south_east,x_10,y_10/`);
  }
}

// ── Private Helpers ────────────────────────────────────────

function _validatePhoto(file) {
  if (file.size && file.size > PHOTO_MAX_BYTES) {
    throw new Error(`Foto terlalu besar: ${(file.size/1024/1024).toFixed(1)}MB. Maksimal ${PHOTO_MAX_BYTES/1024/1024}MB.`);
  }
  if (file.mimetype && !ALLOWED_PHOTO_TYPES.includes(file.mimetype)) {
    throw new Error(`Format foto tidak didukung: ${file.mimetype}. Gunakan: jpg, png, webp.`);
  }
}

function _validateVideo(file) {
  if (file.size && file.size > VIDEO_MAX_BYTES) {
    throw new Error(`Video terlalu besar: ${(file.size/1024/1024).toFixed(1)}MB. Maksimal ${VIDEO_MAX_BYTES/1024/1024}MB per file.`);
  }

  // Cek MIME type
  if (file.mimetype && !ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
    // Cek extension sebagai fallback
    const ext = (file.originalname || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    if (!ALLOWED_VIDEO_EXTS.includes(ext)) {
      throw new Error(`Format video tidak didukung: ${file.mimetype}. Gunakan: mp4, mov, avi, mkv.`);
    }
  }
}

function _mapImageResult(result) {
  return {
    public_id:  result.public_id,
    secure_url: result.secure_url,
    folder:     result.folder,
    format:     result.format,
    width:      result.width,
    height:     result.height,
    bytes:      result.bytes,
    size_mb:    +(result.bytes / 1024 / 1024).toFixed(2),
    created_at: result.created_at,
  };
}

function _mapVideoResult(result) {
  return {
    public_id:     result.public_id,
    secure_url:    result.secure_url,
    folder:        result.folder,
    format:        result.format,
    duration:      result.duration,     // detik
    width:         result.width,
    height:        result.height,
    bytes:         result.bytes,
    size_mb:       +(result.bytes / 1024 / 1024).toFixed(2),
    thumbnail_url: result.eager?.[0]?.secure_url || null,
    created_at:    result.created_at,
  };
}

async function _listFolder(folder, resourceType = 'image') {
  try {
    const result = await cloudinary.api.resources({
      type:          'upload',
      resource_type: resourceType,
      prefix:        folder,
      max_results:   30,
    });
    return (result.resources || []).map(r =>
      resourceType === 'image' ? _mapImageResult(r) : _mapVideoResult(r)
    );
  } catch (e) {
    // Folder belum ada = belum ada media — return empty
    if (e.http_code === 404 || e.error?.http_code === 404) return [];
    console.warn(`[Cloudinary] listFolder ${folder} error:`, e.message);
    return [];
  }
}

// Export constants agar dipakai di media.routes
CloudinaryService.MAX_VIDEO_CLIPS = MAX_VIDEO_CLIPS;
CloudinaryService.MAX_PHOTOS      = MAX_PHOTOS;
CloudinaryService.VIDEO_MAX_BYTES = VIDEO_MAX_BYTES;
CloudinaryService.PHOTO_MAX_BYTES = PHOTO_MAX_BYTES;

module.exports = new CloudinaryService();
