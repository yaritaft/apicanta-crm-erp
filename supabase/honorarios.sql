-- Equipo y honorarios — Apicanta ERP
--
-- Pedido de Juanchi: "un lugar para configurar, que solamente lo puedan ver
-- Yari y yo, donde podamos configurar todos los roles del equipo, generar
-- accesos a la aplicación y cuánto es el fijo y el variable y sobre qué se
-- mide", y que la liquidación de cada mes se calcule sola.
--
-- Cuatro cosas:
--   1. Niveles de acceso en `usuarios_permitidos`: 'dueno' ve todo, incluido
--      Equipo y honorarios; 'equipo' ve todo lo demás. `nivel_acceso()` y
--      `es_dueno()` son la única regla: la usan las políticas y la pantalla.
--   2. Los dueños dan y quitan accesos desde la app (antes sólo por SQL), y
--      la base no deja que se quede sin ningún dueño.
--   3. `honorarios` (lo que cobra cada persona) y `liquidaciones` (cada mes):
--      sólo las leen y escriben los dueños. Para el resto del equipo la
--      tabla está vacía, también si la piden por la API.
--   4. `equipo.puesto`: COO, Trafficker, Customer Success Manager.
--
-- Convención de la app: id de texto, columnas en camelCase entre comillas,
-- igual que los campos de types.ts. Sin FK a equipo, como alumnos → ventas:
-- la siembra y el vaciado de la app no tienen que pensar en el orden, y un
-- esquema de alguien que se borró la liquidación lo ignora.
--
-- Idempotente: se puede correr de nuevo sin duplicar ni pisar nada. Hasta que
-- se corra, la app sigue andando y la sección no aparece para nadie.

do $$ begin
  if to_regclass('public.equipo') is null or to_regclass('public.usuarios_permitidos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla equipo o usuarios_permitidos.';
  end if;
end $$;

-- ---------- 1. niveles de acceso ----------

-- 'admin' era el único nivel: todos veían todo. Pasa a llamarse 'equipo',
-- que es lo que ven (todo menos Equipo y honorarios).
update public.usuarios_permitidos set rol = 'equipo' where rol is null or rol not in ('dueno', 'equipo');

-- Los dueños: Yari y Juan Cruz.
update public.usuarios_permitidos set rol = 'dueno'
  where lower(email) in ('yari.taft@gmail.com', 'ceo@tumetamorfosis.com');

alter table public.usuarios_permitidos alter column rol set default 'equipo';
alter table public.usuarios_permitidos drop constraint if exists usuarios_permitidos_rol_ck;
alter table public.usuarios_permitidos add constraint usuarios_permitidos_rol_ck
  check (rol in ('dueno', 'equipo'));

-- El nivel de quien pregunta, o null si no está en la lista. SECURITY
-- DEFINER como puede_entrar(): lee la lista sin depender de sus políticas.
create or replace function public.nivel_acceso()
returns text
language sql stable security definer
set search_path = public
as $$
  select u.rol from public.usuarios_permitidos u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.es_dueno()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.nivel_acceso() = 'dueno', false);
$$;

grant execute on function public.nivel_acceso() to authenticated;
grant execute on function public.es_dueno() to authenticated;

-- ---------- 2. dar y quitar accesos ----------

-- Leer la lista sigue como estaba (leer_lista: cualquiera del equipo).
-- Escribirla, sólo un dueño.
drop policy if exists duenos_agregan_accesos on public.usuarios_permitidos;
create policy duenos_agregan_accesos on public.usuarios_permitidos
  for insert to authenticated with check (public.es_dueno());

drop policy if exists duenos_editan_accesos on public.usuarios_permitidos;
create policy duenos_editan_accesos on public.usuarios_permitidos
  for update to authenticated using (public.es_dueno()) with check (public.es_dueno());

drop policy if exists duenos_quitan_accesos on public.usuarios_permitidos;
create policy duenos_quitan_accesos on public.usuarios_permitidos
  for delete to authenticated using (public.es_dueno());

