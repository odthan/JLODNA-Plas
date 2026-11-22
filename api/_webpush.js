'use strict';
// Web Push (navigateurs / PWA) — sans dépendance : VAPID (RFC 8292) + chiffrement aes128gcm (RFC 8291) avec le module crypto de Node.
// Variables Vercel : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (base64url), VAPID_SUBJECT (ex. mailto:contact@jlodna.com).
const crypto = require('crypto');
const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const keys = () => {
  const pub = process.env.VAPID_PUBLIC_KEY || '', priv = process.env.VAPID_PRIVATE_KEY || '';
  if (!pub || !priv) return null;
  const p = fromB64u(pub), d = fromB64u(priv);
  return p.length === 65 && p[0] === 4 && d.length === 32 ? { pub, p, d, subject: process.env.VAPID_SUBJECT || 'mailto:contact@jlodna.com' } : null;
};
const privateKey = (k) => crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(k.d), x: b64u(k.p.subarray(1, 33)), y: b64u(k.p.subarray(33, 65)) } });

function vapidHeader(endpoint, k) {
  const aud = new URL(endpoint).origin;
  const unsigned = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: k.subject }))}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey(k), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${k.pub}`;
}

// Chiffre `payload` pour l'abonnement { p256dh, auth } (base64url). Un seul enregistrement (messages < 4 Ko).
function encrypt(payload, p256dh, auth) {
  const ua = fromB64u(p256dh), authSecret = fromB64u(auth);
  if (ua.length !== 65 || authSecret.length < 16) throw new Error('BAD_SUBSCRIPTION');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

const safeLink = (l) => (typeof l === 'string' && l.startsWith('/') && !l.startsWith('//') && l.length <= 200 ? l : '/');
// Retourne 'ok' | 'invalid' (abonnement à supprimer) | 'error'.
async function sendWebPush(sub, { title, body, link, tag }) {
  const k = keys(); if (!k) throw new Error('WEBPUSH_NOT_CONFIGURED');
  let u; try { u = new URL(sub.endpoint); } catch { return 'invalid'; }
  if (u.protocol !== 'https:') return 'invalid';
  const msg = JSON.stringify({ title: String(title || 'JLODNA Plas').slice(0, 100), body: String(body || '').slice(0, 200), link: safeLink(link), tag: tag ? String(tag).slice(0, 64) : undefined });
  let data; try { data = encrypt(msg, sub.p256dh, sub.auth); } catch { return 'invalid'; }
  try {
    const r = await fetch(sub.endpoint, { method: 'POST', signal: AbortSignal.timeout(10000), body: data,
      headers: { Authorization: vapidHeader(sub.endpoint, k), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' } });
    if (r.status === 201 || r.status === 200 || r.status === 202) return 'ok';
    return r.status === 404 || r.status === 410 ? 'invalid' : 'error';
  } catch { return 'error'; }
}
module.exports = { sendWebPush, configured: () => !!keys(), publicKey: () => (keys() ? keys().pub : ''), encrypt, vapidHeader };
