/**
 * Google Drive Service — Upload dokumen legal PDF
 * Folder root "CRM Legal" ID: dari env GDRIVE_LEGAL_FOLDER_ID
 * Struktur folder: /CRM Legal/{Kategori}/{Agen_ID}/
 * Auth: service account yang sama dengan Sheets (GOOGLE_PRIVATE_KEY + GOOGLE_SERVICE_ACCOUNT_EMAIL)
 */

const { google } = require('googleapis');
const { Readable } = require('stream');
const { getGoogleAuth } = require('../config/sheets.config');

const ROOT_FOLDER_ID = process.env.GDRIVE_LEGAL_FOLDER_ID || '1OUHq_ZwtNwvkWIR63cH6nYyvFFk21uwE';

function getDriveClient() {
  const auth = getGoogleAuth();
  // Drive butuh scope tambahan — buat auth baru jika scope berbeda
  const privateKey  = process.env.GOOGLE_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const driveAuth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey ? privateKey.replace(/\\n/g, '\n') : undefined,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
  return google.drive({ version: 'v3', auth: driveAuth });
}

// Cari atau buat subfolder di dalam parentId
async function getOrCreateFolder(drive, name, parentId) {
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 1 });
  if (res.data.files.length > 0) return res.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return created.data.id;
}

/**
 * Upload PDF buffer ke Drive.
 * @param {Buffer} buffer   - File buffer dari multer
 * @param {string} filename - Nama file original
 * @param {string} agentId  - ID agen (subfolder)
 * @param {string} kategori - PJB | Sewa | SPR | Lainnya
 * @returns {{ fileId, webViewLink, ukuranKB }}
 */
async function uploadPDF(buffer, filename, agentId, kategori) {
  const drive = getDriveClient();

  // Buat path folder: root → kategori → agentId
  const katFolder   = await getOrCreateFolder(drive, kategori, ROOT_FOLDER_ID);
  const agenFolder  = await getOrCreateFolder(drive, agentId, katFolder);

  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [agenFolder],
      mimeType: 'application/pdf',
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id,webViewLink,size',
  });

  const fileId = res.data.id;

  // Set permission: anyone with link dapat melihat
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const ukuranKB = Math.ceil((parseInt(res.data.size || buffer.length) / 1024));

  return {
    fileId,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    ukuranKB,
  };
}

/**
 * Hapus file dari Google Drive.
 * @param {string} fileId
 */
async function deleteFile(fileId) {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

module.exports = { uploadPDF, deleteFile };
