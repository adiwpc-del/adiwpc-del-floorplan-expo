import crypto from 'crypto';
import db from '../db.js';

export const SESSION_TTL_HOURS = 12;

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hashToken(token), userId, clientIp(req), (req.headers['user-agent'] || '').slice(0, 250), expiresAt);
  return { token, expiresAt };
}

export const revokeUserSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

export const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

const readBearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

// Resolves req.user from the bearer token when present. Never rejects on its own:
// access decisions are made by `enforceAccessPolicy` so public endpoints keep working.
// The user of a session token, or null (unknown, expired or deactivated: the session is removed).
// Shared by the API and the chat socket (AGENTS.md §38), so both accept exactly the same logins.
export function userFromToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT s.token_hash, s.expires_at, u.id, u.name, u.email, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);

  if (!row || !row.is_active || new Date(row.expires_at) < new Date()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  db.prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run(tokenHash);
  return { user: { id: row.id, name: row.name, email: row.email, role: row.role }, tokenHash };
}

export function authenticate(req, res, next) {
  const token = readBearer(req);
  if (!token) return next();

  const session = userFromToken(token);
  if (!session) {
    req.authError = 'Sesi login sudah berakhir, silakan login kembali';
    return next();
  }
  req.user = session.user;
  req.sessionTokenHash = session.tokenHash;
  next();
}

// ---------------------------------------------------------------------------
// Access policy (first matching rule wins; anything unmatched requires login).
//   'public' = no login, 'staff' = any logged-in user, or a list of roles.
//   Super Admin is allowed everywhere.
// ---------------------------------------------------------------------------
const SALES = ['sales'];
const FINANCE = ['finance'];
const OPERATIONS = ['operations'];
const DEVELOPER = ['developer'];
const FACILITY = ['facility'];
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];

