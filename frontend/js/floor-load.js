/* ═══════════════════════════════════════════════════════════════════
   FLOOR LOAD CALCULATOR & SOP VERIFICATION ENGINE
   SNI 1727 — Beban Minimum Bangunan Gedung Komersial
   Mansion CRM v2.5.83
   ═══════════════════════════════════════════════════════════════════ */

/* ── TENANT SOP (generic, no real brand names) ──────────────────── */
const FL_TENANT_SOPS = {
  retail_besar: { tenantName:'Retail & Material Bangunan',  minNetAreaM2:500, minFrontageMeters:10, minCeilingHeightMeters:3.0, minPowerKva:33,  minFloor1LoadKgM2:500, minFloor2LoadKgM2:300, requiredDocs:['SHM','PBG_KOMERSIAL'] },
  minimarket:   { tenantName:'Minimarket / Convenience',    minNetAreaM2:100, minFrontageMeters:6,  minCeilingHeightMeters:2.8, minPowerKva:10,  minFloor1LoadKgM2:300, minFloor2LoadKgM2:200, requiredDocs:['SHM','HGB'] },
  fnb:          { tenantName:'Restoran & Kafe',             minNetAreaM2:80,  minFrontageMeters:5,  minCeilingHeightMeters:2.8, minPowerKva:15,  minFloor1LoadKgM2:250, minFloor2LoadKgM2:200, requiredDocs:['SHM','HGB'] },
  kantor:       { tenantName:'Perkantoran / Co-Working',    minNetAreaM2:50,  minFrontageMeters:4,  minCeilingHeightMeters:2.7, minPowerKva:5,   minFloor1LoadKgM2:200, minFloor2LoadKgM2:150, requiredDocs:['SHM','HGB'] },
  gudang:       { tenantName:'Gudang & Logistik',           minNetAreaM2:200, minFrontageMeters:8,  minCeilingHeightMeters:4.0, minPowerKva:20,  minFloor1LoadKgM2:1000,minFloor2LoadKgM2:500, requiredDocs:['SHM','PBG_KOMERSIAL'] },
};

/* ── STATE ───────────────────────────────────────────────────────── */
let _flEnabled  = [1];
let _flActive   = 1;
let _flResults  = {};
let _flUIBuilt  = false;
let _flTujuan   = 'survey';
let _flDataMode = 'manual';

/* ════════════════════════════════════════════════════════════════════
   CALCULATION ENGINE
   ════════════════════════════════════════════════════════════════════ */

function flEstimateLoad(d) {
  let est = 0, conf = 'MEDIUM';
  const warns = [], bonuses = [];

  if (d.floorNumber === 1) {
    // Base berbeda per finishing — mencerminkan desain beban lantai sejak awal
    const finishBase = {
      PAVING_BLOCK:     350,  // paving block / outdoor, base pasir
      CERAMIC_STANDARD: 450,  // ruko/pertokoan standar
      GRANITE_TILE:     600,  // ruko komersial menengah
      BETON_COR:        600,  // beton cor exposed K-225/K-300
      EPOXY_EXPOSED:    750,  // ruko industri/logistik
      FLOOR_HARDENER:   900,  // gudang/industri berat
    };
    const finishLabel = {
      PAVING_BLOCK:     'Paving block (base 350)',
      CERAMIC_STANDARD: 'Keramik standar (base 450)',
      GRANITE_TILE:     'Granite / HT (base 600)',
      BETON_COR:        'Beton cor exposed (base 600)',
      EPOXY_EXPOSED:    'Epoxy coating (base 750)',
      FLOOR_HARDENER:   'Floor hardener (base 900)',
    };
    est = finishBase[d.finishingType] || 450;
    bonuses.push(finishLabel[d.finishingType] || 'Keramik standar (base 450)');
    if (d.finishingType === 'PAVING_BLOCK') warns.push('Paving block: kekuatan bergantung base pasir/sirtu — hindari beban titik berat');

    if (d.hasVehicleAccess)   { est += 200; bonuses.push('Akses kendaraan (+200)'); }
    if (d.isElevatedFromRoad) { est += 100; bonuses.push('Tanah elevated (+100)'); }
    if (d.soundKnockingResult === 'SOLID')  { est += 100; conf = 'HIGH'; bonuses.push('Ketukan solid (+100)'); }
    if (d.soundKnockingResult === 'HOLLOW') { est -= 200; conf = 'LOW';  warns.push('Ketukan berongga — indikasi void/rongga tanah'); }
    if (d.hasStructuralDefects) { est -= 400; conf = 'LOW'; warns.push('Retakan/kerusakan struktural terdeteksi'); }
    est = Math.max(150, est);
  } else {
    const base = { 2: 300, 3: 250, 4: 200 };
    est = base[d.floorNumber] || 150;
    if (d.columnSpanMeters <= 4)     { est += 50;  bonuses.push('Bentang kolom ≤4m (+50)'); }
    else if (d.columnSpanMeters > 6) { est -= 50;  warns.push('Bentang >6m — risiko defleksi lebih besar'); }
    if (d.slabThicknessCm >= 15)     { est += 100; bonuses.push('Plat ≥15cm (+100)'); }
    else if (d.slabThicknessCm < 12) { est -= 50;  warns.push('Plat <12cm — di bawah SNI minimum'); }
    if (d.historicalUsage === 'HEAVY_STORAGE' || d.historicalUsage === 'SUPERMARKET') {
      est += 50; bonuses.push('Riwayat beban berat (+50)');
    }
    if (d.soundKnockingResult === 'SOLID')  { conf = 'HIGH'; bonuses.push('Ketukan solid: plat masif'); }
    if (d.soundKnockingResult === 'HOLLOW') { est -= 100; conf = 'LOW'; warns.push('Ketukan berongga — cek kondisi tulangan'); }
    if (d.hasStructuralDefects) {
      est = Math.min(est, 100); conf = 'LOW';
      warns.push('⚠️ BAHAYA: Retakan/defleksi — wajib assessment struktural profesional');
    }
    est = Math.max(50, est);
  }

  let rec = '';
  if (est >= 800)      rec = 'Cocok untuk beban berat: gudang, retail material bangunan, supermarket.';
  else if (est >= 500) rec = 'Cocok tenant beban sedang-berat. Konfirmasi dengan soil test.';
  else if (est >= 300) rec = 'Cocok retail standar dan restoran. Hindari penumpukan tanpa distribusi.';
  else if (est >= 200) rec = 'Cocok kantor dan retail ringan saja.';
  else rec = 'Kapasitas rendah. Konsultasikan dengan insinyur struktural.';

  return { estimatedCapacityKgM2: Math.round(est), confidenceLevel: conf, safetyWarning: warns.length ? warns.join('; ') : null, recommendation: rec, bonusDetail: bonuses };
}

function flRackSafety(weightKg, areaM2, maxKgM2) {
  const density = areaM2 > 0 ? weightKg / areaM2 : 0;
  const pct = maxKgM2 > 0 ? (density / maxKgM2) * 100 : 0;
  const safe = density <= maxKgM2;
  let advice = safe
    ? (pct > 80 ? `Aman, mendekati batas (${pct.toFixed(0)}%). Distribusikan ke beberapa titik rak.` : `Aman. Beban rak hanya ${pct.toFixed(0)}% dari kapasitas lantai.`)
    : `TIDAK AMAN — melebihi kapasitas sebesar ${(pct - 100).toFixed(0)}%. Posisikan rak di atas balok/kolom utama atau kurangi muatan.`;
  return { isSafe: safe, actualLoadDensity: Math.round(density), maxCapacity: maxKgM2, utilizationPct: Math.round(pct), advice };
}

