/**
 * Voice Enhance Service — AI Audio Processing untuk Self Voice Over
 * Menggunakan FFmpeg dengan pipeline seperti Adobe Podcast Enhance:
 *   1. Noise reduction (afftdn)
 *   2. Loudness normalization broadcast standard -16 LUFS (loudnorm)
 *   3. Dynamic range compression (acompressor)
 *   4. EQ presence boost untuk suara voiceover
 * Input: audio buffer (WebM/OGG/MP3/WAV dari browser atau file upload)
 * Output: enhanced MP3 buffer
 */
const ffmpeg = require('fluent-ffmpeg');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');

class VoiceEnhanceService {

  /**
   * Enhance audio buffer — noise reduction + normalization + EQ.
   * @param {Buffer} inputBuffer - raw audio dari browser/upload
   * @param {string} inputExt    - ekstensi file input ('webm', 'mp3', 'wav', 'ogg', 'm4a')
   * @returns {Promise<Buffer>}  - enhanced MP3 buffer
   */
  enhance(inputBuffer, inputExt = 'webm') {
    return new Promise((resolve, reject) => {
      const sid    = uuidv4();
      const tmpIn  = path.join(os.tmpdir(), `vo_in_${sid}.${inputExt}`);
      const tmpOut = path.join(os.tmpdir(), `vo_out_${sid}.mp3`);

      fs.writeFileSync(tmpIn, inputBuffer);

      ffmpeg(tmpIn)
        .audioFilters([
          // 1. Noise reduction — reduce background noise by 20dB floor
          'afftdn=nf=-30',
          // 2. High-pass filter — hapus rumble di bawah 80Hz
          'highpass=f=80',
          // 3. Low-pass filter — potong frekuensi tidak perlu di atas 12kHz
          'lowpass=f=12000',
          // 4. EQ — boost presence range (2kHz-5kHz) untuk kejelasan suara
          'equalizer=f=2500:width_type=o:width=1.5:g=3',
          // 5. EQ — boost air (8kHz) untuk kecemerlangan suara
          'equalizer=f=8000:width_type=o:width=2:g=2',
          // 6. Dynamic range compression — ratakan volume tinggi-rendah
          'acompressor=threshold=-20dB:ratio=4:attack=5:release=100:makeup=3dB',
          // 7. Loudness normalization ke -16 LUFS (broadcast/podcast standard)
          'loudnorm=I=-16:TP=-1.5:LRA=11',
        ])
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .audioFrequency(44100)
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
          reject(new Error(`Voice enhance gagal: ${err.message}`));
        })
        .run();
    });
  }
}

module.exports = new VoiceEnhanceService();
