/**
 * Push Notification Service
 * Manages web push subscriptions and sending notifications.
 * Uses web-push (VAPID) + Google Sheets for persistent subscription storage.
 * In-memory cache as write-through layer to avoid redundant Sheets reads.
 */

const webpush = require('web-push');
const crypto  = require('crypto');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:admin@mansion.co.id';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Lazy-load untuk menghindari circular dependency saat init
function getSheets() {
  return require('./sheets.service');
}
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// Endpoint hash — dipakai sebagai bagian ID row (aman untuk Sheets)
function endpointHash(endpoint) {
  return crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 12);
}

// In-memory write-through cache: { userId: [subscriptionObj, ...] }
const _cache = {};
let _loaded  = false;

class PushService {
  getVapidPublicKey() {
    return VAPID_PUBLIC;
  }

  // ── Load semua subscriptions dari Sheets ke memory (dipanggil saat startup) ──
  async loadSubscriptions() {
    try {
      const rows = await getSheets().getRows(SHEETS.PUSH_SUBSCRIPTIONS);
      const toObj = (row) => COLUMNS.PUSH_SUBSCRIPTIONS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
      for (const row of rows) {
        const r = toObj(row);
        if (!r.User_ID || !r.Endpoint) continue;
        if (!_cache[r.User_ID]) _cache[r.User_ID] = [];
        // Hindari duplikat saat reload
        if (!_cache[r.User_ID].find(s => s.endpoint === r.Endpoint)) {
          _cache[r.User_ID].push({
            endpoint: r.Endpoint,
            keys: { auth: r.Auth, p256dh: r.P256dh },
          });
        }
      }
      _loaded = true;
      const total = Object.values(_cache).reduce((n, arr) => n + arr.length, 0);
      console.log(`[PUSH] Loaded ${total} subscriptions dari Sheets`);
    } catch (e) {
      console.warn('[PUSH] Gagal load subscriptions dari Sheets:', e.message);
    }
  }

  // ── Subscribe — upsert ke Sheets + update cache ───────────
  async subscribe(userId, subscription) {
    if (!userId || !subscription?.endpoint) return;

    const endpoint = subscription.endpoint;
    const auth     = subscription.keys?.auth   || '';
    const p256dh   = subscription.keys?.p256dh || '';
    const rowId    = `${userId}:${endpointHash(endpoint)}`;
    const now      = new Date().toISOString();

    // Cek apakah endpoint sudah ada di Sheets
    let existingRowIndex = -1;
    try {
      const all = await getSheets().getRange(SHEETS.PUSH_SUBSCRIPTIONS);
      existingRowIndex = all.findIndex((row, i) => i > 0 && row[0] === rowId);
    } catch (_) {}

    if (existingRowIndex > 0) {
      // Update hanya kolom keys + Updated_At, biarkan Created_At tidak berubah
      await getSheets().updateRowCells(SHEETS.PUSH_SUBSCRIPTIONS, existingRowIndex + 1, {
        3: auth,
        4: p256dh,
        6: now,
      });
    } else {
      // Append row baru
      await getSheets().appendRow(SHEETS.PUSH_SUBSCRIPTIONS, [
        rowId, userId, endpoint, auth, p256dh, now, now,
      ]);
    }

    // Update cache
    if (!_cache[userId]) _cache[userId] = [];
    const existing = _cache[userId].find(s => s.endpoint === endpoint);
    if (!existing) {
      _cache[userId].push({ endpoint, keys: { auth, p256dh } });
    } else {
      existing.keys = { auth, p256dh };
    }
  }

  // ── Unsubscribe — hapus dari Sheets + cache ───────────────
  async unsubscribe(userId, endpoint) {
    const rowId = `${userId}:${endpointHash(endpoint)}`;
    try {
      const all = await getSheets().getRange(SHEETS.PUSH_SUBSCRIPTIONS);
      const rowIndex = all.findIndex((row, i) => i > 0 && row[0] === rowId);
      if (rowIndex > 0) {
        await getSheets().deleteRow(SHEETS.PUSH_SUBSCRIPTIONS, rowIndex + 1);
      }
    } catch (e) {
      console.warn('[PUSH] unsubscribe Sheets error:', e.message);
    }
    if (_cache[userId]) {
      _cache[userId] = _cache[userId].filter(s => s.endpoint !== endpoint);
    }
  }

  // ── Send ke satu user ─────────────────────────────────────
  async sendToUser(userId, payload) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.warn('[PUSH] VAPID keys not configured — skipping push');
      return;
    }
    const subs = _cache[userId] || [];
    const dead = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          dead.push(sub.endpoint);
        } else {
          console.error('[PUSH] Send error:', e.message);
        }
      }
    }

    // Hapus expired subscriptions dari Sheets + cache
    for (const ep of dead) {
      await this.unsubscribe(userId, ep).catch(() => {});
    }
  }

  async sendToUsers(userIds, payload) {
    await Promise.allSettled(userIds.map(uid => this.sendToUser(uid, payload)));
  }

  getUserSubscriptionCount(userId) {
    return (_cache[userId] || []).length;
  }
}

module.exports = new PushService();
