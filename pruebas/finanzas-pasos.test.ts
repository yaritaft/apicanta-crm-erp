import test from "node:test";
import assert from "node:assert/strict";
import { avanceDeFinanzas, claveChequeo, diasDeLaSemana, diasDelRango, pasosDeFinanzas, periodoActual, semanaDe } from "@/lib/finanzas-pasos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Liquidacion, Movimiento } from "@/lib/types";
import { venta } from "./estado-liquidacion";

/* Finanzas en pasos: lo de cada día, cada semana y cada mes (la lista de tareas de Aldana). Los que se calculan
   salen de lo cargado; los que pasan fuera de la app se tildan y quedan con quién y cuándo. */

const AHORA = Date.parse("2026-10-16T15:00:00.000Z");      // viernes 16 de octubre de 2026
const vacio = (): EstadoApp => ({
  ...(construirSemilla() as EstadoApp),
  ventas: [], cuotas: [], pagos: [], movimientos: [], gastos: [], gastosRecurrentes: [], traspasos: [], arqueos: [], liquidaciones: [], sesiones: [], devoluciones: [],
});
const ids = (e: EstadoApp, c: "dia" | "semana" | "mes" | "rango", p: string, esDueno = true, chequeos = {}) =>
  pasosDeFinanzas(e, c, p, { ahora: AHORA, esDueno, chequeos }).map((x) => x.id);

test("las semanas van de lunes a domingo y se numeran como ISO", () => {
  assert.equal(semanaDe("2026-10-16"), "2026-W42");
  assert.deepEqual(diasDeLaSemana("2026-W42"), { desde: "2026-10-12", hasta: "2026-10-18" });
  assert.equal(semanaDe("2026-10-12"), "2026-W42", "el lunes ya es de esa semana");
  assert.equal(semanaDe("2026-10-18"), "2026-W42", "y el domingo también");
  assert.equal(semanaDe("2026-01-01"), "2026-W01");
  assert.equal(semanaDe("2027-01-01"), "2026-W53", "el 1/1/2027 todavía es la última semana de 2026");
  assert.equal(periodoActual("dia", AHORA), "2026-10-16");
  assert.equal(periodoActual("semana", AHORA), "2026-W42");
  assert.equal(periodoActual("mes", AHORA), "2026-10");
});

test("el día de Aldana: sus tareas, en su orden, las que van en la app y las que se tildan", () => {
  const e = vacio();
  assert.deepEqual(ids(e, "dia", "2026-10-16"), [
    "d-banco", "d-ingresos", "d-cuotas", "d-tareas", "d-proveedores", "d-slack", "d-financiera", "d-caja", "d-pasarelas", "d-reembolsos",
  ]);
  const pasos = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true });
  const tipo = Object.fromEntries(pasos.map((p) => [p.id, p.tipo]));
  assert.equal(tipo["d-banco"], "auto");
  assert.equal(tipo["d-slack"], "manual");
  assert.equal(tipo["d-pasarelas"], "manual");
  /* Sin nada cargado, lo que se calcula está listo y lo que se tilda espera. */
  assert.equal(pasos.find((p) => p.id === "d-banco")!.estado, "listo");
  assert.equal(pasos.find((p) => p.id === "d-slack")!.estado, "pendiente");
  assert.equal(pasos.find((p) => p.id === "d-caja")!.estado, "pendiente", "sin ningún arqueo, la caja no está al día");
  assert.equal(pasos.find((p) => p.siguiente)!.id, "d-tareas", "el primero pendiente");
});

test("tildar un paso lo da por hecho para ese día solamente, y guarda quién y cuándo", () => {
  const e = vacio();
  const chequeos = { [claveChequeo("dia", "2026-10-16", "d-slack")]: { por: "Aldana", en: "2026-10-16T14:00:00.000Z" } };
  const hoy = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true, chequeos });
  const slack = hoy.find((p) => p.id === "d-slack")!;
  assert.equal(slack.estado, "listo");
  assert.equal(slack.chequeo?.por, "Aldana");
  assert.equal(hoy.find((p) => p.siguiente)!.id, "d-tareas");
  /* Mañana hay que volver a hacerlo. */
  const manana = pasosDeFinanzas(e, "dia", "2026-10-17", { ahora: AHORA, esDueno: true, chequeos });
  assert.equal(manana.find((p) => p.id === "d-slack")!.estado, "pendiente");
  assert.equal(avanceDeFinanzas(hoy, true).listos, avanceDeFinanzas(manana, true).listos + 1);
});

