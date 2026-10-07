-- Gastos fijos de todos los meses, con aprobación — Apicanta ERP
--
-- La plantilla de lo que se paga todos los meses (Fathom, EverWebinar, el
-- resto del software): concepto, categoría, monto habitual, día del mes y de
-- qué cuenta sale. Cada mes la app los propone con el monto del mes anterior
-- en Finanzas → Gastos fijos y alguien los aprueba (carga el gasto), los
-- corrige o los saltea. Nada se carga sin aprobación (lib/gastos-recurrentes.ts).
--
-- Los gastos aprobados son gastos comunes (tabla gastos): llevan en `extra`
-- recurrenteId y recurrenteMes para saber de qué plantilla y de qué mes son.
-- No hace falta ninguna columna nueva en gastos.
--
-- Sin esta tabla la app anda igual: las plantillas quedan en el navegador de
-- quien las arma y el aviso del menú sigue funcionando en ese navegador.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla gastos.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

create table if not exists public.gastos_recurrentes (
  id           text primary key,
  concepto     text not null,
  categoria    text not null,
  -- directo · operativo · dueno · retiro (el mismo `grupo` que gastos)
  grupo        text not null default 'operativo',
  proveedor    text,
  -- Lo habitual, en la moneda base. Al aprobar un mes con otro monto, pasa a ser ése.
  monto        numeric not null default 0,
  moneda       text not null default 'USD',
  -- Qué día del mes se paga (1 a 28).
  "diaDelMes"  integer not null default 1 check ("diaDelMes" between 1 and 31),
  -- De qué cuenta recaudadora sale, si se sabe (procesadores). Sin FK a propósito.
  "cuentaId"   text,
  "webinarId"  text,
  notas        text,
  activo       boolean not null default true,
  -- El primer mes ("2026-10") para el que se propone.
  desde        text not null,
  -- Los meses que se decidió saltear (["2026-10", …]).
  salteados    jsonb not null default '[]'::jsonb,
  "creadoEn"   timestamptz not null default now()
);

-- Como los gastos: los ve quien ve Finanzas y los cambia quien edita Finanzas
-- (las mismas áreas que LEEN y EDITAN en src/lib/permisos.ts).
alter table public.gastos_recurrentes enable row level security;

drop policy if exists ver_gastos_recurrentes on public.gastos_recurrentes;
create policy ver_gastos_recurrentes on public.gastos_recurrentes
  for select to authenticated
  using ((select public.nivel_area('finanzas')) >= 1);

drop policy if exists crear_gastos_recurrentes on public.gastos_recurrentes;
create policy crear_gastos_recurrentes on public.gastos_recurrentes
  for insert to authenticated
  with check ((select public.nivel_area('finanzas')) >= 2);

drop policy if exists editar_gastos_recurrentes on public.gastos_recurrentes;
create policy editar_gastos_recurrentes on public.gastos_recurrentes
  for update to authenticated
  using ((select public.nivel_area('finanzas')) >= 2)
  with check ((select public.nivel_area('finanzas')) >= 2);

drop policy if exists borrar_gastos_recurrentes on public.gastos_recurrentes;
create policy borrar_gastos_recurrentes on public.gastos_recurrentes
  for delete to authenticated
  using ((select public.nivel_area('finanzas')) >= 2);

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'gastos_recurrentes')                    as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.gastos_recurrentes'::regclass)   as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'gastos_recurrentes')                        as politicas_de_4;
