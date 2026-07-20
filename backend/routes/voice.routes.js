/**
 * Voice Routes — TTS & Voice Enhancement untuk AI Script VO
 * Base: /api/v1/voice
 *
 * POST /generate-tts   → script → Google TTS → MP3 → Cloudinary URL
 * POST /enhance        → upload audio → FFmpeg enhance → MP3 → Cloudinary URL
 * GET  /voices         → daftar pilihan suara tersedia
 */
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { authMiddleware } = require('../middleware/auth.middleware');
const ttsService         = require('../services/tts.service');
const voiceEnhance       = require('../services/voice-enhance.service');
const cloudinaryService  = require('../services/cloudinary.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm','audio/ogg','audio/mpeg','audio/mp3','audio/wav','audio/mp4','audio/m4a','audio/x-m4a','video/webm'];
    cb(null, allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|webm|m4a)$/i));
  },
});

// GET /voices — daftar suara yang bisa dipilih
router.get('/voices', authMiddleware, (req, res) => {
  res.json({ success: true, data: ttsService.constructor.getVoiceOptions() });
});

// POST /generate-tts — script → audio MP3 via Google TTS
router.post('/generate-tts', authMiddleware, async (req, res) => {
  try {
    const { script, voice = 'female', listing_id } = req.body;

    if (!script?.trim())     return res.status(400).json({ success: false, message: 'script wajib diisi' });
    if (!listing_id?.trim()) return res.status(400).json({ success: false, message: 'listing_id wajib diisi' });
    if (script.length > 5000) return res.status(400).json({ success: false, message: 'Script terlalu panjang (max 5000 karakter)' });

    // Generate TTS audio
    const audioBuffer = await ttsService.synthesize(script.trim(), voice);

    // Upload ke Cloudinary
    const audioUrl = await cloudinaryService.uploadVoiceOver(audioBuffer, listing_id, `tts_${voice}_${Date.now()}`);

    res.json({
      success:   true,
      audio_url: audioUrl,
      message:   'Voice Over berhasil di-generate',
      voice,
      size_kb:   Math.round(audioBuffer.length / 1024),
    });

  } catch (e) {
    console.error('[Voice/TTS] error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /enhance — upload audio self-record → FFmpeg enhance → MP3 Cloudinary URL
router.post('/enhance', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'File audio wajib diupload' });

    const listing_id = req.body.listing_id;
    if (!listing_id) return res.status(400).json({ success: false, message: 'listing_id wajib diisi' });

    // Deteksi ekstensi dari mimetype
    const mimeToExt = {
      'audio/webm': 'webm', 'video/webm': 'webm',
      'audio/ogg':  'ogg',
      'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
      'audio/wav':  'wav',
      'audio/mp4':  'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
    };
    const ext = mimeToExt[req.file.mimetype] || 'webm';

    // Enhance dengan FFmpeg
    const enhancedBuffer = await voiceEnhance.enhance(req.file.buffer, ext);

    // Upload ke Cloudinary
    const audioUrl = await cloudinaryService.uploadVoiceOver(enhancedBuffer, listing_id, `self_vo_${Date.now()}`);

    res.json({
      success:      true,
      audio_url:    audioUrl,
      message:      'Suara berhasil di-enhance',
      original_kb:  Math.round(req.file.buffer.length / 1024),
      enhanced_kb:  Math.round(enhancedBuffer.length / 1024),
    });

  } catch (e) {
    console.error('[Voice/Enhance] error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
