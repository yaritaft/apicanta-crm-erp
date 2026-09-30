-- Tipos de cuenta — Apicanta ERP (fase 3 del feedback de Yari, 29/09)
--
-- "Falta el apartado de ajustes para ir asignando los distintos tipos de
-- cuentas a la gente que usa el sistema." Hasta acá había dos niveles
-- (dueño y equipo) y todas las tablas se abrían enteras a cualquiera de la
-- lista. Desde acá cada persona tiene un tipo de cuenta, y cada tipo dice
-- qué áreas de la app ve y cuáles edita. Lo decide la base, no la pantalla:
-- lo que un tipo no puede ver le llega vacío y lo que no puede editar se
-- rechaza, también si lo pide por la API.
--
--   1. `tipos_cuenta`: los tipos, con sus áreas ('ver' o 'editar') y si ven
--      sólo lo suyo. Los dueños los editan en Equipo → Tipos de cuenta. El
--      de Dueño no se toca: ve y edita todo, como siempre.
--   2. `usuarios_permitidos.rol` pasa a ser el id del tipo (con FK).
--   3. Qué tablas lee y edita cada área (`areas_que_leen`, `areas_que_editan`,
--      las mismas que src/lib/permisos.ts), `ve(tabla)`, `edita(tabla)` y lo
--      que es "de uno" (`mis_anfitriones`, `mis_ventas`, `mis_leads`...).
--   4. Las políticas de cada tabla, reescritas con esas funciones.
--
-- "Sólo lo suyo" (el closer, por defecto): sus llamadas (el anfitrión de
-- Calendly es él, por su nombre en Equipo, como en el cierre del día), sus
-- ventas (de closer o de setter, y las que tienen cuotas que heredó) con sus
-- cuotas y cobros, y la gente de esas llamadas y ventas.
--
-- Idempotente. Los tipos por defecto se crean una sola vez: correrlo de
-- nuevo no pisa lo que los dueños hayan cambiado.

do $$ begin
  if to_regclass('public.usuarios_permitidos') is null or to_regclass('public.equipo') is null
     or to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta usuarios_permitidos, equipo o ventas.';
  end if;
end $$;

-- ---------- 1. los tipos de cuenta ----------

create or replace function public.areas_validas(a jsonb)
returns boolean
language sql immutable
as $$
  select jsonb_typeof(a) = 'object'
    and not exists (select 1 from jsonb_each(a) x where x.value not in ('"ver"'::jsonb, '"editar"'::jsonb));
$$;

create table if not exists public.tipos_cuenta (
  id              text primary key,
  nombre          text not null,
  descripcion     text not null default '',
  -- { área: 'ver' | 'editar' }: lo que no está, no lo ve. Las áreas son las
  -- de src/lib/permisos.ts (panel, leads, crm, ventas, webinars, marketing,
  -- alumnos, finanzas, ajustes).
  areas           jsonb not null default '{}'::jsonb check (public.areas_validas(areas)),
  -- Llamadas, ventas y personas: sólo las suyas.
  "soloLoSuyo"    boolean not null default false,
  orden           integer not null default 100,
  "actualizadoEn" timestamptz not null default now()
);

insert into public.tipos_cuenta (id, nombre, descripcion, areas, "soloLoSuyo", orden) values
  ('dueno', 'Dueño', 'Todo, incluido lo que cobra cada uno y los accesos a la app.',
    '{"panel":"editar","leads":"editar","crm":"editar","ventas":"editar","webinars":"editar","marketing":"editar","alumnos":"editar","finanzas":"editar","ajustes":"editar"}', false, 0),
  ('equipo', 'Todo menos honorarios', 'Toda la app menos Equipo y honorarios.',
    '{"panel":"editar","leads":"editar","crm":"editar","ventas":"editar","webinars":"editar","marketing":"editar","alumnos":"editar","finanzas":"editar","ajustes":"editar"}', false, 1),
  ('director', 'Director comercial', 'Leads, CRM, Agenda, Ventas y Clientes de todos los closers. Ve los webinars y el Dashboard, sin Finanzas.',
    '{"panel":"ver","leads":"editar","crm":"editar","ventas":"editar","webinars":"ver"}', false, 2),
  ('closer', 'Closer', 'Sus llamadas en el CRM y la Agenda, su cierre del día, sus ventas y sus clientes.',
    '{"crm":"editar","ventas":"editar"}', true, 3),
  ('setter', 'Setter', 'Los leads y la Agenda, sin montos de venta.',
    '{"leads":"editar","crm":"ver"}', false, 4),
  ('admin', 'Administración', 'Finanzas, Caja, Conciliación, Ventas y Clientes. En el Dashboard, cobranza y rentabilidad.',
    '{"panel":"ver","ventas":"editar","finanzas":"editar"}', false, 5),
  ('marketing', 'Marketing', 'Webinars y Marketing; ve los leads. En el Dashboard, adquisición y el webinar.',
    '{"panel":"ver","leads":"ver","webinars":"editar","marketing":"editar"}', false, 6)
