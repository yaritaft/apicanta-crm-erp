-- ==================================================================
-- Las llamadas de testimonio en la agenda de resells (Lili, 24/10).
--
-- Los casos de éxito graban su testimonio en una llamada (con Mariano si
-- compraron menos de 5K, con Yari si más) y en la misma llamada se les hace
-- el pitch para renovar o subir de programa. Esas llamadas entran por
-- Calendly a la agenda de resells (lib/resells.ts: el evento «Testimonio»
-- de Yari ahora también cuenta) y quedan pendientes en el panel de quien la
-- tomó hasta que carga:
--   - testimonio: «Grabó», «Se reagenda» o «No quiso grabar»;
--   - linkTestimonio: el link de la grabación;
--   - linkPitch: el link del pitch (la venta);
--   - y, como siempre, el estado (si compró qué, o si sigue activo /
--     outboarding).
-- Se puede volver a correr.
-- ==================================================================

alter table public.resells add column if not exists testimonio text not null default '';
alter table public.resells add column if not exists "linkTestimonio" text not null default '';
alter table public.resells add column if not exists "linkPitch" text not null default '';

alter table public.resells drop constraint if exists resells_testimonio;
alter table public.resells add constraint resells_testimonio check (testimonio in ('', 'Grabó', 'Se reagenda', 'No quiso grabar'));

-- Lo del testimonio pasa solo a la ficha del alumno (su Testimonio), lo cierre quien lo cierre: Mariano y el director comercial
-- no editan alumnos, así que la app no lo puede escribir por ellos. Se ata por el mail, como la agenda (lib/clientes-cs.ts,
-- filasResells). Usa el testimonio que el alumno ya tenga (el más nuevo) y, si no tiene, le crea uno con id fijo por llamada
-- (volver a cerrarla no lo duplica). Nunca frena guardar el resell.
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

    -- Cómo salió el pitch, en las palabras de la tabla de testimonios.
    v_resell := case
      when v_estado ~ '(^|,)\s*(upgrade a hackear ia|renueva)\s*(,|$)' then 'Renueva'
      when v_estado ~ '(no quiere renovar|outbording|outboarding|alumno vigente|no renueva)' then 'No renueva'
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

drop trigger if exists resells_testimonio_a_ficha on public.resells;
create trigger resells_testimonio_a_ficha after insert or update of testimonio, "linkTestimonio", estado on public.resells
  for each row execute function public.resell_testimonio_a_ficha();

select count(*) as resells from public.resells;
