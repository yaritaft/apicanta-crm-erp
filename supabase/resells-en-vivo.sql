-- ==================================================================
-- Los resells en vivo y los alumnos del Airtable atados a su persona
-- (Lili, 26/10).
--
-- Daniel Arroyo agendó su resell con Mariano a las 17:27 y a las 17:34 Lili
-- no lo veía «ni en la ficha ni en la lista». Estaba en la base, pero:
--   1. La app abierta desde antes no se enteraba: la tabla `resells` no
--      avisaba sus cambios (Realtime). Ahora sí; la app la escucha en
--      components/cs/ResellsEnVivo.tsx.
--   2. Era un alumno del Airtable sin persona en la app, y Calendly creó
--      una nueva con el nombre que él escribió («Daniel»): buscando
--      «Arroyo» no aparecía. lib/calendly-sync.ts ya usa el nombre del
--      alumno y lo ata; acá se arregla lo que ya había entrado así.
--
-- Respaldo en respaldo.*_2610_personas. Se puede volver a correr.
-- ==================================================================

-- 1. Realtime de la agenda de resells (la RLS sigue mandando: cada uno recibe lo que puede ver).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resells') then
    alter publication supabase_realtime add table public.resells;
  end if;
end;
$$;

-- 2. Respaldo de lo que se va a tocar.
create schema if not exists respaldo;
create table if not exists respaldo.alumnos_2610_personas as select * from public.alumnos where false;
create table if not exists respaldo.contactos_2610_personas as select * from public.contactos where false;
create table if not exists respaldo.leads_2610_personas as select * from public.leads where false;
create table if not exists respaldo.sesiones_2610_personas as select * from public.sesiones where false;
create table if not exists respaldo.resells_2610_personas as select * from public.resells where false;

-- La persona que creó Calendly con un pedazo del nombre de un alumno que estaba suelto («Daniel» de «Daniel Arroyo Mendoza»).
-- Los que ya estaban atados (un lead que compró y su alumno se cargó con el nombre completo) no se tocan: es cosa del CRM.
create temporary table renombrar on commit drop as
  select c.id as contacto, btrim(a.nombre) as nombre
  from public.alumnos a
  join public.contactos c on lower(btrim(c.email)) = lower(btrim(a.email)) and btrim(coalesce(a.email, '')) <> ''
  where c.id like 'lea_cal_%' and a."leadId" is null
    and lower(btrim(c.nombre)) <> lower(btrim(a.nombre))
    and position(lower(btrim(c.nombre)) || ' ' in lower(btrim(a.nombre)) || ' ') = 1;

-- Los alumnos sin persona que tienen UNA sola oportunidad con su mail.
create temporary table atar on commit drop as
  select a.id as alumno, min(l.id) as lead
  from public.alumnos a
  join public.leads l on lower(btrim(l.email)) = lower(btrim(a.email)) and btrim(coalesce(a.email, '')) <> ''
  where a."leadId" is null
  group by a.id
  having count(*) = 1;

insert into respaldo.alumnos_2610_personas select a.* from public.alumnos a join atar t on t.alumno = a.id
  where not exists (select 1 from respaldo.alumnos_2610_personas x where x.id = a.id);
insert into respaldo.contactos_2610_personas select c.* from public.contactos c join renombrar r on r.contacto = c.id
  where not exists (select 1 from respaldo.contactos_2610_personas x where x.id = c.id);
insert into respaldo.leads_2610_personas select l.* from public.leads l join renombrar r on r.contacto in (l.id, l."contactoId")
  where not exists (select 1 from respaldo.leads_2610_personas x where x.id = l.id);
insert into respaldo.sesiones_2610_personas select s.* from public.sesiones s join renombrar r on r.contacto = s."contactoId"
  where not exists (select 1 from respaldo.sesiones_2610_personas x where x.id = s.id);
insert into respaldo.resells_2610_personas select rs.* from public.resells rs join public.sesiones s on s.id = rs."sesionId" join renombrar r on r.contacto = s."contactoId"
  where not exists (select 1 from respaldo.resells_2610_personas x where x.id = rs.id);

-- 3. El nombre del alumno en su persona, su oportunidad, sus llamadas y sus resells.
update public.contactos c set nombre = r.nombre from renombrar r where c.id = r.contacto;
update public.leads l set nombre = r.nombre from renombrar r where r.contacto in (l.id, l."contactoId");
update public.sesiones s set invitado = r.nombre from renombrar r where s."contactoId" = r.contacto;
update public.resells rs set nombre = r.nombre from public.sesiones s, renombrar r where s.id = rs."sesionId" and s."contactoId" = r.contacto;

-- 4. El alumno atado a su persona: su ficha muestra las llamadas.
update public.alumnos a set "leadId" = t.lead from atar t where a.id = t.alumno and a."leadId" is null;

select (select count(*) from respaldo.contactos_2610_personas) as personas_renombradas,
       (select count(*) from respaldo.alumnos_2610_personas) as alumnos_atados,
       (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'resells') as resells_en_vivo;
