-- ==================================================================
-- Lo que la agenda escribe en el testimonio, la agenda lo desescribe (Lili, 10/11: Darío Vargas «figura como testimonio y no es un
-- caso de éxito»).
--
-- Qué pasó. El 26/10 la llamada de «Próximos pasos» de Darío entró marcada como caso de éxito (por el nombre del evento, antes del
-- arreglo del 28/10) y resell_agenda_a_testimonio (supabase/testimonio-agendado.sql) le creó un testimonio a su ficha: «Llamada
-- agendada», el 28/10, con Mariano. Después Mariano cerró la llamada con «No era para testimonio» (la llamada pasó a casoDeExito =
-- false), pero el disparador sólo sabía ESCRIBIR: al dejar de ser caso de éxito se quedaba callado y el testimonio seguía ahí, en la
-- ficha, en la lista de Testimonios de Mi panel («Grabó el 28 oct con Mariano, falta el link») y en la tabla de Alumnos.
--
-- Raíz. Un dato derivado que una regla escribe sola tiene que poder retirarse cuando se corrige la fuente. Ahora, si una llamada
-- que era caso de éxito deja de serlo:
--   - el testimonio que ESA llamada había puesto («Llamada agendada» el día de la llamada, sin link ni estado de video) se retira:
--       · si lo había CREADO el disparador (id «tes_rs_…») y nadie le cargó nada más, se borra;
--       · si ya existía (Pablo Andrés Ascencao tenía el suyo «Pendiente de agendar»), vuelve a «Pendiente de agendar» y sin fecha;
--   - un testimonio con link, con estado de video o con algo cargado a mano NO se toca: eso es trabajo de una persona;
--   - si hay otra llamada activa de caso de éxito del mismo mail ese mismo día, se queda como está.
-- Nunca frena guardar la llamada (un error se avisa con warning y sigue).
--
-- Lo que ya está cargado: el testimonio de Darío (el único en toda la base en esa situación; se auditó con respaldo antes).
-- Aditivo (una función reemplazada y un respaldo). Se puede volver a correr.
-- ==================================================================

