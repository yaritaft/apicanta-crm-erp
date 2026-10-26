-- «Cuenta hasta el día»: la liquidación puede contar sólo hasta una fecha del mes — Apicanta ERP (Aldana, 26/10/2026)
--
-- A Yari le habilitaron Mercury por unas horas y había que pagar a mitad de mes. La liquidación incluía las ventas del día de
-- hoy, que todavía no cerró: «estaría bueno poder discriminar las de hoy y que sea el cierre sólo hasta el 25/10» (Aldana).
--
-- La app ahora deja elegir hasta qué día cuenta lo que se mide (cobros, ventas, llamadas, profit y devoluciones); los sueldos
-- fijos, bonos y piezas siguen siendo del mes entero. Esa fecha se guarda en la liquidación: una columna nueva, `corte`, con el día
-- en texto («2026-10-25»). Sin fecha (null) cuenta el mes entero, como siempre: no cambia ninguna liquidación que ya existe.
--
-- Hay que correr esto ANTES de publicar la app: al elegir una fecha, la app la guarda en esta columna.
--
-- Aditivo (se puede volver a correr). Para deshacerlo:
--   alter table public.liquidaciones drop constraint if exists liquidaciones_corte_ck;
--   alter table public.liquidaciones drop column if exists corte;

do $$ begin
  if to_regclass('public.liquidaciones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla liquidaciones.';
  end if;
end $$;

alter table public.liquidaciones add column if not exists corte text;

alter table public.liquidaciones drop constraint if exists liquidaciones_corte_ck;
alter table public.liquidaciones add constraint liquidaciones_corte_ck
  check (corte is null or corte ~ '^\d{4}-\d{2}-\d{2}$');

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'liquidaciones' and column_name = 'corte') as columna_de_1,
  (select count(*) from public.liquidaciones where corte is not null) as con_corte;
