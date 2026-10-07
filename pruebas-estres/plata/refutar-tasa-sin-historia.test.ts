import test from "node:test";
import assert from "node:assert/strict";
import { art, liquidacionCerradaCon, miembro, pago } from "./plata-mundo";
import { calcularLiquidacion, diferenciasDesdeElCierre, mismasTasas, tasaParaFinanzas, tasasPorServicio } from "@/lib/honorarios";
import { calcularPyL, comisionesDelMes } from "@/lib/finanzas";
import { rangoDePeriodo } from "@/lib/periodos";
import type { ConceptoPago, EsquemaPago, EstadoApp } from "@/lib/types";

/* ==================================================================
   Refutar: «Finanzas no tiene historia de tasas» (honorarios.ts
   tasaParaFinanzas / tasasPorServicio, comision.ts tasaDeComision).

   No usa nada de src/ más que la API pública. `guardarEsquemaComoLaApp`
   copia, línea por línea, lo que hace store.guardarEsquema (store.ts
   ~3241-3257): escribe en equipo la tasa que vale HOY.
   ================================================================== */

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function guardarEsquemaComoLaApp(e: EstadoApp, esq: EsquemaPago): EstadoApp {
  const m = e.equipo.find((x) => x.id === esq.miembroId);
  const tasa = m ? tasaParaFinanzas(m, esq) : undefined;
  const servicios = m ? tasasPorServicio(m, esq) : undefined;
  let equipo = e.equipo;
  if (m && tasa !== undefined && (Math.abs(tasa - m.comisionRate) > 1e-9 || !mismasTasas(servicios, m.comisionServicios))) {
    const fila = { ...m, comisionRate: tasa, comisionServicios: servicios ?? {} };
    equipo = e.equipo.map((x) => (x.id === m.id ? fila : x));
  }
  const existe = e.honorarios.some((h) => h.id === esq.id);
  const honorarios = existe ? e.honorarios.map((h) => (h.id === esq.id ? esq : h)) : [...e.honorarios, esq];
  return { ...e, equipo, honorarios };
}

const com = (c: Partial<ConceptoPago> & Pick<ConceptoPago, "id" | "tasa">): ConceptoPago =>
  ({ tipo: "porcentaje", nombre: "Comisión", moneda: "USD", base: "cash-neto", alcance: "closer", ...c });
const esquemaDeC1 = (conceptos: ConceptoPago[]): EsquemaPago =>
  ({ id: "hon_c1", miembroId: "c1", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos });

/* Una venta de 1.000 cobrada el 10 del mes `mes` (sin fee de pasarela). */
function mundoChico(anio: number, mes: number): EstadoApp {
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: art(anio, mes, 3), moneda: "USD", productoId: "p1", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(anio, mes, 3), extra: {} };
  return {
    equipo: [miembro("c1", "Mariano", "closer", 0.1)], honorarios: [],
    ventas: [venta], cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [pago("p1", "q1", 1000, 0, art(anio, mes, 10, 10))],
    gastos: [], sesiones: [], devoluciones: [], liquidaciones: [],
    ajustes: { monedaBase: "USD", tipoCambio: 1500 }, productos: [], procesadores: [],
  } as unknown as EstadoApp;
}

const enFinanzas = (e: EstadoApp, periodo: string) => comisionesDelMes(e, rangoDePeriodo(periodo)).reduce((a, f) => a + f.comisionCloser, 0);
const enLiquidacion = (e: EstadoApp, periodo: string, liq?: never) =>
  calcularLiquidacion(e, periodo, liq).personas.find((p) => p.miembroId === "c1")!.lineas.filter((l) => l.enFinanzas).reduce((a, l) => a + l.monto, 0);

test("0 · la fecha del sandbox es posterior a 2026-01-01 (si no, el repro de la vigencia no se dispara)", () => {
  assert.ok(hoyIso() >= "2026-01-01", hoyIso());
});

