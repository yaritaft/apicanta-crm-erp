-- Capturas de la pre-call en cada llamada — Apicanta ERP (Santi, 26/10/2026)
--
-- «Estaría bueno poner en cada call un apartado para poner captura de pantalla de la pre-call, por ejemplo para
-- que el setter cargue el chat y le asignemos comisión, o para que los que cancelan tengamos de pruebas que el
-- closer efectivamente le escribió.»
--
--   1. `precall_capturas`: una fila por imagen, atada a la llamada (sesiones). Quién la subió y cuándo.
--   2. Bucket PRIVADO `precall` de Supabase Storage (8 MB, sólo imágenes): la ruta es <id de la llamada>/<archivo>.
--      Para verlas, la app pide una URL firmada que vence en 5 minutos.
--   3. Quién ve, sube y borra, con la misma función para la tabla y para los archivos (`precall_puede`):
--        · ve: quien ve las llamadas; el closer sólo las de sus llamadas (y el setter las que marcó suyas).
--        · sube: quien edita las llamadas (el closer, las suyas) y un setter activo, en una agenda suya o sin marcar.
--        · borra: quien la subió, un dueño o el director (un setter no borra lo que subió el closer, ni al revés).
--      Sin política de UPDATE: una captura no se reemplaza, se sube otra.
--
-- Hace falta haber corrido tipos-cuenta.sql y setter-marca-agendas.sql. Se puede volver a correr.
-- Para deshacerlo:
--   drop table if exists public.precall_capturas;  drop function if exists public.precall_puede(text, boolean);
--   (y los archivos del bucket `precall`, desde Storage)

do $$ begin
  if to_regclass('public.sesiones') is null or to_regclass('public.equipo') is null
     or to_regprocedure('public.mis_sesiones()') is null or to_regprocedure('public.mi_miembro_id()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: esta no es la base del ERP o está sin la fase de permisos.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sesiones' and column_name = 'setterId') then
    raise exception 'Primero hay que correr setter-marca-agendas.sql (falta sesiones."setterId").';
  end if;
end $$;

-- ---------- quién puede tocar las capturas de una llamada ----------

create or replace function public.precall_puede(p_sesion text, p_escribir boolean)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    public.ve('sesiones')
    and (
      not public.solo_lo_suyo()
      or p_sesion = any((select public.mis_sesiones())::text[])
      or exists (select 1 from public.sesiones s
                  where s.id = p_sesion and s."setterId" is not null and s."setterId" = public.mi_miembro_id())
    )
    and (
      not p_escribir
      or public.edita('sesiones')
      or exists (select 1 from public.equipo e, public.sesiones s
                  where e.id = public.mi_miembro_id() and e.rol = 'setter' and coalesce(e.activo, true)
                    and s.id = p_sesion and (s."setterId" is null or s."setterId" = e.id))
    ), false);
$$;
revoke all on function public.precall_puede(text, boolean) from public, anon;
grant execute on function public.precall_puede(text, boolean) to authenticated;

/* Quien puede borrar lo que subió otro: dueños, el director y quien tiene todo menos honorarios. */
create or replace function public.precall_modera()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select u.rol in ('dueno', 'director', 'equipo') from public.usuarios_permitidos u
                    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1), false);
$$;
revoke all on function public.precall_modera() from public, anon;
grant execute on function public.precall_modera() to authenticated;

-- ---------- la tabla ----------

create table if not exists public.precall_capturas (
  id                text primary key,
  "sesionId"        text not null references public.sesiones(id) on delete cascade,
  ruta              text not null unique,
  nombre            text not null default '',
  tipo              text not null default '',
  tamanio           integer not null default 0,
  nota              text,
  "subidoPor"       text,
  "subidoPorEmail"  text,
  "subidoEn"        timestamptz not null default now()
);

create index if not exists precall_capturas_sesion_idx on public.precall_capturas ("sesionId", "subidoEn");

alter table public.precall_capturas enable row level security;

drop policy if exists precall_ver    on public.precall_capturas;
drop policy if exists precall_subir  on public.precall_capturas;
drop policy if exists precall_borrar on public.precall_capturas;

create policy precall_ver on public.precall_capturas for select to authenticated
  using ((select public.precall_puede("sesionId", false)));

create policy precall_subir on public.precall_capturas for insert to authenticated
  with check ((select public.precall_puede("sesionId", true)));

create policy precall_borrar on public.precall_capturas for delete to authenticated
  using ((select public.precall_puede("sesionId", true))
    and ("subidoPorEmail" = lower(coalesce(auth.jwt() ->> 'email', '')) or (select public.precall_modera())));

-- ---------- el bucket ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('precall', 'precall', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists precall_archivos_ver    on storage.objects;
drop policy if exists precall_archivos_subir  on storage.objects;
drop policy if exists precall_archivos_borrar on storage.objects;

create policy precall_archivos_ver on storage.objects for select to authenticated
  using (bucket_id = 'precall' and public.precall_puede((storage.foldername(name))[1], false));

create policy precall_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'precall' and public.precall_puede((storage.foldername(name))[1], true));

create policy precall_archivos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'precall' and public.precall_puede((storage.foldername(name))[1], true)
    and (owner_id = (select auth.uid())::text or public.precall_modera()));

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'precall_capturas') as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.precall_capturas'::regclass)                               as rls,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'precall_capturas')                   as politicas_de_3,
  (select public from storage.buckets where id = 'precall')                                                           as bucket_publico_debe_ser_false,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'precall\_archivos\_%') as politicas_de_archivos_3;
