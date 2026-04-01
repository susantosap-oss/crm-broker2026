/**
 * Auth Middleware
 * ============================================
 * JWT verification & Role-based access control.
 * Roles: superadmin | principal | business_manager | admin | agen
 */

const jwt = require('jsonwebtoken');
const { ROLE_LEVEL } = require('../config/sheets.config');


// Force Logout Cache (baca CONFIG sheet, cache 2 menit)
let _flCache = { ts: 0, val: 0 };
async function getForceLogoutAt() {
  const now = Date.now();
  if (now - _flCache.ts < 120000) return _flCache.val;
  try {
    const ss = require('../services/sheets.service');
    const { SHEETS } = require('../config/sheets.config');
    const rows = await ss.getRange(SHEETS.CONFIG);
    const row  = (rows||[]).find(r => r[0] === 'Force_Logout_All_At');
    _flCache = { ts: now, val: row ? (parseInt(row[1])||0) : 0 };
  } catch { /* pakai cache lama */ }
  return _flCache.val;
}

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
      // Cek force logout
      const flAt = await getForceLogoutAt();
      if (flAt && decoded.iat && (decoded.iat * 1000) < flAt) {
        return res.status(401).json({ success: false, message: 'Sesi diakhiri oleh admin. Silakan login ulang.' });
      }


      next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Sesi berakhir, silakan login ulang' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
};

// Require specific roles
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Role tidak mencukupi.' });
  }
  next();
};

// Require minimum role level
const requireMinRole = (minRole) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const userLevel = ROLE_LEVEL[req.user.role] || 0;
  const minLevel  = ROLE_LEVEL[minRole] || 0;
  if (userLevel < minLevel) {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Level tidak mencukupi.' });
  }
  next();
};

// Helper: apakah user adalah manager level ke atas
const isManager = (role) => ['superadmin', 'principal', 'kantor', 'business_manager', 'admin'].includes(role);
const isPrincipalOrAbove = (role) => ['superadmin', 'principal', 'kantor'].includes(role);

// Public API key middleware
const publicApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.PUBLIC_API_KEY) {
    return res.status(401).json({ success: false, message: 'API Key tidak valid' });
  }
  next();
};

// Self-resource guard
const selfOrAdmin = (req, res, next) => {
  const { user } = req;
  if (isManager(user.role)) return next();
  if (req.params.id === user.id) return next();
  return res.status(403).json({ success: false, message: 'Hanya bisa mengakses data sendiri' });
};

module.exports = {
  authMiddleware,
  requireRole,
  requireMinRole,
  publicApiKey,
  selfOrAdmin,
  isManager,
  isPrincipalOrAbove,
};
