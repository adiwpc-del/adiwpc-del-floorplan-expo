// Menu Fasilitas (AGENTS.md §46): Sales dan Operasional memakai seluruh menu (form, pengajuan, status, invoice
// fasilitas, daftar tenant untuk broadcast); invoice fasilitas yang dihapus membuat pengajuannya REJECTED, dan
// memulihkan invoice itu mengembalikan pengajuan ke INVOICED; PDF formulir dibuat server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, boothObject, createPublishedFloorplan } from './helpers.js';
import { chromiumPath } from '../src/utils/pdfRenderer.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist/index.html');
const canRender = Boolean(chromiumPath()) && fs.existsSync(DIST);

let s;
const FP = 'FP-TEST-FASILITAS';
before(async () => {
  s = await startServer();
  await createPublishedFloorplan(s.api, FP, [boothObject('A-01', { left: 0, top: 0 }), boothObject('A-02', { left: 300, top: 0 })]);
  const reg = await s.api('POST', '/orders/checkout', { floorplanId: FP, boothCodes: ['A-01'], fullName: 'Budi', brandName: 'Kopi Satu', brandCategory: 'F&B', phone: '081200000001', bookingType: 'booking', deferInvoice: true }, { as: 'sales' });
  assert.equal(reg.status, 200, reg.text);
});
after(async () => { await s?.stop(); });

const ITEMS = [{ id: 'listrik', name: 'Tambahan Listrik 900W', category: 'Listrik', unit: 'Unit', price: 750000 }];
const submit = (booth = 'A-01') => s.api('POST', '/facilities/requests/submit', {
  form_id: 'form_tes', project_id: FP, booth_code: booth, company_name: 'Kopi Satu', pic_name: 'Budi', phone: '081200000001',
  items: [{ ...ITEMS[0], qty: 2 }]
});
const requestOf = async (id, as = 'finance') => (await s.api('GET', '/facilities/requests', undefined, { as })).body.requests.find(r => r.id === id);

test('Sales dan Operasional memakai seluruh menu Fasilitas: form, pengajuan, status, invoice', async () => {
  for (const role of ['sales', 'operations']) {
    const form = await s.api('POST', '/facilities/forms', { project_id: FP, title: `Form ${role}`, items: ITEMS, is_active: 0 }, { as: role });
    assert.equal(form.status, 200, `${role} simpan form: ${form.text}`);
    assert.equal((await s.api('GET', '/facilities/forms', undefined, { as: role })).status, 200, `${role} lihat form`);
    const sub = await submit();
    assert.equal(sub.status, 200, sub.text);
    const id = sub.body.requestId || sub.body.request?.id || (await s.api('GET', '/facilities/requests', undefined, { as: role })).body.requests[0].id;
    assert.equal((await s.api('GET', '/facilities/requests', undefined, { as: role })).status, 200, `${role} lihat pengajuan`);
    const st = await s.api('PUT', `/facilities/requests/${id}/status`, { status: 'APPROVED' }, { as: role });
    assert.equal(st.status, 200, `${role} ubah status: ${st.text}`);
    const inv = await s.api('POST', `/facilities/requests/${id}/generate-invoice`, {}, { as: role });
    assert.equal(inv.status, 200, `${role} terbitkan invoice fasilitas: ${inv.text}`);
    assert.equal((await requestOf(id, role)).status, 'INVOICED');
  }
});

test('daftar tenant untuk broadcast / form: booth terisi dengan kontak, tanpa harga; Dashboard tetap tertutup untuk Operasional', async () => {
  for (const role of ['sales', 'operations']) {
    const r = await s.api('GET', `/facilities/tenants?projectId=${FP}`, undefined, { as: role });
    assert.equal(r.status, 200, `${role}: ${r.text}`);
    const t = r.body.tenants.find(x => x.boothCode === 'A-01');
    assert.ok(t, 'tenant A-01 ada');
    assert.equal(t.tenant, 'Kopi Satu');
    assert.equal(t.phone, '081200000001');
    assert.ok(!r.body.tenants.some(x => x.boothCode === 'A-02'), 'booth kosong tidak ikut');
    assert.ok(!/price|discount|total/i.test(Object.keys(t).join(',')), 'tanpa harga / diskon');
  }
  assert.equal((await s.api('GET', '/facilities/tenants?projectId=global', undefined, { as: 'operations' })).status, 200);
  assert.equal((await s.api('GET', `/stats?projectId=${FP}`, undefined, { as: 'operations' })).status, 403, 'Dashboard tetap tertutup');
  assert.equal((await s.api('GET', '/facilities/tenants')).status, 401, 'pengunjung tidak boleh');
});

