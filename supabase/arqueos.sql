-- Arqueo de caja — Apicanta ERP
--
-- "¿Cuánta plata tenés en Trust?": cada tanto se cuenta lo que hay de verdad
-- en cada cuenta (las que tienen API y las que no: Trust, la Financiera, el
-- efectivo) y la app lo compara con lo que esperaba (lib/caja.ts). Si no da,
-- falta cargar un gasto o una venta. Los saldos van en jsonb, una entrada
-- por cuenta recaudadora.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.procesadores') is null or to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla procesadores o gastos.';
  end if;
end $$;

create table if not exists public.arqueos (
  id            text primary key,
  fecha         timestamptz not null default now(),
  -- [{ procesadorId, monto, moneda, montoBase, nota }]
  saldos        jsonb not null default '[]'::jsonb,
  "tipoCambio"  numeric,
  total         numeric not null default 0,
  esperado      numeric,
  diferencia    numeric,
  notas         text,
  por           text,
  "creadoEn"    timestamptz not null default now()
);

create index if not exists arqueos_fecha_idx on public.arqueos (fecha);

-- Como todas las tablas del ERP: sólo el equipo (puede_entrar) lee y escribe.
alter table public.arqueos enable row level security;
drop policy if exists acceso_equipo_arqueos on public.arqueos;
create policy acceso_equipo_arqueos on public.arqueos
  for all to authenticated
  using (public.puede_entrar())
  with check (public.puede_entrar());

-- Realtime: un arqueo cargado desde otra pestaña aparece solo.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'arqueos') then
    alter publication supabase_realtime add table public.arqueos;
  end if;
end $$;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'arqueos')                      as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.arqueos'::regclass)    as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'arqueos')                         as politicas_de_1;
