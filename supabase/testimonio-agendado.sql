-- ==================================================================
-- El testimonio agendado llega solo a la ficha y a la lista (Lili, 27/10).
--
-- Pablo Andrés Ascencao agendó su llamada de testimonio con Yari y en su ficha («Testimonio») y en la lista de testimonios
-- seguía «Pendiente de agendar»: lo de la ficha sólo se actualizaba DESPUÉS de la llamada, cuando el closer cargaba «Grabó»
-- (supabase/resells-testimonio.sql). Ahora, apenas la llamada entra a la agenda de resells como caso de éxito:
--   - «Follow up» pasa a «Llamada agendada»,
--   - «Fecha de grabación» es el día de la llamada y «Con quién grabó» el closer que la toma;
--   - si la llamada se cancela y era esa, vuelve a «Pendiente de agendar».
-- Se ata por el mail, como el resto. Nunca frena guardar el resell.
--
-- También:
--   - «Alumno vigente» (el pitch no corresponde porque todavía tiene contrato) pasa a decir lo que dice la tabla de testimonios:
--     «No corresponde, alumno activo» (antes caía en «No renueva»).
--   - Las llamadas de «Próximos pasos» ya no entran solas como caso de éxito (lib/resells.ts: Juan Diego Mosquera, vencido e
--     inactivo, agendó para renovar y quedó anotado como testimonio). Las cuatro que entraron así sin que nadie las tocara
--     (ni un estado cargado) y sin testimonio por grabar vuelven a «No»; Customer Success las marca si alguna lo es.
-- Se puede volver a correr.
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
  v_quien text := split_part(btrim(coalesce(new.closer, '')), ' ', 1);
begin
  if not coalesce(new."casoDeExito", false) or coalesce(new.testimonio, '') <> '' then return new; end if;
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

drop trigger if exists resells_agenda_a_testimonio on public.resells;
create trigger resells_agenda_a_testimonio after insert or update of "casoDeExito", "fechaHora", cancelada, closer on public.resells
  for each row execute function public.resell_agenda_a_testimonio();

-- El resultado del pitch: «Alumno vigente» es «No corresponde, alumno activo» (antes caía en «No renueva»).
create or replace function public.resell_testimonio_a_ficha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alumno text;
  v_tes text;
  v_estado text := lower(coalesce(new.estado, ''));
  v_resell text;
  v_dia text := to_char(new."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
begin
  if coalesce(new.testimonio, '') = '' or new.cancelada then return new; end if;
  if tg_op = 'UPDATE' and new.testimonio is not distinct from old.testimonio and new."linkTestimonio" is not distinct from old."linkTestimonio"
     and new.estado is not distinct from old.estado then return new; end if;
  begin
    select a.id into v_alumno from public.alumnos a
    where btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    if v_alumno is null then return new; end if;

    v_resell := case
      when v_estado ~ '(^|,)\s*(upgrade a hackear ia|renueva)\s*(,|$)' then 'Renueva'
      when v_estado ~ 'alumno vigente' then 'No corresponde, alumno activo'
      when v_estado ~ '(no quiere renovar|outbording|outboarding|no renueva)' then 'No renueva'
      when v_estado ~ '(seguimiento|2da agenda)' then 'Lo piensa'
      else null end;

    select id into v_tes from public.testimonios where "alumnoId" = v_alumno order by "creadoEn" desc limit 1;
    if v_tes is null then
      v_tes := 'tes_' || new.id;
      insert into public.testimonios (id, "alumnoId") values (v_tes, v_alumno) on conflict (id) do nothing;
    end if;

    update public.testimonios set
      "followUp" = case new.testimonio when 'Grabó' then 'Llamada agendada' when 'Se reagenda' then 'Pendiente de agendar' else 'No quiere grabar' end,
      "fechaGrabacion" = case when new.testimonio = 'Grabó' then v_dia else "fechaGrabacion" end,
      "conQuien" = case when new.testimonio = 'Grabó' and split_part(btrim(coalesce(new.closer, '')), ' ', 1) <> '' then split_part(btrim(new.closer), ' ', 1) else "conQuien" end,
      link = case when new.testimonio = 'Grabó' and btrim(new."linkTestimonio") <> '' then btrim(new."linkTestimonio") else link end,
      "estadoVideo" = case
        when new.testimonio = 'Grabó' and "estadoVideo" in ('', 'No quiso grabar') then 'Pendiente de subir'
        when new.testimonio = 'No quiso grabar' then 'No quiso grabar'
        else "estadoVideo" end,
      resell = case when new.testimonio = 'Se reagenda' then resell else coalesce(v_resell, resell) end
    where id = v_tes;
  exception when others then
    raise warning 'resell_testimonio_a_ficha (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.resell_testimonio_a_ficha() from public, anon, authenticated;

-- Lo que ya está cargado.
-- 1) «Alumno activo» (como venía del Airtable) es «No corresponde, alumno activo».
update public.testimonios set resell = 'No corresponde, alumno activo' where resell = 'Alumno activo';

-- 2) Las llamadas de «Próximos pasos» que entraron solas como caso de éxito, sin que Customer Success las tocara y sin testimonio por grabar.
update public.resells r set "casoDeExito" = false
where r.origen = 'calendly' and r."casoDeExito" and coalesce(r.testimonio, '') = '' and coalesce(r."actualizadoPor", '') = '' and coalesce(r.estado, '') = ''
  and exists (select 1 from public.sesiones s where s.id = r."sesionId" and s.tipo ~* 'pr.ximos pasos')
  and not exists (select 1 from public.testimonios t join public.alumnos a on a.id = t."alumnoId" where lower(btrim(a.email)) = lower(btrim(r.email)));

-- 3) Las llamadas de testimonio que ya estaban agendadas (Pablo Andrés Ascencao): se pasan a la ficha ahora.
update public.resells set "casoDeExito" = "casoDeExito" where "casoDeExito" and not cancelada and "fechaHora" >= now() - interval '1 day';

select count(*) as resells from public.resells;