-- Nunca sin dueño: sin ninguno, nadie podría volver a dar accesos ni ver
-- los honorarios desde la app. SECURITY DEFINER para contar a todos: con
-- las políticas de quien borra, el que se saca a sí mismo ya no vería a
-- nadie y el control fallaría aunque quedara otro dueño.
create or replace function public.siempre_un_dueno()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.usuarios_permitidos where rol = 'dueno') then
    raise exception 'Tiene que quedar al menos un dueño con acceso.';
  end if;
  return null;
end;
$$;

drop trigger if exists siempre_un_dueno on public.usuarios_permitidos;
create trigger siempre_un_dueno
  after update or delete on public.usuarios_permitidos
  for each statement execute function public.siempre_un_dueno();

-- ---------- 3. honorarios y liquidaciones ----------

create table if not exists public.honorarios (
  id                text primary key,
  "miembroId"       text not null,
  -- Los conceptos (fijo, bono, porcentaje, tramo, unidad) con sus datos:
  -- ConceptoPago[] de types.ts.
  conceptos         jsonb not null default '[]'::jsonb,
  "categoriaGasto"  text not null default 'Equipo / Salarios',
  pendiente         text,
  notas             text,
  "actualizadoEn"   timestamptz not null default now(),
  "actualizadoPor"  text
);

create unique index if not exists honorarios_miembro_uidx on public.honorarios ("miembroId");

create table if not exists public.liquidaciones (
  id              text primary key,
  -- El mes, "2026-09": una liquidación por mes.
  periodo         text not null,
  estado          text not null default 'abierta',
  entradas        jsonb not null default '{}'::jsonb,
  extras          jsonb not null default '[]'::jsonb,
  "tipoCambio"    numeric,
  -- Al cerrar, la foto de lo que se paga (ResultadoLiquidacion).
  resultado       jsonb,
  pagos           jsonb not null default '{}'::jsonb,
  "gastoIds"      jsonb not null default '[]'::jsonb,
  "cerradaEn"     timestamptz,
  "cerradaPor"    text,
  "creadoEn"      timestamptz not null default now(),
  "actualizadoEn" timestamptz
);

create unique index if not exists liquidaciones_periodo_uidx on public.liquidaciones (periodo);

alter table public.liquidaciones drop constraint if exists liquidaciones_estado_ck;
alter table public.liquidaciones add constraint liquidaciones_estado_ck
  check (estado in ('abierta', 'cerrada'));
alter table public.liquidaciones drop constraint if exists liquidaciones_periodo_ck;
alter table public.liquidaciones add constraint liquidaciones_periodo_ck
  check (periodo ~ '^\d{4}-\d{2}$');

-- Supabase no activa RLS en una tabla creada por SQL: sin esto la clave
-- pública, que viaja dentro del JavaScript de la app, alcanzaría para leer
-- los sueldos.
alter table public.honorarios enable row level security;
alter table public.liquidaciones enable row level security;

drop policy if exists solo_duenos_honorarios on public.honorarios;
create policy solo_duenos_honorarios on public.honorarios
  for all to authenticated
  using (public.es_dueno()) with check (public.es_dueno());

drop policy if exists solo_duenos_liquidaciones on public.liquidaciones;
create policy solo_duenos_liquidaciones on public.liquidaciones
  for all to authenticated
  using (public.es_dueno()) with check (public.es_dueno());

-- ---------- 4. el puesto de cada uno ----------

alter table public.equipo add column if not exists puesto text;

-- ---------- diagnóstico ----------
select
  (select count(*) from public.usuarios_permitidos where rol = 'dueno')                 as duenos,
  (select string_agg(email, ', ' order by email) from public.usuarios_permitidos
    where rol = 'dueno')                                                                 as quienes,
  (select relrowsecurity from pg_class where oid = 'public.honorarios'::regclass)       as rls_honorarios,
  (select relrowsecurity from pg_class where oid = 'public.liquidaciones'::regclass)    as rls_liquidaciones,
  (select count(*) from pg_policies where schemaname = 'public'
    and tablename in ('honorarios', 'liquidaciones'))                                    as politicas_de_2,
  (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'equipo' and column_name = 'puesto')                                as columna_puesto_de_1;
