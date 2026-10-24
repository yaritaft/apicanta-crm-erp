-- ==================================================================
-- Consultas de los jueves (Lili, 24/10).
--
-- Los jueves a las 18 h es la clase de consultas generales. El alumno que
-- no puede ir deja su consulta antes; Yari (o Nahuel) la responde al
-- comienzo de la clase y el alumno mira la grabación. Hasta hoy era un
-- Google Form con una planilla; ahora:
--   - el alumno la deja en la app (/consulta, público, tipo Typeform) con su
--     código, el mismo del reporte semanal: se sabe quién es sin
--     preguntarle el nombre, el mail ni el celular;
--   - cada consulta es del jueves de la clase en que se responde (`fecha`);
--   - después de la clase, Yari, Nahuel o Lili cargan quién dio la clase y,
--     por cada consulta: respondida, no se respondió, o queda para la
--     próxima clase (pasa al jueves siguiente: `fecha` + 7, `postergada` + 1,
--     y `primeraFecha` recuerda cuándo la hizo);
--   - se ve en la ficha del alumno (Seguimiento).
-- La ven y la cargan los que ven y editan alumnos. La consulta pública entra
-- por el servidor (api/consultas/enviar) con la clave de servicio.
-- Se puede volver a correr.
-- ==================================================================

create table if not exists public.consultas_clase (
  id text primary key,
  -- El jueves de la clase en que se responde (si pasa a la próxima, se corre).
  fecha date not null,
  -- El jueves en que la hizo: no se mueve.
  "primeraFecha" date not null,
  "alumnoId" text references public.alumnos(id) on delete set null,
  nombre text not null default '',
  email text not null default '',
  telefono text not null default '',
  consulta text not null,
  estado text not null default 'recibida',
  postergada integer not null default 0,
  -- Quién dio la clase (Yari o Nahuel).
  responsable text,
  comentario text,
  origen text not null default 'formulario',
  "cargadoPor" text,
  "creadoEn" timestamptz not null default now(),
  "actualizadoEn" timestamptz not null default now(),
  constraint consultas_clase_estado check (estado in ('recibida', 'respondida', 'no_respondida')),
  constraint consultas_clase_origen check (origen in ('formulario', 'panel', 'google_form')),
  constraint consultas_clase_texto check (length(btrim(consulta)) > 0),
  constraint consultas_clase_fechas check ("primeraFecha" <= fecha)
);
create index if not exists consultas_clase_fecha_idx on public.consultas_clase (fecha desc);
create index if not exists consultas_clase_alumno_idx on public.consultas_clase ("alumnoId");

alter table public.consultas_clase enable row level security;
drop policy if exists consultas_clase_ver on public.consultas_clase;
create policy consultas_clase_ver on public.consultas_clase for select to authenticated using ((select public.ve('alumnos')));
drop policy if exists consultas_clase_cargar on public.consultas_clase;
create policy consultas_clase_cargar on public.consultas_clase for insert to authenticated with check ((select public.edita('alumnos')));
drop policy if exists consultas_clase_editar on public.consultas_clase;
create policy consultas_clase_editar on public.consultas_clase for update to authenticated
  using ((select public.edita('alumnos'))) with check ((select public.edita('alumnos')));
drop policy if exists consultas_clase_borrar on public.consultas_clase;
create policy consultas_clase_borrar on public.consultas_clase for delete to authenticated using ((select public.edita('alumnos')));
revoke all on public.consultas_clase from anon;
grant select, insert, update, delete on public.consultas_clase to authenticated;

-- Cuándo se tocó por última vez.
create or replace function public.consulta_clase_tocada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new."actualizadoEn" := now();
  return new;
end;
$$;
drop trigger if exists consultas_clase_tocada on public.consultas_clase;
create trigger consultas_clase_tocada before update on public.consultas_clase
  for each row execute function public.consulta_clase_tocada();

select count(*) as consultas from public.consultas_clase;
