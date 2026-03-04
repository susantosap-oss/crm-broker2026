/**
 * TasksService
 * ============================================
 * Manajemen jadwal: Visit, Meeting, Follow-Up, Call, Admin.
 * Terintegrasi dengan Pipeline LEADS — saat task selesai,
 * stage lead otomatis diupdate ke tahap berikutnya.
 *
 * ALUR UTAMA:
 *   1. Agen buat task  → Status: Pending
 *   2. Lead konfirmasi → Status: Confirmed
 *   3. Task selesai    → completeTask(outcome) → lead pipeline naik stage
 *   4. Tidak jadi      → cancelTask(alasan)
 */

const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { v4: uuidv4 } = require('uuid');

// Urutan stage untuk logika advance (tidak boleh mundur kecuali Batal)
const STAGE_ORDER = [
  'Baru', 'Dihubungi', 'Qualified', 'Visit',
  'Negosiasi', 'Proses_Admin', 'Deal', 'Batal',
];

// Outcome task → stage baru lead
const OUTCOME_TO_STAGE = {
  'Deal':             'Deal',
  'Batal':            'Batal',
  'Lanjut_Negosiasi': 'Negosiasi',
  'Proses_Admin':     'Proses_Admin',
  'Butuh_Followup':   null, // stage tetap
  'Reschedule':       null,
};

// Tipe task → stage otomatis jika tidak ada outcome eksplisit
const TASK_TYPE_STAGE_MAP = {
  'Visit':     'Visit',
  'Meeting':   'Negosiasi',
  'Call':      'Dihubungi',
  'Follow_Up': 'Dihubungi',
  'Admin':     'Proses_Admin',
};

class TasksService {

  _rowToObject(row) {
    return COLUMNS.TASKS.reduce((obj, col, i) => {
      obj[col] = row[i] ?? '';
      return obj;
    }, {});
  }

  _buildRow(obj) {
    return COLUMNS.TASKS.map((col) => obj[col] ?? '');
  }

  async _generateKode() {
    const rows = await sheetsService.getRange(SHEETS.TASKS);
    const count = Math.max(0, rows.length - 1);
    const year  = new Date().getFullYear();
    return `TSK-${year}-${String(count + 1).padStart(3, '0')}`;
  }

  // ── Get All (with filters) ────────────────────────────────
  async getAll(filters = {}) {
    const rows = await sheetsService.getRange(SHEETS.TASKS);
    if (rows.length < 2) return [];

    const [, ...data] = rows;
    let tasks = data.map((r) => this._rowToObject(r));

    if (filters.agen_id)    tasks = tasks.filter((t) => t.Agen_ID    === filters.agen_id);
    if (filters.status)     tasks = tasks.filter((t) => t.Status     === filters.status);
    if (filters.tipe)       tasks = tasks.filter((t) => t.Tipe       === filters.tipe);
    if (filters.lead_id)    tasks = tasks.filter((t) => t.Lead_ID    === filters.lead_id);
    if (filters.listing_id) tasks = tasks.filter((t) => t.Listing_ID === filters.listing_id);

    if (filters.date_from) {
      const from = new Date(filters.date_from);
      tasks = tasks.filter((t) => new Date(t.Scheduled_At) >= from);
    }
    if (filters.date_to) {
      const to = new Date(filters.date_to);
      to.setDate(to.getDate() + 1);
      tasks = tasks.filter((t) => new Date(t.Scheduled_At) < to);
    }
    if (filters.active_only) {
      tasks = tasks.filter((t) => !['Done', 'Cancelled'].includes(t.Status));
    }

    tasks.sort((a, b) => new Date(a.Scheduled_At) - new Date(b.Scheduled_At));
    return tasks;
  }

  async getToday(agenId = null) {
    const today    = new Date();
    const dateFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const dateTo   = dateFrom;
    return this.getAll({ agen_id: agenId, date_from: dateFrom, date_to: dateTo });
  }

  async getUpcoming(agenId = null, days = 7) {
    const from = new Date(); from.setHours(0,0,0,0);
    const to   = new Date(from); to.setDate(to.getDate() + days - 1);
    return this.getAll({
      agen_id: agenId,
      date_from: from.toISOString(),
      date_to: to.toISOString(),
      active_only: true,
    });
  }

  async getById(id) {
    const result = await sheetsService.findRowById(SHEETS.TASKS, id);
    if (!result) return null;
    return this._rowToObject(result.data);
  }

