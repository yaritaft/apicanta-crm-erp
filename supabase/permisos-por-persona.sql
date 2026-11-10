-- ==================================================================
-- Permisos de más por persona (10/11, pedido de Manuel).
--
-- Manuel quiso que Santiago (Director comercial) viera Finanzas. Lo único
-- que se podía hacer era cambiarle el tipo de cuenta, y con eso perdía lo
-- de director: cada persona tenía UN tipo y nada más.
--
-- Ahora cada acceso lleva, además de su tipo, áreas de más
-- (`usuarios_permitidos."areasExtra"`, igual que `tipos_cuenta.areas`:
-- {"finanzas":"ver"}). Sólo suman: lo que da el tipo no se le quita a nadie
-- desde acá. Se cargan en Equipo → Accesos → «Permisos de más».
--
-- Las cuatro funciones que leen las áreas (mi_acceso, nivel_area, ve,
-- edita) pasan por areas_con_extra(): la pantalla y las políticas siguen
-- mirando una sola regla.
--
-- Aditivo y se puede correr de nuevo. Va después de tipos-cuenta.sql y de
-- closer-ve-todos-los-leads.sql (los dos ya traen estas mismas funciones).
-- ==================================================================

alter table public.usuarios_permitidos add column if not exists "areasExtra" jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_permitidos_extra_ck') then
    alter table public.usuarios_permitidos
      add constraint usuarios_permitidos_extra_ck check (jsonb_typeof("areasExtra") = 'object');
  end if;
end $$;

-- Lo del tipo más lo de la persona: por área, el más alto de los dos.
create or replace function public.areas_con_extra(base jsonb, extra jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_object_agg(s.k, case when s.b = 'editar' or s.x = 'editar' then 'editar' else 'ver' end), '{}'::jsonb)
  from (
    select coalesce(a.key, e.key) as k, a.value as b, e.value as x
    from jsonb_each_text(case when jsonb_typeof(base) = 'object' then base else '{}'::jsonb end) a
    full join jsonb_each_text(case when jsonb_typeof(extra) = 'object' then extra else '{}'::jsonb end) e on e.key = a.key
  ) s
  where s.b in ('ver', 'editar') or s.x in ('ver', 'editar');
$$;

create or replace function public.mi_acceso()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tipo', t.id, 'nombre', t.nombre, 'areas', public.areas_con_extra(t.areas, u."areasExtra"), 'areasExtra', u."areasExtra",
    'soloLoSuyo', t."soloLoSuyo",
    'veTodosLosLeads', t."soloLoSuyo" and t."veTodosLosLeads" and t.id <> 'dueno',
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
                when public.areas_con_extra(t.areas, u."areasExtra") ->> area = 'editar' then 2
                when public.areas_con_extra(t.areas, u."areasExtra") ->> area = 'ver' then 1
                else 0 end
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), 0);
$$;

create or replace function public.ve(tabla text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select t.id = 'dueno'
      or '*' = any(public.areas_que_leen(tabla))
      or exists (select 1 from jsonb_each_text(public.areas_con_extra(t.areas, u."areasExtra")) a
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
      or exists (select 1 from jsonb_each_text(public.areas_con_extra(t.areas, u."areasExtra")) a
                 where a.value = 'editar' and a.key = any(public.areas_que_editan(tabla)))
    from public.usuarios_permitidos u join public.tipos_cuenta t on t.id = u.rol
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1), false);
$$;

grant execute on function public.areas_con_extra(jsonb, jsonb) to authenticated;
grant execute on function public.mi_acceso() to authenticated;
grant execute on function public.nivel_area(text) to authenticated;
grant execute on function public.ve(text) to authenticated;
grant execute on function public.edita(text) to authenticated;

notify pgrst, 'reload schema';

-- Diagnóstico: quién tiene algo de más.
select u.email, u.rol, u."areasExtra" from public.usuarios_permitidos u where u."areasExtra" <> '{}'::jsonb order by u.email;
