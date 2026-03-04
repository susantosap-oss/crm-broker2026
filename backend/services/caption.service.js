/**
 * CaptionService - Auto Caption Generator
 * Parse Deskripsi untuk ambil spesifikasi properti
 */

class CaptionService {
  generate(listing, style = 'standard') {
    const spek = this._parseSpek(listing);
    const hargaText = listing.Harga_Format || this._formatHarga(listing.Harga);
    const emoji = this._getEmoji(listing.Tipe_Properti);
    const actionWord = listing.Status_Transaksi === 'Sewa' ? 'DISEWAKAN' : 'DIJUAL';
    const hashtags = this._buildHashtags(listing);

    if (style === 'luxury')     return this._luxuryTemplate({ emoji, actionWord, hargaText, listing, spek, hashtags });
    if (style === 'investment') return this._investmentTemplate({ emoji, actionWord, hargaText, listing, spek, hashtags });
    return this._standardTemplate({ emoji, actionWord, hargaText, listing, spek, hashtags });
  }

  // Parse Deskripsi untuk ekstrak semua spek
  _parseSpek(listing) {
    const deskripsi = listing.Deskripsi || '';
    const spek = {
      lt:        listing.Luas_Tanah    || this._extract(deskripsi, /LT[:\s]+(\d+)/i) || '',
      lb:        listing.Luas_Bangunan || this._extract(deskripsi, /LB[:\s]+(\d+)/i) || '',
      kt:        listing.Kamar_Tidur   || this._extract(deskripsi, /(\d+)\s*KT/i)    || '',
      km:        listing.Kamar_Mandi   || this._extract(deskripsi, /(\d+)\s*KM/i)    || '',
      garasi:    listing.Garasi        || this._extract(deskripsi, /garasi[:\s]+([^\n,/]+)/i) || '',
      sertifikat:listing.Sertifikat    || this._extract(deskripsi, /(SHM|HGB|SHGB|AJB|Girik|Strata Title)/i) || '',
      lantai:    listing.Lantai        || this._extract(deskripsi, /(\d+)\s*[Ll]antai/i) || '',
      row:       this._extract(deskripsi, /ROW[:\s]+([^\n,/]+)/i) || '',
      hadap:     listing.Hadap         || this._extract(deskripsi, /hadap[:\s]+([^\n,/]+)/i) || '',
      furnished: this._extract(deskripsi, /(Full Furnished|Semi Furnished|Unfurnished|Non Furnished)/i) || '',
    };
    return spek;
  }

  _extract(text, regex) {
    const m = text.match(regex);
    return m ? m[1]?.trim() : null;
  }

  _buildSpekLines(spek) {
    const lines = [];
    if (spek.lt)         lines.push(`• LT          : ${spek.lt} m²`);
    if (spek.lb)         lines.push(`• LB          : ${spek.lb} m²`);
    if (spek.kt)         lines.push(`• Kamar Tidur : ${spek.kt} KT`);
    if (spek.km)         lines.push(`• Kamar Mandi : ${spek.km} KM`);
    if (spek.lantai)     lines.push(`• Lantai      : ${spek.lantai}`);
    if (spek.garasi)     lines.push(`• Garasi      : ${spek.garasi}`);
    if (spek.sertifikat) lines.push(`• Sertifikat  : ${spek.sertifikat}`);
    if (spek.row)        lines.push(`• ROW Jalan   : ${spek.row}`);
    if (spek.hadap)      lines.push(`• Hadap       : ${spek.hadap}`);
    if (spek.furnished)  lines.push(`• Kondisi     : ${spek.furnished}`);
    return lines.join('\n') || '• Hubungi kami untuk spesifikasi lengkap';
  }

