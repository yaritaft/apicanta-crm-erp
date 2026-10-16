-- Cobros de los closers — Apicanta ERP (daily con los closers, 16/10/2026)
--
-- Valentín y los demás closers cargan el cobro de sus cuotas y tienen que poder
-- CONCILIARLO ellos, contra el pago que llegó a la pasarela (Stripe, Whop…), sin
-- esperar a Finanzas. Hasta acá no podían: el tipo Closer no lee `movimientos` (la
-- base devuelve vacío sin avisar: «sin resultados») ni los ata a un cobro. Y un
-- cobro mal cargado no tenía arreglo. Esta tanda:
--
--   1. Quien REGISTRA PAGOS (edita Ventas) ve los movimientos SIN CONCILIAR y los
--      ya atados a una venta que ve; nada más. No ve egresos ni saldos (la tabla
--      sólo tiene ingresos de pasarela), ni lo conciliado de las ventas de otros
--      ni los ignorados. Finanzas y los dueños siguen viéndolo todo.
--   2. Puede marcar uno como conciliado (estado, pago, cuota, venta, quién y
--      cuándo) y soltarlo; ninguna otra columna (monto, cliente, referencia…) y
--      ningún movimiento nuevo: lo frena un trigger. Un movimiento ya conciliado
--      de otro no lo ve, así que no lo toca.
--   3. Un cobro puede atarse a un movimiento si éste se puede atar: existe, está
--      sin conciliar (o ya era de ese cobro) y el monto no pasa de lo que queda
--      libre. Antes un closer que escribía un id inventado dejaba el cobro
--      «chequeado · pasarela» sin plata: por eso la base lo ignoraba; ahora lo
--      ignora si no cumple eso, y lo acepta si cumple.
--   4. EL CANDADO: un closer (quien no es dueño ni edita Finanzas) NO puede
--      corregir ni borrar un cobro que Finanzas ya chequeó, ni uno cuya
--      liquidación del mes ya se cerró (la comisión ya no se recalcula sola). Lo
--      decide la base, no la pantalla. Un cobro rechazado SÍ se puede corregir.
--      Finanzas y los dueños corrigen siempre (la app les avisa si el mes está
--      cerrado).
--
-- Hace falta haber corrido tipos-cuenta.sql y control-cruzado.sql. Idempotente.
-- Para deshacerlo:
--   drop policy if exists ver_movimientos_ventas on public.movimientos;
--   drop policy if exists editar_movimientos_ventas on public.movimientos;
--   drop trigger if exists movimientos_guarda_de_ventas on public.movimientos;
--   drop trigger if exists pagos_candado_de_cobro on public.pagos;
-- y volver a correr control-cruzado.sql (trae la función de antes).

do $$ begin
  if to_regclass('public.movimientos') is null or to_regclass('public.pagos') is null or to_regclass('public.liquidaciones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan movimientos, pagos o liquidaciones.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null or to_regprocedure('public.solo_lo_suyo()') is null
     or to_regprocedure('public.es_dueno()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan nivel_area(), solo_lo_suyo() o es_dueno().';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'pagos' and column_name in ('chequeoFinanzas', 'cargadoPor')) < 2 then
    raise exception 'Primero hay que correr control-cruzado.sql.';
  end if;
end $$;

-- ---------- 1. lo que queda libre de un movimiento ----------

-- Security definer: suma los cobros de TODOS los closers (el closer sólo ve los
-- suyos). Devuelve sólo un número y sólo a quien registra pagos o es de Finanzas.
create or replace function public.movimiento_libre(p_mov text, p_sin_pago text default null)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select case
    when coalesce((select public.nivel_area('ventas')), 0) >= 2 or coalesce((select public.nivel_area('finanzas')), 0) >= 2
      then round(m.monto - coalesce((select sum(p.monto) from public.pagos p
                                      where p."movimientoId" = m.id and p.id is distinct from p_sin_pago), 0), 2)
    else null end
  from public.movimientos m
  where m.id = p_mov and m.estado <> 'ignorado';
$$;

-- ¿Se puede atar un cobro (id `p_pago`, de `p_monto`) a ese movimiento? Los
-- parámetros llevan prefijo: sin él, `monto` era la columna del movimiento.
create or replace function public.movimiento_se_puede_atar(p_mov text, p_pago text, p_monto numeric)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select (m.estado = 'pendiente'
            or exists (select 1 from public.pagos p where p.id = p_pago and p."movimientoId" = m.id))
           and coalesce(p_monto, 0) > 0
           and coalesce(p_monto, 0) <= coalesce(public.movimiento_libre(m.id, p_pago), 0) + 0.01
    from public.movimientos m
    where m.id = p_mov and m.estado in ('pendiente', 'conciliado')), false);
