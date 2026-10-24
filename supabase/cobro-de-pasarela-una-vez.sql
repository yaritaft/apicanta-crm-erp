-- Un pago de la pasarela se usa una sola vez — Apicanta ERP (Dante, 24/10/2026)
--
-- Dante cargó la seña de US$ 50 que pagó Andres Lopez en la venta de Andres
-- Gallego (los dos con llamada ese día). Al cargar la venta, la app guardaba el
-- cobro de Stripe como conciliado con un upsert, y la base se lo rechaza a un
-- closer (no puede insertar movimientos): el cobro quedaba «pendiente» aunque
-- ya tuviera un pago atado. Esa noche, en Conciliación, se lo volvió a atar al
-- pago de la venta de Andres Lopez. Resultado: los mismos US$ 50 contados dos
-- veces. Había otros 6 cobros de closers en «pendiente» con su pago ya atado,
-- esperando que les pasara lo mismo.
--
-- Lo que hace este archivo (la app ya no manda el upsert, pero esto vale venga
-- de donde venga):
--
--   1. El estado del cobro de la pasarela lo calcula la BASE a partir de los
--      pagos atados: con pagos que lo cubren, conciliado (con su pago, cuota,
--      venta, cuándo y quién); sin pagos, pendiente. Se recalcula cada vez que
--      se carga, se corrige o se borra un pago.
--   2. Un pago de la pasarela que otros cobros ya cubren no se puede atar a
--      otro: la base lo frena con un mensaje que la app muestra. A un closer ya
--      se lo ignoraba sin avisar (cobros-de-closers.sql); ahora también a quien
--      concilia desde Finanzas.
--   3. Pone al día los que quedaron mal (los 6 «pendientes» con pago).
--
-- Hace falta haber corrido cobros-de-closers.sql. Se puede volver a correr.
-- Para deshacerlo:
--   drop trigger if exists pagos_mueven_su_cobro on public.pagos;
--   drop trigger if exists pagos_pasarela_una_vez on public.pagos;

