-- Resells: grabación de la llamada y unir los repetidos — Apicanta ERP (21/10/2026)
--
-- Mariano (closer, 21/10): «tampoco hay columna en resells para poner la grabación de la llamada» y «hay muchos en resells repetidos:
-- Marcos Aguilo, Nicolás González, entre otros».
--
--   1. `resells.grabacion`: el link de la grabación de la llamada (Fathom). Si está vacío y la llamada vino de Calendly, la app muestra
--      la que Fathom le trajo a la llamada.
--   2. Los repetidos eran llamadas REPROGRAMADAS: la agenda vieja quedó cancelada con su fila de resell (y lo que ya se había cargado) y
--      la nueva creó otra. `unir_resells_repetidos()` deja UNA fila por cita: la agenda viva se queda con lo cargado en la vieja (estado,
--      cash, caso de éxito, grabación, notas; si los dos tenían estado, el de la vieja queda en las notas) y la vieja se borra. La corre el
--      cron de Calendly cada 30 minutos, así que lo que se repita de acá en adelante (una reprogramación que Calendly no ató, un Excel
--      importado) se une solo. Se corre una vez acá. Respaldo: respaldo.resells_2110.
--
-- Es aditivo y se puede correr más de una vez.

alter table public.resells add column if not exists grabacion text not null default '';
-- Los de la llamada de testimonio (resells-testimonio.sql), por si este archivo corre antes: la unión de abajo los usa.
alter table public.resells add column if not exists testimonio text not null default '';
alter table public.resells add column if not exists "linkTestimonio" text not null default '';
alter table public.resells add column if not exists "linkPitch" text not null default '';

create schema if not exists respaldo;
create table if not exists respaldo.resells_2110 as select * from public.resells;

create or replace function public.unir_resells_repetidos()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  unidos integer := 0;
  par record;
  v public.resells%rowtype;
  n public.resells%rowtype;
  notas_nuevas text;
begin
  -- Una agenda «vieja» es una cancelada (la fila o su llamada de Calendly); la «viva», la que no está cancelada, de la misma
  -- persona (mismo mail), el mismo día o hasta 30 días después.
  for par in
    select distinct on (a.id) a.id as viejo, b.id as nuevo
    from public.resells a
    left join public.sesiones sa on sa.id = a."sesionId"
    join public.resells b on lower(b.email) = lower(a.email) and b.id <> a.id
    left join public.sesiones sb on sb.id = b."sesionId"
    where a.email <> ''
      and (a.cancelada or coalesce(sa.estado, '') = 'cancelada')
      and not b.cancelada and coalesce(sb.estado, '') <> 'cancelada'
      and b."fechaHora" >= a."fechaHora" - interval '1 day'
      and b."fechaHora" <= a."fechaHora" + interval '30 days'
    order by a.id, b."fechaHora"
  loop
    select * into v from public.resells where id = par.viejo;
    select * into n from public.resells where id = par.nuevo;
    if v.id is null or n.id is null then continue; end if;

    notas_nuevas := coalesce(n.notas, '');
    if coalesce(v.notas, '') <> '' and position(v.notas in notas_nuevas) = 0 then
      notas_nuevas := case when notas_nuevas = '' then v.notas else notas_nuevas || E'\n' || v.notas end;
    end if;
    if coalesce(v.estado, '') <> '' and coalesce(n.estado, '') <> '' and v.estado <> n.estado then
      notas_nuevas := case when notas_nuevas = '' then 'Antes: ' || v.estado else notas_nuevas || E'\n' || 'Antes: ' || v.estado end;
    end if;

    update public.resells set
      estado = case when coalesce(n.estado, '') = '' then coalesce(v.estado, '') else n.estado end,
      "cashCollect" = coalesce(n."cashCollect", v."cashCollect"),
      "casoDeExito" = n."casoDeExito" or v."casoDeExito",
      grabacion = case when coalesce(n.grabacion, '') = '' then coalesce(v.grabacion, '') else n.grabacion end,
      /* Lo de la llamada de testimonio (resells-testimonio.sql), si ya está la columna. */
      testimonio = case when coalesce(n.testimonio, '') = '' then coalesce(v.testimonio, '') else n.testimonio end,
      "linkTestimonio" = case when coalesce(n."linkTestimonio", '') = '' then coalesce(v."linkTestimonio", '') else n."linkTestimonio" end,
      "linkPitch" = case when coalesce(n."linkPitch", '') = '' then coalesce(v."linkPitch", '') else n."linkPitch" end,
      notas = notas_nuevas,
      "actualizadoEn" = now()
    where id = n.id;
    delete from public.resells where id = v.id;
    unidos := unidos + 1;
  end loop;
  return unidos;
end;
$$;

-- Sólo el servidor (el cron de Calendly) la llama: no es para la app ni para la clave pública.
revoke all on function public.unir_resells_repetidos() from public, anon, authenticated;
grant execute on function public.unir_resells_repetidos() to service_role;

-- Una vez, ahora.
select public.unir_resells_repetidos() as unidos;

-- Para chequear
select
  (select count(*) from public.resells)                                                                        as resells,
  (select count(*) from (select lower(email) from public.resells where email <> '' group by 1 having count(*) > 1) d) as mails_con_mas_de_una_fila,
  (select count(*) from respaldo.resells_2110)                                                                 as respaldadas;

-- Para deshacer: volver las filas de respaldo.resells_2110 (insert … on conflict do nothing sobre public.resells).
