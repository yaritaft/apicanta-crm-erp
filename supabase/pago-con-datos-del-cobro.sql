-- Un pago atado a un cobro de pasarela toma su comisión real y su día — Apicanta ERP (Aldana, 25/10/2026)
--
-- Aldana comparó las ventas de Whop del 21 al 24/10 contra el export de Whop y la app daba US$ 15.999 contra US$ 15.978,48. Eran dos pagos
-- cargados a mano por un closer y atados después a su cobro de Whop, que quedaron con datos que no son los de la pasarela:
--
--   · el de Brian Asael Noh Cocom (US$ 200): comisión US$ 6,00 (el 3% estimado de la cuenta) y Whop cobró US$ 7,77. El cobro ya tenía la real, pero
--     la venta se cargó desde un navegador que todavía no la había sincronizado: tomó la estimada y nada la corrigió después;
--   · el de Simon Perez (US$ 500, pagado el 24/10 a las 13:17): cargado con la fecha del 27/10 (un vencimiento, no el día en que cobró), así que
--     quedó fuera del período, fuera de «Cobró» del arqueo de Whop y figuró como un cobro del futuro.
--
-- El resto de los 21 pagos de Whop del período coincide al centavo con el export. (La comisión del pago reembolsado de Sebastián Vega sí está
-- sumada: Whop la cobra igual y la app la deja como comisión del procesador.)
--
-- Lo que hace este archivo:
--
--   1. Un disparador en `pagos`: cuando un pago se ata a un cobro de una pasarela que cobra comisión (Stripe, Whop, Hotmart, dLocal, Mercado
--      Pago), toma de ese cobro la comisión real —en proporción, si el cobro se repartió en varios pagos— salvo que alguien la haya corregido a
--      mano (`feeManual`), y el día en que la pasarela cobró. Pasa al insertar el pago y cuando cambia su `movimientoId`; no toca un pago ya
--      atado que alguien corrige después, ni los cobros de Mercury (el día en que se asienta lo decide quien lo ata).
--      Lo hace la base y no la app para que no dependa del navegador de quien carga: un closer con la pantalla desactualizada no puede dejar un
--      pago con datos viejos.
--   2. Repara los pagos de octubre que ya están así: la comisión distinta de la real y los de más de un día después del cobro. Antes guarda una
--      copia en respaldo.pagos_cobro_2610.
--
-- Se puede volver a correr. Para deshacerlo:
--   drop trigger if exists pagos_toma_datos_del_cobro on public.pagos;
--   drop function if exists public.pago_toma_datos_del_cobro();
--   (y para volver los dos pagos: update public.pagos p set "feeMonto" = r."feeMonto", "feeRate" = r."feeRate", fecha = r.fecha
--      from respaldo.pagos_cobro_2610 r where r.id = p.id;)

do $$ begin
  if to_regclass('public.pagos') is null or to_regclass('public.movimientos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan pagos o movimientos.';
  end if;
end $$;

-- ---------- 1. el disparador ----------

create or replace function public.pago_toma_datos_del_cobro()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  m record;
begin
  if new."movimientoId" is null then return new; end if;
  if tg_op = 'UPDATE' and new."movimientoId" is not distinct from old."movimientoId" then return new; end if;

  select proveedor, monto, fee, fecha into m from public.movimientos where id = new."movimientoId";
  if not found or m.proveedor is null or m.proveedor not in ('stripe', 'whop', 'hotmart', 'dlocal', 'mercadopago') then
    return new;
  end if;

  -- La comisión real de la pasarela, en proporción a lo que cubre este pago.
  if not coalesce(new."feeManual", false) and coalesce(m.fee, 0) > 0 and coalesce(m.monto, 0) > 0 and coalesce(new.monto, 0) > 0 then
    new."feeMonto" := round(m.fee * new.monto / m.monto, 2);
    new."feeRate"  := round(new."feeMonto" / new.monto, 4);
  end if;

  -- El día en que la pasarela cobró (no un vencimiento ni el día en que se cargó).
  if m.fecha is not null and m.fecha <> '' then
    begin
      new.fecha := m.fecha::timestamptz;
    exception when others then
      null; -- una fecha que no se entiende no frena el pago
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists pagos_toma_datos_del_cobro on public.pagos;
create trigger pagos_toma_datos_del_cobro
  before insert or update on public.pagos
  for each row execute function public.pago_toma_datos_del_cobro();

-- ---------- 2. los que ya están mal (octubre) ----------

create schema if not exists respaldo;
create table if not exists respaldo.pagos_cobro_2610 as select * from public.pagos where false;

insert into respaldo.pagos_cobro_2610
select p.*
  from public.pagos p
  join public.movimientos m on m.id = p."movimientoId"
 where m.proveedor in ('stripe', 'whop', 'hotmart', 'dlocal', 'mercadopago')
   and p.fecha >= '2026-10-01'
   and not exists (select 1 from respaldo.pagos_cobro_2610 r where r.id = p.id)
   and ( (not coalesce(p."feeManual", false) and m.fee > 0 and m.monto > 0 and p.monto > 0
          and abs(p."feeMonto" - (m.fee * p.monto / m.monto)) > 0.02)
         or (m.fecha ~ '^\d{4}-\d{2}-\d{2}' and abs(extract(epoch from (p.fecha - m.fecha::timestamptz))) > 86400) );

update public.pagos p
   set "feeMonto" = round(m.fee * p.monto / m.monto, 2),
       "feeRate"  = round(round(m.fee * p.monto / m.monto, 2) / p.monto, 4)
  from public.movimientos m
 where m.id = p."movimientoId"
   and m.proveedor in ('stripe', 'whop', 'hotmart', 'dlocal', 'mercadopago')
   and p.fecha >= '2026-10-01'
   and not coalesce(p."feeManual", false) and m.fee > 0 and m.monto > 0 and p.monto > 0
   and abs(p."feeMonto" - (m.fee * p.monto / m.monto)) > 0.02;

update public.pagos p
   set fecha = m.fecha::timestamptz
  from public.movimientos m
 where m.id = p."movimientoId"
   and m.proveedor in ('stripe', 'whop', 'hotmart', 'dlocal', 'mercadopago')
   and p.fecha >= '2026-10-01'
   and m.fecha ~ '^\d{4}-\d{2}-\d{2}'
   and abs(extract(epoch from (p.fecha - m.fecha::timestamptz))) > 86400;
