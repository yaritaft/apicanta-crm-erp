import test from "node:test";
import assert from "node:assert/strict";
import { estadoDeLaCaja, pasosDelMes } from "@/lib/cierre-mes";
import { pasosDeFinanzas } from "@/lib/finanzas-pasos";
import { propuestasAtables, propuestasDescartadas, propuestasPendientes } from "@/lib/reembolsos";
import { cuentaDelGasto, textoParaCategoria, datosDelGasto, borradorInicial, cambiosAlRepetir, esIngreso, problemasDelGasto, resumenDeFechas, opcionesProveedor } from "@/lib/carga-gasto";
import { calcularPyL } from "@/lib/finanzas";
import { cuentasDe, resumenDe, transaccionesDe } from "@/lib/transacciones";
import { enRangoDeDias } from "@/lib/dia-negocio";
import { rangoDePeriodo } from "@/lib/periodos";
import { construirSemilla } from "@/lib/seed";
import { sugerirCategoria } from "@/lib/gastos";
import type { Arqueo, Devolucion, EstadoApp, Gasto, Movimiento, Traspaso } from "@/lib/types";
import { devolucion } from "./estado-devolucion";
import { pago, venta } from "./estado-liquidacion";

/* La revisión con Aldana (17/10): cada cosa que salió de mostrarle el software, con su prueba. */

const AHORA = Date.parse("2026-10-16T15:00:00.000Z");      // viernes 16 de octubre de 2026
const DIA = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const vacio = (): EstadoApp => ({
  ...(construirSemilla() as EstadoApp),
  ventas: [], cuotas: [], pagos: [], movimientos: [], gastos: [], gastosRecurrentes: [], traspasos: [], arqueos: [], liquidaciones: [], sesiones: [], devoluciones: [],
});
const gasto = (g: Partial<Gasto> & { id: string }): Gasto => ({
  categoria: "Software", grupo: "operativo", concepto: "Gasto", monto: 100, moneda: "USD",
  fecha: DIA(10, 3), recurrente: false, creadoEn: DIA(10, 3), extra: {}, ...g,
});
const retiroHotmart = (id: string, fecha: string): Traspaso => ({
  id, fecha, origenId: "proc_hotmart", destinoId: "proc_mercury", montoSale: 1000, monedaSale: "USD", montoLlega: 1000, monedaLlega: "USD",
  estado: "confirmado", llegadaRef: `mercury:${id}`, origen: "api", creadoEn: fecha,
});
const arqueo = (id: string, fecha: string, diferencia = 0): Arqueo => ({ id, fecha, saldos: [], total: 1000, esperado: 1000 - diferencia, diferencia, creadoEn: fecha });
const mov = (id: string, fecha: string, estado: Movimiento["estado"] = "pendiente"): Movimiento =>
  ({ id, proveedor: "stripe", referencia: id, monto: 500, moneda: "USD", fee: 15, neto: 485, fecha, estado, clienteNombre: id } as Movimiento);

/* ---------- 1 y 2 · Lo de septiembre se resuelve en septiembre ---------- */

test("los retiros de Hotmart sin comisión son del mes en que se hicieron: agosto en agosto, no en septiembre ni en octubre", () => {
  const e = vacio();
  e.traspasos = [retiroHotmart("t_ago", DIA(8, 20)), retiroHotmart("t_sep", DIA(9, 10)), retiroHotmart("t_oct", DIA(10, 5))];
  const pases = (mes: string) => pasosDelMes(e, mes, { ahora: AHORA, esDueno: true }).find((p) => p.id === "pases")!;
  assert.deepEqual(pases("2026-08").items.map((i) => i.clave), ["t_ago"]);
  assert.deepEqual(pases("2026-09").items.map((i) => i.clave), ["t_sep"]);
  assert.deepEqual(pases("2026-10").items.map((i) => i.clave), ["t_oct"]);
});