test('invoice fasilitas dihapus di menu Invoice: pengajuan jadi REJECTED; dipulihkan: kembali INVOICED', async () => {
  const sub = await submit();
  assert.equal(sub.status, 200, sub.text);
  const id = sub.body.requestId || sub.body.request?.id;
  assert.ok(id, `id pengajuan: ${sub.text}`);
  assert.equal((await s.api('POST', `/facilities/requests/${id}/generate-invoice`, {}, { as: 'finance' })).status, 200);
  const req = await requestOf(id);
  assert.equal(req.status, 'INVOICED');
  assert.ok(req.invoice_id);

  const del = await s.api('DELETE', `/invoices/${req.invoice_id}`, { reason: 'salah input fasilitas tenant' }, { as: 'finance' });
  assert.equal(del.status, 200, del.text);
  assert.equal((await requestOf(id)).status, 'REJECTED');
  const other = (await s.api('GET', '/facilities/requests', undefined, { as: 'finance' })).body.requests.filter(r => r.id !== id && r.invoice_id);
  assert.ok(other.every(r => r.status === 'INVOICED'), 'pengajuan lain tidak tersentuh');

  const restore = await s.api('POST', `/invoices/${req.invoice_id}/restore`, {}, { as: 'superadmin' });
  assert.equal(restore.status, 200, restore.text);
  assert.equal((await requestOf(id)).status, 'INVOICED');
});

test('kategori fasilitas: awalnya 9 bawaan; daftar bisa diubah (tambah, hapus) oleh staf menu Fasilitas; isian dibersihkan dan divalidasi', async () => {
  const first = await s.api('GET', '/facilities/categories', undefined, { as: 'sales' });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.categories.length, 9);
  assert.ok(first.body.categories.includes('Listrik & Pencahayaan'));

  const next = first.body.categories.filter(c => c !== 'Keamanan & Safety').concat(['  Catering  ']);
  const put = await s.api('PUT', '/facilities/categories', { categories: next }, { as: 'operations' });
  assert.equal(put.status, 200, put.text);
  const saved = (await s.api('GET', '/facilities/categories', undefined, { as: 'finance' })).body.categories;
  assert.ok(saved.includes('Catering'), 'dirapikan');
  assert.ok(!saved.includes('Keamanan & Safety'), 'kategori bawaan bisa dihapus');
  assert.equal(saved.length, 9);

  for (const bad of [[], ['A', 'a'], ['x'.repeat(61)], ['  ']]) {
    assert.equal((await s.api('PUT', '/facilities/categories', { categories: bad }, { as: 'sales' })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await s.api('GET', '/facilities/categories')).status, 401, 'pengunjung tidak boleh');
});

test('ganti nama kategori: daftar dan item semua formulir / template ikut; jumlah pemakaian dilaporkan; tercatat di Log Aktivitas', async () => {
  const form = await s.api('POST', '/facilities/forms', {
    project_id: FP, title: 'Form Kategori', is_active: 0,
    items: [{ id: 'k1', name: 'Lampu Sorot', category: 'Listrik & Pencahayaan', unit: 'Unit', price: 100000 }, { id: 'k2', name: 'Meja', category: 'Furnitur & Meja-Kursi', unit: 'Unit', price: 50000 }]
  }, { as: 'sales' });
  assert.equal(form.status, 200, form.text);
  const usage = (await s.api('GET', '/facilities/categories', undefined, { as: 'sales' })).body.usage;
  assert.ok(usage['Listrik & Pencahayaan'] >= 1, 'jumlah item pemakai');

  assert.equal((await s.api('POST', '/facilities/categories/rename', { from: 'Listrik & Pencahayaan', to: 'Catering' }, { as: 'sales' })).status, 409, 'nama yang sudah ada ditolak');
  const ren = await s.api('POST', '/facilities/categories/rename', { from: 'Listrik & Pencahayaan', to: 'Listrik' }, { as: 'sales' });
  assert.equal(ren.status, 200, ren.text);
  assert.ok(ren.body.updatedItems >= 1);
  const cats = (await s.api('GET', '/facilities/categories', undefined, { as: 'sales' })).body.categories;
  assert.ok(cats.includes('Listrik') && !cats.includes('Listrik & Pencahayaan'));
  const forms = (await s.api('GET', '/facilities/forms', undefined, { as: 'sales' })).body.forms;
  const items = forms.flatMap(f => f.items || []);
  assert.ok(items.some(i => i.name === 'Lampu Sorot' && i.category === 'Listrik'));
  assert.ok(!items.some(i => i.category === 'Listrik & Pencahayaan'), 'tidak ada item tertinggal dengan nama lama');
  assert.ok(items.some(i => i.name === 'Meja' && i.category === 'Furnitur & Meja-Kursi'), 'kategori lain tidak tersentuh');

  const logs = (await s.api('GET', '/audit-logs?category=Fasilitas', undefined, { as: 'superadmin' })).body.logs;
  assert.ok(logs.some(l => /kategori/i.test(l.action) && /Listrik & Pencahayaan → Listrik/.test(l.summary)));
});

