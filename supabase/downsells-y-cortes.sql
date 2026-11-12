-- Los tres downsells y los accesos que se cortan solos — Apicanta ERP (12/11/2026)
--
-- Manuel (WhatsApp, 12/11): hay downsells nuevos y quiere saber si los accesos se dan solos, y que en el Hackear IA MID, cuando la
-- persona termina el mes, se le saque sólo la mentoría grupal y conserve el contenido grabado.
--
--   · Downsell            US$   497  contenido grabado (el de siempre; la bolsa de trabajo pasa al Plus+)
--   · Downsell Plus+      US$   997  contenido + bolsa de trabajo + corrección de CV y LinkedIn (esto último lo hace el equipo a mano)
--   · Hackear IA MID      US$ 1.497  contenido grabado + 1 mes de mentoría grupal (grupos de Telegram y reuniones de Zoom)
--
-- Qué hace este archivo:
--   1. `accesos_alumno."venceEn"`: cuándo se corta solo cada acceso (null: no se corta). La pasada de cada hora (api/cron/contratos →
--      lib/accesos-vencimientos-servidor.ts) saca los que ya vencieron y nada más.
--   2. Los dos productos nuevos en el catálogo de ventas (tipo «downsell», como el Downsell) y el precio del Downsell en 497.
--   3. Los dos programas nuevos en `ajustes.programas` (con respaldo del anterior), el MID con sus cortes a 1 mes, y el Downsell sin la
--      bolsa de trabajo. Todo se puede cambiar desde Ajustes → Integraciones → Programas.
--
-- Los contratos del Plus+ y del MID salen, por ahora, con la plantilla del Downsell (Contrato de acceso al contenido grabado): cuando
-- Manu arme las propias en PandaDoc, se eligen en Ajustes → Programas.
--
-- Aditivo y se puede correr más de una vez (no duplica productos ni programas, y el respaldo se guarda una sola vez).

do $$
begin
  if to_regclass('public.accesos_alumno') is null or to_regclass('public.productos') is null or to_regclass('public.ajustes') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan accesos_alumno, productos o ajustes.';
  end if;
end $$;

-- ---------- 1. Cuándo se corta cada acceso ----------

alter table public.accesos_alumno add column if not exists "venceEn" timestamptz;
create index if not exists accesos_alumno_vence on public.accesos_alumno ("venceEn") where "venceEn" is not null;

-- ---------- 2. Los productos ----------

insert into public.productos (id, nombre, "precioLista", tipo, activo, orden)
select 'prod_downsell_plus', 'Downsell Plus+', 997, 'downsell', true, coalesce(max(orden), 0) + 1 from public.productos
on conflict (id) do nothing;

insert into public.productos (id, nombre, "precioLista", tipo, activo, orden)
select 'prod_hackear_ia_mid', 'Hackear IA MID', 1497, 'downsell', true, coalesce(max(orden), 0) + 1 from public.productos
on conflict (id) do nothing;

-- El Downsell pasa de 500 a 497 (sólo si nadie lo cambió a mano).
update public.productos set "precioLista" = 497 where id = 'prod_downsell' and "precioLista" = 500;

-- ---------- 3. Los programas ----------

create schema if not exists respaldo;
create table if not exists respaldo.ajustes_programas_1211 as
  select now() as cuando, programas from public.ajustes where id = 1;

do $$
declare
  prog  jsonb;
  nuevo jsonb;
  it    constant text := 'PRO-019fd69d87b070648850ba3e5e53e';   -- Mentoría (Hackear IT)
  ai    constant text := 'PRO-019fd69d7de5799e85772a1c877c7';   -- Mentoría (Hackear AI)
  plantilla constant text := '7uUS5z4i2f3FAPXwuNHkUC';
  plantilla_nombre constant text := 'Contrato de acceso al contenido grabado - XXXXX';
  bolsa constant text := '-1004492115716';                      -- Telegram: Bolsa de trabajo
