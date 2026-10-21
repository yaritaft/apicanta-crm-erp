-- Archivos, notas de voz, hilos y reacciones en el chat del equipo de la ficha — Apicanta ERP (20/10/2026)
--
-- Como en Blue OS: en el chat de la ficha de una persona se puede mandar una foto, un video, una nota de voz o
-- cualquier archivo, además del texto. Cada mensaje guarda sus archivos en la columna `adjuntos` (jsonb: id, tipo,
-- nombre, mime, bytes, ruta, duracion, picos, ancho, alto, notaDeVoz) y los archivos van a un bucket PRIVADO
-- (`chat-equipo`): para verlos, la app pide una URL firmada que vence en una hora.
--
-- Quién puede ver, subir o borrar: el mismo `puede_entrar()` de todas las tablas.
-- Idempotente: se puede correr de nuevo sin romper nada.
-- Hay que correrlo antes de publicar el chat nuevo: sin las columnas, guardar un mensaje con archivos o en hilo falla.
-- CORRIDO en producción el 20/10/2026 (ensayado antes con vuelta atrás): columnas 1 + 1, bucket privado, 3 políticas.
-- Vuelto a correr el mismo día para sumar `reacciones` (es idempotente: lo de antes queda igual).
-- Y otra vez (20/10, ensayado antes con vuelta atrás) para la cita («Responder» de WhatsApp: `citaA`), los tildes
-- (`chat_lecturas`, RLS + 4 políticas) y el chat en vivo (Realtime): diagnóstico 1 / true / 4 / 2.

do $$ begin
  if to_regclass('public.comentarios') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla comentarios (supabase/comentarios.sql).';
  end if;
end $$;

-- ---------- el mensaje ----------
alter table public.comentarios add column if not exists adjuntos jsonb;
-- Las respuestas en hilo: el id del mensaje al que responde (sin FK, para que borrar uno no rompa nada).
alter table public.comentarios add column if not exists "respondeA" text;
create index if not exists comentarios_responde_idx on public.comentarios ("respondeA") where "respondeA" is not null;
-- Las reacciones con emoji (una por persona y emoji): [{ emoji, quien, email }].
alter table public.comentarios add column if not exists reacciones jsonb;
-- La cita («Responder» como en WhatsApp): el id del mensaje citado (sin FK: si lo borran, se dice «Mensaje borrado»).
alter table public.comentarios add column if not exists "citaA" text;

-- ---------- los tildes: hasta dónde le llegó y leyó cada uno el chat de cada ficha ----------
-- Una fila por persona y ficha (id = "<contactoId>:<mail>"): la fecha del último mensaje de otro que le llegó a su app
-- y la del último que leyó (abrió el chat). Con eso la app pinta 🕓 / ✓ / ✓✓ / ✓✓ azul (lib/chat-equipo.ts).
create table if not exists public.chat_lecturas (
  id               text primary key,
  "contactoId"     text not null,
  quien            text not null,
  nombre           text not null default '',
  "recibidoHasta"  timestamptz,
  "leidoHasta"     timestamptz
);
create index if not exists chat_lecturas_contacto_idx on public.chat_lecturas ("contactoId");
alter table public.chat_lecturas enable row level security;

-- Ve las lecturas de una ficha quien ve su chat (el mismo alcance que los comentarios, «sólo lo suyo» incluido).
-- Escribe SÓLO la suya (quien = su mail): nadie puede marcar como leído por otro.
drop policy if exists ver_chat_lecturas    on public.chat_lecturas;
drop policy if exists crear_chat_lecturas  on public.chat_lecturas;
drop policy if exists editar_chat_lecturas on public.chat_lecturas;
drop policy if exists borrar_chat_lecturas on public.chat_lecturas;

create policy ver_chat_lecturas on public.chat_lecturas
  for select to authenticated
  using ((select public.ve('comentarios')) and ((select not public.solo_lo_suyo()) or "contactoId" = any ((select public.mis_contactos())::text[])));

create policy crear_chat_lecturas on public.chat_lecturas
  for insert to authenticated
  with check (quien = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (select public.ve('comentarios')) and ((select not public.solo_lo_suyo()) or "contactoId" = any ((select public.mis_contactos())::text[])));

create policy editar_chat_lecturas on public.chat_lecturas
  for update to authenticated
  using (quien = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (quien = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (select public.ve('comentarios')) and ((select not public.solo_lo_suyo()) or "contactoId" = any ((select public.mis_contactos())::text[])));

-- Los dueños pueden vaciar la base (Ajustes → volver a la demo); nadie más borra lecturas.
create policy borrar_chat_lecturas on public.chat_lecturas
  for delete to authenticated
  using ((select public.es_dueno()));

-- ---------- el chat en vivo ----------
-- Lo que escribe otro (y sus reacciones, y hasta dónde leyó) llega solo, sin recargar. Realtime respeta las políticas de arriba.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'comentarios') then
      alter publication supabase_realtime add table public.comentarios;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_lecturas') then
      alter publication supabase_realtime add table public.chat_lecturas;
    end if;
  end if;
end $$;

-- ---------- el bucket ----------
-- Privado, hasta 50 MB por archivo y de cualquier tipo (un PDF, un .zip, una captura, un audio).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-equipo', 'chat-equipo', false, 52428800, null)
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- quién toca los archivos ----------
-- Sin UPDATE: un archivo no se reemplaza, se manda otro. Borrar pasa cuando alguien saca un adjunto antes de enviar.
drop policy if exists chat_equipo_ver    on storage.objects;
drop policy if exists chat_equipo_subir  on storage.objects;
drop policy if exists chat_equipo_borrar on storage.objects;

create policy chat_equipo_ver on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-equipo' and public.puede_entrar());

create policy chat_equipo_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-equipo' and public.puede_entrar());

create policy chat_equipo_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-equipo' and public.puede_entrar());

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'comentarios' and column_name = 'adjuntos') as columna_adjuntos_de_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'comentarios' and column_name = 'respondeA') as columna_responde_de_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'comentarios' and column_name = 'reacciones') as columna_reacciones_de_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'comentarios' and column_name = 'citaA') as columna_cita_de_1,
  (select relrowsecurity from pg_class where oid = 'public.chat_lecturas'::regclass)          as lecturas_rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'chat_lecturas')                               as lecturas_politicas_de_4,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename in ('comentarios', 'chat_lecturas'))     as en_vivo_de_2,
  (select public from storage.buckets where id = 'chat-equipo')                               as bucket_publico_debe_ser_false,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'chat\_equipo\_%') as politicas_de_3;
