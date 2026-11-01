-- Cuenta nueva: Relay (el banco de Apicanta LLC al que Mercury le manda plata).
-- Aldana (01/11): «necesitaría agregar en movimiento entre cuentas 30.000 de Mercury a RELAY (hay que agregarla)».
--
-- Es una cuenta más de la Caja, como Bank of America: en dólares, sin comisión y se cuenta a mano en el arqueo
-- (ninguna API la lee). Con esta fila ya aparece en «Movimiento entre cuentas» y en el arqueo.
--
-- Idempotente: si ya existe, no hace nada.

insert into public.procesadores (id, nombre, "feeRate", activo, automatico)
values ('proc_relay', 'Relay', 0, true, false)
on conflict (id) do nothing;
