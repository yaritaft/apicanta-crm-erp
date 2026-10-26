-- ==================================================================
-- «Pedir acceso» desde la app (Juan Cruz, 26/10: Santiago y Agustín le
-- escribieron por WhatsApp para pedir acceso al CRM / a cambiar datos de
-- leads). Antes, la pantalla sin permiso decía «pediselo a los dueños» y no
-- daba cómo: el pedido terminaba en un chat. Ahora:
--
--   - Quien no tiene una pantalla (o la tiene sólo para mirar) aprieta
--     «Pedir acceso» y la base le deja un aviso en la campanita de cada
--     dueño: quién es, qué cuenta tiene, qué pantalla y para qué.
--   - Lo hace una función de la base (security definer), no el navegador:
--     el navegador no puede escribir avisos a mano (ver avisos.sql). Sólo
--     sirve a quien está en usuarios_permitidos, y sólo avisa a los dueños.
--   - Un pedido por persona, pantalla y día: apretar dos veces no llena la
--     campanita.
--
-- Hace falta avisos.sql. Se puede volver a correr.
-- ==================================================================

create or replace function public.pedir_acceso(
  p_pantalla text,
  p_ruta text default '',
  p_quiere text default 'ver',
  p_mensaje text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_nombre text;
  v_tipo text;
  v_tipo_nombre text;
  v_quiere text := case when p_quiere = 'editar' then 'editar' else 'ver' end;
  v_pantalla text := coalesce(nullif(left(btrim(coalesce(p_pantalla, '')), 80), ''), 'una pantalla');
  v_ruta text := left(btrim(coalesce(p_ruta, '')), 120);
  v_mensaje text := nullif(left(btrim(coalesce(p_mensaje, '')), 240), '');
  v_dia text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD');
  dest record;
  n integer := 0;
begin
  if v_email = '' then
    raise exception 'Entrá con tu cuenta para pedir acceso.' using errcode = '42501';
  end if;
  select u.nombre, u.rol into v_nombre, v_tipo from public.usuarios_permitidos u where lower(u.email) = v_email;
  if not found then
    raise exception 'Tu correo no está entre los accesos a la app: pedíselo a un dueño por fuera de la app.' using errcode = '42501';
  end if;
  -- Un dueño ya lo tiene todo.
  if v_tipo = 'dueno' then return 0; end if;

  v_nombre := coalesce(
    nullif(btrim(v_nombre), ''),
    (select e.nombre from public.equipo e where lower(btrim(e.email)) = v_email limit 1),
    split_part(v_email, '@', 1));
  v_tipo_nombre := coalesce((select t.nombre from public.tipos_cuenta t where t.id = v_tipo), v_tipo);

  for dest in select distinct lower(btrim(u.email)) as email from public.usuarios_permitidos u where u.rol = 'dueno' loop
    insert into public.avisos (id, para, tipo, titulo, cuerpo, de, "deEmail")
    values (
      'av_acceso_' || v_dia || '_' || substr(md5(v_email || '|' || v_ruta || '|' || v_quiere || '|' || dest.email), 1, 14),
      dest.email, 'acceso',
      v_nombre || case when v_quiere = 'editar' then ' pidió poder editar ' else ' pidió acceso a ' end || v_pantalla,
      left('Tiene la cuenta «' || v_tipo_nombre || '».' || coalesce(' Dice: «' || v_mensaje || '».', '')
        || ' Para dárselo: Equipo → Accesos (cambiarle el tipo) o Equipo → Tipos de cuenta (cambiar lo que ve ese tipo).', 400),
      v_nombre, v_email)
    on conflict (id) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.pedir_acceso(text, text, text, text) from public, anon;
grant execute on function public.pedir_acceso(text, text, text, text) to authenticated;
