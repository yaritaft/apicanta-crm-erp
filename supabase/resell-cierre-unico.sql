-- ==================================================================
-- Una llamada de resell se cierra con UNA regla, en la app y en la base (Mariano y Lili, 20/11).
--
-- Mariano puso «No quiere renovar» + «Outbording» a un alumno y la llamada le seguía en «por cerrar». La regla estaba bien (era
-- llamada de caso de éxito y faltaba decir si grabó el testimonio), pero:
--   1) nada en su vista decía QUÉ faltaba (eso es de la app: columna «Falta» y aviso al guardar);
--   2) el dato del testimonio vivía en dos lugares: si Lili cargaba el link en la ficha (Testimonios), la llamada no se enteraba y
--      le seguía pidiendo «si grabó» al closer (dos llamadas del 11 y el 18/11 estaban así). Ahora la ficha también escribe en la llamada;
--   3) la lista de estados que cierran un resell estaba copiada a mano en la app y en cada función. Ahora hay una sola en la base
--      (estados_que_cierran_resell) y una prueba verifica que sea igual a RESELL_RESUELTO (lib/clientes-cs.ts).
-- Y «No se presentó» (Lili, 20/11): cierra la llamada; si era de testimonio, su testimonio vuelve a «Pendiente de agendar».
--
-- Aditivo y se puede volver a correr. Requiere resell-recordar.sql y resells-vinculo-alumno.sql (alumno_de_resell). Deshacer: al final.
-- ==================================================================

-- ---------- 1. La regla ----------

/* Los estados con los que un resell queda resuelto, en minúscula y sin tildes. LA MISMA lista que RESELL_RESUELTO (lib/clientes-cs.ts):
   pruebas-estres/sql/sql-resell-cierre.test.ts falla si no coinciden. */
create or replace function public.estados_que_cierran_resell()
returns text[] language sql immutable as $$
  select array['upgrade a hackear ia', 'no quiere renovar', 'outbording', 'outboarding', 'garantia extendida', 'alumno vigente', 'renueva', 'no renueva', 'no se presento']
$$;

/* Los estados de un resell (se guardan «A, B»), en minúscula y sin tildes. */
create or replace function public.estados_de_resell(p_estado text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(btrim(translate(lower(x), 'áéíóúü', 'aeiouu'))) filter (where btrim(x) <> ''), '{}')
  from unnest(string_to_array(coalesce(p_estado, ''), ',')) x
$$;

create or replace function public.resell_resuelto(p_estado text)
returns boolean language sql immutable as $$
  select public.estados_de_resell(p_estado) && public.estados_que_cierran_resell()
$$;

create or replace function public.resell_no_se_presento(p_estado text)
returns boolean language sql immutable as $$
  select 'no se presento' = any (public.estados_de_resell(p_estado))
$$;

