import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import {
  cuentasDeWhatsapp, diagnosticarWhatsapp, ErrorMetaWhatsapp, leerCostos, pistaDelError, sincronizarCostosWhatsapp, tramos, traerCostosWhatsapp, WABA_POR_DEFECTO, type PedirAMeta,
} from "@/lib/meta-whatsapp";
import { costoWhatsappDelWebinar, metricasDeWebinar, numerosDelWebinar, origenAutomatico } from "@/lib/webinar";
import type { EstadoApp, Webinar } from "@/lib/types";

/* El costo de «WhatsApp API» de cada webinar sale de Meta (21/10): lo que cobra WhatsApp por los mensajes de la API, día por día, repartido
   al próximo webinar como los DM Ads. Antes se cargaba a mano y estaba en US$ 0. */

const unix = (dia: string) => Date.parse(`${dia}T00:00:00Z`) / 1000;
const respuesta = (puntos: Record<string, unknown>[]) => ({ pricing_analytics: { data: [{ data_points: puntos }] }, id: "517225948145267" });

test("la cuenta de WhatsApp Business sale de la configuración y, sin nada, es la que dio el Business Manager", () => {
  assert.deepEqual(cuentasDeWhatsapp({} as never), [WABA_POR_DEFECTO]);
  assert.deepEqual(cuentasDeWhatsapp({ META_WABA_ID: "111111111" } as never), ["111111111"]);
  assert.deepEqual(cuentasDeWhatsapp({ META_WABA_IDS: "111111111, 222222222 111111111" } as never), ["111111111", "222222222"]);
  assert.deepEqual(cuentasDeWhatsapp({ META_WABA_ID: "no-es-un-id" } as never), [], "un valor raro no se manda a Meta");
});

test("las fechas se parten en pedidos de a lo sumo 30 días, sin dejar días afuera ni repetirlos", () => {
  const t = tramos("2026-08-01", "2026-10-21");
  assert.equal(t.length, 3);
  assert.equal(t[0].start, unix("2026-08-01"));
  assert.equal(t[t.length - 1].end, unix("2026-10-22"), "el último día entra entero");
  for (let i = 1; i < t.length; i++) assert.equal(t[i].start, t[i - 1].end, "un tramo empieza donde termina el otro");
  assert.ok(t.every((x) => (x.end - x.start) / 86400 <= 30));
  assert.deepEqual(tramos("2026-10-05", "2026-10-05"), [{ start: unix("2026-10-05"), end: unix("2026-10-06") }]);
  assert.deepEqual(tramos("2026-10-05", "2026-10-01"), []);
  assert.deepEqual(tramos("basura", "2026-10-01"), []);
});

test("se lee la respuesta de Meta: costo por día y categoría, sumando lo repetido y aceptando números como texto", () => {
  const r = leerCostos(respuesta([
    { start: unix("2026-10-05"), end: unix("2026-10-06"), pricing_category: "MARKETING", volume: 120, cost: 9.6 },
    { start: unix("2026-10-05"), end: unix("2026-10-06"), pricing_category: "MARKETING", volume: 30, cost: "2.4" },
    { start: unix("2026-10-05"), end: unix("2026-10-06"), pricing_category: "UTILITY", volume: 10, cost: 0.2 },
    { start: unix("2026-10-06"), end: unix("2026-10-07"), volume: 5, cost: 0 },
  ]), "W1", "USD");
  assert.deepEqual(r.filas.map((f) => `${f.dia} ${f.categoria} ${f.volumen} ${f.costo}`), [
    "2026-10-05 MARKETING 150 12", "2026-10-05 UTILITY 10 0.2", "2026-10-06 TOTAL 5 0",
  ]);
  assert.equal(r.descartados, 0);
  /* También la forma de la ruta de borde ({data:[…]}), con las horas en milisegundos o en texto ISO. */
  const b = leerCostos({ data: [{ data_points: [{ start: unix("2026-10-07") * 1000, cost: 1 }, { start: "2026-10-08T00:00:00Z", cost: 2 }] }] }, "W1", "USD");
  assert.deepEqual(b.filas.map((f) => `${f.dia} ${f.costo}`), ["2026-10-07 1", "2026-10-08 2"]);
});

test("lo que no se entiende se descarta y se cuenta, sin romper", () => {
  const r = leerCostos(respuesta([{ start: "ayer", cost: 1 }, { start: unix("2026-10-05"), cost: "mucho" }, { start: unix("2026-10-05"), cost: 3 }, null as never]), "W1", "USD");
  assert.equal(r.filas.length, 1);
  assert.equal(r.descartados, 3);
  for (const raro of [null, undefined, 7, "x", [], {}, { data: "no" }, { pricing_analytics: { data: [null, 1, {}] } }]) {
    assert.deepEqual(leerCostos(raro, "W1", "USD").filas, [], JSON.stringify(raro));
  }
});

