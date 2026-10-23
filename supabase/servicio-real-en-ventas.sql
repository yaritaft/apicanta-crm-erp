-- El servicio de cada venta dice su nombre real — Apicanta ERP (Yari, 22/10)
--
-- «No me gusta que en servicios diga Mentoría y Upsell: siempre va a haber una sola mentoría y un solo upsell, y para mí debería
-- decir el nombre del servicio». Las ventas de la planilla de Angelo (y las que los closers cargaban con «Mentoría», que venía
-- marcado de antemano) quedaron todas en el producto genérico `prod_mentoria`. Esto las pasa al producto de su programa:
--
--   · Hackear Biz / Principals / Hackear IT / Hackear AI, según el programa que tiene el alumno en su ficha de seguimiento (lo que
--     cargó Customer Success desde el Airtable). La venta se ata al alumno por `alumnos."ventaId"` o, si no, por el lead.
--   · Sin alumno o sin programa: por fecha. Hasta julio de 2026 se vendía Hackear IT; desde agosto, Hackear AI (así dicen los datos:
--     de las ventas con programa, 54 de 64 de agosto a octubre son AI y de abril a junio 119 de 142 eran IT).
--
-- Lo que NO se toca: Resell Mentoría y Upsell siguen siendo productos aparte (tienen su % de comisión propio por closer), y Upgrade AI.
--
-- La plata no cambia: los productos nuevos son del mismo tipo (`principal`) y los esquemas de comisión que filtraban por «Mentoría»
-- (Agustín y Nahuel, profit propio) ahora también cuentan los cuatro programas. Se comprobó con los datos reales mes por mes
-- (agosto 2025 a octubre 2026): P&L, comisiones de cada venta y liquidación de cada persona dan lo mismo antes y después.
--
-- Después: «Mentoría» queda inactivo (no aparece al cargar una venta nueva; las viejas lo siguen viendo si alguna quedara) y los
-- servicios se ordenan: Hackear AI, Hackear IT, Hackear Biz, Principals, Upgrade AI, Upsell, Resell, Downsell, el resto.
--
-- Respaldo de lo que cambia en el esquema `respaldo`. Para deshacerlo:
--   update public.ventas v set "productoId" = r."productoId" from respaldo.ventas_producto_2210 r where r.id = v.id;
--   update public.honorarios h set conceptos = r.conceptos from respaldo.honorarios_2210 r where r."miembroId" = h."miembroId";
--   update public.productos p set activo = r.activo, orden = r.orden from respaldo.productos_2210 r where r.id = p.id;

do $$ begin
  if to_regclass('public.ventas') is null or to_regclass('public.productos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp).';
  end if;
  if (select count(*) from public.productos where id in ('prod_hackear_it', 'prod_hackear_ai', 'prod_biz', 'prod_principals')) < 4 then
    raise exception 'Faltan los productos de los programas (Hackear IT, AI, Biz o Principals).';
  end if;
end $$;

create schema if not exists respaldo;

create table if not exists respaldo.ventas_producto_2210 as
  select id, "productoId" from public.ventas where "productoId" = 'prod_mentoria';
create table if not exists respaldo.honorarios_2210 as
  select "miembroId", conceptos from public.honorarios;
create table if not exists respaldo.productos_2210 as
  select id, activo, orden from public.productos;

-- 1. Cada venta de «Mentoría» a su programa.
with base as (
  select s.id, s.fecha,
    coalesce(
      (select sa.programas from public.alumnos a join public.seguimiento_alumnos sa on sa."alumnoId" = a.id where a."ventaId" = s.id limit 1),
      (select sa.programas from public.alumnos a join public.seguimiento_alumnos sa on sa."alumnoId" = a.id
        where s."contactoId" is not null and a."leadId" = s."contactoId" limit 1)
    ) as programas
  from public.ventas s
  where s."productoId" = 'prod_mentoria'
), destino as (
  select id,
    case when programas::text ilike '%biz%' then 'prod_biz'
         when programas::text ilike '%principals%' then 'prod_principals'
         when programas::text ilike '%hackear it%' then 'prod_hackear_it'
         when programas::text ilike '%IA%' or programas::text ilike '%AI%' then 'prod_hackear_ai'
         when fecha >= '2026-08-01' then 'prod_hackear_ai'
         else 'prod_hackear_it' end as nuevo
  from base
)
update public.ventas v set "productoId" = d.nuevo
from destino d
where v.id = d.id and v."productoId" = 'prod_mentoria';

-- 2. Los esquemas que contaban «Mentoría» ahora cuentan también los cuatro programas.
update public.honorarios h set conceptos = (
  select coalesce(jsonb_agg(
    case when jsonb_typeof(c -> 'productoIds') = 'array' and (c -> 'productoIds') ? 'prod_mentoria'
      then jsonb_set(c, '{productoIds}', (
        select jsonb_agg(distinct x) from jsonb_array_elements(
          (c -> 'productoIds') || '["prod_hackear_it", "prod_hackear_ai", "prod_biz", "prod_principals"]'::jsonb
        ) x))
      else c end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(h.conceptos) with ordinality as t(c, ord)
)
where h.conceptos::text like '%prod_mentoria%';

-- 3. «Mentoría» ya no se elige, y los servicios en un orden con sentido.
update public.productos set activo = false where id = 'prod_mentoria';
update public.productos p set orden = o.orden
from (values
  ('prod_hackear_ai', 0), ('prod_hackear_it', 1), ('prod_biz', 2), ('prod_principals', 3), ('prod_upgrade_ai', 4), ('prod_upsell', 5),
  ('prod_resell', 6), ('prod_downsell', 7), ('prod_resultados', 8), ('prod_mastermind', 9), ('prod_resell_mastermind', 10),
  ('prod_cena_premaster', 11), ('prod_cena', 12), ('prod_prueba', 13), ('prod_mentoria', 14)
) as o(id, orden)
where p.id = o.id;