  // ── Create Task ───────────────────────────────────────────
  async create(payload, user) {
    const id   = uuidv4();
    const kode = await this._generateKode();
    const now  = new Date().toISOString();

    // Cache lead data
    let leadCache = {};
    if (payload.Lead_ID) {
      const lr = await sheetsService.findRowById(SHEETS.LEADS, payload.Lead_ID);
      if (lr) {
        const lead = COLUMNS.LEADS.reduce((o, c, i) => { o[c] = lr.data[i] || ''; return o; }, {});
        leadCache = {
          Lead_Nama:             lead.Nama,
          Lead_No_WA:            lead.No_WA,
          Pipeline_Stage_Before: lead.Status_Lead,
        };
      }
    }

    // Cache listing data
    let listingCache = {};
    if (payload.Listing_ID) {
      const lr = await sheetsService.findRowById(SHEETS.LISTING, payload.Listing_ID);
      if (lr) {
        const l = COLUMNS.LISTING.reduce((o, c, i) => { o[c] = lr.data[i] || ''; return o; }, {});
        listingCache = { Listing_Kode: l.Kode_Listing, Listing_Judul: l.Judul };
      }
    }

    // Default reminder = 60 menit sebelum jadwal
    const reminderAt = payload.Reminder_At || this._defaultReminder(payload.Scheduled_At);

    const task = {
      ID:                    id,
      Kode_Task:             kode,
      Tipe:                  payload.Tipe || 'Follow_Up',
      Judul:                 payload.Judul || `${payload.Tipe || 'Follow Up'} — ${leadCache.Lead_Nama || ''}`,
      Status:                'Pending',
      Prioritas:             payload.Prioritas || 'Sedang',
      Lead_ID:               payload.Lead_ID || '',
      Lead_Nama:             leadCache.Lead_Nama || '',
      Lead_No_WA:            leadCache.Lead_No_WA || '',
      Listing_ID:            payload.Listing_ID || '',
      Listing_Kode:          listingCache.Listing_Kode || '',
      Listing_Judul:         listingCache.Listing_Judul || '',
      Agen_ID:               user.id,
      Agen_Nama:             user.nama,
      Scheduled_At:          payload.Scheduled_At,
      Duration_Menit:        payload.Duration_Menit || '60',
      Lokasi:                payload.Lokasi || '',
      Koordinat_Lat:         payload.Koordinat_Lat || '',
      Koordinat_Lng:         payload.Koordinat_Lng || '',
      Catatan_Pre:           payload.Catatan_Pre || '',
      Catatan_Post:          '',
      Reminder_At:           reminderAt,
      Reminder_Sent:         'FALSE',
      Completed_At:          '',
      Outcome:               '',
      Pipeline_Stage_Before: leadCache.Pipeline_Stage_Before || '',
      Pipeline_Stage_After:  '',
      Created_By:            user.id,
      Created_At:            now,
      Updated_At:            now,
      Attachment_URLs:       '[]',
    };

    await sheetsService.appendRow(SHEETS.TASKS, this._buildRow(task));
    await this._log(user, 'TASK_CREATE', id, `Buat ${task.Tipe}: ${task.Judul}`);
    return task;
  }

  // ── Update Task ───────────────────────────────────────────
  async update(id, payload, user) {
    const existing = await sheetsService.findRowById(SHEETS.TASKS, id);
    if (!existing) throw new Error('Task tidak ditemukan');

    const task = this._rowToObject(existing.data);
    if (user.role === 'agen' && task.Agen_ID !== user.id) {
      throw new Error('Akses ditolak: bukan task Anda');
    }

    const merged = { ...task, ...payload, Updated_At: new Date().toISOString() };
    await sheetsService.updateRow(SHEETS.TASKS, existing.rowIndex, this._buildRow(merged));
    return merged;
  }

  // ── Complete Task ─────────────────────────────────────────
  async completeTask(id, payload, user) {
    const existing = await sheetsService.findRowById(SHEETS.TASKS, id);
    if (!existing) throw new Error('Task tidak ditemukan');

    const task = this._rowToObject(existing.data);
    if (user.role === 'agen' && task.Agen_ID !== user.id) throw new Error('Akses ditolak');

    const { outcome, catatan_post, attachment_urls } = payload;
    const newStage = OUTCOME_TO_STAGE[outcome] ?? TASK_TYPE_STAGE_MAP[task.Tipe] ?? null;
    const now = new Date().toISOString();

    const merged = {
      ...task,
      Status:               'Done',
      Completed_At:         now,
      Outcome:              outcome || '',
      Catatan_Post:         catatan_post || '',
      Pipeline_Stage_After: newStage || task.Pipeline_Stage_Before,
      Attachment_URLs:      attachment_urls ? JSON.stringify(attachment_urls) : task.Attachment_URLs,
      Updated_At:           now,
    };

    await sheetsService.updateRow(SHEETS.TASKS, existing.rowIndex, this._buildRow(merged));

    if (task.Lead_ID && newStage && newStage !== task.Pipeline_Stage_Before) {
      await this._advanceLeadStage(task.Lead_ID, newStage);
    }

    await this._log(user, 'TASK_COMPLETE', id, `Task selesai: ${task.Judul} → ${outcome}`);
    return merged;
  }

