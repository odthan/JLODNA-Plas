// Préférences utilisateur : langue, devise, pays. Sauvegarde : cookie + localStorage + compte (si connecté).
import { sb } from './supabase.js';
import { LANGS, getLang, localizePath, stripLang, readPref, writePref } from './i18n.js';
import { currencyCodes, getCurrency, setCurrencyLocal } from './currency.js';

async function saveToProfile(patch) {
  if (!sb) return;
  try { const { data } = await sb.auth.getSession(); const uid = data.session?.user.id; if (uid) await sb.from('profiles').update(patch).eq('id', uid); } catch { /* préférence locale déjà enregistrée */ }
}
export async function setLanguage(lang) {
  if (!LANGS[lang]) return;
  writePref('jl_lang', lang); writePref('jl_country', LANGS[lang].country);
  if (!readPref('jl_cur_manual')) setCurrencyLocal(LANGS[lang].currency); // devise suivie tant que le client ne l'a pas choisie lui-même
  await saveToProfile({ preferred_language: lang, preferred_country: LANGS[lang].country, preferred_currency: getCurrency() });
  location.href = localizePath(stripLang() + location.search + location.hash, lang);
}
export async function setCurrency(code) {
  if (!currencyCodes().includes(code)) return;
  setCurrencyLocal(code); writePref('jl_cur_manual', '1');
  await saveToProfile({ preferred_currency: code });
  location.reload(); // prix, panier, taxes et livraison sont recalculés au rechargement
}
// Connecté : restaure les préférences du compte si le visiteur n'a encore rien choisi sur cet appareil.
export async function restoreFromProfile() {
  if (!sb) return;
  try {
    const { data: s } = await sb.auth.getSession(); const uid = s.session?.user.id; if (!uid) return;
    const { data: p } = await sb.from('profiles').select('preferred_language, preferred_currency, preferred_country').eq('id', uid).maybeSingle();
    if (!p) return;
    if (p.preferred_currency && !readPref('jl_cur')) { setCurrencyLocal(p.preferred_currency); writePref('jl_cur_manual', '1'); }
    if (p.preferred_country && !readPref('jl_country')) writePref('jl_country', p.preferred_country);
    if (p.preferred_language && LANGS[p.preferred_language] && !readPref('jl_lang') && p.preferred_language !== getLang()) await setLanguage(p.preferred_language);
  } catch { /* ignoré */ }
}
