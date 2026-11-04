import type { SupabaseClient } from "@supabase/supabase-js";
import { nubeServidor } from "./servidor";
import { FUENTES_DE_SALDO, type SaldoReal } from "./saldos-reales";
import type { MovimientoDelBanco } from "./movimientos-del-banco";
import type { EstadoApp } from "./types";
import { cuentaDelBanco, gastosAutomaticos, movimientosDelBancoDePlaid, type CuentaDelBanco, type PlaidCuenta, type PlaidTransaccion } from "./plaid";

/* ==================================================================
   Plaid, del lado del servidor: la conexión con el Bank of America.

   Quien tiene acceso a la cuenta la conecta UNA vez desde Ajustes → Integraciones: se abre la ventana de Plaid, entra con su usuario del banco (la
   clave la ve el banco, nunca esta app) y elige qué cuentas compartir. Plaid devuelve un permiso de sólo lectura (`access_token`) que se guarda en
   `conexion_bancaria` (supabase/conexion-bancaria.sql), una tabla sin políticas que sólo lee el servidor. Con ese permiso se piden los movimientos y
   el saldo cuando hace falta, y el cron de cada hora (/api/pasarelas/sync) carga los gastos nuevos.

   Las claves de Plaid (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV) van en Vercel como las demás (docs/conectar-bank-of-america.md). Se habla con Plaid
   con fetch plano, sin su librería: son cuatro llamadas. Docs: https://plaid.com/docs/api/
   ================================================================== */

export const ID_DE_LA_CONEXION = "bofa";
const VERSION_DE_PLAID = "2020-09-14";

export const plaidConfigurado = (): boolean => Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim());
/** «production» (el banco de verdad) o «sandbox» (el banco de juguete que da Plaid para probar). Sin PLAID_ENV, sandbox: nunca se pega al banco real por descuido. */
export const entornoDePlaid = (): "production" | "sandbox" => (process.env.PLAID_ENV ?? "").trim().toLowerCase() === "production" ? "production" : "sandbox";
const HOSTS = { production: "https://production.plaid.com", sandbox: "https://sandbox.plaid.com" } as const;

/* ---------- Hablar con Plaid ---------- */

export class ErrorDePlaid extends Error {
  constructor(readonly codigo: string, readonly tipo: string, mensaje: string, readonly status: number) {
    super(mensaje);
    this.name = "ErrorDePlaid";
  }
}

const TEXTOS_DE_ERROR: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: "Bank of America pide volver a autorizar la conexión (el permiso vence una vez al año o cuando cambia la clave): entrá a Ajustes → Integraciones y tocá «Volver a autorizar».",
  PRODUCT_NOT_READY: "Plaid todavía está trayendo el historial de la cuenta: probá de nuevo en unos minutos.",
  INVALID_API_KEYS: "Plaid no aceptó las claves: revisá PLAID_CLIENT_ID y PLAID_SECRET en Vercel (y que PLAID_ENV sea el entorno de esas claves).",
  INVALID_CLIENT_ID: "Plaid no reconoce el PLAID_CLIENT_ID de Vercel.",
  INVALID_SECRET: "Plaid no aceptó el PLAID_SECRET de Vercel: tiene que ser el del mismo entorno que PLAID_ENV.",
  RATE_LIMIT_EXCEEDED: "Plaid pidió esperar un poco: probá de nuevo en unos minutos.",
  INSTITUTION_DOWN: "El banco no responde ahora: se vuelve a intentar solo en la próxima hora.",
  INSTITUTION_NOT_RESPONDING: "El banco no responde ahora: se vuelve a intentar solo en la próxima hora.",
  INSTITUTION_NO_LONGER_SUPPORTED: "Plaid dejó de soportar esa conexión: hay que volver a conectar el banco.",
};