function flValidateTenant(propData, sopKey) {
  const sop = FL_TENANT_SOPS[sopKey];
  if (!sop) return null;
  const passed = [], missing = [];
  const chk = (label, ok, detail) => ok ? passed.push('✓ ' + label) : missing.push('✗ ' + label + ': ' + detail);
  chk(`Luas ≥ ${sop.minNetAreaM2} m²`,         propData.netAreaM2 >= sop.minNetAreaM2,              `Ada ${propData.netAreaM2} m², butuh ${sop.minNetAreaM2} m²`);
  chk(`Frontage ≥ ${sop.minFrontageMeters} m`,  propData.frontageMeters >= sop.minFrontageMeters,    `Ada ${propData.frontageMeters} m, butuh ${sop.minFrontageMeters} m`);
  chk(`Plafon ≥ ${sop.minCeilingHeightMeters} m`,propData.ceilingHeightMeters >= sop.minCeilingHeightMeters, `Ada ${propData.ceilingHeightMeters} m, butuh ${sop.minCeilingHeightMeters} m`);
  chk(`Daya ≥ ${sop.minPowerKva} kVA`,          propData.powerKva >= sop.minPowerKva,                `Ada ${propData.powerKva} kVA, butuh ${sop.minPowerKva} kVA`);
  chk(`Beban Lt.1 ≥ ${sop.minFloor1LoadKgM2} kg/m²`, propData.floor1LoadKgM2 >= sop.minFloor1LoadKgM2, `Estimasi ${propData.floor1LoadKgM2} kg/m², butuh ${sop.minFloor1LoadKgM2} kg/m²`);
  if (sop.minFloor2LoadKgM2 > 0 && propData.floor2LoadKgM2 > 0) {
    chk(`Beban Lt.2 ≥ ${sop.minFloor2LoadKgM2} kg/m²`, propData.floor2LoadKgM2 >= sop.minFloor2LoadKgM2, `Estimasi ${propData.floor2LoadKgM2} kg/m², butuh ${sop.minFloor2LoadKgM2} kg/m²`);
  }
  const docOk = sop.requiredDocs.every(d => (propData.availableDocs || []).includes(d));
  chk(`Dokumen: ${sop.requiredDocs.join(', ')}`, docOk, `Butuh: ${sop.requiredDocs.filter(d => !(propData.availableDocs || []).includes(d)).join(', ')}`);
  const total = passed.length + missing.length;
  return { tenantName: sop.tenantName, isEligible: missing.length === 0, scorePercentage: total > 0 ? Math.round((passed.length / total) * 100) : 0, passedCriteria: passed, missingCriteria: missing };
}

/* ════════════════════════════════════════════════════════════════════
   HTML BUILDERS — FORM PARTS
   ════════════════════════════════════════════════════════════════════ */

function _flBoolField(n, key, label, hint, plusLabel) {
  return `
  <div>
    <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">${label}${hint ? `<span style="color:rgba(255,255,255,0.3);margin-left:4px">${hint}</span>` : ''}</label>
    <input type="hidden" id="fl-${n}-${key}-val" value="0"/>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <button id="fl-${n}-${key}-yes" onclick="flSetBool(${n},'${key}',true)"  style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:11px;font-weight:600;background:#131F38;color:rgba(255,255,255,0.5)">✓ Ya${plusLabel ? ` <span style='font-size:9px;opacity:.7'>(${plusLabel})</span>` : ''}</button>
      <button id="fl-${n}-${key}-no"  onclick="flSetBool(${n},'${key}',false)" style="padding:10px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:600;background:#ef4444;color:#fff;border:none">✗ Tidak</button>
    </div>
  </div>`;
}

function _flSliderField(n, key, label, min, max, def, unit, hint) {
  return `
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <label style="font-size:11px;color:rgba(255,255,255,0.5)">${label}${hint ? ` <span style='color:rgba(255,255,255,0.3);font-size:10px'>${hint}</span>` : ''}</label>
      <span id="fl-${n}-${key}-disp" style="font-size:13px;font-weight:700;color:#D4A853">${def} ${unit}</span>
    </div>
    <input type="range" id="fl-${n}-${key}" min="${min}" max="${max}" value="${def}" step="${unit==='cm'?1:0.5}"
      oninput="document.getElementById('fl-${n}-${key}-disp').textContent=this.value+' ${unit}'"
      style="width:100%;accent-color:#D4A853"/>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,0.25);margin-top:2px">
      <span>${min} ${unit}</span><span>${max} ${unit}</span>
    </div>
  </div>`;
}

function _flKnockField(n) {
  return `
  <div>
    <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Uji Ketukan Lantai <span style="color:rgba(255,255,255,0.3)">(ketuk dengan benda keras)</span></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <button id="fl-${n}-knock-solid"  onclick="flSetKnocking(${n},'SOLID')"  style="padding:10px 6px;border-radius:10px;border:none;cursor:pointer;font-size:11px;font-weight:600;background:#D4A853;color:#0D1526;display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:16px">🪨</span><span>Solid / Padat</span><span style="font-size:9px;opacity:.7">Confidence Tinggi</span>
      </button>
      <button id="fl-${n}-knock-hollow" onclick="flSetKnocking(${n},'HOLLOW')" style="padding:10px 6px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:11px;font-weight:600;background:#131F38;color:rgba(255,255,255,0.5);display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:16px">🕳️</span><span>Berongga</span><span style="font-size:9px;opacity:.7">Risiko Tinggi</span>
      </button>
    </div>
    <input type="hidden" id="fl-${n}-knocking" value="SOLID"/>
  </div>`;
}

function _flFinishField(n) {
  const opts = [
    { key:'PAVING_BLOCK',     emoji:'🧱', label:'Paving Block',    note:'Base 350 kg/m²' },
    { key:'CERAMIC_STANDARD', emoji:'🔲', label:'Keramik Standar', note:'Base 450 kg/m²' },
    { key:'GRANITE_TILE',     emoji:'🪨', label:'Granite / HT',    note:'Base 600 kg/m²' },
    { key:'BETON_COR',        emoji:'🏗️', label:'Beton Cor',       note:'Base 600 kg/m²' },
    { key:'EPOXY_EXPOSED',    emoji:'✨', label:'Epoxy Coating',    note:'Base 750 kg/m²' },
    { key:'FLOOR_HARDENER',   emoji:'🏭', label:'Floor Hardener',  note:'Base 900 kg/m²' },
  ];
  const btns = opts.map(o => `
    <button id="fl-${n}-fin-${o.key}" onclick="flSetFinishing(${n},'${o.key}')"
      style="padding:10px 6px;border-radius:10px;border:${o.key==='CERAMIC_STANDARD'?'none':'1px solid rgba(255,255,255,0.1)'};cursor:pointer;font-size:11px;font-weight:600;background:${o.key==='CERAMIC_STANDARD'?'#D4A853':'#131F38'};color:${o.key==='CERAMIC_STANDARD'?'#0D1526':'rgba(255,255,255,0.5)'};display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center">
      <span style="font-size:16px">${o.emoji}</span><span>${o.label}</span><span style="font-size:9px;opacity:.7">${o.note}</span>
    </button>`).join('');
  return `
  <div>
    <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:8px;display:block">Finishing Lantai</label>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">${btns}</div>
    <input type="hidden" id="fl-${n}-finishing" value="CERAMIC_STANDARD"/>
  </div>`;
}

function _flUsageField(n) {
  return `
  <div>
    <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Riwayat Penggunaan</label>
    <select id="fl-${n}-usage" class="form-input" style="font-size:12px">
      <option value="OFFICE_STANDARD">Kantor / Standar</option>
      <option value="SUPERMARKET">Supermarket / Retail Besar</option>
      <option value="HEAVY_STORAGE">Gudang / Penyimpanan Berat</option>
      <option value="RESIDENTIAL">Hunian / Residensial</option>
    </select>
  </div>`;
}

