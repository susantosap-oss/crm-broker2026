const { getDriveClient, SHEETS } = require('../config/sheets.config');
const sheetsService = require('./sheets.service');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const TRAINING_FOLDER_ID = '1RTgQdJ7ZClRC1vUpoFl6-OAyRxWaRRsq';
const PK_FOLDER_NAME     = 'Product Knowledge';
const CL_PK_FOLDER       = 'mansion_properti/product_knowledge';
const CACHE_TTL          = 5 * 60 * 1000;

let _cache     = null;
let _cacheTime = 0;

async function _listFiles(drive, folderId, mimeFilter = null) {
  const q = mimeFilter
    ? `'${folderId}' in parents and (${mimeFilter}) and trashed=false`
    : `'${folderId}' in parents and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id,name,size,mimeType,modifiedTime)',
    orderBy: 'name',
  });
  return res.data.files || [];
}

async function _listFolders(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    orderBy: 'name',
  });
  return res.data.files || [];
}

async function _getPKFromSheets() {
  const rows = await sheetsService.getRange(SHEETS.PRODUCT_KNOWLEDGE);
  if (!rows || rows.length <= 1) return [];
  const folders = {};
  for (const r of rows.slice(1)) {
    const [id, folder, filename, url, mimeType, size] = r;
    if (!folder || !url) continue;
    const key = folder.trim();
    if (!folders[key]) folders[key] = { id: key, name: key, files: [] };
    folders[key].files.push({
      id:           id || '',
      name:         filename || '',
      size:         size ? parseInt(size) : 0,
      mimeType:     mimeType || 'application/pdf',
      url,
      modifiedTime: r[7] || '',
    });
  }
  return Object.values(folders);
}

async function _getOrCreatePKSubfolder(folderName) {
  const drive = getDriveClient();
  const rootFolders = await _listFolders(drive, TRAINING_FOLDER_ID);
  const pkFolder = rootFolders.find(f => f.name.trim().toLowerCase() === PK_FOLDER_NAME.toLowerCase());
  if (!pkFolder) throw new Error('Folder Product Knowledge tidak ditemukan di Drive');

  const existing = await drive.files.list({
    q: `'${pkFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`,
    fields: 'files(id)',
  });
  if (existing.data.files?.length > 0) return existing.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [pkFolder.id] },
    fields: 'id',
  });
  return created.data.id;
}

// Uses Node 20 built-in fetch which follows 302 redirects (GAS web app redirects to googleusercontent.com)
function _copyToDriveViaGas(folderId, filename, url) {
  const gasUrl = process.env.GAS_DRIVE_UPLOAD_URL;
  if (!gasUrl) return;
  fetch(gasUrl, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/json' },
    body:     JSON.stringify({ folderId, filename, url }),
    redirect: 'follow',
  }).then(async r => {
    const text = await r.text();
    try {
      const data = JSON.parse(text);
      if (!data.success) console.warn('[GAS Drive] copy failed:', filename, data.error || '');
      else console.log('[GAS Drive] copied to Drive:', filename);
    } catch { /* GAS may return HTML on redirect loops — not a fatal error */ }
  }).catch(e => console.warn('[GAS Drive] request error:', e.message));
}

function _clPublicId(url, mimeType) {
  // URL: https://res.cloudinary.com/{cloud}/{type}/upload/v{ver}/{public_id}
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!m) return null;
  const path = m[1];
  // Images: public_id has no extension; raw: public_id includes extension
  if (mimeType && mimeType.startsWith('image/')) return path.replace(/\.[^/.]+$/, '');
  return path;
}

function _clResourceType(mimeType) {
  return mimeType && mimeType.startsWith('image/') ? 'image' : 'raw';
}

async function getTrainingMaterials() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  const drive = getDriveClient();
  const folders = await _listFolders(drive, TRAINING_FOLDER_ID);

  const [pkSubfolders, driveCategories] = await Promise.all([
    _getPKFromSheets(),
    Promise.all(
      folders
        .filter(f => f.name.trim().toLowerCase() !== PK_FOLDER_NAME.toLowerCase())
        .map(async folder => {
          const files = await _listFiles(drive, folder.id, `mimeType='application/pdf'`);
          return { id: folder.id, name: folder.name, type: 'regular', files };
        })
    ),
  ]);

  _cache = [
    { id: 'product-knowledge', name: PK_FOLDER_NAME, type: 'product-knowledge', subfolders: pkSubfolders },
    ...driveCategories,
  ];
  _cacheTime = Date.now();
  return _cache;
}

async function uploadToProductKnowledge(folderName, files, uploaderName = '') {
  let driveFolderId = null;
  try {
    driveFolderId = await _getOrCreatePKSubfolder(folderName);
  } catch (e) {
    console.warn('[training] Drive folder lookup failed:', e.message);
  }

  const uploaded = [];
  for (const file of files) {
    const isImage = file.mimetype.startsWith('image/');
    const url = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: isImage ? 'image' : 'raw', folder: `${CL_PK_FOLDER}/${folderName}`, use_filename: true, unique_filename: true },
        (err, result) => err ? reject(err) : resolve(result.secure_url)
      );
      const readable = new Readable();
      readable.push(file.buffer);
      readable.push(null);
      readable.pipe(stream);
    });

    await sheetsService.appendRow(SHEETS.PRODUCT_KNOWLEDGE, [
      uuidv4(), folderName, file.originalname, url,
      file.mimetype, String(file.size || 0), uploaderName, new Date().toISOString(),
    ]);

    if (driveFolderId) _copyToDriveViaGas(driveFolderId, file.originalname, url);
    uploaded.push({ name: file.originalname, url });
  }

  clearTrainingCache();
  return { folderName, uploaded };
}

async function deleteProductKnowledgeFile(fileId) {
  const rows = await sheetsService.getRange(SHEETS.PRODUCT_KNOWLEDGE);
  if (!rows || rows.length <= 1) throw new Error('File tidak ditemukan');

  const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === fileId);
  if (rowIdx === -1) throw new Error('File tidak ditemukan');

  const [, , , url, mimeType] = rows[rowIdx];

  // Delete from Cloudinary
  if (url) {
    try {
      const publicId = _clPublicId(url, mimeType);
      if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: _clResourceType(mimeType) });
    } catch (e) {
      console.warn('[training delete] Cloudinary destroy failed:', e.message);
    }
  }

  // Delete row from sheet (rowIdx is 0-based array index, sheet row = rowIdx + 1)
  await sheetsService.deleteRow(SHEETS.PRODUCT_KNOWLEDGE, rowIdx + 1);
  clearTrainingCache();
}

function clearTrainingCache() {
  _cache = null;
}

module.exports = { getTrainingMaterials, uploadToProductKnowledge, deleteProductKnowledgeFile, clearTrainingCache };
