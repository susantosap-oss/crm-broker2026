/**
 * Legal Storage Service — Upload dokumen PDF ke Cloudinary
 * Folder: mansion_legal/{agent_id}/{filename}
 * Kompresi: ghostscript sebelum upload (hemat 40-70% ukuran)
 */

const cloudinary = require('cloudinary').v2;
const { execFile } = require('child_process');
const { promisify } = require('util');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { Readable } = require('stream');

const execFileAsync = promisify(execFile);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ROOT = 'mansion_legal';

// Kompresi PDF dengan ghostscript. Fallback ke buffer asli jika gs tidak tersedia.
async function compressPDF(inputBuffer) {
  const tmpDir    = os.tmpdir();
  const inputPath = path.join(tmpDir, `legal_in_${Date.now()}_${process.pid}.pdf`);
  const outPath   = path.join(tmpDir, `legal_out_${Date.now()}_${process.pid}.pdf`);
  try {
    fs.writeFileSync(inputPath, inputBuffer);
    await execFileAsync('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/ebook',   // /screen=terkecil, /ebook=seimbang, /printer=kualitas tinggi
      '-dNOPAUSE', '-dQUIET', '-dBATCH',
      `-sOutputFile=${outPath}`,
      inputPath,
    ]);
    const compressed = fs.readFileSync(outPath);
    // Pakai hasil kompresi hanya jika lebih kecil
    return compressed.length < inputBuffer.length ? compressed : inputBuffer;
  } catch (_) {
    // ghostscript tidak tersedia atau error — pakai buffer asli
    return inputBuffer;
  } finally {
    try { fs.unlinkSync(inputPath); } catch (_) {}
    try { fs.unlinkSync(outPath); }  catch (_) {}
  }
}

/**
 * Upload PDF ke Cloudinary (dengan kompresi ghostscript terlebih dahulu).
 * @param {Buffer} buffer
 * @param {string} filename  - Nama file auto-generated (tanpa .pdf di public_id)
 * @param {string} agentId   - ID agen (subfolder)
 * @returns {{ fileId, webViewLink, ukuranKB }}
 */
async function uploadPDF(buffer, filename, agentId) {
  const compressed = await compressPDF(buffer);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder:        `${ROOT}/${agentId}`,
        public_id:     filename,   // pertahankan .pdf agar URL berakhir dengan .pdf
        overwrite:     false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          fileId:      result.public_id,
          webViewLink: result.secure_url,
          ukuranKB:    Math.ceil(result.bytes / 1024),
        });
      }
    );
    Readable.from(compressed).pipe(stream);
  });
}

/**
 * Hapus file PDF dari Cloudinary.
 * @param {string} fileId - public_id dari Cloudinary
 */
async function deleteFile(fileId) {
  await cloudinary.uploader.destroy(fileId, { resource_type: 'raw' });
}

module.exports = { uploadPDF, deleteFile };
