/**
 * TTS Service — msedge-tts (normal voice) + FFmpeg pitch/rate post-process
 * Edge TTS tidak support SSML prosody injection via toStream().
 * Solusi: generate audio normal, lalu shift pitch & rate via FFmpeg asetrate+atempo.
 */
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const ffmpeg = require('fluent-ffmpeg');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// pitch & rate dalam persen (integer). 0 = tidak ada perubahan.
const VOICES = {
  male_normal:     { name: 'id-ID-ArdiNeural',  label: 'Ardi — Normal',            pitch:   0, rate:   0 },
  male_karismatik: { name: 'id-ID-ArdiNeural',  label: 'Ardi — Karismatik/Berat',  pitch: -10, rate:  -5 },
  male_ceria:      { name: 'id-ID-ArdiNeural',  label: 'Ardi — Ceria',             pitch: +10, rate: +10 },
  female_normal:   { name: 'id-ID-GadisNeural', label: 'Gadis — Normal',           pitch:   0, rate:   0 },
  female_energik:  { name: 'id-ID-GadisNeural', label: 'Gadis — Energik/Muda',    pitch: +12, rate: +10 },
  female_elegan:   { name: 'id-ID-GadisNeural', label: 'Gadis — Elegan/Santai',   pitch:  -5, rate:  -8 },
};

const SAMPLE_RATE = 24000; // output rate msedge-tts 24kHz

async function _ttsNormal(text, voiceName) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  return new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data',  c  => chunks.push(c));
    audioStream.on('end',   () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

/**
 * Pitch shift via asetrate: mengubah pitch DAN speed, lalu atempo mengkompensasi
 * speed dan menerapkan rate yang diinginkan.
 *
 * pitchFactor = 1 + pitch/100   (mis. -10% → 0.9, +10% → 1.1)
 * rateFactor  = 1 + rate/100    (mis. -5%  → 0.95, +10% → 1.1)
 *
 * Filter: asetrate=SR*pitchFactor, atempo=rateFactor/pitchFactor, aresample=SR
 */
function _applyPitchRate(buf, pitchPct, ratePct) {
  const pitchFactor = 1 + pitchPct / 100;
  const rateFactor  = 1 + ratePct  / 100;
  const newRate     = Math.round(SAMPLE_RATE * pitchFactor);
  const tempo       = rateFactor / pitchFactor;

  const tmpIn  = path.join(os.tmpdir(), `tts_in_${Date.now()}.mp3`);
  const tmpOut = path.join(os.tmpdir(), `tts_out_${Date.now()}.mp3`);
  fs.writeFileSync(tmpIn, buf);

  return new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .audioFilters([
        `asetrate=${newRate}`,
        `atempo=${tempo.toFixed(6)}`,
        `aresample=${SAMPLE_RATE}`,
      ])
      .audioCodec('libmp3lame')
      .audioBitrate('96k')
      .output(tmpOut)
      .on('end', () => {
        try   { resolve(fs.readFileSync(tmpOut)); }
        finally { [tmpIn, tmpOut].forEach(f => fs.unlink(f, () => {})); }
      })
      .on('error', err => {
        [tmpIn, tmpOut].forEach(f => fs.unlink(f, () => {}));
        reject(err);
      })
      .run();
  });
}

class TTSService {
  async synthesize(text, voiceKey = 'female_normal') {
    const voice = VOICES[voiceKey] || VOICES.female_normal;

    const rawBuf = await _ttsNormal(text, voice.name);

    if (voice.pitch === 0 && voice.rate === 0) return rawBuf;

    return _applyPitchRate(rawBuf, voice.pitch, voice.rate);
  }

  static getVoiceOptions() {
    return Object.entries(VOICES).map(([key, v]) => ({ key, label: v.label }));
  }
}

module.exports = new TTSService();
