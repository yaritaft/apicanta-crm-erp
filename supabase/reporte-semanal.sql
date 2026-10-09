-- Reporte semanal con link único — Apicanta ERP
--
-- Cada alumno tiene un código (UUID, no un número correlativo) con el que completa
-- su reporte semanal en el link de siempre (/reporte). La tabla no tiene políticas:
-- ni quien inició sesión la puede leer desde el navegador. Sólo la leen y escriben
-- las rutas de la app (con la clave de servicio), que antes comprueban quién pide.
--
-- Se crea de a uno, cuando alguien pide el link del alumno: no hace falta cargar nada.
-- Si se borra el alumno, se borra su código.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

create table if not exists public.reporte_codigos (
  "alumnoId" text primary key references public.alumnos(id) on delete cascade,
  codigo uuid not null default gen_random_uuid(),
  "creadoEn" timestamptz not null default now(),
  -- El último aviso por mail: cuándo salió, su id en Resend y lo último que le pasó.
  "ultimoAvisoEn" timestamptz,
  "ultimoAvisoId" text,
  "ultimoAvisoEstado" text
);

create unique index if not exists reporte_codigos_codigo_uq on public.reporte_codigos (codigo);

alter table public.reporte_codigos enable row level security;
-- Sin políticas, y sin permisos para los roles de la API: sólo la clave de servicio.
revoke all on public.reporte_codigos from anon, authenticated;

select count(*) codigos from public.reporte_codigos;
