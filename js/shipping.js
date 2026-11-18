// Livraison par pays. Réglages : settings « shipping_zones » (modifiables dans l'admin), montants en devise de base (HTG).
// { HT: { enabled, default_fee, free_over, regions: { Ouest: 300 } }, DO: { … regions: { 'Santo Domingo': 250 } } }
// Repli : l'ancien réglage « shipping » ({ flat_fee, free_over }) reste valable pour Haïti.
export async function loadShipping(sb) {
  const { data } = await sb.from('settings').select('key, value').in('key', ['shipping', 'shipping_zones']);
  const m = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return { zones: m.shipping_zones || null, legacy: m.shipping || { flat_fee: 0 } };
}
// Retourne les frais en devise de base, ou null si la livraison est indisponible pour ce pays.
export function shippingFee({ zones, legacy }, country, region, subtotal) {
  const z = zones?.[country];
  if (z && z.enabled === false) return null;
  if (!z && country !== 'HT' && zones) return null;
  const cfg = z || { default_fee: legacy?.flat_fee || 0, free_over: legacy?.free_over };
  const fee = Number(cfg.regions?.[region] ?? cfg.default_fee ?? 0) || 0;
  const fo = Number(cfg.free_over);
  return fo > 0 && subtotal >= fo ? 0 : fee;
}
