import test from "node:test";
import assert from "node:assert/strict";
import { esperadoDelArqueo } from "@/lib/arqueo";
import { cajaEsperada } from "@/lib/caja";
import { puntaDeMercury, puntaDeRetiroStripe } from "@/lib/pasarelas-api";
import { clasificarMercury } from "@/lib/mercury";
import {
  cambioDeLlegada, conciliarPuntas, conLlegadasDichas, cuentaDeContraparteEnMercury, cuentaDeContraparte, enCamino, esperaLlegada, estabaEnCamino,
  pasesParaPreguntar, pasesPorCuenta, pistasDeLlegada, saldosEsperados, situacionDe, type Punta,
} from "@/lib/traspasos";
import type { Arqueo, EstadoApp, Traspaso } from "@/lib/types";
import { estadoDeYari } from "./estado-devolucion";

/* ==================================================================
   La plata que salió de una cuenta y todavía no llegó a la otra (Aldana, 11/11).

   «El lunes hice cierre de caja y siempre me queda con diferencias por la plata que salió de una cuenta pero aún no llega a la otra. ¿Eso está
   bien así? Yo igual justifico todas las diferencias que quedan». El caso real: US$ 100 de Bank of America a Mercury cargados el 5/11 (el día que
   salieron); Mercury los acreditó el 9/11 a las 20:01. La app los dio por llegados el 5/11 y al contar el 8/11 Mercury «faltaba» US$ 100.
   ================================================================== */

const ANTERIOR: Arqueo = {
  id: "a1", fecha: "2026-11-01T02:59:59.999Z", total: 3000, creadoEn: "2026-11-01T02:59:59.999Z",
  saldos: [
    { procesadorId: "proc_mercury", monto: 1000, moneda: "USD", montoBase: 1000 },
    { procesadorId: "proc_bofa", monto: 2000, moneda: "USD", montoBase: 2000 },
  ],
};
const AL_8 = "2026-11-09T02:59:59.999Z"; /* el fin del domingo 8/11 en Argentina: el corte del arqueo del lunes */
const AL_15 = "2026-11-16T02:59:59.999Z";

/* BofA → Mercury, US$ 100, cargado a mano el 5/11. */
const PASE: Traspaso = {
  id: "t_100", fecha: "2026-11-05T15:00:00.000Z", origenId: "proc_bofa", destinoId: "proc_mercury",
  montoSale: 100, monedaSale: "USD", montoLlega: 100, monedaLlega: "USD", estado: "confirmado", origen: "manual", creadoEn: "2026-11-05T15:00:00.000Z",
};
const CUENTAS = [
  { id: "proc_mercury", nombre: "ACH-WIRE Mercury", feeRate: 0, activo: true, automatico: true },
  { id: "proc_bofa", nombre: "Bank of America", feeRate: 0, activo: true, automatico: false },
];
const estado = (traspasos: Traspaso[], arqueos: Arqueo[] = [ANTERIOR]): EstadoApp => estadoDeYari({ arqueos, traspasos, pagos: [], gastos: [], procesadores: CUENTAS });

const contado = (mercury: number, bofa: number) => ({
  fecha: AL_8, total: mercury + bofa,
  saldos: [
    { procesadorId: "proc_mercury", monto: mercury, moneda: "USD" as const, montoBase: mercury },
    { procesadorId: "proc_bofa", monto: bofa, moneda: "USD" as const, montoBase: bofa },
  ],
});
const cuenta = (e: EstadoApp, id: string, fecha = AL_8) => saldosEsperados(e, ANTERIOR, fecha).get(id)!.esperado!;

