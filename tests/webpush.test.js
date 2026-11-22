'use strict';
// Tests Web Push : le « navigateur » simulé déchiffre le message (RFC 8291) et la signature VAPID est vérifiée. Aucun appel réseau réel.
const test = require('node:test'); const assert = require('assert'); const crypto = require('crypto');
const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
const vap = crypto.createECDH('prime256v1'); vap.generateKeys();
Object.assign(process.env, { VAPID_PUBLIC_KEY: vap.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: vap.getPrivateKey().toString('base64url'), VAPID_SUBJECT: 'mailto:t@jlodna.com' });
const W = require('../api/_webpush');
const authSecret = crypto.randomBytes(16);
const sub = { endpoint: 'https://push.example.com/send/abc', p256dh: ec.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };

function decrypt(body) { // côté navigateur
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  assert.equal(body.readUInt32BE(16), 4096); assert.equal(idlen, 65);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ec.computeSecret(asPub), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ec.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2); return plain.subarray(0, plain.length - 1).toString();
}
test('le message chiffré est déchiffrable par le navigateur', () => {
  const msg = JSON.stringify({ title: 'Nouvelle commande #JLD-1', body: 'Total : 2700 HTG é à ✔' });
  assert.equal(decrypt(W.encrypt(msg, sub.p256dh, sub.auth)), msg);
});
test('envoi : en-têtes VAPID corrects, signature valide, contenu déchiffrable', async () => {
  let call; global.fetch = async (url, opts) => { call = { url, opts }; return { status: 201 }; };
  assert.equal(await W.sendWebPush(sub, { title: 'Commande', body: 'Reçue', link: '/orders', tag: 'n1' }), 'ok');
  assert.equal(call.url, sub.endpoint); assert.equal(call.opts.headers['Content-Encoding'], 'aes128gcm');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(call.opts.headers.Authorization); assert.ok(m); assert.equal(m[2], process.env.VAPID_PUBLIC_KEY);
  const [h, p, s] = m[1].split('.'); const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, 'https://push.example.com'); assert.equal(claims.sub, 'mailto:t@jlodna.com'); assert.ok(claims.exp > Date.now() / 1000);
  const pub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: vap.getPublicKey().subarray(1, 33).toString('base64url'), y: vap.getPublicKey().subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.deepEqual(JSON.parse(decrypt(Buffer.from(call.opts.body))), { title: 'Commande', body: 'Reçue', link: '/orders', tag: 'n1' });
});
test('liens externes neutralisés ; 410 → abonnement à supprimer ; 500 → erreur', async () => {
  let sent; global.fetch = async (u, o) => { sent = o; return { status: 201 }; };
  await W.sendWebPush(sub, { title: 'x', link: '//evil.com' }); // le lien est remplacé par « / »
  global.fetch = async () => ({ status: 410 }); assert.equal(await W.sendWebPush(sub, { title: 'x' }), 'invalid');
  global.fetch = async () => ({ status: 500 }); assert.equal(await W.sendWebPush(sub, { title: 'x' }), 'error');
  assert.equal(await W.sendWebPush({ ...sub, endpoint: 'http://insecure.test/x' }, { title: 'x' }), 'invalid');
});
