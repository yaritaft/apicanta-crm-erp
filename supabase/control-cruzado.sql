-- Control cruzado de los cobros — Apicanta ERP (reunión del 02/10, F1-03)
--
-- Yari: «el closer tiene que cargar, pero se va a equivocar: después alguien
-- más revisa que el comprobante coincida con lo cargado». Cada cobro (una
-- fila de `pagos`) lo chequean dos casilleros separados, el del director
-- comercial y el de finanzas. Con que uno diga «chequeado» alcanza para que el
-- cobro no quede pendiente, y cualquiera de los dos puede rechazar el
-- comprobante («este no me sirve para certificar»). Cada casillero guarda
-- quién lo hizo (el correo de su sesión), cuándo y, si rechazó, por qué: «el
-- que chequeó también es responsable».
--
--   "chequeoDirector" / "chequeoFinanzas"   null (nadie lo miró), 'chequeado' o 'rechazado'
--   "chequeoDirectorPor" / "…FinanzasPor"   el correo de quien lo hizo
--   "chequeoDirectorEn"  / "…FinanzasEn"    cuándo
--   "chequeoDirectorNota" / "…FinanzasNota" el motivo, si lo rechazó
--   "cargadoPor"                            quién cargó el cobro
--
-- El sí/no de antes (`pagos.chequeado`, de la planilla de Angelo) no se toca:
-- lo que ya estaba marcado sigue marcado (la app lo muestra como «chequeado de
-- antes»), y un cobro sin marca queda pendiente. Ningún monto cambia: chequear
-- o rechazar es sólo una marca.
--
-- El RLS no distingue columnas: quien edita los cobros (el closer, con los
-- suyos) podría editar también los chequeos. Lo frena un trigger:
--   1. Un casillero lo llena quien puede: el de finanzas, quien edita
--      Finanzas; el del director, quien edita Ventas y no ve «sólo lo suyo»
--      (el closer no). Si otro lo intenta, el casillero vuelve a como estaba:
--      no da error, para no trabar a nadie por sorpresa.
--   2. Quién y cuándo los pone la base con la sesión de quien escribe, no la
--      pantalla: nadie chequea a nombre de otro, ni cambia a mano una fecha.
--   3. Reemplazar el comprobante por otro archivo deja los chequeos en
--      pendiente: se chequeó contra el de antes. Agregar el primero no.
--   4. El sí/no de antes ya no lo marca quien carga (el tilde del closer no
--      cuenta); un cobro atado a la pasarela sí lo conserva. Y atar o desatar
--      un cobro a un movimiento ("movimientoId") es de quien concilia (el
--      director y finanzas): a quien no, la base le ignora el dato al crear el
--      cobro y le deja el de antes al corregirlo. Sin esto un closer, que no ve
--      los movimientos, escribía uno inventado y el cobro quedaba «chequeado ·
--      pasarela» sin que la plata existiera.
--   5. "cargadoPor" lo sella la base al crear el cobro y no cambia.
-- Sin sesión de una persona (la clave de servicio del servidor, el editor de
-- SQL) el trigger deja pasar todo tal cual.
--
-- Sin esto la app anda igual: los chequeos quedan sólo en el navegador de
-- quien los hace (ver columnaFaltante en store.ts). Hace falta haber corrido
-- tipos-cuenta.sql antes (usa nivel_area() y solo_lo_suyo()).
--
-- Idempotente: se puede correr de nuevo sin romper nada. Para deshacerlo:
--   drop trigger if exists control_cruzado_pagos on public.pagos;
-- (las columnas pueden quedar; sin el trigger, quien edita los cobros vuelve a
-- poder tocar los chequeos.) Se ensaya con pruebas/sql/control-cruzado.ensayo.mjs.