const ACCESS_RULES = [
  // Auth
  { methods: ['POST'], path: /^\/auth\/login$/, access: 'public' },

  // Health
  { methods: ['GET'], path: /^\/health$/, access: 'public' },

  // Floorplan: admin-only listings first, then public read-only views used by the Live Floorplan portal
  { methods: ['GET'], path: /^\/floorplan\/(list|presets|trash|activity-logs)$/, access: 'staff' },
  { methods: ['GET'], path: /^\/floorplan\/(events|active|[^/]+)$/, access: 'public' },
  { methods: ['POST'], path: /^\/floorplan\/permanent-delete$/, access: [] },
  { methods: ['DELETE'], path: /^\/floorplan\/presets\/[^/]+$/, access: [] },
  // Editing a floorplan (save, publish, presets, merge display...): Super Admin and Operations. Sales only views the
  // Studio and registers tenants (POST /orders/checkout below); Operations does both (every Property Inspector feature).
  { methods: WRITE, path: /^\/floorplan(\/.*)?$/, access: OPERATIONS },

  // Public booking checkout (staff bookings are recognised via the session) & returning-client lookup
  { methods: ['POST'], path: /^\/(orders|exhibitors)\/checkout$/, access: 'public' },
  { methods: ['GET'], path: /^\/(orders|exhibitors)\/check-client$/, access: 'public' },

  // Uploaded images: served to everyone (the Live Floorplan shows the blueprint); stored by roles that edit a floorplan
  // (Super Admin, Operations) or the invoice layout (Finance)
  { methods: ['GET'], path: /^\/uploads\/[^/]+$/, access: 'public' },
  { methods: ['POST'], path: /^\/uploads$/, access: [...OPERATIONS, ...FINANCE] },

  // Booth actions of the Sales pop up in the Studio (summary, "Beri Diskon" with the Sales limit, "Buat Invoice")
  { methods: ['GET', ...WRITE], path: /^\/booth-actions(\/.*)?$/, access: [...SALES, ...FINANCE] },

  // Invoices: finance owns billing, including the private booth discount (sales reads invoices only)
  { methods: ['GET'], path: /^\/invoices\/config$/, access: 'public' },
  // Invoice PDF: staff, or a registrant with the signed token of the checkout response (checked in the handler)
  { methods: ['GET'], path: /^\/invoices\/[^/]+\/pdf$/, access: 'public' },
  // "Simpan Diskon" of the Property Inspector: Finance, and Operations in the Studio
  { methods: ['POST'], path: /^\/invoices\/sync-booth-discount$/, access: [...FINANCE, ...OPERATIONS] },
  // Tempat Sampah Invoice (list, restore): Super Admin only. Deleting: Finance + Super Admin (shared/invoicePermissions.js)
  { methods: ['GET'], path: /^\/invoices\/trash$/, access: [] },
  { methods: ['POST'], path: /^\/invoices\/[^/]+\/restore$/, access: [] },
  { methods: WRITE, path: /^\/invoices(\/.*)?$/, access: FINANCE },

  // Hapus Tenant & Urungkan: Super Admin only (shared/tenantPermissions.js)
  { methods: ['GET', ...WRITE], path: /^\/tenants(\/.*)?$/, access: [] },

  // "Samakan Semua Harga dengan Template": Super Admin and Finance (Operasional: 403)
  { methods: ['GET', ...WRITE], path: /^\/template-prices(\/.*)?$/, access: FINANCE },

  // Master data read by the public booking form; edited by the Super Admin only (Studio tiers & brand categories)
  { methods: ['GET'], path: /^\/(categories|brand-categories|payment-methods)$/, access: 'public' },
  { methods: WRITE, path: /^\/(categories|brand-categories)(\/.*)?$/, access: OPERATIONS },
  { methods: WRITE, path: /^\/payment-methods(\/.*)?$/, access: [] },

  // Facility portal (tenant forms are public). The Fasilitas menu (forms, requests, status, facility invoice, tenant
  // list for broadcast) is used by Finance, Sales, Operations and the Fasilitas role too (AGENTS.md §46)
  { methods: ['GET'], path: /^\/facilities\/forms(\/[^/]+)?$/, access: 'public' },
  { methods: ['POST'], path: /^\/facilities\/requests\/submit$/, access: 'public' },
  { methods: ['GET', ...WRITE], path: /^\/facilities(\/.*)?$/, access: [...FINANCE, ...SALES, ...OPERATIONS, ...FACILITY] },

  // Denah Operasional: the operations team edits its own layer; sales only views it (overlay in the sales Studio)
  { methods: ['GET'], path: /^\/ops\/[^/]+\/public$/, access: 'public' },
  { methods: ['GET'], path: /^\/ops(\/.*)?$/, access: [...OPERATIONS, ...SALES] },
  { methods: ['POST'], path: /^\/ops\/[^/]+\/copy-from$/, access: OPERATIONS },
  { methods: WRITE, path: /^\/ops(\/.*)?$/, access: OPERATIONS },

  // Pusat Maintenance: browser error reports are public (scrubbed + rate limited), the center itself is Developer / Super Admin
  { methods: ['POST'], path: /^\/errors\/report$/, access: 'public' },
  // WhatsApp (Fonnte) assistant webhook (AGENTS.md §45): public path, the secret in the URL is checked by the handler
  { methods: ['POST'], path: /^\/whatsapp\/webhook\/[^/]+$/, access: 'public' },
  // The Claude API key is managed by the Super Admin only (write-only, never returned)
  { methods: ['GET', ...WRITE], path: /^\/maintenance\/(ai-key|ai-config|ai-models|whatsapp)(\/.*)?$/, access: [] },
  { methods: ['GET', ...WRITE], path: /^\/maintenance(\/.*)?$/, access: DEVELOPER },

  // In-app notifications of the logged-in user
  { methods: ['GET', 'POST'], path: /^\/notifications(\/.*)?$/, access: 'staff' },
  // Chat antar staf (AGENTS.md §38): every logged-in staff member; groups are managed by the Super Admin (handler)
  { methods: ['GET', ...WRITE], path: /^\/chat(\/.*)?$/, access: 'staff' },

  // User management & audit trail
  { methods: ['GET'], path: /^\/users\/roles$/, access: 'staff' },
  { methods: ['GET', ...WRITE], path: /^\/(users|audit-logs)(\/.*)?$/, access: [] }
];

