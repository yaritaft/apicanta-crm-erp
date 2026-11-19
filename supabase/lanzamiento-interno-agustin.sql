-- Lanzamiento interno: Agustín comisiona lo que se vende ahí, sea cual sea el servicio — Apicanta ERP (Aldana, 19/11)
--
-- «El lunes o martes se hace un lanzamiento interno donde se vende el upgrade a Hackear AI y Principals; que cuando se cargue la venta se toque
-- lanzamiento interno y ya se le cuente a Agustín, que es una venta interna pero sí corresponde que la comisione.»
--
-- Su comisión (hon_eq_growth, concepto con_muexl8akp7h3n: 5% del profit propio) ya cuenta la estrategia «Lanzamiento interno» (deja afuera la
-- «Venta interna» común y VSL YouTube), pero sólo los servicios de su lista, y el Upgrade AI no está (criterio de Aldana del 28/10: el upgrade
-- «natural» no le corresponde). Principals sí está. Para que el Upgrade AI del lanzamiento cuente sin que cuente el de siempre:
-- el concepto gana `siempreEmbudoIds: ["emb_lanzamiento_interno"]` (código: lib/honorarios.ts, veredicto): las ventas de esa estrategia cuentan
-- siempre, aunque su servicio no esté en la lista. Nada más cambia: monto, porcentaje, fecha de inicio y las demás reglas quedan como están.
-- La estrategia la pone ahora el asistente de venta (pregunta «¿Es del lanzamiento interno?» con Upgrade AI y Principals; opción en el resumen).
--
-- Respaldo: respaldo.honorarios_agustin_1911 guarda la fila entera como estaba. Se puede correr más de una vez.

do $$
declare
  concepto constant text := 'con_muexl8akp7h3n';
  antes jsonb;
  c jsonb;
begin
  select conceptos into antes from public.honorarios where id = 'hon_eq_growth';
  if antes is null then
    raise exception 'No encuentro el esquema de Agustín (hon_eq_growth).';
  end if;
  c := (select x from jsonb_array_elements(antes) x where x->>'id' = concepto);
  if c is null or c->>'base' <> 'profit' or coalesce((c->>'tasa')::numeric, 0) <> 0.05 then
    raise exception 'El concepto de Agustín cambió (no es el 5%% del profit): revisar antes de tocarlo.';
  end if;
  if c ? 'siempreEmbudoIds' then
    raise notice 'El concepto de Agustín ya cuenta el lanzamiento interno: nada que hacer.';
    return;
  end if;
  if not exists (select 1 from public.embudos where id = 'emb_lanzamiento_interno') then
    raise exception 'Falta la estrategia «Lanzamiento interno» (emb_lanzamiento_interno).';
  end if;

  create schema if not exists respaldo;
  create table if not exists respaldo.honorarios_agustin_1911 (id text primary key, fila jsonb not null, cuando timestamptz not null default now());
  alter table respaldo.honorarios_agustin_1911 enable row level security;
  insert into respaldo.honorarios_agustin_1911 (id, fila)
    select h.id, to_jsonb(h) from public.honorarios h where h.id = 'hon_eq_growth'
  on conflict (id) do nothing;

  update public.honorarios h set
    conceptos = (
      select jsonb_agg(
        case when x.c->>'id' = concepto then
          x.c || jsonb_build_object(
            'siempreEmbudoIds', jsonb_build_array('emb_lanzamiento_interno'),
            'notas', coalesce(x.c->>'notas', '') || ' Lanzamiento interno (Aldana, 19/11): las ventas con la estrategia «Lanzamiento interno» le cuentan siempre, también el Upgrade AI (el upgrade común sigue sin contar). Se marca con «¿Es del lanzamiento interno?» al cargar la venta.')
        else x.c end
        order by x.ord)
      from jsonb_array_elements(h.conceptos) with ordinality as x(c, ord)),
    "actualizadoEn" = now(),
    "actualizadoPor" = 'Claude (pedido de Aldana, 19/11)'
  where h.id = 'hon_eq_growth';

  -- Tiene que haber quedado igual salvo ese concepto.
  if (select jsonb_agg(x.c order by x.ord) from jsonb_array_elements((select conceptos from public.honorarios where id = 'hon_eq_growth')) with ordinality as x(c, ord) where x.c->>'id' <> concepto)
     is distinct from (select jsonb_agg(x.c order by x.ord) from jsonb_array_elements(antes) with ordinality as x(c, ord) where x.c->>'id' <> concepto) then
    raise exception 'Cambió algo más que el concepto de Agustín: no se hace nada.';
  end if;
  --[ensayo]
end $$;

select jsonb_pretty(c) as concepto_de_agustin
from public.honorarios h, jsonb_array_elements(h.conceptos) c
where h.id = 'hon_eq_growth' and c->>'id' = 'con_muexl8akp7h3n';
