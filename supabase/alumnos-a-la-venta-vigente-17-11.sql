-- ==================================================================
-- Alumnos atados a una venta cancelada cuando la persona tiene otra venta activa (Lili, 17/11/2026)
--
--   «Alan Vargas… en "seguimiento" me figuraba de baja, lo quise cambiar pero está como reserva y no me deja modificarlo.»
--
-- Qué pasó: Valentín cargó la reserva de Alan (USD 62,50) como una venta y, cuando completó el pago (16/11), cargó el resto como OTRA
-- venta. Aldana canceló la primera por repetida, pero el alumno siguió atado a esa venta cancelada: Servicio lo veía de baja y, al
-- volverlo a «Activo», como una reserva que nunca arranca. El código ya lo evita (al cancelar una venta, el servicio pasa a la otra venta
-- activa de la persona); esto corrige los que ya habían quedado así: Alan Vargas e Iván Suchan (el de la planilla y el de la app, misma
-- compra de USD 3.000). Jhonatan Romero NO se toca: su venta está reembolsada y hay que confirmarlo con Aldana.
--
-- Se puede volver a correr. Respaldo en respaldo.alumnos_venta_vigente_1711.
-- ==================================================================
create schema if not exists respaldo;
create table if not exists respaldo.alumnos_venta_vigente_1711 as
  select a.*, now() as "respaldadoEn" from public.alumnos a where a.id in ('alu_mwgyyeq6002ldsf', 'alu_cs_1q5ekfu');

update public.alumnos a
set "ventaId" = 'ven_mwjhfi9y0012lx3',
    extra = coalesce(a.extra, '{}'::jsonb) || jsonb_build_object('ventaAntesDeLaBaja', 'ven_mwgyyeq0002ij7q')
where a.id = 'alu_mwgyyeq6002ldsf' and a."ventaId" = 'ven_mwgyyeq0002ij7q'
  and exists (select 1 from public.ventas v where v.id = 'ven_mwjhfi9y0012lx3' and v.estado = 'activa');

update public.alumnos a
set "ventaId" = 'ven_ef_1fjtjua',
    extra = coalesce(a.extra, '{}'::jsonb) || jsonb_build_object('ventaAntesDeLaBaja', 'ven_mvh7vwx0v9jnd')
where a.id = 'alu_cs_1q5ekfu' and a."ventaId" = 'ven_mvh7vwx0v9jnd'
  and exists (select 1 from public.ventas v where v.id = 'ven_ef_1fjtjua' and v.estado = 'activa');
