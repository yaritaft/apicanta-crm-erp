import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcularLiquidacion, liquidacionVacia, renglonDe } from "@/lib/honorarios";
import { EMBUDO_LANZAMIENTO_INTERNO, esServicioDelLanzamientoInterno, estrategiaDeLaVenta, SERVICIOS_DEL_LANZAMIENTO_INTERNO } from "@/lib/estrategia-de-venta";
import type { ConceptoPago, EstadoApp } from "@/lib/types";
import { concepto, dia, esquema, estadoDePrueba, pago, PERIODO, venta } from "./estado-liquidacion";

/* Aldana, 19/11: el lunes o martes se vende el upgrade a Hackear AI y Principals a quienes ya son alumnos (lanzamiento interno). Es una venta interna que
   Agustín SÍ comisiona. Su regla (5% del profit propio) deja afuera la «Venta interna» común y VSL YouTube, y sólo cuenta los servicios de su lista, sin el
   Upgrade AI (criterio del 28/10: el upgrade natural no le corresponde). Ahora: la estrategia «Lanzamiento interno» cuenta siempre, sea cual sea el servicio,
   y el asistente de venta la pone solo (sin depender de que el closer elija «excluida o incluida en marketing» ni la estrategia a mano). */

const REGLA_DE_AGUSTIN: ConceptoPago = concepto({
  id: "c_profit", tipo: "porcentaje", nombre: "Comisión de Agustín", tasa: 0.05, base: "profit", profitPropio: true,
  productoIds: ["p_ment", "p_principals"], sinEmbudoIds: ["emb_vsl_youtube", "emb_venta_interna"], siempreEmbudoIds: ["emb_lanzamiento_interno"],
  desde: "2026-09-01", soloVentasDesdeInicio: true,
});

/* Un septiembre con siete ventas de 1.000 cobradas el 10, cada una de un servicio y una estrategia. */
const VENTAS = [
  { id: "vA", n: "Upgrade del lanzamiento", p: "p_upgrade", emb: "emb_lanzamiento_interno" },
  { id: "vB", n: "Upgrade común", p: "p_upgrade", emb: "emb_webinar" },
  { id: "vC", n: "Principals del lanzamiento", p: "p_principals", emb: "emb_lanzamiento_interno" },
  { id: "vD", n: "Principals venta interna", p: "p_principals", emb: "emb_venta_interna" },
  { id: "vE", n: "Mentoría del lanzamiento", p: "p_ment", emb: "emb_lanzamiento_interno" },
  { id: "vF", n: "Upgrade del lanzamiento excluido", p: "p_upgrade", emb: "emb_lanzamiento_interno", excl: true },
  { id: "vG", n: "Mentoría de VSL YouTube", p: "p_ment", emb: "emb_vsl_youtube" },
  { id: "vH", n: "Upgrade sin estrategia", p: "p_upgrade", emb: undefined },
] as const;

function estado(regla: ConceptoPago = REGLA_DE_AGUSTIN): EstadoApp {
  const e = estadoDePrueba() as unknown as Record<string, unknown> & EstadoApp;
  return {
    ...e,
    honorarios: [...e.honorarios.filter((h) => h.miembroId !== "agus"), esquema("agus", [regla])],
    productos: [{ id: "p_ment", nombre: "Mentoría" }, { id: "p_upgrade", nombre: "Upgrade AI" }, { id: "p_principals", nombre: "Principals" }],
    embudos: [
      { id: "emb_webinar", nombre: "Webinar" }, { id: "emb_vsl_youtube", nombre: "VSL YOUTUBE" }, { id: "emb_venta_interna", nombre: "Venta interna" },
      { id: "emb_lanzamiento_interno", nombre: "Lanzamiento interno" },
    ],
    ventas: VENTAS.map((v) => venta({
      id: v.id, contactoNombre: v.n, precioAcordado: 1000, fecha: dia(10), closerId: "dante", productoId: v.p, embudoId: v.emb,
      ...("excl" in v ? { excluidoMarketing: true } : {}),
    })),
    cuotas: VENTAS.map((v) => ({ id: `c${v.id}`, ventaId: v.id, numero: 1, monto: 1000, estado: "pagada", esReserva: false })),
    pagos: VENTAS.map((v) => pago(`p${v.id}`, `c${v.id}`, 1000, 0, dia(10), "proc_stripe")),
    gastos: [], sesiones: [], leads: [], contactos: [],
  } as unknown as EstadoApp;
}

