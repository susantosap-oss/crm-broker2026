/**
 * CRM Broker Properti - GAS Edition
 * Frontend SPA — Mobile First, Tailwind CSS
 * ==========================================
 * Vanilla JS, no framework dependencies.
 * All data from REST API backed by Google Sheets SSoT.
 */

// ── STATE ──────────────────────────────────────────────────
const STATE = {
  user: null, token: null,
  listings: [], leads: [], tasks: [],
  pipelineStages: [],
  currentPage: 'dashboard',
  taskFilter: { date: null, status: 'all' },
  listingFilter: 'all',
  leadFilter: 'all',
  fabOpen: false,
};
let _currentBundle = null; // sosmed bundle state (not stored in HTML attr)

// ── API CLIENT ─────────────────────────────────────────────
const API = {
  BASE: '/api/v1',

  async request(method, path, data = null, isFormData = false) {
    const headers = { Authorization: `Bearer ${STATE.token}` };
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.BASE}${path}`, {
      method,
      headers,
      body: data ? (isFormData ? data : JSON.stringify(data)) : null,
    });

    // Auto-redirect on 401
    if (res.status === 401) {
      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      localStorage.removeItem('crm_login_at');
      STATE.token = null; STATE.user = null;
      showLoginScreen();
      showToast('Sesi berakhir. Silakan login ulang.', 'error');
      throw new Error('Unauthorized');
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return json;
  },

  get:    (p)    => API.request('GET', p),
  post:   (p, d, f) => API.request('POST', p, d, f),
  patch:  (p, d) => API.request('PATCH', p, d),
  put:    (p, d, f) => API.request('PUT', p, d, f),
  delete: (p)    => API.request('DELETE', p),
};

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('crm_token');
  const user  = localStorage.getItem('crm_user');

  if (token && user) {
    STATE.token = token;
    STATE.user  = JSON.parse(user);
    showApp();
  } else {
    showLoginScreen();
  }

  // Inject version — dijalankan selalu, tidak bergantung SW
  const meta = document.querySelector('meta[name="app-version"]');
  if (meta) {
    const v = meta.content;
    ['app-version-label', 'sidebar-version-label', 'login-version-label'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = id === 'app-version-label' ? `v${v}` : `Mansion CRM v${v}`;
    });
  }

  setupPWA();
  setHeroDate();

  // Simpan draft saat PWA di-background; hapus jika kembali tanpa reload
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveDraftState();
    else localStorage.removeItem('crm_draft_state');
  });
  window.addEventListener('pagehide', saveDraftState);
});

// ── AUTH ───────────────────────────────────────────────────
async function handleLogin() {
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;

  errEl.classList.add('hidden');
  errEl.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Masuk...';

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Login gagal');

    STATE.token = json.data.token;
    STATE.user  = json.data.user;
    // Clear semua sesi lama sebelum set yang baru
    localStorage.setItem('crm_token', STATE.token);
    localStorage.setItem('crm_user', JSON.stringify(STATE.user));
    localStorage.setItem('crm_login_at', Date.now().toString());

    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket mr-2"></i>Masuk ke CRM';
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const icon  = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash text-sm';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye text-sm';
  }
}
function togglePassword() { togglePasswordVisibility(); }

function doLogout() {
  if (STATE._notifInterval) { clearInterval(STATE._notifInterval); STATE._notifInterval = null; }
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_user');
  localStorage.removeItem('crm_login_at');
  localStorage.removeItem('crm_draft_state');
  STATE.token = null; STATE.user = null;
  STATE.listings = []; STATE.leads = []; STATE.tasks = [];
  closeModal('modal-sidebar');
  closeModal('modal-profile');
  showLoginScreen();
}

// ── SHOW SCREENS ───────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('login-screen')?.classList.remove('hidden');
  document.getElementById('app')?.classList.add('hidden');
  document.getElementById('bottom-nav')?.classList.add('hidden');
  document.getElementById('fab-area')?.classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  document.getElementById('bottom-nav')?.classList.remove('hidden');
  document.getElementById('fab-area')?.classList.remove('hidden');

  // Reset in-memory data to force fresh fetch
  STATE.listings       = [];
  STATE.leads          = [];
  STATE.tasks          = [];
  STATE.pipelineStages = [];
  STATE.currentPage    = 'dashboard';

  // Wipe rendered DOM dari sesi sebelumnya (prevent stale data flash)
  ['stat-listing','stat-leads','stat-hot','stat-konversi',
   'dash-hot-leads','dash-tasks','dash-pipeline',
   'hot-leads-list','tasks-list','admin-dash-content'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  const { nama, role, email } = STATE.user;
  const initial = (nama || 'A').charAt(0).toUpperCase();

  // Topbar
  setText('topbar-name', nama || 'Agen');
  setText('topbar-avatar', initial);
  setHeroGreeting();

  // Profile modal
  setText('profile-avatar', initial);
  setText('profile-name', nama || 'Agen');
  setText('profile-email', email || '');
  setText('profile-role', role || 'agen');

  // Sidebar
  setText('sidebar-avatar', initial);
  setText('sidebar-name', nama || 'Agen');
  setText('sidebar-role', role || 'agen');

  navigateTo('dashboard').then(restoreDraftState);
}

// ── NAVIGATION ─────────────────────────────────────────────
async function navigateTo(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  // Show page
  const el = document.getElementById(`page-${page}`);
  if (el) { el.style.display = 'block'; el.classList.add('active'); }

  // Nav dots
  document.querySelectorAll('.nav-dot').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Page title
  const titles = {
    dashboard: 'Dashboard',
    listings:  'Listing Properti',
    leads:     'Manajemen Leads',
    tasks:     'Tasks & Jadwal',
    sosmed:    'Sosmed Hub',
    whatsapp:  'WA Center',
    pipeline:  'Pipeline Kanban',
  };
  setText('page-title', titles[page] || page);
  STATE.currentPage = page;

  // Load data for page
  if (page === 'dashboard') await loadDashboard();
  if (page === 'listings')  await loadListings();
  if (page === 'leads')     await loadLeads();
  if (page === 'tasks')     await loadTasks();
  if (page === 'pipeline')  await loadPipeline();
  if (page === 'whatsapp')  await loadWaLeadsSelect();
  if (page === 'legal')     await loadLegalDocs();
  if (page === 'rental')    await loadRentals();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── DASHBOARD ──────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [dashRes, leadsRes, tasksRes] = await Promise.all([
      API.get('/dashboard/stats'),
      API.get('/leads'),
      API.get('/tasks/today' + (STATE.user.role === 'agen' ? `?agen_id=${STATE.user.id}` : '')),
    ]);

    const stats = dashRes.data || {};
    const leads = leadsRes.data || [];
    const todayTasks = tasksRes.data || [];

    // Update stat cards
    animateCounter('stat-listings', stats.activeListings  || stats.totalListings || 0);
    animateCounter('stat-leads',    stats.totalLeads || 0);
    animateCounter('stat-followup', stats.tasks?.today || todayTasks.length || 0);
    animateCounter('stat-deals',    stats.dealsThisMonth || 0);

    // Hot leads badge
    const hotCount = leads.filter(l => l.Score === 'Hot').length;
    if (hotCount > 0) {
      setText('stat-leads-hot', `${hotCount} Hot`);
      setDisplay('nav-hot-badge', hotCount);
      setText('nav-hot-badge', hotCount > 9 ? '9+' : hotCount);
      document.getElementById('nav-hot-badge').classList.remove('hidden');
    }

    // Overdue tasks badge
    if (stats.tasks?.overdue > 0) {
      document.getElementById('stat-overdue-badge').classList.remove('hidden');
      setText('stat-overdue-badge', `${stats.tasks.overdue} overdue`);
      const badge = document.getElementById('nav-task-badge');
      badge.classList.remove('hidden');
      setText('nav-task-badge', stats.tasks.overdue > 9 ? '9+' : stats.tasks.overdue);
      setText('notif-badge', stats.tasks.overdue);
      document.getElementById('notif-badge').classList.remove('hidden');
    }

    // Conversion funnel
    // dashboard returns: { funnel: stages[], overall_conversion: number }
    if (dashRes.data?.funnel?.length) {
      renderFunnel({
        stages: dashRes.data.funnel,
        overall_cr: dashRes.data.overall_conversion || 0,
      });
    } else {
      // Fallback: build funnel from leads data
      const funnel = buildFunnelFromLeads(leads);
      renderFunnel(funnel);
    }

    // Hot leads list — gunakan data dari server yang sudah difilter dengan benar
    const hotLeads = (dashRes.data.hotLeadsList?.length)
      ? dashRes.data.hotLeadsList
      : leads.filter(l => l.Score === 'Hot' && !['Deal','Batal'].includes(l.Status_Lead)).slice(0, 5);
    renderHotLeads(hotLeads);

    // Today tasks
    renderTodayTasks(todayTasks);

    // Hero subtitle
    const pending = todayTasks.filter(t => !['Done','Cancelled'].includes(t.Status));
    if (pending.length > 0) {
      setText('hero-subtitle', `${pending.length} jadwal pending hari ini`);
    } else {
      setText('hero-subtitle', 'Tidak ada jadwal pending hari ini 🎉');
    }

    // Profile stats
    setText('profile-listings', stats.totalListings || '—');
    setText('profile-leads', stats.totalLeads || '—');
    setText('profile-deals', stats.dealsThisMonth || '—');

    // Legal widget (non-blocking)
    if (typeof loadDashboardLegalWidget === 'function') loadDashboardLegalWidget();

  } catch (e) {
    showToast('Gagal memuat dashboard: ' + e.message, 'error');
  }
}

function buildFunnelFromLeads(leads) {
  const total     = leads.length;
  const dihubungi = leads.filter(l => l.Status_Lead !== 'Baru').length;
  const visited   = leads.filter(l => ['Survey','Visit','Negosiasi','Deal','Proses_Admin'].includes(l.Status_Lead)).length;
  const nego      = leads.filter(l => ['Negosiasi','Deal','Proses_Admin'].includes(l.Status_Lead)).length;
  const deal      = leads.filter(l => l.Status_Lead === 'Deal').length;
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

  return {
    stages: [
      { label: 'Leads',      count: total,     cr: 100,                       color: '#2B7BFF', icon: 'fa-users' },
      { label: 'Dihubungi',  count: dihubungi, cr: pct(dihubungi, total),    color: '#A855F7', icon: 'fa-phone' },
      { label: 'Visit',      count: visited,   cr: pct(visited, dihubungi),  color: '#F97316', icon: 'fa-house' },
      { label: 'Negosiasi',  count: nego,      cr: pct(nego, visited),       color: '#EAB308', icon: 'fa-handshake' },
      { label: 'Deal ✅',    count: deal,      cr: pct(deal, nego),          color: '#22C55E', icon: 'fa-trophy' },
    ],
    overall_cr: pct(deal, total),
  };
}

function renderFunnel(funnel) {
  setText('overall-cr', funnel.overall_cr ?? '—');
  const container = document.getElementById('funnel-stages');
  if (!container) return;

  container.innerHTML = funnel.stages.map((s, i) => {
    const width = s.cr || 0;
    return `
      <div class="flex items-center gap-3">
        <div class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs"
             style="background:${s.color}22;color:${s.color}">
          <i class="fa-solid ${s.icon}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-center mb-1">
            <span class="text-xs text-slate-300 font-medium">${escHtml(s.label)}</span>
            <span class="text-xs font-bold" style="color:${s.color}">${s.count} · ${s.cr}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-navy-4 overflow-hidden">
            <div class="funnel-bar h-full rounded-full" style="background:${s.color};width:0%"
                 data-width="${width}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Animate bars after render
  requestAnimationFrame(() => {
    container.querySelectorAll('.funnel-bar').forEach(bar => {
      setTimeout(() => { bar.style.width = bar.dataset.width; }, 100);
    });
  });
}

