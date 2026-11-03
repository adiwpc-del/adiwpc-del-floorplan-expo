import db from '../db.js';
import { clientIp } from './auth.js';

const COALESCE_MINUTES = 10;
const SENSITIVE_KEYS = /password|token|secret|api_?key/i;
const BULKY_KEYS = /fabric|canvas|blueprint|metadata|objects|items|logo|signature|image|base64/i;

const invoiceById = (id) => db.prepare('SELECT invoice_number, company_name, booth_code, payment_status FROM invoices WHERE id = ? OR invoice_number = ?').get(id, id);
const userById = (id) => db.prepare('SELECT name, email, role, is_active FROM users WHERE id = ?').get(id);
const floorplanTitle = (id) => db.prepare('SELECT title FROM floorplans WHERE id = ?').get(id)?.title;
// Booth status / tenant before a booking or a tenant edit ("from -> to" in the log)
const boothBefore = (req) => {
  const b = req.body || {};
  const code = b.boothCode || (Array.isArray(b.boothCodes) ? b.boothCodes[0] : '');
  if (!b.floorplanId || !code) return null;
  return db.prepare('SELECT code, status, owner_name FROM booths WHERE floorplan_id = ? AND deleted_at IS NULL AND LOWER(TRIM(code)) = LOWER(TRIM(?))').get(b.floorplanId, code) || null;
};
const invoiceLabel = (inv, id) => inv ? `${inv.invoice_number} (${inv.company_name || '-'}, booth ${inv.booth_code || '-'})` : id;

