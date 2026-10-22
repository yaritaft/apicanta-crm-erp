import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { cobroDeLaLlegada, llegadaDeCobro, paseDelCobro, paseQuePisaUnCobro, saldosEsperados } from "@/lib/traspasos";
import { closersDeRechazos, subDelRechazo, rechazoDeCobro } from "@/lib/rechazos-de-cobro";
import { miPanelDe, rangoDelPanel } from "@/lib/mi-panel";
import { cobrosSinVenta } from "@/lib/caja";
import { transaccionesDe } from "@/lib/transacciones";
import { sugerirCategoria } from "@/lib/gastos";
import { comisionDePagoWhop, hotmart } from "@/lib/pasarelas-api";
import { importarCSV } from "@/lib/pasarelas";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Movimiento, Pago, Traspaso } from "@/lib/types";

/* Lo que Aldana dejó el 21 y 22/10: un depósito de «Bridge Arx» quedó como pase de Hotmart a Mercury cuando era el pago de un alumno,
   la comisión de Whop se calculaba con el 3% de la cuenta, el closer no tenía cómo saber por qué le rechazaron un cobro,
   no había dónde cargar el cashback ni dónde ver lo que entró en el día. */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const DIA = "2026-10-13T15:38:45.646Z";

/* Un depósito de Mercury «Bridge Arx», pendiente, con su cuota por cobrar, y el pase que la sincronización propuso para el mismo depósito. */
function armarDeposito(extraPase: Partial<Traspaso> = {}) {
  fijarAcceso(null);
  const base = construirSemilla() as EstadoApp;
  const cuota = base.cuotas.find((c) => c.estado === "pendiente" && !base.pagos.some((p) => p.cuotaId === c.id) && base.ventas.find((v) => v.id === c.ventaId)?.estado === "activa")!;
  const mov: Movimiento = {
    id: "mov_mercury_2d366cfe", proveedor: "mercury", referencia: "2d366cfe-c71c", monto: cuota.monto, moneda: "USD", fee: 0, neto: cuota.monto, fecha: DIA,
    estado: "pendiente", procesadorId: "proc_mercury", clienteNombre: "Bridge Arx", creadoEn: DIA, origen: "api",
  } as Movimiento;
  const pase: Traspaso = {
    id: "tra_mercury_2d366cfe", fecha: DIA, origenId: "proc_hotmart", destinoId: "proc_mercury", montoSale: cuota.monto, monedaSale: "USD",
    montoLlega: cuota.monto, monedaLlega: "USD", estado: "confirmado", llegadaRef: llegadaDeCobro(mov), contraparte: "Bridge Arx", origen: "api", creadoEn: DIA, ...extraPase,
  };
  const e = { ...base, movimientos: [mov, ...base.movimientos.filter((m) => m.estado !== "pendiente")], traspasos: [pase], pagos: base.pagos.filter((p) => p.cuotaId !== cuota.id), arqueos: [], actividad: [] };
  assert.equal(acciones.importar(JSON.stringify(e)), true);
  return { cuota, mov, pase };
}

test("un depósito que es a la vez cobro y pase: mientras está pendiente no se pisan; al conciliarlo con una cuota, el pase se descarta", () => {
  const { cuota, mov, pase } = armarDeposito();
  let e = estado();
  assert.equal(cobroDeLaLlegada(e.movimientos, pase)?.id, mov.id, "el cobro es la llegada del pase");
  assert.equal(paseQuePisaUnCobro(e.movimientos, pase), undefined, "pendiente: todavía nadie dijo que es un cliente");

  assert.equal(acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: cuota.monto }]), true);
  e = estado();
  assert.equal(e.movimientos.find((m) => m.id === mov.id)!.estado, "conciliado");
  assert.equal(e.traspasos!.find((t) => t.id === pase.id)!.estado, "ignorado", "el pase deja de contar: ya es el cobro de un cliente");
  assert.equal(paseDelCobro(e.traspasos, mov), undefined);
  assert.ok(e.actividad.some((a) => /no es un movimiento entre cuentas/i.test(a.detalle ?? "")), "queda anotado");
  /* El arqueo: sin el pase, Hotmart no pierde ni Mercury gana esos dólares; el cobro entra una sola vez por el pago. */
  const s = saldosEsperados(e, undefined, "2026-10-20T00:00:00.000Z");
  assert.equal(s.get("proc_hotmart")!.pases, 0);
  assert.equal(s.get("proc_mercury")!.pases, 0);
});