test("un pase cargado a mano se da por llegado el mismo día: por eso Mercury «faltaba» 100 (el comportamiento de antes)", () => {
  const e = estado([PASE]);
  assert.equal(esperaLlegada(PASE), false);
  assert.equal(cuenta(e, "proc_mercury"), 1100);
  assert.equal(cuenta(e, "proc_bofa"), 1900);
  /* Mercury contó 1.000 (el banco todavía no acreditó) y BofA 1.900 (ya salieron los 100): la app creía que los 100 estaban en Mercury. */
  assert.equal(esperadoDelArqueo(e, contado(1000, 1900)).diferencia, -100, "el total marcaba −100: la plata no estaba en ninguna cuenta");
  assert.equal(cuenta(e, "proc_mercury") - 1000, 100, "y la cuenta de Mercury marcaba 100 de menos");
});

test("dicho que todavía no llegó: Mercury no lo espera, BofA sí lo descontó y el total sigue dando", () => {
  const dicho = { ...PASE, todaviaNoLlego: true };
  const e = estado([dicho]);
  assert.equal(esperaLlegada(dicho), true);
  assert.equal(situacionDe(dicho, Date.parse(AL_8)), "en-camino");
  assert.equal(cuenta(e, "proc_mercury"), 1000, "Mercury no tiene los 100 todavía");
  assert.equal(cuenta(e, "proc_bofa"), 1900, "BofA ya los mandó");
  assert.equal(pasesPorCuenta(e, ANTERIOR.fecha, AL_8).get("proc_mercury"), undefined);
  assert.equal(enCamino(e, AL_8), 100);
  const x = esperadoDelArqueo(e, contado(1000, 1900));
  assert.equal(x.diferencia, 0);
  assert.equal(x.conciliacion?.sinExplicar, 0, "las cuentas suman lo mismo que el total: no queda nada sin explicar");
  assert.equal(x.mov?.enCamino, 100);
});

test("el arqueo siguiente cierra solo: cuando llega, Mercury suma los 100 y no marca un «sobra» que no es", () => {
  /* Aldana contó el 8/11 con los 100 en camino. */
  const dicho: Traspaso = { ...PASE, todaviaNoLlego: true };
  const arqueo8: Arqueo = { id: "a2", fecha: AL_8, total: 2900, saldos: contado(1000, 1900).saldos, esperado: 2900, diferencia: 0, creadoEn: AL_8 };
  /* El 15/11 Mercury muestra 1.100 (llegaron el 9/11) y BofA no se movió: lo confirmó al contar. */
  const llego = { ...dicho, ...cambioDeLlegada(dicho, false, arqueo8.fecha, AL_15) };
  const e = estado([llego], [ANTERIOR, arqueo8]);
  const x = esperadoDelArqueo(e, { fecha: AL_15, total: 3000, saldos: [
    { procesadorId: "proc_mercury", monto: 1100, moneda: "USD", montoBase: 1100 },
    { procesadorId: "proc_bofa", monto: 1900, moneda: "USD", montoBase: 1900 },
  ] });
  assert.equal(x.diferencia, 0, "el total da");
  assert.equal(x.cuentas.find((c) => c.procesador.id === "proc_mercury")?.esperado, 1100, "Mercury espera lo que contó + los 100 que llegaron en la ventana");
  assert.equal(x.cuentas.find((c) => c.procesador.id === "proc_bofa")?.esperado, 1900);
  assert.equal(x.conciliacion?.sinExplicar, 0);
  assert.equal(x.mov?.enCaminoAntes, 100, "estaba en camino al contar el 8/11");
  assert.equal(x.mov?.enCamino, 0);
});

test("el movimiento que ve un banco: la llegada con su día real lo deja en camino a los cortes anteriores a ese día", () => {
  const visto: Traspaso = { ...PASE, llegadaRef: "mercury:8b35", fechaLlega: "2026-11-09T23:01:21.000Z" };
  const e = estado([visto]);
  assert.equal(estabaEnCamino(visto, AL_8), true, "el 8/11 todavía no había llegado: llegó el 9/11 a las 20:01");
  assert.equal(estabaEnCamino(visto, AL_15), false);
  assert.equal(cuenta(e, "proc_mercury", AL_8), 1000, "el arqueo del 8/11 se explica solo");
  assert.equal(cuenta(e, "proc_mercury", AL_15), 1100);
  assert.equal(esperadoDelArqueo(e, contado(1000, 1900)).conciliacion?.sinExplicar, 0);
});

