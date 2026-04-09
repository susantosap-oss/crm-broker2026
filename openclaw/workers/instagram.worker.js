/**
 * Instagram Worker — Reels & Story Poster
 * ============================================
 * Human-like Playwright automation untuk posting Reels/Story ke Instagram.
 *
 * BATASAN HARIAN:
 *   - Maks 5 Ads per agen per hari
 *   - Cek counter di payload sebelum eksekusi
 *
 * ANTI-BOT:
 *   - Random viewport (mobile 390×844 ± variasi)
 *   - User-Agent mobile acak
 *   - Bezier mouse movement (humanMouse.js)
 *   - Jeda 30–120 detik antar aksi besar
 *   - Disable WebDriver flag
 *
 * FLOW:
 *   1. Load session dari GCS (atau login ulang jika tidak ada)
 *   2. Download video dari Cloudinary ke tmpdir
 *   3. Navigate ke Instagram → Create → Upload → Caption → Share
 *   4. Simpan session baru ke GCS
 *   5. Report log ke CRM callback
 */

const { chromium } = require('playwright');
const sessionManager = require('../utils/sessionManager');
const { humanClick, humanType, humanScroll, sleep, humanPause, shortPause } = require('../utils/humanMouse');
const taskQueue = require('../utils/taskQueue');
const axios = require('axios');
const path  = require('path');
const fs    = require('fs/promises');
const os    = require('os');

// User-Agent pool (mobile Chrome)
const UA_POOL = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; Samsung Galaxy S23) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
];

// Viewport variations (mobile portrait)
const VIEWPORTS = [
  { width: 390, height: 844 },   // iPhone 14
  { width: 393, height: 851 },   // Pixel 8
  { width: 412, height: 915 },   // Samsung Galaxy
  { width: 375, height: 812 },   // iPhone X
];

async function run(job) {
  const { job_id, agent_id, payload } = job;
  const {
    video_url,        // URL video dari Cloudinary
    caption,          // Caption teks
    listing_id,
    listing_title,
    type = 'reels',   // 'reels' | 'story'
    today_count = 0,  // berapa kali posting hari ini (dari CRM)
    ig_username,      // username IG agen
    ig_password,      // password terenkripsi (CRM sudah decrypt sebelum kirim)
    ads_daily_limit = 5,
  } = payload;

  // ── Guard: Daily Limit ────────────────────────────────────
  if (today_count >= ads_daily_limit) {
    throw new Error(`Daily limit reached: ${today_count}/${ads_daily_limit} ads today`);
  }

  _log(job_id, `Starting ${type.toUpperCase()} post for listing ${listing_id}`);

  // ── Download video ke tmpdir ──────────────────────────────
  const videoPath = await _downloadVideo(video_url, listing_id);
  _log(job_id, `Video downloaded: ${path.basename(videoPath)}`);

  // ── Browser Setup ─────────────────────────────────────────
  const ua       = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
  // Sedikit variasi viewport (+/- 10px)
  viewport.width  += Math.floor((Math.random() - 0.5) * 20);
  viewport.height += Math.floor((Math.random() - 0.5) * 20);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=420,900',
      '--lang=id-ID',
    ],
  });

  const context = await browser.newContext({
    userAgent: ua,
    viewport,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    permissions: ['notifications'],
    // Sembunyikan WebDriver flag
    extraHTTPHeaders: { 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' },
  });

  // Inject script untuk hilangkan navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US'] });
    window.chrome = { runtime: {} };
  });

  let page;
  try {
    page = await context.newPage();

    // ── Load Session atau Login ───────────────────────────────
    const sessionPath = await sessionManager.download(agent_id, 'ig');
    if (sessionPath) {
      await context.addCookies(
        JSON.parse(await require('fs/promises').readFile(sessionPath, 'utf8')).cookies || []
      );
      _log(job_id, 'Session loaded from GCS');
    } else {
      _log(job_id, 'No existing session — performing fresh login');
      await _loginInstagram(page, ig_username, ig_password, job_id);
      await sessionManager.saveFromContext(agent_id, 'ig', context);
      _log(job_id, 'Session saved to GCS');
    }

    // ── Navigate ke Instagram ─────────────────────────────────
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await shortPause(2, 5);

    // Cek apakah masih login
    const isLoggedIn = await page.$('a[href="/direct/inbox/"]') !== null
      || await page.$('[aria-label="Direct"]') !== null
      || await page.$('svg[aria-label="Direct"]') !== null;

    if (!isLoggedIn) {
      _log(job_id, 'Session expired — re-logging in');
      await sessionManager.invalidate(agent_id, 'ig');
      await _loginInstagram(page, ig_username, ig_password, job_id);
      await sessionManager.saveFromContext(agent_id, 'ig', context);
    }

    // ── Upload Reels / Story ──────────────────────────────────
    if (type === 'reels') {
      await _postReels(page, videoPath, caption, listing_title, job_id);
    } else {
      await _postStory(page, videoPath, job_id);
    }

    _log(job_id, `${type.toUpperCase()} posted successfully for listing ${listing_id}`);

  } finally {
    await browser.close();
    // Cleanup video tmp
    await fs.unlink(videoPath).catch(() => {});
  }
}

