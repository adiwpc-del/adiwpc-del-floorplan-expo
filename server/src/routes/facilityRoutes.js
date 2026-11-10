import express from 'express';
import db from '../db.js';
import crypto from 'crypto';
import { nextInvoiceNumber, invoicePaidAmount } from '../utils/contractBilling.js';
import { renderFacilityFormPdf, printBaseUrl, PdfEngineError } from '../utils/pdfRenderer.js';
import { invoiceDesign } from './invoiceRoutes.js';
import { writeAuditLog } from '../middleware/audit.js';
import { clientIp } from '../middleware/auth.js';
import { canDeletePaidInvoice, cleanDeleteReason, sameInvoiceNumber, DELETE_REASON_MIN } from '../../../shared/invoicePermissions.js';

const router = express.Router();

/**
 * Helper to safely parse JSON
 */
function safeJsonParse(data, fallback = []) {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch (e) {
    return fallback;
  }
}

// The invoice issued for a request, unless it was deleted (a deleted one is in the invoice trash, §31)
const invoiceOfRequest = (request) => (request.invoice_id
  ? db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get(request.invoice_id)
  : null);
const isCanceled = (invoice) => String(invoice?.payment_status || '').toUpperCase() === 'CANCELED';
const invoiceBrief = (invoice) => (invoice
  ? { id: invoice.id, number: invoice.invoice_number, status: String(invoice.payment_status || '').toUpperCase(), total: Number(invoice.total_amount) || 0, paid: invoicePaidAmount(invoice) }
  : null);

/**
 * 1. GET /api/facilities/forms
 * Fetch all facility forms and templates
 */
router.get('/forms', (req, res) => {
  try {
    const { projectId, isTemplate } = req.query;
    
    let query = 'SELECT * FROM facility_forms WHERE 1=1';
    const params = [];

    if (projectId) {
      query += " AND (project_id = ? OR project_id = 'global')";
      params.push(projectId);
    }

    if (isTemplate !== undefined) {
      query += ' AND is_template = ?';
      params.push(isTemplate === 'true' || isTemplate === '1' ? 1 : 0);
    }

    query += ' ORDER BY is_active DESC, is_template ASC, created_at DESC';

    const forms = db.prepare(query).all(...params).map(f => ({
      ...f,
      items: safeJsonParse(f.items_json, [])
    }));

    res.json({ success: true, forms });
  } catch (error) {
    console.error('Error fetching facility forms:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat formulir fasilitas' });
  }
});

/**
 * 2. GET /api/facilities/forms/:id
 * Fetch single facility form by ID
 */
router.get('/forms/:id', (req, res) => {
  try {
    const { id } = req.params;
    const form = db.prepare('SELECT * FROM facility_forms WHERE id = ?').get(id);

    if (!form) {
      return res.status(404).json({ success: false, message: 'Formulir tidak ditemukan' });
    }

    res.json({
      success: true,
      form: {
        ...form,
        items: safeJsonParse(form.items_json, [])
      }
    });
  } catch (error) {
    console.error('Error fetching facility form:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat detail formulir' });
  }
});

/**
 * 3. POST /api/facilities/forms
 * Create or update facility form or template
 */
