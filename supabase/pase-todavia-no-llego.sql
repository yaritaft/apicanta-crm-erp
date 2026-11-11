-- Movimientos entre cuentas: «todavía no llegó» (Aldana, 11/11/2026).
--  · Al contar el arqueo le quedaba una diferencia por la plata que salió de una cuenta y todavía no llegó a la otra: la app sólo sabía que algo
--    estaba en camino si una cuenta conectada lo había visto salir y el destino era Mercury; lo cargado a mano (o hacia Bank of America, Relay o la
--    Financiera) se daba por llegado el mismo día que salió.
--  · Ahora quien cuenta puede decir que un movimiento sigue en camino (lib/traspasos.ts: cambioDeLlegada): la cuenta de destino no lo espera hasta
--    que alguien lo marque como llegado o una cuenta lo vea llegar.
-- Aditivo: una columna nueva, sin valor para todo lo que ya está (sigue valiendo lo de siempre). Se puede correr de nuevo sin romper nada.

do $$ begin
  if to_regclass('public.traspasos') is null then
    raise exception 'Primero hay que correr traspasos.sql: falta la tabla traspasos.';
  end if;
end $$;

alter table public.traspasos add column if not exists "todaviaNoLlego" boolean;

-- Lo que quedó:
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'traspasos' and column_name = 'todaviaNoLlego') as columna_de_1,
  (select count(*) from public.traspasos where "todaviaNoLlego" is not null)                    as con_valor_de_0;
