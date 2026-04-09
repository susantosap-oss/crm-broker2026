/**
 * WhatsApp Worker — WA Blast via WhatsApp Web
 * ============================================
 * Mengirim pesan massal (broadcast) ke nomor/grup WhatsApp
 * menggunakan Playwright + WhatsApp Web (wa.me / web.whatsapp.com).
 *
 * KAPASITAS:
 *   - 5 nomor per sesi
 *   - Maks 2 sesi per hari (total 10 nomor/hari per agen)
 *
 * SAFETY (Anti-ban):
 *   - Simulasi 'typing...' 3–7 detik sebelum kirim
 *   - Jeda 20–60 detik antar nomor
 *   - Session persistent via GCS
 *
 * FLOW:
 *   1. Load WA Web session dari GCS
 *   2. Jika tidak ada → tampilkan QR code untuk pairing (kirim ke dashboard)
 *   3. Buka chat per nomor → simulasi typing → kirim pesan
 *   4. Simpan session baru ke GCS
 */

const { chromium } = require('playwright');
const sessionManager = require('../utils/sessionManager');
const { humanClick, humanType, sleep, humanPause, shortPause } = require('../utils/humanMouse');
const taskQueue = require('../utils/taskQueue');
const axios = require('axios');
const path  = require('path');
const fs    = require('fs/promises');

// Batas per session / per hari
const MAX_PER_SESSION = 5;
const MAX_SESSIONS_PER_DAY = 2;

async function run(job) {
  const { job_id, agent_id, payload } = job;
  const {
    recipients,         // Array of { nomor: "62812xxx", type: "personal"|"group", group_id? }
    message_template,   // String pesan (sudah di-interpolate oleh CRM)
    session_number = 1, // Sesi ke-berapa hari ini (1 atau 2)
    listing_id,
    listing_title,
  } = payload;

  // ── Guard: Batas ─────────────────────────────────────────
  if (session_number > MAX_SESSIONS_PER_DAY) {
    throw new Error(`Session limit reached: ${session_number}/${MAX_SESSIONS_PER_DAY} sessions today`);
  }

  const targets = recipients.slice(0, MAX_PER_SESSION);
  _log(job_id, `WA Blast: ${targets.length} recipients | Session ${session_number}/${MAX_SESSIONS_PER_DAY}`);

  // ── Browser ───────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=id-ID'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  });

  let page;
  let qrRequired = false;

  try {
    page = await context.newPage();

    // ── Load Session ──────────────────────────────────────────
    const sessionPath = await sessionManager.download(agent_id, 'wa');
    if (sessionPath) {
      const state = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
      await context.addCookies(state.cookies || []);
      _log(job_id, 'WA session loaded from GCS');
    }

    // ── Buka WhatsApp Web ─────────────────────────────────────
    await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Tunggu sampai loading selesai (QR muncul atau chat list muncul)
    try {
      await page.waitForSelector('[data-testid="chat-list"], canvas[aria-label="Scan this QR code"]', {
        timeout: 30000
      });
    } catch {
      throw new Error('WA Web tidak load dengan benar');
    }

    // Cek apakah QR code muncul (perlu pairing ulang)
    const qrCanvas = await page.$('canvas[aria-label="Scan this QR code"]');
    if (qrCanvas) {
      _log(job_id, 'QR_REQUIRED: WA Web memerlukan re-pairing');
      qrRequired = true;

      // Screenshot QR dan kirim ke CRM untuk ditampilkan ke agen
      const qrScreenshot = await qrCanvas.screenshot();
      await _sendQRToCRM(agent_id, qrScreenshot);
      throw new Error('QR_REQUIRED: Silakan scan QR code di Dashboard PA untuk pairing WhatsApp');
    }

    // ── Tunggu Chat List siap ─────────────────────────────────
    await page.waitForSelector('[data-testid="chat-list"]', { timeout: 30000 });
    _log(job_id, 'WA Web ready');
    await shortPause(2, 4);

    // ── Kirim ke setiap recipient ─────────────────────────────
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const recipient = targets[i];
      _log(job_id, `Sending to ${recipient.nomor} (${i+1}/${targets.length})...`);

      try {
        if (recipient.type === 'group' && recipient.group_id) {
          await _sendToGroup(page, recipient.group_id, message_template, job_id);
        } else {
          await _sendToNumber(page, recipient.nomor, message_template, job_id);
        }
        results.push({ nomor: recipient.nomor, status: 'sent' });
        _log(job_id, `Sent to ${recipient.nomor}`);
      } catch (err) {
        results.push({ nomor: recipient.nomor, status: 'failed', error: err.message });
        _log(job_id, `Failed to send to ${recipient.nomor}: ${err.message}`);
      }

      // Jeda antar nomor (20–60 detik) — anti-ban
      if (i < targets.length - 1) {
        const delay = 20000 + Math.random() * 40000;
        _log(job_id, `Waiting ${(delay/1000).toFixed(1)}s before next recipient...`);
        await sleep(delay);
      }
    }

    // ── Simpan Session ────────────────────────────────────────
    await sessionManager.saveFromContext(agent_id, 'wa', context);
    _log(job_id, 'WA session saved to GCS');

    const sentCount = results.filter(r => r.status === 'sent').length;
    _log(job_id, `WA Blast selesai: ${sentCount}/${targets.length} pesan terkirim`);

    return results;

  } finally {
    await browser.close();
  }
}

