import test from "node:test";
import assert from "node:assert/strict";
import { avanceDelMes, pasosDelMes, queryDelMes } from "@/lib/cierre-mes";
import { construirSemilla } from "@/lib/seed";
import type { Cuota, EstadoApp, Liquidacion, Movimiento } from "@/lib/types";
import { pago, venta } from "./estado-liquidacion";

/* El cierre del mes (de la Bandeja de la Mesa de Finanzas de Blue OS): cada paso se calcula con lo que ya está
   cargado y dice qué falta. Estos casos arman un mes a mano, sin la semilla, y comprueban cada paso. */

const AHORA = Date.parse("2026-10-15T15:00:00.000Z");
const DIA = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;

const vacio = (): EstadoApp => ({
  ...(construirSemilla() as EstadoApp),
  ventas: [], cuotas: [], pagos: [], movimientos: [], gastos: [], gastosRecurrentes: [], traspasos: [], arqueos: [], liquidaciones: [], sesiones: [],
});
const cuota = (id: string, ventaId: string, numero: number, monto: number, vence: string, extra: Partial<Cuota> = {}): Cuota =>
  ({ id, ventaId, numero, monto, vence, estado: "pendiente", esReserva: false, ...extra });
const paso = (e: EstadoApp, id: string, mes = "2026-09", esDueno = true) => pasosDelMes(e, mes, { ahora: AHORA, esDueno }).find((p) => p.id === id)!;

test("la query de un mes es el período completo", () => {
  assert.equal(queryDelMes("2026-09"), "periodo=custom&desde=2026-09-01&hasta=2026-09-30");
  assert.equal(queryDelMes("2026-02"), "periodo=custom&desde=2026-02-01&hasta=2026-02-28");
});

test("las ventas del mes sin estrategia son un paso pendiente, y con todas atribuidas queda listo", () => {
  const e = vacio();
  e.ventas = [
    venta({ id: "a", contactoNombre: "Ana", precioAcordado: 3000, fecha: DIA(9, 5), embudoId: "emb_1" }),
    venta({ id: "b", contactoNombre: "Beto", precioAcordado: 2000, fecha: DIA(9, 6) }),
    venta({ id: "c", contactoNombre: "Del mes pasado", precioAcordado: 1000, fecha: DIA(8, 6) }),
  ];
  const p = paso(e, "ventas-embudo");
  assert.equal(p.estado, "pendiente");
  assert.equal(p.faltan, 1);
  assert.deepEqual(p.items.map((i) => i.titulo), ["Beto"]);
  assert.deepEqual(p.progreso, { hecho: 1, total: 2 });
  e.ventas[1] = { ...e.ventas[1], embudoId: "emb_2" };
  assert.equal(paso(e, "ventas-embudo").estado, "listo", "el mes ya terminó y no falta nada");
  assert.equal(paso(e, "ventas-embudo", "2026-10").estado, "en-curso", "el mes sigue y pueden entrar ventas");
});

test("los cobros de pasarela sin atar son los del mes: lo de otros meses se resuelve en el cierre de su mes", () => {
  const e = vacio();
  const mov = (id: string, fecha: string, estado: Movimiento["estado"]): Movimiento => ({ id, proveedor: "stripe", referencia: id, monto: 500, moneda: "USD", fee: 15, neto: 485, fecha, estado, clienteNombre: id } as Movimiento);
  e.movimientos = [mov("m1", DIA(9, 10), "pendiente"), mov("m2", DIA(8, 20), "pendiente"), mov("m3", DIA(9, 12), "conciliado"), mov("m4", DIA(10, 2), "pendiente")];
  const p = paso(e, "movs-sin-atar");
  assert.equal(p.estado, "pendiente");
  assert.equal(p.faltan, 1, "sólo el de septiembre: el de agosto es de agosto, el de octubre de octubre y el conciliado ya está");
  assert.doesNotMatch(p.detalle, /anteriores/);
  assert.deepEqual(p.items.map((i) => i.clave), ["m1"]);
  assert.equal(p.items[0].destino && "href" in p.items[0].destino ? p.items[0].destino.href : "", "/conciliacion?mes=2026-09", "abre Conciliación en el mes del paso");
  /* Cada mes ve lo suyo. */
  assert.deepEqual(paso(e, "movs-sin-atar", "2026-08").items.map((i) => i.clave), ["m2"]);
  assert.deepEqual(paso(e, "movs-sin-atar", "2026-10").items.map((i) => i.clave), ["m4"]);
});

