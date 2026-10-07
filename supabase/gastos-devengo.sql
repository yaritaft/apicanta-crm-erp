-- Gastos con dos fechas — Apicanta ERP (reunión del 02/10: «mes cerrado»)
--
-- Yari y Juan Cruz: un gasto de septiembre que se paga el 2 de octubre tiene
-- que restar en el estado de resultados de septiembre —ahí lo generó el
-- negocio— pero la plata sale de la caja en octubre. Hasta ahora un gasto
-- tenía una sola fecha, y la caja y el estado de resultados lo contaban en el
-- mismo mes.
--
-- Desde acá un gasto tiene dos:
--
--   · fecha      el mes al que corresponde (el devengo): el estado de
--                resultados lo cuenta ahí. Es la de siempre.
--   · fechaPago  el día que se pagó: la caja y el arqueo lo cuentan ahí.
--                Vacía, es la misma `fecha`: así quedan todos los gastos que
--                ya estaban cargados, sin cambiar ninguna cuenta.
--
-- Qué agrega este archivo: una columna nueva y nada más. No cambia datos
-- existentes ni políticas de RLS (las de `gastos` ya cubren la columna).
--
-- Sin esta columna la app anda igual: el gasto se guarda sin la fecha de pago
-- (la app saca la columna que la base todavía no tiene) y se ve con una sola
-- fecha al volver a cargar. Conviene correrlo ANTES de cargar gastos pagados
-- en otro mes, para que esa fecha no se pierda.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla gastos.';
  end if;
end $$;

alter table public.gastos add column if not exists "fechaPago" timestamptz;

comment on column public.gastos."fechaPago" is
  'El día que se pagó el gasto (caja y arqueo). Vacío: el mismo día que "fecha", el mes al que corresponde (estado de resultados).';

-- ---------- diagnóstico ----------
select
  count(*)                                                     as gastos,
  count(*) filter (where "fechaPago" is not null)              as con_otra_fecha_de_pago,
  count(*) filter (where "fechaPago" is not null
                     and date_trunc('month', "fechaPago") <> date_trunc('month', "fecha"::timestamptz)) as pagados_en_otro_mes
from public.gastos;
