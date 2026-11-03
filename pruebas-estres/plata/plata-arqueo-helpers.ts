import { azar, art, clonar, gasto, mundo, r2, type Azar } from "./plata-mundo";
import { esperadoDelArqueo } from "@/lib/arqueo";
import { aMonedaBase } from "@/lib/gastos";
import type { Arqueo, EstadoApp, Gasto, SaldoCuenta, Traspaso } from "@/lib/types";

export const CUENTAS_USD = ["proc_stripe", "proc_hotmart", "proc_mercury"];

/** Pases al azar entre las cuentas del mundo: en la misma moneda (algunos con costo, como gasto con su traspasoId), entre pesos y dólares y
 *  algunos que llegan días después. */
export function conPases(e: EstadoApp, r: Azar, meses: readonly string[]): EstadoApp {
  const ids = e.procesadores.map((p) => p.id);
  const moneda = (id: string) => e.procesadores.find((p) => p.id === id)!.moneda ?? "USD";
  const traspasos: Traspaso[] = [];
  const gastos: Gasto[] = [...e.gastos];
  const n = r.entre(0, 8);
  for (let i = 0; i < n; i++) {
    const origenId = r.elige(ids);
    const destinoId = r.elige(ids.filter((x) => x !== origenId));
    const [a, m] = r.elige(meses).split("-").map(Number);
    const fecha = art(a, m, r.entre(1, 28), r.entre(0, 23), r.entre(0, 59));
    const tarde = r.si(0.25) ? new Date(Date.parse(fecha) + 86400000 * r.entre(1, 4)).toISOString() : undefined;
    const ms = moneda(origenId), ml = moneda(destinoId);
    const sale = r.plata(50, 4000);
    let llega = sale;
    if (ms !== ml) llega = ms === "ARS" ? r2(sale / 1500) : r2(sale * 1500);
    const costo = ms === ml && r.si(0.3) ? r.plata(1, 25) : 0;
    llega = r2(llega - costo);
    const id = `t${i}`;
    traspasos.push({
      id, fecha, origenId, destinoId, montoSale: ms === "ARS" ? r2(sale * 1500) : sale, monedaSale: ms,
      montoLlega: ms === "ARS" && ml === "ARS" ? r2(llega * 1500) : llega, monedaLlega: ml,
      ...(tarde ? { fechaLlega: tarde } : {}), estado: "confirmado", origen: "manual", creadoEn: fecha,
      ...(costo ? { gastoId: `gas_${id}` } : {}),
    } as Traspaso);
    if (costo) gastos.push(gasto({ id: `gas_${id}`, categoria: "Comisiones bancarias", monto: ms === "ARS" ? r2(costo) : costo, fecha, extra: { traspasoId: id } }));
  }
  return { ...e, traspasos, gastos };
}

/** Pagos al equipo cargados desde una cuenta, algunos marcados como pago de equipo. */
export function conPagosAlEquipo(e: EstadoApp, r: Azar, meses: readonly string[]): EstadoApp {
  const gastos = [...e.gastos];
  const n = r.entre(0, 6);
  for (let i = 0; i < n; i++) {
    const [a, m] = r.elige(meses).split("-").map(Number);
    const fecha = art(a, m, r.entre(1, 28), 15);
    gastos.push(gasto({
      id: `pe${i}`, categoria: r.elige(["Equipo / Salarios", "Comisiones closers"]), concepto: r.elige(["Closer Uno", "Gerencia", "Director Uno"]), monto: r.plata(100, 3000), fecha,
      extra: { ...(r.si(0.8) ? { cuentaId: r.elige(CUENTAS_USD) } : {}), ...(r.si(0.7) ? { pagoDeEquipo: true } : {}) },
    }));
  }
  return { ...e, gastos };
}

/** Lo que apareció en los datos reales (03/11): cobros a la cuenta en pesos anotados sin su cambio (US$ 65 a la Financiera ARS) y gastos cargados
 *  en dólares que salieron de la cuenta en pesos (el pago a ARCA). */
