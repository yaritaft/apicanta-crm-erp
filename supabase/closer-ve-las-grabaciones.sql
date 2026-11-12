-- El closer que «ve los leads de todos» ve también las GRABACIONES de esas llamadas — Apicanta ERP (13/11/2026)
--
-- Dante (closer) le pidió a Santiago poder ver las llamadas de los otros closers, sobre todo las de
-- los que ya no están, para retomar leads viejos: «ver la grabación del Fathom y ver qué pasó».
-- El permiso ya existía (tipos_cuenta."veTodosLosLeads", closer-ve-todos-los-leads.sql, 26/10) y abría
-- los leads, las personas, las llamadas y el chat... pero NO lo que cuelga de la llamada:
--
--   · grabaciones (resumen, accionables y transcripción de Fathom): su política seguía con
--     solo_lo_suyo() a secas, así que el closer veía la llamada de otro y la grabación vacía.
--   · precall_capturas (la captura del chat previo): igual, por precall_puede().
--
-- Raíz: «la lista de tablas abiertas está en solo_lo_suyo_en() y en ningún otro lado» era cierto para
-- la lista, pero cada política tiene que usar esa función, y las dos tablas que nacieron antes del
-- permiso nunca se reescribieron. Ahora:
--   1. solo_lo_suyo_en() incluye grabaciones y precall_capturas (las tablas que cuelgan de una llamada
--      se abren con la llamada);
--   2. sus políticas la usan (fathom.sql y precall-capturas.sql ya lo traen para una base nueva);
--   3. pruebas/politicas-de-closer-decididas.test.ts frena cualquier política nueva que use
--      solo_lo_suyo() a secas sin que alguien haya decidido a propósito que esa tabla queda cerrada.
--
-- Las ventas, cuotas, pagos, devoluciones y resells siguen siendo sólo del closer.
-- Idempotente y sin tocar datos: un closer común no ve nada distinto; sólo cambia lo que ve quien
-- tiene el permiso. Para deshacerlo: volver a correr los .sql viejos de esas dos tablas.
-- Se ensaya con pruebas/closer-ve-las-grabaciones.test.ts (PGlite, en memoria).

do $$ begin
  if to_regprocedure('public.solo_lo_suyo_en(text)') is null or to_regprocedure('public.ve_todos_los_leads()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql (o closer-ve-todos-los-leads.sql): faltan solo_lo_suyo_en() y ve_todos_los_leads().';
  end if;
end $$;

-- ---------- 1. la lista de tablas abiertas ----------

create or replace function public.solo_lo_suyo_en(tabla text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.solo_lo_suyo()
     and not (tabla in ('leads', 'contactos', 'sesiones', 'comentarios', 'chat_lecturas', 'grabaciones', 'precall_capturas') and public.ve_todos_los_leads());
$$;
grant execute on function public.solo_lo_suyo_en(text) to authenticated;

-- ---------- 2. las grabaciones ----------

-- Cambia solo_lo_suyo() por solo_lo_suyo_en('grabaciones') en lo que la base ya tiene (lo demás de
-- cada política queda como está). Si ya está cambiado, o la tabla no existe, no hace nada.
do $$
declare
  r record;
  q text; w text; q2 text; w2 text;
begin
  for r in
    select p.polname, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as chk
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace and c.relname = 'grabaciones'
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

-- ---------- 3. las capturas de la pre-call ----------

-- Sólo si esa fase está instalada (precall-capturas.sql). Es la misma función de ese archivo con
-- solo_lo_suyo_en('precall_capturas'): la tabla y los archivos del bucket pasan por ella.
do $f$
begin
  if to_regprocedure('public.precall_puede(text, boolean)') is null then return; end if;
  execute $sql$
    create or replace function public.precall_puede(p_sesion text, p_escribir boolean)
    returns boolean
    language sql stable security definer
    set search_path = public
    as $body$
      select coalesce(
        public.ve('sesiones')
        and (
          not public.solo_lo_suyo_en('precall_capturas')
          or p_sesion = any((select public.mis_sesiones())::text[])
          or exists (select 1 from public.sesiones s
                      where s.id = p_sesion and s."setterId" is not null and s."setterId" = public.mi_miembro_id())
        )
        and (
          not p_escribir
          or public.edita('sesiones')
          or exists (select 1 from public.equipo e, public.sesiones s
                      where e.id = public.mi_miembro_id() and e.rol = 'setter' and coalesce(e.activo, true)
                        and s.id = p_sesion and (s."setterId" is null or s."setterId" = e.id))
        ), false);
    $body$
  $sql$;
end $f$;

-- Diagnóstico: las dos tienen que dar cero filas.
--   select polname from pg_policy where polrelid = 'public.grabaciones'::regclass
--     and (pg_get_expr(polqual, polrelid) like '%solo_lo_suyo()%' or pg_get_expr(polwithcheck, polrelid) like '%solo_lo_suyo()%');
--   select proname from pg_proc where proname = 'precall_puede' and prosrc like '%solo_lo_suyo()%';
