import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Pencil, X, ShieldCheck, Wallet, Briefcase, Eye, EyeOff, UserCog, HardHat, Wrench, Package } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const ROLE_OPTIONS = [
  {
    key: 'superadmin',
    label: 'Super Admin',
    description: 'Akses penuh ke seluruh menu, termasuk manajemen user & pengaturan sistem',
    icon: ShieldCheck,
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  {
    key: 'finance',
    label: 'Keuangan',
    description: 'Mengelola invoice, status pembayaran, dan laporan keuangan',
    icon: Wallet,
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  {
    key: 'sales',
    label: 'Sales',
    description: 'Mengelola booking booth, data exhibitor, dan floorplan',
    icon: Briefcase,
    badge: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  {
    key: 'operations',
    label: 'Operasional',
    description: 'Mengelola Denah Operasional (listrik, CCTV, APAR, setup booth) tanpa akses harga & tagihan',
    icon: HardHat,
    badge: 'bg-orange-50 text-orange-700 border-orange-200'
  },
  {
    key: 'developer',
    label: 'Developer',
    description: 'Memantau error website di Pusat Maintenance tanpa akses data tenant, harga & tagihan',
    icon: Wrench,
    badge: 'bg-sky-50 text-sky-700 border-sky-200'
  },
  {
    key: 'facility',
    label: 'Fasilitas',
    description: 'Hanya membuka menu Fasilitas: formulir, pengajuan tenant, dan invoice fasilitas',
    icon: Package,
    badge: 'bg-teal-50 text-teal-700 border-teal-200'
  }
];
const ROLE_MAP = Object.fromEntries(ROLE_OPTIONS.map(r => [r.key, r]));
const MIN_PASSWORD_LENGTH = 6;

const EMPTY_FORM = { name: '', email: '', phone: '', role: 'sales', password: '', isActive: true };

const formatDate = (value, withTime = false) => {
  if (!value) return '-';
  // SQLite CURRENT_TIMESTAMP is UTC without a timezone suffix
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (isNaN(d)) return '-';
  return withTime
    ? d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

function UserFormModal({ isOpen, editingUser, currentUserId, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = Boolean(editingUser);
  // Own account: role & status are locked so an admin cannot lock themselves out
  const isSelf = isEdit && editingUser.id === currentUserId;

  useEffect(() => {
    if (!isOpen) return;
    setForm(editingUser ? {
      name: editingUser.name,
      email: editingUser.email,
      phone: editingUser.phone || '',
      role: editingUser.role,
      password: '',
      isActive: editingUser.isActive
    } : EMPTY_FORM);
    setShowPassword(false);
    setError('');
    setIsSaving(false);
  }, [isOpen, editingUser]);

  if (!isOpen) return null;

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) return setError('Nama user wajib diisi');
    if (!form.email.trim()) return setError('Email wajib diisi');
    if (!isEdit && form.password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
    }
    if (isEdit && form.password && form.password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Password baru minimal ${MIN_PASSWORD_LENGTH} karakter`);
    }

    const payload = { ...form };
    if (isEdit && !payload.password) delete payload.password;

    setIsSaving(true);
    const res = isEdit ? await api.updateUser(editingUser.id, payload) : await api.createUser(payload);
    setIsSaving(false);

    if (!res?.success) {
      setError(res?.error || 'Gagal menyimpan user');
      return;
    }
    onSaved(res.message);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              {isEdit ? <Pencil size={17} /> : <UserPlus size={17} />}
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">{isEdit ? 'Edit User' : 'Tambah User Baru'}</h3>
              <p className="text-xs text-slate-500">{isEdit ? `Perbarui data akun ${editingUser.name}` : 'Buat akun baru dan tentukan role aksesnya'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3.5">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Nama Lengkap</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="cth. Andi Pratama"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="nama@perusahaan.com"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">No. Telepon <span className="font-normal text-slate-400">(opsional)</span></label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="08xxxxxxxxxx"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Role</label>
            <div className="grid grid-cols-1 gap-2">
              {ROLE_OPTIONS.map(role => {
                const Icon = role.icon;
                const selected = form.role === role.key;
                return (
                  <button
                    type="button"
                    key={role.key}
                    onClick={() => setField('role', role.key)}
                    disabled={isSelf && !selected}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      selected ? 'border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center ${role.badge}`}>
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800">{role.label}</div>
                      <div className="text-[11px] text-slate-500">{role.description}</div>
                    </div>
                    <div className={`ml-auto mt-1 w-4 h-4 shrink-0 rounded-full border-2 ${selected ? 'border-indigo-600 bg-indigo-600 shadow-[inset_0_0_0_2px_white]' : 'border-slate-300'}`} />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isEdit ? 'Password Baru' : 'Password'}
              {isEdit && <span className="font-normal text-slate-400"> (kosongkan jika tidak diganti)</span>}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder={`Minimal ${MIN_PASSWORD_LENGTH} karakter`}
                autoComplete="new-password"
                className="w-full pl-3 pr-10 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                title={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div>
              <div className="text-xs font-bold text-slate-800">Status Akun</div>
              <div className="text-[11px] text-slate-500">
                {isSelf ? 'Role & status akun Anda sendiri tidak dapat diubah' : 'User nonaktif langsung keluar & tidak dapat login'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setField('isActive', !form.isActive)}
              disabled={isSelf}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                form.isActive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-500 hover:bg-slate-600'
              }`}
            >
              {form.isActive ? 'Aktif' : 'Nonaktif'}
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">
            Batal
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Tambah User'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadUsers = async () => {
    setIsLoading(true);
    setUsers(await api.fetchUsers());
    setIsLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    setIsFormOpen(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setIsFormOpen(true);
  };

  const handleSaved = (message) => {
    setIsFormOpen(false);
    setEditingUser(null);
    showToast(message || 'User berhasil disimpan');
    loadUsers();
  };

  const term = searchTerm.trim().toLowerCase();
  const filteredUsers = users.filter(u =>
    (roleFilter === 'all' || u.role === roleFilter) &&
    (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || (u.phone || '').includes(term))
  );
  const roleCounts = Object.fromEntries(ROLE_OPTIONS.map(r => [r.key, users.filter(u => u.role === r.key).length]));

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full animate-fadeIn">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-1">Manajemen User & Role</h1>
          <p className="text-slate-500 text-xs sm:text-sm">
            Kelola akun tim Super Admin, Keuangan, dan Sales beserta hak aksesnya.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari nama / email..."
              className="bg-transparent text-xs text-slate-800 focus:outline-none w-44"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer shadow-2xs"
          >
            <option value="all">Semua Role ({users.length})</option>
            {ROLE_OPTIONS.map(r => (
              <option key={r.key} value={r.key}>{r.label} ({roleCounts[r.key]})</option>
            ))}
          </select>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors"
          >
            <UserPlus size={14} /> Tambah User
          </button>
        </div>
      </div>

      {/* Role Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {ROLE_OPTIONS.map(role => {
          const Icon = role.icon;
          return (
            <button
              key={role.key}
              onClick={() => setRoleFilter(roleFilter === role.key ? 'all' : role.key)}
              className={`flex items-center gap-3 p-3.5 bg-white rounded-xl border text-left transition-all ${
                roleFilter === role.key ? 'border-indigo-400 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center ${role.badge}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800">{role.label}</div>
                <div className="text-[11px] text-slate-500 truncate">{role.description}</div>
              </div>
              <div className="ml-auto text-xl font-black text-slate-900">{roleCounts[role.key]}</div>
            </button>
          );
        })}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-3.5 py-3">User</th>
                <th className="px-3.5 py-3">Role</th>
                <th className="px-3.5 py-3">No. Telepon</th>
                <th className="px-3.5 py-3">Status</th>
                <th className="px-3.5 py-3">Login Terakhir</th>
                <th className="px-3.5 py-3">Dibuat</th>
                <th className="px-3.5 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="px-3.5 py-10 text-center text-xs text-slate-400">Memuat data user...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3.5 py-10 text-center">
                    <UserCog size={28} className="mx-auto text-slate-300 mb-2" />
                    <div className="text-xs text-slate-500">
                      {users.length === 0 ? 'Belum ada user. Klik "Tambah User" untuk membuat akun.' : 'Tidak ada user yang cocok dengan filter.'}
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.map(user => {
                const role = ROLE_MAP[user.role];
                const RoleIcon = role?.icon || UserCog;
                return (
                  <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 shrink-0 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
                          {user.name.trim().charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-xs truncate max-w-[220px]">
                            {user.name}
                            {user.id === currentUser?.id && <span className="ml-1.5 text-[10px] font-bold text-indigo-600">(Anda)</span>}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3.5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${role?.badge || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        <RoleIcon size={11} /> {role?.label || user.role}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-xs text-slate-600">{user.phone || '-'}</td>
                    <td className="px-3.5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${user.isActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {user.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-xs text-slate-500">{user.lastLoginAt ? formatDate(user.lastLoginAt, true) : 'Belum pernah'}</td>
                    <td className="px-3.5 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                    <td className="px-3.5 py-3 text-right">
                      <button
                        onClick={() => openEdit(user)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <UserFormModal
        isOpen={isFormOpen}
        editingUser={editingUser}
        currentUserId={currentUser?.id}
        onClose={() => setIsFormOpen(false)}
        onSaved={handleSaved}
      />

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[60] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow-xl animate-fadeIn">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
