// Asisten WhatsApp (Fonnte) untuk staf (AGENTS.md §45): rahasia di URL webhook, hanya nomor staf, kata perintah
// tanpa AI (tanpa Claude), voice note ditolak sopan. Fonnte adalah tiruan lokal: tes tidak memanggil layanan asli.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, boothObject, createPublishedFloorplan } from './helpers.js';

const SECRET = 'rahasia-webhook-tes';
const FP = 'FP-TEST-WA';
const STAFF = '6281234567890';
const TECH_WORDS = /kuota|token|kredit|gemini|\bai\b|chat ?bot|\bbot\b|virtual|fonnte|server/i; // never told to the person chatting on WhatsApp
let s;
let wa;
const sent = []; // messages the server sent through the (mock) Fonnte API

const listen = (handler) => new Promise(resolve => { const srv = http.createServer(handler); srv.listen(0, '127.0.0.1', () => resolve(srv)); });
const readJson = async (req) => { let raw = ''; for await (const c of req) raw += c; return JSON.parse(raw || '{}'); };

before(async () => {
  wa = await listen(async (req, res) => { sent.push({ url: req.url, auth: req.headers.authorization, body: await readJson(req) }); res.end(JSON.stringify({ status: true })); });
  // No Claude key at all: the assistant works on commands only
  s = await startServer({ FONNTE_TOKEN: 'tok-fonnte', FONNTE_WEBHOOK_SECRET: SECRET, FONNTE_API_URL: `http://127.0.0.1:${wa.address().port}` });
  await createPublishedFloorplan(s.api, FP, [
    boothObject('A-01', { left: 0, top: 0 }), boothObject('A-02', { left: 300, top: 0 }),
    boothObject('UH 13 14', { left: 600, top: 0, widthM: 6, heightM: 3, price: 20000000 })
  ]);
  const reg = await s.api('POST', '/orders/checkout', { floorplanId: FP, boothCodes: ['A-01'], fullName: 'Budi', brandName: 'Kopi Satu', brandCategory: 'F&B', phone: '081200000001', bookingType: 'booking', deferInvoice: true, paymentType: 'dp', dpPercent: 30 }, { as: 'sales' });
  assert.equal(reg.status, 200, reg.text);
  const u = await s.api('POST', '/users', { name: 'Sari Sales', email: 'sari@expo.test', phone: '0812-3456-7890', role: 'sales', password: 'rahasia123' }, { as: 'superadmin' });
  assert.ok([200, 201].includes(u.status), u.text);
});
after(async () => { await s?.stop(); wa?.close(); });

