/**
 * Legal Perjanjian + Status Sewa
 * Tergantung pada STATE, API, dan showToast dari app.js
 */

// ─────────────────────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────────────────────

const ADMIN_ROLES_LR = ['admin', 'kantor', 'principal', 'superadmin', 'business_manager'];

function isAdminLR() {
  const role = (STATE?.user?.role || '').toLowerCase();
  console.log('[LEGAL] role check:', STATE?.user?.role, '→', role, '→ isAdmin:', ADMIN_ROLES_LR.includes(role));
  return ADMIN_ROLES_LR.includes(role);
}

function formatTanggal(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────
//  FITUR 1 — LEGAL DOKUMEN
// ─────────────────────────────────────────────────────────────

let _legalAgents = [];

async function loadLegalDocs() {
  const isAdmin = isAdminLR();

  // Tampilkan/sembunyikan form upload & filter admin
  const uploadSection = document.getElementById('legal-admin-upload');
  const filterSection = document.getElementById('legal-admin-filter');
  if (uploadSection) uploadSection.style.display = isAdmin ? 'block' : 'none';
  if (filterSection) filterSection.style.display = isAdmin ? 'block' : 'none';

  // Auto-fill tanggal hari ini
  if (isAdmin) {
    const tglEl = document.getElementById('legal-tanggal');
    if (tglEl && !tglEl.value) {
      const now = new Date();
      tglEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }
  }

  // Admin: isi dropdown agen
  if (isAdmin && _legalAgents.length === 0) {
    try {
      const res = await API.get('/agents');
      _legalAgents = (res.data || []).filter(a => a.Status === 'Aktif');
      const selects = [
        document.getElementById('legal-agent-select'),
        document.getElementById('legal-filter-agent'),
      ];
      selects.forEach(sel => {
        if (!sel) return;
        const first = sel.options[0];
        sel.innerHTML = '';
        sel.appendChild(first);
        _legalAgents.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.ID;
          opt.textContent = `${a.Nama} (${a.Role})`;
          sel.appendChild(opt);
        });
      });
    } catch (e) { console.error('[LEGAL] load agents error:', e); }
  }

  // Fetch dokumen
  const list = document.getElementById('legal-docs-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px">Memuat...</div>';

  try {
    const filterAgent = document.getElementById('legal-filter-agent')?.value || '';
    const qs = isAdmin && filterAgent ? `?agent_id=${filterAgent}` : '';
    console.log('[LEGAL] fetching docs...', `/legal/docs${qs}`);
    const res = await API.get(`/legal/docs${qs}`);
    console.log('[LEGAL] docs response:', res);
    const docs = res.data || [];

    if (!docs.length) {
      list.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px">Belum ada dokumen</div>';
      return;
    }

    const kategoriColor = { PJB: '#60a5fa', Sewa: '#34d399', SPR: '#f59e0b', Lainnya: '#a78bfa' };

    list.innerHTML = docs.map(d => `
      <div style="background:#131F38;border-radius:12px;padding:14px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.06);display:flex;align-items:flex-start;gap:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(52,211,153,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fa-solid fa-file-pdf" style="color:#34d399;font-size:16px"></i>
        </div>
        <div style="flex:1;min-width:0">
          ${d.Nama_Klien ? `<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:2px">${d.Nama_Klien}</div>` : ''}
          ${d.Alamat_Unit ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.Alamat_Unit}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
            <span style="background:${kategoriColor[d.Kategori] || '#a78bfa'}22;color:${kategoriColor[d.Kategori] || '#a78bfa'};border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">${d.Kategori}</span>
            ${d.Nama_Pemilik ? `<span style="font-size:10px;color:rgba(255,255,255,0.4)">${d.Nama_Pemilik}</span>` : ''}
            <span style="font-size:10px;color:rgba(255,255,255,0.3)">${d.Ukuran_KB} KB • ${formatTanggal(d.Created_At)}</span>
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.Nama_File}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button onclick="window.open('${d.Drive_URL}','_blank')" style="background:#2B7BFF22;color:#60a5fa;border:1px solid #2B7BFF44;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">Buka</button>
          ${isAdmin ? `<button onclick="deleteLegalDoc('${d.ID}','${(d.Nama_Klien||d.Nama_File).replace(/'/g, "\\'")}')" style="background:rgba(239,68,68,0.08);color:#f87171;border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer">Hapus</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('[LEGAL] loadLegalDocs error:', e);
    list.innerHTML = '<div style="text-align:center;color:#f87171;padding:30px 0;font-size:13px">Gagal memuat dokumen</div>';
  }
}

// Helper: sanitize string untuk preview filename (sama logika dengan backend)
function sanitizeLegal(str) {
  return (str || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 40);
}

function updateLegalFilenamePreview() {
  const kategori  = document.getElementById('legal-kategori')?.value || '';
  const namaKlien = document.getElementById('legal-nama-klien')?.value || '';
  const alamat    = document.getElementById('legal-alamat-unit')?.value || '';
  const preview   = document.getElementById('legal-filename-preview');
  const previewTxt = document.getElementById('legal-filename-text');
  if (!preview || !previewTxt) return;

  if (!namaKlien && !alamat) { preview.style.display = 'none'; return; }

  const now = new Date();
  const tanggal = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const filename = `${sanitizeLegal(kategori)}_${sanitizeLegal(namaKlien)}_${sanitizeLegal(alamat)}_${tanggal}.pdf`;
  previewTxt.textContent = filename;
  preview.style.display = 'block';
}

async function uploadLegalDoc() {
  const agentId      = document.getElementById('legal-agent-select')?.value;
  const kategori     = document.getElementById('legal-kategori')?.value;
  const namaKlien    = document.getElementById('legal-nama-klien')?.value?.trim();
  const namaPemilik  = document.getElementById('legal-nama-pemilik')?.value?.trim() || '';
  const alamatUnit   = document.getElementById('legal-alamat-unit')?.value?.trim();
  const fileInput    = document.getElementById('legal-file');
  const catatan      = document.getElementById('legal-catatan')?.value || '';
  const btn          = document.getElementById('legal-upload-btn');
  const progress     = document.getElementById('legal-upload-progress');

  if (!agentId)              return showToast('Pilih agen terlebih dahulu', 'warning');
  if (!namaKlien)            return showToast('Nama klien wajib diisi', 'warning');
  if (!alamatUnit)           return showToast('Alamat unit / nama proyek wajib diisi', 'warning');
  if (!fileInput?.files[0])  return showToast('Pilih file PDF terlebih dahulu', 'warning');

  const file = fileInput.files[0];
  if (file.size > 10 * 1024 * 1024) return showToast('Ukuran file maksimal 10 MB', 'warning');

  btn.disabled = true;
  btn.textContent = 'Mengupload...';
  if (progress) progress.style.display = 'block';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('agent_id', agentId);
    formData.append('kategori', kategori);
    formData.append('nama_klien', namaKlien);
    formData.append('nama_pemilik', namaPemilik);
    formData.append('alamat_unit', alamatUnit);
    formData.append('catatan', catatan);

    const token = localStorage.getItem('crm_token');
    const res = await fetch('/api/v1/legal/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Upload gagal');

    showToast(`Dokumen berhasil diupload: ${json.data?.Nama_File || ''}`, 'success');

    // Reset form
    ['legal-nama-klien','legal-nama-pemilik','legal-alamat-unit','legal-catatan'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    fileInput.value = '';
    const preview = document.getElementById('legal-filename-preview');
    if (preview) preview.style.display = 'none';

    await loadLegalDocs();
  } catch (e) {
    console.error('[LEGAL] upload error:', e);
    showToast(e.message || 'Gagal upload dokumen', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Dokumen';
    if (progress) progress.style.display = 'none';
  }
}

async function deleteLegalDoc(id, nama) {
  if (!confirm(`Hapus dokumen "${nama}"?`)) return;
  try {
    await API.delete(`/legal/docs/${id}`);
    showToast('Dokumen berhasil dihapus', 'success');
    await loadLegalDocs();
  } catch (e) {
    showToast(e.message || 'Gagal menghapus dokumen', 'error');
  }
}

// ─────────────────────────────────────────────────────────────
//  FITUR 2 — STATUS SEWA
// ─────────────────────────────────────────────────────────────

let _allRentals    = [];
let _rentalFilter  = '';
let _periodeSewa   = 'Tahunan';

function setPeriodeSewa(type) {
  _periodeSewa = type;
  const tahunanSec = document.getElementById('sewa-tahunan-section');
  const bulananSec = document.getElementById('sewa-bulanan-section');
  const btnT       = document.getElementById('btn-periode-tahunan');
  const btnB       = document.getElementById('btn-periode-bulanan');
  const hiddenEl   = document.getElementById('rental-periode-hidden');
  if (hiddenEl) hiddenEl.value = type;
  const isBulanan = type === 'Bulanan';
  if (tahunanSec) tahunanSec.style.display = isBulanan ? 'none' : 'grid';
  if (bulananSec) bulananSec.style.display = isBulanan ? 'grid' : 'none';
  if (btnT) { btnT.style.background = isBulanan ? '#131F38' : '#D4A853'; btnT.style.color = isBulanan ? 'rgba(255,255,255,0.6)' : '#0D1526'; btnT.style.border = isBulanan ? '1px solid rgba(255,255,255,0.1)' : 'none'; }
  if (btnB) { btnB.style.background = isBulanan ? '#D4A853' : '#131F38'; btnB.style.color = isBulanan ? '#0D1526' : 'rgba(255,255,255,0.6)'; btnB.style.border = isBulanan ? 'none' : '1px solid rgba(255,255,255,0.1)'; }
  hitungPeriodeBulananUI();
}

function hitungTanggalSelesaiUI() {
  const mulai  = document.getElementById('rental-start')?.value;
  const durasi = parseInt(document.getElementById('rental-duration')?.value || '0');
  const display = document.getElementById('rental-end-display');
  if (!display) return;
  if (!mulai || !durasi || durasi < 1) { display.textContent = '—'; return; }
  const d = new Date(mulai);
  d.setMonth(d.getMonth() + durasi);
  display.textContent = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hitungPeriodeBulananUI() {
  const preview = document.getElementById('rental-bulanan-preview');
  if (!preview) return;
  const mulai  = document.getElementById('rental-start-bulanan')?.value;
  const durasi = parseInt(document.getElementById('rental-durasi-total')?.value || '0');
  if (!mulai || !durasi) { preview.style.display = 'none'; return; }
  preview.style.display = 'block';
  let html = `<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:8px;font-weight:600;letter-spacing:0.5px">PREVIEW ${durasi} PERIODE · Notif 10 hari sebelum tiap selesai</div>`;
  let curStart = new Date(mulai);
  for (let i = 1; i <= durasi; i++) {
    const nextStart  = new Date(curStart);
    nextStart.setMonth(nextStart.getMonth() + 1);
    const mulaiStr   = curStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const selesaiStr = nextStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    html += `<div style="display:flex;align-items:center;gap:10px;padding:5px 0${i < durasi ? ';border-bottom:1px solid rgba(255,255,255,0.05)' : ''}">
      <span style="background:rgba(212,168,83,0.15);color:#D4A853;border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700;flex-shrink:0">Periode ${i}</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.65)">${mulaiStr} → ${selesaiStr}</span>
    </div>`;
    curStart = nextStart;
  }
  preview.innerHTML = html;
}

async function triggerRentalReminder() {
  const btn = document.getElementById('btn-trigger-rental-reminder');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:5px"></i>Mengirim...'; }
  try {
    await API.post('/admin/trigger-rental-reminder', {});
    showToast('Reminder sewa berhasil dikirim', 'success');
  } catch (e) {
    showToast('Gagal kirim reminder: ' + (e.message || ''), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell" style="margin-right:5px"></i>Kirim Reminder'; }
  }
}

async function loadRentals() {
  const list = document.getElementById('rental-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px">Memuat...</div>';

  // Tampilkan tombol trigger hanya untuk superadmin
  const triggerBtn = document.getElementById('btn-trigger-rental-reminder');
  if (triggerBtn) triggerBtn.style.display = (STATE?.user?.role === 'superadmin') ? 'inline-flex' : 'none';

  try {
    const qs = _rentalFilter ? `?status=${_rentalFilter}` : '';
    const res = await API.get(`/rental${qs}`);
    _allRentals = res.data || [];
    renderRentals();
  } catch (e) {
    console.error('[RENTAL] loadRentals error:', e);
    list.innerHTML = '<div style="text-align:center;color:#f87171;padding:30px 0;font-size:13px">Gagal memuat data sewa</div>';
  }
}

function filterRental(status) {
  _rentalFilter = status;
  document.querySelectorAll('.rental-filter-btn').forEach(b => {
    b.style.background = '#131F38';
    b.style.color = 'rgba(255,255,255,0.6)';
    b.style.border = '1px solid rgba(255,255,255,0.1)';
  });
  const activeId = status ? `rf-${status}` : 'rf-all';
  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.style.background = '#D4A853';
    activeBtn.style.color = '#0D1526';
    activeBtn.style.border = 'none';
  }
  loadRentals();
}

function renderRentals() {
  const list = document.getElementById('rental-list');
  if (!list) return;

  if (!_allRentals.length) {
    list.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px">Belum ada data sewa</div>';
    return;
  }

  const isAdmin = isAdminLR();
  const SC = {
    aktif:        { bg: 'rgba(52,211,153,0.1)',  text: '#34d399', label: 'Aktif' },
    selesai:      { bg: 'rgba(148,163,184,0.1)', text: '#94a3b8', label: 'Selesai' },
    diperpanjang: { bg: 'rgba(96,165,250,0.1)',  text: '#60a5fa', label: 'Diperpanjang' },
    dibatalkan:   { bg: 'rgba(239,68,68,0.1)',   text: '#f87171', label: 'Dibatalkan' },
  };

  const byId = {};
  _allRentals.forEach(r => { byId[r.ID] = r; });

  const sorted = [..._allRentals].sort((a, b) => {
    if (a.Status === 'aktif' && b.Status !== 'aktif') return -1;
    if (a.Status !== 'aktif' && b.Status === 'aktif') return 1;
    return (a.Sisa_Hari || 0) - (b.Sisa_Hari || 0);
  });

  const rendered = new Set();
  let html = '';

  // ── Pre-process: bangun Bulanan chains (forward: period1 → period2 → ... → periodN) ──
  const bulananFwd = {}; // parentId → childRecord
  _allRentals.forEach(r => {
    if (r.Periode_Sewa === 'Bulanan' && r.Ref_ID) bulananFwd[r.Ref_ID] = r;
  });
  const bulananRoots = _allRentals.filter(r =>
    r.Periode_Sewa === 'Bulanan' && (!r.Ref_ID || r.Ref_ID === '')
  );

  // ── Render Bulanan chains ──
  for (const root of bulananRoots) {
    if (rendered.has(root.ID)) continue;
    const chain = [root];
    let cur = root;
    while (bulananFwd[cur.ID]) { cur = bulananFwd[cur.ID]; chain.push(cur); }
    chain.forEach(r => rendered.add(r.ID));

    const totalBulan = root.Durasi_Total_Bulan || chain.length;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Periode aktif = yang rentang tanggalnya mencakup hari ini (atau terdekat)
    const activePeriod = chain.find(r => {
      const s = new Date(r.Tanggal_Mulai); s.setHours(0,0,0,0);
      const e = new Date(r.Tanggal_Selesai); e.setHours(0,0,0,0);
      return today >= s && today <= e;
    }) || chain.find(r => r.Status === 'aktif' && r.Sisa_Hari > 0) || chain[0];

    const sisaHari   = activePeriod.Sisa_Hari ?? '—';
    let sisaColor = '#34d399';
    let sisaBadge = '';
    if (typeof sisaHari === 'number' && sisaHari <= 15)  { sisaColor = '#f87171'; sisaBadge = '<span style="margin-left:3px">⚠️</span>'; }
    else if (typeof sisaHari === 'number' && sisaHari <= 30) { sisaColor = '#f59e0b'; sisaBadge = '<span style="margin-left:3px">📋</span>'; }

    // List semua periode
    const periodeRows = chain.map((p, i) => {
      const isActive = p.ID === activePeriod.ID;
      const isPast   = typeof p.Sisa_Hari === 'number' && p.Sisa_Hari < 0;
      const sisa     = p.Sisa_Hari;
      let sisaTxt = '';
      if (typeof sisa === 'number' && sisa > 0) sisaTxt = `<span style="font-size:9px;color:${sisa<=15?'#f87171':sisa<=30?'#f59e0b':'#94a3b8'};margin-left:4px">${sisa}h lagi</span>`;
      else if (typeof sisa === 'number' && sisa <= 0) sisaTxt = `<span style="font-size:9px;color:rgba(255,255,255,0.2);margin-left:4px">Selesai</span>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0${i < chain.length-1?';border-bottom:1px solid rgba(255,255,255,0.04)':''}">
        <span style="background:${isActive?'rgba(212,168,83,0.2)':isPast?'rgba(148,163,184,0.08)':'rgba(52,211,153,0.08)'};color:${isActive?'#D4A853':isPast?'#94a3b8':'#34d399'};border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700;flex-shrink:0">${p.Periode_Ke||i+1}</span>
        <span style="font-size:11px;color:rgba(255,255,255,${isActive?'0.75':'0.4'})">${formatTanggal(p.Tanggal_Mulai)} → ${formatTanggal(p.Tanggal_Selesai)}</span>
        ${sisaTxt}
        ${isAdmin?`<button onclick="deleteRental('${p.ID}')" style="margin-left:auto;background:rgba(239,68,68,0.06);color:#f87171;border:1px solid rgba(239,68,68,0.12);border-radius:6px;padding:2px 7px;font-size:9px;cursor:pointer;flex-shrink:0">Hapus</button>`:''}
      </div>`;
    }).join('');

    html += `
      <div style="background:#131F38;border-radius:12px;padding:14px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">${root.Nama_Penyewa}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${root.Alamat_Sewa}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="background:${SC.aktif.bg};color:${SC.aktif.text};border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">Aktif</span>
              <span style="background:rgba(212,168,83,0.1);color:#D4A853;border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">Bulanan ${totalBulan}×</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:20px;font-weight:800;color:${sisaColor};line-height:1">${sisaHari}${sisaBadge}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:2px">hari lagi</div>
          </div>
        </div>
        ${root.Catatan ? `<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.35);border-top:1px solid rgba(255,255,255,0.06);padding-top:8px">${root.Catatan}</div>` : ''}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)">${periodeRows}</div>
        <div style="display:flex;gap:8px;margin-top:10px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
          <button onclick="openRentalModal('${activePeriod.ID}')" style="flex:1;background:rgba(212,168,83,0.1);color:#D4A853;border:1px solid rgba(212,168,83,0.2);border-radius:8px;padding:7px;font-size:11px;cursor:pointer;font-weight:600">Edit</button>
          <button onclick="selesaikanSewa('${activePeriod.ID}')" style="background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:7px 12px;font-size:11px;cursor:pointer">Selesai</button>
        </div>
      </div>
    `;
  }

  // ── Render Tahunan aktif (beserta chain history diperpanjang) ──
  for (const r of sorted) {
    if (r.Periode_Sewa === 'Bulanan' || r.Status !== 'aktif' || rendered.has(r.ID)) continue;
    rendered.add(r.ID);

    const history = [];
    let cur = r;
    while (cur.Ref_ID) {
      const parent = byId[cur.Ref_ID];
      if (!parent || rendered.has(parent.ID)) break;
      rendered.add(parent.ID);
      history.push(parent);
      cur = parent;
    }

    const masaNum  = history.length + 1;
    const sisaHari = r.Sisa_Hari ?? '—';
    let sisaColor = '#34d399', sisaBadge = '';
    if (typeof sisaHari === 'number' && sisaHari <= 30)      { sisaColor = '#f87171'; sisaBadge = '<span style="margin-left:3px">⚠️</span>'; }
    else if (typeof sisaHari === 'number' && sisaHari <= 90) { sisaColor = '#f59e0b'; sisaBadge = '<span style="margin-left:3px">📋</span>'; }

    let historyHTML = '';
    if (history.length > 0) {
      const items = history.map((h, i) => {
        const hNum = masaNum - 1 - i;
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(96,165,250,0.04);border-radius:8px;padding:8px 10px${i < history.length - 1 ? ';margin-bottom:5px' : ''}">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">
              <span style="background:${SC.diperpanjang.bg};color:${SC.diperpanjang.text};border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700">Diperpanjang</span>
              <span style="font-size:9px;color:rgba(255,255,255,0.3);font-weight:600">Masa Sewa ${hNum}</span>
            </div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4)">${h.Durasi_Bulan} bulan · ${formatTanggal(h.Tanggal_Mulai)} → ${formatTanggal(h.Tanggal_Selesai)}</div>
          </div>
          ${isAdmin ? `<button onclick="deleteRental('${h.ID}')" style="background:rgba(239,68,68,0.06);color:#f87171;border:1px solid rgba(239,68,68,0.15);border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer;flex-shrink:0">Hapus</button>` : ''}
        </div>`;
      }).join('');
      historyHTML = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(96,165,250,0.12)">${items}</div>`;
    }

    html += `
      <div style="background:#131F38;border-radius:12px;padding:14px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">${r.Nama_Penyewa}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.Alamat_Sewa}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="background:${SC.aktif.bg};color:${SC.aktif.text};border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">Aktif</span>
              ${masaNum > 1 ? `<span style="font-size:10px;color:rgba(255,255,255,0.35);font-weight:600">Masa Sewa ${masaNum}</span>` : ''}
              <span style="font-size:11px;color:rgba(255,255,255,0.4)">${r.Durasi_Bulan} bulan</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.35)">${formatTanggal(r.Tanggal_Mulai)} → ${formatTanggal(r.Tanggal_Selesai)}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:20px;font-weight:800;color:${sisaColor};line-height:1">${sisaHari}${sisaBadge}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:2px">hari lagi</div>
          </div>
        </div>
        ${r.Catatan ? `<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.35);border-top:1px solid rgba(255,255,255,0.06);padding-top:8px">${r.Catatan}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
          <button onclick="openRentalModal('${r.ID}')" style="flex:1;background:rgba(212,168,83,0.1);color:#D4A853;border:1px solid rgba(212,168,83,0.2);border-radius:8px;padding:7px;font-size:11px;cursor:pointer;font-weight:600">Perpanjang / Edit</button>
          <button onclick="selesaikanSewa('${r.ID}')" style="background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:7px 12px;font-size:11px;cursor:pointer">Selesai</button>
          ${isAdmin ? `<button onclick="deleteRental('${r.ID}')" style="background:rgba(239,68,68,0.06);color:#f87171;border:1px solid rgba(239,68,68,0.15);border-radius:8px;padding:7px 12px;font-size:11px;cursor:pointer">Hapus</button>` : ''}
        </div>
        ${historyHTML}
      </div>
    `;
  }

  // ── Render sisa records (selesai, dibatalkan, dll) ──
  for (const r of sorted) {
    if (rendered.has(r.ID)) continue;
    rendered.add(r.ID);
    const sc = SC[r.Status] || SC.aktif;
    html += `
      <div style="background:#131F38;border-radius:12px;padding:14px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">${r.Nama_Penyewa}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.Alamat_Sewa}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="background:${sc.bg};color:${sc.text};border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">${sc.label}</span>
              ${r.Periode_Sewa === 'Bulanan' ? `<span style="background:rgba(212,168,83,0.08);color:#D4A853;border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">Bulanan ${r.Durasi_Total_Bulan||''}×</span>` : ''}
              <span style="font-size:11px;color:rgba(255,255,255,0.4)">${r.Durasi_Bulan} bulan</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.35)">${formatTanggal(r.Tanggal_Mulai)} → ${formatTanggal(r.Tanggal_Selesai)}</span>
            </div>
          </div>
        </div>
        ${r.Catatan ? `<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.35);border-top:1px solid rgba(255,255,255,0.06);padding-top:8px">${r.Catatan}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
          ${isAdmin ? `<button onclick="deleteRental('${r.ID}')" style="background:rgba(239,68,68,0.06);color:#f87171;border:1px solid rgba(239,68,68,0.15);border-radius:8px;padding:7px 12px;font-size:11px;cursor:pointer">Hapus</button>` : ''}
        </div>
      </div>
    `;
  }

  list.innerHTML = html || '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px">Belum ada data sewa</div>';
}