function _flDefectField(n) {
  return `
  <div>
    <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Kerusakan Struktural <span style="color:rgba(255,255,255,0.3)">(retak, penurunan, balok melendut)</span></label>
    <input type="hidden" id="fl-${n}-defect-val" value="0"/>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <button id="fl-${n}-defect-yes" onclick="flSetBool(${n},'defect',true)"  style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:11px;font-weight:600;background:#131F38;color:rgba(255,255,255,0.5)">⚠️ Ada Kerusakan</button>
      <button id="fl-${n}-defect-no"  onclick="flSetBool(${n},'defect',false)" style="padding:10px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:600;background:#22c55e;color:#fff;border:none">✓ Tidak Ada</button>
    </div>
  </div>`;
}

function _flBuildForm(n) {
  const icon = ['🏗️','2️⃣','3️⃣','4️⃣'][n - 1];
  const isF1 = n === 1;
  const typeLabel = isF1 ? 'Slab on Grade — langsung di atas tanah' : 'Suspended Slab — SNI 1727';
  const baseRef   = isF1 ? '800–1.700 kg/m²' : n===2 ? 'Base SNI: 300 kg/m²' : n===3 ? 'Base SNI: 250 kg/m²' : 'Base SNI: 200 kg/m²';
  return `
  <div id="fl-form-${n}" style="display:${n===1?'flex':'none'};flex-direction:column;gap:12px;padding-bottom:4px">
    <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#131F38;border-radius:12px;border:1px solid rgba(212,168,83,0.2)">
      <div style="width:38px;height:38px;border-radius:10px;background:rgba(212,168,83,0.15);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${icon}</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:#fff">Lantai ${n}</div>
        <div style="font-size:10px;color:#D4A853">${typeLabel}</div>
        <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:1px">${baseRef}</div>
      </div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      ${_flFinishField(n)}
      ${isF1 ? _flBoolField(n,'elevated','Tanah elevated dari jalan?','(≥30cm, kompak)','+100 kg/m²') : ''}
      ${isF1 ? _flBoolField(n,'vehicle', 'Ada akses kendaraan (fork/truk)?','','+200 kg/m²')          : ''}
      ${_flKnockField(n)}
      ${!isF1 ? _flSliderField(n,'span','Bentang Kolom ke Kolom',2,12,4,'m','(≤4m = lebih kuat)') : ''}
      ${!isF1 ? _flSliderField(n,'slab','Ketebalan Plat Beton',  8,25,12,'cm','(≥15cm = bonus)')  : ''}
      ${_flUsageField(n)}
      ${_flDefectField(n)}
    </div>
  </div>`;
}

