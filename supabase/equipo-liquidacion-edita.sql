-- Quien liquida también arma el equipo: altas, bajas y lo que cobra cada uno — Apicanta ERP (Aldana, 11/11/2026)
--
-- Aldana se encarga de las finanzas y de dar de alta y de baja al equipo: «los editores, ahora Nacho no va a estar más; a este chico nuevo lo pasé como
-- Fabián y no se llama Fabián, no cobra lo mismo; Ángelo ya no va a estar en el equipo». Hoy el equipo y lo que cobra cada uno (`equipo`, `honorarios`)
-- los cambian sólo los dueños: ella no podía y dependía de Manu.
--
-- El permiso ya existe: «Liquidación: editar» (permiso-liquidacion.sql). Quien lo tiene ahora además:
--
--   · CREA y CAMBIA personas del equipo (nombre, puesto, rol, si está o ya no, desde y hasta cuándo);
--   · CREA y CAMBIA lo que cobra cada uno (`honorarios`: los esquemas).
--
-- Lo que NO da: borrar personas ni esquemas (una persona que se va se da de baja, no se borra: tiene historia); los accesos a la app (`usuarios_permitidos`) ni los
-- tipos de cuenta, que siguen siendo de los dueños. Y una protección: nadie que no sea dueño cambia LO SUYO. Ni su ficha ni lo que él mismo cobra; tampoco el
-- correo de nadie (el correo es lo que ata a una persona con su cuenta de la app). Para eso están los dueños.
--
-- Todo aditivo: las políticas de dueños no se tocan. Hace falta haber corrido tipos-cuenta.sql, honorarios.sql y permiso-liquidacion.sql. Se puede volver a correr.
-- Para deshacerlo, sacar las cuatro políticas *_liquidacion de equipo y honorarios, los dos disparadores no_tocar_lo_propio y la función del mismo nombre.

do $$ begin
  if to_regclass('public.equipo') is null or to_regclass('public.honorarios') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): faltan equipo u honorarios.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null or to_regprocedure('public.es_dueno()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql y honorarios.sql: faltan nivel_area() o es_dueno().';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'honorarios' and policyname = 'ver_honorarios_liquidacion') then
    raise exception 'Primero hay que correr permiso-liquidacion.sql.';
  end if;
end $$;

-- ---------- 1. el equipo ----------

drop policy if exists crear_equipo_liquidacion on public.equipo;
create policy crear_equipo_liquidacion on public.equipo
  for insert to authenticated
  with check ((select public.nivel_area('liquidacion')) >= 2);

drop policy if exists editar_equipo_liquidacion on public.equipo;
create policy editar_equipo_liquidacion on public.equipo
  for update to authenticated
  using ((select public.nivel_area('liquidacion')) >= 2)
  with check ((select public.nivel_area('liquidacion')) >= 2);

-- ---------- 2. lo que cobra cada uno ----------

drop policy if exists crear_honorarios_liquidacion on public.honorarios;
create policy crear_honorarios_liquidacion on public.honorarios
  for insert to authenticated
  with check ((select public.nivel_area('liquidacion')) >= 2);

drop policy if exists editar_honorarios_liquidacion on public.honorarios;
create policy editar_honorarios_liquidacion on public.honorarios
  for update to authenticated
  using ((select public.nivel_area('liquidacion')) >= 2)
  with check ((select public.nivel_area('liquidacion')) >= 2);

-- ---------- 3. lo propio y los correos son de los dueños ----------
-- Sin sesión de una persona (el servidor con la clave de servicio, el SQL de mantenimiento: no hay correo) o siendo dueño, no se mira nada.

create or replace function public.no_tocar_lo_propio()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  yo text := lower(coalesce(auth.jwt() ->> 'email', ''));
  correo_nuevo text;
  correo_viejo text := '';
  de_quien text;
begin
  if yo = '' or public.es_dueno() then
    return new;
  end if;
  if tg_table_name = 'equipo' then
    correo_nuevo := lower(coalesce(new.email, ''));
    if tg_op = 'UPDATE' then
      correo_viejo := lower(coalesce(old.email, ''));
      if correo_viejo is distinct from correo_nuevo then
        raise exception 'El correo de una persona lo cambia un dueño: es lo que la ata a su cuenta de la app.';
      end if;
    end if;
    if yo <> '' and (correo_nuevo = yo or correo_viejo = yo) then
      raise exception 'Tu ficha del equipo la cambia un dueño.';
    end if;
  else
    select lower(coalesce(m.email, '')) into de_quien from public.equipo m where m.id = new."miembroId";
    if yo <> '' and de_quien = yo then
      raise exception 'Lo que cobrás vos lo cambia un dueño.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists no_tocar_lo_propio on public.equipo;
create trigger no_tocar_lo_propio
  before insert or update on public.equipo
  for each row execute function public.no_tocar_lo_propio();

drop trigger if exists no_tocar_lo_propio on public.honorarios;
create trigger no_tocar_lo_propio
  before insert or update on public.honorarios
  for each row execute function public.no_tocar_lo_propio();

-- ---------- diagnóstico ----------
select
  (select count(*) from pg_policies where schemaname = 'public' and policyname like '%\_liquidacion' escape '\'
     and tablename in ('equipo', 'honorarios'))                                                  as politicas_de_4,
  (select count(*) from pg_trigger where tgname = 'no_tocar_lo_propio' and not tgisinternal)     as disparadores_de_2;
