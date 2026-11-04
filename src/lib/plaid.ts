import type { EstadoApp, Gasto, ID } from "./types";
import { limpiarDescripcionBofa, refDeBofa, tipoDelBancoDeBofa, type FilaBofa } from "./gastos-bofa";
import { armarFilasDeBofa, gastosDeFilas } from "./gastos-masivos";
import type { MovimientoDelBanco } from "./movimientos-del-banco";

/* ==================================================================
   Lo que trae Plaid del Bank of America, dicho como lo dice el resto de la app.

   Bank of America no tiene una API que la app pueda leer sola (sacó hasta el formato OFX): Plaid sí, con el permiso de sólo lectura que da quien
   tiene acceso a la cuenta (lib/plaid-servidor.ts). Lo que devuelve Plaid se traduce acá al MISMO formato que el CSV del banco (`FilaBofa`), y de ahí
   en adelante es todo lo que ya existe: las reglas de qué es un gasto y qué se deja afuera (`queEsBofa`), la categoría, no repetir lo que ya está
   cargado y cómo se arma cada gasto (`armarFilasDeBofa`, `gastosDeFilas`). Un movimiento entra igual lo traiga el CSV o Plaid, y si entra por los
   dos caminos se reconoce como el mismo.

   Ojo con el signo: Plaid cuenta POSITIVO lo que sale de la cuenta y negativo lo que entra (una compra con la tarjeta de débito es positiva, un depósito
   es negativo). La app, como el CSV del banco, al revés: entra +, sale −. Acá se da vuelta una sola vez.

   Sin React ni red: se prueba con transacciones de ejemplo.
   ================================================================== */

export interface PlaidTransaccion {
  transaction_id: string;
  account_id: string;
  /* Positivo: sale plata de la cuenta. Negativo: entra. */
  amount: number;
  iso_currency_code?: string | null;
  /* Pending: el día que ocurrió. Asentada: el día que se asentó (aaaa-mm-dd). */
  date: string;
  name?: string | null;
  merchant_name?: string | null;
  /* Lo que dice el banco, entero: sólo viene si se pide (`include_original_description`). */
  original_description?: string | null;
  pending?: boolean;
  pending_transaction_id?: string | null;
}

export interface PlaidCuenta {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  /* «depository» (cuenta corriente, de ahorro), «credit» (tarjeta), «loan»… */
  type?: string | null;
  subtype?: string | null;
  balances?: { available?: number | null; current?: number | null; iso_currency_code?: string | null } | null;
}

/* Lo que se guarda de cada cuenta que se eligió en Plaid (sin saldos: esos se piden cuando hacen falta). */
export interface CuentaDelBanco {
  id: string;
  nombre: string;
  mascara?: string;
  tipo?: string;
  subtipo?: string;
}

const texto = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const r2 = (n: number) => Math.round(n * 100) / 100;

export function cuentaDelBanco(c: PlaidCuenta): CuentaDelBanco {
  return {
    id: c.account_id,
    nombre: texto(c.official_name) || texto(c.name) || "Cuenta",
    ...(texto(c.mask) ? { mascara: texto(c.mask) } : {}),
    ...(texto(c.type) ? { tipo: texto(c.type) } : {}),
    ...(texto(c.subtype) ? { subtipo: texto(c.subtype) } : {}),
  };
}

/** Lo que dice el banco de la transacción, entero. El nombre limpio de Plaid («Whop») sirve para mostrar, pero las reglas de qué es cada
 *  movimiento se escribieron sobre el texto del banco («Whop Inc DES:Whop Inc/p ID:…»). */
export const descripcionDePlaid = (t: PlaidTransaccion): string => texto(t.original_description) || texto(t.name) || texto(t.merchant_name);

export interface FilaDePlaid {
  fila: FilaBofa;
  t: PlaidTransaccion;
}

/** Las transacciones de Plaid como filas del export de Bank of America. Sólo dólares; lo pending sólo si se pide (no es plata hasta asentarse y al
 *  asentarse cambia de id). Los iguales del mismo día (dos cafés) llevan su número, igual que en el CSV, en un orden que no cambia entre lecturas. */
