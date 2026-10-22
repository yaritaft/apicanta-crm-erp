-- ==================================================================
-- La misma persona con otro mail (lib/duplicados.ts, 22/10).
--
-- La entrada de Calendly buscaba a la persona sólo por mail: con otro
-- mail nacía otra ficha. Ahora, si el mail no está, busca por teléfono
-- (y el nombre lo compara la app). Esta función le da los candidatos:
-- los contactos cuyos últimos 8 dígitos del teléfono son esos, sin
-- importar cómo esté escrito («+57 311 3652301», «57 3113652301»…).
--
-- Sólo la usa el servidor (clave de servicio). Se puede volver a correr.
-- ==================================================================

create or replace function public.contactos_por_telefono(ultimos text)
returns setof public.contactos
language sql
stable
set search_path = public
as $$
  select *
  from public.contactos
  where length(ultimos) = 8
    and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 8) = ultimos
  limit 20;
$$;

revoke all on function public.contactos_por_telefono(text) from public, anon, authenticated;
grant execute on function public.contactos_por_telefono(text) to service_role;
