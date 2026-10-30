-- Bank of America y la retención de Hotmart (Aldana, 28–29/10/2026).
--  · Yari confirmó que lo que retiran Stripe, Whop y Hotmart ya no llega a Mercury sino a una cuenta del Bank of America (definitivo).
--  · Hotmart retiene lo cobrado ~15 días: el cobro cuenta en la caja y en las comisiones el día que se acredita (lib/acreditacion.ts).
-- Aditivo: dos columnas nuevas, una cuenta nueva y dos datos corregidos. Con copia de lo que se toca en respaldo.*_3010.
begin;

create schema if not exists respaldo;
create table if not exists respaldo.procesadores_3010 as select * from public.procesadores where id = 'proc_hotmart';
create table if not exists respaldo.traspasos_3010 as
  select * from public.traspasos
  where "origenId" in ('proc_stripe', 'proc_whop', 'proc_hotmart') and "destinoId" is null and fecha >= '2026-10-28';

-- Las dos columnas de la retención (sin valor para las cuentas que acreditan al instante).
alter table public.procesadores add column if not exists "diasDeRetencion" integer;
alter table public.procesadores add column if not exists "retencionDesde" date;

-- La cuenta nueva: se cuenta a mano en el arqueo (ninguna API la lee).
insert into public.procesadores (id, nombre, "feeRate", activo, automatico)
values ('proc_bofa', 'Bank of America', 0, true, false)
on conflict (id) do nothing;

-- Hotmart: 15 días, para los pagos desde el 26/10 (lo anterior ya se acreditó como siempre y el mes de octubre ya se cerró hasta el 25).
update public.procesadores set "diasDeRetencion" = 15, "retencionDesde" = '2026-10-26' where id = 'proc_hotmart';

-- Los retiros que salieron desde el 28/10 sin destino (Stripe → Bank of America) quedan con su destino.
update public.traspasos set "destinoId" = 'proc_bofa'
where "origenId" in ('proc_stripe', 'proc_whop', 'proc_hotmart') and "destinoId" is null and fecha >= '2026-10-28' and estado <> 'ignorado';

-- Aldana (29/10) chequeó los resells de Nahuel uno por uno: todos van a Hackear AI. Queda anotado en su regla (no cambia ningún número).
create table if not exists respaldo.honorarios_3010 as select * from public.honorarios where id = 'hon_eq_socio';
update public.honorarios set
  conceptos = (select jsonb_agg(
    case when c->>'id' = 'con_0910_nahuel' and coalesce(c->>'notas', '') not like '%todos van a Hackear AI%'
      then c || jsonb_build_object('notas', coalesce(c->>'notas', '') || ' Resells chequeados cliente por cliente: todos van a Hackear AI (Aldana, 29/10).')
      else c end order by ord)
    from jsonb_array_elements(conceptos) with ordinality as t(c, ord)),
  "actualizadoEn" = now(), "actualizadoPor" = 'Claude (Aldana, 29/10)'
where id = 'hon_eq_socio';

-- Lo que quedó:
select 'procesadores' as tabla, id, nombre, "diasDeRetencion"::text as dato, "retencionDesde"::text as dato2 from public.procesadores where id in ('proc_bofa', 'proc_hotmart')
union all
select 'traspasos', id, "origenId" || ' → ' || coalesce("destinoId", '—'), "montoSale"::text, left(fecha::text, 10) from public.traspasos where "destinoId" = 'proc_bofa';

commit;  -- APLICADO el 30/10 con el OK de Juan Cruz
