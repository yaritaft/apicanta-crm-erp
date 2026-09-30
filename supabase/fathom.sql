-- Grabaciones de Fathom — Apicanta ERP (fase 4 del feedback de Yari, 29/09)
--
-- Cada llamada con su grabación de Fathom: el link, el resumen, los
-- accionables y la transcripción, sin que el closer pegue nada. Llegan por
-- el webhook de Fathom (api/fathom/webhook) o se traen por su API
-- (api/fathom), y se atan a su llamada por el correo del invitado y la hora
-- (lib/fathom.ts).
--
--   1. `grabaciones`: una fila por reunión de Fathom. La lee quien ve las
--      llamadas, y el closer sólo las de sus llamadas (mis_sesiones(), de
--      supabase/tipos-cuenta.sql). La crea sólo el servidor, con la clave
--      de servicio; atarla a otra llamada, quien edita las llamadas.
--   2. `fathom_conexion`: el webhook creado desde la app y su secreto. Sin
--      políticas: la lee y la escribe sólo el servidor.
--
-- No se carga con el resto de los datos al abrir la app (las
-- transcripciones pesan): se pide cuando se abre la ficha.
--
-- Idempotente. Necesita supabase/tipos-cuenta.sql corrido antes.

do $$ begin
  if to_regclass('public.sesiones') is null or to_regprocedure('public.mis_sesiones()') is null then
    raise exception 'Falta la tabla sesiones o supabase/tipos-cuenta.sql: esta no es la base del ERP o está sin la fase 3.';
  end if;
end $$;

create table if not exists public.grabaciones (
  id                  text primary key,
  fuente              text not null default 'fathom',
  "recordingId"       text not null unique,
  "sesionId"          text references public.sesiones(id) on delete set null,
  -- email-y-hora | a-mano
  "emparejadaPor"     text,
  titulo              text not null default '',
  url                 text,
  "shareUrl"          text,
  empieza             timestamptz,
  "grabadaDesde"      timestamptz,
  "grabadaHasta"      timestamptz,
  "grabadoPor"        text,
  "grabadoPorNombre"  text,
  -- [{ nombre, email, externo }]
  invitados           jsonb not null default '[]'::jsonb,
  -- En markdown, como lo arma Fathom.
  resumen             text,
  -- [{ quien, texto, t }]
  transcripcion       jsonb,
  -- [{ texto, hecho, quien, t, link }]
  accionables         jsonb not null default '[]'::jsonb,
  idioma              text,
  "creadoEn"          timestamptz not null default now(),
  "actualizadoEn"     timestamptz not null default now()
);

create index if not exists grabaciones_sesion_idx on public.grabaciones ("sesionId");
create index if not exists grabaciones_empieza_idx on public.grabaciones (empieza);

alter table public.grabaciones enable row level security;

drop policy if exists ver_grabaciones on public.grabaciones;
create policy ver_grabaciones on public.grabaciones for select to authenticated using (
  (select public.ve('sesiones'))
  and ((select not public.solo_lo_suyo()) or "sesionId" = any((select public.mis_sesiones())::text[])));

-- Atar a mano una grabación a su llamada (o desatarla).
drop policy if exists editar_grabaciones on public.grabaciones;
create policy editar_grabaciones on public.grabaciones for update to authenticated
  using ((select public.edita('sesiones'))
    and ((select not public.solo_lo_suyo()) or "sesionId" = any((select public.mis_sesiones())::text[])))
  with check ((select public.edita('sesiones'))
    and ((select not public.solo_lo_suyo()) or "sesionId" = any((select public.mis_sesiones())::text[])));

create table if not exists public.fathom_conexion (
  id              integer primary key default 1 check (id = 1),
  "webhookId"     text,
  secreto         text,
  url             text,
  -- Si Fathom aceptó avisar también por las grabaciones del equipo (plan Team).
  "paraElEquipo"  boolean not null default false,
  "conectadoEn"   timestamptz not null default now(),
  "conectadoPor"  text
);

-- Sin políticas: el secreto no lo ve nadie desde el navegador.
alter table public.fathom_conexion enable row level security;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('grabaciones', 'fathom_conexion'))                                  as tablas_de_2,
  (select relrowsecurity from pg_class where oid = 'public.grabaciones'::regclass)          as rls_grabaciones,
  (select relrowsecurity from pg_class where oid = 'public.fathom_conexion'::regclass)      as rls_conexion,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'grabaciones') as politicas_de_2,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fathom_conexion') as politicas_de_0;
