import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Map, Users, Settings, ArrowLeft, FileText, PackagePlus, UserCog, ScrollText, LogOut, KeyRound, X, HardHat, Activity } from 'lucide-react';
import NotificationBell from './NotificationBell';
import InstallAppButton from './InstallAppButton';
import ChatDock from '../chat/ChatDock';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { canAccessPage, ROLE_LABELS } from '../../utils/roles';

const MAIN_NAV = [
  { page: 'analytics', to: '/admin/analytics', icon: LayoutDashboard, label: 'Dashboard', title: 'Dashboard & Analytics' },
  { page: 'floorplan', to: '/admin/floorplan', icon: Map, label: 'Studio', title: 'Floorplan Studio' },
  { page: 'ops', to: '/admin/ops', icon: HardHat, label: 'Operasional', title: 'Denah Operasional (listrik, CCTV, APAR, setup booth)' },
  { page: 'exhibitors', to: '/admin/exhibitors', icon: Users, label: 'Exhibitor', title: 'Exhibitor Directory' },
  { page: 'invoices', to: '/admin/invoices', icon: FileText, label: 'Invoice', title: 'Manajemen Invoice & Tagihan (A4)' },
  { page: 'facilities', to: '/admin/facilities', icon: PackagePlus, label: 'Fasilitas', title: 'Formulir Fasilitas Tambahan (Add-ons)' }
];

const UTILITY_NAV = [
  { page: 'maintenance', to: '/admin/maintenance', icon: Activity, label: 'Maintenance', title: 'Pusat Maintenance (error website)' },
  { page: 'audit', to: '/admin/audit', icon: ScrollText, label: 'Audit', title: 'Log Audit Aktivitas User' },
  { page: 'users', to: '/admin/users', icon: UserCog, label: 'User', title: 'Manajemen User & Role' },
  { page: 'settings', to: '/admin/settings', icon: Settings, label: 'Setting', title: 'Pengaturan & Konfigurasi Sistem' }
];

const navClass = ({ isActive }) => `w-full py-2.5 px-1.5 flex flex-col items-center justify-center rounded-xl transition-colors group ${
  isActive
    ? 'bg-slate-800 text-white font-medium border border-slate-700/70 shadow-xs'
    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
}`;

function NavItem({ item }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} className={navClass} title={item.title}>
      <Icon size={19} className="transition-transform group-hover:scale-110" />
      <span className="text-[10px] tracking-tight mt-1 text-center font-medium leading-tight truncate max-w-full">
        {item.label}
      </span>
    </NavLink>
  );
}

function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) return setMessage({ type: 'error', text: 'Password baru minimal 6 karakter' });
    if (newPassword !== confirmPassword) return setMessage({ type: 'error', text: 'Konfirmasi password baru tidak sama' });
    setIsSaving(true);
    const res = await api.changePassword(currentPassword, newPassword);
    setIsSaving(false);
    if (!res?.success) return setMessage({ type: 'error', text: res?.error || 'Gagal mengganti password' });
    setMessage({ type: 'success', text: 'Password berhasil diganti. Sesi di perangkat lain telah dikeluarkan.' });
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
  };

  const inputClass = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-base flex items-center gap-2"><KeyRound size={17} className="text-slate-700" /> Ganti Password</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Password Saat Ini</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={inputClass} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Password Baru</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="Minimal 6 karakter" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Ulangi Password Baru</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
          </div>
          {message && (
            <div className={`px-3 py-2 rounded-lg text-xs font-medium border ${message.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              {message.text}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">Tutup</button>
          <button type="submit" disabled={isSaving} className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60">
            {isSaving ? 'Menyimpan...' : 'Simpan Password'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, storageBlocked } = useAuth();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const isFloorplan = location.pathname.includes('/floorplan') || location.pathname.startsWith('/admin/ops');

  const visibleMain = MAIN_NAV.filter(item => canAccessPage(user?.role, item.page));
  const visibleUtility = UTILITY_NAV.filter(item => canAccessPage(user?.role, item.page));
  const initial = (user?.name || '?').trim().charAt(0).toUpperCase();

  const handleLogout = async () => {
    setIsAccountMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden print:h-auto print:min-h-0 print:overflow-visible print:bg-white print:block">
      {/* Sidebar Navigation (Hidden on Print) */}
      <aside className="w-20 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-4 z-50 print:hidden select-none">
        {/* Logo & App Brand */}
        <div className="flex flex-col items-center gap-1 mb-6">
          <div className="w-9 h-9 bg-slate-800 text-white border border-slate-700/80 rounded-xl flex items-center justify-center shadow-xs">
            <Map className="text-slate-100" size={18} />
          </div>
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
            EXPO
          </span>
        </div>

        {/* Main Navigation with Captions (filtered by role) */}
        <nav className="flex-1 flex flex-col gap-2 w-full px-1.5">
          {visibleMain.map(item => <NavItem key={item.page} item={item} />)}
        </nav>

        {/* Bottom Utility Navigation with Captions */}
        <div className="mt-auto flex flex-col gap-2 w-full px-1.5">
          {visibleUtility.map(item => <NavItem key={item.page} item={item} />)}
          <ChatDock />
          <NotificationBell />
          <InstallAppButton />
          <NavLink
            to="/"
            className="w-full py-2 px-1 flex flex-col items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 transition-all group"
            title="Lihat Sisi Publik (Live Floorplan)"
          >
            <ArrowLeft size={19} className="transition-transform group-hover:-translate-x-0.5" />
            <span className="text-[10px] tracking-tight mt-1 text-center font-medium leading-tight truncate max-w-full">
              Ke Publik
            </span>
          </NavLink>

          {/* Logged-in user & account menu */}
          <div className="relative border-t border-slate-800 pt-2 mt-1">
            <button
              onClick={() => setIsAccountMenuOpen(v => !v)}
              className="w-full py-1.5 flex flex-col items-center rounded-xl hover:bg-slate-800/80 transition-all"
              title={`${user?.name} (${ROLE_LABELS[user?.role] || user?.role})`}
            >
              <div className="w-8 h-8 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center ring-1 ring-slate-600">
                {initial}
              </div>
              <span className="text-[9px] mt-1 font-medium text-slate-400 truncate max-w-full px-1">
                {ROLE_LABELS[user?.role] || user?.role}
              </span>
            </button>

            {isAccountMenuOpen && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setIsAccountMenuOpen(false)} />
                <div className="absolute left-full bottom-0 ml-2 z-[60] w-56 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <div className="text-sm font-bold text-slate-900 truncate">{user?.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{user?.email}</div>
                    <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      {ROLE_LABELS[user?.role] || user?.role}
                    </span>
                  </div>
                  <button
                    onClick={() => { setIsAccountMenuOpen(false); setIsPasswordModalOpen(true); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <KeyRound size={14} /> Ganti Password
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border-t border-slate-100"
                  >
                    <LogOut size={14} /> Keluar (Logout)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`flex-1 flex flex-col min-w-0 print:overflow-visible print:h-auto print:block print:p-0 ${isFloorplan ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {storageBlocked && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900">
            Browser ini memblokir penyimpanan data situs, jadi sesi login hanya berlaku di tab ini dan hilang saat halaman dimuat ulang. Izinkan penyimpanan data (cookies &amp; site data) untuk situs ini agar tetap masuk.
          </div>
        )}
        <Outlet />
      </main>

      {isPasswordModalOpen && <ChangePasswordModal onClose={() => setIsPasswordModalOpen(false)} />}
    </div>
  );
}
