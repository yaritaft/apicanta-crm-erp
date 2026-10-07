-- El cierre del día: la venta atada a su llamada, la primera vez que se cargó cada
-- estado y la puerta del EOD — Apicanta ERP
--
-- Lo que pidió Yari el 02/10 (F2-02): «venta que no se cargó el mismo día, venta
-- que no se comisiona», con el interruptor en Configuración, apagado. Para que eso
-- se pueda calcular sin adivinar hacen falta tres datos:
--
--   ventas."sesionId"           la llamada de la que salió la venta. Antes se inferían
--                               por persona y una ventana de -1/+60 días, y daba falsos
--                               «sin venta». Las ventas de antes quedan sin ese dato: se
--                               siguen mostrando por la ventana, pero no entran en el
--                               descuento (no se puede probar de qué llamada salieron).
--   sesiones."estadoLlamadaEn"  la PRIMERA vez que se cargó el Estado de Llamada, venga de
--   sesiones."estadoPreCallEn"  donde venga (el cierre del día, la tabla del CRM, la Agenda,
--                               la ficha o una venta). Con esa marca se cuentan los strikes.
--   sesiones."ventaPorOtro"     la salida de la puerta del EOD: si el estado es de compra y
--                               la venta no está cargada, el closer avisa que la carga otra
--                               persona; queda {"por": quién, "en": cuándo}.
--
-- La marca de la primera carga la pone la app, pero esta base también la cuida
-- (trigger): pasar el estado de vacío a cargado la escribe con la hora del servidor si
-- no vino, cambiarlo por otro no la toca, y vaciarlo la borra. Así no depende de qué
-- pantalla (ni de qué versión de la app abierta en una pestaña vieja) cargó el estado.
-- Sólo mira UPDATE: restaurar un respaldo (INSERT) no inventa marcas, y el webhook de
-- Calendly, que no toca los estados, no las mueve.
--
-- Sin estas columnas la app anda igual, como antes: descarta esos campos al guardar
-- (store.ts los saca y reintenta). Lo único que no queda guardado es la marca, la
-- salida de la puerta y el id de la llamada de la venta. El interruptor y la fecha de
-- arranque no necesitan nada: viven en ajustes.crm (jsonb, supabase/crm.sql).
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.sesiones') is null or to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla sesiones o ventas.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sesiones' and column_name = 'estadoLlamada'
  ) then
    raise exception 'Primero hay que correr crm.sql: falta sesiones."estadoLlamada".';
  end if;
end $$;

alter table public.ventas   add column if not exists "sesionId"        text;
alter table public.sesiones add column if not exists "estadoLlamadaEn" timestamptz;
alter table public.sesiones add column if not exists "estadoPreCallEn" timestamptz;
alter table public.sesiones add column if not exists "ventaPorOtro"    jsonb;

-- Para encontrar la venta de una llamada (y la llamada de una venta) sin recorrer todo.
create index if not exists ventas_sesion_idx on public.ventas ("sesionId") where "sesionId" is not null;

-- ---------- La marca de la primera carga ----------
create or replace function public.sesiones_marca_primera_carga() returns trigger
language plpgsql as $$
begin
  -- Estado de Llamada
  if coalesce(new."estadoLlamada", '') = '' then
    new."estadoLlamadaEn" := null;                                    -- vaciado: vuelve a estar sin cargar
  elsif coalesce(old."estadoLlamada", '') = '' then
    new."estadoLlamadaEn" := coalesce(new."estadoLlamadaEn", now());  -- de vacío a cargado: la primera vez
  else
    new."estadoLlamadaEn" := coalesce(old."estadoLlamadaEn", new."estadoLlamadaEn");  -- cambiado por otro: no se pisa
  end if;
  -- Estado Pre-Call
  if coalesce(new."estadoPreCall", '') = '' then
    new."estadoPreCallEn" := null;
  elsif coalesce(old."estadoPreCall", '') = '' then
    new."estadoPreCallEn" := coalesce(new."estadoPreCallEn", now());
  else
    new."estadoPreCallEn" := coalesce(old."estadoPreCallEn", new."estadoPreCallEn");
  end if;
  return new;
end $$;

drop trigger if exists sesiones_marca_primera_carga on public.sesiones;
create trigger sesiones_marca_primera_carga
  before update on public.sesiones
  for each row execute function public.sesiones_marca_primera_carga();

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sesiones'
      and column_name in ('estadoLlamadaEn', 'estadoPreCallEn', 'ventaPorOtro')) as columnas_de_sesiones_de_3,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ventas' and column_name = 'sesionId') as columna_de_ventas_de_1,
  (select count(*) from pg_trigger
    where tgname = 'sesiones_marca_primera_carga' and not tgisinternal) as trigger_de_1;