test("el aviso de doble conteo: un pase confirmado cuyo depósito ya está conciliado se marca; uno descartado o sin llegada, no", () => {
  const { mov, pase } = armarDeposito();
  const conciliado = { ...mov, estado: "conciliado" as const };
  assert.equal(paseQuePisaUnCobro([conciliado], pase)?.id, mov.id);
  assert.equal(paseQuePisaUnCobro([conciliado], { ...pase, estado: "propuesto" })?.id, mov.id, "por confirmar también se cuenta mal si después se confirma");
  assert.equal(paseQuePisaUnCobro([conciliado], { ...pase, estado: "ignorado" }), undefined);
  assert.equal(paseQuePisaUnCobro([conciliado], { ...pase, llegadaRef: undefined }), undefined);
  assert.equal(paseQuePisaUnCobro([conciliado], { ...pase, llegadaRef: "a-mano" }), undefined);
  assert.equal(paseQuePisaUnCobro([mov], pase), undefined);
});

test("atar el depósito al pago que ya estaba cargado también saca el pase", () => {
  const { cuota, mov, pase } = armarDeposito();
  /* Un pago de esa cuota cargado a mano (por Mercury) y el depósito del banco que lo respalda. */
  const antes = estado();
  const pago: Pago = {
    id: "pag_a_mano", cuotaId: cuota.id, procesadorId: "proc_mercury", monto: cuota.monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: DIA, creadoEn: DIA,
  } as Pago;
  assert.equal(acciones.importar(JSON.stringify({ ...antes, pagos: [pago, ...antes.pagos] })), true);
  assert.equal(acciones.vincularConPagos([{ movimientoId: mov.id, pagoId: pago.id }]), 1);
  assert.equal(estado().traspasos!.find((t) => t.id === pase.id)!.estado, "ignorado");
});

test("un pase cargado a mano no lo toca la guardia; y descartarlo y volver a contarlo se puede (Deshacer)", () => {
  const { cuota, mov, pase } = armarDeposito({ origen: "manual" });
  assert.equal(acciones.soltarPaseDeCobro(mov), false, "lo que alguien cargó a mano no se descarta solo");
  assert.equal(acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: cuota.monto }]), true);
  assert.equal(estado().traspasos!.find((t) => t.id === pase.id)!.estado, "confirmado");
  acciones.marcarTraspaso(pase.id, "ignorado");
  assert.equal(estado().traspasos!.find((t) => t.id === pase.id)!.estado, "ignorado");
  acciones.marcarTraspaso(pase.id, "confirmado");
  assert.equal(estado().traspasos!.find((t) => t.id === pase.id)!.estado, "confirmado", "Deshacer");
});

/* ---------- Rechazos ---------- */

const AHORA = Date.parse("2026-10-22T15:00:00.000Z");

test("el rechazo de un cobro dice quién, por qué y hace cuánto; sin motivo lo avisa; el que no está en el equipo sale por su correo", () => {
  const e = estado();
  const base: Pago = { id: "pag_x", cuotaId: "c", monto: 49.01, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: "2026-10-18T15:00:00.000Z", creadoEn: "2026-10-18T15:00:00.000Z" } as Pago;
  const aldana = e.equipo.find((m) => m.rol !== "closer") ?? e.equipo[0];
  const equipo = [{ ...aldana, nombre: "Aldana", email: "aldana@apicanta.com" }, ...e.equipo.filter((m) => m.id !== aldana.id)];
  const r = rechazoDeCobro({ equipo }, {
    ...base, chequeoFinanzas: "rechazado", chequeoFinanzasPor: "Aldana@Apicanta.com", chequeoFinanzasEn: "2026-10-20T04:28:26.537Z",
    chequeoFinanzasNota: "No corresponde a octubre, es un cobro de septiembre y fue de 50usd.",
  }, AHORA);
  assert.equal(r.quien, "Aldana");
  assert.equal(r.cuando, "hace 2 días");
  assert.match(r.nota, /No corresponde a octubre/);

  const sin = rechazoDeCobro({ equipo }, { ...base, chequeoFinanzas: "rechazado", chequeoFinanzasPor: "nahuel@apicanta.com", chequeoFinanzasEn: "2026-10-22T14:30:00.000Z" }, AHORA);
  assert.equal(sin.quien, "Nahuel", "no está en el equipo: se usa lo que va antes de la @");
  assert.equal(sin.nota, "Sin motivo escrito");
  assert.equal(sin.cuando, "recién", "media hora: todavía no es una hora");

  const larga = rechazoDeCobro({ equipo }, { ...base, chequeoFinanzas: "rechazado", chequeoFinanzasNota: "x".repeat(400) }, AHORA);
  assert.ok(larga.nota.length <= 180 && larga.nota.endsWith("…"), "un motivo larguísimo no rompe el aviso");
});

