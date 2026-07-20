/**
 * TTS Service — Direct WebSocket ke Microsoft Edge TTS
 * Bypass msedge-tts agar bisa kirim full SSML dengan <prosody> pitch/rate.
 */
const WebSocket = require('ws'); // transitive dep dari msedge-tts
const { randomUUID } = require('crypto');

const EDGE_TTS_WS      = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readspeaker/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const OUTPUT_FORMAT    = 'audio-24khz-96kbitrate-mono-mp3';
const TTS_TIMEOUT_MS   = 30000;

const VOICES = {
  male_normal:     { name: 'id-ID-ArdiNeural',  label: 'Ardi — Normal',           pitch: null,   rate: null   },
  male_karismatik: { name: 'id-ID-ArdiNeural',  label: 'Ardi — Karismatik/Berat', pitch: '-10%', rate: '-5%'  },
  male_ceria:      { name: 'id-ID-ArdiNeural',  label: 'Ardi — Ceria',            pitch: '+10%', rate: '+10%' },
  female_normal:   { name: 'id-ID-GadisNeural', label: 'Gadis — Normal',          pitch: null,   rate: null   },
  female_energik:  { name: 'id-ID-GadisNeural', label: 'Gadis — Energik/Muda',   pitch: '+12%', rate: '+10%' },
  female_elegan:   { name: 'id-ID-GadisNeural', label: 'Gadis — Elegan/Santai',  pitch: '-5%',  rate: '-8%'  },
};

function _buildSsml(text, voiceName, pitch, rate) {
  const prosodyAttrs = [
    pitch ? `pitch="${pitch}"` : '',
    rate  ? `rate="${rate}"`   : '',
  ].filter(Boolean).join(' ');

  const inner = prosodyAttrs
    ? `<prosody ${prosodyAttrs}>${text}</prosody>`
    : text;

  return (
    `<speak version="1.0"` +
    ` xmlns="http://www.w3.org/2001/10/synthesis"` +
    ` xmlns:mstts="https://www.w3.org/2001/10/synthesis/mstts"` +
    ` xml:lang="id-ID">` +
    `<voice name="${voiceName}">${inner}</voice>` +
    `</speak>`
  );
}

function _synthesize(ssml) {
  const connId = randomUUID().replace(/-/g, '');
  const url    = `${EDGE_TTS_WS}&ConnectionId=${connId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control':   'no-cache',
        'Pragma':          'no-cache',
        'Origin':          'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      },
    });

    const chunks = [];
    let done     = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      try { ws.terminate(); } catch (_) {}
      if (err) return reject(err);
      if (chunks.length === 0) return reject(new Error('Edge TTS: tidak ada audio data diterima'));
      resolve(Buffer.concat(chunks));
    };

    const timer = setTimeout(() => finish(new Error('Edge TTS timeout')), TTS_TIMEOUT_MS);

    ws.on('open', () => {
      const ts = new Date().toISOString();

      // 1. speech.config
      ws.send(
        `X-Timestamp:${ts}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
          outputFormat:    OUTPUT_FORMAT,
        }}}})
      );

      // 2. ssml
      const reqId = randomUUID().replace(/-/g, '');
      ws.send(
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml
      );
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // format: [2-byte header-len][header bytes][audio bytes]
        const headerLen = data.readUInt16BE(0);
        const audio     = data.slice(2 + headerLen);
        if (audio.length > 0) chunks.push(audio);
      } else {
        if (data.toString().includes('Path:turn.end')) {
          clearTimeout(timer);
          finish();
        }
      }
    });

    ws.on('error', err => { clearTimeout(timer); finish(err); });

    ws.on('close', (code) => {
      clearTimeout(timer);
      // jika sudah ada chunks tapi belum resolve (turn.end terlewat)
      if (!done && chunks.length > 0) finish();
      else if (!done) finish(new Error(`Edge TTS: koneksi ditutup (${code})`));
    });
  });
}

class TTSService {
  async synthesize(text, voiceKey = 'female_normal') {
    const voice = VOICES[voiceKey] || VOICES.female_normal;
    const ssml  = _buildSsml(text, voice.name, voice.pitch, voice.rate);
    return _synthesize(ssml);
  }

  static getVoiceOptions() {
    return Object.entries(VOICES).map(([key, v]) => ({ key, label: v.label }));
  }
}

module.exports = new TTSService();