test("preguntas: lo que salió hace poco y ningún banco vio llegar; no lo viejo ni lo que un banco ya vio", () => {
  const viejo: Traspaso = { ...PASE, id: "t_viejo", fecha: "2026-11-02T15:00:00.000Z" };
  const visto: Traspaso = { ...PASE, id: "t_visto", fecha: "2026-11-07T15:00:00.000Z", llegadaRef: "mercury:x", salidaRef: "bofa:y" };
  const futuro: Traspaso = { ...PASE, id: "t_futuro", fecha: "2026-11-10T15:00:00.000Z" };
  const descartado: Traspaso = { ...PASE, id: "t_desc", estado: "ignorado" };
  const marcado: Traspaso = { ...PASE, id: "t_marcado", fecha: "2026-11-02T15:00:00.000Z", todaviaNoLlego: true };
  const lista = pasesParaPreguntar({ traspasos: [PASE, viejo, visto, futuro, descartado, marcado] }, ANTERIOR.fecha, AL_8).map((t) => t.id);
  assert.deepEqual(lista.sort(), ["t_100", "t_marcado"].sort(), "el del 5/11 y el que alguien dejó marcado; el del 2/11 es de hace más de 5 días");
});

test("preguntas: con `dias` ilimitado entra todo lo que salió desde el arqueo anterior (para buscar cuál explica lo que no da)", () => {
  const viejo: Traspaso = { ...PASE, id: "t_viejo", fecha: "2026-11-02T15:00:00.000Z" };
  const corte = "2026-11-12T02:59:59.999Z";
  assert.deepEqual(pasesParaPreguntar({ traspasos: [PASE, viejo] }, ANTERIOR.fecha, corte).map((t) => t.id), [], "hace más de 5 días: no se pregunta solo");
  assert.deepEqual(pasesParaPreguntar({ traspasos: [PASE, viejo] }, ANTERIOR.fecha, corte, Infinity).map((t) => t.id), ["t_100", "t_viejo"]);
});

test("preguntas: lo anterior al arqueo previo no se vuelve a preguntar, salvo lo que quedó marcado", () => {
  const antesDelPrevio: Traspaso = { ...PASE, id: "t_antes", fecha: "2026-10-30T15:00:00.000Z" };
  const marcado: Traspaso = { ...PASE, id: "t_marcado", fecha: "2026-10-30T15:00:00.000Z", todaviaNoLlego: true };
  const ids = pasesParaPreguntar({ traspasos: [antesDelPrevio, marcado] }, ANTERIOR.fecha, "2026-11-02T15:00:00.000Z").map((t) => t.id);
  assert.deepEqual(ids, ["t_marcado"]);
});

test("al confirmar una llegada, el día es el del arqueo sólo si salió antes del arqueo anterior", () => {
  const salioAntes: Traspaso = { ...PASE, fecha: "2026-10-30T15:00:00.000Z", todaviaNoLlego: true };
  assert.equal(cambioDeLlegada(salioAntes, false, ANTERIOR.fecha, AL_15).fechaLlega, AL_15);
  assert.equal(cambioDeLlegada(PASE, false, ANTERIOR.fecha, AL_15).fechaLlega, undefined, "salió después del anterior: cae en la misma ventana");
  const c = cambioDeLlegada(salioAntes, false, ANTERIOR.fecha, AL_15);
  assert.equal(c.todaviaNoLlego, false);
  assert.equal(c.llegadaRef, "a-mano");
  assert.deepEqual(cambioDeLlegada(PASE, true, ANTERIOR.fecha, AL_15), { todaviaNoLlego: true, fechaLlega: undefined });
  /* Una llegada dada por hecha a mano se desdice si ahora se dice que sigue en camino. */
  const aMano: Traspaso = { ...PASE, llegadaRef: "a-mano" };
  assert.equal("llegadaRef" in cambioDeLlegada(aMano, true, null, AL_8), true);
  assert.equal(cambioDeLlegada(aMano, true, null, AL_8).llegadaRef, undefined);
});

