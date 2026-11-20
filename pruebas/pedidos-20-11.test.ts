import test from "node:test";
import assert from "node:assert/strict";
import { momentoDe, momentoDeEntrada, webinarsPorFecha } from "@/lib/momento-webinar";
import { esColumna, VISIBLES_POR_DEFECTO, COLUMNAS_SUMADAS } from "@/lib/crm-tabla";
import { mesaDe } from "@/lib/mi-panel";
import { cuotasPorCobrarDe } from "@/lib/cuotas-closer";
import { ACCESO_DUENO, TIPOS_POR_DEFECTO, nivelDeRuta, puedeEditar, EDITAN, type MiAcceso } from "@/lib/permisos";
import { navPara } from "@/components/shell/nav";
import { PROCESADORES } from "@/lib/seed";
import { topeDeCuentas, TOPE_DE_FINANCIERA } from "@/lib/tope-cuentas";
import { cuentasConCorte } from "@/lib/reporteFinanciera";
import { esFinanciera } from "@/components/cobros/EditorCobros";
import type { EstadoApp } from "@/lib/types";

/* Los pedidos del 18 al 20/11: pre-webinar, cuotas del equipo para el director, Agenda para los closers y cuentas recaudadoras de Finanzas. */

const WEBINARS = [
  { id: "w_21_10", titulo: "Taller 21/10/2026 - Yari Taft", fecha: "2026-10-21T22:00:00Z", estado: "finalizado" },
  { id: "w_11_11", titulo: "Taller 11/11/2026 - Yari Taft", fecha: "2026-11-11T22:00:00Z", estado: "finalizado" },
  { id: "w_25_11", titulo: "Taller 25/11/2026 - Yari Taft", fecha: "2026-11-25T22:00:00Z", estado: "programado" },
  { id: "w_02_12", titulo: "Borrador", fecha: "2026-12-02T22:00:00Z", estado: "borrador" },
] as const;
const AHORA = Date.parse("2026-11-20T15:00:00Z");

test("Un lead que entró el 18/11, con el taller del 25/11 por delante: es Pre-webinar de ese taller (no del 21/10)", () => {
  const m = momentoDe("2026-11-18T15:40:15Z", WEBINARS, AHORA)!;
  assert.equal(m.id, "pre");
  assert.equal(m.texto, "Pre-webinar");
  assert.equal(m.webinarId, "w_25_11");
});

test("Un lead que entró el día del webinar del 11/11, antes del vivo: es del webinar", () => {
  const m = momentoDe("2026-11-11T14:00:00Z", WEBINARS, AHORA)!;
  assert.equal(m.id, "webinar");
  assert.equal(m.texto, "Del webinar");
  assert.equal(m.webinarId, "w_11_11");
});

test("cuando pasa el vivo, los pre de ese webinar pasan solos a «del webinar»", () => {
  const entro = "2026-11-18T15:40:15Z";
  assert.equal(momentoDe(entro, WEBINARS, Date.parse("2026-11-25T21:59:00Z"))!.id, "pre");
  assert.equal(momentoDe(entro, WEBINARS, Date.parse("2026-11-25T22:01:00Z"))!.id, "webinar");
});

test("sin fecha de entrada, o con entrada después del último webinar, no hay momento; los borradores no cuentan", () => {
  assert.equal(momentoDe(undefined, WEBINARS, AHORA), null);
  assert.equal(momentoDe("no es una fecha", WEBINARS, AHORA), null);
  assert.equal(momentoDe("2026-11-26T10:00:00Z", WEBINARS, AHORA), null, "el borrador del 02/12 no es un webinar");
  assert.equal(momentoDe("2026-11-18T10:00:00Z", [], AHORA), null);
});

test("la lista de webinars se ordena una vez y sirve para muchas personas", () => {
  const orden = webinarsPorFecha([...WEBINARS].reverse());
  assert.deepEqual(orden.map((x) => x.w.id), ["w_21_10", "w_11_11", "w_25_11"]);
  assert.equal(momentoDeEntrada("2026-10-01T00:00:00Z", orden, AHORA)!.webinarId, "w_21_10");
  assert.equal(momentoDeEntrada("2026-10-22T00:00:00Z", orden, AHORA)!.webinarId, "w_11_11");
});

test("el CRM tiene la columna Momento, a la vista por defecto y sumada una vez para quien ya eligió las suyas", () => {
  assert.equal(esColumna("momento"), true);
  assert.ok(VISIBLES_POR_DEFECTO.includes("momento"));
  assert.ok(COLUMNAS_SUMADAS.some((x) => x.claves.includes("momento") && x.despuesDe === "via"));
});

/* ---------- Cuotas de todo el equipo ---------- */

