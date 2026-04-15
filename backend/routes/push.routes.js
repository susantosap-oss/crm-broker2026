/**
 * Push Notification Routes — /api/v1/push
 */

const express   = require('express');
const router    = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const pushService = require('../services/push.service');

// GET /push/vapid-public-key — berikan VAPID public key ke client
router.get('/vapid-public-key', authMiddleware, (req, res) => {
  const key = pushService.getVapidPublicKey();
  if (!key) return res.status(503).json({ success: false, message: 'Push notifications belum dikonfigurasi' });
  res.json({ success: true, publicKey: key });
});

// POST /push/subscribe — simpan subscription user
router.post('/subscribe', authMiddleware, (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) {
    return res.status(400).json({ success: false, message: 'Subscription tidak valid' });
  }
  pushService.subscribe(req.user.id, subscription);
  res.json({ success: true, message: 'Subscription berhasil disimpan' });
});

// DELETE /push/unsubscribe — hapus subscription
router.delete('/unsubscribe', authMiddleware, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) pushService.unsubscribe(req.user.id, endpoint);
  res.json({ success: true });
});

module.exports = router;
