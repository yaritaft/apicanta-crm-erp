import test from "node:test";
import assert from "node:assert/strict";
import {
  dinero, moneda, puntaDeMercury, puntaDeRetiroStripe, rechazo, reembolsoDeHotmart, reembolsoDeStripe, reembolsoDeWhop, json,
} from "@/lib/pasarelas-api";
import { clasificarMercury, reglasExtraDeEntorno, cobrosAnulados } from "@/lib/mercury";
import { conciliarPuntas, cuentaDeContraparte, type Punta } from "@/lib/traspasos";
import {
  conciliarReembolsos, idDePropuesta, referenciaDeReembolso, reembolsoDePropuesta, type ReembolsoCrudo,
} from "@/lib/reembolsos";
import { parcheDeCobro } from "@/lib/completar-cobros";
import type { Devolucion, Traspaso } from "@/lib/types";
import { Azar, basura, propiedad, textoLoco } from "./azar";

/* ==================================================================
   ESTRÉS · lo que se traduce de las pasarelas (lib/pasarelas-api.ts,
   mercury.ts, reembolsos.ts).

   - Los traductores puros (reembolsoDeStripe / Hotmart / Whop, la punta de
     un retiro de Stripe, la de Mercury, clasificarMercury) con datos
     rotos: nada tira, o devuelve null.
   - Los reembolsos que informa una pasarela: cada uno cuenta una sola
     vez (el mismo reembolso por el webhook, por la sync y por el CSV, en
     cualquier orden, es una propuesta), nunca se confirman solos y nunca
     tocan lo que ya estaba cargado, salvo para atarse.
   - Las puntas de Mercury y Stripe: guardarlas dos veces no duplica pases.
   ================================================================== */

/* ---------- Traductores con basura ---------- */

test("reembolsoDeStripe / Hotmart / Whop: con campos faltantes, tipos cambiados y números raros devuelven null o un reembolso válido", propiedad("traductores de reembolsos", 600, (az) => {
  /* Los extremos que tiran excepción (fechas enormes, moneda que no es texto) están en el BUG de más abajo. */
  /* Números de hasta 1e12: más grandes (1e300) desbordan a Infinity al redondear, y las fechas enormes tienen su BUG abajo. */
  const sano = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) =>
    typeof x === "number" && Math.abs(x) > 1e12 ? 1e12 : typeof x === "string" && /^\s*[-+]?(infinity|\d{16,}|\d+e\d+)/i.test(x) ? "5" : x)));
  /* Los campos de texto vienen como texto (o faltan) y las fechas como número razonable: los tipos cambiados y los
     extremos tienen su BUG aparte, más abajo. El resto (montos, estados, objetos) sí viene con basura. */
  const TEXTO = new Set(["currency", "currency_code", "name", "email", "reason"]);
  const FECHA = new Set(["created", "approved_date", "order_date", "refunded_at", "updated_at", "paid_at", "created_at"]);
  const objeto = (campos: string[]): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const c of campos) {
      if (!az.bool(0.7)) continue;
      o[c] = TEXTO.has(c) ? az.pick(["usd", "ARS", "eur", "Ana Pérez", "A@B.com", "", " ", undefined]) : FECHA.has(c) ? az.pick([az.int(0, 2_000_000_000), az.int(0, 2_000_000_000) * 1000, undefined, 0]) : sano(basura(az));
    }
    return o;
  };
  const stripe = reembolsoDeStripe({ ...objeto(["id", "amount", "status", "created", "currency", "reason", "payment_intent"]), charge: az.pick([undefined, "ch_1", objeto(["id", "payment_intent", "billing_details", "receipt_email"])]) });
  const hot = reembolsoDeHotmart({ purchase: objeto(["transaction", "price", "approved_date", "order_date"]), buyer: objeto(["name", "email"]) } as never, az.bool());
  const whop = reembolsoDeWhop({ ...objeto(["id", "refunded_amount", "final_amount", "subtotal", "refunded_at", "updated_at", "paid_at", "created_at", "currency", "user"]) });
  for (const r of [stripe, hot, whop]) {
    if (r === null) continue;
    assert.ok(Number.isFinite(r.monto) && r.monto > 0, `monto ${r.monto}`);
    assert.ok(r.referencia !== "");
    assert.ok(!Number.isNaN(Date.parse(r.fecha)), `fecha ${r.fecha}`);
    assert.ok(["USD", "ARS"].includes(r.moneda));
    assert.ok(r.procesadorId?.startsWith("proc_"));
    assert.ok(r.clienteEmail === undefined || r.clienteEmail === r.clienteEmail.toLowerCase());
  }
}));

