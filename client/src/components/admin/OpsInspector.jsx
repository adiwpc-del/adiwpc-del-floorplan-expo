import React, { useEffect, useState } from 'react';
import {
  Lock, Zap, Droplets, Wifi, ClipboardList, AlertTriangle, Link2, Unlink, Globe, EyeOff, Crosshair, User, Phone, Mail,
  Tag, Ruler, Store, Layers, MapPin, Info
} from 'lucide-react';
import { SETUP_STATUS, INTERNET_LABELS, OPS_LOCK_MESSAGE, boothKeyOf, opsTypeCounts, venueEmoji, SPECIAL_DESIGN_COLORS, SPECIAL_DESIGN_DEFAULT_COLOR } from '../../utils/opsLayer';
import { captionText } from '../../utils/elementCaptions';
import ElementIcon from './ElementIcon';
import CanvasShortcutsGuide from './CanvasShortcutsGuide';

const panelClass = 'w-80 lg:w-[340px] shrink-0 bg-white border-l border-slate-200 flex flex-col h-full shadow-sm z-10 select-none overflow-y-auto overflow-x-hidden';
const inputClass = 'w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500';
const optionClass = (active) => `py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
  active ? 'bg-amber-500 text-white border-amber-500 shadow-xs' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
}`;

const LockBanner = () => (
  <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-100 border border-slate-300 text-[11px] text-slate-700">
    <Lock size={14} className="shrink-0 mt-0.5 text-slate-600" />
    <span>{OPS_LOCK_MESSAGE}</span>
  </div>
);

const InfoRow = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-2 text-xs">
    <Icon size={13} className="text-slate-400 mt-0.5 shrink-0" />
    <span className="text-slate-500 w-24 shrink-0">{label}</span>
    <span className="font-semibold text-slate-800 min-w-0 break-words">{children || '-'}</span>
  </div>
);