test("un paso que se calcula refleja lo que falta: cobros sin atar, ingresos por validar, cuotas vencidas", () => {
  const e = vacio();
  const mov = (id: string, fecha: string): Movimiento => ({ id, proveedor: "stripe", referencia: id, monto: 500, moneda: "USD", fee: 15, neto: 485, fecha, estado: "pendiente", clienteNombre: id } as Movimiento);
  e.movimientos = [mov("m1", "2026-10-15T15:00:00.000Z"), mov("m2", "2026-10-02T15:00:00.000Z")];
  e.ventas = [venta({ id: "v1", contactoNombre: "Ana", precioAcordado: 3000, fecha: "2026-09-01T15:00:00.000Z" })];
  e.cuotas = [{ id: "c1", ventaId: "v1", numero: 2, monto: 1000, vence: "2026-10-13T15:00:00.000Z", estado: "pendiente", esReserva: false }];
  const pasos = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true });
  const banco = pasos.find((p) => p.id === "d-banco")!;
  assert.equal(banco.estado, "pendiente");
  assert.equal(banco.faltan, 2);
  assert.deepEqual(banco.herramienta, { tipo: "conciliacion" });
  const cuotas = pasos.find((p) => p.id === "d-cuotas")!;
  assert.equal(cuotas.faltan, 1, "una cuota que venció hace tres días");
  assert.equal(cuotas.items[0].titulo, "Ana");
});

test("la semana: la weekly, los reportes, actualizar Finanzas, las suscripciones, la mora, el corte y los KPIs", () => {
  const e = vacio();
  assert.deepEqual(ids(e, "semana", "2026-W42"), ["s-weekly", "s-kpis-reportes", "s-finanzas", "s-suscripciones", "s-mora", "s-corte-financiera", "s-informe", "s-kpis-ceo"]);
  const mora = pasosDeFinanzas(e, "semana", "2026-W42", { ahora: AHORA, esDueno: true }).find((p) => p.id === "s-mora")!;
  assert.equal(mora.tipo, "revisable");
  assert.equal(mora.estado, "listo", "sin nadie atrasado no hay nada que revisar");
  e.ventas = [venta({ id: "v1", contactoNombre: "Ana", precioAcordado: 3000, fecha: "2026-09-01T15:00:00.000Z" })];
  e.cuotas = [{ id: "c1", ventaId: "v1", numero: 1, monto: 1000, vence: "2026-10-01T15:00:00.000Z", estado: "pendiente", esReserva: false }];
  const conMora = pasosDeFinanzas(e, "semana", "2026-W42", { ahora: AHORA, esDueno: true }).find((p) => p.id === "s-mora")!;
  assert.equal(conMora.estado, "pendiente", "hay alguien atrasado: queda pendiente hasta que alguien lo revise");
  const revisada = pasosDeFinanzas(e, "semana", "2026-W42", { ahora: AHORA, esDueno: true, chequeos: { [claveChequeo("semana", "2026-W42", "s-mora")]: { por: "Aldana", en: "2026-10-16T14:00:00.000Z" } } }).find((p) => p.id === "s-mora")!;
  assert.equal(revisada.estado, "listo");
});

test("el mes: los pasos juntos, toda la lista de Aldana adentro, y cerrar espera a todo", () => {
  const e = vacio();
  const lista = ids(e, "mes", "2026-09");
  assert.deepEqual(lista, [
    "ventas-completas", "cobros-atar", "cobros-validar", "cuotas-mes", "pases", "arqueo", "gastos",
    "liq-revisar", "liq-pagar", "m-profit", "m-reporte", "m-kpis-ceo", "m-software", "m-manual-ventas", "cerrar",
  ]);
  /* Lo que era el mismo trabajo en varias filas ya no está suelto. */
  for (const id of ["ventas-embudo", "ventas-sin-cobro", "llamadas-sin-cargar", "movs-sin-atar", "cobros-rechazados", "cobros-comprobante", "reembolsos", "gastos-fijos", "gastos-proveedor"]) {
    assert.ok(!lista.includes(id), `${id} ya no es un paso del mes`);
  }
  /* Septiembre ya terminó, pero los pasos de tildar siguen pendientes: no se puede dar por cerrado. */
  const pasos = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: true });
  assert.equal(pasos.find((p) => p.id === "cerrar")!.estado, "bloqueado");
  assert.match(pasos.find((p) => p.id === "cerrar")!.detalle, /Faltan \d+ pasos/);
  /* Con todo tildado y la liquidación cerrada, el mes cierra. */
  const todo = ["m-profit", "m-reporte", "m-kpis-ceo", "m-software", "m-manual-ventas"];
  const chequeos = Object.fromEntries(todo.map((id) => [claveChequeo("mes", "2026-09", id), { por: "Aldana", en: "2026-10-01T12:00:00.000Z" }]));
  e.liquidaciones = [{ id: "liq_2026-09", periodo: "2026-09", estado: "cerrada", entradas: {}, extras: [], pagos: {}, gastoIds: [], creadoEn: "2026-09-30T12:00:00.000Z" } as Liquidacion];
  const listo = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: true, chequeos });
  assert.equal(listo.find((p) => p.id === "cerrar")!.estado, "listo");
});

test("lo que tildó Aldana cuenta para poder cerrar: con todo tildado y nada pendiente, el cierre ya no espera pasos", () => {
  const e = vacio();
  const todo = ["m-profit", "m-reporte", "m-kpis-ceo", "m-software", "m-manual-ventas"];
  const chequeos = Object.fromEntries(todo.map((id) => [claveChequeo("mes", "2026-09", id), { por: "Aldana", en: "2026-10-01T12:00:00.000Z" }]));
  const sin = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: true });
  const con = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: true, chequeos });
  const faltan = (ps: typeof sin) => Number(ps.find((p) => p.id === "cerrar")!.detalle.match(/Faltan (\d+) pasos?/)?.[1] ?? 0);
  assert.equal(faltan(sin) - faltan(con), todo.length, "cada paso tildado deja de contar como pendiente");
});

