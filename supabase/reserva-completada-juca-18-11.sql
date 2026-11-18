-- Carlos Juca: la reserva y el resto, en UNA venta — Apicanta ERP (Aldana, 18/11)
--
-- Dejó US$ 400 de reserva de Hackear AI el 16/11 (venta ven_mwjr6fli000bopj, «sólo la reserva») y el 17/11 pagó los 2.600
-- que faltaban. No había por dónde completar la reserva, así que se cargó OTRA venta de 3.000 (ven_mwl7kr2c000sa0e) con la
-- reserva adentro, cargada a mano por segunda vez: 3.400 cobrados en vez de 3.000, dos ventas y dos contratos en ventas distintas.
--
-- Queda como lo deja ahora la app al «Completar la reserva» (lib/reservas.ts, acciones.completarReserva):
--   · UNA venta, la de la reserva (la original: su fecha, su llamada, su alumno y el cobro de Stripe que Finanzas ya chequeó),
--     que pasa a valer 3.000;
--   · la cuota de 2.600 con su cobro conciliado se muda a esa venta, y el contrato del programa también;
--   · la otra venta se borra, con su reserva repetida y el cobro de 400 cargado a mano (el mismo comprobante, por segunda vez);
--   · la llamada pasa de «Reserva» a «Compra Full».
--
-- Respaldo: respaldo.reserva_juca_1811 guarda la fila entera de todo lo que toca, como estaba; y lo borrado queda además en
-- ventas_eliminadas (por sus triggers). Deshacerlo = reinsertar esas filas con jsonb_populate_record.
--
-- Se puede correr más de una vez: si la venta repetida ya no está, no hace nada. Si algo cambió desde el 18/11, frena sin tocar.

do $$
declare
  r constant text := 'ven_mwjr6fli000bopj';            -- la reserva: queda
  f constant text := 'ven_mwl7kr2c000sa0e';            -- la repetida: se va
  cuota_reserva constant text := 'cuo_mwjr3ezk0009olm'; -- la reserva de verdad (400, Stripe conciliado)
  cuota_repetida constant text := 'cuo_mwl73z9x000o0cm';-- la reserva cargada otra vez en la venta repetida
  cuota_resto constant text := 'cuo_mwl73z9x000pri0';   -- los 2.600: se muda
  pago_repetido constant text := 'pag_mwl7kr2j000tfpz'; -- 400 a mano, sin pago de pasarela
  mov_resto constant text := 'mov_stripe_ch_3UcrKUCda71F5AQH0yimJDOV';
  contrato_programa constant text := 'ctr_mwl7ktee06yu5';
  llamada constant text := 'cal_4ec55b81-189d-4ef7-9f21-4f4173a0e4ea';
  n int;
