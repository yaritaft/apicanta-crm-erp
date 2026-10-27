-- «Ve los leads de todos» para un tipo de cuenta con «sólo lo suyo» — Apicanta ERP (26/10/2026)
--
-- Santiago le reagenda a Mariano leads de otros closers, y Mariano no los veía:
-- «sólo lo suyo» (el tipo Closer) recorta leads, personas, llamadas y chat a lo
-- que es del closer, y eso estaba escrito a mano en las políticas de cada tabla.
-- Para abrirlo había que tocar SQL. Ahora es un permiso del tipo de cuenta:
--
--   tipos_cuenta."veTodosLosLeads"   Equipo → Tipos de cuenta → «Ve los leads de todos»
--
-- Con «sólo lo suyo» + «ve los leads de todos», la cuenta ve y edita los leads, las
-- personas, las llamadas y el chat de TODOS. Sus ventas, cuotas, cobros,
-- devoluciones y resells siguen siendo sólo los suyos, y el SQL de seguridad de
-- solo-lo-suyo-seguro.sql sigue frenando que se fabrique acceso a una venta ajena.
--
-- Cómo está hecho (la raíz, para que no haya que volver a tocar SQL):
--
--   · public.solo_lo_suyo_en(tabla): «sólo lo suyo» PARA ESA TABLA. Las políticas
--     de leads, contactos, sesiones, comentarios y chat_lecturas (y las ramas de
--     lead, contacto y sesión de actividad) la usan en lugar de solo_lo_suyo().
--     Las demás tablas siguen con solo_lo_suyo(). La lista de tablas abiertas
--     está en esa función y en ningún otro lado.
--   · tipos-cuenta.sql ya trae todo esto para una base nueva (y lo vuelve a poner
--     si se lo corre de nuevo); este archivo lo lleva a una base que ya tiene
--     las políticas viejas: agrega la columna y las funciones, y reescribe SÓLO
--     esas políticas (cambia solo_lo_suyo() por solo_lo_suyo_en('tabla'): el
--     resto de cada política queda como está en la base).
--
-- Después de este archivo hay que correr solo-lo-suyo-seguro.sql (trae los
-- triggers y es_mi_lead()/es_mi_persona() que entienden el permiso).
--
-- Idempotente y sin tocar datos (agrega una columna con false y un tipo de
-- cuenta nuevo). Nadie cambia de comportamiento hasta que un dueño lo prende.
-- Para deshacerlo: update public.tipos_cuenta set "veTodosLosLeads" = false;
-- Se ensaya con pruebas/closer-ve-todos-los-leads.test.ts (PGlite, en memoria).

do $$ begin
  if to_regclass('public.tipos_cuenta') is null or to_regclass('public.usuarios_permitidos') is null
     or to_regclass('public.leads') is null or to_regclass('public.sesiones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan tipos_cuenta, usuarios_permitidos, leads o sesiones.';
  end if;
  if to_regprocedure('public.solo_lo_suyo()') is null or to_regprocedure('public.mis_leads()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan solo_lo_suyo() y mis_leads().';
  end if;
end $$;

-- ---------- 1. el permiso ----------

alter table public.tipos_cuenta add column if not exists "veTodosLosLeads" boolean not null default false;

-- Lo mismo que tipos-cuenta.sql, con la clave nueva (la pantalla la lee de acá).
create or replace function public.mi_acceso()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tipo', t.id, 'nombre', t.nombre, 'areas', t.areas, 'soloLoSuyo', t."soloLoSuyo",
    'veTodosLosLeads', t."soloLoSuyo" and t."veTodosLosLeads" and t.id <> 'dueno',
    'miembroId', (select e.id from public.equipo e
                  where coalesce(e.email, '') <> '' and lower(trim(e.email)) = lower(u.email)
                  order by e.activo desc, e.id limit 1))
  from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.ve_todos_los_leads()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select t."soloLoSuyo" and t."veTodosLosLeads" and t.id <> 'dueno'
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), false);
$$;