export async function plaid<T = Record<string, unknown>>(ruta: string, cuerpo: Record<string, unknown>): Promise<T> {
  const cliente = process.env.PLAID_CLIENT_ID?.trim();
  const secreto = process.env.PLAID_SECRET?.trim();
  if (!cliente || !secreto) throw new ErrorDePlaid("SIN_CLAVES", "CONFIG", "Faltan PLAID_CLIENT_ID y PLAID_SECRET en Vercel: ver docs/conectar-bank-of-america.md.", 503);
  const r = await fetch(`${HOSTS[entornoDePlaid()]}/${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "PLAID-CLIENT-ID": cliente, "PLAID-SECRET": secreto, "Plaid-Version": VERSION_DE_PLAID },
    body: JSON.stringify(cuerpo),
    cache: "no-store",
  });
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const codigo = String(datos.error_code ?? `HTTP_${r.status}`);
    const mostrar = typeof datos.display_message === "string" && datos.display_message ? datos.display_message : "";
    const mensaje = TEXTOS_DE_ERROR[codigo] ?? (mostrar || String(datos.error_message ?? `Plaid respondió ${r.status}.`));
    throw new ErrorDePlaid(codigo, String(datos.error_type ?? "ERROR"), `Plaid (${ruta}): ${mensaje}`, r.status);
  }
  return datos as T;
}

/* ---------- La conexión guardada ---------- */

export interface ConexionBancaria {
  id: string;
  accessToken: string;
  itemId: string;
  institucion?: string | null;
  cuentas: CuentaDelBanco[];
  autoCargar: boolean;
  desdeAuto: string;
  pideReautorizar: boolean;
  ultimaLectura?: string | null;
  ultimoError?: string | null;
  ultimosCargados: number;
  conectadoPor?: string | null;
  conectadoEn: string;
}

/** Lo que se le muestra a la pantalla: nunca el permiso. */
export type EstadoDeLaConexion = Omit<ConexionBancaria, "accessToken" | "itemId">;

type Db = Pick<SupabaseClient, "from">;

export async function conexion(db: Db | null = nubeServidor()): Promise<ConexionBancaria | null> {
  if (!db) return null;
  const r = await db.from("conexion_bancaria").select("*").eq("id", ID_DE_LA_CONEXION).maybeSingle();
  if (r.error || !r.data) return null;
  return r.data as ConexionBancaria;
}

export const sinElPermiso = ({ accessToken: _a, itemId: _i, ...resto }: ConexionBancaria): EstadoDeLaConexion => resto;

async function anotar(db: Db, cambios: Partial<ConexionBancaria>): Promise<void> {
  await db.from("conexion_bancaria").update(cambios).eq("id", ID_DE_LA_CONEXION);
}

/* ---------- Conectar ---------- */

const NOMBRE_EN_PLAID = "Apicanta ERP";

/** El permiso para abrir la ventana de Plaid. Con `volver`, se abre para volver a autorizar la conexión que ya hay (el permiso vence al año). */
export async function crearLinkToken(quien: string, volver: boolean, db: Db | null = nubeServidor()): Promise<string> {
  const base = { client_name: NOMBRE_EN_PLAID, language: "es", country_codes: ["US"], user: { client_user_id: "apicanta-erp" } };
  if (volver) {
    const c = await conexion(db);
    if (!c) throw new ErrorDePlaid("SIN_CONEXION", "CONFIG", "Todavía no hay una conexión para volver a autorizar.", 404);
    const r = await plaid<{ link_token: string }>("link/token/create", { ...base, access_token: c.accessToken });
    return r.link_token;
  }
  void quien;
  const r = await plaid<{ link_token: string }>("link/token/create", { ...base, products: ["transactions"] });
  return r.link_token;
}

/** Plaid devuelve un `public_token` de un solo uso: se cambia por el permiso permanente y se guarda. Si ya había una conexión, se da de baja la vieja (cada
 *  conexión de Plaid se factura por mes: no se dejan dos). */
export async function guardarConexion(publicToken: string, institucion: string, quien: string, db: Db | null = nubeServidor()): Promise<EstadoDeLaConexion> {
  if (!db) throw new ErrorDePlaid("SIN_BASE", "CONFIG", "Falta SUPABASE_SERVICE_ROLE_KEY: no hay dónde guardar el permiso del banco.", 503);
  const previa = await conexion(db);
  const cambio = await plaid<{ access_token: string; item_id: string }>("item/public_token/exchange", { public_token: publicToken });
  const cuentas = (await plaid<{ accounts?: PlaidCuenta[] }>("accounts/get", { access_token: cambio.access_token })).accounts ?? [];
  const fila: ConexionBancaria = {
    id: ID_DE_LA_CONEXION, accessToken: cambio.access_token, itemId: cambio.item_id,
    institucion: institucion.slice(0, 80) || "Bank of America", cuentas: cuentas.map(cuentaDelBanco),
    autoCargar: previa?.autoCargar ?? true,
    /* Lo anterior a hoy se carga a mano o con el CSV: la primera lectura no llena la app de movimientos viejos. */
    desdeAuto: previa?.desdeAuto ?? new Date().toISOString(),
    pideReautorizar: false, ultimaLectura: null, ultimoError: null, ultimosCargados: 0,
    conectadoPor: quien.slice(0, 120) || null, conectadoEn: new Date().toISOString(),
  };
  const r = await db.from("conexion_bancaria").upsert(fila, { onConflict: "id", defaultToNull: false });
  if (r.error) throw new ErrorDePlaid("SIN_TABLA", "CONFIG", `No pude guardar el permiso del banco (${r.error.message}). ¿Se corrió supabase/conexion-bancaria.sql?`, 503);
  /* Si la que se volvió a autorizar es la misma conexión, el permiso viejo sigue valiendo para Plaid: sólo se da de baja si es otra. */
  if (previa && previa.itemId !== cambio.item_id) await plaid("item/remove", { access_token: previa.accessToken }).catch(() => undefined);
  return sinElPermiso(fila);
}

export async function desconectar(db: Db | null = nubeServidor()): Promise<void> {
  if (!db) throw new ErrorDePlaid("SIN_BASE", "CONFIG", "Falta SUPABASE_SERVICE_ROLE_KEY.", 503);
  const c = await conexion(db);
  if (!c) return;
  /* Se le avisa a Plaid primero: deja de facturar la conexión y el permiso queda anulado. Si Plaid no contesta, igual se borra acá. */
  await plaid("item/remove", { access_token: c.accessToken }).catch(() => undefined);
  const r = await db.from("conexion_bancaria").delete().eq("id", ID_DE_LA_CONEXION);
  if (r.error) throw new ErrorDePlaid("SIN_TABLA", "CONFIG", "No pude desconectar el banco.", 502);
}

export async function cambiarAutoCarga(activa: boolean, db: Db | null = nubeServidor()): Promise<void> {
  if (!db) throw new ErrorDePlaid("SIN_BASE", "CONFIG", "Falta SUPABASE_SERVICE_ROLE_KEY.", 503);
  const r = await db.from("conexion_bancaria").update({ autoCargar: activa }).eq("id", ID_DE_LA_CONEXION);
  if (r.error) throw new ErrorDePlaid("SIN_TABLA", "CONFIG", "No pude guardar el cambio.", 502);
}

/* ---------- Leer ---------- */

const DIA = 86_400_000;
const PAGINAS_MAXIMAS = 8;

/** Las transacciones del día `desde` a hoy (de a 500, hasta 4.000). Si el banco pide volver a autorizar, queda anotado en la conexión. */
export async function transaccionesDe(c: ConexionBancaria, desde: Date, db: Db | null = nubeServidor(), hasta: Date = new Date()): Promise<{ transacciones: PlaidTransaccion[]; cuentas: PlaidCuenta[] }> {
  const transacciones: PlaidTransaccion[] = [];
  let cuentas: PlaidCuenta[] = [];
  try {
    for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
      const r = await plaid<{ transactions?: PlaidTransaccion[]; accounts?: PlaidCuenta[]; total_transactions?: number }>("transactions/get", {
        access_token: c.accessToken,
        start_date: desde.toISOString().slice(0, 10),
        end_date: new Date(hasta.getTime() + DIA).toISOString().slice(0, 10),
        options: { count: 500, offset: transacciones.length, include_original_description: true },
      });
      cuentas = r.accounts ?? cuentas;
      const lote = r.transactions ?? [];
      transacciones.push(...lote);
      if (lote.length === 0 || transacciones.length >= (r.total_transactions ?? 0)) break;
    }
  } catch (err) {
    if (err instanceof ErrorDePlaid && err.codigo === "ITEM_LOGIN_REQUIRED" && db) await anotar(db, { pideReautorizar: true, ultimoError: err.message });
    throw err;
  }
  return { transacciones, cuentas };
}

export interface RespuestaDeMovimientos { movimientos: MovimientoDelBanco[]; avisos: string[]; conectada: boolean }

/** Lo que movió el banco desde un día, para «Qué pasó en la cuenta». */
export async function movimientosDeBofa(desde: Date, db: Db | null = nubeServidor()): Promise<RespuestaDeMovimientos> {
  const c = plaidConfigurado() ? await conexion(db) : null;
  if (!c) return { movimientos: [], avisos: [], conectada: false };
  const avisos: string[] = [];
  if (c.pideReautorizar) avisos.push(TEXTOS_DE_ERROR.ITEM_LOGIN_REQUIRED);
  try {
    const { transacciones, cuentas } = await transaccionesDe(c, desde, db);
    const movimientos = movimientosDelBancoDePlaid(transacciones, cuentas).filter((m) => new Date(m.fecha) >= new Date(desde.getTime() - DIA));
    return { movimientos, avisos, conectada: true };
  } catch (err) {
    if (err instanceof ErrorDePlaid && err.codigo === "PRODUCT_NOT_READY") return { movimientos: [], avisos: [...avisos, err.message], conectada: true };
    throw err;
  }
}

/** Lo que hay hoy en la cuenta (las cuentas corrientes y de ahorro; lo que se debe de la tarjeta, aparte). El saldo se pide en vivo al banco; si no se
 *  puede, el que Plaid tiene guardado, que puede tener unas horas. */
export async function saldoDeBofa(db: Db | null = nubeServidor()): Promise<SaldoReal | null> {
  const c = plaidConfigurado() ? await conexion(db) : null;
  if (!c) return null;
  let cuentas: PlaidCuenta[];
  let enVivo = true;
  try {
    cuentas = (await plaid<{ accounts?: PlaidCuenta[] }>("accounts/balance/get", { access_token: c.accessToken })).accounts ?? [];
  } catch (err) {
    if (err instanceof ErrorDePlaid && err.codigo === "ITEM_LOGIN_REQUIRED") {
      if (db) await anotar(db, { pideReautorizar: true, ultimoError: err.message });
      throw err;
    }
    enVivo = false;
    cuentas = (await plaid<{ accounts?: PlaidCuenta[] }>("accounts/get", { access_token: c.accessToken })).accounts ?? [];
  }
  const dolares = cuentas.filter((a) => !a.balances?.iso_currency_code || a.balances.iso_currency_code === "USD");
  const plata = dolares.filter((a) => (a.type ?? "").toLowerCase() === "depository");
  if (plata.length === 0) return null;
  const saldo = Math.round(plata.reduce((s, a) => s + Number(a.balances?.current ?? 0), 0) * 100) / 100;
  const deuda = Math.round(dolares.filter((a) => (a.type ?? "").toLowerCase() === "credit").reduce((s, a) => s + Math.max(0, Number(a.balances?.current ?? 0)), 0) * 100) / 100;
  return {
    cuentaId: "proc_bofa", saldo, moneda: "USD", al: new Date().toISOString(), fuente: FUENTES_DE_SALDO.proc_bofa,
    ...(enVivo ? {} : { nota: "Es el saldo que tiene guardado Plaid: puede tener unas horas." }),
    ...(deuda > 0 ? { pendientes: { salidas: 0, nSalidas: 0, entradas: 0, nEntradas: 0, tarjeta: deuda } } : {}),
  };
}

/* ---------- Cargar los gastos solos ---------- */

/** Cuántos días para atrás mira cada pasada: alcanza para lo que el banco asienta tarde, sin traer meses en cada hora. */
const DIAS_QUE_MIRA = 45;

export interface ResultadoDeLaCarga {
  estado: "no-conectada" | "apagada" | "ok" | "error";
  cargados: number;
  paraRevisar: number;
  mensaje?: string;
}

/** Lo que necesitan las reglas de los gastos del estado de la app: los gastos (la categoría con que se cargó antes cada cosa), el equipo (los pagos de
 *  equipo), las cuentas y los ajustes. Se lee de la base. */
async function estadoParaCargar(db: Db): Promise<EstadoApp | { error: string }> {
  const [gastos, equipo, procesadores, ajustes] = await Promise.all([
    db.from("gastos").select("*"),
    db.from("equipo").select("*"),
    db.from("procesadores").select("*"),
    db.from("ajustes").select("*").eq("id", 1).maybeSingle(),
  ]);
  for (const r of [gastos, equipo, procesadores, ajustes]) if (r.error) return { error: r.error.message };
  const { id: _id, ...resto } = (ajustes.data ?? {}) as Record<string, unknown>;
  return { gastos: gastos.data ?? [], equipo: equipo.data ?? [], procesadores: procesadores.data ?? [], ajustes: { monedaBase: "USD", tipoCambio: 1, ...resto } } as unknown as EstadoApp;
}

/** Lo que hace el cron cada hora: trae lo asentado desde que se conectó (como mucho 45 días atrás) y carga como gasto lo que falta, con la misma
 *  lógica que el CSV. Nunca tumba al cron: el resultado dice qué pasó. */
export async function cargarGastosDelBanco(db: Db | null = nubeServidor(), ahora: Date = new Date(), opciones: { aunqueEsteApagada?: boolean } = {}): Promise<ResultadoDeLaCarga> {
  if (!db || !plaidConfigurado()) return { estado: "no-conectada", cargados: 0, paraRevisar: 0 };
  const c = await conexion(db);
  if (!c) return { estado: "no-conectada", cargados: 0, paraRevisar: 0 };
  if (!c.autoCargar && !opciones.aunqueEsteApagada) return { estado: "apagada", cargados: 0, paraRevisar: 0 };
  try {
    const arranque = new Date(Math.max(Date.parse(c.desdeAuto) || 0, ahora.getTime() - DIAS_QUE_MIRA * DIA));
    const { transacciones, cuentas } = await transaccionesDe(c, arranque, db, ahora);
    const e = await estadoParaCargar(db);
    if ("error" in e) throw new Error(`No pude leer la base para cargar los gastos (${e.error}).`);
    const r = gastosAutomaticos(transacciones, cuentas, e, { desde: arranque.toISOString().slice(0, 10), ahora });
    let cargados = 0;
    if (r.gastos.length) {
      const g = await db.from("gastos").upsert(r.gastos, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false }).select("id");
      if (g.error) throw new Error(`No pude guardar los gastos del banco (${g.error.message}).`);
      cargados = (g.data ?? []).length;
    }
    await anotar(db, { ultimaLectura: ahora.toISOString(), ultimoError: null, pideReautorizar: false, ...(cargados ? { ultimosCargados: cargados } : {}) });
    return { estado: "ok", cargados, paraRevisar: cargados ? r.paraRevisar : 0 };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error desconocido.";
    /* El historial que Plaid todavía está trayendo no es un error: se vuelve a intentar en la próxima hora. */
    if (err instanceof ErrorDePlaid && err.codigo === "PRODUCT_NOT_READY") return { estado: "ok", cargados: 0, paraRevisar: 0, mensaje };
    await anotar(db, { ultimoError: mensaje.slice(0, 300) });
    return { estado: "error", cargados: 0, paraRevisar: 0, mensaje };
  }
}
