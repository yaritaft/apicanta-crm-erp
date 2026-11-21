-- ==================================================================
-- Una compra nueva de quien ya es alumno pasa a ser su servicio, en el
-- MISMO alumno (Manuel y Juan Cruz, 20/11).
--
-- Lanzamiento interno: a los de Downsell se les ofrece pasar al programa
-- completo (Hackear AI) y a los de Hackear AI la renovación con Principals.
-- El closer carga la venta nueva como siempre; nadie toca el alumno a mano.
--
-- Qué pasaba: alumnos-sin-duplicar.sql sólo unía la venta nueva con un
-- alumno SIN venta. El closer no ve a los alumnos que no son de sus ventas,
-- así que su app creaba otro alumno con la venta nueva y la base lo dejaba
-- pasar: Josue Alvarado quedó dos veces con el Upgrade AI que cargó Mariano
-- el 04/11, y el contrato y los accesos de la venta nueva iban a la copia.
-- Y aunque no se duplicara, la ficha seguía diciendo «Downsell».
--
-- Ahora, en la base (que ve a todos), igual que la app (lib/alumnos.ts →
-- tomaElServicio / alumnoConLaCompra):
--   - compra_toma_el_servicio(producto): una compra de un programa
--     (principal, upsell o downsell) que no es una extensión (el MID con
--     2 meses más, `sumaTiempo` en Ajustes → Programas). Un evento
--     (Mastermind, una cena) o la extensión suman algo a lo que ya cursa.
--   - compra_al_alumno(alumno, venta): si la compra toma el servicio y no
--     es más vieja que la que tiene, el alumno pasa a esa venta y a ese
--     plan, vuelve a activo si estaba de baja o egresado, y si renueva
--     (principal o upsell) su inicio pasa a la fecha de la compra; la venta
--     anterior queda en extra.ventasAnteriores. Si no tenía venta (Lili lo
--     dio de alta esperando), se le pega como antes.
--   - al cargar una venta (ventas_pasan_al_alumno, después del aviso a
--     Servicio) se busca al alumno de esa persona y se le pasa la compra;
--   - alumno_sin_duplicar: si llega un alumno con venta y esa persona ya
--     es alumno (con otra venta), no nace otro: la compra va al que está.
--   - el aviso a Servicio de una compra de alguien que ya es alumno dice
--     qué pasó (su servicio pasa a ser el nuevo y los accesos que faltan
--     se suman al firmar el contrato).
-- Se puede volver a correr.
-- ==================================================================

create or replace function public.compra_toma_el_servicio(p_producto text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.tipo in ('principal', 'upsell', 'downsell') from productos p where p.id = p_producto), false)
    and not coalesce((
      select case
        when jsonb_typeof(aj.programas) = 'array' and jsonb_array_length(aj.programas) > 0 then exists (
          select 1 from jsonb_array_elements(aj.programas) pr
          where pr ->> 'sumaTiempo' = 'true' and coalesce(pr ->> 'activo', 'true') <> 'false' and coalesce(pr -> 'productos', '[]'::jsonb) ? p_producto)
        /* Sin programas guardados valen los de siempre (lib/programas.ts): la única extensión es la del MID. */
        else p_producto = 'prod_extension_mid' end
      from ajustes aj where aj.id = 1), p_producto = 'prod_extension_mid');
$$;