test("reembolsoDe…: un reembolso fallido o cancelado de Stripe no devuelve plata; sin id o sin monto, null", () => {
  for (const status of ["failed", "canceled", "cancelled", "requires_action"]) assert.equal(reembolsoDeStripe({ id: "re_1", amount: 100, status, created: 1790000000 }), null, status);
  assert.equal(reembolsoDeStripe({ amount: 100 }), null);
  assert.equal(reembolsoDeStripe({ id: "re_1", amount: 0 }), null);
  assert.equal(reembolsoDeStripe({ id: "re_1", amount: -500 }), null);
  assert.equal(reembolsoDeStripe({ id: "re_1" }), null);
  assert.equal(reembolsoDeHotmart({ purchase: { transaction: "", price: { value: 10 } } } as never), null);
  assert.equal(reembolsoDeHotmart({ purchase: { transaction: "HP1", price: { value: 0 } } } as never), null);
  assert.equal(reembolsoDeHotmart({} as never), null);
  assert.equal(reembolsoDeWhop({ id: "pay_1", refunded_amount: 0, final_amount: 0 }), null);
  assert.equal(reembolsoDeWhop({ refunded_amount: 10 }), null);
  /* El reembolso de Stripe, bien: 1.500,00 de un cargo. */
  const ok = reembolsoDeStripe({ id: "re_9", amount: 150000, status: "succeeded", created: 1790000000, charge: "ch_9", payment_intent: "pi_9", currency: "usd" })!;
  assert.equal(ok.monto, 1500);
  assert.deepEqual(ok.referenciasCobro, ["ch_9", "pi_9"]);
  assert.equal(referenciaDeReembolso(ok), "stripe:re_9");
});

test("dinero, moneda, json y rechazo: no tiran con basura; rechazo no incluye claves y corta a 240 caracteres", async () => {
  for (const n of [0, -0, NaN, Infinity, 1e308, 0.005, 1.005, -1.005, 2.675]) assert.equal(typeof dinero(n), "number");
  assert.equal(moneda("ars"), "ARS");
  assert.equal(moneda(undefined), "USD");
  for (const crudo of ["", "no json", "{", "null", "[]", "5", "\u0000", "x".repeat(100000)]) {
    const j = await json(new Response(crudo));
    /* Lo que no es JSON queda en {crudo}; un JSON que no es un objeto (null, 5) pasa tal cual. */
    if (!["null", "[]", "5"].includes(crudo)) assert.equal(typeof j, "object");
    if (!["null", "[]", "5"].includes(crudo)) assert.ok(j !== null);
  }
  const e = rechazo("Stripe", new Response("", { status: 429 }), { message: "x".repeat(1000), apiKey: "sk_live_secreto" } as Record<string, unknown>);
  assert.ok(e.message.length <= "Stripe respondió 429: ".length + 240);
  assert.equal(e.message.includes("sk_live_secreto"), false);
  const e2 = rechazo("Hotmart", new Response("", { status: 400 }), { errors: [{ detail: "faltan datos" }] });
  assert.match(e2.message, /faltan datos/);
  const e3 = rechazo("X", new Response("", { status: 500 }), {});
  assert.match(e3.message, /500/);
});

