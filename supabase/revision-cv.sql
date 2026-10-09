-- La revisión de CVs de Customer Success — Apicanta ERP
--
-- Aldana corrige el CV y el LinkedIn de cada alumno (después del módulo 2, cuando Lili le pasa su contacto) y hasta hoy lo llevaba
-- en una base de Notion, «REVISION DE CVS»: una fila por alumno, con en qué etapa va (el «Estado»), si el CV llegó, si ya mandó la
-- primera y la segunda corrección, el link del documento de corrección que se le manda al alumno, el link del Loom de Yari y notas.
-- Esto es esa base, adentro de la app, para ver de un vistazo cuántos hay en cada estado y no depender de otra herramienta.
--
--   · `public.revisiones_cv`: una fila por revisión. El estado es texto libre que sale de la lista que ajusta Customer Success (En proceso,
--     Esperando cliente, Segunda ronda, Con Yari, Cerrado, Outboarding), como el estado de la agenda de resells: cambiar un nombre en la
--     lista no reescribe lo ya cargado. `alumnoId` ata la revisión al alumno de la app cuando se pudo saber de quién es (sin eso la
--     revisión vale igual: en su Notion sólo hay nombre y teléfono); si el alumno se borra, la revisión queda y pierde la atadura.
--     El día de inicio es texto «aaaa-mm-dd» (un día suelto en una columna con hora vuelve como el día anterior en Argentina).
--   · El permiso: `revisiones_cv` es del área Alumnos, como el seguimiento, los testimonios y los resells (se suma a areas_que_leen() y a
--     areas_que_editan() sobre su definición vigente, no con una copia; si alguna vez se vuelve a correr tipos-cuenta.sql, hay que volver a
--     correr esto). Leer con ve(), escribir con edita().
--
-- Sin esto la app anda igual: las revisiones quedan sólo en este navegador hasta que corra (la tabla es opcional en supabase.ts).
-- Idempotente y sin tocar datos; para deshacerlo: `drop table public.revisiones_cv;` (y volver a correr tipos-cuenta.sql si se quiere
-- sacar la tabla de las dos listas de áreas). Se ensaya con pruebas/revision-cv-sql.test.ts (PGlite) y, contra la base real, dentro de una
-- transacción que se revierte.

do $$ begin
  if to_regclass('public.alumnos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla alumnos.';
  end if;
  if to_regprocedure('public.areas_que_leen(text)') is null or to_regprocedure('public.areas_que_editan(text)') is null
     or to_regprocedure('public.ve(text)') is null or to_regprocedure('public.edita(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan areas_que_leen(), areas_que_editan(), ve() o edita().';
  end if;
end $$;

-- ---------- 1. La tabla ----------

create table if not exists public.revisiones_cv (
  -- «cv_<…>» si se cargó o se importó; propio de la app.
  id               text primary key,
  nombre           text not null default '',
  -- El teléfono tal cual lo escribió quien lo cargó: el que se usa para encontrar al alumno es otro (sólo los dígitos).
  telefono         text not null default '',
  "alumnoId"       text references public.alumnos (id) on delete set null,
  -- En proceso, Esperando cliente, Segunda ronda, Con Yari, Cerrado, Outboarding… Vacío: sin definir.
  estado           text not null default '',
  "cvRecibido"     boolean not null default false,
  correccion1      boolean not null default false,
  correccion2      boolean not null default false,
  -- «aaaa-mm-dd»: el día en que empezó la revisión.
  "fechaInicio"    text,
  -- El CV en la carpeta «Curriculums» (Drive), el perfil de LinkedIn, el documento de corrección que se le manda al alumno y el Loom de Yari.
  "linkCv"         text not null default '',
  "linkLinkedin"   text not null default '',
  "linkCorreccion" text not null default '',
  "linkLoom"       text not null default '',
  notas            text not null default '',
  -- «msj 9/9», «pedido a lili»: lo que se le avisó al alumno o se le pidió a otro.
  mensajes         text not null default '',
  origen           text not null default 'manual' check (origen in ('manual', 'importado')),
  "creadoEn"       timestamptz not null default now(),
  "actualizadoEn"  timestamptz not null default now(),
  "actualizadoPor" text not null default ''
);

-- Varios alumnos pueden llamarse igual (hay nombres repetidos en lo que se trajo de Notion): el nombre no es único.
create index if not exists revisiones_cv_estado_idx on public.revisiones_cv (estado);
create index if not exists revisiones_cv_nombre_idx on public.revisiones_cv (lower(nombre));
create index if not exists revisiones_cv_alumno_idx on public.revisiones_cv ("alumnoId") where "alumnoId" is not null;

-- ---------- 2. El permiso ----------

do $$
declare
  def_l text := pg_get_functiondef('public.areas_que_leen(text)'::regprocedure);
  def_e text := pg_get_functiondef('public.areas_que_editan(text)'::regprocedure);
  nuevo_l text := def_l;
  nuevo_e text := def_e;
begin
  if def_l not like '%''revisiones_cv''%' then
    nuevo_l := regexp_replace(nuevo_l, $re$(select case tabla)$re$,
      $r$\1$r$ || chr(10) || $r$    when 'revisiones_cv' then array['alumnos']$r$);
  end if;
  if def_e not like '%''revisiones_cv''%' then
    nuevo_e := regexp_replace(nuevo_e, $re$(select case tabla)$re$,
      $r$\1$r$ || chr(10) || $r$    when 'revisiones_cv' then array['alumnos']$r$);
  end if;
  if nuevo_l <> def_l then execute nuevo_l; end if;
  if nuevo_e <> def_e then execute nuevo_e; end if;
end $$;

-- Leer con ve(), escribir con edita(), como el seguimiento, los testimonios y los resells.
alter table public.revisiones_cv enable row level security;
drop policy if exists acceso_equipo_revisiones_cv on public.revisiones_cv;
drop policy if exists ver_revisiones_cv on public.revisiones_cv;
drop policy if exists crear_revisiones_cv on public.revisiones_cv;
drop policy if exists editar_revisiones_cv on public.revisiones_cv;
drop policy if exists borrar_revisiones_cv on public.revisiones_cv;
create policy ver_revisiones_cv on public.revisiones_cv for select to authenticated using ((select public.ve('revisiones_cv')));
create policy crear_revisiones_cv on public.revisiones_cv for insert to authenticated with check ((select public.edita('revisiones_cv')));
create policy editar_revisiones_cv on public.revisiones_cv for update to authenticated
  using ((select public.edita('revisiones_cv'))) with check ((select public.edita('revisiones_cv')));
create policy borrar_revisiones_cv on public.revisiones_cv for delete to authenticated using ((select public.edita('revisiones_cv')));

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'revisiones_cv') as columnas_de_19,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'revisiones_cv')                    as politicas_de_4,
  (select relrowsecurity from pg_class where oid = 'public.revisiones_cv'::regclass)                                as rls_activa,
  (select count(*) from public.revisiones_cv)                                                                       as revisiones,
  public.areas_que_leen('revisiones_cv')                                                                            as lee,
  public.areas_que_editan('revisiones_cv')                                                                          as edita;