create or replace function public.compra_al_alumno(p_alumno text, p_venta text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  a alumnos;
  v ventas;
  ant ventas;
  v_tipo text;
  v_producto text;
  v_renueva boolean;
  v_partes text[] := '{}';
begin
  select * into a from alumnos where id = p_alumno for update;
  select * into v from ventas where id = p_venta;
  if a.id is null or v.id is null or coalesce(v.estado, '') <> 'activa' or a."ventaId" is not distinct from v.id then return false; end if;

  /* Lo dio de alta Lili esperando la venta (alumnos-sin-duplicar.sql): se le pega. */
  if a."ventaId" is null then
    update alumnos set "ventaId" = v.id, "leadId" = coalesce(a."leadId", v."contactoId"), extra = coalesce(a.extra, '{}'::jsonb) - 'ventaPendiente'
    where id = a.id;
    return true;
  end if;

  if not public.compra_toma_el_servicio(v."productoId") then return false; end if;
  select * into ant from ventas where id = a."ventaId";
  /* Una venta cargada tarde (más vieja que la que tiene) no le cambia el servicio. */
  if ant.id is not null and ant.estado = 'activa' and ant.fecha > v.fecha then return false; end if;

  select p.tipo, p.nombre into v_tipo, v_producto from productos p where p.id = v."productoId";
  v_renueva := v_tipo in ('principal', 'upsell')
    and (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date > (a.inicio at time zone 'America/Argentina/Buenos_Aires')::date;

  update alumnos set
    "ventaId" = v.id,
    plan = coalesce(nullif(btrim(v_producto), ''), plan),
    moneda = coalesce(nullif(v.moneda, ''), moneda),
    estado = case when estado in ('baja', 'graduado') then 'activo' else estado end,
    inicio = case when v_renueva then v.fecha else inicio end,
    extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('ventasAnteriores',
      coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(extra -> 'ventasAnteriores') = 'array' then extra -> 'ventasAnteriores' else '[]'::jsonb end) x
                where x <> to_jsonb(a."ventaId")), '[]'::jsonb) || to_jsonb(a."ventaId"))
  where id = a.id;

  v_partes := array_append(v_partes, 'su servicio pasa a ser ' || coalesce(nullif(btrim(v_producto), ''), 'la compra nueva')
    || case when coalesce(a.plan, '') <> '' and a.plan is distinct from v_producto then ' (antes ' || a.plan || ')' else '' end);
  if v_renueva then
    v_partes := array_append(v_partes, 'su programa arranca el ' || to_char(v.fecha at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
      || ' (antes ' || to_char(a.inicio at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') || ')');
  end if;
  /* Lo anota sólo la base (la app no): pasa siempre al guardar la venta, la cargue quien la cargue. */
  insert into actividad (id, accion, actor, entidad, "entidadId", titulo, fecha, detalle)
  values ('act_compra_' || a.id || '_' || v.id, 'actualizo', 'Apicanta', 'alumno', a.id, a.nombre, now(),
    a.nombre || ' compró ' || coalesce(nullif(btrim(v_producto), ''), 'otra vez') || ': ' || array_to_string(v_partes, ' y ') || '.')
  on conflict (id) do nothing;
  return true;
end;
$$;

revoke all on function public.compra_al_alumno(text, text) from public, anon, authenticated;
grant execute on function public.compra_al_alumno(text, text) to service_role;
revoke all on function public.compra_toma_el_servicio(text) from public, anon;
grant execute on function public.compra_toma_el_servicio(text) to authenticated, service_role;

/* El alumno de la persona de una venta: el de su persona del CRM (el mismo lead o el mismo contacto) o el de su mail. Primero el que tiene
   una venta (el servicio en curso), y entre ésos el más nuevo (si quedó repetido de antes, el que se usa hoy). */
create or replace function public.alumno_de_la_persona(p_contacto text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with persona as (
    select coalesce(l."contactoId", l.id) as id, public.clave_email(coalesce(nullif(c.email, ''), l.email)) as mail
    from leads l left join contactos c on c.id = l."contactoId" where l.id = p_contacto
    union all
    select c.id, public.clave_email(c.email) from contactos c where c.id = p_contacto and not exists (select 1 from leads where id = p_contacto)
  )
  select a.id from alumnos a
  left join leads la on la.id = a."leadId"
  cross join (select * from persona limit 1) p
  where a."leadId" = p_contacto
     or coalesce(la."contactoId", la.id) = p.id
     or (coalesce(p.mail, '') <> '' and public.clave_email(a.email) = p.mail)
  order by (a."ventaId" is not null) desc, a."creadoEn" desc
  limit 1;
$$;

revoke all on function public.alumno_de_la_persona(text) from public, anon, authenticated;
grant execute on function public.alumno_de_la_persona(text) to service_role;

create or replace function public.venta_nueva_al_alumno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alumno text;
begin
  begin
    if coalesce(new.estado, '') <> 'activa' or new."contactoId" is null then return new; end if;
    if exists (select 1 from alumnos where "ventaId" = new.id) then return new; end if;
    v_alumno := public.alumno_de_la_persona(new."contactoId");
    if v_alumno is not null then perform public.compra_al_alumno(v_alumno, new.id); end if;
  exception when others then
    /* Nunca frena la venta: si algo falla, queda como antes (la app y alumno_sin_duplicar lo intentan igual). */
    raise warning 'venta_nueva_al_alumno (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

/* Después de «ventas_avisan_a_servicio» (los disparadores corren por orden alfabético): el aviso ve que ya era alumno. */
drop trigger if exists ventas_pasan_al_alumno on public.ventas;
create trigger ventas_pasan_al_alumno after insert on public.ventas
  for each row execute function public.venta_nueva_al_alumno();

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
    and (
      (new."leadId" is not null and a."leadId" is not null and (
        a."leadId" = new."leadId"
        or exists (select 1 from leads la join leads lb on coalesce(la."contactoId", la.id) = coalesce(lb."contactoId", lb.id)
                   where la.id = a."leadId" and lb.id = new."leadId")))
      or (public.clave_email(new.email) <> '' and public.clave_email(a.email) = public.clave_email(new.email))
      or (length(tel) = 8 and public.telefono_de_alumno(a) = tel
          and (select count(*) from unnest(public.palabras_nombre(a.nombre)) x where x = any(public.palabras_nombre(new.nombre))) >= 2)
    )
  /* El que ya tiene esta venta; si no, el que esperaba la venta (el más viejo, como antes); si no, el que ya es alumno con otra compra
     (el más nuevo: si quedó repetido de antes, el que se usa hoy). */
  order by (a."ventaId" = new."ventaId") desc nulls last, (a."ventaId" is null) desc,
    case when a."ventaId" is null then extract(epoch from a."creadoEn") else -extract(epoch from a."creadoEn") end
  limit 1;
  if ya.id is null then return new; end if;

  if ya."ventaId" is null or ya."ventaId" = new."ventaId" then
    update alumnos set "ventaId" = new."ventaId", "leadId" = coalesce(ya."leadId", new."leadId"),
      extra = coalesce(ya.extra, '{}'::jsonb) - 'ventaPendiente' where id = ya.id;
    if ya."ventaId" is null then
      insert into actividad (id, accion, actor, entidad, "entidadId", titulo, fecha, detalle)
      values ('act_alu_' || substr(md5(new.id || ya.id), 1, 12), 'actualizo', 'Apicanta', 'alumno', ya.id, ya.nombre, now(),
        'La venta se sumó a su ficha de servicio (ya estaba cargado a mano): no se creó otro alumno.')
      on conflict (id) do nothing;
    end if;
    return null;
  end if;

  /* Ya es alumno con otra compra (un upgrade, una renovación, un evento): es el mismo alumno. Si la compra toma el servicio, pasa a su
     ficha (compra_al_alumno); si no, sigue con lo que tenía. Nunca nace otro. */
  perform public.compra_al_alumno(ya.id, new."ventaId");
  return null;
end;
$$;

drop trigger if exists alumno_sin_duplicar on public.alumnos;
create trigger alumno_sin_duplicar before insert on public.alumnos
  for each row execute function public.alumno_sin_duplicar();

/* El aviso a Servicio de una venta nueva: si ya era alumno (la misma persona, aunque sea por otro lead o por el mail), dice qué pasa con su
   ficha. Es el de avisos-de-ventas.sql con ese cambio. */
create or replace function public.avisar_venta_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_producto text;
  v_closer text;
  v_alumno alumnos;
  v_ya_es_alumno boolean;
  v_esperaba boolean;
  v_titulo text;
  v_cuerpo text;
begin
  begin
    if coalesce(new.estado, '') <> 'activa' then return new; end if;
    if new.fecha is not null and new.fecha < now() - interval '3 days' then return new; end if;

    v_nombre := coalesce(nullif(btrim(new."contactoNombre"), ''), (select nullif(btrim(c.nombre), '') from public.contactos c where c.id = new."contactoId"), 'un alumno nuevo');
    select p.nombre into v_producto from public.productos p where p.id = new."productoId";
    select nullif(btrim(q.nombre), '') into v_closer from public.equipo q where q.id = new."closerId";

    if new."contactoId" is not null then
      select * into v_alumno from public.alumnos where id = public.alumno_de_la_persona(new."contactoId");
    end if;
    v_ya_es_alumno := v_alumno.id is not null and v_alumno."ventaId" is not null and v_alumno."ventaId" <> new.id;
    v_esperaba := v_alumno.id is not null and v_alumno."ventaId" is null;

    v_titulo := case
      when v_ya_es_alumno then 'Nueva compra de ' || v_nombre
      when v_esperaba then 'Cargaron la venta de ' || v_nombre
      else 'Nueva venta: ' || v_nombre end;
    v_cuerpo := coalesce(v_producto, 'Una venta nueva') || case when v_closer is not null then ' · la cargó ' || v_closer else '' end || '. '
      || case
        when v_ya_es_alumno and public.compra_toma_el_servicio(new."productoId") then
          'Ya es alumno' || case when coalesce(v_alumno.plan, '') <> '' then ' (' || v_alumno.plan || ')' else '' end
          || ': su servicio pasa a ser ' || coalesce(v_producto, 'el nuevo') || ' en la misma ficha y, al firmar el contrato, se le suman los accesos que le faltan.'
        when v_ya_es_alumno then 'Ya es alumno: es una compra más, sigue con su servicio.'
        when v_esperaba then 'Ya lo tenías dado de alta: la venta se unió a su ficha.'
        else 'Mandale la bienvenida por WhatsApp (también si es una reserva) y marcalo en «Alumnos nuevos» de tu panel.' end;

    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "contactoId", persona)
    select 'av_venta_' || new.id || '_' || left(md5(m), 10), m, 'venta-nueva', v_titulo, v_cuerpo, 'Apicanta', new."contactoId", v_nombre
    from public.mails_de_servicio() m
    on conflict (id) do nothing;
  exception when others then
    raise warning 'avisar_venta_nueva (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
