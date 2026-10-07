-- «Sólo lo suyo» seguro — Apicanta ERP (arreglos del estrés de la base, 07/10)
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
-- comisión). Lo frenan cuatro triggers, que sólo miran a quien tiene «sólo lo
-- suyo» y una referencia NUEVA (o cambiada): lo que ya estaba escrito, y todo lo
-- que escriben el servidor y los demás tipos de cuenta, queda igual.
--
--   · cuotas.ventaId, al crear o cambiar, tiene que ser una venta que ya es suya
--     (la venta se carga antes que sus cuotas). La herencia de cuotas a otro
--     closer la sigue asignando quien edita Ventas sin «sólo lo suyo».
--   · ventas.contactoId, sesiones.leadId / contactoId y leads.contactoId, al
--     crear o cambiar, tienen que apuntar a un lead o a una persona que ya es
--     suya (la persona que creó él cuenta: el contacto se escribe antes que el
--     lead y el lead antes que la venta).
--   · ventas.sesionId (lo que ata la venta a su llamada para «venta que no se
--     cargó el mismo día, no se comisiona»): una vez puesto no se cambia ni se
--     suelta, y al crear la venta tiene que ser una llamada suya.
--
-- Si no alcanza, la base contesta 42501 (el código de RLS) y la app lo trata
-- como cualquier escritura que su tipo de cuenta no puede hacer. La única
-- excepción silenciosa es sesionId, que vuelve a como estaba (como cargadoPor).
--
-- Además (hallazgos del mismo estrés):
--
--   · nombre_corto(): las dos tablas del translate() eran de 48 y 49 caracteres y
--     la «ñ» salía «u» («Núñez» → «nuuez»): un closer con ñ no encontraba sus
--     llamadas si Calendly escribía el anfitrión de otra manera. Mismo arreglo
--     que en tipos-cuenta.sql (create or replace de lo mismo).
--   · Dos closers con el mismo nombre corto (Ana Laura Pérez y Ana Laura Gómez):
--     miembro_de_nombre() y son_mios() elegían siempre el de menor id y el otro
--     no veía ninguna llamada. Ahora gana el que tiene el nombre entero igual al
--     del anfitrión; el desempate de antes (activo, id) queda para lo demás, así
--     que a nadie que no choque le cambia nada. Para ver quiénes chocan:
--       select * from public.equipo_nombres_que_chocan();
--
-- Idempotente y en cualquier orden respecto de los demás archivos (sólo pide
-- tipos-cuenta.sql antes). Sin cambiar datos: son funciones y triggers. Para
-- deshacer los triggers:
--   drop trigger if exists cuotas_guarda_del_closer on public.cuotas;
--   drop trigger if exists ventas_guarda_del_closer on public.ventas;
--   drop trigger if exists sesiones_guarda_del_closer on public.sesiones;
--   drop trigger if exists leads_guarda_del_closer on public.leads;
-- Se ensaya con pruebas/fix-sql-solo-lo-suyo.test.ts (PGlite, en memoria).

do $$ begin
  if to_regclass('public.cuotas') is null or to_regclass('public.ventas') is null
     or to_regclass('public.sesiones') is null or to_regclass('public.leads') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta cuotas, ventas, sesiones o leads.';
  end if;
  if to_regprocedure('public.solo_lo_suyo()') is null or to_regprocedure('public.mis_ventas()') is null
     or to_regprocedure('public.mis_leads()') is null or to_regprocedure('public.mis_contactos()') is null
     or to_regprocedure('public.mis_sesiones()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan solo_lo_suyo() o mis_ventas(), mis_leads(), mis_contactos(), mis_sesiones().';
  end if;
end $$;

-- La llamada de la que salió la venta: la agrega cierre-del-dia.sql; acá se
-- asegura para que el trigger de abajo no dependa de en qué orden se corrió.
alter table public.ventas add column if not exists "sesionId" text;

-- ---------- 1. los nombres (copia exacta de lo de tipos-cuenta.sql) ----------

create or replace function public.nombre_completo(t text)
returns text
language sql immutable
as $$
  select trim(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
    'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc')), '\s+', ' ', 'g'));
$$;

create or replace function public.nombre_corto(t text)
returns text
language sql immutable
as $$
  select array_to_string((regexp_split_to_array(public.nombre_completo(t), ' '))[1:2], ' ');
$$;

create or replace function public.miembro_de_nombre(n text)
returns text
language sql stable security definer
set search_path = public
as $$
  with c as (select public.nombre_corto(n) as c)
  select coalesce(
    (select e.id from public.equipo e, c
      where c.c <> '' and public.nombre_corto(e.nombre) = c.c
      order by (public.nombre_completo(e.nombre) = public.nombre_completo(n)) desc, e.activo desc, e.id limit 1),
    (select e.id from public.equipo e, c
      where c.c <> '' and public.nombre_corto(e.nombre) <> ''
        and (c.c like public.nombre_corto(e.nombre) || ' %' or public.nombre_corto(e.nombre) like c.c || ' %')
      order by e.activo desc, e.id limit 1));
$$;

create or replace function public.son_mios(nombres text[])
returns text[]
language sql stable security definer
set search_path = public
as $$
  with yo as materialized (select public.mi_miembro_id() as id),
       eq as materialized (select e.id, public.nombre_corto(e.nombre) as c, public.nombre_completo(e.nombre) as f, e.activo from public.equipo e),
       n  as materialized (select distinct x as nombre, public.nombre_corto(x) as c, public.nombre_completo(x) as f
                           from unnest(nombres) as x where coalesce(x, '') <> ''),
       quien as (
         select n.nombre, coalesce(
           (select eq.id from eq where n.c <> '' and eq.c = n.c order by (eq.f = n.f) desc, eq.activo desc, eq.id limit 1),
           (select eq.id from eq where n.c <> '' and eq.c <> ''
              and (n.c like eq.c || ' %' or eq.c like n.c || ' %')
            order by eq.activo desc, eq.id limit 1)) as miembro
         from n)
  select coalesce(array_agg(quien.nombre), array[]::text[])
  from quien, yo where yo.id is not null and quien.miembro = yo.id;
