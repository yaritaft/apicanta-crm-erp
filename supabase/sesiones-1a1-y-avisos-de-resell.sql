-- ==================================================================
-- Lo que dependía de que alguien se acordara (Lili, 03–05/11).
--
-- 1) La sesión 1 a 1 que se agenda por Calendly llega sola a la ficha del alumno (Servicio → Bonos) y le avisa al mentor.
--    Mariano Andrés Baliño agendó con Yari (calendly.com/yari-taft/sesion-1-a-1) para el 16/11 y en su ficha no apareció: las
--    sesiones 1 a 1 (`seguimiento_alumnos."sesionesUnoAUno"`, supabase/sesiones-uno-a-uno.sql) sólo se cargaban a mano, y nada
--    leía la agenda. Ahora, cada vez que una llamada de un evento «1 a 1» entra o cambia (webhook, cron o a mano):
--      - se anota en la ficha del alumno de ese mail, con el día, con quién (el anfitrión) y la llamada (`sesionId`);
--      - si Lili ya la había anotado a mano ese día, se usa ésa (no se duplica);
--      - si se reprograma, se mueve; si se cancela y nadie le escribió notas ni grabación, se saca;
--      - el mentor (Yari, Nahuel…) recibe un aviso en la campanita; si no hay alumno con ese mail, también Customer Success.
--    Una pestaña vieja que guarda la ficha sin la sesión no la borra (guarda `seguimiento_alumnos_1a1_guarda`): una sesión de
--    Calendly que sigue agendada sólo sale cancelándola.
--
-- 2) Cuando el closer cierra una llamada de resell o de testimonio, Customer Success recibe un aviso con cómo salió. Si no
--    renueva (Outboarding) y es un alumno viejo —la app nunca le dio los accesos—, el aviso le dice que se los saque a mano.
--
-- 3) Un testimonio que se grabó con el closer y no tiene el link deja la llamada pendiente en el panel del closer hasta que lo
--    cargue (Jean Camacho: grabó con Mariano el 14/10, la llamada decía «No quiere renovar» y como no estaba marcada «Caso de
--    éxito» el panel no le pedía el link). La llamada de ese día pasa a «Caso de éxito» y `resellAbierto` (lib/clientes-cs.ts)
--    la deja abierta hasta «Grabó» con el link, «No quiso grabar» o «Se reagenda». Y al cerrarla, lo cargado va al testimonio
--    de ESE día (había dos con el mismo «creado»: la base elegía cualquiera).
--
-- Aditivo y se puede volver a correr. Deshacer: al final del archivo.
-- ==================================================================

-- ---------- 1. Sesiones 1 a 1 ----------

/* El evento «Sesión 1 a 1» (y cualquiera que diga 1 a 1, 1:1, 1-a-1 o uno a uno). Mismo criterio que esSesionUnoAUno (lib/bonos.ts). */
create or replace function public.es_sesion_uno_a_uno(p_tipo text, p_titulo text)
returns boolean
language sql
immutable
as $$
  select translate(lower(coalesce(p_tipo, '') || ' ' || coalesce(p_titulo, '')), 'áéíóúü', 'aeiouu')
    ~ '((^|[^0-9])1\s*(a|:|-a-|-)\s*1([^0-9]|$)|uno a uno)';
$$;

