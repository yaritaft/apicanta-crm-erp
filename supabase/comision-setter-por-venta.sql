-- Porcentaje del setter por venta — Apicanta ERP (Aldana, 31/10/2026)
--
-- Daniel (setter) se marca él mismo las agendas desde Mi panel y, desde el 24/10, la mayoría son leads del webinar a los que sólo les
-- manda un mensaje: el cierre de octubre le dio «mil y pico» al 5% de todo lo que entra de esas ventas. Aldana y Fede tienen que definir qué
-- porcentaje corresponde (o ninguno), y hoy el porcentaje es uno solo por persona (equipo."comisionRate") y por servicio.
--
-- Esta columna deja fijar el % del setter en UNA venta:
--   · vacía  — el de siempre de esa persona (no cambia ningún número);
--   · 0      — esa venta no comisiona al setter;
--   · 0.025  — un % propio (fracción: 0.05 = 5%).
-- Se usa en Finanzas, en Mi panel, en la planilla de Angelo y, en la liquidación, como un renglón aparte («Ajuste por porcentaje propio»).
--
-- Quién la cambia: los dueños y quien tiene «Liquidación: editar» (Aldana). Cualquier otro tipo de cuenta la deja como estaba: el trigger
-- se la devuelve en vez de rechazar la venta entera, porque la app guarda la fila completa y una copia vieja no tiene que romper la edición
-- de un closer. Sin sesión de una persona (la clave de servicio, el editor de SQL) pasa todo.
--
-- Sólo agrega una columna y un trigger: no cambia ningún dato ni ningún número. Se puede volver a correr. Para deshacerlo:
--   drop trigger if exists ventas_guarda_comision_setter on public.ventas;
--   drop function if exists public.ventas_guarda_comision_setter();
--   alter table public.ventas drop column if exists "comisionSetter";

do $$ begin
  if to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla ventas.';
  end if;
  if to_regprocedure('public.es_dueno()') is null or to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql y permiso-liquidacion.sql: faltan es_dueno() o nivel_area().';
  end if;
end $$;

alter table public.ventas add column if not exists "comisionSetter" numeric;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ventas_comision_setter_entre_0_y_1') then
    alter table public.ventas add constraint ventas_comision_setter_entre_0_y_1
      check ("comisionSetter" is null or ("comisionSetter" >= 0 and "comisionSetter" <= 1));
  end if;
end $$;

create or replace function public.ventas_guarda_comision_setter()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  anterior numeric;
  existe boolean;
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' then
    return new;
  end if;
  if coalesce((select public.es_dueno()), false) or coalesce((select public.nivel_area('liquidacion')), 0) >= 2 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new."comisionSetter" := old."comisionSetter";
  else
    -- Un upsert de una venta que ya existe entra por acá antes de chocar con su fila: se conserva lo que tiene.
    select true, v."comisionSetter" into existe, anterior from public.ventas v where v.id = new.id;
    new."comisionSetter" := case when coalesce(existe, false) then anterior else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists ventas_guarda_comision_setter on public.ventas;
create trigger ventas_guarda_comision_setter
  before insert or update on public.ventas
  for each row execute function public.ventas_guarda_comision_setter();
