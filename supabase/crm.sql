-- El CRM de ventas (Booking Calls, como el Airtable del equipo) — Apicanta ERP
--
-- Cada fila del CRM es una agenda de Calendly (`sesiones`): casi todo sale
-- de la agenda misma (nombre, fecha, closer, UTMs, lo que contestó en el
-- formulario). El equipo carga cinco columnas, que viven en la misma fila:
--   "preCall"        1° Mje Enviado, 1° Llamada, 2° Mje Enviado…
--   "estadoPreCall"  Confirmado, Reagendar, Sin Respuesta
--   "estadoLlamada"  Compra Full, Seguimiento Nutrición, Inasistió…
--   notas            (ya existía: las notas de la llamada)
--   grabacion        el link de Fathom
-- Se guardan con el nombre de la opción, como un campo de selección de
-- Airtable. Las opciones y sus colores viven en ajustes.crm (jsonb), junto
-- con qué tipos de evento entran en cada tabla.
--
-- La app manda sólo lo que cambió (un UPDATE de esas columnas): el webhook
-- de Calendly escribe la misma fila y no se pisan. Agregar columnas no toca
-- RLS ni Realtime (sesiones ya está en la publicación).
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.sesiones') is null or to_regclass('public.ajustes') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla sesiones o ajustes.';
  end if;
end $$;

alter table public.sesiones
  add column if not exists "preCall"       text,
  add column if not exists "estadoPreCall" text,
  add column if not exists "estadoLlamada" text,
  add column if not exists grabacion       text;

alter table public.ajustes
  add column if not exists crm jsonb;

-- Las vistas por closer y por día filtran por estos dos.
create index if not exists sesiones_inicia_idx on public.sesiones (inicia);
create index if not exists sesiones_anfitrion_idx on public.sesiones (anfitrion);

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sesiones'
      and column_name in ('preCall', 'estadoPreCall', 'estadoLlamada', 'grabacion')) as columnas_crm_de_4,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ajustes' and column_name = 'crm')  as config_de_1,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sesiones') as realtime_de_1;
