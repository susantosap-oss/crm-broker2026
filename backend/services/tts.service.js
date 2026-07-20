/**
 * TTS Service — MsEdgeTTS dengan toStreamRaw() agar SSML prosody dikirim as-is.
 * toStream() wrap ulang teks sehingga <prosody> tidak bisa dipakai;
 * toStreamRaw() kirim full SSML langsung ke Edge TTS tanpa wrapping.
 */
const { MsEdgeTTS, OUTPUT_FORMAT } = require('ms-edge-tts');

const VOICES = {
  male_normal:     { name: 'id-ID-ArdiNeural',  label: 'Ardi — Normal',            pitch:   0, rate:   0 },
  male_karismatik: { name: 'id-ID-ArdiNeural',  label: 'Ardi — Karismatik/Berat',  pitch: -10, rate:  -5 },
  male_ceria:      { name: 'id-ID-ArdiNeural',  label: 'Ardi — Ceria',             pitch: +10, rate: +10 },
  female_normal:   { name: 'id-ID-GadisNeural', label: 'Gadis — Normal',           pitch:   0, rate:   0 },
  female_energik:  { name: 'id-ID-GadisNeural', label: 'Gadis — Energik/Muda',    pitch: +12, rate: +10 },
  female_elegan:   { name: 'id-ID-GadisNeural', label: 'Gadis — Elegan/Santai',   pitch:  -5, rate:  -8 },
};

function _sanitize(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function _pct(n) {
  const r = Math.round(n);
  return (r >= 0 ? '+' : '') + r + '%';
}

function _buildSsml(text, voiceName, pitch, rate) {
  const clean = _sanitize(text);
  const inner = (pitch === 0 && rate === 0)
    ? clean
    : `<prosody pitch="${_pct(pitch)}" rate="${_pct(rate)}">${clean}</prosody>`;

  return (
    `<speak version="1.0"` +
    ` xmlns="http://www.w3.org/2001/10/synthesis"` +
    ` xmlns:mstts="https://www.w3.org/2001/10/synthesis/mstts"` +
    ` xml:lang="id-ID">` +
    `<voice name="${voiceName}">${inner}</voice>` +
    `</speak>`
  );
}

class TTSService {
  async synthesize(text, voiceKey = 'female_normal') {
    const voice = VOICES[voiceKey] || VOICES.female_normal;
    const ssml  = _buildSsml(text, voice.name, voice.pitch, voice.rate);

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice.name, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const stream = tts.toStreamRaw(ssml);

    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data',  c   => chunks.push(c));
      stream.on('end',   ()  => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  static getVoiceOptions() {
    return Object.entries(VOICES).map(([key, v]) => ({ key, label: v.label }));
  }
}

module.exports = new TTSService();
