// ═══════════════════════════════════════════════════════════
//  KNOWLEDGE CENTER ASSET BANK — Mansion Property CRM
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─── CHECKLIST DATA ──────────────────────────────────────
  const KC_CL = {
    legal: [
      { id: 'kc_cl1', label: 'Sertifikat Valid & Asli (SHM/HGB)' },
      { id: 'kc_cl2', label: 'Tidak Ada Sengketa (PN/Kepolisian)' },
      { id: 'kc_cl3', label: 'Hak Tanggungan Valid & Terdaftar di BPN' },
      { id: 'kc_cl4', label: 'Status Roya Bersih (tidak ada HT lain)' },
      { id: 'kc_cl5', label: 'IMB / PBG Tersedia & Sesuai Bangunan' },
    ],
    physical: [
      { id: 'kc_cp1', label: 'Bangunan Ada & Kondisi Layak Huni' },
      { id: 'kc_cp2', label: 'Akses Jalan Memadai (min. 3 meter)' },
      { id: 'kc_cp3', label: 'Tidak Ada Kerusakan Struktural Berat' },
      { id: 'kc_cp4', label: 'Utilitas Tersedia (listrik, air bersih)' },
    ],
    financial: [
      { id: 'kc_cf1', label: 'Outstanding Kredit Terverifikasi dari Bank' },
      { id: 'kc_cf2', label: 'Nilai Pasar Terkini (NJOP / Appraisal Independen)' },
      { id: 'kc_cf3', label: 'Pajak PBB Lunas & Tidak Ada Tunggakan' },
      { id: 'kc_cf4', label: 'Diskon Min. 20% dari Harga Pasar Wajar' },
      { id: 'kc_cf5', label: 'Tidak Ada Kewajiban Pajak Lain (PPh, BPHTB Est.)' },
    ],
  };
  const KC_CL_ALL = Object.values(KC_CL).flat();

  // ─── CASE STUDY DATA ─────────────────────────────────────
  const KC_CASES = [
    {
      id: 'CS001', type: 'AYDA', color: '#f87171', year: '2025',
      title: 'AYDA Apartemen Darmo Surabaya',
      location: 'Surabaya, Jawa Timur',
      tags: ['AYDA', 'Apartemen', 'Surabaya', 'High ROI'],
      situation: 'Bank BRI mengambil alih unit apartemen 2BR di kawasan Darmo akibat kredit macet 18 bulan. Harga pasar Rp 650 jt, outstanding Rp 480 jt. Debitur tidak tinggal di unit.',
      challenge: 'Unit masih terdaftar atas nama debitur. Proses AYDA memerlukan penilaian ulang dan negosiasi penyelesaian hutang. Risiko tunggakan service charge apartemen Rp 12 jt.',
      resolution: 'Tim legal bank proses AYDA formal. Investor Mansion masuk harga Rp 430 jt (diskon 33.8%). Tunggakan service charge diselesaikan sebelum AJB ditandatangani.',
      outcome: 'Total cost Rp 442 jt. Dijual 6 bulan kemudian Rp 620 jt. Net profit Rp 178 jt. ROI 40.3% dalam 6 bulan.',
    },
    {
      id: 'CS002', type: 'Lelang', color: '#f59e0b', year: '2024',
      title: 'Lelang Rumah Citraland Surabaya',
      location: 'Citraland, Surabaya',
      tags: ['Lelang', 'Rumah', 'KPKNL', 'Renovasi'],
      situation: 'KPKNL Surabaya eksekusi rumah 2 lantai type 150/200 di Citraland akibat kredit macet BNI. Limit lelang Rp 1.2M, nilai pasar Rp 1.8M. 12 peserta terdaftar.',
      challenge: 'Persaingan tinggi di sesi lelang. Kondisi fisik kurang terawat — cat kusam, taman berantakan, kolam renang bocor. Debitur menolak keluar pasca lelang.',
      resolution: 'Due diligence fisik sebelum lelang: estimasi renovasi Rp 80 jt. Menang lelang Rp 1.35M. Proses pengosongan melalui pengadilan 45 hari.',
      outcome: 'Total investasi Rp 1.43M. Dijual Rp 1.95M. Profit bersih Rp 520 jt. ROI 36.4% dalam 9 bulan.',
    },
    {
      id: 'CS003', type: 'Cessie', color: '#a78bfa', year: '2025',
      title: 'Cessie Ruko 3 Lantai Jl. Darmo',
      location: 'Darmo, Surabaya',
      tags: ['Cessie', 'Ruko', 'Passive Income', 'Komersial'],
      situation: 'Pemilik ruko 3 lantai gagal bayar cicilan BCA sejak COVID. Outstanding Rp 2.1M, harga pasar Rp 3.2M. Ruko masih disewa aktif Rp 45 jt/tahun.',
      challenge: 'Proses cessie memerlukan notaris & persetujuan 3 pihak. Debitur awalnya menolak karena ingin jual sendiri. Negosiasi berjalan 3 bulan.',
      resolution: 'Investor ambil alih hutang Rp 2.1M + fee cessie Rp 50 jt. Penyewa dipertahankan — passive income langsung berjalan. Akta cessie di hadapan notaris.',
      outcome: 'Total cost Rp 2.15M. Sewa Rp 45 jt/tahun. Dijual 1.5 tahun kemudian Rp 3.4M. Total return Rp 1.32M. ROI 61.4%.',
    },
    {
      id: 'CS004', type: 'Lelang', color: '#f59e0b', year: '2024',
      title: 'Lelang Gudang Industri Gedangan',
      location: 'Gedangan, Sidoarjo',
      tags: ['Lelang', 'Gudang', 'Konsorsium', 'Industrial'],
      situation: 'KPKNL Sidoarjo lelang gudang 800m² perusahaan manufaktur pailit. Limit lelang Rp 800 jt, nilai pasar Rp 1.35M. Lokasi strategis dekat tol Surabaya–Malang.',
      challenge: 'Modal besar — hanya 4 peserta lelang. IMB hanya untuk gudang, tidak bisa dikonversi ruko. Perlu tenant jangka panjang.',
      resolution: 'Konsorsium 3 investor Mansion memenangkan lelang Rp 870 jt. Sewa jangka panjang ke perusahaan logistik Rp 120 jt/tahun (kontrak 5 tahun).',
      outcome: 'Yield sewa 13.8%/tahun. Capital gain Rp 400 jt dalam 2 tahun. Total IRR 28% per annum.',
    },
    {
      id: 'CS005', type: 'AYDA', color: '#f87171', year: '2025',
      title: 'AYDA Kavling 400m² Malang Kota',
      location: 'Malang, Jawa Timur',
      tags: ['AYDA', 'Tanah', 'Kos-kosan', 'Yield Tinggi'],
      situation: 'Bank Mandiri ambil alih kavling 400m² di Malang kota (dekat kampus) akibat KPR macet. SHM, debitur kooperatif. Nilai pasar Rp 480 jt.',
      challenge: 'Sertifikat masih atas nama debitur. Proses AYDA + balik nama butuh ±3 bulan. Perlu modal pengembangan kos.',
      resolution: 'Investor masuk harga Rp 320 jt (diskon 33%). Proses selesai 75 hari. Dibangun kos-kosan 12 kamar, biaya bangun Rp 360 jt.',
      outcome: 'Total investasi Rp 680 jt. Pendapatan kos Rp 96 jt/tahun (yield 14.1%). Valuasi properti Rp 1.2M dalam 2 tahun.',
    },
  ];

  // ─── DOCUMENT DATA ───────────────────────────────────────
  const KC_DOCS = [
    { id: 'D01', cat: 'Lelang', icon: '📋', title: 'Template Permohonan Lelang KPKNL', desc: 'Format resmi surat permohonan lelang eksekusi ke KPKNL' },
    { id: 'D02', cat: 'Lelang', icon: '✅', title: 'Checklist Dokumen Risalah Lelang', desc: 'Daftar lengkap dokumen yang harus disiapkan setelah memenangkan lelang' },
    { id: 'D03', cat: 'Lelang', icon: '🔍', title: 'SOP Due Diligence Properti Lelang', desc: 'Prosedur standar operasional survei & due diligence sebelum lelang' },
    { id: 'D04', cat: 'Lelang', icon: '🧮', title: 'Kalkulator ROI Aset Lelang', desc: 'Template Excel proyeksi return on investment properti lelang' },
    { id: 'D05', cat: 'Cessie', icon: '📜', title: 'Template Akta Cessie Piutang', desc: 'Draft akta cessie untuk pengalihan piutang dari bank ke investor' },
    { id: 'D06', cat: 'Cessie', icon: '✅', title: 'Checklist Dokumen Cessie Bank', desc: 'Daftar dokumen yang diperlukan untuk proses cessie dari bank' },
    { id: 'D07', cat: 'Cessie', icon: '🤝', title: 'SOP Negosiasi Cessie dengan Debitur', desc: 'Panduan langkah-langkah negosiasi efektif dengan debitur dalam cessie' },
    { id: 'D08', cat: 'AYDA', icon: '🏛️', title: 'Panduan Proses AYDA Bank', desc: 'Panduan lengkap proses Agunan Yang Diambil Alih dari bank ke investor' },
    { id: 'D09', cat: 'AYDA', icon: '📄', title: 'Template Perjanjian AYDA', desc: 'Draft perjanjian pengambilalihan agunan antara bank dan investor' },
    { id: 'D10', cat: 'AYDA', icon: '✅', title: 'Checklist Balik Nama AYDA di BPN', desc: 'Langkah-langkah balik nama sertifikat aset AYDA' },
    { id: 'D11', cat: 'Legal', icon: '⚖️', title: 'Panduan Pengosongan Properti', desc: 'Prosedur hukum untuk mengosongkan properti yang masih ditempati' },
    { id: 'D12', cat: 'Legal', icon: '📩', title: 'Template Surat Somasi', desc: 'Format surat somasi resmi untuk debitur yang menunggak pembayaran' },
    { id: 'D13', cat: 'Legal', icon: '🔓', title: 'Panduan Roya Hak Tanggungan', desc: 'Prosedur roya & penghapusan HT di BPN setelah pelunasan' },
    { id: 'D14', cat: 'SOP', icon: '📊', title: 'SOP Presentasi Aset ke Investor', desc: 'Standar presentasi properti eksekusi bank kepada calon investor' },
    { id: 'D15', cat: 'SOP', icon: '📞', title: 'SOP Handling Investor Inquiry', desc: 'Prosedur standar respon dan penanganan pertanyaan investor aset' },
    { id: 'D16', cat: 'SOP', icon: '💼', title: 'SOP Proses Offer Aset ke Bank', desc: 'Langkah-langkah mengajukan penawaran ke bank untuk aset AYDA/Cessie' },
  ];

  // ─── SCORING ENGINE ──────────────────────────────────────
  function kcCalcScore(p) {
    var d = parseInt(p.discount) || 0;
    var opp = 0, risk = 0;
    var typeBase = { Lelang: 25, AYDA: 22, Cessie: 18 };
    opp += typeBase[p.assetType] || 18;
    if (d >= 40) { opp += 35; risk += 10; }
    else if (d >= 30) { opp += 27; risk += 5; }
    else if (d >= 20) { opp += 18; risk += 2; }
    else if (d >= 10) { opp += 8; }
    else { opp += 2; risk += 5; }
    var occMap = { Kosong: [2, 10], Penyewa: [12, 5], Pemilik: [18, 2], Debitur: [28, 0] };
    var occ = occMap[p.occupancy] || [5, 5];
    risk += occ[0]; opp += occ[1];
    var legalMap = { Clean: [0, 18], 'Need Review': [20, 8], Dispute: [40, -5] };
    var leg = legalMap[p.legalStatus] || [20, 5];
    risk += leg[0]; opp += leg[1];
    var demMap = { High: [0, 12], Medium: [5, 6], Low: [15, 0] };
    var dem = demMap[p.marketDemand] || [5, 6];
    risk += dem[0]; opp += dem[1];
    risk = Math.max(0, Math.min(100, risk));
    opp = Math.max(0, Math.min(100, opp));
    var final = Math.round(opp * 0.65 + (100 - risk) * 0.35);
    var cls, clsColor, clsEmoji;
    if (final >= 90) { cls = 'Hot Deal'; clsColor = '#ef4444'; clsEmoji = '🔥'; }
    else if (final >= 75) { cls = 'Very Good'; clsColor = '#22c55e'; clsEmoji = '⭐'; }
    else if (final >= 60) { cls = 'Good'; clsColor = '#D4A853'; clsEmoji = '✅'; }
    else if (final >= 40) { cls = 'Need Review'; clsColor = '#f59e0b'; clsEmoji = '⚠️'; }
    else { cls = 'High Risk'; clsColor = '#6b7280'; clsEmoji = '❌'; }
    return { risk: risk, opp: opp, final: final, cls: cls, clsColor: clsColor, clsEmoji: clsEmoji };
  }

  // ─── CHECKLIST ───────────────────────────────────────────
  var KC_STORE = 'kc_checklist_v1';
  function kcLoadState() { try { return JSON.parse(localStorage.getItem(KC_STORE)) || {}; } catch(e) { return {}; } }
  function kcSaveState(s) { localStorage.setItem(KC_STORE, JSON.stringify(s)); }

  window.kcUpdateChecklist = function () {
    var state = kcLoadState();
    var total = KC_CL_ALL.length, checked = 0;
    KC_CL_ALL.forEach(function (item) {
      var el = document.getElementById(item.id);
      if (el) { if (el.checked) checked++; state[item.id] = el.checked; }
    });
    kcSaveState(state);
    var pct = total ? Math.round((checked / total) * 100) : 0;
    var bar = document.getElementById('kc-cl-bar');
    var lbl = document.getElementById('kc-cl-label');
    var cnt = document.getElementById('kc-cl-count');
    if (bar) { bar.style.width = pct + '%'; bar.style.background = pct >= 80 ? '#22c55e' : pct >= 50 ? '#D4A853' : '#f87171'; }
    if (lbl) lbl.textContent = pct + '%';
    if (cnt) cnt.textContent = checked + '/' + total + ' Complete';
  };

  window.kcResetChecklist = function () {
    localStorage.removeItem(KC_STORE);
    KC_CL_ALL.forEach(function (item) { var el = document.getElementById(item.id); if (el) el.checked = false; });
    kcUpdateChecklist();
  };

  function kcApplyChecklistState() {
    var state = kcLoadState();
    KC_CL_ALL.forEach(function (item) {
      var el = document.getElementById(item.id);
      if (el && state[item.id]) el.checked = true;
    });
    kcUpdateChecklist();
  }

  // ─── SEARCH / FILTER ─────────────────────────────────────
  window.kcSearchCases = function () {
    var q = ((document.getElementById('kc-case-search') || {}).value || '').toLowerCase().trim();
    var list = q ? KC_CASES.filter(function (c) {
      return c.title.toLowerCase().includes(q) || c.type.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q) || c.tags.some(function (t) { return t.toLowerCase().includes(q); }) ||
        c.situation.toLowerCase().includes(q);
    }) : KC_CASES;
    var cont = document.getElementById('kc-cases-list');
    if (!cont) return;
    cont.innerHTML = list.length ? list.map(kcRenderCase).join('') :
      '<p style="color:rgba(255,255,255,0.35);text-align:center;padding:32px 16px;font-size:13px">Tidak ada case study yang cocok</p>';
  };

  // Dokumen dari API (diisi saat tab Dokumen dibuka)
  var _kcDocsCache = null;
  var _kcDocsFetching = false;

  function _kcApplyDocFilter(cat) {
    document.querySelectorAll('.kc-dfb').forEach(function (b) {
      var active = b.dataset.cat === cat;
      b.style.background = active ? 'rgba(212,168,83,0.2)' : 'rgba(255,255,255,0.04)';
      b.style.borderColor = active ? 'rgba(212,168,83,0.4)' : 'rgba(255,255,255,0.08)';
      b.style.color = active ? '#D4A853' : 'rgba(255,255,255,0.5)';
    });
    var cont = document.getElementById('kc-docs-list');
    if (!cont) return;
    var src = _kcDocsCache || KC_DOCS.map(function(d){ return { id:d.id, title:d.title, category:d.cat, description:d.desc, fileUrl:'#', icon:d.icon, status:'Active' }; });
    var list = cat ? src.filter(function (d) { return d.category === cat; }) : src;
    cont.innerHTML = list.length ? list.map(kcRenderDocApi).join('') :
      '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:24px;font-size:13px">Belum ada dokumen untuk kategori ini</p>';
  }

  function kcRenderDocApi(d) {
    var canOpen = d.fileUrl && d.fileUrl !== '#';
    return '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px">' +
      '<div style="width:42px;height:42px;background:rgba(212,168,83,0.08);border:1px solid rgba(212,168,83,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">' + (d.icon || '📄') + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<p style="color:#fff;font-size:13px;font-weight:600;margin:0 0 3px">' + (d.title || '') + '</p>' +
        '<p style="color:rgba(255,255,255,0.4);font-size:11px;margin:0 0 6px;line-height:1.4">' + (d.description || '') + '</p>' +
        '<span style="background:rgba(212,168,83,0.1);color:#D4A853;font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600">' + (d.category || '') + '</span>' +
      '</div>' +
      (canOpen
        ? '<a href="' + d.fileUrl + '" target="_blank" rel="noopener" style="background:rgba(212,168,83,0.15);border:1px solid rgba(212,168,83,0.3);color:#D4A853;padding:7px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;text-decoration:none;white-space:nowrap">Lihat →</a>'
        : '<button onclick="(window.showToast?showToast(\'URL belum dikonfigurasi\',\'info\'):alert(\'URL belum diset\'))" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.3);padding:7px 12px;border-radius:8px;font-size:11px;cursor:pointer;flex-shrink:0;white-space:nowrap">Belum Tersedia</button>') +
    '</div>';
  }

  window.kcRefreshDocs = async function () {
    if (_kcDocsFetching) return;
    _kcDocsFetching = true;
    _kcDocsCache = null;

    // Tampilkan loading state
    var cont = document.getElementById('kc-docs-list');
    if (cont) cont.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:24px;font-size:13px">⏳ Memuat dokumen dari database...</p>';
    var btn = document.getElementById('kc-docs-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

    try {
      var token = localStorage.getItem('crm_token') || '';
      var resp = await fetch('/api/v1/knowledge/docs', {
        headers: { 'Authorization': 'Bearer ' + token },
        cache: 'no-store'
      });
      if (resp.ok) {
        var json = await resp.json();
        if (json.success && Array.isArray(json.data)) {
          _kcDocsCache = json.data; // bisa [] jika sheet kosong
        }
      }
    } catch(e) { /* fallback ke KC_DOCS */ }

    _kcDocsFetching = false;
    if (btn) { btn.disabled = false; btn.textContent = '↺ Refresh'; }
    _kcApplyDocFilter('');
  };

  window.kcFilterDocs = function (cat) {
    _kcApplyDocFilter(cat);
  };

  // ─── SCORING SUBMIT ──────────────────────────────────────
  window.kcRunScoring = function () {
    var t = (document.getElementById('kc-sc-type') || {}).value;
    var d = (document.getElementById('kc-sc-discount') || {}).value;
    var o = (document.getElementById('kc-sc-occupancy') || {}).value;
    var l = (document.getElementById('kc-sc-legal') || {}).value;
    var m = (document.getElementById('kc-sc-demand') || {}).value;
    if (!t || !o || !l || !m) { if (window.showToast) showToast('Lengkapi semua field terlebih dahulu', 'error'); else alert('Lengkapi semua field!'); return; }
    var r = kcCalcScore({ assetType: t, discount: d, occupancy: o, legalStatus: l, marketDemand: m });
    var card = document.getElementById('kc-sc-result');
    if (!card) return;
    card.style.display = 'block';
    card.innerHTML =
      '<div style="background:#131F38;border:2px solid ' + r.clsColor + '30;border-radius:16px;padding:20px">' +
        '<div style="text-align:center;margin-bottom:20px">' +
          '<div style="font-size:48px;line-height:1.2;margin-bottom:6px">' + r.clsEmoji + '</div>' +
          '<div style="font-size:44px;font-weight:800;color:' + r.clsColor + ';line-height:1">' + r.final + '</div>' +
          '<div style="color:' + r.clsColor + ';font-size:16px;font-weight:700;margin-top:6px">' + r.cls + '</div>' +
          '<div style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:3px">Final Investment Score</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px;text-align:center">' +
            '<div style="color:#4ade80;font-size:26px;font-weight:700">' + r.opp + '</div>' +
            '<div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:3px">Opportunity Score</div>' +
          '</div>' +
          '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:14px;text-align:center">' +
            '<div style="color:#f87171;font-size:26px;font-weight:700">' + r.risk + '</div>' +
            '<div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:3px">Risk Score</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:4px 0">' +
          [['🔥 Hot Deal','#ef4444','90–100'],['⭐ Very Good','#22c55e','75–89'],['✅ Good','#D4A853','60–74'],['⚠️ Need Review','#f59e0b','40–59'],['❌ High Risk','#6b7280','< 40']].map(function(row){
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.04)">' +
              '<span style="color:' + row[1] + ';font-size:12px;font-weight:600">' + row[0] + '</span>' +
              '<span style="color:rgba(255,255,255,0.3);font-size:11px">' + row[2] + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  };

  // ─── RENDER HELPERS ──────────────────────────────────────
  function kcRenderCase(c) {
    var rows = [['Situasi','#60a5fa',c.situation],['Tantangan','#f59e0b',c.challenge],['Solusi','#a78bfa',c.resolution],['Hasil','#4ade80',c.outcome]];
    return '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden;margin-bottom:12px">' +
      '<div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="background:rgba(0,0,0,0.3);color:' + c.color + ';font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid ' + c.color + '40">' + c.type + '</span>' +
          '<span style="color:rgba(255,255,255,0.3);font-size:11px">' + c.id + ' · ' + c.year + '</span>' +
        '</div>' +
        '<span style="color:rgba(255,255,255,0.35);font-size:11px">📍 ' + c.location + '</span>' +
      '</div>' +
      '<div style="padding:14px 16px">' +
        '<h4 style="color:#fff;font-size:14px;font-weight:700;margin:0 0 12px">' + c.title + '</h4>' +
        rows.map(function(r){
          return '<div style="background:rgba(255,255,255,0.03);border-left:3px solid ' + r[1] + '50;border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:7px">' +
            '<p style="color:' + r[1] + ';font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 3px">' + r[0] + '</p>' +
            '<p style="color:rgba(255,255,255,0.65);font-size:12px;margin:0;line-height:1.6">' + r[2] + '</p>' +
          '</div>';
        }).join('') +
        '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:5px">' +
          c.tags.map(function(t){ return '<span style="background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);font-size:10px;padding:2px 8px;border-radius:10px">#' + t + '</span>'; }).join('') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function kcRenderDoc(d) {
    return '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px">' +
      '<div style="width:42px;height:42px;background:rgba(212,168,83,0.08);border:1px solid rgba(212,168,83,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">' + d.icon + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<p style="color:#fff;font-size:13px;font-weight:600;margin:0 0 3px;white-space:normal">' + d.title + '</p>' +
        '<p style="color:rgba(255,255,255,0.4);font-size:11px;margin:0 0 6px;line-height:1.4">' + d.desc + '</p>' +
        '<span style="background:rgba(212,168,83,0.1);color:#D4A853;font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600">' + d.cat + '</span>' +
      '</div>' +
      '<button onclick="(window.showToast ? showToast(\'Dokumen dalam proses digitalisasi. Hubungi admin.\',\'info\') : alert(\'Hubungi admin untuk akses.\'))"' +
        ' style="background:rgba(212,168,83,0.12);border:1px solid rgba(212,168,83,0.3);color:#D4A853;padding:7px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0">Lihat</button>' +
    '</div>';
  }

  // ─── TAB SWITCH ──────────────────────────────────────────
  window.kcSwitchTab = function (tabId) {
    document.querySelectorAll('.kc-tc').forEach(function (el) {
      el.style.display = el.id === 'kc-tab-' + tabId ? 'block' : 'none';
    });
    document.querySelectorAll('.kc-tb').forEach(function (btn) {
      var active = btn.dataset.tab === tabId;
      btn.style.color = active ? '#D4A853' : 'rgba(255,255,255,0.45)';
      btn.style.borderBottom = active ? '2px solid #D4A853' : '2px solid transparent';
      btn.style.background = active ? 'rgba(212,168,83,0.08)' : 'transparent';
    });
    if (tabId === 'checklist') setTimeout(kcApplyChecklistState, 40);
    if (tabId === 'cases') kcSearchCases();
    if (tabId === 'docs') { kcRefreshDocs(); }
  };

  // ─── BUILD MODAL HTML ────────────────────────────────────
  function kcBuildModal() {
    var tabs = [
      { id: 'overview',   icon: '🏠', label: 'Overview' },
      { id: 'lelang',     icon: '🔨', label: 'Lelang' },
      { id: 'cessie',     icon: '📋', label: 'Cessie' },
      { id: 'ayda',       icon: '🏛️', label: 'AYDA' },
      { id: 'checklist',  icon: '✅', label: 'Due Diligence' },
      { id: 'scoring',    icon: '📊', label: 'Scoring' },
      { id: 'cases',      icon: '📚', label: 'Case Study' },
      { id: 'docs',       icon: '📁', label: 'Dokumen' },
    ];

    var tabBtns = tabs.map(function (t) {
      return '<button class="kc-tb" data-tab="' + t.id + '" onclick="kcSwitchTab(\'' + t.id + '\')"' +
        ' style="white-space:nowrap;padding:9px 13px;border:none;border-bottom:2px solid transparent;background:transparent;color:rgba(255,255,255,0.45);font-size:12px;font-weight:600;cursor:pointer;border-radius:8px 8px 0 0;flex-shrink:0">' +
        t.icon + ' ' + t.label + '</button>';
    }).join('');

    // ── Overview content
    var overviewCompareCols = [
      ['Dasar Hukum','PMK 213/2020','Ps. 613 KUHPer','PBI 14/15/2012'],
      ['Diskon Harga','20–50%','15–35%','20–40%'],
      ['Kecepatan','Cepat','Sedang','Sedang–Lambat'],
      ['Risiko Penghuni','Tinggi','Sedang','Rendah–Sedang'],
      ['Kejelasan Hukum','Sangat Jelas','Perlu Verifikasi','Jelas (Bank)'],
      ['Pelaku Utama','KPKNL / Balai','Bank + Investor','Bank (langsung)'],
      ['Potensi Profit','★★★★☆','★★★★★','★★★☆☆'],
    ];
    var compareRows = overviewCompareCols.map(function (r, i) {
      return '<tr style="background:' + (i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent') + '">' +
        ['<td style="padding:9px 14px;color:rgba(255,255,255,0.7);font-size:12px;border:1px solid rgba(255,255,255,0.05);font-weight:600">' + r[0] + '</td>',
         '<td style="padding:9px 14px;color:rgba(255,255,255,0.6);font-size:12px;border:1px solid rgba(255,255,255,0.05);text-align:center">' + r[1] + '</td>',
         '<td style="padding:9px 14px;color:rgba(255,255,255,0.6);font-size:12px;border:1px solid rgba(255,255,255,0.05);text-align:center">' + r[2] + '</td>',
         '<td style="padding:9px 14px;color:rgba(255,255,255,0.6);font-size:12px;border:1px solid rgba(255,255,255,0.05);text-align:center">' + r[3] + '</td>',
        ].join('') + '</tr>';
    }).join('');

    var tabOverview =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:22px">' +
        [
          { emoji: '🔨', label: 'Lelang', color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.2)',
            desc: 'Penjualan paksa aset oleh KPKNL/balai lelang atas perintah hukum akibat kredit macet. Mekanisme paling transparan dan terbuka untuk publik.' },
          { emoji: '📋', label: 'Cessie', color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', border: 'rgba(167,139,250,0.2)',
            desc: 'Pengalihan hak tagih piutang dari kreditur lama (bank) kepada investor berdasarkan Pasal 613 KUH Perdata. Investor menggantikan posisi bank.' },
          { emoji: '🏛️', label: 'AYDA', color: '#f87171', bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.2)',
            desc: 'Agunan Yang Diambil Alih — aset yang diserahkan debitur kepada bank sebagai penyelesaian kredit, lalu dijual bank kepada investor.' },
        ].map(function (c) {
          return '<div style="background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:14px;padding:16px">' +
            '<div style="font-size:28px;margin-bottom:8px">' + c.emoji + '</div>' +
            '<h3 style="color:' + c.color + ';font-size:15px;font-weight:700;margin:0 0 8px">' + c.label + '</h3>' +
            '<p style="color:rgba(255,255,255,0.6);font-size:12px;line-height:1.6;margin:0">' + c.desc + '</p>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">Perbandingan</h3>' +
      '<div style="overflow-x:auto;margin-bottom:22px"><table style="width:100%;border-collapse:collapse;min-width:480px">' +
        '<thead><tr style="background:rgba(212,168,83,0.08)">' +
          '<th style="padding:10px 14px;text-align:left;color:#D4A853;font-size:12px;border:1px solid rgba(255,255,255,0.06)">Aspek</th>' +
          '<th style="padding:10px 14px;text-align:center;color:#f59e0b;font-size:12px;border:1px solid rgba(255,255,255,0.06)">🔨 Lelang</th>' +
          '<th style="padding:10px 14px;text-align:center;color:#a78bfa;font-size:12px;border:1px solid rgba(255,255,255,0.06)">📋 Cessie</th>' +
          '<th style="padding:10px 14px;text-align:center;color:#f87171;font-size:12px;border:1px solid rgba(255,255,255,0.06)">🏛️ AYDA</th>' +
        '</tr></thead><tbody>' + compareRows + '</tbody></table></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">' +
        [
          { title: '✅ Keunggulan', color: '#4ade80', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.2)',
            items: ['Harga di bawah harga pasar','Status hukum bank terjamin','Potensi capital gain tinggi','Bisa kerjasama konsorsium'] },
          { title: '⚠️ Risiko', color: '#f87171', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.2)',
            items: ['Penghuni yang sulit dikeluarkan','Kondisi fisik tidak sempurna','Proses balik nama butuh waktu','Potensi sengketa tersembunyi'] },
          { title: '💰 Potensi Profit', color: '#D4A853', bg: 'rgba(212,168,83,0.06)', border: 'rgba(212,168,83,0.2)',
            items: ['ROI 20–60% dalam 1–2 tahun','Passive income dari sewa','Capital gain jangka panjang','Diversifikasi portofolio'] },
        ].map(function (c) {
          return '<div style="background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:12px;padding:14px">' +
            '<h4 style="color:' + c.color + ';font-size:13px;margin:0 0 10px">' + c.title + '</h4>' +
            '<ul style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;padding-left:16px;line-height:2.1">' +
            c.items.map(function(i){ return '<li>' + i + '</li>'; }).join('') + '</ul></div>';
        }).join('') +
      '</div>';

    // ── Lelang docs helper
    function docGrid(items, color) {
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:20px">' +
        items.map(function (d) {
          return '<div style="background:#131F38;border:1px solid ' + color + '20;border-radius:10px;padding:12px;display:flex;gap:10px;align-items:flex-start">' +
            '<span style="color:' + color + ';font-size:15px;flex-shrink:0">📋</span>' +
            '<div><p style="color:#fff;font-size:12px;font-weight:600;margin:0 0 3px">' + d[0] + '</p>' +
            '<p style="color:rgba(255,255,255,0.4);font-size:11px;margin:0;line-height:1.4">' + d[1] + '</p></div></div>';
        }).join('') +
      '</div>';
    }

    function timelineStep(steps, color) {
      return '<div style="position:relative;padding-left:30px">' +
        '<div style="position:absolute;left:11px;top:0;bottom:0;width:2px;background:' + color + '25;border-radius:1px"></div>' +
        steps.map(function (s, i) {
          return '<div style="position:relative;margin-bottom:14px">' +
            '<div style="position:absolute;left:-30px;top:3px;width:22px;height:22px;background:' + color + ';border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#0D1526">' + (i + 1) + '</div>' +
            '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:11px 13px">' +
            '<p style="color:' + color + ';font-size:12px;font-weight:700;margin:0 0 3px">' + s[0] + '</p>' +
            '<p style="color:rgba(255,255,255,0.55);font-size:12px;margin:0;line-height:1.5">' + s[1] + '</p>' +
            '</div></div>';
        }).join('') +
      '</div>';
    }

    var tabLelang =
      '<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:14px;padding:16px;margin-bottom:20px">' +
        '<h3 style="color:#f59e0b;font-size:15px;font-weight:700;margin:0 0 8px">🔨 Definisi Lelang Eksekusi</h3>' +
        '<p style="color:rgba(255,255,255,0.7);font-size:13px;line-height:1.7;margin:0">Lelang eksekusi adalah penjualan aset/properti oleh <strong style="color:#f59e0b">KPKNL (Kantor Pelayanan Kekayaan Negara dan Lelang)</strong> atau Balai Lelang Swasta berdasarkan Pasal 6 UUHT No. 4/1996. Digunakan saat debitur gagal bayar kredit bank, sehingga bank berhak mengeksekusi jaminan tanpa melalui pengadilan (<em>Parate Eksekusi</em>).</p>' +
      '</div>' +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">📄 Dokumen Wajib</h3>' +
      docGrid([
        ['Sertifikat (SHM/HGB)','Bukti kepemilikan tanah/bangunan yang dijaminkan'],
        ['APHT (Akta Pemberian HT)','Dokumen pembebanan jaminan kredit di BPN'],
        ['SHT (Sertifikat Hak Tanggungan)','Bukti pendaftaran Hak Tanggungan di BPN'],
        ['Akad Kredit','Perjanjian kredit antara bank dan debitur'],
        ['Surat Wanprestasi','Bukti formal kelalaian/tunggakan debitur'],
        ['Risalah Lelang','Berita acara resmi hasil pelaksanaan lelang'],
        ['Surat Roya','Penghapusan Hak Tanggungan setelah pelunasan'],
      ], '#f59e0b') +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px">⏱️ Alur Proses Lelang</h3>' +
      timelineStep([
        ['Kredit Macet (NPL)','Debitur menunggak ≥ 3 bulan, masuk kategori kredit bermasalah (Non-Performing Loan)'],
        ['Somasi SP 1–3','Bank mengirim surat peringatan bertahap sebelum pengajuan eksekusi'],
        ['Permohonan ke KPKNL','Bank mengajukan permohonan lelang eksekusi ke kantor KPKNL setempat dengan seluruh dokumen'],
        ['Pengumuman Lelang','KPKNL mengumumkan jadwal 14–30 hari sebelumnya via media massa dan situs DJKN'],
        ['Pelaksanaan Lelang','Peserta teregistrasi mengajukan penawaran secara open bidding atau closed bidding'],
        ['Pelunasan','Pemenang lelang melunasi 100% pembayaran dalam 5 hari kerja setelah penetapan'],
        ['Risalah Lelang','KPKNL menerbitkan Risalah Lelang — dokumen hukum sah pengalihan kepemilikan'],
        ['Balik Nama di BPN','Proses balik nama sertifikat ke nama pemenang (30–60 hari kerja)'],
      ], '#f59e0b') +
      '<div style="background:rgba(212,168,83,0.06);border:1px solid rgba(212,168,83,0.2);border-radius:12px;padding:14px;margin-top:16px">' +
        '<h4 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 10px">💡 Tips untuk Agen</h4>' +
        '<ul style="color:rgba(255,255,255,0.65);font-size:12px;margin:0;padding-left:16px;line-height:2">' +
          '<li>Daftarkan investor sebagai peserta lelang minimal <strong>H-7</strong> dari jadwal</li>' +
          '<li>Cek riwayat sengketa di Pengadilan Negeri setempat sebelum mendaftar</li>' +
          '<li>Survei fisik sendiri — jangan hanya mengandalkan deskripsi KPKNL</li>' +
          '<li>Siapkan dana tunai penuh — pembayaran harus dalam 5 hari kerja</li>' +
          '<li>Koordinasikan dengan notaris rekanan untuk Risalah → AJB → Balik Nama</li>' +
        '</ul>' +
      '</div>';

    var tabCessie =
      '<div style="background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.2);border-radius:14px;padding:16px;margin-bottom:20px">' +
        '<h3 style="color:#a78bfa;font-size:15px;font-weight:700;margin:0 0 8px">📋 Definisi Cessie</h3>' +
        '<p style="color:rgba(255,255,255,0.7);font-size:13px;line-height:1.7;margin:0">Cessie adalah pengalihan hak tagih piutang dari <strong style="color:#a78bfa">cedent (kreditur lama/bank)</strong> kepada <strong style="color:#a78bfa">cessionaris (kreditur baru/investor)</strong> berdasarkan <strong>Pasal 613 KUH Perdata</strong>. Investor membeli piutang kredit macet dengan harga diskon, lalu berhak menagih seluruh outstanding kepada debitur atau mengeksekusi jaminan.</p>' +
      '</div>' +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px">🔄 Alur Cessie</h3>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:22px;flex-wrap:wrap">' +
        [
          { e: 'Bank', sub: 'Cedent', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', brd: 'rgba(96,165,250,0.3)' },
          { arrow: '→', lbl: 'Akta Cessie\n(Notaris)' },
          { e: 'Investor', sub: 'Cessionaris', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', brd: 'rgba(167,139,250,0.3)' },
          { arrow: '→', lbl: 'Notifikasi\nDebitur' },
          { e: 'Debitur', sub: 'Wajib bayar ke Investor', color: '#f87171', bg: 'rgba(248,113,113,0.1)', brd: 'rgba(248,113,113,0.3)' },
        ].map(function (item) {
          if (item.arrow) return '<div style="text-align:center"><div style="color:rgba(255,255,255,0.3);font-size:22px">' + item.arrow + '</div><div style="color:rgba(255,255,255,0.3);font-size:9px;white-space:pre;line-height:1.5">' + item.lbl + '</div></div>';
          return '<div style="background:' + item.bg + ';border:2px solid ' + item.brd + ';border-radius:14px;padding:14px 16px;text-align:center;min-width:100px">' +
            '<div style="color:' + item.color + ';font-size:15px;font-weight:800;margin-bottom:4px">' + item.e + '</div>' +
            '<div style="color:rgba(255,255,255,0.35);font-size:10px">' + item.sub + '</div></div>';
        }).join('') +
      '</div>' +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">📄 Dokumen Wajib Cessie</h3>' +
      docGrid([
        ['Akta Cessie Piutang','Akta notaris resmi pengalihan hak tagih ke investor'],
        ['Perjanjian Kredit Asli','Kontrak kredit bank dengan debitur (asli)'],
        ['APHT + SHT','Bukti jaminan kredit terdaftar di BPN'],
        ['Sertifikat Properti Jaminan','SHM/HGB yang dijaminkan sebagai agunan kredit'],
        ['Outstanding Hutang Terkini','Pokok + bunga + denda per tanggal cessie ditandatangani'],
        ['Riwayat Pembayaran Debitur','Rekap cicilan debitur dari awal kredit hingga macet'],
        ['Notifikasi ke Debitur','Pemberitahuan resmi bahwa kreditur sudah berganti ke investor'],
      ], '#a78bfa') +
      '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px">' +
        '<h4 style="color:#a78bfa;font-size:13px;font-weight:700;margin:0 0 12px">⚖️ Hubungan Hukum dalam Cessie</h4>' +
        [
          ['Hak Investor (Cessionaris)','Menagih seluruh outstanding kepada debitur, mengeksekusi jaminan jika debitur tetap macet, atau menjual piutang kembali (sub-cessie)','#a78bfa'],
          ['Kewajiban Bank (Cedent)','Menyerahkan semua dokumen kredit asli, menotifikasi debitur secara resmi, menjamin tidak ada sengketa piutang ganda','#60a5fa'],
          ['Posisi Debitur','Tetap wajib bayar — hanya kepada investor. Debitur <em>tidak perlu menyetujui</em> cessie; cukup dinotifikasi secara resmi oleh notaris atau kepala kantor bank','#f59e0b'],
        ].map(function (r) {
          return '<div style="background:rgba(' + (r[2] === '#a78bfa' ? '167,139,250' : r[2] === '#60a5fa' ? '96,165,250' : '245,158,11') + ',0.04);border-left:3px solid ' + r[2] + '50;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px">' +
            '<p style="color:' + r[2] + ';font-size:11px;font-weight:700;margin:0 0 4px">' + r[0] + '</p>' +
            '<p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;line-height:1.5">' + r[1] + '</p></div>';
        }).join('') +
      '</div>' +
      '<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:14px;padding:16px;margin-top:16px">' +
        '<h4 style="color:#f59e0b;font-size:13px;font-weight:700;margin:0 0 12px">💰 Estimasi Biaya Cessie <span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.35)">(per sertifikat)</span></h4>' +
        '<div style="display:flex;flex-direction:column;gap:6px">' +
          [
            ['📝 SKPT (Surat Keterangan Pendaftaran Tanah)', 'Rp 1.000.000'],
            ['⚖️ Notaris (per bidang)', 'Rp 2.500.000'],
            ['📰 Iklan Lelang (1x tayang)', 'Rp 4.500.000'],
            ['🔍 KJPP (Appraisal Independen)', 'Rp 5.000.000'],
            ['📁 Jasa Pengurusan Dokumen A–Z s.d. Lelang', 'Rp 6.000.000'],
          ].map(function (row) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px">' +
              '<span style="color:rgba(255,255,255,0.65);font-size:12px">' + row[0] + '</span>' +
              '<span style="color:#f59e0b;font-size:12px;font-weight:700;flex-shrink:0;margin-left:12px">' + row[1] + '</span>' +
            '</div>';
          }).join('') +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:8px;margin-top:4px">' +
            '<span style="color:#f59e0b;font-size:13px;font-weight:700">TOTAL ESTIMASI</span>' +
            '<span style="color:#f59e0b;font-size:13px;font-weight:800">Rp 16.000.000 – Rp 18.500.000</span>' +
          '</div>' +
        '</div>' +
        '<p style="color:rgba(255,255,255,0.3);font-size:10px;margin:10px 0 0;line-height:1.5">* Biaya dapat bervariasi tergantung bank, notaris, dan kompleksitas dokumen. Harga belum termasuk BPHTB & PPh.</p>' +
      '</div>';

    var tabAYDA =
      '<div style="background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);border-radius:14px;padding:16px;margin-bottom:20px">' +
        '<h3 style="color:#f87171;font-size:15px;font-weight:700;margin:0 0 8px">🏛️ Definisi AYDA</h3>' +
        '<p style="color:rgba(255,255,255,0.7);font-size:13px;line-height:1.7;margin:0"><strong style="color:#f87171">AYDA (Agunan Yang Diambil Alih)</strong> adalah aset yang diserahkan debitur kepada bank sebagai penyelesaian kredit macet, diatur dalam <strong>PBI No. 14/15/PBI/2012</strong>. Bank hanya boleh menahan AYDA selama <strong>1 tahun</strong> (bank umum) atau <strong>2 tahun</strong> (BPR) sebelum wajib dijual. Ini menciptakan insentif bagi bank untuk menawarkan harga kompetitif kepada investor.</p>' +
      '</div>' +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">📄 Dokumen AYDA</h3>' +
      docGrid([
        ['Sertifikat Asli (SHM/HGB)','Masih atas nama debitur, diproses melalui mekanisme AYDA'],
        ['Akta Pengambilalihan Agunan','Dokumen bank mengambil alih fisik aset dari debitur'],
        ['APHT + SHT','Hak tanggungan yang menjadi dasar pengambilalihan'],
        ['Laporan Penilaian Appraisal','Nilai pasar wajar aset per tanggal penilaian'],
        ['Surat Persetujuan Direksi Bank','Otorisasi manajemen bank untuk menjual AYDA'],
        ['Berita Acara Serah Terima','Dokumentasi penyerahan fisik aset dari debitur ke bank'],
      ], '#f87171') +
      '<h3 style="color:#D4A853;font-size:13px;font-weight:700;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px">⏱️ Alur Proses AYDA</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:20px">' +
        [
          ['1','Kredit Macet','Debitur tidak mampu bayar','#f87171'],
          ['2','Negosiasi Bank','Bank tawarkan penyelesaian sukarela','#f59e0b'],
          ['3','Serah Terima','Debitur serahkan fisik aset','#a78bfa'],
          ['4','Status AYDA','Aset tercatat dalam neraca bank','#60a5fa'],
          ['5','Penilaian Ulang','Appraisal independen oleh KJPP','#D4A853'],
          ['6','Jual ke Investor','Bank tawarkan harga kompetitif','#4ade80'],
        ].map(function (s) {
          return '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px;text-align:center">' +
            '<div style="width:28px;height:28px;background:' + s[3] + '20;border:2px solid ' + s[3] + '40;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:' + s[3] + ';margin:0 auto 8px">' + s[0] + '</div>' +
            '<p style="color:#fff;font-size:11px;font-weight:600;margin:0 0 4px">' + s[1] + '</p>' +
            '<p style="color:rgba(255,255,255,0.4);font-size:10px;margin:0;line-height:1.4">' + s[2] + '</p></div>';
        }).join('') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:14px">' +
          '<h4 style="color:#4ade80;font-size:13px;margin:0 0 10px">✅ Keunggulan AYDA</h4>' +
          '<ul style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;padding-left:16px;line-height:2.1">' +
            '<li>Tidak ada persaingan sesi lelang</li><li>Harga bisa dinegosiasi langsung</li>' +
            '<li>Bank punya insentif jual cepat</li><li>Debitur sudah kooperatif</li>' +
            '<li>Dokumentasi aset lebih lengkap</li>' +
          '</ul></div>' +
        '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px">' +
          '<h4 style="color:#f87171;font-size:13px;margin:0 0 10px">⚠️ Risiko AYDA</h4>' +
          '<ul style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;padding-left:16px;line-height:2.1">' +
            '<li>Proses balik nama lebih kompleks</li><li>Mungkin masih ada penghuni</li>' +
            '<li>Harga bank bisa kurang kompetitif</li><li>Kondisi fisik bervariasi</li>' +
            '<li>Potensi tunggakan utilitas</li>' +
          '</ul></div>' +
      '</div>' +
      '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px">' +
        '<p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 10px">Lihat case study AYDA lengkap dengan detail investasi nyata di tab Case Study.</p>' +
        '<button onclick="kcSwitchTab(\'cases\')" style="background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">📚 Buka Case Study →</button>' +
      '</div>';

    // Checklist
    var clCats = [
      { key: 'legal',    title: '⚖️ Legal',    color: '#60a5fa', items: KC_CL.legal },
      { key: 'physical', title: '🏠 Fisik',    color: '#4ade80', items: KC_CL.physical },
      { key: 'financial',title: '💰 Finansial', color: '#D4A853', items: KC_CL.financial },
    ];
    var tabChecklist =
      '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;margin-bottom:20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">' +
          '<h3 style="color:#fff;font-size:15px;font-weight:700;margin:0">Progress Due Diligence</h3>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span id="kc-cl-count" style="color:#D4A853;font-size:13px;font-weight:700">0/' + KC_CL_ALL.length + ' Complete</span>' +
            '<button onclick="kcResetChecklist()" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;padding:5px 10px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer">Reset</button>' +
          '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.06);border-radius:6px;height:10px;overflow:hidden"><div id="kc-cl-bar" style="height:100%;width:0%;background:#f87171;border-radius:6px;transition:width 0.4s"></div></div>' +
        '<div style="text-align:right;margin-top:5px"><span id="kc-cl-label" style="color:rgba(255,255,255,0.4);font-size:12px">0%</span></div>' +
      '</div>' +
      clCats.map(function (cat) {
        return '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:16px;margin-bottom:12px">' +
          '<h4 style="color:' + cat.color + ';font-size:13px;font-weight:700;margin:0 0 12px">' + cat.title + '</h4>' +
          cat.items.map(function (item) {
            return '<label style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;cursor:pointer;margin-bottom:6px;border:1px solid rgba(255,255,255,0.04)">' +
              '<input type="checkbox" id="' + item.id + '" onchange="kcUpdateChecklist()" style="width:16px;height:16px;accent-color:' + cat.color + ';cursor:pointer;flex-shrink:0"/>' +
              '<span style="color:rgba(255,255,255,0.75);font-size:13px;line-height:1.4">' + item.label + '</span></label>';
          }).join('') +
        '</div>';
      }).join('') +
      '<div style="background:rgba(212,168,83,0.05);border:1px solid rgba(212,168,83,0.15);border-radius:12px;padding:14px">' +
        '<p style="color:rgba(255,255,255,0.45);font-size:12px;line-height:1.6;margin:0">💡 Progress tersimpan otomatis di browser. Gunakan tombol <strong style="color:#f87171">Reset</strong> untuk memulai evaluasi aset baru.</p>' +
      '</div>';

    // Scoring tab
    var tabScoring =
      '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px;margin-bottom:16px">' +
        '<h3 style="color:#D4A853;font-size:15px;font-weight:700;margin:0 0 18px">📊 Investment Scoring Engine</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:20px">' +
          [
            { id: 'kc-sc-type', label: 'Tipe Aset', opts: [['','— Pilih —'],['Lelang','🔨 Lelang'],['Cessie','📋 Cessie'],['AYDA','🏛️ AYDA']] },
            { id: 'kc-sc-occupancy', label: 'Status Penghunian', opts: [['','— Pilih —'],['Kosong','🏠 Kosong'],['Penyewa','👤 Penyewa'],['Pemilik','👨‍👩‍👧 Pemilik (non-debitur)'],['Debitur','⚠️ Debitur (masih di sana)']] },
            { id: 'kc-sc-legal', label: 'Status Legal', opts: [['','— Pilih —'],['Clean','✅ Clean & Clear'],['Need Review','⚠️ Need Review'],['Dispute','❌ Dispute/Sengketa']] },
            { id: 'kc-sc-demand', label: 'Permintaan Pasar', opts: [['','— Pilih —'],['High','🔥 High Demand'],['Medium','📈 Medium'],['Low','📉 Low Demand']] },
          ].map(function (f) {
            return '<div><label style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:600;display:block;margin-bottom:6px">' + f.label + '</label>' +
              '<select id="' + f.id + '" style="width:100%;background:#0D1526;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 12px;color:#fff;font-size:13px;outline:none">' +
              f.opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') +
              '</select></div>';
          }).join('') +
          '<div><label style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:600;display:block;margin-bottom:6px">Diskon dari Harga Pasar</label>' +
            '<div style="display:flex;align-items:center;gap:10px;padding:10px 0">' +
              '<input type="range" id="kc-sc-discount" min="0" max="60" value="25" oninput="document.getElementById(\'kc-sc-disc-val\').textContent=this.value+\'%\'" style="flex:1;accent-color:#D4A853"/>' +
              '<span id="kc-sc-disc-val" style="color:#D4A853;font-size:14px;font-weight:700;min-width:36px;text-align:right">25%</span>' +
            '</div></div>' +
        '</div>' +
        '<button onclick="kcRunScoring()" style="width:100%;background:#D4A853;color:#0D1526;border:none;padding:13px;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:0.3px">📊 Hitung Investment Score</button>' +
      '</div>' +
      '<div id="kc-sc-result" style="display:none"></div>';

    // Cases + Docs tabs
    var tabCases =
      '<div style="margin-bottom:16px"><input id="kc-case-search" type="text" placeholder="🔍 Cari tipe, lokasi, atau keyword..." oninput="kcSearchCases()" style="width:100%;background:#131F38;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:11px 14px;color:#fff;font-size:13px;outline:none;box-sizing:border-box"/></div>' +
      '<div id="kc-cases-list"></div>';

    var tabDocs =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">' +
        ['','Lelang','Cessie','AYDA','Legal','SOP'].map(function (cat) {
          var active = cat === '';
          return '<button class="kc-dfb" data-cat="' + cat + '" onclick="kcFilterDocs(\'' + cat + '\')" style="background:' + (active ? 'rgba(212,168,83,0.2)' : 'rgba(255,255,255,0.04)') + ';border:1px solid ' + (active ? 'rgba(212,168,83,0.4)' : 'rgba(255,255,255,0.08)') + ';color:' + (active ? '#D4A853' : 'rgba(255,255,255,0.5)') + ';padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer">' + (cat || 'Semua') + '</button>';
        }).join('') +
        '<button id="kc-docs-refresh-btn" onclick="kcRefreshDocs()" style="margin-left:auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.45);padding:7px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer">↺ Refresh</button>' +
      '</div>' +
      '<div id="kc-docs-list" style="display:grid;gap:10px"></div>';

    // ── Assemble tabs
    var tabContents = [
      { id: 'overview',  html: tabOverview },
      { id: 'lelang',    html: tabLelang },
      { id: 'cessie',    html: tabCessie },
      { id: 'ayda',      html: tabAYDA },
      { id: 'checklist', html: tabChecklist },
      { id: 'scoring',   html: tabScoring },
      { id: 'cases',     html: tabCases },
      { id: 'docs',      html: tabDocs },
    ];

    var modal = document.createElement('div');
    modal.id = 'modal-knowledge-center';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:250;background:rgba(0,0,0,0.88);overflow-y:auto;padding:12px 12px 80px;-webkit-overflow-scrolling:touch';

    modal.innerHTML =
      '<div style="background:#0D1526;border:1px solid rgba(255,255,255,0.08);border-radius:20px;max-width:860px;margin:0 auto;overflow:hidden">' +
        '<div style="background:linear-gradient(135deg,#131F38,#0D1526);border-bottom:1px solid rgba(255,255,255,0.07);position:sticky;top:0;z-index:10">' +
          '<div style="padding:16px 20px 0">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
              '<div style="display:flex;align-items:center;gap:10px">' +
                '<div style="width:34px;height:34px;background:rgba(212,168,83,0.12);border:1px solid rgba(212,168,83,0.3);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:17px">📖</div>' +
                '<div>' +
                  '<h2 style="font-family:\'DM Serif Display\',serif;font-size:16px;color:#fff;margin:0;line-height:1.2">Knowledge Center</h2>' +
                  '<p style="color:#D4A853;font-size:11px;margin:0;line-height:1.3">Asset Bank · Mansion Property</p>' +
                '</div>' +
              '</div>' +
              '<button onclick="closeKnowledgeCenter()" style="width:32px;height:32px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:50%;color:rgba(255,255,255,0.6);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>' +
            '</div>' +
            '<div style="display:flex;overflow-x:auto;gap:2px;-ms-overflow-style:none;scrollbar-width:none">' + tabBtns + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:20px">' +
          tabContents.map(function (t, i) {
            return '<div id="kc-tab-' + t.id + '" class="kc-tc" style="display:' + (i === 0 ? 'block' : 'none') + '">' + t.html + '</div>';
          }).join('') +
        '</div>' +
      '</div>';

    modal.onclick = function (e) { if (e.target === modal) closeKnowledgeCenter(); };
    document.body.appendChild(modal);
    return modal;
  }

  // ─── PUBLIC API ───────────────────────────────────────────
  window.openKnowledgeCenter = function (tabId) {
    tabId = tabId || 'overview';
    var modal = document.getElementById('modal-knowledge-center') || kcBuildModal();
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    kcSwitchTab(tabId);
  };

  window.closeKnowledgeCenter = function () {
    var modal = document.getElementById('modal-knowledge-center');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  // ═══════════════════════════════════════════════════════════
  //  ASSET ANALYSIS INTEGRATION — Due Diligence, Scoring, Case Study
  //  Dipanggil dari openAssetDetail(a) di app-mobile.js
  // ═══════════════════════════════════════════════════════════

  // ─── Current asset cache (set by kcInitAssetAnalysis) ────
  var _kcAsset = null;

  // ─── Per-asset checklist storage ─────────────────────────
  function _aclKey(id) { return 'kc_acl_' + id; }
  function _aclLoad(id) { try { return JSON.parse(localStorage.getItem(_aclKey(id))) || {}; } catch(e) { return {}; } }
  function _aclSave(id, s) { localStorage.setItem(_aclKey(id), JSON.stringify(s)); }

  window.kcAssetClUpdate = function (assetId) {
    var state = _aclLoad(assetId), total = KC_CL_ALL.length, checked = 0;
    KC_CL_ALL.forEach(function (item) {
      var el = document.getElementById('aad_' + item.id);
      if (el) { if (el.checked) checked++; state[item.id] = el.checked; }
    });
    _aclSave(assetId, state);
    var pct = total ? Math.round(checked / total * 100) : 0;
    var bar = document.getElementById('aad-cl-bar');
    var lbl = document.getElementById('aad-cl-label');
    var cnt = document.getElementById('aad-cl-count');
    if (bar) { bar.style.width = pct + '%'; bar.style.background = pct >= 80 ? '#22c55e' : pct >= 50 ? '#D4A853' : '#f87171'; }
    if (lbl) lbl.textContent = pct + '%';
    if (cnt) cnt.textContent = checked + '/' + total + ' Complete';
  };

  window.kcAssetClReset = function (assetId) {
    localStorage.removeItem(_aclKey(assetId));
    KC_CL_ALL.forEach(function (item) { var el = document.getElementById('aad_' + item.id); if (el) el.checked = false; });
    kcAssetClUpdate(assetId);
  };

  // ─── Auto-score from asset fields ────────────────────────
  function _assetDiscount(a) {
    var limit = parseFloat(a.Harga_Limit_Lelang) || 0;
    var pasar = parseFloat(a.Est_Harga_Pasar) || 0;
    if (pasar > 0 && limit > 0 && pasar > limit) return Math.round((pasar - limit) / pasar * 100);
    return 0;
  }

  function _assetAutoScore(a, occupancy, legalStatus, marketDemand) {
    var label = (a.Label_Asset || '').trim() || 'Lelang';
    var disc = _assetDiscount(a);
    return kcCalcScore({
      assetType: label,
      discount: disc,
      occupancy: occupancy || 'Kosong',
      legalStatus: legalStatus || 'Need Review',
      marketDemand: marketDemand || 'Medium',
    });
  }

  // ─── Score result card HTML ──────────────────────────────
  function _scoreCardHtml(r) {
    return '<div style="background:#0D1526;border:2px solid ' + r.clsColor + '30;border-radius:14px;padding:16px">' +
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">' +
        '<div style="text-align:center;flex-shrink:0">' +
          '<div style="font-size:36px;line-height:1">' + r.clsEmoji + '</div>' +
          '<div style="font-size:30px;font-weight:800;color:' + r.clsColor + ';line-height:1.1">' + r.final + '</div>' +
          '<div style="color:' + r.clsColor + ';font-size:12px;font-weight:700">' + r.cls + '</div>' +
        '</div>' +
        '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:8px;text-align:center">' +
            '<div style="color:#4ade80;font-size:18px;font-weight:700">' + r.opp + '</div>' +
            '<div style="color:rgba(255,255,255,0.4);font-size:10px">Opportunity</div>' +
          '</div>' +
          '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:8px;text-align:center">' +
            '<div style="color:#f87171;font-size:18px;font-weight:700">' + r.risk + '</div>' +
            '<div style="color:rgba(255,255,255,0.4);font-size:10px">Risk</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:4px 0">' +
        [['🔥 Hot Deal','#ef4444','90–100'],['⭐ Very Good','#22c55e','75–89'],['✅ Good','#D4A853','60–74'],['⚠️ Need Review','#f59e0b','40–59'],['❌ High Risk','#6b7280','< 40']].map(function(row){
          var active = (r.final >= 90 && row[0].includes('Hot')) || (r.final >= 75 && r.final < 90 && row[0].includes('Very')) || (r.final >= 60 && r.final < 75 && row[0].includes('Good') && !row[0].includes('Very')) || (r.final >= 40 && r.final < 60 && row[0].includes('Review')) || (r.final < 40 && row[0].includes('Risk'));
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.04);background:' + (active ? row[1] + '15' : 'transparent') + '">' +
            '<span style="color:' + row[1] + ';font-size:11px;font-weight:' + (active ? '700' : '500') + '">' + row[0] + '</span>' +
            '<span style="color:rgba(255,255,255,0.3);font-size:10px">' + row[2] + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  // ─── Sub-tab switcher ────────────────────────────────────
  window.kcAssetTab = function (tabId) {
    ['dd','sc','cs'].forEach(function (t) {
      var btn = document.getElementById('aad-btn-' + t);
      var con = document.getElementById('aad-con-' + t);
      var active = t === tabId;
      if (btn) { btn.style.background = active ? 'rgba(212,168,83,0.15)' : 'transparent'; btn.style.borderColor = active ? 'rgba(212,168,83,0.4)' : 'rgba(255,255,255,0.08)'; btn.style.color = active ? '#D4A853' : 'rgba(255,255,255,0.45)'; }
      if (con) con.style.display = active ? 'block' : 'none';
    });
  };

  // ─── Recalculate from asset panel ───────────────────────
  window.kcAssetRunScore = function (assetId) {
    var a = _kcAsset;
    if (!a) return;
    var occ = (document.getElementById('aad-sc-occ') || {}).value;
    var leg = (document.getElementById('aad-sc-leg') || {}).value;
    var dem = (document.getElementById('aad-sc-dem') || {}).value;
    if (!occ || !leg || !dem) { if (window.showToast) showToast('Pilih semua opsi', 'error'); return; }
    var r = _assetAutoScore(a, occ, leg, dem);
    var out = document.getElementById('aad-sc-result');
    if (out) out.innerHTML = _scoreCardHtml(r);
  };

  // ─── Related case study ──────────────────────────────────
  function _relatedCases(label, kota) {
    var type = (label || '').trim();
    var city = (kota || '').toLowerCase();
    return KC_CASES.filter(function (c) {
      return c.type === type || (city && c.location.toLowerCase().includes(city));
    });
  }

  function _renderMiniCases(cases) {
    if (!cases.length) return '<p style="color:rgba(255,255,255,0.3);font-size:12px;text-align:center;padding:16px">Belum ada case study untuk tipe aset ini</p>';
    return cases.map(function (c) {
      return '<div style="background:#0D1526;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
          '<span style="color:' + c.color + ';background:' + c.color + '18;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid ' + c.color + '30">' + c.type + '</span>' +
          '<span style="color:rgba(255,255,255,0.3);font-size:10px">' + c.id + ' · ' + c.year + '</span>' +
          '<span style="color:rgba(255,255,255,0.3);font-size:10px;margin-left:auto">📍 ' + c.location + '</span>' +
        '</div>' +
        '<p style="color:#fff;font-size:12px;font-weight:600;margin:0 0 6px">' + c.title + '</p>' +
        '<p style="color:rgba(255,255,255,0.55);font-size:11px;line-height:1.5;margin:0 0 6px">' + c.situation + '</p>' +
        '<div style="background:rgba(34,197,94,0.06);border-left:2px solid #4ade8060;border-radius:0 6px 6px 0;padding:6px 10px">' +
          '<span style="color:#4ade80;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Hasil: </span>' +
          '<span style="color:rgba(255,255,255,0.6);font-size:11px">' + c.outcome + '</span>' +
        '</div>' +
        '<div style="margin-top:6px">' +
          '<button onclick="openKnowledgeCenter(\'cases\')" style="color:#D4A853;background:none;border:none;font-size:11px;cursor:pointer;padding:0">Lihat detail lengkap di Knowledge Center →</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ─── MAIN ENTRY: build analysis panel in detail modal ───
  window.kcInitAssetAnalysis = function (a) {
    var wrap = document.getElementById('ad-analysis-wrap');
    if (!wrap || !a) return;
    _kcAsset = a;

    var assetId = a.ID || '';
    var label   = (a.Label_Asset || '').trim();
    var disc    = _assetDiscount(a);
    var discStr = disc > 0 ? disc + '%' : '—';
    var cases   = _relatedCases(label, a.Kota);

    // ── Checklist content
    var clCats = [
      { key: 'legal',    title: '⚖️ Legal',    color: '#60a5fa', items: KC_CL.legal },
      { key: 'physical', title: '🏠 Fisik',    color: '#4ade80', items: KC_CL.physical },
      { key: 'financial',title: '💰 Finansial', color: '#D4A853', items: KC_CL.financial },
    ];
    var clHtml =
      '<div style="background:#131F38;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<span style="color:#fff;font-size:13px;font-weight:600">Checklist Aset Ini</span>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span id="aad-cl-count" style="color:#D4A853;font-size:12px;font-weight:700">0/' + KC_CL_ALL.length + '</span>' +
            '<button onclick="kcAssetClReset(\'' + assetId + '\')" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;padding:3px 8px;border-radius:6px;font-size:10px;cursor:pointer">Reset</button>' +
          '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.06);border-radius:4px;height:6px;overflow:hidden;margin-bottom:4px"><div id="aad-cl-bar" style="height:100%;width:0%;background:#f87171;border-radius:4px;transition:width 0.3s"></div></div>' +
        '<div style="text-align:right;margin-bottom:12px"><span id="aad-cl-label" style="color:rgba(255,255,255,0.35);font-size:11px">0%</span></div>' +
        clCats.map(function (cat) {
          return '<div style="margin-bottom:10px">' +
            '<p style="color:' + cat.color + ';font-size:11px;font-weight:700;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px">' + cat.title + '</p>' +
            cat.items.map(function (item) {
              return '<label style="display:flex;align-items:center;gap:8px;padding:7px 8px;background:rgba(255,255,255,0.02);border-radius:7px;cursor:pointer;margin-bottom:4px;border:1px solid rgba(255,255,255,0.04)">' +
                '<input type="checkbox" id="aad_' + item.id + '" onchange="kcAssetClUpdate(\'' + assetId + '\')" style="width:14px;height:14px;accent-color:' + cat.color + ';cursor:pointer;flex-shrink:0"/>' +
                '<span style="color:rgba(255,255,255,0.7);font-size:12px;line-height:1.4">' + item.label + '</span></label>';
            }).join('') +
          '</div>';
        }).join('') +
      '</div>';

    // ── Scoring content
    var labelColor = { Lelang: '#f59e0b', Cessie: '#a78bfa', AYDA: '#f87171' }[label] || '#D4A853';
    var autoResult = _assetAutoScore(a, 'Kosong', 'Need Review', 'Medium');
    var scHtml =
      '<div style="background:rgba(212,168,83,0.04);border:1px solid rgba(212,168,83,0.15);border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;flex:1">' +
          (disc > 0 ? '<div style="text-align:center"><div style="color:#D4A853;font-size:18px;font-weight:800">' + discStr + '</div><div style="color:rgba(255,255,255,0.35);font-size:10px">Diskon</div></div>' : '') +
          (label ? '<div style="text-align:center"><div style="color:' + labelColor + ';font-size:14px;font-weight:700">' + label + '</div><div style="color:rgba(255,255,255,0.35);font-size:10px">Tipe</div></div>' : '') +
          '<div style="text-align:center"><div style="color:rgba(255,255,255,0.5);font-size:12px">' + (a.Kota || '—') + '</div><div style="color:rgba(255,255,255,0.35);font-size:10px">Lokasi</div></div>' +
        '</div>' +
        '<span style="color:rgba(255,255,255,0.3);font-size:10px">Auto-fill dari data aset</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">' +
        [
          { id: 'aad-sc-occ', label: 'Penghunian', opts: [['Kosong','🏠 Kosong'],['Penyewa','👤 Penyewa'],['Pemilik','👨‍👩‍👧 Pemilik'],['Debitur','⚠️ Debitur']] },
          { id: 'aad-sc-leg', label: 'Status Legal', opts: [['Clean','✅ Clean'],['Need Review','⚠️ Need Review'],['Dispute','❌ Dispute']] },
          { id: 'aad-sc-dem', label: 'Demand Pasar', opts: [['High','🔥 High'],['Medium','📈 Medium'],['Low','📉 Low']] },
        ].map(function (f) {
          return '<div><label style="color:rgba(255,255,255,0.45);font-size:10px;font-weight:600;display:block;margin-bottom:4px">' + f.label + '</label>' +
            '<select id="' + f.id + '" style="width:100%;background:#0D1526;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:7px 8px;color:#fff;font-size:11px;outline:none">' +
            f.opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') +
            '</select></div>';
        }).join('') +
      '</div>' +
      '<button onclick="kcAssetRunScore(\'' + assetId + '\')" style="width:100%;background:#D4A853;color:#0D1526;border:none;padding:10px;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;margin-bottom:10px">📊 Hitung Score</button>' +
      '<div id="aad-sc-result">' + _scoreCardHtml(autoResult) + '</div>' +
      '<p style="color:rgba(255,255,255,0.25);font-size:10px;margin:8px 0 0;line-height:1.5">* Diskon & tipe aset otomatis dari data. Sesuaikan kondisi penghunian, status legal, dan demand pasar sesuai survei lapangan.</p>';

    // ── Case Study content
    var csHtml =
      '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">' +
        '<div>' +
          '<span style="color:rgba(255,255,255,0.5);font-size:12px">Filter: </span>' +
          (label ? '<span style="color:' + labelColor + ';font-size:12px;font-weight:700">' + label + '</span>' : '') +
          (a.Kota ? '<span style="color:rgba(255,255,255,0.3);font-size:12px"> + ' + a.Kota + '</span>' : '') +
          ' <span style="color:rgba(255,255,255,0.25);font-size:11px">(' + cases.length + ' case ditemukan)</span>' +
        '</div>' +
        '<button onclick="openKnowledgeCenter(\'cases\')" style="background:rgba(212,168,83,0.1);border:1px solid rgba(212,168,83,0.25);color:#D4A853;padding:5px 10px;border-radius:8px;font-size:11px;cursor:pointer">Lihat Semua →</button>' +
      '</div>' +
      _renderMiniCases(cases);

    // ── Assemble panel
    wrap.innerHTML =
      '<div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.07);padding-top:14px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
          '<h4 style="color:#D4A853;font-size:13px;font-weight:700;margin:0">📊 Analisis Investasi</h4>' +
          '<button onclick="openKnowledgeCenter()" style="color:rgba(255,255,255,0.3);background:none;border:none;font-size:11px;cursor:pointer">📖 Knowledge Center</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:12px">' +
          [['dd','✅ Due Diligence'],['sc','📊 Scoring'],['cs','📚 Case Study (' + cases.length + ')']].map(function (t, i) {
            var first = i === 0;
            return '<button id="aad-btn-' + t[0] + '" onclick="kcAssetTab(\'' + t[0] + '\')" style="flex:1;padding:7px 6px;border-radius:8px;border:1px solid ' + (first ? 'rgba(212,168,83,0.4)' : 'rgba(255,255,255,0.08)') + ';background:' + (first ? 'rgba(212,168,83,0.15)' : 'transparent') + ';color:' + (first ? '#D4A853' : 'rgba(255,255,255,0.45)') + ';font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + t[1] + '</button>';
          }).join('') +
        '</div>' +
        '<div id="aad-con-dd">' + clHtml + '</div>' +
        '<div id="aad-con-sc" style="display:none">' + scHtml + '</div>' +
        '<div id="aad-con-cs" style="display:none">' + csHtml + '</div>' +
      '</div>';

    // Apply saved checklist state
    var saved = _aclLoad(assetId);
    KC_CL_ALL.forEach(function (item) {
      var el = document.getElementById('aad_' + item.id);
      if (el && saved[item.id]) el.checked = true;
    });
    kcAssetClUpdate(assetId);
  };

})();
