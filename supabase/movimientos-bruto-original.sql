-- Cobros de pasarela pagados en otra moneda (05/11): Hotmart da el precio en la moneda del comprador (pesos colombianos, soles…) y sólo
-- en dólares lo que llega. `brutoOriginal` guarda lo que pagó, tal cual («3.320.400 COP»); con eso, al atar el cobro al pago que cargó
-- el closer, la comisión real es ese pago menos lo que llegó (lib/completar-cobros.ts → feeConBrutoEnOtraMoneda).
alter table public.movimientos add column if not exists "brutoOriginal" text;

-- Los 17 cobros de Hotmart que entraron con el precio en otra moneda como dólares (respaldo.movimientos_hotmart_moneda_0511, corregidos
-- el 05/11 a lo que llegó): se marcan y vuelven a su descripción. La moneda no se guardó entonces: queda «en su moneda».
update public.movimientos m
set "brutoOriginal" = replace(to_char(round(r.monto), 'FM999,999,999'), ',', '.') || ' en su moneda',
    descripcion = nullif(trim(r.descripcion), '')
from respaldo.movimientos_hotmart_moneda_0511 r
where r.id = m.id and m."brutoOriginal" is null and m.estado = 'pendiente' and m."pagoId" is null;
