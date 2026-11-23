import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calcularLiquidacion, diferenciasDesdeElCierre, porQueCambio, porQueCambioElRenglon, PREFIJO_DE_RESTO, textoDelCambio,
} from "@/lib/honorarios";
import type { EstadoApp, LineaLiquidada, Liquidacion } from "@/lib/types";
import { concepto, esquema, estadoDePrueba, miembro, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   El ajuste del mes siguiente dice POR QUÉ cambió (23/11). Decía «Comisión de X: 2.400 → 1.968» y nadie sabía de dónde salía: eran
   ventas que después del cierre pasaron a una estrategia que no le cuenta, y costos del mes que bajaron. Ahora cada renglón dice qué
   cobros salieron o entraron (con el motivo de la regla) y qué pasos de la cuenta se movieron. Montos y nombres de prueba.
   ================================================================== */

const SIGUIENTE = "2026-10";

/* Un growth que cobra 5% del profit propio sin la estrategia de YouTube, y un socio que cobra 10% del profit menos la comisión del growth. */
function conCadena(): EstadoApp {
  const e0 = estadoDePrueba();
  return {
    ...e0,
    equipo: [...e0.equipo, miembro("socio", "Socio de prueba", "otro")],
    honorarios: [
      ...e0.honorarios.filter((h) => h.miembroId !== "agus"),
      esquema("agus", [concepto({ id: "c_pp", tipo: "porcentaje", nombre: "Comisión del growth", tasa: 0.05, base: "profit", profitPropio: true, sinEmbudoIds: ["emb_yt"] })]),
      esquema("socio", [concepto({ id: "c_pp", tipo: "porcentaje", nombre: "Comisión del socio", tasa: 0.10, base: "profit", profitPropio: true, descuentaComisionDe: ["agus"] })]),
    ],
    ventas: e0.ventas.map((v) => ({ ...v, embudoId: "emb_web" })),
    embudos: [{ id: "emb_web", nombre: "Webinar", esWebinar: true }, { id: "emb_yt", nombre: "VSL YOUTUBE" }],
  } as EstadoApp;
}

function cerrarY(e0: EstadoApp, despues: (e: EstadoApp) => EstadoApp) {
  const base = { id: `liq_${PERIODO}`, periodo: PERIODO, estado: "abierta", corte: null, entradas: {}, extras: [] } as unknown as Liquidacion;
  const cerrada = { ...base, estado: "cerrada", resultado: calcularLiquidacion(e0, PERIODO, base) } as unknown as Liquidacion;
  const e = despues({ ...e0, liquidaciones: [cerrada] } as EstadoApp);
  return { e, cerrada };
}

const aYouTube = (e: EstadoApp) => ({ ...e, ventas: e.ventas.map((v) => (v.id === "v1" ? { ...v, embudoId: "emb_yt" } : v)) }) as EstadoApp;
const resto = (e: EstadoApp, id: string) =>
  calcularLiquidacion(e, SIGUIENTE).personas.find((p) => p.miembroId === id)?.lineas.find((l) => l.clave.startsWith(PREFIJO_DE_RESTO));

test("una venta que después del cierre pasa a una estrategia que no cuenta: el ajuste dice qué cobro salió y por qué", () => {
  const { e, cerrada } = cerrarY(conCadena(), aYouTube);
  const d = diferenciasDesdeElCierre(e, cerrada).find((x) => x.miembroId === "agus")!;
  const r = d.renglones.find((x) => x.nombre === "Comisión del growth")!;
  assert.equal(r.salieron?.length, 2, "salieron las dos cuotas cobradas de la venta que pasó a YouTube");
  assert.ok(r.salieron!.every((x) => x.cliente === "Belén Godoy"));
  assert.equal(r.salieron!.reduce((a, x) => a + x.monto, 0), -3000, "lo que salió va en negativo");
  assert.ok(r.salieron!.every((x) => /^Salió: es de la estrategia VSL YOUTUBE/.test(x.motivo!)));
  assert.ok(r.salieron!.every((x) => x.estrategia === "Webinar → VSL YOUTUBE"), "la estrategia dice lo que era al cerrar y lo que es hoy");
  assert.equal(r.entraron, undefined, "no entró nada");
  assert.ok(r.pasos?.some((p) => /Cobrado/i.test(p.texto) && Math.round(p.cerrado - p.hoy) === 3000), "en la cuenta, lo cobrado bajó 3.000");

  const l = resto(e, "agus")!;
  assert.equal(l.montoBase, -150);
  assert.match(l.desglose!.avisos!.join(" "), /Qué cambió · Comisión del growth: .*Salieron 2 cobros \(US\$ 3\.000\): es de la estrategia VSL YOUTUBE/);
  assert.equal(l.desglose!.lista!.titulo, "Los cobros que cambiaron desde el cierre");
  assert.deepEqual(l.desglose!.lista!.items.map((x) => x.monto), [-1500, -1500]);
  assert.match(l.desglose!.lista!.items[0].motivo!, /^Salió:/);
});

test("quien cobra sobre la comisión de otro: sus cobros no cambiaron, el ajuste dice que se movió la comisión del otro", () => {
  const { e, cerrada } = cerrarY(conCadena(), aYouTube);
  const d = diferenciasDesdeElCierre(e, cerrada).find((x) => x.miembroId === "socio")!;
  const r = d.renglones[0];
  assert.equal(r.salieron, undefined);
  assert.equal(r.entraron, undefined);
  assert.ok(r.pasos?.some((p) => /Comisión de Agustín|Comisión del growth|Agustín/i.test(p.texto) && Math.round(p.cerrado - p.hoy) === 150), "la comisión del growth bajó 150");
  assert.match(porQueCambio(d.renglones, "USD"), /^En la cuenta: /);
  assert.equal(resto(e, "socio")!.montoBase, 15);
});

test("la venta que vuelve a contar entra con el motivo que la dejaba afuera al cerrar", () => {
  const e0 = aYouTube(conCadena());
  const { e, cerrada } = cerrarY(e0, (x) => ({ ...x, ventas: x.ventas.map((v) => (v.id === "v1" ? { ...v, embudoId: "emb_web" } : v)) }) as EstadoApp);
  const r = diferenciasDesdeElCierre(e, cerrada).find((x) => x.miembroId === "agus")!.renglones[0];
  assert.equal(r.entraron?.length, 2);
  assert.equal(r.entraron!.reduce((a, x) => a + x.monto, 0), 3000);
  assert.match(r.entraron![0].motivo!, /^Entró: al cerrar no contaba \(es de la estrategia VSL YOUTUBE/);
  assert.equal(r.entraron![0].estrategia, "VSL YOUTUBE → Webinar");
  assert.match(textoDelCambio(r, "USD"), /Entraron 2 cobros \(US\$ 3\.000\)/);
});

test("corregir el nombre del cliente no es un cobro que salió y otro que entró", () => {
  const { e, cerrada } = cerrarY(conCadena(), (x) => ({
    ...aYouTube(x),
    ventas: aYouTube(x).ventas.map((v) => (v.id === "v2" ? { ...v, contactoNombre: "Pedro Gómez Ruiz" } : v)),
  }) as EstadoApp);
  const r = diferenciasDesdeElCierre(e, cerrada).find((x) => x.miembroId === "agus")!.renglones[0];
  assert.deepEqual(r.salieron?.map((x) => x.cliente), ["Belén Godoy", "Belén Godoy"], "sólo salieron los de YouTube");
  assert.equal(r.entraron, undefined, "el renombrado no figura como entrado");
});

const linea = (lista: Partial<NonNullable<NonNullable<LineaLiquidada["desglose"]>["lista"]>>, pasos: { texto: string; valor: number }[] = []): LineaLiquidada => ({
  clave: "c", conceptoId: "c", tipo: "porcentaje", nombre: "Comisión", detalle: "", moneda: "USD", monto: 0, montoBase: 0, variable: true, enFinanzas: false,
  desglose: {
    regla: "", moneda: "USD",
    pasos: [...pasos.map((p) => ({ op: "base" as const, texto: p.texto, valor: p.valor, formato: "plata" as const, moneda: "USD" as const })), { op: "igual", texto: "Monto del mes", valor: 0, formato: "plata", moneda: "USD" }],
    lista: { tipo: "cobros", titulo: "", moneda: "USD", total: 0, items: [], ...lista },
  },
});
const cobro = (fecha: string, monto: number) => ({ fecha, cliente: "Cliente de prueba", monto, procesador: "Stripe" });

test("con una lista recortada (guardada sin todos los cobros) no se inventa qué salió: sólo dice lo que se movió en la cuenta", () => {
  const antes = linea({ total: 30, items: [cobro("2026-09-03", 100)] }, [{ texto: "Cobrado", valor: 1000 }]);
  const hoy = linea({ total: 1, items: [cobro("2026-09-04", 100)] }, [{ texto: "Cobrado", valor: 900 }]);
  const x = porQueCambioElRenglon(antes, hoy);
  assert.equal(x.salieron, undefined);
  assert.equal(x.entraron, undefined);
  assert.deepEqual(x.pasos, [{ texto: "Cobrado", cerrado: 1000, hoy: 900 }]);
});

test("dos cobros iguales cuentan dos veces: si sale uno, sale uno", () => {
  const antes = linea({ total: 2, items: [cobro("2026-09-03T15:00:00Z", 100), cobro("2026-09-03T15:00:00Z", 100)] });
  const hoy = linea({ total: 1, items: [cobro("2026-09-03T15:00:00Z", 100)] });
  assert.equal(porQueCambioElRenglon(antes, hoy).salieron?.length, 1);
});

test("la pantalla muestra el porqué: debajo de cada cobro de la lista y una línea debajo de cada persona en el mes cerrado", () => {
  const desglose = readFileSync("src/components/equipo/DesgloseRenglon.tsx", "utf8");
  assert.match(desglose, /Qué cambió/, "al copiar la lista va la columna");
  assert.match(desglose, /x\.motivo && <span className="liq-lista__cambio"/);
  const liq = readFileSync("src/components/equipo/Liquidacion.tsx", "utf8");
  assert.match(liq, /porQueCambio\(x\.renglones, base\)/);
  assert.match(liq, /liq-difs__porque/);
});
