-- JLODNA Plas — Notifications push dans le navigateur / site installé (Web Push). Exécuter APRÈS 50_security_mobile.sql. Idempotent.
create table if not exists public.web_push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 20 and 2048 and endpoint like 'https://%'),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
create index if not exists web_push_subscriptions_user_idx on public.web_push_subscriptions(user_id);
alter table public.web_push_subscriptions enable row level security; alter table public.web_push_subscriptions force row level security;
revoke all on public.web_push_subscriptions from anon, authenticated; -- lisible uniquement par le serveur (service_role)

create or replace function public.register_web_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  -- L'abonnement appartient à l'appareil : s'il change de compte (téléphone partagé), il suit le compte connecté.
  insert into public.web_push_subscriptions(endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, last_seen = now();
  delete from public.web_push_subscriptions where user_id = auth.uid() and endpoint not in
    (select endpoint from public.web_push_subscriptions where user_id = auth.uid() order by last_seen desc limit 10);
end $$;
revoke all on function public.register_web_push(text, text, text) from public, anon;
grant execute on function public.register_web_push(text, text, text) to authenticated;

create or replace function public.unregister_web_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.web_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke all on function public.unregister_web_push(text) from public, anon;
grant execute on function public.unregister_web_push(text) to authenticated;
