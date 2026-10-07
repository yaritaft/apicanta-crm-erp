-- nombre_corto(): la «ñ» salía «u» y la «ç» «n» — Apicanta ERP (estrés del 07/10)
--
-- La cadena de salida del translate() de nombre_corto() tenía una «u» de más (49 caracteres contra 48 de
-- entrada): «Núñez» daba «nuuez», «Peña» «peua». Como lo «suyo» de un closer se decide comparando el nombre del
-- anfitrión de Calendly con el de Equipo, un closer con «ñ» en su nombre escrito de otra manera en Calendly
-- («Agustin Nunez» / «Agustín Núñez») no se encontraba: no veía ninguna de sus llamadas. La app (que normaliza con
-- NFD) sí los emparejaba. Este archivo sólo reemplaza esa función; las que la llaman (miembro_de_nombre, son_mios)
-- no cambian. Está también corregida en tipos-cuenta.sql.
--
-- Idempotente (create or replace). No toca datos.

create or replace function public.nombre_corto(t text)
returns text
language sql immutable
as $$
  select array_to_string((regexp_split_to_array(trim(lower(translate(coalesce(t, ''),
    'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
    'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'))), '\s+'))[1:2], ' ');
$$;

-- diagnóstico: las cuatro tienen que dar la misma palabra, sin «u» de más
select public.nombre_corto('Núñez') as nunez, public.nombre_corto('Peña') as pena, public.nombre_corto('Françoise') as francoise, public.nombre_corto('Niño Pérez') as nino_perez;
