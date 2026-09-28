-- Conciliación: quién pagó y cómo — Apicanta ERP
--
-- Stripe, Whop, Mercado Pago y dLocal mandan el teléfono del que paga junto
-- con el nombre y el correo, y todas dicen cómo pagó (tarjeta, wire, USDT).
-- Se guarda con el cobro: la cuenta sola ("Stripe") no dice de dónde vino
-- la plata, y con el teléfono se le puede escribir sin salir de Conciliación.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

alter table public.movimientos add column if not exists "clienteTelefono" text;
alter table public.movimientos add column if not exists metodo text;

select count(*) filter (where "clienteTelefono" is not null) con_telefono,
       count(*) filter (where metodo is not null) con_metodo,
       count(*) total
from public.movimientos;