$$;

-- ¿La liquidación del mes de ese cobro ya se cerró? Security definer: las
-- liquidaciones son sólo de los dueños y un closer no las ve.
create or replace function public.mes_de_cobro_cerrado(p_fecha timestamptz)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.liquidaciones l
                 where l.id = 'liq_' || to_char(p_fecha at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')
                   and l.estado = 'cerrada');
$$;

revoke all on function public.movimiento_libre(text, text) from public, anon;
revoke all on function public.movimiento_se_puede_atar(text, text, numeric) from public, anon;
grant execute on function public.movimiento_libre(text, text) to authenticated;
grant execute on function public.movimiento_se_puede_atar(text, text, numeric) to authenticated;
revoke all on function public.mes_de_cobro_cerrado(timestamptz) from public, anon;
grant execute on function public.mes_de_cobro_cerrado(timestamptz) to authenticated;

-- ---------- 2. los movimientos que ve y toca quien registra pagos ----------

drop policy if exists ver_movimientos_ventas on public.movimientos;
create policy ver_movimientos_ventas on public.movimientos
  for select to authenticated
  using (
    (select public.nivel_area('ventas')) >= 2
    and (estado = 'pendiente'
         or exists (select 1 from public.ventas v where v.id = movimientos."ventaId"))
  );

drop policy if exists editar_movimientos_ventas on public.movimientos;
create policy editar_movimientos_ventas on public.movimientos
  for update to authenticated
  using (
    (select public.nivel_area('ventas')) >= 2
    and (estado = 'pendiente'
         or exists (select 1 from public.ventas v where v.id = movimientos."ventaId"))
  )
  with check (
    (select public.nivel_area('ventas')) >= 2
    and estado in ('pendiente', 'conciliado')
    and ("ventaId" is null or exists (select 1 from public.ventas v where v.id = movimientos."ventaId"))
  );

-- El RLS no distingue columnas: quien no es de Finanzas sólo mueve lo de la
-- conciliación.
create or replace function public.movimientos_guarda_de_ventas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conciliacion text[] := array['estado', 'pagoId', 'cuotaId', 'ventaId', 'conciliadoEn', 'conciliadoPor', 'vinculado'];
begin
  -- Sin sesión de una persona (clave de servicio, editor de SQL): tal cual.
  if coalesce(auth.jwt() ->> 'email', '') = '' then
    return new;
  end if;
  if coalesce((select public.nivel_area('finanzas')), 0) >= 2 or coalesce((select public.es_dueno()), false) then
    return new;
  end if;
  if (to_jsonb(new) - conciliacion) is distinct from (to_jsonb(old) - conciliacion) then
    raise exception 'Un pago de la pasarela sólo se concilia: el monto, el cliente y la referencia los cambia Finanzas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists movimientos_guarda_de_ventas on public.movimientos;
create trigger movimientos_guarda_de_ventas
  before update on public.movimientos
  for each row execute function public.movimientos_guarda_de_ventas();

-- ---------- 3. atar un cobro a un movimiento ----------

create or replace function public.control_cruzado_pagos()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  yo        text    := lower(coalesce(auth.jwt() ->> 'email', ''));
  puede_dir boolean := false;
  puede_fin boolean := false;
  reemplazo boolean := false;
  soltado   boolean := false;
