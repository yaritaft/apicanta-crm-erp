-- =====================================================================
-- La renovación deja la ficha de Servicio con el programa y la duración
-- de la compra nueva (Liliana, 26/11).
--
-- «Todos los alumnos que renuevan Principals, el contrato es por 12 meses.
-- Algunos que renovaron aparecen por 3 meses.» Eran los 13 que renovaron
-- entre el 24 y el 26/11: la venta nueva les cambió el servicio, el plan y
-- el inicio (compra-nueva-mismo-alumno-20-11.sql), pero la ficha de
-- Servicio siguió con el «Programa» y la «Duración» de la compra anterior
-- (Hackear IA, 3 meses). Con eso el fin del programa caía a los 3 meses y
-- el outboarding les iba a sacar los accesos nueve meses antes.
--
-- LA RAÍZ: el programa y la duración de la ficha son de UNA compra, y al
-- renovar nadie los pasaba a la compra nueva (había que acordarse de
-- hacerlo a mano). Ahora, en la base, en el mismo momento en que la compra
-- pasa a ser el servicio del alumno (compra_al_alumno, la cargue quien la
-- cargue):
--   - el programa de la compra (Ajustes → Programas) queda primero en
--     «Programa» (lo que ya tenía se conserva atrás: «Principals · HACKEAR
--     IA», como los carga Lili) y la «Duración» pasa a la de ese programa
--     (Principals 12 meses, Hackear Biz 6, el resto 3: la misma cuenta que
--     sugiere la ficha, lib/clientes-cs.ts → DURACION_POR_PROGRAMA);
--   - el «Plan de pago» escrito en la ficha era el de la compra anterior
--     («PIF 3000 USD» en quien ahora paga 1.500 en dos veces): se vacía y
--     la app muestra el de las cuotas de la compra nueva (sugerido, como
--     en cualquier alumno sin plan escrito);
--   - el «Contrato firmado» de la ficha era el del contrato anterior
--     («Firmado · DRIVE 28/9» en quien todavía no firmó el de Principals):
--     pasa a «Pendiente» —así aparece en «Contrato sin firmar» del panel—
--     salvo que el contrato de esta compra ya esté firmado; al firmarse
--     vuelve a «Firmado» como siempre (fichaAlFirmar);
--   - seguimiento_alumnos."cicloDeVenta" anota de qué compra son ese
--     programa, esa duración, ese plan de pago y ese contrato;
--   - una pestaña abierta desde antes de la renovación guarda la fila
--     entera del seguimiento («Se lo contactó», el follow-up): como trae la
--     marca de la compra anterior, su programa, su duración, su plan de
--     pago y su contrato viejos NO pisan los de la compra nueva. Lo demás que escribió se guarda. Desde
--     una pestaña al día se pueden cambiar a mano como siempre.
--
-- Y un caso más de lo mismo: el alumno de antes que no tenía venta cargada
-- (los del Airtable; Luis Carlos J., de baja desde 2025, compró
-- Principals el 25/11). La venta se le «pegaba» sin más —pensado para el
-- que Lili da de alta esperando la venta— y quedaba de baja, sin plan y
-- con el inicio de 2025. Ahora, si la compra es de estos días y llega más
-- de un mes después de su inicio, es una renovación como cualquier otra.
--
-- Se puede volver a correr.
-- =====================================================================

alter table public.seguimiento_alumnos add column if not exists "cicloDeVenta" text;