begin
  if not exists (select 1 from public.ventas where id = f) then
    raise notice 'La venta repetida de Carlos Juca ya no está: nada que hacer.';
    return;
  end if;

  -- Tiene que estar todo como el 18/11; si alguien lo movió, no se toca.
  if not exists (select 1 from public.ventas where id = r and estado = 'activa' and "precioAcordado" = 400)
     or not exists (select 1 from public.ventas where id = f and estado = 'activa' and "precioAcordado" = 3000) then
    raise exception 'Las ventas de Carlos Juca cambiaron (estado o valor): revisar antes de unir.';
  end if;
  select count(*) into n from public.cuotas where "ventaId" = r;
  if n <> 1 or not exists (select 1 from public.cuotas where id = cuota_reserva and "ventaId" = r and "esReserva" and estado = 'pagada' and monto = 400) then
    raise exception 'La venta de la reserva ya no tiene sólo su reserva pagada: revisar antes de unir.';
  end if;
  select count(*) into n from public.cuotas where "ventaId" = f;
  if n <> 2 or not exists (select 1 from public.cuotas where id = cuota_repetida and "ventaId" = f and "esReserva" and monto = 400)
     or not exists (select 1 from public.cuotas where id = cuota_resto and "ventaId" = f and not "esReserva" and estado = 'pagada' and monto = 2600) then
    raise exception 'La venta repetida ya no tiene la reserva de 400 y la cuota de 2.600: revisar antes de unir.';
  end if;
  select count(*) into n from public.pagos where "cuotaId" in (cuota_reserva, cuota_repetida, cuota_resto);
  if n <> 3 or not exists (select 1 from public.pagos where id = pago_repetido and "cuotaId" = cuota_repetida and "movimientoId" is null and monto = 400)
     or not exists (select 1 from public.pagos where "cuotaId" = cuota_reserva and "movimientoId" is not null and monto = 400)
     or not exists (select 1 from public.pagos where "cuotaId" = cuota_resto and "movimientoId" = mov_resto and monto = 2600) then
    raise exception 'Los cobros de Carlos Juca cambiaron: revisar antes de unir.';
  end if;
  if exists (select 1 from public.devoluciones where "ventaId" in (r, f)) then
    raise exception 'Hay una devolución cargada en una de las dos ventas: revisar antes de unir.';
  end if;

  -- Respaldo de todo lo que se toca, como estaba.
  create schema if not exists respaldo;
  create table if not exists respaldo.reserva_juca_1811 (
    tabla text not null, id text not null, fila jsonb not null, cuando timestamptz not null default now(), primary key (tabla, id)
  );
  alter table respaldo.reserva_juca_1811 enable row level security;
  insert into respaldo.reserva_juca_1811 (tabla, id, fila)
    select 'ventas', v.id, to_jsonb(v) from public.ventas v where v.id in (r, f)
    union all select 'cuotas', c.id, to_jsonb(c) from public.cuotas c where c."ventaId" in (r, f)
    union all select 'pagos', p.id, to_jsonb(p) from public.pagos p where p."cuotaId" in (cuota_reserva, cuota_repetida, cuota_resto)
    union all select 'movimientos', m.id, to_jsonb(m) from public.movimientos m where m."ventaId" in (r, f)
    union all select 'contratos', k.id, to_jsonb(k) from public.contratos k where k."ventaId" in (r, f)
    union all select 'alumnos', a.id, to_jsonb(a) from public.alumnos a where a."ventaId" in (r, f)
    union all select 'sesiones', s.id, to_jsonb(s) from public.sesiones s where s.id = llamada
  on conflict (tabla, id) do nothing;

  -- Lo de la venta repetida que es de verdad pasa a la de la reserva.
  update public.cuotas set "ventaId" = r where id = cuota_resto;
  update public.movimientos set "ventaId" = r where id = mov_resto;
  update public.contratos set "ventaId" = r where id = contrato_programa;
  update public.alumnos set "ventaId" = r where "ventaId" = f;

  -- Lo repetido se va (queda en ventas_eliminadas además del respaldo).
  delete from public.pagos where id = pago_repetido;
  delete from public.cuotas where id = cuota_repetida;
  delete from public.ventas where id = f;

  -- La venta de la reserva pasa a ser la del programa entero.
  update public.ventas set
    "precioAcordado" = 3000,
    notas = case when coalesce(notas, '') = '' then 'Dejó la reserva de 400 el 16/11 y completó los 2.600 el 17/11 (Stripe).' else notas end,
    extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('reservaCompletada',
      jsonb_build_object('en', now(), 'por', 'Arreglo del 18/11: se unió con la venta repetida', 'valia', 400, 'unidaCon', f))
  where id = r;

  -- La llamada había quedado en «Reserva»: ya compró (si alguien le puso otro estado, no se pisa).
  update public.sesiones set "estadoLlamada" = 'Compra Full' where id = llamada and "estadoLlamada" = 'Reserva';

  insert into public.actividad (id, entidad, "entidadId", titulo, accion, detalle, actor, fecha)
  values ('act_reserva_juca_1811', 'transaccion', r, 'Carlos Juca', 'actualizo',
    'Carlos Juca completó la reserva: la venta pasó de 400 a 3000. La reserva (400) y lo que faltaba (2600) quedaron en esta sola venta; se eliminó la venta repetida del 17/11, que traía la reserva cargada por segunda vez (se contaban 3.400 cobrados).',
    'Apicanta', now())
  on conflict (id) do nothing;

  -- Tiene que cerrar: una venta de 3.000 con 3.000 cobrados.
  select count(*) into n from public.ventas where "contactoId" = 'con_web_6ae984d6473b99a1' and estado = 'activa';
  if n <> 1 then raise exception 'Quedaron % ventas activas de Carlos Juca (tenía que quedar 1).', n; end if;
  if (select coalesce(sum(p.monto), 0) from public.pagos p join public.cuotas c on c.id = p."cuotaId" where c."ventaId" = r) <> 3000
     or (select coalesce(sum(c.monto), 0) from public.cuotas c where c."ventaId" = r) <> 3000 then
    raise exception 'La venta unida no cierra en 3.000.';
  end if;
  --[ensayo]
end $$;

select json_build_object(
  'ventas', (select json_agg(json_build_object('id', v.id, 'valor', v."precioAcordado", 'estado', v.estado, 'fecha', v.fecha)) from public.ventas v where v."contactoId" = 'con_web_6ae984d6473b99a1'),
  'cuotas', (select json_agg(json_build_object('numero', c.numero, 'monto', c.monto, 'estado', c.estado, 'reserva', c."esReserva") order by c.numero) from public.cuotas c where c."ventaId" = 'ven_mwjr6fli000bopj'),
  'cobrado', (select sum(p.monto) from public.pagos p join public.cuotas c on c.id = p."cuotaId" where c."ventaId" = 'ven_mwjr6fli000bopj'),
  'contratos', (select json_agg(json_build_object('plantilla', k."plantillaNombre", 'estado', k.estado, 'ventaId', k."ventaId")) from public.contratos k where k."leadId" = 'con_web_6ae984d6473b99a1'),
  'alumno', (select json_agg(json_build_object('estado', a.estado, 'ventaId', a."ventaId", 'inicio', a.inicio)) from public.alumnos a where a."leadId" = 'con_web_6ae984d6473b99a1'),
  'llamada', (select "estadoLlamada" from public.sesiones where id = 'cal_4ec55b81-189d-4ef7-9f21-4f4173a0e4ea'),
  'respaldo', (select count(*) from respaldo.reserva_juca_1811)
) as como_quedo;
