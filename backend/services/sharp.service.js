/**
 * SharpService — Template-based profile photo & business card generator
 * =====================================================================
 * Menggantikan Canva autofill (butuh Enterprise) dengan Sharp lokal.
 *
 * Templates (PNG) ada di frontend/assets/template_profile/:
 *   foto_profile.png  — 320×320, circle placeholder tengah
 *   Bisnis_Card.png   — 600×1050, circle atas + nama + WA
 *
 * Flow:
 *   1. Resize + circular-crop foto agen
 *   2. Composite ke atas template PNG
 *   3. (Bisnis card) Overlay SVG teks: nama + nomor WA
 *   4. Return PNG Buffer → upload Cloudinary
 */

const sharp = require('sharp');
const path  = require('path');

const TPL_DIR = path.join(__dirname, '../../frontend/assets/template_profile');

// ── Layout constants ─────────────────────────────────────────────────────────
// foto_profile.png  320×320, center (160,160)
//   whiteR : 138 — white fill covers template crosshatch (inside gold ring), photoR+2px gap
//   photoR : 136 — circular photo (85% of 320px canvas → diameter 272px)
const PROFILE = { W: 320, H: 320, cx: 160, cy: 160, whiteR: 138, photoR: 136 };

// Bisnis_Card.png  600×1050
//   photo circle   : center (300,263), r=128
//   nama agen text : center x=300, y=467
//   WA number text : start x=192, y=542
const BISCARD = {
  W: 600, H: 1050,
  cx: 300, cy: 263, r: 128,
  nameCx: 300, nameCy: 467,
  waCx: 192,   waCy: 542,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate foto profil agen di atas template Mansion.
 * Menambahkan arc text: nama agen (atas) + nama kantor (bawah), mengikuti lingkaran.
 *
 * Teknik SVG arc text:
 *   Top  : path CCW right→top→left  + reversed string → teks terbaca kiri-ke-kanan
 *   Bottom: path CCW left→bottom→right + normal string → teks terbaca kiri-ke-kanan
 *
 * @param {Buffer} imageBuffer  — foto agen (JPEG/PNG)
 * @param {string} agentName    — nama agen
 * @param {string} agentKantor  — nama kantor (format: MANSION : {nama})
 * @returns {Buffer}            — PNG hasil composite
 */
async function processProfilePhoto(imageBuffer, agentName = '', agentKantor = '') {
  const { W, H, cx, cy, whiteR, photoR } = PROFILE;

  const circlePhoto = await _circularCrop(imageBuffer, photoR * 2);

  const svgFill = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${whiteR}" fill="white"/>
    </svg>`
  );

  return sharp(path.join(TPL_DIR, 'foto_profile.png'))
    .composite([
      { input: svgFill,     left: 0,          top: 0           },
      { input: circlePhoto, left: cx - photoR, top: cy - photoR },
    ])
    .png()
    .toBuffer();
}

/**
 * Generate bisnis card agen di atas template Mansion.
 * @param {Buffer} imageBuffer  — foto agen (JPEG/PNG)
 * @param {string} agentName    — nama lengkap agen
 * @param {string} agentWa      — nomor WA agen
 * @returns {Buffer}            — PNG hasil composite
 */
async function processBisnisCard(imageBuffer, agentName = '', agentWa = '') {
  const { W, H, cx, cy, r, nameCx, nameCy, waCx, waCy } = BISCARD;
  const circlePhoto = await _circularCrop(imageBuffer, r * 2);

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${nameCx}" y="${nameCy}"
      font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
      font-size="22" font-weight="bold"
      fill="white" text-anchor="middle" dominant-baseline="middle"
      letter-spacing="1"
    >${_esc(agentName)}</text>
    <text x="${waCx}" y="${waCy}"
      font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
      font-size="17"
      fill="white" text-anchor="start" dominant-baseline="middle"
    >${_esc(_fmtWa(agentWa))}</text>
  </svg>`;

  return sharp(path.join(TPL_DIR, 'Bisnis_Card.png'))
    .composite([
      { input: circlePhoto,          left: cx - r, top: cy - r },
      { input: Buffer.from(svg),     left: 0,       top: 0      },
    ])
    .png()
    .toBuffer();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _circularCrop(buffer, size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="white"/>
    </svg>`
  );
  return sharp(buffer)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function _reverseStr(s) {
  return String(s || '').split('').reverse().join('');
}

function _fmtWa(wa) {
  if (!wa) return '';
  return wa.replace(/[^\d+]/g, '');
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { processProfilePhoto, processBisnisCard };
