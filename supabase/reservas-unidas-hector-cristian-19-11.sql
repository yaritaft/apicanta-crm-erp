-- Héctor Méndez y Cristian Lopez: la reserva y el resto, en UNA venta — Apicanta ERP (19/11, siguiendo lo de Carlos Juca del 18/11)
--
-- Mismo patrón que Carlos Juca (supabase/reserva-completada-juca-18-11.sql): la reserva quedó en una venta y lo que faltaba se cargó como OTRA
-- venta, porque la app no tenía cómo completar una reserva (desde el 18/11 sí: acciones.completarReserva). La plata no se duplicó (las reservas
-- no están repetidas adentro de la segunda venta), pero eran dos ventas, dos «Ya compró» y una reserva que seguía figurando como reserva.
--
--   · Héctor Méndez (Dante, 14/11): reserva de 200 (ven_mwgk2mi2000e56q) + 2.300 por Whop (ven_mwgp8xv10009uea) = Hackear AI de 2.500.
--     Queda la venta de la reserva, con la cuota de 2.300, su cobro de Whop conciliado y el contrato del programa firmado.
--   · Cristian Lopez (Dante, octubre): seña de 50 de Hackear AI cargada de la planilla (ven_ef_1okamn0) + Downsell de 450 (ven_mvs65f8e0027dss) =
--     Downsell de 500. Queda la venta de la planilla (para que reimportar la planilla no la resucite), que pasa a Downsell por 500, con la cuota
--     de 450, sus dos cobros (Hotmart y Stripe), el contrato de acceso al contenido grabado, la llamada y el alumno (plan Downsell).
--     No cambia ninguna comisión: Dante cobra 10% en Hackear AI y en Downsell (sólo resell y upsell tienen 5%) y el director 0%; tampoco se
--     mueve el cobro de mes (octubre, ya liquidado): todos los cobros conservan su fecha, su monto y su comisión.
--
-- Qué se toca de un cobro: NADA salvo su etiqueta «Ventas Nuevas vs Cuotas» (lo que entra después de la reserva es «Cuota», como lo hace la app).
-- Una guarda dentro de cada bloque exige que monto, fecha, comisión, chequeos y atadura a la pasarela queden idénticos; si no, no se hace nada.
-- Lo mismo se aplica al cobro de 2.600 de Carlos Juca (la misma etiqueta).
--
-- Respaldo: respaldo.pares_reserva_1911 guarda la fila entera de todo lo que toca, como estaba; lo borrado queda además en ventas_eliminadas.
-- Se puede correr más de una vez: si la venta repetida ya no está, no hace nada. Si algo cambió desde el 19/11, frena sin tocar.

create schema if not exists respaldo;
create table if not exists respaldo.pares_reserva_1911 (
  tabla text not null, id text not null, fila jsonb not null, cuando timestamptz not null default now(), primary key (tabla, id)
);
alter table respaldo.pares_reserva_1911 enable row level security;

-- ===================== Héctor Méndez =====================
do $$
declare
  r constant text := 'ven_mwgk2mi2000e56q';             -- la reserva de 200: queda
  f constant text := 'ven_mwgp8xv10009uea';             -- la venta de 2.300: se va
  cuota_resto constant text := 'cuo_mwgp34s70007dhh';
  pago_resto constant text := 'pag_mwgp8xvf000akvv';
  pago_reserva constant text := 'pag_mwgk2mie000fb0a';
  mov_resto constant text := 'mov_whop_pay_RXpfqZxpeVB5sX';
  contrato_programa constant text := 'ctr_mwgp8z55wgqaz';
  persona constant text := 'con_web_a2c8475d0bda4ba1';
  antes jsonb;
  despues jsonb;
  n int;
