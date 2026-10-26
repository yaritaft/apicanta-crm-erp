-- ==================================================================
-- El contrato completa la ficha del alumno (Lili, 24/10).
--
-- El closer carga para el contrato el documento, el domicilio, el
-- teléfono, el país y el mail del alumno; la ficha de Servicio los volvía
-- a pedir («Falta») aunque el alumno ya tuviera todo el onboarding hecho
-- (Simon Perez). Ahora, cada vez que un contrato tiene alumno y datos
-- (al crearlo, al corregirlo o cuando se le ata el alumno después),
-- completa lo que la ficha tiene VACÍO: DNI, domicilio, teléfono y fecha
-- de nacimiento y perfil (Stack) en seguimiento_alumnos; país y mail en alumnos. Lo que Lili ya cargó no se
-- pisa nunca. Si el alumno todavía no tiene seguimiento, se le crea.
-- La excepción es el perfil (26/10): si al contrato le cambian el perfil de
-- un roadmap a otro, Programa → Perfil lo sigue (salvo que ahí diga algo
-- más fino que no es un roadmap, como «Backend»).
-- Un contrato anulado o con error no completa nada.
--
-- Es security definer: el contrato lo puede escribir quien no edita
-- alumnos (un closer corrigiendo los datos) y eso no tiene que fallar.
-- Se puede volver a correr.
-- ==================================================================

-- La fecha de nacimiento (nacimiento.sql), por si este archivo corre antes.
alter table public.seguimiento_alumnos add column if not exists nacimiento date;

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
  v_nac date;
  /* El perfil del alumno (Lili, 25/10): el que cargó el closer en el contrato es el «Perfil» de Programa en la ficha. */
  v_perfil text := case when p_datos ->> 'perfil' in ('Full Stack', 'Mobile Developer', 'Data Engineer', 'AI Engineer') then p_datos ->> 'perfil' end;
begin
  if p_alumno is null or p_estado in ('anulado', 'error') then return; end if;
  if not exists (select 1 from alumnos where id = p_alumno) then return; end if;
  /* Una fecha mal escrita no frena el contrato: se ignora. */
  begin
    if coalesce(p_datos ->> 'nacimiento', '') ~ '^\d{4}-\d{2}-\d{2}$' then v_nac := (p_datos ->> 'nacimiento')::date; end if;
  exception when others then v_nac := null;
  end;
  if v_dni is null and v_dom is null and v_tel is null and v_pais is null and v_mail is null and v_nac is null and v_perfil is null then return; end if;

  update seguimiento_alumnos set
    dni = case when coalesce(btrim(dni), '') = '' and v_dni is not null then v_dni else dni end,
    domicilio = case when coalesce(btrim(domicilio), '') = '' and v_dom is not null then v_dom else domicilio end,
    telefono = case when coalesce(btrim(telefono), '') = '' and v_tel is not null then v_tel else telefono end,
    nacimiento = coalesce(nacimiento, v_nac),
    stack = case when coalesce(btrim(stack), '') = '' and v_perfil is not null then v_perfil else stack end
  where "alumnoId" = p_alumno
    and ((coalesce(btrim(dni), '') = '' and v_dni is not null)
      or (coalesce(btrim(domicilio), '') = '' and v_dom is not null)
      or (coalesce(btrim(telefono), '') = '' and v_tel is not null)
      or (nacimiento is null and v_nac is not null)
      or (coalesce(btrim(stack), '') = '' and v_perfil is not null));
  if not exists (select 1 from seguimiento_alumnos where "alumnoId" = p_alumno) then
    insert into seguimiento_alumnos (id, "alumnoId", dni, domicilio, telefono, nacimiento, stack)
    /* dni, domicilio y teléfono son «not null default ''»: un null explícito no toma el default. */
    values ('seg_' || p_alumno, p_alumno, coalesce(v_dni, ''), coalesce(v_dom, ''), coalesce(v_tel, ''), v_nac, coalesce(v_perfil, ''))
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
declare
  v_antes text := case when tg_op = 'UPDATE' then old.datos ->> 'perfil' end;
  v_ahora text := new.datos ->> 'perfil';
begin
  /* Completar la ficha nunca frena guardar el contrato: si algo falla, queda un aviso en el registro de la base y listo. */
  begin
    perform public.completar_ficha_del_contrato(new."alumnoId", new.estado, new.datos);
    /* Le CAMBIARON el perfil al contrato (de un roadmap a otro: «Corregir», o «Cambiar» en la bienvenida): Programa → Perfil
       lo sigue (Lili, 26/10: «y viceversa»). Si ahí hay uno más fino que no es un roadmap («Backend», «Frontend»), es de
       Servicio y se deja: la bienvenida toma el del contrato. */
    if new."alumnoId" is not null and new.estado not in ('anulado', 'error')
       and v_antes in ('Full Stack', 'Mobile Developer', 'Data Engineer', 'AI Engineer')
       and v_ahora in ('Full Stack', 'Mobile Developer', 'Data Engineer', 'AI Engineer') and v_ahora <> v_antes then
      update seguimiento_alumnos set stack = v_ahora
      where "alumnoId" = new."alumnoId" and stack is distinct from v_ahora
        and (coalesce(btrim(stack), '') = ''
          or lower(regexp_replace(btrim(stack), '\s+', ' ', 'g')) in ('full stack', 'mobile developer', 'data engineer', 'ai engineer', 'ia engineer'));
    end if;
  exception when others then
    raise warning 'contrato_completa_ficha (%): %', new.id, sqlerrm;
  end;
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
