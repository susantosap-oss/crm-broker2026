/**
 * TaskQueue — In-Memory Job Queue untuk OpenClaw PA
 * ============================================
 * Cloud Run berjalan satu instance per job (min-instances=1).
 * Queue ini cukup untuk serialisasi job agar browser tidak crash
 * akibat multiple Playwright instance berjalan bersamaan.
 *
 * MAX_CONCURRENT: 1 (satu browser session dalam satu waktu)
 * Retention: job history disimpan 2 jam lalu di-prune otomatis.
 */

class TaskQueue {
  constructor() {
    this._jobs = new Map();       // job_id → job object
    this.MAX_HISTORY_MS = 2 * 60 * 60 * 1000; // 2 jam

    // Auto-prune setiap 30 menit
    setInterval(() => this._prune(), 30 * 60 * 1000);
  }

  enqueue({ job_id, agent_id, type, payload }) {
    const job = {
      job_id,
      agent_id,
      type,
      payload,
      status: 'queued',      // queued | running | completed | failed
      error: null,
      logs: [],
      queued_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
    };
    this._jobs.set(job_id, job);
    return job;
  }

  get(job_id) {
    return this._jobs.get(job_id) || null;
  }

  size() {
    return this._jobs.size;
  }

  updateStatus(job_id, status, error = null) {
    const job = this._jobs.get(job_id);
    if (!job) return;

    job.status = status;
    if (error) job.error = error;
    if (status === 'running')   job.started_at  = new Date().toISOString();
    if (status === 'completed' || status === 'failed')
      job.finished_at = new Date().toISOString();
  }

  addLog(job_id, message) {
    const job = this._jobs.get(job_id);
    if (!job) return;
    job.logs.push({ ts: new Date().toISOString(), message });
    // Juga print ke stdout → Cloud Logging
    console.log(`[Job:${job_id}] ${message}`);
  }

  _prune() {
    const cutoff = Date.now() - this.MAX_HISTORY_MS;
    for (const [id, job] of this._jobs) {
      if (['completed', 'failed'].includes(job.status)) {
        const finished = new Date(job.finished_at).getTime();
        if (finished < cutoff) this._jobs.delete(id);
      }
    }
  }
}

module.exports = new TaskQueue(); // Singleton
