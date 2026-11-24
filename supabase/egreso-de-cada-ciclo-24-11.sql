-- =====================================================================
-- El fin del programa es de UN ciclo (24/11).
--
-- Juan Ignacio Ledesma renovó a Principals el 24/11: la venta corrió su
-- inicio al 24/11, pero en su ficha quedó guardado el fin del Upgrade AI
-- (18/12). Como cae después del inicio nuevo, la app lo tomaba como «escrito
-- a mano» (la fecha definitiva) y el outboarding le iba a sacar los accesos
-- el 18/12. Lo mismo Rino (13/12) y Andrés (02/01).
--
-- LA RAÍZ: el fin guardado no decía para qué inicio se había escrito. Ahora:
--   - seguimiento_alumnos."egresoDelInicio": el inicio (día de Argentina)
--     para el que vale el fin. La app lo escribe junto con el fin y no cuenta
--     un fin cuyo inicio no es el actual (lib/clientes-cs.ts → egresoDeEsteCiclo).
--   - Cuando el inicio de un alumno avanza (renovó: la venta, el contrato o a
--     mano), el fin que no tenga marca queda sellado con el inicio anterior:
--     pase por donde pase, ya no cuenta para el ciclo nuevo.
--   - Una pestaña abierta desde antes guarda la fila entera del seguimiento:
--     si manda el mismo fin sin la marca, se conserva la marca que tenía.
--
-- Se puede correr de nuevo sin romper nada.
-- =====================================================================

alter table public.seguimiento_alumnos add column if not exists "egresoDelInicio" text;

-- El inicio avanzó: el fin sin marca es del ciclo anterior.
create or replace function public.egreso_queda_del_ciclo_anterior()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  antes date := (old.inicio at time zone 'America/Argentina/Buenos_Aires')::date;
  ahora date := (new.inicio at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if antes is null or ahora is null or ahora <= antes then return new; end if;
  update seguimiento_alumnos set "egresoDelInicio" = to_char(antes, 'YYYY-MM-DD')
   where "alumnoId" = new.id and "fechaEgreso" is not null and "egresoDelInicio" is null;
  return new;
end $$;

drop trigger if exists alumnos_egreso_del_ciclo_anterior on public.alumnos;
create trigger alumnos_egreso_del_ciclo_anterior
  after update of inicio on public.alumnos
  for each row execute function public.egreso_queda_del_ciclo_anterior();

-- Guardar la fila entera con el mismo fin y sin marca no borra la marca.
create or replace function public.seguimiento_conserva_marca_del_egreso()
returns trigger language plpgsql as $$
begin
  if new."egresoDelInicio" is null and old."egresoDelInicio" is not null
     and new."fechaEgreso" is not distinct from old."fechaEgreso" then
    new."egresoDelInicio" := old."egresoDelInicio";
  end if;
  return new;
end $$;

drop trigger if exists seguimiento_conserva_marca_del_egreso on public.seguimiento_alumnos;
create trigger seguimiento_conserva_marca_del_egreso
  before update on public.seguimiento_alumnos
  for each row execute function public.seguimiento_conserva_marca_del_egreso();

revoke all on function public.egreso_queda_del_ciclo_anterior() from public, anon, authenticated;
revoke all on function public.seguimiento_conserva_marca_del_egreso() from public, anon, authenticated;
