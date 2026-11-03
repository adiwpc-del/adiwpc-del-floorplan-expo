// Role Fasilitas (AGENTS.md §46): only the Fasilitas menu. The users table is rebuilt once to allow the role.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { startServer } from './helpers.js';
import { hashPassword } from '../src/utils/password.js';

let s;
const EMAIL = 'fasilitas@expo.test';
const PASSWORD = 'fasilitas123';

before(async () => {
  s = await startServer({}, { credentials: { facility: [EMAIL, PASSWORD] } });
  const r = await s.api('POST', '/users', { name: 'Tim Fasilitas', email: EMAIL, role: 'facility', password: PASSWORD }, { as: 'superadmin' });
  assert.ok([200, 201].includes(r.status), r.text);
});
after(() => s.stop());

test('role Fasilitas memakai seluruh menu Fasilitas: pengajuan, invoice fasilitas, batalkan, kategori, chat', async () => {
  const as = { as: 'facility' };
  const sub = await s.api('POST', '/facilities/requests/submit', {
    booth_code: 'A-01', company_name: 'Kopi Satu', pic_name: 'Budi', items: [{ name: 'Listrik', price: 1000, qty: 1 }]
  });
  const id = sub.body.request.id;
  assert.equal((await s.api('GET', '/facilities/requests', undefined, as)).status, 200);
  assert.equal((await s.api('GET', '/facilities/categories', undefined, as)).status, 200);
  assert.equal((await s.api('GET', '/facilities/tenants?projectId=global', undefined, as)).status, 200);
  assert.equal((await s.api('PUT', `/facilities/requests/${id}/status`, { status: 'APPROVED' }, as)).status, 200);
  assert.equal((await s.api('POST', `/facilities/requests/${id}/generate-invoice`, undefined, as)).status, 200);
  assert.equal((await s.api('POST', `/facilities/requests/${id}/cancel-invoice`, { reason: 'Tenant tidak jadi ikut', outcome: 'rejected' }, as)).status, 200);
  assert.equal((await s.api('GET', '/notifications', undefined, as)).status, 200);
  assert.equal((await s.api('GET', '/chat/conversations', undefined, as)).status, 200);
});

test('role Fasilitas tidak bisa membuka menu lain', async () => {
  const as = { as: 'facility' };
  for (const url of ['/stats', '/invoices', '/orders', '/exhibitors', '/users', '/audit-logs', '/floorplan/list', '/ops/x', '/maintenance/errors', '/booth-actions/summary', '/tenants/trash', '/invoices/trash']) {
    assert.equal((await s.api('GET', url, undefined, as)).status, 403, url);
  }
  assert.equal((await s.api('POST', '/floorplan/save', {}, as)).status, 403);
  assert.equal((await s.api('POST', '/invoices', {}, as)).status, 403);
  assert.equal((await s.api('GET', '/invoices/inv_x/pdf', undefined, as)).status, 401, 'di endpoint publik dianggap pengunjung');
});

test('database lama: tabel users dibangun ulang sekali; akun dan sesi login tetap, ada salinan sebelum migrasi', async () => {
  const old = await startServer({}, {
    credentials: { superadmin: ['lama@expo.test', 'lama12345'] },
    prepare: (dir) => {
      const db = new Database(path.join(dir, 'floorplan.db'));
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT DEFAULT '',
          role TEXT NOT NULL CHECK (role IN ('superadmin', 'finance', 'sales', 'operations', 'developer')),
          password_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1, last_login_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip TEXT DEFAULT '', user_agent TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL
        );
      `);
      db.prepare("INSERT INTO users (id, name, email, role, password_hash) VALUES ('usr_lama', 'Lama', 'lama@expo.test', 'superadmin', ?)").run(hashPassword('lama12345'));
      db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h1', 'usr_lama', '2099-01-01')").run();
      db.close();
    }
  });
  try {
    const r = await old.api('POST', '/users', { name: 'Fas', email: 'f@expo.test', role: 'facility', password: 'fasilitas123' }, { as: 'superadmin' });
    assert.ok([200, 201].includes(r.status), r.text);
    const db = new Database(path.join(old.dataDir, 'floorplan.db'), { readonly: true });
    assert.equal(db.prepare("SELECT role FROM users WHERE id = 'usr_lama'").get().role, 'superadmin');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'h1'").get().n, 1, 'sesi login tidak ikut terhapus');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    db.close();
    assert.ok(fs.readdirSync(path.join(old.dataDir, 'backups')).some(f => f.startsWith('pre-migration_role-fasilitas_')));
  } finally { await old.stop(); }
});