test("puntaDeRetiroStripe y puntaDeMercury: con basura devuelven null o una punta válida (monto positivo, fecha ISO, ref estable)", propiedad("puntas con basura", 600, (az) => {
  const p = puntaDeRetiroStripe({ id: az.pick(["po_1", "", undefined, 5, null]), status: az.pick(["paid", "failed", "canceled", "in_transit", undefined, 5]), amount: az.pick([100000, -100000, 0, "abc", null, 1.5, NaN, -0]), created: az.pick([1790000000, 0, -5, "x", null, 1790000000.5]), currency: az.pick(["usd", "ars", undefined]), statement_descriptor: az.pick(["APICANTA", 5, undefined]), description: az.pick(["x", undefined]) } as Record<string, unknown>);
  if (p) {
    assert.ok(p.monto > 0 && Number.isFinite(p.monto));
    assert.ok(!Number.isNaN(Date.parse(p.fecha)));
    assert.match(p.ref, /^stripe:/);
    assert.equal(p.cuentaId, "proc_stripe");
  }
  const t = {
    id: az.pick(["tx_1", "", undefined, 7, null]), amount: az.pick([100, -100, 0, "abc", null, NaN, 1e15]), status: az.pick(["sent", "pending", "failed", "cancelled", "reversed", "blocked", undefined, 5]),
    counterpartyName: az.pick(["Stripe", "STRIPE PAYMENTS", "Hotmart", "WHOP INC", "Ana Pérez", "", undefined, 5, "Mercury Credit", "ARX"]),
    postedAt: az.pick(["2026-09-12T10:00:00Z", "no es fecha", "", undefined, null, 5]), createdAt: az.pick(["2026-09-11T10:00:00Z", undefined]),
    kind: az.pick(["externalTransfer", "internalTransfer", "creditCardTransaction", "treasuryTransfer", undefined, 5]), bankDescription: az.pick(["x", undefined]),
  } as Record<string, unknown>;
  const m = puntaDeMercury(t, az.pick([[], ["subcuenta"], reglasExtraDeEntorno(",,a, b ,")]));
  if (m) {
    assert.ok(m.monto > 0 && Number.isFinite(m.monto));
    assert.ok(!Number.isNaN(Date.parse(m.fecha)));
    assert.equal(m.ref, `mercury:${String(t.id)}`);
    assert.equal(m.lado, (Number(t.amount) > 0) ? "llegada" : "salida");
    assert.equal(m.moneda, "USD");
    assert.ok(cuentaDeContraparte(String(t.counterpartyName)) !== null, "sólo es un pase si la otra parte es una cuenta propia");
    assert.equal(m.seguro, m.lado === "llegada" && cuentaDeContraparte(String(t.counterpartyName))!.seguro);
  }
}));

test("clasificarMercury: lo anulado es siempre anulado, un pending no cuenta, y con basura da una de las seis clases", propiedad("clasificarMercury", 600, (az) => {
  const t: Record<string, unknown> = {
    status: az.pick(["sent", "pending", "failed", "cancelled", "canceled", "reversed", "blocked", "FAILED", " failed", "", undefined, 5, null]),
    amount: az.pick([100, -100, 0, "abc", null, NaN]), kind: az.pick(["externalTransfer", "internalTransfer", "creditCardTransaction", "treasuryTransfer", "other", undefined]),
    counterpartyName: az.pick(["Ana Pérez", "Mercury", "Stripe", "Mercury Credit Card", "AUTOPAY", "", undefined, textoLoco(az, 20)]), bankDescription: az.pick(["x", "Credit card payment", undefined, textoLoco(az, 30)]),
    externalMemo: az.pick(["x", undefined]), note: az.pick(["x", undefined]),
  };
  const c = clasificarMercury(t, az.pick([[], ["ana"], ["", "  "], reglasExtraDeEntorno(" a , ,b")]));
  assert.ok(["anulado", "interno", "pase", "en-proceso", "cobro", "gasto"].includes(c.tipo));
  assert.ok(c.motivo.length > 0);
  const estado = String(t.status ?? "").toLowerCase();
  if (["failed", "cancelled", "canceled", "reversed", "blocked"].includes(estado)) assert.equal(c.tipo, "anulado");
  /* Es una función pura: lo mismo da lo mismo. */
  assert.deepEqual(clasificarMercury(t, []), clasificarMercury({ ...t }, []));
}));

