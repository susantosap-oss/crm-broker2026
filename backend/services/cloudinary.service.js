/**
 * CloudinaryService - Media Storage
 * ============================================
 * Semua operasi upload, transform, dan delete foto.
 * Terintegrasi dengan Social Media Asset Bundle.
 */

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = process.env.CLOUDINARY_FOLDER || 'crm-broker-properti';

class CloudinaryService {
  // ── Upload Single File ────────────────────────────────────
  async upload(filePath, options = {}) {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: `${FOLDER}/${options.subfolder || 'listings'}`,
      public_id: options.public_id,
      overwrite: true,
      transformation: [
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
      ],
      ...options,
    });

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  }

  // ── Upload Multiple Files ─────────────────────────────────
  async uploadMultiple(files, listingId) {
    const uploads = await Promise.all(
      files.map((file, i) =>
        this.upload(file.path || file, {
          subfolder: `listings/${listingId}`,
          public_id: `photo_${i + 1}`,
        })
      )
    );
    return uploads;
  }

  // ── Delete File ───────────────────────────────────────────
  async delete(publicId) {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  }

  // ── Get Download URL (forced download) ───────────────────
  getDownloadUrl(url, filename = 'foto-properti') {
    if (!url) return null;
    // Inject fl_attachment for forced download
    return url.replace('/upload/', `/upload/fl_attachment:${filename}/`);
  }

  // ── Get Thumbnail URL ─────────────────────────────────────
  getThumbnailUrl(url, width = 400, height = 300) {
    if (!url) return null;
    return url.replace(
      '/upload/',
      `/upload/c_fill,w_${width},h_${height},q_auto,f_auto/`
    );
  }

  // ── Get Optimized URL (for web) ───────────────────────────
  getOptimizedUrl(url, width = 1200) {
    if (!url) return null;
    return url.replace(
      '/upload/',
      `/upload/w_${width},q_auto,f_auto/`
    );
  }

  // ── Get Watermarked URL ───────────────────────────────────
  getWatermarkedUrl(url, text = 'CRM Broker Properti') {
    if (!url) return null;
    const encoded = encodeURIComponent(text);
    return url.replace(
      '/upload/',
      `/upload/l_text:Arial_28_bold:${encoded},co_white,o_50,g_south_east,x_10,y_10/`
    );
  }

  // ── Social Media Crop (1:1 for IG) ───────────────────────
  getInstagramUrl(url, size = 1080) {
    if (!url) return null;
    return url.replace(
      '/upload/',
      `/upload/c_fill,w_${size},h_${size},q_auto,f_auto/`
    );
  }

  // ── Story Format (9:16) ───────────────────────────────────
  getStoryUrl(url) {
    if (!url) return null;
    return url.replace(
      '/upload/',
      `/upload/c_fill,w_1080,h_1920,q_auto,f_auto/`
    );
  }
}

module.exports = new CloudinaryService();