test("el paso «Arreglar los cobros rechazados» dice en el panel de qué closer está el cobro; el panel del closer lo lista con el motivo", () => {
  fijarAcceso(null);
  const base = construirSemilla() as EstadoApp;
  const closer = base.equipo.find((m) => m.rol === "closer" && m.activo)!;
  const venta = base.ventas.find((v) => v.estado === "activa" && v.closerId === closer.id) ?? { ...base.ventas.find((v) => v.estado === "activa")!, closerId: closer.id };
  const cuota = base.cuotas.find((c) => c.ventaId === venta.id) ?? base.cuotas[0];
  const pago: Pago = {
    id: "pag_rechazado", cuotaId: cuota.id, procesadorId: "proc_stripe", monto: 49.01, moneda: "USD", feeRate: 0, feeMonto: 0,
    fecha: "2026-10-18T15:00:00.000Z", creadoEn: "2026-10-18T15:00:00.000Z", cargadoPor: closer.email ?? "closer@apicanta.com",
    chequeoFinanzas: "rechazado", chequeoFinanzasPor: "aldana@apicanta.com", chequeoFinanzasEn: "2026-10-20T04:28:00.000Z",
    chequeoFinanzasNota: "Ya está registrado y conciliado.",
  } as Pago;
  const e: EstadoApp = {
    ...base, ventas: base.ventas.map((v) => (v.id === venta.id ? { ...v, closerId: closer.id } : v)),
    cuotas: base.cuotas.map((c) => (c.id === cuota.id ? { ...c, ventaId: venta.id } : c)),
    pagos: [pago], equipo: base.equipo.map((m) => (m.rol !== "closer" && m === base.equipo.find((x) => x.rol !== "closer") ? { ...m, nombre: "Aldana", email: "aldana@apicanta.com" } : m)),
  };
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const sub = subDelRechazo(e, pago, ventaDeCuota, ventas, AHORA);
  assert.match(sub, /Ya está registrado y conciliado/);
  assert.match(sub, new RegExp(`en el panel de ${closer.nombre}, hace 2 días`));
  assert.equal(closersDeRechazos(e, [pago], ventaDeCuota, ventas, AHORA), `${closer.nombre} (desde hace 2 días)`);
  assert.equal(closersDeRechazos(e, [pago], ventaDeCuota, new Map([[venta.id, { closerId: undefined }]]), AHORA), "", "sin closer no hay a quién nombrar");
  const sinCloser = subDelRechazo(e, pago, ventaDeCuota, new Map([[venta.id, { closerId: undefined }]]), AHORA);
  assert.match(sinCloser, /no tiene closer a quien avisarle/);

  const panel = miPanelDe(e, closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA);
  const aviso = panel.avisos.find((a) => a.clave === "rc|pag_rechazado");
  assert.ok(aviso, "el cobro rechazado está en «Para vos»");
  assert.equal(aviso!.tono, "danger");
  assert.match(aviso!.texto, /rechazado por Aldana \(hace 2 días\): «Ya está registrado y conciliado»\. Corregilo/);
  assert.match(aviso!.texto, /US\$ 49/);
});

