// Moteur d'internationalisation (i18n) — Español (es) / Kreyòl Ayisyen (ht).
// • La langue est portée par l'URL : /es/… ou /ht/… (SEO international : une URL = une langue).
// • Les textes sont centralisés dans js/locales/es.js et ht.js. Clé = texte source (français).
// • t('Texte source') traduit explicitement ; le DOM (HTML statique et fragments injectés par JS) est traduit
//   automatiquement par applyDom() + un MutationObserver. Un texte absent du dictionnaire reste en français (jamais d'erreur).
export const LANGS = {
  es: { label: 'Español', flag: '🇩🇴', locale: 'es-DO', country: 'DO', currency: 'DOP', og: 'es_DO' },
  ht: { label: 'Kreyòl Ayisyen', flag: '🇭🇹', locale: 'fr-HT', country: 'HT', currency: 'HTG', og: 'ht_HT' },
};
export const DEFAULT_LANG = 'es';
// Pages client servies sous /es/ et /ht/ (le reste — /admin, /bio, /assets, /api — n'est pas préfixé).
export const CUSTOMER_PAGES = ['about', 'account', 'b2b', 'cart', 'checkout', 'contact', 'delete-account', 'login', 'orders', 'product', 'register', 'seller', 'shop', 'faq', 'terms', 'privacy', 'returns'];

// ---------- Préférences (cookie + localStorage) ----------
const ONE_YEAR = 31536000;
export function readPref(k) {
  try { const c = document.cookie.split('; ').find((x) => x.startsWith(`${k}=`)); if (c) return decodeURIComponent(c.slice(k.length + 1)); } catch { /* cookies bloqués */ }
  try { return localStorage.getItem(k) || null; } catch { return null; }
}
export function writePref(k, v) {
  try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=${ONE_YEAR}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* ignoré */ }
  try { localStorage.setItem(k, v); } catch { /* ignoré */ }
}

// ---------- Chemins ----------
const PREFIX_RE = /^\/(es|ht)(?=\/|$)/;
export const pathLang = (p = location.pathname) => (p.match(PREFIX_RE) || [])[1] || null;
export const stripLang = (p = location.pathname) => p.replace(PREFIX_RE, '') || '/';
const firstSeg = (p) => p.split('/')[1]?.replace(/\.html$/, '') || '';
export const isCustomerPath = (p = location.pathname) => { const s = firstSeg(stripLang(p)); return s === '' || CUSTOMER_PAGES.includes(s); };

// La traduction automatique ne s'applique qu'aux pages client localisées (/es, /ht) et aux pages marquées data-i18n (404, hors ligne).
// /admin et /bio restent en français et affichent les montants en devise de base.
export const I18N_ACTIVE = typeof document !== 'undefined' && (!!pathLang() || document.documentElement.hasAttribute('data-i18n'));
let LANG = pathLang() || readPref('jl_lang');
if (!LANGS[LANG]) LANG = null;

// Ajoute le préfixe de langue à un lien interne (/shop?x=1 → /es/shop?x=1). Les liens externes, /admin, /bio, /assets, /api restent intacts.
export function localizePath(href, lang = LANG || DEFAULT_LANG) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href;
  const m = href.match(/^([^?#]*)(.*)$/); let path = m[1]; const rest = m[2];
  if (pathLang(path)) return href;
  const seg = firstSeg(path);
  if (path === '/' || path === '/index.html') return `/${lang}${rest}`;
  if (!CUSTOMER_PAGES.includes(seg)) return href;
  return `/${lang}${path}${rest}`;
}

// ---------- Détection du pays (1re visite) ----------
export async function detectPrefs() {
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch('/api/geo', { signal: ctl.signal, credentials: 'omit' }); clearTimeout(to);
    const j = await r.json();
    if (LANGS[j.lang]) return { lang: j.lang, currency: j.currency, country: j.country };
  } catch { /* hors ligne : repli sur la langue du navigateur */ }
  const nav = (navigator.language || '').toLowerCase();
  const lang = nav.startsWith('ht') || nav.startsWith('fr') ? 'ht' : 'es';
  return { lang, currency: LANGS[lang].currency, country: LANGS[lang].country };
}

// Page ancienne (sans préfixe, ex. /shop) : redirection vers la version localisée, puis on arrête le chargement.
if (!pathLang() && isCustomerPath() && !document.documentElement.hasAttribute('data-i18n')) {
  let target = LANG;
  if (!target) {
    const d = await detectPrefs(); target = d.lang;
    writePref('jl_lang', d.lang); if (!readPref('jl_cur')) writePref('jl_cur', d.currency); writePref('jl_country', d.country);
  }
  location.replace(localizePath(location.pathname + location.search + location.hash, target));
  await new Promise(() => {}); // la page est remplacée : on ne rend rien en français
}
if (!LANG) LANG = DEFAULT_LANG;
export const getLang = () => LANG;
export const getLocale = () => (I18N_ACTIVE ? LANGS[LANG].locale : 'fr-FR');
export const getCountry = () => readPref('jl_country') || LANGS[LANG].country;
if (I18N_ACTIVE) document.documentElement.lang = LANG;

// ---------- Dictionnaire ----------
const dict = I18N_ACTIVE ? (await import(`./locales/${LANG}.js`)).default : { words: {}, patterns: [] };
const sub = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : s);
export function t(key, vars) {
  const k = String(key ?? ''); const v = dict.words[k];
  return sub(v === undefined ? k : v, vars);
}
// Traduit une chaîne (espaces de début/fin conservés). null = rien à changer.
export function translateText(s) {
  const k = s.replace(/\s+/g, ' ').trim(); if (!k) return null;
  let v = dict.words[k];
  if (v === undefined) for (const [re, fn] of dict.patterns) { const m = k.match(re); if (m) { v = fn(...m.slice(1), (x) => translateText(x) ?? x); break; } }
  if (v === undefined || v === k) return null;
  return s.match(/^\s*/)[0] + v + s.match(/\s*$/)[0];
}

// ---------- Traduction du DOM ----------
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
function fixEl(el) {
  if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.textContent); // la valeur envoyée ne doit jamais dépendre de la langue
  for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v) { const r = translateText(v); if (r && r !== v) el.setAttribute(a, r); } }
  if (el.tagName === 'A') { const h = el.getAttribute('href'); const l = h && localizePath(h); if (l && l !== h) el.setAttribute('href', l); }
}
function fixText(n) { const r = translateText(n.nodeValue); if (r && r !== n.nodeValue) n.nodeValue = r; }
export function applyDom(root = document.body) {
  if (!root) return;
  if (root.nodeType === 3) { if (!SKIP.has(root.parentNode?.tagName)) fixText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.closest?.('[data-no-i18n]')) return;
  fixEl(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.hasAttribute('data-no-i18n')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) fixText(n); else fixEl(n); }
}
let queue = new Set(); let scheduled = false;
function flush() { scheduled = false; const q = queue; queue = new Set(); q.forEach((n) => { if (n.isConnected) applyDom(n); }); }
export function observeDom() {
  if (typeof MutationObserver === 'undefined') return;
  new MutationObserver((muts) => {
    for (const m of muts) { if (m.type === 'characterData') queue.add(m.target); else m.addedNodes.forEach((n) => queue.add(n)); }
    if (!scheduled && queue.size) { scheduled = true; queueMicrotask(flush); }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}
if (typeof document !== 'undefined') {
  const boot = () => { if (!I18N_ACTIVE) return; applyDom(document.body); observeDom(); };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot, { once: true });
}

// Formats de date selon la langue
export const fmtDateLocale = (d) => new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
