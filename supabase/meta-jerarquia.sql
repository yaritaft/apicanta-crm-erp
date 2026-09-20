-- Jerarquía de Meta en el ERP: campaigns → adsets → ads → ad_insights
--
-- Reemplaza a `campanias`, que era una tabla plana con UN número de inversión
-- por campaña. Ese era el techo del filtro de fechas: podía elegir qué
-- campañas ver, pero no recortar el gasto a los días elegidos, porque el gasto
-- no tenía días. Con `ad_insights` por anuncio y por día, "últimos 7 días"
-- pasa a ser el gasto de esos 7 días, sumando hacia arriba hasta campaña.
--
-- Convención de la app: id de texto, columnas en camelCase entre comillas,
-- igual que los campos de types.ts, así el adaptador no necesita mapear nada.

-- ---------- campaigns ----------
create table if not exists public.campaigns (
  id          text primary key,
  "metaId"    text unique,
  nombre      text not null,
  objetivo    text not null default '',
  estado      text not null default '',
  "cuentaId"  text,
  desde       timestamptz,
  hasta       timestamptz,
  "creadoEn"  timestamptz not null default now(),
  extra       jsonb not null default '{}'::jsonb
);

-- ---------- adsets ----------
create table if not exists public.adsets (
  id           text primary key,
  "metaId"     text unique,
  "campaignId" text not null references public.campaigns(id) on delete cascade,
  nombre       text not null,
  estado       text not null default '',
  desde        timestamptz,
  hasta        timestamptz,
  "creadoEn"   timestamptz not null default now(),
  extra        jsonb not null default '{}'::jsonb
);

-- ---------- ads ----------
-- `campaignId` va repetido a propósito, aunque se puede llegar por el adset:
-- la pantalla de campañas agrupa por campaña y sin esto cada consulta
-- necesitaría un join de más para la pregunta más común de la app.
create table if not exists public.ads (
  id           text primary key,
  "metaId"     text unique,
  "adsetId"    text not null references public.adsets(id) on delete cascade,
  "campaignId" text not null references public.campaigns(id) on delete cascade,
  nombre       text not null,
  estado       text not null default '',
  "creadoEn"   timestamptz not null default now(),
  extra        jsonb not null default '{}'::jsonb
);

-- ---------- ad_insights ----------
-- Una fila por anuncio y por DÍA. El id es `<adId>_<dia>` para que el upsert
-- del store sea idempotente sin lógica extra: volver a sincronizar un día ya
-- traído lo pisa en vez de duplicarlo.
--
-- Todo nullable salvo lo que Meta siempre manda: una métrica ausente no es un
-- cero. "Gastó y no convirtió" y "no corrió ese día" son cosas distintas.
create table if not exists public.ad_insights (
  id                    text primary key,
  "adId"                text not null references public.ads(id) on delete cascade,
  dia                   date not null,
  inversion             numeric not null default 0,
  impresiones           bigint  not null default 0,
  clicks                bigint  not null default 0,
  leads                 integer not null default 0,
  alcance               bigint,
  frecuencia            numeric,
  ctr                   numeric,
  cpm                   numeric,
  cpc                   numeric,
  "clicksEnlace"        bigint,
  "ctrEnlace"           numeric,
  "costoPorClickEnlace" numeric,
  /* Qué tipos de conversión reportó Meta ese día y cuál se usó para los leads.
     Sirve para entender de dónde sale el número sin adivinar. */
  acciones              jsonb not null default '{}'::jsonb,
  "tipoDeLead"          text,
  "creadoEn"            timestamptz not null default now(),
  unique ("adId", dia)
);

-- Índices para las dos preguntas que la app hace siempre: el gasto de un
-- rango, y el detalle de un anuncio.
create index if not exists ad_insights_dia_idx      on public.ad_insights (dia);
create index if not exists ad_insights_ad_dia_idx   on public.ad_insights ("adId", dia);
create index if not exists ads_campaign_idx         on public.ads ("campaignId");
create index if not exists adsets_campaign_idx      on public.adsets ("campaignId");

-- ---------- Permisos ----------
-- MISMA política que el resto: sin esto las tablas quedan invisibles para
-- todos y la app cree que están vacías, porque un SELECT que RLS rechaza
-- devuelve cero filas y ningún error.
alter table public.campaigns   enable row level security;
alter table public.adsets      enable row level security;
alter table public.ads         enable row level security;
alter table public.ad_insights enable row level security;

drop policy if exists acceso_equipo_campaigns   on public.campaigns;
drop policy if exists acceso_equipo_adsets      on public.adsets;
drop policy if exists acceso_equipo_ads         on public.ads;
drop policy if exists acceso_equipo_ad_insights on public.ad_insights;

create policy acceso_equipo_campaigns   on public.campaigns   for all
  using (public.puede_entrar()) with check (public.puede_entrar());
create policy acceso_equipo_adsets      on public.adsets      for all
  using (public.puede_entrar()) with check (public.puede_entrar());
create policy acceso_equipo_ads         on public.ads         for all
  using (public.puede_entrar()) with check (public.puede_entrar());
create policy acceso_equipo_ad_insights on public.ad_insights for all
  using (public.puede_entrar()) with check (public.puede_entrar());

-- `campanias` NO se borra todavía. Primero migran los datos y la pantalla
-- pasa a leer de las tablas nuevas; recién ahí se tira. Borrarla ahora
-- dejaría Marketing en blanco hasta que termine todo lo demás.