/* ── MAIN HTML BUILDER ───────────────────────────────────────────── */
function flBuildHTML() {
  const tujuanOpts = [
    { key:'survey',  emoji:'🔍', label:'Survey Teknis'  },
    { key:'sewa',    emoji:'🏪', label:'Sewa / Rental'  },
    { key:'beli',    emoji:'🤝', label:'Beli / Investasi'},
    { key:'tenant',  emoji:'📋', label:'Verif. Tenant'  },
  ];
  const tujuanBtns = tujuanOpts.map(t => `
    <button id="fl-tujuan-${t.key}" onclick="flSetTujuan('${t.key}')"
      style="padding:10px 4px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:${t.key==='survey'?'700':'500'};background:${t.key==='survey'?'#D4A853':'#131F38'};color:${t.key==='survey'?'#0D1526':'rgba(255,255,255,0.45)'};border:${t.key==='survey'?'none':'1px solid rgba(255,255,255,0.08)'};display:flex;flex-direction:column;align-items:center;gap:3px">
      <span style="font-size:16px">${t.emoji}</span>${t.label}
    </button>`).join('');

  return `
  <!-- ═══ HEADER: Identitas & Tujuan ═══ -->
  <div class="card" style="margin-bottom:12px;display:flex;flex-direction:column;gap:14px">

    <!-- Nama User / Klien -->
    <div>
      <label class="form-label">Nama User / Klien <span style="color:rgba(255,255,255,0.3);font-weight:400;font-size:10px">— siapa yang disurvey untuk</span></label>
      <input id="fl-nama-user" type="text" class="form-input" placeholder="Contoh: Pak Andi – PT Maju Sejahtera"/>
    </div>

    <!-- Nama Agen (auto dari login) -->
    <div>
      <label class="form-label">Nama Agen <span style="font-size:9px;background:rgba(212,168,83,0.15);color:#D4A853;padding:1px 7px;border-radius:20px;font-weight:600;margin-left:4px">Auto</span></label>
      <input id="fl-nama-agen" type="text" class="form-input" readonly
        style="background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5);cursor:default"/>
    </div>

    <!-- Tujuan Penggunaan -->
    <div>
      <label class="form-label">Tujuan Penggunaan</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px">${tujuanBtns}</div>
    </div>

  </div>

  <!-- ═══ DATA BANGUNAN: Manual / Dari Listing ═══ -->
  <div class="card" style="margin-bottom:12px;display:flex;flex-direction:column;gap:12px">

    <div style="display:flex;align-items:center;justify-content:space-between">
      <label class="form-label" style="margin-bottom:0">Data Spesifik Bangunan</label>
      <div style="display:flex;gap:6px">
        <button id="fl-mode-manual"   onclick="flSetDataMode('manual')"
          style="padding:6px 12px;border-radius:20px;cursor:pointer;font-size:11px;font-weight:700;background:#D4A853;color:#0D1526;border:none">Manual</button>
        <button id="fl-mode-listing"  onclick="flSetDataMode('listing')"
          style="padding:6px 12px;border-radius:20px;cursor:pointer;font-size:11px;font-weight:600;background:#131F38;color:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.1)">Dari Listing</button>
      </div>
    </div>

    <!-- Nama Properti (always visible) -->
    <div>
      <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Nama / Alamat Properti</label>
      <input id="fl-prop-name" type="text" class="form-input" placeholder="Ruko Jl. Sudirman No. 5, Surabaya"/>
    </div>

    <!-- Listing Picker (hidden by default) -->
    <div id="fl-listing-wrap" style="display:none">
      <div style="position:relative">
        <i class="fa-solid fa-magnifying-glass" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,0.3);font-size:12px;pointer-events:none"></i>
        <input id="fl-listing-search" type="text" class="form-input" style="padding-left:34px"
          placeholder="Cari nama atau alamat listing..."
          oninput="flSearchListing(this.value)"/>
      </div>
      <div id="fl-listing-results" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-top:8px"></div>
      <div id="fl-listing-selected" style="display:none;padding:10px;background:rgba(212,168,83,0.1);border-radius:10px;border:1px solid rgba(212,168,83,0.25)">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div id="fl-sel-judul" style="font-size:12px;font-weight:700;color:#fff"></div>
            <div id="fl-sel-info"  style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px"></div>
          </div>
          <button onclick="flClearListing()" style="width:26px;height:26px;border-radius:50%;background:#131F38;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:12px">✕</button>
        </div>
      </div>
    </div>

  </div>

  <!-- ═══ SELECTOR LANTAI ═══ -->
  <div class="card" style="margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <label class="form-label" style="margin-bottom:0">Lantai yang Diinspeksi</label>
      <span style="font-size:10px;color:rgba(255,255,255,0.3)">Tap untuk pilih/hapus</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
      <button id="fl-toggle-1" onclick="flFloorBtn(1)" style="padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:700;background:#D4A853;color:#0D1526;border:none;display:flex;flex-direction:column;align-items:center;gap:3px">
        <span style="font-size:18px">🏗️</span>Lt.1
      </button>
      <button id="fl-toggle-2" onclick="flFloorBtn(2)" style="padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:500;background:#131F38;color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;align-items:center;gap:3px">
        <span style="font-size:18px">2️⃣</span>Lt.2
      </button>
      <button id="fl-toggle-3" onclick="flFloorBtn(3)" style="padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:500;background:#131F38;color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;align-items:center;gap:3px">
        <span style="font-size:18px">3️⃣</span>Lt.3
      </button>
      <button id="fl-toggle-4" onclick="flFloorBtn(4)" style="padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:500;background:#131F38;color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;align-items:center;gap:3px">
        <span style="font-size:18px">4️⃣</span>Lt.4
      </button>
    </div>
  </div>

  <!-- ═══ FORM PER LANTAI ═══ -->
  ${[1,2,3,4].map(_flBuildForm).join('')}

  <!-- ═══ TOMBOL HITUNG ═══ -->
  <button onclick="flHitung()" style="width:100%;padding:16px;border-radius:14px;border:none;cursor:pointer;font-size:14px;font-weight:700;background:#D4A853;color:#0D1526;margin:4px 0 6px;display:flex;align-items:center;justify-content:center;gap:8px">
    <i class="fa-solid fa-weight-hanging"></i> Hitung Kapasitas Lantai
  </button>
  <p style="font-size:10px;color:rgba(255,255,255,0.25);text-align:center;margin-bottom:16px">Estimasi berbasis SNI 1727 — bukan pengganti assessment struktural profesional</p>

  <!-- ═══ HASIL ESTIMASI ═══ -->
  <div id="fl-results" style="display:none">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div style="width:3px;height:20px;background:#D4A853;border-radius:2px"></div>
      <h4 style="font-family:'DM Serif Display',serif;font-size:16px;color:#fff;margin:0">Hasil Estimasi</h4>
    </div>
    <div id="fl-results-cards"></div>
  </div>

  <!-- ═══ UJI KEAMANAN RAK ═══ -->
  <div id="fl-rack-section" style="display:none;margin-top:4px">
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:32px;height:32px;border-radius:8px;background:rgba(43,123,255,0.15);display:flex;align-items:center;justify-content:center;font-size:16px">📦</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff">Uji Keamanan Rak</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4)">Hitung apakah konfigurasi rak aman di lantai terpilih</div>
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Target Lantai</label>
        <select id="fl-rack-floor" class="form-input" style="font-size:12px"></select>
      </div>
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Berat Total Rak + Muatan (kg)</label>
        <input id="fl-rack-weight" type="number" class="form-input" placeholder="2000" min="0"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Panjang Rak (m)</label>
          <input id="fl-rack-length" type="number" class="form-input" placeholder="2.0" step="0.1" min="0.1"/>
        </div>
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Lebar Rak (m)</label>
          <input id="fl-rack-width"  type="number" class="form-input" placeholder="0.6" step="0.1" min="0.1"/>
        </div>
      </div>
      <button onclick="flHitungRak()" style="width:100%;padding:13px;border-radius:12px;border:1px solid rgba(43,123,255,0.3);cursor:pointer;font-size:13px;font-weight:700;background:rgba(43,123,255,0.15);color:#60a5fa">
        <i class="fa-solid fa-box-open" style="margin-right:6px"></i>Cek Keamanan Rak
      </button>
      <div id="fl-rack-result" style="display:none"></div>
    </div>
  </div>

  <!-- ═══ VERIFIKASI SOP TENANT ═══ -->
  <div id="fl-tenant-section" style="display:none;margin-top:12px">
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:32px;height:32px;border-radius:8px;background:rgba(168,85,247,0.15);display:flex;align-items:center;justify-content:center;font-size:16px">🏪</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff">Verifikasi SOP Tenant</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4)">Kelayakan properti berdasarkan kriteria kategori tenant</div>
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Kategori Tenant</label>
        <select id="fl-tenant-sel" class="form-input" style="font-size:12px">
          <option value="retail_besar">Retail & Material Bangunan (Besar)</option>
          <option value="minimarket">Minimarket / Convenience Store</option>
          <option value="fnb">Restoran & Kafe</option>
          <option value="kantor">Perkantoran / Co-Working</option>
          <option value="gudang">Gudang & Logistik</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Luas Netto (m²)</label>
          <input id="fl-sop-area"     type="number" class="form-input" placeholder="300" min="0"/>
        </div>
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Frontage / Lebar Muka (m)</label>
          <input id="fl-sop-frontage" type="number" class="form-input" placeholder="8" step="0.5" min="0"/>
        </div>
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Tinggi Plafon (m)</label>
          <input id="fl-sop-ceiling"  type="number" class="form-input" placeholder="3.5" step="0.1" min="0"/>
        </div>
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Daya Listrik (kVA)</label>
          <input id="fl-sop-power"    type="number" class="form-input" placeholder="33" min="0"/>
        </div>
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Beban Lt.1 (kg/m²) <span style="color:#D4A853;font-size:9px">Auto</span></label>
          <input id="fl-sop-lt1" type="number" class="form-input" placeholder="auto" min="0" style="background:rgba(212,168,83,0.06);border-color:rgba(212,168,83,0.2)"/>
        </div>
        <div>
          <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;display:block">Beban Lt.2 (kg/m²) <span style="color:#D4A853;font-size:9px">Auto</span></label>
          <input id="fl-sop-lt2" type="number" class="form-input" placeholder="auto" min="0" style="background:rgba(212,168,83,0.06);border-color:rgba(212,168,83,0.2)"/>
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:8px;display:block">Dokumen Tersedia</label>
        <div id="fl-sop-docs" style="display:flex;gap:8px;flex-wrap:wrap">
          ${['SHM','HGB','PBG_KOMERSIAL'].map(d => `
          <label style="display:flex;align-items:center;gap:5px;padding:7px 12px;border-radius:20px;background:#131F38;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:11px;font-weight:600;color:rgba(255,255,255,0.6)">
            <input type="checkbox" value="${d}" style="accent-color:#D4A853"/>${d}
          </label>`).join('')}
        </div>
      </div>
      <button onclick="flCheckTenant()" style="width:100%;padding:13px;border-radius:12px;border:1px solid rgba(168,85,247,0.3);cursor:pointer;font-size:13px;font-weight:700;background:rgba(168,85,247,0.15);color:#c084fc">
        <i class="fa-solid fa-clipboard-check" style="margin-right:6px"></i>Cek Kelayakan Tenant
      </button>
      <div id="fl-tenant-result" style="display:none"></div>
    </div>
  </div>

  <!-- ═══ EXPORT ═══ -->
  <div id="fl-export-section" style="display:none;margin-top:12px;margin-bottom:4px;flex-direction:column;gap:8px">
    <button id="fl-copy-btn" onclick="flCopyWA()" style="width:100%;padding:14px;border-radius:14px;border:1.5px solid rgba(37,211,102,0.3);cursor:pointer;font-size:13px;font-weight:700;background:rgba(37,211,102,0.1);color:#4ade80;display:flex;align-items:center;justify-content:center;gap:8px">
      <i class="fa-brands fa-whatsapp" style="font-size:16px"></i>Salin Ringkasan ke WhatsApp
    </button>
    <button onclick="flPrintPDF()" style="width:100%;padding:14px;border-radius:14px;border:1.5px solid rgba(239,68,68,0.3);cursor:pointer;font-size:13px;font-weight:700;background:rgba(239,68,68,0.1);color:#f87171;display:flex;align-items:center;justify-content:center;gap:8px">
      <i class="fa-solid fa-file-pdf" style="font-size:16px"></i>Cetak / Simpan sebagai PDF
    </button>
  </div>`;
}

/* ════════════════════════════════════════════════════════════════════
   UI — INIT & STATE SYNC
   ════════════════════════════════════════════════════════════════════ */