router.post('/forms', (req, res) => {
  try {
    const {
      id,
      project_id = 'global',
      title,
      description = '',
      event_title = 'Indonesia International Expo 2026',
      deadline_date = '',
      terms_notes = '',
      is_active = 1,
      is_template = 0,
      template_name = '',
      items = []
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Judul formulir wajib diisi' });
    }

    const itemsJson = typeof items === 'string' ? items : JSON.stringify(items);
    const formId = id || (is_template ? `tpl_${Date.now()}` : `form_${Date.now()}`);

    // If making this form active, deactivate other forms in the same project if requested
    if (is_active && !is_template) {
      db.prepare('UPDATE facility_forms SET is_active = 0 WHERE project_id = ? AND is_template = 0').run(project_id);
    }

    const existing = db.prepare('SELECT id FROM facility_forms WHERE id = ?').get(formId);

    if (existing) {
      db.prepare(`
        UPDATE facility_forms SET
          project_id = ?,
          title = ?,
          description = ?,
          event_title = ?,
          deadline_date = ?,
          terms_notes = ?,
          is_active = ?,
          is_template = ?,
          template_name = ?,
          items_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        project_id,
        title.trim(),
        description,
        event_title,
        deadline_date,
        terms_notes,
        is_active ? 1 : 0,
        is_template ? 1 : 0,
        template_name || '',
        itemsJson,
        formId
      );
    } else {
      db.prepare(`
        INSERT INTO facility_forms (
          id, project_id, title, description, event_title, deadline_date, terms_notes, is_active, is_template, template_name, items_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        formId,
        project_id,
        title.trim(),
        description,
        event_title,
        deadline_date,
        terms_notes,
        is_active ? 1 : 0,
        is_template ? 1 : 0,
        template_name || '',
        itemsJson
      );
    }

    const saved = db.prepare('SELECT * FROM facility_forms WHERE id = ?').get(formId);

    res.json({
      success: true,
      message: is_template ? 'Template formulir berhasil disimpan' : 'Formulir fasilitas berhasil disimpan',
      form: {
        ...saved,
        items: safeJsonParse(saved.items_json, [])
      }
    });
  } catch (error) {
    console.error('Error saving facility form:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan formulir fasilitas' });
  }
});

/**
 * 4. DELETE /api/facilities/forms/:id
 * Delete facility form or template
 */
