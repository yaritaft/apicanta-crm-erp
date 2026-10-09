-- Customer Success según Lili — Apicanta ERP (respuesta del 09/10, F2-09)
--
-- Lili (Customer Success) contó cómo lleva hoy a los alumnos en su Airtable: la lista de Clientes con 29
-- columnas, la pestaña de Testimonios con 16 y la Agenda de resells con 9, esta última conectada a Calendly.
-- Este archivo agrega lo que falta en la base para llevarlo todo en la app:
--
--   1. `seguimiento_alumnos`: la ficha del cliente (N.º de alumno, teléfono, edad, stack, DNI, domicilio,
--      programas, plan de pago, duración, fecha de egreso, sesiones con el mentor, contacto inicial y de la
--      semana, acceso, follow-up, garantía, accesos a WhatsApp / Zoom / Wibo, contrato, closer, responsable del
--      CV y LinkedIn y el reporte semanal marcado a mano). Se agregan columnas a la tabla que ya existe: una
--      fila por alumno, como hasta ahora (no se toca `alumnos`: el pipeline guarda la fila entera y pisaría lo
--      que cargó Customer Success).
--   2. `testimonios`: las columnas de Lili (follow-up, fecha de grabación, con quién grabó, resell, estado del
--      video, tecnologías, situación previa y actual). `estado` y `fecha` eran del primer modelo (pedido /
--      grabado / publicado): quedan en la tabla, sin escribirse más, y lo que ya estaba cargado se pasa a las
--      columnas nuevas la primera vez.
--   3. `resells`: la agenda de resells. Las llamadas de resell que trae Calendly entran solas (lo hace
--      lib/calendly-sync.ts con la clave de servicio) y Customer Success completa estado, cash collect, caso de
--      éxito y notas. Acá mismo se pasan las que ya había en `sesiones` (auditoría / resell), una sola vez.
--      Es una tabla propia, y no una vista de `sesiones`, porque Customer Success no lee las llamadas de venta.
--   4. El permiso: `resells` es del área Alumnos, como el seguimiento y los testimonios (se agrega a
--      areas_que_leen() y areas_que_editan() sobre su definición vigente, sin pisar la de otros lotes).
--
-- Sin esto la app anda igual: lo nuevo del seguimiento y los testimonios, y la agenda de resells, quedan en el
-- navegador de quien los carga (la app lo avisa), y el servidor no guarda los resells de Calendly.
--
-- Idempotente: se puede correr de nuevo sin romper nada ni pisar lo ya cargado.
-- Requiere haber corrido antes supabase/tipos-cuenta.sql y supabase/customer-success.sql.

do $$ begin
  if to_regclass('public.seguimiento_alumnos') is null or to_regclass('public.testimonios') is null then
    raise exception 'Primero hay que correr customer-success.sql: faltan seguimiento_alumnos y testimonios.';
  end if;
  if to_regprocedure('public.areas_que_leen(text)') is null or to_regprocedure('public.areas_que_editan(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan areas_que_leen() y areas_que_editan().';
  end if;
end $$;

-- ---------- 1. La ficha del cliente ----------

alter table public.seguimiento_alumnos
  add column if not exists numero            integer,
  add column if not exists telefono          text    not null default '',
  add column if not exists edad              integer,
  add column if not exists stack             text    not null default '',
  add column if not exists dni               text    not null default '',
  add column if not exists domicilio         text    not null default '',
  -- Hackear IT, Hackear Biz, Principals, Principal Mastermind: puede estar en más de uno.
  add column if not exists programas         jsonb   not null default '[]'::jsonb,
  add column if not exists "planDePago"      text    not null default '',
  add column if not exists "duracionMeses"   integer,
  -- Días del negocio («2026-10-07»), como texto: no llevan hora.
  add column if not exists "fechaEgreso"     text,
  add column if not exists "sesionesMentor"  integer,
  add column if not exists "contactoInicial" text,
  add column if not exists "contactoSemana"  text,
  add column if not exists acceso            text    not null default '',
  add column if not exists "followUp"        text    not null default '',
  add column if not exists garantia          text    not null default '',
  add column if not exists "accesoWhatsapp"  boolean not null default false,
  add column if not exists "accesoZoom"      boolean not null default false,
  add column if not exists "accesoWibo"      boolean not null default false,
  add column if not exists "contratoFirmado" text    not null default '',
  add column if not exists "estadoContrato"  text    not null default '',
  -- Sólo si el alumno no viene de una venta de la app (uno importado): si viene, el closer es el de la venta.
  add column if not exists "closerNombre"    text    not null default '',
  add column if not exists "responsableCv"   text    not null default '',
  -- {completo, activo, semanasSin, en}: el reporte semanal marcado a mano, mientras los reportes no llegan solos.
  add column if not exists "reporteManual"   jsonb;

create index if not exists seguimiento_alumnos_numero_idx on public.seguimiento_alumnos (numero) where numero is not null;

-- ---------- 2. Testimonios ----------

do $$
declare primera boolean;
begin
  -- Las columnas nuevas se agregan siempre; lo que había cargado en el primer modelo se pasa sólo la primera vez
  -- (si no, un testimonio nuevo, que no escribe `estado` y queda con el «pedido» de siempre, se tomaría por viejo).
  primera := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'testimonios' and column_name = 'followUp'
  );

  alter table public.testimonios
    add column if not exists "followUp"        text not null default '',
    add column if not exists "fechaGrabacion"  text,
    add column if not exists "conQuien"        text not null default '',
    add column if not exists resell            text not null default '',
    add column if not exists "estadoVideo"     text not null default '',
    add column if not exists tecnologias       text not null default '',
    add column if not exists "situacionPrevia" text not null default '',
    add column if not exists "situacionActual" text not null default '';

  if primera then
    update public.testimonios set
      "followUp"       = case estado when 'pedido' then 'Pendiente de agendar' else 'Llamada agendada' end,
      "estadoVideo"    = case estado when 'pedido' then '' when 'grabado' then 'Pendiente de subir' else 'Subido a YouTube' end,
      "fechaGrabacion" = case when estado in ('grabado', 'publicado') then fecha else null end;
  end if;
