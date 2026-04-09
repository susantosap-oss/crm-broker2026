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
let _sseConnection = null;
let _paLogs        = [];      // Buffer logs untuk tampilkan di UI
const MAX_LOGS     = 50;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

function initPADashboard() {
  _injectPAStyles();
  _connectSSE();
  _initCreateAdsButtons();
  console.log('[PA Dashboard] Initialized');
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
  } else if (event === 'job_queued') {
    _showPAToast(`⏳ ${message}`, 'info');
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
          <div>
            <label class="form-label">Username Instagram</label>
            <input class="form-input" id="pa-ig-username" type="text"
              placeholder="contoh: agen.mansion (tanpa @)"
              value="${creds?.ig_username || ''}" autocomplete="off">
          </div>
          <div>
            <label class="form-label">Password Instagram</label>
            <input class="form-input" id="pa-ig-password" type="password"
              placeholder="Kosongkan jika tidak ingin mengubah" autocomplete="new-password">
            <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:6px 0 0;line-height:1.5">🔒 Disimpan terenkripsi AES-256. Hanya dipakai saat session login expired.</p>
          </div>
          ${creds?.last_ig_login ? `<div style="font-size:11px;color:rgba(212,175,55,0.6)">Login terakhir: ${_formatDate(creds.last_ig_login)}</div>` : ''}
        </div>

        <!-- Section WA -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:13px;font-weight:600;color:#fff">📲 WhatsApp</span>
            <span class="pa-status-badge ${_statusBadgeClass(creds?.wa_status)}">${_statusLabel(creds?.wa_status)}</span>
          </div>
          <div>
            <label class="form-label">Nomor WhatsApp Business</label>
            <input class="form-input" id="pa-wa-number" type="tel"
              placeholder="contoh: 628123456789 (awali 62, tanpa +)"
              value="${creds?.wa_number || ''}" autocomplete="off">
            <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:6px 0 0;line-height:1.5">📱 Nomor harus aktif di WA Web. Scan QR diminta saat pertama kali atau session expired.</p>
          </div>
          ${creds?.last_wa_login ? `<div style="font-size:11px;color:rgba(212,175,55,0.6)">Paired terakhir: ${_formatDate(creds.last_wa_login)}</div>` : ''}
        </div>

        <!-- Batas Harian -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px">
          <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);margin-bottom:10px">📊 Batas Harian (Hari Ini)</div>
          <div class="pa-limits-grid" id="pa-limits-grid">
            <div class="pa-limit-card"><span class="pa-limit-icon">🎬</span><span class="pa-limit-label">IG Reels</span><span class="pa-limit-count" id="pa-count-ig_reels">-/5</span></div>
            <div class="pa-limit-card"><span class="pa-limit-icon">📸</span><span class="pa-limit-label">IG Story</span><span class="pa-limit-count" id="pa-count-ig_story">-/5</span></div>
            <div class="pa-limit-card"><span class="pa-limit-icon">📲</span><span class="pa-limit-label">WA Blast</span><span class="pa-limit-count" id="pa-count-wa_blast">-/2</span></div>
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
              <span><b>Zapier</b><br><span style="font-size:10px;font-weight:400;opacity:.7">Rekomendasi — Mudah, tanpa Meta App</span></span>
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
                Pilih mode Zapier atau Meta jika ingin otomatis.
              </p>
              <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
                <p style="font-size:10px;color:rgba(255,255,255,0.25);margin:0;line-height:1.6">
                  💡 <b style="color:rgba(255,255,255,0.35)">Rekomendasi untuk mulai:</b> pilih mode <b>Zapier</b> di atas — tidak perlu daftar Meta Developer, cukup akun Zapier gratis.
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
              <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Secret Key (field "secret" di Zapier)</p>
              ${creds?.zapier_secret ? `
              <div style="display:flex;gap:6px;align-items:center">
                <code id="wb-zapier-secret" style="flex:1;font-size:10px;color:#D4A853;word-break:break-all;background:#0D1526;padding:7px 8px;border-radius:6px;border:1px solid rgba(212,168,83,0.2)">${creds.zapier_secret}</code>
                <button onclick="wbCopy('wb-zapier-secret')" style="flex-shrink:0;padding:7px 9px;border-radius:6px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.2);color:#D4A853;font-size:12px;cursor:pointer">📋</button>
              </div>
              <button onclick="wbGenerateZapierSecret()" style="width:100%;margin-top:8px;padding:7px;border-radius:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);color:#f87171;font-size:10px;cursor:pointer">
                🔄 Generate Ulang (Zapier perlu diupdate)
              </button>` : `
              <p style="font-size:11px;color:rgba(255,255,255,0.35);margin:0 0 8px">Belum ada secret key. Generate dulu:</p>
              <button onclick="wbGenerateZapierSecret()" style="width:100%;padding:10px;border-radius:10px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.3);color:#D4A853;font-size:12px;font-weight:600;cursor:pointer">
                🔑 Generate Secret Key
              </button>`}
            </div>

            <!-- Context: Apa itu Zapier? -->
            <details style="margin-bottom:8px;border:1px solid rgba(34,197,94,0.12);border-radius:8px;overflow:hidden">
              <summary style="padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);cursor:pointer;list-style:none;background:rgba(34,197,94,0.03)">
                ❓ Apa itu Zapier & kenapa direkomendasikan? <span style="opacity:.5">(klik)</span>
              </summary>
              <div style="padding:10px;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.8;background:rgba(34,197,94,0.02)">
                <b style="color:#4ade80">Zapier</b> adalah platform "jembatan" yang menghubungkan dua aplikasi tanpa coding.<br><br>
                <b style="color:rgba(255,255,255,0.7)">Kenapa Zapier lebih mudah dari Meta Developer?</b><br>
                ✅ Tidak perlu daftar Meta Developer Account<br>
                ✅ Tidak perlu App Review dari Meta (bisa jadi berbulan-bulan)<br>
                ✅ Setup 10 menit via browser<br>
                ✅ Zapier sudah punya integrasi resmi Meta Lead Ads<br><br>
                <b style="color:rgba(255,255,255,0.7)">Biaya Zapier:</b><br>
                Plan gratis: 100 Zap runs/bulan — cukup untuk &lt;100 lead/bulan.<br>
                Plan Starter (~$20/bln): 750 runs. Untuk volume tinggi pakai Meta Langsung.
              </div>
            </details>

            <!-- Instruksi setup -->
            <details style="margin-bottom:4px">
              <summary style="font-size:11px;color:rgba(255,255,255,0.45);cursor:pointer;padding:6px 0;list-style:none">
                📋 Tutorial setup Zapier step-by-step <span style="opacity:.5">(klik)</span>
              </summary>
              <div style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.8;padding:8px 4px 0">
                <b style="color:rgba(255,255,255,0.7)">Persiapan:</b><br>
                • Akun <a href="https://zapier.com" target="_blank" style="color:#4ade80">zapier.com</a> (daftar gratis)<br>
                • Facebook Page yang sudah terhubung ke iklan<br>
                • Lead Form sudah aktif di iklan FB/IG<br><br>
                <b style="color:rgba(255,255,255,0.7)">Langkah:</b><br>
                1. Buka <b style="color:#D4A853">zapier.com</b> → <i>Create Zap</i><br>
                2. <b>Trigger:</b> cari <i>"Meta Lead Ads"</i> → pilih <i>New Lead</i><br>
                &nbsp;&nbsp;→ Hubungkan akun Facebook → pilih <b>Page</b> & <b>Form</b> iklanmu<br>
                3. <b>Action:</b> cari <i>"Webhooks by Zapier"</i> → pilih <i>POST</i><br>
                4. <b>URL:</b> paste <i>Webhook URL Kamu</i> dari kotak hijau di atas<br>
                5. <b>Payload Type:</b> pilih <b>JSON</b><br>
                6. <b>Data — tambahkan baris berikut:</b><br>
                <div style="background:#0D1526;border-radius:6px;padding:8px;margin:6px 0;font-family:monospace">
                  <span style="color:#60a5fa">secret</span> → <span style="color:#4ade80">paste Secret Key dari kotak emas</span><br>
                  <span style="color:#60a5fa">name</span> → <span style="color:rgba(255,255,255,0.5)">pilih field "Full Name" dari trigger</span><br>
                  <span style="color:#60a5fa">phone</span> → <span style="color:rgba(255,255,255,0.5)">pilih field "Phone Number"</span><br>
                  <span style="color:#60a5fa">email</span> → <span style="color:rgba(255,255,255,0.5)">pilih field "Email"</span><br>
                  <span style="color:#60a5fa">form_name</span> → <span style="color:rgba(255,255,255,0.5)">pilih "Form Name"</span><br>
                  <span style="color:#60a5fa">ad_name</span> → <span style="color:rgba(255,255,255,0.5)">pilih "Ad Name"</span>
                </div>
                7. <b>Test</b> → jika sukses, klik <b>Publish</b><br><br>
                ✅ Selesai! Lead dari iklan akan otomatis masuk ke CRM dalam &lt;2 menit.
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
                <b style="color:#60a5fa">Meta for Developers</b> adalah platform resmi Meta untuk integrasi langsung tanpa perantara (tanpa Zapier).<br><br>
                <b style="color:rgba(255,255,255,0.7)">Keuntungan vs Zapier:</b><br>
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
            <!-- Base URL (sama seperti Zapier) -->
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
}

