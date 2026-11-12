-- Subirse a la mentoría y las plantillas de los downsells — Apicanta ERP (13/11/2026)
--
-- Manuel (12/11): los downsells tienen opción de subirse (Plus+ → mentoría pagando US$ 1.500; MID → 2 meses más de mentoría pagando US$ 1.000 de una) y
-- los contratos del Plus+ y del MID salían con la plantilla del Downsell. Esto deja en `ajustes.programas` (con respaldo del anterior):
--
--   1. Las plantillas de PandaDoc (armadas el 13/11 a partir de la del Downsell, con la firma de Yari, el campo de firma del alumno y las mismas
--      variables):  Downsell (sin bolsa de trabajo) · Downsell Plus+ · Hackear IA MID · Extensión de mentoría grupal del MID.
--      Sólo se cambia el programa que todavía tiene la plantilla de antes (7uUS5z4i2f3FAPXwuNHkUC): si alguien eligió otra en Ajustes, se respeta.
--   2. «Upgrade a mentoría» (US$ 1.500): un producto más del programa Hackear AI. Al firmar su contrato se le da lo que le falta (grupos, reuniones
--      de Zoom, Bonos) y se le levanta el corte de lo que tenía con el Plus+ o el MID.
--   3. «Extensión mentoría MID» (US$ 1.000): programa aparte `hackear-ia-mid-extension` con los mismos grupos y reuniones del MID, a 2 meses, y
--      `sumaTiempo`: a quien ya los tiene se le SUMAN 2 meses a su corte; a quien ya los perdió se le vuelven a dar por 2 meses.
--
-- Aditivo y se puede correr más de una vez.

do $$
begin
  if to_regclass('public.productos') is null or to_regclass('public.ajustes') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan productos o ajustes.';
  end if;
end $$;

-- ---------- 1. Los productos ----------

insert into public.productos (id, nombre, "precioLista", tipo, activo, orden)
select 'prod_upgrade_mentoria', 'Upgrade a mentoría', 1500, 'upsell', true, coalesce(max(orden), 0) + 1 from public.productos
on conflict (id) do nothing;

insert into public.productos (id, nombre, "precioLista", tipo, activo, orden)
select 'prod_extension_mid', 'Extensión mentoría MID (+2 meses)', 1000, 'upsell', true, coalesce(max(orden), 0) + 1 from public.productos
on conflict (id) do nothing;

-- ---------- 2. Los programas ----------

create schema if not exists respaldo;
create table if not exists respaldo.ajustes_programas_1311 as
  select now() as cuando, programas from public.ajustes where id = 1;

do $$
declare
  prog  jsonb;
  nuevo jsonb;
  mid   jsonb;
  cortes jsonb;
  vieja constant text := '7uUS5z4i2f3FAPXwuNHkUC';
  t_downsell constant text := 'NpaqVwphyLkLP4WFB2226W';
  t_plus     constant text := 'YafMsyG856QgbFmZKrghQR';
  t_mid      constant text := '44j8yGqtQymeNs2pGbocqV';
  t_ext      constant text := '46sU6pEnUQFf86XmmmHbrU';
