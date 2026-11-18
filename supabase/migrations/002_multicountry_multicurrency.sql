-- Migration 002 — Multi-pays (Haïti / République dominicaine), multi-devise (HTG / DOP), multi-langue (ht / es).
-- À exécuter UNE FOIS, après schema.sql → functions.sql → triggers.sql → policies.sql (base neuve ou existante).
-- Sans risque : uniquement des ajouts (colonnes avec valeurs par défaut, réglages, remplacement de create_order). Aucune donnée supprimée.
-- Les anciennes commandes restent valides : country = 'HT', currency = 'HTG', exchange_rate = 1, language = 'ht'.

-- 1) Commandes : pays, langue, taux enregistré, montant affiché, détails d'adresse
alter table public.orders
  add column if not exists country text not null default 'HT',
  add column if not exists language text not null default 'ht',
  add column if not exists exchange_rate numeric(18,8) not null default 1,
  add column if not exists total_display numeric(14,2),
  add column if not exists sector text, add column if not exists street_number text, add column if not exists postal_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_country_chk') then alter table public.orders add constraint orders_country_chk check (country in ('HT','DO')); end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_language_chk') then alter table public.orders add constraint orders_language_chk check (language in ('es','ht')); end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_rate_chk') then alter table public.orders add constraint orders_rate_chk check (exchange_rate > 0); end if;
end $$;
update public.orders set total_display = total where total_display is null;   -- anciennes commandes : devise de base

-- 2) Adresses enregistrées
alter table public.addresses
  add column if not exists country text not null default 'HT',
  add column if not exists sector text, add column if not exists street_number text, add column if not exists postal_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'addresses_country_chk') then alter table public.addresses add constraint addresses_country_chk check (country in ('HT','DO')); end if;
end $$;

-- 3) Préférences du compte (langue, devise, pays)
alter table public.profiles
  add column if not exists preferred_language text, add column if not exists preferred_currency text, add column if not exists preferred_country text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pref_lang_chk') then alter table public.profiles add constraint profiles_pref_lang_chk check (preferred_language is null or preferred_language in ('es','ht')); end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_pref_cur_chk') then alter table public.profiles add constraint profiles_pref_cur_chk check (preferred_currency is null or preferred_currency ~ '^[A-Z]{3}$'); end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_pref_country_chk') then alter table public.profiles add constraint profiles_pref_country_chk check (preferred_country is null or preferred_country in ('HT','DO')); end if;
end $$;
grant update (first_name, last_name, phone, preferred_language, preferred_currency, preferred_country) on public.profiles to authenticated;

-- 4) Réglages publics : devises et zones de livraison (lisibles par les visiteurs ; modifiables par les admins « settings.write »)
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to anon, authenticated
  using (key in ('store','shipping','payment_methods','currencies','shipping_zones') or public.has_perm('settings.write'));

-- Taux : unités de la devise pour 1 HTG. ⚠ Valeur INDICATIVE à vérifier : Admin → Réglages → Devises et livraison.
insert into public.settings(key, value) values ('currencies',
  '{"HTG":{"symbol":"G","name":"Gourde haïtienne","rate":1,"decimals":2,"locale":"fr-FR","enabled":true},"DOP":{"symbol":"RD$","name":"Peso dominicano","rate":0.46,"decimals":2,"locale":"es-DO","enabled":true}}'::jsonb)
on conflict (key) do nothing;
-- Livraison : Haïti reprend l'ancien réglage ; la République dominicaine démarre avec les MÊMES montants (à ajuster dans l'admin). Montants en HTG.
insert into public.settings(key, value)
select 'shipping_zones', jsonb_build_object(
  'HT', jsonb_build_object('enabled', true, 'default_fee', coalesce((s.value->>'flat_fee')::numeric, 0), 'free_over', s.value->'free_over', 'regions', '{}'::jsonb),
  'DO', jsonb_build_object('enabled', true, 'default_fee', coalesce((s.value->>'flat_fee')::numeric, 0), 'free_over', s.value->'free_over', 'regions', '{}'::jsonb))
from (select coalesce((select value from public.settings where key = 'shipping'), '{}'::jsonb) as value) s
on conflict (key) do nothing;

