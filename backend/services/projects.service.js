/**
 * ProjectsService
 * ============================================
 * Manajemen Proyek Primer (Primary):
 * - CRUD proyek developer
 * - Upload foto via Cloudinary (max 2)
 * - Generate shortlink per-agen untuk tracking promosi
 * - AutoCaption + SEO hashtag untuk sosmed
 *
 * Akses: superadmin | principal | admin
 */

const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { v4: uuidv4 } = require('uuid');

class ProjectsService {

  // ── GET ALL ──────────────────────────────────────────────
  async getAll(filters = {}) {
    const rows = await sheetsService.getRange(SHEETS.PROJECTS);
    if (!rows || rows.length < 2) return [];

    const [, ...data] = rows;
    let projects = data.map(row => this._rowToObj(row)).filter(p => p.ID);

    if (filters.status)          projects = projects.filter(p => p.Status === filters.status);
    if (filters.tipe)            projects = projects.filter(p => p.Tipe_Properti === filters.tipe);
    if (filters.created_by_id)   projects = projects.filter(p => p.Created_By_ID === filters.created_by_id);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      projects = projects.filter(p =>
        [p.Nama_Proyek, p.Nama_Developer, p.Tipe_Properti, p.Deskripsi]
          .join(' ').toLowerCase().includes(q)
      );
    }