begin
  select programas into prog from public.ajustes where id = 1;
  if prog is null or jsonb_typeof(prog) <> 'array' then
    raise exception 'ajustes.programas no está guardado como lista: no se toca (se arma desde Ajustes → Programas).';
  end if;

  -- 2a. Las plantillas nuevas (sólo donde todavía está la de antes) y «Upgrade a mentoría» dentro del programa completo.
  select coalesce(jsonb_agg(
    case
      when p ->> 'id' = 'downsell'      and p ->> 'plantillaId' = vieja
        then p || jsonb_build_object('plantillaId', t_downsell, 'plantillaNombre', 'Contrato de acceso al contenido grabado (Downsell)')
      when p ->> 'id' = 'downsell-plus' and p ->> 'plantillaId' = vieja
        then p || jsonb_build_object('plantillaId', t_plus, 'plantillaNombre', 'Contrato Downsell Plus+')
      when p ->> 'id' = 'hackear-ia-mid' and p ->> 'plantillaId' = vieja
        then p || jsonb_build_object('plantillaId', t_mid, 'plantillaNombre', 'Contrato Hackear IA MID')
      when p ->> 'id' = 'hackear-ai' and not jsonb_exists(coalesce(p -> 'productos', '[]'::jsonb), 'prod_upgrade_mentoria')
        then jsonb_set(p, '{productos}', coalesce(p -> 'productos', '[]'::jsonb) || '"prod_upgrade_mentoria"'::jsonb)
      else p
    end order by o), '[]'::jsonb)
    into nuevo
  from jsonb_array_elements(prog) with ordinality as t(p, o);

  -- 2b. La extensión del MID: los mismos grupos y reuniones que el MID tiene hoy (si alguien los cambió en Ajustes, la extensión los sigue), a 2 meses.
  if not exists (select 1 from jsonb_array_elements(nuevo) q where q ->> 'id' = 'hackear-ia-mid-extension') then
    select q into mid from jsonb_array_elements(nuevo) q where q ->> 'id' = 'hackear-ia-mid';
    if mid is null then
      raise notice 'No hay programa «hackear-ia-mid»: no se agrega la extensión (corré antes downsells-y-cortes.sql).';
    else
      select coalesce(jsonb_object_agg(k, 2), '{}'::jsonb) into cortes
      from jsonb_object_keys(coalesce(mid -> 'vencen', '{}'::jsonb)) k where k not like 'wisboo:%';
      nuevo := nuevo || jsonb_build_array(jsonb_build_object(
        'id', 'hackear-ia-mid-extension', 'nombre', 'Hackear IA MID · extensión', 'productos', jsonb_build_array('prod_extension_mid'),
        'plantillaId', t_ext, 'plantillaNombre', 'Contrato de extensión de mentoría grupal (Hackear IA MID)',
        'plantillaReservaId', '', 'plantillaReservaNombre', '', 'plantillaSinSesionesId', '', 'plantillaSinSesionesNombre', '',
        'wisboo', '[]'::jsonb, 'telegram', coalesce(mid -> 'telegram', '[]'::jsonb), 'zoom', coalesce(mid -> 'zoom', '[]'::jsonb), 'bonos', '[]'::jsonb,
        'vencen', cortes, 'sumaTiempo', true, 'activo', true));
    end if;
  end if;

  if nuevo <> prog then
    update public.ajustes set programas = nuevo where id = 1;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---------- Diagnóstico ----------
-- Tiene que dar: los dos productos nuevos, y los programas con su plantilla (downsell, downsell-plus, hackear-ia-mid y la extensión con sumaTiempo y 7 cortes de 2 meses).
select
  (select jsonb_agg(jsonb_build_object('id', id, 'precio', "precioLista", 'tipo', tipo) order by id)
     from public.productos where id in ('prod_upgrade_mentoria', 'prod_extension_mid')) as productos,
  (select jsonb_agg(jsonb_build_object('id', p ->> 'id', 'plantilla', p ->> 'plantillaId', 'suma', p -> 'sumaTiempo',
                                       'cortes', (select count(*) from jsonb_object_keys(coalesce(p -> 'vencen', '{}'::jsonb))),
                                       'upgrade', jsonb_exists(coalesce(p -> 'productos', '[]'::jsonb), 'prod_upgrade_mentoria')))
     from public.ajustes a, jsonb_array_elements(a.programas) p where a.id = 1) as programas;

-- Deshacer:
--   update public.ajustes set programas = (select programas from respaldo.ajustes_programas_1311 limit 1) where id = 1;
--   delete from public.productos where id in ('prod_upgrade_mentoria', 'prod_extension_mid')
--     and not exists (select 1 from public.ventas v where v."productoId" = productos.id);
