// Formulaire d'adresse intelligent : les champs et les validations changent selon le pays (DO / HT).
// Utilisé par le checkout et par « Mon compte → Adresses ». Les valeurs département/ville/adresse restent compatibles
// avec les anciennes commandes (department = Province ou Département, city = Municipio ou Commune, address = rue complète).
import { t, getCountry } from './i18n.js';

export const COUNTRIES = {
  DO: { flag: '🇩🇴', label: 'République dominicaine', dial: '+1', phoneHint: '809-555-1234' },
  HT: { flag: '🇭🇹', label: 'Haïti', dial: '+509', phoneHint: '3412-3456' },
};
export const PROVINCES_DO = ['Distrito Nacional', 'Santo Domingo', 'Santiago', 'La Altagracia', 'La Romana', 'San Pedro de Macorís', 'Puerto Plata', 'La Vega', 'San Cristóbal', 'Duarte', 'Espaillat', 'Monseñor Nouel', 'Peravia', 'Azua', 'Barahona', 'Bahoruco', 'Dajabón', 'El Seibo', 'Elías Piña', 'Hato Mayor', 'Hermanas Mirabal', 'Independencia', 'Magdalena', 'María Trinidad Sánchez', 'Monte Cristi', 'Monte Plata', 'Pedernales', 'Samaná', 'San José de Ocoa', 'San Juan', 'Sánchez Ramírez', 'Santiago Rodríguez', 'Valverde'].sort((a, b) => a.localeCompare(b, 'es'));
export const DEPARTMENTS_HT = ['Ouest', 'Nord', 'Nord-Est', 'Nord-Ouest', 'Artibonite', 'Centre', 'Grand’Anse', 'Nippes', 'Sud', 'Sud-Est'];

const digits = (v) => String(v || '').replace(/\D/g, '');
// Téléphone dominicain : 10 chiffres, indicatifs 809 / 829 / 849 (préfixe +1 accepté).
export function normalizePhone(country, v) {
  let d = digits(v);
  if (country === 'DO') { if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return /^(809|829|849)\d{7}$/.test(d) ? d : null; }
  if (country === 'HT') { if (d.length === 11 && d.startsWith('509')) d = d.slice(3); return /^[2-5]\d{7}$/.test(d) ? d : null; }
  return null;
}
export const formatPhone = (country, v) => { const d = normalizePhone(country, v); if (!d) return v; return country === 'DO' ? `${COUNTRIES.DO.dial} ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${COUNTRIES.HT.dial} ${d.slice(0, 4)}-${d.slice(4)}`; };
export const isPostalDO = (v) => !v || /^\d{5}$/.test(String(v).trim());

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const input = (id, name, label, val, extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" value="${esc(val)}" ${extra}></div>`;
const select = (id, name, label, opts, val) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}" required><option value="">Choisir…</option>${opts.map((o) => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;

export const countryOptionsHtml = (sel) => Object.entries(COUNTRIES).map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${c.flag} ${t(c.label)}</option>`).join('');
export const defaultCountry = () => (COUNTRIES[getCountry()] ? getCountry() : 'DO');

// Champs d'adresse selon le pays. v = valeurs existantes (préremplissage).
export function addressFieldsHtml(country, v = {}) {
  if (country === 'DO') {
    return select('f_department', 'department', 'Province', PROVINCES_DO, v.department)
      + `<div class="two">${input('f_city', 'city', 'Municipio', v.city, 'required autocomplete="address-level2" maxlength="100"')}${input('f_sector', 'sector', 'Secteur', v.sector, 'required maxlength="100"')}</div>`
      + `<div class="two">${input('f_address', 'address', 'Rue', v.address, 'required autocomplete="address-line1" maxlength="200"')}${input('f_street_number', 'street_number', 'Numéro', v.street_number, 'required maxlength="20"')}</div>`
      + input('f_postal_code', 'postal_code', 'Code postal', v.postal_code, 'inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="postal-code"');
  }
  return select('f_department', 'department', 'Département', DEPARTMENTS_HT, v.department)
    + `<div class="two">${input('f_city', 'city', 'Commune', v.city, 'required autocomplete="address-level2" maxlength="100"')}${input('f_sector', 'sector', 'Section communale (si nécessaire)', v.sector, 'maxlength="100"')}</div>`
    + input('f_address', 'address', 'Rue', v.address, 'required autocomplete="address-line1" maxlength="300"');
}

// Validation côté client (le serveur — create_order — revalide tout). Retourne un message traduit ou null.
export function validateAddress(country, d) {
  if (!COUNTRIES[country]) return t('Livraison non disponible vers ce pays.');
  const L = (s, n) => String(s || '').trim().length >= n;
  if (!L(d.department, 2) || !L(d.city, 2) || !L(d.address, 2)) return t('Veuillez remplir correctement tous les champs obligatoires.');
  if (country === 'DO') {
    if (!L(d.sector, 2) || !L(d.street_number, 1)) return t('Veuillez remplir correctement tous les champs obligatoires.');
    if (!isPostalDO(d.postal_code)) return t('Code postal invalide (5 chiffres).');
  }
  if (!normalizePhone(country, d.phone)) return country === 'DO' ? t('Numéro de téléphone dominicain invalide (ex. 809-555-1234).') : t('Numéro de téléphone haïtien invalide (ex. 3412-3456).');
  return null;
}
// Chaîne d'adresse lisible (emails, factures, listes)
export const addressLine = (a) => [a.address, a.street_number && `#${a.street_number}`, a.sector, a.city, a.department].filter(Boolean).join(', ');
