-- Realtime para los webinars — Apicanta ERP
--
-- La ficha y la lista de webinars se actualizan solas cuando cambia algo en
-- la base, sin preguntar cada tantos segundos: Supabase avisa en el momento.
--   sesiones     una agenda nueva de Calendly (el webhook la escribe)
--   webinars     las llamadas, los asistentes y el estado que completa el cron
--   yt_muestras  el minuto nuevo del vivo
--   yt_chat      los mensajes del chat
--   yt_estado    cuando el vivo sale al aire o termina
--
-- Realtime respeta RLS: cada persona recibe sólo lo que puede leer (el
-- equipo, por puede_entrar). Idempotente: se puede correr de nuevo.

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['webinars', 'sesiones', 'yt_muestras', 'yt_chat', 'yt_estado'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- diagnóstico ----------
select string_agg(tablename, ', ' order by tablename) as tablas_en_realtime
from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
