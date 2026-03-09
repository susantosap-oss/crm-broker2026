/**
 * app-mobile.js — CRM Broker Properti GAS Edition
 * PR 1–15: All features implemented
 */

// ─────────────────────────────────────────────────────────
// PR 2: LOGOUT FIX
// ─────────────────────────────────────────────────────────
function logout() { doLogout(); }

// ─────────────────────────────────────────────────────────
// SETTINGS / PROFILE STATE (PR 5,6)
// ─────────────────────────────────────────────────────────
let _profileData = {
  nama: '',
  wa: '',
  status: 'Aktif',
  photoUrl: '',
  logoUrl: '',
  _pendingPhotoFile: null,
  _pendingLogoFile: null,
};

function loadProfileFromStorage() {
  try {
    const saved = localStorage.getItem('crm_profile');
    if (saved) Object.assign(_profileData, JSON.parse(saved));
  } catch (_) {}
}

function saveProfileToStorage() {
  const { nama, wa, status, photoUrl, logoUrl } = _profileData;
  localStorage.setItem('crm_profile', JSON.stringify({ nama, wa, status, photoUrl, logoUrl }));
}

function applyProfileToUI() {
  const initial = (_profileData.nama || STATE?.user?.nama || 'A').charAt(0).toUpperCase();
  const photo = _profileData.photoUrl;
  const logo  = _profileData.logoUrl;
  const status = _profileData.status || 'Aktif';
  const statusColor = status === 'Aktif' ? '#4ade80' : '#9ca3af';
  const statusText = status === 'Aktif' ? '● Aktif' : '✈ Cuti';

  // Avatar everywhere
  ['dash-avatar-img','sidebar-avatar-img','topnav-avatar-img'].forEach(id => {
    const img = document.getElementById(id);
    if (!img) return;
    if (photo) { img.src = photo; img.style.display = 'block'; }
    else { img.style.display = 'none'; }
  });
  ['dash-avatar-letter','sidebar-avatar','topnav-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = initial;
    el.style.display = photo ? 'none' : '';
  });

  // Logo everywhere
  // logo static di HTML — tidak perlu JS

  // Status badges
  const heroStatus = document.getElementById('hero-status');
  if (heroStatus) { heroStatus.textContent = statusText; heroStatus.style.color = statusColor; }
  const sidebarStatus = document.getElementById('sidebar-status');
  if (sidebarStatus) { sidebarStatus.textContent = statusText; sidebarStatus.style.color = statusColor; }
}

function openSettings() {
  const u = STATE?.user || {};
  const d = _profileData;
  setVal('set-nama', d.nama || u.nama || '');
  setVal('set-wa',     d.wa     || u.no_wa    || '');
  setVal('set-wa-biz', d.waBiz  || u.no_wa_biz || '');

  // Photo preview in settings
  const sImg = document.getElementById('set-avatar-img');
  const sLet = document.getElementById('set-avatar-letter');
  if (d.photoUrl) { sImg.src = d.photoUrl; sImg.style.display='block'; sLet.style.display='none'; }
  else { sImg.style.display='none'; sLet.style.display=''; sLet.textContent=(d.nama||u.nama||'A').charAt(0).toUpperCase(); }

  // Tampilkan Ganti Password hanya untuk agen & business_manager
  const passSection = document.getElementById('set-password-section');
  if (passSection) {
    const showPass = ['agen','business_manager'].includes(u.role);
    passSection.style.display = showPass ? 'block' : 'none';
  }
  // Reset password fields
  ['set-pass-old','set-pass-new','set-pass-confirm'].forEach(id => setVal(id, ''));

  setStatus(d.status || 'Aktif');
  openModal('modal-settings');
}

function previewSettingsPhoto(input) {
  const file = input.files[0]; if (!file) return;
  _profileData._pendingPhotoFile = file;
  const url = URL.createObjectURL(file);
  const img = document.getElementById('set-avatar-img');
  const let_ = document.getElementById('set-avatar-letter');
  img.src = url; img.style.display = 'block'; let_.style.display = 'none';
}



function setStatus(status) {
  _profileData.status = status;
  const ab = document.getElementById('btn-status-aktif');
  const cb = document.getElementById('btn-status-cuti');
  if (ab) {
    ab.style.borderWidth = status==='Aktif'?'2px':'1px';
    ab.style.borderColor = status==='Aktif'?'rgba(34,197,94,0.6)':'rgba(255,255,255,0.1)';
    ab.style.background  = status==='Aktif'?'rgba(34,197,94,0.15)':'transparent';
    ab.style.color       = status==='Aktif'?'#4ade80':'rgba(255,255,255,0.45)';
    ab.style.fontWeight  = status==='Aktif'?'700':'400';
  }
  if (cb) {
    cb.style.borderWidth = status==='Cuti'?'2px':'1px';
    cb.style.borderColor = status==='Cuti'?'rgba(156,163,175,0.6)':'rgba(255,255,255,0.1)';
    cb.style.background  = status==='Cuti'?'rgba(156,163,175,0.15)':'transparent';
    cb.style.color       = status==='Cuti'?'#d1d5db':'rgba(255,255,255,0.45)';
    cb.style.fontWeight  = status==='Cuti'?'700':'400';
  }
}

async function saveSettings() {
  const nama  = getVal('set-nama').trim();
  const wa    = getVal('set-wa').trim();
  const waBiz = getVal('set-wa-biz').trim();
  if (!nama) { showToast('Nama wajib diisi', 'error'); return; }

  // Upload photo to Cloudinary if pending
  if (_profileData._pendingPhotoFile) {
    try {
      const url = await uploadToCloudinary(_profileData._pendingPhotoFile, 'profile');
      _profileData.photoUrl = url;
      _profileData._pendingPhotoFile = null;
    } catch (e) {
      showToast('Gagal upload foto: ' + e.message, 'error'); return;
    }
  }
  _profileData.nama  = nama;
  _profileData.wa    = wa;
  _profileData.waBiz = waBiz;
  saveProfileToStorage();
  applyProfileToUI();

  // Ganti password jika diisi (agen & business_manager)
  const passOld     = getVal('set-pass-old').trim();
  const passNew     = getVal('set-pass-new').trim();
  const passConfirm = getVal('set-pass-confirm').trim();
  if (passNew) {
    if (!passOld) { showToast('Masukkan password lama', 'error'); return; }
    if (passNew.length < 6) { showToast('Password baru min. 6 karakter', 'error'); return; }
    if (passNew !== passConfirm) { showToast('Konfirmasi password tidak cocok', 'error'); return; }
    try {
      await API.put('/agents/change-password', { oldPassword: passOld, newPassword: passNew });
      showToast('✅ Password berhasil diubah', 'success');
    } catch (e) {
      showToast('Gagal ganti password: ' + e.message, 'error'); return;
    }
  }

  closeModal('modal-settings');

  // Sync profile to server
  try { await API.put('/agents/profile', { nama, wa, wa_business: waBiz, status: _profileData.status, photoUrl: _profileData.photoUrl }); } catch (_) {}
  showToast('✅ Profil berhasil disimpan!', 'success');
}

// ─────────────────────────────────────────────────────────
// CLOUDINARY UPLOAD (PR 5, foto listing)
// ─────────────────────────────────────────────────────────
async function uploadToCloudinary(file, folder = 'listings') {
  const CLOUD_NAME = window._CLOUD_NAME || 'dqiqatpac';
  const UPLOAD_PRESET = window._UPLOAD_PRESET || 'crm_unsigned';

  // Auto compress: resize + quality (setara WA ~80%)
  const compressed = await compressImage(file, 1280, 0.80);

  const formData = new FormData();
  formData.append('file', compressed);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST', body: formData
  });
  if (!res.ok) throw new Error('Cloudinary error');
  const data = await res.json();
  return data.secure_url;
}

