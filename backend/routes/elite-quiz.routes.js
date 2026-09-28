const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const quizSvc = require('../services/elite-quiz.service');

const MANAGE_ROLES = ['superadmin', 'principal', 'kantor', 'admin'];

router.use(authMiddleware);

// POST /submit — simpan hasil quiz (semua role)
router.post('/submit', async (req, res) => {
  try {
    const { nilai, persen, status, waktuDetik, jawabanJson } = req.body;
    if (nilai === undefined || !status) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    }
    const result = await quizSvc.submitQuiz(
      { nilai: parseInt(nilai), persen: parseInt(persen), status, waktuDetik, jawabanJson },
      req.user
    );
    res.json({ success: true, data: result, message: 'Hasil quiz tersimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /my-results — hasil quiz milik sendiri
router.get('/my-results', async (req, res) => {
  try {
    const results = await quizSvc.getMyResults(req.user.id);
    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /results — semua hasil (manage roles only)
router.get('/results', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    const results = await quizSvc.getAllResults();
    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /summary — ringkasan per agen (manage roles only)
router.get('/summary', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    const data = await quizSvc.getSummaryByAgent();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
