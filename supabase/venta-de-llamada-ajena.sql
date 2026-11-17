-- ==================================================================
-- La venta que un closer cierra en la llamada de otro (17/11/2026).
--
-- Qué pasó: Dante le pasó un lead a Mariano. Mariano cerró y cargó la venta
-- desde esa llamada (el anfitrión de Calendly seguía siendo Dante). El guardia
-- de ventas (solo-lo-suyo-seguro.sql → ventas_guarda_del_closer) la rechazó:
-- «no puede atar una venta a la llamada de otro». La app igual dijo que la
-- venta había quedado y el contrato no salió («No encuentro esa venta»).
--
-- La raíz: desde el 13/11 todos los closers tienen «Leads de todos» (ven y
-- editan las llamadas de cualquiera), pero el guardia de ventas seguía
-- pidiendo que la llamada fuera propia. Quien ve las llamadas de todos puede
-- cargar la venta de cualquiera de ellas. La venta sigue siendo sólo suya
-- (va con su nombre de closer) y las ventas de los otros siguen sin verse.
--
-- Un closer SIN «Leads de todos» sigue igual que antes: sólo sus llamadas.
--
-- Es el mismo es_mi_llamada() de solo-lo-suyo-seguro.sql (que ya lo trae).
-- No toca datos. Volver a correrlo no cambia nada.
-- ==================================================================

do $$
begin
  if to_regprocedure('public.ve_todos_los_leads()') is null or to_regprocedure('public.anfitrion_es_mio(text)') is null then
    raise exception 'Primero hay que correr closer-ve-todos-los-leads.sql y solo-lo-suyo-seguro.sql: faltan ve_todos_los_leads() y anfitrion_es_mio().';
  end if;
end $$;

create or replace function public.es_mi_llamada(sid text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.ve_todos_los_leads()
      or exists (select 1 from public.sesiones s where s.id = sid and public.anfitrion_es_mio(s.anfitrion));
$$;

-- create or replace conserva los permisos: sigue sin poder llamarla un cliente (solo-lo-suyo-seguro.sql, parte 4).
