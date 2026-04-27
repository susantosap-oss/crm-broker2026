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
          <a href="${d.Drive_URL}" target="_blank" style="background:#2B7BFF22;color:#60a5fa;border:1px solid #2B7BFF44;border-radius:8px;padding:5px 10px;font-size:11px;text-decoration:none;font-weight:600">Buka</a>
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
    btn.textContent = 'Upload ke Google Drive';
    if (progress) progress.style.display = 'none';
  }
}

async function deleteLegalDoc(id, nama) {
  if (!confirm(`Hapus dokumen "${nama}"? File akan dihapus dari Google Drive.`)) return;
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

async function loadRentals() {
  const list = document.getElementById('rental-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px">Memuat...</div>';

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

  const statusColor = {
    aktif: { bg: 'rgba(52,211,153,0.1)', text: '#34d399', label: 'Aktif' },
    selesai: { bg: 'rgba(148,163,184,0.1)', text: '#94a3b8', label: 'Selesai' },
    diperpanjang: { bg: 'rgba(96,165,250,0.1)', text: '#60a5fa', label: 'Diperpanjang' },
    dibatalkan: { bg: 'rgba(239,68,68,0.1)', text: '#f87171', label: 'Dibatalkan' },
  };

  const isAdmin = isAdminLR();

  list.innerHTML = _allRentals.map(r => {
    const sc = statusColor[r.Status] || statusColor.aktif;
    const sisaHari = r.Sisa_Hari ?? '—';
    let sisaColor = '#34d399';
    let sisaBadge = '';
    if (r.Status === 'aktif') {
      if (sisaHari <= 30)      { sisaColor = '#f87171'; sisaBadge = '⚠️'; }
      else if (sisaHari <= 90) { sisaColor = '#f59e0b'; sisaBadge = '📋'; }
      sisaBadge = sisaBadge ? `<span style="margin-left:4px">${sisaBadge}</span>` : '';
    }

    return `
      <div style="background:#131F38;border-radius:12px;padding:14px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">${r.Nama_Penyewa}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.Alamat_Sewa}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="background:${sc.bg};color:${sc.text};border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">${sc.label}</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.4)">${r.Durasi_Bulan} bulan</span>
              <span style="font-size:11px;color:rgba(255,255,255,0.35)">${formatTanggal(r.Tanggal_Mulai)} → ${formatTanggal(r.Tanggal_Selesai)}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${r.Status === 'aktif' ? `
              <div style="font-size:20px;font-weight:800;color:${sisaColor};line-height:1">${sisaHari}${sisaBadge}</div>
              <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:2px">hari lagi</div>
            ` : ''}
          </div>
        </div>
        ${r.Catatan ? `<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.35);border-top:1px solid rgba(255,255,255,0.06);padding-top:8px">${r.Catatan}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
          ${r.Status === 'aktif' ? `<button onclick="openRentalModal('${r.ID}')" style="flex:1;background:rgba(212,168,83,0.1);color:#D4A853;border:1px solid rgba(212,168,83,0.2);border-radius:8px;padding:7px;font-size:11px;cursor:pointer;font-weight:600">Perpanjang / Edit</button>` : ''}
          ${r.Status === 'aktif' ? `<button onclick="selesaikanSewa('${r.ID}')" style="background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:7px 12px;font-size:11px;cursor:pointer">Selesai</button>` : ''}
          ${isAdmin ? `<button onclick="deleteRental('${r.ID}')" style="background:rgba(239,68,68,0.06);color:#f87171;border:1px solid rgba(239,68,68,0.15);border-radius:8px;padding:7px 12px;font-size:11px;cursor:pointer">Hapus</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openRentalModal(editId = null) {
  const modal = document.getElementById('rental-modal');
  const title = document.getElementById('rental-modal-title');
  const editIdEl = document.getElementById('rental-edit-id');
  const perpanjangSec = document.getElementById('rental-perpanjang-section');
  if (!modal) return;

  // Reset form
  ['rental-nama-penyewa', 'rental-alamat', 'rental-start', 'rental-duration', 'rental-catatan-modal', 'rental-perpanjang-bulan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('rental-end-display').textContent = '—';

  if (editId) {
    const r = _allRentals.find(x => x.ID === editId);
    if (!r) return;
    title.textContent = 'Perpanjang / Edit Sewa';
    editIdEl.value = editId;
    document.getElementById('rental-nama-penyewa').value = r.Nama_Penyewa;
    document.getElementById('rental-alamat').value       = r.Alamat_Sewa;
    document.getElementById('rental-start').value        = r.Tanggal_Mulai;
    document.getElementById('rental-duration').value     = r.Durasi_Bulan;
    document.getElementById('rental-catatan-modal').value = r.Catatan || '';
    document.getElementById('rental-end-display').textContent = formatTanggal(r.Tanggal_Selesai);
    if (perpanjangSec) perpanjangSec.style.display = 'block';
  } else {
    title.textContent = 'Tambah Data Sewa';
    editIdEl.value = '';
    if (perpanjangSec) perpanjangSec.style.display = 'none';
  }

  modal.style.display = 'block';
}

function closeRentalModal() {
  const modal = document.getElementById('rental-modal');
  if (modal) modal.style.display = 'none';
}

async function saveRental() {
  const editId = document.getElementById('rental-edit-id')?.value;
  const nama   = document.getElementById('rental-nama-penyewa')?.value?.trim();
  const alamat = document.getElementById('rental-alamat')?.value?.trim();
  const mulai  = document.getElementById('rental-start')?.value;
  const durasi = document.getElementById('rental-duration')?.value;
  const catatan = document.getElementById('rental-catatan-modal')?.value || '';
  const perpanjangBulan = document.getElementById('rental-perpanjang-bulan')?.value || '';

  if (!nama || !alamat || !mulai || !durasi) return showToast('Semua field wajib diisi', 'warning');

  const btn = document.getElementById('rental-save-btn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    if (editId) {
      const body = { catatan };
      if (perpanjangBulan && parseInt(perpanjangBulan) > 0) body.perpanjang_bulan = perpanjangBulan;
      await API.patch(`/rental/${editId}`, body);
      showToast('Data sewa berhasil diupdate', 'success');
    } else {
      await API.post('/rental', {
        nama_penyewa: nama,
        alamat_sewa:  alamat,
        tanggal_mulai: mulai,
        durasi_bulan:  parseInt(durasi),
        catatan,
      });
      showToast('Data sewa berhasil ditambahkan', 'success');
    }
    closeRentalModal();
    await loadRentals();
  } catch (e) {
    showToast(e.message || 'Gagal menyimpan data sewa', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan';
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
        <a href="${d.Drive_URL}" target="_blank" style="color:#60a5fa;font-size:11px;text-decoration:none;flex-shrink:0;font-weight:600">Buka</a>
      </div>
    `).join('');
  } catch (e) {
    console.error('[LEGAL] dashboard widget error:', e);
    el.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.25);font-size:12px;padding:16px 0">Gagal memuat</div>';
  }
}