begin
  -- Sin sesión de una persona (la clave de servicio, el editor de SQL): tal cual.
  if yo = '' then
    return new;
  end if;

  puede_fin := coalesce((select public.nivel_area('finanzas')), 0) >= 2;
  puede_dir := coalesce((select public.nivel_area('ventas')), 0) >= 2
               and not coalesce((select public.solo_lo_suyo()), false);

  if tg_op = 'INSERT' then
    new."cargadoPor" := yo;

    -- Un cobro nuevo arranca pendiente. Sólo conserva un casillero quien puede
    -- llenarlo (un respaldo que se restaura, por ejemplo), sellado a su nombre.
    if puede_dir and new."chequeoDirector" is not null then
      new."chequeoDirectorPor" := yo;
      new."chequeoDirectorEn"  := now();
    else
      new."chequeoDirector" := null; new."chequeoDirectorPor" := null;
      new."chequeoDirectorEn" := null; new."chequeoDirectorNota" := null;
    end if;
    if puede_fin and new."chequeoFinanzas" is not null then
      new."chequeoFinanzasPor" := yo;
      new."chequeoFinanzasEn"  := now();
    else
      new."chequeoFinanzas" := null; new."chequeoFinanzasPor" := null;
      new."chequeoFinanzasEn" := null; new."chequeoFinanzasNota" := null;
    end if;

    -- El tilde de quien carga no cuenta como chequeo; el cobro atado a la
    -- pasarela sí viene chequeado (la plata está en la pasarela). Quien carga
    -- puede atarlo a un movimiento SIN conciliar que le alcance (los ve desde
    -- cobros-de-closers.sql): uno inventado o ya usado se ignora.
    if not (puede_dir or puede_fin) then
      if new."movimientoId" is not null
         and public.movimiento_se_puede_atar(new."movimientoId", new.id, new.monto) then
        new.chequeado := true;
      else
        new."movimientoId" := null;
        new.chequeado := null;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  new."cargadoPor" := old."cargadoPor";

  -- Atar o desatar el cobro a un movimiento lo hace quien concilia (director,
  -- finanzas) o quien carga el cobro, si el movimiento se puede atar (existe,
  -- está sin conciliar o ya era de este cobro, y le alcanza el monto). Un
  -- movimiento que no se puede atar se ignora: queda el de antes, sin error.
  if not (puede_dir or puede_fin) and new."movimientoId" is distinct from old."movimientoId" then
    if new."movimientoId" is null then
      -- Soltarlo (corregir un cobro mal conciliado): vuelve a pendiente de chequeo.
      new.chequeado := null;
      soltado := true;
    elsif public.movimiento_se_puede_atar(new."movimientoId", new.id, new.monto) then
      new.chequeado := true;
    else
      new."movimientoId" := old."movimientoId";
    end if;
  end if;

  -- Un cobro atado a la pasarela no puede crecer más allá de lo que queda libre
  -- de ese pago: sin esto, quien lo carga le subía el monto después de atarlo.
  if not (puede_dir or puede_fin) and new."movimientoId" is not null
     and new."movimientoId" is not distinct from old."movimientoId"
     and new.monto is distinct from old.monto
     and not public.movimiento_se_puede_atar(new."movimientoId", new.id, new.monto) then
    raise exception 'Ese cobro está atado a un pago de la pasarela y ese pago no alcanza para el monto nuevo.'
      using errcode = '42501';
  end if;

  -- Otro archivo en lugar del que había (o el link de la planilla cambiado), o
  -- el monto, la moneda, el día o el monto en pesos cambiados: lo chequeado era
  -- contra lo de antes. Sin esto, quien carga el cobro podía subirle el monto
  -- después de que el director lo chequeara.
  reemplazo := (old.comprobante is not null and new.comprobante is distinct from old.comprobante)
            or (old."comprobanteLink" is not null and new."comprobanteLink" is distinct from old."comprobanteLink")
            or new.monto is distinct from old.monto
            or new.moneda is distinct from old.moneda
            or new.fecha is distinct from old.fecha
            or new."montoArs" is distinct from old."montoArs";

  if reemplazo then
    new."chequeoDirector" := null; new."chequeoDirectorPor" := null;
    new."chequeoDirectorEn" := null; new."chequeoDirectorNota" := null;
    new."chequeoFinanzas" := null; new."chequeoFinanzasPor" := null;
    new."chequeoFinanzasEn" := null; new."chequeoFinanzasNota" := null;
  else
    -- El casillero del director.
    if (new."chequeoDirector", new."chequeoDirectorNota") is distinct from (old."chequeoDirector", old."chequeoDirectorNota") then
      if not puede_dir then
        new."chequeoDirector" := old."chequeoDirector"; new."chequeoDirectorPor" := old."chequeoDirectorPor";
        new."chequeoDirectorEn" := old."chequeoDirectorEn"; new."chequeoDirectorNota" := old."chequeoDirectorNota";
      elsif new."chequeoDirector" is null then
        new."chequeoDirectorPor" := null; new."chequeoDirectorEn" := null; new."chequeoDirectorNota" := null;
      else
        new."chequeoDirectorPor" := yo; new."chequeoDirectorEn" := now();
      end if;
    else
      new."chequeoDirectorPor" := old."chequeoDirectorPor"; new."chequeoDirectorEn" := old."chequeoDirectorEn";
    end if;

    -- El casillero de finanzas.
    if (new."chequeoFinanzas", new."chequeoFinanzasNota") is distinct from (old."chequeoFinanzas", old."chequeoFinanzasNota") then
      if not puede_fin then
        new."chequeoFinanzas" := old."chequeoFinanzas"; new."chequeoFinanzasPor" := old."chequeoFinanzasPor";
        new."chequeoFinanzasEn" := old."chequeoFinanzasEn"; new."chequeoFinanzasNota" := old."chequeoFinanzasNota";
      elsif new."chequeoFinanzas" is null then
        new."chequeoFinanzasPor" := null; new."chequeoFinanzasEn" := null; new."chequeoFinanzasNota" := null;
      else
        new."chequeoFinanzasPor" := yo; new."chequeoFinanzasEn" := now();
      end if;
    else
      new."chequeoFinanzasPor" := old."chequeoFinanzasPor"; new."chequeoFinanzasEn" := old."chequeoFinanzasEn";
    end if;
  end if;

  -- El sí/no de antes: con otro comprobante vuelve a pendiente (salvo el cobro
  -- atado a la pasarela); y sólo lo cambian el director y finanzas.
  if reemplazo and new."movimientoId" is null then
    new.chequeado := null;
  elsif new.chequeado is distinct from old.chequeado and not (puede_dir or puede_fin) and not soltado then
    new.chequeado := old.chequeado;
  end if;

  return new;
