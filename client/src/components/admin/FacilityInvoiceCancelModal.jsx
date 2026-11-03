import React, { useEffect, useState } from 'react';
import { Ban, AlertTriangle, X, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { canDeletePaidInvoice, cleanDeleteReason, sameInvoiceNumber, DELETE_REASON_MIN } from '../../utils/invoicePermissions';

const OUTCOMES = [
  { value: 'rejected', label: 'Tenant tidak jadi', hint: 'Pengajuan menjadi REJECTED.' },
  { value: 'change', label: 'Ada perubahan', hint: 'Pengajuan bisa diubah, lalu terbitkan invoice baru.' }
];
const rupiah = (n) => `Rp ${(Number(n) || 0).toLocaleString('id-ID')}`;

// Batalkan invoice fasilitas (AGENTS.md §46). `request` is a row of GET /facilities/requests with its `invoice`.
export default function FacilityInvoiceCancelModal({ request, onClose, onCanceled, showToast }) {
  const { user } = useAuth();
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [typedNumber, setTypedNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const invoice = request?.invoice;

  useEffect(() => {
    setOutcome('');
    setReason('');
    setTypedNumber('');
    setError('');
    setIsSaving(false);
  }, [request?.id]);

  useEffect(() => {
    if (!invoice) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !isSaving) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [invoice, isSaving, onClose]);

  if (!invoice) return null;

  const hasPayment = invoice.paid > 0;
  const blocked = hasPayment && !canDeletePaidInvoice(user);
  const reasonOk = Boolean(cleanDeleteReason(reason));
  const numberOk = !hasPayment || sameInvoiceNumber(typedNumber, invoice.number);
  const canSubmit = !blocked && outcome && reasonOk && numberOk && !isSaving;

  const submit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError('');
    const res = await api.cancelFacilityInvoice(request.id, { reason, outcome, confirmNumber: typedNumber });
    setIsSaving(false);
    if (res?.success) {
      showToast?.(res.message);
      onCanceled?.(request, outcome);
    } else {
      setError(res?.message || res?.error || 'Gagal membatalkan invoice');
    }
  };

  const rows = [
    ['Nomor Invoice', invoice.number],
    ['Brand / Tenant', request.company_name || '-'],
    ['Nomor Booth', `#${request.booth_code}`],
    ['Nominal', rupiah(invoice.total)]
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn" role="dialog" aria-modal="true" aria-label="Batalkan Invoice">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] text-left">
        <div className="px-5 py-4 bg-gradient-to-r from-rose-50 via-white to-amber-50/40 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
              <Ban size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Batalkan Invoice</h2>
              <p className="text-[11px] text-slate-500">Invoice tetap tercatat sebagai dibatalkan. Nomornya tidak dipakai lagi.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} title="Tutup"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <dl className="rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="text-slate-500 shrink-0">{label}</dt>
                <dd className="font-semibold text-slate-900 text-right break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>

          {hasPayment && (
            <div className="flex items-start gap-2 p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-700">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <p className="font-bold">Invoice ini sudah menerima pembayaran {rupiah(invoice.paid)}.</p>
                <p>{blocked
                  ? 'Hanya Super Admin yang dapat membatalkan invoice yang sudah ada pembayarannya.'
                  : 'Pengembalian dana diurus di luar aplikasi. Ketik ulang nomor invoice untuk melanjutkan.'}</p>
              </div>
            </div>
          )}

          {!blocked && (
            <>
              <fieldset>
                <legend className="font-semibold text-slate-700 mb-1">Tindak lanjut pengajuan <span className="text-rose-600">*</span></legend>
                <div className="space-y-1.5">
                  {OUTCOMES.map(o => (
                    <label key={o.value} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${outcome === o.value ? 'border-rose-400 bg-rose-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <input type="radio" name="facility-cancel-outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-0.5 accent-rose-600" />
                      <span>
                        <span className="font-semibold text-slate-900 block">{o.label}</span>
                        <span className="text-[11px] text-slate-500">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="facility-cancel-reason" className="block font-semibold text-slate-700 mb-1">Alasan pembatalan <span className="text-rose-600">*</span></label>
                <textarea id="facility-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
                  placeholder="Contoh: tenant menambah daya listrik, invoice diganti"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-400" />
                <p className={`mt-1 text-[11px] ${reason && !reasonOk ? 'text-rose-600' : 'text-slate-400'}`}>Minimal {DELETE_REASON_MIN} karakter.</p>
              </div>

              {hasPayment && (
                <div>
                  <label htmlFor="facility-cancel-number" className="block font-semibold text-slate-700 mb-1">
                    Ketik ulang nomor invoice: <span className="font-mono text-rose-700">{invoice.number}</span>
                  </label>
                  <input id="facility-cancel-number" type="text" value={typedNumber} onChange={(e) => setTypedNumber(e.target.value)} autoComplete="off"
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 ${typedNumber && !numberOk ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-200 focus:ring-rose-400'}`} />
                </div>
              )}
            </>
          )}

          {error && <p className="text-rose-600 font-medium" role="alert">{error}</p>}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isSaving}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer">
            {blocked ? 'Tutup' : 'Kembali'}
          </button>
          {!blocked && (
            <button type="button" onClick={submit} disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
              <span>Batalkan Invoice</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