function flInitUI() {
  if (_flUIBuilt) return;
  const container = document.getElementById('fl-ui');
  if (!container) return;
  container.innerHTML = flBuildHTML();
  _flUIBuilt = true;
  _flEnabled = [1]; _flActive = 1; _flResults = {};
  _flTujuan = 'survey'; _flDataMode = 'manual';

  // Auto-fill Nama Agen dari state login
  const agenEl = document.getElementById('fl-nama-agen');
  if (agenEl && window.STATE?.user?.nama) agenEl.value = window.STATE.user.nama;

  flSyncFloorUI();
}

/* ── Floor Selector ─────────────────────────────────────────────── */
function flFloorBtn(n) {
  const wasEnabled = _flEnabled.includes(n);
  if (wasEnabled && _flActive === n) {
    if (_flEnabled.length > 1) { _flEnabled = _flEnabled.filter(x => x !== n); _flActive = _flEnabled[0]; }
  } else if (wasEnabled) {
    _flActive = n;
  } else {
    _flEnabled.push(n); _flEnabled.sort((a,b) => a-b); _flActive = n;
  }
  flSyncFloorUI();
}

function flSyncFloorUI() {
  [1,2,3,4].forEach(n => {
    const btn  = document.getElementById('fl-toggle-' + n);
    const form = document.getElementById('fl-form-'   + n);
    if (!btn) return;
    const enabled = _flEnabled.includes(n), active = _flActive === n;
    if (active && enabled) {
      btn.style.cssText = 'flex:1;padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:700;background:#D4A853;color:#0D1526;border:none;display:flex;flex-direction:column;align-items:center;gap:3px';
    } else if (enabled) {
      btn.style.cssText = 'flex:1;padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:600;background:rgba(212,168,83,0.15);color:#D4A853;border:1.5px solid rgba(212,168,83,0.35);display:flex;flex-direction:column;align-items:center;gap:3px';
    } else {
      btn.style.cssText = 'flex:1;padding:12px 4px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:500;background:#131F38;color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;align-items:center;gap:3px';
    }
    if (form) form.style.display = active ? 'flex' : 'none';
  });
}

/* ── Tujuan Penggunaan ──────────────────────────────────────────── */
function flSetTujuan(key) {
  _flTujuan = key;
  ['survey','sewa','beli','tenant'].forEach(k => {
    const btn = document.getElementById('fl-tujuan-' + k);
    if (!btn) return;
    if (k === key) { btn.style.background='#D4A853'; btn.style.color='#0D1526'; btn.style.border='none'; btn.style.fontWeight='700'; }
    else           { btn.style.background='#131F38'; btn.style.color='rgba(255,255,255,0.45)'; btn.style.border='1px solid rgba(255,255,255,0.08)'; btn.style.fontWeight='500'; }
  });
  // Jika pilih Verif.Tenant, expand tenant section setelah hitung
  if (key === 'tenant') {
    const ts = document.getElementById('fl-tenant-section');
    if (ts && ts.style.display !== 'none') setTimeout(()=>ts.scrollIntoView({behavior:'smooth',block:'nearest'}),200);
  }
}

/* ── Data Mode: Manual / Dari Listing ──────────────────────────── */
function flSetDataMode(mode) {
  _flDataMode = mode;
  const manBtn = document.getElementById('fl-mode-manual');
  const lstBtn = document.getElementById('fl-mode-listing');
  const wrap   = document.getElementById('fl-listing-wrap');
  if (mode === 'manual') {
    if (manBtn) { manBtn.style.background='#D4A853'; manBtn.style.color='#0D1526'; manBtn.style.border='none'; manBtn.style.fontWeight='700'; }
    if (lstBtn) { lstBtn.style.background='#131F38'; lstBtn.style.color='rgba(255,255,255,0.5)'; lstBtn.style.border='1px solid rgba(255,255,255,0.1)'; lstBtn.style.fontWeight='600'; }
    if (wrap)   wrap.style.display = 'none';
  } else {
    if (lstBtn) { lstBtn.style.background='#D4A853'; lstBtn.style.color='#0D1526'; lstBtn.style.border='none'; lstBtn.style.fontWeight='700'; }
    if (manBtn) { manBtn.style.background='#131F38'; manBtn.style.color='rgba(255,255,255,0.5)'; manBtn.style.border='1px solid rgba(255,255,255,0.1)'; manBtn.style.fontWeight='600'; }
    if (wrap)   wrap.style.display = 'block';
    // Load listings if not yet loaded
    if (!window._allListings || window._allListings.length === 0) {
      API.get('/listings?all=1').then(r => { window._allListings = (r.data||[]).reverse(); }).catch(()=>{});
    }
    document.getElementById('fl-listing-search').focus();
  }
}

/* ── Listing Search & Select ────────────────────────────────────── */
function flSearchListing(query) {
  const resEl = document.getElementById('fl-listing-results');
  if (!resEl) return;
  const all = window._allListings || [];
  const q = query.trim().toLowerCase();
  if (!q) { resEl.innerHTML = ''; return; }

  const hits = all.filter(l =>
    (l.Judul||'').toLowerCase().includes(q) ||
    (l.Alamat||'').toLowerCase().includes(q) ||
    (l.Kode_Listing||'').toLowerCase().includes(q)
  ).slice(0, 8);

  if (!hits.length) {
    resEl.innerHTML = `<div style="text-align:center;padding:16px;font-size:12px;color:rgba(255,255,255,0.3)">Tidak ditemukan — coba nama atau alamat lain</div>`;
    return;
  }
  resEl.innerHTML = hits.map(l => {
    const tipe = l.Tipe_Properti || '';
    const luas = l.Luas_Bangunan ? `${Number(l.Luas_Bangunan).toLocaleString('id')} m²` : '';
    const lantai = l.Lantai ? `${l.Lantai} lt` : '';
    const info = [tipe, luas, lantai].filter(Boolean).join(' · ');
    return `
    <div onclick="flSelectListing('${l.ID}')"
      style="padding:10px 12px;background:#131F38;border-radius:10px;border:1px solid rgba(255,255,255,0.07);cursor:pointer;transition:border-color .15s"
      onmouseover="this.style.borderColor='rgba(212,168,83,0.35)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.07)'">
      <div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:2px">${l.Judul||l.Kode_Listing||'—'}</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.4)">${l.Alamat||''}</div>
      ${info ? `<div style="font-size:9px;color:#D4A853;margin-top:3px">${info}</div>` : ''}
    </div>`;
  }).join('');
}

function flSelectListing(id) {
  const all = window._allListings || [];
  const l = all.find(x => x.ID === id);
  if (!l) return;

  // Fill property name
  const propEl = document.getElementById('fl-prop-name');
  if (propEl) propEl.value = `${l.Judul||l.Kode_Listing||''} — ${l.Alamat||''}`.replace(/ — $/, '');

  // Show selected badge
  const resEl = document.getElementById('fl-listing-results');
  if (resEl) resEl.innerHTML = '';
  const selEl = document.getElementById('fl-listing-selected');
  const judEl = document.getElementById('fl-sel-judul');
  const infEl = document.getElementById('fl-sel-info');
  if (judEl) judEl.textContent = l.Judul || l.Kode_Listing || '';
  const tipe = l.Tipe_Properti || '', luas = l.Luas_Bangunan ? `${Number(l.Luas_Bangunan).toLocaleString('id')} m²` : '', lantai = l.Lantai ? `${l.Lantai} lantai` : '';
  if (infEl) infEl.textContent = [tipe, luas, lantai].filter(Boolean).join(' · ');
  if (selEl) selEl.style.display = 'block';
  const srch = document.getElementById('fl-listing-search');
  if (srch) srch.value = '';

  // Auto-enable floors based on Lantai field
  const jumlahLantai = parseInt(l.Lantai) || 1;
  _flEnabled = Array.from({length: Math.min(jumlahLantai, 4)}, (_, i) => i + 1);
  _flActive  = 1;
  flSyncFloorUI();

  // Auto-fill SOP area dari Luas_Bangunan
  const areaEl = document.getElementById('fl-sop-area');
  if (areaEl && l.Luas_Bangunan) areaEl.value = Number(l.Luas_Bangunan) || '';

  // Auto-check dokumen dari Sertifikat
  const cert = (l.Sertifikat || '').toUpperCase();
  document.querySelectorAll('#fl-sop-docs input[type=checkbox]').forEach(cb => {
    cb.checked = cert.includes(cb.value.replace('_', ' ')) || cert.includes(cb.value);
  });
}