/* «lunes 16/11 a las 15:00» en hora de Argentina. */
create or replace function public.dia_y_hora_ar(p timestamptz)
returns text
language sql
immutable
as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from p at time zone 'America/Argentina/Buenos_Aires')::int + 1]
    || ' ' || to_char(p at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI');
$$;

/* Los mails de una persona del equipo por su nombre de pila (el anfitrión de Calendly es «Yari Taft»; Yari entra con dos). */
create or replace function public.mails_de_la_persona(p_nombre text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct lower(btrim(x.email)) from (
    select q.email from public.equipo q where q.activo and lower(split_part(btrim(q.nombre), ' ', 1)) = lower(split_part(btrim(coalesce(p_nombre, '')), ' ', 1))
    union all
    select u.email from public.usuarios_permitidos u where lower(split_part(btrim(coalesce(u.nombre, '')), ' ', 1)) = lower(split_part(btrim(coalesce(p_nombre, '')), ' ', 1))
  ) x
  where btrim(coalesce(p_nombre, '')) <> '' and btrim(coalesce(x.email, '')) like '%@%';
$$;

/* Los mails de Customer Success (como el aviso de outboarding, lib/outboarding-servidor.ts). */
create or replace function public.mails_de_servicio()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct lower(btrim(q.email)) from public.equipo q
  where q.activo and btrim(coalesce(q.email, '')) like '%@%'
    and (q.puesto ilike '%customer success%' or q.puesto ilike '%servicio%' or q.puesto ilike '%csm%');
$$;

create or replace function public.anotar_sesion_uno_a_uno(s public.sesiones, p_avisar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alumno text; v_lead text; v_nombre text;
  v_dia text := to_char(s.inicia at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  v_con text := coalesce(nullif(split_part(btrim(coalesce(s.anfitrion, '')), ' ', 1), ''), 'Mentor');
  v_antes jsonb; v_lista jsonb; v_previa jsonb; v_nueva jsonb;
  v_incluidas int; v_tomadas int;
  v_titulo text; v_cuerpo text; v_tipo_aviso text;
begin
  select a.id, a."leadId", a.nombre into v_alumno, v_lead, v_nombre from public.alumnos a
  where (btrim(coalesce(s.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(s.email)))
     or (s."leadId" is not null and a."leadId" = s."leadId")
  order by (a.estado = 'activo') desc, a.inicio desc nulls last
  limit 1;

  if v_alumno is not null then
    insert into public.seguimiento_alumnos (id, "alumnoId") values ('seg_' || v_alumno, v_alumno) on conflict do nothing;
    select "sesionesUnoAUno", "sesionesMentor" into v_antes, v_incluidas from public.seguimiento_alumnos where "alumnoId" = v_alumno limit 1 for update;
    v_antes := coalesce(v_antes, '[]'::jsonb);
    v_lista := v_antes;

    -- La de esta llamada; si no, la de la llamada que reprogramó; si no, una del mentor que Lili anotó a mano ese mismo día.
    select e into v_previa from jsonb_array_elements(v_lista) e where e->>'sesionId' = s.id limit 1;
    if v_previa is null and s."reprogramadaDe" is not null then
      select e into v_previa from jsonb_array_elements(v_lista) e where e->>'sesionId' = s."reprogramadaDe" limit 1;
    end if;
    if v_previa is null then
      select e into v_previa from jsonb_array_elements(v_lista) e
      where coalesce(e->>'sesionId', '') = '' and e->>'fecha' = v_dia and lower(btrim(coalesce(e->>'con', ''))) not like 'lili%' limit 1;
    end if;

    if s.estado = 'cancelada' then
      -- Se saca la de ESTA llamada si nadie le escribió nada; con notas o grabación queda, y la decide Customer Success.
      if v_previa is not null and v_previa->>'sesionId' = s.id and btrim(coalesce(v_previa->>'notas', '')) = '' and btrim(coalesce(v_previa->>'grabacion', '')) = '' then
        select coalesce(jsonb_agg(e), '[]'::jsonb) into v_lista from jsonb_array_elements(v_antes) e where e->>'id' <> v_previa->>'id';
      end if;
    else
      v_nueva := coalesce(v_previa, jsonb_build_object(
          'id', 'ses1a1_' || s.id, 'notas', '', 'grabacion', '',
          'creadoEn', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'creadoPor', 'Calendly'))
        || jsonb_build_object('fecha', v_dia, 'sesionId', s.id,
          'con', case when v_previa is null or lower(btrim(coalesce(v_previa->>'con', ''))) in ('', 'mentor') then v_con else v_previa->>'con' end);
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_lista from jsonb_array_elements(v_antes) e where e->>'id' <> coalesce(v_previa->>'id', '');
      v_lista := v_lista || jsonb_build_array(v_nueva);
    end if;

    if v_lista is distinct from v_antes then
      /* La guarda de seguimiento_alumnos deja pasar lo que escribe esta función (mover o sacar una sesión de Calendly). */
      perform set_config('apicanta.sesiones_1a1', 'on', true);
      update public.seguimiento_alumnos set "sesionesUnoAUno" = v_lista, "actualizadoEn" = now() where "alumnoId" = v_alumno;
      perform set_config('apicanta.sesiones_1a1', 'off', true);
    end if;
  end if;

  -- El aviso: sólo de lo que todavía no pasó, y una vez por llamada y por estado.
  if not p_avisar or s.inicia < now() then return; end if;
  select count(*) into v_tomadas from jsonb_array_elements(coalesce(v_lista, '[]'::jsonb)) e where lower(btrim(coalesce(e->>'con', ''))) not like 'lili%';
  if s.estado = 'cancelada' then
    v_tipo_aviso := 'cancelada';
    v_titulo := 'Se canceló la sesión 1 a 1 de ' || coalesce(nullif(btrim(v_nombre), ''), nullif(btrim(s.invitado), ''), 'un alumno');
    v_cuerpo := 'Era el ' || public.dia_y_hora_ar(s.inicia) || ' (hora de Argentina).'
      || case when coalesce(s."motivoCancelacion", '') <> '' and s."motivoCancelacion" <> 'Reprogramada' then ' Motivo: ' || s."motivoCancelacion" || '.' else '' end
      || case when s."motivoCancelacion" = 'Reprogramada' then ' La reprogramó: te llega otro aviso con el día nuevo.' else '' end;
  else
    v_tipo_aviso := 'agendada-' || to_char(s.inicia at time zone 'UTC', 'YYYYMMDDHH24MI');
    v_titulo := 'Sesión 1 a 1 agendada: ' || coalesce(nullif(btrim(v_nombre), ''), nullif(btrim(s.invitado), ''), 'un alumno');
    v_cuerpo := 'El ' || public.dia_y_hora_ar(s.inicia) || ' (hora de Argentina), con ' || v_con || '.'
      || case when v_alumno is null then ' No encontramos un alumno con el mail ' || coalesce(s.email, '') || ': no quedó en ninguna ficha.'
              when v_incluidas is not null and v_incluidas > 0 then ' Es la ' || v_tomadas || ' de ' || v_incluidas || ' que incluye su contrato. Ya está en su ficha → Servicio → Bonos.'
              else ' Ya está en su ficha → Servicio → Bonos.' end;
  end if;

  insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "contactoId", persona)
  select 'av_1a1_' || s.id || '_' || v_tipo_aviso || '_' || left(md5(m), 10), m, 'sesion-1a1', v_titulo, v_cuerpo, 'Calendly',
         coalesce(v_lead, v_alumno, s."leadId"), coalesce(nullif(btrim(v_nombre), ''), s.invitado)
  from (
    select m from public.mails_de_la_persona(s.anfitrion) m
    union
    select m from public.mails_de_servicio() m where v_alumno is null
  ) x
  on conflict (id) do nothing;
end;
$$;
revoke all on function public.anotar_sesion_uno_a_uno(public.sesiones, boolean) from public, anon, authenticated;

create or replace function public.sesion_uno_a_uno_a_ficha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_sesion_uno_a_uno(new.tipo, new.titulo) then return new; end if;
  if tg_op = 'UPDATE' and new.inicia is not distinct from old.inicia and new.estado is not distinct from old.estado
     and new.email is not distinct from old.email and new.anfitrion is not distinct from old.anfitrion and new."leadId" is not distinct from old."leadId" then
    return new;
  end if;
  begin
    perform public.anotar_sesion_uno_a_uno(new, true);
  exception when others then
    -- Nunca frena guardar la llamada.
    raise warning 'sesion_uno_a_uno_a_ficha (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.sesion_uno_a_uno_a_ficha() from public, anon, authenticated;

drop trigger if exists sesiones_uno_a_uno_a_ficha on public.sesiones;
create trigger sesiones_uno_a_uno_a_ficha after insert or update of inicia, estado, email, anfitrion, "leadId", tipo, titulo on public.sesiones
  for each row execute function public.sesion_uno_a_uno_a_ficha();

/* La guarda: la app guarda la ficha de seguimiento entera, y una pestaña abierta desde antes de que entrara la sesión la
   mandaría sin ella. Una sesión de Calendly que sigue agendada vuelve a la lista; si la pestaña la mandó sin `sesionId`
   (la versión de antes de atarla), se le devuelve. Lo que escribe anotar_sesion_uno_a_uno pasa sin tocar. */
create or replace function public.seguimiento_alumnos_1a1_guarda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_lista jsonb;
begin
  if coalesce(current_setting('apicanta.sesiones_1a1', true), '') = 'on' then return new; end if;
  if new."sesionesUnoAUno" is not distinct from old."sesionesUnoAUno" then return new; end if;
  v_lista := coalesce(new."sesionesUnoAUno", '[]'::jsonb);
  for v in select e from jsonb_array_elements(coalesce(old."sesionesUnoAUno", '[]'::jsonb)) e where coalesce(e->>'sesionId', '') <> '' loop
    if exists (select 1 from jsonb_array_elements(v_lista) n where n->>'id' = v->>'id') then
      -- La misma, quizás de una pestaña vieja que no sabía de qué llamada era.
      select coalesce(jsonb_agg(case when n->>'id' = v->>'id' and coalesce(n->>'sesionId', '') = '' then n || jsonb_build_object('sesionId', v->>'sesionId') else n end), '[]'::jsonb)
        into v_lista from jsonb_array_elements(v_lista) n;
    elsif not exists (select 1 from jsonb_array_elements(v_lista) n where n->>'sesionId' = v->>'sesionId')
       and exists (select 1 from public.sesiones x where x.id = v->>'sesionId' and x.estado <> 'cancelada') then
      v_lista := v_lista || jsonb_build_array(v);
    end if;
  end loop;
  new."sesionesUnoAUno" := v_lista;
  return new;
end;
$$;
revoke all on function public.seguimiento_alumnos_1a1_guarda() from public, anon, authenticated;

drop trigger if exists seguimiento_alumnos_1a1_guarda on public.seguimiento_alumnos;
create trigger seguimiento_alumnos_1a1_guarda before update of "sesionesUnoAUno" on public.seguimiento_alumnos
  for each row execute function public.seguimiento_alumnos_1a1_guarda();

-- ---------- 2. Aviso a Customer Success cuando el closer cierra la llamada ----------

create or replace function public.avisar_resell_cerrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quien text := btrim(coalesce(new."actualizadoPor", ''));
  v_closer text := coalesce(nullif(split_part(btrim(coalesce(new.closer, '')), ' ', 1), ''), nullif(split_part(v_quien, ' ', 1), ''), 'El closer');
  v_estado text := translate(lower(coalesce(new.estado, '')), 'áéíóú', 'aeiou');
  v_sale boolean;
  v_alumno text; v_lead text; v_nombre text; v_dio int := 0;
  v_partes text[] := '{}';
begin
  if new.cancelada then return new; end if;
  if new.estado is not distinct from old.estado and new.testimonio is not distinct from old.testimonio and new."linkTestimonio" is not distinct from old."linkTestimonio" then return new; end if;
  if btrim(coalesce(new.estado, '')) = '' and btrim(coalesce(new.testimonio, '')) = '' then return new; end if;
  -- Lo cargó Customer Success misma, o una corrección o importación por SQL: no hay a quién avisarle.
  if v_quien = '' or v_quien ~* '^(correcci|import|airtable)' then return new; end if;
  if exists (select 1 from public.equipo q where q.activo and lower(btrim(q.nombre)) = lower(v_quien)
             and (q.puesto ilike '%customer success%' or q.puesto ilike '%servicio%' or q.puesto ilike '%csm%')) then
    return new;
  end if;
  begin
    v_sale := v_estado ~ '(no quiere renovar|outbording|outboarding|no renueva)';
    select a.id, a."leadId", a.nombre into v_alumno, v_lead, v_nombre from public.alumnos a
    where btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    if v_alumno is not null and to_regclass('public.accesos_alumno') is not null then
      execute 'select count(*) from public.accesos_alumno where "alumnoId" = $1 and estado in (''dado'', ''entro'', ''quitado'')' into v_dio using v_alumno;
    end if;

    if btrim(coalesce(new.estado, '')) <> '' then v_partes := v_partes || ('Resell: ' || btrim(new.estado) || '.'); end if;
    v_partes := v_partes || case new.testimonio
      when 'Grabó' then case when btrim(coalesce(new."linkTestimonio", '')) <> '' then 'Grabó el testimonio y cargó el link.'
                             else 'Grabó el testimonio; falta el link (le queda pendiente en su panel).' end
      when 'No quiso grabar' then 'No quiso grabar el testimonio.'
      when 'Se reagenda' then 'El testimonio se reagenda.'
      else null end;
    if v_sale then
      v_partes := v_partes || case
        when v_alumno is null then 'No encontramos un alumno con el mail ' || coalesce(new.email, '') || ': revisá sus accesos a mano.'
        when v_dio = 0 then 'Es alumno viejo: la app nunca le dio los accesos, así que hay que sacárselos a mano (Wisboo, Telegram y Zoom) desde su ficha → Servicio → Accesos.'
        else 'Cuando lo pases a Outboarding, la app le saca sola los accesos que le dio, el día después del fin del programa.' end;
    end if;

    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "contactoId", persona)
    select 'av_resell_' || new.id || '_' || left(md5(coalesce(new.estado, '') || '|' || coalesce(new.testimonio, '') || '|' || coalesce(new."linkTestimonio", '')), 8) || '_' || left(md5(m), 10),
           m, case when v_sale then 'resell-outboarding' else 'resell-cerrado' end,
           v_closer || ' cerró la llamada de ' || coalesce(nullif(btrim(v_nombre), ''), nullif(btrim(new.nombre), ''), 'un alumno'),
           array_to_string(v_partes, ' '), v_quien, coalesce(v_lead, v_alumno), coalesce(nullif(btrim(v_nombre), ''), new.nombre)
    from public.mails_de_servicio() m
    on conflict (id) do nothing;
  exception when others then
    raise warning 'avisar_resell_cerrado (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.avisar_resell_cerrado() from public, anon, authenticated;

drop trigger if exists resells_avisar_cerrado on public.resells;
create trigger resells_avisar_cerrado after update of estado, testimonio, "linkTestimonio" on public.resells
  for each row execute function public.avisar_resell_cerrado();

-- ---------- 3. Testimonio grabado sin link → la llamada queda pendiente para el closer ----------

/* La llamada de resell de ese alumno, ese día (±1 por la hora de Argentina) y con ese closer, que todavía no dice qué pasó con el
   testimonio. Desde octubre (TESTIMONIO_DESDE en lib/clientes-cs.ts).
   «Llamada agendada» no la marca: ese Follow Up lo pone la agenda de una llamada que YA era caso de éxito
   (resell_agenda_a_testimonio), así que si la llamada hoy dice que no, alguien eligió «No era para testimonio» y eso manda. */
create or replace function public.testimonio_pendiente_a_resell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new."fechaGrabacion", '') !~ '^\d{4}-\d{2}-\d{2}' or btrim(coalesce(new.link, '')) <> ''
     or coalesce(new."estadoVideo", '') in ('No quiso grabar', 'Subido a Drive', 'Subido a YouTube')
     or coalesce(new."followUp", '') in ('No quiere grabar', 'Llamada agendada') then
    return new;
  end if;
  begin
    update public.resells r set "casoDeExito" = true
    where not r."casoDeExito" and not r.cancelada and coalesce(r.testimonio, '') = '' and r."fechaHora" >= '2026-10-01'
      and btrim(coalesce(r.email, '')) <> ''
      and exists (select 1 from public.alumnos a where a.id = new."alumnoId" and lower(btrim(a.email)) = lower(btrim(r.email)))
      and abs((r."fechaHora" at time zone 'America/Argentina/Buenos_Aires')::date - left(new."fechaGrabacion", 10)::date) <= 1
      and (btrim(coalesce(new."conQuien", '')) = '' or lower(split_part(btrim(r.closer), ' ', 1)) = lower(split_part(btrim(new."conQuien"), ' ', 1)));
  exception when others then
    raise warning 'testimonio_pendiente_a_resell (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.testimonio_pendiente_a_resell() from public, anon, authenticated;

drop trigger if exists testimonios_pendiente_a_resell on public.testimonios;
create trigger testimonios_pendiente_a_resell after insert or update of "fechaGrabacion", "conQuien", link, "estadoVideo", "followUp" on public.testimonios
  for each row execute function public.testimonio_pendiente_a_resell();

/* Lo que se carga al cerrar va al testimonio de ESE día (si no hay, al más nuevo). Igual que supabase/testimonio-agendado.sql
   salvo el orden de la elección. */
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

    select id into v_tes from public.testimonios where "alumnoId" = v_alumno
    order by (left(coalesce("fechaGrabacion", ''), 10) = v_dia) desc, "creadoEn" desc, id desc limit 1;
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

-- ---------- Lo que ya está cargado ----------

-- Las sesiones 1 a 1 que ya entraron por Calendly, a sus fichas (sin avisar: ya pasaron o ya se sabían).
select public.anotar_sesion_uno_a_uno(s, false) from public.sesiones s
where public.es_sesion_uno_a_uno(s.tipo, s.titulo) and s.estado <> 'cancelada';

-- Los testimonios grabados sin link: su llamada vuelve al panel del closer.
update public.testimonios set "fechaGrabacion" = "fechaGrabacion"
where coalesce("fechaGrabacion", '') >= '2026-10-01' and btrim(coalesce(link, '')) = '';

-- ---------- Deshacer ----------
-- drop trigger if exists sesiones_uno_a_uno_a_ficha on public.sesiones;
-- drop trigger if exists seguimiento_alumnos_1a1_guarda on public.seguimiento_alumnos;
-- drop trigger if exists resells_avisar_cerrado on public.resells;
-- drop trigger if exists testimonios_pendiente_a_resell on public.testimonios;
-- (y volver a correr supabase/testimonio-agendado.sql para la elección de antes del testimonio)
-- Los datos que tocó el relleno quedan en respaldo.seguimiento_1a1_0511 y respaldo.resells_caso_0511 (los crea quien lo corre).