  _standardTemplate({ emoji, actionWord, hargaText, listing, spek, hashtags }) {
    const { Judul, Kecamatan, Kota, Tipe_Properti } = listing;
    const spekLines = this._buildSpekLines(spek);
    return `${emoji} ${actionWord} ${Tipe_Properti?.toUpperCase()} | ${hargaText}
📍 ${Kecamatan || ''}, ${Kota || ''}

✨ ${Judul}

🏠 SPESIFIKASI:
${spekLines}

💰 Harga: ${hargaText}
🤝 Harga bisa nego untuk pembeli serius!

📱 Hubungi kami sekarang untuk info & jadwal survey!

${hashtags}`;
  }

  _luxuryTemplate({ emoji, actionWord, hargaText, listing, spek, hashtags }) {
    const { Judul, Kecamatan, Kota } = listing;
    const spekLines = this._buildSpekLines(spek);
    return `✨ EKSKLUSIF ${actionWord} ✨

${emoji} ${Judul}
📍 ${Kecamatan || ''}, ${Kota || ''}

Kesempatan emas memiliki hunian premium di lokasi strategis.

𝗦𝗣𝗘𝗦𝗜𝗙𝗜𝗞𝗔𝗦𝗜 𝗣𝗥𝗘𝗠𝗜𝗨𝗠:
${spekLines}

💎 Harga Penawaran: ${hargaText}

Untuk informasi eksklusif, hubungi kami segera.
Slot terbatas! 🔑

${hashtags}`;
  }

  _investmentTemplate({ emoji, actionWord, hargaText, listing, spek, hashtags }) {
    const { Judul, Kecamatan, Kota } = listing;
    return `💼 INVESTASI PROPERTI MENGUNTUNGKAN!

${emoji} ${actionWord}: ${Judul}
📍 ${Kecamatan || ''}, ${Kota || ''}

📈 KENAPA INVESTASI DI SINI?
✅ Lokasi strategis, nilai terus naik
✅ Dekat pusat kota & fasilitas umum
${spek.sertifikat ? `✅ Sertifikat ${spek.sertifikat} (Aman & Legal)` : ''}
${spek.lt ? `✅ LT ${spek.lt} m²` : ''}

💰 Harga: ${hargaText}
📊 Potensi ROI tinggi!

🤝 Cocok untuk investor & end user.
DM atau WA sekarang! 📲

${hashtags}`;
  }

  _buildHashtags(listing) {
    const { Tipe_Properti, Kota, Kecamatan, Status_Transaksi } = listing;
    const kota   = Kota?.replace(/\s+/g, '') || '';
    const kec    = Kecamatan?.replace(/\s+/g, '') || '';
    const action = Status_Transaksi === 'Sewa' ? 'Sewa' : 'Jual';
    const tipe   = Tipe_Properti?.replace(/\s+/g, '') || 'Properti';
    return [
      `#Properti${kota}`, `#Rumah${action}${kota}`, `#${tipe}${kota}`,
      `#${action}Properti${kota}`, `#PropertiIndonesia`, `#RumahImpian`,
      `#InvestasiProperti`, `#PropertiBagus`, `#RumahMurah`,
      kec ? `#${kec}` : '', kota ? `#${kota}` : '',
      `#CariRumah`, `#BrokerProperti`, `#AgentProperti`, `#PropertiDijual`,
    ].filter(Boolean).join(' ');
  }

  _formatHarga(harga) {
    if (!harga) return 'Hubungi Kami';
    const num = parseFloat(harga);
    if (num >= 1_000_000_000) return `Rp ${(num/1_000_000_000).toFixed(1)} M`;
    if (num >= 1_000_000)     return `Rp ${(num/1_000_000).toFixed(0)} Jt`;
    return `Rp ${num.toLocaleString('id-ID')}`;
  }

  _getEmoji(tipe) {
    return { Rumah:'🏠', Ruko:'🏪', Tanah:'🌿', Apartemen:'🏢', Kios:'🏬', Villa:'🏡', Gudang:'🏭' }[tipe] || '🏘️';
  }
}

module.exports = new CaptionService();
