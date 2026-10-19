-- Por qué un cobro de una pasarela «no corresponde a ninguna venta» (estado «ignorado», que en la pantalla se llama «Sin venta»).
-- Revisión con Aldana (19/10): todo ingreso y egreso de una pasarela tiene que estar justificado, así que ya no se ignora nada sin decir por qué.
-- Aditivo: una columna de texto, sin tocar datos. La app la escribe al ignorar un cobro y la muestra en la pestaña «Sin venta» y en Transacciones.
alter table public.movimientos add column if not exists motivo text;
