-- Equipo: hasta cuándo estuvo cada uno — Apicanta ERP
--
-- "Si el director de la venta no es el que está ahora, no comisiona" (Yari).
-- Con la fecha de salida, un director cobra sólo lo que entró hasta ese día.
-- Texto YYYY-MM-DD, como los demás campos de fecha que se editan a mano.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

alter table public.equipo add column if not exists hasta text;

select count(*) filter (where hasta is not null) con_fecha_de_salida, count(*) total from public.equipo;
