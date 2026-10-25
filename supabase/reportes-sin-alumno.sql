-- ==================================================================
-- Reportes semanales que llegaron sin alumno (Lili, 24/10).
--
-- El link general del reporte (/reporte) pide el código de cada alumno. El
-- que no lo tiene lo completa con su mail, nombre, apellido y WhatsApp
-- (lib/reporte-sin-codigo.ts):
--   - si el mail es de un alumno, el reporte va a su ficha (tabla reportes)
--     como cualquier otro: acá no queda nada;
--   - si no (los alumnos de 2024 y 2025 que no están en la app, o quien
--     compró con otro mail), queda acá hasta que Customer Success lo ata a un
--     alumno o lo crea (Reportes → Sin alumno). Al atarlo se copia al reporte
--     del alumno, y de ahí en más ese mail va solo a ese alumno.
-- Uno por mail y semana (`id`): mandarlo dos veces la misma semana lo
-- reemplaza. Lo escribe el servidor (api/reportes/enviar) con la clave de
-- servicio; lo ven y lo atan los que ven y editan alumnos.
-- Se puede volver a correr.
-- ==================================================================

create table if not exists public.reportes_sin_alumno (
  id text primary key,
  email text not null default '',
  nombre text not null default '',
  apellido text not null default '',
  telefono text not null default '',
  -- El lunes de la semana del reporte (al mediodía de Argentina, como los reportes).
  "semanaDel" timestamptz not null,
  formulario text not null default '',
  programa text not null default '',
  -- Lo que se copia al reporte del alumno al atarlo: respuestas, horasEstudio, entrevistas, postulaciones, bloqueo.
  reporte jsonb not null default '{}',
  estado text not null default 'pendiente',
  "alumnoId" text references public.alumnos(id) on delete set null,
  "reporteId" text,
  "atadoPor" text,
  "creadoEn" timestamptz not null default now(),
  "actualizadoEn" timestamptz not null default now(),
  constraint reportes_sin_alumno_estado check (estado in ('pendiente', 'atado', 'descartado')),
  constraint reportes_sin_alumno_atado check (estado <> 'atado' or "alumnoId" is not null)
);
create index if not exists reportes_sin_alumno_estado_idx on public.reportes_sin_alumno (estado, "creadoEn" desc);
create index if not exists reportes_sin_alumno_email_idx on public.reportes_sin_alumno (lower(email));

alter table public.reportes_sin_alumno enable row level security;
drop policy if exists reportes_sin_alumno_ver on public.reportes_sin_alumno;
create policy reportes_sin_alumno_ver on public.reportes_sin_alumno for select to authenticated using ((select public.ve('alumnos')));
drop policy if exists reportes_sin_alumno_atar on public.reportes_sin_alumno;
create policy reportes_sin_alumno_atar on public.reportes_sin_alumno for update to authenticated
  using ((select public.edita('alumnos'))) with check ((select public.edita('alumnos')));
revoke all on public.reportes_sin_alumno from anon;
-- Desde la app sólo se leen y se atan (o descartan): los crea el servidor.
grant select, update on public.reportes_sin_alumno to authenticated;
revoke insert, delete, truncate on public.reportes_sin_alumno from authenticated;
