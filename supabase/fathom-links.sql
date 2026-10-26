-- Fathom: el barrido por los links — Apicanta ERP (26/10/2026)
--
-- Los closers pegan el link de Fathom en el cierre del día, pero la
-- transcripción no llegaba: la grabación sólo se guardaba si el correo del
-- invitado y la hora coincidían con la llamada de Calendly. Ahora un cron
-- (api/cron/fathom) recorre las reuniones que ve la clave de Fathom y ata
-- cada una a la llamada que tiene pegado su link (lib/fathom-barrido).
--
--   `fathom_barrido`: dónde va el recorrido (el cursor, desde cuándo) y
--   cuándo terminó el último. Una sola fila. Sin políticas: sólo el servidor.
--
-- Idempotente. Necesita supabase/fathom.sql corrido antes.

create table if not exists public.fathom_barrido (
  id                integer primary key default 1 check (id = 1),
  cursor            text,
  desde             timestamptz,
  -- fresco (las llamadas de los últimos 3 días) | completo (todas las que faltan)
  tipo              text,
  "ultimoFresco"    timestamptz,
  "ultimoCompleto"  timestamptz,
  "actualizadoEn"   timestamptz not null default now()
);

alter table public.fathom_barrido enable row level security;

-- Para buscar rápido la llamada que tiene pegado un link de Fathom.
create index if not exists sesiones_grabacion_fathom_idx on public.sesiones ("inicia") where grabacion like '%fathom.video/share/%';

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'fathom_barrido') as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.fathom_barrido'::regclass)                               as rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fathom_barrido')                   as politicas_de_0;
