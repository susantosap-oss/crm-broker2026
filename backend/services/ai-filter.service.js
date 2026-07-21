/**
 * AI Filter Service — Natural Language → Structured Search Filter
 * Menggunakan Groq API (llama-3.3-70b-versatile) untuk mengekstrak
 * parameter filter terstruktur dari query bahasa Indonesia.
 */

const axios = require('axios');

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── System prompt untuk property search di Indonesia ─────────
const SYSTEM_PROMPT = `Kamu adalah AI filter ekstractor untuk website properti Indonesia (Mansion Realty, berbasis di Surabaya, Jawa Timur).

Tugasmu: ekstrak parameter filter terstruktur dari query bahasa Indonesia, lalu kembalikan HANYA JSON valid tanpa teks lain.

SCHEMA OUTPUT (semua field opsional — hanya isi yang disebutkan):
{
  "property_type": string,     // Rumah | Apartemen | Ruko | Kavling | Gudang | Gedung
  "transaction_type": string,  // Jual | Sewa
  "city": string,              // Surabaya | Sidoarjo | Gresik | Malang
  "area": string,              // nama kecamatan/area (cth: Citraland, Rungkut, Wiyung)
  "price_min": number,         // angka rupiah (bukan format teks)
  "price_max": number,         // angka rupiah
  "bedroom_min": number,       // minimum kamar tidur (integer)
  "bathroom_min": number,      // minimum kamar mandi (integer)
  "land_area_min": number,     // luas tanah minimum m²
  "land_area_max": number,     // luas tanah maksimum m²
  "building_area_min": number, // luas bangunan minimum m²
  "building_area_max": number, // luas bangunan maksimum m²
  "keyword": string            // kata kunci tambahan yang tidak masuk field lain
}

ATURAN KONVERSI HARGA:
- "500 juta" = 500000000
- "1 M" / "1 miliar" = 1000000000
- "3,5 M" / "3.5 M" = 3500000000
- "di bawah 1 M" → price_max: 1000000000
- "antara 500 juta sampai 2 M" → price_min: 500000000, price_max: 2000000000
- "maksimal 800 juta" → price_max: 800000000

ATURAN TIPE PROPERTI:
- rumah / house / hunian → "Rumah"
- apartemen / apt / unit → "Apartemen"
- ruko / toko / usaha → "Ruko"
- kavling / tanah / lahan → "Kavling"
- gudang / warehouse → "Gudang"
- gedung / kantor / office → "Gedung"

ATURAN TRANSAKSI:
- jual / beli / dijual / mau beli → "Jual"
- sewa / kontrak / rental / ngontrak / menyewa → "Sewa"

ATURAN LOKASI:
- Kata seperti "di", "daerah", "kawasan", "area", "sekitar" sebelum nama lokasi → masuk ke field "area"
- Jika menyebut nama kota (Surabaya, Sidoarjo, Gresik, Malang) → masuk "city"
- Nama cluster/perumahan (Citraland, Pakuwon, Graha, dll) → masuk "area"

CONTOH:
Input: "rumah 3 kamar di Citraland harga di bawah 3 M"
Output: {"property_type":"Rumah","area":"Citraland","price_max":3000000000,"bedroom_min":3}

Input: "cari ruko dijual di Surabaya Barat"
Output: {"property_type":"Ruko","transaction_type":"Jual","city":"Surabaya","area":"Surabaya Barat"}

Input: "apartemen sewa 2 kamar Gubeng"
Output: {"property_type":"Apartemen","transaction_type":"Sewa","area":"Gubeng","bedroom_min":2}

Input: "tanah kavling 200-300m2 sidoarjo"
Output: {"property_type":"Kavling","city":"Sidoarjo","land_area_min":200,"land_area_max":300}

Kembalikan HANYA JSON. Tidak ada penjelasan, tidak ada markdown, tidak ada teks lain.`;

// ── Validator: pastikan output AI adalah filter yang valid ────
const VALID_PROP_TYPES = ['Rumah', 'Apartemen', 'Ruko', 'Kavling', 'Gudang', 'Gedung'];
const VALID_TX_TYPES   = ['Jual', 'Sewa'];
const VALID_CITIES     = ['Surabaya', 'Sidoarjo', 'Gresik', 'Malang'];

function sanitizeFilter(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const out = {};

  if (raw.property_type && VALID_PROP_TYPES.includes(raw.property_type)) {
    out.property_type = raw.property_type;
  }
  if (raw.transaction_type && VALID_TX_TYPES.includes(raw.transaction_type)) {
    out.transaction_type = raw.transaction_type;
  }
  if (raw.city && VALID_CITIES.some(c => raw.city.toLowerCase().includes(c.toLowerCase()))) {
    out.city = VALID_CITIES.find(c => raw.city.toLowerCase().includes(c.toLowerCase()));
  }
  if (raw.area && typeof raw.area === 'string' && raw.area.length > 0) {
    out.area = raw.area.trim();
  }

  const nums = ['price_min','price_max','bedroom_min','bathroom_min',
                 'land_area_min','land_area_max','building_area_min','building_area_max'];
  for (const k of nums) {
    const v = Number(raw[k]);
    if (!isNaN(v) && v > 0) out[k] = v;
  }

  if (raw.keyword && typeof raw.keyword === 'string' && raw.keyword.trim()) {
    out.keyword = raw.keyword.trim();
  }

  return out;
}

// ── Main extract function ─────────────────────────────────────
async function extractFilter(query) {
  if (!query || !query.trim()) return { filter: {}, raw_query: query };

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[AI Filter] GROQ_API_KEY tidak di-set — fallback ke keyword search');
    return { filter: { keyword: query }, raw_query: query, fallback: true };
  }

  try {
    const response = await axios.post(GROQ_URL, {
      model:       GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: query.trim() },
      ],
      temperature:  0.1,
      max_tokens:   300,
      response_format: { type: 'json_object' },
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    });

    const text = response.data?.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn('[AI Filter] JSON parse gagal, fallback ke keyword:', text);
      return { filter: { keyword: query }, raw_query: query, fallback: true };
    }

    const filter = sanitizeFilter(parsed);
    return { filter, raw_query: query, ai_extracted: parsed };

  } catch (err) {
    const status = err.response?.status;
    if (status === 429) {
      console.warn('[AI Filter] Rate limit Groq — fallback ke keyword');
    } else {
      console.error('[AI Filter] Error Groq API:', err.message);
    }
    return { filter: { keyword: query }, raw_query: query, fallback: true };
  }
}

module.exports = { extractFilter };
