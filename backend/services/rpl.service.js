'use strict';

const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// ── Konstanta Kalkulasi Finansial (Surabaya) ────────────────
const PPH_RATE           = 0.025;   // PPh Final 2.5%
const BPHTB_RATE         = 0.05;    // BPHTB 5%
const NOPTKP_SURABAYA    = 90_000_000;
const BUNGA_KPR          = 0.095;   // 9.5% p.a. estimasi
const TENOR_KPR_TAHUN    = 20;
const NOTARIS_RATE       = 0.006;
const NOTARIS_MIN        = 3_000_000;
const NOTARIS_MAX        = 12_000_000;
const GROSS_YIELD_EST    = 0.05;    // 5% gross yield sewa estimasi
const NET_ROI_EST        = 0.035;   // 3.5% net setelah biaya operasional
const CAPITAL_GAIN_5Y    = 0.15;    // 15% estimasi kenaikan 5 tahun

class RplService {

  async generatePortfolio(agenId, tanggalMulai, tanggalSelesai) {
    const start = new Date(tanggalMulai);
    const end   = new Date(tanggalSelesai);
    end.setHours(23, 59, 59, 999);

    const inRange = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return !isNaN(d) && d >= start && d <= end;
    };

    const fmt = (n) => n ? `Rp ${Number(n).toLocaleString('id-ID')}` : null;

    // ── Fetch semua sheet paralel ───────────────────────────
    const [
      agentRows, listingRows, listingAgentRows, leadRows,
      aktivitasRows, taskRows, shareLogRows, vigenRows,
      paJobRows, komisiRows, rentalRows, legalRows,
      paymentRows, canvasingRows, waQueueRows,
    ] = await Promise.all([
      sheetsService.getRows(SHEETS.AGENTS),
      sheetsService.getRows(SHEETS.LISTING),
      sheetsService.getRows(SHEETS.LISTING_AGENTS),
      sheetsService.getRows(SHEETS.LEADS),
      sheetsService.getRows(SHEETS.AKTIVITAS_HARIAN),
      sheetsService.getRows(SHEETS.TASKS),
      sheetsService.getRows(SHEETS.SHARE_LOG),
      sheetsService.getRows(SHEETS.VIGEN_JOBS),
      sheetsService.getRows(SHEETS.PA_JOBS),
      sheetsService.getRows(SHEETS.KOMISI_REQUEST),
      sheetsService.getRows(SHEETS.RENTAL_STATUS),
      sheetsService.getRows(SHEETS.LEGAL_DOCS),
      sheetsService.getRows(SHEETS.PAYMENT_STAGES),
      sheetsService.getRows(SHEETS.CANVASING),
      sheetsService.getRows(SHEETS.WA_QUEUE),
    ]);

