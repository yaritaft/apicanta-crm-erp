-- ==================================================================
-- El cierre del día del closer (EOD): cómo terminó cada llamada y, si
-- no cerró, por qué. Lo carga el closer al final del día, llamada por
-- llamada (lib/eod.ts), y lo lee el CRM para filtrar y analizar.
--
-- resultado       compro · no-compro · no-vino · reprogramo
-- objecion        por qué no cerró (la lista está en ajustes.crm.objeciones)
-- hizoOferta      si presentó la oferta en la llamada
-- cierreEstimado  para cuándo estima cerrarlo
-- eodEn / eodPor  cuándo y quién lo cargó
--
-- Sin estas columnas la app descarta esos campos al guardar.
-- ==================================================================
alter table sesiones add column if not exists "resultado" text;
alter table sesiones add column if not exists "objecion" text;
alter table sesiones add column if not exists "hizoOferta" boolean;
alter table sesiones add column if not exists "cierreEstimado" date;
alter table sesiones add column if not exists "eodEn" timestamptz;
alter table sesiones add column if not exists "eodPor" text;
