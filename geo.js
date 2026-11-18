// Détection du pays du visiteur (en-tête fourni par Vercel : aucun service externe, aucune donnée stockée).
module.exports = (req, res) => {
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2);
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  let lang;
  if (country === 'HT') lang = 'ht'; else if (country === 'DO') lang = 'es';
  else lang = /^(ht|fr)/.test(al) ? 'ht' : 'es';
  const out = { country: country === 'HT' || country === 'DO' ? country : (lang === 'ht' ? 'HT' : 'DO'), detected: country || null, lang, currency: lang === 'ht' ? 'HTG' : 'DOP' };
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'x-vercel-ip-country, accept-language');
  res.status(200).json(out);
};