test("las ventas del closer sin estrategia (embudo) le aparecen en «Para vos»; las de otro closer, las canceladas y las viejas no", () => {
  fijarAcceso(null);
  const base = construirSemilla() as EstadoApp;
  const closer = base.equipo.find((m) => m.rol === "closer" && m.activo)!;
  const otro = base.equipo.find((m) => m.rol === "closer" && m.activo && m.id !== closer.id)!;
  const molde = base.ventas.find((v) => v.estado === "activa")!;
  const venta = (id: string, extra: Record<string, unknown>) => ({ ...molde, id, contactoNombre: id, closerId: closer.id, embudoId: undefined, estado: "activa", fecha: "2026-10-15T15:00:00.000Z", ...extra }) as EstadoApp["ventas"][number];
  const e: EstadoApp = {
    ...base, pagos: [],
    ventas: [venta("Con embudo", { embudoId: "emb_x" }), venta("Sin embudo", {}), venta("Cancelada", { estado: "cancelada" }), venta("De otro", { closerId: otro.id }), venta("Vieja", { fecha: "2026-07-01T15:00:00.000Z" })],
  };
  const aviso = miPanelDe(e, closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA).avisos.filter((a) => a.clave.startsWith("se|"));
  assert.deepEqual(aviso.map((a) => a.resaltado), ["Sin embudo"]);
  assert.match(aviso[0].texto, /no tiene estrategia \(embudo\)/);
  assert.equal(aviso[0].accion?.ir, "ficha");
});

/* ---------- Whop ---------- */

test("la comisión de Whop sale de las comisiones que lista o de lo que va de lo cobrado a lo que queda: la mayor, nunca el 3% a ciegas", () => {
  /* Aldana: «entró 582, pero Whop decía 577,43» (600 cobrados). */
  assert.equal(comisionDePagoWhop({ total: 600, amount_after_fees: 577.43 }).fee, 22.57);
  /* Whop dejó lo cobrado y lo que queda iguales, pero lista las comisiones: antes eso daba 0 y se usaba el 3% (18). */
  const listada = comisionDePagoWhop({ total: 600, amount_after_fees: 600, fees: [
    { type: "payment_processing_percentage_fee", amount: 17.4 }, { type: "fixed_card_processing_fee", amount: 0.3 }, { type: "radar_fee", amount: 0.07 }, { type: "cross_border_fee", amount: 4.8 },
  ] });
  assert.equal(listada.fee, 22.57);
  assert.equal(listada.listadas, 4);
  /* Si las dos cifras dicen cosas distintas, la mayor: no se subestima lo que se quedó Whop. */
  assert.equal(comisionDePagoWhop({ total: 1000, amount_after_fees: 970, fees: [{ amount: 55.37 }] }).fee, 55.37);
  /* Sin nada: sin comisión (queda la estimada) y se sabe qué trajo. */
  const nada = comisionDePagoWhop({ total: 600, amount_after_fees: 600 });
  assert.equal(nada.fee, undefined);
  assert.deepEqual([nada.total, nada.despues, nada.listadas], [600, 600, 0]);
  assert.equal(comisionDePagoWhop({}).fee, undefined);
  /* Una comisión mayor que lo cobrado es un dato roto: no se usa. */
  assert.equal(comisionDePagoWhop({ total: 100, amount_after_fees: 0, fees: [{ amount: 250 }] }).fee, undefined);
});