function renderHotLeads(leads) {
  const el = document.getElementById('hot-leads-list');
  if (!el) return;

  if (!leads.length) {
    el.innerHTML = `<div class="text-center py-6 text-slate-500 text-sm">
      <i class="fa-solid fa-fire-flame-curved text-2xl mb-2 block opacity-30"></i>
      Tidak ada hot lead saat ini
    </div>`;
    return;
  }

  el.innerHTML = leads.map(l => {
    const sourceBadge = { IG: '📷', TikTok: '🎵', FB: '📘', Web: '🌐', Referral: '🤝', WA: '💬', Direct: '🚶' };
    const src = sourceBadge[l.Sumber] || '📋';
    const initials = (l.Nama || 'L').charAt(0).toUpperCase();
    const since = l.Last_Contact ? timeAgo(l.Last_Contact) : 'belum dihubungi';

    return `
      <div class="card-glass rounded-2xl p-4 flex items-center gap-3 active:scale-[.98] transition-transform cursor-pointer"
           onclick="openLeadDetail('${l.ID}')">
        <div class="w-11 h-11 rounded-full badge-hot flex items-center justify-center text-white font-bold flex-shrink-0">
          ${escHtml(initials)}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-semibold text-white text-sm truncate">${escHtml(l.Nama)}</p>
            <span class="text-base flex-shrink-0">${src}</span>
          </div>
          <p class="text-xs text-slate-400 truncate">${escHtml(l.Status_Lead || 'Baru')} · ${since}</p>
        </div>
        <div class="flex flex-col items-end gap-1 flex-shrink-0">
          <span class="badge-hot text-[10px] text-white px-2 py-0.5 rounded-full font-bold">HOT</span>
          <button onclick="event.stopPropagation();openWaLead('${l.No_WA}')"
            class="w-7 h-7 rounded-full flex items-center justify-center"
            style="background:rgba(34,197,94,.15)">
            <i class="fa-brands fa-whatsapp text-green-400 text-xs"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTodayTasks(tasks) {
  const el = document.getElementById('today-tasks-list');
  if (!el) return;

  if (!tasks.length) {
    el.innerHTML = `<div class="text-center py-6 text-slate-500 text-sm">
      <i class="fa-solid fa-calendar-check text-2xl mb-2 block opacity-30"></i>
      Tidak ada jadwal hari ini
    </div>`;
    return;
  }

  const now = new Date();
  el.innerHTML = tasks.slice(0, 5).map(t => {
    const scheduled = new Date(t.Scheduled_At);
    const isOverdue = scheduled < now && !['Done','Cancelled'].includes(t.Status);
    const tipeColors = { Visit:'#F97316', Meeting:'#A855F7', Follow_Up:'#3B82F6', Call:'#22C55E', Admin:'#94a3b8', Other:'#64748b' };
    const tipeIcons  = { Visit:'fa-house', Meeting:'fa-handshake', Follow_Up:'fa-phone', Call:'fa-mobile', Admin:'fa-clipboard', Other:'fa-circle-dot' };
    const color = isOverdue ? '#EF4444' : (tipeColors[t.Tipe] || '#94a3b8');
    const icon  = tipeIcons[t.Tipe] || 'fa-circle-dot';

    return `
      <div class="card-glass rounded-2xl p-4 task-card ${t.Tipe?.toLowerCase()} ${isOverdue ? 'overdue' : ''}
           flex items-center gap-3 cursor-pointer active:scale-[.98] transition-transform"
           onclick="openTaskDetail('${t.ID}')">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
             style="background:${color}22">
          <i class="fa-solid ${icon} text-sm" style="color:${color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-white text-sm truncate">${escHtml(t.Judul)}</p>
          <p class="text-xs mt-0.5" style="color:${isOverdue?'#f87171':'#94a3b8'}">
            ${isOverdue ? '⚠️ Overdue · ' : ''}${formatTime(t.Scheduled_At)}
            ${t.Lead_Nama ? ` · ${escHtml(t.Lead_Nama)}` : ''}
          </p>
        </div>
        ${t.Status === 'Done' ? `<i class="fa-solid fa-circle-check text-green-400 flex-shrink-0"></i>` :
          `<button onclick="event.stopPropagation();quickCompleteTask('${t.ID}')"
            class="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style="background:rgba(34,197,94,.1);color:#4ade80;border:1px solid rgba(34,197,94,.2)">
            Done
          </button>`
        }
      </div>
    `;
  }).join('');
}

// ── LISTINGS PAGE ─────────────────────────────────────────
async function loadListings() {
  const grid = document.getElementById('listings-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="text-center py-12 text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    const res = await API.get('/listings');
    STATE.listings = res.data || [];
    renderListingsGrid(STATE.listings);
  } catch (e) {
    grid.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm">Gagal memuat listing</div>';
    showToast('Gagal memuat listings', 'error');
  }
}

function filterListings(statusFilter, btn) {
  if (btn) {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.listingFilter = statusFilter;
  }

  const q = document.getElementById('listing-search')?.value?.toLowerCase() || '';
  let data = STATE.listings;

  if (STATE.listingFilter && STATE.listingFilter !== 'all') {
    data = data.filter(l => l.Status_Listing === STATE.listingFilter);
  }
  if (q) {
    data = data.filter(l =>
      [l.Judul, l.Kode_Listing, l.Kota, l.Tipe_Properti].some(v => v?.toLowerCase().includes(q))
    );
  }

  renderListingsGrid(data);
}

function renderListingsGrid(listings) {
  const grid = document.getElementById('listings-grid');
  if (!grid) return;

  if (!listings.length) {
    grid.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm"><i class="fa-solid fa-building-circle-xmark text-3xl mb-3 block opacity-30"></i>Tidak ada listing ditemukan</div>';
    return;
  }

  const statusColors = { Aktif: '#22C55E', Terjual: '#D4A853', Tersewa: '#3B82F6', Ditarik: '#64748B' };

  grid.innerHTML = listings.map(l => {
    const statusColor = statusColors[l.Status_Listing] || '#64748B';
    const hargaFmt = l.Harga_Format || formatHarga(l.Harga) || 'Hubungi Kami';
    const specs = [];
    if (l.Luas_Bangunan) specs.push(`${l.Luas_Bangunan}m²`);
    if (l.Kamar_Tidur && l.Kamar_Tidur !== '0') specs.push(`${l.Kamar_Tidur}KT`);
    if (l.Kamar_Mandi && l.Kamar_Mandi !== '0') specs.push(`${l.Kamar_Mandi}KM`);

    return `
      <div class="card-glass rounded-2xl overflow-hidden active:scale-[.99] transition-transform">
        <!-- Photo -->
        <div class="relative h-44 overflow-hidden bg-navy-4" style="background:#162040">
          ${l.Foto_Utama_URL
            ? `<img src="${l.Foto_Utama_URL}" alt="" class="w-full h-full object-cover"/>`
            : `<div class="w-full h-full flex items-center justify-center opacity-20"><i class="fa-solid fa-building text-5xl text-slate-400"></i></div>`
          }
          <!-- Badges -->
          <div class="absolute top-3 left-3 flex gap-2">
            <span class="text-xs px-2 py-1 rounded-lg font-semibold text-white"
                  style="background:${statusColor}cc">${escHtml(l.Status_Listing || '')}</span>
            <span class="text-xs px-2 py-1 rounded-lg font-medium text-white"
                  style="background:rgba(0,0,0,.5)">${escHtml(l.Tipe_Properti || '')}</span>
            ${l._isCoOwn ? `<span class="text-xs px-2 py-1 rounded-lg font-semibold" style="background:rgba(139,92,246,0.85);color:#fff"><i class="fa-solid fa-link-simple" style="margin-right:3px;font-size:9px"></i>Co-Own</span>` : ''}
          </div>
          ${l.Tampilkan_di_Web === 'TRUE' ? `<div class="absolute top-3 right-3 w-7 h-7 rounded-lg bg-crm-blue flex items-center justify-center" title="Tampil di website"><i class="fa-solid fa-globe text-white text-xs"></i></div>` : ''}
        </div>
        <!-- Info -->
        <div class="p-4">
          <p class="font-semibold text-white text-base leading-snug">${escHtml(l.Judul || 'Tanpa Judul')}</p>
          <p class="text-xs text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1 text-gold"></i>${escHtml(l.Kota || '')}${l.Kecamatan ? ', ' + l.Kecamatan : ''}</p>
          <div class="flex items-center justify-between mt-3">
            <div>
              <p class="text-gold font-bold">${escHtml(hargaFmt)}</p>
              ${specs.length ? `<p class="text-xs text-slate-500 mt-0.5">${specs.join(' · ')}</p>` : ''}
            </div>
            <div class="flex gap-2">
              <button onclick="openSosmedBundle('${l.ID}')"
                class="w-9 h-9 rounded-xl flex items-center justify-center btn-ghost"
                title="Sosmed Bundle">
                <i class="fa-solid fa-share-nodes text-sm"></i>
              </button>
              <button onclick="toggleWebVisibility('${l.ID}', '${l.Tampilkan_di_Web !== 'TRUE'}')"
                class="w-9 h-9 rounded-xl flex items-center justify-center"
                title="${l.Tampilkan_di_Web === 'TRUE' ? 'Sembunyikan dari web' : 'Publikasikan ke web'}"
                style="background:rgba(43,123,255,${l.Tampilkan_di_Web === 'TRUE' ? '.25' : '.08'});color:${l.Tampilkan_di_Web === 'TRUE' ? '#2B7BFF' : '#64748B'}">
                <i class="fa-solid fa-globe text-sm"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleWebVisibility(id, makeVisible) {
  try {
    await API.patch(`/listings/${id}/web-visibility`, { visible: makeVisible === 'true' });
    showToast(makeVisible === 'true' ? '✅ Listing dipublikasikan ke website' : '👁 Listing disembunyikan', 'success');
    await loadListings();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ── LEADS PAGE ────────────────────────────────────────────
async function loadLeads() {
  const el = document.getElementById('leads-list');
  if (!el) return;
  el.innerHTML = '<div class="text-center py-12 text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    const res = await API.get('/leads');
    STATE.leads = res.data || [];
    renderLeadsList(STATE.leads);
  } catch (e) {
    showToast('Gagal memuat leads', 'error');
  }
}

function filterLeadScore(score, btn) {
  document.querySelectorAll('.lead-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE.leadFilter = score;

  const filtered = score === 'all' ? STATE.leads : STATE.leads.filter(l => l.Score === score);
  renderLeadsList(filtered);
}

function renderLeadsList(leads) {
  const el = document.getElementById('leads-list');
  if (!el) return;

  if (!leads.length) {
    el.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm"><i class="fa-solid fa-user-slash text-3xl mb-3 block opacity-30"></i>Tidak ada lead</div>';
    return;
  }

  const statusColors = {
    Baru: '#3B82F6', Dihubungi: '#A855F7', Survey: '#F97316',
    Negosiasi: '#EAB308', Deal: '#22C55E', Batal: '#EF4444',
    Proses_Admin: '#06B6D4',
  };
  const scoreBadge = {
    Hot:  { bg: 'badge-hot', label: 'HOT 🔥' },
    Warm: { bg: 'badge-warm', label: 'WARM ⚡' },
    Cold: { bg: 'badge-cold', label: 'COLD ❄️' },
  };

  el.innerHTML = leads.map(l => {
    const sc = l.Status_Lead || 'Baru';
    const color = statusColors[sc] || '#64748B';
    const score = scoreBadge[l.Score];
    const followUp = l.Next_Follow_Up ? `FU: ${formatDate(l.Next_Follow_Up)}` : '';

    return `
      <div class="card-glass rounded-2xl p-4 cursor-pointer active:scale-[.99] transition-transform"
           onclick="openLeadDetail('${l.ID}')">
        <div class="flex items-start gap-3">
          <div class="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 text-sm"
               style="background:${color}33;border:1px solid ${color}55">
            ${escHtml((l.Nama || 'L').charAt(0).toUpperCase())}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <p class="font-semibold text-white text-sm truncate">${escHtml(l.Nama || '—')}</p>
              ${score ? `<span class="${score.bg} text-[10px] text-white px-2 py-0.5 rounded-full font-bold flex-shrink-0">${score.label}</span>` : ''}
            </div>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                    style="background:${color}22;color:${color}">${escHtml(sc)}</span>
              <span class="text-xs text-slate-500">${escHtml(l.Sumber || '')}</span>
            </div>
            ${followUp ? `<p class="text-xs text-gold mt-1.5"><i class="fa-solid fa-clock-rotate-left mr-1"></i>${followUp}</p>` : ''}
          </div>
          <button onclick="event.stopPropagation();openWaLead('${l.No_WA}')"
            class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style="background:rgba(34,197,94,.1)">
            <i class="fa-brands fa-whatsapp text-green-400"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openWaLead(noWa) {
  if (!noWa) { showToast('Nomor WA tidak tersedia', 'error'); return; }
  let num = noWa.replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  window.open(`https://wa.me/${num}`, '_blank');
}

function openLeadDetail(id) {
  showToast('Fitur detail lead segera hadir', 'info');
}

// ── TASKS PAGE ────────────────────────────────────────────
async function loadTasks() {
  const el = document.getElementById('tasks-list');
  if (!el) return;

  // Build calendar strip
  buildCalendarStrip();

  el.innerHTML = '<div class="text-center py-12 text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    const qs = STATE.user.role === 'agen' ? `?agen_id=${STATE.user.id}` : '';
    const res = await API.get(`/tasks${qs}`);
    STATE.tasks = res.data || [];
    renderTasksList(STATE.tasks, STATE.taskFilter.status);
    // Bug #11: Cek reminder H-2 (tasks dalam 48 jam ke depan)
    checkUpcomingReminders(STATE.tasks);
  } catch (e) {
    showToast('Gagal memuat tasks', 'error');
  }
}

function buildCalendarStrip() {
  const strip = document.getElementById('calendar-strip');
  if (!strip) return;

  const days = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const today = new Date();
  const html = [];

  for (let i = -1; i < 13; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().substring(0, 10);
    const isToday = i === 0;
    const isSelected = STATE.taskFilter.date === dateStr || (i === 0 && !STATE.taskFilter.date);

    html.push(`
      <div class="cal-day ${isSelected ? 'active' : ''} ${isToday ? 'today' : ''}"
           onclick="selectCalDay('${dateStr}', this)">
        <div class="text-[10px] text-slate-400">${days[d.getDay()]}</div>
        <div class="cal-date text-sm font-semibold ${isToday ? 'text-gold' : 'text-white'} mt-0.5">${d.getDate()}</div>
      </div>
    `);
  }
  strip.innerHTML = html.join('');
}

function selectCalDay(dateStr, btn) {
  document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('active'));
  btn.classList.add('active');
  STATE.taskFilter.date = dateStr;
  renderTasksList(STATE.tasks, STATE.taskFilter.status, dateStr);
}

function filterTasks(status, btn) {
  document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE.taskFilter.status = status;
  renderTasksList(STATE.tasks, status, STATE.taskFilter.date);
}

function renderTasksList(tasks, statusFilter = 'all', dateFilter = null) {
  const el = document.getElementById('tasks-list');
  if (!el) return;

  const now = new Date();
  let filtered = tasks;

  if (dateFilter) {
    filtered = filtered.filter(t => t.Scheduled_At?.startsWith(dateFilter));
  }

  if (statusFilter === 'overdue') {
    filtered = filtered.filter(t => new Date(t.Scheduled_At) < now && !['Done','Cancelled'].includes(t.Status));
  } else if (statusFilter !== 'all') {
    filtered = filtered.filter(t => t.Status === statusFilter);
  }

  if (!filtered.length) {
    el.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm"><i class="fa-solid fa-calendar-xmark text-3xl mb-3 block opacity-30"></i>Tidak ada task</div>';
    return;
  }

  const tipeColors = { Visit: '#F97316', Meeting: '#A855F7', Follow_Up: '#3B82F6', Call: '#22C55E', Admin: '#64748B', Other: '#475569' };
  const tipeIcons  = { Visit: 'fa-house', Meeting: 'fa-handshake', Follow_Up: 'fa-phone', Call: 'fa-mobile', Admin: 'fa-clipboard', Other: 'fa-circle-dot' };
  const priorityDot= { Tinggi: '#EF4444', Sedang: '#EAB308', Rendah: '#22C55E' };

  el.innerHTML = filtered.map(t => {
    const isOverdue = new Date(t.Scheduled_At) < now && !['Done','Cancelled'].includes(t.Status);
    const color = isOverdue ? '#EF4444' : (tipeColors[t.Tipe] || '#64748B');
    const icon  = tipeIcons[t.Tipe] || 'fa-circle-dot';
    const pDot  = priorityDot[t.Prioritas] || '#64748B';

    return `
      <div class="card-glass rounded-2xl p-4 task-card ${t.Tipe?.toLowerCase()} ${isOverdue ? 'overdue' : ''}
           cursor-pointer active:scale-[.99] transition-transform"
           onclick="openTaskDetail('${t.ID}')">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
               style="background:${color}22">
            <i class="fa-solid ${icon} text-sm" style="color:${color}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full flex-shrink-0" style="background:${pDot}"></div>
                  <p class="font-semibold text-white text-sm truncate">${escHtml(t.Judul)}</p>
                </div>
                <p class="text-xs mt-1" style="color:${isOverdue?'#f87171':'#94a3b8'}">
                  ${isOverdue ? '⚠️ ' : '⏰ '}${formatDateTime(t.Scheduled_At)}
                </p>
                ${t.Lead_Nama ? `<p class="text-xs text-slate-500 mt-0.5 truncate"><i class="fa-solid fa-user mr-1"></i>${escHtml(t.Lead_Nama)}</p>` : ''}
                ${t.Lokasi ? `<p class="text-xs text-slate-500 mt-0.5 truncate"><i class="fa-solid fa-location-dot mr-1 text-gold"></i>${escHtml(t.Lokasi)}</p>` : ''}
              </div>
              <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
                ${t.Status === 'Done'
                  ? `<span class="text-xs px-2 py-0.5 rounded-full text-green-400 font-medium" style="background:rgba(34,197,94,.12)">Done ✓</span>`
                  : t.Status === 'Cancelled'
                  ? `<span class="text-xs px-2 py-0.5 rounded-full text-slate-400 font-medium" style="background:rgba(100,116,139,.12)">Batal</span>`
                  : `<button onclick="event.stopPropagation();quickCompleteTask('${t.ID}')"
                        class="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
                        style="background:rgba(34,197,94,.1);color:#4ade80;border:1px solid rgba(34,197,94,.2)">
                        ✓ Done
                      </button>`
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function openTaskDetail(id) {
  openModal('modal-task-detail');
  const contentEl = document.getElementById('task-detail-content');
  contentEl.innerHTML = '<div class="text-center py-8 text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    const res = await API.get(`/tasks/${id}`);
    const t = res.data;
    const tipeColors = { Visit:'#F97316', Meeting:'#A855F7', Follow_Up:'#3B82F6', Call:'#22C55E', Admin:'#64748B', Other:'#475569' };
    const color = tipeColors[t.Tipe] || '#64748B';

    contentEl.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style="background:${color}22">
            <i class="fa-solid fa-${t.Tipe === 'Visit' ? 'house' : 'calendar'} text-lg" style="color:${color}"></i>
          </div>
          <div>
            <h3 class="font-bold text-white text-lg">${escHtml(t.Judul)}</h3>
            <p class="text-xs text-slate-400">${escHtml(t.Kode_Task || '')} · ${escHtml(t.Tipe || '')}</p>
          </div>
        </div>
        <div class="space-y-2 text-sm text-slate-300">
          <div class="flex gap-3"><span class="text-slate-500 w-24">Waktu</span><span>${formatDateTime(t.Scheduled_At)}</span></div>
          ${t.Lead_Nama ? `<div class="flex gap-3"><span class="text-slate-500 w-24">Lead</span><span>${escHtml(t.Lead_Nama)}</span></div>` : ''}
          ${t.Lokasi ? `<div class="flex gap-3"><span class="text-slate-500 w-24">Lokasi</span><span>${escHtml(t.Lokasi)}</span></div>` : ''}
          ${t.Catatan_Pre ? `<div class="flex gap-3"><span class="text-slate-500 w-24">Catatan</span><span>${escHtml(t.Catatan_Pre)}</span></div>` : ''}
          <div class="flex gap-3"><span class="text-slate-500 w-24">Status</span>
            <span class="font-medium" style="color:${t.Status === 'Done' ? '#22C55E' : t.Status === 'Cancelled' ? '#64748B' : '#D4A853'}">${escHtml(t.Status)}</span>
          </div>
        </div>
        ${!['Done','Cancelled'].includes(t.Status) ? `
          <div class="space-y-2 pt-2">
            <textarea id="complete-catatan-post" rows="3" placeholder="Catatan hasil (opsional)"
              class="w-full rounded-xl px-4 py-3 text-sm resize-none"></textarea>
            <select id="complete-outcome" class="w-full rounded-xl px-4 py-3 text-sm">
              <option value="">Pilih outcome...</option>
              <option value="Lanjut_Negosiasi">Lanjut Negosiasi ↗</option>
              <option value="Butuh_Followup">Butuh Follow Up lagi</option>
              <option value="Deal">DEAL 🎉</option>
              <option value="Batal">Batal ✗</option>
              <option value="Reschedule">Reschedule</option>
            </select>
            <button onclick="submitCompleteTask('${t.ID}')" class="w-full btn-gold py-3 rounded-xl text-sm font-semibold">
              <i class="fa-solid fa-circle-check mr-2"></i>Tandai Selesai
            </button>
          </div>
        ` : ''}
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm">Gagal memuat detail task</div>';
  }
}

async function quickCompleteTask(id) {
  try {
    await API.patch(`/tasks/${id}/complete`, { outcome: 'Butuh_Followup', catatan_post: '' });
    showToast('✅ Task ditandai selesai', 'success');
    await loadTasks();
    if (STATE.currentPage === 'dashboard') await loadDashboard();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function submitCompleteTask(id) {
  const outcome    = document.getElementById('complete-outcome').value;
  const catatanPost = document.getElementById('complete-catatan-post').value;
  if (!outcome) { showToast('Pilih outcome terlebih dahulu', 'error'); return; }

  try {
    await API.patch(`/tasks/${id}/complete`, { outcome, catatan_post: catatanPost });
    showToast('✅ Task selesai! Pipeline lead diupdate.', 'success');
    closeModal('modal-task-detail');
    await loadTasks();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ── PIPELINE KANBAN ───────────────────────────────────────
async function loadPipeline() {
  const board = document.getElementById('pipeline-board');
  if (!board) return;
  board.innerHTML = '<div class="text-center py-12 text-slate-500 w-full"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    const [stagesRes, leadsRes] = await Promise.all([
      API.get('/tasks/pipeline'),
      API.get('/leads'),
    ]);

    const stages = stagesRes.data || [];
    const leads  = leadsRes.data || [];

    if (!stages.length) {
      board.innerHTML = '<div class="text-center py-12 text-slate-500 w-full text-sm">Pipeline stages belum dikonfigurasi</div>';
      return;
    }

    STATE.pipelineStages = stages;
    STATE.leads = leads;

    // Group leads by Status_Lead ↔ stage Kode
    const stageMap = {};
    const stageCodeToStatus = {
      BARU: 'Baru', DIHUB: 'Dihubungi', QUAL: 'Qualified',
      VISIT: 'Survey', NEG: 'Negosiasi', ADMIN: 'Proses_Admin',
      DEAL: 'Deal', BATAL: 'Batal',
    };
    stages.forEach(s => { stageMap[s.Kode] = []; });
    leads.forEach(l => {
      // Find which stage this lead is in
      const stageEntry = stages.find(s => stageCodeToStatus[s.Kode] === l.Status_Lead);
      const code = stageEntry?.Kode || 'BARU';
      if (stageMap[code]) stageMap[code].push(l);
    });

    board.innerHTML = stages.filter(s => s.Is_Terminal !== 'TRUE' || stageMap[s.Kode]?.length > 0).map(s => {
      const stageLeads = stageMap[s.Kode] || [];
      return `
        <div class="flex-shrink-0 w-[220px]">
          <div class="flex items-center justify-between mb-2 px-1">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-lg flex items-center justify-center"
                   style="background:${s.Warna_Hex}22">
                <i class="fa-solid ${s.Icon_FA || 'fa-circle'} text-xs" style="color:${s.Warna_Hex}"></i>
              </div>
              <span class="text-xs font-semibold text-white">${escHtml(s.Nama)}</span>
            </div>
            <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:${s.Warna_Hex}22;color:${s.Warna_Hex}">${stageLeads.length}</span>
          </div>
          <div class="space-y-2 min-h-[100px]">
            ${stageLeads.length ? stageLeads.slice(0,8).map(l => `
              <div class="card-glass rounded-xl p-3 cursor-pointer active:scale-[.98] transition-transform">
                <p class="text-xs font-semibold text-white truncate">${escHtml(l.Nama || '—')}</p>
                <p class="text-[10px] text-slate-500 mt-0.5">${escHtml(l.Sumber || '')} · ${timeAgo(l.Updated_At || l.Created_At)}</p>
                ${l.Score ? `<span class="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white ${l.Score === 'Hot' ? 'badge-hot' : l.Score === 'Warm' ? 'badge-warm' : 'badge-cold'}">${l.Score}</span>` : ''}
              </div>
            `).join('') : `<div class="rounded-xl border-2 border-dashed flex items-center justify-center h-20" style="border-color:${s.Warna_Hex}22"><p class="text-xs text-slate-600">Kosong</p></div>`}
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    board.innerHTML = '<div class="text-center py-12 text-slate-500 w-full text-sm">Gagal memuat pipeline</div>';
    showToast('Gagal memuat pipeline', 'error');
  }
}

// ── SOSMED HUB ────────────────────────────────────────────
async function searchSosmedBundle() {
  const q   = document.getElementById('sosmed-search')?.value?.toLowerCase() || '';
  const res = document.getElementById('sosmed-search-results');
  if (!res) return;

  if (!q) {
    res.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm"><i class="fa-solid fa-share-nodes text-3xl mb-3 block opacity-30"></i>Cari listing untuk melihat bundle sosmed</div>';
    return;
  }

  // Ensure listings are loaded
  if (!STATE.listings.length) {
    res.innerHTML = '<div class="text-center py-4 text-slate-500 text-sm"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try {
      const r = await API.get('/listings');
      STATE.listings = r.data || [];
    } catch (e) {
      res.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm">Gagal memuat listing</div>';
      return;
    }
  }

  const matches = STATE.listings.filter(l =>
    [l.Judul, l.Kode_Listing, l.Kota].some(v => v?.toLowerCase().includes(q))
  ).slice(0, 5);

  if (!matches.length) {
    res.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm"><i class="fa-solid fa-magnifying-glass text-2xl mb-3 block opacity-30"></i>Listing tidak ditemukan</div>';
    return;
  }

  res.innerHTML = matches.map(l => `
    <div class="card-glass rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:scale-[.99] transition-transform"
         onclick="openSosmedBundle('${l.ID}')">
      <div class="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-navy-4">
        ${l.Foto_Utama_URL ? `<img src="${l.Foto_Utama_URL}" class="w-full h-full object-cover"/>` : '<div class="w-full h-full flex items-center justify-center"><i class="fa-solid fa-building text-slate-600"></i></div>'}
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-white text-sm truncate">${escHtml(l.Judul || '—')}</p>
        <p class="text-xs text-slate-400">${escHtml(l.Kode_Listing || '')} · ${escHtml(l.Kota || '')}</p>
        <p class="text-gold text-sm font-bold mt-1">${escHtml(l.Harga_Format || 'Hubungi Kami')}</p>
      </div>
      <div class="btn-ghost w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0">
        <i class="fa-solid fa-share-nodes text-sm"></i>
      </div>
    </div>
  `).join('');
}

async function openSosmedBundle(listingId) {
  openModal('modal-sosmed-bundle');
  const contentEl = document.getElementById('sosmed-bundle-content');
  contentEl.innerHTML = '<div class="text-center py-8 text-slate-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    const res = await API.get(`/listings/${listingId}/sosmed-bundle`);
    _currentBundle = res.data; // store in STATE, NOT in HTML attribute
    renderSosmedBundleModal(_currentBundle);
  } catch (e) {
    contentEl.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm">Gagal memuat bundle</div>';
  }
}

function renderSosmedBundleModal(bundle) {
  const platforms = [
    { key: 'caption_ig',     label: 'Instagram', icon: 'fa-brands fa-instagram', color: '#E1306C' },
    { key: 'caption_tiktok', label: 'TikTok',    icon: 'fa-brands fa-tiktok',    color: '#010101' },
    { key: 'caption_fb',     label: 'Facebook',  icon: 'fa-brands fa-facebook',  color: '#1877F2' },
  ];

  const photoHtml = bundle.download_links?.length
    ? `<div class="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        ${bundle.download_links.map(dl => `
          <div class="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-navy-4">
            <img src="${dl.thumbnail}" class="w-full h-full object-cover"/>
            <a href="${dl.url}" download="${escHtml(dl.name)}" target="_blank"
              class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <i class="fa-solid fa-cloud-arrow-down text-white text-xl"></i>
            </a>
          </div>
        `).join('')}
      </div>`
    : '<p class="text-slate-500 text-sm text-center py-4">Tidak ada foto</p>';

  document.getElementById('sosmed-bundle-content').innerHTML = `
    <div class="space-y-4">
      <!-- Platform tabs -->
      <div class="flex gap-2">
        ${platforms.map(p => `
          <button class="platform-tab flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2"
                  data-key="${p.key}"
                  onclick="switchSosmedPlatform('${p.key}')"
                  style="background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.08)">
            <i class="${p.icon} text-base"></i>
            <span class="hidden sm:inline">${p.label}</span>
          </button>
        `).join('')}
      </div>

      <!-- Caption display (textContent set via JS, never innerHTML) -->
      <div class="relative">
        <div id="caption-display" class="rounded-2xl p-4 text-sm text-slate-300 leading-relaxed min-h-[120px] whitespace-pre-wrap"
             style="background:#162040;border:1px solid rgba(212,168,83,.15)"></div>
        <button onclick="copyCaption()"
          class="absolute bottom-3 right-3 btn-ghost text-xs px-3 py-1.5 rounded-lg">
          <i class="fa-solid fa-copy mr-1"></i>Copy
        </button>
      </div>

      <div class="flex gap-2">
        <button onclick="copyCaption()" class="flex-1 btn-gold py-3 rounded-xl text-sm font-semibold">
          <i class="fa-solid fa-copy mr-2"></i>Copy Caption
        </button>
        <button onclick="regenerateCaption('${bundle.listing_id}')"
          class="btn-ghost px-4 py-3 rounded-xl text-sm">
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>

      <!-- Photos -->
      <div>
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
          Download Foto (${bundle.download_links?.length || 0} foto)
        </p>
        ${photoHtml}
      </div>
    </div>
  `;

  // Set initial caption via textContent (XSS-safe)
  const captionEl = document.getElementById('caption-display');
  if (captionEl && bundle.caption_ig) {
    captionEl.textContent = bundle.caption_ig;
  }

  // Activate first tab
  const firstTab = document.querySelector('.platform-tab');
  if (firstTab) firstTab.style.cssText = 'background:rgba(212,168,83,.15);color:#D4A853;border:1px solid rgba(212,168,83,.3)';
}

function switchSosmedPlatform(key) {
  // Reset all tabs
  document.querySelectorAll('.platform-tab').forEach(b => {
    b.style.cssText = 'background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.08)';
  });
  // Activate clicked tab
  const activeBtn = document.querySelector(`.platform-tab[data-key="${key}"]`);
  if (activeBtn) activeBtn.style.cssText = 'background:rgba(212,168,83,.15);color:#D4A853;border:1px solid rgba(212,168,83,.3)';

  // Set caption via textContent (XSS-safe — never innerHTML)
  const captionEl = document.getElementById('caption-display');
  if (captionEl && _currentBundle) {
    captionEl.textContent = _currentBundle[key] || '—';
  }
}

async function copyCaption() {
  const text = document.getElementById('caption-display')?.textContent;
  if (!text || text === '—') { showToast('Tidak ada caption untuk disalin', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast('✅ Caption berhasil disalin!', 'success');
}

async function regenerateCaption(listingId) {
  try {
    await API.post(`/listings/${listingId}/generate-caption`, { style: 'standard' });
    showToast('✅ Caption baru berhasil digenerate!', 'success');
    await openSosmedBundle(listingId);
  } catch (e) {
    showToast('Gagal regenerate caption', 'error');
  }
}

// ── WHATSAPP CENTER ───────────────────────────────────────
async function loadWaLeadsSelect() {
  const select = document.getElementById('wa-lead-select');
  if (!select) return;

  if (!STATE.leads.length) {
    try {
      const res = await API.get('/leads');
      STATE.leads = res.data || [];
    } catch (e) { return; }
  }

  const options = STATE.leads.map(l =>
    `<option value="${l.No_WA}" data-nama="${escHtml(l.Nama)}">${escHtml(l.Nama)} (${l.No_WA})</option>`
  ).join('');
  select.innerHTML = `<option value="">Pilih lead...</option>${options}`;

  // Also populate task lead select
  const taskLeadSel = document.getElementById('new-task-lead');
  if (taskLeadSel) {
    taskLeadSel.innerHTML = `<option value="">Pilih lead (opsional)...</option>` +
      STATE.leads.map(l => `<option value="${l.ID}" data-nama="${escHtml(l.Nama)}" data-wa="${l.No_WA}">${escHtml(l.Nama)}</option>`).join('');
  }
}

const WA_TEMPLATES = {
  follow_up: `Halo Kak {{Nama}}, selamat pagi! 🌟\n\nSaya dari CRM Properti, ingin menindaklanjuti ketertarikan Kakak terhadap properti kami.\n\nApakah Kakak masih berminat? Kami siap membantu! 🏠`,
  penawaran: `Halo Kak {{Nama}}! 👋\n\nKami memiliki penawaran spesial properti yang mungkin sesuai kebutuhan Kakak.\n\nBoleh saya share detailnya? 📋`,
  survey:    `Halo Kak {{Nama}}, 😊\n\nApakah Kakak tertarik untuk survey langsung ke lokasi properti?\n\nKami siap atur jadwal yang nyaman! 🗓️`,
};

function useWaTemplate(key) {
  const ta  = document.getElementById('wa-message');
  const sel = document.getElementById('wa-lead-select');
  const nama = sel?.options[sel.selectedIndex]?.dataset.nama || 'Kak';
  if (ta) ta.value = (WA_TEMPLATES[key] || '').replace('{{Nama}}', nama);
}

function previewWaLink() {
  const sel = document.getElementById('wa-lead-select');
  const man = document.getElementById('wa-manual-number');
  const msg = document.getElementById('wa-message').value;
  const noWa = sel?.value || man?.value || '';
  if (!noWa || !msg) { showToast('Isi nomor dan pesan', 'error'); return; }
  let num = noWa.replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}

async function sendWaMessage() {
  const sel = document.getElementById('wa-lead-select');
  const man = document.getElementById('wa-manual-number');
  const msg = document.getElementById('wa-message').value;
  const noWa = sel?.value || man?.value || '';
  if (!noWa || !msg) { showToast('Isi nomor dan pesan', 'error'); return; }
  try {
    await API.post('/whatsapp/send', { noWa, pesan: msg });
    showToast('✅ Pesan masuk antrean!', 'success');
    document.getElementById('wa-message').value = '';
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ── SUBMIT FORMS ──────────────────────────────────────────
// ── State sementara untuk pending listing submission ──────────────────────
let _pendingListingPayload = null;

// ── Parse LT/LB/KT/KM/Garasi dari teks deskripsi (sama seperti logic backend PDF) ──
function parseDeskripsi(text) {
  if (!text) return {};
  const px = (re) => { const m = text.match(re); return m ? m[1] : ''; };
  return {
    Luas_Tanah:    px(/LT[:\s]*(\d+)/i),
    Luas_Bangunan: px(/LB[:\s]*(\d+)/i),
    Kamar_Tidur:   px(/(\d+(?:[+\-]\d+)?)\s*KT/i),
    Kamar_Mandi:   px(/(\d+(?:[+\-]\d+)?)\s*KM/i),
    Garasi:        px(/garasi[:\s]+([^\n,/]+)/i),
  };
}

async function submitAddListing() {
  const payload = {
    Judul           : document.getElementById('add-judul')?.value?.trim(),
    Tipe_Properti   : document.getElementById('add-tipe')?.value,
    Status_Transaksi: document.getElementById('add-transaksi')?.value,
    Harga           : document.getElementById('add-harga')?.value,
    Kota            : document.getElementById('add-kota')?.value?.trim(),
    Kecamatan       : document.getElementById('add-kecamatan')?.value?.trim(),
    Deskripsi       : document.getElementById('add-deskripsi')?.value?.trim(),
    Status_Listing  : 'Aktif',
  };

  if (!payload.Judul || !payload.Tipe_Properti || !payload.Status_Transaksi) {
    showToast('Isi judul, tipe, dan jenis transaksi', 'error'); return;
  }

  // ── Parse spesifikasi dari deskripsi dan masukkan ke payload ───────────
  const parsed = parseDeskripsi(payload.Deskripsi);
  if (parsed.Luas_Tanah)    payload.Luas_Tanah    = parsed.Luas_Tanah;
  if (parsed.Luas_Bangunan) payload.Luas_Bangunan = parsed.Luas_Bangunan;
  if (parsed.Kamar_Tidur)   payload.Kamar_Tidur   = parsed.Kamar_Tidur;
  if (parsed.Kamar_Mandi)   payload.Kamar_Mandi   = parsed.Kamar_Mandi;
  if (parsed.Garasi)        payload.Garasi        = parsed.Garasi;

  // ── Cek duplikat sebelum simpan (hanya jika Kecamatan & Kota diisi) ───
  if (payload.Kecamatan && payload.Kota) {
    const btn = document.getElementById('listing-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Cek duplikat...'; }

    try {
      const checkPayload = {
        Kecamatan:     payload.Kecamatan,
        Kota:          payload.Kota,
        Harga:         payload.Harga,
        Luas_Tanah:    payload.Luas_Tanah,
        Luas_Bangunan: payload.Luas_Bangunan,
        Kamar_Tidur:   payload.Kamar_Tidur,
      };
      const res = await API.post('/listing-agents/check-duplicate', checkPayload);
      if (res.duplicates && res.duplicates.length > 0) {
        // Simpan payload ke state, tampilkan modal duplikat
        _pendingListingPayload = payload;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px"></i>Simpan'; }
        showDuplicateModal(res.duplicates);
        return; // Stop — tunggu keputusan agen
      }
    } catch (e) {
      // Jika cek duplikat gagal, lanjut simpan biasa (jangan blok agen)
      console.warn('[DUPLICATE CHECK]', e.message);
    }

    const btn2 = document.getElementById('listing-submit-btn');
    if (btn2) { btn2.disabled = false; btn2.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px"></i>Simpan'; }
  }

  await _doCreateListing(payload);
}

async function _doCreateListing(payload) {
  const photoInput = document.getElementById('add-photos');
  const hasPhotos  = photoInput?.files?.length > 0;

  const btn = document.getElementById('listing-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Menyimpan...'; }

  try {
    if (hasPhotos) {
      const fd = new FormData();
      Object.entries(payload).forEach(([k,v]) => { if (v) fd.append(k, v); });
      Array.from(photoInput.files).forEach(f => fd.append('photos', f));
      await API.post('/listings', fd, true);
    } else {
      await API.post('/listings', payload);
    }
    showToast('Listing berhasil ditambahkan!', 'success');
    resetListingModal();
    await API.post('/dashboard/cache/clear');
    if (STATE.currentPage === 'listings') await loadListings();
    if (STATE.currentPage === 'dashboard') await loadDashboard();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px"></i>Simpan'; }
  }
}

// ── Tampilkan modal duplikat dengan daftar kandidat ───────────────────────
function showDuplicateModal(duplicates) {
  const list = document.getElementById('duplicate-list');
  if (!list) return;

  list.innerHTML = duplicates.slice(0, 3).map(d => `
    <div style="background:#131F38;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.07)">
      <div style="display:flex;gap:10px;padding:12px">
        ${d.foto_utama
          ? `<img src="${escHtml(d.foto_utama)}" style="width:70px;height:70px;border-radius:10px;object-fit:cover;flex-shrink:0"/>`
          : `<div style="width:70px;height:70px;border-radius:10px;background:#0D1526;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid fa-building" style="color:rgba(255,255,255,0.2)"></i></div>`
        }
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="font-size:10px;font-weight:700;color:#D4A853;letter-spacing:0.05em">${escHtml(d.kode)}</span>
            <span style="font-size:10px;background:rgba(234,179,8,0.15);color:#EAB308;border-radius:6px;padding:1px 7px;font-weight:600">Score: ${d.score}/100</span>
          </div>
          <p style="font-size:13px;font-weight:600;color:#fff;margin:0 0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(d.judul)}</p>
          <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0 0 2px"><i class="fa-solid fa-location-dot" style="color:#D4A853;margin-right:4px"></i>${escHtml(d.kecamatan)}, ${escHtml(d.kota)}</p>
          <p style="font-size:11px;color:rgba(255,255,255,0.4);margin:0"><i class="fa-solid fa-user" style="margin-right:4px"></i>${escHtml(d.agen_nama)}</p>
        </div>
      </div>
      <div style="padding:0 12px 12px">
        <div style="display:flex;gap:6px;font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:10px">
          ${d.breakdown.alamat >= 30 ? '<span style="background:rgba(34,197,94,0.1);color:#22C55E;border-radius:6px;padding:2px 7px">Alamat mirip</span>' : ''}
          ${d.breakdown.lt_lb >= 20  ? '<span style="background:rgba(34,197,94,0.1);color:#22C55E;border-radius:6px;padding:2px 7px">LT/LB sama</span>' : ''}
          ${d.breakdown.harga >= 8   ? '<span style="background:rgba(34,197,94,0.1);color:#22C55E;border-radius:6px;padding:2px 7px">Harga mirip</span>' : ''}
          ${d.breakdown.kt >= 10     ? '<span style="background:rgba(34,197,94,0.1);color:#22C55E;border-radius:6px;padding:2px 7px">KT sama</span>' : ''}
        </div>
        <button onclick="joinExistingListing('${escHtml(d.id)}','${escHtml(d.kode)}')"
          style="width:100%;padding:9px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:10px;color:#A78BFA;font-size:13px;font-weight:600;cursor:pointer">
          <i class="fa-solid fa-link-simple" style="margin-right:6px"></i>Gabung ke Listing Ini
        </button>
      </div>
    </div>
  `).join('');

  document.getElementById('modal-duplicate-listing').style.display = 'flex';
}

function closeDuplicateModal() {
  document.getElementById('modal-duplicate-listing').style.display = 'none';
  _pendingListingPayload = null;
}

// Tetap buat listing baru meski ada duplikat
async function forceCreateListing() {
  const payload = _pendingListingPayload;
  _pendingListingPayload = null;
  document.getElementById('modal-duplicate-listing').style.display = 'none';
  if (payload) await _doCreateListing(payload);
}

// Gabung sebagai Co-Own ke listing yang sudah ada
async function joinExistingListing(listingId, kode) {
  try {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Bergabung...';

    await API.post(`/listing-agents/${listingId}/join`);

    document.getElementById('modal-duplicate-listing').style.display = 'none';
    _pendingListingPayload = null;
    resetListingModal();

    showToast(`Berhasil bergabung sebagai Co-Own di ${kode}`, 'success');
    if (STATE.currentPage === 'listings') await loadListings();
  } catch (e) {
    showToast('Gagal bergabung: ' + e.message, 'error');
    if (event.currentTarget) {
      event.currentTarget.disabled = false;
      event.currentTarget.innerHTML = '<i class="fa-solid fa-link-simple" style="margin-right:6px"></i>Gabung ke Listing Ini';
    }
  }
}

async function submitAddLead() {
  const payload = {
    Nama  : document.getElementById('new-lead-nama')?.value?.trim(),
    No_WA : document.getElementById('new-lead-wa')?.value?.trim(),
    Email : document.getElementById('new-lead-email')?.value?.trim(),
    Sumber: document.getElementById('new-lead-sumber')?.value,
    Minat_Tipe: document.getElementById('new-lead-minat')?.value,
    Score : document.getElementById('lead-score')?.value || 'Warm',
    Tipe_Properti: document.getElementById('lead-tipe-prop')?.value,
    Jenis : document.getElementById('lead-jenis')?.value,
  };

  if (!payload.Nama || !payload.No_WA) {
    showToast('Isi nama dan nomor WA', 'error'); return;
  }

  try {
    await API.post('/leads', payload);
    showToast('✅ Lead berhasil ditambahkan!', 'success');
    closeModal('modal-add-lead');
    await API.post('/dashboard/cache/clear');
    if (STATE.currentPage === 'leads') await loadLeads();
    if (STATE.currentPage === 'dashboard') await loadDashboard();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

async function submitAddTask() {
  const leadSel   = document.getElementById('new-task-lead');
  const leadOpt   = leadSel?.options[leadSel?.selectedIndex];
  const isCustom  = leadSel?.value === 'baru';
  const scheduled = document.getElementById('task-scheduled')?.value;

  const leadNama = isCustom
    ? (document.getElementById('new-task-lead-custom')?.value?.trim() || '')
    : (leadOpt?.dataset.nama || '');

  const payload = {
    Tipe        : document.getElementById('task-tipe')?.value,
    Prioritas   : document.getElementById('task-prioritas')?.value,
    Scheduled_At: scheduled ? new Date(scheduled).toISOString() : '',
    Duration_Menit: document.getElementById('task-durasi')?.value || '60',
    Lokasi      : document.getElementById('task-lokasi')?.value?.trim(),
    Lead_ID     : (!isCustom && leadSel?.value) ? leadSel.value : '',
    Lead_Nama   : leadNama,
    Lead_No_WA  : (!isCustom && leadOpt?.dataset.wa) ? leadOpt.dataset.wa : '',
    Catatan_Pre : document.getElementById('task-catatan')?.value?.trim(),
  };

  if (!payload.Scheduled_At) {
    showToast('Isi waktu jadwal', 'error'); return;
  }

  try {
    await API.post('/tasks', payload);
    showToast('✅ Task berhasil dibuat!', 'success');
    closeModal('modal-add-task');
    await API.post('/dashboard/cache/clear');
    if (STATE.currentPage === 'tasks') await loadTasks();
    if (STATE.currentPage === 'dashboard') await loadDashboard();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

// ── REFRESH ───────────────────────────────────────────────
async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.querySelector('i').classList.add('fa-spin');
  try {
    await API.post('/dashboard/cache/clear');
    await navigateTo(STATE.currentPage);
    showToast('Data diperbarui', 'success');
  } catch (e) {
    showToast('Gagal refresh', 'error');
  } finally {
    if (btn) btn.querySelector('i').classList.remove('fa-spin');
  }
}

// ── FAB ───────────────────────────────────────────────────
function toggleFab() {
  STATE.fabOpen = !STATE.fabOpen;
  const menu = document.getElementById('fab-menu');
  const icon = document.getElementById('fab-icon');
  if (STATE.fabOpen) {
    menu.classList.remove('hidden');
    menu.classList.add('flex');
    icon.style.transform = 'rotate(45deg)';
  } else {
    closeFab();
  }
}

function closeFab() {
  STATE.fabOpen = false;
  const menu = document.getElementById('fab-menu');
  const icon = document.getElementById('fab-icon');
  menu.classList.add('hidden');
  menu.classList.remove('flex');
  icon.style.transform = 'rotate(0)';
}

// ── MODALS ────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// ── DRAFT STATE — jaga isi form saat PWA di-background lalu di-reload ────────
function saveDraftState() {
  if (!STATE.token) return;
  const draft = { page: STATE.currentPage, savedAt: Date.now(), modals: {} };
  document.querySelectorAll('.modal').forEach(modal => {
    if (!modal.id) return;
    const isOpen = modal.classList.contains('open') || modal.style.display === 'block';
    if (!isOpen) return;
    const fields = {};
    modal.querySelectorAll('input:not([type=file]), textarea, select').forEach(el => {
      if (el.id) fields[el.id] = el.value;
    });
    if (Object.keys(fields).length) draft.modals[modal.id] = fields;
  });
  localStorage.setItem('crm_draft_state', JSON.stringify(draft));
}

function restoreDraftState() {
  try {
    const raw = localStorage.getItem('crm_draft_state');
    if (!raw) return;
    const draft = JSON.parse(raw);
    localStorage.removeItem('crm_draft_state');
    // Buang draft yang sudah lebih dari 30 menit
    if (Date.now() - (draft.savedAt || 0) > 30 * 60 * 1000) return;
    if (draft.page && draft.page !== 'dashboard') navigateTo(draft.page);
    const modalEntries = Object.entries(draft.modals || {});
    if (!modalEntries.length) return;
    // Delay kecil agar halaman sempat di-render sebelum modal dibuka
    setTimeout(() => {
      modalEntries.forEach(([modalId, fields]) => {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        openModal(modalId);
        Object.entries(fields).forEach(([fieldId, val]) => {
          const el = document.getElementById(fieldId);
          if (el) el.value = val;
        });
      });
      if (typeof showToast === 'function') showToast('Draft form dipulihkan', 'success');
    }, 350);
  } catch (_) {}
}

// ── PWA ───────────────────────────────────────────────────
let deferredPrompt;

function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('pwa-dismissed')) {
      setTimeout(() => document.getElementById('pwa-banner')?.classList.remove('hidden'), 3000);
    }
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      window._swRegistration = reg;

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw.addEventListener('statechange', () => {
          // 'installed' bisa dilewati saat skipWaiting() — cek 'activated' juga
          if ((sw.state === 'installed' || sw.state === 'activated') && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });

      // Fallback: SW kirim SW_UPDATED setelah activate → force reload
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SW_UPDATED') {
          window.location.reload();
        }
      });

      // Re-subscribe push jika user sudah login (page reload / SW update)
      if (localStorage.getItem('crm_token')) {
        setTimeout(() => {
          if (typeof window.setupPushNotifications === 'function') {
            window.setupPushNotifications();
          }
        }, 2000);
      }
    }).catch(() => {});

  }
}

function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    deferredPrompt = null;
    document.getElementById('pwa-banner')?.classList.add('hidden');
  });
}

function dismissPWA() {
  document.getElementById('pwa-banner')?.classList.add('hidden');
  localStorage.setItem('pwa-dismissed', '1');
}

// ── HELPERS ───────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function debounce(fn, delay) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const steps = 20;
  const step  = (target - start) / steps;
  let current = start;
  let count   = 0;
  const timer = setInterval(() => {
    current += step;
    count++;
    el.textContent = Math.round(current);
    if (count >= steps) { el.textContent = target; clearInterval(timer); }
  }, 16);
}

function formatHarga(harga) {
  if (!harga) return '';
  const n = parseInt(harga);
  if (isNaN(n)) return harga;
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${Math.round(n / 1_000_000)}Jt`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  } catch { return isoStr.substring(0, 10); }
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m lalu`;
  if (hours < 24) return `${hours}j lalu`;
  if (days < 7)  return `${days}h lalu`;
  return formatDate(isoStr);
}

function setHeroDate() {
  const el = document.getElementById('hero-date');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

function setHeroGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Selamat pagi' : hour < 18 ? 'Selamat siang' : 'Selamat malam';
  setText('topbar-greeting', greeting);
  setText('hero-name', STATE.user?.nama?.split(' ')[0] || 'Agen');
}


// ── PHOTO PREVIEW (Bug #7) ─────────────────────────────────
let _selectedPhotos = [];

function previewPhotos(input) {
  _selectedPhotos = Array.from(input.files);
  renderPhotoPreview();
}

function renderPhotoPreview() {
  const grid = document.getElementById('photo-preview-grid');
  if (!grid) return;
  if (!_selectedPhotos.length) { grid.innerHTML = ''; return; }

  grid.innerHTML = _selectedPhotos.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `
      <div style="position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:#0A1628">
        <img src="${url}" style="width:100%;height:100%;object-fit:cover"/>
        <button onclick="removePhoto(${i})"
          style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;
                 background:rgba(239,68,68,0.85);border:none;color:#fff;font-size:11px;
                 cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">
          <i class="fa-solid fa-xmark"></i>
        </button>
        ${i === 0 ? '<span style="position:absolute;bottom:4px;left:4px;font-size:9px;background:rgba(43,123,255,0.85);color:#fff;padding:2px 6px;border-radius:6px">Utama</span>' : ''}
      </div>`;
  }).join('');
}

