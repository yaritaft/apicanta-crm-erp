-- ==================================================================
-- Avisos para cada persona del equipo, como la campanita de Blue OS
-- (Juan Cruz, 23/10: «creemos un sistema de notificaciones como en Blue
-- OS»). El primero: alguien te menciona en el chat de una ficha
-- («@Yari Taft», «@Aldana Ytzcovich»; Lili, 23/10: «etiquetar para que lo
-- vea alguien del equipo»).
--
--   - Una fila por aviso y por persona, con su mail en minúsculas (`para`):
--     cada quien ve y marca leídos sólo los suyos (RLS).
--   - Los crea la BASE, no el navegador: el disparador de `comentarios`
--     busca las menciones a gente del equipo y le escribe a cada uno. Así
--     avisa igual venga el mensaje de donde venga.
--   - A quién: el mail que tiene en Equipo y también la cuenta con su
--     nombre (Yari figura como «Yari» con yari.taft@gmail.com y entra
--     también como «Yari Taft» con yari@apicanta.com).
--   - Borrar el mensaje borra su aviso. Leer el chat de esa ficha lo apaga
--     (lo hace la app: components/avisos).
-- Se puede volver a correr.
-- ==================================================================

create table if not exists public.avisos (
  id text primary key,
  para text not null,
  tipo text not null default 'mencion',
  titulo text not null,
  cuerpo text,
  de text,
  "deEmail" text,
  "contactoId" text,
  persona text,
  "comentarioId" text,
  "leidoEn" timestamptz,
  "creadoEn" timestamptz not null default now()
);
create index if not exists avisos_para_idx on public.avisos (para, "creadoEn" desc);
create unique index if not exists avisos_un_aviso_por_mensaje on public.avisos ("comentarioId", para) where "comentarioId" is not null;

alter table public.avisos enable row level security;
drop policy if exists avisos_ver on public.avisos;
create policy avisos_ver on public.avisos for select to authenticated
  using (para = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists avisos_marcar on public.avisos;
create policy avisos_marcar on public.avisos for update to authenticated
  using (para = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (para = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.avisos from anon, authenticated;
grant select on public.avisos to authenticated;
grant update ("leidoEn") on public.avisos to authenticated;

-- «@Nombre Apellido» en el texto: después del nombre no puede seguir una letra («@Ana» no es «@Anabel»).
create or replace function public.menciona(p_texto text, p_nombre text)
returns boolean
language sql
immutable
as $$
  select length(btrim(coalesce(p_nombre, ''))) >= 2
    and coalesce(p_texto, '') ~* ('(^|\s)@' || regexp_replace(btrim(p_nombre), '([^[:alnum:][:space:]])', '\\\1', 'g')
      || '($|[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ_])')
$$;

create or replace function public.avisar_menciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dest record;
  donde text;
begin
  if coalesce(new.texto, '') not like '%@%' then return new; end if;
  select coalesce(
    (select c.nombre from contactos c where c.id = new."contactoId"),
    (select l.nombre from leads l where l.id = new."contactoId"),
    (select a.nombre from alumnos a where a.id = new."contactoId")
  ) into donde;
  for dest in
    select distinct lower(btrim(m.email)) as email
    from equipo e
    cross join lateral (
      select e.email
      union
      select u.email from usuarios_permitidos u
      where lower(btrim(u.nombre)) = lower(btrim(e.nombre)) or lower(btrim(u.nombre)) like lower(btrim(e.nombre)) || ' %'
    ) m(email)
    where coalesce(e.activo, true) and public.menciona(new.texto, e.nombre) and coalesce(m.email, '') like '%@%'
  loop
    continue when dest.email = lower(coalesce(new."autorEmail", ''));
    insert into avisos (id, para, tipo, titulo, cuerpo, de, "deEmail", "contactoId", persona, "comentarioId")
    values ('avi_' || substr(md5(new.id || ':' || dest.email), 1, 20), dest.email, 'mencion',
      coalesce(nullif(new.autor, ''), 'Alguien') || ' te mencionó', left(new.texto, 400), new.autor, new."autorEmail",
      new."contactoId", donde, new.id)
    on conflict do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function public.avisar_menciones() from public, anon, authenticated;

drop trigger if exists comentarios_avisan_menciones on public.comentarios;
create trigger comentarios_avisan_menciones after insert on public.comentarios
  for each row execute function public.avisar_menciones();

create or replace function public.borrar_avisos_del_mensaje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from avisos where "comentarioId" = old.id;
  return old;
end;
$$;
revoke all on function public.borrar_avisos_del_mensaje() from public, anon, authenticated;

drop trigger if exists comentarios_borran_sus_avisos on public.comentarios;
create trigger comentarios_borran_sus_avisos after delete on public.comentarios
  for each row execute function public.borrar_avisos_del_mensaje();

-- En vivo: la campanita se entera sola (Realtime respeta la RLS: a cada uno le llegan los suyos).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'avisos') then
    alter publication supabase_realtime add table public.avisos;
  end if;
end $$;
