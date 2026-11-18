// Génère dist/es/*.html et dist/ht/*.html à partir des pages sources (français) et des dictionnaires js/locales/*.js.
// SEO international : <html lang>, <title>, description, Open Graph, canonical, hreflang (es / ht / x-default) et liens internes préfixés.
const fs = require('fs'); const path = require('path');

const LANGS = { es: { og: 'es_DO', name: 'Español' }, ht: { og: 'ht_HT', name: 'Kreyòl Ayisyen' } };
const CUSTOMER_PAGES = ['about', 'account', 'b2b', 'cart', 'checkout', 'contact', 'delete-account', 'login', 'orders', 'product', 'register', 'seller', 'shop', 'faq', 'terms', 'privacy', 'returns'];

// Les dictionnaires sont des modules ES : on les lit sans les importer (compatible toutes versions de Node).
function loadLocale(root, lang) {
  const src = fs.readFileSync(path.join(root, 'js/locales', `${lang}.js`), 'utf8').replace('export default', 'module.exports =');
  const m = { exports: {} }; new Function('module', src)(m); return m.exports;
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function makeTranslator(dict) {
  const tr = (x) => translate(x);
  const translate = (s) => {
    const k = norm(s); if (!k) return null;
    let v = dict.words[k];
    if (v === undefined) for (const [re, fn] of dict.patterns) { const m = k.match(re); if (m) { v = fn(...m.slice(1), (x) => tr(x) ?? x); break; } }
    if (v === undefined || v === k) return null;
    return s.match(/^\s*/)[0] + v + s.match(/\s*$/)[0];
  };
  return translate;
}
const localize = (href, lang) => {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const m = href.match(/^([^?#]*)(.*)$/); const seg = m[1].split('/')[1]?.replace(/\.html$/, '') || '';
  if (m[1] === '/' || m[1] === '/index.html') return `/${lang}${m[2]}`;
  return CUSTOMER_PAGES.includes(seg) ? `/${lang}${m[1]}${m[2]}` : href;
};

function transform(html, lang, page, site, dict) {
  const T = makeTranslator(dict);
  const url = `${site}/${lang}${page === 'index' ? '' : `/${page}`}`;
  // Blocs à ne pas traduire (scripts, styles, textarea…) : mis de côté puis restitués.
  const keep = []; html = html.replace(/<(script|style|textarea|noscript)\b[\s\S]*?<\/\1>/gi, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
  // <option> sans value : la valeur envoyée reste la valeur d'origine (jamais traduite).
  html = html.replace(/<option>([^<]*)<\/option>/g, (m, t) => `<option value="${escAttr(t.trim())}">${t}</option>`);
  // Balises SEO
  html = html.replace(/<title>([^<]*)<\/title>/, (m, t) => `<title>${T(t) || t}</title>`);
  html = html.replace(/<meta (name|property)="(description|og:title|og:description|twitter:title|twitter:description)" content="([^"]*)"/g, (m, a, n, c) => `<meta ${a}="${n}" content="${escAttr(T(c) || c)}"`);
  html = html.replace(/(<meta property="og:locale" content=")[^"]*"/, `$1${LANGS[lang].og}"`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`);
  const alt = Object.keys(LANGS).map((l) => `<link rel="alternate" hreflang="${l}" href="${site}/${l}${page === 'index' ? '' : `/${page}`}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${site}${page === 'index' ? '/' : `/${page}`}">`;
  if (/<link rel="canonical"/.test(html)) html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">${alt}`);
  else html = html.replace('</head>', `<link rel="canonical" href="${url}">${alt}</head>`);
  // Attributs visibles
  html = html.replace(/\b(placeholder|aria-label|title|alt)="([^"]*)"/g, (m, a, v) => { const r = T(v); return r ? `${a}="${escAttr(r)}"` : m; });
  // Liens internes
  html = html.replace(/\bhref="(\/[^"]*)"/g, (m, h) => `href="${localize(h, lang)}"`);
  // Texte
  html = html.replace(/>([^<>]+)</g, (m, t) => { const r = T(t); return r ? `>${r}<` : m; });
  return html.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
}

// Page racine « / » : choisit la langue (cookie → pays du visiteur) puis redirige vers /es/ ou /ht/. Liens visibles pour les robots.
function rootRedirect(site) {
  const alts = Object.keys(LANGS).map((l) => `<link rel="alternate" hreflang="${l}" href="${site}/${l}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${site}/">`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>JLODNA Plas</title>
<meta name="description" content="JLODNA Plas — Español · Kreyòl Ayisyen"><link rel="canonical" href="${site}/">${alts}<meta name="theme-color" content="#000000">
<link rel="icon" href="/assets/icons/favicon.ico" sizes="48x48"><link rel="stylesheet" href="/css/style.css"></head>
<body><main style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px"><div><img src="/assets/logo/logo.webp" alt="JLODNA Plas" width="130" height="83">
<h1 style="font-size:1.4rem;margin:16px 0">JLODNA Plas</h1><p><a class="btn primary" href="/es/">🇩🇴 Español</a> <a class="btn primary" href="/ht/">🇭🇹 Kreyòl Ayisyen</a></p></div></main>
<script>(function(){try{var c=document.cookie.match(/(?:^|; )jl_lang=(es|ht)/),l=c&&c[1]||localStorage.getItem('jl_lang');
function go(x){location.replace('/'+x+'/'+location.search+location.hash)}
if(l==='es'||l==='ht')return go(l);
var ctl=new AbortController();setTimeout(function(){ctl.abort()},2000);
fetch('/api/geo',{signal:ctl.signal}).then(function(r){return r.json()}).then(function(j){
document.cookie='jl_lang='+j.lang+'; path=/; max-age=31536000; SameSite=Lax';document.cookie='jl_country='+j.country+'; path=/; max-age=31536000; SameSite=Lax';
if(!document.cookie.match(/jl_cur=/))document.cookie='jl_cur='+j.currency+'; path=/; max-age=31536000; SameSite=Lax';go(j.lang)}).catch(function(){var n=(navigator.language||'').toLowerCase();go(/^(ht|fr)/.test(n)?'ht':'es')})}catch(e){}})();</script></body></html>`;
}

function buildLocalizedPages({ root, dist, site }) {
  const pages = fs.readdirSync(root).filter((f) => /\.html$/.test(f)).map((f) => f.replace(/\.html$/, '')).filter((p) => p === 'index' || CUSTOMER_PAGES.includes(p));
  for (const lang of Object.keys(LANGS)) {
    const dict = loadLocale(root, lang); fs.mkdirSync(path.join(dist, lang), { recursive: true });
    for (const page of pages) fs.writeFileSync(path.join(dist, lang, `${page}.html`), transform(fs.readFileSync(path.join(root, `${page}.html`), 'utf8'), lang, page, site, dict));
  }
  // Pages historiques (sans préfixe) : redirigées côté client vers la version localisée ; non indexées (le référencement va aux URLs /es et /ht).
  for (const page of pages) {
    if (page === 'index') continue;
    const f = path.join(dist, `${page}.html`); let h = fs.readFileSync(f, 'utf8');
    if (!/name="robots"/.test(h)) h = h.replace('</title>', '</title>\n<meta name="robots" content="noindex,follow">');
    fs.writeFileSync(f, h);
  }
  fs.writeFileSync(path.join(dist, 'index.html'), rootRedirect(site));
  console.log(`[build] pages localisées : ${pages.length} × ${Object.keys(LANGS).length} (${Object.keys(LANGS).join(', ')})`);
}
module.exports = { buildLocalizedPages, transform, loadLocale, makeTranslator, localize, CUSTOMER_PAGES, LANGS };
