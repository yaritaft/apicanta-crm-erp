-- ==================================================================
-- Testimonios completos y recordatorios (Lili, 19/11).
--
-- 1. «Resell después del testimonio» con SUS opciones: Alumno activo (no corresponde reventa: logró el objetivo con el contrato vigente),
--    Seguimiento (no sabe si renueva: 24 hs para pensar), No renueva / Outbording (terminó el contrato; si es un alumno automatizado se da de baja
--    solo) y Reservó (dejó una reserva); «Renueva» se queda para cuando compra. Antes eran «Pendiente», «Renueva», «No renueva», «Lo piensa» y
--    «No corresponde, alumno activo». La función que pasa lo que carga el closer al testimonio (resell_testimonio_a_ficha) usa los nombres nuevos,
--    y lo ya cargado con los nombres viejos (y los «Outbording» que vinieron del Airtable) se pasa a los nuevos, con respaldo. Los valores
--    sueltos del Airtable («SI - HACKEAR AI»…) no se tocan.
--
-- 2. recordar_testimonio(id): el botón «Recordar» de Mi panel. Le escribe un aviso en la campanita a quien grabó el testimonio y a quien lo
--    sigue (el director comercial si grabó un closer; Manu si grabó Yari), con lo que falta y los días que pasaron: «Liliana te recuerda que
--    falta cargar la grabación de testimonio de Mauricio Santos. Tuviste la reunión el 23/9. Urgente de completar: ya pasaron 56 días». Uno por
--    testimonio, por persona y por día. Lo puede mandar quien edita Alumnos. La lista de lo que falta es la de lib/clientes-cs.ts
--    (faltaDelTestimonio): link, resultado del resell, situación previa y actual, follow-up; desde el 1/9 (lo anterior viene del Airtable; el testimonio de Mauricio Santos es del 23/9).
--
-- Aditivo (una función reemplazada, otra nueva, un respaldo). Se puede volver a correr.
-- ==================================================================

-- ---------- 1. Las opciones del resell del testimonio ----------
do $$
declare
  v_def text;
  v_a constant text := $q$then 'No corresponde, alumno activo'$q$;
  v_b constant text := $q$then 'Lo piensa'$q$;
  v_c constant text := $q$then 'No renueva'$q$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resell_testimonio_a_ficha';
  if v_def is null then raise exception 'Falta la función resell_testimonio_a_ficha'; end if;
  if position('No renueva / Outbording' in v_def) > 0 then return; end if; -- ya aplicado
  if position(v_a in v_def) = 0 or position(v_b in v_def) = 0 or position(v_c in v_def) = 0 then
    raise exception 'La función resell_testimonio_a_ficha cambió: no encuentro los valores para reemplazarlos';
  end if;
  execute replace(replace(replace(v_def, v_a, $q$then 'Alumno activo'$q$), v_b, $q$then 'Seguimiento'$q$), v_c, $q$then 'No renueva / Outbording'$q$);
end $$;

create schema if not exists respaldo;
create table if not exists respaldo.testimonios_resell_1911 as select id, resell, now() as respaldado_en from public.testimonios where false;
insert into respaldo.testimonios_resell_1911 (id, resell)
select t.id, t.resell from public.testimonios t
where t.resell in ('Outbording', 'No renueva', 'No corresponde, alumno activo', 'Lo piensa', 'Alumno activo')
  and not exists (select 1 from respaldo.testimonios_resell_1911 r where r.id = t.id);

update public.testimonios set resell = 'No renueva / Outbording' where resell in ('Outbording', 'No renueva');
update public.testimonios set resell = 'Alumno activo' where resell = 'No corresponde, alumno activo';
update public.testimonios set resell = 'Seguimiento' where resell = 'Lo piensa';