test("los pasos que se juntan suman lo que falta de cada uno sin repetir, y abren las dos pantallas", () => {
  const e = vacio();
  const mov = (id: string): Movimiento => ({ id, proveedor: "stripe", referencia: id, monto: 500, moneda: "USD", fee: 15, neto: 485, fecha: "2026-09-10T15:00:00.000Z", estado: "pendiente", clienteNombre: id } as Movimiento);
  e.movimientos = [mov("m1")];
  e.ventas = [
    venta({ id: "a", contactoNombre: "Ana", precioAcordado: 3000, fecha: "2026-09-05T15:00:00.000Z" }),                       // sin embudo y sin cobro: una sola vez
    venta({ id: "b", contactoNombre: "Beto", precioAcordado: 2000, fecha: "2026-09-06T15:00:00.000Z", embudoId: "emb_1" }),  // sólo sin cobro
  ];
  const pasos = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: true });
  const ventas = pasos.find((p) => p.id === "ventas-completas")!;
  assert.equal(ventas.estado, "pendiente");
  assert.equal(ventas.faltan, 2, "Ana falta en los dos controles pero es una venta");
  assert.deepEqual(ventas.items.map((i) => i.titulo).sort(), ["Ana", "Beto"]);
  assert.deepEqual(ventas.progreso, { hecho: 0, total: 2 });
  const atar = pasos.find((p) => p.id === "cobros-atar")!;
  assert.equal(atar.faltan, 1);
  assert.deepEqual(atar.herramienta, { tipo: "conciliacion" });
  assert.deepEqual(atar.tambien, [{ tipo: "devoluciones" }]);
  const gastos = pasos.find((p) => p.id === "gastos")!;
  assert.deepEqual([gastos.herramienta, ...(gastos.tambien ?? [])].map((h) => h!.tipo).sort(), ["fijos", "gastos"]);
  assert.match(gastos.detalle, /ningún gasto fijo cargado/, "sin gastos fijos cargados, el paso no se hace pasar por 'todo aprobado'");
});

test("quien no es dueño no ve contadas la liquidación, el pago al equipo ni el cierre", () => {
  const e = vacio();
  const dueno = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: true });
  const otro = pasosDeFinanzas(e, "mes", "2026-09", { ahora: AHORA, esDueno: false });
  assert.equal(avanceDeFinanzas(otro, false).total, avanceDeFinanzas(dueno, true).total - 3);
  assert.ok(otro.filter((p) => p.soloDuenos).every((p) => p.estado === "bloqueado" || p.id === "cerrar"));
});

test("de tal día a tal día: los pasos que se calculan, sin lo que se tilda ni lo de un mes", () => {
  const e = vacio();
  assert.deepEqual(diasDelRango("2026-10-01_2026-10-15"), { desde: "2026-10-01", hasta: "2026-10-15" });
  const lista = ids(e, "rango", "2026-10-01_2026-10-15");
  for (const id of ["ventas-completas", "llamadas-sin-cargar", "cobros-atar", "cobros-validar", "cuotas-mes", "pases", "arqueo", "gastos"]) assert.ok(lista.includes(id), id);
  for (const id of ["m-reporte", "m-software", "liq-revisar", "liq-pagar", "cerrar", "d-slack", "s-weekly"]) assert.ok(!lista.includes(id), `${id} no es de un rango`);
  /* Sólo cuenta lo de esos días. */
  e.ventas = [
    venta({ id: "a", contactoNombre: "Ana", precioAcordado: 3000, fecha: "2026-10-05T15:00:00.000Z" }),
    venta({ id: "b", contactoNombre: "Beto", precioAcordado: 2000, fecha: "2026-10-20T15:00:00.000Z" }),
  ];
  const embudo = pasosDeFinanzas(e, "rango", "2026-10-01_2026-10-15", { ahora: AHORA, esDueno: true }).find((p) => p.id === "ventas-completas")!;
  assert.deepEqual(embudo.items.map((i) => i.titulo), ["Ana"], "la venta del 20 queda afuera de del 1 al 15");
  assert.equal(embudo.cadencia, "rango");
  assert.match(embudo.detalle, /ese período/);
  /* El rango ya terminó: sin nada pendiente, listo; uno que sigue, en curso. */
  assert.equal(pasosDeFinanzas(e, "rango", "2026-09-01_2026-09-30", { ahora: AHORA, esDueno: true }).find((p) => p.id === "ventas-completas")!.estado, "listo");
  assert.equal(pasosDeFinanzas(e, "rango", "2026-10-01_2026-10-31", { ahora: AHORA, esDueno: true }).find((p) => p.id === "llamadas-sin-cargar")!.estado, "en-curso");
});
