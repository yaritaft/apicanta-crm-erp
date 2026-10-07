-- Devoluciones — Apicanta ERP (reunión del 02/10: «que den los números»)
--
-- Yari: «si me meto al CRM y pongo devolución, ¿se refleja en finanzas?».
-- Hoy no: la devolución era un gasto suelto que no se ataba a la venta, no
-- bajaba el Cash Collected ni la cuenta de la caja y no tocaba la comisión del
-- closer. Desde acá es una transacción aparte (lib/devoluciones.ts):
--
--   · la venta sigue contando en su mes y lo cobrado, en el mes en que entró;
--   · la devolución resta en el mes en que se devuelve la plata: Cash
--     Collected, estado de resultados y la caja de la cuenta de la que salió;
--   · la comisión de la pasarela no se toca (Stripe se la queda igual);
--   · al closer y al director se les revierte exactamente lo que se les
--     comisionó, como una línea negativa de la liquidación del mes de la
--     devolución (con «no descontar al closer», no se revierte nada).
--
-- Qué agrega este archivo:
--
--   1. La tabla `devoluciones` (venta, monto, medio por el que salió la plata,
--      fecha, comprobante, «no descontar al closer», y lo que informa la
--      pasarela para atarla a su reembolso) con sus políticas de RLS.
--
--      Quién la VE: quien ve las ventas (Ventas, Finanzas, Webinars, Marketing,
--      Alumnos o Clientes), porque sin ella los números de cada área no darían igual;
--      el closer, sólo las de sus ventas.
--      Quién la CARGA, corrige y borra: Finanzas editable (el asistente de
--      finanzas) o Ventas editable SIN «sólo lo suyo» (el director comercial).
--      El closer sólo la ve (decisión D6 de la reunión). Es la misma regla de
--      src/lib/permisos.ts: puedeCargarDevolucion().
--
--   2. Un freno en `ventas`: quien ve sólo lo suyo (el closer) no puede
--      cancelar una venta, marcarla como reembolsada ni reactivarla. Hasta
--      ahora cualquier tipo de cuenta que editaba Ventas podía, y cancelar
--      saca la venta de las comisiones de todos los meses. Una devolución se
--      carga con su comprobante; una venta no se «reembolsa» a mano.
--      (Es un trigger y no una política para no tocar las de tipos-cuenta.sql:
--      sólo mira el cambio de `estado`; editar el resto de la venta sigue
--      igual.)
--
-- Sin esta tabla la app anda igual: las devoluciones que se carguen quedan
-- sólo en el navegador de quien las carga y la app lo avisa al cargarlas.
-- Antes hay que haber corrido tipos-cuenta.sql (necesita nivel_area(),
-- solo_lo_suyo() y mis_ventas()).
--
-- Hacerle un ensayo de RLS (en una transacción, con ROLLBACK) antes de
-- correrlo de verdad: toca permisos.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.ventas') is null or to_regclass('public.procesadores') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla ventas o procesadores.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null
     or to_regprocedure('public.solo_lo_suyo()') is null
     or to_regprocedure('public.mis_ventas()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area(), solo_lo_suyo() o mis_ventas().';
  end if;
end $$;

-- ---------- 1. la tabla ----------

create table if not exists public.devoluciones (
  id                    text primary key,
  -- La venta que se devuelve. Sin FK a propósito (como traspasos): una venta
  -- que se borra no se lleva la historia de la plata que salió. Sólo una
  -- propuesta de la pasarela puede no saber todavía de qué venta es.
  "ventaId"             text,
  -- Lo devuelto, en la moneda base (la de los cobros).
  monto                 numeric not null default 0,
  moneda                text not null default 'USD',
  -- El día que se devolvió la plata: ahí resta Finanzas.
  fecha                 timestamptz not null default now(),
  -- Por qué cuenta salió (procesadores): el mismo medio con el que se pagó.
  "procesadorId"        text,
  -- Si salió de una cuenta en pesos: lo que fue en ARS y a qué cambio.
  "montoArs"            numeric,
  "tipoCambio"          numeric,
  -- La prueba (ruta en el bucket privado «comprobantes», nombre, tipo, tamaño).
  comprobante           jsonb,
  -- «No descontar al closer»: se devuelve por decisión de la empresa y el
  -- closer cobra igual. Por defecto se descuenta.
  "noDescontarAlCloser" boolean not null default false,
  -- confirmada: cuenta en Finanzas · propuesta: la detectó una pasarela y
  -- falta que alguien la confirme (no cuenta) · ignorada: no es una devolución.
  estado                text not null default 'confirmada' check (estado in ('confirmada', 'propuesta', 'ignorada')),
  motivo                text,
  notas                 text,
  -- La llamada que quedó en «Devolución».
  "sesionId"            text,
  -- Lo que informa la pasarela ("stripe:re_3Q…"): con esto está atada a lo que
  -- vio Stripe, Hotmart o Whop y la misma no entra dos veces.
  referencia            text,
  proveedor             text,
  "conciliadaEn"        timestamptz,
  "cargadaPor"          text,
  "creadoEn"            timestamptz not null default now(),
  extra                 jsonb not null default '{}'::jsonb
);

create index if not exists devoluciones_venta_idx on public.devoluciones ("ventaId");
create index if not exists devoluciones_fecha_idx on public.devoluciones (fecha);
create index if not exists devoluciones_referencia_idx on public.devoluciones (referencia) where referencia is not null;

alter table public.devoluciones enable row level security;

-- Ver: quien ve las ventas (las mismas áreas que LEEN ventas, cuotas y pagos, con
-- Clientes de Customer Success incluido);
-- quien ve sólo lo suyo (el closer), las de sus ventas.
drop policy if exists ver_devoluciones on public.devoluciones;
create policy ver_devoluciones on public.devoluciones
  for select to authenticated
  using (
    ((select public.nivel_area('ventas')) >= 1
      or (select public.nivel_area('finanzas')) >= 1
      or (select public.nivel_area('webinars')) >= 1
      or (select public.nivel_area('marketing')) >= 1
      or (select public.nivel_area('alumnos')) >= 1
      or (select public.nivel_area('clientes')) >= 1)
    and ((select not public.solo_lo_suyo()) or "ventaId" = any((select public.mis_ventas())::text[]))
  );

-- Cargar, corregir y borrar: Finanzas editable, o Ventas editable sin «sólo lo suyo».
drop policy if exists crear_devoluciones on public.devoluciones;
create policy crear_devoluciones on public.devoluciones
  for insert to authenticated
  with check (
    (select public.nivel_area('finanzas')) >= 2
    or ((select public.nivel_area('ventas')) >= 2 and (select not public.solo_lo_suyo()))
  );

drop policy if exists editar_devoluciones on public.devoluciones;
create policy editar_devoluciones on public.devoluciones
  for update to authenticated
  using (
    (select public.nivel_area('finanzas')) >= 2
    or ((select public.nivel_area('ventas')) >= 2 and (select not public.solo_lo_suyo()))
  )
  with check (
    (select public.nivel_area('finanzas')) >= 2
    or ((select public.nivel_area('ventas')) >= 2 and (select not public.solo_lo_suyo()))
  );

drop policy if exists borrar_devoluciones on public.devoluciones;
create policy borrar_devoluciones on public.devoluciones
  for delete to authenticated
  using (
    (select public.nivel_area('finanzas')) >= 2
    or ((select public.nivel_area('ventas')) >= 2 and (select not public.solo_lo_suyo()))
  );

-- ---------- 2. el closer no cancela ni «reembolsa» una venta ----------

create or replace function public.ventas_cambio_de_baja()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado is distinct from old.estado
     and (new.estado in ('cancelada', 'reembolsada') or old.estado in ('cancelada', 'reembolsada'))
     and (select public.solo_lo_suyo()) then
    -- 42501 es el código de RLS: la app lo trata igual que una escritura
    -- rechazada («tu tipo de cuenta no puede…»), sin trabar la cola.
    raise exception 'Tu tipo de cuenta no puede cancelar, devolver ni reactivar una venta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ventas_cambio_de_baja on public.ventas;
create trigger ventas_cambio_de_baja
  before update of estado on public.ventas
  for each row execute function public.ventas_cambio_de_baja();

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'devoluciones')                   as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.devoluciones'::regclass)  as rls_activo,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'devoluciones')                       as politicas_de_4,
  (select count(*) from pg_trigger
    where tgname = 'ventas_cambio_de_baja' and not tgisinternal)                      as freno_en_ventas_de_1;