begin
  if not exists (select 1 from public.ventas where id = f) then
    raise notice 'Héctor Méndez: la venta de 2.300 ya no está, nada que hacer.';
    return;
  end if;
  if not exists (select 1 from public.ventas where id = r and estado = 'activa' and "precioAcordado" = 200 and "productoId" = 'prod_hackear_ai' and "contactoId" = persona)
     or not exists (select 1 from public.ventas where id = f and estado = 'activa' and "precioAcordado" = 2300 and "productoId" = 'prod_hackear_ai' and "contactoId" = persona) then
    raise exception 'Las ventas de Héctor Méndez cambiaron (estado, servicio o valor): revisar antes de unir.';
  end if;
  select count(*) into n from public.cuotas where "ventaId" = r;
  if n <> 1 or not exists (select 1 from public.cuotas where "ventaId" = r and "esReserva" and estado = 'pagada' and monto = 200) then
    raise exception 'La venta de la reserva de Héctor Méndez ya no tiene sólo su reserva pagada: revisar antes de unir.';
  end if;
  select count(*) into n from public.cuotas where "ventaId" = f;
  if n <> 1 or not exists (select 1 from public.cuotas where id = cuota_resto and "ventaId" = f and not "esReserva" and estado = 'pagada' and monto = 2300) then
    raise exception 'La venta de 2.300 de Héctor Méndez ya no tiene su única cuota pagada: revisar antes de unir.';
  end if;
  if (select count(*) from public.pagos where "cuotaId" in (select id from public.cuotas where "ventaId" in (r, f))) <> 2
     or not exists (select 1 from public.pagos where id = pago_resto and "cuotaId" = cuota_resto and "movimientoId" = mov_resto and monto = 2300)
     or not exists (select 1 from public.pagos where id = pago_reserva and monto = 200) then
    raise exception 'Los cobros de Héctor Méndez cambiaron: revisar antes de unir.';
  end if;
  if exists (select 1 from public.devoluciones where "ventaId" in (r, f)) then
    raise exception 'Hay una devolución en una de las dos ventas de Héctor Méndez: revisar antes de unir.';
  end if;

  insert into respaldo.pares_reserva_1911 (tabla, id, fila)
    select 'ventas', v.id, to_jsonb(v) from public.ventas v where v.id in (r, f)
    union all select 'cuotas', c.id, to_jsonb(c) from public.cuotas c where c."ventaId" in (r, f)
    union all select 'pagos', p.id, to_jsonb(p) from public.pagos p where p."cuotaId" in (select id from public.cuotas where "ventaId" in (r, f))
    union all select 'movimientos', m.id, to_jsonb(m) from public.movimientos m where m."ventaId" in (r, f)
    union all select 'contratos', k.id, to_jsonb(k) from public.contratos k where k."ventaId" in (r, f)
    union all select 'alumnos', a.id, to_jsonb(a) from public.alumnos a where a."ventaId" in (r, f)
  on conflict (tabla, id) do nothing;

  select jsonb_agg(to_jsonb(p) - 'tipoVenta' order by p.id) into antes from public.pagos p where p.id in (pago_resto, pago_reserva);

  update public.cuotas set "ventaId" = r where id = cuota_resto;
  update public.movimientos set "ventaId" = r where id = mov_resto;
  update public.contratos set "ventaId" = r where id = contrato_programa;
  update public.alumnos set "ventaId" = r where "ventaId" = f;
  update public.pagos set "tipoVenta" = 'Cuota' where id = pago_resto;

  delete from public.ventas where id = f;

  update public.ventas set
    "precioAcordado" = 2500,
    notas = case when coalesce(notas, '') = '' then 'Dejó la reserva de 200 el 14/11 y completó los 2.300 ese mismo día (Whop).' else notas end,
    extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('reservaCompletada',
      jsonb_build_object('en', now(), 'por', 'Arreglo del 19/11: se unió con la venta de 2.300', 'valia', 200, 'unidaCon', f))
  where id = r;

  select jsonb_agg(to_jsonb(p) - 'tipoVenta' order by p.id) into despues from public.pagos p where p.id in (pago_resto, pago_reserva);
  if antes is distinct from despues then
    raise exception 'Un cobro de Héctor Méndez cambió más que su etiqueta: no se hace nada. Antes %, después %', antes, despues;
  end if;

  insert into public.actividad (id, entidad, "entidadId", titulo, accion, detalle, actor, fecha)
  values ('act_reserva_hector_1911', 'transaccion', r, 'Héctor Méndez', 'actualizo',
    'Héctor Méndez completó la reserva: la venta pasó de 200 a 2500. La reserva (200) y lo que faltaba (2300, Whop) quedaron en esta sola venta; se eliminó la venta de 2.300 que se había cargado aparte.',
    'Apicanta', now())
  on conflict (id) do nothing;

  select count(*) into n from public.ventas where "contactoId" = persona and estado = 'activa';
  if n <> 1 then raise exception 'Quedaron % ventas activas de Héctor Méndez (tenía que quedar 1).', n; end if;
  if (select coalesce(sum(p.monto), 0) from public.pagos p join public.cuotas c on c.id = p."cuotaId" where c."ventaId" = r) <> 2500
     or (select coalesce(sum(c.monto), 0) from public.cuotas c where c."ventaId" = r) <> 2500 then
    raise exception 'La venta unida de Héctor Méndez no cierra en 2.500.';
  end if;
  --[ensayo-hector]