test("los reembolsos de una pasarela que nadie ató van al mes en que se devolvieron", () => {
  const e = vacio();
  e.devoluciones = [
    devolucion({ id: "d_sep", monto: 100, fecha: DIA(9, 12), estado: "propuesta", ventaId: undefined }) as Devolucion,
    devolucion({ id: "d_oct", monto: 200, fecha: DIA(10, 4), estado: "propuesta", ventaId: undefined }) as Devolucion,
  ];
  assert.deepEqual(propuestasPendientes(e).map((d) => d.id).sort(), ["d_oct", "d_sep"], "sin rango, todos");
  assert.deepEqual(propuestasPendientes(e, { desde: "2026-09-01", hasta: "2026-09-30" }).map((d) => d.id), ["d_sep"]);
  assert.deepEqual(propuestasPendientes(e, { desde: "2026-10-01", hasta: "2026-10-31" }).map((d) => d.id), ["d_oct"]);
  assert.ok(propuestasAtables(e, { desde: "2026-11-01", hasta: "2026-11-30" }).length === 0);
  const reembolsos = (mes: string) => pasosDelMes(e, mes, { ahora: AHORA, esDueno: true }).find((p) => p.id === "reembolsos")!;
  assert.equal(reembolsos("2026-09").faltan, 1);
  assert.equal(reembolsos("2026-10").faltan, 1);
  assert.equal(reembolsos("2026-08").faltan, 0);
});

test("el día de Aldana mira el mes en curso y avisa cuánto queda de meses anteriores sin mezclarlo", () => {
  const e = vacio();
  e.movimientos = [mov("m_sep", DIA(9, 10)), mov("m_oct1", DIA(10, 5)), mov("m_oct2", DIA(10, 9)), mov("m_ok", DIA(10, 8), "conciliado")];
  e.traspasos = [retiroHotmart("t_sep", DIA(9, 11))];
  const banco = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true }).find((p) => p.id === "d-banco")!;
  assert.equal(banco.faltan, 2, "los dos cobros de octubre sin atar");
  assert.deepEqual(banco.items.map((i) => i.clave).sort(), ["m_oct1", "m_oct2"]);
  assert.match(banco.detalle, /2 cobros entraron .* este mes/);
  assert.match(banco.detalle, /2 pendientes de meses anteriores/, "el cobro y el retiro de septiembre se avisan, no se mezclan");
  /* Sin nada de octubre, el paso está listo aunque queden cosas de septiembre. */
  e.movimientos = e.movimientos.filter((m) => m.id === "m_sep");
  const sinOctubre = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true }).find((p) => p.id === "d-banco")!;
  assert.equal(sinOctubre.estado, "listo");
  assert.match(sinOctubre.detalle, /meses anteriores/);
});

/* ---------- 3 · El gasto sin proveedor se encuentra ---------- */

test("un gasto de octubre sin proveedor sale en una lista, con un link que lo abre", () => {
  const e = vacio();
  e.gastos = [
    gasto({ id: "g_ok", proveedor: "Zoom" }),
    gasto({ id: "g_sin", concepto: "Equipo / Salarios (No comercial)", categoria: "Equipo / Salarios", monto: 1000, proveedor: undefined }),
  ];
  const paso = pasosDeFinanzas(e, "mes", "2026-10", { ahora: AHORA, esDueno: true, chequeos: {} }).find((p) => p.id === "gastos")!;
  assert.equal(paso.conLista, true, "la lista de lo que falta se ve aunque el paso tenga su pantalla");
  const item = paso.items.find((i) => i.clave === "g_sin")!;
  assert.ok(item, "el gasto sin proveedor está en la lista");
  assert.equal(item.monto, 1000);
  assert.deepEqual(item.destino, { href: "/finanzas?mes=2026-10&paso=gastos&ver=g_sin" });
});

/* ---------- 4 · El arqueo, cada semana ---------- */

test("la caja pide un arqueo por semana: al día, atrasado, con diferencia o sin ninguno", () => {
  const e = vacio();
  assert.equal(estadoDeLaCaja(e, AHORA).alDia, false);
  assert.equal(estadoDeLaCaja(e, AHORA).titulo, "Sin arqueo");
  e.arqueos = [arqueo("a1", DIA(10, 12))];
  assert.equal(estadoDeLaCaja(e, AHORA).alDia, true, "hecho el lunes, hoy es viernes");
  e.arqueos = [arqueo("a2", DIA(10, 5))];
  const viejo = estadoDeLaCaja(e, AHORA);
  assert.equal(viejo.alDia, false);
  assert.equal(viejo.titulo, "Arqueo atrasado");
  assert.match(viejo.detalle, /se hace cada semana/);
  e.arqueos = [arqueo("a3", DIA(10, 14), 250)];
  const dif = estadoDeLaCaja(e, AHORA);
  assert.equal(dif.alDia, false);
  assert.equal(dif.titulo, "Arqueo con diferencia");
  assert.equal(dif.diferencia, 250);
});

