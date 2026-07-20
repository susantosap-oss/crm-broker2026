/**
 * AI Script Service — Voice Over Generator untuk Listing & Project
 * Menggunakan Groq API (OpenAI-compatible, via axios).
 */
const axios = require('axios');

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ~130 kata/menit untuk presenter properti Indonesia
const WORDS_BY_DURATION = { 15: 32, 30: 65, 60: 130 };

const STYLE_PROMPT = {
  profesional: 'Gaya bicara: formal dan terpercaya, seperti presenter properti senior di TV nasional. Diksi tegas, terstruktur, dan meyakinkan.',
  casual:      'Gaya bicara: santai, hangat, dan akrab — seperti sahabat yang dengan tulus merekomendasikan hunian impian. Gunakan sapaan seperti "Kamu" atau "Anda".',
  mewah:       'Gaya bicara: premium dan eksklusif, diksi elegan dan puitis, mencerminkan gaya hidup high-end. Tempo lambat, kata-kata terasa "berat" dan berkelas.',
};

// ── Helper: konversi angka ke kata Indonesia ─────────────────
const SATUAN = [
  'nol','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan','sepuluh',
  'sebelas','dua belas','tiga belas','empat belas','lima belas','enam belas','tujuh belas',
  'delapan belas','sembilan belas',
];
const PULUHAN = ['','','dua puluh','tiga puluh','empat puluh','lima puluh','enam puluh','tujuh puluh','delapan puluh','sembilan puluh'];

function _numWords(n) {
  if (n < 20)   return SATUAN[n];
  if (n < 100)  return PULUHAN[Math.floor(n/10)] + (n%10 > 0 ? ' ' + SATUAN[n%10] : '');
  if (n < 1000) {
    const h = Math.floor(n/100), r = n%100;
    return (h === 1 ? 'seratus' : SATUAN[h] + ' ratus') + (r > 0 ? ' ' + _numWords(r) : '');
  }
  return String(n);
}

/**
 * Konversi harga format CRM ke kata-kata Indonesia.
 * "Rp 3.4 M" → "tiga koma empat milyar rupiah"
 * "Rp 500 Jt" → "lima ratus juta rupiah"
 * "50 Jt/tahun" → "lima puluh juta rupiah per tahun"
 */
function _priceToWords(price) {
  if (!price) return '';
  const s = price.replace(/^Rp\s*/i, '').trim();

  // X.Y M atau X M (milyar)
  const mM = s.match(/^(\d+)(?:[.,](\d+))?\s*M(?:\/(\w+))?/i);
  if (mM) {
    const int  = parseInt(mM[1]);
    const decs = mM[2] ? mM[2].split('').map(Number) : [];
    const per  = mM[3] ? ' per ' + mM[3] : '';
    const words = decs.length
      ? _numWords(int) + ' koma ' + decs.map(d => SATUAN[d]).join(' ')
      : _numWords(int);
    return words + ' milyar rupiah' + per;
  }

  // X.Y Jt atau X Jt (juta)
  const mJ = s.match(/^(\d+)(?:[.,](\d+))?\s*Jt(?:\/(\w+))?/i);
  if (mJ) {
    const int  = parseInt(mJ[1]);
    const decs = mJ[2] ? mJ[2].split('').map(Number) : [];
    const per  = mJ[3] ? ' per ' + mJ[3] : '';
    const words = decs.length
      ? _numWords(int) + ' koma ' + decs.map(d => SATUAN[d]).join(' ')
      : _numWords(int);
    return words + ' juta rupiah' + per;
  }

  return price; // fallback: kembalikan apa adanya
}

/** Normalisasi status transaksi ke kalimat VO natural */
function _statusTx(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('jual') && s.includes('sewa')) return 'dijual dan disewakan';
  if (s.includes('sewa'))  return 'disewakan';
  if (s.includes('jual'))  return 'dijual';
  return raw || '';
}

class AIScriptService {

  _getKey() {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY belum dikonfigurasi di environment');
    return key;
  }

