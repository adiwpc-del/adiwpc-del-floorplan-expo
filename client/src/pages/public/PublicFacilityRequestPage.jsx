import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Calendar, Plus, Minus, CheckCircle2, Send, AlertCircle, ArrowLeft, Printer, Info, PackageOpen, RotateCcw } from 'lucide-react';
import { api } from '../../services/api';
import FacilityFormA4View from '../../components/admin/FacilityFormA4View';
import { printInvoiceElement } from '../../utils/invoicePrintUtils';

// Tenant portal "Formulir Fasilitas Tambahan" (/facility-request). Light, single accent, 16px inputs on phones (no
// iOS zoom), a bottom bar with the total and the submit button below lg. The submission receipt is printed from the
// existing A4 template (FacilityFormA4View, filled) through printInvoiceElement: window.print() on this page printed
// a blank sheet, because the print CSS shows only the printable-* sheets.
const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const longDate = (d) => {
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};
const press = 'transition-transform duration-150 ease-out active:scale-[0.97] [touch-action:manipulation] select-none';
const inputClass = 'w-full h-11 rounded-xl border border-slate-300 bg-white px-3.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 shadow-xs focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-[border-color,box-shadow] duration-150';

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {label}{required && <span className="text-rose-600" aria-hidden="true"> *</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Section({ step, title, desc, children, flush = false }) {
  return (
    <section className={`rounded-2xl bg-white ring-1 ring-slate-200 ${flush ? '' : 'p-5 sm:p-6'}`}>
      <header className={`flex gap-3 ${flush ? 'p-5 sm:p-6 pb-4 sm:pb-4' : 'mb-5'}`}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{step}</span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export default function PublicFacilityRequestPage() {
  const [searchParams] = useSearchParams();
  const formIdParam = searchParams.get('formId') || '';
  const boothParam = searchParams.get('booth') || '';
  const companyParam = searchParams.get('company') || '';

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Tenant Form Information
  const [boothCode, setBoothCode] = useState(boothParam);
  const [companyName, setCompanyName] = useState(companyParam);
  const [picName, setPicName] = useState('');
  const [phone, setPhone] = useState('');
  const [email] = useState('');
  const [notes, setNotes] = useState('');

  // Selected item quantities: { [itemId]: qty }
  const [itemQuantities, setItemQuantities] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedData, setSubmittedData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [printing, setPrinting] = useState(false);
  const errorRef = useRef(null);

  useEffect(() => {
    loadForm();
  }, [formIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (errorMessage) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [errorMessage]);

  const loadForm = async () => {
    setLoading(true);
    try {
      if (formIdParam) {
        const res = await api.fetchFacilityFormById(formIdParam);
        if (res) {
          setForm(res);
          return;
        }
      }
      // Fallback to active forms
      const list = await api.fetchFacilityForms({ isTemplate: '0' });
      const active = list.find(f => f.is_active) || list[0];
      setForm(active || null);
    } catch (e) {
      console.error('Failed to load facility form:', e);
    } finally {
      setLoading(false);
    }
  };

  const items = form?.items || [];
  const categoryCounts = items.reduce((acc, i) => {
    const c = i.category || 'Lainnya';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const categories = ['ALL', ...Object.keys(categoryCounts)];

  const handleQtyChange = (itemId, change) => {
    const item = items.find(i => i.id === itemId);
    const max = item?.max_qty || 99;
    const current = itemQuantities[itemId] || 0;
    const next = Math.max(0, Math.min(max, current + change));
    setItemQuantities(prev => ({ ...prev, [itemId]: next }));
  };

  // Calculations
  const selectedItemsList = items
    .filter(i => (itemQuantities[i.id] || 0) > 0)
    .map(i => ({
      ...i,
      qty: itemQuantities[i.id],
      total: (itemQuantities[i.id] || 0) * (Number(i.price) || 0)
    }));

  const totalAmount = selectedItemsList.reduce((sum, i) => sum + i.total, 0);
  const totalQty = selectedItemsList.reduce((sum, i) => sum + i.qty, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!boothCode.trim()) return setErrorMessage('Nomor / kode booth wajib diisi.');
    if (!companyName.trim()) return setErrorMessage('Nama perusahaan / brand wajib diisi.');
    if (!picName.trim()) return setErrorMessage('Nama PIC wajib diisi.');
    if (!phone.trim()) return setErrorMessage('Nomor WhatsApp wajib diisi untuk koordinasi teknis.');
    if (selectedItemsList.length === 0) return setErrorMessage('Pilih minimal 1 fasilitas.');

    setIsSubmitting(true);
    try {
      const payload = {
        form_id: form?.id || 'form_active_default',
        project_id: form?.project_id || 'global',
        booth_code: boothCode.trim().toUpperCase(),
        company_name: companyName.trim(),
        pic_name: picName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        items: selectedItemsList,
        total_amount: totalAmount,
        notes: notes.trim()
      };

      const res = await api.submitFacilityRequest(payload);
      if (res && res.success) {
        setSubmittedData({
          ...res.request,
          eventTitle: form?.event_title || ''
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setErrorMessage(res?.message || 'Pengajuan belum terkirim. Coba lagi.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Server tidak dapat dihubungi. Coba lagi beberapa saat lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // The receipt is the existing A4 facility form, filled with this submission
  const handlePrintReceipt = async () => {
    setPrinting(true);
    try {
      await printInvoiceElement('printable-facility-form-a4');
    } finally {
      setPrinting(false);
    }
  };

  const startAnother = () => {
    setSubmittedData(null);
    setItemQuantities({});
    setNotes('');
    setErrorMessage('');
    window.scrollTo({ top: 0 });
  };

  const filteredItems = items.filter(item => selectedCategory === 'ALL' || (item.category || 'Lainnya') === selectedCategory);

  if (loading) {
    return (
      <main className="min-h-[100dvh] bg-slate-50 px-4 py-10" aria-busy="true">
        <div className="mx-auto max-w-5xl space-y-4 animate-pulse">
          <div className="h-28 rounded-2xl bg-slate-200/70" />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <div className="h-48 rounded-2xl bg-slate-200/70" />
              <div className="h-72 rounded-2xl bg-slate-200/70" />
            </div>
            <div className="h-64 rounded-2xl bg-slate-200/70" />
          </div>
          <p className="sr-only">Memuat formulir fasilitas...</p>
        </div>
      </main>
    );
  }

  if (!form) {
    return (
      <main className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle size={40} className="text-amber-500 mb-3" />
        <h1 className="text-lg font-semibold text-slate-900">Formulir belum tersedia</h1>
        <p className="mt-1 max-w-md text-sm text-slate-600">
          Panitia belum membuka formulir fasilitas tambahan, atau tautan yang Anda buka sudah tidak berlaku.
        </p>
        <Link to="/" className={`mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 ${press}`}>
          <ArrowLeft size={16} /> Kembali ke denah
        </Link>
      </main>
    );
  }

  // Submission receipt
  if (submittedData) {
    const receiptItems = submittedData.items || [];
    return (
      <main className="min-h-[100dvh] bg-slate-50 px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-xl">
          <div className="rounded-2xl bg-white p-6 sm:p-8 ring-1 ring-slate-200">
            <CheckCircle2 size={44} className="text-emerald-600" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 text-balance">Pengajuan fasilitas terkirim</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Panitia akan memeriksa pesanan Anda, lalu menerbitkan invoice. Simpan bukti pengajuan di bawah ini.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-y border-slate-200 py-5 text-sm">
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs text-slate-500">Nomor pengajuan</dt>
                <dd className="mt-0.5 font-mono text-[13px] font-semibold text-slate-900 break-all">{submittedData.id}</dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="mt-1">
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">Menunggu verifikasi</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Booth</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{submittedData.booth_code}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Brand</dt>
                <dd className="mt-0.5 font-semibold text-slate-900 break-words">{submittedData.company_name}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">PIC</dt>
                <dd className="mt-0.5 text-slate-900">{submittedData.pic_name}{submittedData.phone ? ` · ${submittedData.phone}` : ''}</dd>
              </div>
            </dl>

            <ul className="divide-y divide-slate-100 py-2 text-sm">
              {receiptItems.map((item, idx) => (
                <li key={idx} className="flex items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{item.qty} {item.unit || 'unit'} × {rupiah(item.price)}</p>
                  </div>
                  <span className="shrink-0 font-semibold text-slate-900 tabular-nums">{rupiah((Number(item.price) || 0) * (Number(item.qty) || 1))}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-4">
              <span className="text-sm font-medium text-slate-600">Total</span>
              <span className="text-xl font-semibold text-slate-900 tabular-nums">{rupiah(submittedData.total_amount)}</span>
            </div>

            {submittedData.notes && (
              <div className="mt-5 rounded-xl bg-slate-50 p-3.5 text-sm">
                <p className="text-xs text-slate-500">Catatan untuk panitia</p>
                <p className="mt-0.5 whitespace-pre-line text-slate-700">{submittedData.notes}</p>
              </div>
            )}

            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              <button type="button" onClick={handlePrintReceipt} disabled={printing}
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 ${press}`}>
                <Printer size={17} /> {printing ? 'Menyiapkan…' : 'Unduh / cetak bukti'}
              </button>
              <button type="button" onClick={startAnother}
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 ${press}`}>
                <RotateCcw size={16} /> Ajukan fasilitas lain
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">Untuk menyimpan sebagai PDF, pilih “Simpan sebagai PDF” di jendela cetak.</p>
          </div>

          <Link to="/" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft size={15} /> Kembali ke denah pameran
          </Link>
        </div>

        {/* The A4 receipt (existing template) that is printed; kept off screen */}
        <div aria-hidden="true" className="fixed left-[-10000px] top-0">
          <FacilityFormA4View
            mode="filled"
            form={form}
            selectedItems={receiptItems}
            docNumber={submittedData.id}
            tenant={{ boothCode: submittedData.booth_code, companyName: submittedData.company_name, picName: submittedData.pic_name, phone: submittedData.phone, email: submittedData.email, notes: submittedData.notes }}
          />
        </div>
      </main>
    );
  }

  const termsBlock = form.terms_notes && (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Info size={15} className="text-slate-400" /> Syarat & ketentuan</p>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{form.terms_notes}</p>
    </div>
  );

  return (
    <main className="min-h-[100dvh] bg-slate-50 pb-28 lg:pb-12">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            {form.event_title && <p className="text-sm font-medium text-indigo-700">{form.event_title}</p>}
            <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">{form.title}</h1>
            <p className="mt-2 text-sm sm:text-[15px] leading-relaxed text-slate-600 text-pretty">
              {form.description || 'Pilih fasilitas tambahan untuk booth Anda. Panitia menyiapkannya sebelum loading-in.'}
            </p>
          </div>
          {form.deadline_date && (
            <div className="inline-flex shrink-0 items-center gap-2.5 self-start rounded-xl bg-rose-50 px-3.5 py-2.5 ring-1 ring-rose-200 md:self-auto">
              <Calendar size={17} className="text-rose-600" />
              <div className="leading-tight">
                <p className="text-xs text-rose-700">Batas pengajuan</p>
                <p className="text-sm font-semibold text-rose-900">{longDate(form.deadline_date)}</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <form id="facility-request-form" onSubmit={handleSubmit} noValidate className="mx-auto mt-6 grid max-w-5xl grid-cols-1 items-start gap-6 px-4 sm:px-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {errorMessage && (
            <div ref={errorRef} role="alert" className="flex items-start gap-2.5 rounded-xl bg-rose-50 p-3.5 text-sm text-rose-800 ring-1 ring-rose-200">
              <AlertCircle size={18} className="mt-px shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Step 1 */}
          <Section step={1} title="Data booth Anda" desc="Dipakai panitia untuk konfirmasi dan pemasangan.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nomor booth" required>
                <input type="text" value={boothCode} onChange={(e) => setBoothCode(e.target.value.toUpperCase())} placeholder="Contoh: A-01"
                  autoCapitalize="characters" autoCorrect="off" spellCheck={false} className={`${inputClass} font-semibold uppercase placeholder:normal-case placeholder:font-normal`} />
              </Field>
              <Field label="Nama perusahaan / brand" required>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nama brand di booth" autoComplete="organization" className={inputClass} />
              </Field>
              <Field label="Nama PIC" required>
                <input type="text" value={picName} onChange={(e) => setPicName(e.target.value)} placeholder="Penanggung jawab di lapangan" autoComplete="name" className={inputClass} />
              </Field>
              <Field label="No. WhatsApp" required hint="Panitia menghubungi nomor ini untuk konfirmasi.">
                <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812xxxxxxxx" autoComplete="tel" className={inputClass} />
              </Field>
            </div>
          </Section>

          {/* Step 2 */}
          <Section step={2} title="Pilih fasilitas" desc="Atur jumlah setiap fasilitas yang Anda perlukan." flush>
            {categories.length > 2 && (
              <div className="-mt-1 flex gap-2 overflow-x-auto px-5 pb-4 sm:flex-wrap sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Kategori fasilitas">
                {categories.map(cat => {
                  const active = selectedCategory === cat;
                  return (
                    <button key={cat} type="button" role="tab" aria-selected={active} onClick={() => setSelectedCategory(cat)}
                      className={`h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${press} ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                      {cat === 'ALL' ? `Semua (${items.length})` : `${cat} (${categoryCounts[cat]})`}
                    </button>
                  );
                })}
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <PackageOpen size={32} className="text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Belum ada fasilitas di kategori ini.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {filteredItems.map(item => {
                  const qty = itemQuantities[item.id] || 0;
                  const price = Number(item.price) || 0;
                  const max = item.max_qty || 99;
                  return (
                    <li key={item.id} className={`flex items-start gap-4 px-5 py-4 sm:px-6 transition-colors duration-150 ${qty > 0 ? 'bg-indigo-50/60' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold text-slate-900">{item.name}</h3>
                        {selectedCategory === 'ALL' && item.category && <p className="text-xs text-slate-500">{item.category}</p>}
                        {item.description && <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description}</p>}
                        <p className="mt-2 text-sm">
                          <span className="font-semibold text-slate-900 tabular-nums">{rupiah(price)}</span>
                          <span className="text-slate-500"> / {item.unit || 'unit'}</span>
                          {item.max_qty ? <span className="text-slate-400"> · maks. {item.max_qty}</span> : null}
                        </p>
                        {qty > 0 && <p className="mt-1 text-xs font-medium text-indigo-700 tabular-nums">Subtotal {rupiah(qty * price)}</p>}
                      </div>
                      <div className="flex shrink-0 items-center rounded-xl bg-white ring-1 ring-slate-300">
                        <button type="button" onClick={() => handleQtyChange(item.id, -1)} disabled={qty === 0} aria-label={`Kurangi ${item.name}`}
                          className={`grid size-10 place-items-center rounded-l-xl text-slate-700 hover:bg-slate-50 disabled:text-slate-300 disabled:hover:bg-transparent ${press}`}>
                          <Minus size={16} />
                        </button>
                        <output aria-live="polite" aria-label={`Jumlah ${item.name}`} className="w-8 text-center text-sm font-semibold text-slate-900 tabular-nums">{qty}</output>
                        <button type="button" onClick={() => handleQtyChange(item.id, 1)} disabled={qty >= max} aria-label={`Tambah ${item.name}`}
                          className={`grid size-10 place-items-center rounded-r-xl text-indigo-700 hover:bg-indigo-50 disabled:text-indigo-300 disabled:hover:bg-transparent ${press}`}>
                          <Plus size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Step 3 */}
          <Section step={3} title="Catatan untuk panitia" desc="Opsional: letak colokan, posisi meja, atau permintaan teknis lain.">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: colokan di dinding belakang sebelah kanan, meja di depan dekat lorong."
              className="w-full rounded-xl border border-slate-300 bg-white p-3.5 text-base sm:text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 shadow-xs focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15" />
          </Section>

          <div className="lg:hidden">{termsBlock}</div>
        </div>

        {/* Summary (desktop) */}
        <aside className="hidden space-y-4 lg:sticky lg:top-6 lg:block">
          <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Ringkasan</h2>
              <span className="text-sm text-slate-500 tabular-nums">{totalQty} item</span>
            </div>
            {selectedItemsList.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">Belum ada fasilitas dipilih. Tekan + pada fasilitas yang Anda perlukan.</p>
            ) : (
              <ul className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto overscroll-contain text-sm">
                {selectedItemsList.map(item => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500 tabular-nums">{item.qty} × {rupiah(item.price)}</p>
                    </div>
                    <span className="shrink-0 font-medium text-slate-900 tabular-nums">{rupiah(item.total)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-4">
              <span className="text-sm text-slate-600">Total</span>
              <span className="text-xl font-semibold text-slate-900 tabular-nums">{rupiah(totalAmount)}</span>
            </div>
            <button type="submit" disabled={isSubmitting}
              className={`mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 ${press}`}>
              <Send size={16} /> {isSubmitting ? 'Mengirim…' : 'Kirim pengajuan'}
            </button>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-500">Harga resmi panitia. Invoice diterbitkan setelah pengajuan diperiksa.</p>
          </div>
          {termsBlock}
        </aside>
      </form>

      {/* Bottom bar (phone / tablet): total + submit always in reach */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-xs text-slate-500 tabular-nums">{totalQty} item dipilih</p>
            <p className="text-lg font-semibold text-slate-900 tabular-nums">{rupiah(totalAmount)}</p>
          </div>
          <button type="submit" form="facility-request-form" disabled={isSubmitting}
            className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 ${press}`}>
            <Send size={16} /> {isSubmitting ? 'Mengirim…' : 'Kirim'}
          </button>
        </div>
      </div>
    </main>
  );
}