test("cobrosAnulados: sólo los de Mercury, pendientes y con esa referencia; los conciliados no se tocan", () => {
  const movs = [
    { id: "a", proveedor: "mercury", referencia: "r1", estado: "pendiente" }, { id: "b", proveedor: "mercury", referencia: "r1", estado: "conciliado" },
    { id: "c", proveedor: "stripe", referencia: "r1", estado: "pendiente" }, { id: "d", proveedor: "mercury", referencia: "r2", estado: "pendiente" },
    { id: "e", proveedor: "mercury", referencia: "r1", estado: "ignorado" },
  ] as never[];
  assert.deepEqual(cobrosAnulados(movs, ["r1"]), ["a"]);
  assert.deepEqual(cobrosAnulados(movs, []), []);
  assert.deepEqual(cobrosAnulados(movs, new Set(["r1", "r2"])).sort(), ["a", "d"]);
});

/* ---------- conciliarReembolsos ---------- */

interface Mundo { estado: Record<string, unknown>; crudos: ReembolsoCrudo[] }

const ahoraIso = "2026-10-07T12:00:00.000Z";
const DIA = 86400000;

function mundo(az: Azar): Mundo {
  const n = az.int(1, 8);
  const ventas: Record<string, unknown>[] = [], cuotas: Record<string, unknown>[] = [], pagos: Record<string, unknown>[] = [], devoluciones: Devolucion[] = [];
  const crudos: ReembolsoCrudo[] = [];
  for (let i = 0; i < n; i++) {
    const cargo = `ch_${az.alfanum(8)}${i}`, intento = `pi_${az.alfanum(8)}${i}`, monto = az.int(10, 3000);
    const cuando = Date.parse("2026-09-20T12:00:00Z") + az.int(0, 15) * DIA;
    ventas.push({ id: `v${i}`, contactoNombre: `Persona ${i}`, contactoId: undefined });
    cuotas.push({ id: `c${i}`, ventaId: `v${i}` });
    if (az.bool(0.6)) pagos.push({ id: `p${i}`, cuotaId: `c${i}`, referencia: cargo, monto });
    const hayManual = az.bool(0.4);
    if (hayManual) devoluciones.push({ id: `dev_mano_${i}`, ventaId: `v${i}`, monto, moneda: "USD", fecha: new Date(cuando).toISOString(), estado: "confirmada", noDescontarAlCloser: false, creadoEn: ahoraIso, extra: {} } as Devolucion);
    if (az.bool(0.8)) {
      crudos.push({
        proveedor: "stripe", referencia: `re_${az.alfanum(8)}${i}`, referenciasCobro: [cargo, intento], monto, moneda: "USD",
        fecha: new Date(cuando + az.int(0, 3) * DIA).toISOString(), clienteNombre: `Persona ${i}`, procesadorId: "proc_stripe",
      });
    }
  }
  return { estado: { ventas, cuotas, pagos, movimientos: [], devoluciones, procesadores: [{ id: "proc_stripe", nombre: "Stripe", proveedor: "stripe" }], contactos: [], leads: [] }, crudos };
}

const aplicar = (e: Record<string, unknown>, r: ReturnType<typeof conciliarReembolsos>): Record<string, unknown> => {
  const cambios = new Map(r.atadas.map((a) => [a.devolucionId, a.cambios] as const));
  return { ...e, devoluciones: [...r.nuevas, ...(e.devoluciones as Devolucion[]).map((d) => (cambios.has(d.id) ? ({ ...d, ...cambios.get(d.id) } as Devolucion) : d))] };
};