test("pasar de «ya llegó» a «en camino» y volver deja todo como estaba (lo que se guarda es sólo lo que se tocó)", () => {
  const e = estado([PASE]);
  const dicho = conLlegadasDichas(e.traspasos, new Map([["t_100", true]]), ANTERIOR.fecha, AL_8);
  assert.equal(cuenta({ ...e, traspasos: dicho }, "proc_mercury"), 1000);
  const igual = conLlegadasDichas(e.traspasos, new Map(), ANTERIOR.fecha, AL_8);
  assert.deepEqual(igual, e.traspasos);
});

test("la caja total no se mueve por lo que está en camino: el total espera lo que hay en las cuentas más lo que viaja", () => {
  const dicho = { ...PASE, todaviaNoLlego: true };
  const a = cajaEsperada(estado([PASE]), ANTERIOR, AL_8);
  const b = cajaEsperada(estado([dicho]), ANTERIOR, AL_8);
  assert.equal(a.esperado, b.esperado);
  assert.equal(a.enCuentas, 3000);
  assert.equal(b.enCuentas, 2900, "lo que contás en las cuentas: 100 no están en ninguna");
});

test("pistas: la cuenta que marca de menos justo lo de un pase reciente avisa que puede estar en camino", () => {
  const preguntas = [{ t: PASE, enCamino: false }, { t: { ...PASE, id: "t_otro", montoLlega: 40, montoSale: 40 }, enCamino: false }];
  const pistas = pistasDeLlegada([{ cuentaId: "proc_mercury", moneda: "USD", diferencia: -100 }, { cuentaId: "proc_bofa", moneda: "USD", diferencia: -100 }], preguntas);
  assert.deepEqual(pistas.map((p) => [p.traspasoId, p.sugiere, p.cuentaId]), [["t_100", "camino", "proc_mercury"]], "sólo la cuenta a la que llega");
  /* Si sobra justo lo que figura en camino, probablemente ya llegó. */
  const sobra = pistasDeLlegada([{ cuentaId: "proc_mercury", moneda: "USD", diferencia: 100 }], [{ t: PASE, enCamino: true }]);
  assert.deepEqual(sobra.map((p) => p.sugiere), ["llego"]);
  /* Dos pases juntos explican la suma; una diferencia que no es de nada, no explica nada. */
  const dos = pistasDeLlegada([{ cuentaId: "proc_mercury", moneda: "USD", diferencia: -140 }], preguntas);
  assert.equal(dos.length, 2);
  assert.deepEqual(pistasDeLlegada([{ cuentaId: "proc_mercury", moneda: "USD", diferencia: -77 }], preguntas), []);
  assert.deepEqual(pistasDeLlegada([{ cuentaId: "proc_mercury", moneda: "USD", diferencia: 0.3 }], preguntas), [], "debajo de la tolerancia no hay diferencia");
});

test("cuando una cuenta ve llegar lo que estaba en camino, se apaga la marca y se guarda el día real", () => {
  const dicho: Traspaso = { ...PASE, todaviaNoLlego: true };
  const punta: Punta = {
    lado: "llegada", cuentaId: "proc_mercury", otraCuentaId: "proc_bofa", monto: 100, moneda: "USD", fecha: "2026-11-09T23:01:21.000Z",
    ref: "mercury:8b35", contraparte: "Bank of America - Checking ••4", seguro: false,
  };
  const r = conciliarPuntas([dicho], [punta], "2026-11-10T12:00:00.000Z");
  assert.equal(r.nuevos.length, 0, "se ata al pase que ya estaba, no se crea otro");
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].cambios.llegadaRef, "mercury:8b35");
  assert.equal(r.cambios[0].cambios.todaviaNoLlego, false);
  assert.equal(r.cambios[0].cambios.fechaLlega, "2026-11-09T23:01:21.000Z");
  const despues = { ...dicho, ...r.cambios[0].cambios };
  assert.equal(esperaLlegada(despues), false);
  assert.equal(situacionDe(despues), "detectado", "la cuenta de destino lo vio llegar; la de origen (BofA) no avisa");
});

