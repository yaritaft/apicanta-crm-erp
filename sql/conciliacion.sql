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

-- ------------------------------------------------------------
-- Primero, que la base sea la correcta.
-- Esto tiene que correrse en el proyecto **apicanta-erp**
-- (ref ddysbsybfoeiwcrmetyt), que es el que tiene ventas, cuotas,
-- pagos y procesadores. Si estás en otro, corta acá y no deja nada
-- a medio hacer.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.pagos') is null or to_regclass('public.procesadores') is null then
    raise exception
      'Base equivocada: acá no existen public.pagos / public.procesadores. Abrí el proyecto apicanta-erp (ref ddysbsybfoeiwcrmetyt) y corré esto en su SQL Editor.';
  end if;
end $$;

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

-- ------------------------------------------------------------
-- Los 13 medios de pago reales del negocio.
-- `automatico` = el cobro puede entrar solo (webhook o consulta).
-- Los que no están en esta lista se desactivan, no se borran: si un
-- pago viejo apunta a uno, tiene que seguir sabiendo cómo se llamaba.
-- Los feeRate son los de referencia; se corrigen solos en cada cobro
-- conciliado, porque ahí se guarda el fee real de la plataforma.
-- ------------------------------------------------------------
insert into public.procesadores (id, nombre, "feeRate", activo, automatico, proveedor) values
  ('proc_stripe',         'Stripe',                0.029, true, true,  'stripe'),
  ('proc_hotmart',        'Hotmart',               0.099, true, true,  'hotmart'),
  ('proc_whop',           'Whop',                  0.030, true, true,  'whop'),
  ('proc_dlocal',         'dLocal',                0.050, true, true,  'dlocal'),
  ('proc_mercadopago',    'Mercado Pago (Yari)',   0.062, true, true,  'mercadopago'),
  ('proc_mercury',        'ACH / Wire (Mercury)',  0,     true, true,  'mercury'),
  ('proc_binance',        'USDT (Binance)',        0,     true, true,  'binance'),
  ('proc_trust',          'USDT (Trust)',          0,     true, true,  'trust'),
  ('proc_financiera_usd', 'Financiera USD (Juan)', 0,     true, false, null),
  ('proc_financiera_ars', 'Financiera ARS (Juan)', 0,     true, false, null),
  ('proc_galicia_usd',    'Galicia (USD)',         0,     true, false, null),
  ('proc_galicia_ars',    'Galicia (ARS)',         0,     true, false, null),
  ('proc_efectivo',       'Efectivo USD',          0,     true, false, null)
on conflict (id) do update set
  nombre      = excluded.nombre,
  activo      = true,
  automatico  = excluded.automatico,
  proveedor   = excluded.proveedor;

-- Los que ya no se usan salen de las listas pero no se borran.
update public.procesadores
   set activo = false
 where id not in (
   'proc_stripe','proc_hotmart','proc_whop','proc_dlocal','proc_mercadopago',
   'proc_mercury','proc_binance','proc_trust','proc_financiera_usd',
   'proc_financiera_ars','proc_galicia_usd','proc_galicia_ars','proc_efectivo'
 );

-- Misma política que el resto de las tablas: entra el equipo y nadie más.
alter table public.movimientos enable row level security;

drop policy if exists acceso_equipo_movimientos on public.movimientos;
create policy acceso_equipo_movimientos on public.movimientos
  for all
  using (public.puede_entrar())
  with check (public.puede_entrar());