begin
  select programas into prog from public.ajustes where id = 1;
  if prog is null or jsonb_typeof(prog) <> 'array' then
    raise exception 'ajustes.programas no está guardado como lista: no se toca (se arma desde Ajustes → Programas).';
  end if;
  nuevo := prog;

  -- 3a. El Downsell de siempre queda con el contenido solo: la bolsa de trabajo pasa al Plus+. Sólo si todavía tiene exactamente ese grupo
  --     (si alguien lo cambió a mano, no se pisa). A los que ya compraron no se les saca nada.
  select coalesce(jsonb_agg(case when p ->> 'id' = 'downsell' and p -> 'telegram' = jsonb_build_array(bolsa)
                                 then jsonb_set(p, '{telegram}', '[]'::jsonb) else p end order by o), '[]'::jsonb)
    into nuevo
  from jsonb_array_elements(nuevo) with ordinality as t(p, o);

  -- 3b. Downsell Plus+
  if not exists (select 1 from jsonb_array_elements(nuevo) q where q ->> 'id' = 'downsell-plus') then
    nuevo := nuevo || jsonb_build_array(jsonb_build_object(
      'id', 'downsell-plus', 'nombre', 'Downsell Plus+', 'productos', jsonb_build_array('prod_downsell_plus'),
      'plantillaId', plantilla, 'plantillaNombre', plantilla_nombre,
      'plantillaReservaId', '', 'plantillaReservaNombre', '', 'plantillaSinSesionesId', '', 'plantillaSinSesionesNombre', '',
      'wisboo', jsonb_build_array(it, ai), 'telegram', jsonb_build_array(bolsa), 'zoom', '[]'::jsonb, 'bonos', '[]'::jsonb,
      'vencen', '{}'::jsonb, 'activo', true));
  end if;

  -- 3c. Hackear IA MID: el contenido queda (no se corta) y la mentoría grupal se corta al mes.
  if not exists (select 1 from jsonb_array_elements(nuevo) q where q ->> 'id' = 'hackear-ia-mid') then
    nuevo := nuevo || jsonb_build_array(jsonb_build_object(
      'id', 'hackear-ia-mid', 'nombre', 'Hackear IA MID', 'productos', jsonb_build_array('prod_hackear_ia_mid'),
      'plantillaId', plantilla, 'plantillaNombre', plantilla_nombre,
      'plantillaReservaId', '', 'plantillaReservaNombre', '', 'plantillaSinSesionesId', '', 'plantillaSinSesionesNombre', '',
      'wisboo', jsonb_build_array(it, ai),
      -- General, Contenido recomendado, Novedades - Mentoría y Hackear AI
      'telegram', jsonb_build_array('-1004341505711', '-1004393795361', '-1004338558206', '-1003990857017'),
      -- Seguimiento y Consultas, Sesión de consultas IA y Simulacros y Taller
      'zoom', jsonb_build_array('84681899646', '84967094264', '83449857065'),
      'bonos', '[]'::jsonb,
      'vencen', jsonb_build_object(
        'telegram:-1004341505711', 1, 'telegram:-1004393795361', 1, 'telegram:-1004338558206', 1, 'telegram:-1003990857017', 1,
        'zoom:84681899646', 1, 'zoom:84967094264', 1, 'zoom:83449857065', 1),
      'activo', true));
  end if;

  if nuevo <> prog then
    update public.ajustes set programas = nuevo where id = 1;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---------- Diagnóstico ----------
-- Tiene que dar: la columna, los dos productos (997 y 1497), el Downsell en 497 y los programas downsell, downsell-plus y hackear-ia-mid.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'accesos_alumno' and column_name = 'venceEn') as columna_venceen,
  (select jsonb_agg(jsonb_build_object('id', id, 'precio', "precioLista", 'tipo', tipo, 'activo', activo) order by id)
     from public.productos where id in ('prod_downsell', 'prod_downsell_plus', 'prod_hackear_ia_mid')) as productos,
  (select jsonb_agg(jsonb_build_object('id', p ->> 'id', 'telegram', jsonb_array_length(p -> 'telegram'), 'zoom', jsonb_array_length(p -> 'zoom'),
                                       'wisboo', jsonb_array_length(p -> 'wisboo'), 'cortes', coalesce(p -> 'vencen', '{}'::jsonb)))
     from public.ajustes a, jsonb_array_elements(a.programas) p where a.id = 1) as programas;

-- Deshacer (todo vuelve como estaba; los accesos ya cortados no se reponen solos):
--   update public.ajustes set programas = (select programas from respaldo.ajustes_programas_1211 limit 1) where id = 1;
--   delete from public.productos where id in ('prod_downsell_plus', 'prod_hackear_ia_mid')
--     and not exists (select 1 from public.ventas v where v."productoId" = productos.id);
--   update public.productos set "precioLista" = 500 where id = 'prod_downsell' and "precioLista" = 497;
--   (la columna "venceEn" se puede dejar: sin cortes configurados no hace nada)
