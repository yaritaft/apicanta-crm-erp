-- La demora de inicio y las pausas del programa de cada alumno (Lili, 22/10; lib/pausas.ts): el alumno arranca más tarde
-- (hasta 60 días) o pausa (hasta 45) y el fin del programa se corre solo. Viven en la ficha de seguimiento del alumno, así
-- heredan sus permisos (RLS de seguimiento_alumnos), su historial y el Deshacer. Aditivo: no toca datos.
alter table public.seguimiento_alumnos add column if not exists pausas jsonb not null default '[]'::jsonb;