end;
$$;

drop trigger if exists control_cruzado_pagos on public.pagos;
create trigger control_cruzado_pagos
  before insert or update on public.pagos
  for each row execute function public.control_cruzado_pagos();

-- ---------- 4. el candado de un cobro ----------

create or replace function public.pagos_candado_de_cobro()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  motivo text;
  casilleros text[] := array['chequeoDirector', 'chequeoDirectorPor', 'chequeoDirectorEn', 'chequeoDirectorNota',
                             'chequeoFinanzas', 'chequeoFinanzasPor', 'chequeoFinanzasEn', 'chequeoFinanzasNota',
                             'cargadoPor'];
begin
  -- Sin sesión de una persona (clave de servicio, editor de SQL): tal cual.
  if coalesce(auth.jwt() ->> 'email', '') = '' then
    return coalesce(new, old);
  end if;
  -- Finanzas y los dueños corrigen siempre.
  if coalesce((select public.es_dueno()), false) or coalesce((select public.nivel_area('finanzas')), 0) >= 2 then
    return coalesce(new, old);
  end if;

  if old."chequeoFinanzas" = 'chequeado' then
    motivo := 'Finanzas ya lo chequeó';
  elsif public.mes_de_cobro_cerrado(old.fecha) then
    motivo := 'la liquidación de ese mes ya se cerró y la comisión ya no se recalcula';
  end if;
  if motivo is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Este cobro ya no se puede borrar: %.', motivo using errcode = '42501';
  end if;
  -- Sólo se dejan pasar los casilleros del control cruzado (los filtra
  -- control_cruzado_pagos); cualquier otro cambio se frena.
  if (to_jsonb(new) - casilleros) is distinct from (to_jsonb(old) - casilleros) then
    raise exception 'Este cobro ya no se puede corregir: %.', motivo using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists pagos_candado_de_cobro on public.pagos;
create trigger pagos_candado_de_cobro
  before update or delete on public.pagos
  for each row execute function public.pagos_candado_de_cobro();

notify pgrst, 'reload schema';

-- ---------- diagnóstico ----------
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'movimientos'
     and policyname in ('ver_movimientos_ventas', 'editar_movimientos_ventas'))                  as politicas_de_2,
  (select count(*) from pg_trigger where not tgisinternal
     and tgname in ('movimientos_guarda_de_ventas', 'pagos_candado_de_cobro', 'control_cruzado_pagos')) as triggers_de_3,
  (select count(*) from pg_proc where proname in ('movimiento_libre', 'movimiento_se_puede_atar', 'mes_de_cobro_cerrado')
     and pronamespace = 'public'::regnamespace)                                                  as funciones_de_3;
