-- Las sesiones 1 a 1 de cada alumno (reunión del 21/10 con Lili): las del contrato con Yari (los «bonos») y las de
-- acompañamiento con Lili, con la fecha, las notas y el link de la grabación. Viven en la ficha de seguimiento del alumno,
-- así heredan sus permisos (RLS de seguimiento_alumnos), su historial y el Deshacer. Aditivo: no toca datos.
alter table public.seguimiento_alumnos add column if not exists "sesionesUnoAUno" jsonb not null default '[]'::jsonb;