// PR Auto Compress: compress image like WhatsApp
async function compressImage(file, maxWidth = 1280, quality = 0.80) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) { height = Math.round(height * maxWidth / width); width = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/webp', quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

// Get Cloudinary config from server
async function loadCloudinaryConfig() {
  try {
    const res = await API.get('/config/cloudinary');
    if (res.cloudName) {
      window._CLOUD_NAME = res.cloudName;
      window._UPLOAD_PRESET = res.uploadPreset || 'crm_unsigned';
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────
// NOTIFICATION SYSTEM (PR 8, 12, 15)
// ─────────────────────────────────────────────────────────
let _notifications = [];

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderNotifList();
}

// Close notif panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const bell = e.target.closest('[onclick*="toggleNotifPanel"]');
  if (panel && !bell && !panel.contains(e.target)) panel.style.display = 'none';
});

function addNotif(type, msg, leadId = null) {
  _notifications.unshift({ id: Date.now(), type, msg, leadId, read: false, time: new Date() });
  updateNotifDot();
  // Browser notification (PR 12, 15)
  if (Notification.permission === 'granted') {
    new Notification('CRM Properti', { body: msg, icon: '/icons/icon-192.png' });
  }
}

function updateNotifDot() {
  const dot = document.getElementById('notif-dot');
  if (!dot) return;
  const hasUnread = _notifications.some(n => !n.read);
  dot.classList.toggle('show', hasUnread);
}

function markAllRead() {
  _notifications.forEach(n => n.read = true);
  updateNotifDot();
  renderNotifList();
}

function renderNotifList() {
  const el = document.getElementById('notif-list');
  if (!el) return;
  if (!_notifications.length) {
    el.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;padding:20px">Tidak ada notifikasi</p>';
    return;
  }
  const typeIcon = { stale: '⚠️', schedule: '📅', info: 'ℹ️', success: '✅' };
  el.innerHTML = _notifications.slice(0, 20).map(n => `
    <div onclick="handleNotifClick('${n.id}')" style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;background:${n.read?'transparent':'rgba(212,168,83,0.05)'}" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background='${n.read?'transparent':'rgba(212,168,83,0.05)'}'">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:16px;flex-shrink:0;margin-top:2px">${typeIcon[n.type]||'🔔'}</span>
        <div style="flex:1;min-width:0">
          <p style="font-size:12px;color:${n.read?'rgba(255,255,255,0.6)':'#fff'};margin-bottom:3px;line-height:1.4">${escapeHtml(n.msg)}</p>
          <span style="font-size:10px;color:rgba(255,255,255,0.3)">${formatRelativeDate(n.time)}</span>
        </div>
        ${!n.read ? '<span style="width:6px;height:6px;background:#D4A853;border-radius:50%;flex-shrink:0;margin-top:4px"></span>' : ''}
      </div>
    </div>
  `).join('');
}

function handleNotifClick(id) {
  const notif = _notifications.find(n => n.id == id);
  if (notif) { notif.read = true; updateNotifDot(); }
  document.getElementById('notif-panel').style.display = 'none';
  if (notif?.leadId) { openLeadDetail(notif.leadId); }
  renderNotifList();
}


// ─────────────────────────────────────────────────────────
// HANDLE LOGIN
// ─────────────────────────────────────────────────────────
async function handleLogin() {
  const email = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!email || !password) {
    if (errEl) { errEl.textContent = 'Email dan password wajib diisi'; errEl.classList.remove('hidden'); }
    return;
  }

  if (btn) btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Login gagal');

    STATE.token = data.data.token;
    STATE.user  = data.data.user;
    sessionStorage.setItem('crm_token', STATE.token);
    sessionStorage.setItem('crm_user', JSON.stringify(STATE.user));
    showApp();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.classList.remove('hidden'); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// PR 8: Check stale leads (runs on dashboard load)
async function checkStaleLeads() {
  try {
    const res = await API.get('/leads?limit=200');
    const leads = res.data || [];
    const now = new Date();
    leads.forEach(l => {
      if (!l.Last_Activity_Date) return;
      const lastAct = new Date(l.Last_Activity_Date);
      const daysSince = Math.floor((now - lastAct) / (1000*60*60*24));
      if (l.Score === 'Hot' && daysSince >= 7) {
        addNotif('stale', `🔥 ${l.Nama} (Hot) belum ditindaklanjuti ${daysSince} hari`, l.ID);
      } else if ((l.Score === 'Warm' || l.Score === 'Cold') && daysSince >= 14) {
        addNotif('stale', `${l.Score==='Warm'?'☀️':'❄️'} ${l.Nama} (${l.Score}) belum ditindaklanjuti ${daysSince} hari`, l.ID);
      }
    });
  } catch (_) {}
}

// PR 12: Check upcoming schedules H-2
async function checkUpcomingSchedules() {
  try {
    const res = await API.get('/tasks/upcoming?limit=50');
    const tasks = res.data || [];
    const now = new Date();
    tasks.forEach(t => {
      if (!t.Scheduled_At) return;
      const sched = new Date(t.Scheduled_At);
      const hoursUntil = (sched - now) / (1000*60*60);
      if (hoursUntil > 0 && hoursUntil <= 48) {
        const key = `notif_${t.ID}`;
        if (!sessionStorage.getItem(key)) {
          const timeStr = sched.toLocaleString('id-ID', {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
          addNotif('schedule', `📅 Jadwal H-2: ${t.Tipe} — ${t.Lead_Nama||'Tanpa lead'} (${timeStr})`, null);
          sessionStorage.setItem(key, '1');
        }
      }
    });
  } catch (_) {}
}

// Request browser notification permission
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ─────────────────────────────────────────────────────────
// FAVOURITES (PR 10)
// ─────────────────────────────────────────────────────────
let _favourites = new Set();

// ── Favourites — server-side sync (lintas device) ──────────
async function loadFavourites() {
  try {
    const res = await API.get('/favourites');
    _favourites = new Set(res.data || []);
  } catch (_) {
    // fallback localStorage kalau offline
    try { _favourites = new Set(JSON.parse(localStorage.getItem('crm_favs') || '[]')); } catch (__) {}
  }
}

async function toggleFav(listingId, btn) {
  const wasFav = _favourites.has(listingId);
  // Optimistic update
  if (wasFav) {
    _favourites.delete(listingId);
    if (btn) btn.innerHTML = '<i class="fa-regular fa-star" style="color:rgba(255,255,255,0.4);font-size:14px"></i>';
    showToast('Dihapus dari favorit', 'info');
  } else {
    _favourites.add(listingId);
    if (btn) btn.innerHTML = '<i class="fa-solid fa-star" style="color:#D4A853;font-size:14px"></i>';
    showToast('⭐ Ditambahkan ke favorit!', 'success');
  }
  updateFavBar();
  try {
    await API.post(`/favourites/${listingId}`);
  } catch (_) {
    // Rollback kalau API gagal
    if (wasFav) _favourites.add(listingId); else _favourites.delete(listingId);
    if (btn) btn.innerHTML = wasFav
      ? '<i class="fa-solid fa-star" style="color:#D4A853;font-size:14px"></i>'
      : '<i class="fa-regular fa-star" style="color:rgba(255,255,255,0.4);font-size:14px"></i>';
    updateFavBar();
    showToast('Gagal menyimpan favorit', 'error');
  }
}

function updateFavBar() {
  const bar  = document.getElementById('fav-bar');
  const cnt  = document.getElementById('fav-count');
  if (!bar) return;
  const n = _favourites.size;
  bar.style.display = n > 0 ? 'block' : 'none';
  if (cnt) cnt.textContent = n;
}

async function downloadFavPDF() {
  if (!_favourites.size) { showToast('Belum ada favorit', 'error'); return; }
  showToast('📄 Membuat PDF…', 'info');
  try {
    const ids   = [..._favourites].join(',');
    const res   = await fetch(`/api/v1/listings/pdf?ids=${ids}`, {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `mansion-listing-${Date.now()}.pdf`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('✅ PDF berhasil diunduh!', 'success');
  } catch (err) {
    showToast('PDF error: ' + (err.message || 'unknown'), 'error');
    console.error('[PDF]', err);
  }
}

// ─────────────────────────────────────────────────────────
// LISTING TAB (PR 3, 7, 10)
// ─────────────────────────────────────────────────────────
let _listingTab = 'mine';
let _allListings = [];

async function setListingTab(tab, btn) {
  _listingTab = tab;
  document.querySelectorAll('[id^="ltab-"]').forEach(b => {
    b.className = b.id === 'ltab-' + tab ? 'chip on' : 'chip';
  });
  await loadListings();
}

async function loadListings() {
  const grid = document.getElementById('listings-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="skeleton" style="height:100px;border-radius:14px"></div>'.repeat(3);

  try {
    // Tab fav: ambil semua listing supaya bisa filter lintas agen
    const endpoint = (_listingTab === 'all' || _listingTab === 'fav')
      ? '/listings?all=1'
      : '/listings';
    const res = await API.get(endpoint);
    _allListings = res.data || [];

    let toShow = _allListings;
    if (_listingTab === 'fav') toShow = _allListings.filter(l => _favourites.has(l.ID));

    renderListingsGrid(toShow);
    updateFavBar();
  } catch (e) {
    grid.innerHTML = emptyState('Gagal memuat listing');
  }
}

function renderListingsGrid(listings) {
  const grid = document.getElementById('listings-grid');
  if (!grid) return;
  if (!listings.length) { grid.innerHTML = emptyState('Belum ada listing'); return; }

  const statusColor = { Aktif:'#22C55E', Terjual:'#6B7280', Tersewa:'#3B82F6', Ditarik:'#ef4444' };

  grid.innerHTML = listings.map(l => {
    const sc = statusColor[l.Status_Listing] || '#6B7280';
    const harga = l.Harga_Format || formatRupiah(l.Harga);
    const isFav = _favourites.has(l.ID);
    const isInactive = ['Terjual','Tersewa'].includes(l.Status_Listing);

    return `
      <div data-id="${escapeHtml(l.ID)}" data-inactive="${isInactive}" onclick="if(!this.dataset.inactive||this.dataset.inactive==='false')openListingDetail(this.dataset.id)"
        style="display:flex;gap:12px;background:${isInactive?'rgba(19,31,56,0.55)':'#131F38'};border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:12px;${isInactive?'opacity:0.55;cursor:not-allowed;filter:grayscale(0.5)':'cursor:pointer'};transition:border-color 0.2s"
        onmouseenter="if(!this.dataset.inactive||this.dataset.inactive==='false')this.style.borderColor='rgba(212,168,83,0.25)'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.06)'">
        <div style="width:80px;height:80px;border-radius:10px;background:#1C2D52;overflow:hidden;flex-shrink:0">
          ${l.Foto_Utama_URL
            ? `<img src="${escapeHtml(l.Foto_Utama_URL)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-building" style="color:rgba(255,255,255,0.15);font-size:20px"></i></div>`}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;margin-bottom:4px">
            <span style="font-size:12px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escapeHtml(l.Judul||'—')}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
              ${isInactive
                ? `<span style="font-size:9px;padding:2px 6px;border-radius:5px;background:${sc}18;color:${sc};font-weight:600">${l.Status_Listing}</span>`
                : `<button onclick="event.stopPropagation();openStatusPicker('${escapeHtml(l.ID)}','${l.Status_Listing}')"
                    style="font-size:9px;padding:2px 6px;border-radius:5px;background:${sc}18;color:${sc};font-weight:600;border:none;cursor:pointer;display:flex;align-items:center;gap:3px">
                    ${l.Status_Listing} <i class="fa-solid fa-chevron-down" style="font-size:7px"></i>
                  </button>`
              }
              <button onclick="event.stopPropagation();toggleFav('${escapeHtml(l.ID)}',this)"
                style="width:28px;height:28px;border-radius:8px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">
                ${isFav
                  ? '<i class="fa-solid fa-star" style="color:#D4A853;font-size:14px"></i>'
                  : '<i class="fa-regular fa-star" style="color:rgba(255,255,255,0.3);font-size:14px"></i>'}
              </button>
            </div>
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:5px">${escapeHtml(l.Kode_Listing||'')} · ${escapeHtml(l.Kota||'')}${(_listingTab==='all' && l.Agen_Nama) ? ' · <span style="color:#D4A853">'+escapeHtml(l.Agen_Nama)+'</span>' : ''}</div>
          <div style="font-size:14px;font-weight:700;color:#D4A853">${harga}</div>
          <div style="display:flex;gap:8px;margin-top:3px">
            ${l.Luas_Tanah ? `<span style="font-size:9px;color:rgba(255,255,255,0.3)">LT ${l.Luas_Tanah}m²</span>` : ''}
            ${l.Kamar_Tidur ? `<span style="font-size:9px;color:rgba(255,255,255,0.3)">🛏 ${l.Kamar_Tidur}KT</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function filterListings() {
  const q = document.getElementById('listing-search')?.value?.toLowerCase() || '';
  let filtered = _listingTab === 'fav'
    ? _allListings.filter(l => _favourites.has(l.ID))
    : _allListings;
  if (q) filtered = filtered.filter(l => [l.Judul,l.Kode_Listing,l.Kota,l.Tipe_Properti].some(v => v?.toLowerCase().includes(q)));
  renderListingsGrid(filtered);
}

// ─────────────────────────────────────────────────────────
// LISTING DETAIL MODAL (PR 3, 7)
// ─────────────────────────────────────────────────────────
async function openListingDetail(id) {
  const listing = _allListings.find(l => l.ID === id);
  if (!listing) { showToast('Data tidak ditemukan', 'error'); return; }

  document.getElementById('ld-title').textContent = listing.Judul || 'Detail Listing';
  const body = document.getElementById('ld-body');
  const harga = listing.Harga_Format || formatRupiah(listing.Harga);

  const caption = listing.Caption_Sosmed || listing.Caption || '';
  const deskripsi = listing.Deskripsi || '';

  body.innerHTML = `
    <!-- Photos -->
    ${listing.Foto_Utama_URL ? `
      <div style="border-radius:14px;overflow:hidden;position:relative">
        <img src="${escapeHtml(listing.Foto_Utama_URL)}" onclick="openPhotoViewer('${escapeHtml(listing.Foto_Utama_URL)}','${escapeHtml(listing.Foto_2_URL||'')}','${escapeHtml(listing.Foto_3_URL||'')}')"
          style="width:100%;object-fit:cover;max-height:220px;cursor:zoom-in;display:block" loading="lazy"/>
        <div style="position:absolute;bottom:8px;right:8px;display:flex;gap:6px">
          ${listing.Foto_2_URL ? `<div style="width:44px;height:44px;border-radius:8px;overflow:hidden;border:2px solid rgba(255,255,255,0.3);cursor:pointer" onclick="openPhotoViewer('${escapeHtml(listing.Foto_Utama_URL)}','${escapeHtml(listing.Foto_2_URL||'')}','${escapeHtml(listing.Foto_3_URL||'')}',1)"><img src="${escapeHtml(listing.Foto_2_URL)}" style="width:100%;height:100%;object-fit:cover"/></div>` : ''}
          ${listing.Foto_3_URL ? `<div style="width:44px;height:44px;border-radius:8px;overflow:hidden;border:2px solid rgba(255,255,255,0.3);cursor:pointer" onclick="openPhotoViewer('${escapeHtml(listing.Foto_Utama_URL)}','${escapeHtml(listing.Foto_2_URL||'')}','${escapeHtml(listing.Foto_3_URL||'')}',2)"><img src="${escapeHtml(listing.Foto_3_URL)}" style="width:100%;height:100%;object-fit:cover"/></div>` : ''}
        </div>
      </div>` : ''}

    <!-- Info Row -->
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <span style="padding:5px 10px;border-radius:8px;background:rgba(43,123,255,0.12);color:#60a5fa;font-size:11px;font-weight:600">${escapeHtml(listing.Tipe_Properti||'—')}</span>
      <span style="padding:5px 10px;border-radius:8px;background:rgba(34,197,94,0.12);color:#4ade80;font-size:11px;font-weight:600">${escapeHtml(listing.Status_Transaksi||'—')}</span>
      <span style="padding:5px 10px;border-radius:8px;background:rgba(212,168,83,0.12);color:#D4A853;font-size:11px;font-weight:700">${harga}</span>
    </div>

    <!-- Location -->
    <div style="display:flex;align-items:center;gap:8px;color:rgba(255,255,255,0.6);font-size:13px">
      <i class="fa-solid fa-location-dot" style="color:#D4A853"></i>
      <span>${escapeHtml([listing.Kecamatan, listing.Kota].filter(Boolean).join(', ') || '—')}</span>
    </div>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      ${listing.Luas_Tanah ? `<div style="background:#1C2D52;border-radius:10px;padding:10px;text-align:center"><div style="font-size:13px;font-weight:700;color:#fff">${escapeHtml(String(listing.Luas_Tanah))}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px">LT m²</div></div>` : ''}
      ${listing.Luas_Bangunan ? `<div style="background:#1C2D52;border-radius:10px;padding:10px;text-align:center"><div style="font-size:13px;font-weight:700;color:#fff">${escapeHtml(String(listing.Luas_Bangunan))}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px">LB m²</div></div>` : ''}
      ${listing.Kamar_Tidur ? `<div style="background:#1C2D52;border-radius:10px;padding:10px;text-align:center"><div style="font-size:13px;font-weight:700;color:#fff">${escapeHtml(String(listing.Kamar_Tidur))}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px">Kamar Tidur</div></div>` : ''}
    </div>

    <!-- Deskripsi -->
    ${deskripsi ? `
    <div>
      <label class="form-label">Deskripsi</label>
      <div style="background:#131F38;border-radius:12px;padding:12px 14px;font-size:12px;color:rgba(255,255,255,0.7);line-height:1.6;white-space:pre-wrap">${escapeHtml(deskripsi)}</div>
    </div>` : ''}

    <!-- Caption Sosmed (PR 7) -->
    <div>
      <label class="form-label">Caption Media Sosial</label>
      <div style="position:relative">
        <textarea id="ld-caption" rows="4" class="form-input" style="resize:none;font-size:12px;padding-right:40px">${escapeHtml(caption)}</textarea>
        <button onclick="copyCaption()" style="position:absolute;right:10px;top:10px;background:rgba(212,168,83,0.15);border:1px solid rgba(212,168,83,0.3);border-radius:8px;padding:6px 8px;cursor:pointer;color:#D4A853;font-size:11px"><i class="fa-regular fa-copy"></i></button>
      </div>
      <button onclick="saveCaption('${escapeHtml(id)}')" style="width:100%;margin-top:6px;padding:8px;border-radius:10px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.2);color:#D4A853;font-size:11px;cursor:pointer;font-weight:600"><i class="fa-solid fa-floppy-disk" style="margin-right:5px"></i>Simpan Caption ke Sheet</button>
    </div>

    <!-- Agen info (thumbnail agen lain) -->
    <div>
      <label class="form-label">Listing Agen Lain (Properti Serupa)</label>
      <div id="similar-listings" style="display:flex;flex-direction:column;gap:8px">
        <div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:12px">Memuat…</div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div style="display:flex;gap:10px;padding-top:4px;flex-wrap:wrap">
      <button onclick="openShareWAPicker('${escapeHtml(id)}')" style="flex:1;min-width:120px;padding:13px;border-radius:12px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);color:#4ade80;font-size:13px;font-weight:600;cursor:pointer">
        <i class="fa-brands fa-whatsapp" style="margin-right:6px"></i>Share WA
      </button>
      <button onclick="shareListingWACatalog('${escapeHtml(id)}')" style="flex:1;min-width:120px;padding:13px;border-radius:12px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.25);color:#D4A853;font-size:13px;font-weight:600;cursor:pointer">
        <i class="fa-regular fa-copy" style="margin-right:6px"></i>WA Catalog
      </button>
      ${listing.Agen_ID === STATE.user?.id ? `
      <button onclick="openEditListing('${escapeHtml(id)}')" style="width:100%;padding:13px;border-radius:12px;background:rgba(43,123,255,0.12);border:1px solid rgba(43,123,255,0.25);color:#60a5fa;font-size:13px;font-weight:600;cursor:pointer;margin-top:0">
        <i class="fa-solid fa-pen-to-square" style="margin-right:6px"></i>Edit Listing
      </button>` : ''}
    </div>
  `;

  openModal('modal-listing-detail');
  loadSimilarListings(listing);
}

function loadSimilarListings(current) {
  const el = document.getElementById('similar-listings');
  if (!el) return;
  const others = _allListings.filter(l =>
    l.ID !== current.ID &&
    l.Tipe_Properti === current.Tipe_Properti &&
    l.Status_Transaksi === current.Status_Transaksi
  ).slice(0, 3);

  if (!others.length) { el.innerHTML = '<p style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:10px">Tidak ada listing serupa</p>'; return; }

  el.innerHTML = others.map(l => `
    <div onclick="closeModal('modal-listing-detail');setTimeout(()=>openListingDetail('${escapeHtml(l.ID)}'),200)"
      style="display:flex;align-items:center;gap:10px;background:#1C2D52;border-radius:12px;padding:10px;cursor:pointer">
      <div style="width:44px;height:44px;border-radius:8px;background:#131F38;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">
        ${l.Foto_Utama_URL
          ? `<img src="${escapeHtml(l.Foto_Utama_URL)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"/>`
          : '<i class="fa-solid fa-building" style="color:rgba(255,255,255,0.2);font-size:14px"></i>'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.Judul||'—')}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:1px">${escapeHtml(l.Kode_Listing||'')} · ${l.Harga_Format||formatRupiah(l.Harga)}</div>
      </div>
    </div>
  `).join('');
}

async function copyCaption() {
  const el = document.getElementById('ld-caption');
  if (!el) return;
  try { await navigator.clipboard.writeText(el.value); showToast('✅ Caption disalin!', 'success'); }
  catch (_) { el.select(); document.execCommand('copy'); showToast('✅ Caption disalin!', 'success'); }
}

async function saveCaption(listingId) {
  const caption = document.getElementById('ld-caption')?.value || '';
  try {
    await API.put(`/listings/${listingId}`, { Caption_Sosmed: caption });
    showToast('✅ Caption disimpan ke Sheet!', 'success');
  } catch (e) { showToast('Gagal simpan: ' + e.message, 'error'); }
}

// PR 7: Share to WhatsApp — plain text, no emoji, + Hubungi agen
// ── Share WA helpers ──────────────────────────────────────
let _shareWAListingId = null;

function _buildShareText(listing) {
  const harga     = listing.Harga_Format || formatRupiah(listing.Harga);
  const agentNama  = STATE.user?.nama || listing.Agen_Nama || '';
  const agentWA    = STATE.user?.no_wa    || STATE.user?.No_WA    || '';
  const agentWABiz = STATE.user?.no_wa_biz || '';
  const waClean    = agentWA.replace(/\D/g, '');
  const waBizClean = agentWABiz.replace(/\D/g, '');
  const lokasi    = [listing.Kecamatan, listing.Kota].filter(Boolean).join(', ');
  const spek      = [
    listing.Luas_Tanah    ? `LT ${listing.Luas_Tanah} m2`    : '',
    listing.Luas_Bangunan ? `LB ${listing.Luas_Bangunan} m2` : '',
    listing.Kamar_Tidur   ? `${listing.Kamar_Tidur} KT`       : '',
    listing.Kamar_Mandi   ? `${listing.Kamar_Mandi} KM`       : '',
    listing.Sertifikat    ? `SHT: ${listing.Sertifikat}`      : '',
  ].filter(Boolean).join(' / ');
  // Strip hashtag dari deskripsi
  const rawDesk = (listing.Deskripsi || '').replace(/#\w+/g, '').replace(/\s{2,}/g, ' ').trim();
  const deskripsi = rawDesk
    ? '\n' + rawDesk.substring(0, 300) + (rawDesk.length > 300 ? '...' : '')
    : '';
  return (
    `${listing.Judul || 'Properti Dijual'}\n` +
    `${listing.Tipe_Properti || ''} - ${listing.Status_Transaksi || ''}\n` +
    `Lokasi : ${lokasi || '-'}\n` +
    `Harga  : ${harga}\n` +
    (spek ? `Spek   : ${spek}\n` : '') +
    (listing.Kode_Listing ? `Kode   : ${listing.Kode_Listing}\n` : '') +
    deskripsi +
    `\n\nHubungi :\n` +
    `Nama       : ${agentNama}\n` +
    (waClean    ? `WA         : +${waClean}\n`    : '') +
    (waBizClean ? `WA Business: +${waBizClean}\n` : '')
  );
}

function openShareWAPicker(listingId) {
  _shareWAListingId = listingId;
  // Tampilkan mini-picker di atas tombol
  const existing = document.getElementById('wa-picker-popup');
  if (existing) { existing.remove(); return; }

  const popup = document.createElement('div');
  popup.id = 'wa-picker-popup';
  popup.style.cssText = `
    position:fixed;bottom:160px;left:50%;transform:translateX(-50%);
    background:#141E35;border:1px solid rgba(212,168,83,0.4);border-radius:16px;
    padding:16px;z-index:9999;width:280px;box-shadow:0 8px 32px rgba(0,0,0,0.5);
  `;
  popup.innerHTML = `
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px;text-align:center">Pilih aplikasi WhatsApp</div>
    <button onclick="doShareWA('wa')" style="width:100%;padding:13px;border-radius:12px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);color:#4ade80;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px">
      <i class="fa-brands fa-whatsapp" style="font-size:18px"></i> WhatsApp
    </button>
    <button onclick="doShareWA('wab')" style="width:100%;padding:13px;border-radius:12px;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.3);color:#25d366;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">
      <i class="fa-brands fa-whatsapp" style="font-size:18px"></i> WA Business
    </button>
    <button onclick="document.getElementById('wa-picker-popup')?.remove()" style="width:100%;padding:8px;margin-top:8px;border-radius:10px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);font-size:12px;cursor:pointer">Batal</button>
  `;

  document.body.appendChild(popup);

  // Tutup kalau tap di luar
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 100);
}

function doShareWA(type) {
  document.getElementById('wa-picker-popup')?.remove();
  const listing = _allListings.find(l => l.ID === _shareWAListingId);
  if (!listing) return;
  const text    = _buildShareText(listing);
  const encoded = encodeURIComponent(text);

  if (type === 'wab') {
    // Android: intent URL paksa buka package WA Business (com.whatsapp.w4b)
    const isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid) {
      window.open(`intent://send?text=${encoded}#Intent;package=com.whatsapp.w4b;scheme=whatsapp;end`, '_blank');
    }
    // iOS: tidak didukung, skip
  } else {
    // WA biasa
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  }
}

// Legacy: dipanggil dari tempat lain kalau ada
function shareListingWA(listingId) {
  openShareWAPicker(listingId);
}

// PR 17: WA Business Catalog format
function shareListingWACatalog(listingId) {
  const listing = _allListings.find(l => l.ID === listingId);
  if (!listing) return;
  const harga = listing.Harga_Format || formatRupiah(listing.Harga);
  const catalogText =
    `${listing.Judul || 'Properti'}\n` +
    `Harga: ${harga}\n` +
    `Tipe: ${listing.Tipe_Properti || ''} | ${listing.Status_Transaksi || ''}\n` +
    `Lokasi: ${[listing.Kecamatan, listing.Kota].filter(Boolean).join(', ')}\n` +
    (listing.Sertifikat ? `Sertifikat: ${listing.Sertifikat}\n` : '') +
    `${listing.Deskripsi ? '\n' + listing.Deskripsi.replace(/#\w+/g,'').replace(/\s{2,}/g,' ').trim() : ''}\n` +
    `\nKode: ${listing.Kode_Listing || ''}\n` +
    `📸 Foto: ${listing.Foto_Utama_URL || ''}`;

  navigator.clipboard.writeText(catalogText)
    .then(() => showToast('✅ Format WA Catalog disalin! Paste di WA Business Catalog', 'success'))
    .catch(() => {
      // Fallback
      const el = document.createElement('textarea');
      el.value = catalogText;
      document.body.appendChild(el); el.select(); document.execCommand('copy');
      document.body.removeChild(el);
      showToast('✅ Format WA Catalog disalin!', 'success');
    });
}

// ─────────────────────────────────────────────────────────
// LEAD DETAIL (PR 4)
// ─────────────────────────────────────────────────────────
let _currentLeadId = null;

async function openLeadDetail(id) {
  _currentLeadId = id;
  const lead = (STATE.leads || []).find(l => l.ID === id);

  const body = document.getElementById('lead-detail-body');
  if (!lead) {
    body.innerHTML = '<p style="color:rgba(255,255,255,0.5);text-align:center;padding:20px">Memuat data…</p>';
    openModal('modal-lead-detail');
    try {
      const res = await API.get(`/leads/${id}`);
      renderLeadDetail(res.data || res);
    } catch (e) { body.innerHTML = `<p style="color:#f87171;text-align:center">${e.message}</p>`; }
    return;
  }
  renderLeadDetail(lead);
  openModal('modal-lead-detail');
}

function renderLeadDetail(lead) {
  const body = document.getElementById('lead-detail-body');
  if (!body) return;

  const scoreColor = { Hot:'#ef4444', Warm:'#F59E0B', Cold:'#3B82F6', Closing:'#22C55E', Out:'#6B7280' };
  const scoreEmoji = { Hot:'🔥', Warm:'☀️', Cold:'❄️', Closing:'🤝', Out:'🚫' };
  const sc = scoreColor[lead.Score] || '#6B7280';
  const harga = lead.Harga_Format || formatRupiah(lead.Harga);

  body.innerHTML = `
    <!-- Avatar + Name -->
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:56px;height:56px;border-radius:50%;background:${sc}20;border:2px solid ${sc}40;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:${sc};flex-shrink:0">
        ${escapeHtml((lead.Nama||'L').charAt(0).toUpperCase())}
      </div>
      <div>
        <h3 style="font-family:'DM Serif Display',serif;font-size:18px;color:#fff;margin-bottom:3px">${escapeHtml(lead.Nama||'—')}</h3>
        <span style="font-size:11px;padding:3px 8px;border-radius:6px;background:${sc}18;color:${sc};font-weight:600">${scoreEmoji[lead.Score]||''} ${lead.Score||'—'}</span>
      </div>
    </div>

    <!-- Contact -->
    <div style="display:flex;gap:10px">
      <button onclick="openWA('${escapeHtml(lead.No_WA||'')}');closeModal('modal-lead-detail')"
        style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:12px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);color:#4ade80;font-size:13px;font-weight:600;cursor:pointer">
        <i class="fa-brands fa-whatsapp" style="font-size:15px"></i>WhatsApp
      </button>
      <button onclick="openChangeStatus('${escapeHtml(lead.ID||'')}','${escapeHtml(lead.Nama||'')}')"
        style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:12px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.25);color:#D4A853;font-size:13px;font-weight:600;cursor:pointer">
        <i class="fa-solid fa-sliders" style="font-size:13px"></i>Ubah Status
      </button>
    </div>

    <!-- Detail Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${makeDetailField('Sumber', lead.Sumber)}
      ${makeDetailField('Status Lead', lead.Status_Lead)}
      ${lead.Tanggal_Dihubungi ? makeDetailField('Pertama Dihubungi', new Date(lead.Tanggal_Dihubungi).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})) : ''}
      ${lead.Score === 'Closing' ? `
        <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:10px;color:#4ade80;font-weight:700;margin-bottom:6px">🤝 INFO CLOSING</div>
          ${lead.Closing_Tipe ? `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px"><span style="color:rgba(255,255,255,0.4)">Tipe:</span> <b>${escapeHtml(lead.Closing_Tipe)}</b></div>` : ''}
          ${lead.Closing_Listing_Nama ? `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px"><span style="color:rgba(255,255,255,0.4)">Listing:</span> ${escapeHtml(lead.Closing_Listing_Nama)}</div>` : ''}
          ${lead.Closing_Cobroke ? `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px"><span style="color:rgba(255,255,255,0.4)">Cobroke:</span> ${escapeHtml(lead.Closing_Cobroke)}</div>` : ''}
          ${lead.Closing_Proyek ? `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px"><span style="color:rgba(255,255,255,0.4)">Proyek:</span> ${escapeHtml(lead.Closing_Proyek)}</div>` : ''}
        </div>` : ''}
      ${makeDetailField('Tipe Properti', lead.Tipe_Properti)}
      ${makeDetailField('Jenis', lead.Jenis)}
      ${makeDetailField('Budget Min', lead.Budget_Min ? formatRupiah(lead.Budget_Min) : '')}
      ${makeDetailField('Budget Max', lead.Budget_Max ? formatRupiah(lead.Budget_Max) : '')}
    </div>

    ${lead.Properti_Diminati ? `
    <div>
      <label class="form-label">Properti Diminati</label>
      <div style="background:#131F38;border-radius:10px;padding:10px 14px;font-size:13px;color:rgba(255,255,255,0.8)">${escapeHtml(lead.Properti_Diminati)}</div>
    </div>` : ''}

    ${lead.Catatan ? `
    <div>
      <label class="form-label">Catatan</label>
      <div style="background:#131F38;border-radius:10px;padding:10px 14px;font-size:12px;color:rgba(255,255,255,0.7);white-space:pre-wrap">${escapeHtml(lead.Catatan)}</div>
    </div>` : ''}

    <!-- Timeline -->
    <div>
      <label class="form-label">Timeline</label>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${lead.Created_At ? makeTimelineItem('Ditambahkan', lead.Created_At, '#4ade80') : ''}
        ${lead.Last_Activity_Date ? makeTimelineItem('Aktivitas terakhir', lead.Last_Activity_Date, '#D4A853') : ''}
        ${lead.Next_Follow_Up ? makeTimelineItem('Follow up berikutnya', lead.Next_Follow_Up, '#60a5fa') : ''}
      </div>
    </div>
  `;
}

function makeDetailField(label, value) {
  if (!value) return '';
  return `<div style="background:#131F38;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px">${label}</div><div style="font-size:12px;color:#fff;font-weight:500">${escapeHtml(String(value))}</div></div>`;
}

function makeTimelineItem(label, date, color) {
  return `<div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div><div style="flex:1"><span style="font-size:11px;color:rgba(255,255,255,0.6)">${label}: </span><span style="font-size:11px;color:#fff">${formatRelativeDate(date)}</span></div></div>`;
}

// PR 8: Open change status modal
function openChangeStatus(leadId, leadName) {
  _currentLeadId = leadId;
  const el = document.getElementById('cls-lead-name');
  if (el) el.textContent = leadName || '';
  // Reset semua sub-panels
  document.getElementById('ool-wrap').style.display = 'none';
  document.getElementById('ool-reason').value = '';
  document.getElementById('closing-wrap').style.display = 'none';
  document.getElementById('cls-secondary-wrap').style.display = 'none';
  document.getElementById('cls-primary-wrap').style.display = 'none';
  document.getElementById('cls-own-wrap').style.display = 'none';
  document.getElementById('cls-cobroke-wrap').style.display = 'none';
  closeModal('modal-lead-detail');
  openModal('modal-change-status');
}

function showOutOfList() {
  document.getElementById('ool-wrap').style.display = 'block';
  document.getElementById('closing-wrap').style.display = 'none';
}

// ── Closing panel functions ───────────────────────────────
function showClosingPanel() {
  document.getElementById('ool-wrap').style.display = 'none';
  document.getElementById('closing-wrap').style.display = 'block';
  // Reset tipe selection
  document.getElementById('cls-secondary-wrap').style.display = 'none';
  document.getElementById('cls-primary-wrap').style.display = 'none';
  ['cls-btn-secondary','cls-btn-primary'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.style.outline = 'none'; b.style.boxShadow = 'none'; }
  });
}

function selectClosingTipe(tipe) {
  // Highlight tombol
  document.getElementById('cls-btn-secondary').style.outline = tipe === 'Secondary' ? '2px solid #a855f7' : 'none';
  document.getElementById('cls-btn-primary').style.outline   = tipe === 'Primary'   ? '2px solid #22d3ee' : 'none';
  document.getElementById('cls-secondary-wrap').style.display = tipe === 'Secondary' ? 'block' : 'none';
  document.getElementById('cls-primary-wrap').style.display   = tipe === 'Primary'   ? 'block' : 'none';

  if (tipe === 'Secondary') {
    // Reset source selection
    document.getElementById('cls-own-wrap').style.display = 'none';
    document.getElementById('cls-cobroke-wrap').style.display = 'none';
    ['cls-btn-own','cls-btn-cobroke'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.style.outline = 'none';
    });
  }
}

function selectSecondarySource(source) {
  document.getElementById('cls-btn-own').style.outline     = source === 'own'     ? '2px solid #D4A853' : 'none';
  document.getElementById('cls-btn-cobroke').style.outline = source === 'cobroke' ? '2px solid #fb923c' : 'none';
  document.getElementById('cls-own-wrap').style.display     = source === 'own'     ? 'block' : 'none';
  document.getElementById('cls-cobroke-wrap').style.display = source === 'cobroke' ? 'block' : 'none';

  if (source === 'own') {
    // Load listing milik agen sendiri
    _loadOwnListingsForClosing();
  } else {
    // Load semua listing untuk cobroke picker
    _loadAllListingsForCobroke();
  }
}

async function _loadOwnListingsForClosing() {
  const sel = document.getElementById('cls-own-listing');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Memuat... —</option>';
  try {
    const res = await API.get(`/listings?agen_id=${STATE.user.id}`);
    const listings = res.data || [];
    if (!listings.length) {
      sel.innerHTML = '<option value="">— Belum ada listing —</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Pilih listing kamu —</option>' +
      listings.map(l => `<option value="${escapeHtml(l.ID)}" data-nama="${escapeHtml(l.Judul||'')} (${l.Kode_Listing||''})">${escapeHtml(l.Kode_Listing||'')} — ${escapeHtml(l.Judul||'')} | ${l.Kota||''}</option>`).join('');
  } catch { sel.innerHTML = '<option value="">— Gagal load —</option>'; }
}

async function _loadAllListingsForCobroke() {
  const sel = document.getElementById('cls-cobroke-listing');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Memuat... —</option>';
  try {
    const res = await API.get('/listings?all=1');
    const listings = res.data || [];
    sel.innerHTML = '<option value="">— Pilih dari listing CRM (opsional) —</option>' +
      listings.map(l => `<option value="${escapeHtml(l.ID)}" data-nama="${escapeHtml(l.Judul||'')} (${l.Kode_Listing||''})">${escapeHtml(l.Kode_Listing||'')} — ${escapeHtml(l.Judul||'')} | ${l.Agen_Nama||''}</option>`).join('');
  } catch { sel.innerHTML = '<option value="">— Gagal load —</option>'; }
}

async function doClosingSubmit() {
  if (!_currentLeadId) return;

  // Validasi tipe
  const secBtn = document.getElementById('cls-btn-secondary');
  const priBtn = document.getElementById('cls-btn-primary');
  const isSecondary = secBtn?.style.outline?.includes('solid');
  const isPrimary   = priBtn?.style.outline?.includes('solid');
  if (!isSecondary && !isPrimary) {
    showToast('Pilih tipe transaksi dulu (Secondary / Primary)', 'error'); return;
  }

  const payload = { Score: 'Closing', Closing_Tipe: isSecondary ? 'Secondary' : 'Primary' };

  if (isSecondary) {
    const ownBtn    = document.getElementById('cls-btn-own');
    const isOwn     = ownBtn?.style.outline?.includes('solid');
    const isCobroke = !isOwn;

    if (isOwn) {
      const sel = document.getElementById('cls-own-listing');
      const opt = sel?.options[sel.selectedIndex];
      if (!sel?.value) { showToast('Pilih listing kamu', 'error'); return; }
      payload.Closing_Listing_ID   = sel.value;
      payload.Closing_Listing_Nama = opt?.dataset?.nama || opt?.text || '';
    } else {
      const detail = document.getElementById('cls-cobroke-detail')?.value?.trim();
      const coSel  = document.getElementById('cls-cobroke-listing');
      const coOpt  = coSel?.options[coSel?.selectedIndex];
      if (!detail && !coSel?.value) { showToast('Isi detail cobroke atau pilih listing', 'error'); return; }
      payload.Closing_Cobroke       = detail || (coOpt?.text || '');
      payload.Closing_Listing_ID    = coSel?.value || '';
      payload.Closing_Listing_Nama  = coOpt?.dataset?.nama || '';
    }
  } else {
    const proyek = document.getElementById('cls-primary-proyek')?.value?.trim();
    if (!proyek) { showToast('Isi nama proyek / developer', 'error'); return; }
    payload.Closing_Proyek = proyek;
  }

  try {
    await API.put(`/leads/${_currentLeadId}`, payload);
    showToast('🤝 Closing! Lead berhasil di-mark sebagai deal', 'success');
    closeModal('modal-change-status');
    await loadLeads();
    if (STATE.currentPage === 'dashboard') await loadDashboard();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

async function doChangeStatus(newScore) {
  if (!_currentLeadId) return;
  const ool = newScore === 'Out' ? document.getElementById('ool-reason')?.value?.trim() : null;
  if (newScore === 'Out' && !ool) { showToast('Isi keterangan out of list', 'error'); return; }
  try {
    await API.put(`/leads/${_currentLeadId}`, { Score: newScore, Catatan_Out: ool || undefined });
    showToast(`✅ Status lead diubah ke ${newScore}`, 'success');
    closeModal('modal-change-status');
    await loadLeads();
    if (STATE.currentPage === 'dashboard') await loadDashboard();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

// ─────────────────────────────────────────────────────────
// KOMISI FORM — Native
// ─────────────────────────────────────────────────────────
const KOMISI_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSde2vDLLWK2sw8j872-iponBxnfzNwU5Z_0IvlDuk2AyqQPiQ/viewform?embedded=true';

function openKomisiForm() {
  const iframe = document.getElementById('komisi-iframe');
  if (iframe) {
    // Set setiap kali buka supaya tidak blank
    iframe.src = 'about:blank';
    setTimeout(() => { iframe.src = KOMISI_FORM_URL; }, 50);
  }
  openModal('modal-komisi');
}

// ─────────────────────────────────────────────────────────
// DONE TASK (PR 13)
// ─────────────────────────────────────────────────────────
let _doneTaskId = null;

async function markTaskDone(taskId, taskJudul) {
  _doneTaskId = taskId;
  try {
    await API.put(`/tasks/${taskId}`, { Status: 'Done' });
    const msg = document.getElementById('done-task-msg');
    if (msg) msg.textContent = `"${taskJudul || 'Jadwal'}" selesai! Lanjutkan mengisi hasil ke Tambah Lead?`;
    openModal('modal-done-task');
    await loadTasks();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

function doneTaskYes() {
  closeModal('modal-done-task');
  closeModal('modal-task-detail');
  navigateTo('leads');
  setTimeout(() => openModal('modal-add-lead'), 300);
}

function doneTaskNo() {
  closeModal('modal-done-task');
  navigateTo('dashboard');
}

// ─────────────────────────────────────────────────────────
// LOAD DASHBOARD (override)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// ADMIN DASHBOARD
// ─────────────────────────────────────────────────────────
async function loadAdminDashboard() {
  const page = document.getElementById('page-dashboard');
  if (!page) return;

  try {
    const thisMonth = new Date().toISOString().substring(0, 7);
    const [statsRes, komisiRes, laporanRes, laporanTodayRes] = await Promise.allSettled([
      API.get('/dashboard/stats'),
      API.get('/komisi/stats'),
      API.get('/laporan/summary'),
      API.get('/laporan/today'),
    ]);

    const stats   = statsRes.status   === 'fulfilled' ? statsRes.value?.data   || {} : {};
    const komisi  = komisiRes.status  === 'fulfilled' ? komisiRes.value?.data  || {} : {};
    const laporan = laporanRes.status === 'fulfilled' ? laporanRes.value?.data || [] : [];
    const todayReport = laporanTodayRes.status === 'fulfilled' ? laporanTodayRes.value?.data : null;

    if (stats.unreadNotif > 0) updateNotifBadge(stats.unreadNotif);

    // Hitung listing baru bulan ini — pakai allSettled supaya tidak crash halaman
    let allListings = [];
    try {
      const listingsRes = await API.get('/listings?all=1');
      allListings = listingsRes.data || [];
    } catch (_) { /* lanjut dengan data kosong */ }
    const listingBulanIni = allListings.filter(l => l.Created_At?.startsWith(thisMonth));

    // Top 3 agen listing terbanyak bulan ini
    const agenMap = {};
    listingBulanIni.forEach(l => {
      if (!l.Agen_ID) return;
      if (!agenMap[l.Agen_ID]) agenMap[l.Agen_ID] = { nama: l.Agen_Nama || l.Agen_ID, count: 0 };
      agenMap[l.Agen_ID].count++;
    });
    const top3 = Object.values(agenMap).sort((a, b) => b.count - a.count).slice(0, 3);

    const medals = ['🥇','🥈','🥉'];

    page.innerHTML = `
      <div style="padding:16px;padding-bottom:80px">

        <!-- Header -->
        <div style="margin-bottom:20px">
          <div style="font-size:11px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px">Panel Admin</div>
          <div style="font-size:22px;font-weight:700;color:#fff;font-family:'DM Serif Display',serif;margin-top:2px">Selamat Datang, ${escapeHtml(STATE.user?.nama?.split(' ')[0] || 'Admin')} 👋</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:2px">${new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
        </div>

        <!-- Stats Cards Row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          <div style="background:linear-gradient(135deg,#1C2D52,#141E35);border:1px solid rgba(43,123,255,0.2);border-radius:14px;padding:14px">
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:6px">LISTING AKTIF</div>
            <div style="font-size:28px;font-weight:800;color:#2B7BFF">${stats.activeListings ?? 0}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:3px">+${listingBulanIni.length} bulan ini</div>
          </div>
          <div style="background:linear-gradient(135deg,#1C2D52,#141E35);border:1px solid rgba(212,168,83,0.2);border-radius:14px;padding:14px">
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:6px">REQ. KOMISI</div>
            <div style="font-size:28px;font-weight:800;color:#D4A853">${komisi.pending ?? 0}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:3px">pending review</div>
          </div>
        </div>

        <!-- Top 3 Agen Listing Terbanyak -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:16px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:12px">🏆 Top Agen Listing — Bulan Ini</div>
          ${top3.length === 0
            ? '<div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:12px">Belum ada listing bulan ini</div>'
            : top3.map((a, i) => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i < top3.length-1?'border-bottom:1px solid rgba(255,255,255,0.05)':''}">
                <span style="font-size:20px;width:28px;text-align:center">${medals[i]}</span>
                <span style="flex:1;font-size:13px;font-weight:600;color:#fff">${escapeHtml(a.nama)}</span>
                <span style="font-size:13px;font-weight:700;color:#D4A853">${a.count} listing</span>
              </div>
            `).join('')
          }
        </div>

        <!-- Request Komisi Pending -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:16px;margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;color:#fff">💰 Request Komisi Pending</div>
            ${komisi.pending > 0 ? `<span style="background:#D4A853;color:#0D1526;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">${komisi.pending}</span>` : ''}
          </div>
          ${(komisi.list || []).length === 0
            ? '<div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:8px">Tidak ada request pending</div>'
            : (komisi.list || []).map(k => `
              <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                <div style="width:36px;height:36px;border-radius:10px;background:rgba(212,168,83,0.12);display:flex;align-items:center;justify-content:center;font-weight:700;color:#D4A853;font-size:14px;flex-shrink:0">
                  ${escapeHtml((k.agen||'?').charAt(0).toUpperCase())}
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:600;color:#fff">${escapeHtml(k.agen)}</div>
                  <div style="font-size:10px;color:rgba(255,255,255,0.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(k.listing||'-')}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:11px;font-weight:700;color:#D4A853">${k.nominal ? 'Rp '+parseInt(k.nominal).toLocaleString('id-ID') : '-'}</div>
                  <div style="display:flex;gap:4px;margin-top:4px">
                    <button onclick="updateKomisiStatus('${k.id}','Disetujui')" style="background:rgba(34,197,94,0.15);color:#22C55E;border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer">✓</button>
                    <button onclick="updateKomisiStatus('${k.id}','Selesai')" style="background:rgba(96,165,250,0.15);color:#60a5fa;border:1px solid rgba(96,165,250,0.3);border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer">✔✔</button>
                    <button onclick="updateKomisiStatus('${k.id}','Ditolak')" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer">✗</button>
                  </div>
                </div>
              </div>
            `).join('')
          }
        </div>

        <!-- Laporan Harian Textbox -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:16px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:4px">📋 Laporan Harian</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:12px">${todayReport ? '✅ Sudah diisi hari ini · ' + new Date(todayReport.Updated_At||todayReport.Created_At).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : 'Belum ada laporan hari ini'}</div>
          <textarea id="admin-laporan-text" rows="5" placeholder="Ketik laporan harian kamu di sini...&#10;- Jumlah prospek baru yang dikonfirmasi&#10;- Progress listing&#10;- Kendala & rencana besok"
            style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:10px;padding:12px;font-size:13px;resize:vertical;box-sizing:border-box;line-height:1.6"
          >${escapeHtml(todayReport?.Isi_Laporan || '')}</textarea>
          <button onclick="saveLaporanHarian()" id="laporan-save-btn"
            style="width:100%;margin-top:10px;background:#D4A853;color:#0D1526;border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:700;cursor:pointer">
            💾 Simpan Laporan
          </button>
        </div>

        <!-- Shortcut Buttons -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button onclick="openUserMgmt()" style="background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.2);border-radius:12px;padding:14px;cursor:pointer;text-align:center">
            <i class="fa-solid fa-users-cog" style="color:#60a5fa;font-size:18px;display:block;margin-bottom:6px"></i>
            <span style="font-size:11px;color:#60a5fa;font-weight:600">Manajemen User</span>
          </button>
          <button onclick="openSettingsProfile()" style="background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:12px;padding:14px;cursor:pointer;text-align:center">
            <i class="fa-solid fa-user-gear" style="color:#a855f7;font-size:18px;display:block;margin-bottom:6px"></i>
            <span style="font-size:11px;color:#a855f7;font-weight:600">Pengaturan Profil</span>
          </button>
        </div>

      </div>
    `;
  } catch(e) {
    console.warn('Admin dashboard error:', e.message);
  }
}

async function saveLaporanHarian() {
  const isi = document.getElementById('admin-laporan-text')?.value?.trim();
  if (!isi) { showToast('Laporan tidak boleh kosong', 'error'); return; }
  const btn = document.getElementById('laporan-save-btn');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  try {
    await API.post('/laporan', { Isi_Laporan: isi });
    showToast('✅ Laporan tersimpan!', 'success');
    await loadAdminDashboard(); // refresh
  } catch(e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Simpan Laporan';
  }
}

async function updateKomisiStatus(id, status) {
  try {
    await API.patch('/komisi/' + id + '/status', { status });
    const toastMsg = status === 'Disetujui' ? '✅ Komisi disetujui' : status === 'Selesai' ? '✔️ Komisi selesai' : '❌ Komisi ditolak';
    showToast(toastMsg, 'success');
    await loadAdminDashboard();
  } catch(e) { showToast('Gagal: ' + e.message, 'error'); }
}

function openSettingsProfile() {
  const el = document.getElementById('profile-settings');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
  else navigateTo('profile');
}

async function loadDashboard() {
  // Admin punya tampilan dashboard khusus
  if (STATE.user?.role === 'admin') {
    return loadAdminDashboard();
  }
  try {
    const [dashRes, funnelRes, upcomingRes] = await Promise.allSettled([
      API.get('/dashboard/stats'),
      API.get('/tasks/conversion-stats'),
      API.get('/tasks/upcoming?limit=5'),
    ]);

    if (dashRes.status === 'fulfilled') {
      const s = dashRes.value?.data || {};
      setEl('stat-listings',   s.activeListings  ?? s.totalListings ?? 0);
      setEl('stat-leads',      s.totalLeads       ?? 0);
      setEl('stat-hot',        s.hotLeads         ?? 0);
      setEl('nav-listing-count', s.totalListings  ?? 0);
      // Tampilkan Metode 2 (qualified) sebagai utama, Metode 1 sebagai sub-info
      const qcr = s.qualified_conversion ?? 0;
      const ocr = s.overall_conversion   ?? 0;
      setEl('stat-conversion', qcr + '%');
      // Sub-label konversi — tunjukkan basis perhitungan
      const convSub = document.getElementById('stat-conversion-sub');
      if (convSub) {
        convSub.textContent = s.selesai_leads > 0
          ? `${s.selesai_leads} leads selesai · raw ${ocr}%`
          : 'Belum ada leads selesai';
      }
      // Render funnel dari dashboard stats (sudah terfilter by role)
      if (s.funnel?.length && s.totalLeads > 0) renderFunnel(s.funnel);
      else if (s.totalLeads === 0) {
        const fc = document.getElementById('funnel-container');
        if (fc) fc.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:20px">Belum ada leads — pipeline akan muncul setelah leads masuk</p>';
      }
      // Hot leads sudah ada di dashboard stats
      if (s.hotLeadsList?.length) renderHotLeads(s.hotLeadsList);
      else { const el = document.getElementById('hot-leads-list'); if (el) el.innerHTML = emptyState('Tidak ada hot leads saat ini'); }
      // Buyer requests badge
      if (s.buyerRequests > 0) {
        const badge = document.getElementById('buyer-req-badge');
        if (badge) { badge.textContent = s.buyerRequests; badge.style.display = 'inline-block'; }
      }
      // Notif badge
      if (s.unreadNotif > 0) updateNotifBadge(s.unreadNotif);
    }

    if (funnelRes.status === 'fulfilled') {
      const fd = funnelRes.value?.data || {};
      // Fallback jika dashboard stats tidak punya funnel
      if (!dashRes.value?.data?.funnel?.length) {
        setEl('stat-conversion', (fd.overallConversionRate ?? 0) + '%');
        renderFunnel(fd.funnel || []);
      }
    } else {
      const fc = document.getElementById('funnel-container');
      if (fc && !dashRes.value?.data?.funnel?.length) fc.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:12px">Data funnel belum tersedia</p>';
    }

    if (upcomingRes.status === 'fulfilled') renderUpcomingTasks(upcomingRes.value?.data || []);
    else { const el = document.getElementById('upcoming-tasks-list'); if (el) el.innerHTML = emptyState('Belum ada jadwal 48 jam ke depan'); }

    // Run checks (PR 8, 12)
    checkStaleLeads();
    checkUpcomingSchedules();

    // Laporan harian admin — tampil untuk Principal & Superadmin
    if (['principal','superadmin'].includes(STATE.user?.role)) {
      loadLaporanSummary();
    }

  } catch (e) {
    console.error('[CRM] Dashboard load error:', e.message, e.stack);
    // Jangan biarkan halaman kosong — tampilkan pesan error minimal
    const page = document.getElementById('page-dashboard');
    if (page && !page.innerHTML.trim()) {
      page.innerHTML = `<div style="padding:32px 16px;text-align:center">
        <div style="font-size:32px;margin-bottom:12px">⚠️</div>
        <div style="color:#fff;font-size:15px;font-weight:600;margin-bottom:8px">Dashboard gagal dimuat</div>
        <div style="color:rgba(255,255,255,0.45);font-size:12px;margin-bottom:20px">${e.message}</div>
        <button onclick="loadAdminDashboard()" style="background:#D4A853;color:#0D1526;border:none;border-radius:12px;padding:10px 24px;font-weight:700;font-size:13px;cursor:pointer">🔄 Coba Lagi</button>
      </div>`;
    }
  }
}

async function loadLaporanSummary() {
  const container = document.getElementById('laporan-summary-container');
  if (!container) return;
  try {
    const res = await API.get('/laporan/summary');
    const laporan = res.data || [];
    if (!laporan.length) {
      container.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:8px">Belum ada laporan dari admin</div>';
      return;
    }
    container.innerHTML = laporan.slice(0, 5).map(l => `
      <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:11px;font-weight:600;color:#D4A853">${escapeHtml(l.Admin_Nama||'Admin')}</span>
          <span style="font-size:10px;color:rgba(255,255,255,0.3)">${new Date(l.Tanggal).toLocaleDateString('id-ID',{day:'numeric',month:'short'})}</span>
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5;white-space:pre-line;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(l.Isi_Laporan||'')}</div>
      </div>
    `).join('');
  } catch(_) {}
}

// ─────────────────────────────────────────────────────────
// RENDER FUNNEL
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// LISTING STATUS PICKER
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// TAMBAH FOTO KE LISTING TANPA FOTO
// ─────────────────────────────────────────────────────────
let _aplSelectedId   = null;
let _aplSelectedJudul = '';

async function openAddPhotoModal() {
  _aplSelectedId = null;
  document.getElementById('apl-step1').style.display = 'block';
  document.getElementById('apl-step2').style.display = 'none';
  // Reset foto inputs
  ['apl-foto1','apl-foto2','apl-foto3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['apl-prev1','apl-prev2','apl-prev3'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const labels = ['Foto Utama','Foto 2','Foto 3'];
    const icons  = ['fa-image','fa-plus','fa-plus'];
    el.innerHTML = `<i class="fa-solid ${icons[i]}" style="color:rgba(${i===0?'212,168,83,0.4':'255,255,255,0.2'});font-size:${i===0?20:16}px;margin-bottom:4px"></i><span style="font-size:10px;color:rgba(255,255,255,0.3)">${labels[i]}</span>`;
  });

  openModal('modal-add-photo-listing');
  await aplLoadListings();
}

async function aplLoadListings() {
  const listEl = document.getElementById('apl-listing-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:12px">Memuat...</div>';
  try {
    // Ambil semua listing milik agen, filter yang tidak ada foto
    const res = await API.get('/listings');
    const noPhoto = (res.data || []).filter(l => !l.Foto_Utama_URL && l.Status_Listing === 'Aktif');

    if (!noPhoto.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">✅</div><div style="font-size:13px;color:rgba(255,255,255,0.5)">Semua listing sudah punya foto!</div></div>';
      return;
    }

    listEl.innerHTML = noPhoto.map(l => `
      <div onclick="aplSelectListing('${escapeHtml(l.ID)}','${escapeHtml(l.Judul||'')}')"
        style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;margin-bottom:8px;cursor:pointer"
        onmouseenter="this.style.borderColor='rgba(212,168,83,0.3)';this.style.background='rgba(212,168,83,0.05)'"
        onmouseleave="this.style.borderColor='rgba(255,255,255,0.07)';this.style.background='rgba(255,255,255,0.03)'">
        <div style="width:42px;height:42px;border-radius:10px;background:#1C2D52;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fa-solid fa-image-slash" style="color:rgba(255,255,255,0.2);font-size:16px"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.Judul||'—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px">${escapeHtml(l.Kode_Listing||'')} · ${escapeHtml(l.Kota||'')}</div>
          <div style="font-size:11px;color:#D4A853;margin-top:1px">${l.Harga_Format || formatRupiah(l.Harga)}</div>
        </div>
        <i class="fa-solid fa-chevron-right" style="color:rgba(255,255,255,0.2);font-size:12px;flex-shrink:0"></i>
      </div>
    `).join('');
  } catch(e) {
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px">Gagal memuat: ${e.message}</div>`;
  }
}

function aplSelectListing(id, judul) {
  _aplSelectedId    = id;
  _aplSelectedJudul = judul;
  document.getElementById('apl-step1').style.display = 'none';
  document.getElementById('apl-step2').style.display = 'block';
  document.getElementById('apl-selected-info').innerHTML =
    `<i class="fa-solid fa-house" style="margin-right:6px"></i>${escapeHtml(judul)}`;
}

function aplBack() {
  _aplSelectedId = null;
  document.getElementById('apl-step1').style.display = 'block';
  document.getElementById('apl-step2').style.display = 'none';
}

function aplPreview(input, previewId) {
  const prev = document.getElementById(previewId);
  if (!prev || !input.files?.[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  };
  reader.readAsDataURL(input.files[0]);
}

async function aplSave() {
  if (!_aplSelectedId) { showToast('Pilih listing dulu', 'error'); return; }
  const foto1 = document.getElementById('apl-foto1')?.files[0];
  if (!foto1) { showToast('Foto utama wajib diupload', 'error'); return; }

  const btn = document.getElementById('apl-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Mengupload...';

  try {
    const urls = {};
    const slots = [
      { file: foto1,                                              key: 'Foto_Utama_URL' },
      { file: document.getElementById('apl-foto2')?.files[0],    key: 'Foto_2_URL' },
      { file: document.getElementById('apl-foto3')?.files[0],    key: 'Foto_3_URL' },
    ];

    for (const { file, key } of slots) {
      if (!file) continue;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Upload ${key.replace('_URL','').replace('Foto_','Foto ')}...`;
      const compressed = await compressImage(file, 1280, 0.80);
      urls[key] = await uploadToCloudinary(compressed);
    }

    await API.patch('/listings/' + _aplSelectedId, urls);
    showToast('✅ Foto berhasil ditambahkan!', 'success');
    closeModal('modal-add-photo-listing');
    if (STATE.currentPage === 'listings') await loadListings();
  } catch(e) {
    showToast('Gagal upload: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-upload-alt" style="margin-right:6px"></i>Simpan Foto';
  }
}

function openStatusPicker(listingId, currentStatus) {
  // Remove existing picker
  document.getElementById('status-picker-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'status-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,0.6)';
  overlay.onclick = () => overlay.remove();

  const statuses = [
    { value: 'Aktif',   label: '● Aktif',   color: '#22C55E', desc: 'Listing aktif ditawarkan' },
    { value: 'Terjual', label: '✓ Terjual', color: '#6B7280', desc: 'Properti sudah terjual' },
    { value: 'Tersewa', label: '✓ Tersewa', color: '#3B82F6', desc: 'Properti sudah tersewa' },
  ];

  overlay.innerHTML = `
    <div onclick="event.stopPropagation()" style="position:fixed;bottom:0;left:0;right:0;background:#141E35;border-radius:20px 20px 0 0;padding:20px;z-index:61">
      <div style="width:40px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin:0 auto 20px"></div>
      <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px">Ubah Status Listing</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:16px">Status saat ini: <span style="color:#D4A853">${currentStatus}</span></div>
      ${statuses.map(s => `
        <button onclick="confirmStatusChange('${listingId}','${s.value}')" 
          style="width:100%;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;border:1.5px solid ${s.value===currentStatus?s.color:'rgba(255,255,255,0.08)'};background:${s.value===currentStatus?s.color+'18':'transparent'};cursor:pointer;margin-bottom:8px;text-align:left">
          <span style="font-size:16px;width:20px">${s.value==='Aktif'?'🟢':s.value==='Terjual'?'🏷️':'🔑'}</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:${s.color}">${s.label}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${s.desc}</div>
          </div>
          ${s.value===currentStatus?'<i class="fa-solid fa-check" style="color:'+s.color+'"></i>':''}
        </button>
      `).join('')}
      <button onclick="document.getElementById('status-picker-overlay').remove()" 
        style="width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.5);font-size:13px;cursor:pointer;margin-top:4px">
        Batal
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
}

async function confirmStatusChange(listingId, newStatus) {
  document.getElementById('status-picker-overlay')?.remove();
  const isInactive = ['Terjual','Tersewa'].includes(newStatus);
  
  try {
    await API.patch('/listings/' + listingId, {
      Status_Listing: newStatus,
      Tampilkan_di_Web: isInactive ? 'FALSE' : undefined,
    });
    showToast(
      newStatus === 'Aktif' ? '✅ Listing diaktifkan kembali' :
      newStatus === 'Terjual' ? '🏷️ Listing ditandai Terjual' :
      '🔑 Listing ditandai Tersewa',
      'success'
    );
    await loadListings();
  } catch(e) {
    showToast('Gagal update status: ' + e.message, 'error');
  }
}

function renderFunnel(funnel) {
  const container = document.getElementById('funnel-container');
  if (!container) return;
  if (!funnel.length) { container.innerHTML = emptyState('Belum ada data pipeline'); return; }

  const stageColors = {
    'Leads In':'#2B7BFF', 'Dihubungi':'#A855F7', 'Visit':'#F97316',
    'Negosiasi':'#EAB308', 'Deal ✅':'#22C55E'
  };

  container.innerHTML = funnel.map((s, i) => {
    const color = s.color || stageColors[s.label] || '#6B7280';
    const barW = Math.max(s.cr || s.rate || 0, 4);
    return `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
            <span style="font-size:11px;color:rgba(255,255,255,${i===0?0.8:0.55})">${escapeHtml(s.label||s.stage||'—')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;font-weight:600;color:${color}">${s.count}</span>
            <span style="font-size:10px;color:rgba(255,255,255,0.25)">${s.cr||s.rate||0}%</span>
          </div>
        </div>
        <div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden">
          <div class="funnel-bar" style="height:100%;width:${barW}%;border-radius:3px;background:${color};opacity:0.8"></div>
        </div>
        ${i < funnel.length-1 && funnel[i+1] ? `<div style="font-size:10px;color:rgba(255,255,255,0.2);text-align:right;margin-top:2px">→ ${s.count>0?Math.round((funnel[i+1].count/s.count)*100):0}% lanjut</div>` : ''}
      </div>
    `;
  }).join('');

  setTimeout(() => {
    container.querySelectorAll('.funnel-bar').forEach(bar => {
      const target = bar.style.width; bar.style.width='0';
      requestAnimationFrame(() => { bar.style.width = target; });
    });
  }, 50);
}

// ─────────────────────────────────────────────────────────
// RENDER HOT LEADS
// ─────────────────────────────────────────────────────────
function renderHotLeads(leads) {
  const el = document.getElementById('hot-leads-list');
  if (!el) return;
  if (!leads.length) { el.innerHTML = emptyState('Tidak ada hot leads saat ini 🎉'); return; }

  el.innerHTML = leads.map(l => {
    const nextFU = l.Next_Follow_Up ? formatRelativeDate(l.Next_Follow_Up) : null;
    const isOverdue = l.Next_Follow_Up && new Date(l.Next_Follow_Up) < new Date();
    return `
      <div onclick="openLeadDetail('${escapeHtml(l.ID)}')"
        style="display:flex;align-items:center;gap:12px;background:#131F38;border:1px solid rgba(239,68,68,0.15);border-radius:14px;padding:14px 16px;cursor:pointer;transition:border-color 0.2s"
        onmouseenter="this.style.borderColor='rgba(239,68,68,0.35)'" onmouseleave="this.style.borderColor='rgba(239,68,68,0.15)'">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(239,68,68,0.12);display:flex;align-items:center;justify-content:center;font-weight:700;color:#ef4444;font-size:15px;flex-shrink:0">
          ${escapeHtml((l.Nama||'L').charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="font-size:13px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.Nama||'—')}</span>
            <span style="flex-shrink:0;font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.15);color:#ef4444">🔥 Hot</span>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.Properti_Diminati||l.Minat_Tipe||'—')}</div>
          ${nextFU ? `<div style="font-size:10px;margin-top:3px;color:${isOverdue?'#ef4444':'rgba(255,255,255,0.3)'}">${isOverdue?'⚠️':'🕐'} ${nextFU}</div>` : ''}
        </div>
        <button onclick="event.stopPropagation();openWA('${escapeHtml(l.No_WA||'')}')"
          style="width:36px;height:36px;border-radius:10px;background:rgba(34,197,94,0.12);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fa-brands fa-whatsapp" style="color:#22C55E;font-size:16px"></i>
        </button>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// RENDER UPCOMING TASKS
// ─────────────────────────────────────────────────────────
function renderUpcomingTasks(tasks) {
  const el = document.getElementById('upcoming-tasks-list');
  if (!el) return;
  if (!tasks.length) { el.innerHTML = emptyState('Tidak ada jadwal dalam 48 jam ke depan'); return; }

  const tipeIcon = { Visit:'🏠', Meeting:'🤝', Follow_Up:'📞', Call:'📱', Admin:'📄' };

  el.innerHTML = tasks.map(t => {
    const d = t.Scheduled_At ? new Date(t.Scheduled_At) : null;
    const timeStr = d ? d.toLocaleString('id-ID', {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
    const prioritasColor = { Tinggi:'#ef4444', Sedang:'#F59E0B', Rendah:'#22C55E' }[t.Prioritas] || '#6B7280';

    return `
      <div onclick="openTaskDetail('${escapeHtml(t.ID)}')"
        style="display:flex;align-items:center;gap:12px;background:#131F38;border:1px solid rgba(255,255,255,0.05);border-radius:14px;padding:12px 16px;cursor:pointer;transition:border-color 0.2s"
        onmouseenter="this.style.borderColor='rgba(212,168,83,0.25)'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.05)'">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(212,168,83,0.1);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
          ${tipeIcon[t.Tipe]||'📋'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.Judul||t.Tipe)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:1px">${timeStr} · ${escapeHtml(t.Lead_Nama||'Tanpa lead')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <div style="width:6px;height:6px;border-radius:50%;background:${prioritasColor}"></div>
          <button onclick="event.stopPropagation();markTaskDone('${escapeHtml(t.ID)}','${escapeHtml(t.Judul||t.Tipe)}')"
            style="font-size:10px;padding:4px 8px;border-radius:6px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);color:#4ade80;cursor:pointer;font-weight:600">Done</button>
        </div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// TASKS PAGE
// ─────────────────────────────────────────────────────────
let _currentTaskTab = 'today';

async function loadTasks() { setTaskTab(_currentTaskTab); }

async function setTaskTab(tab) {
  _currentTaskTab = tab;
  document.querySelectorAll('[data-tab]').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.style.background = isActive ? 'rgba(212,168,83,0.2)' : 'transparent';
    b.style.color = isActive ? '#D4A853' : 'rgba(255,255,255,0.4)';
  });

  const list = document.getElementById('tasks-list');
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:76px;border-radius:14px"></div>'.repeat(2);

  try {
    const ep = { today:'/tasks/today', upcoming:'/tasks/upcoming', all:'/tasks' }[tab] || '/tasks';
    const res = await API.get(ep);
    renderTasksList(res.data || []);
  } catch (e) {
    list.innerHTML = emptyState('Gagal memuat jadwal');
  }
}

function renderTasksList(tasks) {
  const el = document.getElementById('tasks-list');
  if (!el) return;
  if (!tasks.length) { el.innerHTML = emptyState('Tidak ada jadwal'); return; }

  const tipeIcon = { Visit:'🏠', Meeting:'🤝', Follow_Up:'📞', Call:'📱', Admin:'📄' };
  const statusColor = { Pending:'#F59E0B', Confirmed:'#2B7BFF', Done:'#22C55E', Cancelled:'#6B7280', Reschedule:'#F97316' };

  el.innerHTML = tasks.map(t => {
    const d = t.Scheduled_At ? new Date(t.Scheduled_At) : null;
    const timeStr = d ? d.toLocaleString('id-ID', {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
    const sc = statusColor[t.Status] || '#6B7280';

    return `
      <div onclick="openTaskDetail('${escapeHtml(t.ID)}')"
        style="display:flex;align-items:center;gap:12px;background:#131F38;border:1px solid rgba(255,255,255,0.05);border-radius:14px;padding:12px 16px;cursor:pointer;transition:border-color 0.2s"
        onmouseenter="this.style.borderColor='rgba(212,168,83,0.2)'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.05)'">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(212,168,83,0.08);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
          ${tipeIcon[t.Tipe]||'📋'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px">${escapeHtml(t.Judul||t.Tipe)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35)">${timeStr}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:1px">${escapeHtml(t.Lead_Nama||'')}${t.Listing_Kode?' · '+escapeHtml(t.Listing_Kode):''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
          <span style="font-size:9px;font-weight:600;padding:3px 8px;border-radius:6px;background:${sc}18;color:${sc}">${t.Status}</span>
          ${t.Status !== 'Done' ? `<button onclick="event.stopPropagation();markTaskDone('${escapeHtml(t.ID)}','${escapeHtml(t.Judul||t.Tipe)}')" style="font-size:10px;padding:4px 8px;border-radius:6px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:#4ade80;cursor:pointer">Done</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openTaskDetail(id) {
  // Basic — show toast for now, full detail can be extended
  showToast('Tap tombol Done untuk selesaikan jadwal', 'info');
}

// ─────────────────────────────────────────────────────────
// LEADS PAGE
// ─────────────────────────────────────────────────────────
let _leadFilter = 'all';

async function setLeadFilter(filter) {
  _leadFilter = filter;
  document.querySelectorAll('[data-filter]').forEach(b => {
    const isActive = b.dataset.filter === filter;
    b.className = isActive ? 'chip on' : 'chip';
  });
  await loadLeads();
}

async function loadLeads() {
  const list = document.getElementById('leads-list');
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:76px;border-radius:14px"></div>'.repeat(3);

  try {
    const params = _leadFilter !== 'all' ? `?score=${_leadFilter}` : '';
    const res = await API.get(`/leads${params}`);
    STATE.leads = res.data || [];
    renderLeadsList(STATE.leads);
  } catch (e) {
    list.innerHTML = emptyState('Gagal memuat leads');
  }
}

function renderLeadsList(leads) {
  const el = document.getElementById('leads-list');
  if (!el) return;
  if (!leads.length) { el.innerHTML = emptyState('Tidak ada leads'); return; }

  const scoreColor = { Hot:'#ef4444', Warm:'#F59E0B', Cold:'#3B82F6', Closing:'#22C55E', Out:'#6B7280' };
  const scoreEmoji = { Hot:'🔥', Warm:'☀️', Cold:'❄️', Closing:'🤝', Out:'🚫' };

  el.innerHTML = leads.map(l => {
    const sc = scoreColor[l.Score] || '#6B7280';
    return `
      <div onclick="openLeadDetail('${escapeHtml(l.ID)}')"
        style="display:flex;align-items:center;gap:12px;background:#131F38;border:1px solid rgba(255,255,255,0.05);border-radius:14px;padding:14px 16px;cursor:pointer;transition:border-color 0.2s"
        onmouseenter="this.style.borderColor='rgba(212,168,83,0.2)'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.05)'">
        <div style="width:40px;height:40px;border-radius:12px;background:${sc}18;display:flex;align-items:center;justify-content:center;font-weight:700;color:${sc};font-size:15px;flex-shrink:0">
          ${escapeHtml((l.Nama||'L').charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="font-size:13px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.Nama||'—')}</span>
            <span style="flex-shrink:0;font-size:9px;padding:2px 6px;border-radius:4px;background:${sc}18;color:${sc}">${scoreEmoji[l.Score]||''} ${l.Score||'—'}</span>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4)">${escapeHtml(l.Sumber||'')}${l.Tipe_Properti?' · '+escapeHtml(l.Tipe_Properti):''}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.25);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${escapeHtml(l.Properti_Diminati||l.Minat_Tipe||'')}</div>
          ${(['principal','business_manager','superadmin'].includes(STATE.user?.role) && l.Agen_Nama) ? `<div style="font-size:10px;color:#D4A853;margin-top:3px;display:flex;align-items:center;gap:3px"><i class="fa-solid fa-user-tie" style="font-size:9px"></i> ${escapeHtml(l.Agen_Nama)}</div>` : ''}
        </div>
        ${['principal','business_manager'].includes(STATE.user?.role)
          ? `<div style="width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid fa-lock" style="color:rgba(255,255,255,0.2);font-size:12px"></i></div>`
          : `<button onclick="event.stopPropagation();openWA('${escapeHtml(l.No_WA||'')}')"
              style="width:34px;height:34px;border-radius:10px;background:rgba(34,197,94,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fa-brands fa-whatsapp" style="color:#22C55E;font-size:15px"></i>
            </button>`
        }
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// SUBMIT FORMS
// ─────────────────────────────────────────────────────────
// Track edit mode
let _editListingId = null;

function resetListingModal() {
  _editListingId = null;
  ['add-tipe','add-transaksi','add-judul','add-kota','add-kecamatan',
   'add-harga','add-deskripsi','add-caption'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const prevGrid = document.getElementById('photo-preview-grid');
  if (prevGrid) prevGrid.innerHTML = '';
  // Reset photo inputs
  ['add-photos','add-photo2','add-photo3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Reset prev-photo divs
  ['prev-photo2','prev-photo3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span style="font-size:11px;color:rgba(255,255,255,0.3)">+ ${id === 'prev-photo2' ? 'Foto 2' : 'Foto 3'}</span>`;
  });
  // Reset modal title & button
  const titleEl = document.getElementById('modal-listing-title');
  const btnEl   = document.getElementById('listing-submit-btn');
  if (titleEl) titleEl.textContent = 'Tambah Listing';
  if (btnEl)   btnEl.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px"></i>Simpan';
  closeModal('modal-add-listing');
}

// Open Edit Listing — pre-fill form with existing data
function openEditListing(listingId) {
  const l = _allListings.find(x => x.ID === listingId);
  if (!l) { showToast('Data listing tidak ditemukan', 'error'); return; }

  _editListingId = listingId;

  // Update modal title & button
  const titleEl = document.getElementById('modal-listing-title');
  const btnEl   = document.getElementById('listing-submit-btn');
  if (titleEl) titleEl.textContent = 'Edit Listing';
  if (btnEl)   btnEl.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right:6px"></i>Update';

  // Pre-fill all fields
  setVal('add-tipe',       l.Tipe_Properti     || '');
  setVal('add-transaksi',  l.Status_Transaksi  || '');
  setVal('add-judul',      l.Judul             || '');
  setVal('add-kota',       l.Kota              || '');
  setVal('add-kecamatan',  l.Kecamatan         || '');
  setVal('add-harga',      l.Harga             || '');
  setVal('add-deskripsi',  l.Deskripsi         || '');
  setVal('add-caption',    l.Caption_Sosmed    || '');

  // Show existing photos as preview
  const prevGrid = document.getElementById('photo-preview-grid');
  if (prevGrid) {
    const photos = [l.Foto_Utama_URL, l.Foto_2_URL, l.Foto_3_URL].filter(Boolean);
    prevGrid.innerHTML = photos.map(u =>
      `<div style="border-radius:8px;overflow:hidden;height:80px;background:#1C2D52">
        <img src="${escapeHtml(u)}" style="width:100%;height:100%;object-fit:cover"/>
      </div>`
    ).join('');
  }

  closeModal('modal-listing-detail');
  openModal('modal-add-listing');
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

async function submitAddListing() {
  const tipe      = getVal('add-tipe');
  const transaksi = getVal('add-transaksi');
  const judul     = getVal('add-judul').trim();
  const kota      = getVal('add-kota').trim();
  const harga     = getVal('add-harga');

  if (!tipe || !transaksi || !judul || !kota || !harga) {
    showToast('Lengkapi field wajib (*)', 'error'); return;
  }

  const isEdit = !!_editListingId;

  const formData = new FormData();
  formData.append('Tipe_Properti',    tipe);
  formData.append('Status_Transaksi', transaksi);
  formData.append('Judul',            judul);
  formData.append('Kota',             kota);
  formData.append('Kecamatan',        getVal('add-kecamatan'));
  formData.append('Harga',            harga);
  formData.append('Deskripsi',        getVal('add-deskripsi'));
  formData.append('Caption_Sosmed',   getVal('add-caption'));
  formData.append('Harga_Format',     formatRupiah(harga));
  if (!isEdit) formData.append('Status_Listing', 'Aktif');


  // Multi photo: utama + foto2 + foto3 (max 3)
  const photoInputs = [
    document.getElementById('add-photos'),
    document.getElementById('add-photo2'),
    document.getElementById('add-photo3'),
  ];
  let hasNewPhotos = false;
  for (const input of photoInputs) {
    if (input?.files?.length) {
      hasNewPhotos = true;
      for (const f of input.files) {
        const compressed = await compressImage(f, 1280, 0.80);
        formData.append('photos', compressed, f.name);
      }
    }
  }

  const btn = document.getElementById('listing-submit-btn');
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }

    if (isEdit) {
      await API.put(`/listings/${_editListingId}`, formData, true);
      showToast('✅ Listing berhasil diupdate!', 'success');
    } else {
      await API.post('/listings', formData, true);
      showToast('✅ Listing berhasil ditambahkan!', 'success');
    }

    resetListingModal();
    closeModal('modal-add-listing');
    await loadDashboard();
    if (STATE.currentPage === 'listings') await loadListings();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px"></i>Simpan'; }
  }
}

async function submitAddLead() {
  const nama = getVal('lead-nama').trim();
  const wa   = getVal('lead-wa').trim();
  if (!nama || !wa) { showToast('Nama dan nomor WA wajib diisi', 'error'); return; }

  let noWa = wa.replace(/\D/g,'');
  if (noWa.startsWith('0')) noWa = '62' + noWa.slice(1);

  const isBuyerReq = document.getElementById('lead-buyer-request')?.checked || false;

  const payload = {
    Nama:              nama,
    No_WA:             noWa,
    Sumber:            getVal('lead-sumber') || 'Direct',
    Score:             getVal('lead-score') || 'Warm',
    Tipe_Properti:     getVal('lead-tipe-prop') || 'Secondary',
    Jenis:             getVal('lead-jenis') || 'Beli',
    Properti_Diminati: getVal('lead-minat'),
    Budget_Min:        getVal('lead-budget-min') || '',
    Budget_Max:        getVal('lead-budget-max') || '',
    Catatan:           getVal('lead-notes') || '',
    Status_Lead:       'Baru',
    Is_Buyer_Request:  isBuyerReq ? 'TRUE' : 'FALSE',
  };

  try {
    await API.post('/leads', payload);
    showToast('✅ Lead berhasil ditambahkan!', 'success');
    closeModal('modal-add-lead');
    await loadDashboard();
    if (STATE.currentPage === 'leads') await loadLeads();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

async function submitAddTask() {
  const scheduled = getVal('task-scheduled');
  if (!scheduled) { showToast('Tanggal & waktu wajib diisi', 'error'); return; }

  const payload = {
    Tipe:           getVal('task-tipe'),
    Prioritas:      getVal('task-prioritas') || 'Sedang',
    Lead_Nama:      getVal('task-lead-nama'),
    Scheduled_At:   new Date(scheduled).toISOString(),
    Duration_Menit: getVal('task-durasi') || 60,
    Lokasi:         getVal('task-lokasi'),
    Catatan_Pre:    getVal('task-catatan'),
  };

  try {
    await API.post('/tasks', payload);
    showToast('✅ Jadwal berhasil dibuat!', 'success');
    closeModal('modal-add-task');
    await loadDashboard();
    if (STATE.currentPage === 'tasks') await loadTasks();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

// ─────────────────────────────────────────────────────────
// NAVIGATION (override)
// ─────────────────────────────────────────────────────────
async function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => { p.style.display='none'; });
  const target = document.getElementById(`page-${page}`);
  if (target) target.style.display = 'block';

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.className = b.id === `nav-${page}` ? 'nav-btn active' : 'nav-btn';
  });

  const titles = { dashboard:'Dashboard', listings:'Listing Properti', leads:'Manajemen Leads', tasks:'Jadwal & Tasks', member:'Member Kantor' };
  setEl('page-title', titles[page] || page);
  STATE.currentPage = page;

  // Close notif panel
  const np = document.getElementById('notif-panel');
  if (np) np.style.display = 'none';

  if (page === 'dashboard') await loadDashboard();
  if (page === 'listings')  await loadListings();
  if (page === 'leads')     await loadLeads();
  if (page === 'tasks')     await loadTasks();
  if (page === 'team')      await loadTeamPage();
  if (page === 'member')    await loadMemberPage();
}

// ─────────────────────────────────────────────────────────
// PHOTO VIEWER — lightbox dengan swipe & download
// ─────────────────────────────────────────────────────────
let _photoViewerPhotos = [];
let _photoViewerIdx   = 0;

function openPhotoViewer(foto1, foto2, foto3, startIdx = 0) {
  _photoViewerPhotos = [foto1, foto2, foto3].filter(Boolean);
  _photoViewerIdx   = startIdx;

  // Buat overlay kalau belum ada
  let overlay = document.getElementById('photo-viewer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'photo-viewer-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
    `;
    overlay.innerHTML = `
      <div style="position:absolute;top:16px;right:16px;display:flex;gap:10px;z-index:2">
        <button id="pv-download" onclick="downloadCurrentPhoto()"
          style="width:40px;height:40px;border-radius:50%;background:rgba(212,168,83,0.2);border:1px solid rgba(212,168,83,0.4);color:#D4A853;cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="fa-solid fa-download" style="font-size:14px"></i>
        </button>
        <button onclick="closePhotoViewer()"
          style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="fa-solid fa-xmark" style="font-size:16px"></i>
        </button>
      </div>
      <button id="pv-prev" onclick="photoViewerNav(-1)"
        style="position:absolute;left:16px;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <img id="pv-img" src="" style="max-width:92vw;max-height:80vh;object-fit:contain;border-radius:8px"/>
      <div id="pv-counter" style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.5)"></div>
      <button id="pv-next" onclick="photoViewerNav(1)"
        style="position:absolute;right:16px;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    `;
    // Tap overlay tutup (bukan pada tombol)
    overlay.addEventListener('click', e => { if (e.target === overlay) closePhotoViewer(); });
    document.body.appendChild(overlay);
  }

  overlay.style.display = 'flex';
  _renderPhotoViewer();
}

function _renderPhotoViewer() {
  const img     = document.getElementById('pv-img');
  const counter = document.getElementById('pv-counter');
  const prev    = document.getElementById('pv-prev');
  const next    = document.getElementById('pv-next');
  if (!img) return;

  img.src = _photoViewerPhotos[_photoViewerIdx] || '';
  if (counter) counter.textContent = _photoViewerPhotos.length > 1
    ? `${_photoViewerIdx + 1} / ${_photoViewerPhotos.length}`
    : '';
  if (prev) prev.style.display = _photoViewerPhotos.length > 1 ? 'flex' : 'none';
  if (next) next.style.display = _photoViewerPhotos.length > 1 ? 'flex' : 'none';
}

function photoViewerNav(dir) {
  const n = _photoViewerPhotos.length;
  _photoViewerIdx = (_photoViewerIdx + dir + n) % n;
  _renderPhotoViewer();
}

function closePhotoViewer() {
  const overlay = document.getElementById('photo-viewer-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function downloadCurrentPhoto() {
  const url = _photoViewerPhotos[_photoViewerIdx];
  if (!url) return;
  try {
    showToast('⬇️ Mengunduh foto…', 'info');
    const res  = await fetch(url);
    const blob = await res.blob();
    const ext  = blob.type.includes('png') ? 'png' : 'jpg';
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `mansion-listing-foto-${Date.now()}.${ext}`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast('✅ Foto berhasil diunduh!', 'success');
  } catch (_) {
    // Fallback: buka di tab baru
    window.open(url, '_blank');
  }
}

// ─────────────────────────────────────────────────────────
// PAGE MEMBER — daftar kantor & agen
// ─────────────────────────────────────────────────────────
let _officesData = [];

async function loadMemberPage() {
  const container = document.getElementById('member-container');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);font-size:13px"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>`;
  try {
    const res  = await API.get('/agents/offices');
    _officesData = res.data || [];
    renderOffices(_officesData);
  } catch(e) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(239,68,68,0.7);font-size:13px">Gagal memuat data kantor</div>`;
  }
}

function renderOffices(offices) {
  const container = document.getElementById('member-container');
  if (!container) return;
  if (!offices.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);font-size:13px">Belum ada data kantor</div>`;
    return;
  }
  container.innerHTML = offices.map(office => officeCard(office)).join('');
}

function officeCard(office) {
  const namaBesar = office.nama_kantor.replace(/^MANSION\s*:\s*/i,'').trim() || 'Kantor Pusat';
  const totalMember = office.members.length;
  const aktif = office.members.filter(m => m.status === 'Aktif').length;

  const memberAvatars = office.members.slice(0,5).map(m => {
    const initial = (m.nama||'?').charAt(0).toUpperCase();
    const foto = m.foto_url ? `<img src="${escapeHtml(m.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : `<span style="font-weight:700;color:#D4A853;font-size:11px">${initial}</span>`;
    return `<div style="width:30px;height:30px;border-radius:50%;background:#1C2D52;border:2px solid #0D1526;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-left:-8px">${foto}</div>`;
  }).join('');
  const extraCount = totalMember > 5 ? `<div style="width:30px;height:30px;border-radius:50%;background:#131F38;border:2px solid #0D1526;display:flex;align-items:center;justify-content:center;margin-left:-8px;font-size:9px;color:rgba(255,255,255,0.4);font-weight:600">+${totalMember-5}</div>` : '';

  return `
    <div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
      <!-- Vcard header -->
      <div style="background:linear-gradient(135deg,#0D1A35,#131F38);padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:2.5px;color:#D4A853;margin-bottom:4px">MANSION</div>
            <div style="font-size:17px;font-weight:700;color:#fff;font-family:'DM Serif Display',serif">${escapeHtml(namaBesar)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:18px;font-weight:800;color:#D4A853">${totalMember}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.35);letter-spacing:1px">MEMBER</div>
          </div>
        </div>
        <!-- Avatar stack -->
        <div style="display:flex;align-items:center;margin-top:14px">
          <div style="display:flex;margin-left:8px">${memberAvatars}${extraCount}</div>
          <div style="margin-left:12px;font-size:11px;color:rgba(255,255,255,0.4)">${aktif} aktif</div>
        </div>
      </div>
      <!-- Expand toggle -->
      <button onclick="toggleOfficeMembers(this)" data-office="${escapeHtml(office.nama_kantor)}"
        style="width:100%;padding:11px 18px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;color:rgba(255,255,255,0.45);font-size:12px">
        <span>Lihat anggota</span>
        <i class="fa-solid fa-chevron-down" style="font-size:11px;transition:transform 0.2s"></i>
      </button>
      <!-- Member list (hidden by default) -->
      <div class="office-member-list" style="display:none;padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;display:none">
        ${office.members.map(m => memberRow(m)).join('')}
      </div>
    </div>`;
}

function memberRow(m) {
  const roleLabel = { agen:'Agen', admin:'Admin', business_manager:'BM', principal:'Principal', superadmin:'Super Admin' }[m.role] || m.role;
  const statusColor = m.status === 'Aktif' ? '#4ade80' : m.status === 'Cuti' ? '#facc15' : '#6b7280';
  const initial = (m.nama||'?').charAt(0).toUpperCase();
  const foto = m.foto_url
    ? `<img src="${escapeHtml(m.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
    : `<span style="font-weight:700;color:#D4A853;font-size:14px">${initial}</span>`;
  const waBtn = m.no_wa ? `<button onclick="openWA('${escapeHtml(m.no_wa)}')" style="padding:6px 12px;border-radius:8px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.2);color:#4ade80;font-size:11px;cursor:pointer"><i class="fa-brands fa-whatsapp" style="margin-right:4px"></i>WA</button>` : '';
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 6px;border-top:1px solid rgba(255,255,255,0.04)">
      <div style="width:40px;height:40px;border-radius:50%;background:#1C2D52;border:2px solid rgba(212,168,83,0.2);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden">${foto}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.nama||'—')}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <span style="font-size:10px;color:rgba(255,255,255,0.35)">${roleLabel}</span>
          <span style="font-size:8px;color:${statusColor}">● ${escapeHtml(m.status||'')}</span>
        </div>
        ${m.no_wa ? `<div style="font-size:10px;color:rgba(212,168,83,0.7);margin-top:3px">+${m.no_wa.replace(/[^0-9]/g,'')}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        <div style="text-align:right;margin-right:4px">
          <div style="font-size:11px;font-weight:700;color:#D4A853">${m.listing_count||0}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.3)">listing</div>
        </div>
        ${waBtn}
      </div>
    </div>`;
}

function toggleOfficeMembers(btn) {
  const list = btn.nextElementSibling;
  const icon = btn.querySelector('i');
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'flex';
  list.style.flexDirection = 'column';
  icon.style.transform = isOpen ? '' : 'rotate(180deg)';
  btn.querySelector('span').textContent = isOpen ? 'Lihat anggota' : 'Sembunyikan';
}

function filterMemberPage(q) {
  if (!q.trim()) { renderOffices(_officesData); return; }
  const kw = q.toLowerCase();
  const filtered = _officesData.map(o => ({
    ...o,
    members: o.members.filter(m =>
      m.nama.toLowerCase().includes(kw) ||
      o.nama_kantor.toLowerCase().includes(kw)
    )
  })).filter(o => o.members.length > 0 || o.nama_kantor.toLowerCase().includes(kw));
  renderOffices(filtered);
}

// ─────────────────────────────────────────────────────────
// SHOW APP (override)
// ─────────────────────────────────────────────────────────
async function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  const appEl = document.getElementById('app');
  appEl.classList.remove('hidden');
  appEl.style.display = 'flex';
  const bnav = document.getElementById('bottom-nav');
  if (bnav) bnav.style.display = 'block';

  const { nama, role } = STATE.user;
  _profileData.nama = _profileData.nama || nama;
  loadProfileFromStorage();

  const initial = (nama||'A').charAt(0).toUpperCase();
  setEl('sidebar-name', _profileData.nama || nama || 'Agent');
  setEl('sidebar-role', role || 'agen');
  setEl('topnav-avatar', initial);
  setEl('hero-name', (_profileData.nama || nama || 'Agen').split(' ')[0]);

  applyProfileToUI();
  requestNotifPermission();
  await loadFavourites();
  loadCloudinaryConfig().then(() => {});
  checkAdminMenu();
  setTimeout(() => navigateTo('dashboard'), 100);
  // Tampilkan laporan card untuk principal/superadmin
  const laporanCard = document.getElementById('laporan-summary-card');
  if (laporanCard && ['principal','superadmin'].includes(STATE.user?.role)) {
    laporanCard.style.display = 'block';
  }
  // Polling notifikasi setiap 60 detik
  setInterval(() => { if (STATE.token) API.get('/notifications/unread-count').then(r => updateNotifBadge(r.count||0)).catch(()=>{}); }, 60000);
}

// ─────────────────────────────────────────────────────────
// QUICK ADD / SIDEBAR / MODAL HELPERS
// ─────────────────────────────────────────────────────────
function openQuickAdd() {
  document.getElementById('quick-add-overlay').classList.remove('hidden');
  const sheet = document.getElementById('quick-add-sheet');
  if (sheet) setTimeout(() => { sheet.classList.remove('drawer-closed'); sheet.classList.add('drawer-open'); }, 10);
}

function closeQuickAdd() {
  document.getElementById('quick-add-overlay').classList.add('hidden');
  const sheet = document.getElementById('quick-add-sheet');
  if (sheet) { sheet.classList.remove('drawer-open'); sheet.classList.add('drawer-closed'); }
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  const isOpen = sb.classList.contains('drawer-open');
  sb.classList.toggle('drawer-open', !isOpen);
  sb.classList.toggle('drawer-closed', isOpen);
  ov.classList.toggle('hidden', isOpen);
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb?.classList.remove('drawer-open'); sb?.classList.add('drawer-closed');
  ov?.classList.add('hidden');
}

function openModal(id) {
  const el = document.getElementById(id); if (!el) return;
  el.style.display = 'flex'; el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id); if (!el) return;
  el.style.display = 'none'; el.classList.remove('open');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast  = document.getElementById('toast');
  const msgEl  = document.getElementById('toast-msg');
  const iconEl = document.getElementById('toast-icon');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  const cfg = {
    success: { bg:'#0D2B1E', border:'rgba(34,197,94,0.3)',  icon:'fa-check-circle',  color:'#22C55E' },
    error:   { bg:'#2B0D0D', border:'rgba(239,68,68,0.3)',  icon:'fa-circle-xmark',  color:'#ef4444' },
    info:    { bg:'#0D1A2B', border:'rgba(43,123,255,0.3)', icon:'fa-circle-info',   color:'#2B7BFF' },
  };
  const c = cfg[type] || cfg.info;
  toast.style.background  = c.bg;
  toast.style.borderColor = c.border;
  if (iconEl) { iconEl.className = `fa-solid ${c.icon}`; iconEl.style.color = c.color; }

  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─────────────────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────────────────
function setEl(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }
function getVal(id) { return document.getElementById(id)?.value||''; }
function setVal(id, val) { const el=document.getElementById(id); if(el) el.value=val; }

function openWA(noWa) {
  if (!noWa) return;
  let num = noWa.replace(/\D/g,'');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  window.open(`https://wa.me/${num}`, '_blank');
}

function formatRupiah(num) {
  if (!num) return '';
  const n = parseInt(num);
  if (n >= 1_000_000_000) return `Rp ${(n/1_000_000_000).toFixed(n%1_000_000_000===0?0:1)} M`;
  if (n >= 1_000_000)     return `Rp ${(n/1_000_000).toFixed(n%1_000_000===0?0:0)} Jt`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr); const now = new Date();
  const diff = Math.round((d - now) / (1000*60*60*24));
  if (diff === 0)  return 'Hari ini';
  if (diff === 1)  return 'Besok';
  if (diff === -1) return 'Kemarin';
  if (diff < 0)   return `${Math.abs(diff)} hari lalu`;
  if (diff < 7)   return `${diff} hari lagi`;
  return d.toLocaleDateString('id-ID', {day:'numeric',month:'short'});
}

function emptyState(msg) {
  return `<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,0.3);font-size:12px">
    <i class="fa-regular fa-folder-open" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.4"></i>
    ${escapeHtml(msg)}
  </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function previewPhotos(input) {
  const grid = document.getElementById('photo-preview-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Array.from(input.files).forEach(file => {
    const url = URL.createObjectURL(file);
    grid.innerHTML += `<div style="position:relative"><img src="${url}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px"/><span style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);color:#fff;font-size:9px;padding:2px 5px;border-radius:4px">WebP</span></div>`;
  });
}
function previewSinglePhoto(input, previewId) {
  const prev = document.getElementById(previewId);
  if (!prev || !input.files?.[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(input.files[0]);
}


async function refreshData() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.style.animation = 'spin 1s linear infinite';
  showToast('🔄 Menyegarkan data…', 'info');
  try { await API.post('/dashboard/cache/clear'); } catch (_) {}
  await navigateTo(STATE.currentPage);
  if (icon) icon.style.animation = '';
}

console.log('[CRM] app-mobile.js v2 loaded — PR 1-15 active 🚀');

// ─────────────────────────────────────────────────────────
// PR 18: MANAJEMEN USER (Admin only)
// ─────────────────────────────────────────────────────────

function openUserMgmt() {
  openModal('modal-user-mgmt');
  setUserTab('list');
  loadUserList();
}

function setUserTab(tab) {
  const isAdd = tab === 'add';
  const listEl = document.getElementById('user-tab-list');
  const addEl  = document.getElementById('user-tab-add');
  const tabList = document.getElementById('utab-list');
  const tabAdd  = document.getElementById('utab-add');
  if (listEl) listEl.style.display = isAdd ? 'none' : 'block';
  if (addEl)  { addEl.style.display = isAdd ? 'flex' : 'none'; }
  if (tabList) { tabList.style.background = isAdd ? 'transparent' : 'rgba(212,168,83,0.2)'; tabList.style.color = isAdd ? 'rgba(255,255,255,0.4)' : '#D4A853'; }
  if (tabAdd)  { tabAdd.style.background  = isAdd ? 'rgba(212,168,83,0.2)' : 'transparent'; tabAdd.style.color  = isAdd ? '#D4A853' : 'rgba(255,255,255,0.4)'; }
}

let _userList = [];

async function loadUserList() {
  const el = document.getElementById('user-list-container');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:12px"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
  try {
    const res = await API.get('/agents');
    _userList = res.data || [];
    if (!_userList.length) { el.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;padding:20px">Belum ada user</p>'; return; }
    const roleColor = { superadmin:'#EF4444', principal:'#F97316', business_manager:'#A855F7', admin:'#D4A853', agen:'#4ade80' };
    const statusColor = { Aktif:'#4ade80', Cuti:'#9ca3af', Nonaktif:'#ef4444' };
    el.innerHTML = _userList.map(u => `
      <div style="display:flex;align-items:center;gap:12px;background:#131F38;border-radius:14px;padding:12px 14px;border:1px solid rgba(255,255,255,0.06)">
        <div style="width:40px;height:40px;border-radius:50%;background:rgba(212,168,83,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;color:#D4A853;font-size:15px;flex-shrink:0">
          ${escapeHtml((u.Nama||'U').charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#fff">${escapeHtml(u.Nama||'—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:1px">${escapeHtml(u.Email||'')}</div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <span style="font-size:9px;padding:2px 7px;border-radius:5px;background:${roleColor[u.Role]||'#6B7280'}18;color:${roleColor[u.Role]||'#6B7280'};font-weight:600">${{ superadmin:'Super Admin', principal:'Principal', business_manager:'Business Mgr', admin:'Admin', agen:'Agen' }[u.Role] || u.Role || 'agen'}</span>
            <span style="font-size:9px;padding:2px 7px;border-radius:5px;background:${statusColor[u.Status]||'#6B7280'}18;color:${statusColor[u.Status]||'#6B7280'};font-weight:600">● ${u.Status||'Aktif'}</span>
            ${u.Telegram_ID ? '<span style="font-size:9px;padding:2px 7px;border-radius:5px;background:rgba(43,123,255,0.12);color:#60a5fa">TG ✓</span>' : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button onclick="openEditUser('${escapeHtml(u.ID)}')" style="font-size:10px;padding:5px 10px;border-radius:7px;background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.2);color:#D4A853;cursor:pointer"><i class="fa-solid fa-pen"></i></button>
          ${u.ID !== STATE.user?.id ? `<button onclick="confirmDeleteUser('${escapeHtml(u.ID)}','${escapeHtml(u.Nama)}')" style="font-size:10px;padding:5px 10px;border-radius:7px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;cursor:pointer"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<p style="color:#f87171;text-align:center;font-size:12px;padding:16px">${e.message}</p>`;
  }
}

function openEditUser(id) {
  const u = _userList.find(x => x.ID === id);
  if (!u) { showToast('Data user tidak ditemukan', 'error'); return; }
  setVal('eu-id', u.ID||'');
  setVal('eu-nama', u.Nama||'');
  setVal('eu-wa', u.No_WA||'');
  setVal('eu-kantor', (u.Nama_Kantor||'').replace(/^MANSION\s*:\s*/i,'').trim());
  setVal('eu-password', '');
  setVal('eu-telegram', u.Telegram_ID||'');
  setVal('eu-role', u.Role||'agen');
  setVal('eu-status', u.Status||'Aktif');
  openModal('modal-edit-user');
}

async function submitEditUser() {
  const id = getVal('eu-id');
  if (!id) return;
  const payload = {
    Nama: getVal('eu-nama').trim(),
    No_WA: getVal('eu-wa').trim(),
    Role: getVal('eu-role'),
    Nama_Kantor: getVal('eu-kantor').trim() ? `MANSION : ${getVal('eu-kantor').trim()}` : '',
    Status: getVal('eu-status'),
    Telegram_ID: getVal('eu-telegram').trim(),
  };
  const newPass = getVal('eu-password').trim();
  if (newPass) payload.newPassword = newPass;
  try {
    await API.put(`/agents/${id}`, payload);
    showToast('✅ User berhasil diupdate!', 'success');
    closeModal('modal-edit-user');
    loadUserList();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

async function submitAddUser() {
  const nama  = getVal('nu-nama').trim();
  const email = getVal('nu-email').trim();
  const pass  = getVal('nu-password').trim();
  if (!nama || !email || !pass) { showToast('Nama, email, dan password wajib diisi', 'error'); return; }
  if (pass.length < 6) { showToast('Password minimal 6 karakter', 'error'); return; }
  const payload = {
    Nama: nama, Email: email, Password: pass,
    No_WA: getVal('nu-wa').trim(),
    Role: getVal('nu-role'),
    Nama_Kantor: getVal('nu-kantor').trim() ? `MANSION : ${getVal('nu-kantor').trim()}` : '',
    Status: getVal('nu-status'),
    Telegram_ID: getVal('nu-telegram').trim(),
  };
  try {
    const btn = document.querySelector('#user-tab-add .btn-gold');
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
    await API.post('/agents', payload);
    showToast(`✅ User ${nama} berhasil ditambahkan!`, 'success');
    setUserTab('list');
    loadUserList();
    ['nu-nama','nu-email','nu-password','nu-wa','nu-telegram','nu-kantor'].forEach(id => setVal(id,''));
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    const btn = document.querySelector('#user-tab-add .btn-gold');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus" style="margin-right:6px"></i>Tambah User'; }
  }
}

function confirmDeleteUser(id, nama) {
  const msg = document.getElementById('delete-user-msg');
  if (msg) msg.textContent = `User "${nama}" akan dihapus permanen. Lanjutkan?`;
  const btn = document.getElementById('btn-confirm-delete-user');
  if (btn) btn.onclick = () => doDeleteUser(id, nama);
  openModal('modal-delete-user');
}

async function doDeleteUser(id, nama) {
  closeModal('modal-delete-user');
  try {
    await API.delete(`/agents/${id}`);
    showToast(`✅ User ${nama} berhasil dihapus`, 'success');
    loadUserList();
  } catch (e) { showToast('Gagal hapus: ' + e.message, 'error'); }
}

// Tampilkan menu Manajemen User hanya untuk admin
function checkAdminMenu() {
  const role = STATE.user?.role;
  const btn = document.getElementById('sidebar-user-mgmt');
  if (btn && ['admin','principal','superadmin'].includes(role)) btn.style.display = 'flex';
  const btnTeam = document.getElementById('sidebar-team-mgmt');
  if (btnTeam && ['principal','superadmin'].includes(role)) btnTeam.style.display = 'flex';
  const navTeam = document.getElementById('nav-team');
  if (navTeam && ['principal','business_manager','superadmin'].includes(role)) navTeam.style.display = 'flex';
  const roleBadge = document.getElementById('sidebar-role-badge');
  const roleLabel = { superadmin:'Super Admin', principal:'Principal', business_manager:'Business Manager', admin:'Admin', agen:'Agen' };
  if (roleBadge) roleBadge.textContent = roleLabel[role] || role;
}


// ─────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────
function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = 'inline-flex'; }
  else badge.style.display = 'none';
}

async function loadNotifications() {
  try {
    const res = await API.get('/notifications');
    const notifs = res.data || [];
    updateNotifBadge(res.unread || 0);
    const panel = document.getElementById('notif-list');
    if (!panel) return;
    if (!notifs.length) { panel.innerHTML = emptyState('Belum ada notifikasi'); return; }
    panel.innerHTML = notifs.slice(0, 20).map(n => `
      <div onclick="markNotifRead('${n.Notif_ID}', '${n.Link_Type}', '${n.Link_ID}')"
           style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;background:${n.Is_Read==='TRUE'?'transparent':'rgba(212,168,83,0.05)'}">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <span style="font-size:18px">${n.Tipe==='buyer_request'?'🔔':n.Tipe==='komisi_request'?'💰':'📢'}</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:${n.Is_Read==='TRUE'?'400':'600'};color:${n.Is_Read==='TRUE'?'rgba(255,255,255,0.55)':'#fff'}">${escapeHtml(n.Judul)}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">${escapeHtml(n.Pesan||'')}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:4px">${timeAgo(n.Created_At)}</div>
          </div>
          ${n.Is_Read!=='TRUE'?'<span style="width:6px;height:6px;border-radius:50%;background:#D4A853;flex-shrink:0;margin-top:4px"></span>':''}
        </div>
      </div>
    `).join('');
  } catch(e) { console.warn('Notif load error:', e.message); }
}

async function markNotifRead(notifId, linkType, linkId) {
  try {
    await API.patch('/notifications/' + notifId + '/read', {});
    if (linkType === 'lead' && linkId) navigateTo('leads');
    await loadNotifications();
  } catch(_) {}
}

async function markAllNotifRead() {
  try {
    await API.patch('/notifications/read-all', {});
    await loadNotifications();
    showToast('Semua notifikasi sudah dibaca', 'success');
  } catch(_) {}
}

// ─────────────────────────────────────────────────────────
// TEAM PAGE (Principal & Business Manager)
// ─────────────────────────────────────────────────────────
async function loadTeamPage() {
  const container = document.getElementById('page-team');
  if (!container) return;
  const role = STATE.user?.role;

  try {
    const [teamsRes, leadsStatsRes, listingStatsRes] = await Promise.allSettled([
      API.get('/teams'),
      API.get('/leads/stats/by-agent'),
      API.get('/listings/stats/by-agent'),
    ]);

    const teams = teamsRes.status === 'fulfilled' ? (teamsRes.value?.data || []) : [];
    const leadsStats = leadsStatsRes.status === 'fulfilled' ? (leadsStatsRes.value?.data || []) : [];
    const listingStats = listingStatsRes.status === 'fulfilled' ? (listingStatsRes.value?.data || []) : [];

    // Build lead & listing maps by agent
    const leadMap = {};
    leadsStats.forEach(a => { leadMap[a.agen_id] = a; });
    const listMap = {};
    listingStats.forEach(a => { listMap[a.agen_id] = a; });

    container.innerHTML = `
      <div style="padding:16px">
        ${role === 'principal' || role === 'superadmin' ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <span style="font-size:13px;color:rgba(255,255,255,0.5)">${teams.length} Tim aktif</span>
          <button onclick="openCreateTeamModal()" style="background:#D4A853;color:#0D1526;border:none;border-radius:10px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer">+ Buat Tim</button>
        </div>` : ''}

        ${teams.length === 0 ? emptyState('Belum ada tim. Buat tim baru untuk mulai.') : teams.map(team => `
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:16px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <div style="font-size:14px;font-weight:700;color:#fff">${escapeHtml(team.Nama_Team)}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">BM: ${escapeHtml(team.BM_Nama||'-')}</div>
              </div>
              ${(role === 'principal' || role === 'superadmin' || role === 'admin') ? `
              <div style="display:flex;gap:6px">
                <button onclick="openEditTeamModal('${team.Team_ID}')" style="background:rgba(212,168,83,0.15);border:1px solid rgba(212,168,83,0.3);color:#D4A853;border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer">Edit</button>
                <button onclick="confirmDeleteTeam('${team.Team_ID}','${(team.Nama_Team||'').replace(/'/g,"\\'")}')" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer">Hapus</button>
              </div>` : ''}
            </div>

            <!-- Leads stats per agent -->
            <div style="font-size:11px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Leads Anggota</div>
            ${(team.member_ids || []).map(agentId => {
              const ls = leadMap[agentId] || { agen_nama: agentId, total: 0, hot: 0, deal: 0 };
              const li = listMap[agentId] || { total: 0 };
              return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;margin-bottom:4px">
                <span style="font-size:12px;color:rgba(255,255,255,0.7)">${escapeHtml(ls.agen_nama||agentId)}</span>
                <div style="display:flex;gap:12px">
                  <span style="font-size:11px;color:rgba(255,255,255,0.4)">🏠 ${li.total}</span>
                  <span style="font-size:11px;color:#A855F7">Leads: ${ls.total}</span>
                  <span style="font-size:11px;color:#EF4444">Hot: ${ls.hot}</span>
                  <span style="font-size:11px;color:#22C55E">Deal: ${ls.deal}</span>
                </div>
              </div>`;
            }).join('') || '<div style="font-size:11px;color:rgba(255,255,255,0.3);padding:8px">Belum ada anggota</div>'}
          </div>
        `).join('')}
      </div>

      <!-- Create/Edit Team Modal -->
      <div id="team-modal-overlay" class="hidden" onclick="closeTeamModal()" style="position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.7)"></div>
      <div id="team-modal" class="hidden" style="position:fixed;bottom:0;left:0;right:0;z-index:51;background:#141E35;border-radius:20px 20px 0 0;padding:24px;max-height:85vh;overflow-y:auto">
        <h3 id="team-modal-title" style="color:#fff;font-size:16px;font-weight:700;margin-bottom:20px">Buat Tim Baru</h3>
        <input id="tm-nama" placeholder="Nama Tim" style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:10px;padding:12px;font-size:14px;margin-bottom:12px;box-sizing:border-box">
        <select id="tm-bm" style="width:100%;background:#141E35;border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:10px;padding:12px;font-size:14px;margin-bottom:12px;box-sizing:border-box">
          <option value="">-- Pilih Business Manager --</option>
        </select>
        <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px">Pilih Anggota Tim:</div>
        <div id="tm-members-list" style="max-height:200px;overflow-y:auto;margin-bottom:16px"></div>
        <button onclick="saveTeam()" style="width:100%;background:#D4A853;color:#0D1526;border:none;border-radius:12px;padding:14px;font-size:14px;font-weight:700;cursor:pointer">Simpan Tim</button>
      </div>
    `;

  } catch(e) {
    container.innerHTML = '<p style="color:rgba(255,255,255,0.4);padding:20px;text-align:center">Gagal memuat data tim: ' + e.message + '</p>';
  }
}

let _teamEditId = null;
let _allAgentsList = [];

async function openCreateTeamModal() {
  _teamEditId = null;
  document.getElementById('team-modal-title').textContent = 'Buat Tim Baru';
  document.getElementById('tm-nama').value = '';
  await loadAgentsForModal();
  document.getElementById('team-modal-overlay').classList.remove('hidden');
  document.getElementById('team-modal').classList.remove('hidden');
}

async function openEditTeamModal(teamId) {
  _teamEditId = teamId;
  document.getElementById('team-modal-title').textContent = 'Edit Tim';
  try {
    const res = await API.get('/teams/' + teamId);
    const team = res.data || {};
    document.getElementById('tm-nama').value = team.Nama_Team || '';
    await loadAgentsForModal(team.BM_ID, team.member_ids || []);
    document.getElementById('team-modal-overlay').classList.remove('hidden');
    document.getElementById('team-modal').classList.remove('hidden');
  } catch(e) { showToast('Gagal memuat data tim', 'error'); }
}

async function loadAgentsForModal(selectedBM = '', selectedMembers = []) {
  try {
    const res = await API.get('/teams/members/available');
    _allAgentsList = res.data || [];
    const bms = _allAgentsList.filter(a => a.Role === 'business_manager');
    const members = _allAgentsList.filter(a => ['agen','admin'].includes(a.Role));
    const bmSel = document.getElementById('tm-bm');
    bmSel.innerHTML = '<option value="">-- Pilih Business Manager --</option>' +
      bms.map(a => `<option value="${a.ID}" ${a.ID===selectedBM?'selected':''}>${escapeHtml(a.Nama)}</option>`).join('');
    const memberList = document.getElementById('tm-members-list');
    memberList.innerHTML = members.map(a => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer">
        <input type="checkbox" value="${a.ID}" ${selectedMembers.includes(a.ID)?'checked':''} style="accent-color:#D4A853">
        <span style="font-size:13px;color:rgba(255,255,255,0.8)">${escapeHtml(a.Nama)} <span style="color:rgba(255,255,255,0.3);font-size:11px">${a.Role}</span></span>
      </label>
    `).join('');
  } catch(e) { document.getElementById('tm-members-list').innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:12px">Gagal memuat agen</p>'; }
}

function closeTeamModal() {
  document.getElementById('team-modal-overlay').classList.add('hidden');
  document.getElementById('team-modal').classList.add('hidden');
}

async function confirmDeleteTeam(teamId, teamName) {
  const ok = confirm(`Hapus tim "${teamName}"?\n\nAnggota tim tidak akan terhapus, hanya struktur timnya saja.`);
  if (!ok) return;
  try {
    await API.delete(`/teams/${teamId}`);
    showToast('✅ Tim berhasil dihapus', 'success');
    // Reload teams section
    const container = document.getElementById('admin-dash-content');
    if (container) {
      const activeSection = container.querySelector('[data-section="teams"]');
      if (activeSection || STATE.currentPage === 'dashboard') {
        await loadAdminDashboard();
      }
    }
  } catch (e) {
    showToast('Gagal hapus tim: ' + e.message, 'error');
  }
}


async function saveTeam() {
  const nama = document.getElementById('tm-nama').value.trim();
  const bm_id = document.getElementById('tm-bm').value;
  const memberCheckboxes = document.querySelectorAll('#tm-members-list input[type=checkbox]:checked');
  const member_ids = [...memberCheckboxes].map(c => c.value);
  if (!nama) { showToast('Nama tim wajib diisi', 'error'); return; }
  try {
    if (_teamEditId) {
      await API.put('/teams/' + _teamEditId, { Nama_Team: nama, BM_ID: bm_id, member_ids });
    } else {
      await API.post('/teams', { Nama_Team: nama, BM_ID: bm_id, member_ids });
    }
    showToast(_teamEditId ? 'Tim diupdate' : 'Tim berhasil dibuat', 'success');
    closeTeamModal();
    await loadTeamPage();
  } catch(e) { showToast('Gagal simpan tim: ' + e.message, 'error'); }
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Baru saja';
  if (m < 60) return m + ' menit lalu';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' jam lalu';
  return Math.floor(h / 24) + ' hari lalu';
}
