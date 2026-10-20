-- El estado de los procesos automáticos — Apicanta ERP
--
-- Los procesos que corren solos (hoy, el cruce de Formularios con la agenda y las ventas, cada media hora) dejaban su resultado
-- sólo en los registros de Vercel: si un día fallaba, nadie lo veía. Esto es una fila por proceso con cuándo corrió por última vez
-- y qué hizo, para mostrarlo en la app («Cruce automático: corrió hace 12 minutos, unió 1, sin errores»).
--
--   · `public.cron_estado`: `clave` es el proceso (`cruce-formularios`), `ejecutadoEn` la última corrida, `ok` si terminó sin
--     errores, `resultado` lo que informó (cuántas personas miró, cuántos registros unió, los errores) y `ultimaUnionEn` la última vez
--     que unió algo (una corrida sin nada nuevo es lo normal y no la cambia).
--   · La escribe sólo el servidor con la clave de servicio (saltea RLS). La RLS queda prendida y SIN políticas: nadie la lee ni la
--     escribe con la sesión de un usuario; la app la consulta a través de /api/conciliacion, que antes pregunta el tipo de cuenta.
--
-- Sin esto la app anda igual: el cruce corre y la pantalla de Conciliación avisa que todavía no hay estado. Idempotente y sin tocar
-- datos; para deshacerlo: `drop table public.cron_estado;`.

do $$ begin
  if to_regclass('public.registros_webinar') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla registros_webinar.';
  end if;
end $$;

create table if not exists public.cron_estado (
  clave           text primary key,
  "ejecutadoEn"   timestamptz not null default now(),
  ok              boolean not null default true,
  resultado       jsonb not null default '{}'::jsonb,
  "ultimaUnionEn" timestamptz
);

alter table public.cron_estado enable row level security;
