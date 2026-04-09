/**
 * VideoCompressService — Auto-compress video sebelum upload ke Cloudinary
 * ============================================
 * Batasan upload:
 *   - Raw upload max : 100 MB  → jika lebih, TOLAK langsung (HTTP 413)
 *   - Target output  : ≤ 50 MB → jika raw > 50MB, auto-compress
 *   - Jika raw ≤ 50MB          → langsung upload, tidak perlu kompresi
 *
 * Metode kompresi: FFmpeg two-pass H.264 + AAC
 *   - Pass 1: analisis bitrate (tidak menghasilkan output)
 *   - Pass 2: encode dengan target bitrate yang dihitung dari durasi
 *   - Target bitrate = (50MB * 8 bits * 0.93) / durasi_detik - 128kbps (audio)
 *   - Resolution: scale down ke max 1280×720 (HD) jika sumber lebih besar
 *   - Audio: AAC 128kbps (stereo)
 *
 * Dependencies: fluent-ffmpeg (wraps system ffmpeg binary)
 * Requirement: ffmpeg harus terinstall di sistem (sudah ada di Dockerfile)
 */

const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── Batasan ────────────────────────────────────────────────
const RAW_MAX_BYTES    = 100 * 1024 * 1024;   // 100 MB — batas upload raw
const TARGET_MAX_BYTES =  50 * 1024 * 1024;   //  50 MB — batas setelah kompresi
const SAFETY_MARGIN    = 0.93;                 // 93% dari 50MB = 46.5MB target aktual
const AUDIO_KBPS       = 128;                  // kbps audio AAC
const MAX_RESOLUTION   = { width: 1280, height: 720 }; // max output resolution

class VideoCompressService {

  /**
   * Entry point utama.
   * Cek ukuran file → jika perlu kompresi → compress → return path output.
   *
   * @param {Object} file        Multer file object
   * @param {string} file.path   Path file sementara (/tmp/...)
   * @param {number} file.size   Ukuran bytes
   * @param {string} file.originalname
   * @returns {Promise<{
   *   outputPath: string,   // path file yang siap diupload (compressed atau original)
   *   wasCompressed: boolean,
   *   originalMB: number,
   *   outputMB: number,
   *   compressionRatio: string   // e.g. "68.2%"
   * }>}
   * @throws Error jika file > 100MB, atau kompresi gagal
   */
  async process(file) {
    const originalMB = +(file.size / 1024 / 1024).toFixed(2);

    // ── Guard: tolak jika > 100MB ─────────────────────────────
    if (file.size > RAW_MAX_BYTES) {
      throw Object.assign(
        new Error(
          `Ukuran file terlalu besar: ${originalMB}MB. ` +
          `Maksimal upload ${RAW_MAX_BYTES / 1024 / 1024}MB per video. ` +
          `Kompres video terlebih dahulu atau gunakan resolusi lebih rendah.`
        ),
        { code: 'FILE_TOO_LARGE', status: 413 }
      );
    }

    // ── Tidak perlu kompresi ──────────────────────────────────
    if (file.size <= TARGET_MAX_BYTES) {
      return {
        outputPath:       file.path,
        wasCompressed:    false,
        originalMB,
        outputMB:         originalMB,
        compressionRatio: '0%',
      };
    }

    // ── Perlu kompresi (50MB < file ≤ 100MB) ─────────────────
    console.log(`[VideoCompress] ${file.originalname}: ${originalMB}MB > 50MB — auto-compressing...`);
    const outputPath = await this._compress(file.path, file.originalname);

    const outputStat = fs.statSync(outputPath);
    const outputMB   = +(outputStat.size / 1024 / 1024).toFixed(2);
    const ratio      = (((originalMB - outputMB) / originalMB) * 100).toFixed(1) + '%';

    console.log(`[VideoCompress] Done: ${originalMB}MB → ${outputMB}MB (compressed ${ratio})`);

    // Hapus file original dari tmpdir (hemat disk)
    _safeUnlink(file.path);

    return {
      outputPath,
      wasCompressed:    true,
      originalMB,
      outputMB,
      compressionRatio: ratio,
    };
  }

