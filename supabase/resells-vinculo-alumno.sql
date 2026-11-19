-- ==================================================================
-- Cada llamada de resell sabe de qué alumno es (Lili, 19/11: «Nicolás González está en resell el 6/10, pero al hacer clic en
-- su ficha me dice "no encontramos a esta persona", y si lo busco en Alumnos su ficha no tiene vinculada la llamada»).
--
-- Qué pasó. Nicolás agendó el resell con nicogmartres1@gmail.com y es alumno con nicogmartres1@hotmail.com: la misma persona (el
-- alumno cuelga de su contacto por "leadId"), con dos mails. La app (lib/clientes-cs.ts, filasResells) y cinco funciones de la base
-- unían la llamada con el alumno SÓLO por mail igual, así que:
--   · en la lista de resells no había alumno → el clic abría la ficha por el id de la LLAMADA, y la cuenta de Customer Success no
--     puede leer las llamadas (sesiones lee crm, leads, webinars, marketing y ventas, no alumnos): «No encontramos a esta persona»;
--   · en la ficha del alumno, «Llamadas de resell» sale de filasResells: sin vínculo, vacía;
--   · los disparadores que pasan lo del resell al testimonio (resell_testimonio_a_ficha, resell_agenda_a_testimonio), el aviso al
--     cerrar y la marca de «caso de éxito» tampoco lo encontraban: el testimonio de ese alumno no se enteraba de la llamada.
-- Eran 14 de 95 resells (6 con la persona en la base, 3 con la llamada pero sin alumno, 5 sin nada).
--
-- Raíz. «De quién es esta llamada» se recalculaba en cada lugar con la misma regla corta (mail igual). Ahora se resuelve UNA vez,
-- en la base, con todos los caminos (el mail del alumno, los otros mails que tiene anotados, la persona por mail y la llamada), y se
-- GUARDA en la fila: resells."alumnoId" y resells."contactoId". Lo calcula un disparador (la escriba el cron de Calendly, la app o un
-- importador, queda igual) y cuando aparece un alumno nuevo se atan las llamadas que lo estaban esperando. Las funciones que usaban
-- el mail igual ahora usan la misma función. La app lee el vínculo guardado (y, sin él, lo calcula con lo que puede leer).
--
-- Aditivo: dos columnas, tres funciones, dos disparadores y cuatro funciones reemplazadas (el cuerpo vivo, con una sola condición
-- cambiada). Se puede volver a correr.
-- ==================================================================

alter table public.resells add column if not exists "alumnoId" text;
alter table public.resells add column if not exists "contactoId" text;

-- ---------- 1. De quién es una llamada de resell ----------
/* El alumno de una llamada de resell. Los caminos, en orden:
     0. el vínculo ya guardado, si ese alumno sigue existiendo;
     1. el mail de la ficha del alumno;
     2. otro mail que el alumno tiene anotado (seguimiento_alumnos."otrosMails");
     3. la persona con ese mail (contacto o lead) y su alumno: alumnos."leadId" o la venta del alumno;
     4. la persona de la llamada (sesiones."contactoId" / "leadId") y su alumno.
   Si una persona tiene varios alumnos, el activo y el más reciente. Es security definer: quien guarda la agenda (Customer Success) no
   puede leer las llamadas ni las ventas. */
