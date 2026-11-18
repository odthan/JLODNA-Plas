import { initLayout } from '../layout.js';
import { sb } from '../supabase.js';
import { requireUser, getSession } from '../auth.js';
import { getCart, clearCart } from '../cart.js';
import { getCartLines } from '../products.js';
import { isDefaultVariant } from '../variants.js';
import { $, esc, fmtPrice, fmtDate, isEmail, setLoading, friendlyError, postJSON, STATUS } from '../utils.js';
import { ONLINE, startPayment } from '../pay.js';
import { getLang, localizePath, writePref } from '../i18n.js';
import { getCurrency, getRate, fmtStored, currencyInfo } from '../currency.js';
import { loadShipping, shippingFee } from '../shipping.js';
import { COUNTRIES, countryOptionsHtml, defaultCountry, addressFieldsHtml, validateAddress, normalizePhone, addressLine } from '../address-form.js';

initLayout();
let user; let totals = { subtotal: 0, fee: 0, discount: 0, total: 0 };
const coupon = sessionStorage.getItem('jl_coupon') || null;
// Moyens de paiement disponibles par pays : MonCash n'existe qu'en Haïti.
const METHOD_COUNTRIES = { moncash: ['HT'] };

(async () => {
  if (!sb) return;
  user = await requireUser(); if (!user) return;
  const cart = getCart();
  if (!cart.length) { $('#co-root').innerHTML = `<div class="empty"><span class="dot"></span><p>Votre panier est vide.</p><a class="btn primary" href="${localizePath('/shop')}">Continuer les achats</a></div>`; return; }
  const [L, ship, pm, prof, addr] = await Promise.all([
    getCartLines(cart), loadShipping(sb),
    sb.from('settings').select('value').eq('key', 'payment_methods').maybeSingle(),
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('addresses').select('*').eq('is_default', true).maybeSingle(),
  ]);
  let subtotal = 0; let lines = ''; let blocked = false;
  for (const l of L) {
    const nm = l.ok ? `${esc(l.p.name)}${isDefaultVariant(l.v) ? '' : ` (${esc(l.v.name)})`}` : 'Produit';
    if (!l.ok || l.available < l.item.quantity) { blocked = true; lines += `<div class="line"><span>${nm} × ${l.item.quantity}</span><span class="stock out">Indisponible</span></div>`; continue; }
    subtotal += l.price * l.item.quantity; lines += `<div class="line"><span>${nm} × ${l.item.quantity}</span><span>${fmtPrice(l.price * l.item.quantity)}</span></div>`;
  }
  let discount = 0; if (coupon) { const { data } = await sb.rpc('validate_coupon', { p_code: coupon, p_subtotal: subtotal }); if (data?.valid) discount = data.discount; }
  const allMethods = Object.entries(pm.data?.value || {}).filter(([, v]) => v.enabled);
  const f = $('#co-form'); const A = addr.data || {};
  let country = COUNTRIES[A.country] ? A.country : defaultCountry();
  let unavailable = false;

  const methodsFor = (c) => allMethods.filter(([k]) => !METHOD_COUNTRIES[k] || METHOD_COUNTRIES[k].includes(c));
  function renderMethods() {
    const prev = f.querySelector('input[name=pay]:checked')?.value; const ms = methodsFor(country);
    $('#pay').innerHTML = ms.length ? ms.map(([k, v], i) => `<label style="display:flex;gap:10px;align-items:center;font-weight:400"><input type="radio" name="pay" value="${esc(k)}" style="width:auto;min-height:0" ${(prev ? prev === k : i === 0) ? 'checked' : ''}> ${esc(v.label)}</label>`).join('') : '<p class="err-msg">Aucun mode de paiement disponible.</p>';
  }
  function renderSummary() {
    const dep = f.department?.value || '';
    const raw = shippingFee(ship, country, dep, subtotal); unavailable = raw === null; const fee = raw || 0;
    totals = { subtotal, fee, discount, total: Math.max(subtotal + fee - discount, 0) };
    const cur = getCurrency();
    $('#co-sum').innerHTML = `<h2 style="font-size:1.2rem">Résumé</h2>${lines}<div class="line"><span>Sous-total</span><span>${fmtPrice(subtotal)}</span></div><div class="line"><span>Livraison</span><span>${unavailable ? 'Non disponible' : fee ? fmtPrice(fee) : 'Offerte'}</span></div>${discount ? `<div class="line"><span>Réduction</span><span>− ${fmtPrice(discount)}</span></div>` : ''}<div class="line total"><span>Total</span><span>${fmtPrice(totals.total)}</span></div>${cur !== 'HTG' && ONLINE.length ? '<p class="addr-hint">Les paiements en ligne par carte ou PayPal sont encaissés en dollars américains (USD).</p>' : ''}`;
    $('#co-btn').disabled = blocked || unavailable;
    if (unavailable) $('#co-err').textContent = 'Livraison non disponible vers ce pays.'; else if (!blocked) $('#co-err').textContent = '';
  }
  function renderAddress(values = {}) {
    $('#addr-box').innerHTML = addressFieldsHtml(country, values);
    f.phone.placeholder = COUNTRIES[country].phoneHint; f.phone.setAttribute('aria-label', `${COUNTRIES[country].dial}`);
    f.department?.addEventListener('change', renderSummary);
    renderMethods(); renderSummary();
  }
  $('#country').innerHTML = countryOptionsHtml(country);
  $('#country').onchange = (e) => { country = e.target.value; writePref('jl_country', country); renderAddress(); };

  f.full_name.value = A.full_name || [prof.data?.first_name, prof.data?.last_name].filter(Boolean).join(' ');
  f.phone.value = A.phone || prof.data?.phone || ''; f.email.value = user.email || '';
  renderAddress(A.country === country ? A : {});
  if (blocked) { $('#co-err').textContent = 'Certains produits ne sont plus disponibles. Modifiez votre panier.'; $('#co-btn').disabled = true; }

  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const err = $('#co-err'); err.textContent = '';
    const d = Object.fromEntries(new FormData(f)); const method = d.pay; delete d.pay;
    if (d.full_name.trim().length < 2 || !isEmail(d.email)) { err.textContent = friendlyError('INVALID_SHIPPING'); return; }
    const msg = validateAddress(country, d); if (msg) { err.textContent = msg; return; }
    if (!method) { err.textContent = 'Choisissez un mode de paiement.'; return; }
    const cur = getCurrency();
    // Le serveur revalide tout (pays, téléphone, devise, taux, livraison) et recalcule les montants : rien de ce qui suit n'est « cru ».
    const shipping = { ...d, country, phone: normalizePhone(country, d.phone), currency: cur, language: getLang() };
    const btn = $('#co-btn'); setLoading(btn, true, 'Envoi de la commande…');
    const items = getCart().map((i) => ({ variant_id: i.variant_id, quantity: i.quantity }));
    const { data, error } = await sb.rpc('create_order', { p_items: items, p_shipping: shipping, p_coupon: coupon, p_payment_method: method });
    setLoading(btn, false);
    if (error) { err.textContent = friendlyError(error); return; }
    clearCart(); sessionStorage.removeItem('jl_coupon');
    const s = await getSession(); postJSON('/api/notify', { event: 'order_created', order_id: data.id }, s?.access_token).catch(() => {});
    const { data: o } = await sb.from('orders').select('*, order_items(name, variant_name, variant, quantity, unit_price)').eq('id', data.id).maybeSingle();
    const money = (n) => fmtStored(n, o.currency || 'HTG', o.exchange_rate || 1);
    const methods = allMethods;
    $('#co-root').innerHTML = `<div class="form-card" style="max-width:560px"><h2>Votre commande a été enregistrée.</h2>
      <p><strong>Numéro : ${esc(o.order_number)}</strong></p><p>Date : ${fmtDate(o.created_at)}<br>Statut : <span class="status new">${STATUS[o.status]}</span><br>Paiement : ${esc(methods.find(([k]) => k === o.payment_method)?.[1].label || o.payment_method)}<br>Livraison à : ${esc(addressLine(o))}</p>
      <div class="summary">${o.order_items.map((i) => `<div class="line"><span>${esc(i.name)}${i.variant && Object.keys(i.variant).length ? ` (${esc(i.variant_name)})` : ''} × ${i.quantity}</span><span>${money(i.unit_price * i.quantity)}</span></div>`).join('')}<div class="line"><span>Livraison</span><span>${o.shipping_fee ? money(o.shipping_fee) : 'Offerte'}</span></div>${o.discount > 0 ? `<div class="line"><span>Réduction</span><span>− ${money(o.discount)}</span></div>` : ''}<div class="line total"><span>Montant</span><span>${money(o.total)}</span></div></div>
      <div id="pay-box"></div><p style="margin-top:16px" class="row"><a class="btn primary" href="${localizePath('/orders')}">Suivre mes commandes</a><a class="btn ghost" href="${localizePath('/shop')}">Continuer les achats</a></p></div>`;
    window.scrollTo(0, 0);
    const meta = methods.find(([k]) => k === method)?.[1] || {};
    const box = $('#pay-box');
    if (ONLINE.includes(method)) {
      box.innerHTML = '<p class="muted" id="pay-msg">Paiement sécurisé : redirection en cours…</p><button class="btn primary" id="pay-now" type="button">Payer maintenant</button>';
      const go = async () => { const b = $('#pay-now'); setLoading(b, true, 'Redirection…'); try { await startPayment(data.id); } catch (ex) { setLoading(b, false); $('#pay-msg').textContent = ex.message; } };
      $('#pay-now').onclick = go; setTimeout(go, 400);
    } else if (meta.instructions) { box.innerHTML = `<div class="order-card"><strong>Instructions de paiement</strong><p style="white-space:pre-wrap">${esc(meta.instructions)}</p><p class="muted">Indiquez le numéro de commande ${esc(o.order_number)}. Votre commande sera confirmée dès réception du paiement.</p></div>`; }
  });
})();
