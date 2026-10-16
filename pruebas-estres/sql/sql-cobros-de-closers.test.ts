/* supabase/cobros-de-closers.sql en un Postgres en memoria (PGlite): quien registra pagos (el closer, el director)
   ve los movimientos SIN conciliar y los que están atados a una venta que ve; los marca como conciliados y nada más;
   ata un cobro a un movimiento sólo si se puede atar; y un closer no corrige ni borra un cobro que Finanzas chequeó o
   de un mes con la liquidación cerrada. Es la misma serie que se ensayó en producción con rollback (daily con los
   closers, 16/10/2026).

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, montarBanco, sqlDe, type Banco } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pg-arnes.ts)";
const bancos: Banco[] = [];
after(async () => { for (const b of bancos) await b.db.close?.(); });

/* control-cruzado.sql da las columnas de chequeo y el trigger; el esquema mínimo no trae movimientos ni liquidaciones,
   y pagos.fecha es timestamptz en la base de verdad. */
async function banco(): Promise<Banco> {
  const b = await montarBanco(Pg!, { archivos: ["control-cruzado.sql"] });
  bancos.push(b);
  await b.ejecutar(`
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
    alter table public.pagos alter column fecha type timestamptz using fecha::timestamptz;
    create table public.liquidaciones (id text primary key, periodo text, estado text);
    create table public.movimientos (
      id text primary key, proveedor text, monto numeric not null, estado text not null default 'pendiente',
      "clienteNombre" text, "pagoId" text, "cuotaId" text, "ventaId" text, "conciliadoEn" text, "conciliadoPor" text, vinculado boolean default false
    );
    alter table public.movimientos enable row level security;
    create policy ver_movimientos on public.movimientos for select to authenticated using ((select public.ve('movimientos')));
    create policy editar_movimientos on public.movimientos for update to authenticated using ((select public.edita('movimientos'))) with check ((select public.edita('movimientos')));
    create policy crear_movimientos on public.movimientos for insert to authenticated with check ((select public.edita('movimientos')));
    grant select, insert, update, delete on public.movimientos, public.liquidaciones to authenticated;
  `);
  await b.ejecutar(sqlDe("cobros-de-closers.sql"));
  await b.ejecutar(`grant select, insert, update, delete on public.movimientos, public.liquidaciones to authenticated;
    grant execute on all functions in schema public to authenticated;`);
  await b.ejecutar(`
    insert into public.ventas (id, "closerId") values ('v1', 'm_dante'), ('v2', 'm_otro');
    insert into public.cuotas (id, "ventaId", "closerId") values ('c1', 'v1', 'm_dante'), ('c2', 'v2', 'm_otro');
    insert into public.movimientos (id, proveedor, monto, estado, "ventaId") values
      ('mov_libre', 'stripe', 3000, 'pendiente', null),
      ('mov_de_dante', 'stripe', 500, 'conciliado', 'v1'),
      ('mov_de_otro', 'stripe', 700, 'conciliado', 'v2'),
      ('mov_ignorado', 'stripe', 50, 'ignorado', null);
  `);
  return b;
}

const cuenta = async (b: Banco, quien: string, sql: string) => {
  const r = await b.intentar<{ n: string }>(quien, sql);
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  return r.ok ? Number(r.rows[0].n) : -1;
};

test("quien registra pagos ve los movimientos sin conciliar y los de sus ventas; no lo conciliado de otros ni lo ignorado", { skip: saltear }, async () => {
  const b = await banco();
  const ids = async (quien: string) => {
    const r = await b.intentar<{ id: string }>(quien, `select id from public.movimientos order by id`);
    assert.ok(r.ok);
    return r.ok ? r.rows.map((x) => x.id) : [];
  };
  assert.deepEqual(await ids("dante@x.com"), ["mov_de_dante", "mov_libre"], "el closer: lo suyo y lo libre");
  assert.deepEqual(await ids("otro@x.com"), ["mov_de_otro", "mov_libre"]);
  assert.deepEqual(await ids("santi@x.com"), ["mov_de_dante", "mov_de_otro", "mov_libre"], "el director ve todas las ventas, así que todo lo atado a ellas");
  assert.equal((await ids("aldana@x.com")).length, 4, "Finanzas sigue viendo todo, también lo ignorado");
  assert.deepEqual(await ids("seti@x.com"), [], "un setter no registra pagos: no ve nada");
  assert.deepEqual(await ids("marta@x.com"), [], "marketing tampoco");
});