    // Sort: terbaru dulu
    projects.sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));
    return projects;
  }

  // ── GET BY ID ────────────────────────────────────────────
  async getById(id) {
    const result = await sheetsService.findRowById(SHEETS.PROJECTS, id);
    if (!result) return null;
    return this._rowToObj(result.data);
  }

  // ── CREATE ───────────────────────────────────────────────
  async create(data, user) {
    await this._ensureHeaders();

    const now  = new Date().toISOString();
    const id   = uuidv4();
    const kode = await this._generateKode(data.Tipe_Properti);

    // Koordinator: auto-fill dari user login, Status_Project = Pending
    // Role lain: bisa set koordinator dari body, Status_Project = Aktif
    const isKoordinator = user.role === 'koordinator';
    const koordinatorId   = isKoordinator ? user.id   : (data.Koordinator_ID   || '');
    const koordinatorNama = isKoordinator ? (user.nama || '') : (data.Koordinator_Nama || '');
    const statusProject   = isKoordinator ? 'Pending' : (data.Status_Project || 'Aktif');

    const obj = {
      ID:               id,
      Tanggal_Input:    now.slice(0, 10),
      Kode_Proyek:      kode,
      Nama_Proyek:      data.Nama_Proyek    || '',
      Nama_Developer:   data.Nama_Developer || '',
      Tipe_Properti:    data.Tipe_Properti  || 'Rumah',
      Harga_Mulai:      String(data.Harga_Mulai || '0').replace(/[^0-9]/g, ''),
      Harga_Format:     this._formatHarga(data.Harga_Mulai),
      Cara_Bayar:       Array.isArray(data.Cara_Bayar)
                          ? data.Cara_Bayar.join(',')
                          : (data.Cara_Bayar || ''),
      Deskripsi:        data.Deskripsi      || '',
      Foto_1_URL:       data.Foto_1_URL     || '',
      Foto_2_URL:       data.Foto_2_URL     || '',
      Cloudinary_IDs:   data.Cloudinary_IDs ? JSON.stringify(data.Cloudinary_IDs) : '[]',
      Caption_Sosmed:   '',
      Status:           'Draft',
      Created_By_ID:    user.id,
      Created_By_Nama:  user.nama || '',
      Created_At:       now,
      Updated_At:       now,
      Notes:            data.Notes          || '',
      Koordinator_ID:    koordinatorId,
      Koordinator_Nama:  koordinatorNama,
      Status_Project:    statusProject,
      Koordinator2_ID:   data.Koordinator2_ID   || '',
      Koordinator2_Nama: data.Koordinator2_Nama || '',
    };

    // Auto-generate caption setelah data lengkap
    obj.Caption_Sosmed = this._generateCaption(obj);

    const row = COLUMNS.PROJECTS.map(col => obj[col] || '');
    await sheetsService.appendRow(SHEETS.PROJECTS, row);
    return obj;
  }

  // ── UPDATE ───────────────────────────────────────────────
  async update(id, data) {
    const result = await sheetsService.findRowById(SHEETS.PROJECTS, id);
    if (!result) throw new Error('Proyek tidak ditemukan');

    const existing = this._rowToObj(result.data);
    const updated  = { ...existing, ...data, Updated_At: new Date().toISOString() };

    // Normalize Cara_Bayar array → CSV string
    if (Array.isArray(updated.Cara_Bayar)) {
      updated.Cara_Bayar = updated.Cara_Bayar.join(',');
    }

    // Normalize Cloudinary_IDs array → JSON string (agar tidak rusak di Sheets)
    if (Array.isArray(updated.Cloudinary_IDs)) {
      // Jika array baru kosong, pertahankan nilai existing dari spreadsheet
      if (updated.Cloudinary_IDs.length === 0) {
        updated.Cloudinary_IDs = existing.Cloudinary_IDs || '[]';
      } else {
        updated.Cloudinary_IDs = JSON.stringify(updated.Cloudinary_IDs);
      }
    }

    // Re-format harga jika berubah
    if (data.Harga_Mulai !== undefined) {
      updated.Harga_Mulai  = String(data.Harga_Mulai).replace(/[^0-9]/g, '');
      updated.Harga_Format = this._formatHarga(data.Harga_Mulai);
    }

    // Re-generate caption jika konten berubah
    if (data.Nama_Proyek || data.Nama_Developer || data.Deskripsi || data.Harga_Mulai) {
      updated.Caption_Sosmed = this._generateCaption(updated);
    }

    const row = COLUMNS.PROJECTS.map(col => updated[col] || '');
    await sheetsService.updateRow(SHEETS.PROJECTS, result.rowIndex, row);
    return updated;
  }

  // ── DELETE ───────────────────────────────────────────────
  async delete(id) {
    const result = await sheetsService.findRowById(SHEETS.PROJECTS, id);
    if (!result) throw new Error('Proyek tidak ditemukan');
    await sheetsService.deleteRow(SHEETS.PROJECTS, result.rowIndex);
    return true;
  }

  // ── PUBLISH / UNPUBLISH ──────────────────────────────────
  async setStatus(id, status) {
    if (!['Draft', 'Publish'].includes(status)) throw new Error('Status tidak valid');
    return this.update(id, { Status: status });
  }

  // ── GENERATE SHORTLINK per Agen ──────────────────────────
  // Setiap agen punya shortlink unik ke setiap proyek.
  // Format: /p/{kode_proyek}?r={ref_code}
  // ref_code = 6 karakter hash dari agen_id + project_id
  async getOrCreateShortlink(projectId, agentUser) {
    await this._ensureRefHeaders();

    const rows = await sheetsService.getRange(SHEETS.PROJECT_REFS);
    const data = rows && rows.length > 1 ? rows.slice(1) : [];

    // Cek apakah sudah ada
    const existing = data.find(r =>
      r[COLUMNS.PROJECT_REFS.indexOf('Project_ID')]  === projectId &&
      r[COLUMNS.PROJECT_REFS.indexOf('Agen_ID')]     === agentUser.id
    );

    if (existing) {
      return this._refRowToObj(existing);
    }

    // Buat baru
    const project = await this.getById(projectId);
    if (!project) throw new Error('Proyek tidak ditemukan');

    const refCode = this._makeRefCode(agentUser.id, projectId);
    const noWa    = (agentUser.No_WA || '').replace(/[^0-9]/g, '');
    const waUrl   = noWa ? `https://wa.me/${noWa}` : '';
    const now     = new Date().toISOString();

    const refObj = {
      ID:           uuidv4(),
      Project_ID:   projectId,
      Kode_Proyek:  project.Kode_Proyek,
      Agen_ID:      agentUser.id,
      Agen_Nama:    agentUser.nama || '',
      Ref_Code:     refCode,
      Short_URL:    waUrl,
      Click_Count:  '0',
      Last_Click_At:'',
      Created_At:   now,
    };

    const row = COLUMNS.PROJECT_REFS.map(col => refObj[col] || '');
    await sheetsService.appendRow(SHEETS.PROJECT_REFS, row);
    return refObj;
  }

  // ── LOG CLICK dari shortlink ─────────────────────────────
  async logClick(refCode) {
    const rows = await sheetsService.getRange(SHEETS.PROJECT_REFS);
    if (!rows || rows.length < 2) return null;

    const idx = rows.slice(1).findIndex(r =>
      r[COLUMNS.PROJECT_REFS.indexOf('Ref_Code')] === refCode
    );
    if (idx === -1) return null;

    const rowIndex = idx + 2; // +2: header+1-based
    const ref = this._refRowToObj(rows[idx + 1]);
    const updated = {
      ...ref,
      Click_Count:  String((parseInt(ref.Click_Count) || 0) + 1),
      Last_Click_At: new Date().toISOString(),
    };

    const row = COLUMNS.PROJECT_REFS.map(col => updated[col] || '');
    await sheetsService.updateRow(SHEETS.PROJECT_REFS, rowIndex, row);
    return updated;
  }

  // ── GET REFERRAL STATS (untuk Principal) ─────────────────
  async getReferralStats(projectId) {
    const rows = await sheetsService.getRange(SHEETS.PROJECT_REFS);
    if (!rows || rows.length < 2) return [];

    const data = rows.slice(1)
      .map(r => this._refRowToObj(r))
      .filter(r => r.Project_ID === projectId)
      .sort((a, b) => (parseInt(b.Click_Count) || 0) - (parseInt(a.Click_Count) || 0));

    return data;
  }

  // ── GENERATE CAPTION (autocaption) ───────────────────────
  generateCaption(project, platform = 'instagram') {
    return this._generateCaption(project, platform);
  }

  // ── SOSMED BUNDLE ─────────────────────────────────────────
  getSosmedBundle(project) {
    return {
      project_id: project.ID,
      kode:       project.Kode_Proyek,
      caption_ig:     this._generateCaption(project, 'instagram'),
      caption_fb:     this._generateCaption(project, 'facebook'),
      caption_tiktok: this._generateCaption(project, 'tiktok'),
      caption_wa:     this._generateCaptionWA(project),
      hashtags:       this._buildHashtags(project),
    };
  }

  // ──────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────

  _rowToObj(row) {
    return COLUMNS.PROJECTS.reduce((obj, col, i) => {
      obj[col] = row[i] || '';
      return obj;
    }, {});
  }

  _refRowToObj(row) {
    return COLUMNS.PROJECT_REFS.reduce((obj, col, i) => {
      obj[col] = row[i] || '';
      return obj;
    }, {});
  }

  _formatHarga(raw) {
    const num = parseInt(String(raw || '0').replace(/[^0-9]/g, ''));
    if (!num) return 'Harga on request';
    if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(num % 1_000_000_000 === 0 ? 0 : 1)} M`;
    if (num >= 1_000_000)     return `Rp ${(num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 0)} Jt`;
    return `Rp ${num.toLocaleString('id-ID')}`;
  }

  _makeRefCode(agenId, projectId) {
    // 6-char alphanumeric derived from ids
    const combined = (agenId + projectId).replace(/-/g, '');
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) - hash) + combined.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36).padStart(6, '0').slice(0, 6).toUpperCase();
  }

  async _generateKode(tipe) {
    const prefix = { Rumah: 'PRJ-RMH', Ruko: 'PRJ-RKO', Apartemen: 'PRJ-APT', Gudang: 'PRJ-GDG' }[tipe] || 'PRJ';
    const year   = new Date().getFullYear();
    const rows   = await sheetsService.getRange(SHEETS.PROJECTS);
    const seq    = String((rows ? rows.length : 1)).padStart(3, '0');
    return `${prefix}-${year}-${seq}`;
  }

  async _ensureHeaders() {
    try {
      const rows = await sheetsService.getRange(SHEETS.PROJECTS);
      if (!rows || rows.length === 0) {
        await sheetsService.appendRow(SHEETS.PROJECTS, COLUMNS.PROJECTS);
      }
    } catch (_) {}
  }

  async _ensureRefHeaders() {
    try {
      const rows = await sheetsService.getRange(SHEETS.PROJECT_REFS);
      if (!rows || rows.length === 0) {
        await sheetsService.appendRow(SHEETS.PROJECT_REFS, COLUMNS.PROJECT_REFS);
      }
    } catch (_) {}
  }

  // ── Caption Generator ─────────────────────────────────────
  _generateCaption(project, platform = 'instagram') {
    const {
      Nama_Proyek, Nama_Developer, Tipe_Properti,
      Harga_Format, Cara_Bayar, Deskripsi,
    } = project;

    const harga    = Harga_Format || this._formatHarga(project.Harga_Mulai);
    const tipe     = Tipe_Properti || 'Properti';
    const devName  = Nama_Developer || 'Developer Terpercaya';
    const projName = Nama_Proyek    || 'Proyek Eksklusif';
    const cara     = Cara_Bayar ? Cara_Bayar.split(',').map(c => c.trim()).join(' | ') : 'Cash / KPR / Inhouse';
    const hashtags = this._buildHashtags(project);

    const emoji = { Rumah: '🏡', Ruko: '🏪', Apartemen: '🏢', Gudang: '🏭' }[tipe] || '🏠';

    // Ekstrak keunggulan dari deskripsi (baris dengan bullet/dash)
    const highlights = this._extractHighlights(Deskripsi);

    if (platform === 'facebook') {
      return `${emoji} HUNIAN IMPIAN: ${projName.toUpperCase()}
