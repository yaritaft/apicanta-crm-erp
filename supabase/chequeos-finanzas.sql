-- Lo que se tilda en los pasos de Finanzas — Apicanta ERP
--
-- Finanzas se organiza en pasos por día, por semana y por mes (la lista de
-- tareas de Aldana). Algunos pasos se calculan solos con lo que ya está
-- cargado; otros pasan fuera de la app (asistir a la weekly, revisar Slack,
-- la auditoría de softwares) y alguien los tilda. Esta tabla guarda quién los
-- tildó y cuándo, para que lo vea todo el equipo.
--
-- La clave es «<cadencia>|<período>|<paso>»: mes|2026-10|m-software (los pasos
-- del mes que se tildan) o eod|2026-10-16|d-slack (el cierre del día). Una fila
-- por tilde; destildar es borrar la fila.
--
-- Sin esta tabla la app anda igual: lo que se tilda queda en el navegador de
-- quien lo hace (lib/chequeos-finanzas.ts).
--
-- Aditivo e idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.procesadores') is null or to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla procesadores o gastos.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

create table if not exists public.chequeos_finanzas (
  clave  text primary key,
  por    text,
  en     timestamptz not null default now(),
  nota   text,
  estado text
);

-- El cierre del día de Finanzas (el EOD de Aldana) guarda acá cada respuesta:
--   eod|2026-10-16|d-slack     estado = hecho · no-llegue · no-hacia-falta, con su nota
--   eod|2026-10-16|_cierre     el día cerrado (quién y cuándo), con la nota del día
alter table public.chequeos_finanzas add column if not exists estado text;

create index if not exists chequeos_finanzas_en_idx on public.chequeos_finanzas (en);

-- Como la caja y los gastos: los ve quien ve Finanzas y los cambia quien edita Finanzas.
alter table public.chequeos_finanzas enable row level security;

drop policy if exists ver_chequeos_finanzas on public.chequeos_finanzas;
create policy ver_chequeos_finanzas on public.chequeos_finanzas
  for select to authenticated
  using ((select public.nivel_area('finanzas')) >= 1);

drop policy if exists crear_chequeos_finanzas on public.chequeos_finanzas;
create policy crear_chequeos_finanzas on public.chequeos_finanzas
  for insert to authenticated
  with check ((select public.nivel_area('finanzas')) >= 2);

drop policy if exists editar_chequeos_finanzas on public.chequeos_finanzas;
create policy editar_chequeos_finanzas on public.chequeos_finanzas
  for update to authenticated
  using ((select public.nivel_area('finanzas')) >= 2)
  with check ((select public.nivel_area('finanzas')) >= 2);

drop policy if exists borrar_chequeos_finanzas on public.chequeos_finanzas;
create policy borrar_chequeos_finanzas on public.chequeos_finanzas
  for delete to authenticated
  using ((select public.nivel_area('finanzas')) >= 2);

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'chequeos_finanzas')                    as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.chequeos_finanzas'::regclass)   as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'chequeos_finanzas')                        as politicas_de_4;