// Human-readable labels for mutations; `before` snapshots state so the log can show "from -> to".
const AUDIT_RULES = [
  // Invoices & payments
  { method: 'POST', path: /^\/invoices\/([^/]+)\/status$/, category: 'Invoice', action: 'Ubah status pembayaran',
    before: (m) => invoiceById(m[1]),
    describe: (req, m, before) => ({
      target: invoiceLabel(before, m[1]),
      summary: `${before?.payment_status || '?'} → ${(req.body.status || '').toUpperCase() || '?'}${req.body.boothStatus ? `, booth → ${req.body.boothStatus}` : ''}`
    }) },
  { method: 'POST', path: /^\/invoices\/sync-booth-discount$/, category: 'Invoice', action: 'Atur diskon booth',
    describe: (req) => ({ target: `Booth ${req.body.boothCode || req.body.booth_code || '-'}` }) },
  { method: 'POST', path: /^\/invoices\/config$/, category: 'Invoice', action: 'Ubah pengaturan/template invoice' },
  { method: 'POST', path: /^\/invoices$/, category: 'Invoice', action: 'Buat invoice',
    describe: (req) => ({ target: `${req.body.invoiceNumber || req.body.invoice_number || ''} ${req.body.companyName || req.body.company_name || ''}`.trim() }) },
  { method: 'POST', path: /^\/invoices\/([^/]+)\/terms$/, category: 'Invoice', action: 'Ubah DP / pajak / tampilan invoice',
    before: (m) => invoiceById(m[1]),
    describe: (req, m, before) => ({
      target: invoiceLabel(before, m[1]),
      summary: [
        req.body.dpValue !== undefined ? `DP ${req.body.dpMode === 'nominal' ? `Rp ${Number(req.body.dpValue || 0).toLocaleString('id-ID')}` : `${req.body.dpValue}%`}` : '',
        req.body.taxMethod ? `PPN: ${req.body.taxMethod}${req.body.taxDisplay ? ` (${req.body.taxDisplay})` : ''}` : '',
        req.body.display ? 'pengaturan tampilan dokumen' : ''
      ].filter(Boolean).join(', ')
    }) },
  { method: 'PUT', path: /^\/invoices\/([^/]+)$/, category: 'Invoice', action: 'Edit invoice',
    before: (m) => invoiceById(m[1]), describe: (req, m, before) => ({ target: invoiceLabel(before, m[1]) }) },
  { method: 'DELETE', path: /^\/invoices\/([^/]+)$/, category: 'Invoice', action: 'Hapus invoice',
    before: (m) => invoiceById(m[1]), describe: (req, m, before) => ({ target: invoiceLabel(before, m[1]) }) },

  // Booths, tenants & bookings
  { method: 'PATCH', path: /^\/stats\/booth\/([^/]+)\/status$/, category: 'Booth', action: 'Ubah status booth',
    before: (m) => db.prepare('SELECT code, status, floorplan_id FROM booths WHERE id = ?').get(m[1]),
    describe: (req, m, before) => ({ target: `Booth ${before?.code || m[1]}`, summary: `${before?.status || '?'} → ${req.body.status || '?'}` }) },
  { method: 'POST', path: /^\/(orders|exhibitors)\/checkout$/, category: 'Booking', action: 'Daftarkan tenant ke booth',
    before: (m, req) => boothBefore(req),
    describe: (req, m, before) => ({
      target: `Booth ${req.body.boothCode || (req.body.boothCodes || []).join('+') || '-'}`,
      summary: `${before?.status || '?'}${before?.owner_name ? ` (${before.owner_name})` : ''} → ${req.body.bookingType === 'payment_gateway' ? 'sold' : 'reserved'} · ${req.body.brandName || '-'} (${req.body.bookingType || 'booking'}${req.body.deferInvoice ? ', invoice menyusul' : ''})`
    }) },
  { method: 'PUT', path: /^\/(orders|exhibitors)\/update-tenant$/, category: 'Booking', action: 'Edit data tenant',
    before: (m, req) => boothBefore(req),
    describe: (req, m, before) => ({
      target: `Booth ${req.body.boothCode || '-'}`,
      summary: before?.owner_name && before.owner_name !== req.body.brandName ? `${before.owner_name} → ${req.body.brandName || ''}` : (req.body.brandName || '')
    }) },
  { method: 'POST', path: /^\/(orders|exhibitors)\/detach-tenant$/, category: 'Booking', action: 'Lepas tenant dari booth',
    describe: (req) => ({ target: `Booth ${req.body.boothCode || '-'}` }) },

  // Floorplans
  { method: 'POST', path: /^\/floorplan\/save$/, category: 'Floorplan', action: 'Simpan denah', coalesce: true,
    describe: (req) => ({ target: `${req.body.title || floorplanTitle(req.body.id) || 'Denah'} (${req.body.id || 'baru'})` }) },
  { method: 'POST', path: /^\/floorplan\/([^/]+)\/publish$/, category: 'Floorplan', action: 'Publish denah',
    describe: (req, m) => ({ target: `${floorplanTitle(m[1]) || ''} (${m[1]})` }) },
  { method: 'POST', path: /^\/floorplan\/([^/]+)\/merge-display$/, category: 'Booth', action: 'Atur tampilan booth gabungan',
    describe: (req, m) => ({ target: `Booth ${(req.body.boothCodes || []).join('+')} — ${floorplanTitle(m[1]) || m[1]}`, summary: req.body.separate ? 'Tampilkan Terpisah' : 'Gabungkan Kembali' }) },
  { method: 'POST', path: /^\/floorplan\/([^/]+)\/booth-status$/, category: 'Booth', action: 'Ubah status booth',
    before: (m, req) => boothBefore({ body: { ...req.body, floorplanId: m[1] } }),
    describe: (req, m, before) => ({
      target: `Booth ${req.body.boothCode || '-'} — ${floorplanTitle(m[1]) || m[1]}`,
      summary: `${before?.status || '?'}${before?.owner_name ? ` (${before.owner_name})` : ''} → ${req.body.status || '?'}`
    }) },
  { method: 'POST', path: /^\/floorplan\/([^/]+)\/unpublish$/, category: 'Floorplan', action: 'Hentikan publikasi denah',
    describe: (req, m) => ({ target: `${floorplanTitle(m[1]) || ''} (${m[1]})` }) },
  { method: 'POST', path: /^\/floorplan\/([^/]+)\/duplicate$/, category: 'Floorplan', action: 'Duplikat denah',
    describe: (req, m) => ({ target: `${floorplanTitle(m[1]) || ''} (${m[1]})` }) },
  { method: 'DELETE', path: /^\/floorplan\/presets\/([^/]+)$/, category: 'Floorplan', action: 'Hapus preset layout' },
  { method: 'DELETE', path: /^\/floorplan\/([^/]+)$/, category: 'Floorplan', action: 'Hapus denah',
    before: (m) => ({ title: floorplanTitle(m[1]) }), describe: (req, m, before) => ({ target: `${before?.title || ''} (${m[1]})` }) },
  { method: 'POST', path: /^\/floorplan\/create-hall$/, category: 'Floorplan', action: 'Buat hall baru' },
  { method: 'POST', path: /^\/floorplan\/(save-as-preset|presets)$/, category: 'Floorplan', action: 'Simpan preset layout' },
  { method: 'POST', path: /^\/floorplan\/soft-delete$/, category: 'Floorplan', action: 'Pindahkan project ke tempat sampah',
    describe: (req) => ({ target: (req.body.projectIds || []).join(', ') }) },
  { method: 'POST', path: /^\/floorplan\/restore$/, category: 'Floorplan', action: 'Pulihkan project',
    describe: (req) => ({ target: (req.body.projectIds || []).join(', ') }) },
  { method: 'POST', path: /^\/floorplan\/permanent-delete$/, category: 'Floorplan', action: 'Hapus permanen project',
    describe: (req) => ({ target: (req.body.projectIds || []).join(', ') }) },

  // Master data & settings
  { method: '*', path: /^\/categories(\/.*)?$/, category: 'Pengaturan', action: 'Ubah kategori/tier harga booth' },
  { method: '*', path: /^\/brand-categories(\/.*)?$/, category: 'Pengaturan', action: 'Ubah kategori brand' },
  { method: '*', path: /^\/payment-methods(\/.*)?$/, category: 'Pengaturan', action: 'Ubah metode pembayaran' },
  { method: '*', path: /^\/facilities\/forms(\/.*)?$/, category: 'Fasilitas', action: 'Ubah formulir fasilitas' },
  { method: 'PUT', path: /^\/facilities\/categories$/, category: 'Fasilitas', action: 'Ubah daftar kategori fasilitas',
    describe: (req) => ({ target: 'Kategori fasilitas', summary: (req.body?.categories || []).map(c => String(c).trim()).filter(Boolean).join(', ').slice(0, 300) }) },
  { method: 'POST', path: /^\/facilities\/categories\/rename$/, category: 'Fasilitas', action: 'Ganti nama kategori fasilitas',
    describe: (req) => ({ target: 'Kategori fasilitas', summary: `${String(req.body?.from || '').trim()} → ${String(req.body?.to || '').trim()}` }) },
  { method: 'PUT', path: /^\/facilities\/requests\/([^/]+)\/status$/, category: 'Fasilitas', action: 'Ubah status permintaan fasilitas',
    describe: (req, m) => ({ target: m[1], summary: `→ ${req.body.status || '?'}` }) },
  { method: 'PUT', path: /^\/facilities\/requests\/([^/]+)$/, category: 'Fasilitas', action: 'Ubah isi permintaan fasilitas',
    describe: (req, m) => ({ target: m[1], summary: `${Array.isArray(req.body?.items) ? req.body.items.length : 0} item` }) },
  { method: 'POST', path: /^\/facilities\/requests\/([^/]+)\/generate-invoice$/, category: 'Fasilitas', action: 'Terbitkan invoice fasilitas',
    describe: (req, m) => ({ target: m[1] }) },

  // Pusat Maintenance
  // AI agent chat (the agent's own tool calls are written by agentRunner.js)
  { method: 'POST', path: /^\/maintenance\/agent\/tasks$/, category: 'Maintenance', action: 'Buat tugas AI Agent',
    describe: (req) => ({ target: String(req.body?.title || 'Percakapan baru').slice(0, 120) }) },
  { method: 'POST', path: /^\/maintenance\/agent\/tasks\/([^/]+)\/messages$/, category: 'Maintenance', action: 'Kirim pesan ke AI Agent',
    describe: (req, m) => ({
      target: `Tugas ${m[1]}`,
      summary: `${String(req.body?.text || '').replace(/\s+/g, ' ').slice(0, 160)}${(req.body?.attachments || []).length ? ` · ${(req.body.attachments || []).length} lampiran` : ''}${(req.body?.context || []).length ? ` · ${(req.body.context || []).length} konteks` : ''}`
    }) },
  { method: 'POST', path: /^\/maintenance\/agent\/tasks\/([^/]+)\/stop$/, category: 'Maintenance', action: 'Hentikan AI Agent',
    describe: (req, m) => ({ target: `Tugas ${m[1]}` }) },
  { method: 'PATCH', path: /^\/maintenance\/agent\/tasks\/([^/]+)$/, category: 'Maintenance', action: 'Ubah tugas AI Agent',
    describe: (req, m) => ({ target: `Tugas ${m[1]}`, summary: [req.body?.title ? `judul: ${String(req.body.title).slice(0, 80)}` : '', req.body?.status ? `status: ${req.body.status}` : ''].filter(Boolean).join(' · ') }) },
  { method: 'PUT', path: /^\/maintenance\/ai-config$/, category: 'Maintenance', action: 'Ubah pengaturan AI (model / batas biaya)',
    describe: (req) => ({ target: 'Integrasi AI', summary: Object.entries(req.body || {}).map(([k, v]) => `${k}: ${v}`).join(', ').slice(0, 200) }) },
  // Chat antar staf (AGENTS.md §38): only group management is logged, never messages (their routes skip the audit)
  { method: 'POST', path: /^\/chat\/groups$/, category: 'Chat', action: 'Buat grup chat',
    describe: (req) => ({ target: `Grup "${req.body.title || ''}"`, summary: `${(req.body.memberIds || []).length} anggota` }) },
  { method: 'PUT', path: /^\/chat\/groups\/(\d+)$/, category: 'Chat', action: 'Ganti nama grup chat',
    before: (m) => db.prepare('SELECT title FROM chat_conversations WHERE id = ?').get(m[1]),
    describe: (req, m, before) => ({ target: `Grup #${m[1]}`, summary: `${before?.title || '?'} → ${req.body.title || ''}` }) },
  { method: 'POST', path: /^\/chat\/groups\/(\d+)\/members$/, category: 'Chat', action: 'Tambah anggota grup chat',
    describe: (req, m) => ({ target: `Grup ${db.prepare('SELECT title FROM chat_conversations WHERE id = ?').get(m[1])?.title || m[1]}`,
      summary: (req.body.userIds || []).map(id => db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || id).join(', ') }) },
  { method: 'DELETE', path: /^\/chat\/groups\/(\d+)\/members\/([^/]+)$/, category: 'Chat', action: 'Keluarkan anggota grup chat',
    describe: (req, m) => ({ target: `Grup ${db.prepare('SELECT title FROM chat_conversations WHERE id = ?').get(m[1])?.title || m[1]}`,
      summary: db.prepare('SELECT name FROM users WHERE id = ?').get(m[2])?.name || m[2] }) },
  // Claude API key: the key itself is never logged (SENSITIVE_KEYS drops `apiKey` from the details too)
  { method: 'PUT', path: /^\/maintenance\/ai-key$/, category: 'Maintenance', action: 'Simpan API key Claude',
    describe: () => ({ target: 'ANTHROPIC_API_KEY (server/.env)', summary: 'Key baru disimpan (nilai tidak dicatat)' }) },
  { method: 'DELETE', path: /^\/maintenance\/ai-key$/, category: 'Maintenance', action: 'Hapus API key Claude',
    describe: () => ({ target: 'ANTHROPIC_API_KEY (server/.env)' }) },
  { method: 'POST', path: /^\/maintenance\/ai-key\/test$/, category: 'Maintenance', action: 'Uji koneksi Claude API',
    describe: () => ({ target: 'api.anthropic.com /v1/models' }) },
  // WhatsApp (Fonnte): the token and the webhook secret are never logged
  { method: 'PUT', path: /^\/maintenance\/whatsapp$/, category: 'Maintenance', action: 'Simpan pengaturan WhatsApp (Fonnte)',
    describe: (req) => ({ target: 'FONNTE_* (server/.env)', summary: [req.body?.token || req.body?.device !== undefined ? 'Token / nomor device diubah (nilai tidak dicatat)' : '', req.body?.signature !== undefined ? `Tanda tangan pesan: ${String(req.body.signature || '').trim() || '(kosong)'}` : '', req.body?.persona !== undefined ? `Nama asisten: ${req.body.persona}` : ''].filter(Boolean).join(' · ') }) },
  { method: 'POST', path: /^\/maintenance\/whatsapp\/secret$/, category: 'Maintenance', action: 'Ganti rahasia webhook WhatsApp',
    describe: () => ({ target: 'FONNTE_WEBHOOK_SECRET (server/.env)' }) },
  { method: 'POST', path: /^\/maintenance\/whatsapp\/test$/, category: 'Maintenance', action: 'Kirim pesan tes WhatsApp',
    describe: () => ({ target: 'api.fonnte.com /send' }) },
  { method: 'DELETE', path: /^\/maintenance\/whatsapp$/, category: 'Maintenance', action: 'Hapus pengaturan WhatsApp (Fonnte)',
    describe: () => ({ target: 'FONNTE_* (server/.env)' }) },
  // Gemini agent of the WhatsApp assistant: the key is never logged (SENSITIVE_KEYS drops `apiKey` from the details)
  { method: 'PUT', path: /^\/maintenance\/whatsapp\/gemini$/, category: 'Maintenance', action: 'Simpan pengaturan agen Gemini',
    describe: (req) => ({ target: 'GEMINI_API_KEY (file .env) / model', summary: [req.body?.apiKey ? 'API key baru (nilai tidak dicatat)' : '', req.body?.model ? `model ${req.body.model}` : '', typeof req.body?.enabled === 'boolean' ? (req.body.enabled ? 'agen diaktifkan' : 'agen dimatikan') : ''].filter(Boolean).join(' · ') }) },
  { method: 'DELETE', path: /^\/maintenance\/whatsapp\/gemini$/, category: 'Maintenance', action: 'Hapus API key Gemini',
    describe: () => ({ target: 'GEMINI_API_KEY (file .env)' }) },
  { method: 'POST', path: /^\/maintenance\/errors\/([^/]+)\/status$/, category: 'Maintenance', action: 'Ubah status error',
    before: (m) => db.prepare('SELECT id, status, priority, message FROM error_groups WHERE id = ?').get(m[1]),
    describe: (req, m, before) => ({
      target: `${m[1]} (${before?.priority || '?'}) ${String(before?.message || '').slice(0, 80)}`,
      summary: `${before?.status || '?'} → ${req.body.status || '?'}${req.body.note ? ` · ${String(req.body.note).slice(0, 120)}` : ''}`
    }) },

  // Users
  { method: 'POST', path: /^\/users$/, category: 'User', action: 'Tambah user',
    describe: (req) => ({ target: `${req.body.name || ''} <${req.body.email || ''}>`, summary: `Role: ${req.body.role || '-'}` }) },
  { method: 'PUT', path: /^\/users\/([^/]+)$/, category: 'User', action: 'Edit user',
    before: (m) => userById(m[1]),
    describe: (req, m, before) => {
      const changes = [];
      if (req.body.role !== undefined && req.body.role !== before?.role) changes.push(`role ${before?.role} → ${req.body.role}`);
      if (req.body.isActive !== undefined && Boolean(req.body.isActive) !== Boolean(before?.is_active)) changes.push(req.body.isActive ? 'diaktifkan' : 'dinonaktifkan');
      if (req.body.email !== undefined && req.body.email.trim().toLowerCase() !== before?.email) changes.push(`email → ${req.body.email}`);
      if (req.body.name !== undefined && req.body.name.trim() !== before?.name) changes.push(`nama → ${req.body.name}`);
      if (req.body.password) changes.push('password diganti');
      return { target: `${before?.name || m[1]} <${before?.email || ''}>`, summary: changes.join(', ') || 'Tidak ada perubahan data' };
    } }
];