📌 Developer: ${devName}
🏠 Tipe: ${tipe} | Mulai dari ${harga}

${highlights ? `✨ KEUNGGULAN:\n${highlights}\n` : ''}
💳 Cara Bayar: ${cara}

${Deskripsi ? `📝 Deskripsi:\n${Deskripsi.slice(0, 500)}${Deskripsi.length > 500 ? '...' : ''}\n` : ''}
📞 Hubungi agen kami sekarang untuk info HARGA TERBAIK & jadwal kunjungan lokasi!

${hashtags}`;
    }

    if (platform === 'tiktok') {
      return `${emoji} ${projName} — Mulai ${harga}!

By ${devName}
Tipe: ${tipe}

${highlights || '✅ Lokasi strategis\n✅ Harga terjangkau\n✅ Legal & bersertifikat'}

Cara bayar: ${cara}
DM atau klik link untuk info lengkap! 🔑

${hashtags}`;
    }

    // Default: Instagram
    return `${emoji} NEW PROJECT LAUNCH! ${emoji}

🏗️ ${projName}
👷 by ${devName}
🏠 Tipe: ${tipe}

💰 Harga Mulai: ${harga}
💳 ${cara}

${highlights || '✨ Fasilitas premium\n✨ Lokasi strategis\n✨ Investasi menjanjikan'}

