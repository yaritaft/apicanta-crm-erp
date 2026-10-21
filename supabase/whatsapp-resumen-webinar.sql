-- ==================================================================
-- «Se unieron al grupo» sale solo del lector de WhatsApp (21/10).
--
-- El embudo del webinar (Webinars, el Dashboard, el informe) usaba un número
-- «Grupo» que alguien tenía que cargar a mano, y estaba en cero. El lector ya
-- sabe quién entró a cada grupo: esta vista lo suma por webinar para que la app
-- lo use sin bajar los teléfonos de nadie.
--
-- Una fila por webinar que tenga grupos atados:
--   · entraron:    los que pasaron por sus grupos (los que están + los que salieron),
--                  cada teléfono una vez aunque esté en dos grupos.
--   · dentro / salieron: de esos, cuántos siguen adentro y cuántos ya no están.
--   · sinTelefono: integrantes a los que WhatsApp les esconde el número (suma de sus grupos).
--
-- SEGURIDAD. `whatsapp_miembros` tiene los teléfonos y sólo la lee el área Webinars.
-- Esta vista corre con los permisos de su dueño (sin security_invoker) para poder
-- contar, pero sólo devuelve números sumados —ningún teléfono— y sólo a quien ya ve
-- el embudo del webinar: las áreas Panel, Webinars o Marketing, y nunca a quien tiene
-- «sólo lo suyo» (un closer). Sin sesión no devuelve nada.
--
-- Se puede correr de nuevo sin problema.
-- ==================================================================

create or replace view public.whatsapp_resumen_webinar as
with personas as (
  -- Cada teléfono una vez por webinar; «sigue adentro» si está adentro de alguno de sus grupos.
  select g."webinarId", m.telefono, bool_or(m.dentro) as dentro
    from public.whatsapp_miembros m
    join public.whatsapp_grupos g on g.id = m."grupoId"
   where g."webinarId" is not null
   group by g."webinarId", m.telefono
), personas_por_webinar as (
  select "webinarId",
         count(*)                         as entraron,
         count(*) filter (where dentro)   as dentro,
         count(*) filter (where not dentro) as salieron
    from personas
   group by "webinarId"
), grupos_por_webinar as (
  select "webinarId",
         count(*)                            as grupos,
         coalesce(sum("sinTelefono"), 0)::int as "sinTelefono",
         max("ultimaFoto")                   as "ultimaFoto"
    from public.whatsapp_grupos
   where "webinarId" is not null
   group by "webinarId"
)
select g."webinarId",
       g.grupos,
       coalesce(p.entraron, 0)  as entraron,
       coalesce(p.dentro, 0)    as dentro,
       coalesce(p.salieron, 0)  as salieron,
       g."sinTelefono",
       g."ultimaFoto"
  from grupos_por_webinar g
  left join personas_por_webinar p on p."webinarId" = g."webinarId"
 where (   (select public.nivel_area('panel'))     >= 1
        or (select public.nivel_area('webinars'))  >= 1
        or (select public.nivel_area('marketing')) >= 1)
   and (select not public.solo_lo_suyo());

revoke all on public.whatsapp_resumen_webinar from anon;
grant select on public.whatsapp_resumen_webinar to authenticated;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.views
    where table_schema = 'public' and table_name = 'whatsapp_resumen_webinar')                       as vista_de_1,
  (select count(*) from public.whatsapp_grupos where "webinarId" is not null)                        as grupos_atados,
  (select count(distinct "webinarId") from public.whatsapp_grupos where "webinarId" is not null)     as webinars_con_grupo;