function flClearListing() {
  const selEl = document.getElementById('fl-listing-selected');
  if (selEl) selEl.style.display = 'none';
  const propEl = document.getElementById('fl-prop-name');
  if (propEl) propEl.value = '';
  _flEnabled = [1]; _flActive = 1;
  flSyncFloorUI();
}

/* ── Finishing / Knocking / Bool setters ────────────────────────── */
function flSetFinishing(n, type) {
  ['PAVING_BLOCK','CERAMIC_STANDARD','GRANITE_TILE','BETON_COR','EPOXY_EXPOSED','FLOOR_HARDENER'].forEach(t => {
    const btn = document.getElementById(`fl-${n}-fin-${t}`); if (!btn) return;
    if (t === type) { btn.style.background='#D4A853'; btn.style.color='#0D1526'; btn.style.border='none'; }
    else { btn.style.background='#131F38'; btn.style.color='rgba(255,255,255,0.5)'; btn.style.border='1px solid rgba(255,255,255,0.1)'; }
  });
  const inp = document.getElementById(`fl-${n}-finishing`); if (inp) inp.value = type;
}

function flSetKnocking(n, val) {
  const s = document.getElementById(`fl-${n}-knock-solid`), h = document.getElementById(`fl-${n}-knock-hollow`);
  if (s) { s.style.background=val==='SOLID'?'#D4A853':'#131F38'; s.style.color=val==='SOLID'?'#0D1526':'rgba(255,255,255,0.5)'; s.style.border=val==='SOLID'?'none':'1px solid rgba(255,255,255,0.1)'; }
  if (h) { h.style.background=val==='HOLLOW'?'#ef4444':'#131F38'; h.style.color=val==='HOLLOW'?'#fff':'rgba(255,255,255,0.5)'; h.style.border=val==='HOLLOW'?'none':'1px solid rgba(255,255,255,0.1)'; }
  const inp = document.getElementById(`fl-${n}-knocking`); if (inp) inp.value = val;
}

function flSetBool(n, key, val) {
  const yBtn = document.getElementById(`fl-${n}-${key}-yes`), nBtn = document.getElementById(`fl-${n}-${key}-no`), hid = document.getElementById(`fl-${n}-${key}-val`);
  const isDefect = key === 'defect';
  const yActive = isDefect ? '#f59e0b' : '#D4A853';
  const nActive = isDefect ? '#22c55e' : '#ef4444';
  if (yBtn) { yBtn.style.background=val?yActive:'#131F38'; yBtn.style.color=val?'#0D1526':'rgba(255,255,255,0.5)'; yBtn.style.border=val?'none':'1px solid rgba(255,255,255,0.1)'; }
  if (nBtn) { nBtn.style.background=!val?nActive:'#131F38'; nBtn.style.color=!val?'#fff':'rgba(255,255,255,0.5)'; nBtn.style.border=!val?'none':'1px solid rgba(255,255,255,0.1)'; }
  if (hid) hid.value = val ? '1' : '0';
}

/* ════════════════════════════════════════════════════════════════════
   CALCULATION & RENDER
   ════════════════════════════════════════════════════════════════════ */

function _flReadData(n) {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  return {
    floorNumber:        n,
    structureType:      n === 1 ? 'SLAB_ON_GRADE' : 'SUSPENDED_SLAB',
    finishingType:      g(`fl-${n}-finishing`)    || 'CERAMIC_STANDARD',
    isElevatedFromRoad: g(`fl-${n}-elevated-val`) === '1',
    soundKnockingResult:g(`fl-${n}-knocking`)     || 'SOLID',
    hasVehicleAccess:   g(`fl-${n}-vehicle-val`)  === '1',
    columnSpanMeters:   parseFloat(g(`fl-${n}-span`)) || 4,
    slabThicknessCm:    parseFloat(g(`fl-${n}-slab`)) || 12,
    historicalUsage:    g(`fl-${n}-usage`)         || 'OFFICE_STANDARD',
    hasStructuralDefects: g(`fl-${n}-defect-val`) === '1',
  };
}

