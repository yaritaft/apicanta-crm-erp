-- ==================================================================
-- Cuándo se reservó cada resell (Lili, 26/10: «a fin de mes saber cuántos
-- resells agendé en el mes, porque es parte del sueldo»).
--
-- Lili cobra un extra por cada tanto de resells que agenda, y no tenía de dónde
-- sacar la cuenta: la liquidación contaba las llamadas con utm_source «Resell»,
-- y desde fines de septiembre los resells entran por el evento «Próximos pasos»,
-- que no trae UTM (octubre daba 0 con 16 agendados).
--
-- Ahora cada fila de la agenda de resells sabe cuándo se reservó ("agendadoEn"):
--   · la de Calendly, cuando el alumno reservó (sesiones."creadoEn", el created_at
--     del invitado); si la reprogramó, la reserva de la PRIMERA llamada de la
--     cadena, así una reprogramación no cuenta dos veces ni se muda de mes;
--   · la cargada a mano, cuando se cargó;
--   · la importada del Airtable sin llamada queda vacía (la app la cuenta por el
--     día de la llamada).
-- Lo pone la base con un disparador: la escriba el cron de Calendly, la app o el
-- importador, queda igual. Se muestra como «Agendado el»; el mes de cada resell
-- en el panel de Lili y en la liquidación lo decide el día de la LLAMADA, como
-- su Airtable (lib/resells-agendados.ts; corregido el 26/10 a la tarde).
--
-- Y el concepto de la liquidación que contaba «llamadas con utm_source Resell»
-- pasa a contar los resells de la agenda (la base «resells» de lib/honorarios.ts),
-- con respaldo en respaldo.honorarios_2610.
--
-- Se puede volver a correr.
-- ==================================================================

alter table public.resells add column if not exists "agendadoEn" timestamptz;

-- La reserva original de una llamada de Calendly: se sigue «reprogramadaDe» hasta la primera.
create or replace function public.reserva_de_la_llamada(p_sesion text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := p_sesion;
  v_prev text;
  v_creado timestamptz;
  v_cuando timestamptz;
  v_vistas text[] := '{}';
begin
  /* Con tope y sin volver a una ya vista: una cadena rota (A reprograma B y B reprograma A) no cuelga nada. */
  while v_id is not null and not (v_id = any (v_vistas)) and coalesce(array_length(v_vistas, 1), 0) < 30 loop
    v_vistas := v_vistas || v_id;
    select s."reprogramadaDe", s."creadoEn" into v_prev, v_creado from sesiones s where s.id = v_id;
    if not found then exit; end if;
    v_cuando := coalesce(v_creado, v_cuando);
    v_id := v_prev;
  end loop;
  return v_cuando;
end;
$$;
revoke all on function public.reserva_de_la_llamada(text) from public, anon, authenticated;

-- Es security definer: quien guarda la agenda (Customer Success) no siempre puede leer las llamadas.
create or replace function public.resell_agendado_en()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /* Calcularlo nunca frena guardar la agenda. */
  begin
    /* Ya sabido, no se borra: una pestaña vieja que guarda la fila sin el dato no lo pisa. */
    if tg_op = 'UPDATE' and new."agendadoEn" is null then new."agendadoEn" := old."agendadoEn"; end if;
    if new."agendadoEn" is null and new."sesionId" is not null then new."agendadoEn" := public.reserva_de_la_llamada(new."sesionId"); end if;
    if new."agendadoEn" is null and new.origen = 'manual' then new."agendadoEn" := coalesce(new."creadoEn", now()); end if;
  exception when others then
    raise warning 'resell_agendado_en (%): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.resell_agendado_en() from public, anon, authenticated;

drop trigger if exists resells_agendado_en on public.resells;
create trigger resells_agendado_en before insert or update of "sesionId", "agendadoEn" on public.resells
  for each row execute function public.resell_agendado_en();

-- Lo que ya había.
update public.resells r set "agendadoEn" = public.reserva_de_la_llamada(r."sesionId")
where r."agendadoEn" is null and r."sesionId" is not null;
update public.resells set "agendadoEn" = "creadoEn" where "agendadoEn" is null and origen = 'manual';

-- El concepto de la liquidación: de «llamadas con utm_source Resell» a los resells de la agenda.
do $$
begin
  if to_regclass('public.honorarios') is null then return; end if;
  create schema if not exists respaldo;
  create table if not exists respaldo.honorarios_2610 as select * from public.honorarios where false;
  insert into respaldo.honorarios_2610
    select h.* from public.honorarios h
    where exists (select 1 from jsonb_array_elements(h.conceptos) c
                  where c ->> 'base' = 'llamadas' and lower(btrim(coalesce(c ->> 'utmSource', ''))) = 'resell')
      and not exists (select 1 from respaldo.honorarios_2610 x where x.id = h.id);
  update public.honorarios h set
    conceptos = (
      select jsonb_agg(case when c ->> 'base' = 'llamadas' and lower(btrim(coalesce(c ->> 'utmSource', ''))) = 'resell'
                            then (c - 'utmSource') || '{"base": "resells"}'::jsonb else c end order by o)
      from jsonb_array_elements(h.conceptos) with ordinality as t(c, o)),
    "actualizadoEn" = now(),
    "actualizadoPor" = 'Apicanta (resells agendados, 26/10)'
  where exists (select 1 from jsonb_array_elements(h.conceptos) c
                where c ->> 'base' = 'llamadas' and lower(btrim(coalesce(c ->> 'utmSource', ''))) = 'resell');
end;
$$;

select count(*) filter (where "agendadoEn" is not null) as con_fecha_de_reserva, count(*) as resells from public.resells;
