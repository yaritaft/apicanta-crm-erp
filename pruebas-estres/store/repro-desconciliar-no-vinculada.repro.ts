/* Repro mínimo para refutar (o confirmar) el hallazgo: desconciliar() en la rama «no vinculada» deja en la base
   pagoId, cuotaId, ventaId, conciliadoEn y conciliadoPor viejos.

   Cada prueba AFIRMA LO QUE PASA HOY (pasa = el bug existe). Se corre con:
     node --import ./pruebas/registrar.mjs --test pruebas/stress/repro-desconciliar-no-vinculada.repro.ts

   Qué se mira:
   1. Que la base sí recibió los valores al conciliar (control: la nube falsa guarda bien lo que le llega).
   2. Qué viaja por HTTP al deshacer (el cliente de verdad, @supabase/supabase-js, habla con la nube falsa).
   3. Qué queda en la base y qué ve una pantalla recargada (cargarDeLaNube de un store nuevo).
   4. Las consecuencias en lib/ (quienPago, cobroDelReembolso) con las filas que lee el servidor.
   5. El control: la rama «vinculada» de la MISMA función sí vacía los cinco campos (UPDATE con null).
   6. Contra Postgres de verdad (PGlite, en memoria, con el DDL del repo) si está: se reproducen los mismos pedidos
      con el SQL que arma PostgREST para un upsert merge-duplicates con ?columns=. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BaseFalsa, instalar, type Fila, type Peticion } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";
import { RAIZ } from "./_aleatorio";
import type { E } from "./_acciones";
import { cobroDelReembolso } from "@/lib/reembolsos";
import { quienPago } from "@/lib/conciliacion";

const base = new BaseFalsa();
instalar(base);

const CINCO = ["pagoId", "cuotaId", "ventaId", "conciliadoEn", "conciliadoPor"] as const;
const por = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id) as T;
const cinco = (f: Fila) => Object.fromEntries(CINCO.map((k) => [k, f[k] ?? null]));

/* Un cobro pendiente que una cuota pendiente cubre entera: así conciliar() lo deja «conciliado» con los cinco campos. */
function elegir(e: E) {
  for (const mov of e.movimientos.filter((m: E) => m.estado === "pendiente" && !m.vinculado)) {
    const cuota = e.cuotas.find((c: E) => c.estado === "pendiente" && c.monto >= mov.monto - 0.01);
    if (cuota) return { mov, cuota };
  }
  throw new Error("la demo no tiene un cobro pendiente que una cuota pendiente cubra entero");
}

/* Se arma una vez y lo leen las pruebas de abajo (comparten la misma base falsa, por eso van en orden). */
const S = await conDemo(base);
const e0 = estadoDe(S);
const { mov, cuota } = elegir(e0);
const antes = { ...mov };

await yEsperar(S, () => assert.ok(S.acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: mov.monto }]), "conciliar() devolvió false"));
const trasConciliar = { ...base.tabla("movimientos").get(mov.id)! };
const pagoViejoId = trasConciliar.pagoId as string;
const pedidosAntesDeDeshacer = base.peticiones("upsert", "movimientos").length;

await yEsperar(S, () => assert.ok(S.acciones.desconciliar(mov.id), "desconciliar() devolvió false"));
const trasDeshacer = { ...base.tabla("movimientos").get(mov.id)! };
const pedidoDeDeshacer = base.peticiones("upsert", "movimientos").slice(pedidosAntesDeDeshacer);
const enMemoria = por<E>(estadoDe(S).movimientos, mov.id);
/* Los pedidos de UN solo cobro que mandó el store (los copio ahora: la prueba de control de abajo vacía la base falsa y su registro). */
const pedidosDelCobro = base.peticiones("upsert", "movimientos").filter((p) => p.filas!.length === 1 && p.filas![0].id === mov.id).map((p) => JSON.parse(JSON.stringify(p)) as Peticion);

test("control: al conciliar, la base recibe y guarda los cinco campos", () => {
  assert.equal(antes.estado, "pendiente");
  assert.equal(trasConciliar.estado, "conciliado");
  assert.ok(trasConciliar.pagoId && trasConciliar.cuotaId && trasConciliar.ventaId && trasConciliar.conciliadoEn && trasConciliar.conciliadoPor, JSON.stringify(cinco(trasConciliar)));
  console.log("# base tras conciliar:", JSON.stringify({ estado: trasConciliar.estado, ...cinco(trasConciliar) }));
});

test("en pantalla (memoria) el cobro queda pendiente y SIN los cinco campos", () => {
  assert.equal(enMemoria.estado, "pendiente");
  for (const k of CINCO) assert.equal(enMemoria[k], undefined, `${k} sigue en memoria: ${enMemoria[k]}`);
});