test("conciliarReembolsos: cada reembolso cuenta una vez (nueva, atada o ya estaba), siempre como propuesta, y sin tocar lo cargado salvo para atarse", propiedad("conciliar reembolsos", 250, (az) => {
  const { estado, crudos } = mundo(az);
  const antes = JSON.parse(JSON.stringify(estado.devoluciones)) as Devolucion[];
  const r = conciliarReembolsos(estado as never, crudos, ahoraIso);
  assert.equal(r.nuevas.length + r.atadas.length + r.yaEstaban, crudos.length, "ninguno se pierde ni se cuenta dos veces");
  const ids = new Set(antes.map((d) => d.id));
  for (const p of r.nuevas) {
    assert.equal(p.estado, "propuesta", "nunca se confirma sola");
    assert.ok(p.monto > 0 && !Number.isNaN(Date.parse(p.fecha)));
    assert.equal(ids.has(p.id), false, "el id no choca con uno existente");
    ids.add(p.id);
    assert.equal(p.id, idDePropuesta(reembolsoDePropuesta(p) ?? { proveedor: p.proveedor!, referencia: p.referencia!.split(":").slice(1).join(":") }));
  }
  const usadas = new Set<string>();
  for (const a of r.atadas) {
    assert.equal(usadas.has(a.devolucionId), false, "una devolución cargada se ata a UN reembolso");
    usadas.add(a.devolucionId);
    const d = antes.find((x) => x.id === a.devolucionId)!;
    assert.ok(d && d.estado === "confirmada" && !d.referencia, "sólo se atan las cargadas a mano y sin referencia");
    assert.ok(Object.keys(a.cambios).every((k) => ["referencia", "proveedor", "conciliadaEn", "procesadorId", "extra"].includes(k)), `cambios: ${Object.keys(a.cambios)}`);
  }
  assert.deepEqual(estado.devoluciones, antes, "conciliarReembolsos no escribe nada: devuelve qué hacer");
}));

test("conciliarReembolsos: aplicar el resultado y volver a traer lo mismo (una vez, dos veces, en otro orden) no cambia nada", propiedad("reembolsos idempotentes", 250, (az) => {
  const { estado, crudos } = mundo(az);
  const r1 = conciliarReembolsos(estado as never, crudos, ahoraIso);
  const e1 = aplicar(estado, r1);
  for (const lista of [crudos, [...crudos].reverse(), az.mezclar([...crudos, ...crudos])]) {
    const r2 = conciliarReembolsos(e1 as never, lista, ahoraIso);
    assert.equal(r2.nuevas.length, 0, "no propone otra vez");
    assert.equal(r2.atadas.length, 0, "no ata otra vez");
    assert.equal(r2.dudosas, 0);
    assert.equal(r2.yaEstaban, lista.length);
  }
  /* Ni siquiera aplicando el segundo resultado: queda igual. */
  const e2 = aplicar(e1, conciliarReembolsos(e1 as never, crudos, ahoraIso));
  assert.deepEqual(e2.devoluciones, e1.devoluciones);
  /* Y lo que quedó como propuesta se puede volver a leer como lo que informó la pasarela. */
  for (const d of e1.devoluciones as Devolucion[]) if (d.estado === "propuesta") {
    const c = reembolsoDePropuesta(d)!;
    assert.equal(c.monto, d.monto);
    assert.equal(referenciaDeReembolso(c), d.referencia);
  }
}));

test("el mismo reembolso por tres vías (webhook y sync con el re_…, CSV con el cargo) en cualquier orden queda como UNA propuesta", propiedad("tres vías, una devolución", 120, (az) => {
  const cargo = `ch_${az.alfanum(8)}`, intento = `pi_${az.alfanum(8)}`, re = `re_${az.alfanum(8)}`;
  const monto = az.int(10, 5000);
  const fecha = "2026-10-02T15:00:00.000Z";
  const base = { proveedor: "stripe" as const, monto, moneda: "USD" as const, procesadorId: "proc_stripe" };
  const vias: ReembolsoCrudo[] = [
    { ...base, referencia: re, referenciasCobro: [cargo, intento], fecha },
    { ...base, referencia: re, referenciasCobro: [cargo, intento], fecha },
    { ...base, referencia: `reembolso:${cargo}`, referenciasCobro: [cargo], fecha: "2026-10-01T03:00:00.000Z", fechaDelCobro: true },
  ];
  let e: Record<string, unknown> = { ventas: [], cuotas: [], pagos: [], movimientos: [], devoluciones: [], procesadores: [], contactos: [], leads: [] };
  for (const v of az.mezclar(vias)) e = aplicar(e, conciliarReembolsos(e as never, [v], ahoraIso));
  const props = (e.devoluciones as Devolucion[]).filter((d) => d.estado === "propuesta");
  assert.equal(props.length, 1, `propuestas: ${props.map((p) => p.id)}`);
  assert.equal(props[0].monto, monto);
}));