async function savePACredentials() {
  const igUsername = document.getElementById('pa-ig-username')?.value?.trim();
  const igPassword = document.getElementById('pa-ig-password')?.value;
  const waNumber   = document.getElementById('pa-wa-number')?.value?.trim();
  const paEnabled  = document.getElementById('pa-enabled-toggle')?.checked;

  const body = { pa_enabled: paEnabled };
  if (igUsername) body.ig_username = igUsername;
  if (igPassword) body.ig_password = igPassword;
  if (waNumber)   body.wa_number   = waNumber;

  try {
    await window.API.post('/pa/credentials', body);
    _showPAToast('✅ Pengaturan PA disimpan', 'success');

    // Clear password field setelah simpan
    const pwdField = document.getElementById('pa-ig-password');
    if (pwdField) pwdField.value = '';
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
    const labels = { zapier: 'Zapier', meta: 'Meta for Developer', none: 'Tidak Pakai' };
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
  if (isRegen && !confirm('Generate ulang Secret Key?\nZapier yang sudah dikonfigurasi harus diupdate dengan key baru.')) return;
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
  const mood     = document.querySelector('input[name="vigen-mood"]:checked')?.value || 'mewah';
  const duration = document.querySelector('input[name="vigen-duration"]:checked')?.value || '30';

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
      listing_id: listingId,
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

function openWABlastModal(listingId, listingTitle, videoUrl) {
  document.getElementById('pa-wa-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'pa-wa-modal';
  modal.className = 'pa-modal-backdrop';
  modal.innerHTML = `
    <div class="pa-modal-box">
      <div class="pa-modal-header">
        <span>📲 WA Blast Personal Assistant</span>
        <button onclick="document.getElementById('pa-wa-modal').remove()">✕</button>
      </div>
      <div class="pa-modal-body">

        <div class="pa-info-box">
          ⚡ PA akan mengirim pesan ke <strong>maks 5 nomor/sesi</strong>, <strong>2 sesi/hari</strong>. PA akan mengetik pesan secara alami (3–7 detik) agar terlihat human-like.
        </div>

        <div class="pa-form-group">
          <label>Sesi ke- (hari ini)</label>
          <select class="pa-select" id="wa-session-number">
            <option value="1">Sesi 1 (Nomor 1–5)</option>
            <option value="2">Sesi 2 (Nomor 6–10)</option>
          </select>
        </div>

        <div class="pa-form-group">
          <label>Nomor Tujuan (maks 5, satu per baris)</label>
          <div id="wa-recipient-list">
            ${[1,2,3,4,5].map(i => `
              <div class="wa-recipient-row">
                <input class="pa-input wa-nomor" type="tel" placeholder="628xxx... atau Nama Grup">
                <select class="pa-select-sm wa-type">
                  <option value="personal">Personal</option>
                  <option value="group">Grup WA</option>
                </select>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="pa-form-group">
          <label>Preview Pesan</label>
          <textarea class="pa-textarea" id="wa-message-preview" rows="5"
            placeholder="Pesan akan otomatis diisi dengan info listing..."></textarea>
          <div class="pa-hint">Pesan dapat diedit. {nama_listing}, {harga}, {lokasi} akan otomatis diganti.</div>
        </div>

        <button class="pa-btn-primary" onclick="submitWABlast('${listingId}')">
          📲 Mulai WA Blast via PA
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Auto-fill pesan template
  _loadWATemplate(listingId);
}

async function _loadWATemplate(listingId) {
  const textarea = document.getElementById('wa-message-preview');
  if (!textarea) return;

  textarea.value = `Halo! 👋\n\nKami ingin menawarkan properti eksklusif dari MANSION Realty:\n\n🏠 [Judul Listing]\n💰 [Harga]\n📍 [Lokasi]\n\nProperti ini sangat strategis dan harga sangat kompetitif. Apakah Anda tertarik untuk mengetahui lebih lanjut?\n\nSalam,\nTim MANSION Realty`;
}

async function submitWABlast(listingId) {
  const sessionNumber = parseInt(document.getElementById('wa-session-number')?.value) || 1;
  const message       = document.getElementById('wa-message-preview')?.value?.trim();

  if (!message) { _showPAToast('Pesan tidak boleh kosong', 'error'); return; }

  // Kumpulkan recipients
  const recipients = [];
  const nomorInputs = document.querySelectorAll('.wa-nomor');
  const typeSelects = document.querySelectorAll('.wa-type');
  nomorInputs.forEach((input, idx) => {
    const nomor = input.value.trim();
    if (!nomor) return;
    recipients.push({
      nomor,
      type: typeSelects[idx]?.value || 'personal',
    });
  });

  if (recipients.length === 0) {
    _showPAToast('Tambahkan minimal 1 nomor tujuan', 'error');
    return;
  }

  const btn = document.querySelector('#pa-wa-modal .pa-btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengirim ke PA...'; }

  try {
    await window.API.post('/pa/trigger', {
      type:            'wa_blast',
      listing_id:      listingId,
      recipients,
      message_template: message,
      session_number:  sessionNumber,
    });

    document.getElementById('pa-wa-modal')?.remove();
    _showPAToast('✅ WA Blast diterima PA! Proses akan berjalan di background.', 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📲 Mulai WA Blast via PA'; }
    _showPAToast(`❌ ${e.message}`, 'error');
  }
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

    const limits = { ig_reels: 5, ig_story: 5, wa_blast: 2 };
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
    /* ── PA Modal Form ───────────────────────────── */
    #pa-credentials-sidebar {
      position:fixed;inset:0;z-index:1200;
      background:rgba(0,0,0,0.75);
      display:flex;align-items:flex-end;justify-content:center;
    }
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

    /* ── Buttons ─────────────────────────────────── */
    .pa-btn-save,.pa-btn-primary {
      width:100%;padding:12px;border:none;border-radius:8px;
      background:linear-gradient(135deg,#d4af37,#b8941e);color:#000;
      font-size:14px;font-weight:700;cursor:pointer;
    }
    .pa-btn-save:hover,.pa-btn-primary:hover { opacity:0.9 }
    .pa-btn-save:disabled,.pa-btn-primary:disabled { opacity:0.5;cursor:not-allowed }

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
window.submitWABlast           = submitWABlast;
