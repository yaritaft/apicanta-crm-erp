import type { EstadoApp, ID, Moneda } from "./types";
import { cajaEsperada, cobrosSinVentaPorCuenta, enOtros, ultimoArqueo } from "./caja";
import { aMonedaBase } from "./gastos";
import { controlarSaldos, type FilaDeControl, type SaldoReal } from "./saldos-reales";
import { gastosSinCuenta, saldosEsperados } from "./traspasos";

/* ==================================================================
   Saldos: cuánta plata hay en cada cuenta y cuánta entró y salió.

   Juan Cruz a Aldana (01/11): «voy a construir una que sea saldo, cosa de que podamos ver fácil cuánta plata hay en cada plataforma». Nada
   se inventa acá: cada número sale de lo que ya calculan el Control de saldos y el arqueo.

     · Las cuentas que se leen solas (USDT Trust, Mercury, Stripe): el saldo REAL, el mismo de la tabla «Control de saldos»
       (`controlarSaldos`), con su lectura (da / no da).
     · Las demás: lo que la app espera que haya, partiendo del último arqueo: la columna «Tendría que haber» del arqueo
       (`saldosEsperados` más los cobros que ya entraron a la cuenta y todavía no tienen su venta).
     · Una cuenta que no estaba en el último arqueo no tiene de dónde partir: se muestra lo que se movió desde entonces («parcial») y se
       dice que falta contarla. Si no se movió nada, «sin dato».

   Las cuentas en pesos se pasan a la moneda base con el tipo de cambio de Ajustes; si falta, la cuenta se muestra en pesos, no entra en el
   total y se avisa. Sin React ni red: las mismas reglas las usan la pantalla y las pruebas.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type OrigenDelSaldo = "real" | "esperado" | "parcial" | "sin-dato";

export interface SaldoDeCuenta {
  cuentaId: ID;
  nombre: string;
  /* La moneda de la cuenta. */
  moneda: Moneda;
  origen: OrigenDelSaldo;
  /* En la moneda de la cuenta. Sin dato: no hay. */
  saldo?: number;
  /* En la moneda base. Falta si es una cuenta en pesos y no hay tipo de cambio, o si no hay dato. */
  saldoBase?: number;
  sinCambio?: boolean;
  /* Sólo si se lee solo: la misma fila que muestra el Control de saldos. */
  control?: FilaDeControl;
  /* Sólo si no se lee: de dónde parte (el último arqueo) y qué se movió desde entonces, en la moneda de la cuenta. */
  partida?: number;
  entro?: number;
  pases?: number;
  salio?: number;
  /* Cobros que ya entraron a la cuenta y todavía no tienen su venta: están en el saldo esperado. */
  sinVenta?: number;
}

/* Lo que explica que las cuentas no sumen lo mismo que la Caja esperada. */
export interface ContraLaCaja {
  /* Lo que la Caja espera que haya en las cuentas (la esperada menos lo que viaja entre cuentas). */
  cajaEnCuentas: number;
  /* Lo que suman las cuentas de esta pantalla. */
  sumaDeCuentas: number;
  /* Las cuentas menos la Caja: positivo, las cuentas tienen más. */
  diferencia: number;
  /* Gastos pagados que no dicen de qué cuenta salieron: la Caja los descuenta, ninguna cuenta. */
  sinCuenta: number;
  /* Cobros que ya están en las cuentas y todavía no tienen su venta: la Caja no los cuenta como cobrados. */
  sinVenta: number;
  /* Lo que los bancos que se leen solos marcan de más (o de menos) contra lo que la app esperaba: la misma diferencia del Control de saldos. */
  bancosMarcan: number;
  /* Lo que queda sin explicar con lo anterior (tipo de cambio, redondeos). */
  resto: number;
}

