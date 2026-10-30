// Agen Gemini untuk asisten WhatsApp staf (AGENTS.md §45): pesan bebas dijawab Gemini dengan alat baca data dan alat
// siapkan booking / invoice; konfirmasinya buatan sistem dan hanya YA yang menyimpan. Kata perintah tetap dijawab sistem.
// Kunci Gemini hanya-tulis (Setting > Integrasi WhatsApp, Super Admin). Gemini dan Fonnte adalah tiruan lokal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, boothObject, createPublishedFloorplan } from './helpers.js';

const SECRET = 'rahasia-webhook-gemini';
const FP = 'FP-TEST-GEMINI';
const SALES = '6281234567890';
const FINANCE = '6281311112222';
const GOOD_KEY = 'AIzaTesKunciGeminiBenar0001';
const BAD_KEY = 'AIzaTesKunciGeminiSalah0002';
const AUTH_KEY = 'AQ.Ab8RN6TesKunciAuthBaru-Google.0003'; // new AI Studio "auth key" format (dots)
const OPEN_KEY = 'AIzaTesKunciTanpaBatasan0004'; // a standard key without restrictions: Google answers 403
const VOICE = Buffer.from('OggS-rekaman-suara-tiruan');
const TECH_WORDS = /kuota|token|kredit|gemini|\bai\b|chat ?bot|\bbot\b|virtual|fonnte|server/i; // never told to the person chatting on WhatsApp
let s;
let wa;
let gm;
const sent = []; // messages sent through the (mock) Fonnte API
const geminiCalls = []; // generateContent requests received by the (mock) Gemini API: { model, key, body }
const replies = []; // scripted Gemini answers, one per generateContent call ({ status, body } for an error)

const listen = (handler) => new Promise(resolve => { const srv = http.createServer(handler); srv.listen(0, '127.0.0.1', () => resolve(srv)); });
const readRaw = async (req) => { const parts = []; for await (const c of req) parts.push(c); return Buffer.concat(parts).toString(); };
const modelSays = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
const modelCalls = (name, args, thoughtSignature = 'sig-1') => ({
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id: `call-${name}` }, thoughtSignature }] }, finishReason: 'STOP' }]
});
const toolNames = (call) => (call.body.tools?.[0]?.functionDeclarations || []).map(d => d.name);

before(async () => {
  wa = await listen(async (req, res) => {
    const raw = await readRaw(req);
    // a document (invoice PDF) is a multipart upload: keep its caption and file name
    if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) {
      const form = await new Response(raw, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      sent.push({ target: form.get('target'), message: form.get('message'), filename: form.get('filename'), file: true });
    } else {
      sent.push(JSON.parse(raw || '{}'));
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: true }));
  });
  gm = await listen(async (req, res) => {
    const raw = await readRaw(req);
    const key = req.headers['x-goog-api-key'];
    const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (key === BAD_KEY) return send(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } });
    if (key === OPEN_KEY) return send(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Requests from unrestricted API keys are not allowed.' } });
    if (req.method === 'GET' && req.url === '/media/voice.ogg') { res.setHeader('Content-Type', 'audio/ogg'); return res.end(VOICE); } // the voice note Fonnte links to
    if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
      return send(200, { models: [
        { name: 'models/gemini-3-flash-preview', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }
      ] });
    }
    const m = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(req.url);
    if (req.method === 'POST' && m?.[1] === 'model-diam') return; // a model that never answers (the "latest" alias once did this)
    if (req.method === 'POST' && m) {
      geminiCalls.push({ model: m[1], key, body: JSON.parse(raw) });
      const next = replies.shift() || modelSays('(tidak ada jawaban tiruan)');
      return next.status ? send(next.status, next.body) : send(200, next);
    }
    send(404, {});
  });
  s = await startServer({
    FONNTE_TOKEN: 'tok-fonnte', FONNTE_WEBHOOK_SECRET: SECRET, FONNTE_API_URL: `http://127.0.0.1:${wa.address().port}`,
    GEMINI_API_URL: `http://127.0.0.1:${gm.address().port}`, GEMINI_TIMEOUT_MS: '1500'
  });
  await createPublishedFloorplan(s.api, FP, ['A-01', 'A-02', 'A-03'].map((c, i) => boothObject(c, { left: i * 300, top: 0 })));
  const reg = await s.api('POST', '/orders/checkout', { floorplanId: FP, boothCodes: ['A-01'], fullName: 'Budi', brandName: 'Kopi Satu', brandCategory: 'F&B', phone: '081200000001', bookingType: 'booking', deferInvoice: true }, { as: 'sales' });
  assert.equal(reg.status, 200, reg.text);
  for (const [name, email, phone, role] of [['Sari Sales', 'sari@expo.test', '0812-3456-7890', 'sales'], ['Fina Keuangan', 'fina@expo.test', '0813-1111-2222', 'finance']]) {
    const u = await s.api('POST', '/users', { name, email, phone, role, password: 'rahasia123' }, { as: 'superadmin' });
    assert.ok([200, 201].includes(u.status), u.text);
  }
  const key = await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: GOOD_KEY }, { as: 'superadmin' });
  assert.equal(key.status, 200, key.text);
});
after(async () => { await s?.stop(); wa?.close(); gm?.closeAllConnections(); gm?.close(); });