on conflict (id) do nothing;

-- El de Dueño es siempre todo: aunque alguien lo editara por SQL, las
-- funciones de abajo lo tratan aparte.
update public.tipos_cuenta set nombre = 'Dueño' where id = 'dueno' and nombre <> 'Dueño';

-- ---------- 2. el tipo de cada acceso ----------

alter table public.usuarios_permitidos drop constraint if exists usuarios_permitidos_rol_ck;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_permitidos_rol_fk') then
    alter table public.usuarios_permitidos
      add constraint usuarios_permitidos_rol_fk foreign key (rol) references public.tipos_cuenta(id)
      on update cascade on delete restrict;
  end if;
end $$;

-- ---------- 3. quién es y qué puede ----------

-- El tipo, sus áreas, si ve sólo lo suyo y quién es en Equipo (por su
-- correo). Lo pide la pantalla una vez por carga; las políticas usan las
-- funciones de abajo, que leen lo mismo.
create or replace function public.mi_acceso()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tipo', t.id, 'nombre', t.nombre, 'areas', t.areas, 'soloLoSuyo', t."soloLoSuyo",
    'miembroId', (select e.id from public.equipo e
                  where coalesce(e.email, '') <> '' and lower(trim(e.email)) = lower(u.email)
                  order by e.activo desc, e.id limit 1))
  from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.nivel_area(area text)
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case when t.id = 'dueno' then 2
                when t.areas ->> area = 'editar' then 2
                when t.areas ->> area = 'ver' then 1
                else 0 end
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), 0);
$$;

create or replace function public.solo_lo_suyo()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select t."soloLoSuyo" and t.id <> 'dueno'
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), false);
$$;

create or replace function public.mi_miembro_id()
returns text
language sql stable security definer
set search_path = public
as $$
  select e.id from public.equipo e
  where coalesce(e.email, '') <> '' and lower(trim(e.email)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by e.activo desc, e.id limit 1;
$$;

-- Qué áreas dejan leer y editar cada tabla. '*' = cualquiera que entre.
-- Lo mismo que LEEN y EDITAN en src/lib/permisos.ts: si se cambia uno, se
-- cambia el otro (lo controla una prueba).
create or replace function public.areas_que_leen(tabla text)
returns text[]
language sql immutable
as $$
  select case tabla
    when 'leads'         then array['leads','crm','ventas','webinars','alumnos','finanzas','marketing']
    when 'contactos'     then array['leads','crm','ventas','webinars','alumnos','finanzas','marketing']
    when 'comentarios'   then array['leads','crm','ventas','alumnos','finanzas']
    when 'sesiones'      then array['crm','leads','webinars','marketing','ventas']
    when 'ventas'        then array['ventas','finanzas','webinars','marketing','alumnos']
    when 'cuotas'        then array['ventas','finanzas','webinars','marketing','alumnos']
    when 'pagos'         then array['ventas','finanzas','webinars','marketing','alumnos']
    when 'alumnos'       then array['alumnos']
    when 'reportes'      then array['alumnos']
    when 'gastos'        then array['finanzas']
    when 'movimientos'   then array['finanzas']
    when 'arqueos'       then array['finanzas']
    when 'transacciones' then array['finanzas']
    when 'ad_insights'   then array['marketing','webinars','finanzas']
    when 'campanias'     then array['marketing','webinars']
    when 'yt_analytics'  then array['webinars','marketing']
    when 'yt_chat'       then array['webinars','marketing']
    when 'yt_estado'     then array['webinars','marketing']
    when 'yt_muestras'   then array['webinars','marketing']
    -- Sólo los dueños (tienen además su propia política con es_dueno()).
    when 'honorarios'          then array[]::text[]
    when 'liquidaciones'       then array[]::text[]
    when 'usuarios_permitidos' then array[]::text[]
    -- La configuración y los catálogos (ajustes, etapas, embudos, productos,
    -- procesadores, campos, metas, equipo, etapas_servicio, tipos_cuenta),
    -- los webinars y los nombres de las campañas los lee cualquiera: sin eso
    -- ninguna pantalla sabe armarse.
    else array['*']
  end;
$$;

create or replace function public.areas_que_editan(tabla text)
returns text[]
language sql immutable
as $$
  select case tabla
    when 'leads'           then array['leads','crm','ventas']
    when 'contactos'       then array['leads','crm','ventas']
    when 'comentarios'     then array['leads','crm','ventas','alumnos','finanzas']
    when 'sesiones'        then array['crm','leads']
    when 'ventas'          then array['ventas','finanzas']
    when 'cuotas'          then array['ventas','finanzas']
    when 'pagos'           then array['ventas','finanzas']
    when 'alumnos'         then array['alumnos']
    when 'reportes'        then array['alumnos']
    when 'etapas_servicio' then array['alumnos']
    when 'webinars'        then array['webinars']
    when 'campaigns'       then array['marketing']
    when 'adsets'          then array['marketing']
    when 'ads'             then array['marketing']
    when 'ad_insights'     then array['marketing']
    when 'campanias'       then array['marketing']
    when 'gastos'          then array['finanzas']
    when 'movimientos'     then array['finanzas']
    when 'arqueos'         then array['finanzas']
    when 'transacciones'   then array['finanzas']
    when 'ajustes'         then array['ajustes']
    when 'campos'          then array['ajustes']
    when 'etapas'          then array['ajustes']
    when 'embudos'         then array['ajustes']
    when 'productos'       then array['ajustes']
    when 'procesadores'    then array['ajustes']
    when 'metas'           then array['ajustes']
    -- equipo, tipos_cuenta, usuarios_permitidos, honorarios, liquidaciones:
    -- sólo los dueños.
    else array[]::text[]
  end;
$$;

create or replace function public.ve(tabla text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select t.id = 'dueno'
      or '*' = any(public.areas_que_leen(tabla))
      or exists (select 1 from jsonb_each_text(t.areas) a
                 where a.value in ('ver', 'editar') and a.key = any(public.areas_que_leen(tabla)))
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), false);
$$;

