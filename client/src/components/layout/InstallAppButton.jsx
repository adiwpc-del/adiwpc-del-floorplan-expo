import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { canPromptInstall, installPlatform, isInstalledApp, onInstallChange, promptInstall } from '../../utils/installApp';

const STEPS = {
  ios: ['Buka halaman ini di Safari.', 'Ketuk tombol Bagikan (kotak dengan panah ke atas).', 'Pilih "Tambah ke Layar Utama", lalu "Tambah".'],
  android: ['Buka halaman ini di Chrome.', 'Ketuk menu ⋮ di kanan atas.', 'Pilih "Instal aplikasi" (atau "Tambahkan ke layar utama").'],
  'mac-safari': ['Di menu Safari, pilih File (Arsip).', 'Pilih "Tambahkan ke Dock".', 'Ikon EXPO muncul di Dock dan Launchpad.'],
  firefox: ['Firefox belum bisa memasang aplikasi web.', 'Buka halaman ini di Chrome, Edge atau Safari, lalu tekan "Pasang Aplikasi" lagi.'],
  desktop: ['Klik ikon pasang (layar dengan panah) di ujung kanan kolom alamat,', 'atau menu ⋮ → "Transmisikan, simpan, dan bagikan" → "Instal halaman sebagai aplikasi".', 'Ikon EXPO muncul di Dock / taskbar dan menu aplikasi.']
};

// Sidebar item: installs the web app with its own icon on the desktop Dock / taskbar and the phone home screen
export default function InstallAppButton() {
  const [, rerender] = useState(0);
  const [steps, setSteps] = useState(null);
  const [installed, setInstalled] = useState(isInstalledApp);

  useEffect(() => onInstallChange(() => { rerender(n => n + 1); setInstalled(isInstalledApp()); }), []);
  useEffect(() => {
    if (!steps) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSteps(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [steps]);

  if (installed) return null;

  const handleClick = async () => {
    if (canPromptInstall()) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') setInstalled(true);
      return;
    }
    setSteps(STEPS[installPlatform()]);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="w-full py-2 px-1 flex flex-col items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 transition-all active:scale-[0.97]"
        title="Pasang EXPO sebagai aplikasi di Dock / layar HP"
      >
        <Download size={19} />
        <span className="text-[10px] tracking-tight mt-1 text-center font-medium leading-tight truncate max-w-full">Pasang App</span>
      </button>

      {steps && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Pasang Aplikasi" onClick={() => setSteps(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <img src="/icon-192.png" alt="" className="w-10 h-10 -m-1" />
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Pasang Aplikasi EXPO</h3>
                  <p className="text-[11px] text-slate-500">Buka langsung dari ikon, tanpa mengetik alamat.</p>
                </div>
              </div>
              <button type="button" onClick={() => setSteps(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Tutup"><X size={18} /></button>
            </div>
            <ol className="px-5 py-4 space-y-2.5 text-xs text-slate-700">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="pt-0.5 leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
            <div className="flex justify-end px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
              <button type="button" autoFocus onClick={() => setSteps(null)} className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 active:scale-[0.97] transition-transform">Mengerti</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
