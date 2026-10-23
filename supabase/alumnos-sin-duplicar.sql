-- ==================================================================
-- Un alumno por persona, aunque lo cargue Lili a mano primero (22/10).
--
-- Los closers todavía no usan la app: Lili carga a mano a los que ya
-- compraron ("no pasó por una venta"). Cuando el closer registra la venta,
-- su app crea el alumno de esa venta, pero el closer no ve a los alumnos
-- de servicio, así que no puede saber que ya estaba: quedaba dos veces
-- (Aristóteles). La app ya lo busca por mail o teléfono y nombre
-- (lib/alumnos.ts → alumnoDeVenta); esto hace lo mismo en la base, que ve a
-- todos: si llega un alumno con venta y ya hay uno SIN venta de la misma
-- persona, se le pega la venta al que estaba y el nuevo no se crea.
--
-- La misma persona: la misma persona del CRM (el mismo lead o el mismo
-- contacto: Lili lo da de alta atado a su llamada, «esperando la venta»),
-- el mismo mail (clave_email, de personas-unicas.sql) o el mismo teléfono
-- (últimos 8 dígitos) y dos palabras del nombre. Al unir, se le saca la
-- marca de «esperando la venta» (extra.ventaPendiente).
-- Se puede volver a correr.
-- ==================================================================

create or replace function public.palabras_nombre(n text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct p), '{}')
  from regexp_split_to_table(lower(translate(coalesce(n, ''), 'áéíóúüñÁÉÍÓÚÜÑàèìòù', 'aeiouunaeiouunaeiou')), '[^a-z]+') p
  where length(p) >= 3;
$$;

create or replace function public.telefono_de_alumno(a public.alumnos)
returns text
language sql
stable
set search_path = public
as $$
  select right(regexp_replace(coalesce(
    nullif((select s.telefono from seguimiento_alumnos s where s."alumnoId" = a.id limit 1), ''),
    (select coalesce(nullif(c.telefono, ''), l.telefono) from leads l left join contactos c on c.id = l."contactoId" where l.id = a."leadId" limit 1),
    ''), '\D', '', 'g'), 8);
$$;

create or replace function public.alumno_sin_duplicar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ya public.alumnos;
  tel text := public.telefono_de_alumno(new);
begin
  if new."ventaId" is null then return new; end if;
  select a.* into ya from alumnos a
  where a.id <> new.id
    and (a."ventaId" is null or a."ventaId" = new."ventaId")
    and (
      (new."leadId" is not null and a."leadId" is not null and (
        a."leadId" = new."leadId"
        or exists (select 1 from leads la join leads lb on coalesce(la."contactoId", la.id) = coalesce(lb."contactoId", lb.id)
                   where la.id = a."leadId" and lb.id = new."leadId")))
      or (public.clave_email(new.email) <> '' and public.clave_email(a.email) = public.clave_email(new.email))
      or (length(tel) = 8 and public.telefono_de_alumno(a) = tel
          and (select count(*) from unnest(public.palabras_nombre(a.nombre)) x where x = any(public.palabras_nombre(new.nombre))) >= 2)
    )
  order by (a."ventaId" = new."ventaId") desc nulls last, a."creadoEn"
  limit 1;
  if ya.id is null then return new; end if;
  update alumnos set "ventaId" = new."ventaId", "leadId" = coalesce(ya."leadId", new."leadId"),
    extra = coalesce(ya.extra, '{}'::jsonb) - 'ventaPendiente' where id = ya.id;
  insert into actividad (id, accion, actor, entidad, "entidadId", titulo, fecha, detalle)
  values ('act_alu_' || substr(md5(new.id || ya.id), 1, 12), 'actualizo', 'Apicanta', 'alumno', ya.id, ya.nombre, now(),
    'La venta se sumó a su ficha de servicio (ya estaba cargado a mano): no se creó otro alumno.')
  on conflict (id) do nothing;
  return null;
end;
$$;

drop trigger if exists alumno_sin_duplicar on public.alumnos;
create trigger alumno_sin_duplicar before insert on public.alumnos
  for each row execute function public.alumno_sin_duplicar();
