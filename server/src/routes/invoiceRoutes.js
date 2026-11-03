import express from 'express';
import db from '../db.js';
import { publicInvoiceConfig } from '../utils/publicData.js';
import {
  CONTRACT_KINDS, kindOf, getContract, invoiceCodeTokens, summarizeContract, getContractInvoices, recalcContract, boothContractValue,
  invoicePaidAmount, nextInvoiceNumber, contractStatusLabel, contractTaxFor, boothsForCode, contractItems, contractSnapshotParams
} from '../utils/contractBilling.js';
import { contractTaxOf, dpTaxOf, taxPortion, taxRemainder, invoiceTaxView, computeContractTax } from '../../../shared/invoiceTax.js';
import { taxOptionsFrom, readTaxSettings } from '../utils/taxSettings.js';
import { writeAuditLog } from '../middleware/audit.js';
import { clientIp } from '../middleware/auth.js';
import { syncPaymentStatusFromInvoices } from '../utils/syncPaymentStatus.js';
import { saveBoothDiscount } from '../utils/boothDiscount.js';
import { externalizeImages, CONFIG_INLINE_KEYS } from '../utils/uploads.js';
import { renderInvoicePdf, printBaseUrl, PdfEngineError } from '../utils/pdfRenderer.js';
import { cleanInvoiceNumber, invoiceFormatProblem, cleanNumberNext, DEFAULT_INVOICE_NUMBER_FORMAT } from '../../../shared/invoiceNumbering.js';
import { cleanDueDays, DEFAULT_DUE_DAYS } from '../../../shared/invoiceDates.js';
import { canDeleteInvoice, canDeletePaidInvoice, canRestoreInvoice, cleanDeleteReason, sameInvoiceNumber, DELETE_REASON_MIN } from '../../../shared/invoicePermissions.js';

const router = express.Router();

const DEFAULT_SYSTEM_CONFIG = {
  templateName: 'Modern Corporate A4',
  presetId: 'indigo_modern',
  primaryColor: '#4f46e5',
  secondaryColor: '#0f172a',
  accentColor: '#10b981',
  backgroundColor: '#ffffff',
  fontFamily: 'font-sans',

  headerLayout: 'logo_left_info_right',
  showLogo: true,
  logoUrl: '',
  logoSize: 44,
  logoText: 'FLOORPLAN STUDIO INDONESIA',
  logoTagline: 'Official Event Management & Exhibition Services',

  companyName: 'PT EXPO KARYA INDONESIA',
  organizerBrand: 'Floorplan & Exhibition Studio',
  companyAddress: 'Jl. Jend. Sudirman No. 45, Jakarta Pusat 10210, Indonesia',
  supportEmail: 'support@expokarya.co.id',
  supportPhone: '021-555-8899',
  supportWhatsapp: '081234567890',
  companyWebsite: 'www.expokarya.id',
  companyNpwp: '01.345.678.9-012.000',

  signatoryName: 'Budi Santoso, S.E.',
  signatoryTitle: 'Head of Exhibition & Operation',
  signatureImage: '',
  signatureImageUrl: '',

  tableHeaderStyle: 'solid_primary',
  signaturePosition: 'right',
  clientSectionPosition: 'grid_2col',
  showClientNpwp: true,
  showClientAddress: true,
  showClientPhone: true,
  showClientEmail: true,
  showWatermark: true,
  showStamp: true,
  showSignatureImage: true,
  showPaymentInstructions: true,
  showBankDetails: true,
  showInvoiceTerms: true,
  showQrCode: true,

  bank1Name: 'Bank Central Asia (BCA)',
  bank1AccNumber: '882-019-3321',
  bank1AccHolder: 'PT EXPO KARYA INDONESIA',
  bank1Branch: 'KCP Sudirman Jakarta',

  bank2Name: 'Bank Mandiri',
  bank2AccNumber: '122-00-9988776-5',
  bank2AccHolder: 'PT EXPO KARYA INDONESIA',
  bank2Branch: 'KCP Thamrin Jakarta',

  bankName: 'Bank Central Asia (BCA)',
  accountNumber: '882-019-3321',
  accountName: 'PT EXPO KARYA INDONESIA',
  bankBranch: 'KCP Sudirman Jakarta',

  paymentInstructions: 'Transfer dilakukan ke rekening resmi di atas. Cantumkan Nomor Invoice sebagai berita transfer. Kirimkan bukti pembayaran melalui WhatsApp Hotline Official kami untuk verifikasi otomatis.',
  invoiceTerms: '1. Uang muka (DP) minimal 50% dibayarkan saat pendaftaran.\n2. Pelunasan sisa 50% wajib diselesaikan maksimal 14 hari sebelum hari H pendaftaran.\n3. Pembatalan kepesertaan setelah invoice diterbitkan akan dikenakan biaya administrasi 25%.',

  taxRate: 11,
  // Online registrations by visitors are charged PPN (staff choose "Dengan PPN" / "Tanpa PPN" per invoice)
  publicBookingTax: true,
  // Smallest DP (% of the contract) a visitor may choose when registering online
  publicMinDpPercent: 20,
  // Largest private discount Sales may give per booth: % of the booth price, and an optional cap in Rp (0 = no Rp cap)
  salesMaxDiscountPercent: 10,
  salesMaxDiscountAmount: 0,
  bookingExpiryMinutes: 15,
  // Nomor & Tanggal Invoice (AGENTS.md §44): number format + running number, Jatuh Tempo = Tanggal Terbit + N days
  invoiceNumberFormat: DEFAULT_INVOICE_NUMBER_FORMAT,
  invoiceNumberNext: 1,
  invoiceDueDays: DEFAULT_DUE_DAYS,
  isPublicBookingActive: true,
  isPaymentActive: true,
  currencySymbol: 'Rp'
};

const BANK_FIELD_PAIRS = [['bank1Name', 'bankName'], ['bank1AccNumber', 'accountNumber'], ['bank1AccHolder', 'accountName'], ['bank1Branch', 'bankBranch']];