export interface VistaDeSaldos {
  base: Moneda;
  tipoCambio: number;
  /* Las que se dibujan, de la que más tiene a la que menos; al final las que no tienen dato. */
  cuentas: SaldoDeCuenta[];
  /* Cuentas de «Otros» (Galicia, Mercado Pago...) sin saldo: sólo se nombran. */
  aparte: SaldoDeCuenta[];
  /* La suma de lo que tiene cada cuenta, en la moneda base. */
  total: number;
  porOrigen: { real: number; esperado: number; parcial: number };
  /* Cuentas en pesos que no entran en el total porque falta el tipo de cambio. */
  sinCambio: SaldoDeCuenta[];
  /* El arqueo del que parte lo esperado. */
  desde?: string;
  contraLaCaja?: ContraLaCaja;
}

/** Cuánto hay en cada cuenta en `ahoraIso`: el saldo real de las que se leen solas y, de las demás, lo que la app espera. */
export function saldosPorCuenta(e: EstadoApp, reales: readonly SaldoReal[], ahoraIso: string): VistaDeSaldos {
  const base = e.ajustes.monedaBase;
  const tipoCambio = e.ajustes.tipoCambio;
  const previo = ultimoArqueo(e, ahoraIso);
  const esperados = saldosEsperados(e, previo, ahoraIso);
  const control = controlarSaldos(e, reales, ahoraIso);
  const sinVenta = cobrosSinVentaPorCuenta(e, previo?.fecha ?? null, ahoraIso, tipoCambio);

  const aBase = (monto: number, moneda: Moneda): { saldoBase?: number; sinCambio?: boolean } =>
    moneda !== base && !(tipoCambio > 0) ? { sinCambio: true } : { saldoBase: r2(aMonedaBase(monto, moneda, base, tipoCambio)) };

  const todas: SaldoDeCuenta[] = [];

  /* Las que se leen solas, aunque no estén cargadas como cuenta. */
  for (const fila of control.filas) {
    todas.push({ cuentaId: fila.cuentaId, nombre: fila.nombre, moneda: fila.moneda, origen: "real", saldo: fila.real, ...aBase(fila.real, fila.moneda), control: fila });
  }
  const leidas = new Set(control.filas.map((f) => f.cuentaId));

  for (const p of e.procesadores) {
    if (leidas.has(p.id)) continue;
    const s = esperados.get(p.id);
    /* La misma lista que el arqueo: las activas, las que se movieron y las que ya estaban en el último arqueo. */
    const seMovio = Boolean(s && (s.entro || s.pases || s.salio));
    if (!(p.activo || seMovio || previo?.saldos.some((x) => x.procesadorId === p.id))) continue;
    const moneda: Moneda = p.moneda ?? "USD";
    /* Los cobros sin venta ya están en la cuenta; en pesos no se pueden pasar (el arqueo tampoco los suma). */
    const conVenta = moneda === "ARS" ? 0 : (sinVenta.get(p.id)?.monto ?? 0);
    if (s?.esperado !== undefined) {
      const saldo = r2(s.esperado + conVenta);
      todas.push({ cuentaId: p.id, nombre: p.nombre, moneda, origen: "esperado", saldo, ...aBase(saldo, moneda), partida: s.anterior, entro: s.entro, pases: s.pases, salio: s.salio, ...(conVenta ? { sinVenta: conVenta } : {}) });
    } else if (previo && s && (seMovio || conVenta)) {
      /* Sin saldo de partida: sólo se sabe lo que se movió desde el último arqueo. */
      const saldo = r2(s.entro + s.pases - s.salio + conVenta);
      todas.push({ cuentaId: p.id, nombre: p.nombre, moneda, origen: "parcial", saldo, ...aBase(saldo, moneda), entro: s.entro, pases: s.pases, salio: s.salio, ...(conVenta ? { sinVenta: conVenta } : {}) });
    } else {
      todas.push({ cuentaId: p.id, nombre: p.nombre, moneda, origen: "sin-dato" });
    }
  }

  const otros = (c: SaldoDeCuenta) => enOtros({ nombre: c.nombre, cajaOtros: e.procesadores.find((p) => p.id === c.cuentaId)?.cajaOtros });
  /* Las cuentas de «Otros» sólo se dibujan si tienen plata. */
  const aparte = todas.filter((c) => otros(c) && !c.saldo);
  const cuentas = todas.filter((c) => !aparte.includes(c)).sort((a, b) => (b.saldoBase ?? -Infinity) - (a.saldoBase ?? -Infinity));

  let total = 0;
  const porOrigen = { real: 0, esperado: 0, parcial: 0 };
  for (const c of todas) {
    if (c.saldoBase === undefined || c.origen === "sin-dato") continue;
    total += c.saldoBase;
    porOrigen[c.origen] += c.saldoBase;
  }
  total = r2(total);
  porOrigen.real = r2(porOrigen.real); porOrigen.esperado = r2(porOrigen.esperado); porOrigen.parcial = r2(porOrigen.parcial);

  let contraLaCaja: ContraLaCaja | undefined;
  if (previo) {
    const mov = cajaEsperada(e, previo, ahoraIso);
    const sinCuenta = gastosSinCuenta(e, previo.fecha, ahoraIso).total;
    const conVenta = r2(todas.reduce((a, c) => a + (c.origen === "real" ? 0 : (c.sinVenta ?? 0)), 0));
    const bancosMarcan = r2(control.filas.reduce((a, f) => a + (f.diferencia !== undefined ? aBase(f.diferencia, f.moneda).saldoBase ?? 0 : 0), 0));
    const diferencia = r2(total - mov.enCuentas);
    contraLaCaja = {
      cajaEnCuentas: mov.enCuentas, sumaDeCuentas: total, diferencia,
      sinCuenta, sinVenta: conVenta, bancosMarcan,
      resto: r2(diferencia - sinCuenta - conVenta - bancosMarcan),
    };
  }

  return { base, tipoCambio, cuentas, aparte, total, porOrigen, sinCambio: todas.filter((c) => c.sinCambio), desde: previo?.fecha, contraLaCaja };
}