  // ── Cancel Task ───────────────────────────────────────────
  async cancelTask(id, alasan, user) {
    await this._log(user, 'TASK_CANCEL', id, `Task dibatalkan${alasan ? `: ${alasan}` : ''}`);
    return this.update(id, { Status: 'Cancelled', Catatan_Post: alasan || 'Dibatalkan' }, user);
  }

  // ── Reschedule Task ───────────────────────────────────────
  async rescheduleTask(id, newData, user) {
    return this.update(id, {
      Status:        'Pending',
      Scheduled_At:  newData.scheduled_at,
      Lokasi:        newData.lokasi || undefined,
      Reminder_At:   this._defaultReminder(newData.scheduled_at),
      Reminder_Sent: 'FALSE',
    }, user);
  }

  // ── Summary Stats ─────────────────────────────────────────
  async getSummary(agenId = null) {
    const tasks = await this.getAll({ agen_id: agenId });
    const today = new Date(); today.setHours(0,0,0,0);
    const tmr   = new Date(today); tmr.setDate(tmr.getDate() + 1);
    const isToday = (t) => { const d = new Date(t.Scheduled_At); return d >= today && d < tmr; };
    return {
      today_total:   tasks.filter(isToday).length,
      today_pending: tasks.filter((t) => isToday(t) && t.Status === 'Pending').length,
      today_done:    tasks.filter((t) => isToday(t) && t.Status === 'Done').length,
      pending_total: tasks.filter((t) => t.Status === 'Pending').length,
      overdue:       tasks.filter((t) => t.Status === 'Pending' && new Date(t.Scheduled_At) < today).length,
      this_week:     tasks.filter((t) => {
        const d = new Date(t.Scheduled_At); const wEnd = new Date(today); wEnd.setDate(wEnd.getDate() + 7);
        return d >= today && d < wEnd && !['Done','Cancelled'].includes(t.Status);
      }).length,
    };
  }

  // ── Conversion Funnel ─────────────────────────────────────
  getConversionStats(leads) {
    const c = {
      total:      leads.length,
      dihubungi:  leads.filter((l) => l.Status_Lead !== 'Baru').length,
      visit:      leads.filter((l) => ['Visit','Negosiasi','Proses_Admin','Deal'].includes(l.Status_Lead)).length,
      negosiasi:  leads.filter((l) => ['Negosiasi','Proses_Admin','Deal'].includes(l.Status_Lead)).length,
      deal:       leads.filter((l) => l.Status_Lead === 'Deal').length,
    };
    const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
    return {
      stages: [
        { label: 'Leads In',   count: c.total,     cr: 100,                          color: '#2B7BFF', icon: 'fa-users' },
        { label: 'Dihubungi',  count: c.dihubungi, cr: pct(c.dihubungi, c.total),   color: '#A855F7', icon: 'fa-phone' },
        { label: 'Visit',      count: c.visit,     cr: pct(c.visit, c.dihubungi),   color: '#F97316', icon: 'fa-house' },
        { label: 'Negosiasi',  count: c.negosiasi, cr: pct(c.negosiasi, c.visit),   color: '#EAB308', icon: 'fa-handshake' },
        { label: 'Deal ✅',    count: c.deal,      cr: pct(c.deal, c.negosiasi),    color: '#22C55E', icon: 'fa-trophy' },
      ],
      overall_cr: pct(c.deal, c.total),
    };
  }