do $$ begin
  if to_regclass('public.pagos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla pagos.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null or to_regprocedure('public.solo_lo_suyo()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan nivel_area() y solo_lo_suyo().';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'pagos'
         and column_name in ('comprobante', 'comprobanteLink', 'chequeado', 'movimientoId', 'monto', 'moneda', 'fecha', 'montoArs')) < 8 then
    raise exception 'A pagos le faltan columnas (comprobante, comprobanteLink, chequeado, movimientoId, monto, moneda, fecha o montoArs): hay que correr antes comprobantes.sql, modelo-angelo.sql y sql/conciliacion.sql.';
  end if;
end $$;

-- ---------- las columnas ----------

alter table public.pagos
  add column if not exists "cargadoPor"          text,
  add column if not exists "chequeoDirector"     text,
  add column if not exists "chequeoDirectorPor"  text,
  add column if not exists "chequeoDirectorEn"   timestamptz,
  add column if not exists "chequeoDirectorNota" text,
  add column if not exists "chequeoFinanzas"     text,
  add column if not exists "chequeoFinanzasPor"  text,
  add column if not exists "chequeoFinanzasEn"   timestamptz,
  add column if not exists "chequeoFinanzasNota" text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_chequeo_director_ck') then
    alter table public.pagos add constraint pagos_chequeo_director_ck
      check ("chequeoDirector" is null or "chequeoDirector" in ('chequeado', 'rechazado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pagos_chequeo_finanzas_ck') then
    alter table public.pagos add constraint pagos_chequeo_finanzas_ck
      check ("chequeoFinanzas" is null or "chequeoFinanzas" in ('chequeado', 'rechazado'));
  end if;
end $$;

-- ---------- el trigger ----------

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
    -- no ata el cobro a un movimiento (no los ve ni puede saber si existe):
    -- eso lo hace la conciliación, con el director o finanzas.
    if not (puede_dir or puede_fin) then
      new."movimientoId" := null;
      new.chequeado := null;
    end if;
    return new;
  end if;

  -- UPDATE
  new."cargadoPor" := old."cargadoPor";

  -- Atar o desatar el cobro a un movimiento lo hace quien concilia; a los
  -- demás les queda el de antes (no da error, igual que los casilleros).
  if not (puede_dir or puede_fin) then
    new."movimientoId" := old."movimientoId";
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
  elsif new.chequeado is distinct from old.chequeado and not (puede_dir or puede_fin) then
    new.chequeado := old.chequeado;
  end if;

  return new;
end;
$$;

drop trigger if exists control_cruzado_pagos on public.pagos;
create trigger control_cruzado_pagos
  before insert or update on public.pagos
  for each row execute function public.control_cruzado_pagos();

-- Que la API vea las columnas nuevas ya.
notify pgrst, 'reload schema';

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'pagos'
      and column_name in ('cargadoPor', 'chequeoDirector', 'chequeoDirectorPor', 'chequeoDirectorEn', 'chequeoDirectorNota',
                          'chequeoFinanzas', 'chequeoFinanzasPor', 'chequeoFinanzasEn', 'chequeoFinanzasNota'))  as columnas_de_9,
  (select count(*) from pg_trigger
    where tgname = 'control_cruzado_pagos' and not tgisinternal)                                                     as trigger_de_1,
  (select count(*) from public.pagos where coalesce(chequeado, false))                                              as marcados_de_antes,
  (select count(*) from public.pagos
    where not coalesce(chequeado, false) and "chequeoDirector" is null and "chequeoFinanzas" is null)               as pendientes_de_chequeo;

-- Opcional, a mano y sólo si se quiere: que la lista de pendientes arranque
-- con lo nuevo y no con toda la historia. Da por chequeados «de antes» los
-- cobros anteriores a una fecha que no están atados a la pasarela. No toca
-- ningún monto. Se cambia la fecha y se saca el comentario:
--
-- update public.pagos set chequeado = true
--   where coalesce(chequeado, false) = false and "movimientoId" is null and fecha < '2026-10-01';
