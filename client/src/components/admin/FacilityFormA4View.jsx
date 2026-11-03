import React, { useRef, useState, useEffect } from 'react';
import { 
  Building2, 
  ShieldCheck, 
  Calendar, 
  CheckSquare, 
  Square,
  FileCheck,
  CreditCard,
  Info
} from 'lucide-react';
import { DEFAULT_INVOICE_CONFIG } from '../../utils/invoiceTemplateConfig';
import { api, getCachedInvoiceConfig } from '../../services/api';

export default function FacilityFormA4View({
  tenant = {},
  form = {},
  selectedItems = [],
  mode = 'blank', // 'blank' (checklist kosong) | 'filled' (draf pesanan terisi)
  companyConfig = null,
  innerRef = null,
  docNumber: docNumberProp = '' // e.g. the request id on the tenant's submission receipt
}) {
  const localRef = useRef(null);
  const printRef = innerRef || localRef;

  const [activeConfig, setActiveConfig] = useState(() => {
    if (companyConfig) return companyConfig;
    const cached = getCachedInvoiceConfig();
    return cached ? { ...DEFAULT_INVOICE_CONFIG, ...cached } : DEFAULT_INVOICE_CONFIG;
  });

  useEffect(() => {
    if (companyConfig) {
      setActiveConfig(companyConfig);
    } else {
      api.fetchInvoiceConfig().then(saved => {
        if (saved) {
          setActiveConfig(prev => ({ ...prev, ...saved }));
        }
      });
    }
  }, [companyConfig]);

  const cfg = activeConfig;
  const primaryColor = cfg.primaryColor || '#4f46e5';
  const secondaryColor = cfg.secondaryColor || '#0f172a';
  const accentColor = cfg.accentColor || '#10b981';

  // Table header background & text styles matching Real-Time Live Canvas Preview
  const getTableHeaderStyles = () => {
    switch (cfg.tableHeaderStyle) {
      case 'solid_primary':
        return { backgroundColor: primaryColor, color: '#ffffff' };
      case 'solid_dark':
        return { backgroundColor: '#0f172a', color: '#ffffff' };
      case 'tinted':
        return { backgroundColor: `${primaryColor}15`, color: primaryColor, borderBottom: `2px solid ${primaryColor}` };
      case 'bordered':
        return { backgroundColor: '#f8fafc', color: '#1e293b', borderBottom: '2px solid #0f172a' };
      case 'minimal':
        return { backgroundColor: 'transparent', color: '#475569', borderBottom: '1px solid #cbd5e1' };
      default:
        return { backgroundColor: primaryColor, color: '#ffffff' };
    }
  };

  const tableHeaderStyle = getTableHeaderStyles();

  const items = (selectedItems && selectedItems.length > 0) ? selectedItems : (form.items || []);
  
  const formattedDate = (dStr) => {
    if (!dStr) return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    try {
      return new Date(dStr).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch (e) {
      return dStr;
    }
  };

  const todayFormatted = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const boothCode = tenant.boothCode || tenant.code || 'A-01';
  const companyName = tenant.companyName || tenant.tenant || tenant.company_name || 'PT NAMA TENANT PAMERAN';
  const picName = tenant.picName || tenant.ownerName || tenant.pic_name || 'Bpk/Ibu PIC Exhibitor';
  const phone = tenant.phone || tenant.client_phone || '-';
  const email = tenant.email || tenant.client_email || '-';
  const docNumber = docNumberProp || `FORM/FAC/${new Date().getFullYear()}/${boothCode}`;

  // Calculate total if in filled mode
  const totalAmount = mode === 'filled'
    ? items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0)), 0)
    : 0;

  // Page margins: an empty table head / foot row, repeated by the browser on every printed page (same idea as the
  // invoice's KopFrame, AGENTS.md §42). With a letterhead the bottom margin also keeps the letterhead's own footer
  // (logo, address) free; a long form continues on the next page instead of being cut off.
  const marginBottomMm = cfg.letterheadUrl ? 38 : 12;

  return (
    <div className="w-full flex justify-center">
      <div 
        ref={printRef}
        id="printable-facility-form-a4"
        data-print-pages="1"
        className={`printable-a4-sheet bg-white text-slate-900 shadow-2xl rounded-sm border border-slate-200 relative font-sans print:shadow-none print:border-none print:m-0 ${cfg.fontFamily || 'font-sans'}`}
        style={{
          boxSizing: 'border-box',
          width: '210mm',
          minHeight: '297mm',
          maxWidth: '210mm',
          padding: 0,
          backgroundColor: '#ffffff',
          isolation: 'isolate' // the letterhead (z-index -1) sits above the white sheet and below the content
        }}
      >
        {cfg.letterheadUrl && (
          // Kop surat (Desain Layout Invoice > Logo & Posisi, AGENTS.md §42): the A4 letterhead behind the whole form;
          // printed (page margin 0, printInvoiceElement) it is fixed, so it covers every page
          <img
            src={cfg.letterheadUrl}
            alt=""
            aria-hidden="true"
            data-kop-bg="1"
            className="pointer-events-none select-none"
            style={{ position: 'absolute', top: 0, left: 0, width: '210mm', height: '297mm', objectFit: 'fill', zIndex: -1 }}
          />
        )}
        <table className="w-full border-collapse">
          <thead><tr><td style={{ height: '12mm', padding: 0 }} /></tr></thead>
          <tfoot><tr><td style={{ height: `${marginBottomMm}mm`, padding: 0 }} /></tr></tfoot>
          <tbody><tr><td style={{ padding: '0 14mm', verticalAlign: 'top' }}>
        <div className="flex flex-col justify-between" style={{ minHeight: `${297 - 12 - marginBottomMm - 1}mm` }}>
        {/* TOP CONTAINER (SECTIONS 1 TO 4) */}
        <div>
          {/* SECTION 1: STANDARDIZED KOP SURAT PERUSAHAAN (IDENTICAL TO REAL-TIME LIVE CANVAS PREVIEW) */}
          {cfg.headerLayout === 'logo_center_stacked' ? (
            // Layout A: Center Stacked Header
            <div className="text-center border-b-2 pb-5 mb-5" style={{ borderColor: primaryColor }}>
              {cfg.showLogo && (
                <div className="flex justify-center mb-2">
                  {cfg.logoUrl ? (
                    <img 
                      src={cfg.logoUrl} 
                      alt="Logo" 
                      style={{ height: `${cfg.logoSize || 44}px` }} 
                      className="object-contain" 
                    />
                  ) : (
                    <div 
                      className="px-4 py-2 rounded-xl text-white font-black text-sm tracking-wider uppercase shadow-md flex items-center gap-2"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <Building2 size={18} />
                      <span>{cfg.logoText || 'PT WAHYU PROMO CITRA'}</span>
                    </div>
                  )}
                </div>
              )}
              <h1 className="text-lg font-black uppercase text-slate-900 tracking-tight">
                {cfg.companyName || 'PT Wahyu Promo Citra'}
              </h1>
              <p className="text-[11px] text-slate-500 max-w-lg mx-auto">
                {cfg.companyAddress}
              </p>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="text-left">
                  <span className="font-bold text-slate-800 text-sm">{form.event_title || 'Indonesia International Expo 2026'}</span>
                  <p className="text-slate-500 text-[11px]">Venue: {form.event_venue || 'Jakarta Convention Center (Hall A)'}</p>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-slate-900 text-sm">{docNumber}</span>
                  <div className="text-[10px] text-slate-500">Terbit: {todayFormatted} • Batas: {formattedDate(form.deadline_date)}</div>
                </div>
              </div>
            </div>
          ) : cfg.headerLayout === 'logo_right_info_left' ? (
            // Layout B: Logo on Right, Info on Left
            <div className="flex items-start justify-between border-b-2 pb-6 mb-6" style={{ borderColor: primaryColor }}>
              <div className="space-y-1 max-w-[60%]">
                <div 
                  className="inline-block text-white px-3 py-1 rounded-md text-xs font-black tracking-wider uppercase mb-1 shadow-sm" 
                  style={{ backgroundColor: primaryColor }}
                >
                  FORMULIR RESMI
                </div>
                <div className="text-sm font-mono font-bold text-slate-900">
                  {docNumber}
                </div>

                <div className="text-xs text-slate-600 space-y-0.5 pt-1">
                  <p className="font-bold text-slate-800 text-sm">
                    {form.event_title || 'Indonesia International Expo 2026'}
                  </p>
                  <p className="text-slate-500">
                    Venue: {form.event_venue || 'Jakarta Convention Center (Hall A)'}
                  </p>
                  <div className="text-[11px] text-slate-500 pt-1">
                    Tanggal Terbit: <b>{todayFormatted}</b> • Batas Pengajuan: <b className="text-rose-700">{formattedDate(form.deadline_date)}</b>
                  </div>
                </div>
              </div>

              {/* Logo / Company on Right */}
              <div className="text-right space-y-1.5 flex flex-col items-end">
                {cfg.showLogo && (
                  cfg.logoUrl ? (
                    <img src={cfg.logoUrl} alt="Logo" style={{ height: `${cfg.logoSize || 44}px` }} className="object-contain" />
                  ) : (
                    <div className="px-3 py-1.5 rounded-lg text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5" style={{ backgroundColor: secondaryColor }}>
                      <Building2 size={14} />
                      <span>{cfg.logoText || 'FLOORPLAN STUDIO'}</span>
                    </div>
                  )
                )}
                <h2 className="text-xs font-bold uppercase text-slate-800 tracking-tight">
                  {cfg.companyName || 'PT Wahyu Promo Citra'}
                </h2>
                <p className="text-[10px] text-slate-500 max-w-[220px]">
                  {cfg.companyAddress}
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300">
                  ● DOKUMEN RESMI
                </span>
              </div>
            </div>
          ) : cfg.headerLayout === 'clean_minimal' ? (
            // Layout C: Clean Minimal
            <div className="border-b pb-5 mb-5 border-slate-300">
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-xl font-black uppercase text-slate-900 tracking-tighter">
                  FORMULIR FASILITAS
                </h1>
                <span className="font-mono font-bold text-slate-800 text-sm">
                  #{docNumber}
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <div>
                  <span className="font-bold text-slate-800">{form.event_title || 'Indonesia International Expo 2026'}</span>
                  <p className="text-slate-500 text-[11px]">{form.event_venue || 'Jakarta Convention Center (Hall A)'}</p>
                </div>
                <div className="text-right">
                  <div>Terbit: <b>{todayFormatted}</b></div>
                  <div>Batas Pengajuan: <b className="text-rose-700">{formattedDate(form.deadline_date)}</b></div>
                </div>
              </div>
            </div>
          ) : (
            // Layout Standard: Logo on Left, Info on Right (Default Real-Time Live Canvas Preview)
            <div className="flex items-start justify-between border-b-2 pb-6 mb-6" style={{ borderColor: primaryColor }}>
              <div className="space-y-1 max-w-[60%]">
                <div className="flex items-center gap-2.5 mb-2">
                  {cfg.showLogo && (
                    cfg.logoUrl ? (
                      <img src={cfg.logoUrl} alt="Logo" style={{ height: `${cfg.logoSize || 44}px` }} className="object-contain rounded-md" />
                    ) : (
                      <div 
                        className="w-9 h-9 rounded-xl text-white flex items-center justify-center font-bold text-sm shadow-md"
                        style={{ backgroundColor: primaryColor }}
                      >
                        FS
                      </div>
                    )
                  )}
                  <div>
                    <h1 className="text-base font-black tracking-tight text-slate-900 uppercase">
                      {cfg.companyName || 'PT Wahyu Promo Citra'}
                    </h1>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-medium">
                      {cfg.logoTagline || 'Official Event Management & Exhibition Services'}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-0.5 pt-1">
                  <p className="font-bold text-slate-800 text-sm">
                    {form.event_title || 'Indonesia International Expo 2026'}
                  </p>
                  <p className="text-slate-500">
                    Venue: {form.event_venue || 'Jakarta Convention Center (Hall A)'}
                  </p>
                </div>
              </div>

              {/* Right: Document Info */}
              <div className="text-right space-y-1">
                <div 
                  className="inline-block text-white px-3 py-1 rounded-md text-xs font-black tracking-wider uppercase mb-1 shadow-sm"
                  style={{ backgroundColor: primaryColor }}
                >
                  FORMULIR RESMI
                </div>
                <div className="text-sm font-mono font-bold text-slate-900">
                  {docNumber}
                </div>

                <div className="pt-2 text-xs space-y-0.5 text-slate-600">
                  <div>
                    <span className="text-slate-400">Tanggal Terbit: </span>
                    <b className="text-slate-800">{todayFormatted}</b>
                  </div>
                  <div>
                    <span className="text-slate-400">Batas Pengajuan: </span>
                    <b className="text-rose-700">{formattedDate(form.deadline_date)}</b>
                  </div>
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300">
                      ● DOKUMEN RESMI
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: DYNAMIC BILL TO / TENANT & ISSUED BY (IDENTICAL TO REAL-TIME LIVE CANVAS PREVIEW) */}
          <div className={`${cfg.clientSectionPosition === 'stacked' ? 'space-y-3' : 'grid grid-cols-2 gap-6'} p-4 bg-slate-50/80 rounded-xl border border-slate-200 mb-5 text-xs`}>
            {/* Bill To / Tenant Info */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                Ditujukan Kepada (Exhibitor / Tenant):
              </span>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-slate-900 text-sm uppercase">{companyName}</span>
                <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                  #{boothCode}
                </span>
              </div>
              <div className="space-y-0.5 text-slate-600 text-[11px]">
                <div>PIC Lapangan: <b className="text-slate-800">{picName}</b></div>
                {phone && phone !== '-' && <div>No. Kontak / WA: <b className="text-slate-800">{phone}</b></div>}
                {email && email !== '-' && <div>Email: <b className="text-slate-800">{email}</b></div>}
              </div>
            </div>

            {/* Issued By / Penyelenggara */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                Diterbitkan Oleh (Penyelenggara Acara):
              </span>
              <div className="font-bold text-slate-900 text-sm mb-1 uppercase">
                {cfg.companyName || 'PT Wahyu Promo Citra'}
              </div>
              <div className="space-y-0.5 text-slate-600 text-[11px]">
                <div className="leading-tight">{cfg.companyAddress || 'Gedung Exhibition Plaza Lt. 4, Jakarta Pusat'}</div>
              </div>
            </div>
          </div>

          {/* SECTION 3: JUDUL FORMULIR / KATALOG FASILITAS */}
          <div 
            className="rounded-xl p-2.5 mb-4 text-center border font-bold"
            style={{ 
              backgroundColor: `${primaryColor}0d`, 
              borderColor: `${primaryColor}30`, 
              color: primaryColor 
            }}
          >
            <h2 className="text-xs font-black uppercase tracking-wider">
              {form.title || 'FORMULIR PERMINTAAN FASILITAS TAMBAHAN STAN PAMERAN'}
            </h2>
            {form.description && (
              <p className="text-[10px] text-slate-600 font-normal mt-0.5">
                {form.description}
              </p>
            )}
          </div>

          {/* SECTION 4: TABEL ITEM FASILITAS & TARIF RESMI */}
          <div className="mb-4">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider" style={tableHeaderStyle}>
                  <th className="py-2.5 px-3 rounded-l-md w-8 text-center">No</th>
                  <th className="py-2.5 px-3">Item Fasilitas Tambahan</th>
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-2 text-center w-14">Satuan</th>
                  <th className="py-2.5 px-3 text-right w-28">Tarif Resmi</th>
                  <th className="py-2.5 px-3 text-center w-24">
                    {mode === 'filled' ? 'Jumlah' : 'Pesanan (Qty)'}
                  </th>
                  {mode === 'filled' && (
                    <th className="py-2.5 px-3 text-right rounded-r-md w-28">Subtotal</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                {items.map((item, idx) => {
                  const price = Number(item.price) || 0;
                  const qty = Number(item.qty) || 0;
                  const itemSubtotal = qty * price;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60" style={{ breakInside: 'avoid' }}>
                      <td className="py-2 px-3 text-center text-slate-500 font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3">
                        <span className="font-bold text-slate-900 text-xs block">{item.name}</span>
                        {item.description && (
                          <span className="text-[10px] text-slate-500 italic block leading-tight">{item.description}</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                          {item.category || 'Fasilitas'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center text-slate-600 text-[11px]">
                        {item.unit || 'Unit'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 text-xs">
                        Rp {price.toLocaleString('id-ID')}
                      </td>
                      
                      {/* Qty Box */}
                      <td className="py-2 px-3 text-center">
                        {mode === 'filled' ? (
                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 text-xs">
                            {qty > 0 ? `${qty} ${item.unit || ''}` : '-'}
                          </span>
                        ) : (
                          <div className="w-16 h-6 border border-dashed border-slate-400 rounded mx-auto flex items-center justify-center text-[10px] text-slate-400">
                            [ . . . ]
                          </div>
                        )}
                      </td>

                      {/* Subtotal if filled mode */}
                      {mode === 'filled' && (
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 text-xs">
                          {itemSubtotal > 0 ? `Rp ${itemSubtotal.toLocaleString('id-ID')}` : '-'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Total Row in filled mode */}
            {mode === 'filled' && totalAmount > 0 && (
              <div className="pt-2 flex justify-end" style={{ breakInside: 'avoid' }}>
                <div className="min-w-64 bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-baseline justify-between gap-4 text-xs">
                  <span className="font-bold uppercase text-slate-700">Total Biaya Fasilitas:</span>
                  <span className="font-mono font-black text-slate-950 text-sm whitespace-nowrap">
                    Rp {totalAmount.toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
            )}

            {/* The tenant's own note on a submitted request */}
            {mode === 'filled' && tenant.notes && (
              <div className="pt-2 text-[10px] text-slate-600" style={{ breakInside: 'avoid' }}>
                <span className="font-bold text-slate-800">Catatan tenant: </span>
                <span className="whitespace-pre-line">{tenant.notes}</span>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM CONTAINER (SECTION 5: INSTRUCTIONS, BANK & DUAL SIGNATURE) */}
        <div className="pt-3 border-t-2 space-y-3 shrink-0" style={{ borderColor: primaryColor, breakInside: 'avoid' }}>
          
          {/* Ketentuan & Rekening Pembayaran */}
          <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <div>
              <div className="flex items-center gap-1 font-bold text-slate-800 mb-0.5">
                <Info size={11} style={{ color: primaryColor }} />
                <span>Ketentuan Pemesanan:</span>
              </div>
              <p className="leading-tight text-slate-500">
                1. Formulir wajib dikonfirmasi paling lambat sebelum batas akhir pengajuan.<br/>
                2. Kerusakan/kehilangan inventaris sewaan menjadi tanggung jawab tenant sepenuhnya.<br/>
                3. Instalasi teknis akan diuji coba saat jadwal loading-in pameran.
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1 font-bold text-slate-800 mb-0.5">
                <CreditCard size={11} style={{ color: primaryColor }} />
                <span>Rekening Resmi Pembayaran:</span>
              </div>
              <p className="leading-tight text-slate-700">
                Bank: <b>{cfg.bankName || 'Bank Central Asia (BCA)'}</b><br/>
                No. Rek: <b className="font-mono">{cfg.accountNumber || '882-019-3321'}</b><br/>
                A/N: <b>{cfg.accountName || cfg.companyName}</b>
              </p>
            </div>
          </div>

          {/* Dua Kolom Tanda Tangan Resmi */}
          <div className="grid grid-cols-2 gap-6 pt-2 text-xs">
            {/* Tanda Tangan Tenant */}
            <div className="border border-slate-200 rounded-xl p-3 text-center flex flex-col justify-between h-32">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Pemohon / Exhibitor (Tenant):
              </span>
              <div className="flex-1 flex items-center justify-center">
                <span className="text-[10px] text-slate-300 italic border-b border-dashed border-slate-300 px-6 py-1">
                  (Tanda Tangan & Stempel Perusahaan)
                </span>
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs underline">{picName}</p>
                <p className="text-[10px] text-slate-500 uppercase">{companyName}</p>
              </div>
            </div>

            {/* Tanda Tangan Panitia Pelaksana */}
            <div className="border border-slate-200 rounded-xl p-3 text-center flex flex-col justify-between h-32">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                {cfg.signerCity || 'Jakarta'}, {todayFormatted}<br/>
                Panitia Pelaksana ({cfg.companyName || 'PT Wahyu Promo Citra'}):
              </span>
              <div className="flex-1 flex items-center justify-center relative">
                {cfg.showStamp && (
                  <span 
                    className="border-2 border-dashed px-2 py-0.5 rounded text-[9px] font-black uppercase rotate-[-8deg] opacity-75 pointer-events-none"
                    style={{ borderColor: primaryColor, color: primaryColor }}
                  >
                    PANITIA EXPO OFFICIAL
                  </span>
                )}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs underline">{cfg.signerName || 'Satrio Sukur'}</p>
                <p className="text-[10px] text-slate-500 uppercase">{cfg.signerTitle || 'Head of Finance & Exhibition'}</p>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="text-center text-[9px] text-slate-400 pt-1">
            Dokumen Formulir Resmi diterbitkan oleh {cfg.companyName || 'PT Wahyu Promo Citra'} • Dicetak melalui Floorplan Studio System
          </div>
        </div>
        </div>
          </td></tr></tbody>
        </table>
      </div>
    </div>
  );
}
