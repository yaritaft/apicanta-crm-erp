-- Customer Success — Apicanta ERP (F2-09 y F2-06, reunión del 02/10)
--
-- Manu pidió unificar en la app lo que Customer Success lleva en planillas y
-- en Airtable: el seguimiento de los alumnos (a quién contactar hoy, cada 7,
-- 15 o 20 días, quién dejó de contestar), quién tiene el CV y el LinkedIn
-- corregidos y los testimonios. Esto agrega:
--
--   1. `seguimiento_alumnos`: una fila por alumno (id = 'seg_<alumnoId>') con
--      la cadencia, el último y el próximo contacto, los intentos sin
--      respuesta, «dejó de contestar» y el CV y el LinkedIn corregidos. Va en
--      tabla aparte y no en `alumnos` porque el pipeline de servicio guarda la
--      fila entera del alumno y pisaría lo que cargó Customer Success.
--   2. `testimonios`: lo que se le pidió, grabó y publicó a cada alumno, con su
--      link y su fecha.
--   3. `ajustes.seguimiento` (jsonb): las cadencias que se pueden elegir, los
--      días de reintento y los intentos hasta «dejó de contestar».
--   4. El permiso: las dos tablas son del área Alumnos, y el área nueva
--      «clientes» (Clientes como permiso propio) lee y edita lo mismo que
--      Ventas en las pantallas de Clientes. Un tipo que ya ve Ventas sigue
--      viendo Clientes: lo resuelve la app (nivelDeAreas en src/lib/permisos.ts),
--      acá sólo se le abren a «clientes» las tablas que lee esa pantalla.
--      areas_que_leen() y areas_que_editan() se ajustan sobre su definición
--      vigente (no se pisan con una copia): se puede correr antes o después de
--      lo de otros lotes.
--   5. El tipo de cuenta «Customer Success» (ve Alumnos y Clientes, y sólo
--      eso). Se crea una sola vez: si Yari lo cambia, correr esto de nuevo no
--      lo pisa.
--
-- Sin esto la app anda igual: el seguimiento y los testimonios quedan en el
-- navegador de quien los carga (como el resto de las tablas opcionales).
--
-- Idempotente: se puede correr de nuevo sin romper nada.
-- Requiere haber corrido antes supabase/tipos-cuenta.sql.

do $$ begin
  if to_regclass('public.alumnos') is null or to_regclass('public.ajustes') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla alumnos o ajustes.';
  end if;
  if to_regprocedure('public.areas_que_leen(text)') is null or to_regclass('public.tipos_cuenta') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan los tipos de cuenta.';
  end if;
end $$;

-- ---------- 1. el seguimiento de cada alumno ----------

create table if not exists public.seguimiento_alumnos (
  id                      text primary key,
  -- Si se borra el alumno, se va su seguimiento.
  "alumnoId"              text not null references public.alumnos(id) on delete cascade,
  -- Cada cuántos días se lo contacta (7, 15 o 20; se elige por alumno).
  "cadenciaDias"          integer not null default 15 check ("cadenciaDias" between 1 and 365),
  -- Días del negocio («2026-10-07»), como texto: no llevan hora.
  "ultimoContacto"        text,
  "proximoContacto"       text,
  -- Veces seguidas que no contestó desde el último contacto logrado.
  "intentosSinRespuesta"  integer not null default 0,
  "ultimoIntento"         text,
  "dejoDeContestar"       boolean not null default false,
  "cvCorregido"           boolean not null default false,
  "cvCorregidoEn"         text,
  "linkedinCorregido"     boolean not null default false,
  "linkedinCorregidoEn"   text,
  notas                   text not null default '',
  "actualizadoEn"         timestamptz not null default now(),
  "actualizadoPor"        text not null default ''
);

-- Uno por alumno: dos personas que lo abren a la vez escriben la misma fila.
create unique index if not exists seguimiento_alumnos_alumno_idx on public.seguimiento_alumnos ("alumnoId");
create index if not exists seguimiento_alumnos_proximo_idx on public.seguimiento_alumnos ("proximoContacto");

-- ---------- 2. los testimonios ----------