create or replace function public.alumno_de_resell(p_email text, p_sesion text default null, p_alumno text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
  v_mail text := lower(btrim(coalesce(p_email, '')));
  v_ids text[];
begin
  if p_alumno is not null then
    select a.id into v from public.alumnos a where a.id = p_alumno;
    if v is not null then return v; end if;
  end if;

  if v_mail <> '' then
    select a.id into v from public.alumnos a where lower(btrim(a.email)) = v_mail
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    if v is not null then return v; end if;

    select a.id into v from public.seguimiento_alumnos s join public.alumnos a on a.id = s."alumnoId"
    where exists (
      select 1 from jsonb_array_elements_text(case when jsonb_typeof(s."otrosMails") = 'array' then s."otrosMails" else '[]'::jsonb end) m
      where lower(btrim(m)) = v_mail)
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    if v is not null then return v; end if;

    -- La persona con ese mail: su contacto, sus leads, y los leads de ese contacto.
    select array_agg(distinct x) into v_ids from (
      select c.id x from public.contactos c where lower(btrim(c.email)) = v_mail
      union select l.id from public.leads l where lower(btrim(l.email)) = v_mail
      union select l."contactoId" from public.leads l where lower(btrim(l.email)) = v_mail
      union select l.id from public.leads l join public.contactos c on c.id = l."contactoId" where lower(btrim(c.email)) = v_mail
    ) t where x is not null;
    if v_ids is not null then
      select a.id into v from public.alumnos a
      where a."leadId" = any (v_ids) or a."ventaId" in (select ve.id from public.ventas ve where ve."contactoId" = any (v_ids))
      order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
      if v is not null then return v; end if;
    end if;
  end if;

  if p_sesion is not null then
    select array_agg(distinct x) into v_ids from (
      select s."contactoId" x from public.sesiones s where s.id = p_sesion
      union select s."leadId" from public.sesiones s where s.id = p_sesion
      union select l."contactoId" from public.sesiones s join public.leads l on l.id = s."leadId" where s.id = p_sesion
    ) t where x is not null;
    if v_ids is not null then
      select a.id into v from public.alumnos a
      where a."leadId" = any (v_ids) or a."ventaId" in (select ve.id from public.ventas ve where ve."contactoId" = any (v_ids))
      order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
      if v is not null then return v; end if;
    end if;
  end if;

  return null;
end;
$$;
revoke all on function public.alumno_de_resell(text, text, text) from public, anon, authenticated;

/* El contacto (la persona) de una llamada de resell, para abrir su ficha aunque no sea alumno: la de la llamada, la del mail o la del
   alumno. */
create or replace function public.contacto_de_resell(p_email text, p_sesion text default null, p_alumno text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
  v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  if p_sesion is not null then
    select c.id into v from public.sesiones s join public.contactos c on c.id = s."contactoId" where s.id = p_sesion;
    if v is not null then return v; end if;
  end if;
  if v_mail <> '' then
    select c.id into v from public.contactos c where lower(btrim(c.email)) = v_mail order by c."creadoEn" limit 1;
    if v is not null then return v; end if;
  end if;
  if p_alumno is not null then
    select c.id into v from public.alumnos a join public.contactos c on c.id = a."leadId" where a.id = p_alumno;
    if v is not null then return v; end if;
    select c.id into v from public.alumnos a join public.leads l on l.id = a."leadId" join public.contactos c on c.id = l."contactoId" where a.id = p_alumno;
    if v is not null then return v; end if;
  end if;
  return null;
end;
$$;
revoke all on function public.contacto_de_resell(text, text, text) from public, anon, authenticated;

-- ---------- 2. Se guarda en la fila ----------
create or replace function public.resell_vincular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /* Calcularlo nunca frena guardar la agenda. */
  begin
    /* Si cambió el mail o la llamada y el vínculo no lo tocó nadie, se vuelve a buscar: ya no es necesariamente la misma persona. */
    if tg_op = 'UPDATE' and (new.email is distinct from old.email or new."sesionId" is distinct from old."sesionId") then
      if new."alumnoId" is not distinct from old."alumnoId" then new."alumnoId" := null; end if;
      if new."contactoId" is not distinct from old."contactoId" then new."contactoId" := null; end if;
    end if;
    new."alumnoId" := public.alumno_de_resell(new.email, new."sesionId", new."alumnoId");
    if new."contactoId" is null or not exists (select 1 from public.contactos c where c.id = new."contactoId") then
      new."contactoId" := public.contacto_de_resell(new.email, new."sesionId", new."alumnoId");
    end if;
  exception when others then
    raise warning 'resell_vincular (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.resell_vincular() from public, anon, authenticated;

drop trigger if exists resells_vincular on public.resells;
create trigger resells_vincular before insert or update of email, "sesionId", "alumnoId", "contactoId" on public.resells
  for each row execute function public.resell_vincular();

/* Un alumno nuevo (o con otro mail o ficha) puede ser el de una llamada que lo estaba esperando: se atan las que no tenían alumno. */
create or replace function public.alumno_atar_resells()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.resells r set "alumnoId" = new.id
    where r."alumnoId" is null and public.alumno_de_resell(r.email, r."sesionId", null) = new.id;
  exception when others then
    raise warning 'alumno_atar_resells (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.alumno_atar_resells() from public, anon, authenticated;

drop trigger if exists alumnos_atar_resells on public.alumnos;
create trigger alumnos_atar_resells after insert or update of email, "leadId", "ventaId" on public.alumnos
  for each row execute function public.alumno_atar_resells();

-- ---------- 3. Las funciones que unían sólo por mail usan la misma regla ----------
/* Se reemplaza la condición en el cuerpo VIVO de cada una (no una copia de un archivo viejo: otros lotes las tocaron después). */
do $$
declare
  v_nombre text;
  v_def text;
  v_viejo constant text := $q$btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))$q$;
  v_nuevo constant text := $q$a.id = public.alumno_de_resell(new.email, new."sesionId", new."alumnoId")$q$;
  v_viejo_r constant text := $q$exists (select 1 from public.alumnos a where a.id = new."alumnoId" and lower(btrim(a.email)) = lower(btrim(r.email)))$q$;
  v_nuevo_r constant text := $q$public.alumno_de_resell(r.email, r."sesionId", r."alumnoId") = new."alumnoId"$q$;
begin
  foreach v_nombre in array array['resell_testimonio_a_ficha', 'avisar_resell_cerrado', 'resell_agenda_a_testimonio', 'testimonio_pendiente_a_resell'] loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_nombre;
    if v_def is null then raise exception 'Falta la función %', v_nombre; end if;
    if position('alumno_de_resell' in v_def) > 0 then continue; end if; -- ya aplicado
    if position(v_viejo in v_def) = 0 and position(v_viejo_r in v_def) = 0 then
      raise exception 'La función % cambió: no encuentro la condición por mail para reemplazarla', v_nombre;
    end if;
    execute replace(replace(v_def, v_viejo, v_nuevo), v_viejo_r, v_nuevo_r);
  end loop;
end $$;

-- ---------- 4. Lo que ya está cargado ----------
-- Se atan las llamadas que hoy no tienen vínculo (el disparador calcula alumno y contacto; no toca el resto de la fila).
update public.resells set "alumnoId" = null, "contactoId" = null where "alumnoId" is null or "contactoId" is null;

-- Cómo quedó: cuántas tienen alumno, cuántas sólo contacto y cuántas ninguno.
select count(*) as total,
  count(*) filter (where "alumnoId" is not null) as con_alumno,
  count(*) filter (where "alumnoId" is null and "contactoId" is not null) as solo_contacto,
  count(*) filter (where "alumnoId" is null and "contactoId" is null) as sin_nada
from public.resells;
