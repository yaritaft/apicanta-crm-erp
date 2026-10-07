-- Cuentas recaudadoras: cuáles van en «Otros» del arqueo — Apicanta ERP
--
-- En la Caja, el arqueo lista primero las cuentas que se usan todo el tiempo y
-- deja plegadas, bajo «Otros», las que no (Mercado Pago, Galicia, Efectivo USD,
-- Binance). Cada cuenta lo dice con esta columna (Ajustes → Ventas → Cuentas
-- recaudadoras → «Otros»). Vacía, la app decide por el nombre.
--
-- Sin esta columna el arqueo agrupa igual por el nombre; sólo no queda guardado
-- lo que se cambie a mano. Idempotente: se puede correr de nuevo.

alter table public.procesadores add column if not exists "cajaOtros" boolean;

select count(*) filter (where "cajaOtros" is not null) con_decision, count(*) total from public.procesadores;