export function filasBofaDePlaid(ts: readonly PlaidTransaccion[], cuentas: readonly PlaidCuenta[], opciones: { pendientes?: boolean } = {}): FilaDePlaid[] {
  const tipoDe = new Map(cuentas.map((c) => [c.account_id, texto(c.type).toLowerCase()] as const));
  const validas = ts.filter((t) => {
    if (!t.transaction_id || !/^\d{4}-\d{2}-\d{2}$/.test(texto(t.date))) return false;
    if (!Number.isFinite(t.amount) || t.amount === 0) return false;
    const moneda = texto(t.iso_currency_code).toUpperCase();
    if (moneda && moneda !== "USD") return false;
    return Boolean(t.pending) ? Boolean(opciones.pendientes) : true;
  });
  validas.sort((a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id));
  const vistas = new Map<string, number>();
  return validas.map((t) => {
    const monto = r2(-t.amount);
    const descripcion = descripcionDePlaid(t);
    const clave = `${t.date}|${Math.round(Math.abs(monto) * 100)}|${monto < 0 ? "-" : "+"}|${descripcion.toLowerCase()}`;
    const repetida = (vistas.get(clave) ?? 0) + 1;
    vistas.set(clave, repetida);
    const origen: FilaBofa["origen"] = tipoDe.get(t.account_id) === "credit" ? "tarjeta" : "cuenta";
    return { t, fila: { fecha: t.date, descripcion, monto, origen, repetida } };
  });
}

/** Lo que movió la cuenta, para «Qué pasó en la cuenta»: cada movimiento con su tipo y la misma referencia con la que se guarda el gasto cargado
 *  (`extra.bancoRef`), así se reconoce como cargado venga de donde venga. */
export function movimientosDelBancoDePlaid(ts: readonly PlaidTransaccion[], cuentas: readonly PlaidCuenta[], cuentaId: ID = "proc_bofa"): MovimientoDelBanco[] {
  return filasBofaDePlaid(ts, cuentas, { pendientes: true }).map(({ fila, t }): MovimientoDelBanco => {
    const nombre = limpiarDescripcionBofa(fila.descripcion);
    const comercio = texto(t.merchant_name);
    return {
      ref: refDeBofa(fila),
      refApp: [t.transaction_id],
      cuentaId,
      fecha: `${fila.fecha}T15:00:00.000Z`,
      monto: fila.monto,
      contraparte: comercio || nombre,
      ...(fila.descripcion && fila.descripcion !== (comercio || nombre) ? { detalle: fila.descripcion } : {}),
      tipo: tipoDelBancoDeBofa(fila),
      ...(t.pending ? { pendiente: true } : {}),
    };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/* ---------- Cargar los gastos solos ---------- */

export interface GastosAutomaticos {
  /* Listos para guardar, con un id que sale de la referencia del banco: guardarlos dos veces no duplica. */
  gastos: Gasto[];
  /* De los que se cargan, los que no se supo a qué categoría van (quedan en «Pendiente de revisión»). */
  paraRevisar: number;
  /* Los que se dejaron afuera con su motivo (pago de la tarjeta, entre cuentas propias, lo que entra). */
  afuera: number;
  /* Los que ya estaban cargados (por su referencia o uno igual de otro día). */
  yaCargados: number;
}

/** El id del gasto sale de la referencia del banco: la misma transacción siempre da el mismo gasto, y el cron puede pasar cien veces. */
export const idDeGastoDeBanco = (bancoRef: string): ID => `gas_${bancoRef.replace(/[^a-zA-Z0-9]+/g, "_")}`.slice(0, 120);

/** Los gastos que hay que cargar de lo que trajo Plaid, con las mismas reglas y la misma categoría que cuando se pega el CSV. Sólo lo asentado y desde
 *  `desde` (aaaa-mm-dd): lo anterior se carga a mano o con el CSV. */
export function gastosAutomaticos(
  ts: readonly PlaidTransaccion[], cuentas: readonly PlaidCuenta[], e: EstadoApp, opciones: { desde: string; ahora?: Date },
): GastosAutomaticos {
  const ahora = opciones.ahora ?? new Date();
  const filas = filasBofaDePlaid(ts, cuentas).filter((x) => x.fila.fecha >= opciones.desde);
  if (filas.length === 0) return { gastos: [], paraRevisar: 0, afuera: 0, yaCargados: 0 };
  const masivas = armarFilasDeBofa(filas.map((x) => x.fila), { e, hoy: ahora });
  const lote = `bofa-plaid-${ahora.toISOString().slice(0, 13)}`;
  const idPlaid = new Map(filas.map((x) => [refDeBofa(x.fila), x.t.transaction_id] as const));
  const gastos = gastosDeFilas(masivas, e, lote, ahora.toISOString()).map((g): Gasto => {
    const ref = typeof g.extra?.bancoRef === "string" ? g.extra.bancoRef : "";
    return { ...g, id: idDeGastoDeBanco(ref), extra: { ...g.extra, origen: "bofa-plaid", cargaAutomatica: true, ...(idPlaid.get(ref) ? { plaidId: idPlaid.get(ref) } : {}) } };
  }).filter((g) => typeof g.extra.bancoRef === "string");
  return {
    gastos,
    paraRevisar: gastos.filter((g) => g.categoria === "Pendiente de revisión").length,
    afuera: masivas.filter((f) => !f.incluir && f.afuera).length,
    yaCargados: masivas.filter((f) => f.yaCargada && !f.incluir).length,
  };
}
