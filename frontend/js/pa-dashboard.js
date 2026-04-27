/**
 * PA Dashboard — Personal Assistant (OpenClaw) Frontend
 * ============================================
 * Modul ini mengelola:
 *   1. Sidebar Kredensial PA (IG + WA input)
 *   2. Panel PA Activity Logs (SSE real-time)
 *   3. Tombol "Create Ads Content" di halaman Listing
 *   4. Tombol "WA Blast" di halaman Listing/Project
 *   5. Laporan Hit & Share PA (untuk BM/Principal)
 *
 * DIINTEGRASIKAN KE: app-mobile.js via initPADashboard()
 * DEPENDENCY: window.API (dari app-mobile.js), window.STATE
 */

// ── Konstanta ──────────────────────────────────────────────
const PA_TYPES = {
  ig_reels: { label: 'Instagram Reels', icon: '🎬' },
  ig_story: { label: 'Instagram Story', icon: '📸' },
  wa_blast: { label: 'WA Blast',        icon: '📲' },
};

// SSE connection singleton
let _sseConnection  = null;
let _paLogs         = [];      // Buffer logs untuk tampilkan di UI
const MAX_LOGS      = 50;
let _paLogPoller    = null;    // Polling interval fallback
let _paLogLastFetch = 0;       // Timestamp last successful poll

// IG Post Queue — antrian batch posting IG
let _igQueue = [];            // [{ listingId, title, type, url, file, mediaType, caption }]

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

function initPADashboard() {
  _injectPAStyles();
  _connectSSE();
  _startLogPoller();
  _initCreateAdsButtons();
  console.log('[PA Dashboard] Initialized');
}

// Polling fallback — baca job history dari /pa/jobs setiap 10 detik
function _startLogPoller() {
  if (_paLogPoller) clearInterval(_paLogPoller);
  _paLogPoller = setInterval(_pollJobHistory, 10_000);
  _pollJobHistory(); // langsung fetch saat init
}

async function _pollJobHistory() {
  try {
    const res  = await window.API.get('/pa/jobs?limit=20');
    const jobs = res.data || [];
    const now  = Date.now();

    jobs.forEach(job => {
      // Cek apakah job ini sudah ada di buffer (hindari duplikat)
      const exists = _paLogs.some(l => l.job_id === job.id);
      if (exists) {
        // Update status jika berubah (misalnya queued → completed)
        const entry = _paLogs.find(l => l.job_id === job.id);
        if (entry && entry._status !== job.status) {
          entry._status = job.status;
          entry.event   = job.status === 'completed' ? 'job_done'
                        : job.status === 'failed'    ? 'job_failed'
                        : entry.event;
          entry.message = _jobStatusMessage(job);
        }
        return;
      }

      // Entry baru dari polling — masukkan ke buffer
      _paLogs.push({
        ts:      new Date(job.created_at),
        event:   job.status === 'completed' ? 'job_done'
               : job.status === 'failed'    ? 'job_failed'
               : job.status === 'running'   ? 'job_started'
               : 'job_queued',
        message: _jobStatusMessage(job),
        type:    job.type,
        job_id:  job.id,
        _status: job.status,
        _source: 'poll',
      });
    });

    // Urutkan ulang berdasarkan timestamp terbaru
    _paLogs.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    if (_paLogs.length > MAX_LOGS) _paLogs.length = MAX_LOGS;

    _paLogLastFetch = now;
    _renderPALogsPanel();
  } catch { /* abaikan error polling */ }
}

function _jobStatusMessage(job) {
  const typeLabel = PA_TYPES[job.type]?.label || job.type;
  const title     = job.listing_title ? `"${job.listing_title}"` : '';
  if (job.status === 'completed') return `✅ ${typeLabel} berhasil diposting ${title}`;
  if (job.status === 'failed')    return `❌ ${typeLabel} gagal ${title}: ${job.error || 'unknown error'}`;
  if (job.status === 'running')   return `⏳ ${typeLabel} sedang diproses ${title}...`;
  return `📋 ${typeLabel} dijadwalkan ${title}`;
}

// ═══════════════════════════════════════════════════════════
// SSE — Real-time Activity Logs
// ═══════════════════════════════════════════════════════════

function _connectSSE() {
  if (_sseConnection) _sseConnection.close();

  const token = localStorage.getItem('crm_token');
  if (!token) return;

  _sseConnection = new EventSource(`/api/v1/pa/logs/stream?token=${token}`);

  _sseConnection.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      _handleSSEEvent(data);
    } catch {}
  };

  _sseConnection.onerror = () => {
    console.warn('[PA] SSE disconnected, reconnecting in 5s...');
    setTimeout(_connectSSE, 5000);
  };
}

