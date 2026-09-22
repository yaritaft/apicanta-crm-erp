-- Chat del equipo en la ficha de cada persona — Apicanta ERP
--
-- Lo que el equipo anota sobre una persona (cómo fue la llamada, qué pidió,
-- por qué se atrasó con la cuota) vive en su ficha y lo ve cualquiera que la
-- abra, desde Ventas o desde Servicio. Va por contacto: la conversación sigue
-- a la persona aunque compre dos veces.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.contactos') is null or to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla contactos o ventas.';
  end if;
end $$;

create table if not exists public.comentarios (
  id            text primary key,
  -- La clave de la persona: el id del contacto, o el del lead/alumno si
  -- todavía no tiene contacto. Sin FK a propósito, para no rechazar esos casos.
  "contactoId"  text not null,
  autor         text not null,
  "autorEmail"  text,
  texto         text not null,
  "creadoEn"    timestamptz not null default now()
);

create index if not exists comentarios_contacto_idx on public.comentarios ("contactoId", "creadoEn");

-- Como todas las tablas del ERP: sólo el equipo (puede_entrar) lee y escribe.
alter table public.comentarios enable row level security;
drop policy if exists acceso_equipo_comentarios on public.comentarios;
create policy acceso_equipo_comentarios on public.comentarios
  for all to authenticated
  using (public.puede_entrar())
  with check (public.puede_entrar());

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'comentarios')                     as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.comentarios'::regclass)   as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'comentarios')                        as politicas_de_1;
