-- Lo que cobra WhatsApp por los mensajes de la API, día por día (21/10).
--
-- El costo de «WhatsApp API» de cada webinar se cargaba a mano y estaba en US$ 0. Meta lo sabe: la cuenta de WhatsApp Business (WABA)
-- entrega el costo de los mensajes enviados (plantillas de marketing, utilidad…) por día y por categoría. El cron de Meta
-- (api/cron/meta, cada 15 minutos) lo trae con el mismo token de sistema que usa para los anuncios y lo deja acá; la app reparte cada día
-- al próximo webinar (como los DM Ads) y lo muestra donde antes decía 0. Lo cargado a mano en el webinar sigue mandando.
--
--   · `public.whatsapp_costos`: una fila por día, cuenta y categoría (MARKETING, UTILITY, SERVICE…).
--       `costo` en la moneda de la cuenta (`moneda`); la app sólo suma lo que viene en USD.
--   · La escribe sólo el servidor con la clave de servicio (saltea RLS). La leen quienes ya ven el embudo de los webinars (Panel, Webinars,
--     Marketing o Finanzas), nunca quien tiene «sólo lo suyo». No tiene teléfonos ni nombres: sólo montos por día.
--
-- Sin esto la app anda igual (el costo sigue siendo el que se cargó a mano). Idempotente; para deshacerlo: `drop table public.whatsapp_costos;`.

do $$ begin
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

create table if not exists public.whatsapp_costos (
  dia              date    not null,
  cuenta           text    not null,
  categoria        text    not null default 'TOTAL',
  volumen          integer not null default 0,
  costo            numeric not null default 0,
  moneda           text    not null default 'USD',
  "actualizadoEn"  timestamptz not null default now(),
  primary key (dia, cuenta, categoria)
);

alter table public.whatsapp_costos enable row level security;

drop policy if exists ver_whatsapp_costos on public.whatsapp_costos;
create policy ver_whatsapp_costos on public.whatsapp_costos
  for select to authenticated
  using (
    (   (select public.nivel_area('panel'))     >= 1
     or (select public.nivel_area('webinars'))  >= 1
     or (select public.nivel_area('marketing')) >= 1
     or (select public.nivel_area('finanzas'))  >= 1)
    and (select not public.solo_lo_suyo())
  );

revoke all on public.whatsapp_costos from anon;
grant select on public.whatsapp_costos to authenticated;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'whatsapp_costos') as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_costos'::regclass)                              as rls_activo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'whatsapp_costos')                  as politicas_de_1,
  (select count(*) from public.whatsapp_costos)                                                                     as filas;
