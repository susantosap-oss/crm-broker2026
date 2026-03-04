// media.routes.js
const express = require('express');
const router  = express.Router();
const cloudinaryService = require('../services/cloudinary.service');
const { authMiddleware } = require('../middleware/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: '/tmp/uploads/' });

router.use(authMiddleware);

router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const { listingId } = req.body;
    const uploads = await cloudinaryService.uploadMultiple(req.files, listingId || 'general');
    res.json({ success: true, data: uploads });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:publicId', async (req, res) => {
  try {
    const result = await cloudinaryService.delete(decodeURIComponent(req.params.publicId));
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
