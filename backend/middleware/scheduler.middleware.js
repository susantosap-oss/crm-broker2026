module.exports = function schedulerAuth(req, res, next) {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret || req.headers['x-scheduler-secret'] !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};
