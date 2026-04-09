/**
 * SessionManager — GCS Auth State per Agent
 * ============================================
 * Menyimpan auth_state.json Playwright (cookies + localStorage)
 * ke Google Cloud Storage dengan path:
 *   gs://{BUCKET}/{agent_id}/ig_auth.json
 *   gs://{BUCKET}/{agent_id}/wa_auth.json
 *
 * Ini memungkinkan setiap agen punya session login sendiri
 * yang persistent antar Cloud Run instance.
 */

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs   = require('fs/promises');
const os   = require('os');

const storage = new Storage();
const BUCKET  = process.env.GCS_SESSION_BUCKET; // e.g. "mansion-pa-sessions"

class SessionManager {
  /**
   * Download auth state dari GCS ke file temporer lokal.
   * Return path ke file lokal, atau null jika belum ada.
   */
  async download(agentId, platform) {
    const gcsPath   = `${agentId}/${platform}_auth.json`;
    const localPath = path.join(os.tmpdir(), `auth_${agentId}_${platform}.json`);

    try {
      await storage.bucket(BUCKET).file(gcsPath).download({ destination: localPath });
      console.log(`[Session] Downloaded ${platform} auth for agent ${agentId}`);
      return localPath;
    } catch (err) {
      if (err.code === 404) {
        console.log(`[Session] No existing ${platform} session for agent ${agentId} — fresh login needed`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Upload auth state dari local file ke GCS setelah login berhasil.
   */
  async upload(agentId, platform, localPath) {
    const gcsPath = `${agentId}/${platform}_auth.json`;
    await storage.bucket(BUCKET).upload(localPath, { destination: gcsPath });
    console.log(`[Session] Uploaded ${platform} auth for agent ${agentId}`);
  }

  /**
   * Hapus session (force re-login, misal saat challenge required).
   */
  async invalidate(agentId, platform) {
    const gcsPath = `${agentId}/${platform}_auth.json`;
    try {
      await storage.bucket(BUCKET).file(gcsPath).delete();
      console.log(`[Session] Invalidated ${platform} session for agent ${agentId}`);
    } catch (e) {
      // Sudah tidak ada, tidak apa-apa
    }
  }

  /**
   * Simpan state Playwright browser context langsung ke GCS.
   */
  async saveFromContext(agentId, platform, browserContext) {
    const localPath = path.join(os.tmpdir(), `auth_${agentId}_${platform}.json`);
    await browserContext.storageState({ path: localPath });
    await this.upload(agentId, platform, localPath);
    // Cleanup lokal
    await fs.unlink(localPath).catch(() => {});
  }
}

module.exports = new SessionManager(); // Singleton
