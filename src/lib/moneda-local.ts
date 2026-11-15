import { num } from "./format";
import type { EstadoApp, Pago, Procesador } from "./types";

/* ==================================================================
   Lo que pagó la persona en SU moneda, en los cobros de dLocal.

   Aldana (13/11): «sigo con el problema de que no me ponen el valor de
   conversión en dLocal ni el monto real pagado por la persona, y sin eso no
   puedo pasar los comprobantes a Financiera». dLocal le cobra al cliente en
   la moneda de su país (pesos argentinos, mexicanos, colombianos, soles…) un
   link armado en dólares, y lo de dLocal se rinde a la Financiera con los
   dos números: cuánto pagó en su moneda y a qué cambio.

   La app sólo pedía el cambio en las cuentas en pesos (la Financiera ARS):
   dLocal está en dólares, así que nunca preguntaba nada. Ahora todo cobro de
   dLocal sin conciliar lleva la moneda, el monto que pagó en esa moneda (el
   del comprobante) y el tipo de cambio, que sale solo de los dos montos
   (unidades de su moneda por dólar). Sin eso no se guarda. Los que ya
   estaban cargados sin eso se completan desde la venta o desde el chequeo.

   Los pesos argentinos también quedan en `montoArs`, como siempre estuvieron
   los cobros de dLocal en la planilla (la columna «Monto ARS»).
   ================================================================== */

export interface MonedaLocal { codigo: string; nombre: string; pais: string }

/* Los países donde se cobra por dLocal. El primero es el que se propone si
   no se sabe de dónde es la persona. */
export const MONEDAS_LOCALES: readonly MonedaLocal[] = [
  { codigo: "ARS", nombre: "Pesos argentinos", pais: "Argentina" },
  { codigo: "MXN", nombre: "Pesos mexicanos", pais: "México" },
  { codigo: "COP", nombre: "Pesos colombianos", pais: "Colombia" },
  { codigo: "PEN", nombre: "Soles peruanos", pais: "Perú" },
  { codigo: "CLP", nombre: "Pesos chilenos", pais: "Chile" },
  { codigo: "UYU", nombre: "Pesos uruguayos", pais: "Uruguay" },
  { codigo: "BRL", nombre: "Reales", pais: "Brasil" },
  { codigo: "USD", nombre: "Dólares", pais: "Ecuador, Panamá…" },
];

const PREFIJOS: [string, string][] = [
  ["598", "UYU"], ["593", "USD"], ["507", "USD"], ["503", "USD"],
  ["57", "COP"], ["56", "CLP"], ["55", "BRL"], ["54", "ARS"], ["52", "MXN"], ["51", "PEN"],
];

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const PAISES: Record<string, string> = {
  argentina: "ARS", mexico: "MXN", colombia: "COP", peru: "PEN", chile: "CLP", uruguay: "UYU", brasil: "BRL", brazil: "BRL",
  ecuador: "USD", panama: "USD", "el salvador": "USD",
};

/** ¿Esta cuenta cobra en la moneda del cliente y pide lo que pagó en ella? Hoy, dLocal. */
export const pideMonedaLocal = (proc?: { proveedor?: Procesador["proveedor"]; nombre?: string } | null): boolean =>
  Boolean(proc && (proc.proveedor === "dlocal" || /\bd\s*local\b/i.test(proc.nombre ?? "")));

/** La moneda que se propone para una persona: la de su país o la del prefijo de su teléfono. Sin saberlo, pesos argentinos. */
export function monedaPropuesta(persona?: { pais?: string | null; telefono?: string | null } | null): string {
  const pais = PAISES[sinTildes(persona?.pais ?? "")];
  if (pais) return pais;
  const t = (persona?.telefono ?? "").trim();
  if (/^(\+|00)/.test(t)) {
    const n = t.replace(/^00/, "").replace(/\D/g, "");
    const p = PREFIJOS.find(([pre]) => n.startsWith(pre));
    if (p) return p[1];
  }
  return MONEDAS_LOCALES[0].codigo;
}

export const nombreDeMoneda = (codigo?: string) => MONEDAS_LOCALES.find((m) => m.codigo === codigo)?.nombre ?? codigo ?? "";