/* ---------- Entró y salió ---------- */

export interface ParteDelFlujo { id: "devoluciones" | "procesador" | "equipo" | "gastos" | "retiros"; nombre: string; monto: number; ayuda?: string }

export interface FlujoDeCaja {
  desde: string;
  hasta: string;
  /* Lo cobrado (lo que entró por las cuentas). */
  entro: number;
  /* Todo lo que salió: devoluciones, procesadores, pagos al equipo, gastos y retiros. */
  salio: number;
  neto: number;
  partes: ParteDelFlujo[];
}

/** Lo que entró y salió entre dos instantes, con la cuenta de la Caja (`cajaEsperada`): los mismos números que «Qué pasó con la plata»,
    para el período que se pida en vez de desde el último arqueo. */
export function flujoDelPeriodo(e: EstadoApp, desde: Date, hasta: Date): FlujoDeCaja {
  /* `cajaEsperada` cuenta desde un milisegundo después de la fecha que se le da: un milisegundo antes, el primer instante del período entra. */
  const m = cajaEsperada(e, { fecha: new Date(desde.getTime() - 1).toISOString(), total: 0 }, hasta.toISOString());
  const partes: ParteDelFlujo[] = [
    { id: "gastos", nombre: "Gastos pagados", monto: m.gastos, ayuda: "Directos, operativos y honorarios del CEO, el día que se pagaron" },
    { id: "equipo", nombre: "Pagos al equipo", monto: m.equipo, ayuda: "Sueldos y comisiones, el día que salieron de la cuenta" },
    { id: "procesador", nombre: "Procesadores", monto: m.procesador },
    { id: "devoluciones", nombre: "Devoluciones a clientes", monto: m.devoluciones, ayuda: "La plata devuelta; la comisión de la pasarela no vuelve" },
    { id: "retiros", nombre: "Retiros del dueño", monto: m.retiros },
  ];
  const salio = r2(partes.reduce((a, p) => a + p.monto, 0));
  return { desde: desde.toISOString(), hasta: hasta.toISOString(), entro: m.cobrado, salio, neto: r2(m.cobrado - salio), partes };
}
