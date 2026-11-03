import express from 'express';
import db from '../db.js';
import { hashPassword } from '../utils/password.js';
import { revokeUserSessions } from '../middleware/auth.js';
import { disconnectUser } from '../utils/chatSocket.js';

const router = express.Router();

export const USER_ROLES = [
  { key: 'superadmin', label: 'Super Admin', description: 'Akses penuh ke seluruh menu, termasuk manajemen user & pengaturan sistem' },
  { key: 'finance', label: 'Keuangan', description: 'Mengelola invoice, status pembayaran, dan laporan keuangan' },
  { key: 'sales', label: 'Sales', description: 'Mengelola booking booth, data exhibitor, dan floorplan' },
  { key: 'operations', label: 'Operasional', description: 'Mengelola Denah Operasional (listrik, CCTV, APAR, setup booth) tanpa akses harga & tagihan' },
  { key: 'developer', label: 'Developer', description: 'Memantau error website di Pusat Maintenance tanpa akses data tenant, harga & tagihan' },
  { key: 'facility', label: 'Fasilitas', description: 'Hanya membuka menu Fasilitas: formulir, pengajuan tenant, dan invoice fasilitas' }
];
const ROLE_KEYS = USER_ROLES.map(r => r.key);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

// Never expose password_hash to the client
const toUserDto = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone || '',
  role: u.role,
  isActive: Boolean(u.is_active),
  lastLoginAt: u.last_login_at || null,
  createdAt: u.created_at,
  updatedAt: u.updated_at
});

const countOtherActiveSuperadmins = (excludeId) =>
  db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'superadmin' AND is_active = 1 AND id != ?`).get(excludeId).count;

// GET /api/users/roles - List available roles
router.get('/roles', (req, res) => {
  res.json({ success: true, roles: USER_ROLES });
});

// GET /api/users - List all users
router.get('/', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(toUserDto);
    res.json({ success: true, users });
  } catch (error) {
    console.error("Fetch users error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/users - Create a new user
router.post('/', (req, res) => {
  try {
    const { name = '', email = '', phone = '', role, password = '', isActive = true } = req.body;
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) return res.status(400).json({ success: false, error: 'Nama user wajib diisi' });
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ success: false, error: 'Format email tidak valid' });
    if (!ROLE_KEYS.includes(role)) return res.status(400).json({ success: false, error: 'Role tidak valid' });
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ success: false, error: `Password minimal ${MIN_PASSWORD_LENGTH} karakter` });
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) {
      return res.status(409).json({ success: false, error: 'Email sudah digunakan oleh user lain' });
    }

    const id = `usr_${Date.now()}`;
    db.prepare(`
      INSERT INTO users (id, name, email, phone, role, password_hash, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanName, cleanEmail, phone.trim(), role, hashPassword(password), isActive ? 1 : 0);

    const user = toUserDto(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    res.json({ success: true, message: `User "${cleanName}" berhasil ditambahkan!`, user });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/users/:id - Update a user (password is only changed when provided)
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, role, password, isActive } = req.body;

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });

    const updates = [];
    const params = [];

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, error: 'Nama user wajib diisi' });
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (email !== undefined) {
      const cleanEmail = email.trim().toLowerCase();
      if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ success: false, error: 'Format email tidak valid' });
      if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanEmail, id)) {
        return res.status(409).json({ success: false, error: 'Email sudah digunakan oleh user lain' });
      }
      updates.push('email = ?');
      params.push(cleanEmail);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone.trim());
    }
    if (role !== undefined) {
      if (!ROLE_KEYS.includes(role)) return res.status(400).json({ success: false, error: 'Role tidak valid' });
      updates.push('role = ?');
      params.push(role);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ success: false, error: `Password minimal ${MIN_PASSWORD_LENGTH} karakter` });
      }
      updates.push('password_hash = ?');
      params.push(hashPassword(password));
    }

    // Safety lock: nobody can lock themselves out by deactivating or demoting their own account
    if (req.user?.id === id && ((isActive !== undefined && !isActive) || (role !== undefined && role !== existing.role))) {
      return res.status(400).json({ success: false, error: 'Anda tidak dapat menonaktifkan atau mengubah role akun Anda sendiri' });
    }

    // Safety lock: always keep at least one active Super Admin
    const willStaySuperadmin = (role ?? existing.role) === 'superadmin' && (isActive ?? Boolean(existing.is_active));
    if (existing.role === 'superadmin' && existing.is_active && !willStaySuperadmin && countOtherActiveSuperadmins(id) === 0) {
      return res.status(400).json({ success: false, error: 'Minimal harus ada 1 Super Admin yang aktif' });
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    // Deactivation, role change or password reset takes effect immediately: sign the user out everywhere
    const roleChanged = role !== undefined && role !== existing.role;
    const deactivated = isActive !== undefined && !isActive && existing.is_active;
    if ((roleChanged || deactivated || password) && req.user?.id !== id) {
      revokeUserSessions(id);
      disconnectUser(id);
    }

    const user = toUserDto(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    res.json({ success: true, message: `User "${user.name}" berhasil diperbarui!`, user });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
