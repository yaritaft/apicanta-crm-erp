-- Meta Conversions API: los eventos ya mandados — Apicanta ERP
--
-- El cron /api/cron/meta-capi le cuenta a Meta las agendas (Schedule) y las
-- ventas (Purchase). Acá queda cada evento mandado, así no se manda dos veces.
-- Sin políticas a propósito: sólo la escribe el servidor (clave de servicio);
-- desde la app nadie la lee ni la toca.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

create table if not exists public.capi_enviados (
  id           text primary key,
  evento       text not null,
  "enviadoEn"  timestamptz not null default now()
);

alter table public.capi_enviados enable row level security;

select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'capi_enviados') as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.capi_enviados'::regclass) as rls_activo;
