-- El video de YouTube de cada webinar — Apicanta ERP
--
-- Pedido de Juanchi: la ficha de un webinar embebe el vivo (o la grabación)
-- y muestra su título, descripción, vistas, comentarios y los suscriptores
-- del canal. Alcanza con guardar el link: los números los trae
-- /api/youtube en el momento, con cache de media hora, así que no se
-- guardan copias que después queden viejas.
--
-- Los links viejos (`enlaceRegistro`, `enlaceReplay`) siguen como estaban.
--
-- Hasta que esto corra, la app guarda todo lo demás del webinar y deja el
-- link sólo en memoria: la cola saca la columna que falta y reintenta.
--
-- Agregar una columna no toca RLS: la política acceso_equipo_webinars ya
-- cubre la tabla entera.
--
-- Idempotente: se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp).';
  end if;
  if to_regclass('public.webinars') is null then
    raise exception 'Falta la tabla webinars: esta no es la base del ERP (apicanta-erp).';
  end if;
end $$;

alter table public.webinars
  add column if not exists "youtubeUrl" text;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'webinars'
      and column_name = 'youtubeUrl')                                          as columna_youtube_de_1,
  (select relrowsecurity from pg_class where oid = 'public.webinars'::regclass) as rls_webinars,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'webinars')                     as politicas_webinars,
  (select count(*) from public.webinars)                                        as webinars;
