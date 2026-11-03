import './utils/envFile.js'; // server/.env must be loaded before the database path is resolved (imports run before index.js code)
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from './utils/password.js';
import { exhibitorIdFor } from './utils/exhibitorIdentity.js';
import { initialPriceMode } from '../../shared/templatePrice.js';
import { cleanBoothCode } from '../../shared/boothCodes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists. DATA_DIR (.env) points staging / tests at their own database copy.
// On Railway the container's own disk is thrown away on every deploy: the database must live on a Volume.
// A Volume attached to the service is used automatically (RAILWAY_VOLUME_MOUNT_PATH), DATA_DIR still wins.
const volumeDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
export const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : (volumeDir ? path.resolve(volumeDir) : path.join(__dirname, '../data'));
// 'volume' = survives deploys; 'ephemeral' = Railway without a Volume (all data is lost on the next deploy); 'local' = this computer
export const storageKind = !process.env.RAILWAY_ENVIRONMENT
  ? 'local'
  : (volumeDir && (dataDir === path.resolve(volumeDir) || dataDir.startsWith(path.resolve(volumeDir) + path.sep)) ? 'volume' : 'ephemeral');
if (storageKind === 'ephemeral') {
  console.warn('⚠️ Database disimpan di disk kontainer Railway (bukan Volume): SEMUA DATA HILANG pada deploy berikutnya. Pasang Volume pada service ini.');
}
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = path.join(dataDir, 'floorplan.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

// Initialize schema according to PRD
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    venue TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS floorplans (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    title TEXT NOT NULL,
    canvas_fabric_json TEXT,
    metadata_json TEXT,
    blueprint_json TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS booths (
    id TEXT PRIMARY KEY,
    floorplan_id TEXT NOT NULL,
    code TEXT NOT NULL,
    category TEXT DEFAULT 'Standard',
    price INTEGER DEFAULT 5000000,
    status TEXT DEFAULT 'available',
    owner_name TEXT DEFAULT '',
    width_m REAL DEFAULT 3,
    height_m REAL DEFAULT 3,
    shape TEXT DEFAULT 'rectangle',
    facilities_json TEXT,
    coordinates_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (floorplan_id) REFERENCES floorplans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    floorplan_id TEXT NOT NULL,
    booth_id TEXT,
    booth_code TEXT NOT NULL,
    company_name TEXT NOT NULL,
    pic_name TEXT NOT NULL,
    email TEXT,
    phone TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    payment_method TEXT DEFAULT 'qris',
    payment_status TEXT DEFAULT 'PAID',
    invoice_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (floorplan_id) REFERENCES floorplans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS venue_items (
    id TEXT PRIMARY KEY,
    floorplan_id TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT,
    label TEXT,
    width_m REAL,
    height_m REAL,
    coordinates_json TEXT,
    FOREIGN KEY (floorplan_id) REFERENCES floorplans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    floorplan_id TEXT,
    booth_id TEXT,
    booth_code TEXT,
    event_id TEXT,
    event_title TEXT,
    event_venue TEXT,
    client_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    client_email TEXT,
    client_phone TEXT,
    client_address TEXT,
    client_npwp TEXT,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    items_json TEXT,
    subtotal INTEGER NOT NULL,
    discount_type TEXT DEFAULT 'nominal',
    discount_value INTEGER DEFAULT 0,
    discount_amount INTEGER DEFAULT 0,
    discount_reason TEXT DEFAULT '',
    tax_rate REAL DEFAULT 0,
    tax_amount INTEGER DEFAULT 0,
    total_amount INTEGER NOT NULL,
    payment_status TEXT DEFAULT 'UNPAID',
    payment_method TEXT DEFAULT 'Bank Transfer',
    bank_details_json TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoice_settings (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS booth_categories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    width_m REAL DEFAULT 3,
    height_m REAL DEFAULT 3,
    default_price INTEGER DEFAULT 5000000,
    color TEXT DEFAULT '#3b82f6',
    border_color TEXT DEFAULT '#1d4ed8',
    is_free INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS brand_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon_type TEXT DEFAULT 'qris',
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    instructions TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS preset_layouts (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    tag TEXT DEFAULT 'Preset Custom',
    canvas_fabric_json TEXT,
    metadata_json TEXT,
    is_system INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS facility_forms (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'global',
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    event_title TEXT DEFAULT 'Indonesia International Expo 2026',
    deadline_date TEXT,
    terms_notes TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    is_template INTEGER DEFAULT 0,
    template_name TEXT DEFAULT '',
    items_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS facility_requests (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL,
    project_id TEXT DEFAULT 'global',
    booth_code TEXT NOT NULL,
    company_name TEXT NOT NULL,
    pic_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    items_json TEXT NOT NULL,
    total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'PENDING',
    notes TEXT DEFAULT '',
    invoice_id TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: ensure shape & brand_category columns exist
try {
  db.exec("ALTER TABLE booths ADD COLUMN shape TEXT DEFAULT 'rectangle'");
} catch (e) {}

try {
  db.exec("ALTER TABLE booths ADD COLUMN brand_category TEXT DEFAULT ''");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN brand_category TEXT DEFAULT ''");
} catch (e) {}

try {
  db.exec("ALTER TABLE brand_categories ADD COLUMN project_id TEXT DEFAULT 'global'");
} catch (e) {}

try {
  db.exec("ALTER TABLE booth_categories ADD COLUMN project_id TEXT DEFAULT 'global'");
} catch (e) {}

try {
  db.exec("ALTER TABLE booths ADD COLUMN discount_type TEXT DEFAULT 'nominal'");
} catch (e) {}

try {
  db.exec("ALTER TABLE booths ADD COLUMN discount_value REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE booths ADD COLUMN discount_amount REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE booths ADD COLUMN discount_reason TEXT DEFAULT ''");
} catch (e) {}

// Migration: Down Payment (Uang Muka), Paid Amount, and Remaining Balance
try {
  db.exec("ALTER TABLE invoices ADD COLUMN paid_amount REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE invoices ADD COLUMN remaining_amount REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE invoices ADD COLUMN payment_type TEXT DEFAULT 'full'");
} catch (e) {}

try {
  db.exec("ALTER TABLE invoices ADD COLUMN dp_percent REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN paid_amount REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN remaining_amount REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN payment_type TEXT DEFAULT 'full'");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN dp_percent REAL DEFAULT 0");
} catch (e) {}

// Migration: Soft delete support across entities
try {
  db.exec("ALTER TABLE floorplans ADD COLUMN deleted_at DATETIME DEFAULT NULL");
} catch (e) {}

try {
  db.exec("ALTER TABLE booths ADD COLUMN deleted_at DATETIME DEFAULT NULL");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN deleted_at DATETIME DEFAULT NULL");
} catch (e) {}

try {
  db.exec("ALTER TABLE invoices ADD COLUMN deleted_at DATETIME DEFAULT NULL");
} catch (e) {}

try {
  db.exec("ALTER TABLE venue_items ADD COLUMN deleted_at DATETIME DEFAULT NULL");
} catch (e) {}

// Migration: Full Tenant Biodata and Registration Source
try {
  db.exec("ALTER TABLE booths ADD COLUMN pic_name TEXT DEFAULT ''");
} catch (e) {}
try {
  db.exec("ALTER TABLE booths ADD COLUMN email TEXT DEFAULT ''");
} catch (e) {}
try {
  db.exec("ALTER TABLE booths ADD COLUMN phone TEXT DEFAULT ''");
} catch (e) {}
try {
  db.exec("ALTER TABLE booths ADD COLUMN registration_source TEXT DEFAULT 'online'");
} catch (e) {}
try {
  db.exec("ALTER TABLE booths ADD COLUMN registered_by TEXT DEFAULT ''");
} catch (e) {}

try {
  db.exec("ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'online'");
} catch (e) {}
try {
  db.exec("ALTER TABLE orders ADD COLUMN admin_name TEXT DEFAULT ''");
} catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_title TEXT NOT NULL,
    user_name TEXT DEFAULT 'Admin',
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Populate initial remaining_amount and paid_amount for existing records if uninitialized
try {
  db.exec(`
    UPDATE invoices 
    SET paid_amount = total_amount, remaining_amount = 0, payment_type = 'full'
    WHERE (paid_amount IS NULL OR (paid_amount = 0 AND (remaining_amount IS NULL OR remaining_amount = 0))) 
      AND UPPER(payment_status) = 'PAID';

    UPDATE invoices 
    SET paid_amount = 0, remaining_amount = total_amount, payment_type = 'full'
    WHERE (remaining_amount IS NULL OR (paid_amount = 0 AND remaining_amount = 0)) 
      AND UPPER(payment_status) != 'PAID';

    UPDATE orders 
    SET paid_amount = total_amount, remaining_amount = 0, payment_type = 'full'
    WHERE (paid_amount IS NULL OR (paid_amount = 0 AND (remaining_amount IS NULL OR remaining_amount = 0))) 
      AND UPPER(payment_status) = 'PAID';

    UPDATE orders 
    SET paid_amount = 0, remaining_amount = total_amount, payment_type = 'full'
    WHERE (remaining_amount IS NULL OR (paid_amount = 0 AND remaining_amount = 0)) 
      AND UPPER(payment_status) != 'PAID';
  `);
} catch (e) {}

// Populate default brand_category for existing sample booths & orders if empty
try {
  db.exec(`
    UPDATE orders SET brand_category = 'Teknologi & Gadget' WHERE (brand_category IS NULL OR brand_category = '') AND (company_name LIKE '%Telkom%' OR company_name LIKE '%Samsung%' OR company_name LIKE '%Google%' OR company_name LIKE '%Tokopedia%');
    UPDATE orders SET brand_category = 'Kuliner & F&B' WHERE (brand_category IS NULL OR brand_category = '') AND company_name LIKE '%Indofood%';
    UPDATE orders SET brand_category = 'Otomotif & Aksesoris' WHERE (brand_category IS NULL OR brand_category = '') AND company_name LIKE '%Astra%';
    UPDATE orders SET brand_category = 'Lainnya' WHERE (brand_category IS NULL OR brand_category = '');

    UPDATE booths SET brand_category = 'Teknologi & Gadget' WHERE (brand_category IS NULL OR brand_category = '') AND (owner_name LIKE '%Telkom%' OR owner_name LIKE '%Samsung%' OR owner_name LIKE '%Google%' OR owner_name LIKE '%Tokopedia%');
    UPDATE booths SET brand_category = 'Kuliner & F&B' WHERE (brand_category IS NULL OR brand_category = '') AND owner_name LIKE '%Indofood%';
    UPDATE booths SET brand_category = 'Otomotif & Aksesoris' WHERE (brand_category IS NULL OR brand_category = '') AND owner_name LIKE '%Astra%';
    UPDATE booths SET brand_category = 'Lainnya' WHERE (brand_category IS NULL OR brand_category = '') AND owner_name IS NOT NULL AND TRIM(owner_name) != '';
  `);
} catch (e) {}

// Seed default categories if table is empty
const catCount = db.prepare('SELECT COUNT(*) as count FROM booth_categories').get().count;
if (catCount === 0) {
  const defaultCats = [
    { id: 'cat_standard', key: 'Standard', name: 'Standard (3x3m)', width_m: 3, height_m: 3, default_price: 5000000, color: '#3b82f6', border_color: '#1d4ed8', is_free: 0, description: 'Booth standar partisi 3x3m', sort_order: 1 },
    { id: 'cat_corner', key: 'Corner', name: 'Corner Booth (3x3m)', width_m: 3, height_m: 3, default_price: 7500000, color: '#06b6d4', border_color: '#0891b2', is_free: 0, description: 'Booth sudut hook 2 sisi terbuka', sort_order: 2 },
    { id: 'cat_premium', key: 'Premium', name: 'Premium (6x3m)', width_m: 6, height_m: 3, default_price: 12000000, color: '#8b5cf6', border_color: '#6d28d9', is_free: 0, description: 'Booth premium medium frontage lebar', sort_order: 3 },
    { id: 'cat_island', key: 'Island', name: 'VIP Island (6x6m)', width_m: 6, height_m: 6, default_price: 25000000, color: '#f59e0b', border_color: '#d97706', is_free: 0, description: 'VIP Island pulau 4 sisi terbuka', sort_order: 4 },
    { id: 'cat_free', key: 'Free', name: 'Free / Additional (Gratis)', width_m: 2, height_m: 2, default_price: 0, color: '#10b981', border_color: '#059669', is_free: 1, description: 'Booth gratis / sponsor / fasilitas tambahan (Rp 0)', sort_order: 5 },
    { id: 'cat_custom', key: 'Custom', name: 'Custom Shape', width_m: 4, height_m: 4, default_price: 10000000, color: '#ec4899', border_color: '#be185d', is_free: 0, description: 'Kategori bentuk khusus fleksibel', sort_order: 6 }
  ];

  const insertCat = db.prepare(`
    INSERT INTO booth_categories (id, key, name, width_m, height_m, default_price, color, border_color, is_free, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  defaultCats.forEach(c => {
    insertCat.run(c.id, c.key, c.name, c.width_m, c.height_m, c.default_price, c.color, c.border_color, c.is_free, c.description, c.sort_order);
  });
}

// Seed default brand categories if table is empty
const brandCatCount = db.prepare('SELECT COUNT(*) as count FROM brand_categories').get().count;
if (brandCatCount === 0) {
  const defaultBrandCats = [
    'Fashion & Apparel',
    'Kuliner & F&B',
    'Travel & Tourism',
    'Education & Academy',
    'Teknologi & Gadget',
    'Kesehatan & Beauty',
    'Otomotif & Aksesoris',
    'Properti & Interior',
    'Kerajinan & Craft',
    'Lainnya'
  ];

  const insertBrandCat = db.prepare(`
    INSERT INTO brand_categories (id, name, is_active, sort_order)
    VALUES (?, ?, 1, ?)
  `);

  defaultBrandCats.forEach((name, idx) => {
    insertBrandCat.run(`bcat_${idx + 1}`, name, idx + 1);
  });
}

// Seed default payment methods if table is empty
const pmCount = db.prepare('SELECT COUNT(*) as count FROM payment_methods').get().count;
if (pmCount === 0) {
  const defaultPMs = [
    { id: 'pm_qris', key: 'qris', name: 'QRIS Instan', description: 'GoPay, OVO, Dana, Shopee, BCA QR', icon_type: 'qris', sort_order: 1 },
    { id: 'pm_bca_va', key: 'bca_va', name: 'BCA Virtual Account', description: 'Verifikasi Otomatis Bank BCA', icon_type: 'bank', sort_order: 2 },
    { id: 'pm_mandiri_va', key: 'mandiri_va', name: 'Mandiri / BNI VA', description: 'Virtual Account Bank Mandiri / BNI', icon_type: 'bank', sort_order: 3 },
    { id: 'pm_cc', key: 'cc', name: 'Kartu Kredit / Debit', description: 'Visa, Mastercard, JCB', icon_type: 'card', sort_order: 4 },
    { id: 'pm_transfer', key: 'manual_transfer', name: 'Transfer Bank Manual', description: 'Transfer ke Rekening Resmi EO', icon_type: 'transfer', sort_order: 5 }
  ];

  const insertPM = db.prepare(`
    INSERT INTO payment_methods (id, key, name, description, icon_type, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);

  defaultPMs.forEach(pm => {
    insertPM.run(pm.id, pm.key, pm.name, pm.description, pm.icon_type, pm.sort_order);
  });
}

// Seed default preset layouts if table is empty
const presetCount = db.prepare('SELECT COUNT(*) as count FROM preset_layouts').get().count;
if (presetCount === 0) {
  const defaultPresets = [
    {
      id: 'preset_blank',
      key: 'blank',
      title: 'Kanvas Kosong (Blank)',
      description: 'Mulai dari kanvas bersih dengan grid 1 meter untuk mendesain denah dari nol.',
      tag: 'Kanvas Bersih',
      is_system: 1,
      sort_order: 1
    }
  ];

  const insertPreset = db.prepare(`
    INSERT INTO preset_layouts (id, key, title, description, tag, is_system, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  defaultPresets.forEach(p => {
    insertPreset.run(p.id, p.key, p.title, p.description, p.tag, p.is_system, p.sort_order);
  });
}

// Seed default facility templates and default active form if empty
const facilityFormCount = db.prepare('SELECT COUNT(*) as count FROM facility_forms').get().count;
if (facilityFormCount === 0) {
  const defaultStandardItems = [
    { id: 'item_pwr_2a', name: 'Daya Listrik 2 Ampere (440 Watt)', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 750000, max_qty: 10, description: 'Termasuk instalasi kabel dan MCB pengaman' },
    { id: 'item_pwr_4a', name: 'Daya Listrik 4 Ampere (880 Watt)', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 1400000, max_qty: 5, description: 'Daya listrik ideal untuk display & komputer' },
    { id: 'item_tbl_ibm', name: 'Meja IBM Standard (180 x 45 cm)', category: 'Furnitur & Meja-Kursi', unit: 'Unit', price: 150000, max_qty: 10, description: 'Rangka besi lipat dengan taplak meja kain putih/hitam' },
    { id: 'item_chr_futura', name: 'Kursi Susun Futura (Cover Hitam)', category: 'Furnitur & Meja-Kursi', unit: 'Unit', price: 65000, max_qty: 20, description: 'Busa tebal empuk dan cover kain resmi' },
    { id: 'item_spot_led', name: 'Lampu Spotlight LED 50 Watt', category: 'Listrik & Pencahayaan', unit: 'Titik', price: 120000, max_qty: 8, description: 'Pencahayaan warm white terarah ke produk display' },
    { id: 'item_pwr_strip', name: 'Stop Kontak 4 Lubang + Kabel 5 Meter', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 85000, max_qty: 6, description: 'Standar SNI dengan saklar on/off individual' },
    { id: 'item_carpet', name: 'Karpet Buana Standar Baru (per m²)', category: 'Konstruksi & Karpet', unit: 'm²', price: 50000, max_qty: 36, description: 'Pilihan warna: Merah, Biru, Abu-abu, Hitam' },
    { id: 'item_bin', name: 'Waste Basket / Tempat Sampah Kecil', category: 'Kebersihan & Aksesoris', unit: 'Unit', price: 35000, max_qty: 4, description: 'Termasuk 3 kantong plastik sampah per hari' }
  ];

  const defaultCulinaryItems = [
    { id: 'item_pwr_10a', name: 'Daya Listrik Heavy Duty 10 Ampere (2200W)', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 3200000, max_qty: 3, description: 'Khusus oven listrik, fryer, microwave F&B' },
    { id: 'item_pwr_16a', name: 'Daya Listrik 16 Ampere (3500W)', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 4800000, max_qty: 2, description: 'Daya ekstra untuk kompor induksi komersial' },
    { id: 'item_sink_port', name: 'Wastafel Portable Cuci Piring & Tangan', category: 'Sanitasi & Air', unit: 'Unit', price: 650000, max_qty: 2, description: 'Lengkap dengan kran dan ember penampungan air' },
    { id: 'item_water_conn', name: 'Instalasi Sambungan Air Bersih & Pembuangan', category: 'Sanitasi & Air', unit: 'Titik', price: 1200000, max_qty: 2, description: 'Koneksi langsung ke pipa pasokan gedung venue' },
    { id: 'item_tbl_ss', name: 'Meja Kerja Stainless Steel 120x60cm', category: 'Furnitur & Meja-Kursi', unit: 'Unit', price: 350000, max_qty: 4, description: 'Food grade higienis anti karat' },
    { id: 'item_bin_jumbo', name: 'Tempat Sampah Jumbo 120 Liter + Roda', category: 'Kebersihan & Aksesoris', unit: 'Unit', price: 90000, max_qty: 4, description: 'Kapasitas besar cocok untuk limbah basah makanan' },
    { id: 'item_apar', name: 'Tabung APAR Dry Powder 3 Kg (Safety)', category: 'Keamanan & Safety', unit: 'Unit', price: 175000, max_qty: 2, description: 'Sesuai regulasi standar dinas pemadam kebakaran expo' }
  ];

  const defaultTechItems = [
    { id: 'item_lan_50m', name: 'Dedicated Kabel LAN Internet 50 Mbps', category: 'Jaringan & IT', unit: 'Titik', price: 1500000, max_qty: 4, description: 'Koneksi fiber optik stabil tanpa gangguan WiFi' },
    { id: 'item_tv_50', name: 'Smart TV LED 50 Inch + Standing Bracket', category: 'Multimedia & Display', unit: 'Hari', price: 1250000, max_qty: 4, description: 'Resolusi 4K UHD lengkap port HDMI dan USB' },
    { id: 'item_stab_1200', name: 'Stabilizer Voltase Stavol 1200 VA', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 300000, max_qty: 4, description: 'Melindungi server mini, laptop, dan perangkat sensitif' },
    { id: 'item_cntr_bar', name: 'Meja Counter Bar Minimalis Glossy', category: 'Furnitur & Meja-Kursi', unit: 'Unit', price: 450000, max_qty: 4, description: 'Desain elegan untuk registrasi atau demo produk tech' },
    { id: 'item_barstool', name: 'Kursi Barstool Putar Putih Chrome', category: 'Furnitur & Meja-Kursi', unit: 'Unit', price: 125000, max_qty: 6, description: 'Tinggi hidrolik dapat disesuaikan' },
    { id: 'item_scanner', name: 'Barcode / 2D QR Scanner Handheld USB', category: 'Peralatan IT', unit: 'Unit', price: 200000, max_qty: 5, description: 'Untuk pemindaian badge tiket pengunjung pameran' }
  ];

  const defaultCustomItems = [
    { id: 'item_spot_track', name: 'Lampu Sorot Track Rail High CRI 150W', category: 'Listrik & Pencahayaan', unit: 'Titik', price: 250000, max_qty: 12, description: 'Warna cahaya akurat untuk mobil/motor atau galeri seni' },
    { id: 'item_stage_wood', name: 'Flooring Panggung Kayu Melamin Glossy (m²)', category: 'Konstruksi & Karpet', unit: 'm²', price: 180000, max_qty: 72, description: 'Tinggi panggung 10cm dengan lis aluminium' },
    { id: 'item_brouch_stnd', name: 'Standing Akrilik Display Brosur 4 Tingkat', category: 'Aksesoris & Branding', unit: 'Unit', price: 100000, max_qty: 4, description: 'Bahan akrilik transparan tebal 3mm' },
    { id: 'item_clean_daily', name: 'Layanan Pembersihan Booth Harian (Dedicated)', category: 'Kebersihan & Layanan', unit: 'Hari', price: 150000, max_qty: 4, description: 'Pembersihan sebelum expo buka & setelah tutup' }
  ];

  const insertForm = db.prepare(`
    INSERT INTO facility_forms (
      id, project_id, title, description, event_title, deadline_date, terms_notes, is_active, is_template, template_name, items_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. Template Standar Trade Expo
  insertForm.run(
    'tpl_standard_expo',
    'global',
    'Formulir Standar Fasilitas Pameran Dagang (All-in-One)',
    'Paket kebutuhan umum untuk booth standar partisi maupun hook (listrik, meja kursi, lampu, stop kontak).',
    'Indonesia International Expo 2026',
    '2026-10-05',
    '1. Pengajuan paling lambat H-10 sebelum loading in.\n2. Pembatalan setelah H-5 dikenakan denda 50%.\n3. Dilarang memasang sambungan listrik ilegal.',
    0,
    1,
    'Template Standar Expo (All-in-One)',
    JSON.stringify(defaultStandardItems)
  );

  // 2. Template Kuliner & F&B
  insertForm.run(
    'tpl_culinary_expo',
    'global',
    'Formulir Fasilitas Khusus Food & Beverage (F&B)',
    'Dilengkapi daya listrik kapasitas besar, wastafel portable, instalasi saluran air, dan tempat sampah jumbo.',
    'Indonesia International Expo 2026',
    '2026-10-05',
    '1. Wajib memiliki tabung APAR di dalam area booth memasak.\n2. Saluran pembuangan minyak wajib menggunakan grease trap.',
    0,
    1,
    'Template Kuliner & F&B',
    JSON.stringify(defaultCulinaryItems)
  );

  // 3. Template IT & Teknologi
  insertForm.run(
    'tpl_tech_expo',
    'global',
    'Formulir Fasilitas Teknologi, Gadget & Startup',
    'Koneksi kabel LAN internet dedicated, TV LED display, stabilizer, dan meja counter demo.',
    'Indonesia International Expo 2026',
    '2026-10-05',
    '1. Kabel internet tidak boleh di-share ke booth lain.\n2. Penggunaan display audio harap menjaga batas kebisingan 70dB.',
    0,
    1,
    'Template Teknologi & Startup',
    JSON.stringify(defaultTechItems)
  );

  // 4. Template Luxury / Otomotif
  insertForm.run(
    'tpl_custom_expo',
    'global',
    'Formulir Fasilitas Booth Khusus & Otomotif',
    'Flooring panggung melamin, lampu spotlight track rel, dan dedicated cleaning service.',
    'Indonesia International Expo 2026',
    '2026-10-05',
    '1. Pemasangan panggung dan konstruksi harus diverifikasi oleh Floor Manager venue.',
    0,
    1,
    'Template Custom & Otomotif',
    JSON.stringify(defaultCustomItems)
  );

  // 5. Formulir Aktif Default Utama (Siap Dipakai & Dikirim ke Tenant)
  insertForm.run(
    'form_active_default',
    'global',
    'Formulir Permintaan Fasilitas Tambahan Expo 2026',
    'Silakan pilih kebutuhan fasilitas tambahan untuk booth pameran Anda. Tim teknis kami akan menyiapkan sebelum jadwal loading-in.',
    'Indonesia International Expo 2026',
    '2026-10-05',
    '1. Batas akhir pengajuan fasilitas tambahan adalah H-10 sebelum pelaksanaan expo.\n2. Seluruh pesanan fasilitas akan diterbitkan invoice resmi dan wajib diselesaikan pembayarannya sebelum hari loading-in.\n3. Kerusakan atau kehilangan inventaris sewaan menjadi tanggung jawab tenant sepenuhnya.',
    1,
    0,
    '',
    JSON.stringify(defaultStandardItems)
  );
}

// Users & Roles (superadmin, finance, sales, operations, developer, facility)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('superadmin', 'finance', 'sales', 'operations', 'developer', 'facility')),
    password_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Chat antar staf (AGENTS.md §38): direct = one conversation per pair (direct_key "idA|idB", sorted), group = Super Admin.
// last_read_id / last_delivered_id per member drive the unread count and the ticks.
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    title TEXT DEFAULT '',
    direct_key TEXT UNIQUE,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_message_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS chat_members (
    conversation_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    left_at DATETIME,
    last_read_id INTEGER DEFAULT 0,
    last_delivered_id INTEGER DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    attachment_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id);
  CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
`);

// Booth contract billing: DP + Pelunasan invoices (see utils/contractBilling.js)
//   invoice_kind: 'full' (single/legacy invoice) | 'dp' | 'settlement' | 'facility' (add-on, not part of the booth contract)
//   related_invoice_id: settlement -> its DP invoice
//   contract_total / contract_tax_rate: booth contract value (after private discount, incl. PPN) when the invoice was issued
for (const col of [
  "ALTER TABLE invoices ADD COLUMN invoice_kind TEXT DEFAULT 'full'",
  "ALTER TABLE invoices ADD COLUMN related_invoice_id TEXT",
  "ALTER TABLE invoices ADD COLUMN contract_total REAL",
  "ALTER TABLE invoices ADD COLUMN contract_tax_rate REAL"
]) {
  try { db.exec(col); } catch (e) {}
}
try {
  db.exec(`
    UPDATE invoices SET invoice_kind = 'facility'
    WHERE (invoice_kind IS NULL OR invoice_kind = 'full') AND id LIKE 'inv_fac_%'; -- never by number: the format is set in Setting (§44)
    UPDATE invoices SET invoice_kind = 'full' WHERE invoice_kind IS NULL;
    -- Existing invoices are "Invoice Penuh": the contract value is the invoice total
    UPDATE invoices SET contract_total = total_amount WHERE contract_total IS NULL AND invoice_kind = 'full';
    UPDATE invoices SET contract_tax_rate = COALESCE(tax_rate, 0) WHERE contract_tax_rate IS NULL AND invoice_kind != 'facility';
  `);
} catch (e) {}

// Tanggal invoice (AGENTS.md §44): 0 = automatic (Tanggal Terbit = the day it is downloaded, Jatuh Tempo = that
// day + invoiceDueDays), 1 = the stored issue_date / due_date was fixed by hand. Existing invoices become automatic.
for (const col of [
  'ALTER TABLE invoices ADD COLUMN issue_date_fixed INTEGER DEFAULT 0',
  'ALTER TABLE invoices ADD COLUMN due_date_fixed INTEGER DEFAULT 0'
]) {
  try { db.exec(col); } catch (e) {}
}

// PPN per invoice (shared/invoiceTax.js): method 'none' | 'exclusive' (added to the price) | 'inclusive' (price includes PPN),
// display 'show' | 'hide', DPP and the printed note, plus the contract breakdown every DP / Pelunasan shares.
// Older invoices keep NULL here and are split at display time from their total and stored rate (never rewritten).
for (const col of [
  'ALTER TABLE invoices ADD COLUMN tax_method TEXT',
  'ALTER TABLE invoices ADD COLUMN tax_display TEXT',
  'ALTER TABLE invoices ADD COLUMN dpp_amount REAL',
  'ALTER TABLE invoices ADD COLUMN tax_note TEXT',
  'ALTER TABLE invoices ADD COLUMN contract_subtotal REAL',
  'ALTER TABLE invoices ADD COLUMN contract_discount REAL',
  'ALTER TABLE invoices ADD COLUMN contract_dpp REAL',
  'ALTER TABLE invoices ADD COLUMN contract_tax_method TEXT',
  'ALTER TABLE invoices ADD COLUMN contract_tax_display TEXT',
  // Per-invoice choices of what the document shows (JSON of booleans; missing = follow Desain Layout Invoice)
  'ALTER TABLE invoices ADD COLUMN display_json TEXT'
]) {
  try { db.exec(col); } catch (e) {}
}

// Hapus Invoice (AGENTS.md §31): who deleted an invoice, why, and who restored it. `deleted_by` also marks an
// invoice deleted on its own, so restoring a project from its trash never brings such an invoice back.
for (const col of [
  'ALTER TABLE invoices ADD COLUMN deleted_by TEXT',
  'ALTER TABLE invoices ADD COLUMN deleted_by_role TEXT',
  'ALTER TABLE invoices ADD COLUMN delete_reason TEXT',
  'ALTER TABLE invoices ADD COLUMN restored_at DATETIME',
  'ALTER TABLE invoices ADD COLUMN restored_by TEXT'
]) {
  try { db.exec(col); } catch (e) {}
}
try {
  // Invoices deleted before this column existed, in a project that is not in the trash: deleted on their own
  db.exec(`
    UPDATE invoices SET deleted_by = '(tidak tercatat)'
    WHERE deleted_at IS NOT NULL AND deleted_by IS NULL
      AND floorplan_id IN (SELECT id FROM floorplans WHERE deleted_at IS NULL)
  `);
} catch (e) {}

// Harga booth mengikuti Katalog Template (AGENTS.md §32): booths.price_mode 'template' | 'custom', and the batches
// of "Samakan Semua Harga dengan Template" (old -> new price per booth; the last one can be undone).
try { db.exec('ALTER TABLE booths ADD COLUMN price_mode TEXT'); } catch (e) {}
db.exec(`
  CREATE TABLE IF NOT EXISTS price_sync_batches (
    id TEXT PRIMARY KEY,
    floorplan_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sync',
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    changes_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    undone_at DATETIME,
    undone_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_price_sync_batches_fp ON price_sync_batches (floorplan_id, created_at);
`);
try {
  // Booths from before this column: 'template' only when the price already IS the template price of the booth's
  // size, otherwise 'custom'. No price changes here, so nothing changes silently when this runs.
  const pending = db.prepare('SELECT id, floorplan_id, price, width_m, height_m FROM booths WHERE price_mode IS NULL').all();
  if (pending.length) {
    const catalog = db.prepare('SELECT * FROM booth_categories').all();
    const setMode = db.prepare('UPDATE booths SET price_mode = ? WHERE id = ?');
    db.transaction(() => {
      pending.forEach(b => {
        const own = catalog.filter(c => !c.project_id || c.project_id === 'global' || c.project_id === b.floorplan_id);
        setMode.run(initialPriceMode(b, own), b.id);
      });
    })();
  }
} catch (e) {
  console.error('price_mode backfill failed:', e);
}

// Hapus Tenant (AGENTS.md §33): one row per deletion (what was removed, so the Super Admin can restore it), and
// facility requests of a deleted tenant are archived instead of removed.
db.exec(`
  CREATE TABLE IF NOT EXISTS deleted_tenants (
    id TEXT PRIMARY KEY,
    floorplan_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    pic_name TEXT,
    phone TEXT,
    email TEXT,
    brand_category TEXT,
    scope TEXT NOT NULL DEFAULT 'tenant',
    booth_codes TEXT NOT NULL DEFAULT '',
    total_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    tenant_ref TEXT,
    payment_status TEXT,
    delete_reason TEXT,
    deleted_by TEXT,
    deleted_by_role TEXT,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    restored_at DATETIME,
    restored_by TEXT,
    restore_note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_deleted_tenants_fp ON deleted_tenants (floorplan_id, deleted_at);
`);
for (const col of [
  'ALTER TABLE facility_requests ADD COLUMN deleted_at DATETIME',
  'ALTER TABLE facility_requests ADD COLUMN deleted_by TEXT',
  // who archived a booking (orders are the tenant records of a project; orders.deleted_at already exists)
  'ALTER TABLE orders ADD COLUMN deleted_by TEXT'
]) {
  try { db.exec(col); } catch (e) {}
}

// Public link per published floorplan: /live/<public_slug> (several floorplans can be live at once)
try {
  db.exec("ALTER TABLE floorplans ADD COLUMN public_slug TEXT");
} catch (e) {}
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_floorplans_public_slug ON floorplans(public_slug) WHERE public_slug IS NOT NULL");
} catch (e) {}

// Element-specific attributes of venue items (e.g. doors: doorType, swing, mirrored, angle)
try {
  db.exec("ALTER TABLE venue_items ADD COLUMN properties_json TEXT");
} catch (e) {}

// Login sessions (only a SHA-256 hash of the bearer token is stored)
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Audit trail: who changed what, when (written automatically for every authenticated mutation + login events)
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    user_name TEXT NOT NULL,
    user_role TEXT,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    target TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    method TEXT,
    path TEXT,
    status_code INTEGER,
    ip TEXT DEFAULT '',
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
`);

// New roles ("facility" is the latest, AGENTS.md §46): older databases have a CHECK constraint without them, so the table
// is rebuilt once, after a copy of the database. Foreign keys are off meanwhile: DROP TABLE would otherwise cascade into
// `sessions` and log everyone out.
try {
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (usersSql && !usersSql.includes("'facility'")) {
    const widened = usersSql
      .replace(/CHECK\s*\(\s*role\s+IN\s*\([^)]*\)\s*\)/i, "CHECK (role IN ('superadmin', 'finance', 'sales', 'operations', 'developer', 'facility'))")
      .replace(/CREATE TABLE\s+("?users"?)/i, 'CREATE TABLE users_new');
    if (!widened.includes("'facility'") || !widened.includes('users_new')) throw new Error('definisi tabel users tidak dikenali');
    const backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const copy = path.join(backupsDir, `pre-migration_role-fasilitas_${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.prepare('VACUUM INTO ?').run(copy);
    const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'users' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all();
    const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(widened);
        db.exec('INSERT INTO users_new SELECT * FROM users');
        if (db.prepare('SELECT COUNT(*) AS n FROM users_new').get().n !== before) throw new Error('jumlah baris tidak sama');
        db.exec('DROP TABLE users');
        db.exec('ALTER TABLE users_new RENAME TO users');
        extras.forEach(x => db.exec(x.sql));
      })();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
    console.log(`👥 Role Fasilitas ditambahkan (${before} akun dipertahankan, salinan: backups/${path.basename(copy)}).`);
  }
} catch (e) {
  // The app keeps working: only an account with the new role cannot be saved
  console.error('Migrasi role users gagal:', e);
}

// Operational layer (Denah Operasional): one layer per sales floorplan, stored apart from the sales canvas.
//   ops_elements    elements added by the operations team (Fabric object JSON), optionally anchored to a booth
//   ops_booth_data  operations-only fields per booth (power, water, internet, setup status, notes)
//   ops_layers      layer version (optimistic locking between operations users) & last editor
//   ops_seen        per user: booth snapshot of the sales layer when the operational floorplan was last opened
//   notifications   in-app notifications (e.g. "Denah Sales berubah" for the operations team)
db.exec(`
  CREATE TABLE IF NOT EXISTS ops_elements (
    id TEXT NOT NULL,
    floorplan_id TEXT NOT NULL,
    type TEXT,
    label TEXT DEFAULT '',
    object_json TEXT NOT NULL,
    anchor_booth_id TEXT,
    anchor_booth_code TEXT,
    public_visible INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_by TEXT,
    updated_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    PRIMARY KEY (floorplan_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_ops_elements_fp ON ops_elements(floorplan_id, deleted_at);

  CREATE TABLE IF NOT EXISTS ops_booth_data (
    floorplan_id TEXT NOT NULL,
    booth_key TEXT NOT NULL,
    booth_code TEXT,
    power_watt INTEGER DEFAULT 0,
    water_needed INTEGER DEFAULT 0,
    internet TEXT DEFAULT 'tidak' CHECK (internet IN ('tidak', 'wifi', 'lan')),
    setup_status TEXT DEFAULT 'belum_datang' CHECK (setup_status IN ('belum_datang', 'proses_setup', 'siap', 'bongkar')),
    notes TEXT DEFAULT '',
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (floorplan_id, booth_key)
  );

  CREATE TABLE IF NOT EXISTS ops_layers (
    floorplan_id TEXT PRIMARY KEY,
    version INTEGER DEFAULT 0,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ops_seen (
    user_id TEXT NOT NULL,
    floorplan_id TEXT NOT NULL,
    snapshot_json TEXT,
    seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, floorplan_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    floorplan_id TEXT,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    link TEXT DEFAULT '',
    meta_json TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
`);

// Pusat Maintenance, error tracking (AGENTS.md §22). Errors are grouped by fingerprint; personal data is scrubbed
// before anything is stored and user IDs are kept only as masked references (never the real id, email or IP).
//   error_groups          one row per distinct error (message + location), with priority and handling status
//   error_events          individual occurrences (last 100 per group, 90 days)
//   error_group_users     masked user references per group (count of affected users)
//   maintenance_settings  key/value settings of the maintenance center (mask salt, later: AI model, cost limit)
db.exec(`
  CREATE TABLE IF NOT EXISTS error_groups (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    error_type TEXT DEFAULT 'Error',
    message TEXT NOT NULL,
    location TEXT DEFAULT '',
    area TEXT DEFAULT '',
    feature TEXT DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL DEFAULT 'baru',
    status_note TEXT DEFAULT '',
    status_by TEXT DEFAULT '',
    status_at DATETIME,
    occurrences INTEGER DEFAULT 0,
    affected_users INTEGER DEFAULT 0,
    reopened_count INTEGER DEFAULT 0,
    sample_stack TEXT DEFAULT '',
    environment TEXT DEFAULT '',
    app_version TEXT DEFAULT '',
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_notified_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_error_groups_status ON error_groups(status, priority, last_seen_at);
  CREATE TABLE IF NOT EXISTS error_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_ref TEXT DEFAULT '',
    user_role TEXT DEFAULT '',
    method TEXT DEFAULT '',
    url TEXT DEFAULT '',
    status_code INTEGER,
    browser TEXT DEFAULT '',
    app_version TEXT DEFAULT '',
    environment TEXT DEFAULT '',
    stack TEXT DEFAULT '',
    context_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_error_events_group ON error_events(group_id, occurred_at);
  CREATE TABLE IF NOT EXISTS error_group_users (
    group_id TEXT NOT NULL,
    user_ref TEXT NOT NULL,
    PRIMARY KEY (group_id, user_ref)
  );
  CREATE TABLE IF NOT EXISTS maintenance_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_by TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Pusat Maintenance: chat with the AI agent (AGENTS.md §27). One task = one conversation (later: one branch).
//   agent_tasks        title, status (diskusi, menunggu_rencana, dikerjakan, siap_ditinjau, dideploy, dibatalkan)
//   agent_messages     user / assistant / system messages (markdown text) + meta (attachments, context, tools used)
//   agent_attachments  screenshots & files, stored under DATA_DIR/agent-files (never in Git)
//   agent_runs         one agent run per user message: progress text, stop request, result
//   agent_usage        tokens & estimated cost of every Claude API call (monthly budget)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'diskusi',
    created_by TEXT,
    created_by_name TEXT DEFAULT '',
    branch TEXT DEFAULT '',
    pr_ref TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT DEFAULT '',
    meta_json TEXT,
    created_by_name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON agent_messages(task_id, id);
  CREATE TABLE IF NOT EXISTS agent_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    message_id INTEGER,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    name TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    file_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'berjalan',
    phase TEXT DEFAULT '',
    steps INTEGER DEFAULT 0,
    stop_requested INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    started_by TEXT DEFAULT '',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id, started_at);
  CREATE TABLE IF NOT EXISTS agent_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    run_id TEXT,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_usage_month ON agent_usage(created_at);
`);

// Denah Operasional: booths built with a "special design" (custom stand) are marked and coloured by the operations
// team. Stored with the other operations booth data, never on the sales booth.
for (const col of [
  "ALTER TABLE ops_booth_data ADD COLUMN special_design INTEGER DEFAULT 0",
  "ALTER TABLE ops_booth_data ADD COLUMN special_color TEXT DEFAULT ''"
]) {
  try { db.exec(col); } catch (e) {}
}

// Exhibitor email is optional (AGENTS.md §29): `orders.email` was created NOT NULL. SQLite cannot drop that with
// ALTER TABLE, so the table is rebuilt once: a copy of the database is written first (VACUUM INTO), then the table is
// recreated from its own definition without the NOT NULL, with every row, index and trigger.
try {
  const emailCol = db.prepare('PRAGMA table_info(orders)').all().find(c => c.name === 'email');
  if (emailCol?.notnull) {
    const def = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get().sql;
    const relaxed = def.replace(/(\bemail\s+TEXT)\s+NOT\s+NULL/i, '$1').replace(/CREATE TABLE\s+("?orders"?)/i, 'CREATE TABLE orders_email_nullable');
    if (relaxed === def || !/orders_email_nullable/.test(relaxed) || /\bemail\s+TEXT\s+NOT\s+NULL/i.test(relaxed)) throw new Error('definisi tabel orders tidak dikenali');
    const backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const copy = path.join(backupsDir, `pre-migration_email-opsional_${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.prepare('VACUUM INTO ?').run(copy);
    const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'orders' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all();
    const before = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(relaxed);
        db.exec('INSERT INTO orders_email_nullable SELECT * FROM orders');
        if (db.prepare('SELECT COUNT(*) AS n FROM orders_email_nullable').get().n !== before) throw new Error('jumlah baris tidak sama');
        db.exec('DROP TABLE orders');
        db.exec('ALTER TABLE orders_email_nullable RENAME TO orders');
        extras.forEach(x => db.exec(x.sql));
      })();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
    console.log(`📧 Kolom email pesanan kini opsional (${before} baris dipertahankan, salinan: backups/${path.basename(copy)}).`);
  }
} catch (e) {
  // The app keeps working: an order without email is then stored with '' (see orderRoutes.js `orderEmailValue`)
  console.error('Migrasi email opsional gagal:', e);
}
export const ordersEmailNullable = () => !db.prepare('PRAGMA table_info(orders)').all().find(c => c.name === 'email')?.notnull;

// Auto-merge booth (AGENTS.md §18): exhibitor identity per booth / order and the "Tampilkan Terpisah" switch
for (const col of [
  "ALTER TABLE booths ADD COLUMN exhibitor_id TEXT DEFAULT ''",
  "ALTER TABLE booths ADD COLUMN merge_separate INTEGER DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN exhibitor_id TEXT DEFAULT ''",
  // Note of a manual booking (Sales); copied to the invoice when it is generated
  "ALTER TABLE orders ADD COLUMN notes TEXT DEFAULT ''"
]) {
  try { db.exec(col); } catch (e) {}
}
try {
  // Old data: booths / orders that already have a tenant get their exhibitor ID (email first, company name as fallback)
  const needId = db.prepare(`
    SELECT b.id, b.floorplan_id, b.code, b.email, b.owner_name,
      (SELECT i.client_email FROM invoices i WHERE i.floorplan_id = b.floorplan_id AND i.deleted_at IS NULL
         AND (LOWER(TRIM(i.booth_code)) = LOWER(TRIM(b.code)) OR ('+' || LOWER(TRIM(i.booth_code)) || '+') LIKE ('%+' || LOWER(TRIM(b.code)) || '+%'))
       ORDER BY i.created_at DESC LIMIT 1) AS invoice_email
    FROM booths b
    WHERE COALESCE(b.exhibitor_id, '') = '' AND TRIM(COALESCE(b.owner_name, '')) != '' AND LOWER(COALESCE(b.status, '')) IN ('reserved', 'sold', 'booked')
  `).all();
  const setId = db.prepare('UPDATE booths SET exhibitor_id = ? WHERE id = ?');
  needId.forEach(b => { const id = exhibitorIdFor(b.email || b.invoice_email, b.owner_name); if (id) setId.run(id, b.id); });
  const orders = db.prepare("SELECT id, email, company_name FROM orders WHERE COALESCE(exhibitor_id, '') = ''").all();
  const setOrder = db.prepare('UPDATE orders SET exhibitor_id = ? WHERE id = ?');
  orders.forEach(o => { const id = exhibitorIdFor(o.email, o.company_name); if (id) setOrder.run(id, o.id); });
} catch (e) {
  console.error('Backfill exhibitor_id gagal:', e.message);
}

// First accounts of an empty database.
// Production (Railway, or INITIAL_ADMIN_PASSWORD set): ONLY a Super Admin, with the password from INITIAL_ADMIN_PASSWORD
// or a random one printed once in the deploy log. The repository is public, so the development passwords below must
// never guard a live website. Other staff accounts are created by the Super Admin in the "Pengguna" menu.
// Development / tests: one account per role with the known development passwords.
const secureAccounts = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.INITIAL_ADMIN_PASSWORD);
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, phone, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  if (secureAccounts) {
    const fromEnv = String(process.env.INITIAL_ADMIN_PASSWORD || '');
    const password = fromEnv.length >= 8 ? fromEnv : crypto.randomBytes(9).toString('base64url');
    const email = String(process.env.INITIAL_ADMIN_EMAIL || 'superadmin@expo.local').trim().toLowerCase();
    insertUser.run('usr_superadmin', 'Super Admin', email, '', 'superadmin', hashPassword(password));
    console.log(fromEnv.length >= 8
      ? `🔐 Akun Super Admin pertama dibuat: ${email} (password dari variabel INITIAL_ADMIN_PASSWORD)`
      : `🔐 Akun Super Admin pertama dibuat: ${email} / password sementara: ${password} — segera ganti setelah login`);
  } else {
    insertUser.run('usr_superadmin', 'Super Admin', 'superadmin@expo.local', '', 'superadmin', hashPassword('superadmin123'));
    insertUser.run('usr_finance', 'Tim Keuangan', 'keuangan@expo.local', '', 'finance', hashPassword('keuangan123'));
    insertUser.run('usr_sales', 'Tim Sales', 'sales@expo.local', '', 'sales', hashPassword('sales123'));
  }
}
// Default operations account (added with the operational floorplan feature; development only)
if (!secureAccounts && !db.prepare("SELECT 1 FROM users WHERE role = 'operations' LIMIT 1").get() && !db.prepare("SELECT 1 FROM users WHERE email = 'operasional@expo.local'").get()) {
  db.prepare(`INSERT INTO users (id, name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('usr_operations', 'Tim Operasional', 'operasional@expo.local', '', 'operations', hashPassword('operasional123'));
}

// Emergency access from the hosting panel: RESET_ADMIN_PASSWORD (min. 8 characters) sets the Super Admin password on
// start (the account is created or re-activated when needed) and signs out its sessions. The password is never logged.
// Remove the variable after logging in, otherwise every restart resets the password again.
{
  const resetPassword = String(process.env.RESET_ADMIN_PASSWORD || '');
  if (resetPassword && resetPassword.length < 8) {
    console.warn('⚠️ RESET_ADMIN_PASSWORD diabaikan: minimal 8 karakter.');
  } else if (resetPassword) {
    const email = String(process.env.INITIAL_ADMIN_EMAIL || 'superadmin@expo.local').trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare("UPDATE users SET password_hash = ?, role = 'superadmin', is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(hashPassword(resetPassword), existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO users (id, name, email, phone, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`usr_superadmin_${Date.now()}`, 'Super Admin', email, '', 'superadmin', hashPassword(resetPassword));
    }
    console.warn(`🔑 Password Super Admin ${email} diatur dari variabel RESET_ADMIN_PASSWORD. Hapus variabel itu setelah berhasil login.`);
  }
}

// A live website still using a development password (accounts created before the change above): warn in the log
if (secureAccounts) {
  try {
    const known = { 'superadmin@expo.local': 'superadmin123', 'keuangan@expo.local': 'keuangan123', 'sales@expo.local': 'sales123', 'operasional@expo.local': 'operasional123' };
    const weak = db.prepare("SELECT email, password_hash FROM users WHERE email IN ('superadmin@expo.local', 'keuangan@expo.local', 'sales@expo.local', 'operasional@expo.local')").all()
      .filter(u => verifyPassword(known[u.email], u.password_hash))
      .map(u => u.email);
    if (weak.length) console.warn(`⚠️ Akun berikut masih memakai password bawaan dari repo publik, segera ganti: ${weak.join(', ')}`);
  } catch (e) {}
}

// Booth numbers without outer / repeated spaces (AGENTS.md §40). Old data held "15        " in booths, orders and
// invoices: cleaned once everywhere (booths, orders, invoices incl. their items, the saved canvas), after a copy of
// the database. A booth whose clean number another booth of its floorplan already has is left as it is.
try {
  const DIRTY = (col) => `${col} IS NOT NULL AND (${col} != TRIM(${col}) OR ${col} LIKE '%  %' OR ${col} LIKE '% +%' OR ${col} LIKE '%+ %')`;
  const dirty = ['booths:code', 'orders:booth_code', 'invoices:booth_code']
    .reduce((n, tc) => { const [t, c] = tc.split(':'); return n + db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${DIRTY(c)}`).get().n; }, 0);
  if (dirty) {
    const backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    db.prepare('VACUUM INTO ?').run(path.join(backupsDir, `pre-migration_nomor-booth_${new Date().toISOString().replace(/[:.]/g, '-')}.db`));
    let fixed = 0;
    db.transaction(() => {
      const taken = db.prepare('SELECT 1 FROM booths WHERE floorplan_id = ? AND id != ? AND deleted_at IS NULL AND LOWER(code) = LOWER(?)');
      for (const b of db.prepare(`SELECT id, floorplan_id, code FROM booths WHERE ${DIRTY('code')}`).all()) {
        const clean = cleanBoothCode(b.code);
        if (clean && !taken.get(b.floorplan_id, b.id, clean)) { db.prepare('UPDATE booths SET code = ? WHERE id = ?').run(clean, b.id); fixed += 1; }
      }
      for (const o of db.prepare(`SELECT id, booth_code FROM orders WHERE ${DIRTY('booth_code')}`).all()) {
        db.prepare('UPDATE orders SET booth_code = ? WHERE id = ?').run(cleanBoothCode(o.booth_code), o.id);
      }
      for (const inv of db.prepare(`SELECT id, booth_code, items_json FROM invoices WHERE ${DIRTY('booth_code')}`).all()) {
        let items = inv.items_json;
        try {
          const list = JSON.parse(inv.items_json || '[]');
          if (Array.isArray(list)) items = JSON.stringify(list.map(it => (it?.boothCode ? { ...it, boothCode: cleanBoothCode(it.boothCode) } : it)));
        } catch (e) { /* items kept as they are */ }
        db.prepare('UPDATE invoices SET booth_code = ?, items_json = ? WHERE id = ?').run(cleanBoothCode(inv.booth_code), items, inv.id);
      }
      for (const fp of db.prepare('SELECT id, canvas_fabric_json FROM floorplans WHERE canvas_fabric_json IS NOT NULL').all()) {
        try {
          const canvas = JSON.parse(fp.canvas_fabric_json);
          let changed = false;
          (canvas.objects || []).forEach(o => ['code', 'booth_number'].forEach(k => {
            if (typeof o?.boothData?.[k] === 'string' && cleanBoothCode(o.boothData[k]) !== o.boothData[k]) { o.boothData[k] = cleanBoothCode(o.boothData[k]); changed = true; }
          }));
          if (changed) db.prepare('UPDATE floorplans SET canvas_fabric_json = ? WHERE id = ?').run(JSON.stringify(canvas), fp.id);
        } catch (e) { /* unreadable canvas: left as it is */ }
      }
    })();
    console.log(`🧹 Nomor booth dirapikan (spasi berlebih): ${fixed} booth, beserta booking, invoice dan denah.`);
  }
} catch (error) {
  console.error('Merapikan nomor booth gagal:', error);
}

// Compact the database (AGENTS.md §43): images once stored as base64 were moved to files (§28) but SQLite keeps the
// freed pages, so the file (and every backup copy of it) stayed ~4x larger than its data on a small Railway Volume.
// At start, when more than a quarter of the file is free pages, VACUUM rewrites it (atomic) and the WAL is truncated.
try {
  const pages = db.pragma('page_count', { simple: true });
  const free = db.pragma('freelist_count', { simple: true });
  const pageSize = db.pragma('page_size', { simple: true });
  if (pages > 0 && free / pages > 0.25 && free * pageSize > 2 * 1024 * 1024) {
    const before = fs.statSync(dbPath).size;
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`🗜️  Database dipadatkan: ${Math.round(before / 1048576)} MB → ${Math.round(fs.statSync(dbPath).size / 1048576 * 10) / 10} MB.`);
  }
} catch (error) {
  console.error('Memadatkan database gagal:', error);
}

export default db;