const liquidar = (e: EstadoApp) => {
  const r = calcularLiquidacion(e, PERIODO, liquidacionVacia(PERIODO, "2026-09-30T12:00:00.000Z"));
  const x = renglonDe(r, "agus", "c_profit");
  assert.ok(x, "falta el renglón de Agustín");
  return x.linea;
};
const nombres = (xs: { cliente: string }[] | undefined) => (xs ?? []).map((x) => x.cliente).sort();

test("la regla de Agustín cuenta lo del lanzamiento interno sea cual sea el servicio, y sigue sin contar el upgrade común", () => {
  const lista = liquidar(estado()).desglose!.lista!;
  const cuentan = nombres(lista.items);
  assert.deepEqual(cuentan, ["Mentoría del lanzamiento", "Principals del lanzamiento", "Upgrade del lanzamiento", "Upgrade del lanzamiento excluido"].sort(),
    "el upgrade del lanzamiento sí (aunque el Upgrade AI no esté en su lista), también el excluido de marketing; el upgrade común, la venta interna y VSL YouTube no");
  const motivos: Record<string, string> = Object.fromEntries((lista.excluidos ?? []).map((x) => [x.cliente, x.motivo ?? ""]));
  assert.match(motivos["Upgrade común"], /Upgrade AI, que no está entre los servicios que cuentan/);
  assert.match(motivos["Principals venta interna"], /estrategia Venta interna, que no cuenta/);
  assert.match(motivos["Mentoría de VSL YouTube"], /estrategia VSL YOUTUBE, que no cuenta/);
});

test("sin la regla nueva el upgrade del lanzamiento NO cuenta (el motivo del cambio)", () => {
  const { siempreEmbudoIds: _quitada, ...sinLaRegla } = REGLA_DE_AGUSTIN;
  const lista = liquidar(estado(sinLaRegla as ConceptoPago)).desglose!.lista!;
  assert.deepEqual(nombres(lista.items), ["Mentoría del lanzamiento", "Principals del lanzamiento"].sort());
  assert.ok(nombres(lista.excluidos).includes("Upgrade del lanzamiento"));
});

test("lo cobrado que le toca a Agustín son los 4 cobros de 1.000 que cuentan (4.000), no los otros cuatro", () => {
  const primero = liquidar(estado()).desglose!.pasos[0];
  assert.equal(primero.texto, "Cobrado de las ventas que le tocan");
  assert.equal(primero.valor, 4000);
  assert.equal(primero.nota, "4 cobros");
  /* Con la regla de antes eran 2 (Mentoría y Principals del lanzamiento). */
  const { siempreEmbudoIds: _quitada, ...antes } = REGLA_DE_AGUSTIN;
  assert.equal(liquidar(estado(antes as ConceptoPago)).desglose!.pasos[0].valor, 2000);
});

test("la regla escrita dice que las del lanzamiento cuentan siempre", () => {
  const regla = liquidar(estado()).desglose!.regla!;
  assert.match(regla, /y todas las de la estrategia Lanzamiento interno, sea cual sea el servicio/);
});

test("sin servicios elegidos el campo no dice nada (cuentan todas igual)", () => {
  const { productoIds: _p, ...sinServicios } = REGLA_DE_AGUSTIN;
  assert.ok(!/sea cual sea el servicio/.test(liquidar(estado(sinServicios as ConceptoPago)).desglose!.regla!));
});