test("un cobro se ata a un movimiento sólo si se puede atar: existe, está sin conciliar y el monto entra", { skip: saltear }, async () => {
  const b = await banco();
  const crear = (id: string, monto: number, mov: string) =>
    b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto, "movimientoId", chequeado, fecha) values ('${id}', 'c1', ${monto}, '${mov}', true, now())`);
  assert.ok((await crear("p_ok", 1000, "mov_libre")).ok);
  assert.ok((await crear("p_grande", 5000, "mov_libre")).ok);
  assert.ok((await crear("p_inventado", 100, "mov_inventado")).ok);
  assert.ok((await crear("p_ajeno", 100, "mov_de_otro")).ok);
  const filas = await b.servicio<{ id: string; movimientoId: string | null; chequeado: boolean | null }>(
    `select id, "movimientoId", chequeado from public.pagos order by id`);
  const de = (id: string) => filas.find((f) => f.id === id)!;
  assert.deepEqual([de("p_ok").movimientoId, de("p_ok").chequeado], ["mov_libre", true], "el que entra, queda atado y chequeado por la pasarela");
  assert.deepEqual([de("p_grande").movimientoId, de("p_grande").chequeado], [null, null], "5000 no entra en un pago de 3000");
  assert.deepEqual([de("p_inventado").movimientoId, de("p_inventado").chequeado], [null, null], "un movimiento inventado se ignora");
  assert.deepEqual([de("p_ajeno").movimientoId, de("p_ajeno").chequeado], [null, null], "uno ya conciliado (de otro) tampoco");
  /* El que ya está atado no puede crecer más allá de lo libre. */
  const subir = await b.intentar("dante@x.com", `update public.pagos set monto = 4000 where id = 'p_ok'`);
  assert.ok(!subir.ok && subir.codigo === "42501", "subirle el monto a un cobro atado más allá del pago de la pasarela se frena");
  assert.ok((await b.intentar("dante@x.com", `update public.pagos set monto = 2500 where id = 'p_ok'`)).ok, "hasta lo libre, sí");
  /* Soltarlo lo deja sin el tilde de la pasarela. */
  assert.ok((await b.intentar("dante@x.com", `update public.pagos set "movimientoId" = null where id = 'p_ok'`)).ok);
  assert.equal((await b.servicio<{ chequeado: boolean | null }>(`select chequeado from public.pagos where id = 'p_ok'`))[0].chequeado, null);
});

test("quien no es de Finanzas sólo concilia: ninguna otra columna del movimiento, ningún movimiento nuevo, ninguno de otro", { skip: saltear }, async () => {
  const b = await banco();
  const ok = await b.intentar("dante@x.com", `update public.movimientos set estado = 'conciliado', "ventaId" = 'v1', "pagoId" = 'p1', "conciliadoPor" = 'dante@x.com' where id = 'mov_libre'`);
  assert.ok(ok.ok && ok.n === 1, "conciliar el libre");
  const monto = await b.intentar("dante@x.com", `update public.movimientos set monto = 1 where id = 'mov_de_dante'`);
  assert.ok(!monto.ok && monto.codigo === "42501", "el monto lo cambia Finanzas");
  const cliente = await b.intentar("dante@x.com", `update public.movimientos set "clienteNombre" = 'X' where id = 'mov_de_dante'`);
  assert.ok(!cliente.ok && cliente.codigo === "42501");
  const ajeno = await b.intentar("dante@x.com", `update public.movimientos set estado = 'pendiente', "ventaId" = null where id = 'mov_de_otro'`);
  assert.ok(ajeno.ok && ajeno.n === 0, "uno ya conciliado de otro no se ve, así que no se toca");
  const ignorar = await b.intentar("dante@x.com", `update public.movimientos set estado = 'ignorado' where id = 'mov_de_dante'`);
  assert.ok(!ignorar.ok, "ignorar un movimiento no es conciliarlo");
  const nuevo = await b.intentar("dante@x.com", `insert into public.movimientos (id, proveedor, monto, estado) values ('mov_nuevo', 'stripe', 10, 'pendiente')`);
  assert.ok(!nuevo.ok, "un closer no inventa movimientos");
  const fin = await b.intentar("aldana@x.com", `update public.movimientos set monto = 3001 where id = 'mov_libre'`);
  assert.ok(fin.ok && fin.n === 1, "Finanzas cambia lo que quiera");
});

test("el candado: un closer no corrige ni borra un cobro que Finanzas chequeó ni uno de un mes con la liquidación cerrada; Finanzas y los dueños sí", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.pagos (id, "cuotaId", monto, fecha) values
    ('p_fin', 'c1', 100, '2026-10-05T15:00:00Z'), ('p_rech', 'c1', 100, '2026-10-05T15:00:00Z'), ('p_cerrado', 'c1', 100, '2026-09-30T15:00:00Z'), ('p_libre', 'c1', 100, '2026-10-05T15:00:00Z');
    update public.pagos set "chequeoFinanzas" = 'chequeado' where id = 'p_fin';
    update public.pagos set "chequeoFinanzas" = 'rechazado' where id = 'p_rech';
    insert into public.liquidaciones (id, periodo, estado) values ('liq_2026-09', '2026-09', 'cerrada'), ('liq_2026-10', '2026-10', 'abierta');`);
  const frena = async (quien: string, sql: string, que: string) => {
    const r = await b.intentar(quien, sql);
    assert.ok(!r.ok && r.codigo === "42501", `${que}: se frena (${r.ok ? "pasó" : r.mensaje})`);
  };
  await frena("dante@x.com", `update public.pagos set monto = 101 where id = 'p_fin'`, "corregir un cobro chequeado por Finanzas");
  await frena("dante@x.com", `delete from public.pagos where id = 'p_fin'`, "borrar un cobro chequeado por Finanzas");
  await frena("dante@x.com", `delete from public.pagos where id = 'p_cerrado'`, "borrar un cobro de septiembre con la liquidación cerrada");
  await frena("dante@x.com", `update public.pagos set notas = 'x' where id = 'p_cerrado'`, "tocar cualquier dato de un cobro del mes cerrado");
  assert.ok((await b.intentar("dante@x.com", `update public.pagos set notas = 'ok' where id = 'p_rech'`)).ok, "un cobro RECHAZADO se puede corregir");
  assert.ok((await b.intentar("dante@x.com", `update public.pagos set monto = 120 where id = 'p_libre'`)).ok, "y uno sin chequear, de un mes abierto");
  assert.ok((await b.intentar("dante@x.com", `delete from public.pagos where id = 'p_libre'`)).ok);
  assert.equal(await cuenta(b, "yari@x.com", `select count(*) as n from public.pagos where id = 'p_fin'`), 1);
  const dueno = await b.intentar("yari@x.com", `update public.pagos set notas = 'dueño' where id = 'p_cerrado'`);
  assert.ok(dueno.ok && dueno.n === 1, "un dueño corrige con el mes cerrado");
  const finanzas = await b.intentar("aldana@x.com", `update public.pagos set notas = 'finanzas' where id = 'p_fin'`);
  assert.ok(finanzas.ok && finanzas.n === 1, "Finanzas también");
  assert.ok((await b.intentar(null, `delete from public.pagos where id = 'p_cerrado'`)).ok, "la clave de servicio no tiene candado");
  /* Otro closer no toca lo ajeno (esto ya lo decía el RLS de pagos). */
  const ajeno = await b.intentar("otro@x.com", `update public.pagos set notas = 'x' where id = 'p_rech'`);
  assert.ok(ajeno.ok && ajeno.n === 0);
});

test("se puede correr dos veces (idempotente)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(sqlDe("cobros-de-closers.sql"));
  assert.equal(await cuenta(b, null, `select count(*) as n from pg_policies where tablename = 'movimientos' and policyname like '%ventas'`), 2);
});
