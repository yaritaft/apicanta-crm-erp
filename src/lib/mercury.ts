import type { Movimiento } from "./types";
import { cuentaDeContraparte } from "./traspasos";

/* ==================================================================
   Reglas de Mercury: qué es cada movimiento del banco.

   Angelo ([16:32] de la reunión del 02/10): Mercury trae muchos movimientos
   que no son ni ingreso ni gasto (el pago diario de la tarjeta de crédito,
   las subcuentas, de checking a tarjeta), y los *pending* tardan 24 a 48 h en
   asentarse y pueden cambiar la fecha (un gasto que aparece el 30/09 y se
   concilia el 02/10). Yari: «le implementamos reglas al sistema para que esas
   cosas queden bien».

   Cada movimiento cae en UNA de estas cosas:
   - anulado: falló, se canceló, se revirtió o se bloqueó. No es plata. Si ya
     había entrado como cobro sin conciliar, se descarta solo.
   - interno: tarjeta de crédito, subcuentas, Treasury, entre cuentas del mismo
     Mercury. Ni ingreso ni gasto, y tampoco un pase entre cuentas.
   - pase: una cuenta propia del otro lado (Stripe, Hotmart…): la punta de un
     movimiento entre cuentas (lib/traspasos.ts).
   - en-proceso: pending. No cuenta hasta asentarse: entra con la fecha de
     asentado (postedAt), no con la de creación.
   - cobro: plata que entra de un tercero, ya asentada.
   - gasto: plata que sale. Hoy no se trae a la app (Fase 4, F4-05).

   La lista de reglas es de Angelo: lo que no esté acá se suma con la variable
   de entorno MERCURY_REGLAS_INTERNAS (textos separados por coma que, si
   aparecen en la contraparte o en la descripción, hacen que sea interno), sin
   tocar el código. Sin React ni red: se prueba con movimientos de ejemplo.
   ================================================================== */

export type TipoMercury = "anulado" | "interno" | "pase" | "en-proceso" | "cobro" | "gasto";

export interface ClasificacionMercury {
  tipo: TipoMercury;
  /* Qué regla lo decidió, en castellano: para los avisos y las pruebas. */
  motivo: string;
}

/* Los estados con los que Mercury dice que la plata NO se movió (o se devolvió). */
const ANULADOS = new Set(["failed", "cancelled", "canceled", "reversed", "blocked"]);

/* Las reglas de «ni ingreso ni gasto», en orden: la primera que coincide. */
const REGLAS_INTERNAS: { motivo: string; coincide: (t: Record<string, unknown>, texto: string) => boolean }[] = [
  { motivo: "Entre cuentas del mismo Mercury", coincide: (t) => String(t.kind ?? "") === "internalTransfer" },
  { motivo: "Tarjeta de crédito de Mercury", coincide: (t) => /credit\s*card/i.test(String(t.kind ?? "")) },
  { motivo: "Treasury (inversión de Mercury)", coincide: (t) => /treasury/i.test(String(t.kind ?? "")) },
  {
    motivo: "Pago de la tarjeta de crédito",
    coincide: (_t, texto) => /\b(credit\s*card|tarjeta)\b.*\b(payment|autopay|pago)\b|\b(payment|autopay|pago)\b.*\b(credit\s*card|tarjeta)\b|\bautopay\b|\bmercury\s*(io|credit)\b/i.test(texto),
  },
  { motivo: "Entre subcuentas de Mercury", coincide: (_t, texto) => /^\s*mercury\b/i.test(texto) && /\b(checking|savings|treasury|subaccount|sub-account|subcuenta)\b/i.test(texto) },
  /* El propio banco (cashback, intereses): tampoco es un cliente. */
  { motivo: "Movimiento del propio Mercury", coincide: (t) => /^\s*mercury\s*$/i.test(String(t.counterpartyName ?? t.counterpartyNickname ?? "")) },
];

const textoDe = (t: Record<string, unknown>) =>
  [t.counterpartyName, t.counterpartyNickname, t.bankDescription, t.externalMemo, t.note].map((x) => String(x ?? "")).join(" · ");

/** Qué es un movimiento de Mercury, con la regla que lo decidió. `extras` son
    los textos que Angelo suma sin tocar el código (MERCURY_REGLAS_INTERNAS). */
export function clasificarMercury(t: Record<string, unknown>, extras: readonly string[] = []): ClasificacionMercury {
  const estado = String(t.status ?? "").toLowerCase();
  if (ANULADOS.has(estado)) return { tipo: "anulado", motivo: `El banco lo dejó en «${estado}»` };

  const texto = textoDe(t);
  for (const r of REGLAS_INTERNAS) if (r.coincide(t, texto)) return { tipo: "interno", motivo: r.motivo };
  const extra = extras.map((x) => x.trim().toLowerCase()).find((x) => x && texto.toLowerCase().includes(x));
  if (extra) return { tipo: "interno", motivo: `Regla de la lista: «${extra}»` };

  const contraparte = String(t.counterpartyName ?? t.counterpartyNickname ?? "").trim();
  const pase = cuentaDeContraparte(contraparte) !== null;
  if (estado === "pending") return { tipo: "en-proceso", motivo: "Pending: todavía no se asentó (24 a 48 h)" };
  if (pase) return { tipo: "pase", motivo: `La otra parte es una cuenta propia («${contraparte}»)` };
  return Number(t.amount ?? 0) >= 0 ? { tipo: "cobro", motivo: "Plata que entra de un tercero" } : { tipo: "gasto", motivo: "Plata que sale" };
}

/** Las reglas extra que se cargan en el entorno, separadas por coma. */
export const reglasExtraDeEntorno = (valor: string | undefined): string[] =>
  (valor ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/* ---------- Lo que se cuenta de una pasada ---------- */

export interface ResumenMercury {
  /* Pending que todavía no cuentan. */
  enProceso: number;
  /* Tarjeta, subcuentas, Treasury: ni ingreso ni gasto. */
  internos: number;
  /* Los ids de los que el banco anuló (fallaron, se cancelaron, se revirtieron). */
  anulados: string[];
}

export const resumenVacio = (): ResumenMercury => ({ enProceso: 0, internos: 0, anulados: [] });

/* ---------- Limpiar lo que ya había entrado y el banco anuló ---------- */

/** Los cobros de Mercury que entraron a la bandeja (todavía sin conciliar) y
    que el banco después anuló: se descartan solos. Uno ya conciliado no se
    toca: ahí hay un pago, y eso lo decide una persona. */
export function cobrosAnulados(movimientos: Pick<Movimiento, "id" | "proveedor" | "referencia" | "estado">[], referencias: Iterable<string>): string[] {
  const refs = new Set(referencias);
  return movimientos
    .filter((m) => m.proveedor === "mercury" && m.estado === "pendiente" && refs.has(m.referencia))
    .map((m) => m.id);
}

export const NOTA_ANULADO = "El banco lo anuló: se descartó solo.";
