-- ==================================================================
-- UTMs, tipo de cambio y Financiera.
--
-- Al cobro: el CBU/CVU desde el que transfirió el cliente (obligatorio
-- si pagó a la Financiera) y el blue venta que había cuando se cargó,
-- con su fuente, para compararlo con el tipo de cambio que puso el
-- closer. A la cuenta recaudadora: en qué moneda recibe y sus cuentas
-- bancarias (salen en el reporte para la Financiera). A los ajustes: de
-- qué estrategia, proyecto y webinar es cada UTM.
--
-- Sólo agrega columnas y marca las cuentas en pesos: se puede correr
-- antes o después del deploy (ver columnaFaltante en store.ts).
-- ==================================================================

alter table pagos
  add column if not exists "cvu" text,
  add column if not exists "tipoCambioBlue" numeric,
  add column if not exists "tipoCambioFuente" text;

alter table procesadores
  add column if not exists "moneda" text,
  add column if not exists "cuentasBancarias" jsonb default '[]'::jsonb;

alter table ajustes
  add column if not exists "reglasUtm" jsonb default '[]'::jsonb;

update procesadores set "moneda" = 'ARS'
  where id in ('proc_financiera_ars', 'proc_mercadopago', 'proc_galicia_ars') and "moneda" is null;