router.delete('/forms/:id', (req, res) => {
  try {
    const { id } = req.params;

    // Check if form has associated requests
    const reqCount = db.prepare('SELECT COUNT(*) as count FROM facility_requests WHERE form_id = ?').get(id).count;
    if (reqCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Tidak dapat menghapus formulir karena terdapat ${reqCount} pengajuan tenant yang terkait. Nonaktifkan saja formulir ini.`
      });
    }

    db.prepare('DELETE FROM facility_forms WHERE id = ?').run(id);
    res.json({ success: true, message: 'Formulir berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting facility form:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus formulir' });
  }
});

/**
 * 5. GET /api/facilities/requests
 * Fetch all tenant facility requests
 */
router.get('/requests', (req, res) => {
  try {
    const { formId, status, projectId, search } = req.query;

    // requests of a deleted tenant are archived (Hapus Tenant, AGENTS.md §33)
    let query = 'SELECT * FROM facility_requests WHERE deleted_at IS NULL';
    const params = [];

    if (formId) {
      query += ' AND form_id = ?';
      params.push(formId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status.toUpperCase());
    }

    if (projectId && projectId !== 'all') {
      query += " AND (project_id = ? OR project_id = 'global')";
      params.push(projectId);
    }

    if (search && search.trim()) {
      query += ' AND (booth_code LIKE ? OR company_name LIKE ? OR pic_name LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    query += ' ORDER BY created_at DESC';

    const requests = db.prepare(query).all(...params).map(r => ({
      ...r,
      items: safeJsonParse(r.items_json, []),
      invoice: invoiceBrief(invoiceOfRequest(r))
    }));

    res.json({ success: true, requests });
  } catch (error) {
    console.error('Error fetching facility requests:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar pengajuan fasilitas' });
  }
});

// ---------- Item categories (AGENTS.md §46): one list for every form, stored in maintenance_settings ----------
const DEFAULT_FACILITY_CATEGORIES = [
  'Listrik & Pencahayaan', 'Furnitur & Meja-Kursi', 'Sanitasi & Air', 'Konstruksi & Karpet', 'Jaringan & IT',
  'Multimedia & Display', 'Kebersihan & Layanan', 'Aksesoris & Branding', 'Keamanan & Safety'
];
const CATEGORY_KEY = 'facility_categories';
const cleanCategory = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const readCategories = () => {
  const row = db.prepare('SELECT value FROM maintenance_settings WHERE key = ?').get(CATEGORY_KEY);
  const list = safeJsonParse(row?.value, null);
  return Array.isArray(list) ? list : DEFAULT_FACILITY_CATEGORIES;
};
const saveCategories = (list, user) => db.prepare(`
  INSERT INTO maintenance_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
`).run(CATEGORY_KEY, JSON.stringify(list), user?.name || '');
// null when the list is usable (1-50 names, each 1-60 characters, no duplicates ignoring case), else the reason
function categoryListProblem(list) {
  if (!Array.isArray(list) || !list.length) return 'Minimal satu kategori.';
  if (list.length > 50) return 'Maksimal 50 kategori.';
  if (list.some(c => !c)) return 'Nama kategori tidak boleh kosong.';
  if (list.some(c => c.length > 60)) return 'Nama kategori maksimal 60 karakter.';
  const seen = new Set();
  for (const c of list) { const k = c.toLowerCase(); if (seen.has(k)) return `Kategori "${c}" tercantum dua kali.`; seen.add(k); }
  return null;
}
// How many items of the saved forms / templates use each category
function categoryUsage() {
  const usage = {};
  db.prepare('SELECT items_json FROM facility_forms').all()
    .forEach(f => safeJsonParse(f.items_json, []).forEach(i => { const c = cleanCategory(i.category); if (c) usage[c] = (usage[c] || 0) + 1; }));
  return usage;
}

// GET /api/facilities/categories: the list (the 9 built-in ones until it is first changed) and the item count per name
router.get('/categories', (req, res) => {
  try {
    res.json({ success: true, categories: readCategories(), usage: categoryUsage() });
  } catch (error) {
    console.error('Error fetching facility categories:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat kategori fasilitas' });
  }
});

// PUT /api/facilities/categories { categories }: the whole list (add, delete, order). A deleted name only leaves the
// list: items that use it keep it until they are edited.
router.put('/categories', (req, res) => {
  try {
    const list = (Array.isArray(req.body?.categories) ? req.body.categories : []).map(cleanCategory);
    const problem = categoryListProblem(list);
    if (problem) return res.status(400).json({ success: false, message: problem });
    saveCategories(list, req.user);
    res.json({ success: true, categories: list, usage: categoryUsage() });
  } catch (error) {
    console.error('Error saving facility categories:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan kategori fasilitas' });
  }
});

// POST /api/facilities/categories/rename { from, to }: renames the category in the list AND in the items of every saved
// form and template, in one transaction (requests already sent by tenants keep what they ordered)
router.post('/categories/rename', (req, res) => {
  try {
    const from = cleanCategory(req.body?.from);
    const to = cleanCategory(req.body?.to);
    if (!from || !to) return res.status(400).json({ success: false, message: 'Nama lama dan nama baru wajib diisi.' });
    if (to.length > 60) return res.status(400).json({ success: false, message: 'Nama kategori maksimal 60 karakter.' });
    const list = readCategories();
    if (list.some(c => c.toLowerCase() === to.toLowerCase() && c.toLowerCase() !== from.toLowerCase())) {
      return res.status(409).json({ success: false, code: 'CATEGORY_EXISTS', message: `Kategori "${to}" sudah ada.` });
    }
    let updatedItems = 0;
    db.transaction(() => {
      const next = list.some(c => c === from) ? list.map(c => (c === from ? to : c)) : [...list, to];
      saveCategories(next, req.user);
      const update = db.prepare('UPDATE facility_forms SET items_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      db.prepare('SELECT id, items_json FROM facility_forms').all().forEach(f => {
        const items = safeJsonParse(f.items_json, []);
        let changed = false;
        items.forEach(i => { if (cleanCategory(i.category) === from) { i.category = to; changed = true; updatedItems += 1; } });
        if (changed) update.run(JSON.stringify(items), f.id);
      });
    })();
    res.json({ success: true, categories: readCategories(), usage: categoryUsage(), updatedItems });
  } catch (error) {
    console.error('Error renaming facility category:', error);
    res.status(500).json({ success: false, message: 'Gagal mengganti nama kategori' });
  }
});

/**
 * GET /api/facilities/tenants?projectId=<id | global>
 * Booked booths with their tenant contact, for "Broadcast ke Tenant" and the tenant facility form (AGENTS.md §46).
 * Only what those need: no prices, discounts or invoices (Operations never sees billing data).
 */
router.get('/tenants', (req, res) => {
  try {
    const projectId = String(req.query.projectId || 'global');
    const rows = db.prepare(`
      SELECT b.floorplan_id, f.title AS project_title, b.code, b.status, b.owner_name, b.pic_name, b.phone
      FROM booths b JOIN floorplans f ON f.id = b.floorplan_id
      WHERE b.deleted_at IS NULL AND f.deleted_at IS NULL AND LOWER(b.status) IN ('reserved', 'sold')
        AND TRIM(COALESCE(b.owner_name, '')) != '' ${projectId === 'global' ? '' : 'AND b.floorplan_id = ?'}
      ORDER BY f.title, b.code`).all(...(projectId === 'global' ? [] : [projectId]));
    res.json({
      success: true,
      tenants: rows.map(b => ({
        floorplanId: b.floorplan_id, projectTitle: b.project_title, boothCode: b.code, code: b.code, status: String(b.status).toLowerCase(),
        tenant: b.owner_name, companyName: b.owner_name, picName: b.pic_name || '', phone: b.phone || ''
      }))
    });
  } catch (error) {
    console.error('Error fetching facility tenants:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar tenant' });
  }
});

/**
 * 6. POST /api/facilities/requests/submit
 * Public endpoint for tenants to submit extra facility orders
 */
router.post('/requests/submit', (req, res) => {
  try {
    const {
      form_id,
      project_id = 'global',
      booth_code,
      company_name,
      pic_name,
      phone = '',
      email = '',
      items = [],
      total_amount = 0,
      notes = ''
    } = req.body;

    if (!booth_code || !booth_code.trim()) {
      return res.status(400).json({ success: false, message: 'Nomor/Kode Booth wajib diisi' });
    }

    if (!company_name || !company_name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama Perusahaan / Brand wajib diisi' });
    }

    if (!pic_name || !pic_name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama PIC Kontak wajib diisi' });
    }

    const selectedItems = Array.isArray(items) 
      ? items.filter(i => (Number(i.qty) || 0) > 0)
      : [];

    if (selectedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Pilih minimal 1 item fasilitas tambahan' });
    }

    // Calculate verified total amount
    const verifiedTotal = selectedItems.reduce((sum, item) => {
      const price = Number(item.price) || 0;
      const qty = Number(item.qty) || 1;
      return sum + (price * qty);
    }, 0);

    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const itemsJson = JSON.stringify(selectedItems);

    db.prepare(`
      INSERT INTO facility_requests (
        id, form_id, project_id, booth_code, company_name, pic_name, phone, email, items_json, total_amount, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      requestId,
      form_id || 'form_active_default',
      project_id,
      booth_code.trim().toUpperCase(),
      company_name.trim(),
      pic_name.trim(),
      phone.trim(),
      email.trim(),
      itemsJson,
      verifiedTotal || total_amount,
      notes.trim()
    );

    const created = db.prepare('SELECT * FROM facility_requests WHERE id = ?').get(requestId);

    res.json({
      success: true,
      message: 'Permintaan fasilitas tambahan Anda berhasil dikirim ke panitia expo!',
      request: {
        ...created,
        items: safeJsonParse(created.items_json, [])
      }
    });
  } catch (error) {
    console.error('Error submitting facility request:', error);
    res.status(500).json({ success: false, message: 'Gagal mengirim formulir fasilitas' });
  }
});

/**
 * 7. PUT /api/facilities/requests/:id/status
 * Update status of tenant request (PENDING, APPROVED, REJECTED, COMPLETED)
 */
router.put('/requests/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status wajib ditentukan' });
    }

    const validStatuses = ['PENDING', 'APPROVED', 'INVOICED', 'COMPLETED', 'REJECTED'];
    const upperStatus = status.toUpperCase();

    if (!validStatuses.includes(upperStatus)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid' });
    }

    db.prepare('UPDATE facility_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(upperStatus, id);

    res.json({ success: true, message: `Status pengajuan berhasil diubah menjadi ${upperStatus}` });
  } catch (error) {
    console.error('Error updating request status:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui status pengajuan' });
  }
});