create or replace function public.resell_agenda_a_testimonio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alumno text;
  v_tes text;
  v_dia text := to_char(new."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  v_dia_antes text;
  v_quien text := split_part(btrim(coalesce(new.closer, '')), ' ', 1);
begin
  /* Dejó de ser caso de éxito: se retira lo que esta llamada había escrito en el testimonio (sólo si ya no se sostiene por otra). */
  if not coalesce(new."casoDeExito", false) then
    if tg_op = 'UPDATE' and coalesce(old."casoDeExito", false) and coalesce(old.testimonio, '') = '' then
      begin
        v_dia_antes := to_char(old."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
        select a.id into v_alumno from public.alumnos a
        where btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))
        order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;

        if v_alumno is not null and not exists (
          select 1 from public.resells o
          where o.id <> new.id and o."casoDeExito" and not o.cancelada and coalesce(o.testimonio, '') = ''
            and lower(btrim(o.email)) = lower(btrim(new.email))
            and to_char(o."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') = v_dia_antes
        ) then
          select id into v_tes from public.testimonios
          where "alumnoId" = v_alumno and "followUp" = 'Llamada agendada' and "fechaGrabacion" = v_dia_antes
            and coalesce(link, '') = '' and coalesce("estadoVideo", '') = ''
          order by "creadoEn" desc limit 1;

          if v_tes is not null then
            delete from public.testimonios
            where id = v_tes and id like 'tes\_rs\_%' escape '\'
              and coalesce(resell, '') = '' and coalesce(tecnologias, '') = '' and coalesce("situacionPrevia", '') = ''
              and coalesce("situacionActual", '') = '' and coalesce(notas, '') = '';
            if not found then
              update public.testimonios set "followUp" = 'Pendiente de agendar', "fechaGrabacion" = null where id = v_tes;
            end if;
          end if;
        end if;
      exception when others then
        raise warning 'resell_agenda_a_testimonio, retiro (%): %', new.id, sqlerrm;
      end;
    end if;
    return new;
  end if;

  if coalesce(new.testimonio, '') <> '' then return new; end if;
  begin
    select a.id into v_alumno from public.alumnos a
    where btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    if v_alumno is null then return new; end if;

    select id into v_tes from public.testimonios where "alumnoId" = v_alumno order by "creadoEn" desc limit 1;

    if new.cancelada then
      -- Si la llamada que se canceló era la que habíamos puesto, vuelve a estar por agendar.
      if v_tes is not null then
        update public.testimonios set "followUp" = 'Pendiente de agendar', "fechaGrabacion" = null
        where id = v_tes and "followUp" = 'Llamada agendada' and "fechaGrabacion" = v_dia;
      end if;
      return new;
    end if;

    -- Una llamada que ya pasó no se vuelve a «agendar»: de eso se encarga lo que carga el closer después de hablar.
    if new."fechaHora" < now() - interval '1 day' then return new; end if;

    if v_tes is null then
      v_tes := 'tes_' || new.id;
      insert into public.testimonios (id, "alumnoId") values (v_tes, v_alumno) on conflict (id) do nothing;
    end if;

    update public.testimonios set
      "followUp" = 'Llamada agendada',
      "fechaGrabacion" = v_dia,
      "conQuien" = case when v_quien <> '' then v_quien else "conQuien" end
    where id = v_tes and coalesce("followUp", '') in ('', 'Pendiente de agendar', 'No agendada', 'Llamada agendada');
  exception when others then
    raise warning 'resell_agenda_a_testimonio (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.resell_agenda_a_testimonio() from public, anon, authenticated;

-- El disparador es el mismo de siempre (se vuelve a crear por si faltara).
drop trigger if exists resells_agenda_a_testimonio on public.resells;
create trigger resells_agenda_a_testimonio after insert or update of "casoDeExito", "fechaHora", cancelada, closer on public.resells
  for each row execute function public.resell_agenda_a_testimonio();

-- ---------- Lo que ya está cargado ----------
-- Los testimonios que el disparador creó solo (id «tes_rs_<id de la llamada>»), siguen en «Llamada agendada» sin nada cargado y cuya
-- llamada ya no es caso de éxito (o se canceló), sin otra llamada del mismo mail ese día que los sostenga. Hoy: el de Darío Vargas.
create schema if not exists respaldo;
create table if not exists respaldo.testimonios_1011 as select * from public.testimonios where false;

with huerfanos as (
  select t.id
  from public.testimonios t
  join public.resells r on r.id = substr(t.id, 5)
  where t.id like 'tes\_rs\_%' escape '\'
    and (not r."casoDeExito" or r.cancelada)
    and coalesce(r.testimonio, '') = ''
    and t."followUp" = 'Llamada agendada'
    and coalesce(t.link, '') = '' and coalesce(t."estadoVideo", '') = '' and coalesce(t.resell, '') = ''
    and coalesce(t.tecnologias, '') = '' and coalesce(t."situacionPrevia", '') = '' and coalesce(t."situacionActual", '') = ''
    and coalesce(t.notas, '') = ''
    and not exists (
      select 1 from public.resells o
      where o.id <> r.id and o."casoDeExito" and not o.cancelada and coalesce(o.testimonio, '') = ''
        and lower(btrim(o.email)) = lower(btrim(r.email)) and btrim(coalesce(r.email, '')) <> ''
    )
), copia as (
  insert into respaldo.testimonios_1011
  select t.* from public.testimonios t where t.id in (select id from huerfanos)
    and not exists (select 1 from respaldo.testimonios_1011 b where b.id = t.id)
  returning id
)
delete from public.testimonios where id in (select id from huerfanos);

select count(*) as testimonios_quedan from public.testimonios;
