-- ==================================================================
-- Reglas de comisión con historia (Yari, 20/11/2026):
--   «Que en cada momento de la facturación te calcule las cosas como se
--   calculaban en ese momento.»
--
-- 1. equipo."comisionHistorial": los % de cada persona con sus fechas.
--    Finanzas calcula cada cobro con el % que valía ese día. Lo escribe la
--    app (lib/honorarios.ts, historialParaFinanzas) al guardar lo que cobra
--    alguien; sin dato, el % de hoy para todos los días (como antes).
-- 2. honorarios_versiones: cada vez que cambian (o se borran) las reglas de
--    alguien, la versión anterior queda guardada, venga el cambio de la app,
--    de un SQL a mano o de donde sea. Nadie la puede editar ni borrar por la
--    API: la escribe sólo el disparador. La leen los dueños y quien tiene el
--    permiso «Liquidación».
-- 3. Las versiones que ya estaban en los respaldos (desde el 24/09) se
--    copian a honorarios_versiones, para no perder lo que ya se sabía.
--
-- Aditivo: no borra ni cambia datos. Se puede correr más de una vez.
-- ==================================================================

begin;

-- ---------- 1. La historia de % que usa Finanzas ----------
alter table public.equipo add column if not exists "comisionHistorial" jsonb;
comment on column public.equipo."comisionHistorial" is
  'Los % de comisión con sus fechas ([{desde?, hasta?, general, servicios}]). Lo escribe la app desde honorarios; Finanzas calcula cada cobro con el del día.';

-- ---------- 2. Cada versión de las reglas, guardada ----------
create table if not exists public.honorarios_versiones (
  id bigserial primary key,
  "honorarioId" text not null,
  "miembroId" text,
  conceptos jsonb not null,
  "actualizadoEn" timestamptz,
  "actualizadoPor" text,
  "guardadaEn" timestamptz not null default now(),
  "guardadaPor" text,
  motivo text not null default 'cambio' check (motivo in ('cambio', 'borrado', 'respaldo'))
);
create index if not exists honorarios_versiones_miembro on public.honorarios_versiones ("miembroId", "guardadaEn" desc);
comment on table public.honorarios_versiones is
  'Cada versión anterior de lo que cobra alguien (honorarios.conceptos). La escribe sólo el disparador honorarios_guarda_version.';

create or replace function public.guardar_version_de_honorarios() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.conceptos is not distinct from new.conceptos then
    return new;
  end if;
  insert into public.honorarios_versiones ("honorarioId", "miembroId", conceptos, "actualizadoEn", "actualizadoPor", "guardadaPor", motivo)
  values (old.id, old."miembroId", old.conceptos, old."actualizadoEn", old."actualizadoPor",
          coalesce(nullif(auth.jwt() ->> 'email', ''), current_user), case when tg_op = 'DELETE' then 'borrado' else 'cambio' end);
  return coalesce(new, old);
end $$;

drop trigger if exists honorarios_guarda_version on public.honorarios;
create trigger honorarios_guarda_version
  after update or delete on public.honorarios
  for each row execute function public.guardar_version_de_honorarios();

alter table public.honorarios_versiones enable row level security;
drop policy if exists ver_versiones_de_honorarios on public.honorarios_versiones;
create policy ver_versiones_de_honorarios on public.honorarios_versiones
  for select to authenticated
  using ((select public.es_dueno()) or (select public.nivel_area('liquidacion')) >= 1);
-- Sin políticas de insert, update ni delete: por la API no se escribe ni se borra la historia.
revoke insert, update, delete on public.honorarios_versiones from anon, authenticated;

-- ---------- 3. Lo que ya estaba en los respaldos ----------
do $$
declare
  t record;
  q text;
begin
  for t in
    select c.table_name,
           bool_or(c.column_name = 'id') as tiene_id,
           bool_or(c.column_name = 'actualizadoEn') as tiene_fecha,
           bool_or(c.column_name = 'fila') as es_fila
    from information_schema.columns c
    where c.table_schema = 'respaldo'
      and (c.table_name like '%honorarios%')
    group by c.table_name
  loop
    if t.es_fila then
      q := format($f$
        insert into public.honorarios_versiones ("honorarioId", "miembroId", conceptos, "actualizadoEn", "actualizadoPor", "guardadaEn", "guardadaPor", motivo)
        select r.fila->>'id', r.fila->>'miembroId', r.fila->'conceptos', (r.fila->>'actualizadoEn')::timestamptz, r.fila->>'actualizadoPor',
               coalesce((r.fila->>'actualizadoEn')::timestamptz, now()), %L, 'respaldo'
        from respaldo.%I r
        where r.fila ? 'conceptos'
          and not exists (select 1 from public.honorarios_versiones v
                          where v.motivo = 'respaldo' and v."honorarioId" = r.fila->>'id' and v.conceptos = r.fila->'conceptos')$f$,
        'respaldo.' || t.table_name, t.table_name);
    else
      q := format($f$
        insert into public.honorarios_versiones ("honorarioId", "miembroId", conceptos, "actualizadoEn", "actualizadoPor", "guardadaEn", "guardadaPor", motivo)
        select %s, r."miembroId", r.conceptos::jsonb, %s, %s, coalesce(%s, now()), %L, 'respaldo'
        from respaldo.%I r
        where r.conceptos is not null
          and not exists (select 1 from public.honorarios_versiones v
                          where v.motivo = 'respaldo' and v."honorarioId" = %s and v.conceptos = r.conceptos::jsonb)$f$,
        case when t.tiene_id then 'r.id' else '''hon_'' || r."miembroId"' end,
        case when t.tiene_fecha then 'r."actualizadoEn"::timestamptz' else 'null::timestamptz' end,
        case when t.tiene_fecha then 'r."actualizadoPor"' else 'null::text' end,
        case when t.tiene_fecha then 'r."actualizadoEn"::timestamptz' else 'null::timestamptz' end,
        'respaldo.' || t.table_name, t.table_name,
        case when t.tiene_id then 'r.id' else '''hon_'' || r."miembroId"' end);
    end if;
    execute q;
  end loop;
end $$;

commit;
