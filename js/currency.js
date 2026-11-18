// Multi-devise. Les prix sont stockés en devise de BASE (HTG) ; l'affichage et la commande utilisent la devise choisie.
// Taux = unités de la devise pour 1 HTG (ex. DOP : 0.46). Modifiable dans l'admin (Réglages → Devises et livraison),
// table settings, clé « currencies ». Ajouter une devise = ajouter une entrée ici (ou dans les réglages) : aucune autre modification.
import { sb } from './supabase.js';
import { LANGS, getLang, readPref, writePref, I18N_ACTIVE } from './i18n.js';

export const BASE = 'HTG';
export const DEFAULT_CONFIG = {
  HTG: { symbol: 'G', name: 'Gourde haïtienne', rate: 1, decimals: 2, locale: 'fr-FR', enabled: true },
  DOP: { symbol: 'RD$', name: 'Peso dominicano', rate: 0.46, decimals: 2, locale: 'es-DO', enabled: true },
};
const CACHE = 'jl_fx_v1'; const TTL = 10 * 60 * 1000;
let CFG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

function merge(remote) {
  if (!remote || typeof remote !== 'object') return;
  for (const [code, c] of Object.entries(remote)) {
    if (!/^[A-Z]{3}$/.test(code) || !c || !(Number(c.rate) > 0)) continue;
    CFG[code] = { ...(CFG[code] || { symbol: code, name: code, decimals: 2, locale: 'es-DO', enabled: true }), ...c, rate: code === BASE ? 1 : Number(c.rate) };
  }
}
async function loadRates() {
  try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && Date.now() - c.t < TTL) { merge(c.v); return; } } catch { /* ignoré */ }
  if (!sb) return;
  try {
    const q = sb.from('settings').select('value').eq('key', 'currencies').maybeSingle();
    const r = await Promise.race([q, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    if (r?.data?.value) { merge(r.data.value); try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), v: r.data.value })); } catch { /* ignoré */ } }
  } catch { /* taux par défaut */ }
}
await loadRates();

export const currencyCodes = () => Object.keys(CFG).filter((c) => CFG[c].enabled !== false);
export const currencyInfo = (code) => CFG[code] || CFG[BASE];
export const getRate = (code) => (CFG[code]?.rate > 0 ? CFG[code].rate : 1);
export function getCurrency() {
  if (!I18N_ACTIVE) return BASE; // admin, BIO : montants toujours en devise de base
  const c = readPref('jl_cur');
  return c && CFG[c] && CFG[c].enabled !== false ? c : LANGS[getLang()].currency;
}
export const setCurrencyLocal = (code) => { if (CFG[code]) writePref('jl_cur', code); };

const round = (n, d) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
// Montant en devise de base → montant dans la devise choisie (même arrondi que create_order côté serveur).
export const convert = (baseAmount, code = getCurrency()) => round(Number(baseAmount || 0) * getRate(code), currencyInfo(code).decimals);
// Montant saisi dans la devise choisie → devise de base (filtres de prix).
export const toBase = (amount, code = getCurrency()) => round(Number(amount || 0) / getRate(code), 2);

export function fmtMoney(baseAmount, code = getCurrency()) {
  const c = currencyInfo(code); const v = convert(baseAmount, code);
  const n = v.toLocaleString(c.locale, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: c.decimals });
  return code === BASE ? `${n} ${c.symbol}` : `${c.symbol} ${n}`;
}
export const currencySymbol = (code = getCurrency()) => currencyInfo(code).symbol;

// Montant d'une commande déjà passée : on utilise le taux ENREGISTRÉ au moment de la commande (jamais le taux du jour).
export function fmtStored(baseAmount, code = BASE, rate = 1) {
  const c = currencyInfo(code); const r = Number(rate) > 0 ? Number(rate) : 1;
  const v = round(Number(baseAmount || 0) * r, c.decimals);
  const n = v.toLocaleString(c.locale, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: c.decimals });
  return code === BASE ? `${n} ${c.symbol}` : `${c.symbol} ${n}`;
}
