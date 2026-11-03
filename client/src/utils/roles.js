// Role labels & which admin pages each role may open (Super Admin: everything).
// Keep in sync with the server access policy in server/src/middleware/auth.js.
export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  finance: 'Keuangan',
  sales: 'Sales',
  operations: 'Operasional',
  developer: 'Developer',
  facility: 'Fasilitas'
};

// Sales: the Studio (view the floorplan and register tenants, no editing), Data Exhibitor (open / send invoices), Fasilitas
// Operations: the Studio (full editing and tenant registration), Denah Operasional, Fasilitas
// Facility: only Fasilitas
export const PAGE_ACCESS = {
  analytics: ['superadmin', 'finance'],
  floorplan: ['superadmin', 'sales', 'operations'],
  ops: ['superadmin', 'operations'],
  exhibitors: ['superadmin', 'finance', 'sales'],
  invoices: ['superadmin', 'finance'],
  facilities: ['superadmin', 'finance', 'sales', 'operations', 'facility'],
  settings: ['superadmin'],
  users: ['superadmin'],
  audit: ['superadmin'],
  maintenance: ['superadmin', 'developer']
};

// Who may edit a floorplan in the Studio (draw, move, price, save, publish). Sales sees it read-only.
export const canEditFloorplan = (role) => role === 'superadmin' || role === 'operations';
// Who may register / change the tenant of a booth, its status and private discount (Property Inspector of the Studio)
export const canRegisterTenant = (role) => role === 'superadmin' || role === 'sales' || role === 'operations';

export const canAccessPage = (role, page) => Boolean(role && PAGE_ACCESS[page]?.includes(role));

// Landing page after login for each role
export const HOME_PAGE = {
  superadmin: '/admin/analytics',
  finance: '/admin/invoices',
  sales: '/admin/floorplan',
  operations: '/admin/ops',
  developer: '/admin/maintenance',
  facility: '/admin/facilities'
};
