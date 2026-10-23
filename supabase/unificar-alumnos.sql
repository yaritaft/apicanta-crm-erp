-- ==================================================================
-- Unir dos alumnos que son la misma persona (Lili, 23/10).
--
-- Mariano cargó la venta de Saul Rivas Martínez con otro nombre y otro mail
-- («Edgar»): la venta creó un alumno nuevo y Saul (cargado a mano, con todo
-- lo de Servicio) quedó sin venta. Como el nombre no coincide, nada los une
-- solo (alumnos-sin-duplicar.sql pide dos palabras del nombre); la app los
-- muestra juntos (mismo teléfono o mail) y Lili decide.
--
-- unificar_alumnos(queda, otro, corregir_persona, quien), en una sola
-- transacción:
--   - lo que cuelga del otro (seguimiento, accesos, contratos, reportes,
--     código del formulario, CV, sesiones, testimonios, transacciones) pasa
--     al que queda; si los dos tienen el mismo dato único, vale el del que
--     queda; el seguimiento se combina (lo vacío del que queda se completa
--     con lo del otro);
--   - lo vacío del que queda (mail, país, plan, cohorte, cuota) se completa
--     con lo del otro, y el nombre queda el más completo («Guillermo Basoco»
--     pasa a «Guillermo Sánchez Basoco»);
--   - el que queda se lleva la venta y el lead del otro;
--   - con corregir_persona, la persona de esa venta (contacto, oportunidades
--     y la venta) toma el nombre y el mail del que queda (el closer los
--     cargó mal); el mail viejo queda como otro mail;
--   - el otro se borra; queda una copia en extra.alumnosUnificados.
-- Sólo la usa el servidor (api/alumnos/unificar). Se puede volver a correr.
-- ==================================================================