// GET /api/invoices/config - Get invoice layout & template settings
router.get('/config', (req, res) => {
  try {
    const row = db.prepare('SELECT config_json FROM invoice_settings WHERE id = ?').get('default_template');
    if (row && row.config_json) {
      try {
        const parsed = JSON.parse(row.config_json);
        const config = { ...DEFAULT_SYSTEM_CONFIG, ...parsed };
        // Visitors never receive the signatory's signature image (AGENTS.md §20)
        return res.json({ success: true, config: req.user ? config : publicInvoiceConfig(config) });
      } catch (e) {}
    }
    return res.json({ success: true, config: req.user ? DEFAULT_SYSTEM_CONFIG : publicInvoiceConfig(DEFAULT_SYSTEM_CONFIG) });
  } catch (error) {
    console.error("Fetch invoice config error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/invoices/config - Save invoice layout & template settings (atomic merge)
router.post('/config', (req, res) => {
  try {
    const { config } = req.body;
    if (!config) {
      return res.status(400).json({ success: false, error: 'Konfigurasi template wajib diisi' });
    }

    const row = db.prepare('SELECT config_json FROM invoice_settings WHERE id = ?').get('default_template');
    let existingConfig = {};
    if (row && row.config_json) {
      try {
        existingConfig = JSON.parse(row.config_json);
      } catch (e) {}
    }

    // Merge: DEFAULT_SYSTEM_CONFIG + existingConfig + incoming config so visual template settings are preserved
    const merged = {
      ...DEFAULT_SYSTEM_CONFIG,
      ...existingConfig,
      ...config,
      updatedAt: new Date().toISOString()
    };

    // Nomor & Tanggal Invoice (§44). The running number changes only when the request names it at the top level
    // (Setting sends it when the admin typed it): a page that saved the whole configuration with an older copy of
    // the counter must never move it back.
    if (config.invoiceNumberFormat !== undefined) {
      const problem = invoiceFormatProblem(config.invoiceNumberFormat);
      if (problem) return res.status(400).json({ success: false, code: 'INVALID_NUMBER_FORMAT', error: problem });
      merged.invoiceNumberFormat = String(config.invoiceNumberFormat).trim();
    }
    merged.invoiceNumberNext = cleanNumberNext(req.body.invoiceNumberNext ?? existingConfig.invoiceNumberNext);
    merged.invoiceDueDays = cleanDueDays(merged.invoiceDueDays);

    // The Sales discount limit is set by the Super Admin only (Finance edits the rest of this configuration)
    if (req.user?.role !== 'superadmin') {
      for (const key of ['salesMaxDiscountPercent', 'salesMaxDiscountAmount']) {
        if (existingConfig[key] !== undefined) merged[key] = existingConfig[key]; else merged[key] = DEFAULT_SYSTEM_CONFIG[key];
      }
    }

    // One primary bank account: Setting > No. Rekening (bank1*) and Desain Layout Invoice (bankName / accountNumber /
    // accountName / bankBranch, printed on the invoice) edit the same account. The side that changed wins.
    for (const [primary, printed] of BANK_FIELD_PAIRS) {
      const primaryChanged = config[primary] !== undefined && config[primary] !== existingConfig[primary];
      const printedChanged = config[printed] !== undefined && config[printed] !== existingConfig[printed];
      if (primaryChanged) merged[printed] = merged[primary];
      else if (printedChanged) merged[primary] = merged[printed];
      // neither changed: an older difference stays as it is (the admin decides which name is right, see Setting)
    }

    // The logo becomes a file (the signature stays inside the configuration: it is never public)
    const stored = externalizeImages(merged, { skipKeys: CONFIG_INLINE_KEYS });
    Object.assign(merged, stored);
    db.prepare(`
      INSERT INTO invoice_settings (id, config_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP
    `).run('default_template', JSON.stringify(merged));

    res.json({
      success: true,
      message: 'Desain layout invoice berhasil disimpan!',
      config: merged
    });
  } catch (error) {
    console.error("Save invoice config error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Booth data for the "Spesifikasi & Fasilitas" column of the invoice document: { [code]: { category, widthM, heightM, facilities } }
function boothSpecsFor(floorplanId, code) {
  const specs = {};
  if (!floorplanId || !code) return specs;
  boothsForCode(floorplanId, code).forEach(b => {
    let facilities = [];
    try { facilities = JSON.parse(b.facilities_json || '[]'); } catch (e) {}
    specs[b.code] = { category: b.category || '', widthM: b.width_m, heightM: b.height_m, facilities: Array.isArray(facilities) ? facilities : [] };
  });
  return specs;
}

const RELATED_INVOICE_SQL = 'SELECT id, invoice_number, payment_status, total_amount, dp_percent, dpp_amount, tax_amount, tax_method FROM invoices WHERE id = ?';

// Invoice row as every page shows it (Manajemen Invoice, Data Exhibitor, A4 document, WhatsApp): the list and the
// single-invoice endpoint build it here, so an invoice opened from any menu is exactly the same invoice.
const INVOICE_ROW_SQL = `
      SELECT inv.*,
        (
          SELECT b.status 
          FROM booths b 
          WHERE (b.code = inv.booth_code OR b.id = inv.booth_id)
            AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001'))
          LIMIT 1
        ) AS current_booth_status,
        (
          SELECT b.discount_amount 
          FROM booths b 
          WHERE (b.code = inv.booth_code OR b.id = inv.booth_id)
            AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001'))
          LIMIT 1
        ) AS booth_discount_amount,
        (
          SELECT b.discount_type 
          FROM booths b 
          WHERE (b.code = inv.booth_code OR b.id = inv.booth_id)
            AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001'))
          LIMIT 1
        ) AS booth_discount_type,
        (
          SELECT b.discount_value 
          FROM booths b 
          WHERE (b.code = inv.booth_code OR b.id = inv.booth_id)
            AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001'))
          LIMIT 1
        ) AS booth_discount_value,
        (
          SELECT b.discount_reason 
          FROM booths b 
          WHERE (b.code = inv.booth_code OR b.id = inv.booth_id)
            AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001'))
          LIMIT 1
        ) AS booth_discount_reason,
        (
          SELECT b.price 
          FROM booths b 
          WHERE (b.code = inv.booth_code OR b.id = inv.booth_id)
            AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001'))
          LIMIT 1
        ) AS booth_price,
        -- Booth size: match by booth id, then exact code, then merged code (invoice A-04 -> booth A-04+A-05)
        COALESCE(
          (SELECT b.width_m FROM booths b WHERE b.deleted_at IS NULL AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001')) AND b.id = inv.booth_id LIMIT 1),
          (SELECT b.width_m FROM booths b WHERE b.deleted_at IS NULL AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001')) AND b.code = inv.booth_code LIMIT 1),
          (SELECT b.width_m FROM booths b WHERE b.deleted_at IS NULL AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001')) AND ('+' || b.code || '+') LIKE ('%+' || inv.booth_code || '+%') LIMIT 1)
        ) AS booth_width_m,
        COALESCE(
          (SELECT b.height_m FROM booths b WHERE b.deleted_at IS NULL AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001')) AND b.id = inv.booth_id LIMIT 1),
          (SELECT b.height_m FROM booths b WHERE b.deleted_at IS NULL AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001')) AND b.code = inv.booth_code LIMIT 1),
          (SELECT b.height_m FROM booths b WHERE b.deleted_at IS NULL AND (b.floorplan_id = inv.floorplan_id OR (inv.floorplan_id IS NULL AND b.floorplan_id = 'FP-2026-001')) AND ('+' || b.code || '+') LIKE ('%+' || inv.booth_code || '+%') LIMIT 1)
        ) AS booth_height_m,
        (
          SELECT fp.title 
          FROM floorplans fp 
          WHERE fp.id = COALESCE(inv.floorplan_id, 'FP-2026-001')
          LIMIT 1
        ) AS project_title,
        (
          SELECT CASE WHEN json_valid(fp.metadata_json)
            THEN COALESCE(json_extract(fp.metadata_json, '$.event.venue'), json_extract(fp.metadata_json, '$.venue')) END
          FROM floorplans fp
          WHERE fp.id = COALESCE(inv.floorplan_id, 'FP-2026-001')
          LIMIT 1
        ) AS project_venue
      FROM invoices inv
`;

function invoiceRowMapper() {
  // One contract summary per booth, shared by its DP / Pelunasan / Penuh invoices
  const contractCache = new Map();
  const contractFor = (inv) => {
    if (!CONTRACT_KINDS.includes(kindOf(inv)) || !inv.booth_code || !inv.floorplan_id) return null;
    const key = `${inv.floorplan_id}_${String(inv.booth_code).trim().toLowerCase()}`;
    if (!contractCache.has(key)) {
      const c = getContract(inv.floorplan_id, inv.booth_code, inv.booth_id);
      contractCache.set(key, {
        key,
        total: c.contractTotal,
        paid: c.paid,
        remaining: c.remaining,
        billed: c.billed,
        unbilled: c.unbilled,
        discountAmount: c.discountAmount,
        dpp: c.dpp,
        ppn: c.ppn,
        paidTax: c.paidTax,
        taxMethod: c.taxMethod,
        taxRate: c.taxRate,
        status: c.status,
        statusLabel: contractStatusLabel(c.status),
        boothWidthM: c.booth?.width_m ?? null,
        boothHeightM: c.booth?.height_m ?? null
      });
    }
    return contractCache.get(key);
  };
  const relatedById = new Map();
  const relatedInvoice = (relatedId) => {
    if (!relatedId) return null;
    if (!relatedById.has(relatedId)) {
      relatedById.set(relatedId, db.prepare(RELATED_INVOICE_SQL).get(relatedId) || null);
    }
    return relatedById.get(relatedId);
  };


  return (inv) => {
    // The event name on the invoice is the project's name (the floorplan title edited in the Studio, AGENTS.md §13):
    // never the shared event's title ("Kanvas Baru") stored on some invoices, nor the template's default text
    if (inv.project_title) inv.event_title = inv.project_title;
    if (inv.project_venue) inv.event_venue = inv.project_venue;
    // Auto-merge contract "A-01+A-03+A-04" (AGENTS.md §18): size of every booth + total area
    const codeTokens = invoiceCodeTokens(inv.booth_code);
    if (codeTokens.length > 1 && !(Number(inv.booth_width_m) > 0) && inv.floorplan_id) {
      const rows = codeTokens
        .map(t => db.prepare('SELECT code, width_m, height_m FROM booths WHERE floorplan_id = ? AND deleted_at IS NULL AND LOWER(TRIM(code)) = LOWER(TRIM(?))').get(inv.floorplan_id, t))
        .filter(Boolean);
      if (rows.length) {
        inv.merged_booths = rows.map(r => ({ code: r.code, widthM: r.width_m, heightM: r.height_m }));
        inv.booth_area_m2 = Math.round(rows.reduce((acc, r) => acc + (Number(r.width_m) || 0) * (Number(r.height_m) || 0), 0) * 100) / 100;
      }
    }
    let items = [];
    try { if (inv.items_json) items = JSON.parse(inv.items_json); } catch (e) {}
    let bankDetails = null;
    try { if (inv.bank_details_json) bankDetails = JSON.parse(inv.bank_details_json); } catch (e) {}

    const effectiveDiscountAmount = (inv.discount_amount && Number(inv.discount_amount) > 0)
      ? Number(inv.discount_amount)
      : Number(inv.booth_discount_amount || 0);
    const effectiveDiscountType = inv.discount_type || inv.booth_discount_type || 'nominal';
    const effectiveDiscountValue = (inv.discount_value !== null && inv.discount_value !== undefined && Number(inv.discount_value) > 0)
      ? Number(inv.discount_value)
      : Number(inv.booth_discount_value || 0);
    const effectiveDiscountReason = inv.discount_reason || inv.booth_discount_reason || '';

    const kind = kindOf(inv);
    const isSplitInvoice = kind === 'dp' || kind === 'settlement';
    const boothDiscountHint = Number(inv.booth_discount_amount || 0);
    if (isSplitInvoice) {
      // The private discount belongs to the contract (shown in its breakdown), never to a DP / Pelunasan line
      inv.booth_discount_amount = 0;
      inv.booth_discount_value = 0;
      inv.booth_discount_reason = '';
    }
    const sub = inv.subtotal || (effectiveDiscountAmount > 0 ? (inv.total_amount + effectiveDiscountAmount) : inv.total_amount) || inv.booth_price || 5000000;
    let effectiveTotal = inv.total_amount;
    // DP / Pelunasan amounts are already net of the contract's private discount: never subtract it again
    // (older invoices only: an invoice with a stored PPN split already carries its discount)
    if (!isSplitInvoice && kind !== 'facility' && !inv.tax_method && (!inv.discount_amount || Number(inv.discount_amount) === 0) && effectiveDiscountAmount > 0) {
      effectiveTotal = Math.max(0, sub - effectiveDiscountAmount);
    }

    // Resolve Down Payment & Remaining Balance
    const pStatus = (inv.payment_status || 'UNPAID').toUpperCase();
    let paidAmt = inv.paid_amount !== undefined && inv.paid_amount !== null ? Number(inv.paid_amount) : 0;
    let remainingAmt = inv.remaining_amount !== undefined && inv.remaining_amount !== null ? Number(inv.remaining_amount) : 0;

    if (pStatus === 'PAID') {
      paidAmt = effectiveTotal;
      remainingAmt = 0;
    } else if (pStatus === 'CANCELED') {
      // A canceled invoice is neither money received nor a receivable (DB paid_amount is kept for audit)
      paidAmt = 0;
      remainingAmt = 0;
    } else if (pStatus === 'PARTIAL' || pStatus === 'DP' || pStatus === 'DP_PAID' || (inv.payment_type === 'dp' && kind === 'full')) {
      if (paidAmt === 0 && remainingAmt === 0) {
        paidAmt = Math.round(effectiveTotal / 2);
      }
      remainingAmt = Math.max(0, effectiveTotal - paidAmt);
    } else if (pStatus === 'UNPAID' || pStatus === 'PENDING') {
      if (paidAmt === 0 && remainingAmt === 0) {
        remainingAmt = effectiveTotal;
      } else {
        remainingAmt = Math.max(0, effectiveTotal - paidAmt);
      }
    } else {
      remainingAmt = Math.max(0, effectiveTotal - paidAmt);
    }

    const paymentType = inv.payment_type || (pStatus === 'PARTIAL' || (paidAmt > 0 && paidAmt < effectiveTotal) ? 'dp' : 'full');
    const dpPercent = inv.dp_percent || (effectiveTotal > 0 && paidAmt > 0 ? Number(((paidAmt / effectiveTotal) * 100).toFixed(0)) : 0);

    const row = {
      ...inv,
      invoice_kind: kind,
      contract: contractFor(inv),
      related_invoice: relatedInvoice(inv.related_invoice_id),
      subtotal: sub,
      discount_amount: effectiveDiscountAmount,
      discount_type: effectiveDiscountType,
      discount_value: effectiveDiscountValue,
      discount_reason: effectiveDiscountReason,
      total_amount: effectiveTotal,
      paid_amount: paidAmt,
      remaining_amount: remainingAmt,
      payment_type: paymentType,
      dp_percent: dpPercent,
      contract_discount_hint: boothDiscountHint,
      booth_specs: boothSpecsFor(inv.floorplan_id, inv.booth_code),
      items,
      bankDetails
    };
    // Booth price and PPN shown separately on the document, WhatsApp and reports (shared/invoiceTax.js)
    // Per-invoice choices of what the document shows (null = follow Desain Layout Invoice)
    try { row.display = inv.display_json ? JSON.parse(inv.display_json) : {}; } catch (e) { row.display = {}; }
    row.tax_view = invoiceTaxView(row);
    return row;
  };
}

/** The invoice row as every page shows it, by id or invoice number (null when not found). */
export function buildInvoiceRow(idOrNumber) {
  const row = db.prepare(`${INVOICE_ROW_SQL} WHERE inv.id = ? OR inv.invoice_number = ?`).get(idOrNumber, idOrNumber);
  return row ? invoiceRowMapper()(row) : null;
}

// GET /api/invoices - List all invoices
router.get('/', (req, res) => {
  try {
    const { status, search, floorplanId, projectId } = req.query;
    let query = INVOICE_ROW_SQL;

    const conditions = ['inv.deleted_at IS NULL'];
    const params = [];

    const targetFp = floorplanId || projectId;
    if (targetFp && targetFp !== 'all') {
      conditions.push("(inv.floorplan_id = ? OR inv.event_id = ? OR inv.floorplan_id IN (SELECT id FROM floorplans WHERE event_id = ?) OR (inv.floorplan_id IS NULL AND ? = 'FP-2026-001'))");
      params.push(targetFp, targetFp, targetFp, targetFp);
    }

    if (status && status !== 'all') {
      conditions.push('inv.payment_status = ?');
      params.push(status.toUpperCase());
    }

    if (search) {
      conditions.push('(inv.invoice_number LIKE ? OR inv.client_name LIKE ? OR inv.company_name LIKE ? OR inv.booth_code LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY inv.created_at DESC';

    const rawInvoices = db.prepare(query).all(...params);

    const toRow = invoiceRowMapper();
    const invoices = rawInvoices.map(toRow);

    res.json({
      success: true,
      total: invoices.length,
      invoices
    });
  } catch (error) {
    console.error("Fetch invoices error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- Invoice PDF (AGENTS.md §34) ----------
// The stored design; visitors (token download) get it without the signature image, like GET /config (§20)
export function invoiceDesign(forStaff) {
  let saved = {};
  try { saved = JSON.parse(db.prepare('SELECT config_json FROM invoice_settings WHERE id = ?').get('default_template')?.config_json || '{}'); } catch (e) { saved = {}; }
  const config = { ...DEFAULT_SYSTEM_CONFIG, ...saved };
  return forStaff ? config : publicInvoiceConfig(config);
}

const pdfFileName = (number) => `Invoice-${String(number || 'Dokumen').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;

async function sendInvoicePdf(req, res, invoice, config) {
  try {
    const pdf = await renderInvoicePdf({ invoice, config, baseUrl: printBaseUrl(req, req.socket?.localPort || process.env.PORT || 5001) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName(invoice.invoice_number)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (error) {
    if (error instanceof PdfEngineError && error.code === 'PDF_ENGINE_UNAVAILABLE') {
      // not an application error: the page falls back to the browser's own "Simpan sebagai PDF"
      return res.status(503).json({ success: false, code: error.code, error: 'Mesin PDF (Chromium) belum tersedia di server. Gunakan Print Invoice lalu "Simpan sebagai PDF".' });
    }
    console.error('Invoice PDF error:', error);
    res.status(500).json({ success: false, code: 'PDF_RENDER_FAILED', error: 'PDF invoice gagal dibuat. Coba lagi, atau gunakan Print Invoice.' });
  }
}

// POST /api/invoices/pdf-preview { invoice, config }: the layout editor's "Download PDF" (a design that is not saved yet)
router.post('/pdf-preview', async (req, res) => {
  req.skipAudit = true; // nothing is stored
  const { invoice, config } = req.body || {};
  if (!invoice || typeof invoice !== 'object') return res.status(400).json({ success: false, error: 'Data invoice wajib diisi' });
  return sendInvoicePdf(req, res, { ...invoice, id: 'preview' }, { ...invoiceDesign(true), ...(config && typeof config === 'object' ? config : {}) });
});

// GET /api/invoices/:id/pdf: the issued invoice as PDF, for any logged-in role that can open invoices.
// Registrants (not logged in) get no invoice: staff issue it (AGENTS.md §12).
router.get('/:id/pdf', async (req, res) => {
  const row = db.prepare('SELECT id FROM invoices WHERE (id = ? OR invoice_number = ?) AND deleted_at IS NULL').get(req.params.id, req.params.id);
  if (!req.user) return res.status(401).json({ success: false, error: 'Silakan login terlebih dahulu' });
  const invoice = row ? buildInvoiceRow(row.id) : null;
  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan' });
  return sendInvoicePdf(req, res, invoice, invoiceDesign(true));
});

// ---------- Hapus Invoice, Tempat Sampah & Pulihkan (AGENTS.md §31) ----------
const rupiahText = (n) => `Rp ${(Number(n) || 0).toLocaleString('id-ID')}`;
const KIND_LABELS = { dp: 'DP', settlement: 'Pelunasan', full: 'Penuh', facility: 'Fasilitas' };
const STATUS_LABELS = { PAID: 'Lunas', PARTIAL: 'Uang Muka / DP', PENDING: 'Menunggu Verifikasi', UNPAID: 'Menunggu Bayar', CANCELED: 'Batal' };
const invoiceStatus = (inv) => String(inv?.payment_status || 'UNPAID').toUpperCase();

// What the confirmation, the trash list and the audit entry show about one invoice
const invoiceBrief = (inv) => ({
  id: inv.id,
  invoiceNumber: inv.invoice_number,
  kind: kindOf(inv),
  kindLabel: KIND_LABELS[kindOf(inv)] || 'Invoice',
  companyName: inv.company_name || inv.client_name || '',
  boothCode: inv.booth_code || '',
  floorplanId: inv.floorplan_id || '',
  totalAmount: Number(inv.total_amount) || 0,
  paidAmount: invoicePaidAmount(inv),
  paymentStatus: invoiceStatus(inv),
  statusLabel: STATUS_LABELS[invoiceStatus(inv)] || invoiceStatus(inv)
});

const auditInvoice = (req, action, brief, extra = {}) => {
  req.skipAudit = true; // written here with the invoice number, amount and reason
  writeAuditLog({
    user: req.user, action, category: 'Invoice',
    target: `${brief.invoiceNumber} (${brief.companyName || '-'}, booth ${brief.boothCode || '-'})`,
    summary: [`${brief.kindLabel} ${rupiahText(brief.totalAmount)}`, brief.statusLabel,
      brief.paidAmount > 0 ? `sudah dibayar ${rupiahText(brief.paidAmount)}` : '', extra.reason ? `Alasan: ${extra.reason}` : ''].filter(Boolean).join(' · '),
    method: req.method, path: `/api/invoices${req.path}`, statusCode: 200, ip: clientIp(req),
    details: { ...brief, ...extra }
  });
};

// GET /api/invoices/trash: invoices deleted on their own (Super Admin). Invoices of a project that is itself in the
// trash are listed there, not here.
router.get('/trash', (req, res) => {
  try {
    if (!canRestoreInvoice(req.user)) return res.status(403).json({ success: false, error: 'Tempat Sampah Invoice hanya untuk Super Admin.' });
    const rows = db.prepare(`
      SELECT inv.*, fp.title AS project_title, fp.deleted_at AS project_deleted_at
      FROM invoices inv LEFT JOIN floorplans fp ON fp.id = inv.floorplan_id
      WHERE inv.deleted_at IS NOT NULL AND inv.deleted_by IS NOT NULL
      ORDER BY inv.deleted_at DESC, inv.id DESC LIMIT 500
    `).all();
    res.json({
      success: true,
      invoices: rows.map(inv => ({
        ...invoiceBrief(inv),
        projectTitle: inv.project_title || '',
        projectInTrash: Boolean(inv.project_deleted_at),
        deletedAt: inv.deleted_at,
        deletedBy: inv.deleted_by || '',
        deletedByRole: inv.deleted_by_role || '',
        deleteReason: inv.delete_reason || ''
      }))
    });
  } catch (error) {
    console.error('Invoice trash error:', error);
    res.status(500).json({ success: false, error: 'Gagal memuat Tempat Sampah Invoice' });
  }
});

// GET /api/invoices/contract?floorplanId=&boothCode=&boothId=&taxRate= - Booth contract summary for the DP / Pelunasan wizard
router.get('/contract', (req, res) => {
  try {
    const { floorplanId, boothCode = '', boothId = '' } = req.query;
    if (!floorplanId || (!boothCode && !boothId)) {
      return res.status(400).json({ success: false, error: 'Project dan booth wajib dipilih' });
    }
    const c = getContract(floorplanId, boothCode, boothId);
    if (!c.booth) return res.status(404).json({ success: false, error: 'Booth tidak ditemukan di project ini' });
    // Booth prices behind the contract (all booths of a multi-booth contract): the form previews every PPN option from these
    const contractCode = c.invoiceCount > 0 && invoiceCodeTokens(c.latestInvoice?.booth_code).length > 1 ? c.latestInvoice.booth_code : c.booth.code;
    const gross = contractTaxFor(floorplanId, contractCode, { method: 'none' });
    const dpTax = c.dpInvoice ? dpTaxOf(c.dpInvoice, { total: c.contractTotal, dpp: c.dpp, ppn: c.ppn }) : null;

    const toLite = (inv) => inv && ({
      id: inv.id, invoice_number: inv.invoice_number, invoice_kind: kindOf(inv), payment_status: inv.payment_status,
      total_amount: inv.total_amount, paid_amount: invoicePaidAmount(inv), dp_percent: inv.dp_percent, created_at: inv.created_at,
      dpp_amount: inv.dpp_amount, tax_amount: inv.tax_amount, tax_method: inv.tax_method
    });
    const exhibitor = c.latestInvoice || {};
    res.json({
      success: true,
      contract: {
        booth: {
          id: c.booth.id, code: c.booth.code, category: c.booth.category, status: c.booth.status,
          widthM: c.booth.width_m, heightM: c.booth.height_m, price: c.booth.price,
          discountType: c.booth.discount_type, discountValue: c.booth.discount_value,
          discountAmount: c.booth.discount_amount || 0, discountReason: c.booth.discount_reason || ''
        },
        // Tenant data comes from the booth / exhibitor record, falling back to the contract's latest invoice
        tenant: {
          companyName: c.booth.owner_name || exhibitor.company_name || '',
          picName: c.booth.pic_name || exhibitor.client_name || c.booth.owner_name || '',
          email: c.booth.email || exhibitor.client_email || '',
          phone: c.booth.phone || exhibitor.client_phone || '',
          address: exhibitor.client_address || '',
          npwp: exhibitor.client_npwp || ''
        },
        hasInvoices: c.invoiceCount > 0,
        contractTotal: c.contractTotal,
        taxRate: c.invoiceCount > 0 ? c.taxRate : 0,
        // PPN of the running contract (none yet without invoices) + the booth prices to preview other options
        tax: c.invoiceCount > 0
          ? { method: c.taxMethod, rate: c.taxRate, display: c.taxDisplay, note: c.taxNote, subtotal: c.subtotal, dpp: c.dpp, ppn: c.ppn, total: c.contractTotal }
          : null,
        contractCode,
        base: { subtotal: gross?.subtotal || 0, discount: gross?.discount || 0 },
        dpTax,
        paidTax: c.paidTax,
        billed: c.billed,
        paid: c.paid,
        remaining: c.remaining,
        unbilled: c.unbilled,
        status: c.status,
        statusLabel: contractStatusLabel(c.status),
        dpInvoice: toLite(c.dpInvoice),
        settlementInvoice: toLite(c.settlementInvoice),
        invoices: c.invoices.map(toLite)
      }
    });
  } catch (error) {
    console.error('Fetch contract error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/invoices/:id - Get single invoice with parsed items & bank details
router.get('/:id', (req, res) => {
  try {
    // Same row as the list (Manajemen Invoice): Data Exhibitor, WhatsApp and the A4 document show the same invoice
    const invoice = db.prepare(`${INVOICE_ROW_SQL} WHERE inv.id = ? OR inv.invoice_number = ?`).get(req.params.id, req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan' });
    }
    res.json({ success: true, invoice: invoiceRowMapper()(invoice) });
  } catch (error) {
    console.error("Fetch single invoice error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/invoices - Create new invoice
// Creates an "Invoice DP" or "Invoice Pelunasan" for a booth contract. All amounts are computed here
// from the booth contract (never trusted from the client).
// A new invoice shows automatic dates (§44: Tanggal Terbit = the day it is downloaded, Jatuh Tempo = + invoiceDueDays)
// unless the form fixed one by hand (issueDateFixed / dueDateFixed with the date).
function fixDatesFromBody(id, body = {}) {
  const on = (v) => v === true || v === 1 || v === '1';
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  db.prepare('UPDATE invoices SET issue_date_fixed = ?, due_date_fixed = ? WHERE id = ?')
    .run(on(body.issueDateFixed) && isDate(body.issueDate) ? 1 : 0, on(body.dueDateFixed) && isDate(body.dueDate) ? 1 : 0, id);
}

export function createContractInvoice(req, res) {
  const {
    invoiceKind,
    floorplanId,
    boothId = '',
    boothCode = '',
    dpMode = 'percent',
    dpValue,
    changeContractTax = false,
    issueDate = new Date().toISOString().split('T')[0],
    dueDate,
    paymentMethod = 'Bank Transfer',
    bankDetails = null,
    clientAddress = '',
    clientNpwp = '',
    notes = '',
    confirmUnpaidDp = false
  } = req.body;

  if (!floorplanId || (!boothCode && !boothId)) {
    return res.status(400).json({ success: false, error: 'Pilih project dan booth terlebih dahulu' });
  }

  const c = getContract(floorplanId, boothCode, boothId);
  if (!c.booth) return res.status(404).json({ success: false, error: 'Booth tidak ditemukan di project ini' });

  const latest = c.latestInvoice || {};
  const companyName = c.booth.owner_name || latest.company_name || '';
  const clientName = c.booth.pic_name || latest.client_name || companyName;
  if (!companyName) {
    return res.status(400).json({ success: false, error: `Booth ${c.booth.code} belum memiliki tenant / exhibitor. Daftarkan tenant terlebih dahulu.` });
  }
  if (c.status === 'PAID') {
    return res.status(409).json({ success: false, code: 'CONTRACT_PAID', error: `Kontrak booth ${c.booth.code} sudah lunas penuh.` });
  }

  // PPN of the whole contract (DP + Pelunasan share it). A new contract takes the chosen options; a running
  // contract keeps its own unless the admin confirmed a change (unpaid invoices are then recomputed, paid ones never).
  const chosen = taxOptionsFrom(req.body, { isStaff: true });
  const contractCode = c.invoiceCount > 0 && invoiceCodeTokens(latest.booth_code).length > 1 ? latest.booth_code : c.booth.code;
  const current = { method: c.taxMethod, rate: c.taxRate, display: c.taxDisplay };
  const wantsChange = c.invoiceCount > 0 && req.body.taxMethod !== undefined
    && (chosen.method !== current.method || (chosen.method !== 'none' && (chosen.rate !== current.rate || chosen.display !== current.display)));
  if (wantsChange && !changeContractTax) {
    return res.status(409).json({
      success: false, code: 'TAX_CHANGE_CONFIRM', requireConfirmation: true,
      error: 'Pengaturan pajak kontrak ini akan diubah. Invoice yang belum dibayar dihitung ulang; invoice yang sudah DP / Lunas tidak berubah otomatis.'
    });
  }
  let contract;
  if (c.invoiceCount === 0 || wantsChange) {
    contract = { ...contractTaxFor(floorplanId, contractCode, chosen), display: chosen.display, note: chosen.note };
    if (wantsChange && c.paid > contract.total) {
      return res.status(409).json({ success: false, code: 'TAX_CHANGE_BELOW_PAID', error: 'Nilai kontrak dengan pengaturan pajak baru lebih kecil dari pembayaran yang sudah diterima.' });
    }
  } else {
    // Running contract: its stored snapshot (the value the tenant was billed)
    contract = { ...contractTaxOf(latest, c.booth.discount_amount), note: latest.tax_note || chosen.note };
  }
  const contractTotal = contract.total;
  if (contractTotal <= 0) {
    return res.status(400).json({ success: false, error: 'Nilai kontrak booth Rp 0 (booth gratis) sehingga tidak perlu ditagih.' });
  }

  const size = c.booth.width_m && c.booth.height_m ? ` (${c.booth.width_m}x${c.booth.height_m}m)` : '';
  let kind;
  let amount;
  let dpPercent = 0;
  let relatedId = null;
  let description;
  let part;

  if (invoiceKind === 'dp') {
    if (c.dpInvoice) {
      return res.status(409).json({
        success: false, code: 'DP_EXISTS', existingInvoiceId: c.dpInvoice.id, existingInvoiceNumber: c.dpInvoice.invoice_number,
        error: `Booth ${c.booth.code} sudah memiliki Invoice DP aktif (${c.dpInvoice.invoice_number}).`
      });
    }
    if (c.paid > 0) {
      return res.status(409).json({ success: false, code: 'ALREADY_PAID', error: 'Kontrak ini sudah menerima pembayaran, Invoice DP tidak dapat dibuat lagi.' });
    }
    const raw = Number(String(dpValue ?? '').replace(',', '.'));
    amount = dpMode === 'nominal' ? Math.round(raw) : Math.round((contractTotal * raw) / 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Nilai DP tidak boleh 0.' });
    }
    if (amount >= contractTotal) {
      return res.status(400).json({ success: false, error: 'Nilai DP harus lebih kecil dari total kontrak. Untuk pembayaran penuh gunakan Invoice Pelunasan.' });
    }
    kind = 'dp';
    part = taxPortion(contract, amount);
    dpPercent = dpMode === 'nominal' ? Math.round((amount / contractTotal) * 10000) / 100 : raw;
    description = `Uang Muka (DP ${dpPercent}%) Sewa Booth #${c.booth.code} ${c.booth.category || ''}${size}`.replace(/\s+/g, ' ');
  } else if (invoiceKind === 'settlement') {
    if (c.settlementInvoice) {
      return res.status(409).json({
        success: false, code: 'SETTLEMENT_EXISTS', existingInvoiceId: c.settlementInvoice.id, existingInvoiceNumber: c.settlementInvoice.invoice_number,
        error: `Booth ${c.booth.code} sudah memiliki invoice pelunasan / penuh aktif (${c.settlementInvoice.invoice_number}).`
      });
    }
    const dp = c.dpInvoice;
    const dpStatus = String(dp?.payment_status || '').toUpperCase();
    if (dp && !['PAID', 'PARTIAL'].includes(dpStatus) && !confirmUnpaidDp) {
      return res.status(409).json({
        success: false, code: 'DP_UNPAID', requireConfirmation: true,
        error: `Invoice DP ${dp.invoice_number} belum dibayar. Pelunasan tetap dapat dibuat, tetapi DP belum diterima.`
      });
    }
    part = dp ? taxRemainder(contract, dpTaxOf(dp, contract)) : { dpp: contract.dpp, ppn: contract.ppn, total: contract.total };
    amount = Math.max(0, part.total);
    if (amount <= 0) {
      return res.status(409).json({ success: false, code: 'CONTRACT_PAID', error: 'Tidak ada sisa kontrak yang perlu dilunasi.' });
    }
    kind = 'settlement';
    relatedId = dp ? dp.id : null;
    description = dp
      ? `Pelunasan Sewa Booth #${c.booth.code}${size} (setelah DP ${dp.invoice_number})`
      : `Pembayaran Penuh 100% Sewa Booth #${c.booth.code} ${c.booth.category || ''}${size}`.replace(/\s+/g, ' ');
  } else {
    return res.status(400).json({ success: false, error: 'Jenis invoice tidak dikenal' });
  }

  const id = `INV-${Date.now()}`;
  const invoiceNumber = nextInvoiceNumber(kind);
  const calculatedDueDate = dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const fp = db.prepare(`
    SELECT fp.event_id, COALESCE(e.title, fp.title) AS event_title, COALESCE(e.venue, '') AS event_venue
    FROM floorplans fp LEFT JOIN events e ON e.id = fp.event_id WHERE fp.id = ?
  `).get(floorplanId) || {};
  // Pelunasan without DP = the whole contract: one line per booth as priced, the discount on its own line
  const rows = kind === 'settlement' && !relatedId ? boothsForCode(floorplanId, contractCode) : [];
  const items = rows.length ? contractItems(rows, 'Pelunasan Sewa Booth') : [{ id: 'item-1', description, qty: 1, unitPrice: amount, amount }];
  const grossSubtotal = rows.length ? rows.reduce((acc, b) => acc + (Number(b.price) || 0), 0) : amount;
  const grossDiscount = rows.length ? rows.reduce((acc, b) => acc + Math.min(Number(b.price) || 0, Number(b.discount_amount) || 0), 0) : 0;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices (
        id, invoice_number, floorplan_id, booth_id, booth_code, event_id, event_title, event_venue,
        client_name, company_name, client_email, client_phone, client_address, client_npwp,
        issue_date, due_date, items_json, subtotal, discount_type, discount_value, discount_amount, discount_reason,
        tax_rate, tax_amount, total_amount, paid_amount, remaining_amount, payment_type, dp_percent,
        payment_status, payment_method, bank_details_json, notes,
        invoice_kind, related_invoice_id, dpp_amount, tax_method, tax_display, tax_note,
        contract_total, contract_tax_rate, contract_subtotal, contract_discount, contract_dpp, contract_tax_method, contract_tax_display
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nominal', 0, ?, '', ?, ?, ?, 0, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, invoiceNumber, floorplanId, c.booth.id, contractCode, fp.event_id || null, fp.event_title || null, fp.event_venue || null,
      clientName, companyName, c.booth.email || latest.client_email || '', c.booth.phone || latest.client_phone || '', clientAddress || latest.client_address || '', clientNpwp || latest.client_npwp || '',
      issueDate, calculatedDueDate, JSON.stringify(items), grossSubtotal, grossDiscount,
      part.ppn > 0 ? contract.rate : 0, part.ppn, amount, amount, kind === 'dp' ? 'dp' : 'full', dpPercent,
      paymentMethod, bankDetails ? JSON.stringify(bankDetails) : (latest.bank_details_json || null), notes,
      kind, relatedId, part.dpp, contract.method, contract.method === 'inclusive' && contract.display === 'hide' ? 'hide' : 'show', contract.note || null,
      ...Object.values(contractSnapshotParams(contract))
    );
    // A DP turns an unpaid single invoice of this booth into its Pelunasan (contract total - DP); a PPN change
    // recomputes the unpaid balance invoice
    recalcContract(floorplanId, c.booth.code, c.booth.id, { contract });
    fixDatesFromBody(id, req.body);
  })();
  syncPaymentStatusFromInvoices();

  const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return res.json({
    success: true,
    message: `${kind === 'dp' ? 'Invoice DP' : 'Invoice Pelunasan'} ${invoiceNumber} berhasil diterbitkan!`,
    invoice: { ...created, items, bankDetails: created.bank_details_json ? JSON.parse(created.bank_details_json) : null }
  });
}

router.post('/', (req, res) => {
  try {
    if (['dp', 'settlement'].includes(req.body?.invoiceKind)) {
      return createContractInvoice(req, res);
    }

    let {
      floorplanId,
      boothId,
      boothCode,
      eventId = 'EVT-2026-001',
      eventTitle = 'Indonesia International Expo 2026',
      eventVenue = 'Jakarta Convention Center (Hall A)',
      clientName,
      companyName,
      clientEmail = '',
      clientPhone = '',
      clientAddress = '',
      clientNpwp = '',
      issueDate = new Date().toISOString().split('T')[0],
      dueDate,
      items = [],
      subtotal = 0,
      discountType = 'nominal',
      discountValue = 0,
      discountAmount = 0,
      discountReason = '',
      taxRate = 0,
      taxAmount = 0,
      totalAmount = 0,
      paidAmount,
      remainingAmount,
      paymentType = 'full',
      dpPercent = 0,
      paymentStatus = 'UNPAID',
      paymentMethod = 'Bank Transfer',
      bankDetails = {
        bankName: 'Bank Central Asia (BCA)',
        accountNumber: '882-019-3321',
        accountName: 'PT EXPO KARYA INDONESIA'
      },
      notes = ''
    } = req.body;

    if (!companyName || !clientName) {
      return res.status(400).json({ success: false, error: 'Nama PIC dan Nama Perusahaan wajib diisi' });
    }

    // PPN (shared/invoiceTax.js): the amounts follow the chosen method, whatever total the form sent
    const taxOpts = req.body.taxMethod !== undefined || req.body.applyTax !== undefined ? taxOptionsFrom(req.body, { isStaff: true }) : null;
    const taxSplit = taxOpts ? { ...computeContractTax({ subtotal, discount: discountAmount, rate: taxOpts.rate, method: taxOpts.method }), display: taxOpts.display } : null;
    if (taxSplit) {
      totalAmount = taxSplit.total;
      taxAmount = taxSplit.ppn;
      taxRate = taxSplit.rate;
    }

    if (floorplanId && (boothCode || boothId)) {
      const existing = summarizeContract(getContractInvoices(floorplanId, boothCode, boothId));
      if (existing.invoiceCount > 0) {
        return res.status(409).json({
          success: false,
          code: 'CONTRACT_HAS_INVOICES',
          error: `Booth ${boothCode || ''} sudah memiliki invoice kontrak. Gunakan "Invoice DP" atau "Invoice Pelunasan" agar total kontrak tidak tertagih dua kali.`
        });
      }
    }

    const id = `INV-${Date.now()}`;
    const invoiceNumber = nextInvoiceNumber('full');

    // Default due date: 7 days from issue date if not provided
    const calculatedDueDate = dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const resolvedPaymentType = paymentType || (paidAmount > 0 && paidAmount < totalAmount ? 'dp' : 'full');
    let resolvedPaidAmount = paidAmount !== undefined ? Number(paidAmount) : 0;
    let resolvedRemainingAmount = remainingAmount !== undefined ? Number(remainingAmount) : 0;
    const resolvedDpPercent = dpPercent ? Number(dpPercent) : (resolvedPaymentType === 'dp' && totalAmount > 0 && resolvedPaidAmount > 0 ? Math.round((resolvedPaidAmount / totalAmount) * 100) : 0);

    let effectivePaymentStatus = paymentStatus;
    if (effectivePaymentStatus === 'PAID') {
      resolvedPaidAmount = totalAmount;
      resolvedRemainingAmount = 0;
    } else if (resolvedPaidAmount > 0 && resolvedPaidAmount < totalAmount) {
      resolvedRemainingAmount = Math.max(0, totalAmount - resolvedPaidAmount);
      if (effectivePaymentStatus === 'UNPAID') effectivePaymentStatus = 'PARTIAL';
    } else if (resolvedPaidAmount === 0 && effectivePaymentStatus !== 'PAID') {
      resolvedRemainingAmount = totalAmount;
    }

    const createTransaction = db.transaction(() => {
      // 1. Insert into invoices
      db.prepare(`
        INSERT INTO invoices (
          id, invoice_number, floorplan_id, booth_id, booth_code, event_id, event_title, event_venue,
          client_name, company_name, client_email, client_phone, client_address, client_npwp,
          issue_date, due_date, items_json, subtotal, discount_type, discount_value, discount_amount, discount_reason,
          tax_rate, tax_amount, total_amount, paid_amount, remaining_amount, payment_type, dp_percent,
          payment_status, payment_method, bank_details_json, notes,
          invoice_kind, contract_total, contract_tax_rate,
          dpp_amount, tax_method, tax_display, tax_note, contract_subtotal, contract_discount, contract_dpp, contract_tax_method, contract_tax_display
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          'full', ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        id, invoiceNumber, floorplanId || null, boothId || null, boothCode || null, eventId, eventTitle, eventVenue,
        clientName, companyName, clientEmail, clientPhone, clientAddress, clientNpwp,
        issueDate, calculatedDueDate, JSON.stringify(items), subtotal, discountType, discountValue, discountAmount, discountReason,
        taxRate, taxAmount, totalAmount, resolvedPaidAmount, resolvedRemainingAmount, resolvedPaymentType, resolvedDpPercent,
        effectivePaymentStatus, paymentMethod, JSON.stringify(bankDetails), notes,
        totalAmount, taxRate,
        taxSplit ? taxSplit.dpp : null, taxSplit ? taxSplit.method : null, taxSplit ? taxSplit.display : null, taxOpts ? taxOpts.note : null,
        taxSplit ? taxSplit.subtotal : null, taxSplit ? taxSplit.discount : null, taxSplit ? taxSplit.dpp : null,
        taxSplit ? taxSplit.method : null, taxSplit ? taxSplit.display : null
      );

      fixDatesFromBody(id, req.body);
      // Booth status / tenant / canvas follow the contract via syncPaymentStatusFromInvoices() below

      return { id, invoiceNumber };
    });

    const result = createTransaction();
    syncPaymentStatusFromInvoices();

    const createdRecord = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.id);
    let parsedItems = items;
    let parsedBankDetails = bankDetails;

    res.json({
      success: true,
      message: `Invoice ${result.invoiceNumber} berhasil diterbitkan!`,
      invoice: {
        ...createdRecord,
        items: parsedItems,
        bankDetails: parsedBankDetails
      }
    });
  } catch (error) {
    console.error("Create invoice error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/invoices/:id - Update invoice details
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    let {
      clientName,
      companyName,
      clientEmail,
      clientPhone,
      clientAddress,
      clientNpwp,
      issueDate,
      dueDate,
      items,
      subtotal,
      discountType,
      discountValue,
      discountAmount,
      discountReason,
      taxRate,
      taxAmount,
      totalAmount,
      paidAmount,
      remainingAmount,
      paymentType,
      dpPercent,
      paymentStatus,
      paymentMethod,
      bankDetails,
      notes
    } = req.body;

    const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan' });
    }

    // Nomor invoice changed by hand (AGENTS.md §44): a usable number, never one another invoice has (deleted ones
    // included, §31). The booking keeps pointing at the invoice (orders.invoice_number follows).
    let newNumber = null;
    if (req.body.invoiceNumber !== undefined && String(req.body.invoiceNumber).trim() !== existing.invoice_number) {
      newNumber = cleanInvoiceNumber(req.body.invoiceNumber);
      if (!newNumber) {
        return res.status(400).json({ success: false, code: 'INVALID_INVOICE_NUMBER', error: 'Nomor invoice hanya boleh berisi huruf, angka, dan tanda / . _ - (3–60 karakter, tanpa spasi)' });
      }
      const clash = db.prepare('SELECT invoice_number FROM invoices WHERE invoice_number = ? COLLATE NOCASE AND id != ?').get(newNumber, id);
      if (clash) {
        return res.status(409).json({ success: false, code: 'INVOICE_NUMBER_TAKEN', error: `Nomor ${clash.invoice_number} sudah dipakai invoice lain (termasuk invoice di Tempat Sampah)` });
      }
    }
    // Tanggal Terbit / Jatuh Tempo: automatic (0) or fixed by hand (1) per invoice (§44)
    const flagOf = (v) => v === undefined ? null : (v === true || v === 1 || v === '1' ? 1 : 0);
    const issueFixed = flagOf(req.body.issueDateFixed);
    const dueFixed = flagOf(req.body.dueDateFixed);
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    if ((issueFixed === 1 && !isDate(issueDate ?? existing.issue_date)) || (dueFixed === 1 && !isDate(dueDate ?? existing.due_date))) {
      return res.status(400).json({ success: false, code: 'INVALID_DATE', error: 'Isi tanggal yang ingin dikunci (format YYYY-MM-DD)' });
    }

    // DP / Pelunasan amounts come from the booth contract: the edit form may change client data, dates
    // and notes, but not the money (use the status control, or change the booth price / discount).
    if (['dp', 'settlement'].includes(kindOf(existing))) {
      items = subtotal = discountType = discountValue = discountAmount = discountReason = undefined;
      taxRate = taxAmount = totalAmount = paidAmount = remainingAmount = paymentType = dpPercent = paymentStatus = undefined;
    }

    // PPN of an Invoice Penuh (shared/invoiceTax.js): recomputed from its subtotal and discount with the chosen method
    const isSplitKind = ['dp', 'settlement'].includes(kindOf(existing));
    const taxOpts = !isSplitKind && (req.body.taxMethod !== undefined || req.body.applyTax !== undefined) ? taxOptionsFrom(req.body, { isStaff: true }) : null;
    const taxSplit = taxOpts ? {
      ...computeContractTax({
        subtotal: subtotal ?? existing.subtotal,
        discount: discountAmount ?? existing.discount_amount,
        rate: taxOpts.rate, method: taxOpts.method
      }),
      display: taxOpts.display
    } : null;
    if (taxSplit) {
      totalAmount = taxSplit.total;
      taxAmount = taxSplit.ppn;
      taxRate = taxSplit.rate;
    }

    const currentTotal = totalAmount !== undefined ? Number(totalAmount) : Number(existing.total_amount);
    let resolvedPaid = paidAmount !== undefined ? Number(paidAmount) : existing.paid_amount;
    let resolvedRemaining = remainingAmount !== undefined ? Number(remainingAmount) : existing.remaining_amount;

    if (paymentStatus === 'PAID') {
      resolvedPaid = currentTotal;
      resolvedRemaining = 0;
    } else if (paidAmount !== undefined && currentTotal !== undefined) {
      resolvedRemaining = Math.max(0, currentTotal - resolvedPaid);
    }

    db.prepare(`
      UPDATE invoices
      SET 
        client_name = COALESCE(?, client_name),
        company_name = COALESCE(?, company_name),
        client_email = COALESCE(?, client_email),
        client_phone = COALESCE(?, client_phone),
        client_address = COALESCE(?, client_address),
        client_npwp = COALESCE(?, client_npwp),
        issue_date = COALESCE(?, issue_date),
        due_date = COALESCE(?, due_date),
        items_json = COALESCE(?, items_json),
        subtotal = COALESCE(?, subtotal),
        discount_type = COALESCE(?, discount_type),
        discount_value = COALESCE(?, discount_value),
        discount_amount = COALESCE(?, discount_amount),
        discount_reason = COALESCE(?, discount_reason),
        tax_rate = COALESCE(?, tax_rate),
        tax_amount = COALESCE(?, tax_amount),
        total_amount = COALESCE(?, total_amount),
        paid_amount = COALESCE(?, paid_amount),
        remaining_amount = COALESCE(?, remaining_amount),
        payment_type = COALESCE(?, payment_type),
        dp_percent = COALESCE(?, dp_percent),
        payment_status = COALESCE(?, payment_status),
        payment_method = COALESCE(?, payment_method),
        bank_details_json = COALESCE(?, bank_details_json),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      clientName,
      companyName,
      clientEmail,
      clientPhone,
      clientAddress,
      clientNpwp,
      issueDate,
      dueDate,
      items ? JSON.stringify(items) : null,
      subtotal,
      discountType,
      discountValue,
      discountAmount,
      discountReason,
      taxRate,
      taxAmount,
      totalAmount,
      resolvedPaid,
      resolvedRemaining,
      paymentType,
      dpPercent,
      paymentStatus,
      paymentMethod,
      bankDetails ? JSON.stringify(bankDetails) : null,
      notes,
      id
    );

    if (issueFixed !== null || dueFixed !== null) {
      db.prepare('UPDATE invoices SET issue_date_fixed = COALESCE(?, issue_date_fixed), due_date_fixed = COALESCE(?, due_date_fixed) WHERE id = ?')
        .run(issueFixed, dueFixed, id);
    }
    if (newNumber) {
      db.transaction(() => {
        db.prepare('UPDATE invoices SET invoice_number = ? WHERE id = ?').run(newNumber, id);
        db.prepare('UPDATE orders SET invoice_number = ? WHERE invoice_number = ?').run(newNumber, existing.invoice_number);
      })();
      writeAuditLog({
        user: req.user, category: 'Invoice', action: 'Ubah nomor invoice',
        target: `${newNumber} (${existing.company_name || '-'}, booth ${existing.booth_code || '-'})`,
        summary: `${existing.invoice_number} → ${newNumber}`, method: 'PUT', path: `/invoices/${id}`, statusCode: 200, ip: clientIp(req),
        details: { invoiceId: id, from: existing.invoice_number, to: newNumber }
      });
    }

    // A single ("full") invoice IS the whole contract: its value follows the edited total and PPN (AGENTS.md §14)
    if (kindOf(existing) === 'full' && totalAmount !== undefined) {
      db.prepare('UPDATE invoices SET contract_total = ?, contract_tax_rate = ? WHERE id = ?')
        .run(Number(totalAmount) || 0, Number(taxRate) || 0, existing.id);
    }
    if (taxSplit) {
      db.prepare(`UPDATE invoices SET dpp_amount = @dpp, tax_method = @method, tax_display = @display, tax_note = COALESCE(tax_note, @note)${kindOf(existing) === 'full' ? `,
        contract_subtotal = @subtotal, contract_discount = @discount, contract_dpp = @dpp, contract_tax_method = @method, contract_tax_display = @display` : ''} WHERE id = @id`)
        .run({ dpp: taxSplit.dpp, method: taxSplit.method, display: taxSplit.display, note: taxOpts.note, subtotal: taxSplit.subtotal, discount: taxSplit.discount, id: existing.id });
    }
    const updatedRecord = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    syncPaymentStatusFromInvoices();
    let parsedItems = items;
    let parsedBankDetails = bankDetails;
    try { if (updatedRecord.items_json) parsedItems = JSON.parse(updatedRecord.items_json); } catch (e) {}
    try { if (updatedRecord.bank_details_json) parsedBankDetails = JSON.parse(updatedRecord.bank_details_json); } catch (e) {}

    res.json({
      success: true,
      message: 'Invoice berhasil diperbarui!',
      invoice: {
        ...updatedRecord,
        items: parsedItems,
        bankDetails: parsedBankDetails
      }
    });
  } catch (error) {
    console.error("Update invoice error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// What an invoice document may show or hide, per invoice (InvoiceA4View). Keys shared with Desain Layout Invoice
// override the layout for this invoice; the others default to shown.
const INVOICE_DISPLAY_KEYS = [
  'showDiscount', 'showContractBox', 'showBank', 'showNotes', 'showTerbilang', 'showDimensionsCol', 'showFacilitiesCol',
  'showClientNpwp', 'showClientAddress', 'showClientPhone', 'showClientEmail', 'showStamp', 'showWatermark'
];

// POST /api/invoices/:id/terms - Edit an issued invoice: DP amount (while the DP is unpaid), the contract's PPN
// setting (unpaid invoices are recomputed, paid ones never change) and what the document shows. Amounts are computed here.
router.post('/:id/terms', (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE (id = ? OR invoice_number = ?) AND deleted_at IS NULL').get(req.params.id, req.params.id);
    if (!inv) return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan' });
    const { dpMode = 'percent', dpValue, changeContractTax = false, display } = req.body || {};
    const kind = kindOf(inv);
    const statusOfInv = String(inv.payment_status || 'UNPAID').toUpperCase();
    const unpaid = ['UNPAID', 'PENDING'].includes(statusOfInv);
    const changes = [];

    // 1. Display choices (any invoice, also paid: they never change the money)
    let displayJson = null;
    if (display && typeof display === 'object') {
      const clean = {};
      INVOICE_DISPLAY_KEYS.forEach(k => { if (typeof display[k] === 'boolean') clean[k] = display[k]; });
      displayJson = JSON.stringify(clean);
    }

    // 2. Contract PPN and DP amount (booth contract invoices only)
    const wantsDp = dpValue !== undefined && dpValue !== null && dpValue !== '';
    const wantsTax = req.body.taxMethod !== undefined;
    if ((wantsDp || wantsTax) && (!CONTRACT_KINDS.includes(kind) || !inv.floorplan_id)) {
      return res.status(400).json({ success: false, error: 'DP dan pajak kontrak hanya untuk invoice sewa booth.' });
    }
    if (wantsDp && kind !== 'dp') {
      return res.status(400).json({ success: false, error: 'Nominal DP hanya bisa diubah pada Invoice DP. Untuk invoice penuh, buat Invoice DP agar sisanya menjadi Pelunasan.' });
    }
    if (wantsDp && !unpaid) {
      return res.status(409).json({ success: false, code: 'DP_ALREADY_PAID', error: `Invoice DP ${inv.invoice_number} sudah dibayar, nominalnya tidak bisa diubah. Batalkan dulu bila memang salah.` });
    }

    const c = CONTRACT_KINDS.includes(kind) && inv.floorplan_id ? getContract(inv.floorplan_id, inv.booth_code, inv.booth_id) : null;
    let contract = null;
    if (c && (wantsDp || wantsTax)) {
      const latest = c.latestInvoice || inv;
      const contractCode = invoiceCodeTokens(latest.booth_code).length > 1 ? latest.booth_code : (c.booth?.code || inv.booth_code);
      const chosen = taxOptionsFrom(req.body, { isStaff: true });
      const current = { method: c.taxMethod, rate: c.taxRate, display: c.taxDisplay };
      const taxChanged = wantsTax && (chosen.method !== current.method || (chosen.method !== 'none' && (chosen.rate !== current.rate || chosen.display !== current.display)));
      if (taxChanged && c.status === 'PAID') {
        return res.status(409).json({ success: false, code: 'CONTRACT_PAID', error: 'Kontrak booth ini sudah lunas; pengaturan pajaknya tidak bisa diubah lagi.' });
      }
      if (taxChanged && !changeContractTax) {
        return res.status(409).json({
          success: false, code: 'TAX_CHANGE_CONFIRM', requireConfirmation: true,
          error: 'Pengaturan pajak kontrak akan diubah. Invoice yang belum dibayar dihitung ulang; invoice yang sudah DP / Lunas tidak berubah otomatis.'
        });
      }
      contract = taxChanged
        ? { ...contractTaxFor(inv.floorplan_id, contractCode, chosen), display: chosen.display, note: chosen.note }
        : { ...contractTaxOf(latest, c.booth?.discount_amount), note: latest.tax_note || chosen.note };
      if (!contract || !(contract.total > 0)) return res.status(400).json({ success: false, error: 'Nilai kontrak booth tidak ditemukan / Rp 0.' });
      if (taxChanged && c.paid > contract.total) {
        return res.status(409).json({ success: false, code: 'TAX_CHANGE_BELOW_PAID', error: 'Nilai kontrak dengan pengaturan pajak baru lebih kecil dari pembayaran yang sudah diterima.' });
      }
      if (taxChanged) changes.push(`pajak kontrak: ${chosen.method}${chosen.method === 'inclusive' ? ` / ${chosen.display}` : ''}`);
    }

    // The DP of this contract (this invoice, or the DP behind a Pelunasan): its amount changes on request, and its
    // DPP / PPN follow a changed contract PPN, but only while it is unpaid
    const dpRow = kind === 'dp' ? inv : (c?.dpInvoice || null);
    const dpUnpaid = dpRow && ['UNPAID', 'PENDING'].includes(String(dpRow.payment_status || 'UNPAID').toUpperCase());
    let dpUpdate = null;
    if (dpRow && dpUnpaid && contract && (wantsDp || wantsTax)) {
      const raw = Number(String(wantsDp ? dpValue : '').replace(',', '.'));
      const amount = wantsDp
        ? (dpMode === 'nominal' ? Math.round(raw) : Math.round((contract.total * raw) / 100))
        : Math.round(Number(dpRow.total_amount) || 0);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Nilai DP tidak boleh 0.' });
      if (amount >= contract.total) return res.status(400).json({ success: false, error: 'Nilai DP harus lebih kecil dari total kontrak.' });
      const pct = Math.round((amount / contract.total) * 10000) / 100;
      const part = taxPortion(contract, amount);
      const size = c.booth?.width_m && c.booth?.height_m ? ` (${c.booth.width_m}x${c.booth.height_m}m)` : '';
      dpUpdate = {
        id: dpRow.id, amount, pct, part,
        items: [{ id: 'item-1', description: `Uang Muka (DP ${pct}%) Sewa Booth #${dpRow.booth_code} ${c.booth?.category || ''}${size}`.replace(/\s+/g, ' ').trim(), qty: 1, unitPrice: amount, amount }]
      };
      if (wantsDp) changes.push(`DP Rp ${amount.toLocaleString('id-ID')} (${pct}%)`);
    }

    db.transaction(() => {
      if (displayJson !== null) db.prepare('UPDATE invoices SET display_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(displayJson, inv.id);
      if (dpUpdate) {
        db.prepare(`
          UPDATE invoices SET total_amount = @amount, remaining_amount = @amount, paid_amount = 0, subtotal = @amount, dp_percent = @pct,
            items_json = @items, tax_rate = @rate, tax_amount = @ppn, dpp_amount = @dpp, tax_method = @method, tax_display = @display,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `).run({
          amount: dpUpdate.amount, pct: dpUpdate.pct, items: JSON.stringify(dpUpdate.items),
          rate: dpUpdate.part.ppn > 0 ? contract.rate : 0, ppn: dpUpdate.part.ppn, dpp: dpUpdate.part.dpp,
          method: contract.method, display: contract.method === 'inclusive' && contract.display === 'hide' ? 'hide' : 'show', id: dpUpdate.id
        });
      }
      // The unpaid balance (Pelunasan / Penuh) follows: contract - DP. Paid invoices are never rewritten.
      if (contract) recalcContract(inv.floorplan_id, c.booth?.code || inv.booth_code, c.booth?.id || inv.booth_id, { contract });
    })();
    if (contract) syncPaymentStatusFromInvoices();

    const updated = db.prepare(`${INVOICE_ROW_SQL} WHERE inv.id = ?`).get(inv.id);
    res.json({
      success: true,
      message: `Invoice ${inv.invoice_number} diperbarui${changes.length ? `: ${changes.join(', ')}` : ''}.`,
      invoice: invoiceRowMapper()(updated)
    });
  } catch (error) {
    console.error('Update invoice terms error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/invoices/:id/status - Update invoice and linked booth status
router.post('/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status, boothStatus, paidAmount, remainingAmount } = req.body;

    if (!status && !boothStatus) {
      return res.status(400).json({ success: false, error: 'Status pembayaran atau status booth wajib diisi' });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan' });
    }

    const totalAmt = Number(invoice.total_amount) || 0;
    const validStatus = status ? status.toUpperCase() : (boothStatus === 'sold' ? 'PAID' : (boothStatus === 'available' ? 'CANCELED' : 'UNPAID'));
    const invoiceKind = kindOf(invoice);
    const wasPaid = ['PAID', 'PARTIAL'].includes(String(invoice.payment_status || '').toUpperCase());
    if (invoiceKind === 'dp' && validStatus === 'CANCELED' && wasPaid && !req.body.confirmCancelPaidDp) {
      return res.status(409).json({
        success: false, code: 'CONFIRM_CANCEL_PAID_DP', requireConfirmation: true,
        error: `Invoice DP ${invoice.invoice_number} sudah dibayar. Membatalkannya akan mengembalikan kontrak ke belum dibayar dan menghitung ulang invoice pelunasan.`
      });
    }
    const fpId = invoice.floorplan_id;
    const bCode = invoice.booth_code;
    const bId = invoice.booth_id;

    let targetPaid = invoice.paid_amount;
    let targetRemaining = invoice.remaining_amount;

    if (validStatus === 'PAID') {
      targetPaid = totalAmt;
      targetRemaining = 0;
    } else if (validStatus === 'UNPAID') {
      targetPaid = 0;
      targetRemaining = totalAmt;
    } else if (validStatus === 'PARTIAL') {
      targetPaid = paidAmount !== undefined ? Number(paidAmount) : (targetPaid > 0 ? targetPaid : Math.round(totalAmt / 2));
      targetRemaining = Math.max(0, totalAmt - targetPaid);
    } else if (validStatus === 'CANCELED') {
      // Nothing left to collect; paid_amount is kept as audit trail of what was received before canceling
      targetRemaining = 0;
    } else if (paidAmount !== undefined) {
      targetPaid = Number(paidAmount);
      targetRemaining = Math.max(0, totalAmt - targetPaid);
    }

    const updateTransaction = db.transaction(() => {
      // 1. Update invoice
      db.prepare(`
        UPDATE invoices 
        SET payment_status = ?, paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(
        validStatus,
        targetPaid,
        targetRemaining,
        id
      );

      // 2. DP / Pelunasan / Penuh: recompute the open balance (e.g. a canceled DP raises the Pelunasan back);
      //    booth status, tenant, orders and canvas then follow the whole contract via the sync below.
      //    Add-on (facility) invoices never change the booth.
      if (CONTRACT_KINDS.includes(invoiceKind) && fpId && (bCode || bId)) {
        recalcContract(fpId, bCode, bId);
      }

      // 3. A facility invoice canceled here rejects its request; active again: invoiced again (§46, same as delete / restore)
      if (invoiceKind === 'facility') {
        if (validStatus === 'CANCELED') {
          db.prepare("UPDATE facility_requests SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ? AND deleted_at IS NULL").run(id);
        } else if (String(invoice.payment_status || '').toUpperCase() === 'CANCELED') {
          db.prepare("UPDATE facility_requests SET status = 'INVOICED', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ? AND status = 'REJECTED' AND deleted_at IS NULL").run(id);
        }
      }
    });

    updateTransaction();
    syncPaymentStatusFromInvoices();

    const contract = CONTRACT_KINDS.includes(invoiceKind) && fpId ? getContract(fpId, bCode, bId) : null;
    const finalBoothStatus = contract?.boothStatus || null;
    if (invoiceKind === 'dp' && validStatus === 'CANCELED' && wasPaid) {
      writeAuditLog({
        user: req.user, category: 'Invoice', action: 'Batalkan Invoice DP yang sudah dibayar',
        target: `${invoice.invoice_number} (${invoice.company_name}, booth ${bCode})`,
        summary: `DP Rp ${totalAmt.toLocaleString('id-ID')} dibatalkan; pelunasan dihitung ulang`, ip: clientIp(req)
      });
    }

    res.json({
      success: true,
      message: `Status invoice ${invoice.invoice_number} diubah menjadi ${validStatus}${finalBoothStatus ? `; kontrak booth #${bCode}: ${contractStatusLabel(contract.status)} (booth ${finalBoothStatus.toUpperCase()})` : ''}`,
      invoiceStatus: validStatus,
      boothStatus: finalBoothStatus,
      contractStatus: contract?.status || null
    });
  } catch (error) {
    console.error("Update invoice status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/invoices/sync-booth-discount - Direct save discount from Property Inspector & instant invoice sync
router.post('/sync-booth-discount', (req, res) => {
  try {
    const {
      floorplanId = 'FP-2026-001',
      boothCode,
      boothId,
      price = 5000000,
      discountType = 'nominal',
      discountValue = 0,
      discountAmount = 0,
      discountReason = ''
    } = req.body;

    if (!boothCode && !boothId) {
      return res.status(400).json({ success: false, error: 'Kode booth atau ID booth wajib diisi' });
    }

    const discount = saveBoothDiscount({
      floorplanId, boothCode, boothId, price: req.body.price, numPrice: Number(price) || 5000000,
      discountType, discountValue, discountReason
    });

    res.json({
      success: true,
      message: `Diskon booth #${boothCode} berhasil disimpan & disinkronkan langsung ke Invoice!`,
      discount
    });
  } catch (error) {
    console.error("Sync booth discount error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/invoices/:id - Delete invoice
// POST /api/invoices/:id/restore: bring a deleted invoice back (Super Admin)
router.post('/:id/restore', (req, res) => {
  try {
    if (!canRestoreInvoice(req.user)) return res.status(403).json({ success: false, error: 'Hanya Super Admin yang dapat memulihkan invoice.' });
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice tidak ada di Tempat Sampah' });

    const kind = kindOf(invoice);
    const isContract = CONTRACT_KINDS.includes(kind) && invoice.floorplan_id && invoice.booth_code;
    if (invoice.floorplan_id) {
      const fp = db.prepare('SELECT title, deleted_at FROM floorplans WHERE id = ?').get(invoice.floorplan_id);
      if (!fp || fp.deleted_at) {
        return res.status(409).json({ success: false, code: 'PROJECT_IN_TRASH', error: `Project invoice ini ${fp ? `("${fp.title}") ada di Tempat Sampah` : 'sudah tidak ada'}. Pulihkan project-nya lebih dulu.` });
      }
    }
    if (isContract) {
      // The contract may have received new invoices meanwhile: never two DP, two Pelunasan, or a Penuh next to them
      const live = getContractInvoices(invoice.floorplan_id, invoice.booth_code, invoice.booth_id).filter(i => invoiceStatus(i) !== 'CANCELED');
      const clash = live.find(i => kind === 'full' || kindOf(i) === 'full' || kindOf(i) === kind);
      if (clash) {
        return res.status(409).json({
          success: false, code: 'CONTRACT_HAS_INVOICES',
          error: `Booth ${invoice.booth_code} sudah punya invoice ${KIND_LABELS[kindOf(clash)] || ''} ${clash.invoice_number}. Hapus invoice itu lebih dulu bila invoice ${invoice.invoice_number} yang harus berlaku.`
        });
      }
    }

    const brief = invoiceBrief(invoice);
    db.transaction(() => {
      db.prepare(`UPDATE invoices SET deleted_at = NULL, deleted_by = NULL, deleted_by_role = NULL, restored_at = CURRENT_TIMESTAMP, restored_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(req.user?.name || 'Super Admin', invoice.id);
      if (isContract) {
        if (kind === 'dp') {
          // the Pelunasan issued for this DP subtracts it again
          db.prepare(`UPDATE invoices SET related_invoice_id = ? WHERE id IN (
            SELECT id FROM invoices WHERE floorplan_id = ? AND deleted_at IS NULL AND invoice_kind = 'settlement' AND related_invoice_id IS NULL AND LOWER(TRIM(booth_code)) = LOWER(TRIM(?)))`)
            .run(invoice.id, invoice.floorplan_id, invoice.booth_code);
        }
        recalcContract(invoice.floorplan_id, invoice.booth_code, invoice.booth_id);
      }
      // its facility request is invoiced again
      if (kind === 'facility') {
        db.prepare("UPDATE facility_requests SET status = 'INVOICED', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ? AND status = 'REJECTED' AND deleted_at IS NULL").run(invoice.id);
      }
    })();
    syncPaymentStatusFromInvoices();
    auditInvoice(req, 'Pulihkan invoice', brief, { reason: invoice.delete_reason || '', deletedBy: invoice.deleted_by || '', deletedAt: invoice.deleted_at });

    res.json({ success: true, message: `Invoice ${invoice.invoice_number} dipulihkan.`, invoice: brief });
  } catch (error) {
    console.error('Restore invoice error:', error);
    res.status(500).json({ success: false, error: 'Gagal memulihkan invoice' });
  }
});

// DELETE /api/invoices/:id { reason, confirmNumber }: soft delete. Only the invoice goes: the tenant, the booking and
// the booth status stay (a booth without any invoice left keeps its status; see syncPaymentStatusFromInvoices).
router.delete('/:id', (req, res) => {
  try {
    if (!canDeleteInvoice(req.user)) {
      return res.status(403).json({ success: false, error: 'Hanya Keuangan dan Super Admin yang dapat menghapus invoice.' });
    }
    const { id } = req.params;
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get(id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice tidak ditemukan' });
    }

    const kind = kindOf(invoice);
    const brief = invoiceBrief(invoice);
    const hasPayment = brief.paidAmount > 0;
    if (hasPayment && !canDeletePaidInvoice(req.user)) {
      return res.status(409).json({
        success: false,
        code: 'INVOICE_PAID',
        error: `Invoice ${invoice.invoice_number} sudah menerima pembayaran (${brief.statusLabel}). Hanya Super Admin yang dapat menghapusnya.`
      });
    }
    const reason = cleanDeleteReason(req.body?.reason);
    if (!reason) {
      return res.status(400).json({ success: false, code: 'REASON_REQUIRED', error: `Alasan penghapusan wajib diisi (minimal ${DELETE_REASON_MIN} karakter).` });
    }
    if (hasPayment && !sameInvoiceNumber(req.body?.confirmNumber, invoice.invoice_number)) {
      return res.status(400).json({ success: false, code: 'CONFIRM_NUMBER', error: `Ketik ulang nomor invoice ${invoice.invoice_number} untuk menghapus invoice yang sudah ada pembayarannya.` });
    }

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.transaction(() => {
      db.prepare('UPDATE invoices SET deleted_at = ?, deleted_by = ?, deleted_by_role = ?, delete_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(nowStr, req.user?.name || req.user?.role || 'Admin', req.user?.role || '', reason, id);
      if (kind === 'dp') {
        // The Pelunasan no longer has a DP to subtract
        db.prepare("UPDATE invoices SET related_invoice_id = NULL WHERE related_invoice_id = ? AND deleted_at IS NULL").run(id);
      }
      if (CONTRACT_KINDS.includes(kind) && invoice.floorplan_id && invoice.booth_code) {
        recalcContract(invoice.floorplan_id, invoice.booth_code, invoice.booth_id);
      }
      // A deleted facility invoice rejects its request in the Fasilitas menu (out of the facility revenue, §46)
      if (kind === 'facility') {
        db.prepare("UPDATE facility_requests SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ? AND deleted_at IS NULL").run(id);
      }
    })();
    syncPaymentStatusFromInvoices();
    auditInvoice(req, 'Hapus invoice', brief, { reason });

    res.json({
      success: true,
      message: `Invoice ${invoice.invoice_number} dipindahkan ke Tempat Sampah.`,
      invoice: brief
    });
  } catch (error) {
    console.error("Delete invoice error:", error);
    res.status(500).json({ success: false, error: 'Gagal menghapus invoice' });
  }
});

export default router;