test("por HTTP: el pedido de deshacer es un upsert que NO nombra los cinco campos (ni en ?columns= ni en el cuerpo)", () => {
  assert.equal(pedidoDeDeshacer.length, 1, "se esperaba un solo upsert a movimientos");
  const p: Peticion = pedidoDeDeshacer[0];
  console.log("# POST", p.url.slice(0, 120) + "…", "\n# Prefer:", p.prefer, "\n# columns:", JSON.stringify(p.columnas), "\n# cuerpo[0]:", JSON.stringify(p.filas![0]));
  assert.match(p.prefer ?? "", /merge-duplicates/);
  for (const k of CINCO) {
    assert.ok(!p.columnas!.includes(k), `${k} viaja en ?columns=`);
    assert.ok(!(k in p.filas![0]), `${k} viaja en el cuerpo`);
  }
  assert.equal(p.filas![0].estado, "pendiente");
  /* y no hay ningún UPDATE aparte que los vacíe */
  const updates = base.peticiones("update", "movimientos").filter((u) => u.ids?.includes(mov.id) && u.n > p.n - 100);
  assert.deepEqual(updates.filter((u) => CINCO.some((k) => k in (u.cambios ?? {}))), []);
});

test("BUG: en la base el cobro queda «pendiente» pero apuntando al pago, la cuota y la venta de la conciliación deshecha", () => {
  console.log("# base tras deshacer:", JSON.stringify({ estado: trasDeshacer.estado, ...cinco(trasDeshacer) }));
  assert.equal(trasDeshacer.estado, "pendiente");
  for (const k of CINCO) assert.equal(trasDeshacer[k], trasConciliar[k], `${k} cambió`);
  /* el pago al que apunta ya no existe: se borró al deshacer */
  assert.equal(base.tabla("pagos").has(pagoViejoId), false);
  assert.ok(trasDeshacer.ventaId, "ventaId quedó");
});

test("BUG: al recargar (store nuevo + cargarDeLaNube) memoria y base dicen cosas distintas", async () => {
  const alRecargar = por<E>((await recargado()).movimientos, mov.id);
  assert.equal(alRecargar.estado, enMemoria.estado);
  for (const k of CINCO) {
    assert.equal(enMemoria[k], undefined);
    assert.equal(alRecargar[k], trasConciliar[k], `${k} al recargar: ${alRecargar[k]}`);
  }
});

test("BUG (consecuencia): con las filas de la base, cobroDelReembolso() ata un reembolso de la pasarela a la venta de la conciliación que se deshizo", async () => {
  const delServidor = { // lo que lee lib/servidor.ts: select * de movimientos/pagos/ventas/cuotas
    ventas: base.filas("ventas"), cuotas: base.filas("cuotas"), pagos: base.filas("pagos"), movimientos: base.filas("movimientos"),
    devoluciones: [], procesadores: base.filas("procesadores"), contactos: [], leads: [],
  } as never;
  const r = { proveedor: mov.proveedor, referenciasCobro: [mov.referencia] };
  const cobro = cobroDelReembolso(delServidor, r);
  console.log("# cobroDelReembolso con filas de la base →", cobro ? `venta ${cobro.venta.id} (${cobro.venta.contactoNombre})` : null);
  assert.equal(cobro?.venta.id, trasConciliar.ventaId);

  /* en memoria (lo que se ve) el mismo cobro NO está atado a nada */
  const enPantalla = { ...(delServidor as object), ventas: estadoDe(S).ventas, cuotas: estadoDe(S).cuotas, pagos: estadoDe(S).pagos, movimientos: estadoDe(S).movimientos } as never;
  assert.equal(cobroDelReembolso(enPantalla, r), null);

  /* y la pantalla recargada le atribuye el cobro a esa persona (quién pagó / ficha) */
  const rec = await recargado();
  const q = quienPago(rec as never, por<E>(rec.movimientos, mov.id));
  console.log("# quienPago tras recargar →", JSON.stringify({ fuente: q.fuente, fichaId: q.fichaId, nombre: q.nombre }));
  assert.equal(q.fuente, "venta");
  const qMem = quienPago(estadoDe(S) as never, enMemoria);
  assert.notEqual(qMem.fuente, "venta");
});