// ── Kirim ke Nomor Personal ───────────────────────────────
async function _sendToNumber(page, nomor, message, jobId) {
  // Format nomor (hilangkan +, 0 → 62)
  let formatted = nomor.replace(/\D/g, '');
  if (formatted.startsWith('0')) formatted = '62' + formatted.slice(1);
  if (!formatted.startsWith('62')) formatted = '62' + formatted;

  // Buka via URL langsung
  await page.goto(`https://web.whatsapp.com/send?phone=${formatted}`, {
    waitUntil: 'domcontentloaded', timeout: 20000
  });

  // Tunggu chat terbuka
  await page.waitForSelector('[data-testid="conversation-compose-box-input"]', { timeout: 20000 });
  await shortPause(2, 4);

  // Simulasi typing... (3–7 detik)
  await _simulateTyping(page, message, jobId);

  // Kirim
  await page.keyboard.press('Enter');
  await shortPause(1, 3);
}

// ── Kirim ke Grup WA ──────────────────────────────────────
async function _sendToGroup(page, groupId, message, jobId) {
  // Group ID format: "120363xxxxxxx@g.us" — buka via search/link
  // WhatsApp Web tidak punya URL langsung ke grup, gunakan search
  _log(jobId, `Searching for group ${groupId}...`);

  const searchBtn = await page.$('[data-testid="chat-list-search"]');
  if (searchBtn) {
    await humanClick(page, '[data-testid="chat-list-search"]');
    await shortPause(1, 2);
    // Cari nama grup (groupId di payload bisa berupa nama atau ID)
    await page.keyboard.type(groupId);
    await shortPause(2, 3);

    const firstResult = await page.waitForSelector('[data-testid="cell-frame-title"]', { timeout: 10000 });
    if (firstResult) {
      await firstResult.click();
      await shortPause(2, 4);
    }
  }

  await page.waitForSelector('[data-testid="conversation-compose-box-input"]', { timeout: 15000 });
  await _simulateTyping(page, message, jobId);
  await page.keyboard.press('Enter');
  await shortPause(1, 3);
}

// ── Simulasi Typing (3–7 detik) ──────────────────────────
async function _simulateTyping(page, message, jobId) {
  const inputBox = await page.$('[data-testid="conversation-compose-box-input"]');
  if (!inputBox) throw new Error('Input box tidak ditemukan');

  await inputBox.click();
  await shortPause(0.5, 1);

  // Typing indicator muncul saat kita benar-benar mengetik
  const typingDuration = 3000 + Math.random() * 4000; // 3–7 detik
  const chars = message.split('');
  const msPerChar = typingDuration / chars.length;

  _log(jobId, `Simulating typing for ${(typingDuration/1000).toFixed(1)}s...`);

  for (const char of chars) {
    if (char === '\n') {
      await page.keyboard.press('Shift+Enter');
    } else {
      await page.keyboard.type(char);
    }
    await sleep(msPerChar * (0.7 + Math.random() * 0.6));
  }
}

// ── Kirim QR Screenshot ke CRM ───────────────────────────
async function _sendQRToCRM(agentId, screenshotBuffer) {
  if (!process.env.CRM_CALLBACK_URL) return;
  try {
    await axios.post(`${process.env.CRM_CALLBACK_URL}/api/v1/pa/qr-required`, {
      agent_id: agentId,
      platform: 'wa',
      qr_image: screenshotBuffer.toString('base64'),
      message: 'WhatsApp Web memerlukan re-pairing. Scan QR code di bawah.',
    }, {
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      timeout: 10000
    });
  } catch (e) {
    console.warn('[WA Worker] Failed to send QR to CRM:', e.message);
  }
}

function _log(jobId, message) {
  taskQueue.addLog(jobId, message);
}

module.exports = { run };
