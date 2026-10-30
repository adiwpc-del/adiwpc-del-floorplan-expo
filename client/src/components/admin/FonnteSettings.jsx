import React, { useState, useEffect } from 'react';
import { MessageCircle, KeyRound, ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, Trash2, Eye, EyeOff, Save, Copy, Send, Users } from 'lucide-react';
import { api } from '../../services/api';
import GeminiAgentSettings from './GeminiAgentSettings';

// Setting > Integrasi WhatsApp (Fonnte): the Super Admin enters the Fonnte device token (AGENTS.md §45).
// The token is WRITE-ONLY, like the Claude key (§23): sent once, stored in server/.env, never shown again.
const ROLE_LABEL = { superadmin: 'Super Admin', finance: 'Keuangan', sales: 'Sales' };
const input = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-400';

export default function FonnteSettings() {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [device, setDevice] = useState('');
  const [signature, setSignature] = useState('');
  const [persona, setPersona] = useState('aisyah');
  const [testTarget, setTestTarget] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);

  const apply = (res) => { if (res.status) { setStatus(res.status); setDevice(res.status.device || ''); setSignature(res.status.signature || ''); setPersona(res.status.persona || 'aisyah'); } };
  const load = async () => {
    const res = await api.waSettings();
    if (res.success) { apply(res); setLoadError(''); } else setLoadError(res.error || 'Gagal memuat pengaturan WhatsApp');
  };
  useEffect(() => { load(); }, []);

  const run = async (name, call, okText) => {
    setBusy(name);
    setNotice(null);
    const res = await call();
    setBusy('');
    if (res.success) { apply(res); setNotice({ type: res.ok === false ? 'error' : 'success', text: res.message || okText }); } else setNotice({ type: 'error', text: res.error || 'Gagal' });
    return res;
  };

  const save = async (e) => {
    e.preventDefault();
    const body = { device, signature, persona };
    if (token.trim()) body.token = token.trim();
    const res = await run('save', () => api.waSettings('PUT', '', body), 'Pengaturan WhatsApp tersimpan.');
    if (res.success) { setToken(''); setShowToken(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(status.webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* the URL stays selectable */ }
  };

  const noticeStyle = { success: 'bg-emerald-50 border-emerald-200 text-emerald-800', error: 'bg-rose-50 border-rose-200 text-rose-700' };
  const locked = status?.source === 'environment';
  const isLocalhost = /localhost|127\.0\.0\.1/.test(status?.webhookUrl || '');
  const test = status?.lastTest;
  const inbox = status?.lastIncoming;
  const inboxTime = inbox ? new Date(inbox.at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const inboxBad = inbox && /tidak dijawab|tidak bisa dijawab|gagal|tidak mengirim|belum aktif/.test(inbox.outcome);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6 animate-fadeIn">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
        <MessageCircle className="text-emerald-600" size={20} />
        <h2 className="text-base font-bold text-slate-900">Integrasi WhatsApp: Asisten Staf (Fonnte)</h2>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Staf (Sales, Keuangan, Super Admin) mengirim kata perintah ke nomor asisten (ketik <b>MENU</b>): booth yang tersedia, detail booth, cari tenant, ringkasan, booking booth, dan invoice (PDF-nya dikirim ke WhatsApp; mengirim file butuh paket Fonnte Super / Advanced / Ultra). Pertanyaan bebas (bukan kata perintah) dan pesan suara dijawab agen AI Gemini bila diaktifkan di bagian bawah. Booking dan invoice baru disimpan setelah staf membalas <b>YA</b>. Hubungkan nomor asisten di{' '}
        <a href="https://fonnte.com" target="_blank" rel="noopener noreferrer" className="text-emerald-700 font-semibold underline">fonnte.com</a>{' '}
        (menu Device, scan QR), lalu salin <b>Token</b> device-nya ke sini. Token hanya disimpan di server (<code className="bg-slate-100 px-1 py-0.5 rounded">server/.env</code>) dan <b>tidak pernah ditampilkan lagi</b>.
      </p>

      {loadError && <div className="px-3 py-2 rounded-xl border text-xs font-semibold bg-rose-50 border-rose-200 text-rose-700">{loadError}</div>}

      {/* Status */}
      <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Token Fonnte</div>
          {!status ? <div className="text-xs text-slate-400">Memuat...</div> : status.tokenConfigured ? (
            <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><ShieldCheck size={16} /> Tersimpan <span className="font-mono text-xs text-slate-500">({status.tokenHint})</span></div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm font-bold text-slate-500"><KeyRound size={16} /> Belum diisi</div>
          )}
          {status?.updatedBy && <div className="text-[11px] text-slate-500 mt-1">Diubah oleh {status.updatedBy}</div>}
        </div>
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Asisten</div>
          <div className={`text-sm font-bold ${status?.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>{status?.enabled ? 'Aktif (menunggu pesan)' : 'Belum aktif'}</div>
          <div className="text-[11px] text-slate-500 mt-1">Aktif bila token dan webhook sudah terdaftar di Fonnte.</div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tes terakhir</div>
          {test ? (
            <div className={`flex items-start gap-1.5 text-xs font-semibold ${test.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {test.ok ? <CheckCircle2 size={15} className="shrink-0" /> : <AlertTriangle size={15} className="shrink-0" />}<span>{test.message} <span className="font-normal text-slate-500">(ke {test.target})</span></span>
            </div>
          ) : <div className="text-xs text-slate-400">Belum pernah diuji</div>}
        </div>
      </div>

      {/* What the last WhatsApp message was and what happened to it (no text, the number masked) */}
      <div className={`px-3 py-2 rounded-xl border text-xs leading-relaxed ${inboxBad ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-slate-200 text-slate-700'}`}>
        <span className="font-bold">Pesan masuk terakhir: </span>
        {inbox ? (
          <>{inboxTime} WIB · pesan {inbox.kind}{inbox.extension ? ` (${inbox.extension}${inbox.kind === 'suara' ? (inbox.hasFile ? ', file diterima' : ', tanpa file') : ''})` : ''} dari {inbox.from}{inbox.staff ? ` (${inbox.staff})` : ''} · <span className="font-semibold">{inbox.outcome}</span></>
        ) : <span className="text-slate-500">belum ada pesan yang sampai ke server.</span>}
        {inbox?.fields?.length > 0 && (
          <div className="mt-1 text-[11px] opacity-80 break-words">
            Kolom dari Fonnte: <span className="font-mono">{inbox.fields.join(', ')}</span>
            {inbox.textCodes?.length > 0 && <> · isi teks tidak terbaca (<span className="font-mono">{inbox.textCodes.join(' ')}</span>)</>}
          </div>
        )}
      </div>

      {locked ? (
        <div className="px-3 py-2 rounded-xl border text-xs font-semibold bg-amber-50 border-amber-200 text-amber-800">
          Token saat ini diatur dari environment server (misalnya Variables di Railway), sehingga tidak dapat diganti atau dihapus dari halaman ini.
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3" autoComplete="off">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">{status?.tokenConfigured ? 'Ganti token Fonnte' : 'Token Fonnte'}</label>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 focus-within:border-emerald-400">
              <KeyRound size={14} className="text-slate-400 shrink-0" />
              <input type={showToken ? 'text' : 'password'} name="fonnte-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status?.tokenConfigured ? `Token tersimpan (${status.tokenHint}). Isi hanya untuk mengganti.` : 'Token dari Fonnte > Device'} autoComplete="new-password" spellCheck={false}
                className="flex-1 min-w-0 bg-transparent px-2 py-2.5 text-xs font-mono text-slate-800 focus:outline-none" />
              <button type="button" onClick={() => setShowToken(v => !v)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer" aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}>
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Nomor asisten (opsional)</label>
            <input type="text" inputMode="tel" value={device} onChange={(e) => setDevice(e.target.value)} className={input} placeholder="6281234567890" />
            <p className="text-[11px] text-slate-500 mt-1">Nomor WhatsApp yang terhubung ke Fonnte. Bila diisi, pesan dari perangkat lain diabaikan.</p>
          </div>
          <div>
            <label htmlFor="wa-persona" className="block text-xs font-bold text-slate-700 mb-1">Nama asisten</label>
            <select id="wa-persona" value={persona} onChange={(e) => setPersona(e.target.value)} className={`${input} cursor-pointer`}>
              {(status?.personas || [{ id: 'aisyah', name: 'Aisyah', call: 'Kak Aisyah', trait: '' }]).map(p => (
                <option key={p.id} value={p.id}>{`${p.call}${p.trait ? `: ${p.trait}` : ' (utama)'}`}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">Admin muslimah yang santun: memanggil staf "Kak", menyebut diri "saya", menjawab salam, dan menjaga adab. Tidak menyebut dirinya bot dan tidak menceritakan kendala teknis (kuota, layanan) di WhatsApp; kendalanya terlihat di "Pesan masuk terakhir". Bila ditanya sungguh-sungguh apakah ia manusia, ia menjawab jujur bahwa ia asisten otomatis tim.</p>
          </div>
          <div>
            <label htmlFor="wa-signature" className="block text-xs font-bold text-slate-700 mb-1">Tanda tangan di akhir pesan (opsional)</label>
            <input id="wa-signature" type="text" value={signature} onChange={(e) => setSignature(e.target.value)} maxLength={80} className={input} placeholder="halalfair.co.id" />
            <p className="text-[11px] text-slate-500 mt-1">Ditambahkan di bawah setiap balasan WhatsApp. Selama device Fonnte memakai paket Free, tulisan "Sent via fonnte.com" tetap muncul di bawahnya (ditambahkan Fonnte, hilang di paket berbayar).</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={Boolean(busy) || (!token.trim() && device === (status?.device || '') && signature.trim() === (status?.signature || '') && persona === (status?.persona || 'aisyah'))} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer">
              {busy === 'save' ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} Simpan
            </button>
            {status?.tokenConfigured && (
              <button type="button" disabled={Boolean(busy)} onClick={() => window.confirm('Hapus token, nomor, dan rahasia webhook dari server? Asisten berhenti menjawab.') && run('delete', () => api.waSettings('DELETE'), 'Pengaturan WhatsApp dihapus.')}
                className="px-3 py-2.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                <Trash2 size={13} /> Hapus
              </button>
            )}
          </div>
        </form>
      )}

      {notice && <div className={`px-3 py-2 rounded-xl border text-xs font-semibold ${noticeStyle[notice.type]}`}>{notice.text}</div>}

      {status?.tokenConfigured && (
        <>
          {/* Webhook URL to paste into Fonnte */}
          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="text-sm font-bold text-slate-900">Webhook URL (tempel di dashboard Fonnte)</div>
            <p className="text-[11px] text-slate-500">Fonnte &gt; Device &gt; pilih device &gt; kolom <b>Webhook</b> (Message). Matikan Auto Reply bawaan Fonnte karena tidak jalan bersama webhook.</p>
            <div className="flex gap-2">
              <input readOnly value={status.webhookUrl} onFocus={(e) => e.target.select()} className={`${input} font-mono`} aria-label="Webhook URL" />
              <button type="button" onClick={copy} className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0">
                {copied ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Copy size={13} />} {copied ? 'Tersalin' : 'Salin'}
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => window.confirm('Buat rahasia webhook baru? URL lama berhenti bekerja dan URL baru harus ditempel ulang di Fonnte.') && run('secret', () => api.waSettings('POST', '/secret'), 'Rahasia webhook diganti. Tempel URL baru di Fonnte.')}
                className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50">
                <RefreshCw size={13} /> Ganti
              </button>
            </div>
            {isLocalhost && (
              <div className="px-3 py-2 rounded-xl border text-[11px] font-semibold bg-amber-50 border-amber-200 text-amber-800">
                Alamat ini masih localhost, belum bisa dijangkau Fonnte. Setelah aplikasi online, ganti bagian depan URL dengan domain publik Anda (bagian setelah <code>/api/whatsapp/webhook/</code> jangan diubah).
              </div>
            )}
          </div>

          {/* Test message */}
          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="text-sm font-bold text-slate-900">Kirim pesan tes</div>
            <p className="text-[11px] text-slate-500">Mengirim satu pesan dari nomor asisten ke nomor yang Anda isi. Ini juga membuktikan token benar. Isi pesannya dibuat otomatis.</p>
            <label htmlFor="wa-test-target" className="block text-xs font-bold text-slate-700">Nomor HP tujuan (bukan isi pesan)</label>
            <div className="flex gap-2">
              <input id="wa-test-target" value={testTarget} onChange={(e) => setTestTarget(e.target.value)} className={input} placeholder="Nomor WhatsApp Anda, contoh 081234567890" inputMode="tel" />
              <button type="button" disabled={Boolean(busy) || !testTarget.trim()} onClick={() => run('test', () => api.waSettings('POST', '/test', { target: testTarget }))}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0">
                {busy === 'test' ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />} Kirim Tes
              </button>
            </div>
          </div>

          {/* Who can use the assistant */}
          <div className="p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Users size={15} className="text-emerald-600" /> Staf yang dilayani</div>
            <p className="text-[11px] text-slate-500">Hanya akun aktif dengan kolom <b>Telepon</b> terisi nomor WhatsApp-nya (menu Pengguna). Nomor lain tidak dijawab.</p>
            <ul className="divide-y divide-slate-100 text-xs">
              {(status.staff || []).map((u, i) => (
                <li key={i} className="py-1.5 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{u.name} <span className="font-normal text-slate-500">({ROLE_LABEL[u.role] || u.role})</span></span>
                  {u.hasPhone ? <span className="text-emerald-700 font-bold">Nomor terisi</span> : <span className="text-amber-700 font-bold">Telepon kosong</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <GeminiAgentSettings gemini={status?.gemini} assistant={(status?.personas || []).find(p => p.id === status?.persona)} onStatus={(next) => apply({ status: next })} />
    </div>
  );
}
