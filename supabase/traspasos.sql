-- Movimientos entre cuentas propias — Apicanta ERP
--
-- La plata que pasa de una cuenta a otra (Stripe deposita en Mercury, de
-- Mercury a la Financiera). No es un ingreso ni un gasto: no toca el P&L ni
-- el total de la caja, pero sin registrarla no se puede controlar cada
-- cuenta por separado (lib/traspasos.ts, Finanzas → Caja).
--
-- Se cargan a mano o los detecta la sincronización de las cuentas: Mercury
-- ve llegar los depósitos de las pasarelas y Stripe dice cuándo mandó cada
-- retiro. Cada dato de ésos es una punta: "salidaRef" y "llegadaRef". Con las
-- dos, el pase está conciliado.
--
-- Sin esta tabla la app anda igual: los movimientos quedan en el navegador
-- de quien los carga y la sincronización no guarda los que detecta.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.procesadores') is null or to_regclass('public.gastos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla procesadores o gastos.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

create table if not exists public.traspasos (
  id             text primary key,
  -- Cuándo salió (o cuándo llegó, si sólo se sabe eso).
  fecha          timestamptz not null default now(),
  -- De qué cuenta salió y a cuál llegó (procesadores). Sin FK: una cuenta
  -- que se borra no se lleva la historia.
  "origenId"     text,
  "destinoId"    text,
  -- Lo que salió, en la moneda de la cuenta de origen, y lo que llegó, en la
  -- de destino. En la misma moneda, la diferencia es lo que costó.
  "montoSale"    numeric not null default 0,
  "monedaSale"   text not null default 'USD',
  "montoLlega"   numeric not null default 0,
  "monedaLlega"  text not null default 'USD',
  "fechaLlega"   timestamptz,
  -- confirmado · propuesto (lo detectó la sincronización y hay que mirarlo) · ignorado
  estado         text not null default 'confirmado' check (estado in ('confirmado', 'propuesto', 'ignorado')),
  -- Las dos puntas, como las vio la sincronización: "stripe:po_…", "mercury:…".
  "salidaRef"    text,
  "llegadaRef"   text,
  contraparte    text,
  -- El gasto con lo que costó el pase.
  "gastoId"      text,
  notas          text,
  -- manual · api
  origen         text not null default 'manual',
  por            text,
  "creadoEn"     timestamptz not null default now()
);

create index if not exists traspasos_fecha_idx on public.traspasos (fecha);
create index if not exists traspasos_salida_idx on public.traspasos ("salidaRef") where "salidaRef" is not null;
create index if not exists traspasos_llegada_idx on public.traspasos ("llegadaRef") where "llegadaRef" is not null;

-- Como la caja y los gastos: los ve quien ve Finanzas y los cambia quien
-- edita Finanzas. Las mismas áreas que LEEN y EDITAN en src/lib/permisos.ts.
alter table public.traspasos enable row level security;

drop policy if exists ver_traspasos on public.traspasos;
create policy ver_traspasos on public.traspasos
  for select to authenticated
  using ((select public.nivel_area('finanzas')) >= 1);

drop policy if exists crear_traspasos on public.traspasos;
create policy crear_traspasos on public.traspasos
  for insert to authenticated
  with check ((select public.nivel_area('finanzas')) >= 2);

drop policy if exists editar_traspasos on public.traspasos;
create policy editar_traspasos on public.traspasos
  for update to authenticated
  using ((select public.nivel_area('finanzas')) >= 2)
  with check ((select public.nivel_area('finanzas')) >= 2);

drop policy if exists borrar_traspasos on public.traspasos;
create policy borrar_traspasos on public.traspasos
  for delete to authenticated
  using ((select public.nivel_area('finanzas')) >= 2);

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'traspasos')                    as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.traspasos'::regclass)   as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'traspasos')                        as politicas_de_4;