function removePhoto(index) {
  _selectedPhotos.splice(index, 1);

  // Re-create FileList from remaining photos
  const dt = new DataTransfer();
  _selectedPhotos.forEach(f => dt.items.add(f));
  const input = document.getElementById('add-photos');
  if (input) input.files = dt.files;

  renderPhotoPreview();
}

// ── RESET LISTING MODAL (Bug #8) ───────────────────────────
function resetListingModal() {
  _selectedPhotos = [];
  const grid = document.getElementById('photo-preview-grid');
  if (grid) grid.innerHTML = '';
  const input = document.getElementById('add-photos');
  if (input) input.value = '';

  // Reset all form fields
  ['add-judul','add-kota','add-kecamatan','add-harga','add-deskripsi'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const tipeEl = document.getElementById('add-tipe');
  if (tipeEl) tipeEl.value = '';
  const transaksiEl = document.getElementById('add-transaksi');
  if (transaksiEl) transaksiEl.value = '';

  // Re-enable save button if it was disabled
  const btn = document.querySelector('#modal-add-listing .btn-gold');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px"></i>Simpan'; }

  closeModal('modal-add-listing');
}

// ── KOMISI FORM (Bug #1) ───────────────────────────────────
async function openKomisiForm() {
  try {
    // Ambil URL form dari server config, atau gunakan fallback dari window
    let url = window._KOMISI_FORM_URL || '';
    if (!url) {
      const cfg = await API.get('/dashboard/config').catch(() => null);
      url = cfg?.data?.komisi_form_url || '';
      window._KOMISI_FORM_URL = url;
    }
    if (!url) {
      showToast('URL Form Komisi belum dikonfigurasi. Set KOMISI_FORM_URL di .env', 'error');
      return;
    }
    const iframe = document.getElementById('komisi-iframe');
    if (iframe && iframe.src !== url) iframe.src = url;
    openModal('modal-komisi');
  } catch(e) {
    showToast('Gagal membuka form komisi', 'error');
  }
}

// ── TASK LEAD DROPDOWN (Bug #6) ────────────────────────────
function onTaskLeadChange(sel) {
  const customInput = document.getElementById('new-task-lead-custom');
  if (!customInput) return;
  customInput.style.display = sel.value === 'baru' ? 'block' : 'none';
}

async function populateTaskLeadDropdown() {
  const sel = document.getElementById('new-task-lead');
  if (!sel) return;

  // Reset to defaults
  sel.innerHTML = '<option value="">-- Pilih dari daftar --</option><option value="baru">✏️ Baru (input manual)</option>';

  try {
    const leads = STATE.leads.length ? STATE.leads : (await API.get('/leads')).data || [];
    const active = leads.filter(l => !['Deal','Batal','Out_of_List'].includes(l.Status_Lead));

    active.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.ID;
      opt.dataset.nama = l.Nama;
      opt.dataset.wa   = l.No_WA || '';
      const badge = l.Score === 'Hot' ? '🔥 ' : l.Score === 'Warm' ? '☀️ ' : '';
      opt.textContent  = `${badge}${l.Nama} — ${l.Status_Lead || 'Baru'}`;
      sel.appendChild(opt);
    });
  } catch(_) {}
}

