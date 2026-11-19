-- ==================================================================
-- «Recordar» también en las llamadas de resell (Lili, 19/11: «botón recordar: el closer y Santi»).
--
-- El botón de Mi panel para los testimonios sin completar (supabase/testimonio-completo.sql) ahora sirve igual para una llamada de resell
-- que ya pasó y no dice en qué quedó. Le escribe un aviso en la campanita a quien la tomó (el closer de la agenda) y a quien lo sigue: el
-- director comercial si la tomó un closer, Manu si la tomó Yari; con la fecha y los días que pasaron. Uno por llamada, por persona y por día.
--
-- Raíz: «a quién se le recuerda» estaba escrito adentro de recordar_testimonio. Ahora vive en destinos_de_recordatorio() y lo usan las dos
-- (la de testimonios se reemplaza para usarla; hace lo mismo que antes).
--
-- «Qué falta» de la llamada es la misma regla que faltaDeLaLlamada (lib/clientes-cs.ts): si grabó el testimonio y el link (si era caso de
-- éxito desde octubre) y en qué terminó el resell (alguno de los estados que la cierran). Lo puede mandar quien edita Alumnos.
--
-- Aditivo (una función nueva, otra reemplazada). Se puede volver a correr. Requiere testimonio-completo.sql.
-- ==================================================================

