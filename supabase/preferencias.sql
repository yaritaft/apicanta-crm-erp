-- Preferencias de cada usuario — Apicanta ERP
--
-- Cómo le gusta ver la app a cada uno, no datos del negocio. Hoy: qué
-- métricas del Dashboard se ven y en qué orden (Yari, 29/09: "que yo, como
-- usuario, pueda dejar guardado que se oculten algunas filas"). Una fila por
-- usuario y clave (lib/preferencias.ts), así lo que alguien oculta en su compu
-- lo ve oculto también en otra.
--
-- Cada uno lee y escribe sólo las suyas. Sin esta tabla la app sigue andando
-- y lo guarda sólo en el navegador, como antes.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.procesadores') is null or to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla procesadores o gastos.';
  end if;
end $$;

create table if not exists public.preferencias (
  "userId"        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clave           text not null,
  valor           jsonb not null,
  "actualizadoEn" timestamptz not null default now(),
  primary key ("userId", clave)
);

-- Del equipo (puede_entrar), y cada uno sólo las suyas.
alter table public.preferencias enable row level security;
drop policy if exists preferencias_propias on public.preferencias;
create policy preferencias_propias on public.preferencias
  for all to authenticated
  using ("userId" = (select auth.uid()) and public.puede_entrar())
  with check ("userId" = (select auth.uid()) and public.puede_entrar());

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'preferencias')                    as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.preferencias'::regclass)   as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'preferencias')                        as politicas_de_1;