create or replace function public.unificar_alumnos(p_queda text, p_otro text, p_corregir_persona boolean, p_quien text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q alumnos;
  o alumnos;
  copia jsonb;
  sq jsonb;
  so jsonb;
  combinado jsonb;
  lead_id text;
  contacto_id text;
  mail_nuevo text;
  mail_viejo text;
  resumen text;
begin
  select * into q from alumnos where id = p_queda for update;
  select * into o from alumnos where id = p_otro for update;
  if q.id is null or o.id is null then raise exception 'No encuentro uno de los dos alumnos.'; end if;
  if q.id = o.id then raise exception 'Es el mismo alumno.'; end if;
  if q."ventaId" is not null and o."ventaId" is not null and q."ventaId" <> o."ventaId" then
    raise exception 'Los dos tienen su propia venta: son dos servicios, no se unen.';
  end if;

  copia := to_jsonb(o) || jsonb_build_object('seguimiento', (select to_jsonb(s) from seguimiento_alumnos s where s."alumnoId" = o.id), 'unificadoEn', now(), 'por', p_quien);

  /* El seguimiento: si los dos tienen, se combinan (lo vacío del que queda se completa con lo del otro). */
  select to_jsonb(x) into sq from seguimiento_alumnos x where x."alumnoId" = q.id;
  select to_jsonb(x) into so from seguimiento_alumnos x where x."alumnoId" = o.id;
  if sq is not null and so is not null then
    combinado := so || (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(sq) e(k, v)
                        where v not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb))
                 || jsonb_build_object('id', sq ->> 'id', 'alumnoId', q.id);
    delete from seguimiento_alumnos where "alumnoId" in (q.id, o.id);
    insert into seguimiento_alumnos select * from jsonb_populate_record(null::seguimiento_alumnos, combinado);
  else
    update seguimiento_alumnos set "alumnoId" = q.id, id = 'seg_' || q.id where "alumnoId" = o.id;
  end if;

  /* Lo único repetido: vale lo del que queda. */
  delete from reporte_codigos r where r."alumnoId" = o.id and exists (select 1 from reporte_codigos x where x."alumnoId" = q.id);
  update reporte_codigos set "alumnoId" = q.id where "alumnoId" = o.id;
  delete from accesos_alumno a where a."alumnoId" = o.id
    and exists (select 1 from accesos_alumno b where b."alumnoId" = q.id and b.plataforma = a.plataforma and b.recurso = a.recurso);
  update accesos_alumno set "alumnoId" = q.id where "alumnoId" = o.id;
  delete from reportes r where r."alumnoId" = o.id and exists (select 1 from reportes x where x."alumnoId" = q.id and x."semanaDel" = r."semanaDel");
  update reportes set "alumnoId" = q.id where "alumnoId" = o.id;
  update contratos set "alumnoId" = q.id where "alumnoId" = o.id;
  update revisiones_cv set "alumnoId" = q.id where "alumnoId" = o.id;
  update sesiones set "alumnoId" = q.id where "alumnoId" = o.id;
  update testimonios set "alumnoId" = q.id where "alumnoId" = o.id;
  update transacciones set "alumnoId" = q.id where "alumnoId" = o.id;

  lead_id := coalesce(o."leadId", q."leadId");
  delete from alumnos where id = o.id;
  update alumnos set
    "ventaId" = coalesce(q."ventaId", o."ventaId"),
    "leadId" = coalesce(q."leadId", o."leadId"),
    nombre = case when public.palabras_nombre(q.nombre) <@ public.palabras_nombre(o.nombre) then o.nombre else q.nombre end,
    email = coalesce(nullif(q.email, ''), o.email),
    pais = coalesce(nullif(q.pais, ''), o.pais),
    plan = coalesce(nullif(q.plan, ''), o.plan),
    cohorte = coalesce(nullif(q.cohorte, ''), o.cohorte),
    "cuotaMensual" = coalesce(nullif(q."cuotaMensual", 0), o."cuotaMensual"),
    moneda = coalesce(q.moneda, o.moneda),
    extra = (coalesce(q.extra, '{}'::jsonb) - 'ventaPendiente')
      || jsonb_build_object('alumnosUnificados', coalesce(q.extra -> 'alumnosUnificados', '[]'::jsonb) || jsonb_build_array(copia))
  where id = q.id;

  /* La persona de la venta, con el nombre y el mail del que queda (ya completado arriba). */
  select * into q from alumnos where id = q.id;
  if p_corregir_persona and lead_id is not null then
    select coalesce(l."contactoId", l.id) into contacto_id from leads l where l.id = lead_id;
    mail_nuevo := clave_email(q.email);
    select c.email into mail_viejo from contactos c where c.id = contacto_id;
    /* Si el mail del que queda ya es de otra persona, se deja el que estaba (la base no deja dos fichas con el mismo mail). */
    if mail_nuevo = '' or exists (select 1 from contactos c where c.id <> contacto_id and clave_email(c.email) = mail_nuevo) then
      mail_nuevo := null;
    end if;
    update contactos c set
      nombre = q.nombre,
      email = coalesce(mail_nuevo, c.email),
      extra = case when mail_nuevo is not null and clave_email(mail_viejo) <> '' and clave_email(mail_viejo) <> mail_nuevo
        then coalesce(c.extra, '{}'::jsonb) || jsonb_build_object('emails', coalesce(c.extra -> 'emails', '[]'::jsonb) || to_jsonb(clave_email(mail_viejo)))
        else c.extra end
    where c.id = contacto_id;
    update leads set nombre = q.nombre, email = coalesce(mail_nuevo, email)
    where coalesce("contactoId", id) = contacto_id;
    update ventas set "contactoNombre" = q.nombre
    where "contactoId" in (select id from leads where coalesce("contactoId", id) = contacto_id);
  end if;

  resumen := format('Se unió con «%s»%s: la venta y lo de servicio quedaron en esta ficha%s.',
    o.nombre, case when coalesce(o.email, '') <> '' then ' (' || o.email || ')' else '' end,
    case when p_corregir_persona then ' y la persona de la venta tomó este nombre y este mail' else '' end);
  insert into actividad (id, accion, actor, entidad, "entidadId", titulo, fecha, detalle)
  values ('act_unalu_' || substr(md5(q.id || o.id || now()::text), 1, 12), 'actualizo', coalesce(nullif(p_quien, ''), 'Apicanta'), 'alumno', q.id, q.nombre, now(), resumen);

  return jsonb_build_object('queda', q.id, 'borrado', o.id, 'resumen', resumen, 'contactoId', contacto_id);
end;
$$;

revoke all on function public.unificar_alumnos(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.unificar_alumnos(text, text, boolean, text) to service_role;

-- El closer ve sólo lo suyo: además de los contactos, persona_existente avisa si el teléfono ya es de un ALUMNO sin venta
-- (un alumno importado o cargado a mano, que no tiene contacto): «ese teléfono es de Saul Rivas Martínez».
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
  union
  select a.id, a.nombre, 'alumno'::text
  from alumnos a, pedido p
  where (select edita('ventas') or edita('leads'))
    and a."ventaId" is null
    and ((length(p.tel) = 8 and public.telefono_de_alumno(a) = p.tel)
      or (p.mail like '%@%' and clave_email(a.email) = p.mail))
  limit 6;
$$;

revoke all on function public.persona_existente(text, text) from public, anon;
grant execute on function public.persona_existente(text, text) to authenticated, service_role;