do $$ begin
  if to_regclass('public.movimientos') is null or to_regclass('public.pagos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan movimientos o pagos.';
  end if;
  if to_regprocedure('public.mi_miembro_id()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql.';
  end if;
end $$;

-- ---------- 1. el cobro de la pasarela, al día con sus pagos ----------

create or replace function public.cobro_de_pasarela_al_dia(p_mov text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  m        record;
  n        integer;
  total    numeric;
  uno      record;
  saldado  boolean;
  quien    text;
  cuando   text;
begin
  if p_mov is null then return; end if;
  select * into m from public.movimientos where id = p_mov for update;
  -- Los ignorados («Sin venta», pases entre cuentas) no se tocan.
  if m.id is null or m.estado not in ('pendiente', 'conciliado') then return; end if;

  select count(*), coalesce(sum(p.monto), 0) into n, total from public.pagos p where p."movimientoId" = p_mov;
  if n = 0 then
    update public.movimientos
       set estado = 'pendiente', vinculado = false, "pagoId" = null, "cuotaId" = null, "ventaId" = null,
           "conciliadoEn" = null, "conciliadoPor" = null
     where id = p_mov
       and (estado, coalesce(vinculado, false), "pagoId", "cuotaId", "ventaId", "conciliadoEn", "conciliadoPor")
           is distinct from ('pendiente', false, null::text, null::text, null::text, null::text, null::text);
    return;
  end if;

  select p.id, p."cuotaId", p."cargadoPor", c."ventaId" into uno
    from public.pagos p left join public.cuotas c on c.id = p."cuotaId"
   where p."movimientoId" = p_mov order by p."creadoEn", p.id limit 1;
  saldado := total >= m.monto - 0.01;
  -- Quién y cuándo: quien está guardando; si es el servidor (o la puesta al día de abajo), quien cargó el pago y cuándo.
  -- conciliadoEn es texto ISO, como lo escribe la app.
  quien := coalesce((select e.nombre from public.equipo e where e.id = public.mi_miembro_id()),
                    (select e.nombre from public.equipo e where coalesce(e.email, '') <> '' and lower(btrim(e.email)) = lower(btrim(uno."cargadoPor")) order by e.activo desc limit 1),
                    nullif(auth.jwt() ->> 'email', ''), nullif(uno."cargadoPor", ''), 'Apicanta');
  cuando := to_char(coalesce(case when coalesce(auth.jwt() ->> 'email', '') = ''
                                  then (select max(p."creadoEn") from public.pagos p where p."movimientoId" = p_mov) end, now())
                    at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  update public.movimientos
     set estado          = case when saldado then 'conciliado' else 'pendiente' end,
         "pagoId"        = case when n = 1 then uno.id else "pagoId" end,
         "cuotaId"       = case when n = 1 then uno."cuotaId" else "cuotaId" end,
         "ventaId"       = coalesce(uno."ventaId", "ventaId"),
         "conciliadoEn"  = case when saldado then coalesce("conciliadoEn", cuando) end,
         "conciliadoPor" = case when saldado then coalesce("conciliadoPor", quien) end
   where id = p_mov
     and (estado, "pagoId", "cuotaId", "ventaId", "conciliadoEn" is null)
         is distinct from (case when saldado then 'conciliado' else 'pendiente' end,
                           case when n = 1 then uno.id else "pagoId" end,
                           case when n = 1 then uno."cuotaId" else "cuotaId" end,
                           coalesce(uno."ventaId", "ventaId"),
                           not saldado);
end;
$$;
revoke all on function public.cobro_de_pasarela_al_dia(text) from public, anon, authenticated;

create or replace function public.pagos_mueven_su_cobro()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old."movimientoId" is not null then
    perform public.cobro_de_pasarela_al_dia(old."movimientoId");
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new."movimientoId" is not null
     and (tg_op = 'INSERT' or new."movimientoId" is distinct from old."movimientoId" or new.monto is distinct from old.monto) then
    perform public.cobro_de_pasarela_al_dia(new."movimientoId");
  end if;
  return null;
end;
$$;
revoke all on function public.pagos_mueven_su_cobro() from public, anon, authenticated;

drop trigger if exists pagos_mueven_su_cobro on public.pagos;
create trigger pagos_mueven_su_cobro
  after insert or update or delete on public.pagos
  for each row execute function public.pagos_mueven_su_cobro();

-- ---------- 2. un pago de la pasarela, una sola vez ----------
-- Corre después de control_cruzado_pagos (orden alfabético): a un closer esa ya
-- le soltó el pago que no se podía atar, así que esto frena a los demás.

create or replace function public.pagos_pasarela_una_vez()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  cubierto numeric;
  monto    numeric;
  de       text;
begin
  -- Sin sesión de una persona (clave de servicio, importaciones): tal cual.
  if coalesce(auth.jwt() ->> 'email', '') = '' or new."movimientoId" is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new."movimientoId" is not distinct from old."movimientoId" then
    return new;
  end if;
  select m.monto into monto from public.movimientos m where m.id = new."movimientoId";
  select coalesce(sum(p.monto), 0) into cubierto from public.pagos p
   where p."movimientoId" = new."movimientoId" and p.id <> new.id;
  if monto is not null and cubierto > 0 and cubierto >= monto - 0.01 then
    select v."contactoNombre" into de
      from public.pagos p join public.cuotas c on c.id = p."cuotaId" join public.ventas v on v.id = c."ventaId"
     where p."movimientoId" = new."movimientoId" and p.id <> new.id
     order by p."creadoEn" limit 1;
    raise exception 'Un pago de la pasarela se usa una sola vez: ese ya está en el cobro de %. Elegí otro o corregí aquel.', coalesce(de, 'otra venta')
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.pagos_pasarela_una_vez() from public, anon, authenticated;

drop trigger if exists pagos_pasarela_una_vez on public.pagos;
create trigger pagos_pasarela_una_vez
  before insert or update on public.pagos
  for each row execute function public.pagos_pasarela_una_vez();

-- ---------- 3. los que quedaron «pendientes» con su pago ya atado ----------

select public.cobro_de_pasarela_al_dia(m.id)
  from public.movimientos m
 where m.estado = 'pendiente' and exists (select 1 from public.pagos p where p."movimientoId" = m.id);
