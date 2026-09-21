-- Contactos: separar la PERSONA de la OPORTUNIDAD — Apicanta ERP
--
-- "Un contacto pudo no haber sido lead, pero un lead es contacto".
--
-- Hoy la identidad vive dentro de `leads`, y eso tiene un costo concreto: no
-- se puede saber de qué anuncio vino alguien. El origen es de la persona, no
-- de la oportunidad — si vuelve seis meses después y se abre un lead nuevo,
-- sigue habiendo venido de aquel anuncio. Con el origen en `leads` esa
-- historia se pierde en cada oportunidad nueva.
--
-- Es lo que bloquea el drill de Marketing: anuncio → leads que generó → ficha
-- del contacto. Sin un `origenAdId` en la persona no hay por dónde entrar.
--
-- EL ID SE REUSA A PROPÓSITO. Cada contacto migrado se queda con el id de su
-- lead. `ventas."contactoId"` ya guarda ids de leads (lo leen alumnos,
-- conciliación, métricas y seed), así que reusar el id convierte ese campo en
-- lo que su nombre dice sin tocar una línea de ventas. Si se generaran ids
-- nuevos, las 4 pantallas quedarían apuntando al vacío el mismo día.
--
-- Convención de la app: id de texto, camelCase entre comillas.

-- ---------- contactos ----------
create table if not exists public.contactos (
  id                 text primary key,
  nombre             text not null,
  email              text not null,
  telefono           text,
  pais               text,

  -- La calificación es de la persona: su inglés no cambia porque se abra otra
  -- oportunidad. Mismos nombres que `leads` y que `contacts` del backend real.
  "inglesNivel"      text,
  "aniosExperiencia" integer,

  -- De dónde vino. `origenAdId` es el vínculo fuerte: un id real de la
  -- jerarquía de Meta, no un texto que alguien escribió. Los UTMs son el
  -- respaldo — de Calendly llegan source, medium y content siempre, pero
  -- campaign sólo en la mitad de las agendas.
  "origenCanal"      text,
  "origenAdId"       text,
  "origenWebinarId"  text,
  utm                jsonb,

  notas              text,
  "creadoEn"         timestamptz not null default now(),
  extra              jsonb not null default '{}'::jsonb
);

-- ---------- seguridad ----------
-- MISMA política que el resto de las tablas. Sin esto la tabla nace ABIERTA:
-- Supabase no activa RLS en las tablas creadas por SQL, y la clave pública
-- —que viaja dentro del JavaScript de la app— alcanzaría para leer nombre,
-- mail y teléfono de todos los contactos. Va pegado al create table para que
-- la tabla no exista ni un instante sin política.
alter table public.contactos enable row level security;

drop policy if exists acceso_equipo_contactos on public.contactos;
create policy acceso_equipo_contactos on public.contactos for all
  using (public.puede_entrar()) with check (public.puede_entrar());

-- Los cuatro canales que ya existen en `contacts.origin_channel` del backend
-- real, donde está lleno al 100%. No se inventa una taxonomía nueva.
alter table public.contactos drop constraint if exists contactos_origen_canal_ck;
alter table public.contactos add constraint contactos_origen_canal_ck
  check ("origenCanal" is null or "origenCanal" in ('webinar', 'vsl', 'setter', 'otro'));

alter table public.contactos drop constraint if exists contactos_ingles_nivel_ck;
alter table public.contactos add constraint contactos_ingles_nivel_ck
  check ("inglesNivel" is null or "inglesNivel" in
    ('ninguno', 'basico', 'intermedio', 'conversacional', 'nativo'));

