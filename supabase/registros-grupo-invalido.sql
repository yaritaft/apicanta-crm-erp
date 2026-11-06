-- Formularios: marca «Número inválido» (06/11)
--
-- La columna «Grupo de WhatsApp» de registros_webinar tenía tres estados (sin
-- revisar, unido, no-unido). Cuando el teléfono que dejó la persona no sirve
-- (incompleto o equivocado) el equipo no tenía cómo decirlo y lo marcaba «no unido».
-- Se agrega un cuarto: 'invalido'.
--
-- Sólo ensancha el check: no toca datos y se puede correr antes o después del
-- código nuevo. Idempotente.

do $$
declare c text;
begin
  if to_regclass('public.registros_webinar') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla registros_webinar.';
  end if;
  for c in
    select conname from pg_constraint
    where conrelid = 'public.registros_webinar'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%no-unido%'
  loop
    execute format('alter table public.registros_webinar drop constraint %I', c);
  end loop;
  alter table public.registros_webinar
    add constraint registros_webinar_grupo_check
    check (grupo is null or grupo in ('unido', 'no-unido', 'invalido'));
end $$;