/* ---------- La estrategia de la venta ---------- */

test("«es del lanzamiento interno» pone esa estrategia; sin marcar, sale de lo elegido como siempre", () => {
  const e = estado();
  assert.equal(estrategiaDeLaVenta(e, "c1", "2026-11-24T15:00:00Z", "emb_webinar", true), EMBUDO_LANZAMIENTO_INTERNO);
  assert.equal(estrategiaDeLaVenta(e, "c1", "2026-11-24T15:00:00Z", "emb_webinar", false), "emb_webinar");
  assert.equal(estrategiaDeLaVenta(e, "c1", "2026-11-24T15:00:00Z", undefined), undefined);
});

test("los servicios del lanzamiento son Upgrade AI y Principals", () => {
  assert.deepEqual([...SERVICIOS_DEL_LANZAMIENTO_INTERNO].sort(), ["prod_principals", "prod_upgrade_ai"]);
  assert.equal(esServicioDelLanzamientoInterno("prod_upgrade_ai"), true);
  assert.equal(esServicioDelLanzamientoInterno("prod_hackear_ai"), false);
  assert.equal(esServicioDelLanzamientoInterno(undefined), false);
});

/* ---------- El asistente de venta ---------- */

test("el asistente pregunta «¿Es del lanzamiento interno?» sin dejar pasar, y lo que se contesta manda sobre la UTM y marketing", () => {
  const a = readFileSync(new URL("../src/components/ventas/AsistenteVenta.tsx", import.meta.url), "utf8");
  /* El paso va justo después del servicio, sólo con Upgrade AI y Principals. */
  assert.match(a, /const preguntaLanzamiento = !completando && esServicioDelLanzamientoInterno\(b\.productoId\)/);
  assert.match(a, /base = \[\.\.\.base\.slice\(0, k \+ 1\), PASO_LANZAMIENTO, \.\.\.base\.slice\(k \+ 1\)\]/);
  assert.match(a, /case "lanzamiento":\s+return b\.lanzamientoInterno === null \? "Decí si es del lanzamiento interno" : null;/);
  assert.match(a, /\{paso\.id === "lanzamiento" && <PasoLanzamiento b=\{b\} set=\{set\} e=\{e\} \/>\}/);
  /* Al guardar: estrategia del lanzamiento, sin UTM ni webinar, excluida de marketing. */
  assert.match(a, /const o = lanzamiento \? undefined : origenDeUtm\(e, contactoId, b\.fecha\)/);
  assert.match(a, /estrategiaDeLaVenta\(e, contactoId, b\.fecha, b\.embudoId, lanzamiento\)/);
  assert.match(a, /const webinarId = lanzamiento \? undefined :/);
  assert.match(a, /excluidoMarketing: b\.excluidoMarketing \|\| sinComision \|\| lanzamiento,/);
  /* El resumen: el interruptor, el origen y el aviso. */
  assert.match(a, /etiqueta="Lanzamiento interno"/);
  assert.match(a, /Del lanzamiento interno: no se mira la UTM con la que la persona llegó\. Agustín comisiona esta venta\./);
  /* Y la estrategia que se pide al final no se exige si es del lanzamiento. */
  assert.match(a, /estrategiaDeLaVenta\(ctx\.e, b\.contactoId, b\.fecha, b\.embudoId, b\.lanzamientoInterno === true\)\) return FALTA_ESTRATEGIA/);
});

test("el editor de conceptos conserva siempreEmbudoIds al guardar (si no, editar la regla de Agustín la rompería)", () => {
  const a = readFileSync(new URL("../src/components/equipo/AsistenteConcepto.tsx", import.meta.url), "utf8");
  assert.match(a, /siempreEmbudoIds: c\.siempreEmbudoIds \?\? \[\]/);
  assert.match(a, /if \(b\.siempreEmbudoIds\.length && c\.productoIds\?\.length\) c\.siempreEmbudoIds = b\.siempreEmbudoIds;/);
});
