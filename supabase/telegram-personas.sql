-- ==================================================================
-- Quién es quién en Telegram (Manu, 20/11).
--
-- Manu: «tenemos alumnos viejos que tenemos que expulsar, pero en Telegram cuesta
-- identificarlos: no todos se ponen su nombre y apellido». Hasta hoy la app sólo sabía el
-- id de Telegram de quien entraba con el link personal que ella misma generaba (193 accesos,
-- unos 50 alumnos); los 294 alumnos activos que ya estaban en los grupos de antes eran
-- anónimos y había que sacarlos a mano, buscándolos por nombre.
--
-- Telegram no deja buscar a nadie por su teléfono, pero el bot sí puede saber quién es
-- cada uno de tres maneras, y esta tabla las guarda todas:
--   · lo VE: cada persona que entra, sale o escribe en un grupo donde el bot es admin;
--   · se lo DICE: toca el link del bot y comparte su número (Telegram lo verifica: es el de
--     esa cuenta) o entra con su link personal (con el código del alumno);
--   · lo ATA una persona del equipo desde la ficha del alumno, con sugerencias por nombre.
--
-- telegram_personas: una fila por cuenta de Telegram vista, con el alumno al que corresponde
-- si ya se sabe. La escribe sólo el servidor (clave de servicio); la lee quien ve Alumnos.
--
-- telefonos_de_alumnos(): los teléfonos de cada alumno (ficha de Servicio, lead y contacto),
-- para cruzar el número que comparte quien toca el bot. Sólo el servidor la puede llamar.
--
-- Aditivo e idempotente: se puede volver a correr. No toca ninguna tabla que ya existía.
-- ==================================================================

do $$
begin
  if to_regclass('public.alumnos') is null or to_regclass('public.accesos_alumno') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan alumnos o accesos_alumno.';
  end if;
end $$;

create table if not exists public.telegram_personas (
  -- El id de usuario de Telegram (no cambia aunque cambie su nombre o su @usuario).
  id            text primary key,
  usuario       text,
  -- Nombre y apellido tal como los muestra Telegram (suele no ser el real).
  nombre        text not null default '',
  -- El teléfono que compartió con el bot, ya normalizado (código de país + número, sin signos).
  telefono      text,
  "alumnoId"    text references public.alumnos(id) on delete set null,
  -- Cómo se supo quién es: entró con su link personal (link), con el código del alumno en el
  -- link del bot (codigo), compartió un número que coincide con su ficha (telefono) o lo ató
  -- una persona del equipo (manual).
  vinculo       text check (vinculo in ('link', 'codigo', 'telefono', 'manual')),
  -- Alumnos que coinciden a medias (el mismo número en dos fichas, o sólo los últimos dígitos):
  -- no se atan solos, los decide una persona. [{ "alumnoId": "alu_…", "motivo": "varios" | "ultimos-digitos" }]
  posibles      jsonb not null default '[]'::jsonb,
  -- Los grupos donde se lo vio adentro: { "<chatId>": "<cuándo>" }.
  grupos        jsonb not null default '{}'::jsonb,
  -- Cómo se lo vio la primera vez: con un link de la app, con otro link, escribiendo, o en el chat del bot.
  "entroPor"    text check ("entroPor" in ('link', 'otro', 'mensaje', 'bot')),
  -- Administra el grupo o es del equipo: no es un alumno y no hay que identificarlo.
  equipo        boolean not null default false,
  "primerVisto" timestamptz not null default now(),
  "ultimoVisto" timestamptz not null default now(),
  "vinculadoEn" timestamptz,
  "vinculadoPor" text
);
create index if not exists telegram_personas_alumno on public.telegram_personas ("alumnoId") where "alumnoId" is not null;
create index if not exists telegram_personas_telefono on public.telegram_personas (telefono) where telefono is not null;

alter table public.telegram_personas enable row level security;
drop policy if exists ver_telegram_personas on public.telegram_personas;
create policy ver_telegram_personas on public.telegram_personas for select to authenticated using (
  (select public.ve('alumnos')));

-- Lo que ya sabíamos: quien entró con el link personal de la app dejó su id en el acceso.
-- Se pasa a la tabla nueva sin tocar los accesos. Si un mismo usuario figura en dos alumnos
-- (una persona cargada dos veces), vale el acceso más reciente.
insert into public.telegram_personas (id, usuario, "alumnoId", vinculo, grupos, "entroPor", "primerVisto", "ultimoVisto", "vinculadoEn", "vinculadoPor")
select
  x.id,
  (array_agg(x.usuario order by x.cuando desc) filter (where x.usuario is not null))[1],
  (array_agg(x."alumnoId" order by x.cuando desc))[1],
  'link',
  coalesce(jsonb_object_agg(x.recurso, to_char(x.cuando at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) filter (where x.estado = 'entro'), '{}'::jsonb),
  'link',
  min(x.cuando), max(x.cuando), min(x.cuando), 'Accesos de la app'
from (
  select a.externo ->> 'telegramUserId' as id,
         nullif(a.externo ->> 'telegramUsuario', '') as usuario,
         a."alumnoId", a.recurso, a.estado, a."actualizadoEn" as cuando
  from public.accesos_alumno a
  where a.plataforma = 'telegram' and a.externo ? 'telegramUserId'
    and exists (select 1 from public.alumnos al where al.id = a."alumnoId")
) x
group by x.id
on conflict (id) do nothing;

-- Los teléfonos de cada alumno, de las tres fichas donde puede estar. Una fila por alumno.
create or replace function public.telefonos_de_alumnos()
returns table ("alumnoId" text, nombre text, estado text, pais text, telefonos text[])
language sql
stable
security definer
set search_path = public
as $$
  select a.id,
         coalesce(a.nombre, ''),
         coalesce(a.estado, ''),
         coalesce(nullif(a.pais, ''), nullif(c.pais, ''), nullif(l.pais, ''), ''),
         array_remove(array[nullif(btrim(s.telefono), ''), nullif(btrim(l.telefono), ''), nullif(btrim(c.telefono), '')], null)
  from public.alumnos a
  left join public.seguimiento_alumnos s on s."alumnoId" = a.id
  left join public.leads l on l.id = a."leadId"
  left join public.contactos c on c.id = l."contactoId"
  order by a.id
$$;
revoke all on function public.telefonos_de_alumnos() from public, anon, authenticated;
grant execute on function public.telefonos_de_alumnos() to service_role;

-- Diagnóstico
select
  (select relrowsecurity from pg_class where oid = 'public.telegram_personas'::regclass) as rls,
  (select count(*) from public.telegram_personas) as personas,
  (select count(*) from public.telegram_personas where "alumnoId" is not null) as atadas;
