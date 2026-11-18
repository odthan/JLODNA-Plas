-- JLODNA Plas — tests SQL : multi-pays (HT / DO), multi-devise (HTG / DOP), livraison par zone.
-- À lancer APRÈS tests_security_mobile.sql et la migration 002 (même base de TEST).
\set ON_ERROR_STOP off
\set QUIET on
create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', case when coalesce(cond,false) then 'PASS - ' else 'FAIL - ' end || label; end $$;
create function pg_temp.login(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create function pg_temp.err(sql text, pat text, label text) returns void language plpgsql as $$
begin
  execute sql; raise notice 'FAIL - % (aucune erreur levée)', label;
exception when others then
  raise notice '%', case when sqlerrm ilike '%'||pat||'%' then 'PASS - ' else 'FAIL - ' end || label || case when sqlerrm ilike '%'||pat||'%' then '' else ' (erreur obtenue : '||sqlerrm||')' end;
end $$;

select set_config('t.var', (select v.id::text from product_variants v join products p on p.id = v.product_id where v.status='active' and p.status='published' order by v.available_quantity desc limit 1), false);
update product_variants set stock_quantity = stock_quantity + 50 where id = current_setting('t.var')::uuid;
select set_config('t.ht', '{"full_name":"Marie J","phone":"34123456","email":"c1@test.com","address":"Rue 1","city":"PAP","department":"Ouest"}', false);
select set_config('t.do', '{"country":"DO","currency":"DOP","language":"es","full_name":"Juan P","phone":"8095551234","email":"c1@test.com","address":"Calle Duarte","street_number":"12","sector":"Naco","city":"Santo Domingo Este","department":"Santo Domingo","postal_code":"10101"}', false);
create function pg_temp.mk(ship text, m text default 'cod') returns jsonb language plpgsql as $$
begin return public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.var'), 'quantity', 1)), ship::jsonb, null, m); end $$;
create function pg_temp.oerr(ship text, pat text, label text, m text default 'cod') returns void language plpgsql as $$
begin
  perform pg_temp.mk(ship, m); raise notice 'FAIL - % (aucune erreur levée)', label;
exception when others then
  raise notice '%', case when sqlerrm ilike '%'||pat||'%' then 'PASS - ' else 'FAIL - ' end || label || case when sqlerrm ilike '%'||pat||'%' then '' else ' (erreur obtenue : '||sqlerrm||')' end;
end $$;

reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('MULTI: visiteur lit les devises', exists (select 1 from settings where key = 'currencies'));
select pg_temp.ok('MULTI: visiteur lit les zones de livraison', exists (select 1 from settings where key = 'shipping_zones'));

reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
-- Haïti (comportement historique)
select (pg_temp.mk(current_setting('t.ht')))->>'id' as h1 \gset
reset role;
select pg_temp.ok('HT: pays HT, devise HTG, taux 1', (select country = 'HT' and currency = 'HTG' and exchange_rate = 1 and language = 'ht' from orders where id = :'h1'));
select pg_temp.ok('HT: téléphone normalisé +509', (select phone = '+509 3412-3456' from orders where id = :'h1'));
-- République dominicaine en DOP
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select (pg_temp.mk(current_setting('t.do')))->>'id' as d1 \gset
reset role;
select pg_temp.ok('DO: pays DO, devise DOP, langue es', (select country = 'DO' and currency = 'DOP' and language = 'es' from orders where id = :'d1'));
select pg_temp.ok('DO: taux = taux du serveur', (select o.exchange_rate = (s.value->'DOP'->>'rate')::numeric from orders o, settings s where o.id = :'d1' and s.key = 'currencies'));
select pg_temp.ok('DO: total_display = total × taux', (select total_display = round(total * exchange_rate, 2) from orders where id = :'d1'));
select pg_temp.ok('DO: champs d''adresse enregistrés', (select sector = 'Naco' and street_number = '12' and postal_code = '10101' and phone = '+1 809-555-1234' from orders where id = :'d1'));
-- Le client ne peut pas imposer un taux
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select (pg_temp.mk((current_setting('t.do')::jsonb || '{"exchange_rate":99,"rate":99}'::jsonb)::text))->>'id' as d2 \gset
reset role;
select pg_temp.ok('SÉCURITÉ: taux envoyé par le navigateur ignoré', (select exchange_rate < 5 from orders where id = :'d2'));
-- Validations
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.oerr((current_setting('t.do')::jsonb || '{"phone":"3412-3456"}'::jsonb)::text, 'INVALID_PHONE', 'DO: téléphone haïtien refusé');
select pg_temp.oerr((current_setting('t.ht')::jsonb || '{"phone":"8095551234"}'::jsonb)::text, 'INVALID_PHONE', 'HT: téléphone dominicain refusé');
select pg_temp.oerr((current_setting('t.do')::jsonb - 'sector')::text, 'INVALID_SHIPPING', 'DO: secteur obligatoire');
select pg_temp.oerr((current_setting('t.do')::jsonb || '{"postal_code":"12"}'::jsonb)::text, 'INVALID_POSTAL', 'DO: code postal invalide');
select pg_temp.oerr((current_setting('t.do')::jsonb || '{"currency":"USD"}'::jsonb)::text, 'INVALID_CURRENCY', 'DEVISE: non configurée refusée');
select pg_temp.oerr((current_setting('t.do')::jsonb || '{"country":"FR"}'::jsonb)::text, 'INVALID_COUNTRY', 'PAYS: non pris en charge refusé');
select pg_temp.oerr(current_setting('t.do'), 'PAYMENT_METHOD_UNAVAILABLE', 'PAIEMENT: MonCash refusé hors Haïti', 'moncash');
-- Livraison par zone (montants en HTG)
reset role;
update settings set value = '{"HT":{"enabled":true,"default_fee":100,"free_over":null,"regions":{"Ouest":150}},"DO":{"enabled":true,"default_fee":400,"free_over":null,"regions":{"Santo Domingo":250}}}'::jsonb where key = 'shipping_zones';
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select (pg_temp.mk(current_setting('t.do')))->>'id' as d3 \gset
select (pg_temp.mk(current_setting('t.ht')))->>'id' as h3 \gset
select (pg_temp.mk((current_setting('t.do')::jsonb || '{"department":"Santiago"}'::jsonb)::text))->>'id' as d4 \gset
reset role;
select pg_temp.ok('LIVRAISON: DO / Santo Domingo = 250', (select shipping_fee = 250 from orders where id = :'d3'));
select pg_temp.ok('LIVRAISON: HT / Ouest = 150', (select shipping_fee = 150 from orders where id = :'h3'));
select pg_temp.ok('LIVRAISON: DO autre province = tarif par défaut 400', (select shipping_fee = 400 from orders where id = :'d4'));
update settings set value = jsonb_set(value, '{DO,enabled}', 'false') where key = 'shipping_zones';
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.oerr(current_setting('t.do'), 'SHIPPING_UNAVAILABLE', 'LIVRAISON: pays désactivé refusé');
reset role;