  // ── Pipeline Stages ───────────────────────────────────────
  async getPipelineStages() {
    const rows = await sheetsService.getRange(SHEETS.PIPELINE_STAGES);
    if (rows.length < 2) return this._defaultPipelineStages();
    const [, ...data] = rows;
    const stages = data.map((r) => COLUMNS.PIPELINE_STAGES.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {}));
    const active = stages.filter((s) => s.Aktif === 'TRUE').sort((a,b) => parseInt(a.Urutan) - parseInt(b.Urutan));
    return active.length ? active : this._defaultPipelineStages();
  }

  async seedPipelineStages() {
    const rows = await sheetsService.getRange(SHEETS.PIPELINE_STAGES);
    if (rows.length > 1) return { skipped: true };
    const defaults = this._defaultPipelineStages();
    for (const s of defaults) {
      await sheetsService.appendRow(SHEETS.PIPELINE_STAGES, COLUMNS.PIPELINE_STAGES.map((c) => s[c] || ''));
    }
    return { seeded: defaults.length };
  }

  // ── Private helpers ───────────────────────────────────────
  async _advanceLeadStage(leadId, newStage) {
    try {
      const lr = await sheetsService.findRowById(SHEETS.LEADS, leadId);
      if (!lr) return;
      const lead = COLUMNS.LEADS.reduce((o, c, i) => { o[c] = lr.data[i] || ''; return o; }, {});
      const curOrder = STAGE_ORDER.indexOf(lead.Status_Lead);
      const newOrder = STAGE_ORDER.indexOf(newStage);
      if (newOrder <= curOrder && newStage !== 'Batal') return;
      const updated = { ...lead, Status_Lead: newStage, Last_Contact: new Date().toISOString(), Updated_At: new Date().toISOString() };
      await sheetsService.updateRow(SHEETS.LEADS, lr.rowIndex, COLUMNS.LEADS.map((c) => updated[c] || ''));
    } catch (e) { console.error('[tasks._advanceLeadStage]', e.message); }
  }

  async _log(user, action, entityId, desc) {
    try {
      const row = COLUMNS.ACTIVITY_LOG.map((c) => {
        if (c === 'ID')          return uuidv4();
        if (c === 'Timestamp')   return new Date().toISOString();
        if (c === 'Agen_ID')     return user.id;
        if (c === 'Agen_Nama')   return user.nama;
        if (c === 'Action_Type') return action;
        if (c === 'Entity_Type') return 'Task';
        if (c === 'Entity_ID')   return entityId;
        if (c === 'Description') return desc;
        return '';
      });
      await sheetsService.appendRow(SHEETS.ACTIVITY_LOG, row);
    } catch (e) { /* non-critical */ }
  }

  _defaultReminder(scheduledAt) {
    if (!scheduledAt) return '';
    const d = new Date(scheduledAt);
    d.setMinutes(d.getMinutes() - 60);
    return d.toISOString();
  }

  _defaultPipelineStages() {
    const now = new Date().toISOString();
    return [
      { Stage_ID: uuidv4(), Kode: 'BARU',  Nama: 'Baru',          Urutan: '1', Warna_Hex: '#6B7280', Icon_FA: 'fa-user-plus',    SLA_Hari: '3',  Auto_Task_Tipe: '',          Is_Terminal: 'FALSE', Aktif: 'TRUE', Deskripsi: 'Lead baru, belum dihubungi',         Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'DIHUB', Nama: 'Dihubungi',     Urutan: '2', Warna_Hex: '#2B7BFF', Icon_FA: 'fa-phone',        SLA_Hari: '7',  Auto_Task_Tipe: 'Follow_Up', Is_Terminal: 'FALSE', Aktif: 'TRUE', Deskripsi: 'Sudah ada kontak pertama',           Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'QUAL',  Nama: 'Qualified',     Urutan: '3', Warna_Hex: '#A855F7', Icon_FA: 'fa-star',         SLA_Hari: '5',  Auto_Task_Tipe: 'Call',      Is_Terminal: 'FALSE', Aktif: 'TRUE', Deskripsi: 'Lead serius, sudah tanya spesifik',  Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'VISIT', Nama: 'Visit',         Urutan: '4', Warna_Hex: '#F97316', Icon_FA: 'fa-house',        SLA_Hari: '10', Auto_Task_Tipe: 'Visit',     Is_Terminal: 'FALSE', Aktif: 'TRUE', Deskripsi: 'Survey properti dijadwalkan',         Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'NEG',   Nama: 'Negosiasi',     Urutan: '5', Warna_Hex: '#EAB308', Icon_FA: 'fa-handshake',    SLA_Hari: '7',  Auto_Task_Tipe: 'Meeting',   Is_Terminal: 'FALSE', Aktif: 'TRUE', Deskripsi: 'Sedang diskusi harga & syarat',       Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'ADMIN', Nama: 'Proses Admin',  Urutan: '6', Warna_Hex: '#06B6D4', Icon_FA: 'fa-file-contract', SLA_Hari: '14', Auto_Task_Tipe: 'Admin',    Is_Terminal: 'FALSE', Aktif: 'TRUE', Deskripsi: 'AJB / KPR / PPJB dalam proses',      Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'DEAL',  Nama: 'Deal',          Urutan: '7', Warna_Hex: '#22C55E', Icon_FA: 'fa-trophy',       SLA_Hari: '0',  Auto_Task_Tipe: '',          Is_Terminal: 'TRUE',  Aktif: 'TRUE', Deskripsi: 'Transaksi berhasil ✅',               Created_At: now },
      { Stage_ID: uuidv4(), Kode: 'BATAL', Nama: 'Batal',         Urutan: '8', Warna_Hex: '#EF4444', Icon_FA: 'fa-ban',          SLA_Hari: '0',  Auto_Task_Tipe: '',          Is_Terminal: 'TRUE',  Aktif: 'TRUE', Deskripsi: 'Tidak jadi beli/sewa ❌',            Created_At: now },
    ];
  }
}

module.exports = new TasksService();