/**
 * 8. POST /api/facilities/requests/:id/generate-invoice
 * Convert facility request into official A4 invoice record in `invoices` table
 */
router.post('/requests/:id/generate-invoice', (req, res) => {
  try {
    const { id } = req.params;

    const request = db.prepare('SELECT * FROM facility_requests WHERE id = ?').get(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Pengajuan fasilitas tidak ditemukan' });
    }

    // One request, one live invoice (a double click, or a request reopened while its invoice came back)
    const current = invoiceOfRequest(request);
    if (current && !isCanceled(current)) {
      db.prepare("UPDATE facility_requests SET status = 'INVOICED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      return res.status(409).json({ success: false, code: 'REQUEST_INVOICED', message: `Pengajuan ini sudah punya invoice ${current.invoice_number}.` });
    }

    // Get form details for event info
    const form = db.prepare('SELECT * FROM facility_forms WHERE id = ?').get(request.form_id);
    const eventTitle = form?.event_title || 'Indonesia International Expo 2026';

    const items = safeJsonParse(request.items_json, []);
    const invoiceItems = items.map(item => ({
      description: `[Add-on] ${item.name} (${item.category || 'Fasilitas'})`,
      unitPrice: Number(item.price) || 0,
      price: Number(item.price) || 0,
      qty: Number(item.qty) || 1,
      unit: item.unit || 'Unit',
      amount: (Number(item.price) || 0) * (Number(item.qty) || 1),
      total: (Number(item.price) || 0) * (Number(item.qty) || 1)
    }));

    const invoiceId = `inv_fac_${Date.now()}`;
    const invoiceNumber = nextInvoiceNumber('facility');
    const issueDate = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const insertInvoice = db.prepare(`
      INSERT INTO invoices (
        id, invoice_number, floorplan_id, booth_code, event_title, client_name, company_name, client_email, client_phone,
        issue_date, due_date, items_json, subtotal, discount_type, discount_value, discount_amount,
        tax_rate, tax_amount, total_amount, payment_status, payment_method, notes, invoice_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nominal', 0, 0, 0, 0, ?, 'UNPAID', 'Bank Transfer', ?, 'facility')
    `);

    insertInvoice.run(
      invoiceId,
      invoiceNumber,
      request.project_id || 'global',
      request.booth_code,
      eventTitle,
      request.pic_name,
      request.company_name,
      request.email || '',
      request.phone || '',
      issueDate,
      dueDate,
      JSON.stringify(invoiceItems),
      request.total_amount,
      request.total_amount,
      `Tagihan Fasilitas Tambahan Booth ${request.booth_code}.\nCatatan: ${request.notes || '-'}`
    );

    // Update request status to INVOICED
    db.prepare("UPDATE facility_requests SET status = 'INVOICED', invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(invoiceId, id);

    const createdInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);

    res.json({
      success: true,
      message: `Invoice resmi ${invoiceNumber} berhasil dibuat untuk booth ${request.booth_code}!`,
      invoice: createdInvoice,
      invoiceId
    });
  } catch (error) {
    console.error('Error generating invoice for facility request:', error);
    res.status(500).json({ success: false, message: `Gagal membuat invoice fasilitas: ${error.message}` });
  }
});

/**
 * PUT /api/facilities/requests/:id { items, notes }: correct a request ("Ubah"), only while it has no live invoice.
 * The total is computed here. An issued invoice is changed by canceling it first (below), then issuing a new one.
 */
router.put('/requests/:id', (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM facility_requests WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Pengajuan fasilitas tidak ditemukan' });
    const current = invoiceOfRequest(request);
    if (current && !isCanceled(current)) {
      return res.status(409).json({ success: false, code: 'REQUEST_INVOICED', message: `Pengajuan ini sudah punya invoice ${current.invoice_number}. Batalkan invoice-nya lebih dulu.` });
    }
    const raw = req.body?.items;
    const valid = Array.isArray(raw) && raw.length > 0 && raw.length <= 300 && raw.every(i =>
      String(i?.name || '').trim() && Number.isInteger(Number(i.qty)) && Number(i.qty) >= 1 && Number(i.qty) <= 9999 && Number(i.price) >= 0);
    if (!valid) return res.status(400).json({ success: false, message: 'Pilih minimal 1 item dengan jumlah yang benar.' });
    const items = raw.map(i => ({ ...i, name: String(i.name).trim(), qty: Number(i.qty), price: Number(i.price) }));
    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const notes = req.body.notes === undefined ? request.notes : String(req.body.notes || '').trim().slice(0, 1000);
    db.prepare('UPDATE facility_requests SET items_json = ?, total_amount = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(items), total, notes, request.id);
    res.json({ success: true, message: `Pengajuan booth ${request.booth_code} diperbarui.` });
  } catch (error) {
    console.error('Error updating facility request:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui pengajuan fasilitas' });
  }
});