// ── H-2 NOTIFICATION (Bug #11) ─────────────────────────────
function checkUpcomingReminders(tasks) {
  const now  = new Date();
  const in48 = new Date(now.getTime() + 48 * 3600 * 1000);

  const upcoming = tasks.filter(t => {
    if (['Done','Cancelled'].includes(t.Status)) return false;
    const sched = new Date(t.Scheduled_At);
    return sched > now && sched <= in48;
  });

  const container = document.getElementById('upcoming-reminder-banner');
  if (!container) return;

  if (!upcoming.length) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = upcoming.map(t => {
    const sched = new Date(t.Scheduled_At);
    const diffH = Math.round((sched - now) / 3600000);
    const label = diffH < 24 ? `${diffH} jam lagi` : 'besok';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(251,146,60,0.1);
                  border:1px solid rgba(251,146,60,0.3);border-radius:12px;margin-bottom:6px">
        <i class="fa-solid fa-bell" style="color:#fb923c;font-size:14px;flex-shrink:0"></i>
        <div style="flex:1;min-width:0">
          <p style="font-size:12px;font-weight:600;color:#fff;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escHtml(t.Tipe)}: ${escHtml(t.Lead_Nama || t.Judul || '')}
          </p>
          <p style="font-size:11px;color:rgba(251,146,60,0.8);margin:2px 0 0">
            🗓 ${sched.toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'})} ${formatTime(t.Scheduled_At)} — <b>${label}</b>
          </p>
        </div>
      </div>`;
  }).join('');
}

// Keyboard: Enter to login
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('login-screen') && !document.getElementById('login-screen').classList.contains('hidden')) {
    handleLogin();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    closeFab();
  }
});

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
  if (STATE.fabOpen && !e.target.closest('#fab-area')) {
    closeFab();
  }
});

// ── Expose globals untuk pa-dashboard.js & modul lain ────
// const tidak otomatis jadi window.X — harus di-assign manual
window.API   = API;
window.STATE = STATE;