// Operations: Denah Operasional, plus the Studio (floorplan, tiers, brand categories) as an editor, with every
// Property Inspector feature: tenant registration / biodata / release and the private booth discount, and the
// Fasilitas menu (§46). Never the invoice, exhibitor, stats, settings or user pages.
const OPERATIONS_AREA = [
  /^\/ops(\/.*)?$/, /^\/floorplan(\/.*)?$/, /^\/(categories|brand-categories)(\/.*)?$/, /^\/uploads(\/.*)?$/,
  /^\/orders\/(checkout|check-client|registered-clients|update-tenant|detach-tenant)$/, /^\/invoices\/sync-booth-discount$/,
  /^\/facilities(\/.*)?$/,
  /^\/notifications(\/.*)?$/, /^\/chat(\/.*)?$/, /^\/auth\//, /^\/users\/roles$/, /^\/health$/
];
// Developer: only the Pusat Maintenance (never tenant, price, invoice or user data)
const DEVELOPER_AREA = [/^\/maintenance(\/.*)?$/, /^\/notifications(\/.*)?$/, /^\/chat(\/.*)?$/, /^\/auth\//, /^\/users\/roles$/, /^\/health$/];
// Fasilitas: only the Fasilitas menu (never the Studio, exhibitors, invoices pages, stats, settings or users)
const FACILITY_AREA = [/^\/facilities(\/.*)?$/, /^\/notifications(\/.*)?$/, /^\/chat(\/.*)?$/, /^\/auth\//, /^\/users\/roles$/, /^\/health$/];
// Roles limited to their own area; on public endpoints they are treated as anonymous visitors
const RESTRICTED_AREAS = {
  operations: { area: OPERATIONS_AREA, error: 'Role Operasional hanya dapat mengakses Studio dan Denah Operasional' },
  developer: { area: DEVELOPER_AREA, error: 'Role Developer hanya dapat mengakses Pusat Maintenance' },
  facility: { area: FACILITY_AREA, error: 'Role Fasilitas hanya dapat mengakses menu Fasilitas' }
};

const findRule = (method, path) =>
  ACCESS_RULES.find(r => r.methods.includes(method) && r.path.test(path));

export function enforceAccessPolicy(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const path = req.path.replace(/\/+$/, '') || '/';
  const rule = findRule(req.method, path);
  const access = rule ? rule.access : 'staff';

  const restricted = RESTRICTED_AREAS[req.user?.role];
  if (rule?.denyRoles?.includes(req.user?.role)) {
    return res.status(403).json({ success: false, error: rule.denyMessage || 'Role Anda tidak memiliki akses untuk tindakan ini', code: 'FORBIDDEN' });
  }
  if (access === 'public') {
    // Operations / developer accounts see public endpoints outside their own area exactly like a visitor (published
    // data only, no staff extras). `restrictedUser` keeps who they are for masked error reports only.
    // Inside their area (e.g. the floorplan for Operations) they stay staff: the Studio needs drafts and full data.
    if (restricted && !restricted.area.some(re => re.test(path))) {
      req.restrictedUser = req.user;
      req.user = undefined;
    }
    return next();
  }

  // Operations / developer accounts only reach their own area (plus notifications and their own account), never
  // sales / billing data behind generic "staff" endpoints (prices, discounts, invoices, exhibitors)
  if (restricted && !restricted.area.some(re => re.test(path))) {
    return res.status(403).json({ success: false, error: restricted.error, code: 'FORBIDDEN' });
  }

  if (!req.user) {
    return res.status(401).json({ success: false, error: req.authError || 'Silakan login terlebih dahulu', code: 'UNAUTHENTICATED' });
  }
  if (access === 'staff' || req.user.role === 'superadmin' || access.includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Role Anda tidak memiliki akses untuk tindakan ini', code: 'FORBIDDEN' });
}

// Names recorded on bookings, deletions, etc. come from the session, never from the request body.
const ACTOR_FIELDS = ['adminName', 'deletedBy', 'restoredBy', 'confirmedBy', 'registeredBy'];

export function stampActorIdentity(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return next();

  if (req.user) {
    ACTOR_FIELDS.forEach(field => {
      if (field in req.body || field === 'adminName') req.body[field] = req.user.name;
    });
  } else {
    // Anonymous visitors cannot register a booking "as admin"
    ACTOR_FIELDS.forEach(field => { delete req.body[field]; });
    if (req.body.source === 'admin') req.body.source = 'online';
    delete req.body.isAdmin;
  }
  next();
}
