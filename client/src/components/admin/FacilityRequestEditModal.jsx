import React, { useEffect, useState } from 'react';
import { Edit2, X, Loader2, Plus, Minus } from 'lucide-react';
import { api } from '../../services/api';

const rupiah = (n) => `Rp ${(Number(n) || 0).toLocaleString('id-ID')}`;
const keyOf = (item) => String(item.id || item.name);

// "Ubah" a facility request that has no live invoice (AGENTS.md §46): the jumlah of what it ordered, the other items of
// its form, and the note. An item already ordered keeps the price it was ordered at; the server computes the total.
export default function FacilityRequestEditModal({ request, form, onClose, onSaved, showToast }) {
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!request) return;
    const ordered = request.items || [];
    // by id or by name: an older request or a changed form may carry another id for the same item
    const taken = new Set(ordered.flatMap(i => [keyOf(i), i.name]));
    const others = (form?.items || []).filter(i => !taken.has(keyOf(i)) && !taken.has(i.name)).map(i => ({ ...i, qty: 0 }));
    setRows([...ordered, ...others]);
    setNotes(request.notes || '');
    setError('');
    setIsSaving(false);
  }, [request, form]);

  useEffect(() => {
    if (!request) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !isSaving) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, isSaving, onClose]);

  if (!request) return null;

  const chosen = rows.filter(r => Number(r.qty) > 0);
  const total = chosen.reduce((sum, r) => sum + Number(r.price || 0) * Number(r.qty), 0);
  const setQty = (idx, value) => setRows(prev => prev.map((r, i) => (i === idx ? { ...r, qty: Math.min(9999, Math.max(0, Number(value) || 0)) } : r)));

  const submit = async () => {
    if (!chosen.length || isSaving) return;
    setIsSaving(true);
    setError('');
    const res = await api.updateFacilityRequest(request.id, { items: chosen, notes });
    setIsSaving(false);
    if (res?.success) {
      showToast?.(res.message);
      onSaved?.();
    } else {
      setError(res?.message || res?.error || 'Gagal menyimpan perubahan');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn" role="dialog" aria-modal="true" aria-label="Ubah Pengajuan">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] text-left">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
              <Edit2 size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Ubah Pengajuan</h2>
              <p className="text-[11px] text-slate-500 truncate">#{request.booth_code} · {request.company_name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} title="Tutup"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {rows.map((row, idx) => (
              <li key={keyOf(row)} className={`flex items-center justify-between gap-3 px-3 py-2 ${Number(row.qty) > 0 ? 'bg-indigo-50/40' : ''}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 break-words">{row.name}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{rupiah(row.price)} / {row.unit || 'Unit'}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" aria-label={`Kurangi ${row.name}`} onClick={() => setQty(idx, Number(row.qty) - 1)} disabled={!Number(row.qty)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                    <Minus size={12} />
                  </button>
                  <input type="number" inputMode="numeric" min="0" max="9999" value={row.qty || 0} onChange={(e) => setQty(idx, e.target.value)} aria-label={`Jumlah ${row.name}`}
                    className="w-12 h-7 text-center bg-white border border-slate-200 rounded-lg font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                  <button type="button" aria-label={`Tambah ${row.name}`} onClick={() => setQty(idx, Number(row.qty) + 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer">
                    <Plus size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div>
            <label htmlFor="facility-edit-notes" className="block font-semibold text-slate-700 mb-1">Catatan</label>
            <textarea id="facility-edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          {!chosen.length && <p className="text-amber-700 font-medium">Pilih minimal 1 item.</p>}
          {error && <p className="text-rose-600 font-medium" role="alert">{error}</p>}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <p className="font-mono font-bold text-slate-900 text-sm">{rupiah(total)}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={isSaving}
              className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer">
              Batal
            </button>
            <button type="button" onClick={submit} disabled={!chosen.length || isSaving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {isSaving && <Loader2 size={13} className="animate-spin" />}
              <span>Simpan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