test("traerCostosWhatsapp pide la moneda y cada tramo, con la expansión de campos documentada", async () => {
  const pedidos: { ruta: string; fields?: string }[] = [];
  const pedir: PedirAMeta = async (ruta, params) => {
    pedidos.push({ ruta, fields: params.fields });
    if (params.fields === "currency") return { currency: "USD" };
    return respuesta([{ start: unix("2026-08-03"), pricing_category: "MARKETING", volume: 1, cost: 0.5 }]);
  };
  const r = await traerCostosWhatsapp(pedir, "W1", "2026-08-01", "2026-10-21");
  assert.equal(pedidos[0].fields, "currency");
  assert.equal(pedidos.length, 1 + 3, "la moneda y tres tramos");
  assert.match(pedidos[1].fields!, /^pricing_analytics\.start\(\d+\)\.end\(\d+\)\.granularity\(DAILY\)\.metric_types\(\["COST","VOLUME"\]\)\.dimensions\(\["PRICING_CATEGORY"\]\)$/);
  assert.equal(r.moneda, "USD");
  assert.equal(r.monedaSupuesta, false);
  assert.equal(r.filas.length, 1, "el mismo día y categoría que vuelve en cada tramo no se repite");
});

test("si Meta rechaza la expansión por parámetros (100), se prueba la ruta de borde; otros errores no se esconden", async () => {
  const vistos: string[] = [];
  const pedir: PedirAMeta = async (ruta, params) => {
    vistos.push(ruta);
    if (params.fields === "currency") throw new ErrorMetaWhatsapp("sin moneda", 100);
    if (params.fields) throw new ErrorMetaWhatsapp("Invalid parameter", 100);
    return { data: [{ data_points: [{ start: unix("2026-10-05"), cost: 4 }] }] };
  };
  const r = await traerCostosWhatsapp(pedir, "W1", "2026-10-01", "2026-10-10");
  assert.deepEqual(vistos, ["W1", "W1", "W1/pricing_analytics"]);
  assert.equal(r.filas[0].costo, 4);
  assert.equal(r.monedaSupuesta, true, "sin poder leer la moneda se supone USD y queda anotado");
  await assert.rejects(traerCostosWhatsapp(async (_r, p) => { if (p.fields === "currency") return { currency: "USD" }; throw new ErrorMetaWhatsapp("boom", 1); }, "W1", "2026-10-01", "2026-10-10"), /boom/);
});

test("el error de permisos dice qué hacer", () => {
  assert.match(pistaDelError(new ErrorMetaWhatsapp("(#200) Requires whatsapp_business_management permission", 200)), /whatsapp_business_management/);
  assert.match(pistaDelError(new ErrorMetaWhatsapp("Session has expired", 190)), /venció/);
  assert.equal(pistaDelError(new Error("otra cosa")), "otra cosa");
});

/* ---------- Guardar y repartir ---------- */

function dbFalsa(opciones: { falla?: string } = {}) {
  const filas: Record<string, unknown>[] = [];
  const db = { from: () => ({ upsert: async (f: Record<string, unknown>[]) => { if (opciones.falla) return { error: { message: opciones.falla } }; filas.push(...f); return { error: null }; } }) };
  return { db: db as never, filas };
}

test("sincronizarCostosWhatsapp guarda los días y devuelve el resumen; un error de una cuenta no tira a las otras", async () => {
  const pedir: PedirAMeta = async (ruta, params) => {
    if (ruta === "MALA") throw new ErrorMetaWhatsapp("(#200) permission", 200);
    if (params.fields === "currency") return { currency: "USD" };
    return respuesta([{ start: unix("2026-10-05"), pricing_category: "MARKETING", volume: 10, cost: 1.5 }, { start: unix("2026-10-06"), pricing_category: "MARKETING", volume: 10, cost: 2.5 }]);
  };
  const { db, filas } = dbFalsa();
  const r = await sincronizarCostosWhatsapp(db, pedir, ["BUENA", "MALA"], "2026-10-01", "2026-10-10");
  assert.equal(r[0].dias, 2);
  assert.equal(r[0].total, 4);
  assert.equal(r[0].error, undefined);
  assert.match(r[1].error ?? "", /whatsapp_business_management/);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => [f.dia, f.cuenta, f.categoria, f.moneda]), [["2026-10-05", "BUENA", "MARKETING", "USD"], ["2026-10-06", "BUENA", "MARKETING", "USD"]]);
});

test("sin la tabla creada, el error dice que falta el SQL", async () => {
  const pedir: PedirAMeta = async (_r, p) => (p.fields === "currency" ? { currency: "USD" } : respuesta([{ start: unix("2026-10-05"), cost: 1 }]));
  const r = await sincronizarCostosWhatsapp(dbFalsa({ falla: 'relation "whatsapp_costos" does not exist' }).db, pedir, ["W1"], "2026-10-01", "2026-10-10");
  assert.match(r[0].error ?? "", /whatsapp-costos\.sql/);
});

