-- Aviso en la campanita cuando Financiera ARS + Financiera USD + dLocal pasan el tope de US$ 50.000 — Apicanta ERP (Aldana, 19/11)
--
-- «Que me llegue una notificación cuando eso esté excediendo el máximo, así lo tengo en cuenta para avisar y hacer un retiro.»
--
-- La cuenta de cuánto hay en cada cuenta vive en la app (lib/tope-cuentas.ts, la misma de la pantalla de Saldos); la base no la repite: la app, cuando
-- alguien con Finanzas la tiene abierta y las cuentas pasan el tope, llama a esta función UNA vez por día y por total, y la función escribe el aviso para
-- quienes editan Finanzas (dueños, administración, contenido y finanzas). Un solo aviso por persona y día (el id lo evita repetir).
--
-- Seguridad: security definer, sólo para quien ve Finanzas; el texto lo arma la función con los números (no se acepta texto libre) y se rechazan
-- números imposibles. Se puede volver a correr.

do $$
begin
  if to_regclass('public.avisos') is null or to_regclass('public.usuarios_permitidos') is null or to_regclass('public.tipos_cuenta') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta avisos, usuarios_permitidos o tipos_cuenta.';
  end if;
  if to_regprocedure('public.nivel_area(text)') is null or to_regprocedure('public.es_dueno()') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: faltan nivel_area() y es_dueno().';
  end if;
end $$;

create or replace function public.avisar_tope_de_cuentas(p_total numeric, p_limite numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  dia text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD');
  n integer;
begin
  if not (coalesce(public.es_dueno(), false) or coalesce(public.nivel_area('finanzas'), 0) >= 1) then
    raise exception 'Tu tipo de cuenta no ve Finanzas.' using errcode = '42501';
  end if;
  if p_total is null or p_limite is null or p_limite <= 0 or p_limite > 10000000 or p_total <= p_limite or p_total > 100000000 then
    return 0;
  end if;

  insert into public.avisos (id, para, tipo, titulo, cuerpo, de)
  select
    'av_tope_' || dia || '_' || substr(md5(lower(u.email)), 1, 10),
    lower(u.email), 'tope-cuentas',
    'Financiera y dLocal pasaron el tope',
    'Entre Financiera ARS, Financiera USD y dLocal hay US$ ' || replace(to_char(round(p_total), 'FM999G999G999'), ',', '.') || ': US$ '
      || replace(to_char(round(p_total - p_limite), 'FM999G999G999'), ',', '.') || ' por encima del tope de US$ ' || replace(to_char(round(p_limite), 'FM999G999G999'), ',', '.')
      || '. Hay que avisar y hacer un retiro.',
    'Saldos'
  from public.usuarios_permitidos u
  join public.tipos_cuenta t on t.id = u.rol
  where coalesce(t.areas ->> 'finanzas', '') = 'editar'
    and u.email is not null
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.avisar_tope_de_cuentas(numeric, numeric) from public, anon;
grant execute on function public.avisar_tope_de_cuentas(numeric, numeric) to authenticated;
