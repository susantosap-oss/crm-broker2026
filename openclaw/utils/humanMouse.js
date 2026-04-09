/**
 * HumanMouse — Anti-Bot Mouse Movement
 * ============================================
 * Menghasilkan kurva Bezier acak untuk simulasi gerakan mouse
 * yang menyerupai pola manusia asli.
 *
 * Teknik:
 *   - Cubic Bezier dengan 2 control point acak
 *   - Kecepatan tidak konstan (accelerate + decelerate)
 *   - Micro-jitter di titik akhir (tangan gemetar natural)
 *   - Delay antar aksi: variasi 30–120 detik
 */

/**
 * Hasilkan titik-titik di sepanjang kurva Bezier kubik.
 * @param {Object} p0 - start {x, y}
 * @param {Object} p3 - end   {x, y}
 * @param {number} steps - jumlah titik
 */
function bezierPoints(p0, p3, steps = 40) {
  // Control points acak di antara p0 dan p3
  const cp1 = {
    x: p0.x + (p3.x - p0.x) * (0.2 + Math.random() * 0.3),
    y: p0.y + (p3.y - p0.y) * (Math.random() * 0.6 - 0.3),
  };
  const cp2 = {
    x: p0.x + (p3.x - p0.x) * (0.6 + Math.random() * 0.2),
    y: p0.y + (p3.y - p0.y) * (0.4 + Math.random() * 0.6 - 0.3),
  };

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    const mt = 1 - t;

    // B(t) = mt³·p0 + 3mt²t·cp1 + 3mt·t²·cp2 + t³·p3
    points.push({
      x: mt**3 * p0.x + 3*mt**2*t * cp1.x + 3*mt*t**2 * cp2.x + t**3 * p3.x,
      y: mt**3 * p0.y + 3*mt**2*t * cp1.y + 3*mt*t**2 * cp2.y + t**3 * p3.y,
    });
  }
  return points;
}

/**
 * Gerakkan mouse dari posisi sekarang ke target dengan kurva Bezier.
 * @param {Page} page - Playwright page
 * @param {number} toX
 * @param {number} toY
 */
async function moveTo(page, toX, toY) {
  const viewport  = page.viewportSize();
  const currentPos = { x: viewport.width / 2, y: viewport.height / 2 };

  const points = bezierPoints(currentPos, { x: toX, y: toY }, 35 + Math.floor(Math.random() * 20));

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    // Kecepatan: mulai lambat, tengah cepat, akhir lambat (ease-in-out)
    const progress = i / points.length;
    const speed    = 6 + Math.sin(Math.PI * progress) * 10; // 6–16ms per titik
    await page.mouse.move(Math.round(pt.x), Math.round(pt.y));
    await sleep(speed + Math.random() * 4);
  }

  // Micro-jitter di titik akhir (seperti tangan manusia)
  for (let j = 0; j < 3; j++) {
    await page.mouse.move(
      Math.round(toX + (Math.random() - 0.5) * 3),
      Math.round(toY + (Math.random() - 0.5) * 3)
    );
    await sleep(30 + Math.random() * 40);
  }
}

/**
 * Klik dengan delay alami: move → hover pause → click.
 */
async function humanClick(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 15000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // Klik di dalam area elemen (tidak selalu tengah)
  const cx = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const cy = box.y + box.height * (0.3 + Math.random() * 0.4);

  await moveTo(page, cx, cy);
  await sleep(80 + Math.random() * 120); // hover pause
  await page.mouse.click(cx, cy);
}

/**
 * Ketik teks dengan kecepatan acak antar karakter.
 * @param {Page} page
 * @param {string} selector
 * @param {string} text
 */
async function humanType(page, selector, text) {
  await humanClick(page, selector);
  await sleep(200 + Math.random() * 300);

  for (const char of text) {
    await page.keyboard.type(char);
    // WPM ~40–70: delay 50–150ms per karakter
    await sleep(50 + Math.random() * 100);

    // Sesekali pause panjang (seperti manusia berpikir)
    if (Math.random() < 0.05) await sleep(300 + Math.random() * 500);
  }
}

/**
 * Scroll halaman secara alami (step kecil, tidak langsung loncat).
 */
async function humanScroll(page, deltaY) {
  const steps = Math.ceil(Math.abs(deltaY) / 80);
  const dir   = deltaY > 0 ? 1 : -1;

  for (let i = 0; i < steps; i++) {
    const scrollAmount = (60 + Math.random() * 40) * dir;
    await page.mouse.wheel(0, scrollAmount);
    await sleep(40 + Math.random() * 60);
  }
}

/**
 * Delay acak dalam range [min, max] milidetik.
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

/**
 * Delay panjang (antar aksi besar): 30–120 detik.
 * Dengan variasi normal distribution.
 */
async function humanPause(minSec = 30, maxSec = 120) {
  const range = (maxSec - minSec) * 1000;
  const ms    = minSec * 1000 + Math.random() * range;
  console.log(`[HumanMouse] Pausing ${(ms/1000).toFixed(1)}s...`);
  await sleep(ms);
}

/**
 * Delay singkat (antar step dalam satu tugas): 2–8 detik.
 */
async function shortPause(minSec = 2, maxSec = 8) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  await sleep(ms);
}

module.exports = { moveTo, humanClick, humanType, humanScroll, sleep, humanPause, shortPause };
