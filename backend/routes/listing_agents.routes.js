/**
 * Listing Agents Routes (Co-Ownership)
 * Base: /api/v1/listing-agents
 * ============================================
 * Mengelola relasi Owner & Co-Own antara Listing dan Agen.
 * Co-Own HANYA bisa terjadi melalui jalur duplicate detection
 * (agen pilih "Gabung ke Listing Ini" di modal kembar).
 *
 * Endpoint:
 *  POST   /check-duplicate           → Cek kembar sebelum simpan listing
 *  POST   /:listingId/join           → Gabung sebagai Co-Own (dari hasil duplicate)
 *  GET    /:listingId/agents         → Daftar semua Owner & Co-Own listing ini
 *  PATCH  /:listingId/transfer-owner → Ganti Owner (Principal/Superadmin only)
 *  DELETE /:listingId/co-own/:agenId → Hapus Co-Own dari listing (Principal only)
 *  GET    /orphaned                  → Listing dengan Owner Nonaktif (Principal only)
 *  GET    /duplicate-clusters        → Audit semua listing kembar (Principal only)
 */

const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const sheetsService   = require('../services/sheets.service');
const duplicateService = require('../services/duplicate.service');
const { createNotification } = require('./notifications.routes');
const { SHEETS, COLUMNS }    = require('../config/sheets.config');

router.use(authMiddleware);

// ── Helpers ────────────────────────────────────────────────────────────────

function rowToObj(row) {
  return COLUMNS.LISTING_AGENTS.reduce((obj, col, i) => {
    obj[col] = row[i] || '';
    return obj;
  }, {});
}

function buildRow(obj) {
  return COLUMNS.LISTING_AGENTS.map(col => obj[col] || '');
}

async function getListingAgentRows() {
  const rows = await sheetsService.getRange(SHEETS.LISTING_AGENTS);
  if (!rows || rows.length <= 1) return [];
  const [, ...data] = rows;
  return data.map(rowToObj);
}

async function getListingById(listingId) {
  const result = await sheetsService.findRowById(SHEETS.LISTING, listingId);
  if (!result) return null;
  return COLUMNS.LISTING.reduce((obj, col, i) => {
    obj[col] = result.data[i] || '';
    return obj;
  }, {});
}

async function getAgentById(agentId) {
  const result = await sheetsService.findRowById(SHEETS.AGENTS, agentId);
  if (!result) return null;
  return COLUMNS.AGENTS.reduce((obj, col, i) => {
    obj[col] = result.data[i] || '';
    return obj;
  }, {});
}

// Kirim notif ke semua Co-Own suatu listing
async function notifyCoOwns(listingId, tipe, judul, pesan, fromUserId, fromUserNama) {
  try {
    const laRows = await getListingAgentRows();
    const coOwns = laRows.filter(r => r.Listing_ID === listingId && r.Role === 'co_own');
    for (const co of coOwns) {
      await createNotification({
        tipe,
        judul,
        pesan,
        from_user_id:   fromUserId,
        from_user_nama: fromUserNama,
        to_user_id:     co.Agen_ID,
        link_type:      'listing',
        link_id:        listingId,
      });
    }
  } catch (e) {
    console.error('[NOTIF CO-OWN ERROR]', e.message);
  }
}

