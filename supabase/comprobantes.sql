-- Comprobantes de pago — Apicanta ERP
--
-- Un pago que NO se concilió contra una pasarela necesita su prueba: la
-- captura de la transferencia, el PDF del recibo. El archivo va a un bucket
-- PRIVADO de Supabase Storage y en el pago queda sólo la ruta (columna
-- `comprobante`, jsonb: ruta, nombre, tipo, tamanio, subidoEn).
--
-- Quién puede ver, subir o borrar: el mismo `puede_entrar()` que usan las
-- políticas de las tablas. Nadie de afuera puede leer un comprobante: para
-- verlo, la app pide una URL firmada que vence en 5 minutos.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.pagos') is null or to_regclass('public.cuotas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla pagos o cuotas.';
  end if;
end $$;

-- ---------- el pago ----------
alter table public.pagos add column if not exists comprobante jsonb;

-- ---------- el bucket ----------
-- Privado, 10 MB por archivo, sólo imágenes y PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes', 'comprobantes', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- quién toca los archivos ----------
-- Sin política de UPDATE a propósito: un comprobante no se reemplaza, se
-- sube otro. Borrar sólo pasa cuando alguien saca el archivo antes de
-- guardar el pago (para no dejar huérfanos).
drop policy if exists comprobantes_ver    on storage.objects;
drop policy if exists comprobantes_subir  on storage.objects;
drop policy if exists comprobantes_borrar on storage.objects;

create policy comprobantes_ver on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes' and public.puede_entrar());

create policy comprobantes_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.puede_entrar());

create policy comprobantes_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes' and public.puede_entrar());

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'pagos' and column_name = 'comprobante') as columna_comprobante_de_1,
  (select public from storage.buckets where id = 'comprobantes')                           as bucket_publico_debe_ser_false,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'comprobantes\_%') as politicas_de_3;