test("las cuotas del mes están resueltas si se cobraron o se dieron por incobrables; las demás frenan el paso", () => {
  const e = vacio();
  e.ventas = [venta({ id: "v1", contactoNombre: "Ana", precioAcordado: 3000, fecha: DIA(8, 1) })];
  e.cuotas = [
    cuota("c1", "v1", 1, 1000, DIA(9, 5)),                                                         // se cobra
    cuota("c2", "v1", 2, 1000, DIA(9, 15), { estado: "cancelada", notas: "Incobrable: se dio de baja" }), // incobrable
    cuota("c3", "v1", 3, 1000, DIA(9, 25)),                                                        // sigue sin cobrar
    cuota("c4", "v1", 4, 1000, DIA(10, 25)),                                                       // de octubre: no es de este mes
  ];
  e.pagos = [pago("p1", "c1", 1000, 30, DIA(9, 6), "proc_stripe")];
  const p = paso(e, "cuotas-mes");
  assert.equal(p.estado, "pendiente");
  assert.deepEqual(p.progreso, { hecho: 2, total: 3 });
  assert.deepEqual(p.items.map((i) => i.clave), ["c3"]);
  /* En octubre (el mes en curso) lo que todavía no venció no frena nada. */
  assert.equal(paso(e, "cuotas-mes", "2026-10").faltan, 0);
});

test("un cobro sin comprobante que no está conciliado con una pasarela es un paso pendiente", () => {
  const e = vacio();
  e.ventas = [venta({ id: "v1", contactoNombre: "Ana", precioAcordado: 3000, fecha: DIA(9, 1) })];
  e.cuotas = [cuota("c1", "v1", 1, 1000, DIA(9, 5)), cuota("c2", "v1", 2, 1000, DIA(9, 6))];
  e.pagos = [
    { ...pago("p1", "c1", 1000, 0, DIA(9, 6), "proc_efectivo"), comprobanteLink: "https://x.test/1" },
    pago("p2", "c2", 1000, 0, DIA(9, 7), "proc_efectivo"),
  ];
  const p = paso(e, "cobros-comprobante");
  assert.equal(p.faltan, 1);
  assert.equal(p.items[0].titulo, "Ana");
});

test("el cierre del mes: bloqueado mientras el mes sigue o faltan pasos, y listo con la liquidación cerrada", () => {
  const e = vacio();
  assert.equal(paso(e, "cerrar", "2026-10").estado, "bloqueado", "el mes sigue en curso");
  assert.match(paso(e, "cerrar", "2026-10").detalle, /sigue en curso/);
  /* Septiembre sin nada pendiente salvo lo de los dueños: ya se puede cerrar. */
  const sept = pasosDelMes(e, "2026-09", { ahora: AHORA, esDueno: true });
  assert.ok(sept.every((p) => p.id === "cerrar" || p.id.startsWith("liq-") || p.id === "arqueo" || p.estado !== "pendiente"), "sin datos, lo único que pide cosas es el arqueo y la liquidación");
  const liq: Liquidacion = { id: "liq_2026-09", periodo: "2026-09", estado: "cerrada", entradas: {}, extras: [], pagos: {}, gastoIds: [], creadoEn: DIA(9, 30) } as Liquidacion;
  e.liquidaciones = [liq];
  assert.equal(paso(e, "cerrar").estado, "listo");
  assert.match(paso(e, "liq-revisar").detalle, /cerrada/);
});

test("el primer paso pendiente es el siguiente, y los pasos de los dueños no cuentan para el resto", () => {
  const e = vacio();
  e.ventas = [venta({ id: "b", contactoNombre: "Beto", precioAcordado: 2000, fecha: DIA(9, 6) })];
  const dueno = pasosDelMes(e, "2026-09", { ahora: AHORA, esDueno: true });
  assert.equal(dueno.filter((p) => p.siguiente).length, 1);
  assert.equal(dueno.find((p) => p.siguiente)!.id, "ventas-embudo");
  const otro = pasosDelMes(e, "2026-09", { ahora: AHORA, esDueno: false });
  const liq = otro.find((p) => p.id === "liq-revisar")!;
  assert.equal(liq.estado, "bloqueado");
  assert.ok(liq.soloDuenos);
  assert.equal(avanceDelMes(otro, false).total, avanceDelMes(dueno, true).total - 3, "la liquidación, el pago y el cierre no cuentan para quien no es dueño");
});