const call = (payload, secret = SECRET) => fetch(`${s.base}/whatsapp/webhook/${secret}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
});
let counter = 0;
// the body Fonnte posts: one message per call
const text = (sender, message, extra = {}) => ({ device: '628111000111', sender, message, inboxid: ++counter, timestamp: Date.now(), ...extra });
async function waitSent(count) {
  for (let i = 0; i < 60 && sent.length < count; i++) await new Promise(r => setTimeout(r, 100));
  return sent.slice(count - 1);
}
// One message from the staff member, its reply text
async function ask(message) {
  const n = sent.length;
  assert.equal((await call(text(STAFF, message))).status, 200);
  const [msg] = await waitSent(n + 1);
  assert.ok(msg, `ada balasan untuk "${message}"`);
  return msg.body.message;
}

test('rahasia di URL salah: 404 dan tidak diproses (Fonnte tidak menandatangani panggilannya)', async () => {
  const before = sent.length;
  assert.equal((await call(text(STAFF, 'halo'), 'salah')).status, 404);
  assert.ok([401, 404].includes((await fetch(`${s.base}/whatsapp/webhook`, { method: 'POST' })).status), 'tanpa rahasia tidak bisa masuk');
  await new Promise(r => setTimeout(r, 400));
  assert.equal(sent.length, before);
});

test('nomor yang bukan staf tidak dijawab sama sekali', async () => {
  const before = sent.length;
  assert.equal((await call(text('6285555555555', 'TERSEDIA'))).status, 200);
  await new Promise(r => setTimeout(r, 600));
  assert.equal(sent.length, before);
});

test('pesan yang tidak dikenal dijawab MENU berisi daftar perintah; balasan lewat WhatsApp API', async () => {
  const n = sent.length;
  await call(text(STAFF, 'halo, booth kopi ada di mana?'));
  const [msg] = await waitSent(n + 1);
  assert.equal(msg.url, '/send');
  assert.equal(msg.auth, 'tok-fonnte', 'token Fonnte tanpa Bearer');
  assert.equal(msg.body.target, STAFF);
  for (const cmd of ['TERSEDIA', 'BOOTH', 'CARI', 'RINGKASAN', 'BOOKING', 'INVOICE']) assert.match(msg.body.message, new RegExp(cmd));
  assert.match(await ask('menu'), /TERSEDIA/);
});

test('TERSEDIA: hanya booth kosong (ukuran, harga); TERSEDIA 6x3 menyaring ukuran', async () => {
  const all = await ask('tersedia');
  assert.match(all, /A-02/);
  assert.match(all, /UH 13 14/);
  assert.ok(!/A-01/.test(all), 'booth yang dibooking tidak ikut');
  assert.match(all, /Rp 10\.000\.000/);
  const big = await ask('TERSEDIA 6x3');
  assert.match(big, /UH 13 14/);
  assert.ok(!/A-02/.test(big));
});

test('CARI dan BOOTH: tenant ditemukan; detail memuat rencana DP dan tanpa email; nomor booth berspasi', async () => {
  const found = await ask('cari kopi');
  assert.match(found, /Kopi Satu/);
  assert.match(found, /A-01/);
  const detail = await ask('BOOTH A-01');
  assert.match(detail, /Kopi Satu/);
  assert.match(detail, /DP 30%/);
  assert.ok(!/@/.test(detail), 'tanpa email');
  assert.match(await ask('booth uh 13 14'), /6x3/);
  assert.match(await ask('BOOTH Z-99'), /tidak ditemukan/i);
});

test('RINGKASAN: jumlah booth per status', async () => {
  const sum = await ask('ringkasan');
  assert.match(sum, /Tersedia: 2/);
  assert.match(sum, /Reserved: 1/);
});

test('voice note tanpa agen Gemini dijawab sopan: diminta mengetik', async () => {
  const n = sent.length;
  await call(text(STAFF, '', { url: 'https://example.test/vn.ogg', extension: 'ogg' }));
  const [msg] = await waitSent(n + 1);
  assert.match(msg.body.message, /pesan suara/i);
  assert.match(msg.body.message, /ketik/);
  assert.doesNotMatch(msg.body.message, TECH_WORDS);
});

test('pesan tanpa huruf / angka (pesan suara di paket Fonnte tanpa lampiran): dijawab jelas; catatan berisi kolom dan kode karakter, bukan isi', async () => {
  const n = sent.length;
  await call(text(STAFF, '\u200e ', { name: 'Sari' }));
  const [msg] = await waitSent(n + 1);
  assert.match(msg.body.message, /tidak berisi teks/);
  assert.doesNotMatch(msg.body.message, TECH_WORDS);
  const last = (await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status.lastIncoming;
  assert.equal(last.kind, 'tanpa teks');
  assert.deepEqual(last.fields, ['device', 'inboxid', 'message', 'name', 'sender', 'timestamp']);
  assert.deepEqual(last.textCodes, ['U+200E']);
  assert.match(await ask('👍'), /./, 'emoji saja tetap diproses');
  assert.equal((await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status.lastIncoming.kind, 'teks');
});

test('grup (member terisi) dan perangkat lain diabaikan', async () => {
  const n = sent.length;
  await call(text(STAFF, 'TERSEDIA', { member: '6281111' }));
  await call(text(STAFF, 'TERSEDIA'));
  await waitSent(n + 1);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(sent.length, n + 1, 'hanya pesan pribadi yang dijawab');
});

test('pesan yang sama (retry Fonnte) hanya diproses sekali', async () => {
  const payload = text(STAFF, 'TERSEDIA', { inboxid: 99999 });
  const n = sent.length;
  await call(payload);
  await waitSent(n + 1);
  await call(payload);
  await new Promise(r => setTimeout(r, 500));
  assert.equal(sent.length, n + 1);
});