create or replace function public.edita(tabla text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select t.id = 'dueno'
      or exists (select 1 from jsonb_each_text(t.areas) a
                 where a.value = 'editar' and a.key = any(public.areas_que_editan(tabla)))
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), false);
$$;

-- ---------- lo que es de uno ----------

-- "Valentín Abadía" → "valentin abadia": sin tildes, en minúscula y con las
-- dos primeras palabras, como nombreCorto() de src/lib/crm.ts.
create or replace function public.nombre_corto(t text)
returns text
language sql immutable
as $$
  select array_to_string((regexp_split_to_array(trim(lower(translate(coalesce(t, ''),
    'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
    'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc'))), '\s+'))[1:2], ' ');
$$;

-- Quién de Equipo es un nombre (el anfitrión de Calendly, el responsable de
-- un lead): el que tiene el mismo nombre corto o, si no hay, uno que
-- empieza igual. Como miembroDeCloser() de src/lib/crm.ts.
create or replace function public.miembro_de_nombre(n text)
returns text
language sql stable security definer
set search_path = public
as $$
  with c as (select public.nombre_corto(n) as c)
  select coalesce(
    (select e.id from public.equipo e, c
      where c.c <> '' and public.nombre_corto(e.nombre) = c.c
      order by e.activo desc, e.id limit 1),
    (select e.id from public.equipo e, c
      where c.c <> '' and public.nombre_corto(e.nombre) <> ''
        and (c.c like public.nombre_corto(e.nombre) || ' %' or public.nombre_corto(e.nombre) like c.c || ' %')
      order by e.activo desc, e.id limit 1));
$$;

-- Lo de uno, calculado una vez por consulta: las políticas lo llaman con
-- (select …) y cada fila sólo se fija si está en la lista. Fila por fila
-- serían miles de cruces entre leads, llamadas y equipo en cada lectura.

-- Los anfitriones de Calendly que son uno (tal cual vienen escritos).
create or replace function public.mis_anfitriones()
returns text[]
language sql stable security definer
set search_path = public
as $$
  with yo as (select public.mi_miembro_id() as id)
  select coalesce(array_agg(x.a), array[]::text[])
  from (select distinct s.anfitrion as a from public.sesiones s where coalesce(s.anfitrion, '') <> '') x, yo
  where yo.id is not null and public.miembro_de_nombre(x.a) = yo.id;
$$;

