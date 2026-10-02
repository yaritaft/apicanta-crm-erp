-- Un % de comisión por servicio — Apicanta ERP
--
-- "Es diferente el % por closer y por servicio vendido" (Angelo, 02/10).
-- Quien vende, agenda o dirige ventas tiene un % general
-- (equipo."comisionRate") y puede tener uno propio para algunos servicios:
-- en esas ventas vale el propio en vez del general.
--
-- "comisionServicios" es un mapa servicio → fracción: {"prod_downsell": 0.05}.
-- Como "comisionRate", no se edita a mano: lo escribe la app desde lo que
-- cobra la persona (Equipo y honorarios → Comisiones), para que Finanzas y
-- la liquidación digan lo mismo (lib/honorarios.ts: tasasPorServicio).
--
-- Va en `equipo` y no en `honorarios` porque Finanzas lo necesita para
-- calcular la comisión de cada venta, y `honorarios` sólo la leen los dueños.
-- Son porcentajes, no sueldos: el general ya estaba en esta misma tabla.
--
-- Sin esta columna la app anda igual: guarda todo lo demás y el % por
-- servicio queda sólo en el navegador de quien lo cargó.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.equipo') is null or to_regclass('public.productos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla equipo o productos.';
  end if;
end $$;

alter table public.equipo add column if not exists "comisionServicios" jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipo_comision_servicios_es_mapa') then
    alter table public.equipo add constraint equipo_comision_servicios_es_mapa
      check ("comisionServicios" is null or jsonb_typeof("comisionServicios") = 'object');
  end if;
end $$;

comment on column public.equipo."comisionServicios" is
  'El % de los servicios que comisionan distinto del general (servicio → fracción). Lo escribe la app desde lo que cobra la persona.';

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'equipo' and column_name = 'comisionServicios') as columna_de_1,
  (select count(*) from pg_constraint where conname = 'equipo_comision_servicios_es_mapa')          as control_de_1,
  (select count(*) from public.equipo where "comisionServicios" is not null
     and "comisionServicios" <> '{}'::jsonb)                                                        as personas_con_porcentaje_por_servicio;
