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
  (select public from storage.buckets where id = 'chat-equipo')                               as bucket_publico_debe_ser_false,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'chat\_equipo\_%') as politicas_de_3;
