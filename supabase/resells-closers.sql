-- Resells para los closers — Apicanta ERP (19/10/2026)
--
-- Mariano (closer): «el tema de los resells tengo algunos para cargar, pero la columna me lo muestra como un lead
-- normal, no tiene las opciones necesarias para un lead de resell». En el Airtable los resells eran otra tabla («Agendas
-- Resells») con otros estados. En la app la agenda de resells ya existía (`resells`, supabase/customer-success-lili.sql),
-- pero sólo la leía el área Alumnos (Customer Success). Esto se la da a los closers, cada uno la suya:
--
--   1. El permiso: `resells` lo leen y editan Alumnos y Ventas (el closer y el director). Ventas y no CRM, porque el
--      setter tiene CRM y no tiene que ver el Cash Collect.
--   2. «Sólo lo suyo»: un closer lee, crea, corrige y borra únicamente los resells cuyo `closer` es él (el nombre tal cual
--      lo escribe Calendly o el Airtable, con la misma regla que las llamadas: son_mios()). El resto de los tipos de cuenta
--      queda como estaba.
--   3. Lo que faltaba: el evento «Llamada de Asesoramiento - Próximos pasos» es el que usan para hablar con alumnos (15 de
--      los 73 resells del Airtable están ahí) y no entraba a `resells`. A los que ya están importados se les ata la llamada
--      (mismo mail y día) y a los demás se les agrega una fila, sin duplicar ni tocar lo ya cargado. Desde ahora lo hace
--      solo lib/calendly-sync.ts (lib/resells.ts reconoce «próximos pasos»).
--
-- Es aditivo y se puede correr más de una vez. Si algo no anda, el deshacer está al final (comentado).

-- ---------- 1. El permiso ----------

do $$
declare
  def_l text := pg_get_functiondef('public.areas_que_leen(text)'::regprocedure);
  def_e text := pg_get_functiondef('public.areas_que_editan(text)'::regprocedure);
  nuevo_l text := def_l;
  nuevo_e text := def_e;
begin
  nuevo_l := replace(nuevo_l, $a$when 'resells' then array['alumnos']$a$, $b$when 'resells' then array['alumnos','ventas']$b$);
  nuevo_e := replace(nuevo_e, $a$when 'resells' then array['alumnos']$a$, $b$when 'resells' then array['alumnos','ventas']$b$);
  if nuevo_l <> def_l then execute nuevo_l; end if;
  if nuevo_e <> def_e then execute nuevo_e; end if;
end $$;

-- ---------- 2. «Sólo lo suyo» ----------
-- La fila es mía si su closer es uno de mis nombres (son_mios): los resells que trae Calendly dicen «Mariano Arias» y los
-- del Airtable «Mariano», «Dante», «Valentin Abadia». Quien no tiene «sólo lo suyo» no mira la fila.

alter table public.resells enable row level security;
drop policy if exists ver_resells on public.resells;
drop policy if exists crear_resells on public.resells;
drop policy if exists editar_resells on public.resells;
drop policy if exists borrar_resells on public.resells;

create policy ver_resells on public.resells for select to authenticated
  using ((select public.ve('resells'))
         and ((select not public.solo_lo_suyo()) or cardinality(public.son_mios(array[closer])) > 0));
create policy crear_resells on public.resells for insert to authenticated
  with check ((select public.edita('resells'))
              and ((select not public.solo_lo_suyo()) or cardinality(public.son_mios(array[closer])) > 0));
create policy editar_resells on public.resells for update to authenticated
  using ((select public.edita('resells'))
         and ((select not public.solo_lo_suyo()) or cardinality(public.son_mios(array[closer])) > 0))
  with check ((select public.edita('resells'))
              and ((select not public.solo_lo_suyo()) or cardinality(public.son_mios(array[closer])) > 0));
create policy borrar_resells on public.resells for delete to authenticated
  using ((select public.edita('resells'))
         and ((select not public.solo_lo_suyo()) or cardinality(public.son_mios(array[closer])) > 0));

-- ---------- 3. Las llamadas de «Próximos pasos» ----------
-- a) Si el resell ya está (importado del Airtable, o cargado a mano) con el mismo mail y el mismo día, se le ata la llamada
--    y no se crea otro: así no se duplica a nadie y lo que ya se cargó queda donde estaba.
-- b) Las que no tienen resell, se agregan (una por llamada).
-- Una sola vez por llamada: lo que se cargue después no se toca al volver a correr esto.

with par as (
  select distinct on (x.sesion_id) x.resell_id, x.sesion_id
  from (
    select distinct on (r.id) r.id as resell_id, s.id as sesion_id, s.inicia
    from public.resells r
    join public.sesiones s on lower(s.email) = lower(r.email)
    where r."sesionId" is null and r.email <> '' and coalesce(s.tipo, '') ~* 'pr[oó]ximos pasos'
      and not exists (select 1 from public.resells y where y."sesionId" = s.id)
      and (r."fechaHora" at time zone 'America/Argentina/Buenos_Aires')::date = (s.inicia at time zone 'America/Argentina/Buenos_Aires')::date
    order by r.id, s.inicia
  ) x
  order by x.sesion_id, x.resell_id
)
update public.resells r set "sesionId" = par.sesion_id
from par where r.id = par.resell_id;

insert into public.resells (id, "sesionId", "fechaHora", nombre, email, telefono, closer, cancelada, origen, "creadoEn")
select 'rs_' || s.id, s.id, s.inicia, coalesce(s.invitado, ''), coalesce(s.email, ''), coalesce(c.telefono, ''),
       coalesce(s.anfitrion, ''), s.estado = 'cancelada', 'calendly', coalesce(s."creadoEn", now())
from public.sesiones s
left join public.contactos c on c.id = s."contactoId"
where coalesce(s.tipo, '') ~* 'pr[oó]ximos pasos'
  and not exists (select 1 from public.resells r where r."sesionId" = s.id)
on conflict (id) do nothing;

-- ---------- Para chequear ----------

select
  public.areas_que_leen('resells')                                                   as lee_resells,
  public.areas_que_editan('resells')                                                 as edita_resells,
  (select count(*) from public.resells)                                              as resells,
  (select count(*) from public.resells where origen = 'calendly')                    as resells_de_calendly,
  (select count(*) from public.sesiones where coalesce(tipo, '') ~* 'pr[oó]ximos pasos'
     and not exists (select 1 from public.resells r where r."sesionId" = sesiones.id)) as proximos_pasos_sin_fila,
  (select count(*) from public.resells where origen = 'importado' and "sesionId" is not null) as importados_con_llamada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'resells') as politicas;

-- Para deshacer (sólo permisos y políticas; las filas agregadas son datos de verdad y quedan):
--   a) volver a customer-success-lili.sql, sección 4 y las políticas de `resells`;
--   b) o a mano: replace(... array['alumnos','ventas'] → array['alumnos']) en areas_que_leen/areas_que_editan y
--      recrear las 4 políticas con ve()/edita() solos.
