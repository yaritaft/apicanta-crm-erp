-- ==================================================================
-- El servicio de SUS alumnos, para el closer (Juan Cruz, 26/10: «hay que darle
-- acceso a la parte de servicio para que el closer también vea esa parte de sus
-- leads/clientes»; Mariano no sabía si el contrato de Jacob había salido).
--
-- La ficha del closer ya mostraba «Alumno activo» (ver_alumnos deja leer los
-- alumnos de sus ventas), pero la solapa Servicio no le servía: el seguimiento
-- y los accesos de cada alumno se leen con el área Alumnos, que el closer no
-- tiene, y la base devolvía vacío sin avisar.
--
-- Lo que abre, SÓLO PARA LEER y sólo para quien ve «sólo lo suyo» y edita
-- Ventas (el closer):
--   · seguimiento_alumnos y accesos_alumno de los alumnos que ya puede ver
--     (los de sus ventas: la política de alumnos es la que recorta).
-- Lo que NO abre: escribir nada (ni seguimiento ni accesos), ni los
-- formularios semanales, testimonios, CV y asistencias a Zoom del alumno.
-- El director y Administración no cambian: o ven todo ya, o no lo necesitan.
--
-- Va como política APARTE (las de la misma tabla se suman con «o»), para que
-- volver a correr tipos-cuenta.sql o customer-success.sql —que rehacen
-- ver_<tabla>— no la borre. Se puede volver a correr.
-- Para deshacerlo:
--   drop policy servicio_closer_seguimiento_alumnos on public.seguimiento_alumnos;
--   drop policy servicio_closer_accesos_alumno on public.accesos_alumno;
-- ==================================================================

do $$
begin
  if to_regprocedure('public.solo_lo_suyo()') is null or to_regprocedure('public.edita(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan solo_lo_suyo() y edita().';
  end if;
  if to_regclass('public.alumnos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla alumnos.';
  end if;
end $$;

-- El alumno es suyo si la política de alumnos se lo deja ver (el exists corre con SU sesión, así que hereda ese recorte).
do $$
begin
  if to_regclass('public.seguimiento_alumnos') is not null then
    alter table public.seguimiento_alumnos enable row level security;
    drop policy if exists servicio_closer_seguimiento_alumnos on public.seguimiento_alumnos;
    create policy servicio_closer_seguimiento_alumnos on public.seguimiento_alumnos for select to authenticated using (
      (select public.solo_lo_suyo()) and (select public.edita('ventas'))
      and exists (select 1 from public.alumnos a where a.id = seguimiento_alumnos."alumnoId"));
  end if;
  if to_regclass('public.accesos_alumno') is not null then
    alter table public.accesos_alumno enable row level security;
    drop policy if exists servicio_closer_accesos_alumno on public.accesos_alumno;
    create policy servicio_closer_accesos_alumno on public.accesos_alumno for select to authenticated using (
      (select public.solo_lo_suyo()) and (select public.edita('ventas'))
      and exists (select 1 from public.alumnos a where a.id = accesos_alumno."alumnoId"));
  end if;
end $$;