test("el mes en curso pide el arqueo de la semana, y el que ya terminó, el de cierre", () => {
  const e = vacio();
  const arq = (mes: string) => pasosDelMes(e, mes, { ahora: AHORA, esDueno: true }).find((p) => p.id === "arqueo")!;
  /* Octubre sigue: sin arqueo reciente, pendiente; con uno de esta semana, al día. */
  assert.equal(arq("2026-10").estado, "pendiente");
  e.arqueos = [arqueo("a1", DIA(10, 14))];
  assert.equal(arq("2026-10").faltan, 0);
  /* Septiembre terminó: el arqueo de octubre (del 14) queda lejos de su cierre; hace falta el de fin de septiembre. */
  assert.equal(arq("2026-09").faltan, 1);
  e.arqueos = [arqueo("a2", DIA(9, 30))];
  assert.equal(arq("2026-09").faltan, 0);
  /* Y el día de Aldana usa la misma regla que el mes. */
  const caja = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true }).find((p) => p.id === "d-caja")!;
  assert.equal(caja.estado, "pendiente", "el de fin de septiembre ya es de hace más de una semana");
});

/* ---------- 5 · Un ingreso (lo que volvió) ---------- */

const AJ = { monedaBase: "USD" as const, tipoCambio: 1450 };

test("un reembolso se carga como ingreso: se guarda en negativo, en su categoría, y sin repetirse", () => {
  const b = { ...borradorInicial(AJ, null, new Date(2026, 9, 16, 12)), concepto: "Reembolso del hotel", categoria: "Honorarios del CEO", grupo: "dueno" as const, categoriaElegida: true,
    proveedor: "Hotel Miami", monto: "280", ingreso: true, recurrente: true, cuenta: "Mercury", notas: "Devolución de la reserva cancelada" };
  assert.deepEqual(problemasDelGasto(b, "USD"), {}, "se puede cargar con monto positivo");
  const g = datosDelGasto(b, { base: "USD", opciones: opcionesProveedor({ equipo: [], gastos: [] }, b.categoria) });
  assert.equal(g.monto, -280);
  assert.equal(g.recurrente, false, "un ingreso es de esa vez");
  assert.equal(g.categoria, "Honorarios del CEO");
  assert.equal(g.notas, "Devolución de la reserva cancelada");
  assert.equal(g.extra?.ingreso, true);
  assert.equal(g.extra?.cuenta, "Mercury");
  assert.ok(esIngreso(g));
  assert.match(resumenDeFechas({ ...b }), /^Descuenta del gasto de octubre 2026 y entra a la caja/);
  /* Al abrirlo para editar vuelve a verse en positivo y como ingreso, y guardarlo sin tocar nada lo deja igual. */
  const guardado: Gasto = { ...g, id: "g_hotel" };
  const otra = borradorInicial(AJ, guardado);
  assert.equal(otra.ingreso, true);
  assert.equal(otra.monto, "280");
  assert.equal(otra.cuenta, "Mercury");
  const igual = datosDelGasto(otra, { base: "USD", previo: guardado, opciones: [] });
  assert.equal(igual.monto, -280);
  assert.equal(igual.extra?.ingreso, true);
  /* Si lo vuelve un gasto, deja de ser ingreso y de llevar la marca. */
  const comoGasto = datosDelGasto({ ...otra, ingreso: false }, { base: "USD", previo: guardado, opciones: [] });
  assert.equal(comoGasto.monto, 280);
  assert.ok(!("ingreso" in (comoGasto.extra ?? {})));
  /* Repetirlo copia que era un ingreso. */
  assert.equal(cambiosAlRepetir(guardado, "1450").ingreso, true);
  assert.equal(cambiosAlRepetir(guardado, "1450").monto, "280");
});

