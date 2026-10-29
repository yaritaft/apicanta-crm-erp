-- Seguimiento del cobro de una cuota vencida (Aldana, 28/10): el closer marca «contactado» / «no responde» / «pido la baja por falta
-- de pago» y Finanzas lo ve. Una sola columna nueva, vacía para todas las cuotas que ya existen. Aditivo: no toca datos.
-- Forma: {"estado": "contactado" | "no-responde" | "baja", "nota": "...", "por": "quién", "en": "ISO"}.
alter table public.cuotas add column if not exists "seguimientoCobro" jsonb;
comment on column public.cuotas."seguimientoCobro" is 'Cómo va el cobro de la cuota vencida: estado, nota, quién lo marcó y cuándo (la app: lib/cobranza-seguimiento.ts).';
