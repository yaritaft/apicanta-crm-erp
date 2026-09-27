-- Conciliación: cobros atados a un pago que ya estaba cargado — Apicanta ERP
--
-- Muchos cobros de pasarela ya están en la app como pago (cargados a mano o
-- desde la planilla de Angelo). Conciliarlos atándolos a ese pago no crea
-- otro: esta columna lo marca, así deshacer desata el pago en vez de borrarlo.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

alter table public.movimientos add column if not exists vinculado boolean not null default false;

select count(*) filter (where vinculado) vinculados, count(*) total from public.movimientos;