-- Las FKs van aparte y toleran que la tabla apuntada no exista o tenga otro
-- tipo de id: la integridad referencial es deseable, pero no al precio de que
-- falle la migración entera y no quede nada. Si no se pueden poner, AVISA —
-- el diagnóstico del final dice cuántas quedaron, así que una FK que no entró
-- se ve, no se entera nadie seis meses después.
do $$
begin
  begin
    alter table public.contactos add constraint contactos_ad_fk
      foreign key ("origenAdId") references public.ads(id) on delete set null;
  exception
    when duplicate_object then null;
    when others then raise notice 'Sin FK a ads (%). La columna queda igual.', sqlerrm;
  end;
  begin
    alter table public.contactos add constraint contactos_webinar_fk
      foreign key ("origenWebinarId") references public.webinars(id) on delete set null;
  exception
    when duplicate_object then null;
    when others then raise notice 'Sin FK a webinars (%). La columna queda igual.', sqlerrm;
  end;
end $$;

-- El email NO es único todavía: la migración crea un contacto por lead y hoy
-- hay emails repetidos. Unificarlos es fusionar personas, y eso se mira antes
-- de correrlo — el diagnóstico del final los lista.
create index if not exists contactos_email_idx   on public.contactos (lower(email));
create index if not exists contactos_ad_idx      on public.contactos ("origenAdId");
create index if not exists contactos_webinar_idx on public.contactos ("origenWebinarId");

-- ---------- el lead apunta a su contacto ----------
-- `on delete set null`, no cascade: borrar una persona no puede llevarse
-- puesta la oportunidad y, con ella, la venta que cuelga de esa oportunidad.
alter table public.leads
  add column if not exists "contactoId" text;

do $$
begin
  alter table public.leads add constraint leads_contacto_fk
    foreign key ("contactoId") references public.contactos(id) on delete set null;
exception
  when duplicate_object then null;
  when others then raise notice 'Sin FK leads→contactos (%).', sqlerrm;
end $$;

create index if not exists leads_contacto_idx on public.leads ("contactoId");

-- ---------- migración ----------
-- Idempotente: se puede correr de nuevo sin duplicar nada.
insert into public.contactos (
  id, nombre, email, telefono, pais,
  "inglesNivel", "aniosExperiencia",
  "origenCanal", "origenWebinarId", notas, "creadoEn", extra
)
select
  l.id, l.nombre, l.email, l.telefono, l.pais,
  l."inglesNivel", l."aniosExperiencia",
  -- Sólo se deriva lo que es estructuralmente cierto: si el lead cuelga de un
  -- webinar, vino de un webinar. El resto queda NULL a propósito — `fuente` es
  -- texto libre y mapearlo a mano sería inventar un dato que después nadie
  -- sabe si es real. Los que vengan de Meta se llenan solos al sincronizar.
  case when l."webinarId" is not null then 'webinar' end,
  l."webinarId", l.notas, l."creadoEn", '{}'::jsonb
from public.leads l
on conflict (id) do nothing;

update public.leads set "contactoId" = id where "contactoId" is null;

-- Las columnas duplicadas en `leads` (nombre, email, teléfono, país, inglés)
-- NO se borran acá. Ocho pantallas las leen; el contacto es la fuente de
-- verdad desde ahora y la copia se limpia cuando esas pantallas migren.

-- ---------- diagnóstico ----------
select
  (select count(*) from public.contactos)                             as contactos,
  (select count(*) from public.leads where "contactoId" is not null)  as leads_vinculados,
  (select count(*) from public.leads where "contactoId" is null)      as leads_sueltos,
  (select count(*) from public.contactos where "origenCanal" is not null) as con_canal,
  (select count(*) from (
     select lower(email) from public.contactos group by 1 having count(*) > 1
   ) d)                                                               as emails_repetidos,
  (select count(*) from pg_constraint
    where conname in ('contactos_ad_fk', 'contactos_webinar_fk', 'leads_contacto_fk')) as fks_de_3,
  -- Tiene que dar true. Si da false, la tabla está abierta: no usar la app
  -- hasta arreglarlo.
  (select relrowsecurity from pg_class where oid = 'public.contactos'::regclass) as rls_activo;