// DELETE /api/facilities/requests/:id: "Hapus" a request (AGENTS.md §46). Soft delete (deleted_at), undone by
// POST /requests/:id/restore ("Urungkan"). Refused while it has a live invoice: cancel that invoice first.
const auditRequest = (req, action, request) => {
  req.skipAudit = true;
  writeAuditLog({
    user: req.user, category: 'Fasilitas', action,
    target: `${request.company_name || '-'} (booth ${request.booth_code})`,
    summary: `${request.status} · Rp ${(Number(request.total_amount) || 0).toLocaleString('id-ID')}`,
    method: req.method, path: `/api/facilities${req.path}`, statusCode: 200, ip: clientIp(req),
    details: { requestId: request.id }
  });
};

router.delete('/requests/:id', (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM facility_requests WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Pengajuan fasilitas tidak ditemukan' });
    const invoice = invoiceOfRequest(request);
    if (invoice && !isCanceled(invoice)) {
      return res.status(409).json({ success: false, code: 'REQUEST_INVOICED', message: `Pengajuan ini punya invoice aktif ${invoice.invoice_number}. Batalkan invoice-nya lebih dulu.` });
    }
    db.prepare('UPDATE facility_requests SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?').run(req.user?.name || '', request.id);
    auditRequest(req, 'Hapus pengajuan fasilitas', request);
    res.json({ success: true, message: `Pengajuan booth ${request.booth_code} (${request.company_name || '-'}) dihapus.` });
  } catch (error) {
    console.error('Error deleting facility request:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus pengajuan fasilitas' });
  }
});

