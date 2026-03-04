/**
 * WhatsAppService - Komunikasi CRM
 * ============================================
 * Single message & semi-broadcast dengan antrean.
 * Antrean disimpan ke Google Sheets (WA_QUEUE tab).
 */

const axios = require('axios');
const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { v4: uuidv4 } = require('uuid');

class WhatsAppService {
  constructor() {
    this.apiUrl = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
    this.headers = {
      'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Send Single Message ───────────────────────────────────
  async sendSingle(leadId, noWa, pesan, agentId) {
    const queueId = await this._addToQueue({
      leadId, noWa, pesan, tipe: 'Single', agentId
    });

    try {
      const res = await axios.post(this.apiUrl, {
        messaging_product: 'whatsapp',
        to: this._formatNumber(noWa),
        type: 'text',
        text: { body: pesan }
      }, { headers: this.headers });

      await this._updateQueueStatus(queueId, 'Sent');
      return { success: true, message_id: res.data.messages?.[0]?.id, queue_id: queueId };

    } catch (error) {
      await this._updateQueueStatus(queueId, 'Failed', error.message);
      throw error;
    }
  }

  // ── Semi-Broadcast (Antrean dengan delay) ────────────────
  async sendBroadcast(leads, pesanTemplate, agentId, delayMs = 3000) {
    const results = [];

    for (const lead of leads) {
      const pesan = this._interpolate(pesanTemplate, lead);
      const queueId = await this._addToQueue({
        leadId: lead.ID,
        noWa: lead.No_WA,
        pesan,
        tipe: 'Broadcast',
        agentId,
      });
      results.push({ lead_id: lead.ID, queue_id: queueId, status: 'Queued' });
    }

    // Process queue dengan delay (non-blocking)
    this._processQueue(results, delayMs);

    return {
      total: leads.length,
      queued: results.length,
      message: `${leads.length} pesan masuk antrean. Proses pengiriman dimulai.`,
      queue_ids: results.map(r => r.queue_id),
    };
  }

  // ── Generate WA Link (fallback manual) ───────────────────
  generateWaLink(noWa, pesan) {
    const number = this._formatNumber(noWa);
    const encoded = encodeURIComponent(pesan);
    return `https://wa.me/${number}?text=${encoded}`;
  }

  // ── Private: Process queue async ─────────────────────────
  async _processQueue(items, delayMs) {
    for (const item of items) {
      try {
        const queueEntry = await sheetsService.findRowById(SHEETS.WA_QUEUE, item.queue_id);
        if (!queueEntry) continue;

        const data = queueEntry.data;
        const noWa = data[4]; // Column E: No_WA
        const pesan = data[5]; // Column F: Pesan

        await axios.post(this.apiUrl, {
          messaging_product: 'whatsapp',
          to: this._formatNumber(noWa),
          type: 'text',
          text: { body: pesan }
        }, { headers: this.headers });

        await this._updateQueueStatus(item.queue_id, 'Sent');

      } catch (error) {
        await this._updateQueueStatus(item.queue_id, 'Failed', error.message);
      }

      // Delay antar pesan untuk hindari rate limiting
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // ── Private: Add to queue ─────────────────────────────────
  async _addToQueue({ leadId, noWa, pesan, tipe, agentId }) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const row = [
      id, now, leadId, '', noWa, pesan, tipe,
      'Pending', '', '', agentId, '',
    ];

    await sheetsService.appendRow(SHEETS.WA_QUEUE, row);
    return id;
  }

  // ── Private: Update queue status ─────────────────────────
  async _updateQueueStatus(id, status, errorLog = '') {
    const result = await sheetsService.findRowById(SHEETS.WA_QUEUE, id);
    if (!result) return;

    const row = result.data;
    row[7] = status;               // Column H: Status
    row[9] = new Date().toISOString(); // Column J: Sent_At
    row[11] = errorLog;            // Column L: Error_Log

    await sheetsService.updateRow(SHEETS.WA_QUEUE, result.rowIndex, row);
  }

  // ── Private Helpers ───────────────────────────────────────
  _formatNumber(no) {
    let num = no.replace(/\D/g, '');
    if (num.startsWith('0')) num = '62' + num.slice(1);
    return num;
  }

  _interpolate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
  }
}

module.exports = new WhatsAppService();
