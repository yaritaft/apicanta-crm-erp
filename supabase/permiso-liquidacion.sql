-- Permiso «Liquidación»: cerrar el mes sin ser dueño — Apicanta ERP (Aldana, 26/10/2026)
--
-- A Yari le suspendieron la cuenta de Mercury y había que hacer HOY el cierre de comisiones de closers, Agus, Santi y Nahue. La liquidación
-- (Equipo y honorarios) es de los dueños: `honorarios` y `liquidaciones` sólo las lee y las escribe es_dueno(). Aldana (tipo «Contenido y
-- finanzas», sin ser dueña) no podía abrirla, y Juan Cruz no quiere que dependa de él cada mes.
--
-- Un área nueva en los tipos de cuenta: `liquidacion`, con dos niveles, como las demás:
--
--   · «ver»    — mira la liquidación del mes y lo que cobra cada uno (para pagarle), y las comisiones;
--   · «editar» — además carga lo que falta (piezas, cantidades, correcciones, un monto), cierra el mes y marca quién cobró.
--
-- Lo que NO da: cambiar lo que cobra cada uno (los esquemas de `honorarios`), el equipo, los accesos, los tipos de cuenta ni los ajustes. Eso
-- sigue siendo de los dueños. Un dueño puede dar o sacar el permiso en Equipo y honorarios → Tipos de cuenta.
--
-- Qué hace este archivo (todo aditivo: las políticas de dueños no se tocan):
--
--   1. Quien tiene `liquidacion` en «ver» o «editar» LEE `honorarios` (el motor necesita los esquemas para calcular) y `liquidaciones`.
--   2. Quien la tiene en «editar» CREA y CAMBIA `liquidaciones` (cerrar, reabrir, cargar, marcar pagado). Nadie sin ser dueño las borra.
--   3. Le da «editar» al tipo `contenido_finanzas` (Aldana). Si más adelante se quiere otro tipo, se cambia desde la app.
--
-- Hace falta haber corrido tipos-cuenta.sql y honorarios.sql. Se puede volver a correr. Para deshacerlo:
--   drop policy if exists ver_honorarios_liquidacion on public.honorarios;
--   drop policy if exists ver_liquidaciones_liquidacion on public.liquidaciones;
--   drop policy if exists crear_liquidaciones_liquidacion on public.liquidaciones;
--   drop policy if exists editar_liquidaciones_liquidacion on public.liquidaciones;
--   update public.tipos_cuenta set areas = areas - 'liquidacion' where id = 'contenido_finanzas';

do $$ begin
  if to_regclass('public.honorarios') is null or to_regclass('public.liquidaciones') is null or to_regclass('public.tipos_cuenta') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan honorarios, liquidaciones o tipos_cuenta.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null or to_regprocedure('public.es_dueno()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql y honorarios.sql: faltan nivel_area() o es_dueno().';
  end if;
end $$;

-- ---------- 1. mirar ----------

drop policy if exists ver_honorarios_liquidacion on public.honorarios;
create policy ver_honorarios_liquidacion on public.honorarios
  for select to authenticated
  using ((select public.nivel_area('liquidacion')) >= 1);

drop policy if exists ver_liquidaciones_liquidacion on public.liquidaciones;
create policy ver_liquidaciones_liquidacion on public.liquidaciones
  for select to authenticated
  using ((select public.nivel_area('liquidacion')) >= 1);

-- ---------- 2. cerrar y cargar ----------

drop policy if exists crear_liquidaciones_liquidacion on public.liquidaciones;
create policy crear_liquidaciones_liquidacion on public.liquidaciones
  for insert to authenticated
  with check ((select public.nivel_area('liquidacion')) >= 2);

drop policy if exists editar_liquidaciones_liquidacion on public.liquidaciones;
create policy editar_liquidaciones_liquidacion on public.liquidaciones
  for update to authenticated
  using ((select public.nivel_area('liquidacion')) >= 2)
  with check ((select public.nivel_area('liquidacion')) >= 2);

-- ---------- 3. el tipo de Aldana ----------

update public.tipos_cuenta
   set areas = coalesce(areas, '{}'::jsonb) || '{"liquidacion": "editar"}'::jsonb
 where id = 'contenido_finanzas'
   and coalesce(areas ->> 'liquidacion', '') <> 'editar';

-- ---------- diagnóstico ----------
select
  (select count(*) from pg_policies where schemaname = 'public' and policyname like '%\_liquidacion' escape '\') as politicas_nuevas,
  (select areas ->> 'liquidacion' from public.tipos_cuenta where id = 'contenido_finanzas')                      as contenido_finanzas,
  (select string_agg(email, ', ') from public.usuarios_permitidos where rol = 'contenido_finanzas')              as quienes;
