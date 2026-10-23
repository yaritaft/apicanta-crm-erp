-- ==================================================================
-- Una persona, una ficha (22/10; lib/duplicados.ts).
--
-- Juan Camilo quedó dos veces porque cada entrada buscaba a la persona
-- sólo por su mail y él usó dos. La app ya busca por mail o por teléfono
-- y nombre en todas las entradas; esto es la traba de la base:
--
-- 1. clave_email(): el mail como lo compara la app (sin mayúsculas,
--    espacios ni caracteres invisibles), igual que claveEmail().
-- 2. persona_existente(): el closer ve sólo sus contactos, así que antes de
--    crear un cliente nuevo le pregunta a la base si ese mail o teléfono ya
--    es de alguien. Devuelve sólo el id y el nombre, y sólo a quien edita
--    Ventas o Leads.
-- 3. Un índice único: dos fichas no pueden tener el mismo mail. Se crea
--    DESPUÉS de unificar las que ya estaban repetidas (si no, falla).
--
-- Se puede volver a correr.
-- ==================================================================

create or replace function public.clave_email(e text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(e, ''), '[​-‏‪-‮⁠-⁤﻿]', '', 'g')));
$$;

create or replace function public.persona_existente(p_email text, p_telefono text)
returns table (id text, nombre text, por text)
language sql
stable
security definer
set search_path = public
as $$
  with pedido as (
    select clave_email(p_email) as mail, right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 8) as tel
  )
  select c.id, c.nombre, 'email'::text
  from contactos c, pedido p
  where (select edita('ventas') or edita('leads'))
    and p.mail like '%@%'
    and (clave_email(c.email) = p.mail or coalesce(c.extra->'emails', '[]'::jsonb) ? p.mail)
  union
  select c.id, c.nombre, 'telefono'::text
  from contactos c, pedido p
  where (select edita('ventas') or edita('leads'))
    and length(p.tel) = 8
    and right(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g'), 8) = p.tel
  limit 5;
$$;

revoke all on function public.persona_existente(text, text) from public, anon;
grant execute on function public.persona_existente(text, text) to authenticated, service_role;

-- 3. La traba (correr después de unificar las repetidas):
create unique index if not exists contactos_email_unico
  on public.contactos (public.clave_email(email))
  where public.clave_email(email) <> '';