// ── Login Flow ────────────────────────────────────────────
async function _loginInstagram(page, username, password, jobId) {
  _log(jobId, 'Navigating to Instagram login...');
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
  await humanPause(3, 6);

  // Terima cookies jika muncul
  const cookieBtn = await page.$('button:has-text("Allow essential")');
  if (cookieBtn) await humanClick(page, 'button:has-text("Allow essential")');

  await humanType(page, 'input[name="username"]', username);
  await shortPause(1, 2);
  await humanType(page, 'input[name="password"]', password);
  await shortPause(1, 3);

  await humanClick(page, 'button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await shortPause(3, 6);

  // Cek challenge / 2FA
  const url = page.url();
  if (url.includes('challenge') || url.includes('two_factor')) {
    throw new Error('CHALLENGE_REQUIRED: Login memerlukan verifikasi tambahan. Silakan re-pair di Dashboard PA.');
  }

  // Dismiss "Save Login Info" popup
  const notNowBtn = await page.$('button:has-text("Not Now")');
  if (notNowBtn) await humanClick(page, 'button:has-text("Not Now")');

  // Dismiss notification prompt
  const notNow2 = await page.$('button:has-text("Not Now")');
  if (notNow2) await humanClick(page, 'button:has-text("Not Now")');

  _log(jobId, 'Login successful');
}

// ── Post Reels ────────────────────────────────────────────
async function _postReels(page, videoPath, caption, listingTitle, jobId) {
  _log(jobId, 'Opening Create menu...');

  // Klik tombol Create (+)
  await humanClick(page, 'svg[aria-label="New post"], a[href="/create/style/"]');
  await shortPause(2, 4);

  // Pilih "Reel" dari menu
  const reelOption = await page.$('button:has-text("Reel"), span:has-text("Reel")');
  if (reelOption) {
    await humanClick(page, 'button:has-text("Reel"), span:has-text("Reel")');
    await shortPause(1, 3);
  }

  // Upload file
  _log(jobId, 'Uploading video file...');
  const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
  await fileInput.setInputFiles(videoPath);
  _log(jobId, 'Video upload initiated, waiting for processing...');

  // Tunggu Instagram processing video (bisa 30–120 detik)
  await page.waitForSelector('[aria-label="Next"], button:has-text("Next")', { timeout: 180000 });
  _log(jobId, 'Video processed by Instagram');
  await shortPause(2, 5);

  // Klik Next
  await humanClick(page, '[aria-label="Next"], button:has-text("Next")');
  await shortPause(2, 4);

  // Mungkin ada step Edit lagi (trim/cover)
  const nextBtn2 = await page.$('button:has-text("Next")');
  if (nextBtn2) {
    await humanClick(page, 'button:has-text("Next")');
    await shortPause(2, 4);
  }

  // ── Isi Caption ───────────────────────────────────────────
  _log(jobId, 'Typing caption...');
  const captionArea = await page.$('textarea[aria-label="Write a caption..."], div[contenteditable="true"]');
  if (captionArea) {
    await captionArea.click();
    await shortPause(1, 2);
    // Ketik karakter per karakter untuk human-like
    for (const char of caption) {
      await page.keyboard.type(char);
      await sleep(40 + Math.random() * 80);
    }
  }

  await humanPause(3, 8); // Pause seperti orang review caption

  // ── Share ─────────────────────────────────────────────────
  _log(jobId, 'Clicking Share...');
  await humanClick(page, 'button:has-text("Share"), div[role="button"]:has-text("Share")');

  // Tunggu konfirmasi posted
  await page.waitForSelector('div:has-text("Reel shared"), span:has-text("Your reel has been shared")', {
    timeout: 60000
  });

  _log(jobId, `Reels untuk "${listingTitle}" berhasil di-share!`);
  await shortPause(3, 6);
}

// ── Post Story ────────────────────────────────────────────
async function _postStory(page, videoPath, jobId) {
  _log(jobId, 'Navigating to Story creator...');

  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await shortPause(2, 4);

  // Klik "Your Story" atau Create Story
  const storyBtn = await page.$('[aria-label="New story"], a[href="/stories/create/"]');
  if (storyBtn) await storyBtn.click();

  const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
  await fileInput.setInputFiles(videoPath);

  await page.waitForSelector('button:has-text("Add to story"), button:has-text("Share")', { timeout: 120000 });
  await shortPause(2, 4);

  await humanClick(page, 'button:has-text("Add to story"), button:has-text("Share")');
  await shortPause(3, 5);

  _log(jobId, 'Story posted successfully');
}

// ── Download Video ke tmpdir ──────────────────────────────
async function _downloadVideo(videoUrl, listingId) {
  const filename  = `ig_video_${listingId}_${Date.now()}.mp4`;
  const localPath = path.join(os.tmpdir(), filename);

  const response = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
  await fs.writeFile(localPath, response.data);
  return localPath;
}

function _log(jobId, message) {
  taskQueue.addLog(jobId, message);
}

module.exports = { run };