end $$;

-- ===================== Cristian Lopez =====================
do $$
declare
  r constant text := 'ven_ef_1okamn0';                  -- la seña de la planilla: queda (pasa a Downsell por 500)
  f constant text := 'ven_mvs65f8e0027dss';             -- el Downsell de 450: se va
  cuota_resto constant text := 'cuo_mvs64b6g0024ofm';
  pagos_resto constant text[] := array['pag_mvs65f8k0029v3s', 'pag_mvs65f8k0028n2y'];
  pago_reserva constant text := 'pag_ef_1tab6wl';
  movs_resto constant text[] := array['mov_hotmart_HP2869946248', 'mov_stripe_ch_3UVW87Cda71F5AQH1zEiIa78'];
  contrato_programa constant text := 'ctr_mvs65htzprmbz';
  llamada constant text := 'ses_at_333f426ce231';
  persona constant text := 'lea_cal_9b43d345-4ac0-4552-bee0-0f6ef128ea51';
  alumno constant text := 'alu_mvgte8zca9p47';
  antes jsonb;
  despues jsonb;
  proyecto_f text;
  n int;
begin
  if not exists (select 1 from public.ventas where id = f) then
    raise notice 'Cristian Lopez: el Downsell de 450 ya no está, nada que hacer.';
    return;
  end if;
  if not exists (select 1 from public.ventas where id = r and estado = 'activa' and "precioAcordado" = 50 and "productoId" = 'prod_hackear_ai' and "contactoId" = persona and "closerId" = 'eq_dante')
     or not exists (select 1 from public.ventas where id = f and estado = 'activa' and "precioAcordado" = 450 and "productoId" = 'prod_downsell' and "contactoId" = persona and "closerId" = 'eq_dante' and "sesionId" = llamada) then
    raise exception 'Las ventas de Cristian Lopez cambiaron (estado, servicio, valor o vendedor): revisar antes de unir.';
  end if;
  select count(*) into n from public.cuotas where "ventaId" = r;
  if n <> 1 or not exists (select 1 from public.cuotas where "ventaId" = r and "esReserva" and estado = 'pagada' and monto = 50) then
    raise exception 'La seña de Cristian Lopez ya no tiene sólo su reserva pagada: revisar antes de unir.';
  end if;
  select count(*) into n from public.cuotas where "ventaId" = f;
  if n <> 1 or not exists (select 1 from public.cuotas where id = cuota_resto and "ventaId" = f and not "esReserva" and estado = 'pagada' and monto = 450) then
    raise exception 'El Downsell de Cristian Lopez ya no tiene su única cuota pagada: revisar antes de unir.';
  end if;
  if (select count(*) from public.pagos where "cuotaId" in (select id from public.cuotas where "ventaId" in (r, f))) <> 3
     or (select count(*) from public.pagos where id = any(pagos_resto) and "cuotaId" = cuota_resto) <> 2
     or not exists (select 1 from public.pagos where id = pago_reserva and monto = 50) then
    raise exception 'Los cobros de Cristian Lopez cambiaron: revisar antes de unir.';
  end if;
  if exists (select 1 from public.devoluciones where "ventaId" in (r, f)) then
    raise exception 'Hay una devolución en una de las dos ventas de Cristian Lopez: revisar antes de unir.';
  end if;
  if not exists (select 1 from public.alumnos where id = alumno and "ventaId" = r) then
    raise exception 'El alumno de Cristian Lopez ya no está atado a la seña: revisar antes de unir.';
  end if;

  insert into respaldo.pares_reserva_1911 (tabla, id, fila)
    select 'ventas', v.id, to_jsonb(v) from public.ventas v where v.id in (r, f)
    union all select 'cuotas', c.id, to_jsonb(c) from public.cuotas c where c."ventaId" in (r, f)
    union all select 'pagos', p.id, to_jsonb(p) from public.pagos p where p."cuotaId" in (select id from public.cuotas where "ventaId" in (r, f))
    union all select 'movimientos', m.id, to_jsonb(m) from public.movimientos m where m."ventaId" in (r, f)
    union all select 'contratos', k.id, to_jsonb(k) from public.contratos k where k."ventaId" in (r, f)
    union all select 'alumnos', a.id, to_jsonb(a) from public.alumnos a where a."ventaId" in (r, f)
    union all select 'sesiones', s.id, to_jsonb(s) from public.sesiones s where s.id = llamada
  on conflict (tabla, id) do nothing;

  select jsonb_agg(to_jsonb(p) - 'tipoVenta' order by p.id) into antes from public.pagos p where p.id = pago_reserva or p.id = any(pagos_resto);
  select proyecto into proyecto_f from public.ventas where id = f;

  update public.cuotas set "ventaId" = r where id = cuota_resto;
  update public.movimientos set "ventaId" = r where id = any(movs_resto);
  update public.contratos set "ventaId" = r where id = contrato_programa;
  update public.pagos set "tipoVenta" = 'Cuota' where id = any(pagos_resto);

  delete from public.ventas where id = f;

  -- La seña pasa a ser el Downsell entero: es lo que compró (la seña era de Hackear AI; Dante, 27/10: «la seña pasa a Downsell»).
  update public.ventas set
    "productoId" = 'prod_downsell',
    "precioAcordado" = 500,
    "sesionId" = llamada,
    proyecto = coalesce(proyecto_f, proyecto),
    notas = case when coalesce(notas, '') = '' then 'Dejó una seña de 50 el 14/10 (Hackear AI) y compró el Downsell: completó 450 el 28/10 (Hotmart y Stripe).' else notas end,
    extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('reservaCompletada',
      jsonb_build_object('en', now(), 'por', 'Arreglo del 19/11: se unió con el Downsell de 450', 'valia', 50, 'unidaCon', f, 'servicioAntes', 'prod_hackear_ai'))
  where id = r;

  update public.alumnos set plan = 'Downsell' where id = alumno;
  -- La llamada seguía en «Reserva» aunque ya compró el Downsell (si alguien le puso otro estado, no se pisa).
  update public.sesiones set "estadoLlamada" = 'Compra Downsell' where id = llamada and "estadoLlamada" = 'Reserva';

  select jsonb_agg(to_jsonb(p) - 'tipoVenta' order by p.id) into despues from public.pagos p where p.id = pago_reserva or p.id = any(pagos_resto);
  if antes is distinct from despues then
    raise exception 'Un cobro de Cristian Lopez cambió más que su etiqueta: no se hace nada. Antes %, después %', antes, despues;
  end if;

  insert into public.actividad (id, entidad, "entidadId", titulo, accion, detalle, actor, fecha)
  values ('act_reserva_cristian_1911', 'transaccion', r, 'Cristian Lopez', 'actualizo',
    'Cristian Lopez completó la reserva: la seña de 50 (Hackear AI) y el Downsell de 450 quedaron en esta sola venta de Downsell por 500; se eliminó la venta de 450 que se había cargado aparte.',
    'Apicanta', now())
  on conflict (id) do nothing;

  select count(*) into n from public.ventas where "contactoId" = persona and estado = 'activa';
  if n <> 1 then raise exception 'Quedaron % ventas activas de Cristian Lopez (tenía que quedar 1).', n; end if;
  if (select coalesce(sum(p.monto), 0) from public.pagos p join public.cuotas c on c.id = p."cuotaId" where c."ventaId" = r) <> 500
     or (select coalesce(sum(c.monto), 0) from public.cuotas c where c."ventaId" = r) <> 500 then
    raise exception 'La venta unida de Cristian Lopez no cierra en 500.';
  end if;
  --[ensayo-cristian]
