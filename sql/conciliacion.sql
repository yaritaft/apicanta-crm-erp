-- ============================================================
-- Conciliación de cobros — Apicanta ERP
--
-- Corré esto una vez en el SQL Editor del proyecto de Supabase
-- (ddysbsybfoeiwcrmetyt). Hasta que exista la tabla, la app sigue
-- andando: los cobros de pasarela viven sólo en el navegador y la
-- carga de la nube saltea la tabla que falta.
--
-- Las columnas se llaman igual que los campos de types.ts (camelCase
-- entre comillas) para que no haga falta ninguna capa de mapeo.
-- Las fechas van como texto ISO, que es exactamente lo que escribe
-- la app: así nada se reformatea ni se corre de huso al volver.
-- ============================================================

create table if not exists public.movimientos (
  id              text primary key,
  proveedor       text not null,
  "procesadorId"  text,
  referencia      text not null,
  monto           numeric not null,
  moneda          text not null default 'USD',
  fee             numeric not null default 0,
  neto            numeric not null default 0,
  fecha           text not null,
  "clienteNombre" text,
  "clienteEmail"  text,
  descripcion     text,
  estado          text not null default 'pendiente',
  "pagoId"        text,
  "cuotaId"       text,
  "ventaId"       text,
  "conciliadoEn"  text,
  "conciliadoPor" text,
  origen          text not null default 'manual',
  "creadoEn"      text not null
);

-- El mismo cobro importado dos veces tiene que seguir siendo uno solo.
-- El front ya deduplica; esto lo garantiza aunque entren de dos lados
-- a la vez (un CSV y la sincronización automática).
create unique index if not exists movimientos_referencia_unica
  on public.movimientos (proveedor, referencia);

create index if not exists movimientos_pendientes
  on public.movimientos (estado, fecha desc);

-- Un pago puede haber nacido de un cobro de pasarela.
alter table public.pagos add column if not exists "movimientoId" text;

-- Contra qué pasarela se concilia cada procesador.
alter table public.procesadores add column if not exists proveedor text;

update public.procesadores set proveedor = 'stripe'      where id = 'proc_stripe'      and proveedor is null;
update public.procesadores set proveedor = 'paypal'      where id = 'proc_paypal'      and proveedor is null;
update public.procesadores set proveedor = 'hotmart'     where id = 'proc_hotmart'     and proveedor is null;
update public.procesadores set proveedor = 'mercadopago' where id = 'proc_mercadopago' and proveedor is null;

insert into public.procesadores (id, nombre, "feeRate", activo, automatico, proveedor)
values ('proc_whop', 'Whop', 0.03, true, true, 'whop')
on conflict (id) do nothing;

-- Misma política que el resto de las tablas: entra el equipo y nadie más.
alter table public.movimientos enable row level security;

drop policy if exists acceso_equipo_movimientos on public.movimientos;
create policy acceso_equipo_movimientos on public.movimientos
  for all
  using (public.puede_entrar())
  with check (public.puede_entrar());
