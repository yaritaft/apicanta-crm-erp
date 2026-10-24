-- Copia de respaldo de lo que se borra de una venta — Apicanta ERP (Aldana, 24/10/2026)
--
-- Aldana pidió poder eliminar ventas (una se cargó dos veces y cancelarla no sacaba lo cobrado: «Pagó todo
-- US$ 6.000» por una compra de US$ 3.000; otra la cargó un closer y el cliente no pagó). La app ahora tiene
-- «Eliminar venta» (sólo Finanzas y dueños; el closer no, lo traba ventas_sin_baja_del_closer). Borrar es lo único
-- que no se puede deshacer, así que la base guarda una copia de todo lo que se borra de ventas, cuotas y pagos,
-- venga de la app o de una escritura directa a la API.
--
-- Qué hace este archivo:
--
--   1. La tabla `ventas_eliminadas`: una fila por cada venta, cuota o pago que se borra, con la fila entera en JSON,
--      de qué venta era, quién la borró y cuándo. La ven sólo los dueños; nadie la escribe a mano (la llenan los
--      disparadores).
--   2. Un disparador BEFORE DELETE en `ventas`, `cuotas` y `pagos` que guarda la copia. Salta también cuando la
--      cuota se va en cascada con su venta (cuotas_ventaId_fkey) o el pago con su cuota (pagos_cuotaId_fkey).
--
-- No cambia ningún dato ni ninguna regla: sólo anota. Se puede volver a correr.
--
-- Para recuperar una venta borrada por error (lo hace alguien con acceso a la base):
--   select tabla, fila from public.ventas_eliminadas where "ventaId" = '<id de la venta>' order by id;
--   y se vuelve a insertar cada fila con jsonb_populate_record(null::public.ventas, fila) (y cuotas, pagos).
-- Para deshacer este archivo:
--   drop trigger if exists ventas_respaldo_al_borrar on public.ventas;
--   drop trigger if exists cuotas_respaldo_al_borrar on public.cuotas;
--   drop trigger if exists pagos_respaldo_al_borrar on public.pagos;
--   drop function if exists public.respaldar_lo_que_se_borra();
--   (la tabla ventas_eliminadas se conserva: es el respaldo)

do $$ begin
  if to_regclass('public.ventas') is null or to_regclass('public.cuotas') is null or to_regclass('public.pagos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan ventas, cuotas o pagos.';
  end if;
  if to_regprocedure('public.es_dueno()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta es_dueno().';
  end if;
end $$;

-- ---------- 1. la tabla ----------

create table if not exists public.ventas_eliminadas (
  id            bigserial primary key,
  tabla         text not null check (tabla in ('ventas', 'cuotas', 'pagos')),
  "registroId"  text not null,
  -- De qué venta era. Un pago que se va en cascada con su cuota puede no traerla: la cuota ya no está cuando se
  -- anota; en ese caso se recupera por el `cuotaId` de la fila.
  "ventaId"     text,
  fila          jsonb not null,
  "eliminadoEn" timestamptz not null default now(),
  "eliminadoPor" uuid
);

create index if not exists ventas_eliminadas_venta on public.ventas_eliminadas ("ventaId");

alter table public.ventas_eliminadas enable row level security;
revoke all on public.ventas_eliminadas from anon, authenticated;
grant select on public.ventas_eliminadas to authenticated;

drop policy if exists ventas_eliminadas_ver on public.ventas_eliminadas;
create policy ventas_eliminadas_ver on public.ventas_eliminadas for select to authenticated
  using (coalesce((select public.es_dueno()), false));

-- ---------- 2. la copia, venga de donde venga el borrado ----------

create or replace function public.respaldar_lo_que_se_borra()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  venta text;
begin
  if tg_table_name = 'ventas' then
    venta := old.id;
  elsif tg_table_name = 'cuotas' then
    venta := old."ventaId";
  else
    select c."ventaId" into venta from public.cuotas c where c.id = old."cuotaId";
  end if;
  insert into public.ventas_eliminadas (tabla, "registroId", "ventaId", fila, "eliminadoPor")
  values (tg_table_name, old.id, venta, to_jsonb(old), auth.uid());
  return old;
end;
$$;

drop trigger if exists ventas_respaldo_al_borrar on public.ventas;
create trigger ventas_respaldo_al_borrar before delete on public.ventas
  for each row execute function public.respaldar_lo_que_se_borra();

drop trigger if exists cuotas_respaldo_al_borrar on public.cuotas;
create trigger cuotas_respaldo_al_borrar before delete on public.cuotas
  for each row execute function public.respaldar_lo_que_se_borra();

drop trigger if exists pagos_respaldo_al_borrar on public.pagos;
create trigger pagos_respaldo_al_borrar before delete on public.pagos
  for each row execute function public.respaldar_lo_que_se_borra();
