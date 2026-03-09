#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CRM Mansion — Patch v5
=======================
[1] Force Logout All Devices
[2] Export CSV Leads
[3] sessionStorage -> localStorage
"""

import os, sys, re, shutil
from datetime import datetime

ROOT       = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(ROOT, f"_patch_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
ERRORS     = []

def backup_and_read(rel_path):
    full = os.path.join(ROOT, rel_path)
    if not os.path.exists(full):
        print(f"  [ERROR] File tidak ditemukan: {rel_path}")
        ERRORS.append(rel_path); return None
    dst = os.path.join(BACKUP_DIR, rel_path)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(full, dst)
    with open(full, 'r', encoding='utf-8') as f: return f.read()

def write_file(rel_path, content):
    with open(os.path.join(ROOT, rel_path), 'w', encoding='utf-8') as f: f.write(content)

def rxrep(content, pattern, repl_fn, label, flags=re.DOTALL):
    found = [False]
    def wrap(m):
        found[0] = True
        return repl_fn(m)
    result = re.sub(pattern, wrap, content, count=1, flags=flags)
    print(f"  [OK]    {label}" if found[0] else f"  [SKIP]  {label}")
    return result

def strep(content, old, new, label):
    if old in content:
        print(f"  [OK]    {label}")
        return content.replace(old, new, 1)
    print(f"  [SKIP]  {label}")
    return content

# ═══════════════════════════════════════════════════════
# PATCH 1 — auth.middleware.js: cek force logout
# ═══════════════════════════════════════════════════════
print("\n[1/5] Patching backend/middleware/auth.middleware.js ...")
AUTH_PATH = "backend/middleware/auth.middleware.js"
content = backup_and_read(AUTH_PATH)
if content:
    HELPER = (
        "\n// Force Logout Cache (baca CONFIG sheet, cache 2 menit)\n"
        "let _flCache = { ts: 0, val: 0 };\n"
        "async function getForceLogoutAt() {\n"
        "  const now = Date.now();\n"
        "  if (now - _flCache.ts < 120000) return _flCache.val;\n"
        "  try {\n"
        "    const ss = require('../services/sheets.service');\n"
        "    const { SHEETS } = require('../config/sheets.config');\n"
        "    const rows = await ss.getRange(SHEETS.CONFIG);\n"
        "    const row  = (rows||[]).find(r => r[0] === 'Force_Logout_All_At');\n"
        "    _flCache = { ts: now, val: row ? (parseInt(row[1])||0) : 0 };\n"
        "  } catch { /* pakai cache lama */ }\n"
        "  return _flCache.val;\n"
        "}\n\n"
    )
    content = strep(content,
        "const authMiddleware = (req, res, next) => {",
        HELPER + "const authMiddleware = async (req, res, next) => {",
        "Inject helper + jadikan async")

    content = strep(content,
        "    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n    req.user = decoded;",
        "    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n"
        "    req.user = decoded;\n"
        "    // Cek force logout\n"
        "    const flAt = await getForceLogoutAt();\n"
        "    if (flAt && decoded.iat && (decoded.iat * 1000) < flAt) {\n"
        "      return res.status(401).json({ success: false, message: 'Sesi diakhiri oleh admin. Silakan login ulang.' });\n"
        "    }",
        "Cek force logout setelah verify")

    write_file(AUTH_PATH, content)
    print(f"  [DONE]  {AUTH_PATH}")

# ═══════════════════════════════════════════════════════
# PATCH 2 — agents.routes.js: route force-logout-all
# ═══════════════════════════════════════════════════════
print("\n[2/5] Patching backend/routes/agents.routes.js ...")
AGENTS_PATH = "backend/routes/agents.routes.js"
content = backup_and_read(AGENTS_PATH)
if content:
    ROUTE = (
        "// POST /agents/force-logout-all — superadmin only\n"
        "router.post('/force-logout-all', requireRole('superadmin'), async (req, res) => {\n"
        "  try {\n"
        "    const rows = await sheetsService.getRange(SHEETS.CONFIG);\n"
        "    const now  = Date.now().toString();\n"
        "    const idx  = (rows||[]).findIndex(r => r[0] === 'Force_Logout_All_At');\n"
        "    if (idx >= 0) {\n"
        "      const row = [...rows[idx]]; row[1] = now;\n"
        "      await sheetsService.updateRow(SHEETS.CONFIG, idx + 1, row);\n"
        "    } else {\n"
        "      await sheetsService.appendRow(SHEETS.CONFIG, ['Force_Logout_All_At', now, 'Force logout semua token']);\n"
        "    }\n"
        "    res.json({ success: true, message: 'Semua device telah di-logout. Agen harus login ulang.' });\n"
        "  } catch (e) { res.status(500).json({ success: false, message: e.message }); }\n"
        "});\n\n"
        "// GET /agents\n"
    )
    content = strep(content, "// GET /agents\n", ROUTE, "Tambah route force-logout-all")
    write_file(AGENTS_PATH, content)
    print(f"  [DONE]  {AGENTS_PATH}")

# ═══════════════════════════════════════════════════════
# PATCH 3 — leads.routes.js: GET /leads/export/csv
# ═══════════════════════════════════════════════════════
print("\n[3/5] Patching backend/routes/leads.routes.js ...")
LEADS_PATH = "backend/routes/leads.routes.js"
content = backup_and_read(LEADS_PATH)
if content:
    CSV_ROUTE = (
        "// GET /leads/export/csv\n"
        "router.get('/export/csv', async (req, res) => {\n"
        "  try {\n"
        "    const rows = await sheetsService.getRange(SHEETS.LEADS);\n"
        "    const [, ...data] = rows;\n"
        "    let leads = data.map(rowToLead).filter(l => l.ID);\n"
        "    const { role, id } = req.user;\n"
        "    if (role === 'agen') {\n"
        "      leads = leads.filter(l => l.Agen_ID === id);\n"
        "    } else if (role !== 'superadmin') {\n"
        "      return res.status(403).json({ success: false, message: 'Akses ditolak' });\n"
        "    }\n"
        "    const esc = (v) => { const s = String(v||'').replace(/\"/g,'\"\"'); return /[,\"\\n]/.test(s)?`\"${s}\"`:s; };\n"
        "    const lines = [['Nama','No WA','Tipe Properti','Transaksi'].join(',')];\n"
        "    for (const l of leads) {\n"
        "      const tipe = l.Minat_Tipe || l.Closing_Tipe || l.Tipe_Properti || '';\n"
        "      const trx  = l.Jenis || l.Status_Transaksi || '';\n"
        "      lines.push([esc(l.Nama), esc(l.No_WA), esc(tipe), esc(trx)].join(','));\n"
        "    }\n"
        "    const date  = new Date().toISOString().slice(0,10);\n"
        "    const fname = role === 'superadmin' ? `leads-all-${date}.csv` : `leads-saya-${date}.csv`;\n"
        "    res.setHeader('Content-Type','text/csv; charset=utf-8');\n"
        "    res.setHeader('Content-Disposition',`attachment; filename=\"${fname}\"`);\n"
        "    res.send('\\uFEFF' + lines.join('\\r\\n'));\n"
        "  } catch (e) { res.status(500).json({ success: false, message: e.message }); }\n"
        "});\n\n"
        "// GET /leads\n"
    )
    content = strep(content, "// GET /leads\n", CSV_ROUTE, "Tambah route export CSV")
    write_file(LEADS_PATH, content)
    print(f"  [DONE]  {LEADS_PATH}")

# ═══════════════════════════════════════════════════════
# PATCH 4 — app.js: sessionStorage -> localStorage
# ═══════════════════════════════════════════════════════
print("\n[4/5] Patching frontend/js/app.js ...")
APPJS_PATH = "frontend/js/app.js"
content = backup_and_read(APPJS_PATH)
if content:
    replacements = [
        ("sessionStorage.clear();\n    sessionStorage.setItem('crm_token'",
         "localStorage.setItem('crm_token'",
         "Login: clear+set token"),
        ("sessionStorage.setItem('crm_token', STATE.token);",
         "localStorage.setItem('crm_token', STATE.token);",
         "Login: set token"),
        ("sessionStorage.setItem('crm_user', JSON.stringify(STATE.user));",
         "localStorage.setItem('crm_user', JSON.stringify(STATE.user));",
         "Login: set user"),
        ("sessionStorage.setItem('crm_login_at', Date.now().toString());",
         "localStorage.setItem('crm_login_at', Date.now().toString());",
         "Login: set login_at"),
        ("const token = sessionStorage.getItem('crm_token');",
         "const token = localStorage.getItem('crm_token');",
         "Init: read token"),
        ("const user  = sessionStorage.getItem('crm_user');",
         "const user  = localStorage.getItem('crm_user');",
         "Init: read user"),
        ("function doLogout() {\n  sessionStorage.clear();",
         "function doLogout() {\n"
         "  localStorage.removeItem('crm_token');\n"
         "  localStorage.removeItem('crm_user');\n"
         "  localStorage.removeItem('crm_login_at');",
         "Logout: clear localStorage"),
        ("      sessionStorage.clear();\n      STATE.token = null; STATE.user = null;",
         "      localStorage.removeItem('crm_token');\n"
         "      localStorage.removeItem('crm_user');\n"
         "      localStorage.removeItem('crm_login_at');\n"
         "      STATE.token = null; STATE.user = null;",
         "401: clear localStorage"),
    ]
    for old, new, label in replacements:
        content = strep(content, old, new, label)

    remaining = content.count("sessionStorage.getItem('crm_token')")
    print(f"  [INFO]  sessionStorage crm_token tersisa: {remaining} (harusnya 0)")
    write_file(APPJS_PATH, content)
    print(f"  [DONE]  {APPJS_PATH}")

# ═══════════════════════════════════════════════════════
# PATCH 5 — app-mobile.js: helper functions + UI buttons
# ═══════════════════════════════════════════════════════
print("\n[5/5] Patching frontend/js/app-mobile.js ...")
MOBILE_PATH = "frontend/js/app-mobile.js"
content = backup_and_read(MOBILE_PATH)
if content:
    HELPERS = (
        "// ── Export CSV Leads ─────────────────────────────────\n"
        "async function exportLeadsCSV() {\n"
        "  try {\n"
        "    showToast('Mempersiapkan CSV...', 'info');\n"
        "    const res = await fetch('/api/v1/leads/export/csv', {\n"
        "      headers: { Authorization: `Bearer ${STATE.token}` }\n"
        "    });\n"
        "    if (!res.ok) { showToast('Gagal export CSV', 'error'); return; }\n"
        "    const blob = await res.blob();\n"
        "    const url  = URL.createObjectURL(blob);\n"
        "    const a    = document.createElement('a');\n"
        "    a.href = url; a.download = `leads-${new Date().toISOString().slice(0,10)}.csv`;\n"
        "    document.body.appendChild(a); a.click();\n"
        "    document.body.removeChild(a); URL.revokeObjectURL(url);\n"
        "    showToast('\u2705 CSV berhasil didownload!', 'success');\n"
        "  } catch (e) { showToast('Error: ' + e.message, 'error'); }\n"
        "}\n\n"
        "// ── Force Logout All Devices (superadmin) ─────────────\n"
        "async function forceLogoutAllDevices() {\n"
        "  if (!confirm('\u26a0\ufe0f Semua agen akan di-logout dari semua device.\\nLanjutkan?')) return;\n"
        "  try {\n"
        "    const r = await API.post('/agents/force-logout-all', {});\n"
        "    showToast('\u2705 ' + r.message, 'success');\n"
        "  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }\n"
        "}\n\n"
        "// ── PR 2: LOGOUT FIX\n"
    )
    content = strep(content,
        "// ─────────────────────────────────────────────────────────\n"
        "// PR 2: LOGOUT FIX\n",
        HELPERS,
        "Inject helper functions")

    write_file(MOBILE_PATH, content)
    print(f"  [DONE]  {MOBILE_PATH}")

# ═══════════════════════════════════════════════════════
print("\n" + "="*60)
if ERRORS:
    print(f"  {len(ERRORS)} file tidak ditemukan.")
    for e in ERRORS: print(f"   - {e}")
    sys.exit(1)
else:
    print("  Patch v5 selesai!")
    print(f"  Backup: {os.path.basename(BACKUP_DIR)}/")
    print("\n  Deploy: bash deploy.sh")
print("="*60 + "\n")

# (append di akhir file sebelum print summary)