test("el export de pagos de Whop se importa con su comisión real (la API de Whop no la trae con la clave actual): monto cobrado, fecha de pago y Fee", () => {
  /* Columnas tal cual las trae el export de Whop (el de Aldana del 20/10), recortadas. */
  const csv = [
    'ID,Paid at,Created at,Status,Description,Payment method,Email,Subtotal,Tax amount,Amount excluding tax,Payment Amount,Refunded amount,Fee,Payment Currency,Customer name,Sub status,Total Amount USD (Excluding Fees)',
    'pay_BCEzBGcIcUOUBj,2026-08-14 13:47:59 -0300,2026-08-14 13:47:57 -0300,paid,HACKEAR AI,card,nico@x.com,1000.0,0.0,1000.0,1000.0,0.0,55.37,usd,Nicolas Godoy,succeeded,944.63',
    'pay_xibFKX9acdhyOn,2026-10-02 19:42:04 -0300,2026-10-02 19:42:00 -0300,paid,HACKEAR AI,card,otra@x.com,1000.0,0.0,1000.0,1000.0,0.0,37.37,usd,Otra Persona,succeeded,992.63',
  ].join("\n");
  const r = importarCSV(csv, "whop", "proc_whop", 0.03);
  assert.equal(r.movimientos.length, 2);
  const [a, b] = r.movimientos;
  assert.deepEqual([a.referencia, a.monto, a.fee, a.neto], ["pay_BCEzBGcIcUOUBj", 1000, 55.37, 944.63], "la comisión es la que cobró Whop, no el 3%");
  assert.deepEqual([b.referencia, b.monto, b.fee, b.neto], ["pay_xibFKX9acdhyOn", 1000, 37.37, 962.63]);
  assert.equal(a.fecha, "2026-08-14T16:47:59.000Z", "la fecha es la de pago (Paid at), con su zona");
  assert.equal(a.clienteEmail, "nico@x.com");
  /* Importarlo sobre cobros que ya estaban con comisión 0 la completa, y los pagos conciliados toman la real. */
  fijarAcceso(null);
  const base = construirSemilla() as EstadoApp;
  const cuota = base.cuotas.find((c) => c.estado === "pendiente" && !base.pagos.some((p) => p.cuotaId === c.id) && base.ventas.find((v) => v.id === c.ventaId)?.estado === "activa")!;
  const mov: Movimiento = { id: "mov_w", proveedor: "whop", referencia: "pay_BCEzBGcIcUOUBj", monto: 1000, moneda: "USD", fee: 0, neto: 1000, fecha: a.fecha, estado: "pendiente", procesadorId: "proc_whop", creadoEn: a.fecha, origen: "api" } as Movimiento;
  assert.equal(acciones.importar(JSON.stringify({ ...base, movimientos: [mov], pagos: [], arqueos: [], traspasos: [] })), true);
  assert.equal(acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: Math.min(1000, cuota.monto) }]), true);
  const antes = estado().pagos.find((p) => p.movimientoId === mov.id)!;
  assert.equal(antes.feeMonto, Math.round(antes.monto * 0.03 * 100) / 100, "conciliado con el 3% estimado");
  acciones.importarMovimientos([a], "csv");
  const despues = estado();
  assert.equal(despues.movimientos.find((m) => m.id === mov.id)!.fee, 55.37);
  const pago = despues.pagos.find((p) => p.movimientoId === mov.id)!;
  assert.equal(pago.feeMonto, Math.round(55.37 * (pago.monto / 1000) * 100) / 100, "el pago toma la comisión real, en proporción");
});

/* ---------- Hotmart ---------- */

test("Hotmart: si contesta 400 al pedido normal se reintenta sin la fecha de fin, y con otro error no se insiste", async () => {
  const guardado = { ...process.env };
  const fetchOriginal = globalThis.fetch;
  process.env.HOTMART_CLIENT_ID = "id"; process.env.HOTMART_CLIENT_SECRET = "secreto"; process.env.HOTMART_BASIC = "basic";
  const pedidos: string[] = [];
  const responder = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      pedidos.push(u);
      if (u.includes("oauth/token")) return responder({ access_token: "t" });
      if (u.includes("sales/history")) {
        return u.includes("end_date") ? responder({ message: "The request was unacceptable, often due to a misconfigured parameter." }, 400) : responder({ items: [{
          product: { name: "Programa" }, buyer: { name: "Ana", email: "ana@x.com" },
          purchase: { transaction: "HP1", approved_date: Date.parse("2026-10-20T12:00:00Z"), price: { value: 100, currency_code: "USD" }, payment: { type: "PIX" } },
        }], page_info: {} });
      }
      return responder({ items: [] });
    }) as typeof fetch;
    const lista = await hotmart(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-22T00:00:00Z"));
    assert.equal(lista.length, 1);
    assert.equal(lista[0].referencia, "HP1");
    const historial = pedidos.filter((u) => u.includes("sales/history"));
    assert.ok(historial.some((u) => u.includes("end_date")) && historial.some((u) => !u.includes("end_date")), "probó con y sin la fecha de fin");

    /* Un 401 (clave mala) no se reintenta cuatro veces. */
    pedidos.length = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      pedidos.push(u);
      if (u.includes("oauth/token")) return responder({ access_token: "t" });
      return responder({ error: "unauthorized" }, 401);
    }) as typeof fetch;
    await assert.rejects(() => hotmart(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-22T00:00:00Z")), /respondió 401/);
    assert.equal(pedidos.filter((u) => u.includes("sales/history")).length, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const k of ["HOTMART_CLIENT_ID", "HOTMART_CLIENT_SECRET", "HOTMART_BASIC"]) { if (guardado[k] === undefined) delete process.env[k]; else process.env[k] = guardado[k]; }
  }
});

