// "Pasang Aplikasi": the browser's own install prompt (Chrome / Edge, desktop and Android). It fires once, early,
// often before the admin page is open, so it is kept here from the start (main.jsx) until the button asks for it.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

export const canPromptInstall = () => Boolean(deferred);
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// true when the page already runs as the installed app (dock / home screen)
export const isInstalledApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

// 'accepted' | 'dismissed' | null (no prompt available: show the manual steps)
export async function promptInstall() {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice)?.outcome || null;
}

// Which manual steps to show when the browser gives no prompt
export function installPlatform() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)) return 'mac-safari';
  if (/Firefox/.test(ua)) return 'firefox';
  return 'desktop';
}