test('PDF formulir fasilitas dibuat server (Download PDF A4): staf menu Fasilitas; tanpa Chromium 503; PDF sungguhan bila tersedia', async () => {
  const body = { tenant: { boothCode: 'A-01', companyName: 'Kopi Satu', picName: 'Budi' }, form: { title: 'Form Tes', items: ITEMS }, items: ITEMS, mode: 'blank' };
  assert.equal((await s.api('POST', '/facilities/form-pdf', body)).status, 401, 'pengunjung tidak boleh');
  assert.equal((await s.api('POST', '/facilities/form-pdf', { items: ITEMS }, { as: 'sales' })).status, 400, 'tanpa data formulir');

  const off = await startServer({ PDF_ENGINE: 'off' });
  try {
    const r = await off.api('POST', '/facilities/form-pdf', body, { as: 'operations' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'PDF_ENGINE_UNAVAILABLE');
  } finally { await off.stop(); }

  if (!canRender) return;
  const login = await s.api('POST', '/auth/login', { email: 'sales@expo.local', password: 'sales123' });
  const res = await fetch(`${s.base}/facilities/form-pdf`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.body.token}` }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /Formulir_Fasilitas_A-01_Kopi_Satu\.pdf/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

const issueFacilityInvoice = async (booth) => {
  const id = (await submit(booth)).body.request.id;
  const r = await s.api('POST', `/facilities/requests/${id}/generate-invoice`, undefined, { as: 'sales' });
  assert.equal(r.status, 200);
  return { id, invoiceId: r.body.invoiceId, number: r.body.invoice.invoice_number };
};
const invoiceOf = async (invoiceId) => (await s.api('GET', `/invoices/${invoiceId}`, undefined, { as: 'finance' })).body;
const REASON = 'Tenant tidak jadi ikut pameran';

test('batalkan invoice fasilitas "tidak jadi": invoice CANCELED (tetap tercatat), pengajuan REJECTED, tercatat di Log Aktivitas', async () => {
  const { id, invoiceId, number } = await issueFacilityInvoice('C-01');
  assert.equal((await requestOf(id)).invoice.number, number, 'baris pengajuan menunjukkan invoice-nya');

  const url = `/facilities/requests/${id}/cancel-invoice`;
  assert.equal((await s.api('POST', url, { reason: REASON, outcome: 'rejected' })).status, 401);
  assert.equal((await s.api('POST', url, { reason: 'pendek', outcome: 'rejected' }, { as: 'sales' })).body.code, 'REASON_REQUIRED');
  assert.equal((await s.api('POST', url, { reason: REASON, outcome: 'apa' }, { as: 'sales' })).status, 400);

  const ok = await s.api('POST', url, { reason: REASON, outcome: 'rejected' }, { as: 'sales' });
  assert.equal(ok.status, 200);
  const inv = await invoiceOf(invoiceId);
  assert.equal((inv.invoice || inv).payment_status, 'CANCELED');
  const reqRow = await requestOf(id);
  assert.equal(reqRow.status, 'REJECTED');
  assert.equal(reqRow.invoice.status, 'CANCELED');

  assert.equal((await s.api('POST', url, { reason: REASON, outcome: 'rejected' }, { as: 'sales' })).body.code, 'NO_ACTIVE_INVOICE', 'tidak bisa dua kali');
  const logs = (await s.api('GET', '/audit-logs?limit=20', undefined, { as: 'superadmin' })).body;
  assert.match(JSON.stringify(logs), new RegExp(`Batalkan invoice fasilitas[\\s\\S]*${number}`));
});

test('batalkan invoice fasilitas "ada perubahan": pengajuan bisa diubah lalu diterbitkan invoice baru bernomor lain', async () => {
  const { id, number } = await issueFacilityInvoice('C-02');
  const edit = { items: [{ name: 'Tambahan Listrik 900W', category: 'Listrik', unit: 'Unit', price: 750000, qty: 3 }], notes: 'Tambah satu' };
  assert.equal((await s.api('PUT', `/facilities/requests/${id}`, edit, { as: 'sales' })).body.code, 'REQUEST_INVOICED', 'selama invoice aktif pengajuan terkunci');

  assert.equal((await s.api('POST', `/facilities/requests/${id}/cancel-invoice`, { reason: REASON, outcome: 'change' }, { as: 'operations' })).status, 200);
  let row = await requestOf(id);
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.invoice, null);

  assert.equal((await s.api('PUT', `/facilities/requests/${id}`, { items: [] }, { as: 'sales' })).status, 400);
  assert.equal((await s.api('PUT', `/facilities/requests/${id}`, { items: [{ name: 'X', price: 1000, qty: 0 }] }, { as: 'sales' })).status, 400);
  assert.equal((await s.api('PUT', `/facilities/requests/${id}`, edit, { as: 'sales' })).status, 200);
  row = await requestOf(id);
  assert.equal(row.total_amount, 2250000, 'total dihitung server');
  assert.equal(row.notes, 'Tambah satu');

  const again = await s.api('POST', `/facilities/requests/${id}/generate-invoice`, undefined, { as: 'sales' });
  assert.equal(again.status, 200);
  assert.notEqual(again.body.invoice.invoice_number, number);
  assert.equal(again.body.invoice.total_amount, 2250000);
});

test('invoice fasilitas tidak terbit dua kali; yang sudah dibayar hanya dibatalkan Super Admin dengan mengetik nomornya', async () => {
  const { id, invoiceId, number } = await issueFacilityInvoice('C-03');
  assert.equal((await s.api('POST', `/facilities/requests/${id}/generate-invoice`, undefined, { as: 'sales' })).body.code, 'REQUEST_INVOICED');

  assert.equal((await s.api('POST', `/invoices/${invoiceId}/status`, { status: 'PAID' }, { as: 'finance' })).status, 200);
  const url = `/facilities/requests/${id}/cancel-invoice`;
  const body = { reason: REASON, outcome: 'rejected' };
  assert.equal((await s.api('POST', url, body, { as: 'finance' })).body.code, 'INVOICE_PAID');
  assert.equal((await s.api('POST', url, body, { as: 'superadmin' })).body.code, 'CONFIRM_NUMBER');
  assert.equal((await s.api('POST', url, { ...body, confirmNumber: number }, { as: 'superadmin' })).status, 200);
  assert.equal((await requestOf(id)).status, 'REJECTED');
});

test('invoice fasilitas dibatalkan dari menu Invoice: pengajuan REJECTED; diaktifkan lagi: kembali INVOICED', async () => {
  const { id, invoiceId } = await issueFacilityInvoice('C-04');
  assert.equal((await s.api('POST', `/invoices/${invoiceId}/status`, { status: 'CANCELED' }, { as: 'finance' })).status, 200);
  assert.equal((await requestOf(id)).status, 'REJECTED');
  assert.equal((await s.api('POST', `/invoices/${invoiceId}/status`, { status: 'UNPAID' }, { as: 'finance' })).status, 200);
  assert.equal((await requestOf(id)).status, 'INVOICED');
});

test('hapus pengajuan fasilitas: tidak tampil lagi, bisa diurungkan; selama invoice aktif ditolak; tercatat di Log Aktivitas', async () => {
  const sub = await submit('A-01');
  const id = sub.body.requestId || sub.body.request?.id || (await s.api('GET', '/facilities/requests', undefined, { as: 'sales' })).body.requests[0].id;
  const url = `/facilities/requests/${id}`;
  assert.equal((await s.api('DELETE', url)).status, 401);
  assert.equal((await s.api('DELETE', '/facilities/requests/tidak-ada', undefined, { as: 'sales' })).status, 404);

  const del = await s.api('DELETE', url, undefined, { as: 'operations' });
  assert.equal(del.status, 200, del.text);
  assert.equal(await requestOf(id), undefined, 'hilang dari daftar');
  assert.equal((await s.api('DELETE', url, undefined, { as: 'sales' })).status, 404, 'tidak bisa dua kali');

  const undo = await s.api('POST', `${url}/restore`, undefined, { as: 'sales' });
  assert.equal(undo.status, 200, undo.text);
  assert.ok(await requestOf(id), 'kembali setelah diurungkan');
  assert.equal((await s.api('POST', `${url}/restore`, undefined, { as: 'sales' })).status, 404, 'yang tidak dihapus tidak dipulihkan');

  const { id: invoiced, invoiceId } = await issueFacilityInvoice('C-05');
  assert.equal((await s.api('DELETE', `/facilities/requests/${invoiced}`, undefined, { as: 'sales' })).body.code, 'REQUEST_INVOICED');
  assert.equal((await s.api('POST', `/facilities/requests/${invoiced}/cancel-invoice`, { reason: REASON, outcome: 'rejected' }, { as: 'sales' })).status, 200);
  assert.equal((await s.api('DELETE', `/facilities/requests/${invoiced}`, undefined, { as: 'sales' })).status, 200, 'setelah invoice dibatalkan boleh dihapus');
  const inv = await invoiceOf(invoiceId);
  assert.equal((inv.invoice || inv).payment_status, 'CANCELED', 'invoice yang dibatalkan tetap tercatat');

  const logs = JSON.stringify((await s.api('GET', '/audit-logs?limit=30', undefined, { as: 'superadmin' })).body);
  assert.match(logs, /Hapus pengajuan fasilitas/);
  assert.match(logs, /Pulihkan pengajuan fasilitas/);
});
