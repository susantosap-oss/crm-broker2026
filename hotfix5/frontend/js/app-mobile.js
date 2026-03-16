
// ── Force Logout All Devices (superadmin) ─────────────
async function forceLogoutAllDevices() {
  if (!confirm('⚠️ Semua agen akan di-logout dari semua device.\nLanjutkan?')) return;
  try {
    const r = await API.post('/agents/force-logout-all', {});
    showToast('✅ ' + r.message, 'success');
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

// ── PR 2: LOGOUT FIX
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
  // Tampilkan danger zone untuk superadmin
  const dz = document.getElementById('superadmin-danger-zone');
  if (dz) dz.style.display = (STATE.user?.role === 'superadmin') ? 'block' : 'none';
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
    localStorage.setItem('crm_token', STATE.token);
    localStorage.setItem('crm_user', JSON.stringify(STATE.user));
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
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <div style="font-size:14px;font-weight:700;color:#D4A853">${harga}</div>
            ${l.Harga_Permeter ? `<div style="font-size:10px;color:rgba(212,168,83,0.7);font-weight:600">${l.Harga_Permeter_Format || formatRupiah(l.Harga_Permeter)}/m²</div>` : ''}
          </div>
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
      ${listing.Harga_Permeter ? `<span style="padding:5px 10px;border-radius:8px;background:rgba(212,168,83,0.07);color:#D4A853;font-size:11px;font-weight:600;border:1px solid rgba(212,168,83,0.25)">${listing.Harga_Permeter_Format || formatRupiah(listing.Harga_Permeter)}/m²</span>` : ''}
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
    // Parse spek dari deskripsi (fallback untuk listing lama)
  const _desc   = listing.Deskripsi || '';
  const _px     = (re) => { const m = _desc.match(re); return m ? m[1] : ''; };
  const _lt     = listing.Luas_Tanah    || _px(/LT[:\s]*(\d+)/i);
  const _lb     = listing.Luas_Bangunan || _px(/LB[:\s]*(\d+)/i);
  const _kt     = listing.Kamar_Tidur   || _px(/(\d+(?:[+\-]\d+)?)\s*KT/i);
  const _km     = listing.Kamar_Mandi   || _px(/(\d+(?:[+\-]\d+)?)\s*KM/i);
  const _srt    = listing.Sertifikat    || _px(/(SHM|HGB|SHGB|AJB|Girik|Strata Title)/i);
  
  const spek    = [
    _lt  ? `LT ${_lt} m2`  : '',
    _lb  ? `LB ${_lb} m2`  : '',
    _kt  ? `${_kt} KT`     : '',
    _km  ? `${_km} KM`     : '',
    _srt ? _srt            : '',
  ].filter(Boolean).join(' / ');
  // Strip hashtag dari deskripsi
  const rawDesk = (listing.Deskripsi || '').replace(/#\w+/g, '').replace(/\s{2,}/g, ' ').trim();
  const deskripsi = rawDesk
    ? '\n' + rawDesk.substring(0, 300) + (rawDesk.length > 300 ? '...' : '')
    : '';
  return (
    `*${(listing.Judul || 'Properti Dijual').toUpperCase().trim()}*\n` + 
    `_${listing.Tipe_Properti || ''} - ${listing.Status_Transaksi || ''}_\n\n` + 
    `📍 *Lokasi* : ${lokasi || '-'}\n` +
    `💰 *Harga* : *${harga}*\n` + 
    (listing.Harga_Permeter ? `📐 *Harga/m²* : ${listing.Harga_Permeter_Format || formatRupiah(listing.Harga_Permeter)}\n` : '') +
    (spek ? `🏠 *Spek* : ${spek}\n` : '') +
    (listing.Kode_Listing ? `🆔 *Kode* : ${listing.Kode_Listing}\n` : '') +
    `\n${deskripsi}\n\n` +
    `*Hubungi Agen:*\n` +
    `👤 ${agentNama}\n` +
    (waClean    ? `📱 : +${waClean}\n` : '') + 
    (waBizClean ? `💼 : +${waBizClean}\n` : '')
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

  const platform = type === 'wab' ? 'wa_business' : 'wa';

  if (type === 'wab') {
    const isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid) {
      window.open(`intent://send?text=${encoded}#Intent;package=com.whatsapp.w4b;scheme=whatsapp;end`, '_blank');
    }
  } else {
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  }

  // Log share (fire & forget)
  _logShare('listing', listing.ID, listing.Judul || listing.Kode_Listing || '', platform);
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
  const _d2  = listing.Deskripsi || '';
  const _p2  = (re) => { const m = _d2.match(re); return m ? m[1] : ''; };
  const _spekCat = [
    (listing.Luas_Tanah    || _p2(/LT[:\s]*(\d+)/i))  ? `LT ${listing.Luas_Tanah || _p2(/LT[:\s]*(\d+)/i)} m2` : '',
    (listing.Luas_Bangunan || _p2(/LB[:\s]*(\d+)/i))  ? `LB ${listing.Luas_Bangunan || _p2(/LB[:\s]*(\d+)/i)} m2` : '',
    (listing.Kamar_Tidur   || _p2(/(\d+(?:[+\-]\d+)?)\s*KT/i))     ? `${listing.Kamar_Tidur || _p2(/(\d+(?:[+\-]\d+)?)\s*KT/i)} KT` : '',
    (listing.Kamar_Mandi   || _p2(/(\d+(?:[+\-]\d+)?)\s*KM/i))     ? `${listing.Kamar_Mandi || _p2(/(\d+(?:[+\-]\d+)?)\s*KM/i)} KM` : '',
    listing.Sertifikat || _p2(/(SHM|HGB|SHGB|AJB|Girik|Strata Title)/i) || '',
  ].filter(Boolean).join(' / ');
  
  const catalogText =
    `${listing.Judul || 'Properti'}\n` +
    `Harga: ${harga}\n` +
    `Tipe: ${listing.Tipe_Properti || ''} | ${listing.Status_Transaksi || ''}\n` +
    `Lokasi: ${[listing.Kecamatan, listing.Kota].filter(Boolean).join(', ')}\n` +
    (_spekCat ? `Spek: ${_spekCat}\n` : '') +
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
    const res = await API.get(`/listings?agen_id=${STATE.user?.id}`);
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

    // Primary stats — koordinator, principal, superadmin
    if (['koordinator','principal','superadmin'].includes(STATE.user?.role)) {
      loadPrimaryStats();
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
    let params = '';
    if (_leadFilter === 'mine') {
      // Leads Saya — filter by agen_id sendiri
      params = `?agen_id=${STATE.user?.id}`;
    } else if (_leadFilter !== 'all') {
      params = `?score=${_leadFilter}`;
    }
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
          ${(['principal','superadmin'].includes(STATE.user?.role) && l.Agen_Nama) ? `<div style="font-size:10px;color:#D4A853;margin-top:3px;display:flex;align-items:center;gap:3px"><i class="fa-solid fa-user-tie" style="font-size:9px"></i> ${escapeHtml(l.Agen_Nama)}</div>` : ''}
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
   'add-harga','add-harga-permeter','add-deskripsi','add-caption'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const prevGrid = document.getElementById('photo-preview-grid');
  if (prevGrid) prevGrid.innerHTML = '';
  // Clear harga previews
  ['add-harga-preview','add-harga-pm-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
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
  setVal('add-harga-permeter', l.Harga_Permeter || '');
  // Trigger preview
  const hEl = document.getElementById('add-harga');
  const pmEl = document.getElementById('add-harga-permeter');
  if (hEl)  previewHargaFormat(hEl, 'add-harga-preview');
  if (pmEl) previewHargaFormat(pmEl, 'add-harga-pm-preview');
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
  // Strip non-digits — no rounding, exact value
  const harga     = getVal('add-harga').replace(/\D/g, '');
  const hargaPM   = getVal('add-harga-permeter').replace(/\D/g, '');

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
  if (hargaPM) {
    formData.append('Harga_Permeter', hargaPM);
    formData.append('Harga_Permeter_Format', formatRupiah(hargaPM));
  }
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


// ── Properti Picker for Add Lead ─────────────────────────
let _propertiPickerTab = 'listing';
let _pickerItems = [];

async function openPropertiPicker() {
  _propertiPickerTab = 'listing';
  const overlay = document.getElementById('properti-picker-overlay');
  const modal = document.getElementById('properti-picker-modal');
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  document.getElementById('properti-picker-search').value = '';

  // Load data kalau belum ada
  if (!_allListings.length) {
    try {
      const res = await API.get('/listings');
      _allListings = res.data || [];
    } catch(e) {}
  }
  if (!_projectsData.length) {
    try {
      const res = await API.get('/projects');
      _projectsData = res.data || [];
    } catch(e) {}
  }

  setPropertiTab('listing');
}

function closePropertiPicker() {
  const overlay = document.getElementById('properti-picker-overlay');
  const modal = document.getElementById('properti-picker-modal');
  overlay.classList.add('hidden');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function setPropertiTab(tab) {
  _propertiPickerTab = tab;
  const btnListing = document.getElementById('ptab-listing');
  const btnPrimary = document.getElementById('ptab-primary');
  if (btnListing) {
    btnListing.style.background = tab==='listing' ? 'rgba(212,168,83,0.2)' : 'transparent';
    btnListing.style.color = tab==='listing' ? '#D4A853' : 'rgba(255,255,255,0.5)';
    btnListing.style.border = tab==='listing' ? 'none' : '1px solid rgba(255,255,255,0.1)';
  }
  if (btnPrimary) {
    btnPrimary.style.background = tab==='primary' ? 'rgba(212,168,83,0.2)' : 'transparent';
    btnPrimary.style.color = tab==='primary' ? '#D4A853' : 'rgba(255,255,255,0.5)';
    btnPrimary.style.border = tab==='primary' ? 'none' : '1px solid rgba(255,255,255,0.1)';
  }
  filterPropertiPicker(document.getElementById('properti-picker-search')?.value || '');
}

function filterPropertiPicker(q) {
  const list = document.getElementById('properti-picker-list');
  if (!list) return;
  const query = q.toLowerCase();

  let items = [];
  if (_propertiPickerTab === 'listing') {
    items = (_allListings || [])
      .filter(l => ['Aktif'].includes(l.Status_Listing))
      .filter(l => !query || 
        (l.Judul||'').toLowerCase().includes(query) ||
        (l.Kota||'').toLowerCase().includes(query) ||
        (l.Kecamatan||'').toLowerCase().includes(query) ||
        (l.Kode_Listing||'').toLowerCase().includes(query))
      .map(l => ({
        label: l.Judul || '—',
        sub: `${l.Kode_Listing||''} · ${l.Kecamatan||''}, ${l.Kota||''} · ${l.Harga_Format||formatRupiah(l.Harga)}`,
        value: `${l.Judul} (${l.Kode_Listing||l.ID})`
      }));
  } else {
    items = (_projectsData || [])
      .filter(p => !query ||
        (p.Nama_Project||'').toLowerCase().includes(query) ||
        (p.Lokasi||'').toLowerCase().includes(query) ||
        (p.Tipe_Properti||'').toLowerCase().includes(query))
      .map(p => ({
        label: p.Nama_Project || '—',
        sub: `${p.Tipe_Properti||''} · ${p.Lokasi||''} · ${p.Harga_Format||'On Request'}`,
        value: `${p.Nama_Project} (Primary)`
      }));
  }

  if (!items.length) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:12px">Tidak ada properti ditemukan</div>';
    return;
  }

  list.innerHTML = items.map((item, idx) => `
    <div data-picker-idx="${idx}"
      style="background:#1C2D52;border-radius:10px;padding:12px;cursor:pointer;border:1px solid transparent"
      onmouseenter="this.style.borderColor='rgba(212,168,83,0.3)'" onmouseleave="this.style.borderColor='transparent'">
      <div style="font-size:13px;font-weight:600;color:#fff">${escapeHtml(item.label)}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">${escapeHtml(item.sub)}</div>
    </div>
  `).join('');

  _pickerItems = items;
  list.querySelectorAll('[data-picker-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.pickerIdx);
      selectProperti(_pickerItems[idx].value);
    });
  });
}

function selectProperti(value) {
  const input = document.getElementById('lead-minat');
  if (input) input.value = value;
  closePropertiPicker();
}
// ─────────────────────────────────────────────────────────

function toggleLeadKeterangan(sumber) {
  const input = document.getElementById('lead-keterangan');
  if (!input) return;
  const aktif = ['Portal Prop', 'Offline'].includes(sumber);
  input.disabled = !aktif;
  input.style.opacity = aktif ? '1' : '0.4';
  input.style.cursor = aktif ? 'text' : 'not-allowed';
  if (!aktif) input.value = '';
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
    Keterangan:        getVal('lead-keterangan') || 'False',
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
  if (target) { target.style.display = 'block'; target.scrollTop = 0; window.scrollTo(0,0); document.querySelector('main')?.scrollTo(0,0); }

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.className = b.id === `nav-${page}` ? 'nav-btn active' : 'nav-btn';
  });

  const titles = { dashboard:'Dashboard', listings:'Listing Properti', leads:'Manajemen Leads', tasks:'Jadwal & Tasks', member:'Member Kantor', primary:'Primary' };
  setEl('page-title', titles[page] || page);
  STATE.currentPage = page;

  // Close notif panel
  const np = document.getElementById('notif-panel');
  if (np) np.style.display = 'none';

  if (page === 'dashboard') await loadDashboard();
  // Reset lead filter saat keluar dari leads
  if (page !== 'leads' && _leadFilter === 'mine') {
    _leadFilter = 'all';
  }
  if (page === 'listings')  await loadListings();
  if (page === 'leads') {
    // Tampilkan tab Leads Saya untuk principal & superadmin
    const mineTab = document.getElementById('leads-tab-mine');
    if (mineTab) {
      mineTab.style.display = ['principal','superadmin','business_manager'].includes(STATE.user?.role) ? '' : 'none';
    }
    await loadLeads();
  }
  if (page === 'tasks')     await loadTasks();
  if (page === 'team')      await loadTeamPage();
  if (page === 'primary')   await loadPrimaryPage();
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

    // Sembunyikan Kantor Pusat (nama_kantor = "0" atau kosong) untuk agen/koordinator/BM
    const role = STATE.user?.role;
    const hideKantorPusat = ['agen', 'koordinator', 'business_manager'].includes(role);
    const isAdminGroup = (nama) => {
      const s = (nama || '').trim();
      const raw = s.replace(/^MANSION\s*:\s*/i, '').trim().toLowerCase();
      return !raw || raw === '0' || raw === 'kantor pusat' || raw === 'administrator' || s === '0';
    };
    const filtered = hideKantorPusat
      ? _officesData.filter(o => !isAdminGroup(o.nama_kantor))
      : _officesData;

    renderOffices(filtered);
  } catch(e) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(239,68,68,0.7);font-size:13px">Gagal memuat data kantor</div>`;
  }
  setTimeout(() => {
    document.querySelector('main')?.scrollTo(0, 0);
  }, 50);
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
  const namaBesar = office.nama_kantor.replace(/^MANSION\s*:\s*/i,'').trim() || 'Administrator';
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
  const role = STATE.user?.role;
  const hideKantorPusat = ['agen', 'koordinator', 'business_manager'].includes(role);

  // Base data — sudah difilter tanpa Kantor Pusat kalau perlu
  const isAdminGroup = (nama) => {
    const s = (nama || '').trim();
    const raw = s.replace(/^MANSION\s*:\s*/i, '').trim().toLowerCase();
    return !raw || raw === '0' || raw === 'kantor pusat' || raw === 'administrator' || s === '0';
  };
  const base = hideKantorPusat
    ? _officesData.filter(o => !isAdminGroup(o.nama_kantor))
    : _officesData;

  if (!q.trim()) { renderOffices(base); return; }
  const kw = q.toLowerCase();
  const filtered = base.map(o => ({
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
  STATE._notifInterval = setInterval(() => { if (STATE.token) API.get('/notifications/unread-count').then(r => updateNotifBadge(r.count||0)).catch(()=>{}); }, 60000);
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
  el.style.display = 'block'; el.classList.add('open');
  el.scrollTop = 0; // selalu mulai dari atas
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
  if (n >= 1_000_000_000) {
    const v = parseFloat((n/1_000_000_000).toFixed(3));
    return `Rp ${v.toLocaleString('id-ID', {maximumFractionDigits:3})} M`;
  }
  if (n >= 1_000_000) {
    const v = parseFloat((n/1_000_000).toFixed(3));
    return `Rp ${v.toLocaleString('id-ID', {maximumFractionDigits:3})} Jt`;
  }
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
    const roleColor = { superadmin:'#EF4444', principal:'#F97316', business_manager:'#A855F7', admin:'#D4A853', agen:'#4ade80', koordinator:'#22d3ee' };
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
            <span style="font-size:9px;padding:2px 7px;border-radius:5px;background:${roleColor[u.Role]||'#6B7280'}18;color:${roleColor[u.Role]||'#6B7280'};font-weight:600">${{ superadmin:'Super Admin', principal:'Principal', business_manager:'Business Mgr', admin:'Admin', agen:'Agen', koordinator:'Koordinator' }[u.Role] || u.Role || 'agen'}</span>
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
  const _pRoles = ['superadmin','principal','admin','agen','business_manager','koordinator'];
  if (_pRoles.includes(STATE.user?.role)) {
    document.getElementById('nav-primary')?.style.removeProperty('display');
    document.getElementById('sb-primary')?.style.removeProperty('display');
  }
  if (['superadmin','principal','admin'].includes(STATE.user?.role)) {
    const _ab = document.getElementById('btn-add-project');
    if (_ab) _ab.style.display = 'flex';
  }
  const role = STATE.user?.role;
  const btn = document.getElementById('sidebar-user-mgmt');
  if (btn && ['admin','principal','superadmin'].includes(role)) btn.style.display = 'flex';
  const btnTeam = document.getElementById('sidebar-team-mgmt');
  if (btnTeam && ['principal','superadmin'].includes(role)) btnTeam.style.display = 'flex';
  const navTeam = document.getElementById('nav-team');
  if (navTeam && ['principal','business_manager','superadmin'].includes(role)) navTeam.style.display = 'flex';
  const roleBadge = document.getElementById('sidebar-role-badge');
  const roleLabel = { superadmin:'Super Admin', principal:'Principal', business_manager:'Business Manager', admin:'Admin', agen:'Agen', koordinator:'Koordinator' };
  if (roleBadge) roleBadge.textContent = roleLabel[role] || role;

  // Admin tidak bisa akses Leads — sembunyikan nav & sidebar
  const navLeads = document.getElementById('nav-leads');
  const sbLeads  = document.getElementById('sb-leads');
  if (role === 'admin') {
    if (navLeads) navLeads.style.display = 'none';
    if (sbLeads)  sbLeads.style.display  = 'none';
  } else {
    if (navLeads) navLeads.style.removeProperty('display');
    if (sbLeads)  sbLeads.style.removeProperty('display');
  }
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
    const [teamsRes, leadsStatsRes, listingStatsRes, agentsRes] = await Promise.allSettled([
      API.get('/teams'),
      API.get('/leads/stats/by-agent'),
      API.get('/listings/stats/by-agent'),
      API.get('/agents'),
    ]);

    const teams = teamsRes.status === 'fulfilled' ? (teamsRes.value?.data || []) : [];
    const leadsStats = leadsStatsRes.status === 'fulfilled' ? (leadsStatsRes.value?.data || []) : [];
    const listingStats = listingStatsRes.status === 'fulfilled' ? (listingStatsRes.value?.data || []) : [];
    const agentsList = agentsRes.status === 'fulfilled' ? (agentsRes.value?.data || []) : [];

    // Build name map: agentId → Nama
    const nameMap = {};
    agentsList.forEach(a => { if(a.ID) nameMap[a.ID] = a.Nama; if(a.id) nameMap[a.id] = a.Nama; });

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
              const ls = leadMap[agentId] || { agen_nama: nameMap[agentId] || '(Akun Dihapus)', total: 0, hot: 0, deal: 0 };
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

// ── Hapus Team ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════
// PRIMARY FEATURE — app-mobile.js patch
// Tambahkan di bagian bawah app-mobile.js
// ════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let _projectsData       = [];     // cache semua proyek
let _currentProjectId   = null;   // proyek yang sedang dibuka
let _projectPhotoSlot   = 1;      // slot foto yang sedang diupload
let _projectPhotos      = { 1: { url: '', cloudId: '' }, 2: { url: '', cloudId: '' } };
let _projectBundle      = null;   // sosmed bundle dari API
const MANAGE_ROLES_PRIMARY = ['superadmin', 'principal', 'admin', 'koordinator'];
let _korModalSlot = 1;          // slot koordinator yang sedang diedit
let _korCandidates = [];        // cache kandidat koordinator

// ─────────────────────────────────────────────────────────
// NAVIGATION HOOK — integrasi ke navigateTo()
// Tambahkan ke dalam switch/case navigateTo yang sudah ada
// ─────────────────────────────────────────────────────────
// Di dalam navigateTo(page), tambahkan case:
//   case 'primary': loadPrimaryPage(); break;
//
// Di checkAdminMenu(), tambahkan:
//   if (['superadmin','principal','admin','agen'].includes(role)) {
//     document.getElementById('nav-primary')?.style.removeProperty('display');
//     document.getElementById('sb-primary')?.style.removeProperty('display');
//   }
//   if (MANAGE_ROLES_PRIMARY.includes(role)) {
//     document.getElementById('btn-add-project')?.style.removeProperty('display');
//     document.getElementById('primary-filter-status').style.display = '';
//     document.getElementById('pd-admin-actions').style.display = '';
//   }

// ─────────────────────────────────────────────────────────
// LOAD PAGE
// ─────────────────────────────────────────────────────────
async function loadPrimaryPage() {
  const role      = STATE.user?.role;
  const canManage = MANAGE_ROLES_PRIMARY.includes(role);
  const canFilter = ['superadmin', 'principal', 'admin'].includes(role);

  const addBtn = document.getElementById('btn-add-project');
  if (addBtn) addBtn.style.display = canManage ? 'flex' : 'none';

  const filterStatus = document.getElementById('primary-filter-status');
  if (filterStatus) filterStatus.style.display = canFilter ? '' : 'none';

  await fetchProjects();
}

async function fetchProjects(silent = false) {
  if (!silent) renderProjectSkeletons();
  try {
    const params = new URLSearchParams();
    const role = STATE.user?.role;
    if (role === 'agen') params.set('status', 'Publish');
    const search = document.getElementById('primary-search')?.value?.trim();
    const tipe   = document.getElementById('primary-filter-tipe')?.value;
    const status = document.getElementById('primary-filter-status')?.value;
    if (search) params.set('search', search);
    if (tipe)   params.set('tipe', tipe);
    if (status) params.set('status', status);

    const res = await API.get('/projects?' + params.toString());
    _projectsData = res.data || [];
    renderProjectGrid(_projectsData);
  } catch (e) {
    showToast('Gagal load proyek: ' + e.message, 'error');
    renderProjectGrid([]);
  }
}

function renderProjectSkeletons() {
  const grid = document.getElementById('primary-grid');
  if (!grid) return;
  grid.innerHTML = [1, 2, 3].map(() =>
    `<div style="height:280px;border-radius:16px;background:rgba(255,255,255,0.04);animation:pulse 1.5s infinite"></div>`
  ).join('');
  document.getElementById('primary-empty').style.display = 'none';
}

function renderProjectGrid(projects) {
  const grid  = document.getElementById('primary-grid');
  const empty = document.getElementById('primary-empty');
  if (!grid) return;

  if (!projects.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = projects.map(p => buildProjectCard(p)).join('');
}

function buildProjectCard(p) {
  const statusColor = p.Status === 'Publish' ? '#4ade80' : '#94a3b8';
  const statusBg    = p.Status === 'Publish' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.1)';
  const tipeEmoji   = { Rumah: '🏡', Ruko: '🏪', Apartemen: '🏢', Gudang: '🏭' }[p.Tipe_Properti] || '🏠';
  const foto        = p.Foto_1_URL || '';
  const cara        = p.Cara_Bayar ? p.Cara_Bayar.split(',').join(' · ') : '—';
  const spColor     = p.Status_Project === 'Pending' ? '#fbbf24' : p.Status_Project === 'Nonaktif' ? '#f87171' : '#4ade80';
  const spBg        = p.Status_Project === 'Pending' ? 'rgba(251,191,36,0.12)' : p.Status_Project === 'Nonaktif' ? 'rgba(248,113,113,0.12)' : 'rgba(34,197,94,0.1)';
  const korNama     = [p.Koordinator_Nama, p.Koordinator2_Nama].filter(Boolean).join(' & ') || '';

  return `
  <div onclick="openProjectDetail('${escapeHtml(p.ID)}')"
    style="background:#0D1E36;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;cursor:pointer;transition:all 0.2s"
    onmouseenter="this.style.borderColor='rgba(212,168,83,0.35)'"
    onmouseleave="this.style.borderColor='rgba(255,255,255,0.07)'">

    <!-- Foto -->
    <div style="height:160px;background:#131F38;position:relative;overflow:hidden">
      ${foto
        ? `<img src="${escapeHtml(foto)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:40px">${tipeEmoji}</div>`}
      <!-- Status badge -->
      <span style="position:absolute;top:10px;left:10px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${statusBg};color:${statusColor};border:1px solid ${statusColor}33">
        ${p.Status || 'Draft'}
      </span>
      ${p.Status_Project ? `<span style="position:absolute;top:10px;left:${p.Status === 'Publish' ? '80px' : '72px'};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${spBg};color:${spColor};border:1px solid ${spColor}33">${p.Status_Project}</span>` : ''}
      ${p.Foto_2_URL
        ? `<img src="${escapeHtml(p.Foto_2_URL)}" style="position:absolute;bottom:8px;right:8px;width:46px;height:46px;border-radius:8px;object-fit:cover;border:2px solid rgba(255,255,255,0.2)"/>`
        : ''}
    </div>

    <!-- Content -->
    <div style="padding:14px">
      <p style="color:rgba(255,255,255,0.4);font-size:10px;margin:0 0 3px;text-transform:uppercase;letter-spacing:1px">${escapeHtml(p.Kode_Proyek)}</p>
      <h3 style="font-family:'DM Serif Display',serif;font-size:15px;color:#fff;margin:0 0 3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(p.Nama_Proyek)}</h3>
      <p style="color:#D4A853;font-size:12px;font-weight:600;margin:0 0 10px">${escapeHtml(p.Nama_Developer)}</p>

      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <p style="color:#fff;font-size:14px;font-weight:700;margin:0">${escapeHtml(p.Harga_Format || 'On Request')}</p>
          <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:2px 0 0">${tipeEmoji} ${escapeHtml(p.Tipe_Properti)} · ${escapeHtml(cara)}</p>
          ${korNama ? `<p style="color:rgba(212,168,83,0.7);font-size:10px;margin:3px 0 0"><i class="fa-solid fa-user-tie" style="font-size:9px;margin-right:3px"></i>${escapeHtml(korNama)}</p>` : ''}
        </div>
        <div style="background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.2);border-radius:8px;padding:6px 12px;font-size:12px;color:#D4A853;font-weight:600">
          Detail →
        </div>
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────
// FILTER
// ─────────────────────────────────────────────────────────
function filterProjects() {
  if (!_projectsData?.length) return;
  const search = (document.getElementById('primary-search')?.value || '').toLowerCase();
  const tipe   = document.getElementById('primary-filter-tipe')?.value || '';
  const status = document.getElementById('primary-filter-status')?.value || '';

  const filtered = _projectsData.filter(p => {
    const matchSearch = !search || [p.Nama_Proyek, p.Nama_Developer, p.Deskripsi].join(' ').toLowerCase().includes(search);
    const matchTipe   = !tipe   || p.Tipe_Properti === tipe;
    const matchStatus = !status || p.Status === status;
    return matchSearch && matchTipe && matchStatus;
  });

  renderProjectGrid(filtered);
}

// ─────────────────────────────────────────────────────────
// DETAIL MODAL
// ─────────────────────────────────────────────────────────
async function openProjectDetail(id) {
  _currentProjectId = id;
  const project = _projectsData.find(p => p.ID === id) || await loadProjectById(id);
  if (!project) return showToast('Proyek tidak ditemukan', 'error');

  // Isi konten
  setEl('pd-nama-proyek', project.Nama_Proyek || '');
  setEl('pd-developer',   project.Nama_Developer || '');
  setEl('pd-harga',       project.Harga_Format || project.Harga_Mulai || 'On Request');
  setEl('pd-deskripsi',   project.Deskripsi || '(tidak ada deskripsi)');
  setEl('pd-tipe-badge',  (({ Rumah: '🏡', Ruko: '🏪', Apartemen: '🏢', Gudang: '🏭' }[project.Tipe_Properti] || '🏠') + ' ' + (project.Tipe_Properti || '')));
  setEl('pd-cara-badge',  '💳 ' + (project.Cara_Bayar || '').replace(/,/g, ' · ') || '—');

  // Status badge
  const badge = document.getElementById('pd-status-badge');
  if (badge) {
    badge.textContent = project.Status || 'Draft';
    badge.style.cssText = project.Status === 'Publish'
      ? 'position:absolute;top:12px;left:12px;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4)'
      : 'position:absolute;top:12px;left:12px;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(148,163,184,0.15);color:#94a3b8;border:1px solid rgba(148,163,184,0.3)';
  }

  // Foto
  const foto1 = document.getElementById('pd-foto1');
  const foto2 = document.getElementById('pd-foto2-thumb');
  if (foto1) {
    if (project.Foto_1_URL) { foto1.src = project.Foto_1_URL; foto1.style.display = ''; }
    else { foto1.style.display = 'none'; }
  }
  if (foto2) {
    if (project.Foto_2_URL) { foto2.src = project.Foto_2_URL; foto2.style.display = ''; }
    else { foto2.style.display = 'none'; }
  }

  // Admin actions visibility
  const role          = STATE.user?.role;
  const canManage      = MANAGE_ROLES_PRIMARY.includes(role);
  const canManageNoKor = ['superadmin', 'principal', 'admin'].includes(role);
  // Koordinator bisa edit proyek miliknya sendiri
  const isOwnProject   = role === 'koordinator' && (
    project.Koordinator_ID  === STATE.user?.id ||
    project.Koordinator2_ID === STATE.user?.id
  );
  const canEdit = canManageNoKor || isOwnProject;

  const adminDiv = document.getElementById('pd-admin-actions');
  if (adminDiv) adminDiv.style.display = canEdit ? 'flex' : 'none';

  // Tombol Edit: koordinator proyek sendiri + admin/principal/SA
  const editBtn = document.getElementById('pd-edit-btn');
  if (editBtn) editBtn.style.display = canEdit ? '' : 'none';

  // Tombol Publish: hanya admin/principal/SA
  const pubBtn = document.getElementById('pd-publish-btn');
  if (pubBtn) {
    pubBtn.style.display = canManageNoKor ? '' : 'none';
    pubBtn.textContent = project.Status === 'Publish' ? '📴 Sembunyikan' : '🌐 Publish';
    pubBtn.style.color = project.Status === 'Publish' ? '#f87171' : '#4ade80';
  }

  const delBtn = document.getElementById('pd-delete-btn');
  if (delBtn) delBtn.style.display = canManageNoKor ? '' : 'none';

  // Badge Status_Project
  const spBadge = document.getElementById('pd-status-project-badge');
  if (spBadge && project.Status_Project) {
    const spColor = project.Status_Project === 'Pending' ? '#fbbf24' : project.Status_Project === 'Nonaktif' ? '#f87171' : '#4ade80';
    const spBg    = project.Status_Project === 'Pending' ? 'rgba(251,191,36,0.2)' : project.Status_Project === 'Nonaktif' ? 'rgba(248,113,113,0.15)' : 'rgba(34,197,94,0.15)';
    spBadge.textContent = project.Status_Project;
    spBadge.style.cssText = `position:absolute;top:12px;left:80px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${spBg};color:${spColor};border:1px solid ${spColor}44;display:block`;
  } else if (spBadge) { spBadge.style.display = 'none'; }

  // Seksi koordinator
  const korSection = document.getElementById('pd-koordinator-section');
  const hasKor = project.Koordinator_ID || project.Koordinator2_ID;
  if (korSection) korSection.style.display = (hasKor || canManageNoKor) ? '' : 'none';
  setEl('pd-kor1-nama', project.Koordinator_Nama  || '(belum ada)');
  setEl('pd-kor2-nama', project.Koordinator2_Nama || '(belum ada)');
  const kor1Btn = document.getElementById('pd-kor1-btn');
  const kor2Btn = document.getElementById('pd-kor2-btn');
  if (kor1Btn) kor1Btn.style.display = canManageNoKor ? '' : 'none';
  if (kor2Btn) kor2Btn.style.display = canManageNoKor ? '' : 'none';

  // Tombol Approve — hanya principal/SA saat Status_Project=Pending
  const approveSection = document.getElementById('pd-approve-section');
  if (approveSection) {
    const canApprove = ['superadmin', 'principal'].includes(role) && project.Status_Project === 'Pending';
    approveSection.style.display = canApprove ? '' : 'none';
  }

  // Referral section — principal/superadmin only
  const refSection = document.getElementById('pd-referral-section');
  if (refSection) refSection.style.display = ['superadmin','principal'].includes(role) ? '' : 'none';

  // Hit agen section — koordinator proyek, principal, SA
  const hitSection = document.getElementById('pd-hit-section');
  const hitList    = document.getElementById('pd-hit-list');
  if (hitSection) {
    const canSeeHit = ['superadmin','principal'].includes(role) ||
      (role === 'koordinator' && (project.Koordinator_ID === STATE.user?.id || project.Koordinator2_ID === STATE.user?.id));
    // Sederhananya: koordinator dan ke atas semua bisa lihat
    hitSection.style.display = ['superadmin','principal','admin','koordinator'].includes(role) ? '' : 'none';
  }
  if (hitList) hitList.innerHTML = ''; // reset setiap buka

  // Reset shortlink box
  document.getElementById('pd-shortlink-box').style.display = 'none';
  document.getElementById('pd-referral-list').innerHTML = '';

  openModal('modal-project-detail');
}

async function loadProjectById(id) {
  try {
    const res = await API.get('/projects/' + id);
    return res.data;
  } catch { return null; }
}

function toggleDetailPhoto() {
  const f1 = document.getElementById('pd-foto1');
  const f2 = document.getElementById('pd-foto2-thumb');
  if (!f1 || !f2) return;
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  if (!project?.Foto_2_URL) return;
  const cur = f1.src;
  f1.src = cur === project.Foto_1_URL ? project.Foto_2_URL : project.Foto_1_URL;
}

// ─────────────────────────────────────────────────────────
// SHORTLINK
// ─────────────────────────────────────────────────────────
async function generateProjectShortlink() {
  if (!_currentProjectId) return;
  try {
    showToast('Membuat shortlink...', 'info');
    const res = await API.get('/projects/' + _currentProjectId + '/shortlink');
    const ref = res.data;

    const box     = document.getElementById('pd-shortlink-box');
    const urlCode = document.getElementById('pd-shortlink-url');
    if (box && urlCode) {
      urlCode.textContent = ref.Short_URL || '';
      box.style.display   = '';
    }
    showToast('✅ Shortlink siap!', 'success');
  } catch (e) {
    showToast('Gagal buat shortlink: ' + e.message, 'error');
  }
}

async function copyProjectShortlink() {
  const url = document.getElementById('pd-shortlink-url')?.textContent;
  if (!url) return;
  try { await navigator.clipboard.writeText(url); }
  catch { document.execCommand('copy'); }
  showToast('✅ Shortlink disalin!', 'success');
}

// ─────────────────────────────────────────────────────────
// REFERRAL STATS
// ─────────────────────────────────────────────────────────
async function loadReferralStats() {
  if (!_currentProjectId) return;
  const list = document.getElementById('pd-referral-list');
  if (!list) return;
  list.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:12px;text-align:center;padding:8px">Memuat...</p>';
  try {
    const res  = await API.get('/projects/' + _currentProjectId + '/referrals');
    const data = res.data || [];
    if (!data.length) {
      list.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:8px">Belum ada klik</p>';
      return;
    }
    list.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden">
        <div style="padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between">
          <span style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px">Agen</span>
          <span style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px">Klik</span>
        </div>
        ${data.map((r, i) => `
          <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:#D4A853;font-weight:700;min-width:20px">#${i + 1}</span>
              <span style="color:#fff;font-size:13px">${escapeHtml(r.Agen_Nama || r.Agen_ID)}</span>
            </div>
            <span style="color:#D4A853;font-size:14px;font-weight:700">${r.Click_Count || 0}</span>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    list.innerHTML = `<p style="color:#ef4444;font-size:12px;text-align:center">${e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────
// SHARE WA
// ─────────────────────────────────────────────────────────
async function shareProjectWA() {
  if (!_currentProjectId) return;
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  if (!project) return;

  let shortUrl = '';
  try {
    const r = await API.get('/projects/' + _currentProjectId + '/shortlink');
    shortUrl = r.data?.Short_URL || '';
  } catch (_) {}

  const tipeEmoji = { Rumah: '🏡', Ruko: '🏪', Apartemen: '🏢', Gudang: '🏭' }[project.Tipe_Properti] || '🏠';
  const cara      = (project.Cara_Bayar || '').replace(/,/g, ', ');

  const text = `${tipeEmoji} *${project.Nama_Proyek}*\n`
    + `Developer: *${project.Nama_Developer}*\n`
    + `Tipe: ${project.Tipe_Properti} | Mulai *${project.Harga_Format || 'On Request'}*\n`
    + `💳 ${cara}\n\n`
    + (project.Deskripsi ? project.Deskripsi.slice(0, 250) + (project.Deskripsi.length > 250 ? '...' : '') + '\n\n' : '')
    + (shortUrl ? `🔗 Info lengkap: ${shortUrl}\n\n` : '')
    + `📞 Hubungi saya untuk info & jadwal survei!`;

  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');

  // Log share project WA
  _logShare('project', project.ID, project.Nama_Proyek || '', 'wa', project.Koordinator_ID || '');
}

// ─────────────────────────────────────────────────────────
// SIAPKAN KONTEN (sosmed bundle)
// ─────────────────────────────────────────────────────────
async function openProjectContent() {
  if (!_currentProjectId) return;
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  if (!project) return;

  setEl('pc-project-name', project.Nama_Proyek + ' — ' + project.Nama_Developer);

  // Foto
  const f1 = document.getElementById('pc-foto1');
  const f2 = document.getElementById('pc-foto2');
  if (f1) { f1.src = project.Foto_1_URL || ''; f1.style.display = project.Foto_1_URL ? '' : 'none'; }
  if (f2) { f2.src = project.Foto_2_URL || ''; f2.style.display = project.Foto_2_URL ? '' : 'none'; }

  // Load bundle
  try {
    const res = await API.get('/projects/' + _currentProjectId + '/bundle');
    _projectBundle = res.data;
  } catch (_) {
    _projectBundle = null;
  }

  // Reset platform tabs
  document.querySelectorAll('.platform-tab[data-pkey]').forEach(b => {
    b.style.cssText = 'background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.08);padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer';
  });
  const igTab = document.querySelector('.platform-tab[data-pkey="instagram"]');
  if (igTab) igTab.style.cssText = 'background:rgba(212,168,83,0.15);color:#D4A853;border:1px solid rgba(212,168,83,0.3);padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer';

  switchProjectPlatform('instagram');
  openModal('modal-project-content');
}

function switchProjectPlatform(key) {
  document.querySelectorAll('.platform-tab[data-pkey]').forEach(b => {
    b.style.cssText = 'background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.08);padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer';
  });
  const active = document.querySelector(`.platform-tab[data-pkey="${key}"]`);
  if (active) active.style.cssText = 'background:rgba(212,168,83,0.15);color:#D4A853;border:1px solid rgba(212,168,83,0.3);padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer';

  const captionEl = document.getElementById('pc-caption-display');
  if (captionEl && _projectBundle) {
    const keyMap = { instagram: 'caption_ig', facebook: 'caption_fb', tiktok: 'caption_tiktok', wa: 'caption_wa' };
    captionEl.textContent = _projectBundle[keyMap[key]] || '—';
  }
}

async function copyProjectCaption() {
  const text = document.getElementById('pc-caption-display')?.textContent;
  if (!text || text === '—') return showToast('Tidak ada caption', 'error');
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' }); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  showToast('✅ Caption disalin!', 'success');

  // Log share — deteksi platform aktif
  if (_currentProjectId) {
    const project  = _projectsData.find(p => p.ID === _currentProjectId);
    const activeTab = document.querySelector('.platform-tab[data-pkey][style*="D4A853"]');
    const platform  = activeTab?.dataset?.pkey || 'instagram'; // wa | instagram | facebook | tiktok
    _logShare('project', _currentProjectId, project?.Nama_Proyek || '', platform, project?.Koordinator_ID || '');
  }
}

async function regenerateProjectCaption() {
  if (!_currentProjectId) return;
  try {
    showToast('Generating caption...', 'info');
    const res = await API.post('/projects/' + _currentProjectId + '/caption', {});
    _projectBundle = res.data;

    // Find active platform
    const active = document.querySelector('.platform-tab[data-pkey][style*="D4A853"]');
    const key = active?.dataset?.pkey || 'instagram';
    switchProjectPlatform(key);

    showToast('✅ Caption baru siap!', 'success');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// FORM: TAMBAH / EDIT
// ─────────────────────────────────────────────────────────
function openAddProject() {
  _projectPhotos = { 1: { url: '', cloudId: '' }, 2: { url: '', cloudId: '' } };
  document.getElementById('project-form-id').value    = '';
  document.getElementById('project-form-title').textContent = '⭐ Tambah Proyek Primary';
  document.getElementById('project-form-btn-text').textContent = '💾 Simpan Proyek';
  document.getElementById('pf-nama-proyek').value     = '';
  document.getElementById('pf-nama-developer').value  = '';
  document.getElementById('pf-tipe').value            = 'Rumah';
  document.getElementById('pf-harga').value           = '';
  document.getElementById('pf-harga-preview').textContent = '';
  document.getElementById('pf-deskripsi').value       = '';
  document.getElementById('pf-notes').value           = '';
  document.querySelectorAll('.pf-cara').forEach(cb => cb.checked = false);
  resetProjectPhotoPreview(1);
  resetProjectPhotoPreview(2);

  // Koordinator field: auto-fill untuk role koordinator
  const role = STATE.user?.role;
  const korWrap = document.getElementById('pf-koordinator-wrap');
  if (korWrap) {
    korWrap.style.display = role === 'koordinator' ? '' : 'none';
    if (role === 'koordinator') {
      document.getElementById('pf-koordinator-nama').value = STATE.user?.nama || '';
      document.getElementById('pf-koordinator-id').value   = STATE.user?.id   || '';
    }
  }

  openModal('modal-project-form');
}

function editCurrentProject() {
  if (!_currentProjectId) return;
  const p = _projectsData.find(pr => pr.ID === _currentProjectId);
  if (!p) return;

  closeModal('modal-project-detail');

  document.getElementById('project-form-id').value    = p.ID;
  document.getElementById('project-form-title').textContent = '✏️ Edit Proyek';
  document.getElementById('project-form-btn-text').textContent = '💾 Simpan Perubahan';
  document.getElementById('pf-nama-proyek').value     = p.Nama_Proyek   || '';
  document.getElementById('pf-nama-developer').value  = p.Nama_Developer|| '';
  document.getElementById('pf-tipe').value            = p.Tipe_Properti || 'Rumah';
  document.getElementById('pf-harga').value           = p.Harga_Mulai   || '';
  document.getElementById('pf-harga-preview').textContent = p.Harga_Format || '';
  document.getElementById('pf-deskripsi').value       = p.Deskripsi     || '';
  document.getElementById('pf-notes').value           = p.Notes         || '';

  // Cara bayar checkboxes
  const caraBayar = (p.Cara_Bayar || '').split(',').map(c => c.trim());
  document.querySelectorAll('.pf-cara').forEach(cb => {
    cb.checked = caraBayar.includes(cb.value);
  });

  // Foto previews
  _projectPhotos = {
    1: { url: p.Foto_1_URL || '', cloudId: '' },
    2: { url: p.Foto_2_URL || '', cloudId: '' },
  };
  setProjectPhotoPreview(1, p.Foto_1_URL || '');
  setProjectPhotoPreview(2, p.Foto_2_URL || '');

  openModal('modal-project-form');
}

function formatHargaInput(el) {
  const raw = el.value.replace(/[^0-9]/g, '');
  el.value = raw;
  const preview = document.getElementById('pf-harga-preview');
  if (!preview) return;
  const num = parseInt(raw) || 0;
  if (!num) { preview.textContent = ''; return; }
  if (num >= 1_000_000_000) preview.textContent = `≈ Rp ${(num / 1_000_000_000).toFixed(1)} M`;
  else if (num >= 1_000_000) preview.textContent = `≈ Rp ${Math.floor(num / 1_000_000)} Jt`;
  else preview.textContent = `≈ Rp ${num.toLocaleString('id-ID')}`;
}

// Preview harga format untuk field add-harga & add-harga-permeter (tanpa pembulatan)
function previewHargaFormat(el, previewId) {
  const raw = el.value.replace(/[^0-9]/g, '');
  // Jangan ubah nilai input — tulis ulang hanya digits (tidak ada pembulatan)
  // Preserve posisi cursor
  const pos = el.selectionStart - (el.value.length - raw.length);
  el.value = raw;
  try { el.setSelectionRange(pos, pos); } catch(_) {}
  const preview = document.getElementById(previewId);
  if (!preview) return;
  const num = parseInt(raw) || 0;
  if (!num) { preview.textContent = ''; return; }
  if (num >= 1_000_000_000) preview.textContent = `Rp ${(num / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')} M`;
  else if (num >= 1_000_000) preview.textContent = `Rp ${(num / 1_000_000).toFixed(0)} Juta`;
  else preview.textContent = `Rp ${num.toLocaleString('id-ID')}`;
}

async function submitProjectForm() {
  const id  = document.getElementById('project-form-id').value?.trim();
  const btn = document.getElementById('project-form-btn-text');

  const body = {
    Nama_Proyek:    document.getElementById('pf-nama-proyek').value.trim(),
    Nama_Developer: document.getElementById('pf-nama-developer').value.trim(),
    Tipe_Properti:  document.getElementById('pf-tipe').value,
    Harga_Mulai:    document.getElementById('pf-harga').value.replace(/[^0-9]/g, ''),
    Deskripsi:      document.getElementById('pf-deskripsi').value.trim(),
    Notes:          document.getElementById('pf-notes').value.trim(),
    Cara_Bayar:     [...document.querySelectorAll('.pf-cara:checked')].map(cb => cb.value),
  };

  // Koordinator — hanya jika role koordinator dan ada nilainya
  const korId = document.getElementById('pf-koordinator-id')?.value?.trim();
  if (korId) {
    body.Koordinator_ID   = korId;
    body.Koordinator_Nama = document.getElementById('pf-koordinator-nama')?.value?.trim() || '';
  }

  if (!body.Nama_Proyek)    return showToast('Nama Proyek wajib diisi', 'error');
  if (!body.Nama_Developer) return showToast('Nama Developer wajib diisi', 'error');

  // Upload foto yang pending jika ada file baru
  await uploadPendingProjectPhotos();

  body.Foto_1_URL     = _projectPhotos[1].url || '';
  body.Foto_2_URL     = _projectPhotos[2].url || '';
  body.Cloudinary_IDs = [_projectPhotos[1].cloudId, _projectPhotos[2].cloudId].filter(Boolean);

  try {
    if (btn) btn.textContent = '⏳ Menyimpan...';
    let res;
    if (id) {
      res = await API.put('/projects/' + id, body);
    } else {
      res = await API.post('/projects', body);
    }
    closeModal('modal-project-form');
    showToast(res.message || '✅ Proyek disimpan!', 'success');
    await fetchProjects(true);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    if (btn) btn.textContent = id ? '💾 Simpan Perubahan' : '💾 Simpan Proyek';
  }
}

// ─────────────────────────────────────────────────────────
// PUBLISH TOGGLE
// ─────────────────────────────────────────────────────────
async function toggleProjectPublish() {
  if (!_currentProjectId) return;
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  if (!project) return;

  const newStatus = project.Status === 'Publish' ? 'Draft' : 'Publish';
  try {
    const res = await API.patch('/projects/' + _currentProjectId + '/publish', { status: newStatus });
    showToast(res.message || `Status diubah ke ${newStatus}`, 'success');

    // Update cache
    const idx = _projectsData.findIndex(p => p.ID === _currentProjectId);
    if (idx !== -1) _projectsData[idx] = { ..._projectsData[idx], Status: newStatus };

    // Update publish button
    const pubBtn = document.getElementById('pd-publish-btn');
    if (pubBtn) {
      pubBtn.textContent = newStatus === 'Publish' ? '📴 Sembunyikan' : '🌐 Publish';
      pubBtn.style.color = newStatus === 'Publish' ? '#f87171' : '#4ade80';
    }

    // Update badge
    const badge = document.getElementById('pd-status-badge');
    if (badge) {
      badge.textContent = newStatus;
      badge.style.background = newStatus === 'Publish' ? 'rgba(34,197,94,0.2)' : 'rgba(148,163,184,0.15)';
      badge.style.color      = newStatus === 'Publish' ? '#4ade80' : '#94a3b8';
    }

    renderProjectGrid(_projectsData);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────
async function deleteCurrentProject() {
  if (!_currentProjectId) return;
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  if (!confirm(`Hapus proyek "${project?.Nama_Proyek}"? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    await API.delete('/projects/' + _currentProjectId);
    closeModal('modal-project-detail');
    showToast('✅ Proyek dihapus', 'success');
    _projectsData = _projectsData.filter(p => p.ID !== _currentProjectId);
    _currentProjectId = null;
    renderProjectGrid(_projectsData);
  } catch (e) {
    showToast('Gagal hapus: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// APPROVE PROJECT (Principal / Superadmin)
// ─────────────────────────────────────────────────────────
async function approveProject() {
  if (!_currentProjectId) return;
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  if (!confirm(`Approve proyek "${project?.Nama_Proyek}"?\nProyek akan berstatus Aktif.`)) return;
  try {
    const res = await API.patch('/projects/' + _currentProjectId + '/approve', {});
    showToast(res.message || '✅ Proyek diapprove!', 'success');
    // Update cache & UI
    const idx = _projectsData.findIndex(p => p.ID === _currentProjectId);
    if (idx !== -1) _projectsData[idx] = { ..._projectsData[idx], Status_Project: 'Aktif' };
    document.getElementById('pd-approve-section').style.display = 'none';
    const spBadge = document.getElementById('pd-status-project-badge');
    if (spBadge) {
      spBadge.textContent = 'Aktif';
      spBadge.style.background = 'rgba(34,197,94,0.15)';
      spBadge.style.color = '#4ade80';
    }
    renderProjectGrid(_projectsData);
  } catch (e) {
    showToast('Gagal approve: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// KELOLA KOORDINATOR — Modal pilih slot 1 / 2
// ─────────────────────────────────────────────────────────
async function openKoordinatorModal(slot) {
  if (!_currentProjectId) return;
  _korModalSlot = slot;

  const project = _projectsData.find(p => p.ID === _currentProjectId);
  const titleEl = document.getElementById('kor-modal-title');
  if (titleEl) titleEl.textContent = `Koordinator Slot ${slot}${slot === 2 ? ' (Tandem)' : ''}`;

  // Tombol hapus slot — hanya tampil jika slot sudah terisi
  const clearBtn = document.getElementById('kor-clear-btn');
  const slotFilled = slot === 1 ? !!project?.Koordinator_ID : !!project?.Koordinator2_ID;
  if (clearBtn) clearBtn.style.display = slotFilled ? '' : 'none';

  // Reset search
  const searchEl = document.getElementById('kor-search');
  if (searchEl) searchEl.value = '';

  // Load kandidat
  const listEl = document.getElementById('kor-candidates-list');
  if (listEl) listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:20px;font-size:13px">Memuat...</p>';

  openModal('modal-koordinator');

  try {
    const res = await API.get('/projects/' + _currentProjectId + '/koordinator-candidates');
    _korCandidates = res.data || [];
    renderKoordinatorList(_korCandidates, project, slot);
  } catch (e) {
    if (listEl) listEl.innerHTML = `<p style="color:#ef4444;text-align:center;padding:20px;font-size:13px">${e.message}</p>`;
  }
}

function renderKoordinatorList(candidates, project, slot) {
  const listEl = document.getElementById('kor-candidates-list');
  if (!listEl) return;
  if (!candidates.length) {
    listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:20px;font-size:13px">Tidak ada kandidat</p>';
    return;
  }
  const activeId = slot === 1 ? project?.Koordinator_ID : project?.Koordinator2_ID;
  listEl.innerHTML = candidates.map(c => {
    const isActive = c.id === activeId;
    return `<div onclick="saveKoordinatorSlot('${c.id}', '${escapeHtml(c.nama)}')"
      style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:10px;cursor:pointer;transition:all 0.15s;background:${isActive ? 'rgba(212,168,83,0.12)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isActive ? 'rgba(212,168,83,0.3)' : 'rgba(255,255,255,0.06)'}"
      onmouseenter="this.style.background='rgba(212,168,83,0.08)'"
      onmouseleave="this.style.background='${isActive ? 'rgba(212,168,83,0.12)' : 'rgba(255,255,255,0.03)'}'">
      <div>
        <p style="color:${isActive ? '#D4A853' : '#fff'};font-size:13px;font-weight:600;margin:0">${escapeHtml(c.nama)}</p>
        <p style="color:rgba(255,255,255,0.35);font-size:11px;margin:2px 0 0">${escapeHtml(c.nama_kantor || '')} · ${c.role}</p>
      </div>
      ${isActive ? '<span style="color:#D4A853;font-size:12px">✓ Aktif</span>' : ''}
    </div>`;
  }).join('');
}

function filterKoordinatorList(query) {
  const project = _projectsData.find(p => p.ID === _currentProjectId);
  const q = query.toLowerCase();
  const filtered = q ? _korCandidates.filter(c =>
    c.nama.toLowerCase().includes(q) || (c.nama_kantor || '').toLowerCase().includes(q)
  ) : _korCandidates;
  renderKoordinatorList(filtered, project, _korModalSlot);
}

async function saveKoordinatorSlot(koordinatorId, koordinatorNama = '') {
  if (!_currentProjectId) return;
  try {
    const res = await API.patch('/projects/' + _currentProjectId + '/koordinator', {
      slot: _korModalSlot,
      koordinator_id: koordinatorId,
    });
    showToast(res.message || '✅ Koordinator disimpan', 'success');

    // Update cache & UI
    const idx = _projectsData.findIndex(p => p.ID === _currentProjectId);
    if (idx !== -1) {
      if (_korModalSlot === 1) {
        _projectsData[idx].Koordinator_ID   = koordinatorId;
        _projectsData[idx].Koordinator_Nama = koordinatorNama;
      } else {
        _projectsData[idx].Koordinator2_ID   = koordinatorId;
        _projectsData[idx].Koordinator2_Nama = koordinatorNama;
      }
    }
    setEl('pd-kor' + _korModalSlot + '-nama', koordinatorNama || '(belum ada)');
    closeModal('modal-koordinator');
    renderProjectGrid(_projectsData);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// FOTO UPLOAD
// ─────────────────────────────────────────────────────────
function triggerProjectPhotoUpload(slot) {
  _projectPhotoSlot = slot;
  const input = document.getElementById('pf-photo-input');
  if (input) { input.value = ''; input.click(); }
}

function handleProjectPhotoSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const slot = _projectPhotoSlot;
  const reader = new FileReader();
  reader.onload = (e) => {
    _projectPhotos[slot] = { url: '', cloudId: '', _file: file, _preview: e.target.result };
    setProjectPhotoPreview(slot, e.target.result);
  };
  reader.readAsDataURL(file);
}

function setProjectPhotoPreview(slot, src) {
  const preview = document.getElementById(`pf-foto${slot}-preview`);
  const delBtn  = document.getElementById(`pf-foto${slot}-del`);
  if (preview) { preview.src = src; preview.style.display = src ? '' : 'none'; }
  if (delBtn)  { delBtn.style.display = src ? '' : 'none'; }
}

function clearProjectPhoto(slot) {
  _projectPhotos[slot] = { url: '', cloudId: '' };
  resetProjectPhotoPreview(slot);
}

function resetProjectPhotoPreview(slot) {
  const preview = document.getElementById(`pf-foto${slot}-preview`);
  const delBtn  = document.getElementById(`pf-foto${slot}-del`);
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (delBtn)  { delBtn.style.display = 'none'; }
}

async function uploadPendingProjectPhotos() {
  const cloudName   = STATE.cloudinaryConfig?.cloudName;
  const uploadPreset = STATE.cloudinaryConfig?.uploadPreset || 'crm_unsigned';
  if (!cloudName) return;

  for (const slot of [1, 2]) {
    const photo = _projectPhotos[slot];
    if (!photo._file) {
      // Keep existing URL as-is
      continue;
    }
    try {
      showToast(`Mengupload foto ${slot}...`, 'info');
      const formData = new FormData();
      formData.append('file', photo._file);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', 'crm_projects');

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST', body: formData,
      });
      const data = await res.json();
      _projectPhotos[slot] = { url: data.secure_url, cloudId: data.public_id };
    } catch (e) {
      showToast(`Gagal upload foto ${slot}: ${e.message}`, 'error');
    }
  }
}


// ─────────────────────────────────────────────────────────
// FASE 4 — PRIMARY STATS DASHBOARD
// Koordinator: proyek miliknya + status
// Principal / SA: ringkasan semua proyek + koordinator + pending
// ─────────────────────────────────────────────────────────
async function loadPrimaryStats() {
  const container = document.getElementById('primary-stats-container');
  if (!container) return;

  const role = STATE.user?.role;
  container.style.display = '';
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="color:rgba(255,255,255,0.65);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em">
        ⭐ Primary — Proyek Developer
      </h3>
      <button onclick="navigateTo('primary')" style="color:rgba(212,168,83,0.8);font-size:11px;background:none;border:none;cursor:pointer">Lihat semua →</button>
    </div>
    <div style="height:64px;border-radius:14px;background:rgba(255,255,255,0.03);animation:pulse 1.5s infinite"></div>`;

  try {
    const res = await API.get('/projects');
    const projects = res.data || [];

    if (!projects.length) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="color:rgba(255,255,255,0.65);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em">⭐ Primary — Proyek Developer</h3>
          <button onclick="navigateTo('primary')" style="color:rgba(212,168,83,0.8);font-size:11px;background:none;border:none;cursor:pointer">Lihat semua →</button>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px;text-align:center;color:rgba(255,255,255,0.3);font-size:13px">
          Belum ada proyek
        </div>`;
      return;
    }

    if (role === 'koordinator') {
      _renderKoordinatorStats(container, projects);
    } else {
      _renderPrincipalStats(container, projects);
      // Load top hit data async setelah render selesai
      setTimeout(() => _loadTopProjectHits(), 200);
    }
  } catch (e) {
    container.innerHTML = `<div style="padding:12px;color:rgba(255,255,255,0.3);font-size:12px;text-align:center">Gagal load primary stats: ${e.message}</div>`;
  }
}

function _renderKoordinatorStats(container, projects) {
  // Hitung summary
  const total    = projects.length;
  const pending  = projects.filter(p => p.Status_Project === 'Pending').length;
  const aktif    = projects.filter(p => p.Status_Project === 'Aktif').length;
  const publish  = projects.filter(p => p.Status === 'Publish').length;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="color:rgba(255,255,255,0.65);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em">⭐ Daftar Primary Aktif</h3>
      <button onclick="navigateTo('primary')" style="color:rgba(212,168,83,0.8);font-size:11px;background:none;border:none;cursor:pointer">Kelola →</button>
    </div>

    <!-- Summary pills -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:5px 14px;font-size:12px;color:#fff">
        <span style="font-weight:700">${total}</span> <span style="color:rgba(255,255,255,0.45)">total</span>
      </div>
      ${pending > 0 ? `<div style="background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);border-radius:20px;padding:5px 14px;font-size:12px;color:#fbbf24">
        <span style="font-weight:700">${pending}</span> menunggu approval ⏳
      </div>` : ''}
      <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);border-radius:20px;padding:5px 14px;font-size:12px;color:#4ade80">
        <span style="font-weight:700">${aktif}</span> aktif
      </div>
      <div style="background:rgba(43,123,255,0.1);border:1px solid rgba(43,123,255,0.2);border-radius:20px;padding:5px 14px;font-size:12px;color:#60a5fa">
        <span style="font-weight:700">${publish}</span> publish
      </div>
    </div>

    <!-- Daftar proyek -->
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden">
      ${projects.slice(0, 5).map((p, i) => {
        const spColor = p.Status_Project === 'Pending' ? '#fbbf24' : p.Status_Project === 'Nonaktif' ? '#f87171' : '#4ade80';
        return `<div onclick="navigateTo('primary')" style="display:flex;align-items:center;gap:12px;padding:12px 14px;${i < Math.min(projects.length,5)-1 ? 'border-bottom:1px solid rgba(255,255,255,0.05)' : ''};cursor:pointer"
          onmouseenter="this.style.background='rgba(255,255,255,0.03)'"
          onmouseleave="this.style.background=''">
          <div style="flex:1;min-width:0">
            <p style="color:#fff;font-size:13px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.Nama_Proyek)}</p>
            <p style="color:rgba(255,255,255,0.35);font-size:11px;margin:2px 0 0">${escapeHtml(p.Nama_Developer)} · ${escapeHtml(p.Harga_Format || 'On Request')}</p>
          </div>
          <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:${spColor}18;color:${spColor};border:1px solid ${spColor}33;white-space:nowrap">
            ${p.Status_Project || 'Aktif'}
          </span>
        </div>`;
      }).join('')}
      ${projects.length > 5 ? `<div style="padding:10px 14px;text-align:center;border-top:1px solid rgba(255,255,255,0.05)">
        <button onclick="navigateTo('primary')" style="background:none;border:none;color:rgba(212,168,83,0.7);font-size:12px;cursor:pointer">+${projects.length - 5} proyek lainnya →</button>
      </div>` : ''}
    </div>`;
}

async function _loadTopProjectHits() {
  // Cari section setelah DOM rendered
  const hitSection = document.getElementById('primary-hit-section');
  if (!hitSection) return;

  hitSection.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)">
    <span style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px">🔥 Top 5 Proyek Terbanyak Di-Share</span>
  </div>
  <div style="padding:12px 14px;color:rgba(255,255,255,0.3);font-size:12px;text-align:center"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>`;

  try {
    const res  = await API.get('/share-log/top-projects?limit=5');
    const data = res.data || [];

    if (!data.length) {
      hitSection.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px">🔥 Top 5 Proyek Terbanyak Di-Share</span>
      </div>
      <div style="padding:16px 14px;color:rgba(255,255,255,0.25);font-size:12px;text-align:center">
        Belum ada aktivitas share proyek
      </div>`;
      return;
    }

    hitSection.innerHTML = `
      <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px">🔥 Top 5 Proyek Terbanyak Di-Share</span>
      </div>
      ${data.map((p, i) => `
        <div style="padding:11px 14px;${i < data.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.04)' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;font-weight:700;color:#D4A853;min-width:18px">#${i+1}</span>
              <span style="color:#fff;font-size:13px;font-weight:600">${escapeHtml(p.konten_nama)}</span>
            </div>
            <span style="background:rgba(212,168,83,0.12);border:1px solid rgba(212,168,83,0.25);border-radius:20px;padding:2px 10px;font-size:11px;color:#D4A853;font-weight:700">${p.total} hit</span>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;padding-left:26px">
            ${(p.agen_list || []).slice(0,5).map(a =>
              `<span style="font-size:10px;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.05);border-radius:10px;padding:2px 8px">${escapeHtml(a.nama)}</span>`
            ).join('')}
            ${p.agen_list?.length > 5 ? `<span style="font-size:10px;color:rgba(255,255,255,0.3)">+${p.agen_list.length-5} lainnya</span>` : ''}
          </div>
        </div>`).join('')}`;
  } catch (e) {
    if (hitSection) hitSection.innerHTML = `<div style="padding:12px 14px;color:rgba(255,255,255,0.25);font-size:12px;text-align:center">Gagal load hit data</div>`;
  }
}

function _renderPrincipalStats(container, projects) {
  // Hitung summary
  const total   = projects.length;
  const pending = projects.filter(p => p.Status_Project === 'Pending').length;
  const aktif   = projects.filter(p => p.Status_Project === 'Aktif').length;
  const publish = projects.filter(p => p.Status === 'Publish').length;

  // Kumpulkan koordinator unik
  const korMap = {};
  projects.forEach(p => {
    if (p.Koordinator_ID) korMap[p.Koordinator_ID] = {
      nama: p.Koordinator_Nama || p.Koordinator_ID,
      count: (korMap[p.Koordinator_ID]?.count || 0) + 1,
    };
    if (p.Koordinator2_ID) korMap[p.Koordinator2_ID] = {
      nama: p.Koordinator2_Nama || p.Koordinator2_ID,
      count: (korMap[p.Koordinator2_ID]?.count || 0) + 1,
    };
  });
  const korList = Object.values(korMap).sort((a, b) => b.count - a.count);

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="color:rgba(255,255,255,0.65);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em">⭐ Primary Overview</h3>
      <button onclick="navigateTo('primary')" style="color:rgba(212,168,83,0.8);font-size:11px;background:none;border:none;cursor:pointer">Kelola →</button>
    </div>

    <!-- Summary stats -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
      ${[
        { label: 'Total', value: total,   color: '#fff',    bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' },
        { label: 'Pending', value: pending, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
        { label: 'Aktif',   value: aktif,   color: '#4ade80', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.2)'   },
        { label: 'Publish', value: publish, color: '#60a5fa', bg: 'rgba(43,123,255,0.08)', border: 'rgba(43,123,255,0.2)'  },
      ].map(s => `
        <div style="background:${s.bg};border:1px solid ${s.border};border-radius:12px;padding:10px 8px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:${s.color}">${s.value}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px">${s.label}</div>
        </div>`).join('')}
    </div>

    ${pending > 0 ? `
    <!-- Pending approval alert -->
    <div onclick="navigateTo('primary')" style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.3);border-radius:12px;padding:12px 14px;margin-bottom:14px;cursor:pointer;display:flex;align-items:center;gap:10px">
      <span style="font-size:20px">⏳</span>
      <div style="flex:1">
        <p style="color:#fbbf24;font-size:13px;font-weight:700;margin:0">${pending} proyek menunggu approval</p>
        <p style="color:rgba(251,191,36,0.6);font-size:11px;margin:2px 0 0">Tap untuk review & approve</p>
      </div>
      <span style="color:rgba(251,191,36,0.5);font-size:16px">›</span>
    </div>` : ''}

    <!-- Koordinator aktif -->
    ${korList.length > 0 ? `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden;margin-bottom:14px">
      <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px">Koordinator Aktif</span>
      </div>
      ${korList.map((k, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;${i < korList.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.04)' : ''}">
          <div style="width:30px;height:30px;border-radius:8px;background:rgba(212,168,83,0.12);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#D4A853">
            ${escapeHtml((k.nama||'?')[0].toUpperCase())}
          </div>
          <span style="flex:1;font-size:13px;color:#fff;font-weight:500">${escapeHtml(k.nama)}</span>
          <span style="font-size:11px;color:rgba(255,255,255,0.35)">${k.count} proyek</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- Top hit section (diisi oleh _loadTopProjectHits) -->
    <div id="primary-hit-section" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden;margin-bottom:14px">
      <div style="padding:10px 14px"><span style="font-size:11px;color:rgba(255,255,255,0.3)">Memuat data hit...</span></div>
    </div>

    <!-- Top proyek (terbaru) -->
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden">
      <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px">Proyek Terbaru</span>
      </div>
      ${projects.slice(0, 4).map((p, i) => {
        const spColor = p.Status_Project === 'Pending' ? '#fbbf24' : p.Status_Project === 'Nonaktif' ? '#f87171' : '#4ade80';
        const kor = [p.Koordinator_Nama, p.Koordinator2_Nama].filter(Boolean).join(' & ') || '—';
        return `<div onclick="navigateTo('primary')" style="display:flex;align-items:center;gap:10px;padding:11px 14px;${i < Math.min(projects.length,4)-1 ? 'border-bottom:1px solid rgba(255,255,255,0.04)' : ''};cursor:pointer"
          onmouseenter="this.style.background='rgba(255,255,255,0.02)'"
          onmouseleave="this.style.background=''">
          <div style="flex:1;min-width:0">
            <p style="color:#fff;font-size:13px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.Nama_Proyek)}</p>
            <p style="color:rgba(255,255,255,0.35);font-size:11px;margin:2px 0 0"><i class="fa-solid fa-user-tie" style="font-size:9px;margin-right:3px"></i>${escapeHtml(kor)}</p>
          </div>
          <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:${spColor}18;color:${spColor};white-space:nowrap">
            ${p.Status_Project || 'Aktif'}
          </span>
        </div>`;
      }).join('')}
    </div>`;
}



// ─────────────────────────────────────────────────────────
// HIT AGEN PER PROYEK — modal section
// Akses: koordinator proyek, principal, SA
// ─────────────────────────────────────────────────────────
async function loadProjectHits() {
  if (!_currentProjectId) return;
  const listEl = document.getElementById('pd-hit-list');
  if (!listEl) return;

  listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:12px"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</p>';

  try {
    const res  = await API.get('/share-log/project/' + _currentProjectId);
    const data = res.data || [];
    const total = res.total_hits || 0;

    if (!data.length) {
      listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:12px">Belum ada agen yang share proyek ini</p>';
      return;
    }

    const platIcon = { wa:'💬', wa_business:'🟢', instagram:'📸', tiktok:'🎵', facebook:'👤' };

    listEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <span style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px">Agen</span>
        <span style="color:rgba(212,168,83,0.7);font-size:11px">Total: <strong style="color:#D4A853">${total} hit</strong></span>
      </div>
      ${data.map((a, i) => {
        const plats = Object.entries(a.platforms || {})
          .map(([p, c]) => `${platIcon[p]||'📤'}${c}`).join(' ');
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;${i < data.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.04)' : ''}">
          <div style="width:32px;height:32px;border-radius:8px;background:rgba(212,168,83,0.1);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#D4A853;flex-shrink:0">
            ${escapeHtml((a.agen_nama||'?')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <p style="color:#fff;font-size:13px;font-weight:600;margin:0">${escapeHtml(a.agen_nama)}</p>
            <p style="color:rgba(255,255,255,0.35);font-size:11px;margin:2px 0 0">${plats} · terakhir ${_timeAgo(a.last_share)}</p>
          </div>
          <span style="font-size:14px;font-weight:800;color:#D4A853">${a.total}</span>
        </div>`;
      }).join('')}`;
  } catch (e) {
    listEl.innerHTML = `<p style="color:#ef4444;font-size:12px;text-align:center;padding:12px">${e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────
// SHARE LOG — HIT TRACKER
// ─────────────────────────────────────────────────────────

// Fire & forget — tidak boleh crash UI
function _logShare(tipe_konten, konten_id, konten_nama, platform, koordinator_id = '') {
  if (!STATE.token || !konten_id) return; // jangan log kalau belum login
  API.post('/share-log', { tipe_konten, konten_id, konten_nama, platform, koordinator_id })
    .catch(e => console.warn('[ShareLog] gagal catat:', e.message));
}

// ─────────────────────────────────────────────────────────
// HALAMAN LOG SHARE — modal drawer
// ─────────────────────────────────────────────────────────
async function openShareLog() {
  openModal('modal-share-log');
  await loadShareLogData();
}

async function loadShareLogData(tipe = '', platform = '') {
  const listEl = document.getElementById('share-log-list');
  const summEl = document.getElementById('share-log-summary');
  if (!listEl) return;

  listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:20px;font-size:13px"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</p>';

  try {
    const params = new URLSearchParams({ limit: 100 });
    if (tipe)     params.set('tipe', tipe);
    if (platform) params.set('platform', platform);

    const [logRes, sumRes] = await Promise.allSettled([
      API.get('/share-log/mine?' + params),
      API.get('/share-log/summary'),
    ]);

    const logs    = logRes.status    === 'fulfilled' ? logRes.value?.data    || [] : [];
    const summary = sumRes.status === 'fulfilled' ? sumRes.value?.data || {} : {};

    // Render summary pills
    if (summEl) {
      const platIcon = { wa:'💬', wa_business:'🟢', instagram:'📸', tiktok:'🎵', facebook:'👤' };
      const byPlat = summary.by_platform || {};
      summEl.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <div style="background:rgba(212,168,83,0.12);border:1px solid rgba(212,168,83,0.25);border-radius:20px;padding:5px 14px;font-size:12px;color:#D4A853">
            <span style="font-weight:700">${summary.total || 0}</span> total hit
          </div>
          ${Object.entries(byPlat).map(([p, c]) => `
            <div onclick="loadShareLogData('','${p}')" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:5px 12px;font-size:12px;color:rgba(255,255,255,0.7);cursor:pointer">
              ${platIcon[p]||'📤'} ${p} <span style="font-weight:700;color:#fff">${c}</span>
            </div>`).join('')}
        </div>`;
    }

    if (!logs.length) {
      listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px">Belum ada aktivitas share</p>';
      return;
    }

    const platIcon  = { wa:'💬 WA', wa_business:'🟢 WA Bisnis', instagram:'📸 Instagram', tiktok:'🎵 TikTok', facebook:'👤 Facebook' };
    const tipeColor = { listing:'#60a5fa', project:'#D4A853' };

    listEl.innerHTML = logs.map((r, i) => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 0;${i < logs.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.05)' : ''}">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
          ${{ wa:'💬', wa_business:'🟢', instagram:'📸', tiktok:'🎵', facebook:'👤' }[r.Platform] || '📤'}
        </div>
        <div style="flex:1;min-width:0">
          <p style="color:#fff;font-size:13px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.Konten_Nama || r.Konten_ID)}</p>
          <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:3px 0 0">
            <span style="color:${tipeColor[r.Tipe_Konten]||'#fff'};font-weight:600">${r.Tipe_Konten}</span>
            · ${platIcon[r.Platform] || r.Platform}
            · ${_timeAgo(r.Timestamp)}
          </p>
        </div>
      </div>`).join('');

  } catch (e) {
    listEl.innerHTML = `<p style="color:#ef4444;text-align:center;padding:20px;font-size:13px">${e.message}</p>`;
  }
}

function _timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'baru saja';
  if (m < 60)  return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

// ─────────────────────────────────────────────────────────
// DEEPLINK: buka detail dari shortlink redirect
// Tambahkan di showApp() atau setelah navigateTo('primary')
// ─────────────────────────────────────────────────────────
function checkPrimaryDeeplink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('primary') === '1') {
    const pid = params.get('pid');
    navigateTo('primary');
    if (pid) setTimeout(() => openProjectDetail(pid), 600);
    // Bersihkan URL
    history.replaceState({}, '', '/');
  }
}

// ─────────────────────────────────────────────────────────
// INTEGRASI navigateTo — tambahkan ini ke fungsi navigateTo:
// ─────────────────────────────────────────────────────────
// Tambah ke dalam switch (page) di navigateTo():
//
//   case 'primary':
//     showSection('page-primary');
//     loadPrimaryPage();
//     break;
//
// Dan di bagian update nav buttons di navigateTo():
//   document.getElementById('nav-primary')?.classList.toggle('active', page === 'primary');

// ── Export CSV Leads ─────────────────────────────────
async function exportLeadsCSV() {
  try {
    showToast('Mempersiapkan CSV...', 'info');
    const res = await fetch('/api/v1/leads/export/csv', {
      headers: { Authorization: `Bearer ${STATE.token}` }
    });
    if (!res.ok) { showToast('Gagal export CSV', 'error'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('✅ CSV berhasil didownload!', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}