  async generateScript(data, listingType = 'secondary', duration = 30, style = 'profesional') {
    const targetWords   = WORDS_BY_DURATION[duration] || WORDS_BY_DURATION[30];
    const styleNote     = STYLE_PROMPT[style] || STYLE_PROMPT.profesional;
    const propertyBlock = this._buildPropertyBlock(data, listingType);

    const systemPrompt = `Kamu adalah voice over artist dan copywriter properti Indonesia senior yang menulis SCRIPT AUDIO — bukan teks baca biasa.
Script kamu akan langsung dibacakan oleh AI text-to-speech, sehingga TANDA BACA = NAPAS & JEDA SUARA.

ATURAN WAJIB PENULISAN SCRIPT VO:
1. TITIK (.) wajib di akhir SETIAP kalimat — beri jeda natural setelah tiap kalimat.
2. KOMA (,) untuk jeda napas pendek di tengah kalimat — maksimal 2 koma per kalimat, tidak berlebihan.
3. Satu kalimat maksimal 18 kata — kalimat pendek terdengar lebih natural saat diucapkan.
4. DILARANG singkatan teknis: tulis "kamar tidur" bukan "KT", "kamar mandi" bukan "KM", "meter persegi" bukan "m²".
5. HARGA sudah ditulis dalam kata-kata di data — SALIN PERSIS, jangan ubah ke angka.
6. STATUS TRANSAKSI sudah ditulis benar di data — gunakan kata "dijual" atau "disewakan" sesuai data.
7. JUDUL LISTING boleh dijadikan pembuka atau hook yang menarik — bisa disebut langsung atau diparafrasekan.
8. DILARANG simbol: *, #, -, /, [], (), tanda seru (!), tanda tanya (?), elipsis (...).
9. DILARANG heading atau label: jangan tulis "Hook:", "CTA:", "Narasi:", dll.
10. Gunakan kata transisi alami antar kalimat: "Di sini,", "Tak hanya itu,", "Dan yang terbaik,", "Segera miliki,".
11. Output HANYA teks script murni — TANPA penjelasan, catatan, atau komentar apapun.`;

    const userPrompt = `${propertyBlock}

Tugas: Buat script Voice Over iklan properti.
- Durasi target: ${duration} detik (~${targetWords} kata).
- ${styleNote}
- Struktur alami: kalimat pembuka menarik perhatian → detail properti mengalir → ajakan bertindak hangat.
- Setiap kalimat DIAKHIRI TITIK tanpa kecuali.`;

    const { data: resp } = await axios.post(
      GROQ_URL,
      {
        model:       GROQ_MODEL,
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens:  700,
        temperature: 0.75,
      },
      {
        headers:  { Authorization: `Bearer ${this._getKey()}`, 'Content-Type': 'application/json' },
        timeout:  30000,
      }
    );

    let script = (resp.choices?.[0]?.message?.content || '').trim();
    if (!script) throw new Error('Groq tidak mengembalikan script. Coba lagi.');

    script = script
      .replace(/[*#\[\]()]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/!+/g, '.')
      .replace(/\?+/g, '.')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();

    if (script && !/[.]$/.test(script)) script += '.';

    const wordCount        = script.split(/\s+/).filter(Boolean).length;
    const estimatedSeconds = Math.round((wordCount / 130) * 60);

    return { script, word_count: wordCount, estimated_seconds: estimatedSeconds };
  }

  _buildPropertyBlock(data, listingType) {
    if (listingType === 'primary') {
      const harga = _priceToWords(data.Harga_Format || data.Harga_Mulai);
      const lines = [
        `Jenis           : Proyek Primary (Developer)`,
        `Judul / Nama    : ${data.Nama_Proyek || '-'}`,
        `Developer       : ${data.Nama_Developer || '-'}`,
        `Tipe Properti   : ${data.Tipe_Properti || '-'}`,
        `Harga Mulai     : ${harga || data.Harga_Format || '-'}`,
        `Cara Bayar      : ${data.Cara_Bayar || '-'}`,
        `Lokasi          : ${[data.Kecamatan, data.Kota].filter(Boolean).join(', ') || '-'}`,
        data.Deskripsi ? `Deskripsi       : ${data.Deskripsi}` : null,
      ].filter(Boolean);
      return `DATA PROPERTI:\n${lines.join('\n')}`;
    }

    const harga = _priceToWords(data.Harga_Format || data.Harga);
    const status = _statusTx(data.Status_Transaksi);

    const specs = [
      data.Luas_Tanah    ? `luas tanah ${_numWords(parseInt(data.Luas_Tanah) || 0)} meter persegi`    : null,
      data.Luas_Bangunan ? `luas bangunan ${_numWords(parseInt(data.Luas_Bangunan) || 0)} meter persegi` : null,
      data.Kamar_Tidur   ? `${_numWords(parseInt(data.Kamar_Tidur) || 0)} kamar tidur`   : null,
      data.Kamar_Mandi   ? `${_numWords(parseInt(data.Kamar_Mandi) || 0)} kamar mandi`   : null,
    ].filter(Boolean).join(', ');

    const lines = [
      `Judul Listing     : ${data.Judul || '-'}`,
      `Tipe Properti     : ${data.Tipe_Properti || '-'}`,
      `Status Transaksi  : ${status}`,
      `Lokasi            : ${[data.Kecamatan, data.Kota].filter(Boolean).join(', ') || '-'}`,
      `Harga             : ${harga || '-'}`,
      specs ? `Spesifikasi       : ${specs}` : null,
      data.Karakter_Properti ? `Kelebihan Utama   : ${data.Karakter_Properti}` : null,
      data.Deskripsi ? `Deskripsi         : ${data.Deskripsi}` : null,
    ].filter(Boolean);
    return `DATA PROPERTI:\n${lines.join('\n')}`;
  }
}

module.exports = new AIScriptService();