create table if not exists public.testimonios (
  id          text primary key,
  "alumnoId"  text not null references public.alumnos(id) on delete cascade,
  -- pedido · grabado · publicado
  estado      text not null default 'pedido' check (estado in ('pedido', 'grabado', 'publicado')),
  -- Dónde está: el video, el posteo, la carpeta.
  link        text not null default '',
  -- El día en que se pidió, grabó o publicó (según el estado).
  fecha       text,
  notas       text not null default '',
  "creadoEn"  timestamptz not null default now()
);

create index if not exists testimonios_alumno_idx on public.testimonios ("alumnoId");

-- ---------- 3. la configuración del seguimiento ----------

alter table public.ajustes
  add column if not exists seguimiento jsonb;

-- ---------- 4. el permiso ----------

-- areas_que_leen / areas_que_editan: se parte de la definición que hay ahora
-- y se le agregan líneas, para no pisar lo que hayan agregado otros lotes.
do $$
declare
  def_l text := pg_get_functiondef('public.areas_que_leen(text)'::regprocedure);
  def_e text := pg_get_functiondef('public.areas_que_editan(text)'::regprocedure);
  nuevo_l text := def_l;
  nuevo_e text := def_e;
begin
  -- Lo que lee la pantalla Clientes (la gente, sus ventas, cuotas y cobros, el chat).
  if def_l not like '%''clientes''%' then
    nuevo_l := regexp_replace(nuevo_l,
      $re$(when '(leads|contactos|comentarios|ventas|cuotas|pagos)'\s+then array\[)$re$,
      $r$\1'clientes',$r$, 'g');
  end if;
  -- Las dos tablas nuevas, sólo del área Alumnos.
  if def_l not like '%''seguimiento_alumnos''%' then
    nuevo_l := regexp_replace(nuevo_l, $re$(select case tabla)$re$,
      $r$\1$r$ || chr(10) || $r$    when 'seguimiento_alumnos' then array['alumnos']$r$
        || chr(10) || $r$    when 'testimonios'          then array['alumnos']$r$);
  end if;
  -- Quien edita Clientes puede corregir los datos de la persona y escribir en su chat.
  if def_e not like '%''clientes''%' then
    nuevo_e := regexp_replace(nuevo_e,
      $re$(when '(contactos|comentarios)'\s+then array\[)$re$,
      $r$\1'clientes',$r$, 'g');
  end if;
  if def_e not like '%''seguimiento_alumnos''%' then
    nuevo_e := regexp_replace(nuevo_e, $re$(select case tabla)$re$,
      $r$\1$r$ || chr(10) || $r$    when 'seguimiento_alumnos' then array['alumnos']$r$
        || chr(10) || $r$    when 'testimonios'          then array['alumnos']$r$);
  end if;
  if nuevo_l <> def_l then execute nuevo_l; end if;
  if nuevo_e <> def_e then execute nuevo_e; end if;
end $$;

-- Las políticas de las tablas nuevas: leer con ve(), escribir con edita(),
-- como el resto de las tablas sin «sólo lo suyo».
do $$
declare t text;
begin
  foreach t in array array['seguimiento_alumnos', 'testimonios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'acceso_equipo_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'ver_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'crear_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'editar_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'borrar_' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ve(%L)))', 'ver_' || t, t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.edita(%L)))', 'crear_' || t, t, t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.edita(%L))) with check ((select public.edita(%L)))', 'editar_' || t, t, t, t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.edita(%L)))', 'borrar_' || t, t, t);
  end loop;
end $$;

-- ---------- 5. el tipo de cuenta «Customer Success» ----------

insert into public.tipos_cuenta (id, nombre, descripcion, areas, "soloLoSuyo", orden) values
  ('customer_success', 'Customer Success',
   'Alumnos (seguimiento, CV y LinkedIn, testimonios) y Clientes. Sólo eso.',
   '{"alumnos":"editar","clientes":"ver"}', false,
   (select coalesce(max(orden), 0) + 1 from public.tipos_cuenta))
on conflict (id) do nothing;

-- ---------- diagnóstico ----------
select
  (select count(*) from public.seguimiento_alumnos)                                  as seguimientos,
  (select count(*) from public.testimonios)                                          as testimonios,
  (select count(*) from public.tipos_cuenta where id = 'customer_success')           as tipo_customer_success,
  public.areas_que_leen('ventas')                                                    as lee_ventas,
  public.areas_que_leen('seguimiento_alumnos')                                       as lee_seguimiento,
  public.areas_que_editan('contactos')                                               as edita_contactos,
  public.areas_que_editan('testimonios')                                             as edita_testimonios;