/* ---------- Control: la rama «vinculada» de la misma función sí lo hace bien ---------- */
test("control: desconciliar() de un cobro VINCULADO a un pago ya cargado sí vacía los cinco campos en la base", async () => {
  const S2 = await conDemo(base);
  const e = estadoDe(S2);
  const m = e.movimientos.find((x: E) => x.estado === "pendiente" && !x.vinculado);
  const pago = e.pagos.find((p: E) => !p.movimientoId);
  await yEsperar(S2, () => assert.equal(S2.acciones.vincularConPagos([{ movimientoId: m.id, pagoId: pago.id }]), 1));
  const vinc = { ...base.tabla("movimientos").get(m.id)! };
  assert.equal(vinc.vinculado, true);
  assert.ok(vinc.pagoId && vinc.ventaId && vinc.conciliadoEn, JSON.stringify(cinco(vinc)));
  await yEsperar(S2, () => assert.ok(S2.acciones.desconciliar(m.id)));
  const des = base.tabla("movimientos").get(m.id)!;
  assert.deepEqual({ estado: des.estado, vinculado: des.vinculado, ...cinco(des) }, { estado: "pendiente", vinculado: false, pagoId: null, cuotaId: null, ventaId: null, conciliadoEn: null, conciliadoPor: null });
});

/* ---------- Postgres de verdad (PGlite), con el DDL del repo ---------- */
const DIR = process.env.PGLITE_DIR ?? "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite";
const hayPglite = existsSync(resolve(DIR, "dist/index.js"));

test("Postgres de verdad: el mismo pedido (upsert merge-duplicates con ?columns=) deja los cinco campos viejos", { skip: !hayPglite && "PGlite no está" }, async () => {
  const { PGlite } = await import(pathToFileURL(resolve(DIR, "dist/index.js")).href);
  const db = new PGlite();
  const sql = (n: string) => readFileSync(resolve(RAIZ, n), "utf8");
  await db.exec(`
    create function public.puede_entrar() returns boolean language sql as $$ select true $$;
    create table public.pagos (id text primary key);
    create table public.procesadores (id text primary key, nombre text, "feeRate" numeric, activo boolean, automatico boolean);
  `);
  await db.exec(sql("sql/conciliacion.sql"));
  await db.exec(sql("supabase/movimientos-vinculado.sql"));
  await db.exec(sql("supabase/movimientos-quien-pago.sql"));

  /* lo que PostgREST arma para POST ?columns=… con Prefer: resolution=merge-duplicates (la clave primaria es id) */
  const upsert = async (columnas: string[], filas: Fila[]) => {
    const l = columnas.map((c) => `"${c}"`).join(", ");
    const set = columnas.filter((c) => c !== "id").map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
    await db.query(
      `INSERT INTO public.movimientos (${l}) SELECT ${l} FROM json_populate_recordset(null::public.movimientos, $1::json) ON CONFLICT ("id") DO UPDATE SET ${set}`,
      [JSON.stringify(filas)],
    );
  };

  /* el punto de partida (la fila del seed, sólo sus claves) y después los pedidos que mandó el store, en orden */
  const sembrado = e0.movimientos.find((x: E) => x.id === mov.id) as Fila;
  const limpio = (f: Fila) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  await upsert(Object.keys(limpio(sembrado)), [limpio(sembrado)]);
  assert.equal(pedidosDelCobro.length, 2, "se esperaban dos pedidos de un solo cobro: conciliar y deshacer");
  for (const p of pedidosDelCobro) await upsert(p.columnas!, p.filas!);

  const { rows } = await db.query(`select estado, "pagoId", "cuotaId", "ventaId", "conciliadoEn", "conciliadoPor" from public.movimientos where id = $1`, [mov.id]);
  console.log("# Postgres (PGlite) tras conciliar+deshacer:", JSON.stringify(rows[0]));
  assert.equal(rows[0].estado, "pendiente");
  assert.deepEqual(
    { pagoId: rows[0].pagoId, cuotaId: rows[0].cuotaId, ventaId: rows[0].ventaId, conciliadoEn: rows[0].conciliadoEn, conciliadoPor: rows[0].conciliadoPor },
    { pagoId: trasConciliar.pagoId, cuotaId: trasConciliar.cuotaId, ventaId: trasConciliar.ventaId, conciliadoEn: trasConciliar.conciliadoEn, conciliadoPor: trasConciliar.conciliadoPor },
  );

  /* y con un UPDATE con null (como hace la rama vinculada) sí se vacían: el arreglo posible */
  await db.query(`update public.movimientos set "pagoId"=null, "cuotaId"=null, "ventaId"=null, "conciliadoEn"=null, "conciliadoPor"=null where id = $1`, [mov.id]);
  const v = await db.query(`select "pagoId", "ventaId" from public.movimientos where id = $1`, [mov.id]);
  assert.deepEqual(v.rows[0], { pagoId: null, ventaId: null });
  await db.close();
});
