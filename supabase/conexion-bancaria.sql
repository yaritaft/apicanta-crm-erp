-- La conexión con el banco (Bank of America, por Plaid) — Apicanta ERP (Yari y Manu, 03/11/2026)
--
-- Bank of America no tiene una API que la app pueda leer sola: Plaid sí. Alguien con acceso a la cuenta (Yari o Manu) entra una vez con su usuario
-- del banco en la ventana de Plaid —la clave del banco la ve el banco, nunca la app— y Plaid devuelve un permiso de sólo lectura (`accessToken`) que
-- el servidor guarda acá. Con ese permiso el servidor trae los movimientos y el saldo de la cuenta cuando se le pide y cada hora (el cron de
-- /api/pasarelas/sync), y carga los gastos de a uno (lib/plaid-servidor.ts).
--
-- Una fila por banco: `id` = 'bofa'.
--   · accessToken     el permiso de Plaid. SIN política: sólo lo lee el servidor (como yt_conexion, el refresh token de YouTube).
--   · cuentas         las cuentas que se eligieron en Plaid: [{ id, nombre, mascara, tipo, subtipo }].
--   · autoCargar      si el cron carga solo los gastos nuevos (se puede apagar sin desconectar).
--   · desdeAuto       lo anterior a este día no se carga solo (lo de antes se carga a mano o con el CSV).
--   · pideReautorizar Bank of America vence el permiso al año, o el banco lo pide: hay que volver a entrar desde Ajustes.
--
-- Idempotente: se puede volver a correr. Para deshacerlo:  drop table if exists public.conexion_bancaria;

do $$ begin
  if to_regclass('public.gastos') is null or to_regclass('public.procesadores') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla gastos o procesadores.';
  end if;
end $$;

create table if not exists public.conexion_bancaria (
  id                 text primary key,
  "accessToken"      text not null,
  "itemId"           text not null,
  institucion        text,
  cuentas            jsonb not null default '[]'::jsonb,
  "autoCargar"       boolean not null default true,
  "desdeAuto"        timestamptz not null default now(),
  "pideReautorizar"  boolean not null default false,
  "ultimaLectura"    timestamptz,
  "ultimoError"      text,
  "ultimosCargados"  integer not null default 0,
  "conectadoPor"     text,
  "conectadoEn"      timestamptz not null default now()
);

-- Nadie lo lee desde el navegador: RLS activado y sin políticas. La clave de servicio (el servidor) se salta RLS.
alter table public.conexion_bancaria enable row level security;
revoke all on public.conexion_bancaria from anon, authenticated;

-- Diagnóstico
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'conexion_bancaria') as tabla_de_1,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'conexion_bancaria')                  as politicas_de_0,
  (select relrowsecurity from pg_class where oid = 'public.conexion_bancaria'::regclass)                               as rls_activado;