test("Mercury reconoce a Bank of America como cuenta propia (sólo mirando a Mercury), propuesto y no seguro", () => {
  assert.deepEqual(cuentaDeContraparteEnMercury("Bank of America - Checking ••4210"), { cuentaId: "proc_bofa", seguro: false });
  assert.deepEqual(cuentaDeContraparteEnMercury("Stripe"), { cuentaId: "proc_stripe", seguro: true }, "lo que ya reconocía sigue igual");
  assert.equal(cuentaDeContraparteEnMercury("Juan Pérez"), null);
  /* Dentro del extracto del propio banco el nombre está en cualquier línea: ahí no cuenta (gastos-bofa.ts). */
  assert.equal(cuentaDeContraparte("BANK OF AMERICA SERVICE CHARGE"), null);
  const t = { id: "8b35", amount: 100, status: "sent", kind: "externalTransfer", counterpartyName: "Bank of America - Checking ••4210", postedAt: "2026-11-09T23:01:21Z" };
  assert.equal(clasificarMercury(t).tipo, "pase");
  const punta = puntaDeMercury(t);
  assert.equal(punta?.lado, "llegada");
  assert.equal(punta?.otraCuentaId, "proc_bofa");
  assert.equal(punta?.seguro, false, "un cliente que paga desde su cuenta del mismo banco figuraría igual: se confirma a mano");
});

test("Stripe dice qué día llega cada retiro al banco: hasta ese día está en camino", () => {
  const p = puntaDeRetiroStripe({ id: "po_1", status: "in_transit", amount: 37580, currency: "usd", created: Date.parse("2026-11-02T00:40:51Z") / 1000, arrival_date: Date.parse("2026-11-04T00:00:00Z") / 1000 });
  assert.equal(p?.llegaEl, "2026-11-04T15:00:00.000Z");
  const r = conciliarPuntas([], [p!], "2026-11-02T01:00:00.000Z", [{ id: "proc_bofa" }]);
  const t = r.nuevos[0];
  assert.equal(t.destinoId, "proc_bofa", "los retiros de Stripe van al Bank of America");
  assert.equal(t.fechaLlega, "2026-11-04T15:00:00.000Z");
  /* El 3/11 a la noche todavía estaba en camino; el 4/11 a la noche ya llegó: BofA lo espera recién entonces. */
  const e = estado([t]);
  assert.equal(saldosEsperados(e, ANTERIOR, "2026-11-04T02:59:59.999Z").get("proc_bofa")!.esperado, 2000 + 0, "al corte del 3/11 no llegó");
  assert.equal(saldosEsperados(e, ANTERIOR, "2026-11-05T02:59:59.999Z").get("proc_bofa")!.esperado, 2375.8, "al corte del 4/11 ya llegó");
  /* Un retiro instantáneo (llega el mismo día) y uno sin el dato no cambian nada. */
  assert.equal(puntaDeRetiroStripe({ id: "po_2", status: "paid", amount: 1000, currency: "usd", created: 1762300800, arrival_date: 1762300800 })?.llegaEl, "2025-11-05T15:00:00.000Z");
  const mismoDia = conciliarPuntas([], [puntaDeRetiroStripe({ id: "po_2", status: "paid", amount: 1000, currency: "usd", created: 1762300800, arrival_date: 1762300800 })!], "2026-11-02T01:00:00.000Z", [{ id: "proc_bofa" }]);
  assert.equal(mismoDia.nuevos[0].fechaLlega, undefined);
  assert.equal(puntaDeRetiroStripe({ id: "po_3", status: "paid", amount: 1000, currency: "usd", created: 1762300800 })?.llegaEl, undefined);
});