router.post('/requests/:id/restore', (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM facility_requests WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Pengajuan yang dihapus tidak ditemukan' });
    db.prepare('UPDATE facility_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(request.id);
    auditRequest(req, 'Pulihkan pengajuan fasilitas', request);
    res.json({ success: true, message: `Pengajuan booth ${request.booth_code} dikembalikan.` });
  } catch (error) {
    console.error('Error restoring facility request:', error);
    res.status(500).json({ success: false, message: 'Gagal memulihkan pengajuan fasilitas' });
  }
});

/**
 * POST /api/facilities/requests/:id/cancel-invoice { reason, outcome, confirmNumber }: the tenant withdrew or the order
 * changed (AGENTS.md §46). The invoice stays on record as CANCELED; its number is never reused.
 * outcome 'rejected' = tenant tidak jadi (request REJECTED); 'change' = ada perubahan (request APPROVED, open for "Ubah"
 * and a new invoice). An invoice with a payment: Super Admin only, after typing its number (same rule as §31).
 */
router.post('/requests/:id/cancel-invoice', (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM facility_requests WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Pengajuan fasilitas tidak ditemukan' });
    const invoice = invoiceOfRequest(request);
    if (!invoice || isCanceled(invoice)) return res.status(409).json({ success: false, code: 'NO_ACTIVE_INVOICE', message: 'Pengajuan ini tidak punya invoice aktif.' });

    const { outcome, confirmNumber } = req.body || {};
    if (!['rejected', 'change'].includes(outcome)) return res.status(400).json({ success: false, message: 'Pilih tindak lanjut pengajuan.' });
    const paid = invoicePaidAmount(invoice);
    if (paid > 0 && !canDeletePaidInvoice(req.user)) {
      return res.status(409).json({ success: false, code: 'INVOICE_PAID', message: `Invoice ${invoice.invoice_number} sudah menerima pembayaran. Hanya Super Admin yang dapat membatalkannya.` });
    }
    const reason = cleanDeleteReason(req.body?.reason);
    if (!reason) return res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: `Alasan pembatalan wajib diisi (minimal ${DELETE_REASON_MIN} karakter).` });
    if (paid > 0 && !sameInvoiceNumber(confirmNumber, invoice.invoice_number)) {
      return res.status(400).json({ success: false, code: 'CONFIRM_NUMBER', message: `Ketik ulang nomor invoice ${invoice.invoice_number} untuk membatalkan invoice yang sudah ada pembayarannya.` });
    }

    db.transaction(() => {
      // paid_amount stays: the record of what was received before canceling, same as POST /invoices/:id/status
      db.prepare("UPDATE invoices SET payment_status = 'CANCELED', remaining_amount = 0, notes = TRIM(COALESCE(notes, '') || char(10) || ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(`Dibatalkan: ${reason}`, invoice.id);
      if (outcome === 'rejected') {
        // invoice_id stays, so activating the invoice again in Manajemen Invoice brings the request back
        db.prepare("UPDATE facility_requests SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(request.id);
      } else {
        db.prepare("UPDATE facility_requests SET status = 'APPROVED', invoice_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(request.id);
      }
    })();

    req.skipAudit = true; // written here with the invoice number, amount and reason
    writeAuditLog({
      user: req.user, category: 'Fasilitas', action: 'Batalkan invoice fasilitas',
      target: `${invoice.invoice_number} (${request.company_name}, booth ${request.booth_code})`,
      summary: [`Rp ${(Number(invoice.total_amount) || 0).toLocaleString('id-ID')}`, paid > 0 ? `sudah dibayar Rp ${paid.toLocaleString('id-ID')}` : '',
        outcome === 'rejected' ? 'Tenant tidak jadi' : 'Ada perubahan', `Alasan: ${reason}`].filter(Boolean).join(' · '),
      method: req.method, path: `/api/facilities${req.path}`, statusCode: 200, ip: clientIp(req),
      details: { invoiceId: invoice.id, requestId: request.id, outcome, reason, paid }
    });

    res.json({ success: true, message: `Invoice ${invoice.invoice_number} dibatalkan.` });
  } catch (error) {
    console.error('Error canceling facility invoice:', error);
    res.status(500).json({ success: false, message: 'Gagal membatalkan invoice fasilitas' });
  }
});