let counter = 0;
// Send one WhatsApp message from `sender` and return the text of the replies (`count` messages are awaited)
async function say(sender, message, count = 1, extra = {}) {
  const n = sent.length;
  const r = await fetch(`${s.base}/whatsapp/webhook/${SECRET}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: '628111000111', sender, message, inboxid: `g${++counter}`, timestamp: Date.now(), ...extra })
  });
  assert.equal(r.status, 200);
  for (let i = 0; i < 600 && sent.length < n + count; i++) await new Promise(res => setTimeout(res, 50));
  return sent.slice(n).map(m => m.message || '').join('\n');
}
const booth = async (code) => (await s.api('GET', `/floorplan/${FP}`, undefined, { as: 'superadmin' })).body.floorplan.booths.find(b => b.code === code);
const geminiStatus = async () => (await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status.gemini;

test('pengaturan Gemini: hanya Super Admin; kunci hanya-tulis (4 huruf terakhir); kunci salah ditolak dan kunci lama tetap; pilihan model', async () => {
  assert.equal((await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'sales' })).status, 403);
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: GOOD_KEY }, { as: 'finance' })).status, 403);

  const st = await geminiStatus();
  assert.equal(st.configured, true);
  assert.equal(st.hint, '…0001');
  assert.equal(st.enabled, true);
  assert.equal(st.model, 'gemini-3.5-flash', 'default = model tetap, bukan alias "latest" yang bisa macet');
  const full = await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' });
  assert.ok(!full.text.includes(GOOD_KEY), 'kunci tidak pernah dikirim balik');

  const bad = await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: BAD_KEY }, { as: 'superadmin' });
  assert.equal(bad.status, 400, bad.text);
  assert.match(bad.body.error, /ditolak|tidak valid/i);
  assert.equal((await geminiStatus()).hint, '…0001', 'kunci lama tetap');
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: 'ada spasi di sini' }, { as: 'superadmin' })).status, 400);

  // a key Google refuses because it has no restrictions: the answer says how to fix it in AI Studio
  const open = await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: OPEN_KEY }, { as: 'superadmin' });
  assert.equal(open.status, 400, open.text);
  assert.match(open.body.error, /Restrict to Gemini API only/);
  assert.match(open.body.error, /unrestricted API keys/, 'alasan dari Google ikut ditampilkan');
  // the new AI Studio key format (with dots) is accepted and checked with Google
  const auth = await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: AUTH_KEY }, { as: 'superadmin' });
  assert.equal(auth.status, 200, auth.text);
  assert.equal(auth.body.status.gemini.hint, '…0003');
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { apiKey: GOOD_KEY }, { as: 'superadmin' })).status, 200);

  const models = await s.api('GET', '/maintenance/whatsapp/gemini/models', undefined, { as: 'superadmin' });
  assert.equal(models.status, 200, models.text);
  assert.deepEqual(models.body.models.map(m => m.id), ['gemini-3-flash-preview'], 'hanya model yang bisa generateContent');
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { model: 'models/../x y' }, { as: 'superadmin' })).status, 400);
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { model: 'gemini-3-flash-preview' }, { as: 'superadmin' })).status, 200);
  assert.equal((await geminiStatus()).model, 'gemini-3-flash-preview');

  const logs = await s.api('GET', '/audit-logs?category=Maintenance', undefined, { as: 'superadmin' });
  assert.ok(logs.body.logs.some(l => /gemini/i.test(l.action)), 'tercatat di Log Aktivitas');
  assert.ok(![GOOD_KEY, BAD_KEY, AUTH_KEY, OPEN_KEY].some(k => logs.text.includes(k)), 'nilai kunci tidak tercatat');
});

test('pesan bebas dijawab Gemini memakai alat data; balasan model dikembalikan apa adanya; **tebal** jadi *tebal*', async () => {
  const n = geminiCalls.length;
  replies.push(modelCalls('detail_booth', { nomor_booth: 'A-01' }, 'sig-A'), modelSays('Booth A-01 dipakai **Kopi Satu**.'));
  assert.equal(await say(SALES, 'siapa yang ada di booth A-01 ya?'), 'Booth A-01 dipakai *Kopi Satu*.');

  const calls = geminiCalls.slice(n);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, GOOD_KEY);
  assert.equal(calls[0].model, 'gemini-3-flash-preview');
  assert.ok(calls[0].body.systemInstruction?.parts?.[0]?.text, 'instruksi sistem dikirim');
  assert.ok(toolNames(calls[0]).includes('siapkan_booking'));
  const contents = calls[1].body.contents;
  const modelTurn = contents[contents.length - 2];
  assert.equal(modelTurn.role, 'model');
  assert.equal(modelTurn.parts[0].thoughtSignature, 'sig-A', 'thought signature dikembalikan');
  const answer = contents[contents.length - 1].parts[0].functionResponse;
  assert.equal(answer.name, 'detail_booth');
  assert.equal(answer.id, 'call-detail_booth');
  assert.match(JSON.stringify(answer.response), /Kopi Satu/);
});

test('kata perintah tetap dijawab sistem tanpa Gemini; kalimat yang bukan perintah diteruskan ke Gemini; riwayat obrolan ikut', async () => {
  const n = geminiCalls.length;
  assert.match(await say(SALES, 'TERSEDIA'), /Booth tersedia/);
  assert.match(await say(SALES, 'BOOTH A-01'), /Kopi Satu/);
  assert.match(await say(SALES, 'RINGKASAN'), /Ringkasan/);
  assert.equal(geminiCalls.length, n, 'perintah tidak memanggil Gemini');

  replies.push(modelSays('Ada 2 booth kosong.'));
  assert.equal(await say(SALES, 'booth mana yang masih kosong?'), 'Ada 2 booth kosong.');
  replies.push(modelSays('Sama-sama.'));
  assert.equal(await say(SALES, 'terima kasih'), 'Sama-sama.');
  const last = geminiCalls[geminiCalls.length - 1].body.contents;
  assert.ok(JSON.stringify(last).includes('booth mana yang masih kosong?') && JSON.stringify(last).includes('Ada 2 booth kosong.'), 'pesan sebelumnya ikut');
});

test('booking lewat obrolan: Gemini menyiapkan, sistem mengirim konfirmasinya sendiri, hanya YA yang menyimpan', async () => {
  const n = geminiCalls.length;
  replies.push(modelCalls('siapkan_booking', { nomor_booth: ['A-02'], brand: 'Teh Dua', nama_pic: 'Rina', whatsapp: '081200000002', kategori: 'F&B', rencana: 'dp', dp_persen: 30 }));
  const confirm = await say(SALES, 'tolong bookingkan A-02 untuk Teh Dua, PIC Rina 081200000002, F&B, DP 30');
  assert.match(confirm, /Konfirmasi BOOKING/);
  assert.match(confirm, /A-02/);
  assert.match(confirm, /Teh Dua/);
  assert.match(confirm, /DP 30%/);
  assert.match(confirm, /Balas YA/);
  assert.equal(geminiCalls.length, n + 1, 'loop berhenti setelah booking disiapkan');
  assert.equal((await booth('A-02')).status, 'available', 'belum tersimpan sebelum YA');

  const saved = await say(SALES, 'ya');
  assert.match(saved, /Booking tersimpan/);
  assert.equal(geminiCalls.length, n + 1, 'YA dijawab sistem, bukan Gemini');
  const b = await booth('A-02');
  assert.equal(b.status, 'reserved');
  assert.equal(b.owner_name, 'Teh Dua');
});

test('Keuangan tidak bisa booking lewat Gemini: alasannya kembali ke Gemini, YA tidak menyimpan apa pun', async () => {
  const n = geminiCalls.length;
  replies.push(
    modelCalls('siapkan_booking', { nomor_booth: ['A-03'], brand: 'Roti Tiga', nama_pic: 'Tono', whatsapp: '081200000003', kategori: 'F&B', rencana: 'penuh' }),
    modelSays('Maaf, akun Keuangan tidak bisa membuat booking.')
  );
  assert.equal(await say(FINANCE, 'bookingkan A-03 untuk Roti Tiga'), 'Maaf, akun Keuangan tidak bisa membuat booking.');
  const toolAnswer = geminiCalls[n + 1].body.contents.at(-1).parts[0].functionResponse;
  assert.match(JSON.stringify(toolAnswer.response), /tidak dapat membuat booking/);

  replies.push(modelSays('Ada lagi yang bisa dibantu?'));
  assert.equal(await say(FINANCE, 'ya'), 'Ada lagi yang bisa dibantu?', 'tanpa permintaan menunggu, "ya" diteruskan ke Gemini');
  assert.equal((await booth('A-03')).status, 'available');
});

test('Gemini gagal (kuota habis, juga di model cadangan): di WhatsApp hanya kalimat netral; alasan teknisnya tercatat untuk admin', async () => {
  const n = geminiCalls.length;
  const quota = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } } };
  replies.push(quota, quota);
  const r = await say(SALES, 'halo');
  assert.match(r, /Mohon maaf, Kak/, 'tetap santun saat gagal');
  assert.match(r, /MENU/);
  assert.doesNotMatch(r, TECH_WORDS, 'tanpa kuota / token / AI / nama layanan');
  const last = (await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status.lastIncoming;
  assert.match(last.outcome, /kuota/i, 'alasannya terlihat di Setting'); 
  assert.deepEqual(geminiCalls.slice(n).map(c => c.model), ['gemini-3-flash-preview', 'gemini-3.1-flash-lite'], 'model cadangan ikut dicoba');
});

const chatWeb = (message, as = 'superadmin') => s.api('POST', '/maintenance/whatsapp/chat', { message }, { as });
const texts = (r) => (r.body.parts || []).filter(p => p.text).map(p => p.text).join('\n');

test('chat asisten di halaman Setting: bertanya, booking dan invoice lewat obrolan, tersimpan hanya setelah YA', async () => {
  replies.push(modelSays('Ada 1 booth kosong.'));
  let r = await chatWeb('booth kosong ada berapa?');
  assert.equal(r.status, 200, r.text);
  assert.equal(texts(r), 'Ada 1 booth kosong.');
  assert.ok(toolNames(geminiCalls.at(-1)).includes('siapkan_booking') && toolNames(geminiCalls.at(-1)).includes('siapkan_invoice'), 'alat booking dan invoice tersedia');

  replies.push(modelCalls('siapkan_booking', { nomor_booth: ['A-03'], brand: 'Roti Tiga', nama_pic: 'Tono', whatsapp: '081200000003', kategori: 'F&B', rencana: 'penuh' }));
  r = await chatWeb('bookingkan A-03 untuk Roti Tiga, PIC Tono 081200000003, F&B, bayar penuh');
  assert.match(texts(r), /Konfirmasi BOOKING/);
  assert.equal((await booth('A-03')).status, 'available', 'belum tersimpan sebelum YA');
  r = await chatWeb('ya');
  assert.match(texts(r), /Booking tersimpan/);
  assert.equal((await booth('A-03')).status, 'reserved');

  replies.push(modelCalls('siapkan_invoice', { nomor_booth: 'A-03' }));
  r = await chatWeb('buatkan invoicenya');
  assert.match(texts(r), /Konfirmasi INVOICE/);
  r = await chatWeb('ya');
  assert.match(texts(r), /Invoice Penuh \S+ terbit untuk booth A-03/);
  const pdf = r.body.parts.find(p => p.invoiceId);
  assert.ok(pdf, 'tombol PDF invoice');
  const inv = (await s.api('GET', '/invoices', undefined, { as: 'finance' })).body.invoices.find(i => i.id === pdf.invoiceId);
  assert.equal(inv?.booth_code, 'A-03');

  const logs = await s.api('GET', '/audit-logs?category=WhatsApp', undefined, { as: 'superadmin' });
  assert.ok(logs.body.logs.some(l => /Booking via chat Setting/.test(l.action)), 'tercatat dari chat Setting');
  assert.equal((await chatWeb('halo', 'sales')).status, 403);
  assert.equal((await chatWeb('', 'superadmin')).status, 400);
});

test('cek invoice dan kirim PDF invoice lewat obrolan: sudah / belum ada, PDF langsung dikirim tanpa YA', async () => {
  const inv = (await s.api('GET', '/invoices', undefined, { as: 'finance' })).body.invoices.find(i => i.floorplan_id === FP && i.booth_code === 'A-03');
  assert.ok(inv, 'invoice A-03 dari test chat');
  const num = new RegExp(inv.invoice_number.replace(/[/.]/g, '\\$&'));
  const lastToolAnswer = () => JSON.stringify(geminiCalls.at(-1).body.contents.at(-1).parts[0].functionResponse.response);

  replies.push(modelCalls('cari_invoice', { kata: 'A-03' }), modelSays('Sudah ada.'));
  assert.equal(texts(await chatWeb('invoice A-03 sudah dibuat belum?')), 'Sudah ada.');
  assert.match(lastToolAnswer(), num, 'nomor invoice dikirim ke Gemini');
  assert.match(lastToolAnswer(), /Penuh/);
  replies.push(modelCalls('cari_invoice', { kata: 'Kopi Satu' }), modelSays('Belum ada.'));
  await chatWeb('invoice kopi satu sudah ada?');
  assert.match(lastToolAnswer(), /belum ada invoice/i);

  // send: no YA, the system's own message + the PDF
  const n = geminiCalls.length;
  replies.push(modelCalls('kirim_pdf_invoice', { nomor: 'A-03' }));
  let r = await chatWeb('kirimin pdf invoice A-03');
  assert.equal(geminiCalls.length, n + 1, 'langsung dikirim');
  assert.match(texts(r), num);
  assert.ok(r.body.parts.some(p => p.invoiceId === inv.id), 'tombol PDF invoice yang benar di chat Setting');
  replies.push(modelCalls('kirim_pdf_invoice', { nomor: 'Z-99' }), modelSays('Invoice Z-99 tidak ditemukan.'));
  r = await chatWeb('kirim invoice Z-99');
  assert.equal(texts(r), 'Invoice Z-99 tidak ditemukan.');
  assert.match(lastToolAnswer(), /Belum ada invoice/i);

  // on WhatsApp: the text and then the PDF file (or the reason when it cannot be made)
  replies.push(modelCalls('kirim_pdf_invoice', { nomor: inv.invoice_number }));
  const wa = await say(SALES, 'tolong kirim pdf invoice A-03', 2);
  assert.match(wa, num);
  assert.ok(sent.slice(-2).some(m => m.file) || /PDF/.test(wa), 'PDF terkirim sebagai file, atau alasannya dikabarkan');
});

test('daftar booth per status bayar: lunas, dan reserved (DP / belum bayar / belum ada invoice), lewat Gemini dan kata perintah', async () => {
  const inv = (await s.api('GET', '/invoices', undefined, { as: 'finance' })).body.invoices.find(i => i.floorplan_id === FP && i.booth_code === 'A-03');
  const paid = await s.api('POST', `/invoices/${inv.id}/status`, { status: 'PAID' }, { as: 'finance' });
  assert.equal(paid.status, 200, paid.text);
  const lastToolAnswer = () => JSON.stringify(geminiCalls.at(-1).body.contents.at(-1).parts[0].functionResponse.response);

  replies.push(modelCalls('daftar_booth', { status: 'lunas' }), modelSays('Yang lunas: A-03.'));
  assert.equal(texts(await chatWeb('booth mana saja yang sudah lunas?')), 'Yang lunas: A-03.');
  assert.match(lastToolAnswer(), /A-03 · Roti Tiga/);
  assert.doesNotMatch(lastToolAnswer(), /A-01|A-02/);

  replies.push(modelCalls('daftar_booth', { status: 'reserved' }), modelSays('Masih reserve: A-01, A-02.'));
  await chatWeb('yang masih reserve apa saja?');
  const reserved = lastToolAnswer();
  assert.match(reserved, /A-01 · Kopi Satu/);
  assert.match(reserved, /A-02 · Teh Dua/);
  assert.match(reserved, /Belum ada invoice/);
  assert.doesNotMatch(reserved, /A-03/);

  // the same lists without AI
  assert.match(await say(SALES, 'LUNAS'), /A-03 · Roti Tiga/);
  const r = await say(SALES, 'RESERVED');
  assert.match(r, /A-01 · Kopi Satu/);
  assert.doesNotMatch(r, /A-03/);
});

test('persona asisten: Kak Aisyah secara bawaan (prompt Gemini, MENU); bisa diganti dari Setting', async () => {
  const st = (await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status;
  assert.equal(st.persona, 'aisyah');
  assert.deepEqual(st.personas.map(p => p.id), ['aisyah', 'khadijah', 'zahra', 'nadhira', 'salma']);

  replies.push(modelSays("Wa'alaikumussalam warahmatullah, Kak 😊"));
  await say(SALES, 'assalamualaikum');
  const prompt = geminiCalls.at(-1).body.systemInstruction.parts[0].text;
  assert.match(prompt, /Aisyah \(panggilan: Kak Aisyah\)/);
  assert.match(prompt, /"Kak"/);
  assert.match(prompt, /politik, SARA/);
  assert.match(prompt, /Jangan menyebut diri bot/, 'tidak mengumumkan dirinya mesin');
  assert.match(prompt, /jangan mengaku manusia/i, 'tetapi jujur bila ditanya sungguh-sungguh');
  assert.doesNotMatch(prompt, /virtual/i);
  assert.match(prompt, /siapkan_booking/, 'aturan kerja tetap ada');
  // data rules come first and forbid invented booths / numbers (a greeting once made the model list booths that do not exist)
  assert.match(prompt, /WAJIB memanggil alat/);
  assert.ok(prompt.indexOf('WAJIB memanggil alat') < prompt.indexOf('Kepribadian'), 'aturan data sebelum persona');
  const menu = await say(SALES, 'MENU');
  assert.match(menu, /Saya Aisyah/);
  assert.doesNotMatch(menu, /virtual|\bbot\b|chat ?bot|\bai\b/i, 'tidak menyebut dirinya mesin (judul project tes berisi "GEMINI", itu data)');

  assert.equal((await s.api('PUT', '/maintenance/whatsapp', { persona: 'tidak-ada' }, { as: 'superadmin' })).status, 400);
  const z = await s.api('PUT', '/maintenance/whatsapp', { persona: 'zahra' }, { as: 'superadmin' });
  assert.equal(z.status, 200, z.text);
  assert.equal(z.body.status.persona, 'zahra');
  assert.match(await say(SALES, 'MENU'), /Saya Zahra/);
  replies.push(modelSays('Baik, Kak.'));
  await say(SALES, 'halo');
  assert.match(geminiCalls.at(-1).body.systemInstruction.parts[0].text, /Zahra \(panggilan: Kak Zahra\)/);
  assert.equal((await s.api('PUT', '/maintenance/whatsapp', { persona: 'aisyah' }, { as: 'superadmin' })).status, 200);
});

test('model utama diam atau sedang penuh: pertanyaan yang sama dijawab model cadangan', async () => {
  // a model that never answers: stopped after the time limit, then the fallback answers
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { model: 'model-diam' }, { as: 'superadmin' })).status, 200);
  replies.push(modelSays('Jawaban dari model cadangan.'));
  const t0 = Date.now();
  let r = await chatWeb('halo');
  assert.equal(r.status, 200, r.text);
  assert.equal(texts(r), 'Jawaban dari model cadangan.');
  assert.equal(geminiCalls.at(-1).model, 'gemini-3.1-flash-lite');
  assert.ok(Date.now() - t0 < 10000, 'tidak menunggu lebih dari batas waktu');

  // a model "experiencing high demand" (503)
  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { model: 'gemini-3-flash-preview' }, { as: 'superadmin' })).status, 200);
  replies.push({ status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } } }, modelSays('Cadangan menjawab.'));
  r = await chatWeb('halo lagi');
  assert.equal(texts(r), 'Cadangan menjawab.');
  assert.equal(geminiCalls.at(-1).model, 'gemini-3.1-flash-lite');
});

test('pesan suara: didengarkan Gemini, ditulis ulang, lalu dijawab seperti pesan ketik; tanpa file atau tidak jelas: diminta mengetik', async () => {
  const voice = { url: `http://127.0.0.1:${gm.address().port}/media/voice.ogg`, extension: 'ogg', filename: 'voice.ogg' };
  const n = geminiCalls.length;
  replies.push(modelSays('booth A-01 siapa tenantnya?'), modelSays('A-01 dipakai Kopi Satu, Kak.'));
  const r = await say(FINANCE, '', 1, voice);
  assert.match(r, /🎙️ Kakak bilang: "booth A-01 siapa tenantnya\?"/, 'tulisan dari suara ditampilkan');
  assert.match(r, /A-01 dipakai Kopi Satu, Kak\./);
  const hear = geminiCalls[n].body;
  const audio = hear.contents[0].parts.find(p => p.inlineData)?.inlineData;
  assert.equal(audio?.mimeType, 'audio/ogg');
  assert.equal(audio?.data, VOICE.toString('base64'), 'file suara dikirim ke Gemini');
  assert.ok(!hear.tools, 'mendengarkan tanpa alat');
  assert.equal(geminiCalls[n + 1].body.contents.at(-1).parts[0].text, 'booth A-01 siapa tenantnya?', 'diproses seperti pesan ketik');

  const last = (await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status.lastIncoming;
  assert.equal(last.kind, 'suara');
  assert.equal(last.hasFile, true);
  assert.equal(last.extension, 'ogg');
  assert.equal(last.staff, 'Fina Keuangan');
  assert.match(last.outcome, /dijawab/);
  assert.equal(last.from, '…2222', 'nomor disamarkan');

  // Fonnte did not forward the file (package without attachments)
  const noFile = await say(FINANCE, '', 1, { extension: 'ogg', filename: 'voice.ogg' });
  assert.match(noFile, /ketik/);
  assert.doesNotMatch(noFile, TECH_WORDS);
  assert.match((await s.api('GET', '/maintenance/whatsapp', undefined, { as: 'superadmin' })).body.status.lastIncoming.outcome, /Fonnte tidak mengirim/, 'alasannya untuk admin');
  // the voice note arrives as an invisible character (Fonnte package without attachments): never sent to Gemini
  const before = geminiCalls.length;
  const empty = await say(FINANCE, '\u200e');
  assert.match(empty, /tidak berisi teks/);
  assert.doesNotMatch(empty, TECH_WORDS);
  assert.equal(geminiCalls.length, before);
  // nothing intelligible
  replies.push(modelSays('(tidak terdengar)'));
  assert.match(await say(FINANCE, '', 1, voice), /tidak terdengar jelas/);
});

test('agen dimatikan lalu kunci dihapus: pesan bebas dijawab MENU tanpa memanggil Gemini', async () => {
  const off = await s.api('PUT', '/maintenance/whatsapp/gemini', { enabled: false }, { as: 'superadmin' });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.body.status.gemini.enabled, false);
  const n = geminiCalls.length;
  assert.match(await say(SALES, 'halo lagi'), /Ketik salah satu perintah/);
  assert.equal(geminiCalls.length, n);

  assert.equal((await s.api('PUT', '/maintenance/whatsapp/gemini', { enabled: true }, { as: 'superadmin' })).status, 200);
  const del = await s.api('DELETE', '/maintenance/whatsapp/gemini', undefined, { as: 'superadmin' });
  assert.equal(del.status, 200, del.text);
  assert.equal(del.body.status.gemini.configured, false);
  assert.match(await say(SALES, 'halo sekali lagi'), /Ketik salah satu perintah/);
  assert.equal(geminiCalls.length, n);
});
