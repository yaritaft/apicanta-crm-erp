-- Equipo: quién aparece como vendedor al cargar una venta — Apicanta ERP (Juan Cruz, 22/11/2026)
--
-- Aldana pidió a Yari como vendedora al cargar una venta («es para lo de mañana») y Juan Cruz pidió que el equipo lo pueda
-- editar, «para luego desactivarlo por ejemplo». Hasta acá lo decía sólo el rol (Closer y CEO aparecen); para sacar a Yari había
-- que cambiarle el rol, que también dice otras cosas (qué reglas de comisión le tocan, la liquidación).
--
-- equipo."apareceComoVendedor": vacío = lo dice el rol; true/false = manda esto, sin tocar el rol (lib/vendedores.ts). Se prende y
-- apaga desde la ficha de cada persona en Equipo; lo puede cambiar quien arma el equipo (Liquidación: editar), con las mismas reglas
-- que el resto de la ficha (equipo-liquidacion-edita.sql: nadie cambia la suya). Las ventas ya cargadas no cambian.
--
-- Idempotente: se puede correr de nuevo sin romper nada. Para deshacerlo:
--   alter table public.equipo drop column if exists "apareceComoVendedor";

do $$ begin
  if to_regclass('public.equipo') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta equipo.';
  end if;
end $$;

alter table public.equipo add column if not exists "apareceComoVendedor" boolean;

select count(*) filter (where "apareceComoVendedor" is not null) con_dato, count(*) total from public.equipo;
