// Notifications sur l'appareil (Web Push) : alerte sur l'écran du téléphone/ordinateur pour les commandes, paiements, etc.
import { sb } from './supabase.js';
const KEY_CACHE = 'jl_webpush_on';
const u8 = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'unsupported' | 'ios-install' (iPhone : ajouter le site à l'écran d'accueil) | 'denied' | 'on' | 'off'
export async function pushState() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window) || !('Notification' in window)) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = reg && (await reg.pushManager.getSubscription()); return sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch { return 'off'; }
}
async function register(sub) {
  const j = sub.toJSON(); if (!j.keys) throw new Error('Abonnement invalide.');
  const { error } = await sb.rpc('register_web_push', { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); if (error) throw error;
}
export async function enablePush() {
  if ((await pushState()) === 'unsupported') throw new Error('Les notifications ne sont pas disponibles sur ce navigateur.');
  const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Autorisation refusée. Vous pouvez la réactiver dans les réglages du navigateur.');
  const r = await fetch('/api/push/key'); if (!r.ok) throw new Error('Les notifications ne sont pas encore activées sur le serveur.');
  const { key } = await r.json();
  const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) }));
  await register(sub); try { localStorage.setItem(KEY_CACHE, '1'); } catch {}
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/'); const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) { await sb.rpc('unregister_web_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
  try { localStorage.removeItem(KEY_CACHE); } catch {}
}
// À chaque visite d'un utilisateur déjà abonné : rattache l'appareil au compte connecté (téléphone partagé) sans rien afficher.
export async function refreshPush() {
  try { if ((await pushState()) !== 'on') return; const reg = await navigator.serviceWorker.getRegistration('/'); await register(await reg.pushManager.getSubscription()); } catch {}
}
