-- ==================================================================
-- Contratos a mano (Juan Cruz, 23/10: «¿se puede como en Blue OS?»).
--
-- 1. Un contrato firmado fuera de PandaDoc (en papel o por otro lado) se
--    sube desde la ficha con su PDF: origen 'manual'.
-- 2. Los que el equipo manda a mano desde PandaDoc son contratos reales,
--    aunque los haya traído el aviso de la clave de prueba (que ve el mismo
--    espacio de PandaDoc): hasta el 23/10 quedaban como 'prueba' y al
--    firmar no se marcaba la ficha. Se pasan a 'produccion' (con respaldo).
--
-- Se puede correr más de una vez.
-- ==================================================================

alter table public.contratos drop constraint if exists contratos_origen_check;
alter table public.contratos add constraint contratos_origen_check check (origen in ('app', 'pandadoc', 'manual'));

create schema if not exists respaldo;
create table if not exists respaldo.contratos_pandadoc_2310 as
  select * from public.contratos where origen = 'pandadoc';

update public.contratos set modo = 'produccion', "actualizadoEn" = now()
 where origen = 'pandadoc' and modo = 'prueba';
