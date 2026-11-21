'use strict';
// GET /api/push/key — clé publique VAPID (publique par nature) pour abonner le navigateur aux notifications.
const W = require('../_webpush');
module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const key = W.publicKey();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return key ? res.status(200).json({ key }) : res.status(404).json({ error: 'WEBPUSH_NOT_CONFIGURED' });
};
