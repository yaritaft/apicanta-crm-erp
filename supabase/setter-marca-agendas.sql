-- Agendas que marca el setter — Apicanta ERP (Daniel, 24/10/2026)
--
-- «Sería buen cambio si pudiera marcar directamente las agendas que ayudé
-- setteando, así no hace falta avisarle a cada closer cada vez que suben una.»
--
-- Hasta acá una agenda era del setter sólo si entraba por su link
-- (utm_campaign=setter_nombre). Las que setteaba por otro lado dependían de que
-- el closer se acordara de ponerlo al cargar la venta. Ahora:
--
--   1. El setter marca la agenda desde Mi panel (marcar_agenda_de_setter). Queda
--      en sesiones."setterId". Sólo un setter activo marca, y sólo a su nombre;
--      una agenda que ya marcó otro setter no se le pisa.
--   2. Si esa persona ya tenía la venta cargada sin setter, la venta lo toma en
--      ese momento (salvo que la liquidación de ese mes ya esté cerrada). El
--      closer de la agenda recibe un aviso en la campanita.
--   3. Toda venta que entra sin setter toma el de sus agendas: la llamada de la
--      que salió o, si no está marcada, la última agenda marcada de esa persona
--      en los 45 días antes. Lo hace la base, así vale venga de donde venga la
--      venta (la app hace lo mismo antes, en lib/setter-agendas.ts).
--   4. Una pestaña vieja (que no sabía de la marca) no le borra el setter a una
--      agenda ni a una venta. Sacarlo de una venta lo hace un dueño, el director
--      o Finanzas; el closer le avisa al director.
--
-- Hace falta haber corrido tipos-cuenta.sql (mi_miembro_id, es_dueno,
-- solo_lo_suyo, miembro_de_nombre), avisos.sql y cobros-de-closers.sql
-- (mes_de_cobro_cerrado). Se puede volver a correr.
-- Para deshacerlo:
--   drop trigger if exists ventas_setter_de_la_agenda on public.ventas;
--   drop trigger if exists sesiones_setter_por_marca on public.sesiones;
--   drop function if exists public.marcar_agenda_de_setter(text, boolean);
-- (las columnas pueden quedar: nadie más las lee).

do $$ begin
  if to_regclass('public.sesiones') is null or to_regclass('public.ventas') is null or to_regclass('public.avisos') is null then
    raise exception 'Esta no es la base del ERP o falta avisos.sql: no están sesiones, ventas o avisos.';
  end if;
  if to_regprocedure('public.mi_miembro_id()') is null or to_regprocedure('public.miembro_de_nombre(text)') is null
     or to_regprocedure('public.mes_de_cobro_cerrado(timestamptz)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql y cobros-de-closers.sql.';
  end if;
end $$;

alter table public.sesiones add column if not exists "setterId" text;
alter table public.sesiones add column if not exists "setterMarcadoEn" timestamptz;
create index if not exists sesiones_setter_marcado on public.sesiones ("setterId") where "setterId" is not null;

-- ---------- el setter de una venta según sus agendas ----------

create or replace function public.setter_de_agendas(p_sesion text, p_contacto text, p_fecha timestamptz)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select s."setterId" from public.sesiones s where s.id = p_sesion and s."setterId" is not null),
    (select s."setterId" from public.sesiones s
      where coalesce(p_contacto, '') <> '' and (s."contactoId" = p_contacto or s."leadId" = p_contacto)
        and s."setterId" is not null
        and s.inicia <= coalesce(p_fecha, now()) + interval '1 day'
        and s.inicia >= coalesce(p_fecha, now()) - interval '45 days'
      order by s.inicia desc limit 1));
$$;
revoke all on function public.setter_de_agendas(text, text, timestamptz) from public, anon, authenticated;

-- ---------- 1 y 2: marcar (o desmarcar) una agenda ----------

create or replace function public.marcar_agenda_de_setter(p_sesion text, p_mia boolean)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  yo     text := public.mi_miembro_id();
  mio    record;
  s      record;
  otro   text;
  closer text;
  n      integer := 0;
