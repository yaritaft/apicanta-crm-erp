-- WhatsApp de lectura: el código QR para vincular el número, en la app — Apicanta ERP
--
-- Antes el código QR salía en la terminal del servidor y alguien lo escaneaba
-- ahí. Ahora el lector lo manda a la app y se escanea desde Ajustes →
-- WhatsApp, junto con el estado de la conexión. Esto agrega lo que falta:
--
--   1. `whatsapp_lector.estado`: cómo está el lector con WhatsApp (conectado,
--      esperando_qr, reconectando o cerrado). La ve quien ve los Webinars, como
--      el resto de esa fila (política que ya trae whatsapp-lector.sql).
--   2. `whatsapp_qr`: una sola fila con el código QR vigente (una imagen) y
--      cuándo llegó.
--
-- EL CÓDIGO QR ES UNA CREDENCIAL: quien lo escanea con el teléfono del número
-- del lector puede leer ese WhatsApp. Por eso `whatsapp_qr` NO tiene ninguna
-- política de RLS (ni de lectura): desde el navegador, con la sesión de quien
-- sea —dueños incluidos—, no se puede leer ni escribir. Sólo el servidor de la
-- app, con la clave de servicio (que saltea RLS), la escribe (/api/whatsapp/
-- latido) y la lee, y /api/whatsapp/estado se lo da únicamente a quien edita
-- Ajustes, si tiene menos de un minuto. El lector la borra apenas se conecta.
-- Tampoco se agrega a Realtime.
--
-- Sin este archivo la app anda igual: el lector se conecta, pero el código no
-- se puede ver en Ajustes (la pantalla lo dice) y hay que escanearlo desde la
-- terminal del servidor (`npm start -- --qr-terminal`).
--
-- Idempotente: se puede correr de nuevo sin romper nada ni borrar datos.
-- Necesita supabase/whatsapp-lector.sql corrido antes. No toca ese archivo.

do $$ begin
  if to_regclass('public.whatsapp_lector') is null then
    raise exception 'Primero hay que correr whatsapp-lector.sql: falta la tabla whatsapp_lector.';
  end if;
end $$;

-- ---------- 1. cómo está el lector con WhatsApp ----------

alter table public.whatsapp_lector add column if not exists estado text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_lector_estado_ck') then
    alter table public.whatsapp_lector add constraint whatsapp_lector_estado_ck
      check (estado is null or estado in ('conectado', 'esperando_qr', 'reconectando', 'cerrado'));
  end if;
end $$;

-- ---------- 2. el código QR (credencial: sólo el servidor) ----------

create table if not exists public.whatsapp_qr (
  id    integer primary key default 1 check (id = 1),
  -- La imagen del código, como data URL (data:image/svg+xml;base64,…). Pocos KB.
  qr    text not null,
  -- Cuándo llegó, según el servidor de la app: pasado un minuto ya no se muestra.
  en    timestamptz not null default now()
);

alter table public.whatsapp_qr enable row level security;

-- Sin políticas: si alguna vez alguien agregó una, se saca. Con RLS activa y sin
-- políticas, nadie que no sea el servidor ve ni toca nada.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'whatsapp_qr' loop
    execute format('drop policy %I on public.whatsapp_qr', p.policyname);
  end loop;
end $$;

-- Y los permisos también, por si algún día alguien agrega una política de más.
revoke all on public.whatsapp_qr from anon, authenticated;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_lector' and column_name = 'estado')            as columna_estado_de_1,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'whatsapp_qr')                                           as tabla_qr_de_1,
  (select relrowsecurity from pg_class where oid = 'public.whatsapp_qr'::regclass)                          as rls_qr_activo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'whatsapp_qr')              as politicas_qr_de_0,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'whatsapp_qr' and grantee in ('anon', 'authenticated'))  as permisos_qr_de_0;