  /**
   * Probe metadata video (durasi, resolusi, bitrate) menggunakan ffprobe.
   * @param {string} filePath
   * @returns {Promise<{ duration: number, width: number, height: number, bitrate: number }>}
   */
  probeVideo(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, meta) => {
        if (err) return reject(new Error(`ffprobe gagal: ${err.message}`));

        const format  = meta.format || {};
        const vStream = (meta.streams || []).find(s => s.codec_type === 'video') || {};

        resolve({
          duration: parseFloat(format.duration) || 0,
          width:    vStream.width  || 0,
          height:   vStream.height || 0,
          bitrate:  parseInt(format.bit_rate) || 0,   // bits/s total
        });
      });
    });
  }

  // ── Private: Two-Pass Compression ─────────────────────────

  async _compress(inputPath, originalName) {
    // 1. Probe durasi untuk hitung target bitrate
    const { duration, width, height } = await this.probeVideo(inputPath);

    if (duration < 1) {
      throw new Error('Video terlalu pendek atau format tidak valid (durasi < 1 detik)');
    }

    // 2. Hitung target video bitrate
    //    total_target_bits = TARGET_MAX_BYTES * 8 * SAFETY_MARGIN
    //    video_kbps = (total_target_bits / duration_secs / 1000) - audio_kbps
    const totalTargetBits  = TARGET_MAX_BYTES * 8 * SAFETY_MARGIN;
    const videoKbps        = Math.floor(totalTargetBits / duration / 1000) - AUDIO_KBPS;

    if (videoKbps < 200) {
      throw new Error(
        `Video terlalu panjang untuk dikompres ke 50MB. ` +
        `Durasi ${duration.toFixed(0)}s memerlukan bitrate ${videoKbps}kbps yang terlalu rendah. ` +
        `Potong durasi video atau gunakan resolusi lebih kecil.`
      );
    }

    // 3. Tentukan output resolution (scale down jika > 1280x720)
    const scaleFilter = _buildScaleFilter(width, height);

    // 4. Path output
    const basename   = path.basename(originalName, path.extname(originalName));
    const outputPath = path.join(os.tmpdir(), `compressed_${Date.now()}_${basename}.mp4`);

    // 5. Two-pass encoding
    const passlogPath = path.join(os.tmpdir(), `ffpass_${Date.now()}`);

    await this._pass1(inputPath, passlogPath, videoKbps, scaleFilter);
    await this._pass2(inputPath, outputPath, passlogPath, videoKbps, scaleFilter);

    // Bersihkan pass log files
    _safeUnlink(`${passlogPath}-0.log`);
    _safeUnlink(`${passlogPath}-0.log.mbtree`);

    return outputPath;
  }

  /**
   * Pass 1: Analisis video (tidak menghasilkan output video).
   */
  _pass1(inputPath, passlogPath, videoKbps, scaleFilter) {
    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          `-b:v ${videoKbps}k`,
          '-pass 1',
          `-passlogfile ${passlogPath}`,
          '-an',                    // No audio di pass 1
          '-f null',
        ]);

      if (scaleFilter) cmd = cmd.videoFilter(scaleFilter);

      cmd
        .output(process.platform === 'win32' ? 'NUL' : '/dev/null')
        .on('end', resolve)
        .on('error', err => reject(new Error(`Kompresi pass 1 gagal: ${err.message}`)))
        .run();
    });
  }

  /**
   * Pass 2: Encode dengan target bitrate dari pass 1.
   */
  _pass2(inputPath, outputPath, passlogPath, videoKbps, scaleFilter) {
    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          `-b:v ${videoKbps}k`,
          '-pass 2',
          `-passlogfile ${passlogPath}`,
          '-c:a aac',
          `-b:a ${AUDIO_KBPS}k`,
          '-ar 44100',              // Sample rate 44.1kHz
          '-movflags +faststart',   // Optimasi streaming (metadata di awal file)
        ]);

      if (scaleFilter) cmd = cmd.videoFilter(scaleFilter);

      cmd
        .output(outputPath)
        .on('start', cmd => console.log(`[VideoCompress] FFmpeg: ${cmd.slice(0, 120)}...`))
        .on('progress', p => {
          if (p.percent) process.stdout.write(`\r[VideoCompress] ${p.percent.toFixed(1)}%`);
        })
        .on('end', () => { process.stdout.write('\n'); resolve(outputPath); })
        .on('error', err => reject(new Error(`Kompresi pass 2 gagal: ${err.message}`)))
        .run();
    });
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Build ffmpeg scale filter agar output tidak melebihi MAX_RESOLUTION.
 * Maintain aspect ratio. Jika source sudah kecil, tidak perlu scale.
 */
function _buildScaleFilter(srcWidth, srcHeight) {
  if (!srcWidth || !srcHeight) return null;
  if (srcWidth <= MAX_RESOLUTION.width && srcHeight <= MAX_RESOLUTION.height) return null;

  // Scale ke max 1280x720, maintain aspect ratio, pastikan dimensi genap
  return `scale='if(gt(iw,${MAX_RESOLUTION.width}),${MAX_RESOLUTION.width},-2)':'if(gt(ih,${MAX_RESOLUTION.height}),${MAX_RESOLUTION.height},-2)'`;
}

function _safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = new VideoCompressService();
