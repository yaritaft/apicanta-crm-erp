-- ==================================================================
-- Outboarding es baja, siempre (Liliana, 27/11 a la tarde).
--
-- «En Alumnos, en el filtro Egresados, hay muchos alumnos que son outboarding, que están dados de baja. Que todos los que sean
-- outboarding estén como baja. Y los que me queden como egresados sin follow up, me voy a poner a verlos uno a uno.»
--
-- Por qué pasaba: el estado del alumno (activo, pausado, graduado, baja) y el Follow Up de Lili dicen lo mismo con dos campos, y
-- nadie mantenía el estado. La importación del Airtable del 19/10 marcó «graduado» a quien tenía la fecha de egreso vencida sin
-- mirar el Follow Up (83 estaban en OUTBOARDING), y la regla de la app dejaba que lo marcado a mano le ganara al Follow Up.
--
-- Lo que hace este archivo (la app hace lo mismo: lib/situacion-alumno.ts → estadoPorFollowUp):
--   1. alumno_sigue_al_follow_up: cuando el Follow Up pasa a Outboarding, el estado queda en «baja»; cuando sale de Outboarding y el
--      estado dice baja, vuelve a «activo» (salvo que su venta esté cancelada o reembolsada: esa baja es de la venta).
--   2. alumno_en_outboarding_es_baja: mientras el Follow Up diga Outboarding, nadie le escribe otro estado (una pestaña vieja que
--      guarda la fila entera, una compra nueva que lo reactiva): queda en baja hasta que se cambie el Follow Up.
--   3. Renovar saca de Outboarding (aviso de la sesión de renovaciones, 27/11): cuando la compra nueva pasa a ser el servicio
--      (ficha_del_ciclo_nuevo, renovacion-deja-la-ficha-26-11.sql), un Follow Up en Outboarding pasa a «Onboarding» —lo que hizo Lili
--      a mano con Luis Carlos J. el 26/11— y el estado vuelve a activo. Una pestaña abierta desde antes de la renovación no lo
--      devuelve a Outboarding.
--   4. Los que hoy están en Outboarding y no figuran como baja pasan a baja, con respaldo en respaldo.alumnos_outboarding_2711.
--
-- Es aditivo y no manda nada: ni mails, ni avisos, ni toca accesos (eso lo sigue haciendo el outboarding automático).
--
-- Para deshacerlo:
--   drop trigger if exists seguimiento_alumnos_estado on public.seguimiento_alumnos;
--   drop trigger if exists seguimiento_ciclo_y_outboarding on public.seguimiento_alumnos;
--   drop trigger if exists alumnos_outboarding_es_baja on public.alumnos;
--   update public.alumnos a set estado = r.estado from respaldo.alumnos_outboarding_2711 r where r.id = a.id;
-- ==================================================================

create or replace function public.es_outboarding(p text)
returns boolean
language sql
immutable
as $$
  /* Como lib/outboarding.ts → esOutboarding (y terminoElServicio): «OUTBOARDING», «Outboarding», o «Outbording» como a veces se
     escribía en el Airtable. «No renueva» NO es: todavía cursa. */
  select lower(btrim(coalesce(p, ''))) ~ '^(outboarding|outbording)'
$$;

/* La marca de la compra de la ficha (la pone renovacion-deja-la-ficha-26-11.sql; acá sólo por si este archivo corre antes). */
alter table public.seguimiento_alumnos add column if not exists "cicloDeVenta" text;

create or replace function public.alumno_sigue_al_follow_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.es_outboarding(new."followUp") then
    update alumnos set estado = 'baja' where id = new."alumnoId" and estado is distinct from 'baja';
  elsif tg_op = 'UPDATE' and public.es_outboarding(old."followUp") then
    update alumnos a set estado = 'activo'
    where a.id = new."alumnoId" and a.estado = 'baja'
      and not exists (select 1 from ventas v where v.id = a."ventaId" and v.estado in ('cancelada', 'reembolsada'));
  end if;
  return null;
end;
$$;