test("hotmart: el mismo reembolso por el webhook, la sync y el CSV es una sola devolución (la referencia es la del cobro)", () => {
  const delAviso = reembolsoDeHotmart({ purchase: { transaction: "HP99", price: { value: 300, currency_code: "USD" }, approved_date: 1790000000000 }, buyer: { email: "A@B.com" } } as never)!;
  const delCsv = (importarCsv()).find((r) => r.referencia === "reembolso:HP99")!;
  assert.equal(referenciaDeReembolso(delAviso), referenciaDeReembolso(delCsv));
  let e: Record<string, unknown> = { ventas: [], cuotas: [], pagos: [], movimientos: [], devoluciones: [], procesadores: [], contactos: [], leads: [] };
  for (const r of [delCsv, delAviso, delAviso, delCsv]) e = aplicar(e, conciliarReembolsos(e as never, [r], ahoraIso));
  assert.equal((e.devoluciones as Devolucion[]).length, 1);
});

function importarCsv(): ReembolsoCrudo[] {
  return [{ proveedor: "hotmart", referencia: "reembolso:HP99", referenciasCobro: ["HP99"], monto: 300, moneda: "USD", fecha: "2026-09-20T12:00:00.000Z", fechaDelCobro: true }];
}

/* ---------- las puntas ---------- */

test("conciliarPuntas: guardar las mismas puntas otra vez (o en otro orden) no duplica pases ni los toca", propiedad("puntas idempotentes", 150, (az) => {
  const puntas: Punta[] = [];
  const base = Date.parse("2026-09-25T12:00:00Z");
  for (let i = 0; i < az.int(1, 8); i++) {
    const monto = az.int(100, 9000);
    const dia = base + az.int(0, 10) * DIA;
    puntas.push({ lado: "salida", cuentaId: "proc_stripe", otraCuentaId: "proc_mercury", monto, moneda: "USD", fecha: new Date(dia).toISOString(), ref: `stripe:po_${az.alfanum(8)}${i}`, seguro: true });
    if (az.bool(0.7)) puntas.push({ lado: "llegada", cuentaId: "proc_mercury", otraCuentaId: "proc_stripe", monto, moneda: "USD", fecha: new Date(dia + az.int(1, 3) * DIA).toISOString(), ref: `mercury:tx_${az.alfanum(8)}${i}`, contraparte: "STRIPE", seguro: true });
  }
  const r1 = conciliarPuntas([], puntas, ahoraIso);
  const guardados: Traspaso[] = r1.nuevos.map((t) => ({ ...t }));
  /* Los cambios de r1 sobre pases nuevos ya van adentro de `nuevos` (se mutan en el lugar). */
  assert.equal(new Set(guardados.map((t) => t.id)).size, guardados.length, "ids únicos, derivados de la punta");
  const refs = guardados.flatMap((t) => [t.salidaRef, t.llegadaRef]).filter(Boolean);
  assert.equal(new Set(refs).size, refs.length, "ninguna punta entra dos veces");
  for (const lista of [puntas, [...puntas].reverse(), az.mezclar([...puntas, ...puntas])]) {
    const r2 = conciliarPuntas(guardados, lista, ahoraIso);
    assert.equal(r2.nuevos.length, 0, "no hay pases nuevos");
    assert.equal(r2.cambios.length, 0, "ni cambios");
  }
  /* Con todas las puntas vistas, cada punta está en algún pase. */
  const vistas = new Set(refs);
  for (const p of puntas) assert.ok(vistas.has(p.ref), `la punta ${p.ref} se perdió`);
}));

