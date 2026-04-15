/**
 * Push Notification Service
 * Manages web push subscriptions and sending notifications.
 * Uses web-push (VAPID) + in-memory subscription store.
 *
 * In production, persist subscriptions to Google Sheets or DB.
 */

const webpush = require('web-push');

// VAPID keys — generate once and store in env
// Run: node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(JSON.stringify(k))"
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:admin@mansion.co.id';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// In-memory store: { userId: [subscription, ...] }
// TODO: migrate to Sheets for persistence across restarts
const _subscriptions = {};

class PushService {
  getVapidPublicKey() {
    return VAPID_PUBLIC;
  }

  subscribe(userId, subscription) {
    if (!userId || !subscription?.endpoint) return;
    if (!_subscriptions[userId]) _subscriptions[userId] = [];

    // Avoid duplicate endpoints
    const exists = _subscriptions[userId].find(s => s.endpoint === subscription.endpoint);
    if (!exists) {
      _subscriptions[userId].push(subscription);
    } else {
      // Update keys in case they changed
      Object.assign(exists, subscription);
    }
  }

  unsubscribe(userId, endpoint) {
    if (!_subscriptions[userId]) return;
    _subscriptions[userId] = _subscriptions[userId].filter(s => s.endpoint !== endpoint);
  }

  async sendToUser(userId, payload) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.warn('[PUSH] VAPID keys not configured — skipping push');
      return;
    }
    const subs = _subscriptions[userId] || [];
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

    // Remove expired subscriptions
    if (dead.length) {
      _subscriptions[userId] = (_subscriptions[userId] || []).filter(s => !dead.includes(s.endpoint));
    }
  }

  async sendToUsers(userIds, payload) {
    await Promise.allSettled(userIds.map(uid => this.sendToUser(uid, payload)));
  }

  getUserSubscriptionCount(userId) {
    return (_subscriptions[userId] || []).length;
  }
}

module.exports = new PushService();