test("un ingreso resta de Honorarios del CEO en el estado de resultados de su mes, y no toca otros", () => {
  const e = vacio();
  const rango = rangoDePeriodo("2026-10");
  e.gastos = [
    gasto({ id: "g1", categoria: "Honorarios del CEO", grupo: "dueno", concepto: "Honorarios", monto: 3000, fecha: DIA(10, 2), proveedor: "Yari" }),
    gasto({ id: "g2", categoria: "Honorarios del CEO", grupo: "dueno", concepto: "Hotel", monto: 300, fecha: DIA(10, 6), proveedor: "Hotel Miami" }),
    gasto({ id: "g3", categoria: "Honorarios del CEO", grupo: "dueno", concepto: "Reembolso del hotel", monto: -280, fecha: DIA(10, 9), proveedor: "Hotel Miami", extra: { ingreso: true } }),
    gasto({ id: "g4", categoria: "Honorarios del CEO", grupo: "dueno", concepto: "Reembolso viejo", monto: -50, fecha: DIA(9, 9), proveedor: "Hotel" }),
  ];
  const sinIngreso = calcularPyL({ ...e, gastos: e.gastos.filter((g) => g.id !== "g3") }, rango);
  const conIngreso = calcularPyL(e, rango);
  assert.equal(Math.round((sinIngreso.honorariosCeo ?? 0) - (conIngreso.honorariosCeo ?? 0)), 280, "octubre baja lo que volvió, y nada más");
});

/* ---------- 6 · Transacciones: todo, una sola vez ---------- */

test("Transacciones junta cobros, gastos, ingresos, devoluciones, pases y lo sin conciliar, cada uno una vez", () => {
  const e = vacio();
  e.ventas = [venta({ id: "v1", contactoNombre: "Ana Pérez", precioAcordado: 3000, fecha: DIA(10, 1) })];
  e.cuotas = [{ id: "c1", ventaId: "v1", numero: 1, monto: 1000, vence: DIA(10, 3), estado: "pendiente", esReserva: false }];
  e.pagos = [pago("p1", "c1", 1000, 30, DIA(10, 4), "proc_stripe")];
  /* El movimiento conciliado ES el pago: no se lista dos veces. Uno pendiente sí, aparte. */
  e.movimientos = [{ ...mov("m_ok", DIA(10, 4), "conciliado"), pagoId: "p1" }, mov("m_pend", DIA(10, 7)), mov("m_ign", DIA(10, 8), "ignorado")];
  e.gastos = [
    gasto({ id: "g1", concepto: "Notion", monto: 20, fecha: DIA(10, 5), proveedor: "Notion", extra: { cuenta: "Mercury" } }),
    gasto({ id: "g2", concepto: "Reembolso del hotel", monto: -280, fecha: DIA(10, 9), proveedor: "Hotel", extra: { ingreso: true } }),
    gasto({ id: "g3", concepto: "Pago de septiembre", monto: 70, fecha: DIA(9, 29), fechaPago: DIA(10, 2), proveedor: "Zoom" }),
  ];
  e.devoluciones = [devolucion({ id: "d1", monto: 100, fecha: DIA(10, 10), ventaId: "v1" })];
  e.traspasos = [retiroHotmart("t1", DIA(10, 11))];

  const { filas, resumen } = transaccionesDe(e);
  assert.equal(new Set(filas.map((f) => f.id)).size, filas.length, "ninguna fila repetida");
  assert.deepEqual(filas.map((f) => f.id).sort(), ["cobro:p1", "devolucion:d1", "gasto:g1", "gasto:g2", "gasto:g3", "pase:t1", "sin-conciliar:m_pend"]);
  assert.ok(!filas.some((f) => f.id.includes("m_ok") || f.id.includes("m_ign")), "el conciliado es el pago y el ignorado no cuenta");
  /* Un gasto cuenta el día que se pagó, no el mes al que corresponde. */
  assert.equal(filas.find((f) => f.id === "gasto:g3")!.dia, "2026-10-02");
  assert.equal(filas.find((f) => f.id === "gasto:g1")!.cuenta, "Mercury");
  assert.equal(filas.find((f) => f.id === "gasto:g2")!.tipo, "ingreso");
  assert.equal(filas.find((f) => f.id === "gasto:g2")!.monto, 280, "siempre en positivo; el tipo dice para qué lado");
  assert.equal(filas.find((f) => f.id === "cobro:p1")!.titulo, "Ana Pérez");
  /* Los totales no cuentan lo sin conciliar ni los pases. */
  assert.equal(resumen.ingresos, 1000 + 280);
  assert.equal(resumen.egresos, 20 + 70 + 100);
  assert.equal(resumen.neto, 1000 + 280 - 190);
  assert.equal(resumen.sinConciliar, 500);
  assert.equal(resumen.sinConciliarN, 1);
  assert.equal(resumen.pasesN, 1);
  /* El orden: lo más nuevo primero. */
  assert.deepEqual(filas.map((f) => f.dia), [...filas.map((f) => f.dia)].sort().reverse());
  /* Un rango deja sólo esos días, y el resumen sale de lo que se ve. */
  const dia9 = transaccionesDe(e, { desde: "2026-10-09", hasta: "2026-10-10" });
  assert.deepEqual(dia9.filas.map((f) => f.id).sort(), ["devolucion:d1", "gasto:g2"]);
  assert.deepEqual(resumenDe(dia9.filas), dia9.resumen);
  assert.equal(dia9.filas.every((f) => enRangoDeDias(f.fecha, { desde: "2026-10-09", hasta: "2026-10-10" })), true);
  /* Las cuentas para elegir: con cuántas filas, y las que no dicen cuenta juntas. */
  const cuentas = cuentasDe(filas);
  assert.equal(cuentas.reduce((a, c) => a + c.n, 0), filas.length);
  assert.ok(cuentas.some((c) => c.cuenta === "Mercury" && c.n >= 1));
  assert.ok(cuentas.some((c) => c.cuenta === ""));
});

