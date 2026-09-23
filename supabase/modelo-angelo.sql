-- ==================================================================
-- Modelo de la planilla de Angelo ("Centro de control", hoja Ventas).
--
-- Agrega a la venta y al cobro lo que la planilla guardaba y la app no:
-- proyecto, setter, referidor, ingreso a la comunidad; característica
-- del pago, venta nueva vs cuota, tipo de cambio y monto en ARS, quién
-- transfirió, CUIT, chequeado, el link del comprobante y si la comisión
-- del procesador se cargó a mano. También la marca del embudo de webinar
-- y la lista de proyectos.
--
-- Sólo agrega columnas: se puede correr antes o después del deploy. Hasta
-- que corra, la app guarda todo lo demás y deja afuera estos campos (ver
-- columnaFaltante en store.ts).
-- ==================================================================

alter table ventas
  add column if not exists "proyecto" text,
  add column if not exists "setterId" text,
  add column if not exists "referidorNombre" text,
  add column if not exists "referidorTelefono" text,
  add column if not exists "ingresoComunidad" text;

alter table pagos
  add column if not exists "caracteristica" text,
  add column if not exists "tipoVenta" text,
  add column if not exists "tipoCambio" numeric,
  add column if not exists "montoArs" numeric,
  add column if not exists "pagador" text,
  add column if not exists "cuit" text,
  add column if not exists "chequeado" boolean,
  add column if not exists "comprobanteLink" text,
  add column if not exists "feeManual" boolean;

alter table embudos
  add column if not exists "esWebinar" boolean default false;

alter table ajustes
  add column if not exists "proyectos" text[] default '{}',
  add column if not exists "comisionReferidor" numeric default 0.1;