create or replace function public.mis_sesiones()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(s.id), array[]::text[])
  from public.sesiones s where s.anfitrion = any(public.mis_anfitriones());
$$;

-- Las ventas de uno: de closer o de setter, y las que tienen cuotas que heredó.
create or replace function public.mis_ventas()
returns text[]
language sql stable security definer
set search_path = public
as $$
  with yo as (select public.mi_miembro_id() as id)
  select coalesce(array_agg(v.id), array[]::text[])
  from public.ventas v, yo
  where yo.id is not null
    and (v."closerId" = yo.id or v."setterId" = yo.id
         or exists (select 1 from public.cuotas c where c."ventaId" = v.id and c."closerId" = yo.id));
$$;

create or replace function public.mis_cuotas()
returns text[]
language sql stable security definer
set search_path = public
as $$
  with yo as (select public.mi_miembro_id() as id), mv as (select public.mis_ventas() as ids)
  select coalesce(array_agg(c.id), array[]::text[])
  from public.cuotas c, yo, mv
  where yo.id is not null and (c."closerId" = yo.id or c."ventaId" = any(mv.ids));
$$;

-- Los leads de uno: es su responsable, o tienen una llamada suya (por el
-- lead o por la persona), o una venta suya (ventas.contactoId es el lead).
create or replace function public.mis_leads()
returns text[]
language sql stable security definer
set search_path = public
as $$
  with yo as (select public.mi_miembro_id() as id),
       resp as (
         select coalesce(array_agg(x.r), array[]::text[]) as r
         from (select distinct l.responsable as r from public.leads l where coalesce(l.responsable, '') <> '') x, yo
         where yo.id is not null and public.miembro_de_nombre(x.r) = yo.id),
       ses as (select s."leadId", s."contactoId" from public.sesiones s where s.id = any(public.mis_sesiones())),
       mv as (select public.mis_ventas() as ids)
  select coalesce(array_agg(distinct l.id), array[]::text[])
  from public.leads l, resp, mv
  where l.responsable = any(resp.r)
     or l.id in (select "leadId" from ses where "leadId" is not null)
     or (l."contactoId" is not null and l."contactoId" in (select "contactoId" from ses where "contactoId" is not null))
     or l.id in (select v."contactoId" from public.ventas v where v.id = any(mv.ids) and v."contactoId" is not null);
$$;

-- Las personas de uno: las de sus llamadas y las de sus leads.
create or replace function public.mis_contactos()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x.c), array[]::text[]) from (
    select s."contactoId" as c from public.sesiones s where s.id = any(public.mis_sesiones()) and s."contactoId" is not null
    union
    select l."contactoId" from public.leads l where l.id = any(public.mis_leads()) and l."contactoId" is not null
  ) x;
$$;

grant execute on function public.mi_acceso() to authenticated;
grant execute on function public.nivel_area(text) to authenticated;
grant execute on function public.solo_lo_suyo() to authenticated;
grant execute on function public.mi_miembro_id() to authenticated;
grant execute on function public.ve(text) to authenticated;
grant execute on function public.edita(text) to authenticated;
grant execute on function public.mis_anfitriones() to authenticated;
grant execute on function public.mis_sesiones() to authenticated;
grant execute on function public.mis_ventas() to authenticated;
grant execute on function public.mis_cuotas() to authenticated;
grant execute on function public.mis_leads() to authenticated;
grant execute on function public.mis_contactos() to authenticated;
grant execute on function public.miembro_de_nombre(text) to authenticated;

-- ---------- 4. las políticas ----------

-- Las tablas sin "sólo lo suyo": leer con ve(), escribir con edita().
-- (select …) hace que la base lo calcule una vez por consulta y no por fila.
do $$
declare t text;
begin
  foreach t in array array[
    'ajustes', 'campos', 'etapas', 'embudos', 'productos', 'procesadores', 'metas', 'equipo',
    'etapas_servicio', 'webinars', 'campaigns', 'adsets', 'ads', 'ad_insights', 'campanias',
    'movimientos', 'arqueos', 'transacciones', 'reportes', 'tipos_cuenta'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'acceso_equipo_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'ver_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'crear_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'editar_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'borrar_' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ve(%L)))', 'ver_' || t, t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.edita(%L)))', 'crear_' || t, t, t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.edita(%L))) with check ((select public.edita(%L)))', 'editar_' || t, t, t, t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.edita(%L)))', 'borrar_' || t, t, t);
  end loop;

  -- Lo de YouTube lo escribe sólo el cron (con la clave de servicio).
  foreach t in array array['yt_analytics', 'yt_chat', 'yt_estado', 'yt_muestras'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', 'acceso_equipo_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'ver_' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ve(%L)))', 'ver_' || t, t, t);
  end loop;