test("una cuenta que la app no conoce (la de la planilla de Transacciones) se lee igual", () => {
  assert.equal(cuentaDelGasto({ extra: { cuenta: "  Financiera ARS Juan " } }), "Financiera ARS Juan");
  assert.equal(cuentaDelGasto({ extra: { cuenta: 5 } }), "");
  assert.equal(cuentaDelGasto({}), "");
});

test("un ingreso no sugiere «Reembolsos» (plata devuelta a clientes): el hotel va con los viáticos", () => {
  const e = vacio();
  assert.equal(sugerirCategoria("Reembolso del hotel de Miami", e)?.categoria, "Reembolsos", "como gasto, la palabra reembolso manda");
  assert.equal(textoParaCategoria("Reembolso del hotel de Miami", true), "del hotel de Miami");
  assert.equal(sugerirCategoria(textoParaCategoria("Reembolso del hotel de Miami", true), e)?.categoria, "Viáticos equipo");
  assert.equal(textoParaCategoria("Devolución de Notion", true), "de Notion");
  assert.equal(textoParaCategoria("Reembolso del hotel", false), "Reembolso del hotel", "un gasto se lee tal cual");
});

test("los reembolsos marcados como «no es una devolución» quedan a la vista, por mes, para deshacerlo", () => {
  const e = vacio();
  e.devoluciones = [
    devolucion({ id: "d_sep", monto: 843, fecha: DIA(9, 21), estado: "ignorada", ventaId: undefined, referencia: "stripe:re_1", proveedor: "stripe" }) as Devolucion,
    devolucion({ id: "d_oct", monto: 100, fecha: DIA(10, 4), estado: "ignorada", ventaId: undefined, referencia: "whop:reembolso:pay_2", proveedor: "whop" }) as Devolucion,
    devolucion({ id: "d_pend", monto: 50, fecha: DIA(9, 22), estado: "propuesta", ventaId: undefined, referencia: "stripe:re_3", proveedor: "stripe" }) as Devolucion,
    devolucion({ id: "d_conf", monto: 70, fecha: DIA(9, 23), estado: "confirmada" }) as Devolucion,
    /* Una ignorada que no vino de una pasarela (sin referencia) no es de esta lista. */
    devolucion({ id: "d_sinref", monto: 10, fecha: DIA(9, 24), estado: "ignorada" }) as Devolucion,
  ];
  assert.deepEqual(propuestasDescartadas(e).map((d) => d.id), ["d_oct", "d_sep"], "lo más nuevo primero");
  assert.deepEqual(propuestasDescartadas(e, { desde: "2026-09-01", hasta: "2026-09-30" }).map((d) => d.id), ["d_sep"]);
  assert.deepEqual(propuestasPendientes(e).map((d) => d.id), ["d_pend"], "lo descartado no cuenta como pendiente");
  /* Y no frena ningún paso del mes. */
  assert.equal(pasosDelMes(e, "2026-09", { ahora: AHORA, esDueno: true }).find((p) => p.id === "reembolsos")!.faltan, 1);
});
