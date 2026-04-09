/**
 * OpenClaw PA — Cloud Run Worker
 * ============================================
 * Personal Assistant otonom untuk setiap agen Mansion Properti.
 * Menerima job dari CRM via Cloud Tasks atau direct trigger.
 *
 * ENDPOINTS:
 *   POST /job          ← terima job dari Cloud Tasks (internal)
 *   GET  /health       ← health check (Cloud Run warm-up)
 *   GET  /status/:id   ← status job by ID
 *
 * SECURITY: Semua endpoint internal dilindungi INTERNAL_SECRET header.
 */

const express = require('express');
const taskQueue = require('./utils/taskQueue');
const igWorker  = require('./workers/instagram.worker');
const waWorker  = require('./workers/whatsapp.worker');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '5mb' }));

// ── Internal Auth Middleware ───────────────────────────────
function internalAuth(req, res, next) {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Health Check (Cold Start Warm-up) ─────────────────────
// Cloud Run mengirim traffic ke /health untuk startup probe
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', queue_size: taskQueue.size(), ts: Date.now() });
});

// ── Terima Job dari Cloud Tasks / CRM Backend ─────────────
app.post('/job', internalAuth, async (req, res) => {
  const { job_id, agent_id, type, payload } = req.body;

  if (!job_id || !agent_id || !type) {
    return res.status(400).json({ error: 'Missing required fields: job_id, agent_id, type' });
  }

  const VALID_TYPES = ['ig_reels', 'ig_story', 'wa_blast'];
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid job type. Valid: ${VALID_TYPES.join(', ')}` });
  }

  // Enqueue — respond 202 segera agar Cloud Tasks tidak timeout
  const job = taskQueue.enqueue({ job_id, agent_id, type, payload });
  res.status(202).json({ status: 'queued', job_id: job.job_id });

  // Proses async di background (tidak await di sini)
  _processJob(job).catch(err => {
    console.error(`[OpenClaw] Job ${job_id} FAILED:`, err.message);
    taskQueue.updateStatus(job_id, 'failed', err.message);
  });
});

// ── Status Job ────────────────────────────────────────────
app.get('/status/:job_id', internalAuth, (req, res) => {
  const job = taskQueue.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── Job Processor ─────────────────────────────────────────
async function _processJob(job) {
  taskQueue.updateStatus(job.job_id, 'running');
  console.log(`[OpenClaw] Processing job ${job.job_id} | type=${job.type} | agent=${job.agent_id}`);

  try {
    switch (job.type) {
      case 'ig_reels':
      case 'ig_story':
        await igWorker.run(job);
        break;
      case 'wa_blast':
        await waWorker.run(job);
        break;
    }

    taskQueue.updateStatus(job.job_id, 'completed');
    await _callbackToCRM(job.job_id, 'completed', null);
  } catch (err) {
    taskQueue.updateStatus(job.job_id, 'failed', err.message);
    await _callbackToCRM(job.job_id, 'failed', err.message);
    throw err;
  }
}

// ── Callback ke CRM Backend ───────────────────────────────
async function _callbackToCRM(jobId, status, errorMsg) {
  if (!process.env.CRM_CALLBACK_URL) return;
  try {
    const axios = require('axios');
    await axios.post(`${process.env.CRM_CALLBACK_URL}/api/v1/pa/callback`, {
      job_id: jobId, status, error: errorMsg, ts: new Date().toISOString()
    }, {
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      timeout: 5000
    });
  } catch (e) {
    console.warn('[OpenClaw] Callback failed:', e.message);
  }
}

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🦅 OpenClaw PA Worker`);
  console.log(`🚀 Listening on port ${PORT}`);
  console.log(`📋 Queue ready — awaiting jobs\n`);
});

module.exports = app;