-- 5) create_order : pays, téléphone par pays, devise + taux serveur, livraison par zone, MonCash réservé à Haïti
create or replace function public.create_order(p_items jsonb, p_shipping jsonb, p_coupon text default null, p_payment_method text default 'cod')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_item jsonb; v_var public.product_variants; v_prod public.products;
  v_qty int; v_price numeric; v_subtotal numeric := 0; v_fee numeric := 0; v_discount numeric := 0;
  v_order_id uuid := gen_random_uuid(); v_number text; v_img text; v_cfg jsonb; v_cv jsonb; v_methods jsonb; v_free_over numeric;
  v_country text := upper(coalesce(nullif(p_shipping->>'country',''), 'HT')); v_lang text := lower(coalesce(p_shipping->>'language','ht'));
  v_cur text := upper(coalesce(nullif(p_shipping->>'currency',''), 'HTG')); v_cur_cfg jsonb; v_rate numeric := 1; v_dec int := 2;
  v_zones jsonb; v_zone jsonb; v_digits text; v_phone text; v_postal text; v_sector text; v_number_st text; v_dep text; v_total numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'CART_EMPTY'; end if;

  -- Pays, langue
  if v_country not in ('HT','DO') then raise exception 'INVALID_COUNTRY'; end if;
  if v_lang not in ('es','ht') then v_lang := 'ht'; end if;

  -- Adresse : champs communs + règles propres à chaque pays
  v_dep := trim(coalesce(p_shipping->>'department','')); v_sector := nullif(trim(coalesce(p_shipping->>'sector','')), '');
  v_number_st := nullif(trim(coalesce(p_shipping->>'street_number','')), ''); v_postal := nullif(trim(coalesce(p_shipping->>'postal_code','')), '');
  if char_length(coalesce(p_shipping->>'full_name','')) < 2
     or char_length(trim(coalesce(p_shipping->>'address',''))) < 2 or char_length(trim(coalesce(p_shipping->>'city',''))) < 2
     or char_length(v_dep) < 2 or coalesce(p_shipping->>'email','') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_SHIPPING';
  end if;
  v_digits := regexp_replace(coalesce(p_shipping->>'phone',''), '\D', '', 'g');
  if v_country = 'DO' then
    if char_length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := substr(v_digits, 2); end if;
    if v_digits !~ '^(809|829|849)[0-9]{7}$' then raise exception 'INVALID_PHONE'; end if;
    if v_sector is null or char_length(v_sector) < 2 or v_number_st is null then raise exception 'INVALID_SHIPPING'; end if;
    if v_postal is not null and v_postal !~ '^[0-9]{5}$' then raise exception 'INVALID_POSTAL'; end if;
    v_phone := '+1 ' || substr(v_digits,1,3) || '-' || substr(v_digits,4,3) || '-' || substr(v_digits,7);
  else
    if char_length(v_digits) = 11 and left(v_digits, 3) = '509' then v_digits := substr(v_digits, 4); end if;
    if v_digits !~ '^[2-5][0-9]{7}$' then raise exception 'INVALID_PHONE'; end if;
    v_postal := null; v_number_st := null;
    v_phone := '+509 ' || substr(v_digits,1,4) || '-' || substr(v_digits,5);
  end if;

  -- Devise : le taux vient TOUJOURS du serveur (réglage « currencies »), jamais du navigateur. HTG = devise de base.
  if v_cur <> 'HTG' then
    select value into v_cfg from public.settings where key = 'currencies';
    v_cur_cfg := v_cfg->v_cur;
    if v_cur_cfg is null or coalesce((v_cur_cfg->>'enabled')::boolean, true) = false or coalesce((v_cur_cfg->>'rate')::numeric, 0) <= 0 then raise exception 'INVALID_CURRENCY'; end if;
    v_rate := (v_cur_cfg->>'rate')::numeric; v_dec := coalesce((v_cur_cfg->>'decimals')::int, 2);
  end if;

  select value into v_methods from public.settings where key = 'payment_methods';
  if v_methods is null or not (v_methods ? p_payment_method) or coalesce((v_methods->p_payment_method->>'enabled')::boolean, false) = false
     or (p_payment_method = 'moncash' and v_country <> 'HT') then   -- MonCash n'existe qu'en Haïti
    raise exception 'PAYMENT_METHOD_UNAVAILABLE';
  end if;

  v_number := 'JLD-' || lpad(nextval('public.order_number_seq')::text, 6, '0');
  insert into public.orders(id, order_number, user_id, payment_method, subtotal, shipping_fee, discount, total, full_name, phone, email, address, city, department, notes,
                            country, language, currency, exchange_rate, sector, street_number, postal_code)
  values (v_order_id, v_number, v_uid, p_payment_method, 0, 0, 0, 0,
          left(p_shipping->>'full_name',150), v_phone, left(p_shipping->>'email',200),
          left(trim(p_shipping->>'address'),300), left(trim(p_shipping->>'city'),100), left(v_dep,100), left(p_shipping->>'notes',1000),
          v_country, v_lang, v_cur, v_rate, left(v_sector,100), left(v_number_st,20), v_postal);

  for v_item in select e from jsonb_array_elements(p_items) e order by e->>'variant_id' loop
    v_qty := greatest(1, least(99, coalesce((v_item->>'quantity')::int, 1)));
    select * into v_var from public.product_variants where id = (v_item->>'variant_id')::uuid and status = 'active' for update;
    if not found then raise exception 'VARIANT_UNAVAILABLE'; end if;
    select * into v_prod from public.products where id = v_var.product_id and status = 'published';
    if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if v_var.available_quantity < v_qty then raise exception 'OUT_OF_STOCK:%', v_prod.name; end if;
    v_price := coalesce(v_var.sale_price, v_var.price, v_prod.sale_price, v_prod.price);
    v_subtotal := v_subtotal + v_price * v_qty;
    select url into v_img from public.product_images where product_id = v_prod.id order by sort_order limit 1;
    insert into public.order_items(order_id, product_id, variant_id, name, variant_name, sku, image_url, variant, unit_price, quantity)
    values (v_order_id, v_prod.id, v_var.id, v_prod.name, v_var.name, coalesce(v_var.sku, v_prod.sku), v_img, v_var.attributes, v_price, v_qty);
    update public.product_variants set reserved_quantity = reserved_quantity + v_qty where id = v_var.id;
    insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, order_id, created_by)
    values (v_prod.id, v_var.id, 'reserve', 0, v_qty, v_var.stock_quantity, v_var.reserved_quantity + v_qty, 'Commande ' || v_number, v_order_id, v_uid);
  end loop;

  -- Livraison par pays (réglage « shipping_zones », montants en HTG). Repli : ancien réglage « shipping ».
  select value into v_zones from public.settings where key = 'shipping_zones';
  v_zone := v_zones->v_country;
  if v_zones is not null and (v_zone is null and v_country <> 'HT' or coalesce((v_zone->>'enabled')::boolean, true) = false) then raise exception 'SHIPPING_UNAVAILABLE'; end if;
  if v_zone is null then
    select value into v_cfg from public.settings where key = 'shipping';
    v_fee := coalesce((v_cfg->>'flat_fee')::numeric, 0); v_free_over := (v_cfg->>'free_over')::numeric;
  else
    v_fee := coalesce((v_zone->'regions'->>v_dep)::numeric, (v_zone->>'default_fee')::numeric, 0); v_free_over := nullif(v_zone->>'free_over','')::numeric;
  end if;
  if v_free_over is not null and v_free_over > 0 and v_subtotal >= v_free_over then v_fee := 0; end if;

  if p_coupon is not null and trim(p_coupon) <> '' then
    v_cv := public.validate_coupon(p_coupon, v_subtotal);
    if (v_cv->>'valid')::boolean then
      v_discount := (v_cv->>'discount')::numeric;
      update public.coupons set used_count = used_count + 1 where upper(code) = upper(v_cv->>'code');
    else raise exception 'COUPON_INVALID'; end if;
  end if;

  v_total := greatest(v_subtotal + v_fee - v_discount, 0);
  update public.orders set subtotal = v_subtotal, shipping_fee = v_fee, discount = v_discount, total = v_total,
         total_display = round(v_total * v_rate, v_dec), coupon_code = case when v_discount > 0 then upper(trim(p_coupon)) end
   where id = v_order_id;

  insert into public.payments(order_id, method, amount) select id, payment_method, total from public.orders where id = v_order_id;
  if v_discount > 0 then
    insert into public.coupon_usages(coupon_id, order_id, user_id, discount)
    select id, v_order_id, v_uid, v_discount from public.coupons where upper(code) = upper(trim(p_coupon));
  end if;
  delete from public.cart_items where user_id = v_uid;
  insert into public.notifications(user_id, audience, type, title, body, link)
  values (v_uid, 'customer', 'order_new', 'Votre commande a été enregistrée', 'Commande ' || v_number || ' reçue.', '/orders.html');
  perform public.notify_admins('order_new', 'Nouvelle commande #' || v_number, 'Total : ' || round(v_total * v_rate, v_dec) || ' ' || v_cur || ' (' || v_country || ')', '/admin/#orders');
  return jsonb_build_object('id', v_order_id, 'order_number', v_number);
end $$;
grant execute on function public.create_order(jsonb, jsonb, text, text) to authenticated;