const venta = (id: string, closerId: string, extra = {}) => ({ id, closerId, estado: "activa", contactoNombre: id, ...extra });
const cuota = (id: string, ventaId: string, monto: number, vence: string) => ({ id, ventaId, monto, vence, numero: 1, estado: "pendiente" });
const ESTADO = {
  ventas: [venta("v1", "c1"), venta("v2", "c2"), venta("v3", "c1", { estado: "cancelada" })],
  cuotas: [cuota("q1", "v1", 500, "2026-11-28"), cuota("q2", "v2", 300, "2026-11-28"), cuota("q3", "v2", 200, "2026-09-10"), cuota("q4", "v3", 999, "2026-11-28")],
  pagos: [],
} as unknown as Pick<EstadoApp, "cuotas" | "ventas" | "pagos">;

test("la mesa de un closer sigue siendo la suya y la del equipo suma a todos (sin las ventas canceladas)", () => {
  assert.equal(mesaDe(ESTADO, "c1", "2026-11-20").mesPendiente, 500);
  assert.equal(mesaDe(ESTADO, "c2", "2026-11-20").mesPendiente, 300);
  const equipo = mesaDe(ESTADO, null, "2026-11-20");
  assert.equal(equipo.mesPendiente, 800);
  assert.equal(equipo.atrasado, 200);
});

test("las cuotas por cobrar: de un closer o de todos, ordenadas por vencimiento", () => {
  assert.deepEqual(cuotasPorCobrarDe(ESTADO, "c2").map((x) => x.cuota.id), ["q3", "q2"]);
  assert.deepEqual(cuotasPorCobrarDe(ESTADO, null).map((x) => x.cuota.id), ["q3", "q1", "q2"]);
});

/* ---------- Agenda para los closers ---------- */

const acceso = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};
const menu = (a: MiAcceso) => navPara(a).flatMap((g) => g.items.map((i) => i.href));

test("el menú del closer tiene la Agenda (Dante, 20/11), entre el CRM y las Ventas", () => {
  const m = menu(acceso("closer"));
  assert.equal(m.indexOf("/agenda"), m.indexOf("/crm") + 1);
  assert.ok(m.includes("/mis-llamadas") && m.includes("/cerrar-el-dia"), "sigue con lo suyo");
});

/* ---------- Cuentas recaudadoras ---------- */

const CONTENIDO_FINANZAS: MiAcceso = {
  tipo: "contenido_finanzas", nombre: "Contenido y finanzas", soloLoSuyo: false,
  areas: { alumnos: "editar", finanzas: "editar", leads: "ver", marketing: "editar", panel: "ver", ventas: "editar", webinars: "editar" },
};

test("Finanzas edita las cuentas recaudadoras (Aldana); un closer, el setter o el director no", () => {
  assert.ok(EDITAN.procesadores.includes("finanzas"));
  assert.equal(puedeEditar(ACCESO_DUENO, "procesadores"), true);
  assert.equal(puedeEditar(CONTENIDO_FINANZAS, "procesadores"), true);
  assert.equal(puedeEditar(acceso("admin"), "procesadores"), true);
  for (const id of ["closer", "setter", "director", "marketing", "customer_success"]) assert.equal(puedeEditar(acceso(id), "procesadores"), false, id);
});

test("y sólo eso: el resto de Ajustes sigue siendo de quien edita Ajustes", () => {
  for (const tabla of ["productos", "embudos", "etapas", "campos", "ajustes", "metas"]) assert.equal(puedeEditar(CONTENIDO_FINANZAS, tabla), false, tabla);
  assert.ok(nivelDeRuta(CONTENIDO_FINANZAS, "/ajustes") >= 1, "la pantalla se abre (con el Catálogo)");
  assert.equal(nivelDeRuta(acceso("closer"), "/ajustes"), 0);
  assert.equal(nivelDeRuta(acceso("director"), "/ajustes"), 0);
});

test("la Financiera Capital ARS y USD están separadas de las de Juan: otras cuentas, su propio reporte y fuera del tope", () => {
  const capital = PROCESADORES.filter((p) => p.id.startsWith("proc_financiera_capital"));
  assert.deepEqual(capital.map((p) => p.nombre), ["Financiera Capital ARS", "Financiera Capital USD"]);
  assert.equal(capital[0].moneda, "ARS");
  const ids = new Set(PROCESADORES.map((p) => p.id));
  assert.equal(ids.size, PROCESADORES.length, "ids únicos");
  assert.ok(capital.every((p) => esFinanciera(p)), "piden nombre y CUIT del que transfirió, como la de Juan");
  assert.ok(capital.every((p) => !TOPE_DE_FINANCIERA.cuentaIds.includes(p.id)), "no suman al tope de US$ 50.000 de la de Juan");
  const e = { procesadores: PROCESADORES } as unknown as EstadoApp;
  const conCorte = cuentasConCorte(e).map((p) => p.id);
  assert.ok(conCorte.includes("proc_financiera_capital_ars") && conCorte.includes("proc_financiera_ars"), "cada una tiene su corte");
  assert.equal(typeof topeDeCuentas, "function");
});
