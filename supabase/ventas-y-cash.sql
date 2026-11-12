-- Ventas y cash — Apicanta ERP (12/11/2026)
--
-- Manuel (WhatsApp, 12/11): Santiago «ve todo bien lo de Finanzas, pero hay información a la que no debería tener acceso. Él nada más
-- quiere ver los números de ventas y el cash collected». Finanzas era todo o nada: el 10/11 se le sumó «Ve Finanzas» y con eso le
-- llegaron los gastos, los movimientos, las cuentas y el P&L con los honorarios.
--
-- Esto agrega un permiso más fino, el área `cash` («Ventas y cash»): lo vendido y lo cobrado, sin gastos, cuentas, caja ni honorarios.
-- En la base son sólo cuatro lecturas, las mismas que ya tiene quien ve Ventas:
--
--   · ventas, cuotas y pagos (areas_que_leen)
--   · devoluciones (política ver_devoluciones): sin ellas el Cash Collected saldría de más
--
-- No hay ninguna escritura: `cash` no entra en areas_que_editan(). Y no lee ninguna tabla de Finanzas (gastos, movimientos, arqueos,
-- traspasos, transacciones, gastos_recurrentes) ni honorarios ni liquidaciones.
--
-- Se parte de la definición vigente de areas_que_leen() (la que tiene lo de Customer Success, Resells y Revisión de CV) y se le suma
-- `cash` a esas tres tablas, igual que hicieron resells-closers.sql y customer-success.sql: no se pisa lo de otros lotes.
-- Es aditivo y se puede correr más de una vez.

-- ---------- 1. Lectura de ventas, cuotas y pagos ----------

do $$
declare
  def_l text := pg_get_functiondef('public.areas_que_leen(text)'::regprocedure);
  nuevo_l text := def_l;
  t text;
begin
  foreach t in array array['ventas', 'cuotas', 'pagos'] loop
    -- Sólo si esa tabla todavía no lo tiene: correrlo de nuevo no cambia nada.
    if nuevo_l !~ ('when ''' || t || '''\s+then array\[[^\]]*''cash''') then
      nuevo_l := regexp_replace(nuevo_l, '(when ''' || t || '''\s+then array\[)', '\1''cash'',');
    end if;
  end loop;
  if nuevo_l <> def_l then execute nuevo_l; end if;
end $$;

-- ---------- 2. Las devoluciones ----------
-- Igual que la política vigente (devoluciones.sql) más `cash`: lo que se devolvió resta del Cash Collected.

drop policy if exists ver_devoluciones on public.devoluciones;
create policy ver_devoluciones on public.devoluciones
  for select to authenticated
  using (
    ((select public.nivel_area('ventas')) >= 1
      or (select public.nivel_area('finanzas')) >= 1
      or (select public.nivel_area('webinars')) >= 1
      or (select public.nivel_area('marketing')) >= 1
      or (select public.nivel_area('alumnos')) >= 1
      or (select public.nivel_area('clientes')) >= 1
      or (select public.nivel_area('cash')) >= 1)
    and ((select not public.solo_lo_suyo()) or "ventaId" = any ((select public.mis_ventas())::text[]))
  );

notify pgrst, 'reload schema';

-- ---------- Diagnóstico ----------
-- Tiene que dar: ventas, cuotas y pagos con 'cash'; gastos, movimientos, arqueos y transacciones SIN 'cash'; y la política de devoluciones con cash.
select
  public.areas_que_leen('ventas')        as lee_ventas,
  public.areas_que_leen('cuotas')        as lee_cuotas,
  public.areas_que_leen('pagos')         as lee_pagos,
  public.areas_que_leen('gastos')        as lee_gastos,
  public.areas_que_leen('movimientos')   as lee_movimientos,
  public.areas_que_leen('transacciones') as lee_transacciones,
  public.areas_que_editan('ventas')      as edita_ventas,
  (select qual like '%nivel_area(''cash''%' from pg_policies where schemaname = 'public' and tablename = 'devoluciones' and policyname = 'ver_devoluciones') as devoluciones_con_cash;

-- Deshacer: volver a correr tipos-cuenta.sql sólo repone la lista base; lo más simple es quitarle 'cash' a mano:
--   do $$ declare d text := pg_get_functiondef('public.areas_que_leen(text)'::regprocedure); begin
--     execute replace(d, '''cash'',', ''); end $$;
--   y recrear ver_devoluciones sin la línea de `cash` (devoluciones.sql).