end $$;

-- El tipo Dueño no se cambia ni se borra desde la app.
drop policy if exists editar_tipos_cuenta on public.tipos_cuenta;
create policy editar_tipos_cuenta on public.tipos_cuenta for update to authenticated
  using ((select public.edita('tipos_cuenta')) and id <> 'dueno')
  with check ((select public.edita('tipos_cuenta')) and id <> 'dueno');
drop policy if exists borrar_tipos_cuenta on public.tipos_cuenta;
create policy borrar_tipos_cuenta on public.tipos_cuenta for delete to authenticated
  using ((select public.edita('tipos_cuenta')) and id not in ('dueno', 'equipo'));

-- Las que tienen "sólo lo suyo". Para quien no lo tiene, (select not
-- public.solo_lo_suyo()) es true y la fila no se mira.
do $$
declare r record;
begin
  for r in select * from (values
    ('sesiones',    'anfitrion = any((select public.mis_anfitriones()))',
                    'anfitrion = any((select public.mis_anfitriones()))'),
    ('ventas',      'id = any((select public.mis_ventas()))',
                    '("closerId" = (select public.mi_miembro_id()) or "setterId" = (select public.mi_miembro_id()) or id = any((select public.mis_ventas())))'),
    ('cuotas',      '("closerId" = (select public.mi_miembro_id()) or "ventaId" = any((select public.mis_ventas())))',
                    '("closerId" = (select public.mi_miembro_id()) or "ventaId" = any((select public.mis_ventas())))'),
    ('pagos',       '"cuotaId" = any((select public.mis_cuotas()))',
                    '"cuotaId" = any((select public.mis_cuotas()))'),
    -- Una persona nueva (la de una venta que no venía de una llamada) todavía
    -- no está atada a nada: se puede crear; la venta la ata después.
    ('leads',       'id = any((select public.mis_leads()))', 'true'),
    ('contactos',   'id = any((select public.mis_contactos()))', 'true'),
    ('comentarios', '"contactoId" = any((select public.mis_contactos()))',
                    '"contactoId" = any((select public.mis_contactos()))')
  ) as v(t, alcance, alcance_nuevo)
  loop
    if to_regclass('public.' || r.t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', r.t);
    execute format('drop policy if exists %I on public.%I', 'acceso_equipo_' || r.t, r.t);
    execute format('drop policy if exists %I on public.%I', 'ver_' || r.t, r.t);
    execute format('drop policy if exists %I on public.%I', 'crear_' || r.t, r.t);
    execute format('drop policy if exists %I on public.%I', 'editar_' || r.t, r.t);
    execute format('drop policy if exists %I on public.%I', 'borrar_' || r.t, r.t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ve(%L)) and ((select not public.solo_lo_suyo()) or %s))',
      'ver_' || r.t, r.t, r.t, r.alcance);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.edita(%L)) and ((select not public.solo_lo_suyo()) or %s))',
      'crear_' || r.t, r.t, r.t, r.alcance_nuevo);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.edita(%L)) and ((select not public.solo_lo_suyo()) or %s)) with check ((select public.edita(%L)) and ((select not public.solo_lo_suyo()) or %s))',
      'editar_' || r.t, r.t, r.t, r.alcance, r.t, r.alcance_nuevo);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.edita(%L)) and ((select not public.solo_lo_suyo()) or %s))',
      'borrar_' || r.t, r.t, r.t, r.alcance);
  end loop;
end $$;

-- Alumnos: los de Alumnos, y el servicio que nace de una venta, que lo crea
-- quien la carga aunque no vea la pantalla (registrarVenta).
alter table public.alumnos enable row level security;
drop policy if exists acceso_equipo_alumnos on public.alumnos;
drop policy if exists ver_alumnos on public.alumnos;
drop policy if exists crear_alumnos on public.alumnos;
drop policy if exists editar_alumnos on public.alumnos;
drop policy if exists borrar_alumnos on public.alumnos;
create policy ver_alumnos on public.alumnos for select to authenticated using (
  (select public.ve('alumnos'))
  or ((select public.edita('ventas')) and "ventaId" is not null
      and ((select not public.solo_lo_suyo()) or "ventaId" = any((select public.mis_ventas())))));