end $$;

-- ===================== Carlos Juca: la etiqueta del cobro que completó la reserva =====================
do $$
declare
  antes jsonb;
  despues jsonb;
begin
  if not exists (select 1 from public.pagos where id = 'pag_mwl7kr2j000uae6' and "tipoVenta" = 'Venta Nueva') then
    raise notice 'Carlos Juca: el cobro de 2.600 ya tiene otra etiqueta, nada que hacer.';
    return;
  end if;
  select jsonb_agg(to_jsonb(p) - 'tipoVenta') into antes from public.pagos p where p.id = 'pag_mwl7kr2j000uae6';
  update public.pagos set "tipoVenta" = 'Cuota' where id = 'pag_mwl7kr2j000uae6';
  select jsonb_agg(to_jsonb(p) - 'tipoVenta') into despues from public.pagos p where p.id = 'pag_mwl7kr2j000uae6';
  if antes is distinct from despues then
    raise exception 'El cobro de Carlos Juca cambió más que su etiqueta: no se hace nada.';
  end if;
end $$;

select json_build_object(
  'ventas_hector', (select json_agg(json_build_object('id', v.id, 'valor', v."precioAcordado", 'servicio', v."productoId", 'estado', v.estado) ) from public.ventas v where v."contactoId" = 'con_web_a2c8475d0bda4ba1'),
  'ventas_cristian', (select json_agg(json_build_object('id', v.id, 'valor', v."precioAcordado", 'servicio', v."productoId", 'estado', v.estado, 'llamada', v."sesionId") ) from public.ventas v where v."contactoId" = 'lea_cal_9b43d345-4ac0-4552-bee0-0f6ef128ea51'),
  'cuotas', (select json_agg(json_build_object('venta', c."ventaId", 'n', c.numero, 'monto', c.monto, 'estado', c.estado, 'reserva', c."esReserva") order by c."ventaId", c.numero) from public.cuotas c where c."ventaId" in ('ven_mwgk2mi2000e56q', 'ven_ef_1okamn0')),
  'cobrado', (select json_agg(json_build_object('venta', c."ventaId", 'cobrado', x.t)) from (select c."ventaId", sum(p.monto) t from public.pagos p join public.cuotas c on c.id = p."cuotaId" where c."ventaId" in ('ven_mwgk2mi2000e56q', 'ven_ef_1okamn0') group by 1) x join public.cuotas c on c."ventaId" = x."ventaId" and c.numero = 0),
  'contratos', (select json_agg(json_build_object('venta', k."ventaId", 'plantilla', k."plantillaNombre", 'estado', k.estado)) from public.contratos k where k."ventaId" in ('ven_mwgk2mi2000e56q', 'ven_ef_1okamn0')),
  'alumnos', (select json_agg(json_build_object('nombre', a.nombre, 'plan', a.plan, 'venta', a."ventaId", 'estado', a.estado)) from public.alumnos a where a.id in ('alu_mwgk2mig000h7sa', 'alu_mvgte8zca9p47')),
  'llamadas', (select json_agg(json_build_object('id', s.id, 'estado', s."estadoLlamada")) from public.sesiones s where s.id in ('ses_at_333f426ce231', 'cal_7e9b87a4-37c6-47af-be03-86570e004db8')),
  'respaldo', (select count(*) from respaldo.pares_reserva_1911)
) as como_quedo;
