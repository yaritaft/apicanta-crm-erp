-- «Sólo lo suyo» seguro — Apicanta ERP (arreglos del estrés de la base: 07/10 y segunda ronda del 09/10)
--
-- Un tipo de cuenta con «sólo lo suyo» (el closer) ve las llamadas, ventas,
-- cuotas, personas y chat que el mismo calcula con referencias que él escribe
-- (mis_ventas(), mis_cuotas(), mis_leads(), mis_contactos() de
-- tipos-cuenta.sql). Las políticas de escritura sólo le pedían que la fila
-- nueva lo nombrara a él, así que con el id de algo ajeno (un id no se
-- muestra, pero tampoco es un secreto) podía fabricarse el acceso:
--
--   V1  una cuota «heredada» propia (cuotas.closerId = yo) sobre la venta de otro
--   V2  mover una cuota propia a la venta de otro
--   V3  una venta propia nueva con ventas.contactoId = el lead de otro
--   V4  apuntar una venta propia al lead de otro
--   V5  apuntar una llamada propia (sesiones.leadId / contactoId) al lead de otro
--   V6  apuntar un lead propio (leads.contactoId) a la persona de otro
--
-- y de ahí leer la venta, sus cuotas, cobros con comprobante, devoluciones, el
-- lead, la persona y su chat; o cambiarle el closer a la venta (robarle la
-- comisión). Lo frenan cinco triggers, que sólo miran a quien tiene «sólo lo
-- suyo» y una referencia NUEVA (o cambiada): lo que ya estaba escrito, y todo lo
-- que escriben el servidor y los demás tipos de cuenta, queda igual.
--
--   · cuotas.ventaId, al crear o cambiar, tiene que ser una venta que ya es suya
--     (la venta se carga antes que sus cuotas). La herencia de cuotas a otro
--     closer la sigue asignando quien edita Ventas sin «sólo lo suyo».
--   · Cada referencia se mira contra SU espacio de ids, no contra «cualquiera
--     de los dos»: sesiones.leadId contra los leads suyos; sesiones.contactoId y
--     leads.contactoId contra las personas suyas; ventas.contactoId contra los
--     leads suyos (la app a veces guarda ahí una persona: en ese caso, sólo si
--     no existe un lead con ese id y la persona es suya). La persona que creó él
--     cuenta como suya: el contacto se escribe antes que el lead y el lead antes
--     que la venta.
--   · Una persona nueva no puede llevar el id de un lead que no es suyo, ni un
--     lead nuevo el de una persona que no es suya: sin esto, creando una fila con
--     el id del otro espacio el closer la hacía pasar por «suya» y después la
--     usaba para apuntar a lo ajeno.
--   · ventas.sesionId (lo que ata la venta a su llamada para «venta que no se
--     cargó el mismo día, no se comisiona»): una vez puesto no se cambia ni se
--     suelta, y al crear la venta tiene que ser una llamada suya.
--
-- Si no alcanza, la base contesta 42501 (el código de RLS) y la app lo trata
-- como cualquier escritura que su tipo de cuenta no puede hacer. La única
-- excepción silenciosa es sesionId, que vuelve a como estaba (como cargadoPor).
--
-- Cómo está hecho (segunda ronda):
--
--   · Los triggers son security definer: preguntan «¿ya existe esa fila?» y «¿esto
--     es mío?» sin pasar por las políticas, y NINGUNA de las funciones de ayuda
--     queda ejecutable por anon ni por authenticated (ni por PUBLIC): no hay un
--     oráculo que le diga a cualquiera con la clave pública si un id existe. Un
--     trigger no se puede llamar a mano.
--   · «¿es mío?» se contesta mirando UN id (es_mi_lead, es_mi_persona,
--     es_mi_venta, es_mi_llamada) y no armando de nuevo la lista entera de
--     mis_leads() / mis_contactos() / mis_ventas() / mis_sesiones() por cada fila
--     nueva. Dicen exactamente lo mismo que esas listas (lo controla una prueba
--     con datos al azar), así que lo que un closer ve y lo que puede escribir no
--     se separan.
--
-- Los nombres: nombre_corto() ya tiene las dos cadenas del mismo largo en
-- tipos-cuenta.sql y nombre-corto.sql. Dos closers cuyo nombre empieza con las
-- mismas dos palabras (Ana Laura Pérez y Ana Laura Gómez) siguen siendo la misma
-- persona para la base —el de menor id entre los activos—, igual que para la app
-- (miembroDeCloser de src/lib/crm.ts): cambiar sólo uno haría que la pantalla y
-- la base dijeran cosas distintas. Para ver quiénes chocan:
--
--   select * from public.equipo_nombres_que_chocan();
--
-- Idempotente y en cualquier orden respecto de los demás archivos (sólo pide
-- tipos-cuenta.sql antes). Sin cambiar datos: son funciones y triggers. Para
-- deshacer los triggers:
--   drop trigger if exists cuotas_guarda_del_closer on public.cuotas;
--   drop trigger if exists ventas_guarda_del_closer on public.ventas;
--   drop trigger if exists sesiones_guarda_del_closer on public.sesiones;
--   drop trigger if exists leads_guarda_del_closer on public.leads;
--   drop trigger if exists contactos_guarda_del_closer on public.contactos;
-- Se ensaya con pruebas/fix-sql-solo-lo-suyo.test.ts (PGlite, en memoria).

