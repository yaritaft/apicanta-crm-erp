-- Estado follow-up del CRM — Apicanta ERP (Daniel, setter, 06/11/2026)
--
-- «Necesitaría que en la sección de CRM haya una columna de Follow-up o Estado
-- follow-up para poder tener mejor control sobre quiénes fueron recontactados de
-- los no-show y quiénes no.»
--
-- Es una columna más de la llamada, igual que "preCall" o "estadoPreCall"
-- (crm.sql): se guarda con el NOMBRE de la opción, como un campo de selección de
-- Airtable. Las opciones y sus colores viven en ajustes.crm (jsonb), y se editan
-- desde Ajustes → Estados de llamada; los valores de entrada están en
-- OPCIONES_POR_DEFECTO.followUp (src/lib/crm.ts), así que no hace falta cargar nada.
--
--   sesiones."followUp"   1° Mje Enviado, 2° Mje Enviado, Llamado, Respondió,
--                         Reagendó, Sin respuesta, No le interesa
--
-- Vacío en un no-show = todavía nadie lo recontactó: la tabla del CRM lo muestra
-- como «Sin recontactar» (no se guarda: lo deduce la pantalla).
--
-- Sin RLS nueva ni triggers: la fila es la misma de `sesiones`, y la escribe quien
-- ya puede editar llamadas (dueños, director, closer en lo suyo, setter). La app
-- manda sólo lo que cambió (un UPDATE de esta columna): el webhook de Calendly
-- escribe la misma fila y no se pisan.
--
-- IMPORTANTE: correr este archivo ANTES de publicar el código. Sin la columna, la
-- app la saca en silencio al guardar (columnaFaltante) y el dato no se guarda nunca.
--
-- Idempotente: se puede correr de nuevo sin romper nada.
-- Para deshacerlo: alter table public.sesiones drop column if exists "followUp";

do $$ begin
  if to_regclass('public.sesiones') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla sesiones.';
  end if;
end $$;

alter table public.sesiones
  add column if not exists "followUp" text;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sesiones' and column_name = 'followUp') as columna_de_1,
  (select count(*) from public.sesiones where "followUp" is not null)                         as llamadas_con_follow_up;
