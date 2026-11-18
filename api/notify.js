// Fonction serverless Vercel : emails transactionnels via Resend. Aucune clé n'est exposée au navigateur.
// Variables : RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Emails client dans la langue de la commande (es / ht) et dans la devise de la commande, avec le taux enregistré à ce moment-là.
const TXT = {
  es: { status: { new: 'Nueva', confirmed: 'Confirmada', preparing: 'En preparación', shipped: 'Enviada', out_for_delivery: 'En camino', delivered: 'Entregada', cancelled: 'Cancelada' },
    subjCreated: (n) => `Confirmación de tu pedido ${n}`, titleCreated: 'Tu pedido ha sido registrado', order: 'Pedido', total: 'Total', delivery: 'Entrega en', subjStatus: (n, st) => `Pedido ${n}: ${st}`, titleStatus: (st) => `Estado de tu pedido: ${st}`, footer: 'Gracias por comprar en JLODNA Plas.', locale: 'es-DO' },
  ht: { status: { new: 'Nouvo', confirmed: 'Konfime', preparing: 'An preparasyon', shipped: 'Voye', out_for_delivery: 'Ap livre', delivered: 'Livre', cancelled: 'Anile' },
    subjCreated: (n) => `Konfimasyon kòmand ou ${n}`, titleCreated: 'Kòmand ou anrejistre', order: 'Kòmand', total: 'Total', delivery: 'Livrezon nan', subjStatus: (n, st) => `Kòmand ${n} : ${st}`, titleStatus: (st) => `Estati kòmand ou : ${st}`, footer: 'Mèsi paske ou achte nan JLODNA Plas.', locale: 'fr-HT' },
};
const SYMBOL = { HTG: 'G', DOP: 'RD$' };
const money = (amount, o) => { const cur = o.currency || 'HTG'; const r = Number(o.exchange_rate) > 0 ? Number(o.exchange_rate) : 1; const v = Math.round(Number(amount) * r * 100) / 100; const n = v.toLocaleString(TXT[o.language]?.locale || 'fr-FR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); return cur === 'HTG' ? `${n} G` : `${SYMBOL[cur] || cur} ${n}`; };
const addr = (o) => [o.address, o.street_number && `#${o.street_number}`, o.sector, o.city, o.department].filter(Boolean).join(', ');
const STATUS = { new: 'Nouvelle', confirmed: 'Confirmée', preparing: 'En préparation', shipped: 'Expédiée', out_for_delivery: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };
const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL; const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

async function rest(path, token) { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }); return r.ok ? r.json() : null; }
async function send(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return false;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM || 'JLODNA Plas <onboarding@resend.dev>', to, subject, html }) });
  return r.ok;
}
const wrap = (title, body) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2 style="color:#000;border-bottom:4px solid #FF7A1A;padding-bottom:8px">JLODNA Plas</h2><h3>${esc(title)}</h3>${body}<p style="color:#777;font-size:12px">JLODNA Plas — Magazin global en Haïti · www.jlodna.com</p></div>`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token || !URL_ || !ANON) return res.status(401).json({ error: 'auth' });
  try {
    const { event, order_id } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(order_id || '')) return res.status(400).json({ error: 'order' });
    const me = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null));
    if (!me?.id) return res.status(401).json({ error: 'auth' });
    const [order] = (await rest(`orders?id=eq.${order_id}&select=*,order_items(name,quantity,unit_price)`, token)) || []; // RLS : propriétaire ou admin uniquement
    if (!order) return res.status(404).json({ error: 'not_found' });
    const items = order.order_items.map((i) => `<li>${esc(i.name)} × ${i.quantity} — ${money(i.unit_price * i.quantity, order)}</li>`).join('');
    const X = TXT[order.language]; // undefined = français (anciennes commandes, copie admin)
    const summary = `<p>${X ? X.order : 'Commande'} <strong>${esc(order.order_number)}</strong></p><ul>${items}</ul><p><strong>${X ? X.total : 'Total'} : ${money(order.total, order)}</strong></p>`;
    if (event === 'order_created') {
      if (order.user_id !== me.id || Date.now() - new Date(order.created_at).getTime() > 10 * 60 * 1000) return res.status(403).json({ error: 'forbidden' });
      await send(order.email, X ? X.subjCreated(order.order_number) : `Confirmation de votre commande ${order.order_number}`, wrap(X ? X.titleCreated : 'Votre commande a été enregistrée', summary + `<p>${X ? X.delivery : 'Livraison à'} : ${esc(addr(order))}.</p>`));
      if (process.env.ADMIN_EMAIL) await send(process.env.ADMIN_EMAIL, `Nouvelle commande ${order.order_number} (${order.country || 'HT'} · ${order.currency || 'HTG'})`, wrap('Nouvelle commande', `<p>Commande <strong>${esc(order.order_number)}</strong></p><ul>${items}</ul><p><strong>Total : ${money(order.total, order)}</strong> (${Number(order.total).toLocaleString('fr-FR')} G)</p><p>${esc(order.full_name)} · ${esc(order.phone)}</p><p>${esc(addr(order))} — ${order.country || 'HT'}</p>`));
    } else if (event === 'order_status') {
      const role = await rest(`admin_roles?user_id=eq.${me.id}&select=role`, token);
      if (!role?.length) return res.status(403).json({ error: 'forbidden' });
      const st = (X ? X.status : STATUS)[order.status];
      await send(order.email, X ? X.subjStatus(order.order_number, st) : `Commande ${order.order_number} : ${st}`, wrap(X ? X.titleStatus(st) : `Statut de votre commande : ${st}`, summary));
    } else return res.status(400).json({ error: 'event' });
    return res.status(200).json({ ok: true, email: !!process.env.RESEND_API_KEY });
  } catch (e) { console.error('notify error', e.message); return res.status(500).json({ error: 'server' }); }
};