drop trigger if exists seguimiento_alumnos_estado on public.seguimiento_alumnos;
/* También con "cicloDeVenta": la renovación no escribe el Follow Up en su UPDATE (lo cambia el disparador de abajo), y un disparador
   «update of» sólo corre si la columna está en el UPDATE. */
create trigger seguimiento_alumnos_estado after insert or update of "followUp", "cicloDeVenta" on public.seguimiento_alumnos
  for each row execute function public.alumno_sigue_al_follow_up();

create or replace function public.ciclo_nuevo_saca_de_outboarding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new."cicloDeVenta" is distinct from old."cicloDeVenta" then
    if coalesce(current_setting('apicanta.ciclo_nuevo', true), '') <> '' then
      /* Renueva (ficha_del_ciclo_nuevo): vuelve a cursar. */
      if public.es_outboarding(new."followUp") then new."followUp" := 'Onboarding'; end if;
    elsif public.es_outboarding(new."followUp") and not public.es_outboarding(old."followUp") then
      /* Una pestaña de antes de la renovación (trae la marca de otra compra) no lo vuelve a Outboarding. */
      new."followUp" := old."followUp";
    end if;
  end if;
  return new;
end;
$$;

/* Corre antes que seguimiento_es_de_la_compra_en_curso (orden alfabético), que devuelve la marca vieja a la de la base: acá todavía
   se ve si la fila viene de la renovación o de una pestaña vieja. */
drop trigger if exists seguimiento_ciclo_y_outboarding on public.seguimiento_alumnos;
create trigger seguimiento_ciclo_y_outboarding before update on public.seguimiento_alumnos
  for each row execute function public.ciclo_nuevo_saca_de_outboarding();

create or replace function public.alumno_en_outboarding_es_baja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado is distinct from 'baja'
     and exists (select 1 from seguimiento_alumnos s where s."alumnoId" = new.id and public.es_outboarding(s."followUp")) then
    new.estado := 'baja';
  end if;
  return new;
end;
$$;

drop trigger if exists alumnos_outboarding_es_baja on public.alumnos;
create trigger alumnos_outboarding_es_baja before insert or update of estado on public.alumnos
  for each row execute function public.alumno_en_outboarding_es_baja();

revoke all on function public.alumno_sigue_al_follow_up() from public, anon, authenticated;
revoke all on function public.alumno_en_outboarding_es_baja() from public, anon, authenticated;
revoke all on function public.ciclo_nuevo_saca_de_outboarding() from public, anon, authenticated;

-- ---------- Los que hoy están en Outboarding y no figuran como baja ----------
create schema if not exists respaldo;
create table if not exists respaldo.alumnos_outboarding_2711 as
  select a.id, a.estado, s."followUp", now() as respaldado_en
  from public.alumnos a join public.seguimiento_alumnos s on s."alumnoId" = a.id
  where public.es_outboarding(s."followUp") and a.estado is distinct from 'baja';

insert into public.actividad (id, accion, actor, entidad, "entidadId", titulo, fecha, detalle)
select 'act_outboarding_baja_2711', 'actualizo', 'Apicanta', 'config', 'seguimiento', 'Seguimiento de alumnos', now(),
  count(*) || ' alumnos con el Follow Up en Outboarding pasan a baja (' || count(*) filter (where estado = 'graduado') || ' figuraban egresados, '
  || count(*) filter (where estado = 'activo') || ' activos, ' || count(*) filter (where estado not in ('graduado', 'activo')) || ' otros). '
  || 'Desde ahora pasar a Outboarding los deja en baja solos (Liliana, 27/11).'
from respaldo.alumnos_outboarding_2711
having count(*) > 0
on conflict (id) do nothing;

update public.alumnos a set estado = 'baja'
from respaldo.alumnos_outboarding_2711 r
where r.id = a.id and a.estado is distinct from 'baja';

-- Comprobación: tiene que dar 0.
select count(*) as en_outboarding_sin_baja
from public.alumnos a join public.seguimiento_alumnos s on s."alumnoId" = a.id
where public.es_outboarding(s."followUp") and a.estado is distinct from 'baja';
