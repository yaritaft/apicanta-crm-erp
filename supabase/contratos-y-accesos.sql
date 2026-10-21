-- Contratos de PandaDoc y accesos de alumnos — Apicanta ERP (pedido del 20/10)
--
-- El Loom de Yari (onboarding y outboarding de alumnos) y el circuito del contrato de Blue OS, traído acá:
--
--   1. `contratos`: cada contrato de PandaDoc, atado a su venta, su llamada, la persona y el servicio (alumno).
--      Lo crea el servidor al mandarlo desde la carga de la venta o desde la ficha, y lo actualiza el aviso de
--      PandaDoc (enviado, lo abrió, firmado, rechazado, anulado). `modo` = 'prueba' es un contrato hecho con la
--      clave sandbox (sólo a mails del dominio de la cuenta): nunca cuenta como un contrato real.
--   2. `contrato_eventos`: el historial de cada contrato (quién lo mandó, cuándo lo abrió, cuándo lo firmó,
--      los reenvíos, las correcciones).
--   3. `pandadoc_conexion` y `pandadoc_avisos`: la suscripción al aviso de PandaDoc (con su clave para
--      verificar la firma de cada aviso) y los avisos ya procesados, para no procesar dos veces el mismo.
--   4. `accesos_alumno`: qué acceso se le dio a cada alumno (curso de Wisboo, grupo de Telegram, reunión de
--      Zoom), cuándo, quién y cómo quedó. Con eso el outboarding sabe qué sacar.
--   5. `telegram_grupos` y `telegram_conexion`: los grupos donde está el bot y su conexión.
--   6. `ajustes.programas` y `ajustes.contratos`: el mapa de cada programa (qué productos de la venta son ese
--      programa, su plantilla de PandaDoc, sus cursos, grupos y reuniones, y sus bonos) y la configuración de
--      los contratos (si están prendidos, el asunto y el mensaje).
--
-- Quién ve qué: los contratos los ve quien ve las ventas o los alumnos, y el closer sólo los de sus ventas o
-- su gente (las mismas funciones de solo-lo-suyo-seguro.sql). Nadie los escribe desde el navegador: los
-- escribe el servidor (clave de servicio), después de comprobar el permiso de quien pide. Las conexiones y
-- los avisos no los lee nadie desde el navegador.
--
-- Sin esto la app anda igual: la tarjeta del contrato y el paso de la venta avisan que falta correrlo.
-- Idempotente: se puede correr de nuevo sin romper nada ni pisar lo cargado.
-- Requiere haber corrido antes supabase/tipos-cuenta.sql y supabase/solo-lo-suyo-seguro.sql.