test("completar un cobro: parcheDeCobro nunca pisa lo que ya estaba y, aplicado, la segunda vez no hay nada que completar", propiedad("parche de cobro", 400, (az) => {
  const dato = (a: unknown[]) => az.pick(a) as string | undefined;
  const guardado = { proveedor: az.pick(["stripe", "whop", "mercury", "hotmart", "binance"] as const), monto: 100, fee: az.pick([0, 3.5]), neto: 96.5, clienteNombre: dato([undefined, "", "Ana"]), clienteEmail: dato([undefined, "", "a@b.com"]), clienteTelefono: dato([undefined, ""]), metodo: dato([undefined, "Tarjeta"]), descripcion: dato([undefined, "TPQ…", "Mentoría"]), fecha: "2026-09-01T12:00:00.000Z", estado: "pendiente" as const };
  const traido = { monto: az.pick([100, 100.004, 250]), fee: az.pick([0, 3.5, 4]), neto: az.pick([96, 96.5]), clienteNombre: dato([undefined, "Beto", " "]), clienteEmail: dato([undefined, "BETO@MAIL.COM"]), clienteTelefono: dato([undefined, "+54 9 11 5555 1234"]), metodo: dato([undefined, "PayPal"]), descripcion: dato([undefined, "TPQNPnSLA9XYZ", "Otra"]), fecha: az.pick(["2026-09-01T12:00:30.000Z", "2026-09-03T12:00:00.000Z"]) };
  const p = parcheDeCobro(guardado, traido);
  if (!p) return;
  if (guardado.clienteNombre) assert.equal(p.clienteNombre, undefined);
  if (guardado.clienteEmail) assert.equal(p.clienteEmail, undefined);
  if (guardado.metodo) assert.equal(p.metodo, undefined);
  if (p.fee !== undefined) assert.ok(guardado.fee === 0 && Math.abs(traido.monto - guardado.monto) < 0.01, "la comisión real sólo si era el mismo cobro y no se sabía");
  if (p.clienteEmail) assert.equal(p.clienteEmail, p.clienteEmail.toLowerCase());
  const despues = { ...guardado, ...p };
  assert.equal(parcheDeCobro(despues, traido), null, "ya está completo");
}));

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: un monto «Infinity» o 1e308 pasa por positivo en los traductores de reembolsos (monto > 0 sin mirar que sea finito)", { todo: true }, () => {
  /* dinero(1e308) = Infinity (n * 100 desborda) y `Infinity > 0`; con «Infinity» como texto, Number() lo devuelve tal cual.
     El JSON lo manda como null y la base rechaza el lote; el CSV y los avisos están abiertos a eso. */
  const candidatos = [
    reembolsoDeStripe({ id: "re_1", amount: "Infinity", status: "succeeded", created: 1790000000 }),
    reembolsoDeStripe({ id: "re_1", amount: 1e308, status: "succeeded", created: 1790000000 }),
    reembolsoDeWhop({ id: "pay_1", final_amount: "Infinity" }),
    reembolsoDeHotmart({ purchase: { transaction: "HP1", price: { value: 1.7976931348623157e308 } } } as never),
  ];
  for (const r of candidatos) assert.ok(r === null || Number.isFinite(r.monto), `monto ${r?.monto}`);
});

test("BUG: dos reembolsos DISTINTOS de Stripe (re_1 y re_2) del mismo cargo y del mismo monto, que llegan en tandas distintas, se toman por el mismo: el segundo se pierde", { todo: true }, () => {
  /* yaDeCobro(): «el mismo cobro y el mismo monto es el mismo» (pensado para unir el CSV, que trae el cargo, con
     la API, que trae el re_…). Pero también se dispara con dos re_ distintos: devolver 50 dos veces de un cargo de
     100, un día cada vez, deja una sola propuesta y la segunda salida de plata no se ve nunca. */
  const base = { proveedor: "stripe" as const, referenciasCobro: ["ch_1", "pi_1"], monto: 50, moneda: "USD" as const, procesadorId: "proc_stripe" };
  let e: Record<string, unknown> = { ventas: [], cuotas: [], pagos: [], movimientos: [], devoluciones: [], procesadores: [], contactos: [], leads: [] };
  e = aplicar(e, conciliarReembolsos(e as never, [{ ...base, referencia: "re_1", fecha: "2026-10-01T10:00:00.000Z" }], ahoraIso));
  e = aplicar(e, conciliarReembolsos(e as never, [{ ...base, referencia: "re_2", fecha: "2026-10-02T10:00:00.000Z" }], ahoraIso));
  assert.deepEqual((e.devoluciones as Devolucion[]).map((d) => d.referencia).sort(), ["stripe:re_1", "stripe:re_2"], "son dos devoluciones de 50");
});