// ── 1. POST /check-duplicate ───────────────────────────────────────────────
// Dipanggil SEBELUM submit form listing baru.
// Frontend intercept submit → cek dulu → jika ada kembar tampilkan modal.
router.post('/check-duplicate', async (req, res) => {
  try {
    const {
      Kecamatan, Kota, Alamat,
      Luas_Tanah, Luas_Bangunan,
      Harga, Kamar_Tidur,
    } = req.body;

    if (!Kecamatan || !Kota) {
      return res.json({ success: true, duplicates: [], message: 'Kecamatan/Kota wajib diisi untuk cek duplikat' });
    }

    const duplicates = await duplicateService.check(
      { Kecamatan, Kota, Alamat, Luas_Tanah, Luas_Bangunan, Harga, Kamar_Tidur },
      req.user.id
    );

    res.json({
      success:    true,
      duplicates,
      threshold:  80,
      count:      duplicates.length,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── 2. POST /:listingId/join ───────────────────────────────────────────────
// Agen bergabung sebagai Co-Own ke listing yang sudah ada (dari hasil cek kembar).
// Agen yang join tidak perlu buat listing baru — cukup masuk junction table.
router.post('/:listingId/join', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { id: agenId, nama: agenNama, role } = req.user;

    // Hanya agen & koordinator yang bisa join sebagai co-own
    if (!['agen', 'koordinator'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Hanya agen yang bisa join sebagai Co-Own' });
    }

    // Cek listing ada
    const listing = await getListingById(listingId);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });

    // Cek apakah agen sudah terdaftar di listing ini
    const laRows = await getListingAgentRows();
    const alreadyIn = laRows.find(r => r.Listing_ID === listingId && r.Agen_ID === agenId);
    if (alreadyIn) {
      return res.status(409).json({
        success: false,
        message: `Anda sudah terdaftar di listing ini sebagai ${alreadyIn.Role === 'owner' ? 'Owner' : 'Co-Own'}`,
      });
    }

    // Cek apakah agen adalah owner listing (via Agen_ID di LISTING sheet)
    if (listing.Agen_ID === agenId) {
      return res.status(409).json({ success: false, message: 'Anda adalah Owner listing ini' });
    }

    // Insert Co-Own ke LISTING_AGENTS
    const now = new Date().toISOString();
    const newRow = buildRow({
      ID:         uuidv4(),
      Listing_ID: listingId,
      Agen_ID:    agenId,
      Agen_Nama:  agenNama,
      Role:       'co_own',
      Joined_At:  now,
      Added_By:   'system',
      Notes:      `Join via duplicate detection`,
    });
    await sheetsService.appendRow(SHEETS.LISTING_AGENTS, newRow);

    // Notif ke Owner listing
    await createNotification({
      tipe:           'co_own_joined',
      judul:          'Co-Own Bergabung',
      pesan:          `Agen ${agenNama} bergabung sebagai Co-Own di listing ${listing.Kode_Listing} (${listing.Judul})`,
      from_user_id:   agenId,
      from_user_nama: agenNama,
      to_user_id:     listing.Agen_ID,
      link_type:      'listing',
      link_id:        listingId,
    });

    res.status(201).json({
      success: true,
      message: `Berhasil bergabung sebagai Co-Own di listing ${listing.Kode_Listing}`,
      data: {
        listing_id:   listingId,
        kode:         listing.Kode_Listing,
        judul:        listing.Judul,
        owner_nama:   listing.Agen_Nama,
        co_own_nama:  agenNama,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── 3. GET /:listingId/agents ──────────────────────────────────────────────
// Lihat semua Owner & Co-Own untuk listing tertentu.
router.get('/:listingId/agents', async (req, res) => {
  try {
    const { listingId } = req.params;
    const listing = await getListingById(listingId);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });

    const laRows = await getListingAgentRows();
    const coOwns = laRows.filter(r => r.Listing_ID === listingId && r.Role === 'co_own');

    res.json({
      success: true,
      data: {
        listing_id:  listingId,
        kode:        listing.Kode_Listing,
        owner: {
          agen_id:   listing.Agen_ID,
          agen_nama: listing.Agen_Nama,
          role:      'owner',
        },
        co_owns: coOwns.map(r => ({
          agen_id:   r.Agen_ID,
          agen_nama: r.Agen_Nama,
          joined_at: r.Joined_At,
          added_by:  r.Added_By,
        })),
        total_agents: 1 + coOwns.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── 4. PATCH /:listingId/transfer-owner ───────────────────────────────────
// Ganti Owner listing (Principal/Superadmin only).
// Bisa dipicu: (a) manual oleh Principal, atau (b) saat agen Owner di-Nonaktifkan.
router.patch('/:listingId/transfer-owner',
  requireRole(['principal', 'superadmin', 'admin']),
  async (req, res) => {
    try {
      const { listingId } = req.params;
      const { new_owner_id, notes = '' } = req.body;

      if (!new_owner_id) {
        return res.status(400).json({ success: false, message: 'new_owner_id wajib diisi' });
      }

      const listing  = await getListingById(listingId);
      if (!listing) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });

      const newOwner = await getAgentById(new_owner_id);
      if (!newOwner) return res.status(404).json({ success: false, message: 'Agen baru tidak ditemukan' });

      const oldOwnerId   = listing.Agen_ID;
      const oldOwnerNama = listing.Agen_Nama;
      const now          = new Date().toISOString();

      // ── Update LISTING sheet: Agen_ID & Agen_Nama ──────────────────────
      const listingResult = await sheetsService.findRowById(SHEETS.LISTING, listingId);
      const listingObj    = COLUMNS.LISTING.reduce((obj, col, i) => {
        obj[col] = listingResult.data[i] || ''; return obj;
      }, {});
      listingObj.Agen_ID   = new_owner_id;
      listingObj.Agen_Nama = newOwner.Nama;
      listingObj.Updated_At = now;
      const updatedListingRow = COLUMNS.LISTING.map(col => listingObj[col] || '');
      await sheetsService.updateRow(SHEETS.LISTING, listingResult.rowIndex, updatedListingRow);

      // ── Update LISTING_AGENTS: owner lama → co_own, owner baru → owner ──
      const laRows = await getListingAgentRows();

      // Turunkan owner lama ke co_own (jika ada di junction table)
      const oldOwnerRow = laRows.find(r => r.Listing_ID === listingId && r.Agen_ID === oldOwnerId && r.Role === 'owner');
      if (oldOwnerRow) {
        const allRows = await sheetsService.getRange(SHEETS.LISTING_AGENTS);
        const rowIdx  = allRows.findIndex(r => r[0] === oldOwnerRow.ID);
        if (rowIdx !== -1) {
          const updated = { ...oldOwnerRow, Role: 'co_own', Notes: `Downgraded by ${req.user.nama} on ${now}` };
          await sheetsService.updateRow(SHEETS.LISTING_AGENTS, rowIdx + 1, buildRow(updated));
        }
      }

      // Upgrade new owner dari co_own → owner (atau insert baru jika belum ada)
      const newOwnerRow = laRows.find(r => r.Listing_ID === listingId && r.Agen_ID === new_owner_id);
      if (newOwnerRow) {
        const allRows = await sheetsService.getRange(SHEETS.LISTING_AGENTS);
        const rowIdx  = allRows.findIndex(r => r[0] === newOwnerRow.ID);
        if (rowIdx !== -1) {
          const updated = { ...newOwnerRow, Role: 'owner', Notes: `Promoted by ${req.user.nama} on ${now}` };
          await sheetsService.updateRow(SHEETS.LISTING_AGENTS, rowIdx + 1, buildRow(updated));
        }
      } else {
        // Insert owner baru ke junction table
        await sheetsService.appendRow(SHEETS.LISTING_AGENTS, buildRow({
          ID:         uuidv4(),
          Listing_ID: listingId,
          Agen_ID:    new_owner_id,
          Agen_Nama:  newOwner.Nama,
          Role:       'owner',
          Joined_At:  now,
          Added_By:   req.user.id,
          Notes:      notes || `Transfer owner oleh ${req.user.nama}`,
        }));
      }

      // ── Notif ke Owner lama, Owner baru, dan semua Co-Own ───────────────
      const pesan = `Owner listing ${listing.Kode_Listing} (${listing.Judul}) telah dialihkan dari ${oldOwnerNama} ke ${newOwner.Nama} oleh ${req.user.nama}`;
      const fromId   = req.user.id;
      const fromNama = req.user.nama;

      if (oldOwnerId && oldOwnerId !== new_owner_id) {
        await createNotification({ tipe: 'owner_changed', judul: 'Owner Listing Diubah', pesan, from_user_id: fromId, from_user_nama: fromNama, to_user_id: oldOwnerId,  link_type: 'listing', link_id: listingId });
      }
      await createNotification({ tipe: 'owner_changed', judul: 'Anda Menjadi Owner Listing', pesan, from_user_id: fromId, from_user_nama: fromNama, to_user_id: new_owner_id, link_type: 'listing', link_id: listingId });
      await notifyCoOwns(listingId, 'owner_changed', 'Owner Listing Diubah', pesan, fromId, fromNama);

      res.json({
        success: true,
        message: `Owner listing ${listing.Kode_Listing} berhasil dialihkan ke ${newOwner.Nama}`,
        data: {
          listing_id:    listingId,
          kode:          listing.Kode_Listing,
          old_owner:     { id: oldOwnerId, nama: oldOwnerNama },
          new_owner:     { id: new_owner_id, nama: newOwner.Nama },
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
);

// ── 5. DELETE /:listingId/co-own/:agenId ──────────────────────────────────
// Hapus Co-Own dari listing (Principal/Superadmin atau Owner listing sendiri).
router.delete('/:listingId/co-own/:agenId',
  requireRole(['principal', 'superadmin', 'admin', 'agen']),
  async (req, res) => {
    try {
      const { listingId, agenId } = req.params;
      const { role, id: requesterId, nama: requesterNama } = req.user;

      const listing = await getListingById(listingId);
      if (!listing) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });

      // Jika role agen: hanya Owner listing yang boleh hapus co-own orang lain
      // atau agen itu sendiri yang resign dari co-own
      if (role === 'agen' && listing.Agen_ID !== requesterId && requesterId !== agenId) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Cari row di LISTING_AGENTS
      const allRows = await sheetsService.getRange(SHEETS.LISTING_AGENTS);
      const laObjs  = allRows.slice(1).map(rowToObj);
      const target  = laObjs.find(r => r.Listing_ID === listingId && r.Agen_ID === agenId && r.Role === 'co_own');

      if (!target) {
        return res.status(404).json({ success: false, message: 'Co-Own tidak ditemukan di listing ini' });
      }

      const rowIdx = allRows.findIndex(r => r[0] === target.ID);
      if (rowIdx !== -1) {
        await sheetsService.deleteRow(SHEETS.LISTING_AGENTS, rowIdx + 1);
      }

      // Notif ke co-own yang dihapus
      await createNotification({
        tipe:           'co_own_removed',
        judul:          'Anda Dihapus dari Co-Own',
        pesan:          `Anda telah dihapus dari Co-Own listing ${listing.Kode_Listing} (${listing.Judul}) oleh ${requesterNama}`,
        from_user_id:   requesterId,
        from_user_nama: requesterNama,
        to_user_id:     agenId,
        link_type:      'listing',
        link_id:        listingId,
      });

      res.json({ success: true, message: 'Co-Own berhasil dihapus dari listing' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
);

// ── 6. GET /orphaned ──────────────────────────────────────────────────────
// Listing Aktif yang Owner-nya sudah Nonaktif (perlu reassign).
router.get('/orphaned',
  requireRole(['principal', 'superadmin', 'admin']),
  async (req, res) => {
    try {
      // Load agents & listings
      const [agentRows, listingRows, laRows] = await Promise.all([
        sheetsService.getRange(SHEETS.AGENTS),
        sheetsService.getRange(SHEETS.LISTING),
        getListingAgentRows(),
      ]);

      // Map agen nonaktif
      const nonaktifAgents = new Set(
        agentRows.slice(1)
          .map(r => COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = r[i] || ''; return obj; }, {}))
          .filter(a => a.Status === 'Nonaktif')
          .map(a => a.ID)
      );

      const orphaned = listingRows.slice(1)
        .map(r => COLUMNS.LISTING.reduce((obj, col, i) => { obj[col] = r[i] || ''; return obj; }, {}))
        .filter(l => l.Status_Listing === 'Aktif' && nonaktifAgents.has(l.Agen_ID))
        .map(l => {
          const coOwns = laRows
            .filter(r => r.Listing_ID === l.ID && r.Role === 'co_own')
            .map(r => ({ agen_id: r.Agen_ID, agen_nama: r.Agen_Nama, joined_at: r.Joined_At }));
          return {
            id:          l.ID,
            kode:        l.Kode_Listing,
            judul:       l.Judul,
            kota:        l.Kota,
            harga:       l.Harga_Format || l.Harga,
            foto:        l.Foto_Utama_URL,
            owner_id:   l.Agen_ID,
            owner_nama:  l.Agen_Nama,
            co_owns:     coOwns,
            has_co_own:  coOwns.length > 0,
          };
        });

      res.json({
        success: true,
        data:    orphaned,
        count:   orphaned.length,
        message: orphaned.length > 0
          ? `${orphaned.length} listing perlu reassign Owner`
          : 'Tidak ada listing orphan',
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
);

// ── 7. GET /duplicate-clusters ────────────────────────────────────────────
// Audit semua listing kembar yang ada di database (untuk Principal/Admin).
router.get('/duplicate-clusters',
  requireRole(['principal', 'superadmin', 'admin']),
  async (req, res) => {
    try {
      const clusters = await duplicateService.findAllDuplicateClusters();
      res.json({
        success: true,
        data:    clusters,
        count:   clusters.length,
        message: clusters.length > 0
          ? `${clusters.length} cluster listing kembar ditemukan`
          : 'Tidak ada listing kembar terdeteksi',
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
);

module.exports = router;
// Export helper agar listings.routes.js bisa pakai notifyCoOwns
module.exports.notifyCoOwns = notifyCoOwns;
