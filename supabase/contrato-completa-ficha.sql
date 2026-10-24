-- ==================================================================
-- El contrato completa la ficha del alumno (Lili, 24/10).
--
-- El closer carga para el contrato el documento, el domicilio, el
-- teléfono, el país y el mail del alumno; la ficha de Servicio los volvía
-- a pedir («Falta») aunque el alumno ya tuviera todo el onboarding hecho
-- (Simon Perez). Ahora, cada vez que un contrato tiene alumno y datos
-- (al crearlo, al corregirlo o cuando se le ata el alumno después),
-- completa lo que la ficha tiene VACÍO: DNI, domicilio y teléfono en
-- seguimiento_alumnos; país y mail en alumnos. Lo que Lili ya cargó no se
-- pisa nunca. Si el alumno todavía no tiene seguimiento, se le crea.
-- Un contrato anulado o con error no completa nada.
--
-- Es security definer: el contrato lo puede escribir quien no edita
-- alumnos (un closer corrigiendo los datos) y eso no tiene que fallar.
-- Se puede volver a correr.
-- ==================================================================

create or replace function public.completar_ficha_del_contrato(p_alumno text, p_estado text, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dni text := nullif(btrim(coalesce(p_datos ->> 'documento', '')), '');
  v_dom text := nullif(btrim(coalesce(p_datos ->> 'domicilio', '')), '');
  v_tel text := nullif(btrim(coalesce(p_datos ->> 'telefono', '')), '');
  v_pais text := nullif(btrim(coalesce(p_datos ->> 'pais', '')), '');
  v_mail text := nullif(lower(btrim(coalesce(p_datos ->> 'email', ''))), '');
begin
  if p_alumno is null or p_estado in ('anulado', 'error') then return; end if;
  if not exists (select 1 from alumnos where id = p_alumno) then return; end if;
  if v_dni is null and v_dom is null and v_tel is null and v_pais is null and v_mail is null then return; end if;

  update seguimiento_alumnos set
    dni = case when coalesce(btrim(dni), '') = '' and v_dni is not null then v_dni else dni end,
    domicilio = case when coalesce(btrim(domicilio), '') = '' and v_dom is not null then v_dom else domicilio end,
    telefono = case when coalesce(btrim(telefono), '') = '' and v_tel is not null then v_tel else telefono end
  where "alumnoId" = p_alumno
    and ((coalesce(btrim(dni), '') = '' and v_dni is not null)
      or (coalesce(btrim(domicilio), '') = '' and v_dom is not null)
      or (coalesce(btrim(telefono), '') = '' and v_tel is not null));
  if not exists (select 1 from seguimiento_alumnos where "alumnoId" = p_alumno) then
    insert into seguimiento_alumnos (id, "alumnoId", dni, domicilio, telefono)
    values ('seg_' || p_alumno, p_alumno, v_dni, v_dom, v_tel)
    on conflict (id) do nothing;
  end if;

  update alumnos set
    pais = case when coalesce(btrim(pais), '') = '' and v_pais is not null then v_pais else pais end,
    email = case when coalesce(btrim(email), '') = '' and v_mail is not null then v_mail else email end
  where id = p_alumno
    and ((coalesce(btrim(pais), '') = '' and v_pais is not null) or (coalesce(btrim(email), '') = '' and v_mail is not null));
end;
$$;
revoke all on function public.completar_ficha_del_contrato(text, text, jsonb) from public, anon, authenticated;

create or replace function public.contrato_completa_ficha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.completar_ficha_del_contrato(new."alumnoId", new.estado, new.datos);
  return new;
end;
$$;
revoke all on function public.contrato_completa_ficha() from public, anon, authenticated;

drop trigger if exists contratos_completan_ficha on public.contratos;
create trigger contratos_completan_ficha after insert or update of datos, "alumnoId", estado on public.contratos
  for each row execute function public.contrato_completa_ficha();

-- Lo que ya había: cada alumno con contrato, desde el más reciente que no está anulado (primero los firmados).
select count(*) as fichas_revisadas from (
  select public.completar_ficha_del_contrato(c."alumnoId", c.estado, c.datos)
  from (
    select distinct on (c."alumnoId") c."alumnoId", c.estado, c.datos
    from public.contratos c
    where c."alumnoId" is not null and c.estado not in ('anulado', 'error')
    order by c."alumnoId", (c.estado = 'firmado') desc, c."creadoEn" desc
  ) c
) x;
