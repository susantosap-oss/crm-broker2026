/**
 * Auth Routes - /api/v1/auth
 * ============================================
 * JWT berisi: id, nama, email, role, team_id
 */
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware } = require('../middleware/auth.middleware');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email dan password harus diisi' });

    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const [, ...agents] = rows;

    // Cari berdasarkan email (kolom C = index 2)
    const agentRow = agents.find(row => row[2]?.toLowerCase() === email.toLowerCase());
    if (!agentRow)
      return res.status(401).json({ success: false, message: 'Email tidak terdaftar' });

    // Status harus Aktif (kolom G = index 6)
    if (agentRow[6] !== 'Aktif')
      return res.status(403).json({ success: false, message: 'Akun tidak aktif' });

    const validPass = await bcrypt.compare(password, agentRow[3]); // Password_Hash
    if (!validPass)
      return res.status(401).json({ success: false, message: 'Password salah' });

    // Build user object sesuai COLUMNS.AGENTS
    const agentObj = COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = agentRow[i] || ''; return obj; }, {});

    const user = {
      id:      agentObj.ID,
      nama:    agentObj.Nama,
      email:   agentObj.Email,
      role:    agentObj.Role || 'agen',
      team_id: agentObj.Team_ID || '',
      no_wa:   agentObj.No_WA  || '',
    };

    const token = jwt.sign(user, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    // Log last login (non-blocking)
    sheetsService.findRowById(SHEETS.AGENTS, user.id).then(result => {
      if (result) {
        const row = [...result.data];
        const lastLoginIdx = COLUMNS.AGENTS.indexOf('Last_Login');
        if (lastLoginIdx >= 0) row[lastLoginIdx] = new Date().toISOString();
        sheetsService.updateRow(SHEETS.AGENTS, result.rowIndex, row);
      }
    }).catch(() => {});

    res.json({ success: true, data: { token, user } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ success: true, data: req.user });
});

module.exports = router;