export function conRarezasDeLosDatos(e: EstadoApp, r: Azar, meses: readonly string[]): EstadoApp {
  const pesos = e.procesadores.find((p) => p.moneda === "ARS");
  if (!pesos) return e;
  const pagos = e.pagos.map((p) => {
    if (p.procesadorId !== pesos.id || !r.si(0.25)) return p;
    const { tipoCambio: _t, montoArs: _m, ...resto } = p;
    return resto as typeof p;
  });
  const gastos = [...e.gastos];
  for (let i = 0; i < r.entre(0, 3); i++) {
    const [a, m] = r.elige(meses).split("-").map(Number);
    gastos.push(gasto({ id: `ars_usd_${i}`, categoria: "Honorarios del CEO", grupo: "dueno", monto: r.plata(20, 4000), fecha: art(a, m, r.entre(1, 28), 15), extra: { cuenta: pesos.nombre } }));
  }
  return { ...e, pagos, gastos };
}

/** Un arqueo de partida en `fecha`: algunas cuentas contadas (con lo que sea), otras no (se cuentan por primera vez después). */
export function arqueoDePartida(e: EstadoApp, r: Azar, fecha: string, tc: number): Arqueo {
  const saldos: SaldoCuenta[] = [];
  for (const p of e.procesadores) {
    if (r.si(0.2)) continue;
    const moneda = p.moneda ?? "USD";
    const monto = moneda === "ARS" ? r2(r.plata(0, 5000) * tc) : r.plata(0, 20000);
    saldos.push({ procesadorId: p.id, monto, moneda, montoBase: r2(aMonedaBase(monto, moneda, "USD", tc)) });
  }
  return { id: "a0", fecha, saldos, total: r2(saldos.reduce((s, x) => s + x.montoBase, 0)), tipoCambio: tc, esperado: null, diferencia: null, creadoEn: fecha };
}

/** Cuenta en cada cuenta lo que la app dice que tendría que haber (las que no estaban en el anterior, con lo que sea) y guarda el arqueo con su esperado. */
export function contarJusto(e: EstadoApp, r: Azar, previo: Arqueo, fecha: string, tc: number, id: string): { a: Arqueo; x: ReturnType<typeof esperadoDelArqueo> } {
  const borrador = esperadoDelArqueo(e, { fecha, saldos: [], total: 0, tipoCambio: tc }, { previo });
  const saldos: SaldoCuenta[] = borrador.cuentas.map((c) => {
    const monto = c.esperado ?? (c.moneda === "ARS" ? r2(r.plata(0, 3000) * tc) : r.plata(0, 9000));
    return { procesadorId: c.procesador.id, monto, moneda: c.moneda, montoBase: r2(aMonedaBase(monto, c.moneda, "USD", tc)) };
  });
  const total = r2(saldos.reduce((s, x) => s + x.montoBase, 0));
  const x = esperadoDelArqueo(e, { fecha, saldos, total, tipoCambio: tc }, { previo });
  return { a: { id, fecha, saldos, total, tipoCambio: tc, esperado: x.esperado, diferencia: x.diferencia, creadoEn: fecha }, x };
}

export const instantes = (r: Azar, meses: readonly string[]) => {
  const t = [0, 1, 2].map(() => { const [a, m] = r.elige(meses).split("-").map(Number); return art(a, m, r.entre(1, 28), r.entre(0, 23), r.entre(0, 59)); });
  return t.sort();
};

export function mundoCompleto(semilla: number, pesos: boolean) {
  const r = azar(semilla * 104729);
  const { e: e0, meses } = mundo(semilla, { pesos, devoluciones: 6, gastos: 14, esquemas: true, bordes: 0.3 });
  /* El cambio de Ajustes es el del mundo: lo que se cobró en pesos se anotó a ese cambio. */
  const e1 = conRarezasDeLosDatos(conPagosAlEquipo(conPases(e0, r, meses), r, meses), r, meses);
  const tc = 1500;
  return { e: { ...e1, ajustes: { ...e1.ajustes, tipoCambio: tc } } as EstadoApp, r, meses, tc };
}

