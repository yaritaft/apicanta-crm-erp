-- Los registros de la landing del webinar, en una tabla propia — Apicanta ERP
--
-- Hasta ahora cada persona que se anotaba al webinar quedaba en un Google
-- Sheet (una hoja por webinar) y, desde el 27/09, también como un renglón
-- dentro de `contactos.extra.registrosWebinar`. Para que el equipo pueda
-- seguir lo que hacía en el Excel (quién se unió al grupo de WhatsApp, a
-- quién ya se le escribió), para migrar las hojas viejas y para cruzar el
-- formulario con la agenda de Calendly hace falta una tabla propia: una fila
-- por persona y por webinar, con la fecha del webinar, los UTMs, el id del
-- anuncio, las respuestas y las tres marcas del equipo.
--
-- (D15 de la reunión del 02/10: "tabla propia, no dentro de contactos.extra".)
--
-- La clave `id` es `reg_` + un hash del mail y la fecha del webinar: la misma
-- persona en el mismo webinar es siempre la misma fila, venga de la landing,
-- del importador del Excel o de otro lado. Reimportar no duplica.
--
-- Sin esta tabla la app anda igual: el registro de la landing se sigue
-- guardando como pre-lead en `contactos` y la pantalla Formularios avisa que
-- falta correr este archivo.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.contactos') is null or to_regclass('public.webinars') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla contactos o webinars.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

create table if not exists public.registros_webinar (
  id               text primary key,
  -- El webinar de la app (si ya existe) y su fecha, aaaa-mm-dd en Argentina.
  -- La fecha es la que identifica al webinar: viene del nombre de la hoja del
  -- Excel o del webinar al que quedó atado el registro. Sin FK: una fila
  -- importada puede ser de un webinar que no está cargado en la app.
  "webinarId"      text,
  "fechaWebinar"   date,
  -- Los datos del formulario.
  email            text not null,
  nombre           text,
  telefono         text,
  -- El teléfono normalizado (código de país + número sin 0, 9 ni 15), para
  -- cruzar con la agenda y armar el link de WhatsApp.
  "telefonoNorm"   text,
  pais             text,
  utm              jsonb,
  -- El anuncio (ads.id) del que vino, sacado de utm_content. Sin FK: el
  -- anuncio puede no estar sincronizado todavía.
  "adId"           text,
  pagina           text,
  respuestas       jsonb not null default '[]'::jsonb,
  -- Para mandarle el evento a Meta aunque se envíe diferido.
  fbp              text,
  fbc              text,
  ip               text,
  "userAgent"      text,
  "eventoId"       text,
  -- Las tres marcas del equipo (lo que hacían en el Excel).
  -- grupo: null (sin revisar) · unido · no-unido
  grupo            text check (grupo is null or grupo in ('unido', 'no-unido')),
  "grupoPor"       text,
  "grupoEn"        timestamptz,
  contactado       boolean not null default false,
  "contactadoPor"  text,
  "contactadoEn"   timestamptz,
  notas            text,
  -- El cruce con la agenda (lib/cruce-formularios.ts): a qué persona del CRM
  -- es, cómo se supo y qué personas se descartaron con «No es».
  "contactoId"     text,
  cruce            text check (cruce is null or cruce in ('mail', 'telefono', 'nombre', 'manual')),
  "cruceEn"        timestamptz,
  descartados      jsonb not null default '[]'::jsonb,
  -- landing · excel · meta · whatsapp · otro, y el detalle (nombre de la hoja
  -- o del archivo).
  origen           text not null default 'landing',
  "origenDetalle"  text,
  -- Cuándo se anotó la persona (la hora de la landing, o la del Excel).
  "registradoEn"   timestamptz not null default now(),
  "creadoEn"       timestamptz not null default now()
);

create index if not exists registros_webinar_fecha_idx   on public.registros_webinar ("fechaWebinar");
create index if not exists registros_webinar_webinar_idx on public.registros_webinar ("webinarId");
create index if not exists registros_webinar_email_idx   on public.registros_webinar (lower(email));
create index if not exists registros_webinar_tel_idx     on public.registros_webinar ("telefonoNorm") where "telefonoNorm" is not null;
create index if not exists registros_webinar_ad_idx      on public.registros_webinar ("adId") where "adId" is not null;

-- ---------- seguridad ----------
-- Los ve quien ve Webinars y los cambia quien edita Webinars. Quien sólo ve
-- lo suyo (el closer) no los ve: son los datos de toda la gente que se anotó.
-- La landing escribe con la clave de servicio (saltea RLS).
alter table public.registros_webinar enable row level security;

drop policy if exists ver_registros_webinar on public.registros_webinar;
create policy ver_registros_webinar on public.registros_webinar
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1 and (select not public.solo_lo_suyo()));

drop policy if exists crear_registros_webinar on public.registros_webinar;
create policy crear_registros_webinar on public.registros_webinar
  for insert to authenticated
  with check ((select public.nivel_area('webinars')) >= 2 and (select not public.solo_lo_suyo()));

drop policy if exists editar_registros_webinar on public.registros_webinar;
create policy editar_registros_webinar on public.registros_webinar
  for update to authenticated
  using ((select public.nivel_area('webinars')) >= 2 and (select not public.solo_lo_suyo()))
  with check ((select public.nivel_area('webinars')) >= 2 and (select not public.solo_lo_suyo()));

drop policy if exists borrar_registros_webinar on public.registros_webinar;
create policy borrar_registros_webinar on public.registros_webinar
  for delete to authenticated
  using ((select public.nivel_area('webinars')) >= 2 and (select not public.solo_lo_suyo()));

-- ---------- el resumen por webinar ----------
-- Para armar el selector de la pantalla sin bajar las miles de filas: cuántos
-- se anotaron a cada webinar, cuántos se unieron al grupo y a cuántos se les
-- escribió. Respeta la seguridad de quien lo mira (security_invoker).
create or replace view public.registros_webinar_resumen
  with (security_invoker = true) as
select
  "fechaWebinar",
  max("webinarId")                                      as "webinarId",
  count(*)                                              as registros,
  count(*) filter (where grupo = 'unido')               as unidos,
  count(*) filter (where grupo = 'no-unido')            as no_unidos,
  count(*) filter (where contactado)                    as contactados
from public.registros_webinar
group by "fechaWebinar";

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'registros_webinar')                  as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.registros_webinar'::regclass) as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'registros_webinar')                      as politicas_de_4,
  (select count(*) from public.registros_webinar)                                        as registros;
