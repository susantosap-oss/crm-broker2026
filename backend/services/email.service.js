/**
 * Email Service — Nodemailer + Gmail SMTP per-user
 * =================================================
 * Setiap user kirim dari akun Gmail mereka sendiri.
 * App Password disimpan encrypted di AGENTS sheet (kolom Email_App_Pass_Enc).
 */
const nodemailer = require('nodemailer');

/**
 * Buat transporter untuk email + app password tertentu.
 * Tidak di-cache karena tiap user beda credential.
 */
function createTransporter(email, appPassword) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: email, pass: appPassword },
  });
}

/**
 * Kirim satu email.
 * @param {object} opts
 * @param {string} opts.fromEmail    - email pengirim (Gmail user)
 * @param {string} opts.fromPassword - App Password (sudah di-decrypt)
 * @param {string} opts.fromName     - nama display pengirim
 * @param {string} opts.to           - email tujuan
 * @param {string} opts.subject
 * @param {string} opts.html
 */
async function sendEmail({ fromEmail, fromPassword, fromName, to, subject, html }) {
  if (!fromEmail || !fromPassword) {
    throw new Error('Konfigurasi email belum lengkap. Silakan atur App Password Gmail di profil Anda.');
  }
  const transporter = createTransporter(fromEmail, fromPassword);
  return transporter.sendMail({
    from:    `"${fromName || 'Mansion Properti'}" <${fromEmail}>`,
    to,
    subject,
    html,
  });
}

module.exports = { sendEmail };
