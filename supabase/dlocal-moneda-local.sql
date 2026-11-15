-- dLocal: lo que pagó la persona en su moneda — Apicanta ERP (13/11/2026)
--
-- Aldana (WhatsApp, 13/11): «sigo con el problema de que no me ponen el valor de
-- conversión en dLocal ni el monto real pagado por la persona, y sin eso no puedo
-- pasar los comprobantes a Financiera». dLocal le cobra al cliente en la moneda de
-- su país un link armado en dólares; la app sólo pedía el cambio en las cuentas en
-- pesos, así que en dLocal nunca preguntaba nada.
--
--   1. Dos columnas en pagos: "monedaLocal" (ARS, MXN, COP, PEN…) y "montoLocal"
--      (lo que pagó en esa moneda, del comprobante). "tipoCambio" pasa a ser el de
--      esa moneda (unidades por dólar). La app las pide al cargar un cobro de dLocal
--      y no deja guardar sin ellas (lib/moneda-local.ts).
--   2. El candado de un cobro que Finanzas ya chequeó deja que quien lo cargó
--      ESCRIBA esos datos si faltaban (no cambia el monto, el día ni el
--      comprobante); cambiarlos cuando ya estaban sigue siendo de Finanzas.
--   3. El control cruzado: escribir los pesos o lo de su moneda donde faltaban no
--      vuelve el cobro a pendiente; cambiarlos, sí (como antes con los pesos).
--
-- Hace falta haber corrido cobros-de-closers.sql. Idempotente.
-- Para deshacerlo: volver a correr cobros-de-closers.sql (trae las dos funciones de
-- antes) y, si se quiere, drop function public.cobro_de_dlocal(text); las columnas
-- pueden quedar (vacías no molestan).

do $$ begin
  if to_regclass('public.pagos') is null or to_regclass('public.procesadores') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan pagos o procesadores.';
  end if;
  if to_regprocedure('public.pagos_candado_de_cobro()') is null or to_regprocedure('public.control_cruzado_pagos()') is null then
    raise exception 'Primero hay que correr cobros-de-closers.sql.';
  end if;
end $$;

-- ---------- 1. las columnas ----------
alter table public.pagos add column if not exists "monedaLocal" text;
alter table public.pagos add column if not exists "montoLocal" numeric;
comment on column public.pagos."monedaLocal" is 'dLocal: la moneda en la que pagó la persona (ARS, MXN, COP, PEN…). El tipoCambio es el de esa moneda por dólar.';
comment on column public.pagos."montoLocal" is 'dLocal: lo que pagó la persona en su moneda, como dice el comprobante.';

-- ¿Es un cobro de dLocal? Security definer: el candado corre con la sesión de quien
-- corrige y no tiene por qué depender de que esa cuenta lea las cuentas recaudadoras.
create or replace function public.cobro_de_dlocal(p_proc text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select pr.proveedor = 'dlocal' from public.procesadores pr where pr.id = p_proc), false);
$$;
revoke all on function public.cobro_de_dlocal(text) from public, anon;
grant execute on function public.cobro_de_dlocal(text) to authenticated;

-- ---------- 2. el candado ----------
create or replace function public.pagos_candado_de_cobro()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- dLocal (13/11): escribir lo que pagó la persona en su moneda donde faltaba
  -- no corrige el cobro (no cambia el monto, el día ni el comprobante que se
  -- chequearon): se deja pasar. Cambiarlo cuando ya estaba, no.
  if old."montoLocal" is null and old."montoArs" is null and public.cobro_de_dlocal(old."procesadorId") then
    casilleros := casilleros || array['monedaLocal', 'montoLocal', 'tipoCambio', 'montoArs'];
  end if;
  -- Sólo se dejan pasar los casilleros del control cruzado (los filtra
  -- control_cruzado_pagos); cualquier otro cambio se frena.
  if (to_jsonb(new) - casilleros) is distinct from (to_jsonb(old) - casilleros) then
    raise exception 'Este cobro ya no se puede corregir: %.', motivo using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- ---------- 3. el control cruzado ----------
create or replace function public.control_cruzado_pagos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
            -- Los pesos o lo que pagó en su moneda (dLocal) CAMBIADOS invalidan lo
            -- chequeado; escribirlos donde faltaban no (dlocal-moneda-local.sql).
            or (old."montoArs" is not null and new."montoArs" is distinct from old."montoArs")
            or (old."montoLocal" is not null and new."montoLocal" is distinct from old."montoLocal")
            or (old."monedaLocal" is not null and new."monedaLocal" is distinct from old."monedaLocal");

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
$function$;

notify pgrst, 'reload schema';

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pagos'
     and column_name in ('monedaLocal', 'montoLocal'))                                                   as columnas_de_2,
  (select count(*) from pg_proc where proname = 'cobro_de_dlocal' and pronamespace = 'public'::regnamespace) as funcion_de_1,
  (select position('cobro_de_dlocal' in pg_get_functiondef('public.pagos_candado_de_cobro()'::regprocedure)) > 0) as candado_nuevo,
  (select position('montoLocal' in pg_get_functiondef('public.control_cruzado_pagos()'::regprocedure)) > 0)    as control_nuevo;
