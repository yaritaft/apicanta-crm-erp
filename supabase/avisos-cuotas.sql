-- Avisos de cuotas por cobrar — Apicanta ERP (Mariano, 28/10/2026)
--
-- «¿El sistema te avisa cuando tenemos que cobrar cuotas? Hace dos o tres días
-- cobré una y no me avisó; me lo había anotado en el celular.»
--
-- Mi panel mostraba las cuotas vencidas, pero había que entrar a mirarlo. Ahora
-- la campanita le avisa al closer de cada cuota pendiente:
--   · el día antes («Mañana vence…»),
--   · el día que vence («Hoy vence…»),
--   · y el día después si sigue sin cobrarse («Ayer venció…»).
-- El closer es el de la cuota (cuotas."closerId") o, si no tiene, el de la venta;
-- se le escribe al mail que tiene en Equipo. Una vez por cuota y por aviso: la
-- función se puede correr varias veces por día sin repetir nada. La corre el cron
-- /api/cron/cuotas-a-cobrar todos los días a las 9 de Argentina.
--
-- Hace falta haber corrido avisos.sql. Se puede volver a correr.
-- Para deshacerlo: drop function if exists public.avisar_cuotas_por_cobrar(date);

do $$ begin
  if to_regclass('public.avisos') is null or to_regclass('public.cuotas') is null then
    raise exception 'Falta avisos.sql (o esta no es la base del ERP).';
  end if;
end $$;

create or replace function public.avisar_cuotas_por_cobrar(p_hoy date default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  hoy date := coalesce(p_hoy, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  n integer := 0;
begin
  with pendientes as (
    select c.id, c.numero, c."esReserva", c.monto, v."contactoId", v."contactoNombre", v.moneda,
           (c.vence at time zone 'America/Argentina/Buenos_Aires')::date as dia,
           lower(btrim(eq.email)) as para,
           coalesce(p.nombre, 'la venta') as producto,
           coalesce((select sum(pg.monto) from pagos pg where pg."cuotaId" = c.id), 0) as cobrado
    from cuotas c
    join ventas v on v.id = c."ventaId"
    join equipo eq on eq.id = coalesce(c."closerId", v."closerId")
    left join productos p on p.id = v."productoId"
    where c.estado = 'pendiente' and coalesce(v.estado, '') = 'activa' and c.vence is not null
      and coalesce(eq.email, '') like '%@%' and coalesce(eq.activo, true)
  ),
  avisar as (
    select x.*,
      case when x.dia = hoy + 1 then 'manana' when x.dia = hoy then 'hoy' else 'ayer' end as cuando
    from pendientes x
    where x.dia between hoy - 1 and hoy + 1 and x.monto - x.cobrado > 0.009
  ),
  nuevos as (
    insert into avisos (id, para, tipo, titulo, cuerpo, de, "deEmail", "contactoId", persona)
    select 'avi_cuo_' || substr(md5(a.id || ':' || a.cuando || ':' || a.dia), 1, 20), a.para, 'cuota',
      case a.cuando
        when 'manana' then 'Mañana vence ' || case when a."esReserva" then 'la reserva' else 'la cuota ' || a.numero end || ' de ' || coalesce(nullif(btrim(a."contactoNombre"), ''), 'un cliente')
        when 'hoy' then 'Hoy vence ' || case when a."esReserva" then 'la reserva' else 'la cuota ' || a.numero end || ' de ' || coalesce(nullif(btrim(a."contactoNombre"), ''), 'un cliente')
        else 'Ayer venció ' || case when a."esReserva" then 'la reserva' else 'la cuota ' || a.numero end || ' de ' || coalesce(nullif(btrim(a."contactoNombre"), ''), 'un cliente') || ' y no está cobrada'
      end,
      -- «US$ 1.000» o «US$ 950,50», como en la app.
      case coalesce(a.moneda, 'USD') when 'USD' then 'US$ ' else a.moneda || ' ' end
        || regexp_replace(translate(to_char(round(a.monto - a.cobrado, 2), 'FM999,999,990.00'), ',.', '.,'), ',00$', '') || ' · ' || a.producto
        || '. Cuando entre, cargalo con «Registrar pago» en su ficha.',
      'Apicanta', null, a."contactoId", nullif(btrim(a."contactoNombre"), '')
    from avisar a
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into n from nuevos;
  return n;
end;
$$;
revoke all on function public.avisar_cuotas_por_cobrar(date) from public, anon, authenticated;