function flHitung() {
  _flResults = {};
  _flEnabled.forEach(n => { _flResults[n] = flEstimateLoad(_flReadData(n)); });
  _flRenderResults();

  if (_flResults[1]) { const e = document.getElementById('fl-sop-lt1'); if (e) e.value = _flResults[1].estimatedCapacityKgM2; }
  if (_flResults[2]) { const e = document.getElementById('fl-sop-lt2'); if (e) e.value = _flResults[2].estimatedCapacityKgM2; }

  ['fl-results','fl-rack-section','fl-tenant-section'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'block';
  });
  const expEl = document.getElementById('fl-export-section');
  if (expEl) expEl.style.display = 'flex';

  // Jika tujuan = verif.tenant, langsung scroll ke tenant section
  if (_flTujuan === 'tenant') {
    setTimeout(() => { const ts = document.getElementById('fl-tenant-section'); if (ts) ts.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 350);
  } else {
    setTimeout(() => { const r = document.getElementById('fl-results'); if (r) r.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 200);
  }
}

function _flCapColor(kg) { return kg>=800?'#22c55e':kg>=400?'#D4A853':kg>=200?'#f59e0b':'#ef4444'; }
function _flConfColor(c) { return c==='HIGH'?'#22c55e':c==='LOW'?'#ef4444':'#f59e0b'; }
function _flConfLabel(c) { return c==='HIGH'?'🟢 Tinggi':c==='LOW'?'🔴 Rendah':'🟡 Sedang'; }
function _flCapLabel(kg) {
  if (kg>=800) return { txt:'Beban Berat ✓', bg:'rgba(34,197,94,0.15)',   col:'#22c55e' };
  if (kg>=400) return { txt:'Beban Sedang',  bg:'rgba(212,168,83,0.15)',  col:'#D4A853' };
  if (kg>=200) return { txt:'Beban Ringan',  bg:'rgba(245,158,11,0.15)',  col:'#f59e0b' };
  return          { txt:'Kapasitas Rendah',  bg:'rgba(239,68,68,0.15)',   col:'#ef4444' };
}

function _flRenderResults() {
  const container = document.getElementById('fl-results-cards'); if (!container) return;
  let html = '';
  _flEnabled.forEach(n => {
    const r = _flResults[n]; if (!r) return;
    const capColor = _flCapColor(r.estimatedCapacityKgM2), confColor = _flConfColor(r.confidenceLevel);
    const capLabel = _flCapLabel(r.estimatedCapacityKgM2), icon = ['🏗️','2️⃣','3️⃣','4️⃣'][n-1];
    html += `
    <div style="background:#0D1526;border-radius:16px;padding:16px;border:1px solid ${capColor}33;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:12px;background:${capColor}22;display:flex;align-items:center;justify-content:center;font-size:20px">${icon}</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#fff">Lantai ${n}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4)">${n===1?'Slab on Grade':'Suspended Slab'}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:26px;font-weight:800;color:${capColor};font-family:'DM Serif Display',serif;line-height:1">${r.estimatedCapacityKgM2.toLocaleString('id')}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4)">kg/m²</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${confColor}22;color:${confColor}">${_flConfLabel(r.confidenceLevel)}</span>
        <span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${capLabel.bg};color:${capLabel.col}">${capLabel.txt}</span>
      </div>
      ${r.safetyWarning?`<div style="background:rgba(239,68,68,0.1);border-radius:10px;padding:10px;margin-bottom:10px;border:1px solid rgba(239,68,68,0.2)"><p style="font-size:11px;color:#fca5a5;margin:0"><i class="fa-solid fa-triangle-exclamation" style="margin-right:5px"></i>${r.safetyWarning}</p></div>`:''}
      <p style="font-size:11px;color:rgba(255,255,255,0.65);margin:0 0 ${r.bonusDetail.length?'10':'0'}px;line-height:1.5"><i class="fa-solid fa-lightbulb" style="color:#D4A853;margin-right:5px"></i>${r.recommendation}</p>
      ${r.bonusDetail.length?`<div style="padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)"><p style="font-size:9.5px;color:rgba(212,168,83,0.7);margin:0">${r.bonusDetail.join(' · ')}</p></div>`:''}
    </div>`;
  });
  container.innerHTML = html;

  const rackSel = document.getElementById('fl-rack-floor');
  if (rackSel) rackSel.innerHTML = _flEnabled.map(n=>`<option value="${n}">Lantai ${n} (${(_flResults[n]||{}).estimatedCapacityKgM2||'—'} kg/m²)</option>`).join('');
}

/* ── Rack Safety ────────────────────────────────────────────────── */
function flHitungRak() {
  const weight = parseFloat(document.getElementById('fl-rack-weight').value) || 0;
  const length = parseFloat(document.getElementById('fl-rack-length').value) || 1;
  const width  = parseFloat(document.getElementById('fl-rack-width').value)  || 1;
  const floorN = parseInt(document.getElementById('fl-rack-floor').value)    || 1;
  const floorLoad = (_flResults[floorN]||{}).estimatedCapacityKgM2 || 0;
  if (!floorLoad) { alert('Hitung kapasitas lantai terlebih dahulu.'); return; }
  const result = flRackSafety(weight, length * width, floorLoad);
  const resEl  = document.getElementById('fl-rack-result');
  const color  = result.isSafe ? (result.utilizationPct>80?'#f59e0b':'#22c55e') : '#ef4444';
  resEl.style.display = 'block';
  resEl.innerHTML = `
    <div style="background:${color}15;border-radius:12px;padding:14px;border:1px solid ${color}33">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:14px;font-weight:700;color:${color}">${result.isSafe?'✅ AMAN':'❌ TIDAK AMAN'}</span>
        <div style="text-align:right"><span style="font-size:22px;font-weight:800;color:${color}">${result.utilizationPct}%</span><div style="font-size:9px;color:rgba(255,255,255,0.4)">utilisasi</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="text-align:center;background:rgba(0,0,0,0.25);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.4)">Beban Rak</div><div style="font-size:14px;font-weight:700;color:#fff">${result.actualLoadDensity.toLocaleString('id')} kg/m²</div></div>
        <div style="text-align:center;background:rgba(0,0,0,0.25);border-radius:8px;padding:8px"><div style="font-size:10px;color:rgba(255,255,255,0.4)">Max Lantai</div><div style="font-size:14px;font-weight:700;color:${color}">${result.maxCapacity.toLocaleString('id')} kg/m²</div></div>
      </div>
      <p style="font-size:11px;color:rgba(255,255,255,0.7);margin:0;line-height:1.5">${result.advice}</p>
    </div>`;
}

/* ── Tenant SOP ─────────────────────────────────────────────────── */
function flCheckTenant() {
  const sel = document.getElementById('fl-tenant-sel').value;
  const propData = {
    netAreaM2:          parseFloat(document.getElementById('fl-sop-area').value)     || 0,
    frontageMeters:     parseFloat(document.getElementById('fl-sop-frontage').value) || 0,
    ceilingHeightMeters:parseFloat(document.getElementById('fl-sop-ceiling').value)  || 0,
    powerKva:           parseFloat(document.getElementById('fl-sop-power').value)    || 0,
    floor1LoadKgM2:     parseFloat(document.getElementById('fl-sop-lt1').value)      || 0,
    floor2LoadKgM2:     parseFloat(document.getElementById('fl-sop-lt2').value)      || 0,
    availableDocs:      Array.from(document.querySelectorAll('#fl-sop-docs input:checked')).map(el=>el.value)
  };
  const result = flValidateTenant(propData, sel); if (!result) return;
  const resEl = document.getElementById('fl-tenant-result');
  const color = result.isEligible ? '#22c55e' : result.scorePercentage>=60 ? '#f59e0b' : '#ef4444';
  resEl.style.display = 'block';
  resEl.innerHTML = `
    <div style="background:${color}15;border-radius:12px;padding:14px;border:1px solid ${color}33">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div><div style="font-size:13px;font-weight:700;color:#fff">${result.tenantName}</div><div style="font-size:10px;color:rgba(255,255,255,0.4)">${result.isEligible?'✅ Memenuhi semua kriteria':'⚠️ Belum memenuhi kriteria'}</div></div>
        <div style="text-align:center"><div style="font-size:26px;font-weight:800;color:${color};font-family:'DM Serif Display',serif;line-height:1">${result.scorePercentage}%</div><div style="font-size:9px;color:rgba(255,255,255,0.4)">skor</div></div>
      </div>
      <div style="background:rgba(0,0,0,0.3);border-radius:4px;height:6px;margin-bottom:12px;overflow:hidden"><div style="height:100%;border-radius:4px;background:${color};width:${result.scorePercentage}%"></div></div>
      ${result.passedCriteria.length?`<div style="margin-bottom:8px">${result.passedCriteria.map(c=>`<div style="font-size:11px;color:#86efac;padding:2px 0">${c}</div>`).join('')}</div>`:''}
      ${result.missingCriteria.length?`<div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:8px">${result.missingCriteria.map(c=>`<div style="font-size:11px;color:#fca5a5;padding:2px 0">${c}</div>`).join('')}</div>`:''}
    </div>`;
}

/* ── Export WA ──────────────────────────────────────────────────── */
function flCopyWA() {
  const propName  = (document.getElementById('fl-prop-name')||{}).value  || 'Properti';
  const namaUser  = (document.getElementById('fl-nama-user')||{}).value  || '';
  const namaAgen  = (document.getElementById('fl-nama-agen')||{}).value  || '';
  const tujuanMap = { survey:'Survey Teknis', sewa:'Sewa/Rental', beli:'Beli/Investasi', tenant:'Verifikasi Tenant' };
  const lines = [
    `*📊 ANALISIS BEBAN LANTAI — SNI 1727*`,
    `*Properti:* ${propName}`,
    namaUser ? `*Klien:* ${namaUser}` : '',
    namaAgen ? `*Agen:* ${namaAgen}` : '',
    `*Tujuan:* ${tujuanMap[_flTujuan]||'Survey'}`,
    ''
  ].filter(x => x !== undefined);

  _flEnabled.forEach(n => {
    const r = _flResults[n]; if (!r) return;
    const icon = r.confidenceLevel==='HIGH'?'🟢':r.confidenceLevel==='MEDIUM'?'🟡':'🔴';
    lines.push(`${icon} *Lantai ${n}:* ${r.estimatedCapacityKgM2.toLocaleString('id')} kg/m² (Conf: ${r.confidenceLevel})`);
    if (r.safetyWarning) lines.push(`   ⚠️ ${r.safetyWarning}`);
    lines.push(`   💡 ${r.recommendation}`);
  });

  const tenRes = document.getElementById('fl-tenant-result');
  if (tenRes && tenRes.style.display !== 'none') {
    const selEl = document.getElementById('fl-tenant-sel');
    const sop = selEl ? FL_TENANT_SOPS[selEl.value] : null;
    const pctEl = tenRes.querySelector('[style*="font-weight:800"]');
    if (sop && pctEl) lines.push('', `*🏪 Kompatibilitas ${sop.tenantName}:* ${pctEl.textContent}`);
  }

  lines.push(
    '',
    '⚠️ *DISCLAIMER:*',
    '_Hasil ini adalah estimasi saja, bukan perhitungan riil. Untuk perhitungan riil memerlukan tenaga dan alat yang dibutuhkan._'
  );
  const text = lines.join('\n');

  const btn = document.getElementById('fl-copy-btn');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) { btn.innerHTML='<i class="fa-solid fa-check" style="margin-right:6px"></i>Tersalin!'; btn.style.background='rgba(34,197,94,0.2)'; btn.style.color='#4ade80'; btn.style.borderColor='rgba(34,197,94,0.3)'; }
      setTimeout(() => { if (btn) { btn.innerHTML='<i class="fa-brands fa-whatsapp" style="font-size:16px;margin-right:6px"></i>Salin Ringkasan ke WhatsApp'; btn.style.cssText=''; } }, 2500);
    });
  } else {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    if (btn) btn.textContent = '✓ Tersalin!';
  }
}

/* ── Print PDF ──────────────────────────────────────────────────── */
function flPrintPDF() {
  const propName  = (document.getElementById('fl-prop-name') ||{}).value || '—';
  const namaUser  = (document.getElementById('fl-nama-user') ||{}).value || '—';
  const namaAgen  = (document.getElementById('fl-nama-agen') ||{}).value || '—';
  const tujuanMap = { survey:'Survey Teknis', sewa:'Sewa / Rental', beli:'Beli / Investasi', tenant:'Verifikasi Tenant' };
  const tujuan    = tujuanMap[_flTujuan] || 'Survey Teknis';
  const tanggal   = new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });
  const DISCLAIMER = 'Hasil ini adalah estimasi saja, bukan perhitungan riil. Untuk perhitungan riil memerlukan tenaga dan alat yang dibutuhkan.';

  const capColor  = kg => kg>=800?'#16a34a':kg>=400?'#b45309':kg>=200?'#d97706':'#dc2626';
  const confLabel = c  => c==='HIGH'?'Tinggi ✓':c==='LOW'?'Rendah ✗':'Sedang ~';
  const capLabel  = kg => kg>=800?'Beban Berat':kg>=400?'Beban Sedang':kg>=200?'Beban Ringan':'Kapasitas Rendah';

  // Build results rows
  let floorRows = '';
  _flEnabled.forEach(n => {
    const r = _flResults[n]; if (!r) return;
    const cc = capColor(r.estimatedCapacityKgM2);
    floorRows += `
      <div style="border:1.5px solid ${cc};border-radius:12px;padding:16px;margin-bottom:12px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
          <div>
            <div style="font-size:15px;font-weight:700;color:#111">Lantai ${n} — ${n===1?'Slab on Grade':'Suspended Slab'}</div>
            <div style="font-size:11px;color:#555;margin-top:2px">Confidence: <strong>${confLabel(r.confidenceLevel)}</strong> &nbsp;|&nbsp; Kategori: <strong>${capLabel(r.estimatedCapacityKgM2)}</strong></div>
          </div>
          <div style="text-align:right">
            <div style="font-size:28px;font-weight:900;color:${cc};line-height:1">${r.estimatedCapacityKgM2.toLocaleString('id')}</div>
            <div style="font-size:11px;color:#777">kg/m²</div>
          </div>
        </div>
        ${r.safetyWarning ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:8px 10px;border-radius:4px;margin-bottom:8px;font-size:11px;color:#b91c1c">⚠️ ${r.safetyWarning}</div>` : ''}
        <div style="font-size:12px;color:#374151;line-height:1.5">💡 ${r.recommendation}</div>
        ${r.bonusDetail.length ? `<div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px">${r.bonusDetail.join(' · ')}</div>` : ''}
      </div>`;
  });

  // Tenant SOP result (if visible)
  let tenantBlock = '';
  const tenRes = document.getElementById('fl-tenant-result');
  if (tenRes && tenRes.style.display !== 'none') {
    const selEl = document.getElementById('fl-tenant-sel');
    const sop = selEl ? FL_TENANT_SOPS[selEl.value] : null;
    const pctEl = tenRes.querySelector('[style*="font-weight:800"]');
    if (sop && pctEl) {
      const pct = parseInt(pctEl.textContent) || 0;
      const passed = Array.from(tenRes.querySelectorAll('[style*="#86efac"]')).map(el => el.textContent);
      const missing = Array.from(tenRes.querySelectorAll('[style*="#fca5a5"]')).map(el => el.textContent);
      tenantBlock = `
      <div style="margin-top:16px;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:8px;border-bottom:2px solid #e5e7eb;padding-bottom:6px">Verifikasi SOP Tenant — ${sop.tenantName}</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="font-size:26px;font-weight:900;color:${pct>=100?'#16a34a':pct>=60?'#d97706':'#dc2626'}">${pct}%</div>
          <div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px"><div style="width:${pct}%;height:100%;background:${pct>=100?'#16a34a':pct>=60?'#d97706':'#dc2626'};border-radius:4px"></div></div>
        </div>
        ${passed.length ? `<div style="margin-bottom:6px">${passed.map(c=>`<div style="font-size:11px;color:#166534;padding:1px 0">${c}</div>`).join('')}</div>` : ''}
        ${missing.length ? `<div>${missing.map(c=>`<div style="font-size:11px;color:#991b1b;padding:1px 0">${c}</div>`).join('')}</div>` : ''}
      </div>`;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <title>Analisis Beban Lantai — ${propName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color:#111; background:#fff; padding:28px 32px; font-size:13px; }
    @media print {
      body { padding:16px 20px; }
      button { display:none !important; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2.5px solid #111">
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#555;margin-bottom:4px">Mansion Property CRM</div>
      <div style="font-size:20px;font-weight:900;color:#111">Analisis Beban Lantai</div>
      <div style="font-size:11px;color:#555;margin-top:2px">Estimasi berbasis SNI 1727 — Beban Minimum Bangunan Gedung</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#555">
      <div>${tanggal}</div>
      <div style="margin-top:3px;font-weight:600">v${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}</div>
    </div>
  </div>

  <!-- Info properti -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:20px;background:#f9fafb;border-radius:8px;padding:12px 16px">
    <div><span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Properti</span><div style="font-weight:700;margin-top:1px">${propName}</div></div>
    <div><span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Tujuan</span><div style="font-weight:700;margin-top:1px">${tujuan}</div></div>
    <div><span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Klien / User</span><div style="font-weight:700;margin-top:1px">${namaUser}</div></div>
    <div><span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Agen</span><div style="font-weight:700;margin-top:1px">${namaAgen}</div></div>
  </div>

  <!-- Hasil per lantai -->
  <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Hasil Estimasi Kapasitas</div>
  ${floorRows}

  ${tenantBlock}

  <!-- Disclaimer -->
  <div style="margin-top:20px;padding:12px 16px;background:#fffbeb;border:1.5px solid #f59e0b;border-radius:8px;page-break-inside:avoid">
    <div style="font-size:11px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">⚠️ Disclaimer Penting</div>
    <div style="font-size:12px;color:#78350f;line-height:1.6;font-weight:600">${DISCLAIMER}</div>
  </div>

  <!-- Footer -->
  <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af">
    <span>Dicetak dari Mansion Property CRM &nbsp;·&nbsp; ${tanggal}</span>
    <span>Dokumen ini bukan laporan teknis resmi</span>
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { alert('Pop-up diblokir browser. Izinkan pop-up untuk fitur cetak PDF.'); return; }
  win.document.write(html);
  win.document.close();
}

/* ── Entry Point (dari dashboard button / navbar) ───────────────── */
function openFloorLoad() {
  navigateTo('calculator');
  setTimeout(() => switchCalcTab('floorload'), 100);
}
