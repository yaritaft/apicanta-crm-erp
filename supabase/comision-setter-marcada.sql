-- % del setter en las ventas cuya agenda marcó él — Apicanta ERP (Fede, 02/11/2026: «Daniel setter comisión 2%»)
--
-- Daniel se marca él mismo las agendas desde Mi panel y casi todas son leads del webinar a los que sólo les manda un mensaje. Fede definió que
-- esas ventas le comisionan el 2% (no el 5% de siempre). Cargar ese 2% venta por venta (Ventas → Setter → «Comisión»,
-- supabase/comision-setter-por-venta.sql) hace que cada venta nueva dependa de que alguien se acuerde.
--
-- Esto lo deja como si una persona ya lo hubiera cargado en cada venta, sola:
--   · equipo."comisionSetterMarcada": el % del setter cuando la venta sale de una agenda que ÉL marcó (vacío: no hay regla, comisiona lo de siempre);
--   · cuando una venta toma a ese setter (nace con él, o él marca la agenda de una venta ya cargada) y esa venta no tiene % propio, se le escribe
--     ese % en ventas."comisionSetter": el mismo dato que cargaría Aldana a mano, así Finanzas, Mi panel, la planilla de Angelo y la liquidación
--     (renglón «Ajuste por porcentaje propio») no cambian en nada;
--   · lo que ya tiene % propio no se pisa, ni lo que entra por el link del setter o lo puso el closer sin que él marcara la agenda;
--   · si la venta cambia de setter y el % era el de la regla, se le saca junto con el setter.
--
-- Hace falta haber corrido setter-marca-agendas.sql y comision-setter-por-venta.sql. Se puede volver a correr. Para deshacerlo:
--   drop trigger if exists ventas_setter_marcado_porcentaje on public.ventas;
--   drop function if exists public.ventas_comision_setter_marcada();
--   drop function if exists public.agenda_marcada_por_setter(text, text, text, timestamptz);
--   alter table public.equipo drop column if exists "comisionSetterMarcada";

do $$ begin
  if to_regclass('public.ventas') is null or to_regclass('public.equipo') is null or to_regclass('public.sesiones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan ventas, equipo o sesiones.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'comisionSetter')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sesiones' and column_name = 'setterMarcadoEn') then
    raise exception 'Primero hay que correr comision-setter-por-venta.sql y setter-marca-agendas.sql.';
  end if;
end $$;

alter table public.equipo add column if not exists "comisionSetterMarcada" numeric;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipo_comision_setter_marcada_entre_0_y_1') then
    alter table public.equipo add constraint equipo_comision_setter_marcada_entre_0_y_1
      check ("comisionSetterMarcada" is null or ("comisionSetterMarcada" >= 0 and "comisionSetterMarcada" <= 1));
  end if;
end $$;

-- ¿Esa venta sale de una agenda que marcó ESE setter? La llamada misma, o la última agenda marcada de esa persona en los 45 días antes
-- (la misma ventana que setter_de_agendas y que lib/setter-agendas.ts → origenDelSetterPorVenta).
create or replace function public.agenda_marcada_por_setter(p_setter text, p_sesion text, p_contacto text, p_fecha timestamptz)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sesiones s
     where s."setterId" = p_setter and s."setterMarcadoEn" is not null
       and (s.id = p_sesion
            or (coalesce(p_contacto, '') <> '' and (s."contactoId" = p_contacto or s."leadId" = p_contacto)
                and s.inicia <= coalesce(p_fecha, now()) + interval '1 day'
                and s.inicia >= coalesce(p_fecha, now()) - interval '45 days')));
$$;
revoke all on function public.agenda_marcada_por_setter(text, text, text, timestamptz) from public, anon, authenticated;

create or replace function public.ventas_comision_setter_marcada()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  porc    numeric;
  anterior numeric;
begin
  -- Sólo cuando la venta nace con setter o cambia de setter: una edición cualquiera no toca el porcentaje.
  if tg_op = 'UPDATE' and new."setterId" is not distinct from old."setterId" then
    return new;
  end if;

  -- Cambió de setter: si el % era el que puso la regla para el anterior, se va con él.
  if tg_op = 'UPDATE' and old."setterId" is not null then
    select e."comisionSetterMarcada" into anterior from public.equipo e where e.id = old."setterId";
    if anterior is not null and new."comisionSetter" is not distinct from anterior then
      new."comisionSetter" := null;
    end if;
  end if;

  if new."setterId" is null or coalesce(new.estado, '') = 'cancelada' then
    return new;
  end if;
  -- Un % que alguien fijó (o que ya está) no se pisa.
  if new."comisionSetter" is not null then
    return new;
  end if;

  select e."comisionSetterMarcada" into porc from public.equipo e where e.id = new."setterId";
  if porc is not null and public.agenda_marcada_por_setter(new."setterId", new."sesionId", new."contactoId", new.fecha) then
    new."comisionSetter" := porc;
  end if;
  return new;
end;
$$;
revoke all on function public.ventas_comision_setter_marcada() from public, anon, authenticated;

-- Se llama «ventas_setter_marcado_porcentaje»: dispara después de ventas_guarda_comision_setter (que cuida quién cambia el %) y de
-- ventas_setter_de_la_agenda (que le pone el setter a la venta), en ese orden alfabético.
drop trigger if exists ventas_setter_marcado_porcentaje on public.ventas;
create trigger ventas_setter_marcado_porcentaje
  before insert or update on public.ventas
  for each row execute function public.ventas_comision_setter_marcada();

-- Daniel: 2% en lo que marca por mensaje (Fede, 02/11).
update public.equipo set "comisionSetterMarcada" = 0.02
 where nombre ilike 'Daniel Rodriguez' and "comisionSetterMarcada" is null;

-- Las ventas que ya tenía marcadas y todavía no tienen % propio (las de octubre se cargaron a mano el 02/11): las mismas reglas, una vez.
update public.ventas v set "comisionSetter" = e."comisionSetterMarcada"
  from public.equipo e
 where e.id = v."setterId" and e."comisionSetterMarcada" is not null
   and v."comisionSetter" is null and coalesce(v.estado, '') <> 'cancelada'
   and v.fecha >= '2026-10-24'
   and public.agenda_marcada_por_setter(v."setterId", v."sesionId", v."contactoId", v.fecha);