/* Lo que falta para cerrar la llamada, en palabras. LA MISMA regla que faltaDeLaLlamada (lib/clientes-cs.ts). */
create or replace function public.falta_de_la_llamada(r public.resells)
returns text[] language plpgsql stable as $$
declare
  v_falta text[] := '{}';
  v_dia text := to_char(r."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
begin
  if coalesce(r.testimonio, '') = 'Se reagenda' or public.resell_no_se_presento(r.estado) then return v_falta; end if;
  if coalesce(r."casoDeExito", false) and v_dia >= '2026-10-01' then
    if coalesce(r.testimonio, '') = '' then v_falta := array_append(v_falta, 'si grabó el testimonio');
    elsif r.testimonio = 'Grabó' and btrim(coalesce(r."linkTestimonio", '')) = '' then v_falta := array_append(v_falta, 'el link de la grabación'); end if;
  end if;
  if not public.resell_resuelto(r.estado) then
    v_falta := array_append(v_falta, case when btrim(coalesce(r.estado, '')) <> '' then 'en qué terminó el resell (está en «' || btrim(r.estado) || '»)' else 'si compró (el resell)' end);
  end if;
  return v_falta;
end;
$$;

-- ---------- 2. El recordatorio usa la regla (antes tenía su propia copia) ----------

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
begin
  if not public.edita('testimonios') then
    raise exception 'Sólo quien edita Alumnos puede mandar recordatorios de resells.';
  end if;
  select * into r from public.resells where id = p_resell;
  if r.id is null then raise exception 'No encuentro esa llamada.'; end if;
  if r.cancelada then raise exception 'Esa llamada se canceló: no queda nada para completar.'; end if;
  if r."fechaHora" > now() then raise exception 'Esa llamada todavía no pasó.'; end if;
  if coalesce(r.testimonio, '') = 'Se reagenda' then raise exception 'Se reagenda: la nueva agenda entra sola.'; end if;

  v_dia := to_char(r."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  v_falta := public.falta_de_la_llamada(r);
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

-- ---------- 3. Lo que se carga en la ficha del testimonio llega a la llamada ----------

/* Si el testimonio de un alumno tiene el link (o dice que no quiso grabar), la llamada de testimonio de ese alumno ESE día (±1 por la hora
   de Argentina) que todavía no dice qué pasó, lo dice: «Grabó» con el link, o «No quiso grabar». Devuelve cuántas llamadas cambió.
   Mientras escribe, marca `apicanta.llamada_desde_ficha` para que la llamada no vuelva a escribir la ficha (resell_testimonio_a_ficha) ni
   le avise a Customer Success que «el closer cerró la llamada» (avisar_resell_cerrado): lo cargó la ficha, no el closer. */
create or replace function public.llamada_desde_testimonio(t public.testimonios)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res text;
  v_dia date;
  v_n int := 0;
begin
  if coalesce(t."fechaGrabacion", '') !~ '^\d{4}-\d{2}-\d{2}' then return 0; end if;
  if btrim(coalesce(t.link, '')) <> '' then v_res := 'Grabó';
  elsif coalesce(t."followUp", '') = 'No quiere grabar' or coalesce(t."estadoVideo", '') = 'No quiso grabar' then v_res := 'No quiso grabar';
  else return 0; end if;
  v_dia := left(t."fechaGrabacion", 10)::date;
  perform set_config('apicanta.llamada_desde_ficha', '1', true);
  update public.resells r set
    testimonio = v_res,
    "linkTestimonio" = case when v_res = 'Grabó' and btrim(coalesce(r."linkTestimonio", '')) = '' then btrim(t.link) else r."linkTestimonio" end
  where r."casoDeExito" and not r.cancelada and r."fechaHora" >= '2026-10-01'
    and r."alumnoId" = t."alumnoId"
    and abs((r."fechaHora" at time zone 'America/Argentina/Buenos_Aires')::date - v_dia) <= 1
    and (coalesce(r.testimonio, '') = '' or (v_res = 'Grabó' and r.testimonio = 'Grabó' and btrim(coalesce(r."linkTestimonio", '')) = ''));
  get diagnostics v_n = row_count;
  perform set_config('apicanta.llamada_desde_ficha', '', true);
  return v_n;
exception when others then
  perform set_config('apicanta.llamada_desde_ficha', '', true);
  raise warning 'llamada_desde_testimonio (%): %', t.id, sqlerrm;
  return 0;
end;
$$;
revoke all on function public.llamada_desde_testimonio(public.testimonios) from public, anon, authenticated;

create or replace function public.testimonio_a_llamada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.link is not distinct from old.link and new."followUp" is not distinct from old."followUp"
     and new."estadoVideo" is not distinct from old."estadoVideo" and new."fechaGrabacion" is not distinct from old."fechaGrabacion" then
    return new;
  end if;
  perform public.llamada_desde_testimonio(new);
  return new;
end;
$$;
revoke all on function public.testimonio_a_llamada() from public, anon, authenticated;

drop trigger if exists testimonios_a_llamada on public.testimonios;
create trigger testimonios_a_llamada after insert or update of link, "followUp", "estadoVideo", "fechaGrabacion" on public.testimonios
  for each row execute function public.testimonio_a_llamada();

/* Las dos funciones de la llamada que escriben la ficha o avisan, saltean lo que vino de la ficha. Se agrega una línea al principio del
   cuerpo VIVO de cada una (tienen varias versiones en el repo: la que manda es la de la base). */
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['public.resell_testimonio_a_ficha()', 'public.avisar_resell_cerrado()'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    if position('apicanta.llamada_desde_ficha' in d) > 0 then continue; end if;
    if position(E'\nbegin\n' in d) = 0 then raise exception 'No encuentro el comienzo del cuerpo de %', f; end if;
    d := regexp_replace(d, E'\nbegin\n', E'\nbegin\n  if current_setting(''apicanta.llamada_desde_ficha'', true) = ''1'' then return new; end if;\n');
    execute d;
  end loop;
end $$;

-- ---------- 4. «No se presentó» en una llamada de testimonio ----------

/* No hubo llamada, así que tampoco testimonio: el que su agenda había dejado en «Llamada agendada» para ese día (sin link) vuelve a
   «Pendiente de agendar» y sin fecha, como cuando una llamada deja de ser de testimonio. Cuando vuelva a agendar, entra solo. */
create or replace function public.resell_no_se_presento_a_testimonio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia text := to_char(new."fechaHora" at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  v_alumno text;
begin
  if new.cancelada or not coalesce(new."casoDeExito", false) or coalesce(new.testimonio, '') <> '' or v_dia < '2026-10-01' then return new; end if;
  if not public.resell_no_se_presento(new.estado) then return new; end if;
  if tg_op = 'UPDATE' and public.resell_no_se_presento(old.estado) then return new; end if;
  begin
    v_alumno := coalesce(new."alumnoId", public.alumno_de_resell(new.email, new."sesionId", new."alumnoId"));
    if v_alumno is null then return new; end if;
    update public.testimonios t set "followUp" = 'Pendiente de agendar', "fechaGrabacion" = null
    where t."alumnoId" = v_alumno and left(coalesce(t."fechaGrabacion", ''), 10) = v_dia
      and btrim(coalesce(t.link, '')) = '' and coalesce(t."estadoVideo", '') in ('', 'Pendiente de subir')
      and coalesce(t."followUp", '') in ('', 'Llamada agendada', 'Agendado', 'Pendiente de agendar');
  exception when others then
    raise warning 'resell_no_se_presento_a_testimonio (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.resell_no_se_presento_a_testimonio() from public, anon, authenticated;

drop trigger if exists resells_no_se_presento_a_testimonio on public.resells;
create trigger resells_no_se_presento_a_testimonio after insert or update of estado on public.resells
  for each row execute function public.resell_no_se_presento_a_testimonio();

-- ---------- 5. Lo que ya está cargado ----------

-- Respaldo de la agenda de resells antes de pasarle lo de las fichas.
create schema if not exists respaldo;
create table if not exists respaldo.resells_2011 as select * from public.resells;

-- Los testimonios que ya tienen el link (o dicen que no quiso grabar): su llamada lo dice.
select coalesce(sum(public.llamada_desde_testimonio(t)), 0) as llamadas_completadas_desde_la_ficha
from public.testimonios t
where coalesce(t."fechaGrabacion", '') >= '2026-09-30'
  and (btrim(coalesce(t.link, '')) <> '' or coalesce(t."followUp", '') = 'No quiere grabar' or coalesce(t."estadoVideo", '') = 'No quiso grabar');

-- ---------- Deshacer ----------
-- drop trigger if exists testimonios_a_llamada on public.testimonios;
-- drop trigger if exists resells_no_se_presento_a_testimonio on public.resells;
-- drop function if exists public.testimonio_a_llamada(); drop function if exists public.llamada_desde_testimonio(public.testimonios);
-- drop function if exists public.resell_no_se_presento_a_testimonio();
-- volver a correr supabase/resell-recordar.sql (recordar_resell con su copia de la lista);
-- la línea agregada a resell_testimonio_a_ficha y avisar_resell_cerrado no molesta (sólo actúa con la marca puesta);
-- los datos: update public.resells r set testimonio = b.testimonio, "linkTestimonio" = b."linkTestimonio" from respaldo.resells_2011 b
--   where b.id = r.id and (r.testimonio, r."linkTestimonio") is distinct from (b.testimonio, b."linkTestimonio");