// ---------- Booth selected (read-only sales data + editable operations data) ----------
function BoothPanel({ booth, boothRow, data, onChange, anchored = [], onSelectElement }) {
  const bd = booth.boothData || {};
  const [watt, setWatt] = useState(String(data.powerWatt || 0));
  const [notes, setNotes] = useState(data.notes || '');
  useEffect(() => { setWatt(String(data.powerWatt || 0)); setNotes(data.notes || ''); }, [data.boothKey, data.powerWatt, data.notes]);

  const applyWatt = () => {
    const n = Math.max(0, Math.round(Number(String(watt).replace(/\D/g, '')) || 0));
    setWatt(String(n));
    if (n !== data.powerWatt) onChange({ powerWatt: n });
  };
  const pic = boothRow?.pic_name || bd.picName;
  const phone = boothRow?.phone || bd.phone;
  const email = boothRow?.email || bd.email;

  return (
    <aside className={panelClass}>
      <div className="p-4 border-b border-slate-200 bg-amber-50/60">
        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded border bg-white text-amber-700 border-amber-300">Booth • Lapisan Sales</span>
        <h2 className="font-semibold text-slate-800 text-base mt-2 flex items-center gap-2"><Lock size={14} className="text-slate-500" /> Booth {bd.code || '-'}</h2>
        <p className="text-[11px] text-slate-500">Data booth hanya-baca • data operasional di bawah bisa diedit</p>
      </div>
      <div className="p-4 space-y-4 flex-1">
        <LockBanner />
        <div className="space-y-1.5 p-3 rounded-xl border border-slate-200">
          <InfoRow icon={Tag} label="Nomor booth">{bd.code}</InfoRow>
          <InfoRow icon={Ruler} label="Ukuran">{bd.widthM && bd.heightM ? `${bd.widthM} × ${bd.heightM} m` : '-'}</InfoRow>
          <InfoRow icon={Store} label="Brand / Tenant">{bd.ownerName || boothRow?.owner_name || 'Belum ada tenant'}</InfoRow>
          <InfoRow icon={Layers} label="Kategori">{[bd.category, bd.brandCategory || boothRow?.brand_category].filter(Boolean).join(' • ')}</InfoRow>
          <InfoRow icon={User} label="PIC">{pic}</InfoRow>
          <InfoRow icon={Phone} label="Kontak PIC">{phone}</InfoRow>
          {email && <InfoRow icon={Mail} label="Email PIC">{email}</InfoRow>}
        </div>

        {/* Special design: the only booth "edit" allowed here — a colour on the operational floorplan */}
        <div className="p-3 rounded-xl border space-y-2" style={data.specialDesign ? { borderColor: data.specialColor || SPECIAL_DESIGN_DEFAULT_COLOR, background: `${data.specialColor || SPECIAL_DESIGN_DEFAULT_COLOR}12` } : { borderColor: '#e2e8f0' }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Special Design</div>
              <div className="text-[10px] text-slate-500">Booth dibangun khusus (bukan booth standar)</div>
            </div>
            <div className="grid grid-cols-2 gap-1 w-28">
              <button type="button" onClick={() => !data.specialDesign && onChange({ specialDesign: true, specialColor: data.specialColor || SPECIAL_DESIGN_DEFAULT_COLOR })} className={optionClass(data.specialDesign)}>Ya</button>
              <button type="button" onClick={() => data.specialDesign && onChange({ specialDesign: false })} className={optionClass(!data.specialDesign)}>Tidak</button>
            </div>
          </div>
          {data.specialDesign && (
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 font-medium">Warna booth di Denah Operasional</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {SPECIAL_DESIGN_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => c !== data.specialColor && onChange({ specialColor: c })} title={c}
                    className={`w-6 h-6 rounded-md border cursor-pointer ${(data.specialColor || SPECIAL_DESIGN_DEFAULT_COLOR) === c ? 'ring-2 ring-offset-1 ring-slate-500 border-slate-500' : 'border-slate-300'}`}
                    style={{ background: c }} />
                ))}
                <input type="color" value={data.specialColor || SPECIAL_DESIGN_DEFAULT_COLOR} onChange={(e) => onChange({ specialColor: e.target.value })}
                  className="w-7 h-7 rounded border border-slate-200 cursor-pointer" title="Warna lain" />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Data Operasional Booth</div>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Status Loading-in / Setup</label>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(SETUP_STATUS).map(([key, cfg]) => (
                <button key={key} type="button" onClick={() => key !== data.setupStatus && onChange({ setupStatus: key })}
                  className="py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  style={data.setupStatus === key ? { background: cfg.color, color: '#fff', borderColor: cfg.color } : { background: '#fff', color: '#334155', borderColor: '#e2e8f0' }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: data.setupStatus === key ? '#fff' : cfg.color }} /> {cfg.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1 font-medium flex items-center gap-1"><Zap size={12} /> Kebutuhan Listrik (Watt)</label>
            <input type="text" inputMode="numeric" value={watt} onChange={(e) => setWatt(e.target.value)} onBlur={applyWatt}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1 font-medium flex items-center gap-1"><Droplets size={12} /> Kebutuhan Air</label>
              <div className="grid grid-cols-2 gap-1">
                <button type="button" onClick={() => !data.waterNeeded && onChange({ waterNeeded: true })} className={optionClass(data.waterNeeded)}>Ya</button>
                <button type="button" onClick={() => data.waterNeeded && onChange({ waterNeeded: false })} className={optionClass(!data.waterNeeded)}>Tidak</button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1 font-medium flex items-center gap-1"><Wifi size={12} /> Internet</label>
              <select value={data.internet} onChange={(e) => onChange({ internet: e.target.value })} className={inputClass}>
                {Object.entries(INTERNET_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1 font-medium flex items-center gap-1"><ClipboardList size={12} /> Catatan Operasional</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== data.notes && onChange({ notes })}
              placeholder='contoh: "butuh akses loading dock pagi"' className={inputClass} />
          </div>
          <p className="text-[10px] text-slate-400 flex items-start gap-1"><Info size={11} className="mt-0.5 shrink-0" /> Disimpan terpisah dari data sales: tidak mengubah booth, tenant, maupun invoice.</p>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Elemen yang Menempel ({anchored.length})</div>
          {anchored.length === 0 && <p className="text-[11px] text-slate-400">Belum ada elemen operasional yang ditempel ke booth ini.</p>}
          {anchored.map(el => (
            <button key={el.venueData.id} type="button" onClick={() => onSelectElement?.(el)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-xs text-left">
              <Link2 size={12} className="text-amber-600" /> {captionText(el)}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ---------- Other sales object selected (wall, stage, door, ...) ----------
function SalesObjectPanel({ obj }) {
  const name = obj.venueData ? captionText(obj) || obj.venueData.label || obj.venueData.type : (obj.isBackgroundBlueprint ? 'Blueprint' : 'Objek denah');
  return (
    <aside className={panelClass}>
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded border bg-white text-slate-600 border-slate-300">Lapisan Sales</span>
        <h2 className="font-semibold text-slate-800 text-base mt-2 flex items-center gap-2"><Lock size={14} className="text-slate-500" /> {name}</h2>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-100 border border-slate-300 text-[11px] text-slate-700">
          <Lock size={14} className="shrink-0 mt-0.5" />
          <span>Dinding, struktur, pintu, stage, dan blueprint hanya bisa diubah di Denah Sales. Hubungi tim Sales untuk mengubah layout.</span>
        </div>
      </div>
    </aside>
  );
}

// ---------- Section on top of the element inspector: anchor, warnings, public visibility ----------
export function OpsElementSection({ element, boothCodes = [], conflictCodes = null, isAdmin = false, meta = null, onAnchor, onDetach, onAutoAnchor, onTogglePublic }) {
  const vd = element.venueData || {};
  const anchor = vd.anchor;
  const [choice, setChoice] = useState(anchor?.boothCode || '');
  useEffect(() => { setChoice(anchor?.boothCode || ''); }, [vd.id, anchor?.boothCode]);

  return (
    <div className="space-y-2.5">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-300">
        Lapisan Operasional
      </span>
      {vd.anchorOrphaned && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-orange-50 border border-orange-300 text-[11px] text-orange-800">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span><b>Booth induk sudah dihapus</b> (sebelumnya booth {anchor?.boothCode || '-'}). Tinjau posisi elemen ini, lalu tempel ke booth lain atau lepas tempelannya.</span>
        </div>
      )}
      {conflictCodes?.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-[11px] text-rose-800">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Bertabrakan dengan booth <b>{conflictCodes.join(', ')}</b>. Pindahkan elemen atau tempelkan ke booth tersebut bila memang berada di dalamnya.</span>
        </div>
      )}
      <div className="p-3 rounded-xl border border-slate-200 space-y-2">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Link2 size={13} className="text-amber-600" /> Tempel ke Booth</div>
        {anchor && !vd.anchorOrphaned ? (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-600">Menempel ke <b className="text-slate-900">booth {anchor.boothCode}</b>, ikut berpindah bila booth dipindah Sales.</span>
            <button type="button" onClick={onDetach} className="shrink-0 px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 flex items-center gap-1 font-bold"><Unlink size={11} /> Lepas</button>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Tidak menempel: elemen tetap di posisinya.</p>
        )}
        <div className="flex gap-1.5">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={inputClass}>
            <option value="">Pilih booth…</option>
            {boothCodes.map(code => <option key={code} value={code}>Booth {code}</option>)}
          </select>
          <button type="button" disabled={!choice || (choice === anchor?.boothCode && !vd.anchorOrphaned)} onClick={() => onAnchor(choice)}
            className="shrink-0 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold disabled:opacity-40">Tempel</button>
        </div>
        <button type="button" onClick={onAutoAnchor} className="w-full py-1.5 rounded-lg border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 text-[11px] font-bold flex items-center justify-center gap-1">
          <Crosshair size={12} /> Tempel ke booth di bawah elemen
        </button>
      </div>
      {isAdmin && (
        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <div>
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              {vd.publicVisible ? <Globe size={13} className="text-emerald-600" /> : <EyeOff size={13} className="text-slate-500" />}
              Tampil di Live Floorplan
            </div>
            <div className="text-[11px] text-slate-500">{vd.publicVisible ? 'Ditampilkan ke publik (dipilih Admin)' : 'Internal: hanya tim operasional'}</div>
          </div>
          <button type="button" onClick={onTogglePublic}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white ${vd.publicVisible ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-500 hover:bg-slate-600'}`}>
            {vd.publicVisible ? 'Tampil' : 'Sembunyi'}
          </button>
        </div>
      )}
      {!isAdmin && (
        <p className="text-[10px] text-slate-400 flex items-start gap-1"><EyeOff size={11} className="mt-0.5 shrink-0" /> Lapisan operasional tidak tampil di Live Floorplan publik. Hanya Admin yang bisa memilih elemen tertentu untuk ditampilkan.</p>
      )}
      {meta?.updatedBy && <p className="text-[10px] text-slate-400">Terakhir disimpan oleh {meta.updatedBy}</p>}
    </div>
  );
}

// ---------- Nothing selected: operational summary instead of sales statistics ----------
function SummaryPanel({ opsObjects, booths, boothOps, conflicts, orphans, layer, onFocusElement }) {
  const types = opsTypeCounts(opsObjects);
  const statusCounts = Object.fromEntries(Object.keys(SETUP_STATUS).map(k => [k, 0]));
  const sum = { special: { count: 0, area: 0 }, standard: { count: 0, area: 0 } };
  booths.forEach(b => {
    const d = boothOps[boothKeyOf(b.boothData)];
    const s = d?.specialDesign ? sum.special : sum.standard;
    s.count++;
    s.area += (Number(b.boothData?.widthM) || 0) * (Number(b.boothData?.heightM) || 0);
    statusCounts[d?.setupStatus || 'belum_datang']++;
  });
  const m2 = (v) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })} m²`;
  const warnings = [
    ...[...conflicts.entries()].map(([el, codes]) => ({ el, text: `${captionText(el)} bertabrakan dengan booth ${codes.join(', ')}`, tone: 'rose' })),
    ...[...orphans].map(el => ({ el, text: `${captionText(el)}: booth induk sudah dihapus`, tone: 'orange' }))
  ];

  return (
    <aside className={panelClass}>
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <h2 className="font-semibold text-slate-800 text-base">Floorplan Inspector</h2>
        <p className="text-xs text-slate-500">Ringkasan operasional • pilih elemen atau booth untuk diedit</p>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 space-y-3">
          <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Ringkasan Operasional</h3>
          <div className="grid grid-cols-2 gap-2">
            {[['Special Design', sum.special, 'text-violet-300'], ['Standar', sum.standard, 'text-white']].map(([label, v, tone]) => (
              <div key={label} className="bg-slate-800 p-2.5 rounded-lg space-y-1.5">
                <div className="text-[10px] text-slate-400">Booth {label}</div>
                <div className={`text-xl font-bold tabular-nums ${tone}`}>{v.count} <span className="text-xs font-medium text-slate-400">booth</span></div>
                <div className="text-[10px] text-slate-400 pt-1.5 border-t border-slate-700">Total luas</div>
                <div className={`text-base font-bold tabular-nums ${tone}`}>{m2(v.area)}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">Jumlah per Jenis Elemen</div>
          {types.length === 0 && <p className="text-[11px] text-slate-400">Belum ada elemen. Tambahkan titik listrik, CCTV, APAR, dll dari panel kiri.</p>}
          <div className="space-y-1">
            {types.map(t => (
              <div key={t.key} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <span className="flex items-center gap-2 text-slate-700">
                  {t.lib ? <span className="w-5 h-5 flex items-center justify-center"><ElementIcon type={t.type} size={16} /></span> : <span className="w-5 text-center">{venueEmoji(t.type)}</span>}
                  {t.name}
                </span>
                <b className="text-slate-900">{t.count}</b>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">Status Setup Booth ({booths.length})</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(SETUP_STATUS).map(([key, cfg]) => (
              <div key={key} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs" style={{ borderColor: cfg.color, background: `${cfg.color}14` }}>
                <span className="flex items-center gap-1.5 text-slate-700"><span className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />{cfg.label}</span>
                <b>{statusCounts[key]}</b>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} className={warnings.length ? 'text-rose-600' : 'text-slate-400'} /> Perlu Ditinjau ({warnings.length})
          </div>
          {warnings.length === 0 && <p className="text-[11px] text-slate-400">Tidak ada konflik dengan booth.</p>}
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <button key={i} type="button" onClick={() => onFocusElement?.(w.el)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-[11px] flex items-start gap-1.5 ${w.tone === 'rose' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-orange-50 border-orange-200 text-orange-800'}`}>
                <MapPin size={12} className="shrink-0 mt-0.5" /> {w.text}
              </button>
            ))}
          </div>
        </div>
        {layer?.updatedBy && <p className="text-[10px] text-slate-400">Lapisan operasional terakhir disimpan oleh {layer.updatedBy}</p>}
        <CanvasShortcutsGuide mode="ops" />
      </div>
    </aside>
  );
}

export default function OpsInspector({ view, ...props }) {
  if (view === 'booth') return <BoothPanel {...props} />;
  if (view === 'sales') return <SalesObjectPanel obj={props.obj} />;
  return <SummaryPanel {...props} />;
}
