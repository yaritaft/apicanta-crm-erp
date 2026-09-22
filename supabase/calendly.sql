-- Calendly en el ERP: cada agenda entra sola a nuestra base — Apicanta ERP
--
-- Una agenda de Calendly deja tres cosas: el CONTACTO (la persona, por
-- email), un LEAD en "Sesión agendada" si no tenía ninguna oportunidad, y la
-- LLAMADA. Este SQL le agrega a las llamadas lo que trae Calendly, y a los
-- contactos lo nuevo que pregunta su formulario.
--
-- Lo escriben /api/calendly/webhook (en segundos) y /api/cron/calendly (cada
-- 30 minutos, repesca lo que un webhook haya perdido), con la clave de
-- servicio. La política de `sesiones` no cambia: agregar columnas no toca RLS.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.contactos') is null or to_regclass('public.sesiones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla contactos o sesiones.';
  end if;
end $$;

-- ---------- la llamada ----------
alter table public.sesiones
  add column if not exists "contactoId"          text,
  -- El canal sale del tipo de evento ("Llamada de Asesoramiento - Webinar").
  add column if not exists canal                 text,
  -- Los UTMs con los que agendó: el embudo (Webinar + fecha, Resell,
  -- setter-ia), no el anuncio. Calendly no conoce el anuncio.
  add column if not exists utm                   jsonb,
  -- Las preguntas del formulario, tal cual se contestaron.
  add column if not exists respuestas            jsonb,
  -- Quién la atiende: el anfitrión del evento (el closer).
  add column if not exists anfitrion             text,
  add column if not exists "calendlyEventoUri"   text,
  add column if not exists "calendlyInvitadoUri" text,
  add column if not exists "reprogramadaDe"      text,
  add column if not exists "canceladaEn"         timestamptz,
  add column if not exists "motivoCancelacion"   text;

-- Una llamada es de una persona aunque todavía no tenga oportunidad abierta.
do $$
begin
  alter table public.sesiones add constraint sesiones_contacto_fk
    foreign key ("contactoId") references public.contactos(id) on delete set null;
exception
  when duplicate_object then null;
  when others then raise notice 'Sin FK sesiones→contactos (%).', sqlerrm;
end $$;

alter table public.sesiones drop constraint if exists sesiones_canal_ck;
alter table public.sesiones add constraint sesiones_canal_ck
  check (canal is null or canal in ('webinar', 'vsl', 'setter', 'otro'));

-- Un invitado de Calendly es UNA llamada: si el webhook y el cron traen la
-- misma, la segunda la pisa en vez de duplicarla.
create unique index if not exists sesiones_calendly_invitado_uidx
  on public.sesiones ("calendlyInvitadoUri") where "calendlyInvitadoUri" is not null;
create index if not exists sesiones_calendly_evento_idx on public.sesiones ("calendlyEventoUri");
create index if not exists sesiones_contacto_idx        on public.sesiones ("contactoId");

-- ---------- la persona ----------
-- Texto libre, tal cual lo escribió ("React y Node", "Universitario", "1200"):
-- no son categorías, y forzarlas perdería lo que dijo.
alter table public.contactos
  add column if not exists tecnologias text,
  add column if not exists formacion   text,
  add column if not exists "sueldoUsd" text,
  add column if not exists instagram   text;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sesiones'
      and column_name in ('contactoId', 'canal', 'utm', 'respuestas', 'anfitrion', 'calendlyEventoUri',
                          'calendlyInvitadoUri', 'reprogramadaDe', 'canceladaEn', 'motivoCancelacion')) as columnas_llamada_de_10,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contactos'
      and column_name in ('tecnologias', 'formacion', 'sueldoUsd', 'instagram'))                  as columnas_persona_de_4,
  (select count(*) from pg_constraint where conname = 'sesiones_contacto_fk')                     as fk_de_1,
  (select relrowsecurity from pg_class where oid = 'public.sesiones'::regclass)                   as rls_llamadas;
