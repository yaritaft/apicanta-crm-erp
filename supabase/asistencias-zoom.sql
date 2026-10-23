-- La asistencia a las clases de Zoom — Apicanta ERP (Yari, 22/10)
--
-- «Para ver si una persona está activa o no en el servicio, a cuántas clases asistió». Zoom dice, de cada clase, quién entró, cuándo
-- salió y cuántos minutos estuvo; la app lo trae cada hora (/api/cron/zoom-asistencia) y lo muestra en la ficha del alumno → Accesos.
--
--   · `public.asistencias_zoom`: una fila por persona y clase (el id es la clase + el mail: traer la misma clase dos veces no duplica).
--   · `public.asistencias_zoom_clases`: una fila por clase traída, aunque nadie de los nuestros haya entrado: sirve para decir
--     «asistió a 3 de 8 clases».
--   · Las escribe sólo el servidor (clave de servicio); las lee quien ve Alumnos, igual que los accesos (accesos_alumno).
--
-- Sin esto la app anda igual: la ficha dice que todavía no se trajo la asistencia. Idempotente y sin tocar datos; para deshacerlo:
-- `drop table public.asistencias_zoom, public.asistencias_zoom_clases;`.

do $$ begin
  if to_regclass('public.accesos_alumno') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla accesos_alumno (supabase/contratos-y-accesos.sql).';
  end if;
end $$;

create table if not exists public.asistencias_zoom (
  id          text primary key,
  reunion     text not null,
  instancia   text not null,
  tema        text not null default '',
  inicio      timestamptz not null,
  email       text not null,
  nombre      text not null default '',
  entro       timestamptz,
  salio       timestamptz,
  minutos     numeric not null default 0,
  "traidoEn"  timestamptz not null default now()
);
create index if not exists asistencias_zoom_email on public.asistencias_zoom (email);
create index if not exists asistencias_zoom_instancia on public.asistencias_zoom (instancia);
alter table public.asistencias_zoom enable row level security;
drop policy if exists ver_asistencias_zoom on public.asistencias_zoom;
create policy ver_asistencias_zoom on public.asistencias_zoom for select to authenticated using (
  (select public.ve('alumnos')));

create table if not exists public.asistencias_zoom_clases (
  instancia      text primary key,
  reunion        text not null,
  tema           text not null default '',
  inicio         timestamptz not null,
  participantes  integer not null default 0,
  "traidoEn"     timestamptz not null default now()
);
create index if not exists asistencias_zoom_clases_inicio on public.asistencias_zoom_clases (inicio desc);
alter table public.asistencias_zoom_clases enable row level security;
drop policy if exists ver_asistencias_zoom_clases on public.asistencias_zoom_clases;
create policy ver_asistencias_zoom_clases on public.asistencias_zoom_clases for select to authenticated using (
  (select public.ve('alumnos')));