do $$ begin
  if to_regclass('public.cuotas') is null or to_regclass('public.ventas') is null
     or to_regclass('public.sesiones') is null or to_regclass('public.leads') is null
     or to_regclass('public.contactos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta cuotas, ventas, sesiones, leads o contactos.';
  end if;
  if to_regprocedure('public.solo_lo_suyo()') is null or to_regprocedure('public.mi_miembro_id()') is null
     or to_regprocedure('public.mi_email()') is null or to_regprocedure('public.son_mios(text[])') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan solo_lo_suyo(), mi_miembro_id(), mi_email() o son_mios().';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'creadoPor')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contactos' and column_name = 'creadoPor') then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan las columnas creadoPor de leads y contactos.';
  end if;
end $$;

-- La llamada de la que salió la venta: la agrega cierre-del-dia.sql; acá se
-- asegura para que el trigger de abajo no dependa de en qué orden se corrió.
alter table public.ventas add column if not exists "sesionId" text;

-- ---------- 1. los nombres que chocan (sólo para mirar) ----------

-- Los miembros activos de Equipo cuyo nombre corto (las dos primeras palabras,
-- sin tildes) es el mismo: para la base son la misma persona. Vacío = nadie choca.
create or replace function public.equipo_nombres_que_chocan()
returns table (clave text, miembros text[], ids text[])
language sql stable
set search_path = public
as $$
  select public.nombre_corto(e.nombre), array_agg(e.nombre order by e.id), array_agg(e.id order by e.id)
  from public.equipo e
  where coalesce(e.activo, true) and public.nombre_corto(e.nombre) <> ''
  group by public.nombre_corto(e.nombre)
  having count(*) > 1;
$$;

-- ---------- 2. «¿esto es mío?», mirando un solo id ----------
-- Cada una dice lo mismo que la lista de tipos-cuenta.sql que lleva al lado.