const findAuditRule = (method, path) => {
  for (const rule of AUDIT_RULES) {
    if (rule.method !== '*' && rule.method !== method) continue;
    const match = path.match(rule.path);
    if (match) return { rule, match };
  }
  return null;
};

// Small, safe snapshot of the request payload (no passwords, no canvas/blueprint blobs)
const safeDetails = (body) => {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.test(key) || BULKY_KEYS.test(key)) continue;
    if (value === null || ['number', 'boolean'].includes(typeof value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= 200) out[key] = value;
    else if (Array.isArray(value) && value.length <= 20 && value.every(v => typeof v !== 'object')) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
};

export function writeAuditLog({ user, action, category, target = '', summary = '', method = null, path = null, statusCode = null, ip = '', details = null }) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, user_role, action, category, target, summary, method, path, status_code, ip, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user?.id || null, user?.name || 'Publik (tanpa login)', user?.role || null, action, category, target, summary,
      method, path, statusCode, ip, details ? JSON.stringify(details) : null);
  } catch (e) {
    console.error('Audit log write failed:', e.message);
  }
}

// Records every mutation made by a logged-in user, plus denied attempts (403).
export function auditTrail(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const path = req.path.replace(/\/+$/, '') || '/';
  if (path.startsWith('/auth/')) return next(); // login/logout are logged by the auth routes

  const found = findAuditRule(req.method, path);
  let before = null;
  try { before = found?.rule.before ? found.rule.before(found.match, req) : null; } catch (e) { before = null; }
  // Chat (AGENTS.md §38): message text never reaches the audit log, not even in a denied attempt
  const bodySnapshot = path.startsWith('/chat/') ? null : safeDetails(req.body);

  res.on('finish', () => {
    const user = req.user;
    const status = res.statusCode;
    if (!user) return;
    // Routes that write their own detailed entries (operational layer) or are not worth logging (notification reads)
    if ((req.skipAudit || path.startsWith('/notifications')) && status !== 403) return; // anonymous public actions (bookings, facility requests) are tracked in their own tables
    if (status >= 400 && status !== 403) return;

    const base = { user, method: req.method, path: `/api${path}`, statusCode: status, ip: clientIp(req), details: bodySnapshot };
    if (status === 403) {
      writeAuditLog({ ...base, category: 'Keamanan', action: 'Akses ditolak', target: `${req.method} /api${path}` });
      return;
    }

    let described = {};
    try { described = found?.rule.describe ? found.rule.describe(req, found.match, before) : {}; } catch (e) { described = {}; }
    const action = found?.rule.action || `${req.method} /api${path}`;
    const category = found?.rule.category || 'Lainnya';
    const target = described.target || '';

    if (found?.rule.coalesce) {
      // Collapse repeated autosaves of the same target by the same user into one entry
      const recent = db.prepare(`
        SELECT id, details_json FROM audit_logs
        WHERE user_id = ? AND action = ? AND target = ? AND created_at >= datetime('now', ?)
        ORDER BY id DESC LIMIT 1
      `).get(user.id, action, target, `-${COALESCE_MINUTES} minutes`);
      if (recent) {
        const count = (JSON.parse(recent.details_json || '{}').saveCount || 1) + 1;
        db.prepare(`UPDATE audit_logs SET created_at = CURRENT_TIMESTAMP, summary = ?, details_json = ? WHERE id = ?`)
          .run(`${count}x disimpan dalam ${COALESCE_MINUTES} menit terakhir`, JSON.stringify({ ...(bodySnapshot || {}), saveCount: count }), recent.id);
        return;
      }
    }

    writeAuditLog({ ...base, category, action, target, summary: described.summary || '' });
  });
  next();
}