create policy crear_alumnos on public.alumnos for insert to authenticated with check (
  (select public.edita('alumnos'))
  or ((select public.edita('ventas')) and "ventaId" is not null
      and ((select not public.solo_lo_suyo()) or "ventaId" = any((select public.mis_ventas())))));
create policy editar_alumnos on public.alumnos for update to authenticated
  using ((select public.edita('alumnos'))
    or ((select public.edita('ventas')) and "ventaId" is not null
        and ((select not public.solo_lo_suyo()) or "ventaId" = any((select public.mis_ventas())))))
  with check ((select public.edita('alumnos'))
    or ((select public.edita('ventas')) and "ventaId" is not null
        and ((select not public.solo_lo_suyo()) or "ventaId" = any((select public.mis_ventas())))));
create policy borrar_alumnos on public.alumnos for delete to authenticated using ((select public.edita('alumnos')));

-- Gastos: Finanzas; y los cargados con un webinar, quien ve los webinars
-- (entran en su profit).
alter table public.gastos enable row level security;
drop policy if exists acceso_equipo_gastos on public.gastos;
drop policy if exists ver_gastos on public.gastos;
drop policy if exists crear_gastos on public.gastos;
drop policy if exists editar_gastos on public.gastos;
drop policy if exists borrar_gastos on public.gastos;
create policy ver_gastos on public.gastos for select to authenticated using (
  (select public.ve('gastos')) or ("webinarId" is not null and (select public.nivel_area('webinars')) >= 1));
create policy crear_gastos on public.gastos for insert to authenticated with check ((select public.edita('gastos')));
create policy editar_gastos on public.gastos for update to authenticated
  using ((select public.edita('gastos'))) with check ((select public.edita('gastos')));
create policy borrar_gastos on public.gastos for delete to authenticated using ((select public.edita('gastos')));

-- La actividad: cada fila, para quien ve de qué habla. La escribe
-- cualquiera (cada uno anota lo que hace); la corrige sólo un dueño.
alter table public.actividad enable row level security;
drop policy if exists acceso_equipo_actividad on public.actividad;
drop policy if exists ver_actividad on public.actividad;
drop policy if exists crear_actividad on public.actividad;
drop policy if exists editar_actividad on public.actividad;
drop policy if exists borrar_actividad on public.actividad;
create policy ver_actividad on public.actividad for select to authenticated using (
  (select public.es_dueno()) or case entidad
    when 'lead'        then (select public.ve('leads'))
                            and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_leads())))
    when 'contacto'    then (select public.ve('contactos'))
                            and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_contactos())))
    when 'sesion'      then (select public.ve('sesiones'))
                            and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_sesiones())))
    -- Los cobros y las ventas; los arqueos y las importaciones, sólo Finanzas.
    when 'transaccion' then (select public.ve('movimientos'))
                            or ((select public.ve('ventas')) and exists (select 1 from public.ventas v where v.id = "entidadId")
                                and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_ventas()))))
    when 'alumno'      then (select public.ve('alumnos'))
    when 'webinar'     then (select public.ve('webinars'))
    when 'campania'    then (select public.ve('ad_insights'))
    when 'meta'        then (select public.ve('ad_insights'))
    when 'config'      then (select public.nivel_area('ajustes')) >= 1
    else false
  end);
create policy crear_actividad on public.actividad for insert to authenticated with check ((select public.puede_entrar()));
create policy editar_actividad on public.actividad for update to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));
create policy borrar_actividad on public.actividad for delete to authenticated using ((select public.es_dueno()));

-- La lista de accesos (con los correos de todos) la leen sólo los dueños.
-- Cada uno sabe lo suyo por mi_acceso(), que no la necesita.
drop policy if exists leer_lista on public.usuarios_permitidos;
create policy leer_lista on public.usuarios_permitidos for select to authenticated using ((select public.es_dueno()));

-- ---------- diagnóstico ----------
select
  (select count(*) from public.tipos_cuenta)                                               as tipos,
  (select string_agg(u.rol || ':' || n, ', ' order by u.rol)
     from (select rol, count(*) n from public.usuarios_permitidos group by rol) u)          as accesos_por_tipo,
  (select count(*) from pg_policies where schemaname = 'public'
     and policyname like 'acceso_equipo_%')                                                 as politicas_viejas,
  (select count(*) from pg_policies where schemaname = 'public'
     and (policyname like 'ver_%' or policyname like 'crear_%' or policyname like 'editar_%' or policyname like 'borrar_%')) as politicas_nuevas,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)               as tablas_sin_rls;
