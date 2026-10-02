-- Vistas guardadas del equipo — Apicanta ERP
--
-- Como en Notion: una pantalla con sus filtros, su orden, su período y sus
-- columnas, con nombre, para que todo el equipo la abra con un clic (CRM →
-- Vistas → «Para todo el equipo»). Las que cada uno guarda sólo para sí van
-- con sus preferencias (preferencias.sql), no acá.
--
-- Lo que se guarda es la dirección de lo que se estaba viendo (los filtros
-- que ya van en el link), no datos del negocio: abrir una vista no deja ver
-- nada que el tipo de cuenta no vea. Las ve quien entra a la app; las guarda,
-- cambia y borra quien ve todo (no las cuentas «sólo lo suyo», como el
-- closer, que guarda las suyas).
--
-- Sin esta tabla la app sigue andando: sólo no ofrece «Para todo el equipo».
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.procesadores') is null or to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla procesadores o gastos.';
  end if;
  if to_regprocedure('public.solo_lo_suyo()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta solo_lo_suyo().';
  end if;
end $$;

create table if not exists public.vistas (
  id              text primary key,
  -- De qué pantalla es: "crm".
  pantalla        text not null,
  nombre          text not null check (char_length(btrim(nombre)) between 1 and 80),
  -- La query de la pantalla: ?solo-closer=…&orden=…
  consulta        text not null default '' check (char_length(consulta) <= 4000),
  "creadoPor"     text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  "creadoEn"      timestamptz not null default now(),
  "actualizadoEn" timestamptz not null default now()
);
create index if not exists vistas_pantalla on public.vistas (pantalla);

alter table public.vistas enable row level security;

drop policy if exists ver_vistas on public.vistas;
create policy ver_vistas on public.vistas
  for select to authenticated
  using ((select public.puede_entrar()));

drop policy if exists crear_vistas on public.vistas;
create policy crear_vistas on public.vistas
  for insert to authenticated
  with check ((select public.puede_entrar()) and (select not public.solo_lo_suyo()));

drop policy if exists editar_vistas on public.vistas;
create policy editar_vistas on public.vistas
  for update to authenticated
  using ((select public.puede_entrar()) and (select not public.solo_lo_suyo()))
  with check ((select public.puede_entrar()) and (select not public.solo_lo_suyo()));

drop policy if exists borrar_vistas on public.vistas;
create policy borrar_vistas on public.vistas
  for delete to authenticated
  using ((select public.puede_entrar()) and (select not public.solo_lo_suyo()));

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'vistas')                    as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.vistas'::regclass)   as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'vistas')                        as politicas_de_4;