$$;

-- Los miembros activos de Equipo cuyo nombre corto (las dos primeras palabras,
-- sin tildes) es el mismo: para la base son la misma persona salvo que el
-- anfitrión de Calendly traiga el nombre entero. Vacío = nadie choca.
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
grant execute on function public.equipo_nombres_que_chocan() to authenticated;

-- ---------- 2. lo que un closer no puede fabricarse ----------

-- ¿Este lead o esta persona ya es de quien escribe? (vacío = nada que mirar)
create or replace function public.referencia_a_gente_es_mia(id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(id, '') = ''
      or id = any((select public.mis_leads())::text[])
      or id = any((select public.mis_contactos())::text[]);
$$;
grant execute on function public.referencia_a_gente_es_mia(text) to authenticated;

-- ¿Ya existe esa fila? Se mira sin las políticas (una consulta por clave, sin
-- recalcular lo que ve cada uno): el upsert de una fila que ya está entra por el
-- INSERT antes de chocar con ella, y lo que cambie lo mira el UPDATE. Si la fila
-- existe y no es suya, el upsert falla igual por RLS (no puede actualizarla).
create or replace function public.fila_ya_existe(tabla text, id text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare existe boolean;
begin
  if tabla not in ('ventas', 'cuotas', 'sesiones', 'leads') then
    raise exception 'fila_ya_existe: tabla no prevista (%).', tabla;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', tabla) into existe using id;
  return existe;
end;
$$;
grant execute on function public.fila_ya_existe(text, text) to authenticated;

-- Quién escribe: sin sesión de una persona (la clave de servicio del servidor,
-- el editor de SQL) los cuatro triggers dejan pasar todo, como control-cruzado.
create or replace function public.ventas_guarda_del_closer()
returns trigger
language plpgsql
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
    if public.fila_ya_existe('ventas', new.id) then
      return new;
    end if;
    if not (select public.referencia_a_gente_es_mia(new."contactoId")) then
      raise exception 'Tu tipo de cuenta no puede cargar una venta a nombre de una persona que todavía no es tuya.' using errcode = '42501';
    end if;
    if new."sesionId" is not null and not (new."sesionId" = any((select public.mis_sesiones())::text[])) then
      raise exception 'Tu tipo de cuenta no puede atar una venta a la llamada de otro.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new."contactoId" is distinct from old."contactoId" and not (select public.referencia_a_gente_es_mia(new."contactoId")) then
    raise exception 'Tu tipo de cuenta no puede apuntar una venta a una persona que todavía no es tuya.' using errcode = '42501';
  end if;
  -- La llamada de la que salió la venta no se suelta ni se cambia (la app nunca
  -- lo hace): vuelve a como estaba. Si la venta no tenía llamada, sólo una suya.
  if old."sesionId" is not null then
    new."sesionId" := old."sesionId";
  elsif new."sesionId" is not null and not (new."sesionId" = any((select public.mis_sesiones())::text[])) then
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
language plpgsql
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
    if public.fila_ya_existe('cuotas', new.id) then
      return new;
    end if;
  elsif new."ventaId" is not distinct from old."ventaId" then
    return new;
  end if;

  if not (new."ventaId" = any((select public.mis_ventas())::text[])) then
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
language plpgsql
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
    if public.fila_ya_existe('sesiones', new.id) then
      return new;
    end if;
  elsif new."leadId" is not distinct from old."leadId" and new."contactoId" is not distinct from old."contactoId" then
    return new;
  end if;

  if (tg_op = 'INSERT' or new."leadId" is distinct from old."leadId")
     and not (select public.referencia_a_gente_es_mia(new."leadId")) then
    raise exception 'Tu tipo de cuenta no puede atar una llamada a un lead que todavía no es tuyo.' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new."contactoId" is distinct from old."contactoId")
     and not (select public.referencia_a_gente_es_mia(new."contactoId")) then
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
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not coalesce((select public.solo_lo_suyo()), false) then
    return new;
  end if;

  if coalesce(new."contactoId", '') = '' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if public.fila_ya_existe('leads', new.id) then
      return new;
    end if;
  elsif new."contactoId" is not distinct from old."contactoId" then
    return new;
  end if;

  -- La persona de un lead nuevo la escribió él un instante antes (creadoPor):
  -- cuenta como suya. La de otro, no.
  if not (select public.referencia_a_gente_es_mia(new."contactoId")) then
    raise exception 'Tu tipo de cuenta no puede atar un lead a una persona que todavía no es tuya.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guarda_del_closer on public.leads;
create trigger leads_guarda_del_closer
  before insert or update of "contactoId" on public.leads
  for each row execute function public.leads_guarda_del_closer();

-- ---------- diagnóstico ----------
select
  (select count(*) from pg_trigger
    where tgname in ('cuotas_guarda_del_closer', 'ventas_guarda_del_closer', 'sesiones_guarda_del_closer', 'leads_guarda_del_closer')
      and not tgisinternal)                                                          as triggers_de_4,
  (select public.nombre_corto('Núñez') = 'nunez')                                    as nombre_corto_bien,
  (select count(*) from public.equipo_nombres_que_chocan())                          as nombres_que_chocan,
  (select string_agg(x.clave || ': ' || array_to_string(x.miembros, ' / '), '; ')
     from public.equipo_nombres_que_chocan() x)                                      as quienes_chocan;
