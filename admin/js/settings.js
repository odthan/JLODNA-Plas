import { sb } from '/js/supabase.js';
import { $, $$, esc, toast, friendlyError, isEmail } from '/js/utils.js';
import { table } from './ui.js';
import { ctx } from './admin.js';
import { DEFAULT_CONFIG } from '/js/currency.js';
import { PROVINCES_DO, DEPARTMENTS_HT } from '/js/address-form.js';
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EDITOR', 'SUPPORT'];
export async function render(el) {
  const { data: rows, error } = await sb.from('settings').select('*').in('key', ['store', 'shipping', 'payment_methods', 'currencies', 'shipping_zones']); if (error) throw error;
  const S = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const pm = S.payment_methods || {};
  const PM_HINT = { card: 'Stripe — clés à ajouter sur Vercel', paypal: 'PayPal — clés à ajouter sur Vercel', moncash: 'Haïti uniquement — clés à ajouter sur Vercel', natcash: 'manuel : le personnel confirme le paiement' };
  // Devises et livraison par pays (montants de livraison en HTG, devise de base)
  const CUR = { ...DEFAULT_CONFIG, ...(S.currencies || {}) };
  const Z = S.shipping_zones || { HT: { enabled: true, default_fee: S.shipping?.flat_fee ?? 0, free_over: S.shipping?.free_over ?? null, regions: {} }, DO: { enabled: true, default_fee: S.shipping?.flat_fee ?? 0, free_over: S.shipping?.free_over ?? null, regions: {} } };
  const regionsTxt = (c) => Object.entries(Z[c]?.regions || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const zoneHtml = (c, label, names) => `<fieldset class="panel-box" style="margin:10px 0"><legend><strong>${label}</strong></legend>
    <label class="chk"><input type="checkbox" id="z-${c}-on" ${Z[c]?.enabled === false ? '' : 'checked'}> Livraison disponible dans ce pays</label>
    <div class="two"><div class="field"><label for="z-${c}-fee">Frais par défaut (HTG)</label><input id="z-${c}-fee" type="number" min="0" step="any" value="${Z[c]?.default_fee ?? 0}"></div>
    <div class="field"><label for="z-${c}-free">Livraison offerte dès (HTG, 0 = jamais)</label><input id="z-${c}-free" type="number" min="0" step="any" value="${Z[c]?.free_over ?? 0}"></div></div>
    <div class="field"><label for="z-${c}-reg">Frais par ${c === 'DO' ? 'province' : 'département'} (HTG) — une ligne « Nom: montant »</label><textarea id="z-${c}-reg" rows="4" placeholder="${names.slice(0, 2).map((n) => n + ': 300').join('\n')}">${esc(regionsTxt(c))}</textarea></div></fieldset>`;
  el.innerHTML = `<h1>Paramètres</h1>
  <form id="sf" class="panel-box" style="max-width:640px"><h2>Boutique</h2>
  <div class="two"><div class="field"><label for="sn">Nom</label><input id="sn" value="${esc(S.store?.name || 'JLODNA Plas')}"></div><div class="field"><label for="sp">Téléphone</label><input id="sp" value="${esc(S.store?.phone || '')}"></div></div>
  <h2>Devises</h2><p class="muted">Devise de base : HTG (les prix des produits sont saisis en HTG). Taux = nombre d’unités de la devise pour 1 HTG. Le taux est enregistré avec chaque commande.</p>
  <div class="two"><div class="field"><label for="fx-dop">Taux DOP (1 HTG = … RD$)</label><input id="fx-dop" type="number" min="0.0001" step="any" value="${CUR.DOP?.rate ?? 0.46}"></div><div class="field"><label>Équivalent</label><input id="fx-eq" disabled></div></div>
  <label class="chk"><input type="checkbox" id="fx-dop-on" ${CUR.DOP?.enabled === false ? '' : 'checked'}> Proposer le peso dominicain (DOP)</label>
  <h2>Livraison par pays</h2>${zoneHtml('HT', '🇭🇹 Haïti', DEPARTMENTS_HT)}${zoneHtml('DO', '🇩🇴 République dominicaine', PROVINCES_DO)}
  <h2>Livraison (ancien réglage, Haïti)</h2><div class="two"><div class="field"><label for="sh">Frais de livraison (G)</label><input id="sh" type="number" min="0" value="${S.shipping?.flat_fee ?? 0}"></div><div class="field"><label for="sf2">Livraison offerte dès (G, 0 = jamais)</label><input id="sf2" type="number" min="0" value="${S.shipping?.free_over ?? 0}"></div></div>
  <h2>Modes de paiement</h2><p class="muted">Cochez les modes proposés aux clients. Carte, PayPal et MonCash ne fonctionnent que si leurs clés sont ajoutées dans Vercel (Settings → Environment Variables) ; sinon le client voit « mode de paiement non disponible ».</p>
  ${Object.entries(pm).map(([k, v]) => `<label class="chk"><input type="checkbox" data-pm="${esc(k)}" ${v.enabled ? 'checked' : ''}> ${esc(v.label)}${PM_HINT[k] ? ` <small class="muted">(${PM_HINT[k]})</small>` : ''}</label>`).join('')}
  <div style="margin-top:14px"><button class="btn primary" id="sb">Enregistrer</button></div></form>
  ${ctx.role === 'SUPER_ADMIN' ? '<div id="team"></div>' : ''}`;
  const eq = () => { const r = +$('#fx-dop').value; $('#fx-eq').value = r > 0 ? `1 RD$ = ${(1 / r).toFixed(2)} G` : ''; }; $('#fx-dop').oninput = eq; eq();
  const parseRegions = (txt) => Object.fromEntries(txt.split('\n').map((l) => l.split(':')).filter((p) => p.length === 2 && p[0].trim() && Number(p[1]) >= 0 && p[1].trim() !== '').map((p) => [p[0].trim(), Number(p[1])]));
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const rate = +$('#fx-dop').value; if (!(rate > 0) || !isFinite(rate)) return toast('Taux DOP invalide.', 'err');
    const zone = (c) => ({ enabled: $(`#z-${c}-on`).checked, default_fee: +$(`#z-${c}-fee`).value || 0, free_over: +$(`#z-${c}-free`).value || null, regions: parseRegions($(`#z-${c}-reg`).value) });
    const zones = { HT: zone('HT'), DO: zone('DO') };
    const next = { store: { ...S.store, name: $('#sn').value.trim() || 'JLODNA Plas', phone: $('#sp').value.trim() }, shipping: { flat_fee: +$('#sh').value || 0, free_over: +$('#sf2').value || null },
      currencies: { ...(S.currencies || {}), HTG: { ...DEFAULT_CONFIG.HTG, ...(S.currencies?.HTG || {}), rate: 1 }, DOP: { ...DEFAULT_CONFIG.DOP, ...(S.currencies?.DOP || {}), rate, enabled: $('#fx-dop-on').checked } }, shipping_zones: zones,
      payment_methods: Object.fromEntries(Object.entries(pm).map(([k, v]) => [k, { ...v, enabled: $(`[data-pm="${k}"]`).checked }])) };
    for (const [key, value] of Object.entries(next)) { const { error } = await sb.from('settings').upsert({ key, value }); if (error) return toast(friendlyError(error), 'err'); }
    try { localStorage.removeItem('jl_fx_v1'); } catch { /* ignoré */ }
    toast('Paramètres enregistrés.');
  };
  if (ctx.role === 'SUPER_ADMIN') team(el.querySelector('#team'));
}
async function team(box) {
  const [{ data: roles }, { data: profs }] = await Promise.all([sb.from('admin_roles').select('*'), sb.from('profiles').select('id, email, first_name, last_name')]);
  const P = new Map((profs || []).map((p) => [p.id, p]));
  box.innerHTML = `<div class="panel-box" style="max-width:640px"><h2>Équipe et rôles</h2>${table(['Utilisateur', 'Rôle', ''], (roles || []).map((r) => `<tr><td>${esc(P.get(r.user_id)?.email || r.user_id)}</td><td><select data-role="${r.user_id}" ${r.user_id === ctx.user.id ? 'disabled' : ''}>${ROLES.map((x) => `<option ${x === r.role ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td>${r.user_id === ctx.user.id ? '' : `<button class="btn danger sm" data-rm="${r.user_id}">Retirer</button>`}</td></tr>`))}
  <h3 style="margin-top:16px">Ajouter un membre</h3><p class="muted">La personne doit d’abord avoir créé un compte sur le site.</p><form id="tf" class="row"><input id="te" type="email" placeholder="Email du compte" required aria-label="Email" style="flex:2"><select id="tr" aria-label="Rôle" style="flex:1">${ROLES.filter((r) => r !== 'SUPER_ADMIN').map((x) => `<option>${x}</option>`).join('')}</select><button class="btn primary">Ajouter</button></form></div>`;
  box.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => { const { error } = await sb.from('admin_roles').update({ role: s.value }).eq('user_id', s.dataset.role); toast(error ? friendlyError(error) : 'Rôle mis à jour.', error ? 'err' : 'ok'); }));
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { const { error } = await sb.from('admin_roles').delete().eq('user_id', b.dataset.rm); toast(error ? friendlyError(error) : 'Membre retiré.', error ? 'err' : 'ok'); team(box); }));
  box.querySelector('#tf').onsubmit = async (e) => { e.preventDefault(); const email = box.querySelector('#te').value.trim().toLowerCase(); if (!isEmail(email)) return toast('Email invalide.', 'err'); const { data: p } = await sb.from('profiles').select('id').ilike('email', email).maybeSingle(); if (!p) return toast('Aucun compte trouvé avec cet email.', 'err'); const { error } = await sb.from('admin_roles').upsert({ user_id: p.id, role: box.querySelector('#tr').value }); toast(error ? friendlyError(error) : 'Membre ajouté.', error ? 'err' : 'ok'); team(box); };
}