-- ¿El anfitrión de Calendly es uno de los míos? (mis_anfitriones())
create or replace function public.anfitrion_es_mio(a text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(a, '') <> '' and a = any((select public.son_mios(array[a]))::text[]);
$$;

-- ¿Esta llamada es mía? (mis_sesiones())
create or replace function public.es_mi_llamada(sid text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.sesiones s where s.id = sid and public.anfitrion_es_mio(s.anfitrion));
$$;

-- ¿Esta venta es mía? Soy su closer o su setter, o heredé una cuota. (mis_ventas())
create or replace function public.es_mi_venta(vid text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ventas v
    where v.id = vid
      and (v."closerId" = (select public.mi_miembro_id())
        or v."setterId" = (select public.mi_miembro_id())
        or exists (select 1 from public.cuotas c where c."ventaId" = v.id and c."closerId" = (select public.mi_miembro_id()))));
$$;

-- ¿Este lead es mío? Vacío = nada que mirar. (mis_leads())
create or replace function public.es_mi_lead(x text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(x, '') = '' or exists (
    select 1 from public.leads l
    where l.id = x
      and ((coalesce(l.responsable, '') <> '' and public.anfitrion_es_mio(l.responsable))
        or (l."creadoPor" <> '' and l."creadoPor" = (select public.mi_email()))
        or exists (select 1 from public.sesiones s
                    where (s."leadId" = l.id or s."contactoId" = l."contactoId")
                      and public.anfitrion_es_mio(s.anfitrion))
        or exists (select 1 from public.ventas v
                    where v."contactoId" = l.id and public.es_mi_venta(v.id))));
$$;

-- ¿Esta persona es mía? Vacío = nada que mirar. Cuenta aunque todavía no haya
-- fila en contactos, como mis_contactos(): lo que nombran mis llamadas y mis
-- leads. (mis_contactos())
create or replace function public.es_mi_persona(x text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(x, '') = ''
      or exists (select 1 from public.contactos c
                  where c.id = x and c."creadoPor" <> '' and c."creadoPor" = (select public.mi_email()))
      or exists (select 1 from public.sesiones s where s."contactoId" = x and public.anfitrion_es_mio(s.anfitrion))
      or exists (select 1 from public.leads l where l."contactoId" = x and public.es_mi_lead(l.id));
$$;

-- ventas.contactoId es el lead; la app a veces guarda ahí una persona. Un lead
-- tiene que ser mío; un id que no es de ningún lead, una persona mía.
create or replace function public.venta_apunta_a_lo_mio(x text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(x, '') = ''
      or public.es_mi_lead(x)
      or (not exists (select 1 from public.leads l where l.id = x) and public.es_mi_persona(x));
$$;

-- ---------- 3. lo que un closer no puede fabricarse ----------

-- Quién escribe: sin sesión de una persona (la clave de servicio del servidor,
-- el editor de SQL) los cinco triggers dejan pasar todo, como control-cruzado.
create or replace function public.ventas_guarda_del_closer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not coalesce((select public.solo_lo_suyo()), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new."contactoId", '') = '' and new."sesionId" is null then
      return new;
    end if;
    -- El upsert de una venta que ya está entra por acá antes de chocar con su
    -- fila: lo que cambie lo mira el UPDATE.
    if exists (select 1 from public.ventas v where v.id = new.id) then
      return new;
    end if;
    if not public.venta_apunta_a_lo_mio(new."contactoId") then
      raise exception 'Tu tipo de cuenta no puede cargar una venta a nombre de una persona que todavía no es tuya.' using errcode = '42501';
    end if;
    if new."sesionId" is not null and not public.es_mi_llamada(new."sesionId") then
      raise exception 'Tu tipo de cuenta no puede atar una venta a la llamada de otro.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new."contactoId" is distinct from old."contactoId" and not public.venta_apunta_a_lo_mio(new."contactoId") then
    raise exception 'Tu tipo de cuenta no puede apuntar una venta a una persona que todavía no es tuya.' using errcode = '42501';
  end if;
  -- La llamada de la que salió la venta no se suelta ni se cambia (la app nunca
  -- lo hace): vuelve a como estaba. Si la venta no tenía llamada, sólo una suya.
  if old."sesionId" is not null then
    new."sesionId" := old."sesionId";
  elsif new."sesionId" is not null and not public.es_mi_llamada(new."sesionId") then
    raise exception 'Tu tipo de cuenta no puede atar una venta a la llamada de otro.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ventas_guarda_del_closer on public.ventas;
create trigger ventas_guarda_del_closer
  before insert or update of "contactoId", "sesionId" on public.ventas
  for each row execute function public.ventas_guarda_del_closer();

create or replace function public.cuotas_guarda_del_closer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not coalesce((select public.solo_lo_suyo()), false) then
    return new;
  end if;
  if coalesce(new."ventaId", '') = '' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.cuotas c where c.id = new.id) then
      return new;
    end if;
  elsif new."ventaId" is not distinct from old."ventaId" then
    return new;
  end if;

  if not public.es_mi_venta(new."ventaId") then
    raise exception 'Tu tipo de cuenta no puede poner una cuota en una venta que todavía no es tuya.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists cuotas_guarda_del_closer on public.cuotas;
create trigger cuotas_guarda_del_closer
  before insert or update of "ventaId" on public.cuotas
  for each row execute function public.cuotas_guarda_del_closer();

create or replace function public.sesiones_guarda_del_closer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not coalesce((select public.solo_lo_suyo()), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new."leadId", '') = '' and coalesce(new."contactoId", '') = '' then
      return new;
    end if;
    if exists (select 1 from public.sesiones s where s.id = new.id) then
      return new;
    end if;
  elsif new."leadId" is not distinct from old."leadId" and new."contactoId" is not distinct from old."contactoId" then
    return new;
  end if;

  if (tg_op = 'INSERT' or new."leadId" is distinct from old."leadId")
     and not public.es_mi_lead(new."leadId") then
    raise exception 'Tu tipo de cuenta no puede atar una llamada a un lead que todavía no es tuyo.' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new."contactoId" is distinct from old."contactoId")
     and not public.es_mi_persona(new."contactoId") then
    raise exception 'Tu tipo de cuenta no puede atar una llamada a una persona que todavía no es tuya.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sesiones_guarda_del_closer on public.sesiones;
create trigger sesiones_guarda_del_closer
  before insert or update of "leadId", "contactoId" on public.sesiones
  for each row execute function public.sesiones_guarda_del_closer();

create or replace function public.leads_guarda_del_closer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not coalesce((select public.solo_lo_suyo()), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.leads l where l.id = new.id) then
      return new;
    end if;
    -- Un lead nuevo no puede llevar el id de una persona que no es suya.
    if exists (select 1 from public.contactos c where c.id = new.id) and not public.es_mi_persona(new.id) then
      raise exception 'Tu tipo de cuenta no puede crear un lead con el id de una persona que no es tuya.' using errcode = '42501';
    end if;
  elsif new."contactoId" is not distinct from old."contactoId" then
    return new;
  end if;

  if coalesce(new."contactoId", '') = '' then
    return new;
  end if;
  -- La persona de un lead nuevo la escribió él un instante antes (creadoPor):
  -- cuenta como suya. La de otro, no.
  if not public.es_mi_persona(new."contactoId") then
    raise exception 'Tu tipo de cuenta no puede atar un lead a una persona que todavía no es tuya.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guarda_del_closer on public.leads;
create trigger leads_guarda_del_closer
  before insert or update of "contactoId" on public.leads
  for each row execute function public.leads_guarda_del_closer();

create or replace function public.contactos_guarda_del_closer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not coalesce((select public.solo_lo_suyo()), false) then
    return new;
  end if;
  -- El upsert de una persona que ya está entra por acá antes de chocar con su fila.
  if exists (select 1 from public.contactos c where c.id = new.id) then
    return new;
  end if;
  -- Una persona nueva no puede llevar el id de un lead que no es suyo.
  if exists (select 1 from public.leads l where l.id = new.id) and not public.es_mi_lead(new.id) then
    raise exception 'Tu tipo de cuenta no puede crear una persona con el id de un lead que no es tuyo.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists contactos_guarda_del_closer on public.contactos;
create trigger contactos_guarda_del_closer
  before insert on public.contactos
  for each row execute function public.contactos_guarda_del_closer();

-- ---------- 4. quién puede llamar a qué ----------
-- Ninguna de estas funciones es para que la llame un cliente: los triggers (que
-- son security definer) las usan por dentro. Se les saca el permiso a PUBLIC y,
-- si existen, a anon y authenticated (en Supabase las funciones nuevas nacen con
-- permiso para los dos). Sólo equipo_nombres_que_chocan() la puede mirar quien
-- tiene sesión.
do $$
declare f text; r text;
begin
  foreach f in array array[
    'public.anfitrion_es_mio(text)', 'public.es_mi_llamada(text)', 'public.es_mi_venta(text)',
    'public.es_mi_lead(text)', 'public.es_mi_persona(text)', 'public.venta_apunta_a_lo_mio(text)',
    'public.ventas_guarda_del_closer()', 'public.cuotas_guarda_del_closer()', 'public.sesiones_guarda_del_closer()',
    'public.leads_guarda_del_closer()', 'public.contactos_guarda_del_closer()'
  ] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;

  revoke all on function public.equipo_nombres_que_chocan() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.equipo_nombres_que_chocan() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.equipo_nombres_que_chocan() to authenticated;
  end if;
end $$;

-- Las dos funciones de la primera versión de este archivo (nunca llegaron a
-- producción): la lista mezclada de leads y personas, y el oráculo de existencia.
drop function if exists public.referencia_a_gente_es_mia(text);
drop function if exists public.fila_ya_existe(text, text);

-- ---------- diagnóstico ----------
select
  (select count(*) from pg_trigger
    where tgname in ('cuotas_guarda_del_closer', 'ventas_guarda_del_closer', 'sesiones_guarda_del_closer',
                     'leads_guarda_del_closer', 'contactos_guarda_del_closer')
      and not tgisinternal)                                                          as triggers_de_5,
  (select public.nombre_corto('Núñez') = 'nunez')                                    as nombre_corto_bien,
  (select count(*) from public.equipo_nombres_que_chocan())                          as nombres_que_chocan,
  (select string_agg(x.clave || ': ' || array_to_string(x.miembros, ' / '), '; ')
     from public.equipo_nombres_que_chocan() x)                                      as quienes_chocan;
