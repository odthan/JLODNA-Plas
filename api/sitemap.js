const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL; const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SITE = process.env.VITE_SITE_URL || 'https://www.jlodna.com';
const LANGS = ['es', 'ht'];
// Chaque page existe en /es et /ht : une entrée par langue, avec ses alternatives hreflang (SEO international).
const alt = (path) => LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}/${l}${path}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${path || '/'}"/>`;
module.exports = async (req, res) => {
  const pages = ['', '/shop', '/b2b', '/about', '/contact', '/faq', '/terms', '/privacy', '/returns'];
  const entries = pages.flatMap((p) => LANGS.map((l) => `<url><loc>${SITE}/${l}${p}</loc>${alt(p)}</url>`)).concat(['/bio', '/delete-account'].map((p) => `<url><loc>${SITE}${p}</loc></url>`));
  let prods = [];
  try { if (URL_ && ANON) prods = await fetch(`${URL_}/rest/v1/products?select=slug,updated_at&status=eq.published&limit=5000`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then((r) => (r.ok ? r.json() : [])); } catch {}
  const x = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const body = entries.concat(prods.flatMap((p) => { const q = `/product?slug=${encodeURIComponent(p.slug)}`; return LANGS.map((l) => `<url><loc>${SITE}/${l}${q}</loc><lastmod>${x(p.updated_at.slice(0, 10))}</lastmod>${alt(q)}</url>`); }));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body.join('')}</urlset>`);
};
