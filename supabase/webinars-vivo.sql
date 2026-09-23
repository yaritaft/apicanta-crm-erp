-- El vivo de cada webinar, minuto a minuto — Apicanta ERP
--
-- Pedido de Juanchi y Shari: saber cómo fueron los espectadores durante el
-- vivo (el pico, cuánto se quedaron, qué pasó cuando arrancó el pitch) y qué
-- dijo la gente en el chat y en los comentarios.
--
-- YouTube sólo dice cuántos están mirando EN ESE MOMENTO: el número no se
-- puede pedir después. Por eso /api/cron/youtube corre cada minuto y, si hay
-- un webinar en el aire, guarda una muestra. Con el chat pasa lo mismo:
-- cuando el vivo termina, la API ya no lo devuelve. Todo lo escribe el cron
-- con la clave de servicio; las pantallas lo leen por /api/youtube/vivo.
--
--   yt_muestras   una fila por video y por minuto (durante el vivo) o por
--                 hora/día (después, para ver cómo crecen las vistas).
--   yt_chat       cada mensaje del chat del vivo.
--   yt_estado     lo que el cron recuerda de cada video: cuándo empezó y
--                 terminó el vivo, por dónde va leyendo el chat.
--   yt_analytics  lo que trae YouTube Analytics (retención, fuentes, países),
--                 guardado unas horas para no gastar cuota en cada visita.
--   yt_conexion   el permiso del canal para YouTube Analytics. Guarda un
--                 refresh token: SIN política, sólo lo lee el servidor.
--
-- Y a los webinars, el minuto en que arrancó el pitch ("pitchEn").
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.webinars') is null or to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla webinars o ventas.';
  end if;
end $$;

-- ---------- el pitch ----------
alter table public.webinars
  add column if not exists "pitchEn" timestamptz;

-- ---------- muestras ----------
create table if not exists public.yt_muestras (
  "videoId"      text not null,
  -- El minuto de la muestra, redondeado: el cron puede correr dos veces en
  -- el mismo minuto y la segunda pisa a la primera en vez de duplicarla.
  minuto         timestamptz not null,
  "webinarId"    text,
  "enVivo"       boolean not null default false,
  -- Sólo mientras está en el aire. null = YouTube no lo dio (no es un cero).
  espectadores   integer,
  vistas         integer,
  likes          integer,
  comentarios    integer,
  primary key ("videoId", minuto)
);
create index if not exists yt_muestras_webinar_idx on public.yt_muestras ("webinarId", minuto);

-- ---------- chat ----------
create table if not exists public.yt_chat (
  id              text primary key,
  "videoId"       text not null,
  "webinarId"     text,
  "publicadoEn"   timestamptz not null,
  "autorCanalId"  text,
  "autorNombre"   text,
  "autorFoto"     text,
  "esDueno"       boolean not null default false,
  "esModerador"   boolean not null default false,
  -- textMessageEvent, superChatEvent, superStickerEvent, newSponsorEvent…
  tipo            text,
  texto           text,
  -- Super Chat: el monto tal cual lo muestra YouTube ("US$5.00").
  monto           text
);
create index if not exists yt_chat_video_idx on public.yt_chat ("videoId", "publicadoEn");

-- ---------- estado del cron ----------
create table if not exists public.yt_estado (
  "videoId"          text primary key,
  "webinarId"        text,
  estado             text,           -- programado | en-vivo | terminado | video
  programado         timestamptz,
  inicio             timestamptz,
  fin                timestamptz,
  "liveChatId"       text,
  "paginaChat"       text,
  "errorChat"        text,
  "ultimaMuestra"    timestamptz,
  "actualizadoEn"    timestamptz not null default now()
);

-- ---------- YouTube Analytics ----------
create table if not exists public.yt_analytics (
  "videoId"   text primary key,
  datos       jsonb not null,
  "traidoEn"  timestamptz not null default now()
);

create table if not exists public.yt_conexion (
  id               text primary key,   -- siempre 'canal'
  "refreshToken"   text not null,
  "canalId"        text,
  "canalNombre"    text,
  "conectadoPor"   text,
  "conectadoEn"    timestamptz not null default now()
);

-- Como todas las tablas del ERP: sólo el equipo (puede_entrar) lee.
alter table public.yt_muestras enable row level security;
drop policy if exists acceso_equipo_yt_muestras on public.yt_muestras;
create policy acceso_equipo_yt_muestras on public.yt_muestras
  for select to authenticated using (public.puede_entrar());

alter table public.yt_chat enable row level security;
drop policy if exists acceso_equipo_yt_chat on public.yt_chat;
create policy acceso_equipo_yt_chat on public.yt_chat
  for select to authenticated using (public.puede_entrar());

alter table public.yt_estado enable row level security;
drop policy if exists acceso_equipo_yt_estado on public.yt_estado;
create policy acceso_equipo_yt_estado on public.yt_estado
  for select to authenticated using (public.puede_entrar());

alter table public.yt_analytics enable row level security;
drop policy if exists acceso_equipo_yt_analytics on public.yt_analytics;
create policy acceso_equipo_yt_analytics on public.yt_analytics
  for select to authenticated using (public.puede_entrar());

-- El refresh token no lo lee nadie desde el navegador: RLS sin políticas.
alter table public.yt_conexion enable row level security;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'webinars' and column_name = 'pitchEn')  as columna_pitch_de_1,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('yt_muestras', 'yt_chat', 'yt_estado', 'yt_analytics', 'yt_conexion')) as tablas_de_5,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename like 'yt\_%')                                     as politicas_de_4;
