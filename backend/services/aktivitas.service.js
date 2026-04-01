/**
 * Aktivitas Harian Service
 * ============================================
 * CRUD untuk input aktivitas harian agen.
 * Data disimpan di sheet AKTIVITAS_HARIAN.
 * Aktivitas_Count di AGENTS diupdate untuk keperluan scoring.
 */

const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

class AktivitasService {

  /**
   * Ambil daftar aktivitas.
   * @param {object} opts
   * @param {string} [opts.agen_id]    - filter by agen
   * @param {string} [opts.tanggal]    - filter by tanggal YYYY-MM-DD
   * @param {string} [opts.week_start] - filter range awal
   * @param {string} [opts.week_end]   - filter range akhir
   */
  async getAll({ agen_id, tanggal, week_start, week_end } = {}) {
    const rows = await sheetsService.getAllAsObjects(SHEETS.AKTIVITAS_HARIAN, COLUMNS.AKTIVITAS_HARIAN);
    let data = rows.filter(r => r.ID);

    if (agen_id)               data = data.filter(r => r.Agen_ID === agen_id);
    if (tanggal)               data = data.filter(r => r.Tanggal === tanggal);
    if (week_start && week_end) data = data.filter(r => r.Tanggal >= week_start && r.Tanggal <= week_end);

    return data.sort((a, b) => b.Created_At.localeCompare(a.Created_At));
  }

  /**
   * Buat aktivitas baru dan update Aktivitas_Count agen.
   */
  async create({ agen_id, agen_nama, tanggal, deskripsi }) {
    const id         = uuidv4();
    const now        = new Date().toISOString();
    const tanggalStr = tanggal || new Date().toISOString().slice(0, 10);

    const row = COLUMNS.AKTIVITAS_HARIAN.map(col => {
      if (col === 'ID')         return id;
      if (col === 'Tanggal')    return tanggalStr;
      if (col === 'Agen_ID')    return agen_id;
      if (col === 'Agen_Nama')  return agen_nama;
      if (col === 'Deskripsi')  return deskripsi;
      if (col === 'Created_At') return now;
      return '';
    });

    await sheetsService.appendRow(SHEETS.AKTIVITAS_HARIAN, row);
    await this._incrementAktivitasCount(agen_id, +1);

    return { id, tanggal: tanggalStr, agen_id, agen_nama, deskripsi, created_at: now };
  }

  /**
   * Hapus aktivitas (hanya milik sendiri atau manager).
   */
  async delete(id, user) {
    const rows = await sheetsService.getRange(SHEETS.AKTIVITAS_HARIAN);
    // rows[0] = header, rows[1..] = data
    const idx = rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (idx < 0) throw Object.assign(new Error('Aktivitas tidak ditemukan'), { status: 404 });

    const row      = rows[idx];
    const agenId   = row[2]; // Agen_ID = kolom C (index 2)
    const isOwner  = agenId === user.id;
    const isMgr    = ['superadmin', 'admin', 'principal', 'kantor'].includes(user.role);

    if (!isOwner && !isMgr) throw Object.assign(new Error('Tidak bisa menghapus aktivitas milik orang lain'), { status: 403 });

    await sheetsService.deleteRow(SHEETS.AKTIVITAS_HARIAN, idx + 1); // +1 karena 1-indexed sheet
    await this._incrementAktivitasCount(agenId, -1);
  }

  /**
   * Increment / decrement Aktivitas_Count di AGENTS sheet.
   */
  async _incrementAktivitasCount(agen_id, delta) {
    try {
      const result = await sheetsService.findRowById(SHEETS.AGENTS, agen_id);
      if (!result) return;
      const { data: agentRow, rowIndex } = result;
      const colIdx = COLUMNS.AGENTS.indexOf('Aktivitas_Count');
      if (colIdx < 0) return;
      const current   = parseInt(agentRow[colIdx] || '0', 10) || 0;
      const newCount  = Math.max(0, current + delta);
      agentRow[colIdx] = String(newCount);
      await sheetsService.updateRow(SHEETS.AGENTS, rowIndex, agentRow);
    } catch (e) {
      console.warn('[AktivitasService] Gagal update Aktivitas_Count:', e.message);
    }
  }
}

module.exports = new AktivitasService();
