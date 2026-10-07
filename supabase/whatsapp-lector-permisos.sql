-- WhatsApp de lectura: permisos más estrictos — Apicanta ERP (estrés del 07/10, lado de la app)
--
-- Dos cosas que los SQL anteriores (whatsapp-lector.sql y whatsapp-lector-qr.sql) dejaban flojas:
--
--   1. «SÓLO LO SUYO». Las políticas de `whatsapp_lector`, `whatsapp_grupos` y `whatsapp_miembros` pedían ver los
--      Webinars y nada más, así que una cuenta con «Sólo lo suyo» prendido (el closer, o un tipo propio) que tuviera
--      Webinars en «ver» leía los teléfonos de TODOS los miembros de los grupos, cuando las personas ajenas (contactos,
--      registros_webinar, leads, ventas) no las ve. Ahora las tres políticas agregan `not solo_lo_suyo()`, igual que
--      `registros_webinar`. Quien no es «sólo lo suyo» ve exactamente lo mismo que antes.
--
--   2. EL CÓDIGO QR ES UNA CREDENCIAL. `whatsapp_qr_vigente()` devuelve el código sólo si quien llama edita Ajustes
--      (`nivel_area('ajustes') >= 2`) y el código tiene menos de 60 segundos. Es UNA llamada atómica, con la sesión de
--      quien pide, y la decide la base con la misma regla que las políticas: no hay una ventana entre «¿puede?» y «dame
--      el código», y un error de la llamada (sesión vencida, límite de pedidos, la base caída) significa «sin código».
--      /api/whatsapp/estado la usa cuando existe; sin este archivo sigue leyendo el código con la clave de servicio,
--      después de comprobar el permiso (ahora sin dejar pasar ante un error).
--      `whatsapp_qr` sigue sin políticas ni permisos: esta función es la única puerta, además del servidor.
--
-- Idempotente: se puede correr de nuevo sin romper nada ni borrar datos.
-- Necesita tipos-cuenta.sql, whatsapp-lector.sql y whatsapp-lector-qr.sql corridos antes. No toca esos archivos.

do $$ begin
  if to_regclass('public.whatsapp_miembros') is null then
    raise exception 'Primero hay que correr whatsapp-lector.sql: faltan las tablas de WhatsApp.';
  end if;
  if to_regclass('public.whatsapp_qr') is null then
    raise exception 'Primero hay que correr whatsapp-lector-qr.sql: falta la tabla whatsapp_qr.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null or to_regprocedure('public.solo_lo_suyo()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan nivel_area() y solo_lo_suyo().';
  end if;
end $$;

-- ---------- 1. «sólo lo suyo» no ve los grupos ni los teléfonos ----------

drop policy if exists ver_whatsapp_lector on public.whatsapp_lector;
create policy ver_whatsapp_lector on public.whatsapp_lector
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1 and (select not public.solo_lo_suyo()));

drop policy if exists ver_whatsapp_grupos on public.whatsapp_grupos;
create policy ver_whatsapp_grupos on public.whatsapp_grupos
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1 and (select not public.solo_lo_suyo()));

drop policy if exists ver_whatsapp_miembros on public.whatsapp_miembros;
create policy ver_whatsapp_miembros on public.whatsapp_miembros
  for select to authenticated
  using ((select public.nivel_area('webinars')) >= 1 and (select not public.solo_lo_suyo()));

-- ---------- 2. el código QR: sólo quien edita Ajustes, y sólo si es de hace menos de un minuto ----------

create or replace function public.whatsapp_qr_vigente()
returns text
language sql stable security definer
set search_path = public
as $$
  select q.qr
  from public.whatsapp_qr q
  where q.id = 1
    and q.en > now() - interval '60 seconds'
    and public.nivel_area('ajustes') >= 2;
$$;

-- Sin sesión (anon) no; con sesión, la función misma pregunta por el nivel.
revoke execute on function public.whatsapp_qr_vigente() from public, anon;
grant execute on function public.whatsapp_qr_vigente() to authenticated;

-- ---------- diagnóstico ----------
select
  (select count(*) from pg_policies where schemaname = 'public'
     and policyname in ('ver_whatsapp_lector', 'ver_whatsapp_grupos', 'ver_whatsapp_miembros')
     and qual like '%solo_lo_suyo%')                                                                         as politicas_con_solo_lo_suyo_de_3,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'whatsapp_qr_vigente')                                       as funcion_qr_de_1,
  has_function_privilege('anon', 'public.whatsapp_qr_vigente()', 'execute')                                  as anon_puede_ejecutar_debe_ser_false;