create or replace function public.solo_lo_suyo_en(tabla text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.solo_lo_suyo()
     and not (tabla in ('leads', 'contactos', 'sesiones', 'comentarios', 'chat_lecturas') and public.ve_todos_los_leads());
$$;

grant execute on function public.mi_acceso() to authenticated;
grant execute on function public.ve_todos_los_leads() to authenticated;
grant execute on function public.solo_lo_suyo_en(text) to authenticated;

-- ---------- 2. las políticas de esas tablas ----------

-- Cambia solo_lo_suyo() por solo_lo_suyo_en('tabla') en lo que la base ya tiene.
-- Si una política ya está cambiada no encuentra nada que cambiar.
do $$
declare
  r record;
  q text;
  w text;
  q2 text;
  w2 text;
begin
  for r in
    select p.polname, p.polcmd, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as chk
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('leads', 'contactos', 'sesiones', 'comentarios', 'chat_lecturas')
  loop
    q := r.qual; w := r.chk;
    q2 := replace(q, 'solo_lo_suyo()', format('solo_lo_suyo_en(%L)', r.relname));
    w2 := replace(w, 'solo_lo_suyo()', format('solo_lo_suyo_en(%L)', r.relname));
    if q2 is not distinct from q and w2 is not distinct from w then continue; end if;
    if q2 is not null and w2 is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.polname, r.relname, q2, w2);
    elsif q2 is not null then
      execute format('alter policy %I on public.%I using (%s)', r.polname, r.relname, q2);
    else
      execute format('alter policy %I on public.%I with check (%s)', r.polname, r.relname, w2);
    end if;
  end loop;
end $$;

-- La actividad: las ramas de lead, contacto y sesión miran la tabla de la que
-- hablan; la de transacciones (ventas y cobros) sigue con solo_lo_suyo(). Igual
-- que en tipos-cuenta.sql.
drop policy if exists ver_actividad on public.actividad;
create policy ver_actividad on public.actividad for select to authenticated using (
  (select public.es_dueno())
  or ("creadoPor" <> '' and "creadoPor" = (select public.mi_email()))
  or case entidad
    when 'lead'        then (select public.ve('leads'))
                            and ((select not public.solo_lo_suyo_en('leads')) or "entidadId" = any((select public.mis_leads())::text[]))
    when 'contacto'    then (select public.ve('contactos'))
                            and ((select not public.solo_lo_suyo_en('contactos')) or "entidadId" = any((select public.mis_contactos())::text[]))
    when 'sesion'      then (select public.ve('sesiones'))
                            and ((select not public.solo_lo_suyo_en('sesiones')) or "entidadId" = any((select public.mis_sesiones())::text[]))
    when 'transaccion' then (select public.ve('movimientos'))
                            or ((select public.ve('ventas')) and exists (select 1 from public.ventas v where v.id = "entidadId")
                                and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_ventas())::text[])))
    when 'alumno'      then (select public.ve('alumnos'))
    when 'webinar'     then (select public.ve('webinars'))
    when 'campania'    then (select public.ve('ad_insights'))
    when 'meta'        then (select public.ve('ad_insights'))
    when 'config'      then (select public.nivel_area('ajustes')) >= 1
    else false
  end);

-- ---------- 3. el tipo de cuenta listo para usar ----------

-- Como «Closer», pero con los leads de todos. Se crea una vez; los dueños lo
-- ajustan en Equipo → Tipos de cuenta.
insert into public.tipos_cuenta (id, nombre, descripcion, areas, "soloLoSuyo", "veTodosLosLeads", orden)
values ('closer_ve_leads', 'Closer con todos los leads',
        'Como el Closer (sus ventas y sus cobros), y además ve los leads, las llamadas y el chat de todos los closers.',
        '{"crm":"editar","ventas":"editar"}', true, true, 3)
on conflict (id) do nothing;

-- Diagnóstico: tiene que dar cero filas. Una política de esas tablas que todavía
-- use solo_lo_suyo() a secas dejaría al closer con los leads de todos sin ver algo.
-- select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relnamespace = 'public'::regnamespace
--     and c.relname in ('leads', 'contactos', 'sesiones', 'comentarios', 'chat_lecturas')
--     and (pg_get_expr(p.polqual, p.polrelid) like '%solo_lo_suyo()%' or pg_get_expr(p.polwithcheck, p.polrelid) like '%solo_lo_suyo()%');
