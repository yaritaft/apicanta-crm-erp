-- ==================================================================
-- El cartel de «actualizá la app» (Juan Cruz, 23/10: «que salga un cartelito para actualizar la app sí o sí»).
-- Cada versión publicada lo dispara sola; esta columna es para cuando un dueño cambia algo de Ajustes que el equipo
-- tiene que ver ya (por ejemplo, prender los contratos para todos): se aprieta «Pedir a todos que actualicen».
-- Se puede correr más de una vez.
-- ==================================================================
alter table public.ajustes add column if not exists "recargaPedida" timestamptz;