📲 Hubungi kami untuk INFO & BOOKING sekarang!
Jangan sampai kehabisan unit terbaik! 🔥

${hashtags}`;
  }

  _generateCaptionWA(project) {
    const {
      Nama_Proyek, Nama_Developer, Tipe_Properti,
      Harga_Format, Cara_Bayar, Deskripsi,
    } = project;

    const harga  = Harga_Format || this._formatHarga(project.Harga_Mulai);
    const cara   = Cara_Bayar ? Cara_Bayar.split(',').map(c => c.trim()).join(', ') : 'Cash / KPR / Inhouse';
    const emoji  = { Rumah: '🏡', Ruko: '🏪', Apartemen: '🏢', Gudang: '🏭' }[Tipe_Properti] || '🏠';

    return `${emoji} *${Nama_Proyek || 'Proyek Properti'}*
Developer: *${Nama_Developer || '-'}*
Tipe: ${Tipe_Properti} | Mulai *${harga}*

💳 Cara Bayar: ${cara}
${Deskripsi ? `\n📝 ${Deskripsi.slice(0, 300)}${Deskripsi.length > 300 ? '...' : ''}` : ''}

Tertarik? Hubungi saya untuk info lengkap & jadwal kunjungan! 🤝`;
  }

  _extractHighlights(deskripsi) {
    if (!deskripsi) return '';
    const lines = deskripsi.split('\n').filter(l => l.trim().match(/^[-•*✓✅]/));
    if (!lines.length) return '';
    return lines.slice(0, 5).map(l => `✅ ${l.replace(/^[-•*✓✅]\s*/, '').trim()}`).join('\n');
  }

  _buildHashtags(project) {
    const tipe = (project.Tipe_Properti || '').toLowerCase().replace(/\s/g, '');
    const dev  = (project.Nama_Developer || '').replace(/\s/g, '').slice(0, 20);
    const proj = (project.Nama_Proyek || '').replace(/\s/g, '').slice(0, 25);

    const tags = [
      `#${proj}`, `#${dev}`,
      `#${tipe}baru`, `#proyek${tipe}`, `#propertiindonesia`,
      '#rumahidaman', '#investasiproperti', '#jualproperti',
      '#rumahmurah', '#properti2024', '#newlaunch',
      '#developer', '#perumahan', '#hunianimpian',
    ].filter(t => t.length > 3);

    return [...new Set(tags)].slice(0, 14).join(' ');
  }
}

module.exports = new ProjectsService();