/* ---------- Cashback, lo que entró sin venta y el día ---------- */

test("el cashback tiene su categoría: escribir «cashback» la elige sola, como un ingreso que resta de los gastos", () => {
  const e = construirSemilla() as EstadoApp;
  assert.equal(sugerirCategoria("Cashback Mercury", e)?.categoria, "Cashback");
  assert.equal(sugerirCategoria("cash back de la tarjeta", e)?.categoria, "Cashback");
  assert.equal(sugerirCategoria("Reembolso del hotel", e)?.categoria, "Reembolsos", "lo demás sigue igual");
});

test("la plata que entró y todavía no tiene su venta se cuenta aparte, desde el último arqueo, neta de la comisión", () => {
  const e = construirSemilla() as EstadoApp;
  const mov = (id: string, extra: Partial<Movimiento>): Movimiento => ({
    id, proveedor: "whop", referencia: id, monto: 600, moneda: "USD", fee: 22.57, neto: 577.43, fecha: "2026-10-21T16:00:00.000Z", estado: "pendiente", creadoEn: "2026-10-21T16:00:00.000Z", origen: "api", ...extra,
  } as Movimiento);
  const datos = { ajustes: e.ajustes, movimientos: [
    mov("a", {}), mov("b", { monto: 200, fee: 0 }), mov("viejo", { fecha: "2026-10-01T10:00:00.000Z" }), mov("conciliado", { estado: "conciliado" }), mov("futuro", { fecha: "2026-10-23T10:00:00.000Z" }),
  ] };
  assert.deepEqual(cobrosSinVenta(datos, "2026-10-20T00:00:00.000Z", "2026-10-22T12:00:00.000Z"), { n: 2, monto: 777.43 });
  assert.deepEqual(cobrosSinVenta(datos, null, "2026-10-22T12:00:00.000Z").n, 3, "sin arqueo anterior cuenta desde siempre");
  assert.deepEqual(cobrosSinVenta({ ...datos, movimientos: [] }, null, "2026-10-22T12:00:00.000Z"), { n: 0, monto: 0 });
});

test("lo que entró en un día: el cobro que espera la venta de un closer lo dice, y cada fila lleva su día de negocio", () => {
  const base = construirSemilla() as EstadoApp;
  const closer = base.equipo.find((m) => m.rol === "closer" && m.activo)!;
  const e: EstadoApp = {
    ...base, pagos: [], gastos: [], devoluciones: [], traspasos: [],
    movimientos: [
      { id: "m1", proveedor: "whop", referencia: "pay_1", monto: 600, moneda: "USD", fee: 0, neto: 600, fecha: "2026-10-21T16:28:08.000Z", estado: "pendiente", procesadorId: "proc_whop", clienteNombre: "Cristian", creadoEn: "x", origen: "api", pedidoACloserId: closer.id, pedidoEn: "2026-10-21T17:00:00.000Z" },
      { id: "m2", proveedor: "whop", referencia: "pay_2", monto: 200, moneda: "USD", fee: 0, neto: 200, fecha: "2026-10-21T18:00:00.000Z", estado: "pendiente", procesadorId: "proc_whop", clienteNombre: "Brian", creadoEn: "x", origen: "api" },
    ] as Movimiento[],
  };
  const filas = transaccionesDe(e).filas.filter((f) => f.dia === "2026-10-21");
  assert.equal(filas.length, 2);
  assert.equal(filas.find((f) => f.titulo === "Cristian")!.estado, `Esperando la venta de ${closer.nombre}`);
  assert.equal(filas.find((f) => f.titulo === "Brian")!.estado, "Sin conciliar");
});
