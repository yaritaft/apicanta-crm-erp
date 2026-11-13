-- ==================================================================
-- Aviso a Customer Success por CADA venta nueva + seguimiento cada 20 días
-- (Liliana, 13/11/2026)
--
--   «Ayer hubo nuevos ingresos y la app no me notificó. Solo recibí la
--    notificación del último ingreso. Es importante que me llegue una
--    notificación por cada nueva venta que se cargue, incluyendo las
--    reservas: en todos los casos debo enviar un mensaje de bienvenida desde
--    el momento en que ingresa.»
--
-- Qué pasaba: la campanita de Lili sólo recibía avisos que salían de otros
-- procesos (el roadmap cuando se firma un contrato y se elige el perfil, el
-- contrato que rebota...). Una venta, por sí sola, no avisaba a nadie, y una
-- reserva no tiene contrato: ayer entraron cinco alumnos y sólo el último
-- (el único con contrato y roadmap) le llegó.
--
-- Qué hace ahora: un disparador en `ventas` (la base, no el navegador: avisa
-- igual entre por la app, por la planilla o por un cobro) escribe un aviso a
-- cada persona de Customer Success (mails_de_servicio(), como el resto) con
-- tipo 'venta-nueva'. Tres textos, según lo que ya hay de esa persona:
--   · nunca fue alumno  → «Nueva venta: X»        · mandale la bienvenida
--   · ya es alumno      → «Nueva compra de X»     · es una compra más (upsell/renovación)
--   · Lili ya lo dio de alta esperando la venta → «Cargaron la venta de X»
-- Sólo ventas activas de los últimos 3 días: cargar una planilla vieja no le
-- llena la campanita. Un aviso por venta y por persona (id fijo): repetir el
-- insert no repite el aviso. Si algo falla, la venta se guarda igual.
--
-- Y la cadencia de seguimiento de los alumnos pasa de 15 a 20 días (día 1 =
-- bienvenida, día 7 = contacto semanal, después cada 20 días): el default de
-- la columna y los alumnos que estaban en 15 (con respaldo de lo que cambia).
--
-- Hace falta haber corrido avisos.sql y sesiones-1a1-y-avisos-de-resell.sql
-- (mails_de_servicio). Se puede volver a correr.
-- Para deshacerlo: drop trigger ventas_avisan_a_servicio on public.ventas;
--   drop function public.avisar_venta_nueva();  (la cadencia: respaldo.seguimiento_cadencia_1311)
-- ==================================================================

do $$ begin
  if to_regclass('public.avisos') is null or to_regclass('public.ventas') is null then
    raise exception 'Falta avisos.sql (o esta no es la base del ERP).';
  end if;
  if to_regprocedure('public.mails_de_servicio()') is null then
    raise exception 'Falta sesiones-1a1-y-avisos-de-resell.sql (mails_de_servicio).';
  end if;
end $$;

create or replace function public.avisar_venta_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_producto text;
  v_closer text;
  v_ya_es_alumno boolean;
  v_esperaba boolean;
  v_titulo text;
  v_cuerpo text;
begin
  begin
    if coalesce(new.estado, '') <> 'activa' then return new; end if;
    if new.fecha is not null and new.fecha < now() - interval '3 days' then return new; end if;

    v_nombre := coalesce(nullif(btrim(new."contactoNombre"), ''), (select nullif(btrim(c.nombre), '') from public.contactos c where c.id = new."contactoId"), 'un alumno nuevo');
    select p.nombre into v_producto from public.productos p where p.id = new."productoId";
    select nullif(btrim(q.nombre), '') into v_closer from public.equipo q where q.id = new."closerId";

    select exists (select 1 from public.alumnos a where new."contactoId" is not null and a."leadId" = new."contactoId" and a."ventaId" is not null and a."ventaId" <> new.id),
           exists (select 1 from public.alumnos a where new."contactoId" is not null and a."leadId" = new."contactoId" and a."ventaId" is null)
      into v_ya_es_alumno, v_esperaba;

    v_titulo := case
      when v_ya_es_alumno then 'Nueva compra de ' || v_nombre
      when v_esperaba then 'Cargaron la venta de ' || v_nombre
      else 'Nueva venta: ' || v_nombre end;
    v_cuerpo := coalesce(v_producto, 'Una venta nueva') || case when v_closer is not null then ' · la cargó ' || v_closer else '' end || '. '
      || case
        when v_ya_es_alumno then 'Ya es alumno: es una compra más (upsell o renovación). Fijate si hay que actualizar su programa o sus accesos.'
        when v_esperaba then 'Ya lo tenías dado de alta: la venta se unió a su ficha.'
        else 'Mandale la bienvenida por WhatsApp (también si es una reserva) y marcalo en «Alumnos nuevos» de tu panel.' end;

    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "contactoId", persona)
    select 'av_venta_' || new.id || '_' || left(md5(m), 10), m, 'venta-nueva', v_titulo, v_cuerpo, 'Apicanta', new."contactoId", v_nombre
    from public.mails_de_servicio() m
    on conflict (id) do nothing;
  exception when others then
    raise warning 'avisar_venta_nueva (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.avisar_venta_nueva() from public, anon, authenticated;

drop trigger if exists ventas_avisan_a_servicio on public.ventas;
create trigger ventas_avisan_a_servicio after insert on public.ventas
  for each row execute function public.avisar_venta_nueva();

-- ---------- Seguimiento cada 20 días ----------
create schema if not exists respaldo;
create table if not exists respaldo.seguimiento_cadencia_1311 as
  select "alumnoId", "cadenciaDias", "proximoContacto", "ultimoContacto", now() as "respaldadoEn"
  from public.seguimiento_alumnos where "cadenciaDias" = 15;

alter table public.seguimiento_alumnos alter column "cadenciaDias" set default 20;

-- Si el próximo contacto era justo «último contacto + 15» (lo que deja «Lo contacté»), pasa a +20. Un reintento («no contestó») u otra fecha puesta a mano no se toca.
update public.seguimiento_alumnos
set "proximoContacto" = to_char(("ultimoContacto"::date + 20), 'YYYY-MM-DD')
where "cadenciaDias" = 15
  and "ultimoContacto" ~ '^\d{4}-\d{2}-\d{2}' and "proximoContacto" ~ '^\d{4}-\d{2}-\d{2}'
  and left("proximoContacto", 10)::date = left("ultimoContacto", 10)::date + 15;

update public.seguimiento_alumnos set "cadenciaDias" = 20 where "cadenciaDias" = 15;
