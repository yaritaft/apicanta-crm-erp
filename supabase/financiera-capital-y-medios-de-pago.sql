-- Financiera Capital (ARS y USD) como medio de pago, y las cuentas recaudadoras editables por Finanzas — Apicanta ERP (20/11/2026).
--
-- Aldana (20/11): «Podrás agregar como medio de pago Financiera Capital ARS y Financiera Capital USD». Y en el audio: «Vamos a trabajar con
-- una financiera nueva aparte de la de Juan y necesitamos que esté también la opción, así queda separado lo de la financiera de Juan y lo de
-- esa financiera». Juan Cruz: que Aldana o Santiago puedan agregar medios de pago ellos, sin pasar por él.
--
--   1. Las dos cuentas, separadas de «Financiera ARS Juan» y «Financiera USD Juan». Cada una tiene su propio reporte para la Financiera
--      (el corte de cobros sale por cuenta) y sus propios cobros. El tope de US$ 50.000 (lib/tope-cuentas.ts) cuenta SÓLO las de Juan
--      más dLocal, por id: estas no se suman.
--   2. Quien edita Finanzas puede crear y corregir cuentas recaudadoras (Ajustes → Catálogo → Cuentas recaudadoras). Antes sólo quien edita
--      Ajustes (los dueños). Lo demás de Ajustes sigue igual.
--
-- Aditivo e idempotente: se puede correr más de una vez.

-- ---------- 1. Las dos cuentas ----------

insert into public.procesadores (id, nombre, "feeRate", activo, automatico, moneda)
values
  ('proc_financiera_capital_ars', 'Financiera Capital ARS', 0, true, false, 'ARS'),
  ('proc_financiera_capital_usd', 'Financiera Capital USD', 0, true, false, 'USD')
on conflict (id) do nothing;

-- ---------- 2. Finanzas edita las cuentas recaudadoras ----------

do $$
declare
  def_e text := pg_get_functiondef('public.areas_que_editan(text)'::regprocedure);
  nuevo_e text := replace(def_e, $a$when 'procesadores'    then array['ajustes']$a$, $b$when 'procesadores'    then array['ajustes','finanzas']$b$);
begin
  if nuevo_e <> def_e then execute nuevo_e; end if;
end $$;

-- Para revisar: debe decir {ajustes,finanzas}.
-- select public.areas_que_editan('procesadores');
-- Deshacer: la fila se apaga desde la app (Activa) y la función vuelve con
--   replace(pg_get_functiondef('public.areas_que_editan(text)'::regprocedure), $$array['ajustes','finanzas']$$, $$array['ajustes']$$)
--   sólo en la línea de 'procesadores'.