begin
  select e.id, e.nombre, e.rol, e.activo into mio from public.equipo e where e.id = yo;
  if mio.id is null or mio.rol <> 'setter' or not coalesce(mio.activo, true) then
    raise exception 'Sólo un setter marca sus agendas.' using errcode = '42501';
  end if;
  select * into s from public.sesiones where id = p_sesion for update;
  if s.id is null then
    raise exception 'No encontré esa agenda.' using errcode = 'P0002';
  end if;

  -- Sólo esta función cambia la marca (ver sesiones_setter_por_marca): la llave se abre para cada update y se cierra.
  if p_mia then
    if s."setterId" is not null and s."setterId" <> yo then
      select nombre into otro from public.equipo where id = s."setterId";
      raise exception 'Esa agenda ya la marcó %.', coalesce(otro, 'otro setter') using errcode = 'P0001';
    end if;
    if s."setterId" is null then
      perform set_config('apicanta.marca_setter', '1', true);
      update public.sesiones set "setterId" = yo, "setterMarcadoEn" = now() where id = s.id;
      perform set_config('apicanta.marca_setter', '', true);
      -- El closer de la agenda se entera (una vez por agenda y setter).
      select lower(btrim(e.email)) into closer from public.equipo e
        where e.id = public.miembro_de_nombre(s.anfitrion) and coalesce(e.email, '') like '%@%';
      if closer is not null then
        insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "deEmail", "contactoId", persona)
        values ('avi_set_' || substr(md5(s.id || ':' || yo), 1, 20), closer, 'setter',
          mio.nombre || ' setteó a ' || coalesce(nullif(btrim(s.invitado), ''), 'una de tus agendas'),
          'Marcó la agenda como suya: si le vendés, la venta queda con ' || mio.nombre || ' de setter sin que lo elijas. Si no corresponde, avisale al director.',
          mio.nombre, lower(coalesce(auth.jwt() ->> 'email', '')), coalesce(s."contactoId", s."leadId"), nullif(btrim(s.invitado), ''))
        on conflict (id) do nothing;
      end if;
    end if;
    -- La venta que ya estaba cargada sin setter lo toma ahora.
    update public.ventas v set "setterId" = yo
     where v."setterId" is null and coalesce(v.estado, '') <> 'cancelada'
       and (v."sesionId" = s.id or (coalesce(v."contactoId", '') <> '' and v."contactoId" in (s."contactoId", s."leadId")))
       and public.setter_de_agendas(v."sesionId", v."contactoId", v.fecha) = yo
       and not public.mes_de_cobro_cerrado(v.fecha);
    get diagnostics n = row_count;
  else
    if s."setterId" is distinct from yo then
      return jsonb_build_object('marcada', false, 'ventas', 0);
    end if;
    perform set_config('apicanta.marca_setter', '1', true);
    update public.sesiones set "setterId" = null, "setterMarcadoEn" = null where id = s.id;
    perform set_config('apicanta.marca_setter', '', true);
    delete from public.avisos where id = 'avi_set_' || substr(md5(s.id || ':' || yo), 1, 20) and "leidoEn" is null;
    -- Lo que esa marca le había dado (y ninguna otra agenda suya sostiene).
    update public.ventas v set "setterId" = null
     where v."setterId" = yo and coalesce(v.estado, '') <> 'cancelada'
       and (v."sesionId" = s.id or (coalesce(v."contactoId", '') <> '' and v."contactoId" in (s."contactoId", s."leadId")))
       and public.setter_de_agendas(v."sesionId", v."contactoId", v.fecha) is null
       and not public.mes_de_cobro_cerrado(v.fecha);
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('marcada', p_mia, 'ventas', n);
end;
$$;
revoke all on function public.marcar_agenda_de_setter(text, boolean) from public, anon;
grant execute on function public.marcar_agenda_de_setter(text, boolean) to authenticated;

-- ---------- 3 y 4: la venta toma el setter de sus agendas ----------

create or replace function public.ventas_setter_de_la_agenda()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new."setterId" is null and coalesce(new.estado, '') <> 'cancelada' then
      new."setterId" := public.setter_de_agendas(new."sesionId", new."contactoId", new.fecha);
    end if;
    return new;
  end if;
  -- Una pestaña vieja del closer manda la venta entera sin el setter que marcó la agenda: no se lo borra.
  if new."setterId" is null and old."setterId" is not null
     and coalesce(auth.jwt() ->> 'email', '') <> '' and coalesce((select public.solo_lo_suyo()), false)
     and old."setterId" = public.setter_de_agendas(old."sesionId", old."contactoId", old.fecha) then
    new."setterId" := old."setterId";
  end if;
  return new;
end;
$$;
revoke all on function public.ventas_setter_de_la_agenda() from public, anon, authenticated;

drop trigger if exists ventas_setter_de_la_agenda on public.ventas;
create trigger ventas_setter_de_la_agenda
  before insert or update on public.ventas
  for each row execute function public.ventas_setter_de_la_agenda();

-- La marca de la agenda la cambia marcar_agenda_de_setter (o un dueño, o el servidor): nadie más, ni una pestaña vieja.
create or replace function public.sesiones_setter_por_marca()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new."setterId" is not distinct from old."setterId" and new."setterMarcadoEn" is not distinct from old."setterMarcadoEn" then
    return new;
  end if;
  if coalesce(auth.jwt() ->> 'email', '') = '' or current_setting('apicanta.marca_setter', true) = '1'
     or coalesce((select public.es_dueno()), false) then
    return new;
  end if;
  new."setterId" := old."setterId";
  new."setterMarcadoEn" := old."setterMarcadoEn";
  return new;
end;
$$;

drop trigger if exists sesiones_setter_por_marca on public.sesiones;
create trigger sesiones_setter_por_marca
  before update on public.sesiones
  for each row execute function public.sesiones_setter_por_marca();