create or replace function public.destinos_de_recordatorio(p_quien text)
returns table (email text, nombre text, es_resp boolean, resp_corto text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_quien text := split_part(split_part(btrim(coalesce(p_quien, '')), ',', 1), ' ', 1);
  v_resp public.equipo;
  v_corto text;
  c_manu constant text := 'eq_muexnypwe579r';
begin
  select * into v_resp from public.equipo e
  where coalesce(e.activo, true) and v_quien <> '' and lower(split_part(btrim(e.nombre), ' ', 1)) = lower(v_quien) order by e.id limit 1;
  v_corto := coalesce(nullif(split_part(btrim(coalesce(v_resp.nombre, v_quien)), ' ', 1), ''), 'quien lo tomó');
  -- Quien lo tomó (con su mail de Equipo y el de su cuenta, como las menciones) y quien lo sigue (Manu si es Yari; si no, el director).
  return query
  select distinct lower(btrim(m.email)), e.nombre, (e.id = v_resp.id), v_corto
  from public.equipo e
  cross join lateral (
    select e.email union
    select u.email from public.usuarios_permitidos u
    where lower(btrim(u.nombre)) = lower(btrim(e.nombre)) or lower(btrim(u.nombre)) like lower(btrim(e.nombre)) || ' %'
  ) m(email)
  where coalesce(e.activo, true) and coalesce(m.email, '') like '%@%'
    and (e.id = v_resp.id
         or (v_resp.id = 'eq_yari' and e.id = c_manu)
         or (coalesce(v_resp.id, '') <> 'eq_yari' and e.rol = 'director'));
end;
$$;
revoke all on function public.destinos_de_recordatorio(text) from public, anon, authenticated;

-- El recordatorio de testimonios, con la misma lista de destinatarios.
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
  v_titulo text;
  v_cuerpo text;
  v_cuando text;
  v_urgencia text;
  v_n int;
  d record;
  v_avisados text[] := '{}';
  v_nuevo boolean := false;
  v_hay boolean := false;
begin
  if not public.edita('testimonios') then
    raise exception 'Sólo quien edita Alumnos puede mandar recordatorios de testimonios.';
  end if;
  select * into t from public.testimonios where id = p_testimonio;
  if t.id is null then raise exception 'No encuentro ese testimonio.'; end if;
  select * into a from public.alumnos where id = t."alumnoId";

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

  for d in select * from public.destinos_de_recordatorio(t."conQuien")
  loop
    continue when d.email = v_mail;
    v_hay := true;
    if d.es_resp then
      v_titulo := v_yo_corto || ' te recuerda que falta cargar la grabación de testimonio de ' || a.nombre;
      v_cuerpo := 'Tuviste la reunión el ' || v_cuando || '. ' || v_urgencia || '. Falta ' || array_to_string(v_falta, ', ') || '.';
    else
      v_titulo := v_yo_corto || ' le recuerda a ' || d.resp_corto || ' que falta cargar el testimonio de ' || a.nombre;
      v_cuerpo := 'La reunión fue el ' || v_cuando || '. ' || v_urgencia || '. Falta ' || array_to_string(v_falta, ', ') || '. Ayudá con el seguimiento de que se complete.';
    end if;
    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "deEmail", "contactoId", persona)
    values ('av_tes_' || substr(md5(t.id || ':' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD') || ':' || d.email), 1, 20),
            d.email, 'testimonio-pendiente', v_titulo, v_cuerpo, v_yo, v_mail, a.id, a.nombre)
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

-- El recordatorio de una llamada de resell sin cerrar.
create or replace function public.recordar_resell(p_resell text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.resells;
  v_mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_yo text;
  v_yo_corto text;
  v_dia text;
  v_dias int;
  v_falta text[] := '{}';
  v_nombre text;
  v_titulo text;
  v_cuerpo text;
  v_cuando text;
  v_urgencia text;
  v_n int;
  d record;
  v_avisados text[] := '{}';
  v_nuevo boolean := false;
  v_hay boolean := false;
  v_resuelto boolean;
begin
  if not public.edita('testimonios') then
    raise exception 'Sólo quien edita Alumnos puede mandar recordatorios de resells.';
  end if;
  select * into r from public.resells where id = p_resell;
  if r.id is null then raise exception 'No encuentro esa llamada.'; end if;
  if r.cancelada then raise exception 'Esa llamada se canceló: no queda nada para completar.'; end if;
  if r."fechaHora" > now() then raise exception 'Esa llamada todavía no pasó.'; end if;
  if coalesce(r.testimonio, '') = 'Se reagenda' then raise exception 'Se reagenda: la nueva agenda entra sola.'; end if;

  -- Lo que falta: la misma regla que faltaDeLaLlamada (lib/clientes-cs.ts).
  v_dia := to_char(r."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  if coalesce(r."casoDeExito", false) and v_dia >= '2026-10-01' then
    if coalesce(r.testimonio, '') = '' then v_falta := array_append(v_falta, 'si grabó el testimonio');
    elsif r.testimonio = 'Grabó' and btrim(coalesce(r."linkTestimonio", '')) = '' then v_falta := array_append(v_falta, 'el link de la grabación'); end if;
  end if;
  select exists (
    select 1 from unnest(string_to_array(coalesce(r.estado, ''), ',')) x
    where btrim(translate(lower(x), 'áéíóú', 'aeiou')) = any (array['upgrade a hackear ia', 'no quiere renovar', 'outbording', 'outboarding', 'garantia extendida', 'alumno vigente', 'renueva', 'no renueva'])
  ) into v_resuelto;
  if not v_resuelto then
    v_falta := array_append(v_falta, case when btrim(coalesce(r.estado, '')) <> '' then 'en qué terminó el resell (está en «' || btrim(r.estado) || '»)' else 'si compró (el resell)' end);
  end if;
  if coalesce(array_length(v_falta, 1), 0) = 0 then raise exception 'Esa llamada ya está completa.'; end if;

  v_nombre := coalesce(nullif(btrim(r.nombre), ''), (select a.nombre from public.alumnos a where a.id = r."alumnoId"), 'un alumno');
  select coalesce(nullif(btrim(u.nombre), ''), 'Customer Success') into v_yo from public.usuarios_permitidos u where lower(btrim(u.email)) = v_mail limit 1;
  v_yo := coalesce(v_yo, 'Customer Success');
  v_yo_corto := split_part(v_yo, ' ', 1);
  v_dias := (now() at time zone 'America/Argentina/Buenos_Aires')::date - v_dia::date;
  v_cuando := to_char(v_dia::date, 'FMDD/FMMM');
  v_urgencia := case when v_dias >= 7 then 'Urgente de completar: ya pasaron ' else 'Ya pasaron ' end || v_dias || case when v_dias = 1 then ' día' else ' días' end;

  for d in select * from public.destinos_de_recordatorio(r.closer)
  loop
    continue when d.email = v_mail;
    v_hay := true;
    if d.es_resp then
      v_titulo := v_yo_corto || ' te recuerda que falta cargar cómo salió la llamada de resell de ' || v_nombre;
      v_cuerpo := 'La llamada fue el ' || v_cuando || '. ' || v_urgencia || '. Falta: ' || array_to_string(v_falta, ', ') || '.';
    else
      v_titulo := v_yo_corto || ' le recuerda a ' || d.resp_corto || ' que falta cargar la llamada de resell de ' || v_nombre;
      v_cuerpo := 'La llamada fue el ' || v_cuando || '. ' || v_urgencia || '. Falta: ' || array_to_string(v_falta, ', ') || '. Ayudá con el seguimiento de que se complete.';
    end if;
    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "deEmail", "contactoId", persona)
    values ('av_res_' || substr(md5(r.id || ':' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD') || ':' || d.email), 1, 20),
            d.email, 'resell-pendiente', v_titulo, v_cuerpo, v_yo, v_mail, coalesce(r."alumnoId", r."contactoId"), v_nombre)
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
revoke all on function public.recordar_resell(text) from public, anon;
grant execute on function public.recordar_resell(text) to authenticated;

select to_regprocedure('public.recordar_resell(text)') is not null as resell, to_regprocedure('public.destinos_de_recordatorio(text)') is not null as destinos;
