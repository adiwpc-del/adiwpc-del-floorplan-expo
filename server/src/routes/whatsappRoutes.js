import express from 'express';
import { waEnabled, secretMatches, incomingMessage, staffByPhone, sendText, sendFile, saveWaMeta } from '../utils/whatsapp.js';
import { answerStaff, answerVoice, currentPersona, takeFailure } from '../utils/waAgent.js';

// WhatsApp (Fonnte) webhook of the staff assistant (AGENTS.md §45). Public path; Fonnte does not sign its calls, so the
// URL itself carries a secret: /api/whatsapp/webhook/<FONNTE_WEBHOOK_SECRET>.
const router = express.Router();

const seen = new Set(); // message ids already handled (Fonnte retries a call that did not get a 200)
const recent = new Map(); // sender -> timestamps, max 20 messages per 10 minutes
const allowed = (from) => {
  const now = Date.now();
  const list = (recent.get(from) || []).filter(t => now - t < 10 * 60 * 1000);
  list.push(now);
  recent.set(from, list);
  return list.length <= 20;
};

export async function processMessage(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  if (seen.size > 2000) seen.delete(seen.values().next().value);

  const user = staffByPhone(m.from);
  // "Pesan masuk terakhir" in Setting: what arrived and what happened (never the text, the number masked)
  const note = (outcome) => saveWaMeta({ lastIncoming: {
    at: new Date().toISOString(), from: `…${m.from.slice(-4)}`, staff: user?.name || null,
    kind: { text: 'teks', audio: 'suara', media: 'lampiran', empty: 'tanpa teks' }[m.type], extension: m.extension || '', hasFile: Boolean(m.url),
    fields: m.fields, textCodes: m.textCodes, outcome
  } });
  if (!user) { note('tidak dijawab: nomor ini tidak terdaftar di kolom Telepon akun staf'); return; } // nothing revealed
  if (!allowed(m.from)) { note('tidak dijawab: terlalu banyak pesan'); await sendText(m.from, 'Terlalu banyak pesan dalam waktu singkat. Coba lagi beberapa menit lagi.'); return; }

  let outcome = 'dijawab';
  let reply;
  if (m.type === 'audio') ({ reply, outcome } = await answerVoice(user, m));
  else if (m.type === 'media') { outcome = 'lampiran bukan suara: diminta mengetik'; reply = `Mohon maaf, Kak 🙏 gambar dan file belum bisa ${currentPersona().name} buka. Silakan ketik pertanyaannya ya, Kak.`; }
  else if (m.type === 'empty') {
    outcome = 'tanpa teks (pesan suara / lampiran yang tidak diteruskan Fonnte?): diminta mengetik';
    reply = `Mohon maaf, Kak 🙏 pesan ini tidak berisi teks yang bisa ${currentPersona().name} baca. Pesan suara, gambar, dan file belum bisa ${currentPersona().name} terima saat ini. Mohon diketik ya, Kak.`;
  }
  else reply = await answerStaff(user, m.text);
  const failure = takeFailure(user.id); // the AI could not answer: the reason is for the admin, not for the chat
  if (failure) outcome = `tidak bisa dijawab (dikirim permintaan maaf): ${failure}`;

  // The answer is one text, or several parts: texts and a document ({ file, filename, caption }, e.g. the invoice PDF)
  let failed = '';
  for (const part of [].concat(reply)) {
    if (typeof part === 'string') { const r = await sendText(m.from, part); if (!r.ok && !failed) failed = r.reason; continue; }
    const sentFile = await sendFile(m.from, part.file, part.filename, part.caption);
    if (!sentFile.ok) await sendText(m.from, `PDF ${part.filename} tidak terkirim lewat WhatsApp (${sentFile.reason}). Unduh dari aplikasi.`);
  }
  note(failed ? `${outcome}, tetapi balasan gagal dikirim Fonnte: ${failed}` : outcome);
}

// POST: answered at once (200), the reply is sent afterwards through Fonnte. A wrong secret looks like a missing page.
router.post('/webhook/:secret', (req, res) => {
  if (!waEnabled() || !secretMatches(req.params.secret)) return res.sendStatus(404);
  res.sendStatus(200);
  const m = incomingMessage(req.body);
  if (m) processMessage(m).catch(e => console.error('WhatsApp proses pesan gagal:', e));
});

export default router;
