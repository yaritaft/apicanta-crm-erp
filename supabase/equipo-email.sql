-- El email de cada persona del equipo — Apicanta ERP
--
-- Con el email con el que cada uno entra a la app, la app sabe quién está
-- usándola: el closer que carga una venta queda elegido solo y a Yari (CEO)
-- sólo le aparece Yari como closer. Se carga en Ajustes → Equipo.
--
-- Agregar una columna no toca RLS. Idempotente.

do $$ begin
  if to_regclass('public.equipo') is null or to_regclass('public.ventas') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla equipo o ventas.';
  end if;
end $$;

alter table public.equipo add column if not exists email text;

-- Un email, una persona (sin distinguir mayúsculas; vacío no cuenta).
create unique index if not exists equipo_email_uidx
  on public.equipo (lower(email)) where email is not null and email <> '';

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'equipo' and column_name = 'email') as columna_email_de_1,
  (select count(*) from public.equipo)                                                as personas;