    // ── Helper: row array → object ──────────────────────────
    const toObj = (cols, row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? '']));
    const idx   = (cols, name) => cols.indexOf(name);

    // ── Resolusi agent ──────────────────────────────────────
    const aC = COLUMNS.AGENTS;
    const agentRow = agentRows.find(r => r[idx(aC, 'ID')] === agenId);
    if (!agentRow) throw new Error(`Agen ID "${agenId}" tidak ditemukan`);
    const agent = toObj(aC, agentRow);

    // ── Listing IDs milik agen (owner + co_own) ─────────────
    const laC = COLUMNS.LISTING_AGENTS;
    const coOwnIds = new Set(
      listingAgentRows
        .filter(r => r[idx(laC, 'Agen_ID')] === agenId)
        .map(r => r[idx(laC, 'Listing_ID')])
    );

    const lC = COLUMNS.LISTING;
    const myListings = listingRows
      .filter(r => r[idx(lC, 'Agen_ID')] === agenId || coOwnIds.has(r[idx(lC, 'ID')]))
      .map(r => toObj(lC, r));

    const myListingIds = new Set(myListings.map(l => l.ID));
    const listingsInPeriod = myListings.filter(l => inRange(l.Tanggal_Input || l.Created_At));

    // ── Leads agen di periode ───────────────────────────────
    const ldc = COLUMNS.LEADS;
    const myLeads = leadRows
      .filter(r => r[idx(ldc, 'Agen_ID')] === agenId && inRange(r[idx(ldc, 'Tanggal')]))
      .map(r => toObj(ldc, r));

    // Semua deal (tidak terbatas periode, untuk kelengkapan bukti transaksi)
    const myDeals = leadRows
      .filter(r => r[idx(ldc, 'Agen_ID')] === agenId && r[idx(ldc, 'Status_Lead')] === 'Deal')
      .map(r => toObj(ldc, r));
    const myDealIds = new Set(myDeals.map(l => l.ID));

    // ── Aktivitas Harian ────────────────────────────────────
    const ahC = COLUMNS.AKTIVITAS_HARIAN;
    const myAktivitas = aktivitasRows
      .filter(r => r[idx(ahC, 'Agen_ID')] === agenId && inRange(r[idx(ahC, 'Tanggal')]))
      .map(r => toObj(ahC, r));

    // ── Tasks ───────────────────────────────────────────────
    const tC = COLUMNS.TASKS;
    const myTasks = taskRows
      .filter(r => r[idx(tC, 'Agen_ID')] === agenId && inRange(r[idx(tC, 'Scheduled_At')]))
      .map(r => toObj(tC, r));

    const myViewing  = myTasks.filter(t => t.Tipe === 'visit');
    const myMeeting  = myTasks.filter(t => t.Tipe === 'meeting');
    const myFU       = myTasks.filter(t => t.Tipe === 'follow-up' || t.Tipe === 'call');

    // ── Share Log ───────────────────────────────────────────
    const slC = COLUMNS.SHARE_LOG;
    const myShareLog = shareLogRows
      .filter(r => r[idx(slC, 'Agen_ID')] === agenId && inRange(r[idx(slC, 'Timestamp')]))
      .map(r => toObj(slC, r));

    // ── ViGen Jobs ──────────────────────────────────────────
    const vC = COLUMNS.VIGEN_JOBS;
    const myVigen = vigenRows
      .filter(r =>
        (myListingIds.has(r[idx(vC, 'Listing_ID')]) || r[idx(vC, 'Requested_By')] === agenId) &&
        inRange(r[idx(vC, 'Created_At')])
      )
      .map(r => toObj(vC, r));

    // ── PA Jobs ─────────────────────────────────────────────
    const pjC = COLUMNS.PA_JOBS;
    const myPaJobs = paJobRows
      .filter(r => r[idx(pjC, 'Agen_ID')] === agenId && inRange(r[idx(pjC, 'Created_At')]))
      .map(r => toObj(pjC, r));

    // ── Komisi ──────────────────────────────────────────────
    const kC = COLUMNS.KOMISI_REQUEST;
    const myKomisi = komisiRows
      .filter(r => r[idx(kC, 'Agen_ID')] === agenId && inRange(r[idx(kC, 'Tanggal')]))
      .map(r => toObj(kC, r));

    // ── Rental ──────────────────────────────────────────────
    const rC = COLUMNS.RENTAL_STATUS;
    const myRental = rentalRows
      .filter(r =>
        r[idx(rC, 'Agen_ID')] === agenId ||
        r[idx(rC, 'Agen_Selling_ID')] === agenId
      )
      .map(r => toObj(rC, r));

    // ── Legal Docs ──────────────────────────────────────────
    const ldC = COLUMNS.LEGAL_DOCS;
    const myLegal = legalRows
      .filter(r => r[idx(ldC, 'Agen_ID')] === agenId && inRange(r[idx(ldC, 'Created_At')]))
      .map(r => toObj(ldC, r));

    // ── Payment Stages (untuk deal agen) ────────────────────
    const psC = COLUMNS.PAYMENT_STAGES;
    const myPayments = paymentRows
      .filter(r => myDealIds.has(r[idx(psC, 'Lead_ID')]))
      .map(r => toObj(psC, r));

    // ── Canvasing ───────────────────────────────────────────
    const cvC = COLUMNS.CANVASING;
    const myCanvasing = canvasingRows
      .filter(r => r[idx(cvC, 'Agen_ID')] === agenId && inRange(r[idx(cvC, 'Tanggal_Canvasing')]))
      .map(r => toObj(cvC, r));

    // ── WA Terkirim (bukti follow-up) ───────────────────────
    const wqC = COLUMNS.WA_QUEUE;
    const myWaSent = waQueueRows
      .filter(r =>
        r[idx(wqC, 'Agen_ID')] === agenId &&
        r[idx(wqC, 'Status')] === 'sent' &&
        inRange(r[idx(wqC, 'Sent_At')])
      )
      .map(r => toObj(wqC, r));

    // ═══════════════════════════════════════════════════════
    // UNIT 1 — KELOLA LISTING
    // ═══════════════════════════════════════════════════════
    const statusCount = (status) => myListings.filter(l => l.Status_Listing === status).length;
    const hasVideo    = (listingId) => myVigen.some(v => v.Listing_ID === listingId && v.Status === 'done');

    const unit1 = {
      label:      'SKKNI Unit 4, 10, 11 & Akselerasi L.68BPR20.009.2',
      keterangan: 'Kemampuan Mengelola Data Listing Properti',
      ringkasan: {
        total_listing_portfolio:    myListings.length,
        listing_ditambah_periode:   listingsInPeriod.length,
        listing_aktif:              statusCount('Aktif'),
        listing_terjual:            statusCount('Terjual'),
        listing_tersewa:            statusCount('Tersewa'),
        listing_nonaktif:           statusCount('Nonaktif'),
        listing_co_own:             myListings.filter(l => coOwnIds.has(l.ID) && l.Agen_ID !== agenId).length,
        listing_dengan_foto:        myListings.filter(l => l.Foto_Utama_URL).length,
        listing_dengan_video_vigen: myListings.filter(l => hasVideo(l.ID)).length,
        listing_tayang_web:         myListings.filter(l => l.Tampilkan_di_Web === 'TRUE').length,
      },
      records: myListings.map(l => ({
        kode:             l.Kode_Listing,
        nama:             l.Judul || `${l.Tipe_Properti} ${l.Kecamatan}`.trim(),
        tipe_properti:    l.Tipe_Properti,
        status_transaksi: l.Status_Transaksi,
        status_listing:   l.Status_Listing,
        tanggal_input:    l.Tanggal_Input,
        alamat_lengkap:   [l.Alamat, l.Kecamatan, l.Kota, l.Provinsi].filter(Boolean).join(', '),
        spesifikasi: {
          luas_tanah:    l.Luas_Tanah    ? `${l.Luas_Tanah} m²`    : null,
          luas_bangunan: l.Luas_Bangunan ? `${l.Luas_Bangunan} m²` : null,
          kamar_tidur:   l.Kamar_Tidur   || null,
          kamar_mandi:   l.Kamar_Mandi   || null,
          lantai:        l.Lantai        || null,
          garasi:        l.Garasi        || null,
          sertifikat:    l.Sertifikat    || null,
        },
        harga_net:    l.Harga ? Number(l.Harga) : null,
        harga_format: l.Harga_Format || null,
        foto_count:   [l.Foto_Utama_URL, l.Foto_2_URL, l.Foto_3_URL].filter(Boolean).length,
        foto_utama:   l.Foto_Utama_URL || null,
        has_video:    hasVideo(l.ID),
        tayang_web:   l.Tampilkan_di_Web === 'TRUE',
        nama_pemilik: l.Nama_Pemilik || null,
        co_own:       coOwnIds.has(l.ID) && l.Agen_ID !== agenId,
        dalam_periode: inRange(l.Tanggal_Input || l.Created_At),
      })),
    };

    // ═══════════════════════════════════════════════════════
    // UNIT 2 — AKTIVITAS HARIAN & PROSPEKSI
    // ═══════════════════════════════════════════════════════
    const sopCompliant = myAktivitas.filter(a => {
      if (!a.Created_At) return false;
      const jam = new Date(a.Created_At).getHours();
      return jam >= 16 && jam <= 21;
    });
    const hariAktifSet = new Set(myAktivitas.map(a => a.Tanggal));

    const unit2 = {
      label:      'SKKNI Unit 7, 8, 13 & Akselerasi L.68BPR20.012.2',
      keterangan: 'Aktivitas Harian, Prospeksi & Kegiatan Lapangan',
      ringkasan: {
        total_hari_aktif:      hariAktifSet.size,
        input_dalam_sop_1621:  sopCompliant.length,
        pct_sop_compliance:    hariAktifSet.size > 0
          ? `${Math.round((sopCompliant.length / hariAktifSet.size) * 100)}%`
          : '0%',
        total_leads_baru:      myLeads.length,
        total_viewing:         myViewing.length,
        total_meeting:         myMeeting.length,
        total_fu_tasks:        myFU.length,
        total_wa_terkirim:     myWaSent.length,
        total_canvasing:       myCanvasing.length,
        canvasing_converted:   myCanvasing.filter(c => c.Status === 'Converted').length,
      },
      aktivitas_harian: myAktivitas.map(a => {
        const jamInput = a.Created_At
          ? new Date(a.Created_At).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
          : null;
        const jam = a.Created_At ? new Date(a.Created_At).getHours() : null;
        return {
          tanggal:          a.Tanggal,
          deskripsi:        a.Deskripsi,
          jam_input:        jamInput,
          sop_compliant:    jam !== null && jam >= 16 && jam <= 21,
        };
      }),
      leads_baru: myLeads.map(l => ({
        tanggal:    l.Tanggal,
        nama:       l.Nama,
        sumber:     l.Sumber || '-',
        tipe:       l.Minat_Tipe || l.Tipe_Properti || '-',
        budget_max: l.Budget_Max ? fmt(l.Budget_Max) : '-',
        status:     l.Status_Lead,
      })),
      tasks_viewing: myViewing.map(t => ({
        tanggal:      t.Scheduled_At,
        lead_nama:    t.Lead_Nama || '-',
        listing_kode: t.Listing_Kode || '-',
        lokasi:       t.Lokasi || '-',
        outcome:      t.Outcome || '-',
        status:       t.Status,
      })),
      tasks_meeting: myMeeting.map(t => ({
        tanggal:     t.Scheduled_At,
        lead_nama:   t.Lead_Nama || '-',
        catatan:     t.Catatan_Post || t.Catatan_Pre || '-',
        outcome:     t.Outcome || '-',
      })),
      canvasing: myCanvasing.map(c => ({
        tanggal:       c.Tanggal_Canvasing,
        alamat:        c.Alamat,
        tipe_properti: c.Tipe_Properti,
        hasil:         c.Hasil,
        status:        c.Status,
        converted:     c.Status === 'Converted',
      })),
    };

    // ═══════════════════════════════════════════════════════
    // UNIT 3 — KALKULATOR FINANSIAL & INVESTASI
    // ═══════════════════════════════════════════════════════
    const kprCicilan = (pokok) => {
      const r = BUNGA_KPR / 12;
      const n = TENOR_KPR_TAHUN * 12;
      return Math.round(pokok * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
    };
    const notarisFee = (harga) =>
      Math.round(Math.min(Math.max(harga * NOTARIS_RATE, NOTARIS_MIN), NOTARIS_MAX));

    const listingsWithHarga = myListings.filter(l => l.Harga && Number(l.Harga) > 0);

    const vendorNetSheet = listingsWithHarga.map(l => {
      const harga  = Number(l.Harga);
      const pph    = Math.round(harga * PPH_RATE);
      const ntrs   = notarisFee(harga);
      return {
        kode_listing:       l.Kode_Listing,
        nama_listing:       l.Judul || `${l.Tipe_Properti} ${l.Kecamatan}`.trim(),
        harga_jual:         harga,
        harga_jual_format:  l.Harga_Format || fmt(harga),
        pph_final_25pct:    pph,
        pph_format:         fmt(pph),
        estimasi_notaris:   ntrs,
        notaris_format:     fmt(ntrs),
        net_income_penjual: harga - pph - ntrs,
        net_income_format:  fmt(harga - pph - ntrs),
      };
    });

    const buyerAcquisition = listingsWithHarga
      .filter(l => l.Status_Transaksi !== 'Sewa')
      .map(l => {
        const harga      = Number(l.Harga);
        const njop       = Math.round(harga * 0.9);
        const dasarBphtb = Math.max(0, njop - NOPTKP_SURABAYA);
        const bphtb      = Math.round(dasarBphtb * BPHTB_RATE);
        const dp         = Math.round(harga * 0.2);
        const pokok      = harga - dp;
        const cicilan    = kprCicilan(pokok);
        const ntrs       = notarisFee(harga);
        return {
          kode_listing:        l.Kode_Listing,
          nama_listing:        l.Judul || `${l.Tipe_Properti} ${l.Kecamatan}`.trim(),
          harga_beli:          harga,
          harga_beli_format:   l.Harga_Format || fmt(harga),
          bphtb_surabaya: {
            njop_estimasi:    njop,
            noptkp:           NOPTKP_SURABAYA,
            dasar_pengenaan:  dasarBphtb,
            bphtb_terutang:   bphtb,
            bphtb_format:     fmt(bphtb),
          },
          estimasi_kpr: {
            dp_20pct:         dp,
            dp_format:        fmt(dp),
            pokok_pinjaman:   pokok,
            bunga_per_tahun:  `${(BUNGA_KPR * 100).toFixed(1)}%`,
            tenor_tahun:      TENOR_KPR_TAHUN,
            cicilan_per_bulan: cicilan,
            cicilan_format:   fmt(cicilan),
          },
          estimasi_notaris_buyer: ntrs,
          cash_required:     dp + bphtb + ntrs,
          cash_required_format: fmt(dp + bphtb + ntrs),
        };
      });

    const investasiProperti = listingsWithHarga.map(l => {
      const harga          = Number(l.Harga);
      const sewaTahunan    = Math.round(harga * GROSS_YIELD_EST);
      const netAnnual      = Math.round(harga * NET_ROI_EST);
      const capitalGain5y  = Math.round(harga * CAPITAL_GAIN_5Y);
      return {
        kode_listing:              l.Kode_Listing,
        nama_listing:              l.Judul || `${l.Tipe_Properti} ${l.Kecamatan}`.trim(),
        harga_beli:                harga,
        estimasi_sewa_per_tahun:   sewaTahunan,
        estimasi_sewa_format:      `${fmt(sewaTahunan)}/tahun`,
        gross_yield:               `${(GROSS_YIELD_EST * 100).toFixed(1)}%`,
        net_roi_estimasi:          `${(NET_ROI_EST * 100).toFixed(1)}%`,
        net_income_tahunan:        netAnnual,
        estimasi_capital_gain_5th: `${(CAPITAL_GAIN_5Y * 100).toFixed(0)}%`,
        capital_gain_nominal:      capitalGain5y,
        capital_gain_format:       fmt(capitalGain5y),
        catatan: 'Estimasi berdasarkan rata-rata pasar properti Surabaya',
      };
    });

    const unit3 = {
      label:      'SKKNI Unit 15, 16 & Akselerasi L.68BPR20.008.2',
      keterangan: 'Kalkulasi Finansial & Investasi Properti',
      metodologi: {
        pph_final:      'PPh Final 2.5% dari harga jual (PP 34/2016)',
        bphtb:          'BPHTB = (NJOP - NOPTKP Rp 90.000.000) × 5% (Surabaya)',
        notaris:        'Biaya notaris 0.6% dari harga, min Rp 3 jt, max Rp 12 jt',
        kpr:            `Estimasi KPR bunga ${(BUNGA_KPR * 100).toFixed(1)}% p.a., tenor ${TENOR_KPR_TAHUN} tahun`,
        investasi:      'Gross yield 5%, Net ROI 3.5% (asumsi biaya operasional 30%), capital gain 15%/5 tahun',
      },
      ringkasan: {
        total_kalkulasi_vendor:    vendorNetSheet.length,
        total_kalkulasi_buyer:     buyerAcquisition.length,
        total_kalkulasi_investasi: investasiProperti.length,
      },
      vendor_net_sheet:   vendorNetSheet,
      buyer_acquisition:  buyerAcquisition,
      investasi_properti: investasiProperti,
    };

    // ═══════════════════════════════════════════════════════
    // UNIT 4 — PEMASARAN DIGITAL & KONTEN
    // ═══════════════════════════════════════════════════════
    const platforms = ['wa', 'wa_business', 'instagram', 'tiktok', 'facebook'];
    const sharePerPlatform = platforms.reduce((acc, p) => {
      acc[p] = myShareLog.filter(s => s.Platform === p).length;
      return acc;
    }, {});
    const listingUnikDishare = new Set(
      myShareLog.filter(s => s.Tipe_Konten === 'listing').map(s => s.Konten_ID)
    ).size;

    const unit4 = {
      label:      'SKKNI Unit 12 & Akselerasi L.68BPR20.013.2, L.68BPR20.014.2',
      keterangan: 'Pemasaran Digital, Konten & Distribusi Portal Properti',
      ringkasan: {
        total_share_konten:        myShareLog.length,
        listing_unik_dishare:      listingUnikDishare,
        memenuhi_kpi_min_5:        listingUnikDishare >= 5,
        share_per_platform:        sharePerPlatform,
        total_video_vigen_done:    myVigen.filter(v => v.Status === 'done').length,
        total_video_vigen_request: myVigen.length,
        total_pa_jobs:             myPaJobs.length,
        pa_jobs_selesai:           myPaJobs.filter(j => j.Status === 'completed').length,
      },
      share_log: myShareLog.map(s => ({
        timestamp:    s.Timestamp,
        tipe_konten:  s.Tipe_Konten,
        nama_konten:  s.Konten_Nama,
        platform:     s.Platform,
      })),
      vigen_jobs: myVigen.map(v => ({
        listing_judul:  v.Listing_Title,
        mood:           v.Mood,
        durasi:         v.Duration_Target ? `${v.Duration_Target} detik` : null,
        status:         v.Status,
        tanggal:        v.Created_At,
        video_url:      v.Video_URL || null,
      })),
      pa_jobs: myPaJobs.map(j => ({
        tipe:          j.Type,
        listing_judul: j.Listing_Title,
        status:        j.Status,
        tanggal:       j.Created_At,
      })),
    };

    // ═══════════════════════════════════════════════════════
    // UNIT 5 — TRANSAKSI & AKAD NOTARIS
    // ═══════════════════════════════════════════════════════
    const komisiEarned = myKomisi
      .filter(k => k.Status === 'Disetujui')
      .reduce((s, k) => s + (Number(k.Komisi_Nominal) || 0), 0);

    const dealsWithDetail = myDeals.map(lead => {
      const payment = myPayments.find(p => p.Lead_ID === lead.ID);
      const komisi  = myKomisi.find(k =>
        k.Agen_ID === agenId &&
        (k.Listing_ID === lead.Closing_Listing_ID || !lead.Closing_Listing_ID)
      );
      return {
        lead_id:        lead.ID,
        nama_buyer:     lead.Nama,
        tipe_transaksi: lead.Minat_Tipe || lead.Tipe_Properti || '-',
        closing_tipe:   lead.Closing_Tipe || '-',
        listing_nama:   lead.Closing_Listing_Nama || lead.Closing_Cobroke || lead.Closing_Proyek || '-',
        cobroke:        !!lead.Closing_Cobroke,
        payment_stages: payment ? {
          tanda_jadi:     !!payment.Tanda_Jadi,
          tgl_tanda_jadi: payment.Tgl_Tanda_Jadi || null,
          nominal_tj:     payment.Tanda_Jadi ? fmt(payment.Tanda_Jadi) : null,
          dp1:            !!payment.DP1,
          tgl_dp1:        payment.Tgl_DP1 || null,
          dp2:            !!payment.DP2,
          tgl_dp2:        payment.Tgl_DP2 || null,
          pelunasan:      !!payment.Pelunasan,
          tgl_pelunasan:  payment.Tgl_Pelunasan || null,
          status:         payment.Status,
        } : null,
        komisi: komisi ? {
          persen:     komisi.Komisi_Persen,
          nominal:    fmt(komisi.Komisi_Nominal),
          harga_deal: fmt(komisi.Harga_Deal),
          status:     komisi.Status,
        } : null,
      };
    });

    const unit5 = {
      label:      'SKKNI Unit 14, 17 & Akselerasi L.68BPR20.015.2, L.68BPR20.016.2',
      keterangan: 'Transaksi, Pemberkasan & Pendampingan Akad Notaris/PPAT',
      ringkasan: {
        total_deal_closed:     myDeals.length,
        total_komisi_diajukan: myKomisi.length,
        total_komisi_disetujui: myKomisi.filter(k => k.Status === 'Disetujui').length,
        total_komisi_earned:   komisiEarned,
        total_komisi_format:   fmt(komisiEarned),
        total_rental_aktif:    myRental.filter(r => r.Status === 'aktif').length,
        total_legal_docs:      myLegal.length,
        legal_per_kategori: {
          PJB:     myLegal.filter(l => l.Kategori === 'PJB').length,
          Sewa:    myLegal.filter(l => l.Kategori === 'Sewa').length,
          SPR:     myLegal.filter(l => l.Kategori === 'SPR').length,
          Lainnya: myLegal.filter(l => l.Kategori === 'Lainnya').length,
        },
      },
      deals:   dealsWithDetail,
      rental_aktif: myRental.filter(r => r.Status === 'aktif').map(r => ({
        nama_penyewa:    r.Nama_Penyewa,
        alamat_sewa:     r.Alamat_Sewa,
        tanggal_mulai:   r.Tanggal_Mulai,
        tanggal_selesai: r.Tanggal_Selesai,
        durasi_bulan:    r.Durasi_Bulan,
        cobroke:         r.CoBroke === 'TRUE',
      })),
      legal_docs: myLegal.map(l => ({
        kategori:    l.Kategori,
        nama_klien:  l.Nama_Klien,
        nama_pemilik: l.Nama_Pemilik,
        alamat_unit: l.Alamat_Unit,
        drive_url:   l.Drive_URL || null,
        tanggal:     l.Created_At,
      })),
      komisi_requests: myKomisi.map(k => ({
        tanggal:       k.Tanggal,
        listing_judul: k.Listing_Judul,
        harga_deal:    fmt(k.Harga_Deal),
        persen:        k.Komisi_Persen,
        nominal:       fmt(k.Komisi_Nominal),
        status:        k.Status,
      })),
    };

    // ═══════════════════════════════════════════════════════
    // SUMMARY SKKNI
    // ═══════════════════════════════════════════════════════
    const unitSummary = {
      unit_1: {
        nama:       'Kelola Listing',
        skkni:      'Unit 4, 10, 11',
        memenuhi:   unit1.ringkasan.total_listing_portfolio > 0,
        bukti:      unit1.ringkasan.total_listing_portfolio,
        catatan:    `${unit1.ringkasan.total_listing_portfolio} listing, ${unit1.ringkasan.listing_dengan_foto} dengan foto, ${unit1.ringkasan.listing_dengan_video_vigen} dengan video`,
      },
      unit_2: {
        nama:       'Aktivitas Harian & Prospeksi',
        skkni:      'Unit 7, 8, 13',
        memenuhi:   unit2.ringkasan.total_hari_aktif >= 10,
        bukti:      unit2.ringkasan.total_hari_aktif,
        catatan:    `${unit2.ringkasan.total_hari_aktif} hari aktif, ${unit2.ringkasan.input_dalam_sop_1621} input sesuai SOP 16-21`,
      },
      unit_3: {
        nama:       'Kalkulator Finansial & Investasi',
        skkni:      'Unit 15, 16',
        memenuhi:   unit3.ringkasan.total_kalkulasi_vendor > 0,
        bukti:      unit3.ringkasan.total_kalkulasi_vendor,
        catatan:    `${unit3.ringkasan.total_kalkulasi_vendor} kalkulasi vendor, ${unit3.ringkasan.total_kalkulasi_buyer} kalkulasi buyer`,
      },
      unit_4: {
        nama:       'Pemasaran Digital & Konten',
        skkni:      'Unit 12',
        memenuhi:   unit4.ringkasan.total_share_konten >= 5,
        bukti:      unit4.ringkasan.total_share_konten,
        catatan:    `${unit4.ringkasan.total_share_konten} share, ${unit4.ringkasan.listing_unik_dishare} listing unik, ${unit4.ringkasan.total_video_vigen_done} video done`,
      },
      unit_5: {
        nama:       'Transaksi & Akad Notaris',
        skkni:      'Unit 14, 17',
        memenuhi:   unit5.ringkasan.total_deal_closed > 0,
        bukti:      unit5.ringkasan.total_deal_closed,
        catatan:    `${unit5.ringkasan.total_deal_closed} deal, komisi ${unit5.ringkasan.total_komisi_format}`,
      },
    };

    const jmlMemenuhi = Object.values(unitSummary).filter(u => u.memenuhi).length;
    const rekomendasi = jmlMemenuhi >= 4
      ? 'Portofolio memenuhi persyaratan minimum RPL KKNI VI — siap diajukan ke LSP.'
      : jmlMemenuhi >= 3
        ? 'Portofolio cukup kuat, namun beberapa unit perlu dilengkapi sebelum pengajuan RPL.'
        : 'Portofolio membutuhkan penambahan bukti yang signifikan sebelum dapat diajukan.';

    return {
      metadata: {
        dokumen:            'Berkas Bukti Portofolio RPL KKNI VI',
        skema_sertifikasi:  'Agen Properti KKNI Level VI',
        generated_at:       new Date().toISOString(),
        agen: {
          id:          agent.ID,
          nama:        agent.Nama,
          email:       agent.Email,
          nomer_lsp:   agent.Nomer_LSP || '-',
          kantor:      agent.Nama_Kantor || '-',
          role:        agent.Role,
          join_date:   agent.Join_Date || '-',
          no_wa:       agent.No_WA || '-',
        },
        periode: {
          mulai:    tanggalMulai,
          selesai:  tanggalSelesai,
          label:    `${new Date(tanggalMulai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} s/d ${new Date(tanggalSelesai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        },
      },
      unit_1_kelola_listing:       unit1,
      unit_2_aktivitas_harian:     unit2,
      unit_3_kalkulator_finansial: unit3,
      unit_4_pemasaran_digital:    unit4,
      unit_5_transaksi:            unit5,
      summary_skkni: {
        unit_summary:  unitSummary,
        unit_memenuhi: jmlMemenuhi,
        total_unit:    5,
        rekomendasi,
      },
    };
  }
}

module.exports = new RplService();