const base = construirSemilla();
const W = (id: string, dia: string, extra: Partial<Webinar> = {}): Webinar => ({ ...base.webinars[0], id, titulo: id, fecha: `${dia}T22:00:00.000Z`, estado: "finalizado", inversion: 1000, inversionDmAds: 0, costoWhatsappApi: 0, formularios: 100, ...extra } as Webinar);
const estado = (webinars: Webinar[], costosWpp?: { dia: string; costo: number }[]): EstadoApp => ({ ...base, webinars, ventas: [], adInsights: [], costosWpp } as unknown as EstadoApp);

test("cada día de costo va al próximo webinar (hasta 21 días antes), como los DM Ads", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21")], [
    { dia: "2026-09-20", costo: 100 },   // 17 días antes de a: es de a
    { dia: "2026-10-07", costo: 10 },    // el día del vivo de a: es de a
    { dia: "2026-10-08", costo: 40.123 }, // ya pasó a: es de b
    { dia: "2026-10-21", costo: 5 },     // el día del vivo de b
    { dia: "2026-08-01", costo: 999 },   // más de 21 días antes de cualquiera: de nadie
    { dia: "2026-10-22", costo: 7 },     // después del último vivo: de nadie
  ]);
  assert.equal(costoWhatsappDelWebinar(e, e.webinars[0]), 110);
  assert.equal(costoWhatsappDelWebinar(e, e.webinars[1]), 45.12);
});

test("el costo de WhatsApp API entra en la inversión total y en el ROAS; lo cargado a mano manda", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21", { costoWhatsappApi: 50 })], [{ dia: "2026-10-05", costo: 200 }, { dia: "2026-10-15", costo: 80 }]);
  const [a, b] = e.webinars;
  assert.equal(numerosDelWebinar(e, a).costoWhatsappApi, 200);
  assert.equal(metricasDeWebinar(e, a).inversionTotal, 1200, "pauta 1000 + WhatsApp 200");
  assert.match(origenAutomatico(e, a, "costoWhatsappApi") ?? "", /WhatsApp Business/);
  assert.equal(numerosDelWebinar(e, b).costoWhatsappApi, 50, "lo cargado a mano en b no se pisa");
  assert.equal(origenAutomatico(e, b, "costoWhatsappApi"), undefined);
});

test("sin costos de WhatsApp todo queda como estaba", () => {
  for (const costos of [undefined, []]) {
    const e = estado([W("a", "2026-10-07")], costos);
    assert.equal(costoWhatsappDelWebinar(e, e.webinars[0]), 0);
    assert.equal(numerosDelWebinar(e, e.webinars[0]).costoWhatsappApi, 0);
    assert.equal(origenAutomatico(e, e.webinars[0], "costoWhatsappApi"), undefined);
  }
});

test("cuando Meta rechaza por permisos, el resultado dice qué permisos tiene el token y si la cuenta se puede leer", async () => {
  const pedir: PedirAMeta = async (ruta, p) => {
    if (ruta === "me/permissions") return { data: [{ permission: "ads_read", status: "granted" }, { permission: "business_management", status: "granted" }, { permission: "whatsapp_business_messaging", status: "declined" }] };
    if (p.fields === "id,name") return { id: "W1", name: "Apicanta" };
    throw new ErrorMetaWhatsapp("(#200) You do not have permission to access this field.", 200);
  };
  const r = await sincronizarCostosWhatsapp(dbFalsa().db, pedir, ["W1"], "2026-10-01", "2026-10-10");
  assert.match(r[0].error ?? "", /whatsapp_business_management/);
  assert.deepEqual(r[0].diagnostico, { permisos: ["ads_read", "business_management"], cuentaLeible: true, nombre: "Apicanta", faltaPermiso: true });
});

test("el diagnóstico distingue «falta el permiso» de «la cuenta no está asignada» y no tira si no puede preguntar", async () => {
  const sinAsignar: PedirAMeta = async (ruta) => {
    if (ruta === "me/permissions") return { data: [{ permission: "whatsapp_business_management", status: "granted" }] };
    throw new ErrorMetaWhatsapp("(#100) Object does not exist or you lack permission", 100);
  };
  const d = await diagnosticarWhatsapp(sinAsignar, "W1");
  assert.equal(d.faltaPermiso, false, "el permiso está");
  assert.equal(d.cuentaLeible, false, "pero la cuenta no se lee: falta asignarla al usuario de sistema");
  assert.match(d.errorCuenta ?? "", /lack permission/);
  const nada = await diagnosticarWhatsapp(async () => { throw new Error("sin red"); }, "W1");
  assert.deepEqual(nada, { permisos: null, cuentaLeible: false, errorCuenta: "sin red" });
});

test("un error que no es de permisos no dispara el diagnóstico", async () => {
  const pedir: PedirAMeta = async (_r, p) => { if (p.fields === "currency") return { currency: "USD" }; throw new ErrorMetaWhatsapp("(#1) Unknown error", 1); };
  const r = await sincronizarCostosWhatsapp(dbFalsa().db, pedir, ["W1"], "2026-10-01", "2026-10-10");
  assert.ok(r[0].error);
  assert.equal(r[0].diagnostico, undefined);
});
