-- Reporte semanal: un formulario por programa — Apicanta ERP
--
-- El reporte de cada alumno ya no son sólo tres cifras: cada programa tiene su formulario
-- (Hackear Biz, Hackear IT…) y lo que contesta el alumno se guarda entero en el reporte de su
-- semana, para leerlo en la ficha del cliente.
--
--   programa    el programa del formulario («Hackear Biz»).
--   formulario  cuál era («hackear-biz»): con eso la ficha sabe qué pregunta es cada respuesta.
--   respuestas  { clave de la pregunta: lo que contestó }, tal cual (texto o número).
--
-- Los reportes de antes (y los que llegan por el webhook) quedan con estas tres en null: no se toca
-- ninguna fila. Idempotente: se puede correr de nuevo sin romper nada.
--
-- Orden: correr esto ANTES de publicar la versión de la app que guarda las respuestas.

alter table public.reportes
  add column if not exists programa   text,
  add column if not exists formulario text,
  add column if not exists respuestas jsonb;

select count(*) reportes, count(respuestas) con_respuestas from public.reportes;