test("S1 · del 10% al 15% «desde enero» con vigencia, DESPUÉS de cerrar noviembre de 2025: Finanzas reescribe noviembre y nada lo avisa", () => {
  /* 1. Noviembre de 2025: Mariano comisiona el 10% (un solo concepto, sin fechas). */
  let e = guardarEsquemaComoLaApp(mundoChico(2025, 11), esquemaDeC1([com({ id: "c", tasa: 0.1 })]));
  assert.equal(e.equipo[0].comisionRate, 0.1);
  const liqNov = calcularLiquidacion(e, "2025-11", undefined);
  assert.equal(enLiquidacion(e, "2025-11"), 100);
  assert.equal(enFinanzas(e, "2025-11"), 100);
  const pylAntes = calcularPyL(e, rangoDePeriodo("2025-11"));
  /* 2. Se cierra la liquidación de noviembre (la foto). */
  e = { ...e, liquidaciones: [liquidacionCerradaCon("2025-11", liqNov)] };

  /* 3. Mariano sube al 15% desde el 1/1/2026: el modo que prevé la ficha (Desde/Hasta en el concepto). */
  e = guardarEsquemaComoLaApp(e, esquemaDeC1([
    com({ id: "c", tasa: 0.1, nombre: "Comisión (hasta 2025)", hasta: "2025-12-31" }),
    com({ id: "c2", tasa: 0.15, nombre: "Comisión (desde 2026)", desde: "2026-01-01" }),
  ]));
  console.log("  comisionRate que escribe la app:", e.equipo[0].comisionRate);

  /* La liquidación de noviembre sigue valiendo 100 (respeta la vigencia) y la foto no cambió... */
  assert.equal(enLiquidacion(e, "2025-11"), 100);
  /* ...pero Finanzas ahora dice 150 para ese mismo mes ya liquidado, y el estado de resultados se mueve. */
  const fin = enFinanzas(e, "2025-11");
  const pylDespues = calcularPyL(e, rangoDePeriodo("2025-11"));
  console.log("  Finanzas nov-2025:", fin, "· P&L comisionCloser antes/después:", pylAntes.comisionCloser, pylDespues.comisionCloser,
    "· operativoCC antes/después:", pylAntes.operativoCC, pylDespues.operativoCC, "· CAC antes/después:", pylAntes.cac, pylDespues.cac);
  /* El aviso «cambios desde el cierre» NO salta: calcula la liquidación de noviembre y da lo mismo que la foto. */
  const avisos = diferenciasDesdeElCierre(e, e.liquidaciones[0]);
  console.log("  diferenciasDesdeElCierre:", JSON.stringify(avisos));
  assert.equal(fin, 150, "Finanzas dice 150 en un mes que se liquidó con 100");
  assert.deepEqual(avisos, [], "nada avisa del desfasaje");
  assert.equal(pylDespues.comisionCloser - pylAntes.comisionCloser, 50);
  assert.equal(pylAntes.operativoCC - pylDespues.operativoCC, 50, "el profit de un mes cerrado cambió");
  assert.equal(pylDespues.cac, pylAntes.cac, "el CAC (ads / ventas) no depende de las comisiones");
});

test("S2 · lo mismo pero editando el % en el lugar (sin vigencia): la liquidación cerrada avisa, el estado de resultados de Finanzas igual se mueve", () => {
  let e = guardarEsquemaComoLaApp(mundoChico(2025, 11), esquemaDeC1([com({ id: "c", tasa: 0.1 })]));
  const liqNov = calcularLiquidacion(e, "2025-11", undefined);
  const pylAntes = calcularPyL(e, rangoDePeriodo("2025-11"));
  e = { ...e, liquidaciones: [liquidacionCerradaCon("2025-11", liqNov)] };
  e = guardarEsquemaComoLaApp(e, esquemaDeC1([com({ id: "c", tasa: 0.15 })]));
  const avisos = diferenciasDesdeElCierre(e, e.liquidaciones[0]);
  const pylDespues = calcularPyL(e, rangoDePeriodo("2025-11"));
  console.log("  avisos:", JSON.stringify(avisos), "· Finanzas nov:", enFinanzas(e, "2025-11"), "· operativoCC", pylAntes.operativoCC, "→", pylDespues.operativoCC);
  assert.equal(avisos.length, 1, "acá sí avisa: la liquidación de hoy (150) difiere de la foto (100)");
  assert.equal(pylAntes.operativoCC - pylDespues.operativoCC, 50, "pero el P&L de un mes cerrado igual cambió");
});

test("S3 · «15% desde el 1 de noviembre» guardado hoy: Finanzas sigue en el 10% cuando llega noviembre (nada reescribe comisionRate)", () => {
  /* Hoy es 2026-10-07: el concepto nuevo todavía no vale, así que la app deja el viejo. */
  const hoy = hoyIso();
  const [a, m] = hoy.split("-").map(Number);
  const proximoMes = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  const ultimoDelMes = new Date(proximoMes + "T12:00:00Z"); ultimoDelMes.setUTCDate(0);
  const ultimo = ultimoDelMes.toISOString().slice(0, 10);
  const periodoQueViene = proximoMes.slice(0, 7);
  const [aq, mq] = periodoQueViene.split("-").map(Number);
  const e = guardarEsquemaComoLaApp(mundoChico(aq, mq), esquemaDeC1([
    com({ id: "c", tasa: 0.1, hasta: ultimo }),
    com({ id: "c2", tasa: 0.15, desde: proximoMes }),
  ]));
  console.log("  hoy", hoy, "· comisionRate guardado:", e.equipo[0].comisionRate, "· mes que viene", periodoQueViene,
    "· liquidación", enLiquidacion(e, periodoQueViene), "· Finanzas", enFinanzas(e, periodoQueViene));
  assert.equal(enLiquidacion(e, periodoQueViene), 150);
  assert.equal(enFinanzas(e, periodoQueViene), 100, "Finanzas sigue con el 10% en un mes en el que la liquidación paga el 15%");
});
