-- WhatsApp de lectura — Apicanta ERP (reunión del 02/10, F3-04)
--
-- Un servicio aparte (servicios/whatsapp-lector/), prendido en un servidor con
-- un número dedicado conectado por QR, LEE los grupos de WhatsApp de los
-- webinars y le avisa a la app quién está adentro. Nunca manda un mensaje.
-- Con eso la vista del webinar dice quién está «Unida» al grupo y quién no.
--
--   1. `whatsapp_lector`: el último latido del lector (una sola fila). De ahí
--      sale «Conectado / Sin señal hace N minutos» y el aviso de Webinars.
--   2. `whatsapp_grupos`: los grupos que detectó el lector, y a qué webinar
--      corresponde cada uno (varios grupos pueden ser del mismo webinar:
--      WhatsApp deja 1.024 por grupo).
--   3. `whatsapp_miembros`: quién está adentro de cada grupo (teléfono con el
--      código de país, sin signos: «5491155551234»), cuándo lo vimos entrar y
--      cuándo salir.
--   4. `whatsapp_contactados`: la marca «Contactado» de cada persona en cada
--      webinar, con quién la puso y cuándo.
--
-- Quién lee: quien ve los Webinars (nivel_area('webinars') >= 1). Quién
-- escribe: sólo el servidor de la app, con la clave de servicio (que saltea
-- RLS), desde /api/whatsapp/*: no hay políticas de escritura y además se
-- revocan los permisos. Los teléfonos de los grupos sólo los ve quien ve los
-- Webinars, que ya ve los teléfonos de las personas.
--
-- Sin estas tablas la app anda igual: Ajustes → WhatsApp dice que falta correr
-- este archivo y el lector recibe un 503.
--
-- Idempotente: se puede correr de nuevo sin romper nada ni borrar datos.
-- Necesita supabase/tipos-cuenta.sql corrido antes.

do $$ begin
  if to_regclass('public.webinars') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla webinars.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

-- ---------- 1. el latido del lector ----------

create table if not exists public.whatsapp_lector (
  id               integer primary key default 1 check (id = 1),
  -- Cuándo llegó el último latido, según el servidor de la app (no la hora
  -- que dice el lector: su reloj puede estar mal).
  "ultimoLatido"   timestamptz not null default now(),
  "enLector"       timestamptz,
  -- ¿Está conectado a WhatsApp? Puede estar vivo y desconectado (se cerró la sesión).
  conectado        boolean not null default false,
  -- Cuántos grupos vigila.
  grupos           integer not null default 0,
  -- La última vez que dijo estar conectado.
  "ultimaConexion" timestamptz,
  -- El primer latido de la historia: sirve para saber que alguien lo configuró.
  desde            timestamptz not null default now()
);

-- ---------- 2. los grupos ----------

create table if not exists public.whatsapp_grupos (
  -- El id de WhatsApp: 1203…@g.us
  id             text primary key,
  nombre         text not null default '',
  -- A qué webinar corresponde (se elige en Ajustes → WhatsApp o en la ficha del webinar).
  "webinarId"    text,
  -- Cuántos con teléfono hay adentro.
  miembros       integer not null default 0,
  -- Cuántos más hay que WhatsApp muestra por un id interno, sin teléfono.
  "sinTelefono"  integer not null default 0,
  -- La última lista completa que mandó el lector.
  "ultimaFoto"   timestamptz,
  "creadoEn"     timestamptz not null default now()
);

create index if not exists whatsapp_grupos_webinar_idx on public.whatsapp_grupos ("webinarId") where "webinarId" is not null;

-- ---------- 3. los miembros ----------

create table if not exists public.whatsapp_miembros (
  "grupoId"   text not null references public.whatsapp_grupos(id) on delete cascade,
  -- La clave del teléfono (src/lib/telefonos.ts): código de país + número.
  telefono    text not null,
  dentro      boolean not null default true,
  -- Cuándo lo vimos entrar. Vacío si ya estaba cuando empezamos a mirar.
  entro       timestamptz,
  salio       timestamptz,
  "creadoEn"  timestamptz not null default now(),
  primary key ("grupoId", telefono)
);

-- ---------- 4. «Contactado» ----------

create table if not exists public.whatsapp_contactados (
  "webinarId" text not null,
  -- La persona del webinar (su id en la app: contacto, o lead si no tiene contacto).
  "personaId" text not null,
  -- Quién la marcó (su correo).
  por         text,
  en          timestamptz not null default now(),
  primary key ("webinarId", "personaId")
);

-- Las claves foráneas van aparte y toleran que la tabla apuntada tenga otro
-- tipo de id: la integridad es deseable, pero no al precio de que falle la
-- migración entera. Si no se pueden poner, avisa.
do $$
begin
  begin
    alter table public.whatsapp_grupos add constraint whatsapp_grupos_webinar_fk
      foreign key ("webinarId") references public.webinars(id) on delete set null;
  exception
    when duplicate_object then null;
    when others then raise notice 'Sin FK de los grupos a webinars (%). La columna queda igual.', sqlerrm;
  end;
  begin
    alter table public.whatsapp_contactados add constraint whatsapp_contactados_webinar_fk
      foreign key ("webinarId") references public.webinars(id) on delete cascade;
  exception
    when duplicate_object then null;
    when others then raise notice 'Sin FK de los contactados a webinars (%). La columna queda igual.', sqlerrm;
  end;
end $$;

-- ---------- RLS: lee quien ve los Webinars; escribe sólo el servidor ----------

alter table public.whatsapp_lector enable row level security;
drop policy if exists ver_whatsapp_lector on public.whatsapp_lector;
create policy ver_whatsapp_lector on public.whatsapp_lector
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1);

alter table public.whatsapp_grupos enable row level security;
drop policy if exists ver_whatsapp_grupos on public.whatsapp_grupos;
create policy ver_whatsapp_grupos on public.whatsapp_grupos
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1);

alter table public.whatsapp_miembros enable row level security;
drop policy if exists ver_whatsapp_miembros on public.whatsapp_miembros;
create policy ver_whatsapp_miembros on public.whatsapp_miembros
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1);

alter table public.whatsapp_contactados enable row level security;
drop policy if exists ver_whatsapp_contactados on public.whatsapp_contactados;
create policy ver_whatsapp_contactados on public.whatsapp_contactados
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1);

-- Sin políticas de escritura RLS ya las rechaza; esto lo deja dicho aparte, por
-- si algún día alguien agrega una política de más.
revoke insert, update, delete, truncate on public.whatsapp_lector, public.whatsapp_grupos,
  public.whatsapp_miembros, public.whatsapp_contactados from anon, authenticated;
revoke select on public.whatsapp_lector, public.whatsapp_grupos,
  public.whatsapp_miembros, public.whatsapp_contactados from anon;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('whatsapp_lector', 'whatsapp_grupos', 'whatsapp_miembros', 'whatsapp_contactados')) as tablas_de_4,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'whatsapp\_%' and c.relkind = 'r' and c.relrowsecurity)    as con_rls_de_4,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'whatsapp\_%')            as politicas_de_4,
  (select count(*) from pg_constraint where conname in ('whatsapp_grupos_webinar_fk', 'whatsapp_contactados_webinar_fk')) as fks_de_2;
