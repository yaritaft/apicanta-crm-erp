-- Pipeline de servicio de alumnos — Apicanta ERP
--
-- Pedido de Juanchi: "que haya un pipeline de alumnos, tipo venta nueva,
-- onboarding, servicio, etc, y se puedan agregar más o sacar stages y mover
-- en un pipeline los clientes". Y "que cuando se carga una venta se cree el
-- alumno automáticamente".
--
-- Tres cosas:
--   1. `etapas_servicio`: las columnas de ese tablero (con RLS).
--   2. En `alumnos`, en qué etapa está cada uno ("etapaServicioId") y qué
--      venta lo trajo ("ventaId").
--   3. Las etapas por defecto, y a los alumnos que ya existen se los ubica.
--
-- Convención de la app: id de texto, columnas en camelCase entre comillas,
-- igual que los campos de types.ts.
--
-- Idempotente: se puede correr de nuevo sin duplicar ni pisar nada. Hasta que
-- se corra, la app sigue andando: el tablero usa las etapas por defecto y lo
-- que se mueva no se guarda en la nube.

do $$ begin
  if to_regclass('public.ventas') is null or to_regclass('public.alumnos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp).';
  end if;
end $$;

-- ---------- etapas_servicio ----------
create table if not exists public.etapas_servicio (
  id          text primary key,
  nombre      text not null,
  orden       integer not null default 0,
  -- La variante del Badge de la app: info, brand, accent, warning, success,
  -- danger o neutral. Las mismas que usan las etapas de ventas.
  color       text not null default 'brand',
  "creadoEn"  timestamptz not null default now()
);

-- MISMA política que el resto de las tablas. Supabase no activa RLS en una
-- tabla creada por SQL: sin esto la clave pública, que viaja dentro del
-- JavaScript de la app, alcanzaría para leerla y escribirla.
alter table public.etapas_servicio enable row level security;

drop policy if exists acceso_equipo_etapas_servicio on public.etapas_servicio;
create policy acceso_equipo_etapas_servicio on public.etapas_servicio
  for all to authenticated
  using (public.puede_entrar()) with check (public.puede_entrar());

alter table public.etapas_servicio drop constraint if exists etapas_servicio_color_ck;
alter table public.etapas_servicio add constraint etapas_servicio_color_ck
  check (color in ('info', 'brand', 'accent', 'warning', 'success', 'danger', 'neutral'));

-- Las etapas por defecto, con los mismos ids que la semilla de la app
-- (ETAPAS_SERVICIO en src/lib/seed.ts). Sólo si la tabla está vacía: si
-- alguien ya borró o renombró una desde Ajustes, correr esto de nuevo no la
-- resucita.
insert into public.etapas_servicio (id, nombre, orden, color)
select v.id, v.nombre, v.orden, v.color
from (values
  ('ets_nueva',      'Venta nueva',       0, 'info'),
  ('ets_onboarding', 'Onboarding',        1, 'accent'),
  ('ets_servicio',   'En servicio',       2, 'brand'),
  ('ets_trabajo',    'Consiguió trabajo', 3, 'success'),
  ('ets_finalizado', 'Finalizado',        4, 'neutral')
) as v(id, nombre, orden, color)
where not exists (select 1 from public.etapas_servicio)
on conflict (id) do nothing;

-- ---------- alumnos ----------
-- Sin FK, a propósito. La siembra de la app escribe `alumnos` antes que
-- `ventas` (store.ts, ordenDeSiembra), así que una FK a ventas rompería
-- "Volver a los datos de ejemplo" y la restauración de un respaldo. Y la app
-- ya tolera los huecos: un alumno con una etapa que no existe se dibuja en la
-- primera columna, y una venta enlazada que se borró se avisa en su ficha.
alter table public.alumnos
  add column if not exists "etapaServicioId" text,
  add column if not exists "ventaId"         text;

create index if not exists alumnos_venta_idx on public.alumnos ("ventaId");

-- Los alumnos de antes no tienen etapa: se los ubica por su estado. Los que
-- terminaron o se fueron, en Finalizado; el resto, En servicio (ya estaban
-- cursando). Si esas etapas no existen, en la primera. Sólo toca a los que no
-- tienen etapa: correrlo de nuevo no mueve a nadie que ya se haya movido.
update public.alumnos a
set "etapaServicioId" = coalesce(
  case when a.estado in ('graduado', 'baja')
    then (select id from public.etapas_servicio where id = 'ets_finalizado')
    else (select id from public.etapas_servicio where id = 'ets_servicio')
  end,
  (select id from public.etapas_servicio order by orden, id limit 1)
)
where a."etapaServicioId" is null;

-- Y la venta que los trajo: la primera venta de su lead. `ventas."contactoId"`
-- guarda el id del lead, que es lo que el alumno tiene en "leadId".
update public.alumnos a
set "ventaId" = (
  select v.id from public.ventas v
  where v."contactoId" = a."leadId"
  order by v.fecha, v.id
  limit 1
)
where a."ventaId" is null
  and exists (select 1 from public.ventas v where v."contactoId" = a."leadId");

-- ---------- diagnóstico ----------
select
  (select count(*) from public.etapas_servicio)                                  as etapas,
  (select count(*) from public.alumnos)                                          as alumnos,
  (select count(*) from public.alumnos where "etapaServicioId" is not null)     as alumnos_con_etapa,
  (select count(*) from public.alumnos where "ventaId" is not null)             as alumnos_con_venta,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'etapas_servicio'
      and policyname = 'acceso_equipo_etapas_servicio')                         as politica_de_1,
  -- Tiene que dar true. Si da false, la tabla está abierta: no usar la app
  -- hasta arreglarlo.
  (select relrowsecurity from pg_class where oid = 'public.etapas_servicio'::regclass) as rls_activo;
