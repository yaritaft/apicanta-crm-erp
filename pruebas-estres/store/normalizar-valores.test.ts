/* Estrés del almacén, frente 6: lo que normalizar() manda a la base (upsert con defaultToNull:false).

   - Los `undefined` no viajan (la columna toma su DEFAULT en vez de NULL); lo demás, tal cual.
   - Fechas y montos: el texto de una fecha llega idéntico (con zona, sin zona, sólo el día) y un monto con decimales, el cero,
     los negativos y los enormes llegan con el mismo valor (1e21, 0.1+0.2, 99.995).
   - Todo upsert pide merge-duplicates y missing=default: con otra cosa un campo que falta se escribiría como NULL y rompería
     cualquier columna NOT NULL.
   - Textos raros (comillas, barras, emoji, 'DROP TABLE', saltos de línea, 2000 caracteres) viajan y vuelven iguales.
   - La fila de ajustes lleva id 1 y todos sus campos. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";
import { azar, fechaRara, numeroRaro, textoRaro } from "./_aleatorio";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);
const S0 = await conDemo(base);
const FOTO = base.foto();
void S0;
const nuevo = async () => { base.restaurar(FOTO); const S = await (await import("./_fresco")).storeNuevo(); await S.cargarDeLaNube(); return S; };

test("los undefined no viajan: el cuerpo del upsert sólo lleva las claves que tienen valor", async () => {
  const S = await nuevo();
  base.log = [];
  await yEsperar(S, () => { S.acciones.crear("gastos", { categoria: "Software", grupo: "operativo", concepto: "Sin nada más", monto: 10, moneda: "USD", fecha: "2026-10-01T00:00:00.000Z", recurrente: false, creadoEn: "2026-10-01T00:00:00.000Z", extra: {}, fechaPago: undefined, proveedor: undefined, notas: undefined, webinarId: undefined } as never, "g"); });
  const cuerpo = base.peticiones("upsert", "gastos")[0].filas![0];
  for (const k of ["fechaPago", "proveedor", "notas", "webinarId"]) assert.ok(!(k in cuerpo), `${k} viajó aunque era undefined`);
  assert.ok(base.peticiones("upsert", "gastos")[0].columnas!.every((c) => !["fechaPago", "proveedor", "notas", "webinarId"].includes(c)));
});

test("todo upsert que sale del store pide merge-duplicates y missing=default (defaultToNull:false)", async () => {
  const S = await nuevo();
  base.log = [];
  const e = estadoDe(S);
  S.acciones.actualizar("leads", e.leads[0].id, { notas: "x" } as never, "x");
  S.acciones.crear("metas", { nombre: "m", metrica: "ingresos", objetivo: 1, unidad: "cantidad", periodo: "2026-10", creadoEn: "2026-10-01" } as never, "m");
  S.acciones.ajustes({ negocio: "Otro" });
  S.acciones.guardarArqueo({ id: "arq_1", fecha: "2026-10-05T00:00:00.000Z", saldos: [], total: 1, creadoEn: "2026-10-05T00:00:00.000Z" } as never);
  await esperarCola(S.estadoSync);
  const upserts = base.peticiones("upsert");
  assert.ok(upserts.length >= 8);
  for (const p of upserts) {
    assert.match(p.prefer ?? "", /resolution=merge-duplicates/, `${p.tabla}: sin merge-duplicates`);
    assert.match(p.prefer ?? "", /missing=default/, `${p.tabla}: sin missing=default (un campo ausente se escribiría como NULL)`);
  }
});

test("las fechas salen del store idénticas, con cualquier forma de escribirlas (la base falsa no las reformatea: Postgres devuelve los timestamptz en UTC)", async () => {
  const S = await nuevo();
  const fechas = ["2026-10-07T18:00:00.000Z", "2026-10-07T15:00:00.000-03:00", "2026-10-07", "2026-02-28T23:59:59.999Z", "2024-02-29T00:00:00.000Z", "2026-12-31T23:59:59.000+00:00"];
  await yEsperar(S, () => { fechas.forEach((f, i) => S.acciones.crear("gastos", { id: `gas_f${i}`, categoria: "x", grupo: "operativo", concepto: "f", monto: 1, moneda: "USD", fecha: f, fechaPago: f, recurrente: false, creadoEn: f, extra: {} } as never, "g")); });
  const r = await recargado();
  fechas.forEach((f, i) => {
    const g = r.gastos.find((x: E) => x.id === `gas_f${i}`);
    assert.equal(g.fecha, f); assert.equal(g.fechaPago, f); assert.equal(g.creadoEn, f);
  });
});

test("los montos fraccionarios, cero, negativos y enormes llegan con el mismo valor", async () => {
  const S = await nuevo();
  const montos = [0, 0.1 + 0.2, 99.995, 2.675, 1e-7, 123456789.12, 9007199254740991, 1e21, -250.5, 1 / 3, 0.005, 1234.5678];
  await yEsperar(S, () => { montos.forEach((m, i) => S.acciones.crear("gastos", { id: `gas_m${i}`, categoria: "x", grupo: "operativo", concepto: "m", monto: m, moneda: "USD", fecha: "2026-10-01T00:00:00.000Z", recurrente: false, creadoEn: "2026-10-01T00:00:00.000Z", extra: {} } as never, "g")); });
  const r = await recargado();
  montos.forEach((m, i) => assert.equal(r.gastos.find((x: E) => x.id === `gas_m${i}`).monto, m, `monto ${m}`));
});

test("textos con comillas, barras, emoji, saltos de línea y 2000 caracteres viajan y vuelven iguales (también en un id y dentro de un jsonb)", async () => {
  const S = await nuevo();
  const a = azar(5);
  const textos = Array.from({ length: 40 }, () => textoRaro(a));
  await yEsperar(S, () => { textos.forEach((t, i) => S.acciones.crear("gastos", { id: `gas_t${i}`, categoria: "x", grupo: "operativo", concepto: t, monto: 1, moneda: "USD", fecha: "2026-10-01T00:00:00.000Z", recurrente: false, proveedor: t, notas: t, creadoEn: "2026-10-01T00:00:00.000Z", extra: { clave: t, lista: [t, { a: t }] } } as never, "g")); });
  const r = await recargado();
  textos.forEach((t, i) => {
    const g = r.gastos.find((x: E) => x.id === `gas_t${i}`);
    assert.equal(g.concepto, t); assert.equal(g.proveedor, t); assert.equal(g.notas, t);
    assert.deepEqual(g.extra, { clave: t, lista: [t, { a: t }] });
  });
});

test("las filas al azar (montos, fechas y textos raros) llegan iguales: lo escrito es lo leído", async () => {
  const S = await nuevo();
  const a = azar(2026);
  const filas = Array.from({ length: 60 }, (_x, i) => ({
    id: `gas_r${i}`, categoria: textoRaro(a), grupo: a.pick(["directo", "operativo", "dueno", "retiro"]), concepto: textoRaro(a), monto: numeroRaro(a), moneda: a.pick(["USD", "ARS"]),
    fecha: fechaRara(a), ...(a.prob(0.5) ? { fechaPago: fechaRara(a) } : {}), recurrente: a.prob(0.5), ...(a.prob(0.5) ? { proveedor: textoRaro(a) } : {}), creadoEn: fechaRara(a), extra: {},
  }));
  await yEsperar(S, () => { filas.forEach((f) => S.acciones.crear("gastos", f as never, "g")); });
  const r = await recargado();
  for (const f of filas) {
    const g = r.gastos.find((x: E) => x.id === f.id);
    for (const [k, v] of Object.entries(f)) assert.deepEqual(g[k], v, `${f.id}.${k}`);
  }
});

test("la fila de ajustes lleva id 1 y todos los campos del estado", async () => {
  const S = await nuevo();
  base.log = [];
  await yEsperar(S, () => S.acciones.ajustes({ negocio: "Ñandú S.A." }));
  const p = base.peticiones("upsert", "ajustes")[0];
  const fila = p.filas![0];
  assert.equal(fila.id, 1);
  const ajustes = estadoDe(S).ajustes;
  for (const k of Object.keys(ajustes)) assert.deepEqual(fila[k], ajustes[k], `ajustes.${k}`);
  assert.equal(base.tabla("ajustes").size, 1, "una sola fila de ajustes");
});
