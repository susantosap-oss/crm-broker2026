/**
 * Notifications Routes — /api/v1/notifications
 * ============================================
 * Notifikasi in-app:
 * - komisi_request: agen ajukan komisi → notif ke principal & BM
 * - buyer_request:  lead ditandai buyer request → notif ke all akun
 * - system:         notif sistem
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

function rowToNotif(row) {
  return COLUMNS.NOTIFICATIONS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
}

// GET /notifications — notif untuk user yang login
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.NOTIFICATIONS);
    if (rows.length < 2) return res.json({ success: true, data: [], unread: 0 });
    const [, ...data] = rows;
    const all = data.map(rowToNotif).filter(n => n.Notif_ID);

    const { id, role, team_id } = req.user;

    // Filter: notif untuk user ini atau role-nya
    const mine = all.filter(n => {
      if (n.To_User_ID === id) return true;
      if (n.To_Role === 'all') return true;
      if (n.To_Role === role) return true;
      if (n.To_Role === 'principal' && role === 'principal') return true;
      if (n.To_Role === 'business_manager' && role === 'business_manager') return true;
      return false;
    });

    // Sort: terbaru dulu
    mine.sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));

    const unread = mine.filter(n => n.Is_Read !== 'TRUE').length;

    res.json({ success: true, data: mine.slice(0, 50), unread });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.NOTIFICATIONS);
    if (rows.length < 2) return res.json({ success: true, count: 0 });
    const [, ...data] = rows;
    const all = data.map(rowToNotif).filter(n => n.Notif_ID);
    const { id, role } = req.user;
    const count = all.filter(n =>
      n.Is_Read !== 'TRUE' &&
      (n.To_User_ID === id || n.To_Role === 'all' || n.To_Role === role)
    ).length;
    res.json({ success: true, count });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /notifications/:id/read — tandai sudah dibaca
router.patch('/:id/read', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.NOTIFICATIONS);
    if (rows.length < 2) return res.json({ success: true });
    const [, ...data] = rows;

    for (let i = 0; i < data.length; i++) {
      const n = rowToNotif(data[i]);
      if (n.Notif_ID === req.params.id) {
        n.Is_Read = 'TRUE';
        const row = COLUMNS.NOTIFICATIONS.map(c => n[c] || '');
        await sheetsService.updateRow(SHEETS.NOTIFICATIONS, i + 2, row);
        break;
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /notifications/read-all — tandai semua sudah dibaca
router.patch('/read-all', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.NOTIFICATIONS);
    if (rows.length < 2) return res.json({ success: true });
    const [, ...data] = rows;
    const { id, role } = req.user;

    for (let i = 0; i < data.length; i++) {
      const n = rowToNotif(data[i]);
      const ismine = n.To_User_ID === id || n.To_Role === 'all' || n.To_Role === role;
      if (ismine && n.Is_Read !== 'TRUE') {
        n.Is_Read = 'TRUE';
        const row = COLUMNS.NOTIFICATIONS.map(c => n[c] || '');
        await sheetsService.updateRow(SHEETS.NOTIFICATIONS, i + 2, row);
      }
    }
    res.json({ success: true, message: 'Semua notif dibaca' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /notifications — buat notif baru (internal helper, bisa dari route lain)
router.post('/', async (req, res) => {
  try {
    const notif = await createNotification(req.body);
    res.status(201).json({ success: true, data: notif });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Helper: createNotification (dipakai route lain) ───────
async function createNotification({ tipe, judul, pesan, from_user_id, from_user_nama, to_user_id = '', to_role = '', link_type = '', link_id = '' }) {
  const notif_id = uuidv4();
  const now = new Date().toISOString();
  const row = COLUMNS.NOTIFICATIONS.map(col => {
    if (col === 'Notif_ID')       return notif_id;
    if (col === 'Tipe')           return tipe;
    if (col === 'Judul')          return judul;
    if (col === 'Pesan')          return pesan;
    if (col === 'From_User_ID')   return from_user_id;
    if (col === 'From_User_Nama') return from_user_nama;
    if (col === 'To_User_ID')     return to_user_id;
    if (col === 'To_Role')        return to_role;
    if (col === 'Is_Read')        return 'FALSE';
    if (col === 'Created_At')     return now;
    if (col === 'Link_Type')      return link_type;
    if (col === 'Link_ID')        return link_id;
    return '';
  });
  await sheetsService.appendRow(SHEETS.NOTIFICATIONS, row);
  return { notif_id, tipe, judul };
}

module.exports = router;
module.exports.createNotification = createNotification;
