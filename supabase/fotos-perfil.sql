-- La foto de perfil de cada uno del equipo — Apicanta ERP (20/10/2026)
--
-- Pedido de Juan Cruz: «que todos cuando entren a la app tengan que ponerse foto de perfil, así en el chat se ve cheto
-- y no random con letras». La app la pide al entrar (si no la tiene) y la muestra en el chat de la ficha, las caras de
-- los hilos y quién leyó cada mensaje.
--
-- Se guarda CHICA y ya recortada por la app: un cuadrado de 192 px en JPEG como data URL (unos 15–25 KB), así viene con
-- el resto de los datos y se dibuja al toque, sin bucket ni URLs que vencen (lib/fotos-perfil.ts).
--
-- Quién: la ve cualquiera que entra a la app; cada uno pone y cambia SÓLO la suya (id = su mail); un dueño, la de
-- cualquiera (para cargarle la foto a alguien del equipo). Idempotente: se puede correr de nuevo.
-- CORRIDO en producción el 20/10/2026 después de un ensayo de seguridad con vuelta atrás (17 chequeos con cuentas reales
-- por tipo: cada uno sólo la suya, nada de afuera, fotos que no son imagen o de más de 400 KB rechazadas): 1 / true / 4 / 0.

do $$ begin
  if to_regprocedure('public.puede_entrar()') is null or to_regprocedure('public.es_dueno()') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan puede_entrar() o es_dueno().';
  end if;
end $$;

create table if not exists public.fotos_perfil (
  id               text primary key,          -- el mail en minúsculas
  nombre           text not null default '',
  foto             text not null,
  "actualizadoEn"  timestamptz not null default now(),
  constraint fotos_perfil_es_imagen check (foto like 'data:image/%'),
  constraint fotos_perfil_chica     check (length(foto) <= 400000)
);
alter table public.fotos_perfil enable row level security;

drop policy if exists ver_fotos_perfil    on public.fotos_perfil;
drop policy if exists crear_fotos_perfil  on public.fotos_perfil;
drop policy if exists editar_fotos_perfil on public.fotos_perfil;
drop policy if exists borrar_fotos_perfil on public.fotos_perfil;

create policy ver_fotos_perfil on public.fotos_perfil
  for select to authenticated
  using ((select public.puede_entrar()));

create policy crear_fotos_perfil on public.fotos_perfil
  for insert to authenticated
  with check ((select public.puede_entrar()) and (id = lower(coalesce(auth.jwt() ->> 'email', '')) or (select public.es_dueno())));

create policy editar_fotos_perfil on public.fotos_perfil
  for update to authenticated
  using (id = lower(coalesce(auth.jwt() ->> 'email', '')) or (select public.es_dueno()))
  with check ((select public.puede_entrar()) and (id = lower(coalesce(auth.jwt() ->> 'email', '')) or (select public.es_dueno())));

create policy borrar_fotos_perfil on public.fotos_perfil
  for delete to authenticated
  using (id = lower(coalesce(auth.jwt() ->> 'email', '')) or (select public.es_dueno()));

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'fotos_perfil') as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.fotos_perfil'::regclass)                              as rls_activo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fotos_perfil')                    as politicas_de_4,
  (select count(*) from public.fotos_perfil)                                                                        as fotos_cargadas;