// POST /api/facilities/form-pdf { tenant, form, items, mode, docNumber }: "Download PDF A4" of the facility form, made
// by the server from the same A4 template (FacilityFormA4View) with the saved design and its kop surat (AGENTS.md §46).
// The browser cannot make it itself: html2canvas does not read Tailwind v4's oklch() colours (§34). Nothing is stored.
const pdfNamePart = (v, fallback) => String(v || fallback).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || fallback;
router.post('/form-pdf', async (req, res) => {
  req.skipAudit = true;
  const { tenant, form, items, mode, docNumber } = req.body || {};
  if (!form || typeof form !== 'object' || Array.isArray(form)) return res.status(400).json({ success: false, error: 'Data formulir wajib diisi' });
  const list = Array.isArray(items) ? items : (Array.isArray(form.items) ? form.items : []);
  if (list.length > 300) return res.status(400).json({ success: false, error: 'Item formulir terlalu banyak (maks. 300)' });
  const sheet = {
    tenant: tenant && typeof tenant === 'object' ? tenant : {},
    form,
    items: list,
    mode: mode === 'filled' ? 'filled' : 'blank',
    docNumber: docNumber ? String(docNumber).slice(0, 80) : ''
  };
  try {
    const pdf = await renderFacilityFormPdf({ sheet, config: invoiceDesign(true), baseUrl: printBaseUrl(req, req.socket?.localPort || process.env.PORT || 5001) });
    const fileName = `Formulir_Fasilitas_${pdfNamePart(sheet.tenant.boothCode, 'Booth')}_${pdfNamePart(sheet.tenant.companyName, 'Tenant')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pdf);
  } catch (error) {
    if (error instanceof PdfEngineError && error.code === 'PDF_ENGINE_UNAVAILABLE') {
      return res.status(503).json({ success: false, code: error.code, error: 'Mesin PDF (Chromium) belum tersedia di server. Gunakan Print A4 lalu "Simpan sebagai PDF".' });
    }
    console.error('Facility form PDF error:', error);
    return res.status(500).json({ success: false, code: 'PDF_RENDER_FAILED', error: 'PDF formulir gagal dibuat. Coba lagi, atau gunakan Print A4.' });
  }
});

export default router;
