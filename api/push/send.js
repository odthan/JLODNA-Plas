'use strict';
const L = require('../_pay/lib'); const P = require('../_push'); const W = require('../_webpush');
// Notifications trop fréquentes pour une alerte sur l'écran du téléphone : elles restent visibles dans la cloche du site.
const NO_PUSH = new Set(['new_review', 'new_customer']);
// POST /api/push/send — reçoit le « Database Webhook » Supabase (INSERT sur la table notifications) et envoie la notification push
// aux appareils de l'utilisateur concerné. Protégé par le secret PUSH_WEBHOOK_SECRET (en-tête x-webhook-secret).
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return L.send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const secret = L.env('PUSH_WEBHOOK_SECRET');
    if (!secret || !L.safeEq(String(req.headers['x-webhook-secret'] || ''), secret)) return L.send(res, 401, { error: 'UNAUTHORIZED' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const rec = b.record; if (b.type !== 'INSERT' || b.table !== 'notifications' || !rec || !/^[0-9a-f-]{36}$/i.test(rec.user_id || '')) return L.send(res, 200, { ignored: true });
    if (NO_PUSH.has(rec.type)) return L.send(res, 200, { skipped: 'NOT_IMPORTANT' });
    if (!P.configured() && !W.configured()) return L.send(res, 200, { skipped: 'PUSH_NOT_CONFIGURED' }); // 200 : le webhook ne doit pas réessayer
    let sent = 0;
    if (P.configured()) { // application Android (FCM)
      const rows = await L.sbFetch(`device_tokens?select=token&user_id=eq.${rec.user_id}&limit=10`);
      for (const { token } of rows || []) {
        const out = await P.sendPush(token, { title: rec.title, body: rec.body, link: rec.link });
        if (out === 'ok') sent++; else if (out === 'invalid') await L.sbFetch(`device_tokens?token=eq.${encodeURIComponent(token)}`, { method: 'DELETE' });
      }
    }
    if (W.configured()) { // navigateurs et site installé (Web Push)
      const subs = await L.sbFetch(`web_push_subscriptions?select=endpoint,p256dh,auth&user_id=eq.${rec.user_id}&limit=10`);
      for (const sub of subs || []) {
        const out = await W.sendWebPush(sub, { title: rec.title, body: rec.body, link: rec.link, tag: rec.id });
        if (out === 'ok') sent++; else if (out === 'invalid') await L.sbFetch(`web_push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
      }
    }
    return L.send(res, 200, { sent });
  } catch (e) {
    if (e instanceof L.PayError) return L.send(res, e.status, { error: e.code });
    console.error('push/send', e && e.message); return L.send(res, 500, { error: 'SERVER_ERROR' });
  }
};
