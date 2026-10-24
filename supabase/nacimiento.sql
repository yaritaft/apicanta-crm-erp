-- ==================================================================
-- La fecha de nacimiento del alumno (Juan Cruz, 24/10).
--
-- La ficha pedía la edad, que cambia cada año y nadie actualiza. Ahora se
-- guarda la fecha de nacimiento y la edad se calcula (lib/clientes-cs.ts).
-- La carga el closer en los datos del contrato y pasa sola a la ficha
-- (contrato-completa-ficha.sql), o Customer Success en la ficha. La edad
-- que ya estaba cargada a mano se sigue mostrando mientras no haya fecha.
-- Se puede volver a correr.
-- ==================================================================

alter table public.seguimiento_alumnos add column if not exists nacimiento date;