let _rentalAgents = [];

async function _loadRentalAgents() {
  if (_rentalAgents.length > 0) return;
  try {
    const res = await API.get('/agents');
    _rentalAgents = (res.data || []).filter(a => a.Status === 'Aktif');
    ['rental-agen-listing','rental-agen-selling'].forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const first = sel.options[0];
      sel.innerHTML = '';
      sel.appendChild(first);
      _rentalAgents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = `${a.ID}|${a.Nama}`;
        opt.textContent = a.Nama;
        sel.appendChild(opt);
      });
    });
  } catch (_) {}
}

function togglePerpanjangBulan(val) {
  const wrap = document.getElementById('rental-bulan-wrap');
  if (wrap) wrap.style.display = val === 'perpanjang' ? 'block' : 'none';
}

function openRentalModal(editId = null) {
  const modal = document.getElementById('rental-modal');
  const title = document.getElementById('rental-modal-title');
  const editIdEl = document.getElementById('rental-edit-id');
  const perpanjangSec = document.getElementById('rental-perpanjang-section');
  const toggleEl = document.getElementById('sewa-periode-toggle');
  if (!modal) return;

  _loadRentalAgents();

  // Reset form
  ['rental-nama-penyewa','rental-wa-penyewa','rental-alamat','rental-start','rental-duration',
   'rental-catatan-modal','rental-perpanjang-bulan','rental-hasil-fu',
   'rental-start-bulanan','rental-cobroke-nama','rental-cobroke-wa'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['rental-agen-listing','rental-agen-selling','rental-perpanjang-aksi','rental-durasi-total'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  const cb = document.getElementById('rental-cobroke');
  if (cb) cb.checked = false;
  const cobrokeFields = document.getElementById('rental-cobroke-fields');
  if (cobrokeFields) cobrokeFields.style.display = 'none';
  const bulanWrap = document.getElementById('rental-bulan-wrap');
  if (bulanWrap) bulanWrap.style.display = 'none';
  const preview = document.getElementById('rental-bulanan-preview');
  if (preview) preview.style.display = 'none';
  const endDisplay = document.getElementById('rental-end-display');
  if (endDisplay) endDisplay.textContent = '—';

  if (editId) {
    const r = _allRentals.find(x => x.ID === editId);
    if (!r) return;
    title.textContent = 'Perpanjang / Edit Sewa';
    editIdEl.value = editId;

    // Dalam edit mode: sembunyikan toggle, tampilkan section Tahunan sebagai referensi
    if (toggleEl) toggleEl.style.display = 'none';
    const tahunanSec = document.getElementById('sewa-tahunan-section');
    const bulananSec = document.getElementById('sewa-bulanan-section');
    if (tahunanSec) tahunanSec.style.display = 'grid';
    if (bulananSec) bulananSec.style.display = 'none';

    document.getElementById('rental-nama-penyewa').value  = r.Nama_Penyewa;
    document.getElementById('rental-alamat').value        = r.Alamat_Sewa;
    document.getElementById('rental-start').value         = r.Tanggal_Mulai;
    document.getElementById('rental-duration').value      = r.Durasi_Bulan;
    document.getElementById('rental-catatan-modal').value = r.Catatan || '';
    if (endDisplay) endDisplay.textContent = formatTanggal(r.Tanggal_Selesai);

    const setSelect = (selId, id) => {
      const sel = document.getElementById(selId);
      if (!sel || !id) return;
      const opt = [...sel.options].find(o => o.value.startsWith(id + '|'));
      if (opt) sel.value = opt.value;
    };
    setSelect('rental-agen-listing', r.Agen_Listing_ID);
    setSelect('rental-agen-selling', r.Agen_Selling_ID);
    const waEl = document.getElementById('rental-wa-penyewa');
    if (waEl) waEl.value = r.No_WA_Penyewa || '';
    if (cb) cb.checked = r.CoBroke === 'TRUE';
    const cof = document.getElementById('rental-cobroke-fields');
    if (cof) cof.style.display = r.CoBroke === 'TRUE' ? 'grid' : 'none';
    const cobNamaEl = document.getElementById('rental-cobroke-nama');
    if (cobNamaEl) cobNamaEl.value = r.Agen_CoBroke_Nama || '';
    const cobWaEl = document.getElementById('rental-cobroke-wa');
    if (cobWaEl) cobWaEl.value = r.Agen_CoBroke_WA || '';
    if (perpanjangSec) perpanjangSec.style.display = 'block';
  } else {
    title.textContent = 'Tambah Data Sewa';
    editIdEl.value = '';
    if (toggleEl) toggleEl.style.display = 'block';
    if (perpanjangSec) perpanjangSec.style.display = 'none';
    // Reset ke Tahunan
    _periodeSewa = 'Tahunan';
    setPeriodeSewa('Tahunan');
  }

  modal.style.display = 'block';
}

function closeRentalModal() {
  const modal = document.getElementById('rental-modal');
  if (modal) modal.style.display = 'none';
}

function toggleCobrokeFields() {
  const cb     = document.getElementById('rental-cobroke');
  const fields = document.getElementById('rental-cobroke-fields');
  if (!fields) return;
  fields.style.display = cb?.checked ? 'grid' : 'none';
  if (!cb?.checked) {
    const n = document.getElementById('rental-cobroke-nama');
    const w = document.getElementById('rental-cobroke-wa');
    if (n) n.value = '';
    if (w) w.value = '';
  }
}

async function saveRental() {
  const editId      = document.getElementById('rental-edit-id')?.value;
  const nama        = document.getElementById('rental-nama-penyewa')?.value?.trim();
  const noWaPenyewa = document.getElementById('rental-wa-penyewa')?.value?.trim() || '';
  const alamat      = document.getElementById('rental-alamat')?.value?.trim();
  const catatan     = document.getElementById('rental-catatan-modal')?.value || '';
  const hasilFU     = document.getElementById('rental-hasil-fu')?.value?.trim() || '';
  const cobroke     = document.getElementById('rental-cobroke')?.checked ? 'TRUE' : 'FALSE';
  const cobrokeNama = document.getElementById('rental-cobroke-nama')?.value?.trim() || '';
  const cobrokeWA   = document.getElementById('rental-cobroke-wa')?.value?.trim() || '';

  const listingVal = document.getElementById('rental-agen-listing')?.value || '';
  const [agen_listing_id, agen_listing_nama] = listingVal.includes('|') ? listingVal.split('|') : ['', listingVal];
  const sellingVal = document.getElementById('rental-agen-selling')?.value || '';
  const [agen_selling_id, agen_selling_nama] = sellingVal.includes('|') ? sellingVal.split('|') : ['', sellingVal];

  const periode   = document.getElementById('rental-periode-hidden')?.value || 'Tahunan';
  const isBulanan = periode === 'Bulanan' && !editId;

  if (!nama || !alamat) return showToast('Nama dan alamat wajib diisi', 'warning');
  if (!noWaPenyewa) return showToast('No WA Penyewa wajib diisi', 'warning');
  if (cobroke === 'TRUE' && !cobrokeWA) return showToast('No WA Agen CoBroke wajib diisi', 'warning');

  if (isBulanan) {
    const mulaiBulanan = document.getElementById('rental-start-bulanan')?.value;
    const durasiTotal  = document.getElementById('rental-durasi-total')?.value;
    if (!mulaiBulanan) return showToast('Tanggal Mulai Pertama wajib diisi', 'warning');
    if (!durasiTotal)  return showToast('Durasi Total wajib dipilih (3/6/12 bulan)', 'warning');

    const btn = document.getElementById('rental-save-btn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      await API.post('/rental', {
        nama_penyewa: nama, alamat_sewa: alamat,
        tanggal_mulai: mulaiBulanan, durasi_bulan: 1,
        catatan, cobroke,
        agen_listing_id, agen_listing_nama,
        agen_selling_id, agen_selling_nama,
        agen_cobroke_nama: cobrokeNama,
        agen_cobroke_wa: cobrokeWA,
        no_wa_penyewa: noWaPenyewa,
        periode_sewa: 'Bulanan',
        durasi_total_bulan: parseInt(durasiTotal),
      });
      showToast(`Sewa Bulanan ${durasiTotal} periode berhasil ditambahkan`, 'success');
      closeRentalModal();
      await loadRentals();
    } catch (e) {
      showToast(e.message || 'Gagal menyimpan data sewa', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Simpan';
    }
    return;
  }

  // Tahunan (baru atau edit)
  const mulai  = document.getElementById('rental-start')?.value;
  const durasi = document.getElementById('rental-duration')?.value;
  if (!editId && (!mulai || !durasi)) return showToast('Tanggal Mulai dan Durasi wajib diisi', 'warning');

  const btn = document.getElementById('rental-save-btn');
  btn.disabled = true; btn.textContent = 'Menyimpan...';

  try {
    if (editId) {
      const perpanjangAksi  = document.getElementById('rental-perpanjang-aksi')?.value || '';
      const perpanjangBulan = document.getElementById('rental-perpanjang-bulan')?.value || '';
      const body = {
        catatan, cobroke, hasil_fu_reminder: hasilFU,
        agen_listing_id, agen_listing_nama,
        agen_selling_id, agen_selling_nama,
        no_wa_penyewa: noWaPenyewa,
        agen_cobroke_nama: cobrokeNama,
        agen_cobroke_wa: cobrokeWA,
      };
      if (perpanjangAksi === 'perpanjang' && parseInt(perpanjangBulan) > 0) {
        body.perpanjang_bulan = perpanjangBulan;
      } else if (perpanjangAksi === 'tidak') {
        body.status = 'selesai';
      }
      await API.patch(`/rental/${editId}`, body);
      showToast('Data sewa berhasil diupdate', 'success');
    } else {
      await API.post('/rental', {
        nama_penyewa: nama, alamat_sewa: alamat,
        tanggal_mulai: mulai, durasi_bulan: parseInt(durasi), catatan,
        cobroke, agen_listing_id, agen_listing_nama,
        agen_selling_id, agen_selling_nama,
        agen_cobroke_nama: cobrokeNama,
        agen_cobroke_wa: cobrokeWA,
        no_wa_penyewa: noWaPenyewa,
        periode_sewa: 'Tahunan',
      });
      showToast('Data sewa berhasil ditambahkan', 'success');
    }
    closeRentalModal();
    await loadRentals();
  } catch (e) {
    showToast(e.message || 'Gagal menyimpan data sewa', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

async function selesaikanSewa(id) {
  if (!confirm('Tandai sewa ini sebagai selesai?')) return;
  try {
    await API.patch(`/rental/${id}`, { status: 'selesai' });
    showToast('Status sewa diperbarui', 'success');
    await loadRentals();
  } catch (e) {
    showToast(e.message || 'Gagal update status', 'error');
  }
}

async function deleteRental(id) {
  if (!confirm('Hapus data sewa ini?')) return;
  try {
    await API.delete(`/rental/${id}`);
    showToast('Data sewa berhasil dihapus', 'success');
    await loadRentals();
  } catch (e) {
    showToast(e.message || 'Gagal menghapus data', 'error');
  }
}

// Tutup modal sewa saat klik overlay
document.addEventListener('click', (e) => {
  const modal = document.getElementById('rental-modal');
  if (modal && e.target === modal) closeRentalModal();
});

// ─────────────────────────────────────────────────────────────
//  DASHBOARD WIDGET — Legal Perjanjian (3 dokumen terbaru)
// ─────────────────────────────────────────────────────────────

async function loadDashboardLegalWidget() {
  const el = document.getElementById('dash-legal-list');
  if (!el) return;

  try {
    const res  = await API.get('/legal/docs');
    const docs = (res.data || []).slice(-5).reverse(); // 5 terbaru

    if (!docs.length) {
      el.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.25);font-size:12px;padding:16px 0">Belum ada dokumen legal</div>';
      return;
    }

    const kategoriColor = { PJB: '#60a5fa', Sewa: '#34d399', SPR: '#f59e0b', Lainnya: '#a78bfa' };

    el.innerHTML = docs.map(d => `
      <div style="background:#131F38;border-radius:12px;padding:11px 14px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:12px">
        <div style="width:34px;height:34px;border-radius:10px;background:rgba(52,211,153,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fa-solid fa-file-pdf" style="color:#34d399;font-size:14px"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.Nama_File}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px">
            <span style="background:${kategoriColor[d.Kategori] || '#a78bfa'}22;color:${kategoriColor[d.Kategori] || '#a78bfa'};border-radius:20px;padding:1px 7px;font-size:9px;font-weight:700">${d.Kategori}</span>
            <span style="font-size:10px;color:rgba(255,255,255,0.3)">${formatTanggal(d.Created_At)}</span>
          </div>
        </div>
        <button onclick="window.open('${d.Drive_URL}','_blank')" style="color:#60a5fa;font-size:11px;background:none;border:none;cursor:pointer;flex-shrink:0;font-weight:600;padding:0">Buka</button>
      </div>
    `).join('');
  } catch (e) {
    console.error('[LEGAL] dashboard widget error:', e);
    el.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.25);font-size:12px;padding:16px 0">Gagal memuat</div>';
  }
}