end $$;

-- ---------- 3. La agenda de resells ----------

create table if not exists public.resells (
  -- «rs_<id de la llamada>» si la trajo Calendly; propio si se cargó a mano o se importó.
  id               text primary key,
  "sesionId"       text,
  "fechaHora"      timestamptz not null default now(),
  nombre           text not null default '',
  email            text not null default '',
  telefono         text not null default '',
  -- El anfitrión del evento en Calendly (el closer), tal cual.
  closer           text not null default '',
  -- Renueva, no renueva… Vacío: sin definir (la app muestra «Agendada» o «Cancelada»).
  estado           text not null default '',
  "cashCollect"    numeric,
  "casoDeExito"    boolean not null default false,
  notas            text not null default '',
  cancelada        boolean not null default false,
  origen           text not null default 'manual' check (origen in ('calendly', 'manual', 'importado')),
  "creadoEn"       timestamptz not null default now(),
  "actualizadoEn"  timestamptz not null default now(),
  "actualizadoPor" text not null default ''
);

-- Una llamada de Calendly, un resell.
create unique index if not exists resells_sesion_idx on public.resells ("sesionId") where "sesionId" is not null;
create index if not exists resells_fecha_idx on public.resells ("fechaHora");
create index if not exists resells_email_idx on public.resells (lower(email)) where email <> '';

-- Las que ya había: las llamadas de auditoría / resell que Calendly ya trajo. Una sola vez por llamada: lo que
-- Customer Success cargue después no se toca al volver a correr esto.
insert into public.resells (id, "sesionId", "fechaHora", nombre, email, telefono, closer, cancelada, origen, "creadoEn")
select 'rs_' || s.id, s.id, s.inicia, coalesce(s.invitado, ''), coalesce(s.email, ''), coalesce(c.telefono, ''),
       coalesce(s.anfitrion, ''), s.estado = 'cancelada', 'calendly', coalesce(s."creadoEn", now())
from public.sesiones s
left join public.contactos c on c.id = s."contactoId"
where coalesce(s.tipo, '') ~* '(auditor|resell)'
   or lower(coalesce(s.utm ->> 'utm_source', '')) like '%resell%'
on conflict (id) do nothing;

-- ---------- 4. El permiso ----------

do $$
declare
  def_l text := pg_get_functiondef('public.areas_que_leen(text)'::regprocedure);
  def_e text := pg_get_functiondef('public.areas_que_editan(text)'::regprocedure);
  nuevo_l text := def_l;
  nuevo_e text := def_e;
begin
  if def_l not like '%''resells''%' then
    nuevo_l := regexp_replace(nuevo_l, $re$(select case tabla)$re$,
      $r$\1$r$ || chr(10) || $r$    when 'resells' then array['alumnos']$r$);
  end if;
  if def_e not like '%''resells''%' then
    nuevo_e := regexp_replace(nuevo_e, $re$(select case tabla)$re$,
      $r$\1$r$ || chr(10) || $r$    when 'resells' then array['alumnos']$r$);
  end if;
  if nuevo_l <> def_l then execute nuevo_l; end if;
  if nuevo_e <> def_e then execute nuevo_e; end if;
end $$;

-- Leer con ve(), escribir con edita(), como el seguimiento y los testimonios.
alter table public.resells enable row level security;
drop policy if exists acceso_equipo_resells on public.resells;
drop policy if exists ver_resells on public.resells;
drop policy if exists crear_resells on public.resells;
drop policy if exists editar_resells on public.resells;
drop policy if exists borrar_resells on public.resells;
create policy ver_resells on public.resells for select to authenticated using ((select public.ve('resells')));
create policy crear_resells on public.resells for insert to authenticated with check ((select public.edita('resells')));
create policy editar_resells on public.resells for update to authenticated
  using ((select public.edita('resells'))) with check ((select public.edita('resells')));
create policy borrar_resells on public.resells for delete to authenticated using ((select public.edita('resells')));

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'seguimiento_alumnos'
      and column_name in ('numero', 'telefono', 'edad', 'stack', 'dni', 'domicilio', 'programas', 'planDePago', 'duracionMeses',
        'fechaEgreso', 'sesionesMentor', 'contactoInicial', 'contactoSemana', 'acceso', 'followUp', 'garantia', 'accesoWhatsapp',
        'accesoZoom', 'accesoWibo', 'contratoFirmado', 'estadoContrato', 'closerNombre', 'responsableCv', 'reporteManual'))
                                                                                        as columnas_de_seguimiento_de_24,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'testimonios'
      and column_name in ('followUp', 'fechaGrabacion', 'conQuien', 'resell', 'estadoVideo', 'tecnologias', 'situacionPrevia', 'situacionActual'))
                                                                                        as columnas_de_testimonios_de_8,
  (select count(*) from public.resells)                                                 as resells,
  (select count(*) from public.resells where origen = 'calendly')                       as resells_de_calendly,
  public.areas_que_leen('resells')                                                      as lee_resells,
  public.areas_que_editan('resells')                                                    as edita_resells;
