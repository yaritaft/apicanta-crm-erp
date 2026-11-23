-- ==================================================================
-- Aviso a Customer Success cuando un closer pide la baja por falta de pago
-- + menciones con @ en la nota de cobranza (Liliana, 23/11/2026)
--
--   «Necesito que la app sí o sí me avise cuando el closer pone "darlo de
--    baja por falta de pago". Si el alumno está automatizado, que se realice
--    automáticamente el outboarding; si es un alumno viejo, yo procedo a
--    realizarlo manualmente. Para ambos casos necesitamos que me avise para
--    chequear.»
--
-- Qué pasaba: «Pido la baja por falta de pago» (Mi panel → Cuotas vencidas)
-- quedaba escrito en la cuota (`seguimientoCobro`) y sólo lo veía Finanzas.
-- Servicio no se enteraba: Mariano la pidió para dos alumnos el 03/11 y
-- veinte días después nadie había hecho el outboarding. En
-- el video intenta etiquetar a Lili con @ en la nota, y la nota no avisaba.
--
-- Qué hace ahora un disparador en `cuotas` (la base, no el navegador: avisa
-- igual se marque desde Mi panel, desde Finanzas o desde lo que venga):
--   · se marca la baja → un aviso tipo 'baja-falta-de-pago' a cada persona de
--     Customer Success (mails_de_servicio()), con quién la pidió, qué cuota no
--     pagó, la nota y si el outboarding sale solo (tiene accesos de la app: la
--     pasada de cada hora se los saca, lib/bajas-falta-de-pago-servidor.ts) o
--     es a mano (alumno de antes de la app). Uno por venta: dos cuotas marcadas
--     de la misma venta no repiten el aviso. No avisa si la cuota ya está paga
--     o la venta no está activa.
--   · se saca la marca → si ninguna otra cuota de esa venta la pide, el aviso
--     que todavía no se leyó se borra (fue un error o el alumno pagó).
--   · la nota nombra a alguien con @ («@Liliana», «@Liliana Riveros» o el
--     comienzo del nombre, «@lili», desde 3 letras) → un aviso 'mencion' a esa
--     persona (sus mails de Equipo y de acceso), salvo a quien la escribió.
-- Si algo falla, la cuota se guarda igual.
--
-- Hace falta haber corrido avisos.sql y sesiones-1a1-y-avisos-de-resell.sql
-- (mails_de_servicio, mails_de_la_persona). Se puede volver a correr.
-- Para deshacerlo: drop trigger cuotas_avisan_baja on public.cuotas;
--   drop function public.avisar_baja_por_falta_de_pago(); drop function public.mails_mencionados(text);
-- ==================================================================

do $$ begin
  if to_regclass('public.avisos') is null or to_regclass('public.cuotas') is null then
    raise exception 'Falta avisos.sql (o esta no es la base del ERP).';
  end if;
  if to_regprocedure('public.mails_de_servicio()') is null or to_regprocedure('public.mails_de_la_persona(text)') is null then
    raise exception 'Falta sesiones-1a1-y-avisos-de-resell.sql (mails_de_servicio, mails_de_la_persona).';
  end if;
end $$;

/* Los mails de quienes nombra un texto con @: el nombre de pila entero o su comienzo (desde 3 letras), sin importar mayúsculas
   ni tildes («@lili» = Liliana). Como avisar_menciones (avisos.sql): el mail de Equipo y los de acceso con el mismo nombre. */
