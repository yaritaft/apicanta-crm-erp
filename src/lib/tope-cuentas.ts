import type { EstadoApp, ID, Moneda } from "./types";
import { saldosPorCuenta, type OrigenDelSaldo } from "./saldos-vista";

/* ==================================================================
   El tope de la Financiera (Aldana, 19/11): «a partir de ahora vamos a hacer un retiro de toda la plata que esté en Financiera, va a quedar
   solo un resto. La idea es que nunca haya más de 50.000 dólares en total entre Financiera ARS, Financiera USD y dLocal; que se me marque en
   rojo o me llegue una notificación cuando eso esté excediendo el máximo, así lo tengo en cuenta para avisar y hacer un retiro».

   Nada se inventa: cada cuenta vale lo mismo que en la pantalla de Saldos (lo que la app espera que haya desde el último arqueo, con los pesos
   al tipo de cambio de Ajustes). Ninguna de estas tres se lee sola del banco, así que no hace falta red. Sin React: la usan la pantalla, el
   aviso de la campanita y las pruebas.
   ================================================================== */

export const TOPE_DE_FINANCIERA: { limite: number; cuentaIds: readonly ID[] } = {
  limite: 50_000,
  cuentaIds: ["proc_financiera_ars", "proc_financiera_usd", "proc_dlocal"],
};

/* Desde qué parte del tope se avisa que se acerca (en ámbar), antes de pasarse. */
export const AVISAR_DESDE = 0.9;

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CuentaDelTope {
  cuentaId: ID;
  nombre: string;
  moneda: Moneda;
  origen: OrigenDelSaldo;
  /* En la moneda base. Falta si es una cuenta en pesos y no hay tipo de cambio, o si no hay dato. */
  saldoBase?: number;
}

export interface EstadoDelTope {
  base: Moneda;
  limite: number;
  /* Lo que suman las cuentas del tope, en la moneda base. */
  total: number;
  /* Cuánto se pasa del tope (0 si no se pasa) y cuánto falta para llegar. */
  exceso: number;
  falta: number;
  /* total / límite, de 0 en adelante. */
  proporcion: number;
  excede: boolean;
  /* Se acerca (desde el 90%) sin haberse pasado. */
  seAcerca: boolean;
  cuentas: CuentaDelTope[];
  /* No se puede afirmar nada: una cuenta en pesos sin tipo de cambio, o ninguna cuenta con dato. */
  faltaCambio: boolean;
  /* Cuentas que no tienen de dónde partir (no estaban en el último arqueo): sólo cuentan lo que se movió desde entonces. */
  parciales: string[];
}

/** Cuánto hay entre las cuentas del tope en `ahoraIso` y si pasa el límite. */
export function topeDeCuentas(e: EstadoApp, ahoraIso: string, tope = TOPE_DE_FINANCIERA): EstadoDelTope {
  const vista = saldosPorCuenta(e, [], ahoraIso);
  const todas = [...vista.cuentas, ...vista.aparte, ...vista.sinCambio];
  const cuentas: CuentaDelTope[] = [];
  for (const id of tope.cuentaIds) {
    const c = todas.find((x) => x.cuentaId === id);
    if (c) { cuentas.push({ cuentaId: id, nombre: c.nombre, moneda: c.moneda, origen: c.origen, saldoBase: c.saldoBase }); continue; }
    /* Una cuenta que no está (borrada o inactiva sin movimientos): no suma, y se nombra si existe. */
    const p = e.procesadores.find((x) => x.id === id);
    if (p) cuentas.push({ cuentaId: id, nombre: p.nombre, moneda: p.moneda ?? "USD", origen: "sin-dato" });
  }
  const total = r2(cuentas.reduce((a, c) => a + (c.saldoBase ?? 0), 0));
  const faltaCambio = vista.sinCambio.some((c) => tope.cuentaIds.includes(c.cuentaId));
  const excede = total > tope.limite && !faltaCambio;
  return {
    base: vista.base, limite: tope.limite, total,
    exceso: excede ? r2(total - tope.limite) : 0,
    falta: r2(Math.max(tope.limite - total, 0)),
    proporcion: tope.limite > 0 ? total / tope.limite : 0,
    excede,
    seAcerca: !excede && !faltaCambio && tope.limite > 0 && total >= tope.limite * AVISAR_DESDE,
    cuentas, faltaCambio,
    parciales: cuentas.filter((c) => c.origen === "parcial").map((c) => c.nombre),
  };
}
