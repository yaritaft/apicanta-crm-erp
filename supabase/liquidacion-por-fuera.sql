-- «Lo que se pagó por fuera de la app» en la liquidación — Apicanta ERP (Aldana, 23/11/2026)
--
-- Julio, agosto y septiembre de 2026 se liquidaron y pagaron con la planilla de Angelo. La app los recalculaba con las reglas y los
-- datos de hoy y no daba lo que se pagó (a alguien le daba la cuarta parte de lo que se le pagó). Ahora la liquidación guarda lo
-- que se le pagó a cada uno por fuera de la app y eso manda sobre la cuenta (lib/pagado-por-fuera.ts).
--
-- Una columna nueva, `porFuera` (jsonb): { fuente, personas: { <miembroId>: { monto, fecha, nota, cargadoPor, cargadoEn } }, marcados }.
-- Sin dato (null) la liquidación es la cuenta de siempre: no cambia ninguna que ya existe. Las políticas de la tabla no cambian (es la
-- misma fila: la leen y la editan los mismos de siempre).
--
-- Hay que correr esto ANTES de publicar la app: al cargar lo pagado, la app lo guarda en esta columna.
--
-- Aditivo (se puede volver a correr). Para deshacerlo:
--   alter table public.liquidaciones drop column if exists "porFuera";

do $$ begin
  if to_regclass('public.liquidaciones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla liquidaciones.';
  end if;
end $$;

alter table public.liquidaciones add column if not exists "porFuera" jsonb;

alter table public.liquidaciones drop constraint if exists liquidaciones_por_fuera_ck;
alter table public.liquidaciones add constraint liquidaciones_por_fuera_ck
  check ("porFuera" is null or (jsonb_typeof("porFuera") = 'object' and jsonb_typeof("porFuera"->'personas') = 'object'));

-- PostgREST tiene que ver la columna nueva enseguida.
notify pgrst, 'reload schema';

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'liquidaciones' and column_name = 'porFuera') as columna_de_1,
  (select count(*) from public.liquidaciones where "porFuera" is not null) as con_lo_pagado;