create or replace function public.mails_mencionados(p_texto text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with palabras as (
    select distinct lower(translate(m[1], 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) as p
    from regexp_matches(coalesce(p_texto, ''), '(?:^|[^[:alnum:]_])@([[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]{3,})', 'g') as m
  ), quienes as (
    select e.nombre, e.email from public.equipo e
    where coalesce(e.activo, true) and btrim(coalesce(e.nombre, '')) <> ''
      and exists (select 1 from palabras w where lower(translate(split_part(btrim(e.nombre), ' ', 1), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) like w.p || '%')
  )
  select distinct lower(btrim(x.email)) from (
    select q.email from quienes q
    union all
    select u.email from public.usuarios_permitidos u join quienes q
      on lower(btrim(u.nombre)) = lower(btrim(q.nombre)) or lower(btrim(u.nombre)) like lower(btrim(q.nombre)) || ' %'
  ) x
  where btrim(coalesce(x.email, '')) like '%@%';
$$;
revoke all on function public.mails_mencionados(text) from public, anon, authenticated;

create or replace function public.avisar_baja_por_falta_de_pago()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes text;
  v_ahora text;
  v_nota_antes text;
  v_nota text;
  v_por text;
  v_marca boolean;
  v_menciona boolean;
  v_venta record;
  v_alumno record;
  v_nombre text;
  v_producto text;
  v_pagado numeric;
  v_cuota text;
  v_con_accesos boolean;
  v_monto text;
  v_cuerpo text;
begin
  begin
    v_antes := case when tg_op = 'UPDATE' then old."seguimientoCobro" ->> 'estado' end;
    v_ahora := new."seguimientoCobro" ->> 'estado';
    v_nota_antes := case when tg_op = 'UPDATE' then btrim(coalesce(old."seguimientoCobro" ->> 'nota', '')) else '' end;
    v_nota := btrim(coalesce(new."seguimientoCobro" ->> 'nota', ''));
    v_por := coalesce(nullif(btrim(new."seguimientoCobro" ->> 'por'), ''), 'El closer');

    -- Se sacó la marca (o pasó a otra): si ninguna otra cuota de la venta pide la baja, el aviso sin leer se va.
    if v_antes = 'baja' and v_ahora is distinct from 'baja' then
      if not exists (select 1 from public.cuotas c where c."ventaId" = new."ventaId" and c.id <> new.id and c."seguimientoCobro" ->> 'estado' = 'baja') then
        delete from public.avisos where tipo = 'baja-falta-de-pago' and "leidoEn" is null
          and left(id, length('av_bajafp_' || new."ventaId" || '_')) = 'av_bajafp_' || new."ventaId" || '_';
      end if;
    end if;

    v_marca := v_ahora = 'baja' and v_antes is distinct from 'baja';
    v_menciona := v_nota like '%@%' and v_nota <> v_nota_antes;
    if not v_marca and not v_menciona then return new; end if;

    select v.id, v.estado, v."contactoId", v."contactoNombre", v."productoId", coalesce(nullif(v.moneda, ''), 'USD') as moneda into v_venta
    from public.ventas v where v.id = new."ventaId";
    select a.id, a.nombre, a."leadId" into v_alumno from public.alumnos a
    where a."ventaId" = new."ventaId" or (v_venta."contactoId" is not null and a."leadId" = v_venta."contactoId")
    order by (a."ventaId" = new."ventaId") desc, a.id limit 1;
    v_nombre := coalesce(nullif(btrim(v_alumno.nombre), ''), nullif(btrim(v_venta."contactoNombre"), ''), 'un alumno');
    v_cuota := case when new."esReserva" then 'la reserva' else 'la cuota ' || new.numero end;

    if v_marca and coalesce(v_venta.estado, '') = 'activa' then
      select coalesce(sum(p.monto), 0) into v_pagado from public.pagos p where p."cuotaId" = new.id;
      if v_pagado < coalesce(new.monto, 0) - 0.01 then
        select p.nombre into v_producto from public.productos p where p.id = v_venta."productoId";
        v_con_accesos := v_alumno.id is not null and exists (
          select 1 from public.accesos_alumno x where x."alumnoId" = v_alumno.id and x.estado in ('pendiente', 'dado', 'entro'));
        v_monto := v_venta.moneda || ' ' || replace(to_char(round(new.monto - v_pagado), 'FM999,999,990'), ',', '.');
        -- Si se marcó hace días (lo de antes de este aviso, o una cola que llegó tarde), se dice cuándo.
        v_cuerpo := case when coalesce(new."seguimientoCobro" ->> 'en', '') ~ '^\d{4}-\d{2}-\d{2}' and left(new."seguimientoCobro" ->> 'en', 10)::date < current_date - 1
            then 'Lo pidió el ' || to_char(left(new."seguimientoCobro" ->> 'en', 10)::date, 'DD/MM') || '. ' else '' end
          || 'No pagó ' || v_cuota || coalesce(' de ' || v_producto, '') || ' (' || v_monto
          || coalesce(', vencía el ' || to_char(new.vence at time zone 'America/Argentina/Buenos_Aires', 'DD/MM'), '') || ').'
          || case when v_nota <> '' then ' «' || left(v_nota, 200) || '».' else '' end
          || case
            when v_alumno.id is null then ' No encontramos su ficha de alumno: buscalo y hacé el outboarding a mano.'
            when v_con_accesos then ' Tiene accesos que dio la app: se los sacamos solos en la próxima pasada (cada hora, a los 25 minutos) y te avisamos qué queda a mano.'
            else ' Sus accesos no los dio la app (alumno de antes): hacé el outboarding a mano.' end
          || ' Queda en tu panel, en «Bajas por falta de pago», hasta que lo pases a Outboarding.';
        insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "contactoId", persona)
        select 'av_bajafp_' || new."ventaId" || '_' || left(md5(m), 10), m, 'baja-falta-de-pago',
          v_por || ' pidió la baja de ' || v_nombre || ' por falta de pago', v_cuerpo, v_por,
          coalesce(v_alumno."leadId", v_venta."contactoId", v_alumno.id), v_nombre
        from public.mails_de_servicio() m
        on conflict (id) do nothing;
      end if;
    end if;

    -- @Nombre en la nota: a quien se nombra (salvo a quien escribió). Una nota nueva que vuelve a nombrar, vuelve a avisar.
    if v_menciona then
      insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "contactoId", persona)
      select 'av_cobro_' || new.id || '_' || left(md5(m || ':' || v_nota), 12), m, 'mencion',
        v_por || ' te mencionó en la cobranza de ' || v_nombre,
        initcap(left(v_cuota, 1)) || substr(v_cuota, 2) || ': «' || left(v_nota, 300) || '»', v_por,
        coalesce(v_alumno."leadId", v_venta."contactoId", v_alumno.id), v_nombre
      from public.mails_mencionados(v_nota) m
      where m not in (select x from public.mails_de_la_persona(v_por) x)
      on conflict (id) do nothing;
    end if;
  exception when others then
    raise warning 'avisar_baja_por_falta_de_pago (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.avisar_baja_por_falta_de_pago() from public, anon, authenticated;

drop trigger if exists cuotas_avisan_baja on public.cuotas;
create trigger cuotas_avisan_baja after insert or update of "seguimientoCobro" on public.cuotas
  for each row execute function public.avisar_baja_por_falta_de_pago();
