import { apiFetch } from './session';
import { keepDraft, dropDraft } from '../utils/localDraft';

// Nothing large is mirrored in localStorage (AGENTS.md §28): the server is the only source of floorplan data.
// The invoice layout is cached in memory for this page only.
let invoiceConfigCache = null;
export const getCachedInvoiceConfig = () => invoiceConfigCache;

// API address per environment (client/.env: VITE_API_URL); in production defaults to '/api'
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5001/api');

export const api = {
  // 1. Fetch active floorplan from SQLite database with multi-hall support
  // Fingerprint of what the Live Floorplan shows (a few bytes): polled in the background instead of the whole floorplan.
  // null = could not be checked (offline, older server); { notFound: true } = the public link no longer exists.
  async fetchLiveVersion(params = {}) {
    try {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
      const res = await apiFetch(`${API_BASE_URL}/floorplan/live-version${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
      if (res.status === 404) return { notFound: true, version: 'not-found' };
      if (!res.ok) return null;
      const json = await res.json();
      return json?.version ? json : null;
    } catch (e) {
      return null;
    }
  },

  async fetchActiveFloorplan(params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/floorplan/active?_t=${Date.now()}${qs ? `&${qs}` : ''}`, {
        // No custom Pragma/Cache-Control headers: the API's CORS config rejects them (cache: 'no-store' + _t already bust caches)
        cache: 'no-store'
      });
      if (res.status === 404) return null;
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.floorplan) {
          return {
            ...json.floorplan,
            event: json.event,
            halls: json.halls || []
          };
        }
      }
    } catch (e) {
      console.warn("Failed to fetch the active floorplan:", e);
    }

    return null;
  },

  // 1b. Fetch all Events/Projects with their child Halls
  // params.view = 'public' -> only published floorplans (what the Live Denah portal may show)
  async fetchEvents(params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/floorplan/events?_t=${Date.now()}${qs ? `&${qs}` : ''}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          return json.events || [];
        }
      }
    } catch (e) {
      console.warn("Failed to fetch events list:", e);
    }
    return [];
  },

  // 1c. Create a new Hall for an existing Event
  async createHall(payload) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/create-hall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Gagal membuat hall baru' };
    }
  },

  // 2. Fetch all saved floorplan templates
  async fetchFloorplanList(params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/floorplan/list?_t=${Date.now()}${qs ? `&${qs}` : ''}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          return json.floorplans || [];
        }
      }
    } catch (e) {
      console.warn("Failed to fetch floorplan templates list:", e);
    }
    return [];
  },

  // Studio sync (AGENTS.md §39): a tiny fingerprint of the booths' status / tenant; null when it cannot be read
  async fetchBoothVersion(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${encodeURIComponent(id)}/booth-version`, { cache: 'no-store' });
      const json = res.ok ? await res.json() : null;
      return json?.success ? json.version : null;
    } catch (e) {
      return null;
    }
  },

  // 3. Fetch specific floorplan by ID
  async fetchFloorplanById(id, params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${id}?_t=${Date.now()}${qs ? `&${qs}` : ''}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.floorplan) {
          return {
            ...json.floorplan,
            event: json.event,
            halls: json.halls || []
          };
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch floorplan ${id}:`, e);
    }
    return null;
  },

  // 4b. Stop publishing a floorplan (back to draft; its /live/<slug> link stops working)
  // Auto-merge: "Tampilkan Terpisah" / "Gabungkan Kembali" for one merged booth group
  async setMergeDisplay(floorplanId, boothCodes, separate) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${encodeURIComponent(floorplanId)}/merge-display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boothCodes, separate })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async unpublishFloorplan(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${id}/unpublish`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  // 4. Publish a specific floorplan template
  async publishFloorplan(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${id}/publish`, {
        method: 'POST'
      });
      if (res.ok) {
        return await res.json();
      }
      // e.g. 403 for a role that may not publish: pass the server's reason on
      return await res.json().catch(() => ({ success: false, error: `Gagal mempublikasikan (HTTP ${res.status})` }));
    } catch (e) {
      console.warn(`Failed to publish floorplan ${id}:`, e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 5. Duplicate a template
  async duplicateFloorplan(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${id}/duplicate`, {
        method: 'POST'
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn(`Failed to duplicate floorplan ${id}:`, e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 6. Delete a template
  async deleteFloorplan(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn(`Failed to delete floorplan ${id}:`, e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 7. Save Draft or Publish Floorplan to SQLite database
  async saveFloorplan(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        dropDraft(data.id); // the server has it: an older unsaved draft of this floorplan is obsolete
        return json;
      }
      // Session expired, no permission or server error: the change is NOT in the database
      return { success: false, status: res.status, error: json.error || `Server menolak penyimpanan (HTTP ${res.status})` };
    } catch (e) {
      // Server unreachable: keep this canvas in IndexedDB (never localStorage) so it can be restored later
      const kept = await keepDraft(data.id, data, 'Server tidak dapat dihubungi');
      console.warn("Server save failed:", e);
      return { success: false, localOnly: kept, error: kept ? 'Tidak dapat terhubung ke server. Draft disimpan sementara di browser ini.' : 'Tidak dapat terhubung ke server' };
    }
  },

  // 8. Process Exhibitor Order & Checkout in SQLite database
  async checkoutOrder(orderData) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
      // Refusals (booth just booked by someone else, not found, ...) must reach the page: never fake a success
      return await res.json();
    } catch (e) {
      console.warn("checkoutOrder error:", e);
      return { success: false, error: 'Server tidak dapat dihubungi. Pemesanan belum tersimpan, silakan coba lagi.' };
    }
  },

  // 8b. Fetch list of all registered clients for selector & deduplication
  async fetchRegisteredClients() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/orders/registered-clients`);
      if (res.ok) {
        const json = await res.json();
        return json.clients || [];
      }
    } catch (e) {
      console.warn("Failed to fetch registered clients:", e);
    }
    return [];
  },

  // 8c. Check if email or phone is already registered
  async checkExistingExhibitor({ email, phone }) {
    try {
      const params = new URLSearchParams();
      if (email) params.append('email', email);
      if (phone) params.append('phone', phone);
      const res = await apiFetch(`${API_BASE_URL}/orders/check-client?${params.toString()}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to check existing exhibitor:", e);
    }
    return { success: false, exists: false };
  },

  // 8d. Detach tenant from booth
  async detachTenantFromBooth(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/orders/detach-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.error("Failed to detach tenant:", e);
      return { success: false, error: e.message };
    }
  },

  // 8e. Update tenant biodata
  async updateTenantBiodata(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/orders/update-tenant`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.error("Failed to update tenant biodata:", e);
      return { success: false, error: e.message };
    }
  },

  // 9. Fetch All Exhibitors & Transactions (Brand / Tenant Booked Booths) with optional project filter
  async fetchExhibitors(floorplanId) {
    try {
      const query = floorplanId && floorplanId !== 'all' ? `?floorplanId=${encodeURIComponent(floorplanId)}` : '';
      const res = await apiFetch(`${API_BASE_URL}/exhibitors${query}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.exhibitors) {
          return {
            exhibitors: json.exhibitors || [],
            projectsList: json.projectsList || [],
            selectedProjectId: json.selectedProjectId || 'all'
          };
        }
      }
    } catch (e) {
      console.warn("Failed to fetch exhibitors from server", e);
    }

    return {
      exhibitors: [],
      projectsList: [],
      selectedProjectId: 'all'
    };
  },

  // 10. Fetch Dashboard Summary Stats with optional floorplanId
  async fetchStats(floorplanId) {
    try {
      const query = floorplanId ? `?floorplanId=${encodeURIComponent(floorplanId)}` : '';
      const res = await apiFetch(`${API_BASE_URL}/stats${query}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          return {
            ...json.stats,
            floorplanList: json.floorplanList || [],
            exhibitorsList: json.exhibitorsList || [],
            categoryBreakdown: json.categoryBreakdown || [],
            selectedProjectId: json.selectedProjectId || 'all',
            selectedProject: json.selectedProject || null
          };
        }
      }
    } catch (e) {
      console.warn("Failed to fetch stats from server", e);
    }

    return null;
  },

  // 10.1 Update Booth Status and Tenant Name
  async updateBoothStatus(boothId, { status, owner_name }) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/stats/booth/${boothId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, owner_name })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Failed to update booth status:", e);
    }
    return { success: false, error: 'Gagal menghubungi server' };
  },

  // 10.2 Status button of the Studio's Property Inspector: a booked booth's status is written to its booking / invoice
  // contract on the server, so it survives the next save and a refresh (AGENTS.md §37)
  async setBoothStatus(floorplanId, boothCode, status, extra = {}) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/${encodeURIComponent(floorplanId)}/booth-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boothCode, status, ...extra })
      });
      const json = await res.json().catch(() => ({}));
      return { ...json, success: res.ok && json.success !== false, error: json.error || (res.ok ? '' : `Status booth gagal disimpan (HTTP ${res.status})`) };
    } catch (e) {
      console.error('Failed to set booth status:', e);
      return { success: false, error: 'Gagal menghubungi server' };
    }
  },

  // 11. Reseed database with dummy data
  async reseedDatabase() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/seed`, { method: 'POST' });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn("Failed to reseed database:", e);
    }
    return { success: false };
  },

  // 12. Fetch all invoices
  async fetchInvoices(params = {}) {
    try {
      const query = new URLSearchParams(params).toString();
      const url = `${API_BASE_URL}/invoices${query ? `?${query}` : ''}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          return json.invoices || [];
        }
      }
    } catch (e) {
      console.warn("Failed to fetch invoices:", e);
    }
    return [];
  },

  // 13. Fetch single invoice by ID
  async fetchInvoiceById(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.invoice) {
          return json.invoice;
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch invoice ${id}:`, e);
    }
    return null;
  },

  // 14. Create a new invoice
  async createInvoice(invoiceData) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData)
      });
      // Validation errors (e.g. DP already exists, DP not paid yet) carry a message & code from the server
      return await res.json();
    } catch (e) {
      console.warn("Failed to create invoice:", e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 14b. Booth contract summary (Total Kontrak, Sudah Ditagih / Dibayar, DP & Pelunasan) for the invoice wizard
  async fetchContract({ floorplanId, boothCode = '', boothId = '', taxRate = 0 }) {
    try {
      const qs = new URLSearchParams({ floorplanId, boothCode, boothId, taxRate: String(taxRate), _t: String(Date.now()) });
      const res = await apiFetch(`${API_BASE_URL}/invoices/contract?${qs}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  // 15. Update an invoice
  // Edit form (Manajemen Invoice & Data Exhibitor): always returns the server's answer, also on errors
  async saveInvoiceDetails(id, details) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  // DP amount, contract PPN and what the document shows (POST /invoices/:id/terms)
  async updateInvoiceTerms(id, terms) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${encodeURIComponent(id)}/terms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(terms)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  async updateInvoice(id, invoiceData) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceData)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn(`Failed to update invoice ${id}:`, e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 16. Update invoice payment status and booth status
  async updateInvoiceStatus(id, status, boothStatus = null, paidAmount = undefined, remainingAmount = undefined, extra = {}) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, boothStatus, paidAmount, remainingAmount, ...extra })
      });
      return await res.json();
    } catch (e) {
      console.warn(`Failed to update status for invoice ${id}:`, e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 17. Delete an invoice
  // Soft delete with a mandatory reason; `confirmNumber` for an invoice that already received a payment
  async deleteInvoice(id, { reason = '', confirmNumber = '' } = {}) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, confirmNumber })
      });
      return await res.json();
    } catch (e) {
      console.warn(`Failed to delete invoice ${id}:`, e);
    }
    return { success: false, error: 'Koneksi server gagal' };
  },

  // 17a. Hapus Tenant (Super Admin, AGENTS.md §33): summary for the confirmation, delete, bulk delete, undo
  async fetchTenantSummary(id, alsoIds = []) {
    try {
      const query = alsoIds.length ? `?alsoIds=${encodeURIComponent(alsoIds.join(','))}` : '';
      const res = await apiFetch(`${API_BASE_URL}/tenants/${encodeURIComponent(id)}/summary${query}`);
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  async deleteTenant(id, { confirmBooth = '', alsoIds = [] } = {}) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/tenants/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmBooth, alsoIds })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal. Tenant belum dihapus.' };
    }
  },

  // `ids`: one entry per table row (an id, or the ids of a merged row). One transaction: all or nothing
  async bulkDeleteTenants(ids, confirmText = '') {
    try {
      const res = await apiFetch(`${API_BASE_URL}/tenants/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, confirmText })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal. Tidak ada tenant yang dihapus.' };
    }
  },

  async restoreTenant(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/tenants/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal. Tenant belum dipulihkan.' };
    }
  },

  // 17b. Tempat Sampah Invoice (Super Admin): deleted invoices and restore
  async fetchInvoiceTrash() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/trash`);
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  async restoreInvoice(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  // 18. Fetch Invoice Layout Template Configuration
  async fetchInvoiceConfig() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/config`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.config) {
          invoiceConfigCache = json.config;
          return json.config;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch invoice config from server:", e);
    }

    return invoiceConfigCache;
  },

  // 19. Save Invoice Layout Template Configuration
  // `extra` = top-level fields, e.g. { invoiceNumberNext } when the admin typed a new running number (AGENTS.md §44)
  async saveInvoiceConfig(config, extra = {}) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...extra, config })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.config) invoiceConfigCache = json.config;
        return json;
      }
      return { success: false, error: json.error || `Server menolak penyimpanan (HTTP ${res.status})` };
    } catch (e) {
      console.warn("Invoice config save failed:", e);
      return { success: false, error: 'Tidak dapat terhubung ke server. Pengaturan belum tersimpan.' };
    }
  },

  // 19b. Store an image (blueprint, logo) as a file on the server; the caller keeps the returned URL, not the base64
  async uploadImage(dataUrl) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl })
      });
      const json = await res.json().catch(() => ({}));
      return res.ok && json.url ? json : { success: false, error: json.error || `Gambar gagal diunggah (HTTP ${res.status})` };
    } catch (e) {
      return { success: false, error: 'Tidak dapat terhubung ke server. Gambar belum diunggah.' };
    }
  },

  // 20. Fetch All Booth Categories
  async fetchCategories() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/categories`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.categories)) {
          return json.categories;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch categories from server:", e);
    }
    return null;
  },

  // 20b. "Samakan Semua Harga dengan Template" (AGENTS.md §32): preview (nothing saved), apply, undo of the last batch
  async fetchTemplatePricePreview(floorplanId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/template-prices/${encodeURIComponent(floorplanId)}/preview`);
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  async applyTemplatePrices(floorplanId, codes) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/template-prices/${encodeURIComponent(floorplanId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal. Tidak ada harga yang diubah.' };
    }
  },

  async undoTemplatePrices(floorplanId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/template-prices/${encodeURIComponent(floorplanId)}/undo`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Koneksi server gagal' };
    }
  },

  // 21. Create New Booth Category Tier
  async createCategory(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 22. Update Existing Booth Category Tier
  async updateCategory(id, data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 23. Delete Booth Category Tier
  async deleteCategory(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/categories/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 24. Reset Booth Categories to Defaults
  async resetCategories() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/categories/reset`, {
        method: 'POST'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 25. Fetch Brand Categories (with optional projectId filter)
  async fetchBrandCategories(activeOnly = false, projectId = null) {
    try {
      const params = new URLSearchParams();
      if (activeOnly) params.append('activeOnly', 'true');
      if (projectId) params.append('projectId', projectId);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`${API_BASE_URL}/brand-categories${query}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.categories)) {
          return json.categories;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch brand categories from server:", e);
    }
    // Fallback default list
    return [
      { id: 'bcat_1', name: 'Fashion & Apparel', isActive: true, sortOrder: 1 },
      { id: 'bcat_2', name: 'Kuliner & F&B', isActive: true, sortOrder: 2 },
      { id: 'bcat_3', name: 'Travel & Tourism', isActive: true, sortOrder: 3 },
      { id: 'bcat_4', name: 'Education & Academy', isActive: true, sortOrder: 4 },
      { id: 'bcat_5', name: 'Teknologi & Gadget', isActive: true, sortOrder: 5 },
      { id: 'bcat_6', name: 'Kesehatan & Beauty', isActive: true, sortOrder: 6 },
      { id: 'bcat_7', name: 'Otomotif & Aksesoris', isActive: true, sortOrder: 7 },
      { id: 'bcat_8', name: 'Properti & Interior', isActive: true, sortOrder: 8 },
      { id: 'bcat_9', name: 'Kerajinan & Craft', isActive: true, sortOrder: 9 },
      { id: 'bcat_10', name: 'Lainnya', isActive: true, sortOrder: 10 }
    ];
  },

  // 26. Create Brand Category (supports projectId)
  async createBrandCategory(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/brand-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // Copy default brand categories to specific project
  async copyDefaultBrandCategories(targetProjectId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/brand-categories/copy-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // Save & isolate brand categories for a specific project
  async saveProjectBrandCategories(projectId, categories = null) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/brand-categories/save-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, categories })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 27. Update Brand Category (name or isActive)
  async updateBrandCategory(id, data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/brand-categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 28. Delete Brand Category
  async deleteBrandCategory(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/brand-categories/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 29. Fetch All Payment Methods
  async fetchPaymentMethods(activeOnly = false) {
    try {
      const query = activeOnly ? '?activeOnly=true' : '';
      const res = await apiFetch(`${API_BASE_URL}/payment-methods${query}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.paymentMethods)) {
          return json.paymentMethods;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch payment methods from server:", e);
    }
    // Default fallback
    return [
      { id: 'pm_qris', key: 'qris', name: 'QRIS Instan', description: 'GoPay, OVO, Dana, Shopee, BCA QR', iconType: 'qris', isActive: true, sortOrder: 1 },
      { id: 'pm_bca_va', key: 'bca_va', name: 'BCA Virtual Account', description: 'Verifikasi Otomatis Bank BCA', iconType: 'bank', isActive: true, sortOrder: 2 },
      { id: 'pm_mandiri_va', key: 'mandiri_va', name: 'Mandiri / BNI VA', description: 'Virtual Account Bank Mandiri / BNI', iconType: 'bank', isActive: true, sortOrder: 3 },
      { id: 'pm_cc', key: 'cc', name: 'Kartu Kredit / Debit', description: 'Visa, Mastercard, JCB', iconType: 'card', isActive: true, sortOrder: 4 }
    ];
  },

  // 30. Create Payment Method
  async createPaymentMethod(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 31. Update Payment Method
  async updatePaymentMethod(id, data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/payment-methods/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 32. Delete Payment Method
  async deletePaymentMethod(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/payment-methods/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 33. Fetch Preset Layouts
  async fetchPresetLayouts() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/presets`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.presets)) {
          return json.presets;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch preset layouts from server:", e);
    }
    return [];
  },

  // 34. Save Floorplan as Preset Layout
  async saveFloorplanAsPreset(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/save-as-preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 35. Delete Preset Layout
  async deletePresetLayout(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/presets/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 36. Fetch Facility Request Forms & Templates
  async fetchFacilityForms(params = {}) {
    try {
      const query = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/facilities/forms${query ? `?${query}` : ''}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) return json.forms || [];
      }
    } catch (e) {
      console.warn("Failed to fetch facility forms:", e);
    }
    return [];
  },

  // 37. Fetch Single Facility Form by ID
  async fetchFacilityFormById(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/forms/${id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) return json.form;
      }
    } catch (e) {
      console.warn(`Failed to fetch facility form ${id}:`, e);
    }
    return null;
  },

  // 38. Save Facility Form or Template
  async saveFacilityForm(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 39. Delete Facility Form
  async deleteFacilityForm(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/forms/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 40. Fetch Tenant Facility Requests
  async fetchFacilityRequests(params = {}) {
    try {
      const query = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests${query ? `?${query}` : ''}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) return json.requests || [];
      }
    } catch (e) {
      console.warn("Failed to fetch facility requests:", e);
    }
    return [];
  },

  // Booked booths with tenant contact for the Fasilitas menu (broadcast, tenant form). No prices (AGENTS.md §46)
  async fetchFacilityTenants(projectId = 'global') {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/tenants?projectId=${encodeURIComponent(projectId || 'global')}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) return json.tenants || [];
      }
    } catch (e) {
      console.warn("Failed to fetch facility tenants:", e);
    }
    return [];
  },

  // Facility item categories (AGENTS.md §46): { categories, usage } or { success: false, message }
  async facilityCategories(method = 'GET', path = '', body) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/categories${path}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined
      });
      const json = await res.json().catch(() => ({}));
      return res.ok ? json : { success: false, message: json.message || json.error || `Gagal (HTTP ${res.status})` };
    } catch (e) {
      return { success: false, message: 'Server tidak dapat dihubungi' };
    }
  },

  // 41. Submit Facility Request (Public Tenant Portal)
  async submitFacilityRequest(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 42. Update Facility Request Status
  async updateFacilityRequestStatus(id, status) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 43. Generate Official A4 Invoice for Facility Request
  async updateFacilityRequest(id, data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  async deleteFacilityRequest(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/${id}`, { method: 'DELETE' });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  async restoreFacilityRequest(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/${id}/restore`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  async cancelFacilityInvoice(id, data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/${id}/cancel-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  async generateFacilityInvoice(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/facilities/requests/${id}/generate-invoice`, {
        method: 'POST'
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 44. Save & Sync Booth Discount directly to Invoices
  async syncBoothDiscount(payload) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/invoices/sync-booth-discount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Koneksi server gagal' };
    }
  },

  // 44b. Booth actions of the Sales pop up in the Studio (summary, Beri Diskon, Buat Invoice)
  async fetchBoothActionSummary({ floorplanId, boothCode, boothId }) {
    try {
      const params = new URLSearchParams({ floorplanId: floorplanId || '', boothCode: boothCode || '', boothId: boothId || '' });
      const res = await apiFetch(`${API_BASE_URL}/booth-actions/summary?${params.toString()}`);
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi.' };
    }
  },
  async saveBoothActionDiscount(payload) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/booth-actions/discount`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi. Diskon belum tersimpan.' };
    }
  },
  async generateBoothInvoice(payload) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/booth-actions/invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi. Invoice belum diterbitkan.' };
    }
  },

  // 45. Fetch soft-deleted projects in Trash
  async fetchTrashProjects() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/trash?_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        return json.trash || [];
      }
      return [];
    } catch (e) {
      console.error("fetchTrashProjects error:", e);
      return [];
    }
  },

  // 46. Soft delete projects
  async softDeleteProjects(projectIds, reason = 'Dihapus oleh admin', deletedBy = 'Admin') {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/soft-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds, reason, deletedBy })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Gagal memindahkan ke sampah' };
    }
  },

  // 47. Restore soft-deleted projects
  async restoreProjects(projectIds, restoredBy = 'Admin') {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds, restoredBy })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Gagal memulihkan project' };
    }
  },

  // 48. Permanently delete projects (financial safety locked)
  async permanentDeleteProjects(projectIds, confirmedBy = 'Admin') {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/permanent-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds, confirmedBy })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Gagal menghapus permanen' };
    }
  },

  // 49. Fetch Activity Logs
  async fetchActivityLogs(limit = 100) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/floorplan/activity-logs?limit=${limit}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        return json.logs || [];
      }
      return [];
    } catch (e) {
      console.error("fetchActivityLogs error:", e);
      return [];
    }
  },

  // Auth: login / logout / current session / change own password
  async login(email, password) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Tidak dapat terhubung ke server' };
    }
  },

  async logout() {
    try {
      await apiFetch(`${API_BASE_URL}/auth/logout`, { method: 'POST' });
    } catch (e) {}
  },

  async fetchCurrentUser() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/auth/me`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json.user : null;
    } catch (e) {
      return undefined; // server unreachable: keep the local session
    }
  },

  async changePassword(currentPassword, newPassword) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Tidak dapat terhubung ke server' };
    }
  },

  // Audit trail (Super Admin)
  // ---- Denah Operasional (operational layer on top of the sales floorplan) ----
  async fetchOpsFloorplans() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/ops/floorplans?_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json.floorplans : [];
    } catch (e) {
      console.error('fetchOpsFloorplans error:', e);
      return [];
    }
  },

  async fetchOpsLayer(floorplanId, params = {}) {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await apiFetch(`${API_BASE_URL}/ops/${encodeURIComponent(floorplanId)}?_t=${Date.now()}${qs ? `&${qs}` : ''}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      console.error('fetchOpsLayer error:', e);
      return { success: false, error: e.message };
    }
  },

  async fetchOpsVersion(floorplanId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/ops/${encodeURIComponent(floorplanId)}/version?_t=${Date.now()}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async saveOpsLayer(floorplanId, payload) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/ops/${encodeURIComponent(floorplanId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      return { ...json, status: res.status };
    } catch (e) {
      console.error('saveOpsLayer error:', e);
      return { success: false, error: e.message };
    }
  },

  async copyOpsLayer(targetFloorplanId, sourceId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/ops/${encodeURIComponent(targetFloorplanId)}/copy-from`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async fetchPublicOpsElements(floorplanId) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/ops/${encodeURIComponent(floorplanId)}/public?_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json.elements : [];
    } catch (e) {
      return [];
    }
  },

  // ---- In-app notifications ----
  async fetchNotifications() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/notifications?_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json : { notifications: [], unreadCount: 0 };
    } catch (e) {
      return { notifications: [], unreadCount: 0 };
    }
  },

  async markNotificationRead(id) {
    try {
      await apiFetch(`${API_BASE_URL}/notifications/${id}/read`, { method: 'POST' });
    } catch (e) {}
  },

  async markAllNotificationsRead() {
    try {
      await apiFetch(`${API_BASE_URL}/notifications/read-all`, { method: 'POST' });
    } catch (e) {}
  },

  async fetchAuditLogs(params = {}) {
    try {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== 'all')).toString();
      const res = await apiFetch(`${API_BASE_URL}/audit-logs?${qs}&_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json : { logs: [], categories: [] };
    } catch (e) {
      console.error("fetchAuditLogs error:", e);
      return { logs: [], categories: [] };
    }
  },

  // Pusat Maintenance (AGENTS.md §22)
  async fetchMaintenanceErrors(params = {}) {
    try {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== 'all')).toString();
      const res = await apiFetch(`${API_BASE_URL}/maintenance/errors?${qs}&_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json : { errors: [], summary: null, error: json.error };
    } catch (e) {
      return { errors: [], summary: null, error: 'Server tidak dapat dihubungi' };
    }
  },

  async fetchMaintenanceError(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/errors/${encodeURIComponent(id)}?_t=${Date.now()}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  async setMaintenanceErrorStatus(id, status, note = '') {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/errors/${encodeURIComponent(id)}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  // Pusat Maintenance: chat with the AI agent (AGENTS.md §27)
  async agentRequest(method, path, body) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/agent${path}`, {
        method,
        cache: 'no-store',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, ...json, success: res.ok && json.success !== false };
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },
  agentListTasks(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
    return this.agentRequest('GET', `/tasks?${qs}&_t=${Date.now()}`);
  },
  agentCreateTask(title) { return this.agentRequest('POST', '/tasks', title ? { title } : {}); },
  agentGetTask(id) { return this.agentRequest('GET', `/tasks/${encodeURIComponent(id)}?_t=${Date.now()}`); },
  agentUpdateTask(id, patch) { return this.agentRequest('PATCH', `/tasks/${encodeURIComponent(id)}`, patch); },
  agentSendMessage(id, payload) { return this.agentRequest('POST', `/tasks/${encodeURIComponent(id)}/messages`, payload); },
  agentStop(id) { return this.agentRequest('POST', `/tasks/${encodeURIComponent(id)}/stop`, {}); },
  agentModules() { return this.agentRequest('GET', '/context/modules'); },
  agentFiles(q) { return this.agentRequest('GET', `/context/files?q=${encodeURIComponent(q || '')}`); },
  async agentAttachmentUrl(id) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/agent/attachments/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch (e) {
      return null;
    }
  },

  // AI settings (Super Admin): model from /v1/models, monthly budget, price estimates
  async fetchAiConfig() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-config?_t=${Date.now()}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },
  async fetchAiModels() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-models?_t=${Date.now()}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },
  async saveAiConfig(patch) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  // Claude API key (Super Admin, write-only: only the status comes back, never the key)
  async fetchClaudeKeyStatus() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-key?_t=${Date.now()}`, { cache: 'no-store' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  async saveClaudeKey(apiKey) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-key`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  async testClaudeKey() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-key/test`, { method: 'POST' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  async deleteClaudeKey() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/ai-key`, { method: 'DELETE' });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  // WhatsApp assistant (Fonnte) settings, Super Admin: the token is write-only
  async waSettings(method = 'GET', path = '', body) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/maintenance/whatsapp${path}${method === 'GET' ? `?_t=${Date.now()}` : ''}`, {
        method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: 'Server tidak dapat dihubungi' };
    }
  },

  // 50. Fetch Users (Super Admin, Keuangan, Sales)
  async fetchUsers() {
    try {
      const res = await apiFetch(`${API_BASE_URL}/users?_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.success ? json.users : [];
    } catch (e) {
      console.error("fetchUsers error:", e);
      return [];
    }
  },

  // 51. Create User
  async createUser(data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Gagal menambahkan user' };
    }
  },

  // 52. Update User (password only changes when provided)
  async updateUser(id, data) {
    try {
      const res = await apiFetch(`${API_BASE_URL}/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message || 'Gagal memperbarui user' };
    }
  }
};

export default api;