/* El nombre de siempre de un programa, igual que lib/clientes-cs.ts → familiaDePrograma («HACKEAR IA» y «Hackear AI» son el mismo). */
create or replace function public.familia_de_programa(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when x.t = '' then ''
    when x.t ~ 'downsell' then case when x.t ~ 'plus' then 'Downsell Plus+' else 'Downsell' end
    when x.t ~ '\mmid\M' then 'Hackear IA MID'
    when x.t ~ 'mastermind' then 'Principal Mastermind'
    when x.t ~ 'principal' then 'Principals'
    when x.t ~ '\mbiz\M|business' then 'Hackear Biz'
    when x.t ~ '\mia\M|\mai\M' then 'Hackear AI'
    when x.t ~ '\mit\M|mentoria' then 'Hackear IT'
    else btrim(coalesce(p_texto, '')) end
  from (select regexp_replace(lower(translate(btrim(coalesce(p_texto, '')), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')), '\s+', ' ', 'g') as t) x;
$$;

/* Los meses que dura un programa: los que sugiere la ficha (lib/clientes-cs.ts → DURACION_POR_PROGRAMA y DURACION_POR_DEFECTO). */
create or replace function public.meses_de_programa(p_programa text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case public.familia_de_programa(p_programa)
    when 'Principals' then 12
    when 'Principal Mastermind' then 12
    when 'Hackear Biz' then 6
    else 3 end;
$$;

/* El programa (Ajustes → Programas) al que pertenece un producto: el primero activo que lo tenga, como lib/programas.ts → programaDeProducto.
   Null si el producto no es de ningún programa (o todavía no hay programas guardados): la ficha no se toca. */
create or replace function public.programa_entero_de_producto(p_producto text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select pr.p
  from ajustes aj, jsonb_array_elements(case when jsonb_typeof(aj.programas) = 'array' then aj.programas else '[]'::jsonb end) with ordinality as pr(p, orden)
  where aj.id = 1
    and coalesce(pr.p ->> 'activo', 'true') <> 'false'
    and coalesce(pr.p -> 'productos', '[]'::jsonb) ? p_producto
    and nullif(btrim(pr.p ->> 'nombre'), '') is not null
  order by pr.orden
  limit 1;
$$;

/* Su nombre. */
create or replace function public.programa_de_producto(p_producto text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select btrim(public.programa_entero_de_producto(p_producto) ->> 'nombre');
$$;

revoke all on function public.programa_entero_de_producto(text) from public, anon, authenticated;
grant execute on function public.programa_entero_de_producto(text) to service_role;

/* ¿El contrato de ESTA compra ya está firmado? El atado a esta venta o, si todavía no se ató (se mandó antes de cargar la venta), el del
   mismo programa de estas semanas para ese alumno o esa persona (como lib/contratos.ts → contratoDeEstaCompra). El de la reserva no cuenta. */
create or replace function public.contrato_de_la_compra_firmado(p_alumno text, p_venta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from contratos c join ventas v on v.id = p_venta
    where c.estado = 'firmado' and coalesce(c.modo, 'produccion') = 'produccion' and coalesce(c.datos ->> 'reserva', 'false') <> 'true'
      and (c."ventaId" = v.id
        or (c."ventaId" is null and c."creadoEn" > now() - interval '31 days'
            and c.programa = (public.programa_entero_de_producto(v."productoId") ->> 'id')
            and (c."alumnoId" = p_alumno or (c."leadId" is not null and c."leadId" = v."contactoId")))));
$$;

revoke all on function public.contrato_de_la_compra_firmado(text, text) from public, anon, authenticated;
grant execute on function public.contrato_de_la_compra_firmado(text, text) to service_role;

/* La ficha de Servicio pasa a la compra nueva: su programa primero, su duración, el plan de pago en blanco (se muestra el de las cuotas de
   esta compra) y el contrato «Pendiente» hasta que se firme el de esta compra. Devuelve lo que cambió (para la actividad) o null si no
   había nada que cambiar: sin ficha todavía (nace sugerida por la venta) o ya era de esta compra. Si el producto no es de ningún programa
   de Ajustes (no tiene contrato propio), el programa, la duración y el contrato quedan como estaban. */
create or replace function public.ficha_del_ciclo_nuevo(p_alumno text, p_venta text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s seguimiento_alumnos;
  v_programa text;
  v_meses integer;
  v_programas jsonb;
  v_ya boolean;
  v_plan text;
  v_contrato text;
  v_estado_contrato text;
  v_partes text[] := '{}';
begin
  if not exists (select 1 from ventas v where v.id = p_venta) then return null; end if;
  select public.programa_de_producto(v."productoId") into v_programa from ventas v where v.id = p_venta;
  select * into s from seguimiento_alumnos where "alumnoId" = p_alumno for update;
  if s.id is null or s."cicloDeVenta" is not distinct from p_venta then return null; end if;

  v_programas := case when jsonb_typeof(s.programas) = 'array' then s.programas else '[]'::jsonb end;
  v_meses := s."duracionMeses";
  v_contrato := s."contratoFirmado";
  v_estado_contrato := s."estadoContrato";
  if v_programa is not null then
    v_meses := public.meses_de_programa(v_programa);
    select exists (select 1 from jsonb_array_elements_text(v_programas) x where public.familia_de_programa(x) = public.familia_de_programa(v_programa)) into v_ya;
    if not v_ya then v_programas := jsonb_build_array(v_programa) || v_programas; end if;
    v_partes := array_append(v_partes, 'su ficha de Servicio queda en ' || v_programa || ', ' || v_meses || ' meses'
      || case when s."duracionMeses" is not null and s."duracionMeses" <> v_meses then ' (antes ' || s."duracionMeses" || ')' else '' end);
    /* El contrato firmado que figura es el de la compra anterior, salvo que el de ésta ya esté firmado (se mandó antes de cargar la venta). */
    if public.contrato_de_la_compra_firmado(p_alumno, p_venta) then
      v_contrato := 'Firmado';
      v_estado_contrato := 'Firmado en PandaDoc';
    else
      if btrim(coalesce(s."contratoFirmado", '')) = 'Firmado' then
        v_partes := array_append(v_partes, 'el contrato de esta compra queda pendiente de firma (el firmado'
          || case when btrim(coalesce(s."estadoContrato", '')) <> '' then ', «' || btrim(s."estadoContrato") || '»,' else '' end || ' era el de la compra anterior)');
      end if;
      v_contrato := 'Pendiente';
      v_estado_contrato := '';
    end if;
  end if;
  v_plan := btrim(coalesce(s."planDePago", ''));
  if v_plan <> '' then
    v_partes := array_append(v_partes, 'su plan de pago pasa a ser el de esta compra (el escrito era «' || v_plan || '»)');
  end if;

  /* El disparador de abajo deja pasar el cambio de compra sólo a quien lo hace desde acá. */
  perform set_config('apicanta.ciclo_nuevo', p_venta, true);
  update seguimiento_alumnos set programas = v_programas, "duracionMeses" = v_meses, "planDePago" = '',
    "contratoFirmado" = v_contrato, "estadoContrato" = v_estado_contrato, "cicloDeVenta" = p_venta where id = s.id;
  perform set_config('apicanta.ciclo_nuevo', '', true);

  return nullif(array_to_string(v_partes, '; '), '');
end;
$$;

revoke all on function public.ficha_del_ciclo_nuevo(text, text) from public, anon, authenticated;
grant execute on function public.ficha_del_ciclo_nuevo(text, text) to service_role;
revoke all on function public.programa_de_producto(text) from public, anon;
grant execute on function public.programa_de_producto(text) to authenticated, service_role;

/* Una fila que llega con la marca de OTRA compra (la pestaña se abrió antes de la renovación) no devuelve el programa, la duración, el plan
   de pago y el contrato a los de la compra anterior: se quedan los de la compra en curso. Todo lo demás que trae se guarda. */
create or replace function public.seguimiento_es_de_la_compra_en_curso()
returns trigger
language plpgsql
as $$
begin
  if old."cicloDeVenta" is not null and new."cicloDeVenta" is distinct from old."cicloDeVenta"
     and coalesce(nullif(current_setting('apicanta.ciclo_nuevo', true), ''), '(nadie)') is distinct from new."cicloDeVenta" then
    new.programas := old.programas;
    new."duracionMeses" := old."duracionMeses";
    new."planDePago" := old."planDePago";
    new."contratoFirmado" := old."contratoFirmado";
    new."estadoContrato" := old."estadoContrato";
    new."cicloDeVenta" := old."cicloDeVenta";
  end if;
  return new;
end;
$$;

drop trigger if exists seguimiento_es_de_la_compra_en_curso on public.seguimiento_alumnos;
create trigger seguimiento_es_de_la_compra_en_curso
  before update on public.seguimiento_alumnos
  for each row execute function public.seguimiento_es_de_la_compra_en_curso();

revoke all on function public.seguimiento_es_de_la_compra_en_curso() from public, anon, authenticated;

/* La de compra-nueva-mismo-alumno-20-11.sql con dos cambios: el alumno de antes sin venta cargada renueva como cualquier otro, y la ficha de
   Servicio pasa a la compra nueva. La app hace lo mismo con el alumno (lib/alumnos.ts → alumnoSinVentaConLaCompra, alumnoConLaCompra). */
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
  v_de_antes boolean := false;
  v_ficha text;
  v_partes text[] := '{}';
begin
  select * into a from alumnos where id = p_alumno for update;
  select * into v from ventas where id = p_venta;
  if a.id is null or v.id is null or coalesce(v.estado, '') <> 'activa' or a."ventaId" is not distinct from v.id then return false; end if;
  select p.tipo, p.nombre into v_tipo, v_producto from productos p where p.id = v."productoId";

  if a."ventaId" is null then
    /* Un alumno de antes que nunca tuvo la venta cargada y vuelve a comprar: la compra es de estos días (no una vieja que alguien carga
       tarde) y llega más de un mes después de su inicio. No es el que Lili dio de alta esperando la venta (ése trae `ventaPendiente`). */
    v_de_antes := not (coalesce(a.extra, '{}'::jsonb) ? 'ventaPendiente')
      and public.compra_toma_el_servicio(v."productoId") and coalesce(v_tipo, '') in ('principal', 'upsell')
      and v.fecha >= now() - interval '30 days'
      and coalesce((v.fecha at time zone 'America/Argentina/Buenos_Aires')::date - (a.inicio at time zone 'America/Argentina/Buenos_Aires')::date > 30, false);
    if not v_de_antes then
      /* Lo dio de alta Lili esperando la venta (alumnos-sin-duplicar.sql): se le pega. */
      update alumnos set "ventaId" = v.id, "leadId" = coalesce(a."leadId", v."contactoId"), extra = coalesce(a.extra, '{}'::jsonb) - 'ventaPendiente'
      where id = a.id;
      return true;
    end if;
  end if;

  if not public.compra_toma_el_servicio(v."productoId") then return false; end if;
  select * into ant from ventas where id = a."ventaId";
  /* Una venta cargada tarde (más vieja que la que tiene) no le cambia el servicio. */
  if ant.id is not null and ant.estado = 'activa' and ant.fecha > v.fecha then return false; end if;

  v_renueva := v_tipo in ('principal', 'upsell')
    and (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date > (a.inicio at time zone 'America/Argentina/Buenos_Aires')::date;

  update alumnos set
    "ventaId" = v.id,
    "leadId" = coalesce("leadId", v."contactoId"),
    plan = coalesce(nullif(btrim(v_producto), ''), plan),
    moneda = coalesce(nullif(v.moneda, ''), moneda),
    estado = case when estado in ('baja', 'graduado') then 'activo' else estado end,
    inicio = case when v_renueva then v.fecha else inicio end,
    extra = case when a."ventaId" is null then coalesce(extra, '{}'::jsonb) - 'ventaPendiente'
      else coalesce(extra, '{}'::jsonb) || jsonb_build_object('ventasAnteriores',
        coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(extra -> 'ventasAnteriores') = 'array' then extra -> 'ventasAnteriores' else '[]'::jsonb end) x
                  where x <> to_jsonb(a."ventaId")), '[]'::jsonb) || to_jsonb(a."ventaId")) end
  where id = a.id;

  v_partes := array_append(v_partes, 'su servicio pasa a ser ' || coalesce(nullif(btrim(v_producto), ''), 'la compra nueva')
    || case when coalesce(a.plan, '') <> '' and a.plan is distinct from v_producto then ' (antes ' || a.plan || ')' else '' end);
  if a.estado in ('baja', 'graduado') then v_partes := array_append(v_partes, 'vuelve a estar activo'); end if;
  if v_renueva then
    v_partes := array_append(v_partes, 'su programa arranca el ' || to_char(v.fecha at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
      || ' (antes ' || to_char(a.inicio at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') || ')');
  end if;

  /* Un programa nuevo (principal o upsell): la ficha de Servicio pasa a su programa y a su duración. Si algo falla ahí, la compra igual pasa. */
  if v_tipo in ('principal', 'upsell') then
    begin
      v_ficha := public.ficha_del_ciclo_nuevo(a.id, v.id);
      if v_ficha is not null then v_partes := array_append(v_partes, v_ficha); end if;
    exception when others then
      raise warning 'ficha_del_ciclo_nuevo (% / %): %', a.id, v.id, sqlerrm;
    end;
  end if;

  /* Lo anota sólo la base (la app no): pasa siempre al guardar la venta, la cargue quien la cargue. */
  insert into actividad (id, accion, actor, entidad, "entidadId", titulo, fecha, detalle)
  values ('act_compra_' || a.id || '_' || v.id, 'actualizo', 'Apicanta', 'alumno', a.id, a.nombre, now(),
    a.nombre || ' compró ' || coalesce(nullif(btrim(v_producto), ''), 'otra vez') || ': ' || array_to_string(v_partes, ', ') || '.')
  on conflict (id) do nothing;
  return true;
end;
$$;

revoke all on function public.compra_al_alumno(text, text) from public, anon, authenticated;
grant execute on function public.compra_al_alumno(text, text) to service_role;

/* La de compra-nueva-mismo-alumno-20-11.sql con un cambio: cuando el alumno que ya estaba no tenía venta, la compra le llega por
   compra_al_alumno (que la pega como antes o, si es un alumno de antes que vuelve a comprar, lo renueva). Pasa cuando la venta no lo
   encontró por su persona ni por su mail y sí lo encuentra acá, por el teléfono y el nombre. */
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
    if ya."ventaId" is null and public.compra_al_alumno(ya.id, new."ventaId") then
      update alumnos set "leadId" = new."leadId" where id = ya.id and "leadId" is null and new."leadId" is not null;
    else
      update alumnos set "ventaId" = new."ventaId", "leadId" = coalesce(ya."leadId", new."leadId"),
        extra = coalesce(ya.extra, '{}'::jsonb) - 'ventaPendiente' where id = ya.id;
    end if;
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