-- ---------- 2. El recordatorio ----------
create or replace function public.recordar_testimonio(p_testimonio text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.testimonios;
  a public.alumnos;
  v_mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_yo text;
  v_yo_corto text;
  v_dia text;
  v_dias int;
  v_falta text[] := '{}';
  v_quien text;
  v_resp public.equipo;
  v_resp_corto text;
  v_titulo text;
  v_cuerpo text;
  v_cuando text;
  v_urgencia text;
  v_n int;
  d record;
  v_avisados text[] := '{}';
  v_nuevo boolean := false;
  v_hay boolean := false;
  c_manu constant text := 'eq_muexnypwe579r';
begin
  if not public.edita('testimonios') then
    raise exception 'Sólo quien edita Alumnos puede mandar recordatorios de testimonios.';
  end if;
  select * into t from public.testimonios where id = p_testimonio;
  if t.id is null then raise exception 'No encuentro ese testimonio.'; end if;
  select * into a from public.alumnos where id = t."alumnoId";
  v_quien := split_part(btrim(coalesce(t."conQuien", '')), ' ', 1);

  -- Lo que falta: la misma lista que faltaDelTestimonio (lib/clientes-cs.ts).
  v_dia := left(coalesce(t."fechaGrabacion", ''), 10);
  if coalesce(t."followUp", '') in ('No quiere grabar', 'No se graba, porque no se concretó') or coalesce(t."estadoVideo", '') = 'No quiso grabar' then
    raise exception 'Ese testimonio no se va a grabar: no queda nada para completar.';
  end if;
  if v_dia !~ '^\d{4}-\d{2}-\d{2}$' or v_dia < '2026-09-01' or v_dia > to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') then
    raise exception 'Todavía no hay una grabación para reclamar (sin fecha, futura o anterior a septiembre).';
  end if;
  if btrim(coalesce(t.link, '')) = '' then v_falta := array_append(v_falta, 'el link de la grabación'); end if;
  if btrim(coalesce(t.resell, '')) = '' then v_falta := array_append(v_falta, 'el resultado del resell'); end if;
  if btrim(coalesce(t."situacionPrevia", '')) = '' and btrim(coalesce(t."situacionActual", '')) = '' then v_falta := array_append(v_falta, 'su situación previa y actual');
  elsif btrim(coalesce(t."situacionPrevia", '')) = '' then v_falta := array_append(v_falta, 'su situación previa');
  elsif btrim(coalesce(t."situacionActual", '')) = '' then v_falta := array_append(v_falta, 'su situación actual'); end if;
  if btrim(coalesce(t."followUp", '')) = '' then v_falta := array_append(v_falta, 'el follow-up'); end if;
  if coalesce(array_length(v_falta, 1), 0) = 0 then raise exception 'Ese testimonio ya está completo.'; end if;

  select coalesce(nullif(btrim(u.nombre), ''), 'Customer Success') into v_yo from public.usuarios_permitidos u where lower(btrim(u.email)) = v_mail limit 1;
  v_yo := coalesce(v_yo, 'Customer Success');
  v_yo_corto := split_part(v_yo, ' ', 1);
  v_dias := (now() at time zone 'America/Argentina/Buenos_Aires')::date - v_dia::date;
  v_cuando := to_char(v_dia::date, 'FMDD/FMMM');
  v_urgencia := case when v_dias >= 7 then 'Urgente de completar: ya pasaron ' else 'Ya pasaron ' end || v_dias || case when v_dias = 1 then ' día' else ' días' end;

  select * into v_resp from public.equipo e
  where coalesce(e.activo, true) and v_quien <> '' and lower(split_part(btrim(e.nombre), ' ', 1)) = lower(v_quien) order by e.id limit 1;
  v_resp_corto := coalesce(nullif(split_part(btrim(coalesce(v_resp.nombre, v_quien)), ' ', 1), ''), 'quien grabó');

  -- A quién: quien grabó (con su mail de Equipo y el de su cuenta, como las menciones) y quien lo sigue (Manu si grabó Yari; si no, el director).
  for d in
    select m.email, e.nombre, (e.id = v_resp.id) as es_resp
    from public.equipo e
    cross join lateral (
      select e.email union
      select u.email from public.usuarios_permitidos u
      where lower(btrim(u.nombre)) = lower(btrim(e.nombre)) or lower(btrim(u.nombre)) like lower(btrim(e.nombre)) || ' %'
    ) m(email)
    where coalesce(e.activo, true) and coalesce(m.email, '') like '%@%'
      and (e.id = v_resp.id
           or (v_resp.id = 'eq_yari' and e.id = c_manu)
           or (coalesce(v_resp.id, '') <> 'eq_yari' and e.rol = 'director'))
  loop
    continue when lower(btrim(d.email)) = v_mail;
    v_hay := true;
    if d.es_resp then
      v_titulo := v_yo_corto || ' te recuerda que falta cargar la grabación de testimonio de ' || a.nombre;
      v_cuerpo := 'Tuviste la reunión el ' || v_cuando || '. ' || v_urgencia || '. Falta ' || array_to_string(v_falta, ', ') || '.';
    else
      v_titulo := v_yo_corto || ' le recuerda a ' || v_resp_corto || ' que falta cargar el testimonio de ' || a.nombre;
      v_cuerpo := 'La reunión fue el ' || v_cuando || '. ' || v_urgencia || '. Falta ' || array_to_string(v_falta, ', ') || '. Ayudá con el seguimiento de que se complete.';
    end if;
    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "deEmail", "contactoId", persona)
    values ('av_tes_' || substr(md5(t.id || ':' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD') || ':' || lower(btrim(d.email))), 1, 20),
            lower(btrim(d.email)), 'testimonio-pendiente', v_titulo, v_cuerpo, v_yo, v_mail, a.id, a.nombre)
    on conflict (id) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_nuevo := true;
      if not (split_part(btrim(d.nombre), ' ', 1) = any (v_avisados)) then v_avisados := array_append(v_avisados, split_part(btrim(d.nombre), ' ', 1)); end if;
    end if;
  end loop;

  return jsonb_build_object('avisados', to_jsonb(v_avisados), 'yaHoy', v_hay and not v_nuevo);
end;
$$;
revoke all on function public.recordar_testimonio(text) from public, anon;
grant execute on function public.recordar_testimonio(text) to authenticated;

select count(*) filter (where resell = 'No renueva / Outbording') as no_renueva, count(*) filter (where resell = 'Alumno activo') as activo,
  (select count(*) from respaldo.testimonios_resell_1911) as respaldados from public.testimonios;
