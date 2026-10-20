-- Pedir la venta de un cobro a un closer — Apicanta ERP (Aldana, 20/10/2026)
--
-- Un cobro entra a una pasarela y nadie cargó la venta. Finanzas sabe de qué closer es (tuvo la llamada) y se la
-- pide desde Conciliación: «Pedir la venta a un closer». El pedido queda en el propio cobro:
--
--   movimientos."pedidoACloserId"   el id del closer en Equipo
--   movimientos."pedidoEn"          cuándo se pidió
--   movimientos."pedidoPor"         quién lo pidió
--
-- Al closer le aparece en «Pendientes» de su panel (ya ve los cobros sin conciliar: supabase/cobros-de-closers.sql) y
-- se va solo cuando el cobro deja de estar pendiente. No hace falta una tabla aparte ni tocar las políticas.
--
-- Una sola cosa más: el closer concilia con una fila entera y el trigger `movimientos_guarda_de_ventas` sólo le deja
-- cambiar la conciliación. Si Finanzas pide o saca un pedido justo mientras el closer tenía abierta la bandeja, su guardado
-- se rechazaría por «cambiar» esas columnas. Se agregan a lo que puede mover (no le da nada que no pueda ver: es el
-- pedido que le hicieron a él). El resto de la función queda igual.
--
-- Aditivo e idempotente: se puede correr de nuevo. Sin estas columnas la app anda igual (descarta esos campos al guardar):
-- lo único que no queda guardado es el pedido.
--
-- Para deshacerlo:
--   alter table public.movimientos drop column if exists "pedidoACloserId", drop column if exists "pedidoEn", drop column if exists "pedidoPor";
--   y volver a correr supabase/cobros-de-closers.sql (trae la función de antes).

do $$ begin
  if to_regclass('public.movimientos') is null then
    raise exception 'Esta no es la base del ERP (apicanta-erp): falta la tabla movimientos.';
  end if;
end $$;

alter table public.movimientos add column if not exists "pedidoACloserId" text;
alter table public.movimientos add column if not exists "pedidoEn" timestamptz;
alter table public.movimientos add column if not exists "pedidoPor" text;

create index if not exists movimientos_pedido_idx on public.movimientos ("pedidoACloserId") where "pedidoACloserId" is not null;

-- La función de cobros-de-closers.sql con las tres columnas nuevas entre las que el closer puede mover. Sólo si ya existe.
do $outer$
begin
  if to_regprocedure('public.movimientos_guarda_de_ventas()') is not null then
    execute $f$
      create or replace function public.movimientos_guarda_de_ventas()
      returns trigger
      language plpgsql
      set search_path = public
      as $body$
      declare
        conciliacion text[] := array['estado', 'pagoId', 'cuotaId', 'ventaId', 'conciliadoEn', 'conciliadoPor', 'vinculado',
                                     'pedidoACloserId', 'pedidoEn', 'pedidoPor'];
      begin
        -- Sin sesión de una persona (clave de servicio, editor de SQL): tal cual.
        if coalesce(auth.jwt() ->> 'email', '') = '' then
          return new;
        end if;
        if coalesce((select public.nivel_area('finanzas')), 0) >= 2 or coalesce((select public.es_dueno()), false) then
          return new;
        end if;
        if (to_jsonb(new) - conciliacion) is distinct from (to_jsonb(old) - conciliacion) then
          raise exception 'Un pago de la pasarela sólo se concilia: el monto, el cliente y la referencia los cambia Finanzas.'
            using errcode = '42501';
        end if;
        return new;
      end;
      $body$
    $f$;
  end if;
end
$outer$;