/** «MXN 18.500», «ARS 1.033.902,50»: con el código adelante, porque un «$» solo no dice de qué país. */
export const enMoneda = (n: number, codigo: string, decimales = 2) =>
  `${codigo} ${num(n, Number.isInteger(n) ? 0 : decimales)}`;

/** «1.618 ARS por dólar». */
export const textoDeCambio = (tc: number, codigo: string) => `${tc.toLocaleString("es-AR", { maximumFractionDigits: 4 })} ${codigo} por dólar`;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** El tipo de cambio que resulta: cuántas unidades de su moneda pagó por cada dólar. */
export function cambioQueResulta(montoLocal?: number, montoUsd?: number): number | undefined {
  if (!(montoLocal && montoLocal > 0) || !(montoUsd && montoUsd > 0)) return undefined;
  return r4(montoLocal / montoUsd);
}

/** Lo que se guarda en el cobro con la moneda y el monto en esa moneda. Los pesos argentinos también van en `montoArs`. */
export function camposDeMonedaLocal(moneda: string, montoLocal: number, montoUsd: number):
  { monedaLocal: string; montoLocal: number; tipoCambio: number; montoArs?: number } | null {
  const tc = cambioQueResulta(montoLocal, montoUsd);
  if (!moneda || !tc) return null;
  return { monedaLocal: moneda, montoLocal: r2(montoLocal), tipoCambio: tc, ...(moneda === "ARS" ? { montoArs: r2(montoLocal) } : {}) };
}

export interface LoQuePagoEnSuMoneda { moneda: string; monto: number; tipoCambio: number }

/** Lo que pagó en su moneda, si está. Los cobros de antes con los pesos y el cambio cargados (la planilla) cuentan como pesos argentinos. */
export function enSuMoneda(p: Pick<Pago, "monedaLocal" | "montoLocal" | "montoArs" | "tipoCambio">): LoQuePagoEnSuMoneda | null {
  if (p.monedaLocal && p.montoLocal && p.montoLocal > 0 && p.tipoCambio && p.tipoCambio > 0) {
    return { moneda: p.monedaLocal, monto: p.montoLocal, tipoCambio: p.tipoCambio };
  }
  if (p.montoArs && p.montoArs > 0 && p.tipoCambio && p.tipoCambio > 0) return { moneda: "ARS", monto: p.montoArs, tipoCambio: p.tipoCambio };
  return null;
}

/** ¿A este cobro le falta lo que pagó en su moneda? Sí si es de una cuenta que lo pide, no está atado a un pago de la pasarela (ese trae lo suyo) y no lo tiene. */
export function faltaMonedaLocal(
  procesadores: readonly (Pick<Procesador, "id" | "proveedor"> & { nombre?: string })[],
  p: Pick<Pago, "procesadorId" | "movimientoId" | "monedaLocal" | "montoLocal" | "montoArs" | "tipoCambio">,
): boolean {
  if (p.movimientoId) return false;
  const proc = procesadores.find((x) => x.id === p.procesadorId);
  return pideMonedaLocal(proc) && !enSuMoneda(p);
}

/* Desde cuándo se avisa de los que faltan: los de la planilla vieja ya se rindieron a mano. */
export const AVISAR_DESDE = "2026-10-01";

/** Los cobros (desde `AVISAR_DESDE`) a los que les falta lo que pagó en su moneda, los más nuevos primero. Con `cargadoPor`, sólo los que cargó esa persona. */
export function cobrosSinMonedaLocal(
  e: Pick<EstadoApp, "pagos" | "procesadores">, opciones: { cargadoPor?: string | null; desde?: string } = {},
): Pago[] {
  const desde = opciones.desde ?? AVISAR_DESDE;
  const quien = opciones.cargadoPor?.toLowerCase();
  return e.pagos
    .filter((p) => p.fecha.slice(0, 10) >= desde && faltaMonedaLocal(e.procesadores, p)
      && (!quien || (p.cargadoPor ?? "").toLowerCase() === quien))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export const textoDeMonedaLocalQueFalta = (nombre: string) =>
  `Escribí cuánto pagó la persona por dLocal en su moneda (${nombre}), como dice el comprobante: con eso sale el tipo de cambio que necesita la Financiera`;