test("BUG: reembolsoDeStripe / reembolsoDeWhop / reembolsoDeHotmart / puntaDeRetiroStripe tiran RangeError o TypeError con una fecha enorme o no numérica, una moneda o un mail que no son texto", { todo: true }, () => {
  const tiran: string[] = [];
  const prueba = (nombre: string, f: () => unknown) => { try { f(); } catch (e) { tiran.push(`${nombre}: ${e instanceof Error ? e.message : e}`); } };
  prueba("reembolsoDeStripe(created 1e300)", () => reembolsoDeStripe({ id: "re_1", amount: 100, status: "succeeded", created: 1e300 }));
  prueba("reembolsoDeStripe(currency 5)", () => reembolsoDeStripe({ id: "re_1", amount: 100, status: "succeeded", created: 1790000000, currency: 5 }));
  prueba("reembolsoDeWhop(refunded_at 1e300)", () => reembolsoDeWhop({ id: "pay_1", refunded_amount: 10, refunded_at: 1e300 }));
  prueba("reembolsoDeWhop(currency {})", () => reembolsoDeWhop({ id: "pay_1", refunded_amount: 10, currency: {} }));
  prueba("reembolsoDeHotmart(approved_date 1e300)", () => reembolsoDeHotmart({ purchase: { transaction: "HP1", price: { value: 10 }, approved_date: 1e300 } } as never));
  prueba("puntaDeRetiroStripe(created 1e300)", () => puntaDeRetiroStripe({ id: "po_1", amount: 100, created: 1e300 }));
  prueba("reembolsoDeHotmart(approved_date «2026-09-01»)", () => reembolsoDeHotmart({ purchase: { transaction: "HP1", price: { value: 10 }, approved_date: "2026-09-01" } } as never));
  prueba("reembolsoDeHotmart(buyer.email 5)", () => reembolsoDeHotmart({ purchase: { transaction: "HP1", price: { value: 10 } }, buyer: { email: 5 } } as never));
  prueba("reembolsoDeHotmart(price.currency_code {})", () => reembolsoDeHotmart({ purchase: { transaction: "HP1", price: { value: 10, currency_code: {} } } } as never));
  assert.deepEqual(tiran, [], "tendrían que devolver null o ignorar el campo");
});

test("BUG: un cobro de un cliente cuyo memo dice «pago» y «tarjeta» (o «payment» y «credit card», o «autopay») se clasifica «interno» y desaparece sin avisar", { todo: true }, () => {
  /* La regla «Pago de la tarjeta de crédito» busca en TODO el texto del movimiento, incluido externalMemo (lo escribe quien
     transfiere). «Pago mentoría — mi tarjeta no funcionó» es una transferencia de un cliente, no el pago de la tarjeta de
     Mercury: no entra como cobro, ni como pase, ni se ve; sólo suma uno al contador de «internos». Lo mismo con un cliente
     cuyo nombre empieza con «Mercury» y un memo con «checking». */
  const base = { id: "t1", amount: 1500, status: "sent", counterpartyName: "Ana Pérez", kind: "externalTransfer", postedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" };
  const mal: string[] = [];
  for (const memo of ["Pago mentoría - tarjeta de mi esposa no funcionó", "payment for course, no credit card available", "Pago por transferencia, tarjeta bloqueada", "Autopay mentoria"]) {
    const c = clasificarMercury({ ...base, externalMemo: memo });
    if (c.tipo !== "cobro") mal.push(`«${memo}» → ${c.tipo}`);
  }
  const c2 = clasificarMercury({ ...base, counterpartyName: "Mercury Marketing LLC", externalMemo: "checking" });
  if (c2.tipo !== "cobro") mal.push(`«Mercury Marketing LLC / checking» → ${c2.tipo}`);
  assert.deepEqual(mal, [], "son plata de un cliente");
});
