-- Cuándo se le preguntó por última vez a cada pasarela y qué contestó (Aldana, 24/11).
--
-- «Se volvió a desconectar Whop»: no estaba desconectado. El cron de cada hora había traído los cobros de las 15:39–15:53 a las 16:00, pero
-- la pantalla de Aldana tenía la lista de cuando la abrió y decía «Último cobro recibido de Whop: 21 nov» (el fin de semana no hubo ventas por
-- Whop). Sin saber cuándo se revisó Whop por última vez, «el último cobro es viejo» y «Whop no anda» se ven igual.
--
--   · `public.pasarelas_estado`: una fila por pasarela. `revisadoEn` = la última vez que se le preguntó (cron de cada hora, el de cada 5
--     minutos de Whop y Hotmart, o «Buscar pagos nuevos» del selector). `okEn` = la última vez que contestó bien. `error`/`errorDesde` = lo
--     que dijo si falló y desde cuándo falla seguido. `ultimoCobro` = la fecha del cobro más nuevo que trajo.
--   · La escribe sólo el servidor con la clave de servicio (saltea RLS). La leen quienes ven Ventas o Finanzas (el closer incluido: carga
--     ventas con el selector de pagos). No tiene nombres, mails ni montos: sólo fechas y el texto del error.
--
-- Sin esto la app anda igual (el selector vuelve a decir sólo el último cobro). Idempotente; para deshacerlo: `drop table public.pasarelas_estado;`.

do $$ begin
  if to_regprocedure('public.nivel_area(text)') is null then
    raise exception 'Primero hay que correr tipos-cuenta.sql: falta nivel_area().';
  end if;
end $$;

create table if not exists public.pasarelas_estado (
  proveedor      text primary key,
  "revisadoEn"   timestamptz not null default now(),
  "okEn"         timestamptz,
  error          text,
  "errorDesde"   timestamptz,
  "ultimoCobro"  timestamptz,
  nuevos         integer not null default 0,
  fuente         text
);

alter table public.pasarelas_estado enable row level security;

drop policy if exists ver_pasarelas_estado on public.pasarelas_estado;
create policy ver_pasarelas_estado on public.pasarelas_estado
  for select to authenticated
  using ((select public.nivel_area('ventas')) >= 1 or (select public.nivel_area('finanzas')) >= 1);

revoke all on public.pasarelas_estado from anon;
revoke insert, update, delete on public.pasarelas_estado from authenticated;
grant select on public.pasarelas_estado to authenticated;

-- ---------- diagnóstico ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'pasarelas_estado') as tabla_de_1,
  (select relrowsecurity from pg_class where oid = 'public.pasarelas_estado'::regclass)                              as rls_activo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pasarelas_estado')                  as politicas_de_1,
  (select count(*) from public.pasarelas_estado)                                                                     as filas;
