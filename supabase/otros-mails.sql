-- ==================================================================
-- Otros mails del alumno (Lili, 28/10).
--
-- Los alumnos viejos tienen el ingreso en Wisboo con un mail y en Zoom con otro, y hay que tenerlos presentes al hacer el
-- outboarding (sacarlo de cada plataforma con el mail que usa). Una lista de mails por alumno en su ficha de Servicio
-- (Datos → Otros mails); el principal sigue siendo el de la ficha. Se puede volver a correr.
-- ==================================================================

alter table public.seguimiento_alumnos add column if not exists "otrosMails" jsonb not null default '[]'::jsonb;
