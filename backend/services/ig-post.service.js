'use strict';

/**
 * IGPostService — posting ke Instagram via Graph API (resmi Meta)
 *
 * Flow per job:
 *   1. Create media container  → POST /{ig_user_id}/media
 *   2. (Video/Reels) Poll status sampai FINISHED (max 3 menit)
 *   3. Publish container       → POST /{ig_user_id}/media_publish
 *
 * Credentials per-agen:
 *   ig_graph_user_id    — Instagram User ID (angka dari Meta Developer)
 *   ig_graph_token      — Long-lived Page Access Token (berlaku 60 hari)
 *
 * Anti-bot: delay antar post dikontrol oleh frontend (human-habit countdown).
 */

const axios     = require('axios');
const GRAPH_VER = 'v19.0';
const BASE      = `https://graph.facebook.com/${GRAPH_VER}`;

class IGPostService {

  /**
   * @param {object} opts
   * @param {string} opts.igUserId      — Instagram User ID
   * @param {string} opts.accessToken   — Page Access Token
   * @param {'ig_reels'|'ig_story'} opts.type
   * @param {string} opts.mediaUrl      — URL media (Cloudinary)
   * @param {string} opts.caption
   */
  async post({ igUserId, accessToken, type, mediaUrl, caption }) {
    if (type === 'ig_story') {
      return this._postStory(igUserId, accessToken, mediaUrl);
    }
    // ig_reels
    return this._postReels(igUserId, accessToken, mediaUrl, caption);
  }

  async _postReels(igUserId, accessToken, mediaUrl, caption) {
    const isVideo = this._isVideo(mediaUrl);

    // Step 1: buat container
    const containerParams = {
      access_token:  accessToken,
      caption:       caption || '',
    };

    if (isVideo) {
      containerParams.media_type  = 'REELS';
      containerParams.video_url   = mediaUrl;
      containerParams.share_to_feed = true;
    } else {
      // Foto → post ke feed biasa
      containerParams.image_url = mediaUrl;
    }

    const { data: container } = await axios.post(`${BASE}/${igUserId}/media`, containerParams);
    const creationId = container.id;

    // Step 2: tunggu video processing (khusus video)
    if (isVideo) await this._pollUntilFinished(igUserId, accessToken, creationId);

    // Step 3: publish
    await axios.post(`${BASE}/${igUserId}/media_publish`, {
      creation_id:  creationId,
      access_token: accessToken,
    });

    return { success: true };
  }

  async _postStory(igUserId, accessToken, mediaUrl) {
    const isVideo = this._isVideo(mediaUrl);

    const containerParams = {
      access_token: accessToken,
      media_type:   'STORIES',
    };
    if (isVideo) {
      containerParams.video_url = mediaUrl;
    } else {
      containerParams.image_url = mediaUrl;
    }

    const { data: container } = await axios.post(`${BASE}/${igUserId}/media`, containerParams);
    const creationId = container.id;

    if (isVideo) await this._pollUntilFinished(igUserId, accessToken, creationId);

    await axios.post(`${BASE}/${igUserId}/media_publish`, {
      creation_id:  creationId,
      access_token: accessToken,
    });

    return { success: true };
  }

  // Poll status container video hingga FINISHED atau ERROR (max 3 menit)
  async _pollUntilFinished(igUserId, accessToken, creationId, maxMs = 180_000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 6000)); // tunggu 6 detik
      const { data } = await axios.get(`${BASE}/${creationId}`, {
        params: { fields: 'status_code,status', access_token: accessToken },
      });
      if (data.status_code === 'FINISHED') return;
      if (data.status_code === 'ERROR') {
        throw new Error(`Video processing gagal: ${data.status || 'unknown'}`);
      }
    }
    throw new Error('Timeout: video processing > 3 menit. Coba file yang lebih kecil.');
  }

  _isVideo(url) {
    return /\.(mp4|mov|avi|webm)(\?|$)/i.test(url);
  }

  classifyError(e) {
    const apiErr = e.response?.data?.error;
    const code   = apiErr?.code;
    const subcode = apiErr?.error_subcode;
    const msg    = apiErr?.message || e.message || '';
    const fbTrace = apiErr?.fbtrace_id || '';

    console.error(`[IG] Meta API error — code=${code} subcode=${subcode} msg="${msg}" trace=${fbTrace}`);
    console.error(`[IG] Full error:`, JSON.stringify(e.response?.data || e.message));

    if (code === 190 || msg.includes('access token') || msg.includes('OAuthException')) {
      return { code: 'token_expired', message: 'Access Token expired atau tidak valid. Update token di PA Settings → Instagram.' };
    }
    if (code === 10 || msg.includes('permission') || msg.includes('instagram_content_publish')) {
      return { code: 'permission', message: `Token tidak punya izin instagram_content_publish (code=${code} sub=${subcode}). Generate ulang token di Meta Developer.` };
    }
    if (msg.includes('not a business') || msg.includes('professional')) {
      return { code: 'not_professional', message: 'Akun IG harus Professional/Creator. Ubah di Instagram Settings → Account Type.' };
    }
    if (msg.includes('Media type') || msg.includes('format')) {
      return { code: 'media_format', message: 'Format media tidak didukung. Gunakan JPG/PNG untuk foto, MP4 untuk video.' };
    }
    return { code: 'unknown', message: msg || 'Terjadi kesalahan tidak diketahui.' };
  }
}

module.exports = new IGPostService();