do $$ begin
  if to_regprocedure('public.ve(text)') is null or to_regprocedure('public.solo_lo_suyo()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan ve() y solo_lo_suyo().';
  end if;
  if to_regprocedure('public.es_mi_venta(text)') is null or to_regprocedure('public.es_mi_lead(text)') is null then
    raise exception 'Primero hay que correr solo-lo-suyo-seguro.sql: faltan es_mi_venta() y es_mi_lead().';
  end if;
end $$;

-- ---------- 1. Contratos ----------

create table if not exists public.contratos (
  id               text primary key,
  "ventaId"        text,
  "sesionId"       text,
  "leadId"         text,
  "alumnoId"       text,
  programa         text not null default '',
  "plantillaId"    text not null default '',
  "plantillaNombre" text not null default '',
  "documentoId"    text unique,
  modo             text not null default 'produccion' check (modo in ('produccion', 'prueba')),
  estado           text not null default 'creando'
                   check (estado in ('creando', 'borrador', 'enviado', 'visto', 'firmado', 'rechazado', 'anulado', 'error')),
  -- A quién: nombre, email y teléfono del alumno que firma.
  destinatario     jsonb not null default '{}'::jsonb,
  -- Lo que va en el contrato: documento, domicilio, modalidad, sesiones, bonos, fecha.
  datos            jsonb not null default '{}'::jsonb,
  -- El link para firmar (sesión de PandaDoc), para copiarlo y mandarlo por WhatsApp. Vence.
  enlace           text,
  "enlaceVence"    timestamptz,
  -- El PDF firmado, en el bucket privado `contratos`.
  "pdfPath"        text,
  "enviadoEn"      timestamptz,
  "vistoEn"        timestamptz,
  "firmadoEn"      timestamptz,
  "rechazadoEn"    timestamptz,
  "anuladoEn"      timestamptz,
  -- Cuándo se dispararon los accesos al firmar (para no darlos dos veces).
  "accesosEn"      timestamptz,
  -- De dónde salió: la app, o PandaDoc (uno mandado a mano que el aviso encontró).
  origen           text not null default 'app' check (origen in ('app', 'pandadoc')),
  error            text,
  "creadoEn"       timestamptz not null default now(),
  "creadoPor"      text not null default '',
  "actualizadoEn"  timestamptz not null default now(),
  -- La última vez que se le preguntó a PandaDoc cómo está (la frescura del dato).
  "sincronizadoEn" timestamptz
);
create index if not exists contratos_venta  on public.contratos ("ventaId");
create index if not exists contratos_lead   on public.contratos ("leadId");
create index if not exists contratos_alumno on public.contratos ("alumnoId");
create index if not exists contratos_estado on public.contratos (estado);

create table if not exists public.contrato_eventos (
  id           text primary key,
  "contratoId" text not null references public.contratos(id) on delete cascade,
  evento       text not null,
  detalle      jsonb not null default '{}'::jsonb,
  cuando       timestamptz not null default now(),
  quien        text not null default '',
  origen       text not null default 'app' check (origen in ('app', 'pandadoc', 'sincronizacion'))
);
create index if not exists contrato_eventos_contrato on public.contrato_eventos ("contratoId", cuando);

alter table public.contratos enable row level security;
alter table public.contrato_eventos enable row level security;

drop policy if exists ver_contratos on public.contratos;
create policy ver_contratos on public.contratos for select to authenticated using (
  ((select public.ve('ventas')) or (select public.ve('alumnos')))
  and ((select not public.solo_lo_suyo())
       or ("ventaId" is not null and public.es_mi_venta("ventaId"))
       or ("leadId" is not null and public.es_mi_lead("leadId"))));

-- El historial se ve si se ve su contrato (la política de arriba corre también en la subconsulta).
drop policy if exists ver_contrato_eventos on public.contrato_eventos;
create policy ver_contrato_eventos on public.contrato_eventos for select to authenticated using (
  exists (select 1 from public.contratos c where c.id = "contratoId"));

-- ---------- 2. La conexión con PandaDoc y los avisos ya procesados ----------

create table if not exists public.pandadoc_conexion (
  modo            text primary key check (modo in ('produccion', 'prueba')),
  "suscripcionId" text,
  clave           text,
  url             text,
  "conectadoEn"   timestamptz,
  "conectadoPor"  text not null default ''
);
create table if not exists public.pandadoc_avisos (
  id         text primary key,
  recibido   timestamptz not null default now(),
  documento  text,
  estado     text
);
alter table public.pandadoc_conexion enable row level security;
alter table public.pandadoc_avisos enable row level security;
-- Sin políticas: sólo el servidor (la clave de servicio saltea RLS).

-- ---------- 3. Los accesos de cada alumno ----------

create table if not exists public.accesos_alumno (
  id              text primary key,
  "alumnoId"      text not null,
  "contratoId"    text,
  programa        text not null default '',
  plataforma      text not null check (plataforma in ('wisboo', 'telegram', 'zoom')),
  -- El producto de Wisboo, el chat de Telegram o la reunión de Zoom.
  recurso         text not null,
  "recursoNombre" text not null default '',
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'dado', 'entro', 'fallo', 'quitado')),
  -- Lo que hace falta para sacarlo: el usuario y el acceso de Wisboo, el link y el usuario de Telegram, el
  -- inscripto de Zoom.
  externo         jsonb not null default '{}'::jsonb,
  error           text,
  "dadoEn"        timestamptz,
  "quitadoEn"     timestamptz,
  origen          text not null default 'automatico' check (origen in ('automatico', 'manual')),
  quien           text not null default '',
  "creadoEn"      timestamptz not null default now(),
  "actualizadoEn" timestamptz not null default now(),
  unique ("alumnoId", plataforma, recurso)
);
create index if not exists accesos_alumno_alumno on public.accesos_alumno ("alumnoId");
alter table public.accesos_alumno enable row level security;
drop policy if exists ver_accesos_alumno on public.accesos_alumno;
create policy ver_accesos_alumno on public.accesos_alumno for select to authenticated using (
  (select public.ve('alumnos')));

create table if not exists public.telegram_grupos (
  "chatId"        text primary key,
  titulo          text not null default '',
  tipo            text not null default '',
  "botEsAdmin"    boolean not null default false,
  "puedeInvitar"  boolean not null default false,
  "puedeExpulsar" boolean not null default false,
  "vistoEn"       timestamptz not null default now()
);
alter table public.telegram_grupos enable row level security;
drop policy if exists ver_telegram_grupos on public.telegram_grupos;
create policy ver_telegram_grupos on public.telegram_grupos for select to authenticated using (
  (select public.ve('alumnos')) or (select public.edita('ajustes')));

create table if not exists public.telegram_conexion (
  id             int primary key default 1 check (id = 1),
  secreto        text,
  url            text,
  "conectadoEn"  timestamptz,
  "conectadoPor" text not null default ''
);
alter table public.telegram_conexion enable row level security;
-- Sin políticas: sólo el servidor.

-- ---------- 4. El mapa de programas y la configuración de los contratos ----------

alter table public.ajustes add column if not exists programas jsonb;
alter table public.ajustes add column if not exists contratos jsonb;

-- ---------- 5. El bucket de los PDF firmados (privado: los firma el servidor) ----------

insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', false)
on conflict (id) do update set public = false;

-- ---------- Diagnóstico ----------
select c.relname as tabla, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('contratos', 'contrato_eventos', 'pandadoc_conexion', 'pandadoc_avisos',
                    'accesos_alumno', 'telegram_grupos', 'telegram_conexion')
order by 1;