function _handleSSEEvent(data) {
  const { event, message, type, job_id, status, qr_image, platform } = data;

  if (event === 'connected') return; // Ignore handshake

  // Tambah ke log buffer
  _paLogs.unshift({ ts: new Date(), event, message, type, job_id, status });
  if (_paLogs.length > MAX_LOGS) _paLogs.pop();

  // Update UI logs panel
  _renderPALogsPanel();

  // Notifikasi spesifik
  if (event === 'job_done') {
    _showPAToast(`✅ ${PA_TYPES[type]?.label || 'PA'} berhasil diselesaikan!`, 'success');
  } else if (event === 'job_failed') {
    _showPAToast(`❌ PA gagal: ${message}`, 'error');
  } else if (event === 'qr_required') {
    _showQRModal(platform, qr_image, message);
  } else if (event === 'job_queued' || event === 'blast_queued') {
    _showPAToast(`⏳ ${message}`, 'info');
  } else if (event === 'wa_blast_due') {
    _openWABlastSession(data);
  }
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR KREDENSIAL PA
// ═══════════════════════════════════════════════════════════

async function openPACredentialsSidebar() {
  // Hapus sidebar lama jika ada
  document.getElementById('pa-credentials-sidebar')?.remove();

  // Fetch kredensial + webhook config paralel
  let creds  = null;
  let wbCfg  = null;
  try {
    const [credsRes, wbRes] = await Promise.all([
      window.API.get('/pa/credentials'),
      window.API.get('/webhook/config'),
    ]);
    creds = credsRes.data;
    wbCfg = wbRes.data;
  } catch {}
  if (!wbCfg) wbCfg = { webhook_type: 'none', can_edit: false };

  const sidebar = document.createElement('div');
  sidebar.id = 'pa-credentials-sidebar';
  sidebar.className = 'modal-overlay open';
  sidebar.style.zIndex = '1200';
  sidebar.onclick = closePACredentialsSidebar;
  sidebar.innerHTML = `
    <div class="modal-sheet" style="max-width:540px" onclick="event.stopPropagation()">
      <div class="mheader">
        <div class="drag-handle"></div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <i class="fa-solid fa-robot" style="color:#D4A853;font-size:16px"></i>
            <h3 style="font-family:'DM Serif Display',serif;font-size:18px;color:#fff;margin:0">Personal Assistant</h3>
          </div>
          <button onclick="closePACredentialsSidebar()" style="width:30px;height:30px;border-radius:50%;background:#131F38;border:none;color:rgba(255,255,255,0.5);cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>

      <div class="mbody">

        <!-- Status PA -->
        <div style="display:flex;align-items:center;justify-content:space-between;background:#131F38;border-radius:12px;padding:12px 16px;border:1px solid rgba(255,255,255,0.08)">
          <div>
            <div style="font-size:13px;font-weight:600;color:#fff">PA Status</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px">
              ${creds?.pa_enabled ? '✅ Aktif — siap menerima job' : '⏸️ Nonaktif — job tidak dieksekusi'}
            </div>
          </div>
          <label class="pa-toggle">
            <input type="checkbox" id="pa-enabled-toggle" ${creds?.pa_enabled ? 'checked' : ''}>
            <span class="pa-toggle-slider"></span>
          </label>
        </div>

        <!-- Section IG -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:13px;font-weight:600;color:#fff">📸 Instagram</span>
            <span class="pa-status-badge ${_statusBadgeClass(creds?.ig_status)}">${_statusLabel(creds?.ig_status)}</span>
          </div>

          <!-- Graph API fields (primary) -->
          <div style="background:rgba(43,123,255,0.06);border:1px solid rgba(43,123,255,0.18);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:11px;color:#60a5fa;font-weight:600">🔵 Graph API (Meta for Developer)</div>
            <div>
              <label class="form-label">Instagram User ID</label>
              <input class="form-input" id="pa-ig-graph-uid" type="text"
                placeholder="contoh: 17841400000000000"
                value="${creds?.ig_graph_user_id || ''}" autocomplete="off">
              <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:4px 0 0">Angka dari Meta Developer → Graph API Explorer → id</p>
            </div>
            <div>
              <label class="form-label">Access Token</label>
              <input class="form-input" id="pa-ig-graph-token" type="password"
                placeholder="${creds?.ig_graph_token ? '••••••• (sudah tersimpan)' : 'Paste long-lived token di sini'}"
                autocomplete="new-password">
              <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:4px 0 0">Long-lived token (60 hari). Generate di Meta Developer → Graph API Explorer.</p>
            </div>
          </div>

        </div>

        <!-- Section WA -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">
          <div>
            <span style="font-size:13px;font-weight:600;color:#fff">📲 WhatsApp</span>
          </div>
          <div>
            <label class="form-label">Nomor WhatsApp (referensi)</label>
            <input class="form-input" id="pa-wa-number" type="tel"
              placeholder="contoh: 628123456789 (awali 62, tanpa +)"
              value="${creds?.wa_number || ''}" autocomplete="off">
            <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:6px 0 0;line-height:1.5">📱 Nomor WA agen — dipakai untuk WA Blast mode Semi Manual.</p>
          </div>
        </div>

        <!-- Section Fonnte (Fully Auto AI) -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(37,211,102,0.15);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <span style="font-size:13px;font-weight:600;color:#fff">🤖 Fonnte — Fully Auto AI</span>
              <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px">WA Blast dikirim otomatis oleh PA tanpa intervensi</div>
            </div>
            <span style="font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;
              ${creds?.fonnte_token ? 'background:rgba(37,211,102,0.15);color:#25d366' : 'background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.3)'}">
              ${creds?.fonnte_token ? '✅ Terpasang' : '⚪ Belum'}
            </span>
          </div>
          <div>
            <label class="form-label">Token Fonnte</label>
            <input class="form-input" id="pa-fonnte-token" type="password"
              placeholder="${creds?.fonnte_token ? '••••••••••• (sudah tersimpan)' : 'Masukkan token dari fonnte.com'}"
              autocomplete="new-password">
            <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:6px 0 0;line-height:1.6">
              Daftar & hubungkan WA di <b style="color:rgba(255,255,255,0.5)">fonnte.com</b> → salin Device Token → paste di sini.<br>
              Jika diisi, WA Blast berjalan <b style="color:#25d366">fully otomatis</b> tanpa agen membuka WA.
            </p>
          </div>
        </div>

        <!-- Batas Harian -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px">
          <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);margin-bottom:10px">📊 Batas Harian (Hari Ini)</div>
          <div class="pa-limits-grid" id="pa-limits-grid">
            <div class="pa-limit-card"><span class="pa-limit-icon">🎬</span><span class="pa-limit-label">IG Reels</span><span class="pa-limit-count" id="pa-count-ig_reels">-/5</span></div>
            <div class="pa-limit-card"><span class="pa-limit-icon">📸</span><span class="pa-limit-label">IG Story</span><span class="pa-limit-count" id="pa-count-ig_story">-/5</span></div>
            <div class="pa-limit-card"><span class="pa-limit-icon">📲</span><span class="pa-limit-label">WA Blast</span><span class="pa-limit-count" id="pa-count-wa_blast">-/4</span></div>
          </div>
        </div>

        <!-- Save button -->
        <button class="btn-gold" style="width:100%;font-size:14px;padding:15px;border-radius:14px" onclick="savePACredentials()">
          💾 Simpan Pengaturan PA
        </button>

        <!-- ═══════════════════════════════════════════════
             WEBHOOK LEAD DARI IKLAN META
             Tampil untuk semua role — edit hanya superadmin/principal/kantor
             ═══════════════════════════════════════════════ -->
        <div class="pa-section" id="pa-webhook-section">
          <div class="pa-section-title">🔗 Lead dari Iklan Meta</div>

          <!-- Konteks: Apa itu lead otomatis? -->
          <details style="margin-bottom:12px;border:1px solid rgba(43,123,255,0.15);border-radius:10px;overflow:hidden">
            <summary style="padding:9px 12px;font-size:11px;color:#60a5fa;cursor:pointer;list-style:none;background:rgba(43,123,255,0.05);display:flex;align-items:center;justify-content:space-between">
              <span>💡 Apa itu lead otomatis dari Meta Ads?</span>
              <span style="font-size:10px;opacity:.5">klik</span>
            </summary>
            <div style="padding:10px 12px;font-size:11px;color:rgba(255,255,255,0.55);line-height:1.8;background:rgba(43,123,255,0.02)">
              Ketika kamu pasang iklan di <b style="color:#60a5fa">Facebook / Instagram</b> dengan <b>Lead Form</b>, setiap orang yang mengisi form tersebut disebut <b style="color:#D4A853">lead</b>.<br><br>
              Tanpa integrasi: kamu harus buka Ads Manager secara manual, download data lead, lalu input ke CRM.<br><br>
              <b style="color:rgba(255,255,255,0.8)">Dengan fitur ini:</b><br>
              Begitu seseorang isi form iklan → data langsung masuk ke <b>menu Leads CRM</b> → kamu dapat notifikasi in-app + <b style="color:#60a5fa">notifikasi Telegram langsung ke HP</b> → bisa follow up dalam hitungan menit.
            </div>
          </details>

          <!-- Telegram Notification Setup -->
          <details style="margin-bottom:12px;border:1px solid rgba(96,165,250,0.2);border-radius:10px;overflow:hidden">
            <summary style="padding:9px 12px;font-size:11px;color:#60a5fa;cursor:pointer;list-style:none;background:rgba(96,165,250,0.06);display:flex;align-items:center;justify-content:space-between">
              <span>🔔 Aktifkan Notifikasi Telegram untuk Lead Baru</span>
              <span style="font-size:10px;opacity:.5">klik</span>
            </summary>
            <div style="padding:10px 12px;font-size:11px;color:rgba(255,255,255,0.55);line-height:1.8;background:rgba(96,165,250,0.02)">
              Setiap lead baru dari iklan Meta akan dikirim langsung ke <b style="color:#60a5fa">DM Telegram</b> kamu secara real-time — gratis, tanpa delay.<br><br>
              <b style="color:rgba(255,255,255,0.8)">Cara aktivasi (sekali saja):</b><br>
              1. Buka Telegram → cari bot kantor <b>@MansionRealtyBot</b><br>
              2. Ketik <code style="background:#0D1526;padding:1px 5px;border-radius:4px;color:#4ade80">/start</code> lalu <code style="background:#0D1526;padding:1px 5px;border-radius:4px;color:#4ade80">/id</code><br>
              3. Bot akan membalas dengan angka — itu <b>Telegram ID</b> kamu<br>
              4. Berikan angka tersebut ke admin kantor untuk didaftarkan di sistem<br><br>
              <div style="background:rgba(239,68,68,0.06);border-left:3px solid rgba(239,68,68,0.3);border-radius:0 6px 6px 0;padding:7px 10px;margin-top:4px">
                <span style="color:#f87171;font-weight:600">Belum terdaftar?</span>
                <span style="color:rgba(255,255,255,0.4)"> Notifikasi tetap masuk ke CRM — Telegram hanya notif tambahan.</span>
              </div>
            </div>
          </details>

          <!-- Pilihan Mode (3 pilihan) -->
          <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0 0 8px">
            Pilih cara menerima lead otomatis:
          </p>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
            <button id="wb-btn-none" onclick="wbSetMode('none')"
              style="width:100%;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;border:2px solid rgba(255,255,255,0.1);background:#131F38;color:rgba(255,255,255,0.5)">
              <span style="font-size:16px">⬜</span>
              <span><b>Tidak Pakai</b><br><span style="font-size:10px;font-weight:400;opacity:.7">Skip — tidak terima lead dari Meta Ads</span></span>
            </button>
            <button id="wb-btn-zapier" onclick="wbSetMode('zapier')"
              style="width:100%;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;border:2px solid rgba(255,255,255,0.1);background:#131F38;color:rgba(255,255,255,0.5)">
              <span style="font-size:16px">⚡</span>
              <span><b>Pipedream</b><br><span style="font-size:10px;font-weight:400;opacity:.7">Rekomendasi — Mudah, tanpa Meta App</span></span>
            </button>
            <button id="wb-btn-meta" onclick="wbSetMode('meta')"
              style="width:100%;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;border:2px solid rgba(255,255,255,0.1);background:#131F38;color:rgba(255,255,255,0.5)">
              <span style="font-size:16px">🔵</span>
              <span><b>Meta for Developer</b><br><span style="font-size:10px;font-weight:400;opacity:.7">Langsung — Butuh akun Meta Developer</span></span>
            </button>
          </div>
          ${!wbCfg.can_edit ? '<p style="font-size:10px;color:rgba(255,255,255,0.25);margin:-6px 0 10px;text-align:center">Mode hanya bisa diubah oleh superadmin / principal / kantor</p>' : ''}

          <!-- Panel: TIDAK PAKAI -->
          <div id="wb-panel-none">
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px">
              <p style="font-size:13px;color:rgba(255,255,255,0.4);margin:0 0 8px;text-align:center">Webhook lead tidak aktif.</p>
              <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;line-height:1.7;text-align:center">
                Lead dari iklan Meta harus diinput <b>manual</b> via menu Leads.<br>
                Pilih mode Pipedream atau Meta jika ingin otomatis.
              </p>
              <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
                <p style="font-size:10px;color:rgba(255,255,255,0.25);margin:0;line-height:1.6">
                  💡 <b style="color:rgba(255,255,255,0.35)">Rekomendasi untuk mulai:</b> pilih mode <b>Pipedream</b> di atas — tidak perlu daftar Meta Developer, cukup akun Pipedream gratis.
                </p>
              </div>
            </div>
          </div>

          <!-- Panel: ZAPIER -->
          <div id="wb-panel-zapier" style="display:none">

            ${wbCfg.can_edit ? `
            <!-- Base URL (editable oleh admin/kantor) -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Base URL CRM (domain publik)</p>
              <div style="display:flex;gap:6px">
                <input id="wb-base-url" class="form-input" type="url" style="flex:1;font-size:11px;margin:0"
                  placeholder="https://crm.domain.com"
                  value="${wbCfg.base_url || ''}">
                <button onclick="wbSaveBaseUrl()" style="flex-shrink:0;padding:6px 10px;border-radius:8px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.25);color:#D4A853;font-size:11px;cursor:pointer;white-space:nowrap">💾 Simpan</button>
              </div>
              <p style="font-size:10px;color:rgba(255,255,255,0.25);margin:4px 0 0">Dipakai untuk generate Webhook URL. Update saat ganti domain.</p>
            </div>` : ''}

            <!-- Webhook URL per-agen (unique) -->
            <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);border-radius:10px;padding:12px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Webhook URL Kamu (unik per agen)</p>
              <div style="display:flex;gap:6px;align-items:center">
                <code id="wb-zapier-url" style="flex:1;font-size:10px;color:#4ade80;word-break:break-all;background:#0D1526;padding:7px 8px;border-radius:6px;border:1px solid rgba(34,197,94,0.2)">${
                  (wbCfg.zapier_url_template || '').replace('{agent_id}', window.STATE?.user?.id || '{agent_id}')
                }</code>
                <button onclick="wbCopy('wb-zapier-url')" style="flex-shrink:0;padding:7px 9px;border-radius:6px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:#4ade80;font-size:12px;cursor:pointer">📋</button>
              </div>
              <p style="font-size:10px;color:rgba(255,255,255,0.25);margin:4px 0 0">URL ini unik milikmu — lead yang masuk langsung assign ke kamu.</p>
            </div>

            <!-- Secret Key per-agen -->
            <div style="background:rgba(212,168,83,0.06);border:1px solid rgba(212,168,83,0.15);border-radius:10px;padding:12px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Secret Key (field "secret" di Pipedream)</p>
              ${creds?.zapier_secret ? `
              <div style="display:flex;gap:6px;align-items:center">
                <code id="wb-zapier-secret" style="flex:1;font-size:10px;color:#D4A853;word-break:break-all;background:#0D1526;padding:7px 8px;border-radius:6px;border:1px solid rgba(212,168,83,0.2)">${creds.zapier_secret}</code>
                <button onclick="wbCopy('wb-zapier-secret')" style="flex-shrink:0;padding:7px 9px;border-radius:6px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.2);color:#D4A853;font-size:12px;cursor:pointer">📋</button>
              </div>
              <button onclick="wbGenerateZapierSecret()" style="width:100%;margin-top:8px;padding:7px;border-radius:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);color:#f87171;font-size:10px;cursor:pointer">
                🔄 Generate Ulang (Pipedream perlu diupdate)
              </button>` : `
              <p style="font-size:11px;color:rgba(255,255,255,0.35);margin:0 0 8px">Belum ada secret key. Generate dulu:</p>
              <button onclick="wbGenerateZapierSecret()" style="width:100%;padding:10px;border-radius:10px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.3);color:#D4A853;font-size:12px;font-weight:600;cursor:pointer">
                🔑 Generate Secret Key
              </button>`}
            </div>

            <!-- Context: Apa itu Pipedream? -->
            <details style="margin-bottom:8px;border:1px solid rgba(34,197,94,0.12);border-radius:8px;overflow:hidden">
              <summary style="padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);cursor:pointer;list-style:none;background:rgba(34,197,94,0.03)">
                ❓ Apa itu Pipedream & kenapa direkomendasikan? <span style="opacity:.5">(klik)</span>
              </summary>
              <div style="padding:10px;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.8;background:rgba(34,197,94,0.02)">
                <b style="color:#4ade80">Pipedream</b> adalah platform otomasi gratis yang menghubungkan dua aplikasi tanpa coding.<br><br>
                <b style="color:rgba(255,255,255,0.7)">Kenapa Pipedream lebih mudah dari Meta Developer?</b><br>
                ✅ Tidak perlu daftar Meta Developer Account<br>
                ✅ Tidak perlu App Review dari Meta (bisa jadi berbulan-bulan)<br>
                ✅ Setup 10 menit via browser<br>
                ✅ HTTP Webhook gratis tanpa perlu upgrade plan berbayar<br><br>
                <b style="color:rgba(255,255,255,0.7)">Biaya Pipedream:</b><br>
                Free Plan: 3.000 eksekusi/bulan — cukup untuk &lt;3.000 lead/bulan.<br>
                Untuk volume sangat tinggi, pakai Meta Langsung.
              </div>
            </details>

            <!-- Instruksi setup -->
            <details style="margin-bottom:4px">
              <summary style="font-size:11px;color:rgba(255,255,255,0.45);cursor:pointer;padding:6px 0;list-style:none">
                📋 Tutorial setup Pipedream step-by-step <span style="opacity:.5">(klik)</span>
              </summary>
              <div style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.8;padding:8px 4px 0">
                <b style="color:rgba(255,255,255,0.7)">Persiapan:</b><br>
                • Akun <a href="https://pipedream.com" target="_blank" style="color:#4ade80">pipedream.com</a> (daftar gratis, pakai Google)<br>
                • Facebook Page yang sudah terhubung ke iklan<br>
                • Lead Form sudah aktif di iklan FB/IG<br><br>
                <b style="color:rgba(255,255,255,0.7)">Langkah:</b><br>
                1. Buka <b style="color:#D4A853">pipedream.com</b> → <i>New Workflow</i><br>
                2. <b>Trigger:</b> cari <i>"Facebook Lead Ads"</i> → pilih <i>New Lead (Instant)</i><br>
                &nbsp;&nbsp;→ Hubungkan akun Facebook → pilih <b>Page</b> & <b>Form</b> iklanmu<br>
                3. <b>Action:</b> tambah step → cari <i>"HTTP Request"</i> → pilih <i>Send any HTTP Request</i><br>
                4. <b>Method:</b> POST &nbsp;|&nbsp; <b>URL:</b> paste <i>Webhook URL Kamu</i> dari kotak hijau di atas<br>
                5. <b>Content-Type:</b> application/json<br>
                6. <b>Body (JSON) — isi field berikut:</b><br>
                <div style="background:#0D1526;border-radius:6px;padding:8px;margin:6px 0;font-family:monospace">
                  <span style="color:#60a5fa">secret</span> → <span style="color:#4ade80">paste Secret Key dari kotak emas (teks statis)</span><br>
                  <span style="color:#60a5fa">full_name</span> → <span style="color:rgba(255,255,255,0.5)">pilih field "Full Name" dari trigger</span><br>
                  <span style="color:#60a5fa">phone</span> → <span style="color:rgba(255,255,255,0.5)">pilih field "Phone Number"</span><br>
                  <span style="color:#60a5fa">email</span> → <span style="color:rgba(255,255,255,0.5)">pilih field "Email"</span><br>
                  <span style="color:#60a5fa">form_name</span> → <span style="color:rgba(255,255,255,0.5)">pilih "Form Name"</span><br>
                  <span style="color:#60a5fa">ad_name</span> → <span style="color:rgba(255,255,255,0.5)">pilih "Ad Name"</span>
                </div>
                7. Klik <b>Test</b> → respons <code>{"received":true}</code> = sukses → klik <b>Deploy</b><br><br>
                ✅ Selesai! Lead dari iklan akan otomatis masuk ke CRM dalam hitungan detik.
              </div>
            </details>
          </div>

          <!-- Panel: META LANGSUNG -->
          <div id="wb-panel-meta" style="display:none">

            <!-- Context: Meta for Developer -->
            <details style="margin-bottom:10px;border:1px solid rgba(43,123,255,0.15);border-radius:8px;overflow:hidden">
              <summary style="padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);cursor:pointer;list-style:none;background:rgba(43,123,255,0.04)">
                ❓ Apa itu Meta for Developer & cara daftar? <span style="opacity:.5">(klik)</span>
              </summary>
              <div style="padding:10px;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.8;background:rgba(43,123,255,0.02)">
                <b style="color:#60a5fa">Meta for Developers</b> adalah platform resmi Meta untuk integrasi langsung tanpa perantara (tanpa Pipedream).<br><br>
                <b style="color:rgba(255,255,255,0.7)">Keuntungan vs Pipedream:</b><br>
                ✅ Gratis — tidak ada biaya bulanan<br>
                ✅ Real-time — lead masuk dalam hitungan detik<br>
                ✅ Tidak ada batas run per bulan<br><br>
                <b style="color:rgba(255,255,255,0.7)">Syarat:</b><br>
                • Akun Facebook (personal atau bisnis)<br>
                • Facebook Page untuk kantor / brand<br>
                • Meta Business Suite aktif<br>
                • Domain/URL publik (Cloud Run URL sudah cukup)<br><br>
                <b style="color:rgba(255,255,255,0.7)">Cara daftar (singkat):</b><br>
                1. Buka <b style="color:#60a5fa">developers.facebook.com</b><br>
                2. Login → <i>My Apps</i> → <i>Create App</i><br>
                3. Pilih type: <i>Business</i> → isi nama app<br>
                4. Add Product: <b>Webhooks</b><br>
                5. Subscribe ke object: <b>Page</b> → field: <b>leadgen</b><br>
                6. Masukkan <i>Webhook URL</i> + <i>Verify Token</i> dari kotak di bawah<br>
                7. Add Product: <b>Meta Lead Ads</b> → ikuti panduan<br><br>
                ⚠️ Mode <i>Development</i> bisa ditest segera tanpa App Review. <i>Live mode</i> butuh review Meta (1–7 hari kerja).
              </div>
            </details>

            ${wbCfg.can_edit ? `
            <!-- Base URL (sama seperti Pipedream) -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Base URL CRM (domain publik)</p>
              <div style="display:flex;gap:6px">
                <input id="wb-base-url-meta" class="form-input" type="url" style="flex:1;font-size:11px;margin:0"
                  placeholder="https://crm.domain.com"
                  value="${wbCfg.base_url || ''}">
                <button onclick="wbSaveBaseUrl('meta')" style="flex-shrink:0;padding:6px 10px;border-radius:8px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.25);color:#D4A853;font-size:11px;cursor:pointer;white-space:nowrap">💾 Simpan</button>
              </div>
            </div>` : ''}

            <!-- Webhook URL -->
            <div style="background:rgba(43,123,255,0.06);border:1px solid rgba(43,123,255,0.15);border-radius:10px;padding:12px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Webhook URL (daftarkan di Meta App)</p>
              <div style="display:flex;gap:6px;align-items:center">
                <code id="wb-meta-url" style="flex:1;font-size:10px;color:#60a5fa;word-break:break-all;background:#0D1526;padding:7px 8px;border-radius:6px;border:1px solid rgba(43,123,255,0.2)">${wbCfg.meta_webhook_url || '—'}</code>
                <button onclick="wbCopy('wb-meta-url')" style="flex-shrink:0;padding:7px 9px;border-radius:6px;background:rgba(43,123,255,0.1);border:1px solid rgba(43,123,255,0.2);color:#60a5fa;font-size:12px;cursor:pointer">📋</button>
              </div>
            </div>

            <!-- Verify Token -->
            <div style="background:rgba(212,168,83,0.06);border:1px solid rgba(212,168,83,0.15);border-radius:10px;padding:12px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Verify Token (Meta App → Webhooks)</p>
              <div style="display:flex;gap:6px;align-items:center">
                <code id="wb-meta-token" style="flex:1;font-size:10px;color:#D4A853;word-break:break-all;background:#0D1526;padding:7px 8px;border-radius:6px;border:1px solid rgba(212,168,83,0.2)">${wbCfg.meta_verify_token || '—'}</code>
                <button onclick="wbCopy('wb-meta-token')" style="flex-shrink:0;padding:7px 9px;border-radius:6px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.2);color:#D4A853;font-size:12px;cursor:pointer">📋</button>
              </div>
              ${wbCfg.can_edit ? `<button onclick="wbRegenerateMetaToken()" style="width:100%;margin-top:8px;padding:7px;border-radius:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);color:#f87171;font-size:10px;cursor:pointer">🔄 Generate Ulang Verify Token</button>` : ''}
            </div>

            ${wbCfg.can_edit ? `
            <!-- Form Settings Meta (hanya admin/kantor) -->
            <div style="background:rgba(43,123,255,0.04);border:1px solid rgba(43,123,255,0.12);border-radius:10px;padding:14px;margin-bottom:10px">
              <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 10px;text-transform:uppercase;letter-spacing:.5px">Pengaturan Meta App</p>
              <div style="margin-bottom:8px">
                <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0 0 4px">Page Access Token</p>
                <input id="wb-meta-pat" type="password" class="form-input" style="margin:0"
                  placeholder="Dari Meta App → Tools → Graph API Explorer"
                  value="${wbCfg.meta_page_access_token && wbCfg.meta_page_access_token !== '••••••••' ? wbCfg.meta_page_access_token : ''}">
                <p style="font-size:10px;color:rgba(255,255,255,0.25);margin:3px 0 0">Untuk fetch detail lead (nama/HP/email) via Graph API</p>
              </div>
              <div style="margin-bottom:10px">
                <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0 0 4px">App Secret</p>
                <input id="wb-meta-secret" type="password" class="form-input" style="margin:0"
                  placeholder="Dari Meta App → Settings → Basic → App Secret"
                  value="${wbCfg.meta_app_secret && wbCfg.meta_app_secret !== '••••••••' ? wbCfg.meta_app_secret : ''}">
                <p style="font-size:10px;color:rgba(255,255,255,0.25);margin:3px 0 0">Untuk verifikasi signature dari Meta (keamanan)</p>
              </div>
              <button onclick="wbSaveMeta()" style="width:100%;padding:10px;border-radius:10px;background:rgba(43,123,255,0.12);border:1px solid rgba(43,123,255,0.3);color:#60a5fa;font-size:12px;font-weight:600;cursor:pointer">
                💾 Simpan Pengaturan Meta
              </button>
            </div>` : `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px;text-align:center">
              <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0">
                Page Access Token: ${wbCfg.meta_page_access_token || 'Belum dikonfigurasi'}<br>
                App Secret: ${wbCfg.meta_app_secret || 'Belum dikonfigurasi'}
              </p>
            </div>`}
          </div>
        </div>

        <!-- Activity Logs Panel -->
        <div class="pa-section">
          <div class="pa-section-title">🔄 PA Activity Log (Real-time)</div>
          <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:-4px 0 8px;line-height:1.6">
            Semua aktivitas PA (posting IG, WA Blast, lead masuk) tampil di sini secara live via SSE. Tersimpan maks 50 log terakhir per sesi.
          </p>
          <div class="pa-logs-panel" id="pa-logs-panel">
            <div class="pa-log-empty">Menunggu aktivitas PA...</div>
          </div>
        </div>

      </div><!-- /mbody -->
    </div><!-- /modal-sheet -->
  `;

  document.body.appendChild(sidebar);

  // Animate in
  requestAnimationFrame(() => {
    const sheet = sidebar.querySelector('.modal-sheet');
    if (sheet) { sheet.style.opacity = '1'; sheet.style.transform = 'translateY(0)'; }
  });

  // Inisialisasi panel webhook sesuai config (fromInit=true agar tidak trigger save)
  _wbCurrentMode = wbCfg.webhook_type || 'none';
  wbSetMode(_wbCurrentMode, true);

  // Load job counts hari ini
  _loadTodayJobCounts();

  // Render existing logs
  _renderPALogsPanel();
}

function closePACredentialsSidebar() {
  const sidebar = document.getElementById('pa-credentials-sidebar');
  if (!sidebar) return;
  const sheet = sidebar.querySelector('.modal-sheet');
  if (sheet) { sheet.style.opacity = '0'; sheet.style.transform = 'translateY(16px)'; }
  setTimeout(() => sidebar.remove(), 200);
  _waQRPollStop();
}


async function savePACredentials() {
  const igUsername    = document.getElementById('pa-ig-username')?.value?.trim();
  const igPassword    = document.getElementById('pa-ig-password')?.value;
  const waNumber      = document.getElementById('pa-wa-number')?.value?.trim();
  const paEnabled     = document.getElementById('pa-enabled-toggle')?.checked;
  const fontteToken   = document.getElementById('pa-fonnte-token')?.value?.trim();
  const igGraphUid    = document.getElementById('pa-ig-graph-uid')?.value?.trim();
  const igGraphToken  = document.getElementById('pa-ig-graph-token')?.value?.trim();

  const body = { pa_enabled: paEnabled };
  if (igUsername)   body.ig_username       = igUsername;
  if (igPassword)   body.ig_password       = igPassword;
  if (waNumber)     body.wa_number         = waNumber;
  if (fontteToken)  body.fonnte_token      = fontteToken;
  if (igGraphUid)   body.ig_graph_user_id  = igGraphUid;
  if (igGraphToken) body.ig_graph_token    = igGraphToken;

  try {
    await window.API.post('/pa/credentials', body);
    _showPAToast('✅ Pengaturan PA disimpan', 'success');

    // Clear sensitive fields setelah disimpan
    ['pa-ig-password', 'pa-fonnte-token', 'pa-ig-graph-token'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  } catch (e) {
    _showPAToast(`❌ Gagal simpan: ${e.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// WEBHOOK CONFIG — Mode toggle + Save
// ═══════════════════════════════════════════════════════════

// State mode saat ini (diisi saat sidebar dibuka)
let _wbCurrentMode = 'zapier';

function wbSetMode(mode, fromInit = false) {
  const prevMode = _wbCurrentMode;
  _wbCurrentMode = mode;

  // Panels
  const panels = {
    none:   document.getElementById('wb-panel-none'),
    zapier: document.getElementById('wb-panel-zapier'),
    meta:   document.getElementById('wb-panel-meta'),
  };
  const btns = {
    none:   document.getElementById('wb-btn-none'),
    zapier: document.getElementById('wb-btn-zapier'),
    meta:   document.getElementById('wb-btn-meta'),
  };

  if (!panels.none) return; // sidebar belum dirender

  // Sembunyikan semua panel, reset semua tombol
  Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
  Object.values(btns).forEach(b => {
    if (b) {
      b.style.border     = '2px solid rgba(255,255,255,0.1)';
      b.style.background = '#131F38';
      b.style.color      = 'rgba(255,255,255,0.5)';
    }
  });

  // Aktifkan panel & tombol yang dipilih
  if (panels[mode]) panels[mode].style.display = '';
  if (btns[mode]) {
    btns[mode].style.border     = '2px solid #D4A853';
    btns[mode].style.background = 'rgba(212,168,83,0.12)';
    btns[mode].style.color      = '#D4A853';
  }

  // Simpan ke server hanya saat user klik (bukan saat init)
  if (!fromInit && mode !== prevMode) {
    wbSaveMode(mode);
  }
}

// Simpan mode ke server (dipanggil saat user klik tombol mode)
async function wbSaveMode(mode) {
  try {
    const labels = { zapier: 'Pipedream', meta: 'Meta for Developer', none: 'Tidak Pakai' };
    await window.API.post('/webhook/config', { webhook_type: mode });
    _showPAToast(`✅ Mode diubah: ${labels[mode] || mode}`, 'success');
  } catch (e) {
    _showPAToast(`❌ ${e.message}`, 'error');
  }
}

// Simpan Base URL (field editable domain publik)
async function wbSaveBaseUrl(panel = 'zapier') {
  const inputId = panel === 'meta' ? 'wb-base-url-meta' : 'wb-base-url';
  const url = document.getElementById(inputId)?.value?.trim();
  if (!url) return _showPAToast('Base URL tidak boleh kosong', 'error');
  try {
    await window.API.post('/webhook/config', { base_url: url });
    _showPAToast('✅ Base URL disimpan. Reload sidebar untuk update URL.', 'success');
    setTimeout(() => { closePACredentialsSidebar(); openPACredentialsSidebar(); }, 1200);
  } catch (e) { _showPAToast(`❌ ${e.message}`, 'error'); }
}

// Generate/regenerate Secret Key per-agen (Zapier)
async function wbGenerateZapierSecret() {
  const isRegen = !!document.getElementById('wb-zapier-secret');
  if (isRegen && !confirm('Generate ulang Secret Key?\nPipedream yang sudah dikonfigurasi harus diupdate dengan key baru.')) return;
  try {
    const res = await window.API.post('/pa/zapier-secret/generate', {});
    if (!res.success) throw new Error(res.message);
    _showPAToast('✅ Secret Key berhasil dibuat!', 'success');
    setTimeout(() => { closePACredentialsSidebar(); openPACredentialsSidebar(); }, 800);
  } catch (e) { _showPAToast(`❌ ${e.message}`, 'error'); }
}

// Simpan pengaturan Meta (Page Access Token + App Secret)
async function wbSaveMeta() {
  const pat    = document.getElementById('wb-meta-pat')?.value?.trim();
  const secret = document.getElementById('wb-meta-secret')?.value?.trim();
  try {
    await window.API.post('/webhook/config', {
      webhook_type:           'meta',
      meta_page_access_token: pat    || undefined,
      meta_app_secret:        secret || undefined,
    });
    _showPAToast('✅ Pengaturan Meta Webhook tersimpan', 'success');
  } catch (e) { _showPAToast(`❌ ${e.message}`, 'error'); }
}

// Generate ulang Verify Token (Meta)
async function wbRegenerateMetaToken() {
  if (!confirm('Generate ulang Verify Token?\nMeta App Dashboard harus diupdate dengan token baru.')) return;
  try {
    await window.API.post('/webhook/config', { regenerate_meta_token: true });
    _showPAToast('✅ Verify Token baru dibuat.', 'success');
    setTimeout(() => { closePACredentialsSidebar(); openPACredentialsSidebar(); }, 1000);
  } catch (e) { _showPAToast(`❌ ${e.message}`, 'error'); }
}

function wbCopy(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.textContent || el.value || '';
  navigator.clipboard.writeText(text).then(() => {
    _showPAToast('✅ Disalin!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    _showPAToast('✅ Disalin!', 'success');
  });
}

// ═══════════════════════════════════════════════════════════
// TOMBOL "CREATE ADS CONTENT" DI HALAMAN LISTING
// ═══════════════════════════════════════════════════════════

function _initCreateAdsButtons() {
  // Observer untuk mendeteksi saat halaman listing/project dibuka
  const observer = new MutationObserver(() => {
    _injectListingAdsButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function _injectListingAdsButtons() {
  // Tambah tombol di listing detail page (cari container aksi listing)
  const listingActions = document.querySelector('#listing-detail-actions, .listing-action-bar');
  if (!listingActions || listingActions.dataset.paInjected) return;
  listingActions.dataset.paInjected = 'true';

  const listingId = listingActions.dataset.listingId || window._currentListingId;
  if (!listingId) return;

  // Tombol Create Ads Content
  const btnAds = document.createElement('button');
  btnAds.className = 'btn-action-listing btn-pa-ads';
  btnAds.innerHTML = '🎬 Buat Konten Iklan';
  btnAds.onclick = () => openViGenModal(listingId);
  listingActions.appendChild(btnAds);

  // Tombol WA Blast
  const btnWA = document.createElement('button');
  btnWA.className = 'btn-action-listing btn-pa-wa';
  btnWA.innerHTML = '📲 WA Blast';
  btnWA.onclick = () => openWABlastModal(listingId);
  listingActions.appendChild(btnWA);
}

// ═══════════════════════════════════════════════════════════
// MODAL VIGEN — Create Ads Content
// ═══════════════════════════════════════════════════════════

async function openViGenModal(listingId, listingTitle) {
  document.getElementById('pa-vigen-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'pa-vigen-modal';
  modal.className = 'pa-modal-backdrop';
  modal.innerHTML = `
    <div class="pa-modal-box">
      <div class="pa-modal-header">
        <span>🎬 Buat Konten Iklan Video</span>
        <button onclick="document.getElementById('pa-vigen-modal').remove()">✕</button>
      </div>
      <div class="pa-modal-body">

        <!-- Foto dari CRM (read-only preview) -->
        <div class="pa-form-group">
          <label>Foto dari Listing CRM</label>
          <div id="vigen-media-preview" class="vigen-media-preview">
            <div class="pa-hint" style="padding:8px 0">⏳ Memuat media listing...</div>
          </div>
        </div>

        <!-- Foto tambahan khusus iklan (tidak tersimpan ke listing) -->
        <div class="pa-form-group">
          <div class="vigen-extra-header">
            <label>Foto Tambahan untuk Iklan</label>
            <span class="vigen-extra-badge">Opsional · maks 3 foto · tidak tersimpan ke listing</span>
          </div>
          <div class="vigen-extra-slots" id="vigen-extra-slots">
            ${[1,2,3].map(i => `
              <div class="vigen-extra-slot" id="vigen-slot-${i}">
                <input type="file" id="vigen-extra-${i}" accept="image/jpeg,image/jpg,image/png,image/webp"
                  style="display:none" onchange="viGenExtraPreview(${i}, this)">
                <div class="vigen-slot-btn" onclick="document.getElementById('vigen-extra-${i}').click()">
                  <span class="vigen-slot-icon">＋</span>
                  <span class="vigen-slot-label">Foto ${i}</span>
                </div>
                <div class="vigen-slot-preview" id="vigen-prev-${i}" style="display:none">
                  <img id="vigen-prev-img-${i}">
                  <button class="vigen-slot-clear" onclick="viGenExtraClear(${i})" title="Hapus">✕</button>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="pa-hint" style="margin-top:4px">
            Foto ini digabung dengan foto CRM (total maks 6) untuk variasi konten iklan.
          </div>
        </div>

        <div class="pa-form-group">
          <label>Mood / Style</label>
          <div class="pa-radio-group">
            <label><input type="radio" name="vigen-mood" value="mewah" checked> ✨ Mewah (Gold/Luxury)</label>
            <label><input type="radio" name="vigen-mood" value="minimalis"> 🤍 Minimalis (Clean/Modern)</label>
          </div>
        </div>

        <div class="pa-form-group">
          <label>Durasi Video</label>
          <div class="pa-radio-group">
            <label><input type="radio" name="vigen-duration" value="15"> 15 detik</label>
            <label><input type="radio" name="vigen-duration" value="30" checked> 30 detik</label>
            <label><input type="radio" name="vigen-duration" value="60"> 60 detik</label>
          </div>
        </div>

        <div class="pa-info-box">
          💡 Foto listing + foto tambahan akan diproses AI (MoviePy + Gemini) menjadi video iklan 9:16.
          Foto tambahan hanya dipakai untuk render ini, tidak mengubah data listing.
        </div>

        <button class="pa-btn-primary" id="vigen-submit-btn" onclick="submitViGenRender('${listingId}')">
          🚀 Render Video Sekarang
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Load preview foto dari CRM (read-only)
  _loadViGenMediaPreview(listingId);
}

// ── Slot foto extra: preview saat file dipilih ─────────────
function viGenExtraPreview(slotIdx, input) {
  const file = input.files?.[0];
  if (!file) return;

  // Validasi ukuran (10MB max, sama dengan foto CRM)
  if (file.size > 10 * 1024 * 1024) {
    _showPAToast(`Foto terlalu besar (${(file.size/1024/1024).toFixed(1)}MB). Maks 10MB.`, 'error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const btn     = document.querySelector(`#vigen-slot-${slotIdx} .vigen-slot-btn`);
    const preview = document.getElementById(`vigen-prev-${slotIdx}`);
    const img     = document.getElementById(`vigen-prev-img-${slotIdx}`);
    if (btn)     btn.style.display     = 'none';
    if (preview) preview.style.display = 'block';
    if (img)     img.src               = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Clear satu slot foto extra ─────────────────────────────
function viGenExtraClear(slotIdx) {
  const input   = document.getElementById(`vigen-extra-${slotIdx}`);
  const btn     = document.querySelector(`#vigen-slot-${slotIdx} .vigen-slot-btn`);
  const preview = document.getElementById(`vigen-prev-${slotIdx}`);
  if (input)   input.value            = '';
  if (btn)     btn.style.display      = 'flex';
  if (preview) preview.style.display  = 'none';
}

async function _loadViGenMediaPreview(listingId) {
  const container = document.getElementById('vigen-media-preview');
  if (!container) return;

  try {
    const res  = await window.API.get(`/pa/vigen/media/${listingId}`);
    const data = res.data || {};

    const { photos = [], videos = [], counts = {} } = data;

    // Foto CRM: dari kolom GSheets (Foto_Utama, Foto_2, Foto_3)
    // Ditampilkan terpisah — ini sudah masuk listing
    // Cloudinary photos/ folder mungkin kosong untuk listing lama → wajar
    const crmPhotoCount = counts.photos || 0;

    if (crmPhotoCount === 0 && photos.length === 0) {
      // Tidak ada foto di Cloudinary — cek apakah listing punya foto di CRM
      // Tampilkan info: bisa pakai foto extra saja
      container.innerHTML = `
        <div class="vigen-no-crm-photo">
          ℹ️ Listing ini belum punya foto di sistem baru.
          Tambah minimal 1 foto di bagian "Foto Tambahan" di bawah untuk membuat iklan.
        </div>`;
      return;
    }

    // Ada foto di Cloudinary photos/ folder — tampilkan thumbnails
    const videoSlots = `${counts.videos || 0}/6`;

    container.innerHTML = `
      <div class="vigen-media-stats">
        <div class="vigen-stat-pill">🖼 ${crmPhotoCount} foto CRM</div>
        ${counts.videos > 0 ? `<div class="vigen-stat-pill">🎥 ${videoSlots} video clips</div>` : ''}
      </div>

      ${photos.length > 0 ? `
        <div class="vigen-thumb-row">
          ${photos.slice(0, 3).map(p => `
            <div class="vigen-thumb">
              <img src="${p.secure_url?.replace('/upload/', '/upload/c_fill,w_80,h_60,q_auto/')}" loading="lazy">
            </div>`).join('')}
          ${photos.length > 3 ? `<div class="vigen-thumb-more">+${photos.length - 3}</div>` : ''}
        </div>` : ''}

      ${videos.length > 0 ? `
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin:6px 0 4px">Video Clips</div>
        <div class="vigen-thumb-row">
          ${videos.slice(0, 6).map(v => `
            <div class="vigen-thumb vigen-thumb-video">
              ${v.thumbnail_url
                ? `<img src="${v.thumbnail_url}" loading="lazy">`
                : '<div class="vigen-thumb-nopreview">🎬</div>'}
              <span class="vigen-thumb-label">${v.size_mb ? v.size_mb + 'MB' : ''}</span>
            </div>`).join('')}
        </div>` : ''}
    `;
  } catch (e) {
    // Jika gagal fetch (misal listing lama) — tidak block modal
    container.innerHTML = `
      <div class="pa-hint">
        ℹ️ Foto CRM listing akan digunakan otomatis. Tambah foto ekstra di bawah jika diperlukan.
      </div>`;
  }
}

async function submitViGenRender(listingId) {
  // Fallback ke _viGen state (dipanggil dari modal-vigen statis tanpa parameter)
  if (!listingId) listingId = window._viGen?.listingId;
  const mood     = document.querySelector('input[name="vigen-mood"]:checked')?.value || window._viGen?.mood || 'mewah';
  const duration = document.querySelector('input[name="vigen-duration"]:checked')?.value || String(window._viGen?.duration || 30);

  const btn = document.querySelector('#pa-vigen-modal .pa-btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengirim job render...'; }

  try {
    // ── Upload foto extra jika ada ────────────────────────
    const extraFiles = [1, 2, 3]
      .map(i => document.getElementById(`vigen-extra-${i}`)?.files?.[0])
      .filter(Boolean);

    if (extraFiles.length > 0) {
      if (btn) btn.textContent = `⏳ Upload ${extraFiles.length} foto tambahan...`;
      const formData = new FormData();
      extraFiles.forEach(f => formData.append('files', f));

      const uploadRes = await fetch(`/api/v1/media/upload/photos/${listingId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) {
        throw new Error(uploadData.message || 'Upload foto tambahan gagal');
      }
      if (btn) btn.textContent = '⏳ Mengirim job render...';
    }

    // ── Trigger render ────────────────────────────────────
    const res = await window.API.post('/pa/vigen/render', {
      listing_id:   listingId,
      listing_type: window._viGen?.listingType || 'secondary',
      mood,
      duration: parseInt(duration),
    });

    document.getElementById('pa-vigen-modal')?.remove();
    _showPAToast(`✅ ${res.message || 'Video render dimulai! Notifikasi akan muncul saat selesai.'}`, 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Render Video Sekarang'; }
    _showPAToast(`❌ ${e.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// MODAL WA BLAST
// ═══════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────────────
function _buildWAMessage(listingId) {
  const listing = (window._allListings || []).find(l => l.ID === listingId);
  const project = (window._projectsData || []).find(p => p.ID === listingId);
  const agen    = (window.STATE?.user?.nama || 'Tim MANSION Realty').split(' ').slice(0,2).join(' ');
  if (listing) {
    const harga  = listing.Harga_Format || (listing.Harga ? 'Rp\u00a0' + Number(listing.Harga).toLocaleString('id-ID') : 'Hubungi Agen');
    const lokasi = [listing.Kecamatan, listing.Kota].filter(Boolean).join(', ') || '—';
    return `Halo! 👋\n\nSaya ingin menawarkan properti eksklusif:\n\n🏠 *${listing.Judul || 'Properti'}*\n💰 ${harga}\n📍 ${lokasi}\n\nProperti ini sangat strategis. Apakah Anda tertarik mengetahui lebih lanjut?\n\nSalam,\n${agen} — MANSION Realty`;
  } else if (project) {
    const harga = project.Harga_Format || project.Harga_Mulai || 'On Request';
    return `Halo! 👋\n\nSaya ingin menawarkan proyek properti eksklusif:\n\n🏗️ *${project.Nama_Proyek || 'Proyek'}*\n💰 Mulai dari ${harga}\n\nProyek ini sangat strategis. Apakah Anda tertarik mengetahui lebih lanjut?\n\nSalam,\n${agen} — MANSION Realty`;
  }
  return `Halo! 👋\n\nSaya ingin menawarkan properti eksklusif dari MANSION Realty.\n\nApakah Anda tertarik untuk mengetahui lebih lanjut?\n\nSalam,\n${agen} — MANSION Realty`;
}

function _buildSessionInputs(sessionIdx) {
  const label = sessionIdx === 0
    ? '<span style="font-size:10px;background:rgba(37,211,102,0.15);color:#25d366;padding:1px 7px;border-radius:8px;font-weight:600">⚡ Langsung</span>'
    : `<span style="font-size:10px;color:rgba(255,255,255,0.35)">+${sessionIdx * 180} mnt</span>`;

  return `
    <div class="wa-session-block" id="wa-sess-${sessionIdx}"
      style="border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;margin-bottom:8px">

      <!-- Header (accordion toggle) -->
      <div onclick="_toggleWASession(${sessionIdx})"
        style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
               cursor:pointer;background:rgba(255,255,255,0.03);user-select:none">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:700;color:#fff">Sesi ${sessionIdx + 1}</span>
          ${label}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="wa-sess-${sessionIdx}-badge"
            style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.3)">0/5</span>
          <span style="font-size:10px;color:rgba(255,255,255,0.2)">▾</span>
        </div>
      </div>

      <!-- Body -->
      <div id="wa-sess-${sessionIdx}-body"
        style="padding:10px 14px;display:${sessionIdx === 0 ? 'block' : 'none'}">

        <!-- Tombol pilih kontak (hanya tampil jika Contact Picker API tersedia) -->
        <button id="wa-sess-${sessionIdx}-pick"
          onclick="_pickContactsForSession(${sessionIdx})"
          style="display:none;width:100%;margin-bottom:10px;padding:8px;border:1px dashed rgba(37,211,102,0.4);
                 border-radius:9px;background:rgba(37,211,102,0.06);color:#25d366;
                 font-size:12px;font-weight:600;cursor:pointer">
          📱 Pilih dari Kontak HP (maks 5)
        </button>

        <!-- Input nomor -->
        ${[0,1,2,3,4].map(j => `
          <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
            <span style="font-size:10px;color:rgba(255,255,255,0.25);width:14px;text-align:right;flex-shrink:0">${j+1}</span>
            <input type="tel" class="pa-input wa-num" data-sess="${sessionIdx}" data-slot="${j}"
              placeholder="628xxx..."
              style="flex:1;margin:0;font-size:13px;padding:7px 10px"
              oninput="_waNumInput(this)">
          </div>
        `).join('')}

        <div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:6px">
          Format 628xxx (tanpa +). Kosongkan slot yang tidak dipakai.
        </div>
      </div>
    </div>
  `;
}

function _toggleWASession(idx) {
  const body = document.getElementById(`wa-sess-${idx}-body`);
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
}

function _waNumInput(input) {
  const sess  = input.dataset.sess;
  const block = document.getElementById(`wa-sess-${sess}`);
  const inputs = block?.querySelectorAll('.wa-num') || [];
  const filled = [...inputs].filter(i => i.value.trim()).length;
  const badge  = document.getElementById(`wa-sess-${sess}-badge`);
  if (badge) {
    badge.textContent  = `${filled}/5`;
    badge.style.color  = filled > 0 ? '#4ade80' : 'rgba(255,255,255,0.3)';
  }
}

async function _pickContactsForSession(sessionIdx) {
  if (!('contacts' in navigator && 'ContactsManager' in window)) {
    _showPAToast('Fitur pilih kontak tidak tersedia di browser ini', 'error');
    return;
  }
  try {
    const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: true });
    if (!contacts || contacts.length === 0) return;

    const inputs = document.querySelectorAll(`#wa-sess-${sessionIdx} .wa-num`);
    let filled = 0;
    for (const input of inputs) {
      if (input.value.trim()) filled++;
    }

    for (const contact of contacts) {
      if (filled >= 5) break;
      const tel = (contact.tel || [])[0];
      if (!tel) continue;
      // Normalize to 628xxx format
      let num = tel.replace(/\D/g, '');
      if (num.startsWith('0')) num = '62' + num.slice(1);
      else if (!num.startsWith('62')) num = '62' + num;

      // Find next empty input
      for (const input of inputs) {
        if (!input.value.trim()) {
          input.value = num;
          filled++;
          break;
        }
      }
    }

    _waNumInput({ closest: (sel) => document.getElementById(`wa-sess-${sessionIdx}`)?.closest?.(sel) ?? { querySelector: () => null } });
    // Update badge manually
    const allInputs = document.querySelectorAll(`#wa-sess-${sessionIdx} .wa-num`);
    const count = [...allInputs].filter(i => i.value.trim()).length;
    const badge = document.getElementById(`wa-sess-${sessionIdx}-badge`);
    if (badge) {
      badge.textContent = `${count}/5`;
      badge.style.color = count > 0 ? '#4ade80' : 'rgba(255,255,255,0.3)';
    }

    _showPAToast(`${Math.min(contacts.length, 5 - (filled - contacts.length))} kontak dipilih`, 'success');
  } catch (e) {
    if (e.name !== 'AbortError') _showPAToast('Gagal membuka kontak: ' + e.message, 'error');
  }
}

async function openWABlastModal(listingId) {
  document.getElementById('pa-wa-modal')?.remove();

  const listing   = (window._allListings || []).find(l => l.ID === listingId);
  const project   = (window._projectsData || []).find(p => p.ID === listingId);
  const title     = listing?.Judul || project?.Nama_Proyek || listingId;
  const escapedId = listingId.replace(/'/g, "\\'");
  const message   = _buildWAMessage(listingId);

  // Cek mode (Fonnte atau manual) dari credentials
  let hasFonnte = false;
  try {
    const creds = await window.API.get('/pa/credentials');
    hasFonnte = !!(creds?.data?.fonnte_token);
  } catch {}

  const modeHtml = hasFonnte
    ? `<div style="display:flex;align-items:center;gap:8px;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.25);border-radius:10px;padding:10px 12px">
        <span style="font-size:18px">🤖</span>
        <div>
          <div style="font-size:12px;font-weight:700;color:#25d366">Fully Auto AI — Fonnte Aktif</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px">PA kirim otomatis ke semua nomor. Agen tidak perlu melakukan apapun.</div>
        </div>
      </div>`
    : `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;font-size:11px">
        <div style="font-weight:600;color:rgba(255,255,255,0.7);margin-bottom:8px">📋 Mode Pengiriman</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <tr style="color:rgba(255,255,255,0.35)">
            <td style="padding:3px 6px 3px 0;width:40%">Langkah</td>
            <td style="padding:3px 6px;color:#fbbf24;text-align:center">Semi Manual</td>
            <td style="padding:3px 6px;color:#25d366;text-align:center">Fully Auto AI</td>
          </tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.05)">
            <td style="padding:4px 6px 4px 0;color:rgba(255,255,255,0.5)">Siapkan pesan</td>
            <td style="text-align:center">🤖 PA</td><td style="text-align:center">🤖 PA</td>
          </tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.05)">
            <td style="padding:4px 6px 4px 0;color:rgba(255,255,255,0.5)">Jadwalkan sesi</td>
            <td style="text-align:center">🤖 PA</td><td style="text-align:center">🤖 PA</td>
          </tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.05)">
            <td style="padding:4px 6px 4px 0;color:rgba(255,255,255,0.5)">Kirim notifikasi</td>
            <td style="text-align:center">🤖 PA</td><td style="text-align:center">🤖 PA</td>
          </tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.05)">
            <td style="padding:4px 6px 4px 0;color:rgba(255,255,255,0.5)">Buka WA & kirim</td>
            <td style="text-align:center;color:#fbbf24">👤 Agen</td><td style="text-align:center;color:#25d366">🤖 PA</td>
          </tr>
        </table>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);font-size:10px;color:rgba(255,255,255,0.3)">
          💡 Upgrade ke <b style="color:#25d366">Fully Auto AI</b>: masukkan <b>Token Fonnte</b> di Pengaturan PA.
        </div>
      </div>`;

  const modal = document.createElement('div');
  modal.id = 'pa-wa-modal';
  modal.className = 'pa-modal-backdrop';
  modal.innerHTML = `
    <div class="pa-modal-box" style="max-height:92vh;overflow-y:auto">
      <div class="pa-modal-header">
        <span>📲 WA Blast Queue — PA</span>
        <button onclick="document.getElementById('pa-wa-modal').remove()">✕</button>
      </div>
      <div class="pa-modal-body">

        <div style="background:#1C2D52;border-radius:10px;padding:10px 12px;font-size:13px;color:#fff;font-weight:600;margin-bottom:2px">
          ${title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        </div>

        ${modeHtml}

        <div class="pa-info-box" style="font-size:11px;margin-top:2px">
          ⏱ PA jadwalkan otomatis: <b>Sesi 1</b> langsung · <b>+180 mnt</b> · <b>+360 mnt</b> · <b>+540 mnt</b>
        </div>

        <!-- 4 Session Inputs -->
        ${[0,1,2,3].map(i => _buildSessionInputs(i)).join('')}

        <!-- Pesan -->
        <div class="pa-form-group" style="margin-top:10px">
          <label>Pesan (sama untuk semua sesi, bisa diedit)</label>
          <textarea class="pa-textarea" id="wa-message-preview" rows="5">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
        </div>

        <button class="pa-btn-primary" onclick="submitWABlastQueue('${escapedId}')">
          📋 Queue ke PA
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Show contact picker buttons only on compatible browsers (mobile Chrome/Android)
  if ('contacts' in navigator && 'ContactsManager' in window) {
    for (let s = 0; s < 4; s++) {
      const btn = document.getElementById(`wa-sess-${s}-pick`);
      if (btn) btn.style.display = 'block';
    }
  }
}

async function submitWABlastQueue(listingId) {
  const message = document.getElementById('wa-message-preview')?.value?.trim();
  if (!message) { _showPAToast('Pesan tidak boleh kosong', 'error'); return; }

  // Kumpulkan sesi
  const sessions = [];
  for (let s = 0; s < 4; s++) {
    const inputs = document.querySelectorAll(`#wa-sess-${s} .wa-num`);
    const recipients = [...inputs]
      .map(i => i.value.trim())
      .filter(Boolean)
      .map(nomor => ({ nomor, type: 'personal' }));
    if (recipients.length > 0) sessions.push(recipients);
  }

  if (sessions.length === 0) {
    _showPAToast('Isi minimal 1 nomor di Sesi 1', 'error');
    return;
  }

  const btn = document.querySelector('#pa-wa-modal .pa-btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengirim ke PA...'; }

  try {
    const res = await window.API.post('/pa/trigger', {
      type:             'wa_blast',
      listing_id:       listingId,
      sessions,
      message_template: message,
    });

    document.getElementById('pa-wa-modal')?.remove();

    const total = sessions.reduce((a, s) => a + s.length, 0);
    _showPAToast(`✅ ${sessions.length} sesi · ${total} nomor dijadwalkan PA!`, 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Queue ke PA'; }
    _showPAToast(`❌ ${e.message}`, 'error');
  }
}

// ── WA Blast Session Runner (wa.me links) ────────────────────────

function _openWABlastSession({ job_id, session_number, recipients, message }) {
  document.getElementById('pa-wa-runner')?.remove();

  if (!recipients || recipients.length === 0) return;

  let currentIdx = 0;
  let countdownTimer = null;

  const panel = document.createElement('div');
  panel.id = 'pa-wa-runner';
  panel.style.cssText = `
    position:fixed;inset:0;z-index:1500;display:flex;align-items:flex-end;justify-content:center;
    background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)
  `;

  function renderCurrent() {
    if (currentIdx >= recipients.length) {
      // Semua selesai
      clearInterval(countdownTimer);
      window.API.post(`/pa/jobs/${job_id}/complete`).catch(() => {});
      _showPAToast(`✅ Sesi ${session_number} selesai — ${recipients.length} nomor dikirim`, 'success');
      panel.remove();
      _loadTodayJobCounts();
      return;
    }

    const { nomor } = recipients[currentIdx];
    const num  = nomor.replace(/\D/g, '').replace(/^0/, '62');
    const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
    const remaining = recipients.length - currentIdx;

    panel.innerHTML = `
      <div style="background:#0d1a30;border:1px solid rgba(212,175,55,0.3);border-radius:20px 20px 0 0;
                  width:100%;max-width:480px;padding:24px 20px 32px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="font-size:14px;font-weight:700;color:#fff">📲 WA Blast Sesi ${session_number}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4)">${currentIdx + 1} / ${recipients.length}</div>
        </div>

        <!-- Progress bar -->
        <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:4px;margin-bottom:18px">
          <div style="height:100%;width:${(currentIdx/recipients.length)*100}%;background:#25d366;border-radius:4px;transition:.3s"></div>
        </div>

        <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:6px">Nomor tujuan</div>
        <div style="font-size:18px;font-weight:700;color:#fff;font-family:monospace;margin-bottom:20px">${num}</div>

        <a href="${waUrl}" target="_blank" rel="noopener"
          onclick="_waRunnerNext(${currentIdx})"
          style="display:block;padding:14px;text-align:center;background:linear-gradient(135deg,#25d366,#128c7e);
                 border-radius:12px;color:#fff;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:12px">
          📱 Buka WA & Kirim
        </a>

        <div style="display:flex;gap:8px">
          <button onclick="_waRunnerSkip(${currentIdx})"
            style="flex:1;padding:10px;border:1px solid rgba(255,255,255,0.15);border-radius:10px;
                   background:transparent;color:rgba(255,255,255,0.5);font-size:12px;cursor:pointer">
            Lewati
          </button>
          <button onclick="panel.remove();clearInterval(countdownTimer)"
            style="flex:1;padding:10px;border:1px solid rgba(255,100,100,0.3);border-radius:10px;
                   background:transparent;color:rgba(255,100,100,0.7);font-size:12px;cursor:pointer">
            Stop Sesi
          </button>
        </div>

        ${remaining > 1 ? `<div style="font-size:11px;color:rgba(255,255,255,0.25);text-align:center;margin-top:12px">
          Setelah klik Buka WA & Kirim, nomor berikutnya otomatis muncul
        </div>` : ''}
      </div>
    `;

    // Ekspos fungsi ke inline onclick
    window._waRunnerNext = (idx) => {
      if (idx !== currentIdx) return;
      currentIdx++;
      setTimeout(renderCurrent, 300);
    };
    window._waRunnerSkip = (idx) => {
      if (idx !== currentIdx) return;
      currentIdx++;
      renderCurrent();
    };
  }

  document.body.appendChild(panel);
  renderCurrent();
}

// ═══════════════════════════════════════════════════════════
// MODAL IG POST (Reels / Story) — QUEUE SYSTEM
// ═══════════════════════════════════════════════════════════

function openIGPostModal(listingId, type) {
  document.getElementById('pa-ig-modal')?.remove();

  const listing      = (window._allListings || []).find(l => l.ID === listingId);
  const project      = (window._projectsData || []).find(p => p.ID === listingId);
  const title        = listing?.Judul || project?.Nama_Proyek || listingId;
  const caption      = (listing?.Caption_Sosmed || listing?.Caption || project?.Deskripsi || '').slice(0, 2200);
  const autoPhotoUrl = listing?.Foto_Utama_URL || listing?.Foto_2_URL || project?.Foto_1_URL || project?.Foto_2_URL || '';

  const typeLabel = type === 'ig_reels' ? 'Instagram Reels' : 'Instagram Story';
  const typeIcon  = type === 'ig_reels' ? '🎬' : '📸';
  const mediaHint = type === 'ig_story'
    ? 'Story: video ≤15 dtk (9:16) · atau gambar JPG/PNG (rasio 9:16 optimal)'
    : 'Reels: video MP4 ≤90 dtk (9:16) · gambar juga didukung';

  const escapedId    = listingId.replace(/'/g, "\\'");
  const escapedType  = type.replace(/'/g, "\\'");
  const escapedTitle = title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const escapedCaption = caption
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const queueBadge = _igQueue.length > 0
    ? `<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(225,48,108,0.12);border:1px solid rgba(225,48,108,0.3);border-radius:10px;padding:8px 12px;font-size:12px;color:#f472b6;font-weight:600">
        <span>⏳ Queue aktif: <strong>${_igQueue.length} post</strong> menunggu</span>
        <button onclick="_showIGQueuePanel()" style="background:none;border:none;color:#f472b6;font-size:11px;cursor:pointer;text-decoration:underline;padding:0">Lihat ›</button>
       </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'pa-ig-modal';
  modal.className = 'pa-modal-backdrop';
  modal.innerHTML = `
    <div class="pa-modal-box">
      <div class="pa-modal-header">
        <span>${typeIcon} ${typeLabel} via PA</span>
        <button onclick="document.getElementById('pa-ig-modal').remove()">✕</button>
      </div>
      <div class="pa-modal-body">

        ${queueBadge}

        <div class="pa-info-box">
          ⚡ Tambah beberapa listing ke <strong>Queue</strong>, lalu jalankan sekaligus. PA akan post secara berurutan dengan metode anti-bot.
        </div>

        <div style="background:#1C2D52;border-radius:10px;padding:10px 12px;font-size:13px;color:#fff;font-weight:600">
          ${escapedTitle}
        </div>

        <div class="pa-form-group">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label style="margin:0">Media <span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.35)">(opsional)</span></label>
            <div style="display:flex;gap:4px">
              <button id="ig-tab-url" onclick="_igSwitchTab('url')"
                style="padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:rgba(225,48,108,0.2);border:1px solid rgba(225,48,108,0.4);color:#f472b6">
                🔗 URL
              </button>
              <button id="ig-tab-file" onclick="_igSwitchTab('file')"
                style="padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:#131F38;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4)">
                📁 Upload
              </button>
            </div>
          </div>

          <div id="ig-tab-url-content">
            <input class="pa-input" id="ig-media-url" type="url"
              placeholder="https://... (video MP4, gambar JPG/PNG, hasil ViGen, dll)">
          </div>
          <div id="ig-tab-file-content" style="display:none">
            <label for="ig-media-file"
              style="display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed rgba(225,48,108,0.35);border-radius:12px;padding:18px 12px;cursor:pointer;gap:5px;background:rgba(225,48,108,0.04)">
              <span style="font-size:22px">📁</span>
              <span style="font-size:12px;color:#94a3b8">Klik untuk pilih file</span>
              <span id="ig-file-name" style="font-size:11px;color:#f472b6;max-width:240px;text-align:center;word-break:break-all"></span>
            </label>
            <input type="file" id="ig-media-file"
              accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/quicktime"
              style="display:none" onchange="_igFileSelected(this)">
          </div>
          <div class="pa-hint" style="margin-top:5px">${mediaHint}</div>

          ${autoPhotoUrl ? `
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 10px">
            <img src="${autoPhotoUrl}" style="width:44px;height:44px;object-fit:cover;border-radius:7px;flex-shrink:0" onerror="this.parentElement.style.display='none'">
            <div>
              <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:1px">Foto listing (dipakai otomatis jika media kosong)</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.25);word-break:break-all;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${autoPhotoUrl}</div>
            </div>
          </div>` : `
          <div style="margin-top:8px;font-size:11px;color:#f87171;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:8px;padding:7px 10px">
            ⚠️ Foto listing belum tersedia — media wajib diisi manual.
          </div>`}
        </div>

        <div class="pa-form-group">
          <label>Caption Instagram</label>
          <textarea class="pa-textarea" id="ig-caption-input" rows="4"
            placeholder="Caption, hashtag, emoji...">${escapedCaption}</textarea>
          <div class="pa-hint">Maks 2.200 karakter.</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="pa-btn-secondary" onclick="addToIGQueue('${escapedId}','${escapedType}')">
            ➕ Tambah ke Queue
          </button>
          <button class="pa-btn-primary" onclick="addToIGQueueAndShow('${escapedId}','${escapedType}')">
            ${typeIcon} Lanjut &amp; Jalankan
          </button>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function _igSwitchTab(tab) {
  const urlBtn  = document.getElementById('ig-tab-url');
  const fileBtn = document.getElementById('ig-tab-file');
  const urlDiv  = document.getElementById('ig-tab-url-content');
  const fileDiv = document.getElementById('ig-tab-file-content');
  if (!urlBtn || !fileBtn) return;

  if (tab === 'url') {
    urlBtn.style.cssText  = 'padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:rgba(225,48,108,0.2);border:1px solid rgba(225,48,108,0.4);color:#f472b6';
    fileBtn.style.cssText = 'padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:#131F38;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4)';
    urlDiv.style.display  = '';
    fileDiv.style.display = 'none';
  } else {
    fileBtn.style.cssText = 'padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:rgba(225,48,108,0.2);border:1px solid rgba(225,48,108,0.4);color:#f472b6';
    urlBtn.style.cssText  = 'padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;background:#131F38;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4)';
    urlDiv.style.display  = 'none';
    fileDiv.style.display = '';
  }
}

function _igFileSelected(input) {
  const file   = input.files?.[0];
  const nameEl = document.getElementById('ig-file-name');
  if (nameEl && file) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    nameEl.textContent = `${file.name} (${sizeMB} MB)`;
  }
}

function _igGetMediaInput() {
  const fileDiv = document.getElementById('ig-tab-file-content');
  const isFile  = fileDiv && fileDiv.style.display !== 'none';

  if (isFile) {
    const file = document.getElementById('ig-media-file')?.files?.[0];
    if (!file) return { useListingMedia: true }; // kosong → pakai foto listing
    return { file, mediaType: file.type.startsWith('video/') ? 'video' : 'image' };
  } else {
    const url = document.getElementById('ig-media-url')?.value?.trim();
    if (!url) return { useListingMedia: true }; // kosong → pakai foto listing
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    return { url, mediaType: ['mp4','mov','webm','avi'].includes(ext) ? 'video' : 'image' };
  }
}

function addToIGQueue(listingId, type) {
  const media = _igGetMediaInput();
  if (media.error) { _showPAToast(media.error, 'error'); return; }

  const caption = document.getElementById('ig-caption-input')?.value?.trim() || '';
  const listing = (window._allListings || []).find(l => l.ID === listingId);
  const project = (window._projectsData || []).find(p => p.ID === listingId);
  const title   = listing?.Judul || project?.Nama_Proyek || listingId;

  _igQueue.push({ listingId, title, type, caption, ...media });
  document.getElementById('pa-ig-modal')?.remove();
  _renderIGQueueBadge();
  _showPAToast(`➕ Ditambahkan ke queue! Total: ${_igQueue.length} post.`, 'success');
}

function addToIGQueueAndShow(listingId, type) {
  const media = _igGetMediaInput();
  if (media.error) { _showPAToast(media.error, 'error'); return; }

  const caption = document.getElementById('ig-caption-input')?.value?.trim() || '';
  const listing = (window._allListings || []).find(l => l.ID === listingId);
  const project = (window._projectsData || []).find(p => p.ID === listingId);
  const title   = listing?.Judul || project?.Nama_Proyek || listingId;

  _igQueue.push({ listingId, title, type, caption, ...media });
  document.getElementById('pa-ig-modal')?.remove();
  _renderIGQueueBadge();
  _showIGQueuePanel();
}

// ── Queue Badge (floating pill) ────────────────────────────
function _renderIGQueueBadge() {
  let badge = document.getElementById('pa-ig-queue-badge');
  if (_igQueue.length === 0) { badge?.remove(); return; }

  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'pa-ig-queue-badge';
    badge.onclick = _showIGQueuePanel;
    document.body.appendChild(badge);
  }
  badge.style.cssText = 'position:fixed;bottom:76px;right:14px;z-index:9990;background:linear-gradient(135deg,rgba(225,48,108,0.92),rgba(168,36,80,0.92));border-radius:28px;padding:9px 16px;display:flex;align-items:center;gap:7px;cursor:pointer;box-shadow:0 4px 20px rgba(225,48,108,0.45);font-size:13px;font-weight:700;color:#fff;backdrop-filter:blur(8px);user-select:none';
  badge.innerHTML = `⏳ Queue IG <span style="background:rgba(255,255,255,0.2);border-radius:12px;padding:1px 8px;font-size:15px;margin:0 2px">${_igQueue.length}</span> post ›`;
}

// ── Queue Panel (list + run) ────────────────────────────────
function _showIGQueuePanel() {
  document.getElementById('pa-ig-queue-panel')?.remove();

  const items = _igQueue.map((q, i) => {
    const isFile = !!q.file;
    const mediaLabel = q.useListingMedia
      ? '🖼️ foto listing (otomatis)'
      : q.mediaType === 'video'
        ? (isFile ? '🎥 video (lokal)' : '🎥 video (URL)')
        : (isFile ? '🖼️ gambar (lokal)' : '🖼️ gambar (URL)');
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:9px 10px;background:#131F38;border-radius:10px">
        <span style="font-size:18px;flex-shrink:0">${q.type === 'ig_reels' ? '🎬' : '📸'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${q.title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
          </div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px">
            ${q.type === 'ig_reels' ? 'Reels' : 'Story'} · ${mediaLabel}
          </div>
        </div>
        <button onclick="_removeFromIGQueue(${i})"
          style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.25);color:#f87171;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;flex-shrink:0">✕</button>
      </div>`;
  }).join('');

  const panel = document.createElement('div');
  panel.id = 'pa-ig-queue-panel';
  panel.className = 'pa-modal-backdrop';
  panel.innerHTML = `
    <div class="pa-modal-box">
      <div class="pa-modal-header">
        <span>⏳ IG Post Queue — ${_igQueue.length} post</span>
        <button onclick="document.getElementById('pa-ig-queue-panel').remove()">✕</button>
      </div>
      <div class="pa-modal-body">

        <div style="display:flex;flex-direction:column;gap:7px">
          ${items}
        </div>

        <div class="pa-info-box">
          PA akan memproses <strong>${_igQueue.length} post</strong> secara berurutan menggunakan metode anti-bot. Tambah lagi atau langsung jalankan.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="pa-btn-secondary" onclick="document.getElementById('pa-ig-queue-panel').remove()">
            ➕ Tambah Lagi
          </button>
          <button class="pa-btn-primary" id="pa-queue-run-btn" onclick="submitIGQueue()">
            ▶ Jalankan (${_igQueue.length})
          </button>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(panel);
}

function _removeFromIGQueue(index) {
  _igQueue.splice(index, 1);
  _renderIGQueueBadge();
  if (_igQueue.length === 0) {
    document.getElementById('pa-ig-queue-panel')?.remove();
    _showPAToast('Queue dikosongkan', 'success');
  } else {
    _showIGQueuePanel();
  }
}

// Flag untuk cancel countdown antar post
let _igQueueCancelled = false;

async function submitIGQueue() {
  if (_igQueue.length === 0) return;

  const btn = document.getElementById('pa-queue-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Memproses...'; }

  _igQueueCancelled = false;
  const total = _igQueue.length;
  let success = 0;
  let failed  = 0;
  const token = localStorage.getItem('crm_token') || localStorage.getItem('token');

  for (let i = 0; i < total; i++) {
    if (_igQueueCancelled) break;

    const item = _igQueue[i];
    _igQueueShowProgress(i + 1, total, item.title || item.listingId, 'posting');

    try {
      let mediaUrl  = item.url;
      let mediaType = item.mediaType;

      if (item.useListingMedia) {
        // Ambil foto utama dari data listing/project yang sudah di-load
        const ls = (window._allListings  || []).find(l => l.ID === item.listingId);
        const pj = (window._projectsData || []).find(p => p.ID === item.listingId);
        mediaUrl  = ls?.Foto_Utama_URL || ls?.Foto_2_URL || pj?.Foto_1_URL || pj?.Foto_2_URL || '';
        mediaType = 'image';
        if (!mediaUrl) throw new Error('Foto listing tidak tersedia. Buka modal dan upload media manual.');
      } else if (item.file) {
        const fd = new FormData();
        fd.append('files', item.file);
        const up = await fetch(`/api/v1/media/upload/photos/${item.listingId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const upData = await up.json();
        if (!upData.success) throw new Error(upData.message || 'Upload gagal');
        mediaUrl = upData.url || upData.urls?.[0];
      }

      await window.API.post('/pa/trigger', {
        type:             item.type,
        listing_id:       item.listingId,
        video_url:        mediaUrl,
        media_type:       mediaType,
        caption_override: item.caption || undefined,
      });
      success++;
    } catch (e) {
      failed++;
      console.error(`[IGQueue] job ${i + 1} gagal:`, e.message);
      _showPAToast(`⚠️ Post ke-${i + 1} gagal: ${e.message}`, 'error');
    }

    // Human-habit delay sebelum post berikutnya (bukan post terakhir)
    if (i < total - 1 && !_igQueueCancelled) {
      const delaySec = 60 + Math.floor(Math.random() * 120); // 1–3 menit
      const skipped = await _igQueueCountdown(delaySec, i + 2, total);
      if (!skipped && _igQueueCancelled) break;
    }
  }

  _igQueueRemoveProgress();
  _igQueue = [];
  _renderIGQueueBadge();
  document.getElementById('pa-ig-queue-panel')?.remove();

  if (_igQueueCancelled && success === 0 && failed === 0) {
    _showPAToast('Queue IG dibatalkan.', 'error');
  } else if (failed === 0) {
    _showPAToast(`✅ ${success} post IG dikirim ke PA! Pantau progress di Activity Log.`, 'success');
  } else {
    _showPAToast(`⚠️ ${success} berhasil · ${failed} gagal. Cek Activity Log.`, 'error');
  }
}

function _igQueueShowProgress(current, total, title, phase) {
  let bar = document.getElementById('pa-ig-progress-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pa-ig-progress-bar';
    bar.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;background:#0D1526;border:1px solid rgba(43,123,255,0.3);border-radius:14px;padding:12px 16px;min-width:280px;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">IG Queue ${current}/${total}</div>
    <div style="font-size:13px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${phase === 'posting' ? '📤' : '⏳'} ${title}</div>
  `;
}

function _igQueueRemoveProgress() {
  document.getElementById('pa-ig-progress-bar')?.remove();
}

// Countdown panel antar post — returns true jika di-skip, false jika habis/dibatalkan
function _igQueueCountdown(totalSec, nextIdx, total) {
  return new Promise(resolve => {
    let remaining = totalSec;
    let skipped   = false;

    const panel = document.createElement('div');
    panel.id    = 'pa-ig-countdown';
    panel.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;background:#0D1526;border:1px solid rgba(212,168,83,0.3);border-radius:14px;padding:14px 16px;min-width:280px;max-width:320px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5)';

    const render = () => {
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2, '0');
      panel.innerHTML = `
        <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Anti-bot delay</div>
        <div style="font-size:22px;font-weight:700;color:#D4A853;letter-spacing:2px">${m}:${s}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.45);margin:4px 0 10px">Post ke-${nextIdx}/${total} akan dikirim...</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button onclick="window._igSkipDelay()" style="padding:5px 14px;border-radius:8px;border:1px solid rgba(212,168,83,0.3);background:rgba(212,168,83,0.08);color:#D4A853;font-size:11px;cursor:pointer">Lewati</button>
          <button onclick="window._igCancelQueue()" style="padding:5px 14px;border-radius:8px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.06);color:#f87171;font-size:11px;cursor:pointer">Batalkan</button>
        </div>
      `;
    };

    window._igSkipDelay  = () => { skipped = true; clearInterval(timer); panel.remove(); resolve(true); };
    window._igCancelQueue = () => { _igQueueCancelled = true; clearInterval(timer); panel.remove(); resolve(false); };

    document.body.appendChild(panel);
    render();

    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        panel.remove();
        resolve(false);
      } else {
        render();
      }
    }, 1000);
  });
}

// ── Wrapper Project Detail ─────────────────────────────────
function openProjectIGPostModal(type) {
  const projectId = window._currentProjectId;
  if (!projectId) { _showPAToast('Tidak ada proyek aktif', 'error'); return; }
  openIGPostModal(projectId, type);
}

function openProjectWABlastModal() {
  const projectId = window._currentProjectId;
  if (!projectId) { _showPAToast('Tidak ada proyek aktif', 'error'); return; }
  openWABlastModal(projectId);
}

// ═══════════════════════════════════════════════════════════
// MODAL QR CODE (WA Re-pairing)
// ═══════════════════════════════════════════════════════════

function _showQRModal(platform, qrBase64, message) {
  document.getElementById('pa-qr-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'pa-qr-modal';
  modal.className = 'pa-modal-backdrop';
  modal.innerHTML = `
    <div class="pa-modal-box" style="text-align:center">
      <div class="pa-modal-header">
        <span>📲 WhatsApp Re-pairing Diperlukan</span>
        <button onclick="document.getElementById('pa-qr-modal').remove()">✕</button>
      </div>
      <div class="pa-modal-body">
        <p style="color:rgba(255,255,255,0.7);margin-bottom:16px">${message}</p>
        ${qrBase64 ? `<img src="data:image/png;base64,${qrBase64}" style="width:220px;height:220px;border-radius:8px;background:#fff;padding:8px">` : ''}
        <p style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:12px">Buka WhatsApp → titik tiga → Linked Devices → Link a Device</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ═══════════════════════════════════════════════════════════
// PA LOGS PANEL
// ═══════════════════════════════════════════════════════════

function _renderPALogsPanel() {
  const panel = document.getElementById('pa-logs-panel');
  if (!panel) return;

  if (_paLogs.length === 0) {
    panel.innerHTML = '<div class="pa-log-empty">Menunggu aktivitas PA...</div>';
    return;
  }

  panel.innerHTML = _paLogs.map(log => {
    const icon = {
      job_queued: '⏳', job_done: '✅', job_failed: '❌',
      qr_required: '🔑', connected: '🔗',
    }[log.event] || '•';

    const time = log.ts ? new Date(log.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const typeTag = log.type ? `<span class="pa-log-type">${PA_TYPES[log.type]?.label || log.type}</span>` : '';

    return `
      <div class="pa-log-item ${log.event === 'job_failed' ? 'pa-log-error' : ''}">
        <span class="pa-log-icon">${icon}</span>
        <div class="pa-log-content">
          <div class="pa-log-msg">${log.message || log.event}</div>
          <div class="pa-log-meta">${time} ${typeTag}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

async function _loadTodayJobCounts() {
  try {
    const res = await window.API.get('/pa/jobs?limit=100');
    const today = new Date().toISOString().slice(0, 10);
    const todayJobs = (res.data || []).filter(j => j.created_at?.startsWith(today));

    const counts = { ig_reels: 0, ig_story: 0, wa_blast: 0 };
    todayJobs.forEach(j => { if (counts[j.type] !== undefined) counts[j.type]++; });

    const limits = { ig_reels: 5, ig_story: 5, wa_blast: 4 };
    Object.entries(counts).forEach(([type, count]) => {
      const el = document.getElementById(`pa-count-${type}`);
      if (el) {
        el.textContent = `${count}/${limits[type]}`;
        el.style.color = count >= limits[type] ? '#ef4444' : '#4ade80';
      }
    });
  } catch {}
}

function _statusBadgeClass(status) {
  const map = {
    active:             'pa-badge-active',
    challenge_required: 'pa-badge-warning',
    qr_required:        'pa-badge-warning',
    not_configured:     'pa-badge-inactive',
  };
  return map[status] || 'pa-badge-inactive';
}

function _statusLabel(status) {
  const map = {
    active:             '● Aktif',
    challenge_required: '⚠ Challenge',
    qr_required:        '⚠ Perlu QR',
    not_configured:     '○ Belum Setup',
  };
  return map[status] || '○ Belum Setup';
}

function _formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function _showPAToast(message, type = 'info') {
  // Gunakan toast dari app-mobile.js jika tersedia
  if (window.showToast) { window.showToast(message, type); return; }

  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${type === 'success' ? '#166534' : type === 'error' ? '#7f1d1d' : '#1e3a5f'};
    color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;
    z-index:9999;max-width:90vw;text-align:center;
    animation:fadeIn 0.2s ease;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════
// CSS STYLES
// ═══════════════════════════════════════════════════════════

function _injectPAStyles() {
  if (document.getElementById('pa-styles')) return;
  const style = document.createElement('style');
  style.id = 'pa-styles';
  style.textContent = `
    /* ── PA Modal Sheet animation ────────────────── */
    #pa-credentials-sidebar .modal-sheet {
      opacity:0;transform:translateY(16px);
      transition:opacity 0.2s ease,transform 0.2s ease;
    }

    /* ── Sections ───────────────────────────────── */
    .pa-section { background:rgba(255,255,255,0.04);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px }
    .pa-section-title { font-size:13px;font-weight:600;color:rgba(255,255,255,0.8);display:flex;align-items:center;gap:8px }
    .pa-status-row { display:flex;align-items:center;justify-content:space-between;padding:4px 0 }
    .pa-status-row>span { font-size:13px;color:rgba(255,255,255,0.7) }

    /* ── Toggle ─────────────────────────────────── */
    .pa-toggle { position:relative;display:inline-block;width:44px;height:24px }
    .pa-toggle input { opacity:0;width:0;height:0 }
    .pa-toggle-slider { position:absolute;inset:0;background:#333;border-radius:24px;transition:.3s }
    .pa-toggle-slider:before { content:'';position:absolute;width:18px;height:18px;bottom:3px;left:3px;background:#fff;border-radius:50%;transition:.3s }
    .pa-toggle input:checked + .pa-toggle-slider { background:#d4af37 }
    .pa-toggle input:checked + .pa-toggle-slider:before { transform:translateX(20px) }

    /* ── Inputs ─────────────────────────────────── */
    .pa-input,.pa-select,.pa-textarea {
      width:100%;padding:9px 12px;background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.12);border-radius:6px;
      color:#fff;font-size:13px;box-sizing:border-box;
    }
    .pa-input:focus,.pa-select:focus,.pa-textarea:focus { border-color:#d4af37;outline:none }
    .pa-select-sm { padding:4px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#fff;font-size:12px }
    .pa-textarea { resize:vertical;min-height:80px;font-family:inherit }
    .pa-hint { font-size:11px;color:rgba(255,255,255,0.35);line-height:1.4 }
    .pa-last-login { font-size:11px;color:rgba(212,175,55,0.6) }

    /* ── Badges ─────────────────────────────────── */
    .pa-status-badge { font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500;margin-left:auto }
    .pa-badge-active   { background:rgba(74,222,128,0.15);color:#4ade80 }
    .pa-badge-warning  { background:rgba(251,191,36,0.15);color:#fbbf24 }
    .pa-badge-inactive { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.3) }
    .pa-badge-error    { background:rgba(248,113,113,0.15);color:#f87171 }
    .pa-badge-pending  { background:rgba(251,191,36,0.12);color:#fbbf24 }
    .pa-badge-checking { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.35) }
    .pa-badge-idle     { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.3) }

    /* ── Buttons ─────────────────────────────────── */
    .pa-btn-save,.pa-btn-primary {
      width:100%;padding:12px;border:none;border-radius:8px;
      background:linear-gradient(135deg,#d4af37,#b8941e);color:#000;
      font-size:14px;font-weight:700;cursor:pointer;
    }
    .pa-btn-save:hover,.pa-btn-primary:hover { opacity:0.9 }
    .pa-btn-save:disabled,.pa-btn-primary:disabled { opacity:0.5;cursor:not-allowed }
    .pa-btn-secondary {
      width:100%;padding:12px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;
      background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.8);
    }
    .pa-btn-secondary:hover { background:rgba(255,255,255,0.1) }

    /* ── Limits Grid ────────────────────────────── */
    .pa-limits-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:8px }
    .pa-limit-card { display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;background:rgba(255,255,255,0.04);border-radius:6px }
    .pa-limit-icon { font-size:18px }
    .pa-limit-label { font-size:10px;color:rgba(255,255,255,0.4) }
    .pa-limit-count { font-size:13px;font-weight:700;color:#4ade80 }

    /* ── Logs Panel ─────────────────────────────── */
    .pa-logs-panel { max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-bottom:4px }
    .pa-log-empty { font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:20px }
    .pa-log-item { display:flex;gap:8px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;align-items:flex-start }
    .pa-log-item.pa-log-error { background:rgba(239,68,68,0.08);border-left:2px solid #ef4444 }
    .pa-log-icon { font-size:14px;flex-shrink:0;margin-top:1px }
    .pa-log-content { flex:1;min-width:0 }
    .pa-log-msg { font-size:12px;color:rgba(255,255,255,0.8);line-height:1.4 }
    .pa-log-meta { font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;display:flex;gap:8px }
    .pa-log-type { background:rgba(212,175,55,0.15);color:#d4af37;padding:1px 6px;border-radius:4px }

    /* ── Modals ─────────────────────────────────── */
    .pa-modal-backdrop { position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1300;display:flex;align-items:center;justify-content:center;padding:16px }
    .pa-modal-box { background:#0f1923;border:1px solid rgba(212,175,55,0.2);border-radius:12px;width:100%;max-width:400px;max-height:90vh;overflow-y:auto }
    .pa-modal-header { display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:14px;font-weight:600;color:#d4af37 }
    .pa-modal-header button { background:none;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer }
    .pa-modal-body { padding:16px;display:flex;flex-direction:column;gap:14px }
    .pa-form-group { display:flex;flex-direction:column;gap:8px }
    .pa-form-group label { font-size:12px;color:rgba(255,255,255,0.6) }
    .pa-radio-group { display:flex;flex-direction:column;gap:6px }
    .pa-radio-group label { display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,0.8);cursor:pointer }
    .pa-info-box { background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.2);border-radius:6px;padding:12px;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.5 }

    /* ── WA Recipient ───────────────────────────── */
    .wa-recipient-row { display:flex;gap:8px }
    .wa-recipient-row .pa-input { flex:1 }

    /* ── ViGen Media Preview ─────────────────────── */
    .vigen-media-preview { display:flex;flex-direction:column;gap:6px }
    .vigen-media-stats { display:flex;gap:6px;flex-wrap:wrap }
    .vigen-stat-pill { font-size:11px;padding:3px 10px;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.2);border-radius:20px;color:#d4af37 }
    .vigen-thumb-row { display:flex;gap:6px;flex-wrap:wrap }
    .vigen-thumb { width:72px;height:54px;border-radius:5px;overflow:hidden;background:#111;border:1px solid rgba(255,255,255,0.08);flex-shrink:0;position:relative }
    .vigen-thumb img { width:100%;height:100%;object-fit:cover }
    .vigen-thumb-video { border-color:rgba(212,175,55,0.3) }
    .vigen-thumb-nopreview { width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;color:rgba(255,255,255,0.3) }
    .vigen-thumb-label { position:absolute;bottom:2px;right:3px;font-size:9px;color:#d4af37;background:rgba(0,0,0,0.7);padding:1px 3px;border-radius:3px }
    .vigen-thumb-more { width:72px;height:54px;border-radius:5px;background:rgba(212,175,55,0.08);border:1px dashed rgba(212,175,55,0.3);display:flex;align-items:center;justify-content:center;font-size:12px;color:#d4af37;flex-shrink:0 }
    .vigen-no-crm-photo { font-size:12px;color:rgba(255,255,255,0.4);padding:8px 0 }

    /* ── ViGen Extra Photo Slots ─────────────────── */
    .vigen-extra-header { display:flex;align-items:center;gap:8px;margin-bottom:8px }
    .vigen-extra-header label { font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);margin:0 }
    .vigen-extra-badge { font-size:10px;color:rgba(212,175,55,0.7);background:rgba(212,175,55,0.07);border:1px solid rgba(212,175,55,0.2);border-radius:20px;padding:2px 8px }
    .vigen-extra-slots { display:flex;gap:10px }
    .vigen-extra-slot { width:80px;flex-shrink:0;position:relative }
    .vigen-slot-btn { width:80px;height:64px;border-radius:8px;border:1.5px dashed rgba(212,175,55,0.4);background:rgba(212,175,55,0.04);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;transition:border-color .2s,background .2s }
    .vigen-slot-btn:hover { border-color:rgba(212,175,55,0.8);background:rgba(212,175,55,0.08) }
    .vigen-slot-icon { font-size:20px;color:rgba(212,175,55,0.6);line-height:1 }
    .vigen-slot-label { font-size:10px;color:rgba(255,255,255,0.45) }
    .vigen-slot-preview { width:80px;height:64px;border-radius:8px;overflow:hidden;position:relative;border:1.5px solid rgba(212,175,55,0.5) }
    .vigen-slot-preview img { width:100%;height:100%;object-fit:cover;display:block }
    .vigen-slot-clear { position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.75);border:none;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 }
    .vigen-slot-clear:hover { background:rgba(200,50,50,0.85) }

    /* ── Listing Buttons ────────────────────────── */
    .btn-pa-ads,.btn-pa-wa {
      display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;
      font-size:13px;font-weight:600;cursor:pointer;border:none;
    }
    .btn-pa-ads { background:linear-gradient(135deg,#d4af37,#b8941e);color:#000 }
    .btn-pa-wa  { background:rgba(37,211,102,0.15);color:#25d366;border:1px solid rgba(37,211,102,0.3) }
    .btn-pa-ads:hover { opacity:0.9 }
    .btn-pa-wa:hover  { background:rgba(37,211,102,0.25) }
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════
// EXPORTS (untuk dipakai di app-mobile.js)
// ═══════════════════════════════════════════════════════════

window.initPADashboard         = initPADashboard;
window.openPACredentialsSidebar = openPACredentialsSidebar;
window.closePACredentialsSidebar = closePACredentialsSidebar;
window.savePACredentials       = savePACredentials;
window.openViGenModal          = openViGenModal;
window.submitViGenRender       = submitViGenRender;
window.openWABlastModal        = openWABlastModal;
window.submitWABlast           = submitWABlastQueue;
window._pickContactsForSession = _pickContactsForSession;
window.openIGPostModal         = openIGPostModal;
window.openProjectWABlastModal = openProjectWABlastModal;
window.openProjectIGPostModal  = openProjectIGPostModal;
