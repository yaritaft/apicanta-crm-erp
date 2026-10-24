-- ==================================================================
-- Simulacros de entrevista de los martes (Lili, 23/10).
--
-- Los martes Yari o Nahuel le toman un simulacro de entrevista a 1, 2 o 3
-- alumnos. Es condición del contrato hacer al menos uno. Hasta hoy se
-- anotaban en un Google Form; ahora:
--   - el alumno se inscribe en la app (/simulacro, público, tipo Typeform):
--     una fila por inscripción, del martes de la clase;
--   - la base la ata sola al alumno por el teléfono (los últimos 8 dígitos,
--     como alumnos-sin-duplicar.sql);
--   - después de la clase, Yari, Nahuel o Lili cargan cómo fue: se hizo (con
--     el tipo de entrevista, las tecnologías y un comentario), no se
--     presentó, no se preparó u otro motivo. Eso se ve en la ficha.
-- La ven y la cargan los que ven y editan alumnos. La inscripción pública
-- entra por el servidor (api/simulacros/inscripcion) con la clave de servicio.
-- Se puede volver a correr.
-- ==================================================================

create table if not exists public.simulacros (
  id text primary key,
  fecha date not null,
  nombre text not null,
  telefono text not null default '',
  stack text not null default '',
  "tipoPedido" text not null default '',
  preparado boolean not null default false,
  "alumnoId" text references public.alumnos(id) on delete set null,
  origen text not null default 'formulario',
  estado text not null default 'inscripto',
  motivo text,
  "tipoTomado" text,
  tecnologias text,
  comentario text,
  responsable text,
  "cargadoPor" text,
  "creadoEn" timestamptz not null default now(),
  "actualizadoEn" timestamptz not null default now(),
  constraint simulacros_estado check (estado in ('inscripto', 'hecho', 'no_se_presento', 'no_se_preparo', 'otro')),
  constraint simulacros_origen check (origen in ('formulario', 'panel'))
);
create index if not exists simulacros_fecha_idx on public.simulacros (fecha desc);
create index if not exists simulacros_alumno_idx on public.simulacros ("alumnoId");

alter table public.simulacros enable row level security;
drop policy if exists simulacros_ver on public.simulacros;
create policy simulacros_ver on public.simulacros for select to authenticated using ((select public.ve('alumnos')));
drop policy if exists simulacros_cargar on public.simulacros;
create policy simulacros_cargar on public.simulacros for insert to authenticated with check ((select public.edita('alumnos')));
drop policy if exists simulacros_editar on public.simulacros;
create policy simulacros_editar on public.simulacros for update to authenticated
  using ((select public.edita('alumnos'))) with check ((select public.edita('alumnos')));
drop policy if exists simulacros_borrar on public.simulacros;
create policy simulacros_borrar on public.simulacros for delete to authenticated using ((select public.edita('alumnos')));
revoke all on public.simulacros from anon;
grant select, insert, update, delete on public.simulacros to authenticated;

-- Atar al alumno por el teléfono, si nadie lo eligió: el activo primero, el que tiene venta primero.
create or replace function public.simulacro_atar_alumno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tel text := right(regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g'), 8);
begin
  if new."alumnoId" is null and length(tel) = 8 then
    select a.id into new."alumnoId"
    from alumnos a
    where public.telefono_de_alumno(a) = tel
    order by (a.estado = 'activo') desc, (a."ventaId" is not null) desc, a.inicio desc nulls last
    limit 1;
  end if;
  new."actualizadoEn" := now();
  return new;
end;
$$;
revoke all on function public.simulacro_atar_alumno() from public, anon, authenticated;

drop trigger if exists simulacros_atar_alumno on public.simulacros;
create trigger simulacros_atar_alumno before insert or update of telefono, "alumnoId" on public.simulacros
  for each row execute function public.simulacro_atar_alumno();
