import type {
  CasilleroChequeo, Comprobante, Cuota, EstadoApp, ID, MiembroEquipo, Pago, Procesador, Venta, VeredictoChequeo,
} from "./types";
import { fechaHora } from "./format";
import { nivelEn, puedeEditar, type MiAcceso } from "./permisos";

export type { CasilleroChequeo, VeredictoChequeo } from "./types";

/* ==================================================================
   El control cruzado de los cobros.

   Yari (02/10): «el closer tiene que cargar, pero se va a equivocar:
   después alguien más revisa que el comprobante coincida con lo cargado».
   Dos casilleros separados, el del director comercial y el de finanzas, y
   con uno alcanza para que el cobro no quede pendiente. Cada casillero
   guarda quién lo hizo, cuándo y, si rechazó el comprobante, por qué: «el
   que chequeó también es responsable».

   Esto es lo que se puede decir de un cobro sin tocar nada de su plata:
   chequear o rechazar no cambia ningún número (el Cash Collected, las
   comisiones y el profit salen igual). Es sólo una marca para que la
   asistente sepa qué le queda por revisar.

   El sí/no de antes (`Pago.chequeado`, la columna «Pasado Financiera /
   Chequeado en plataforma» de la planilla de Angelo) se respeta: un cobro
   que ya estaba marcado sigue chequeado, sin quién ni cuándo. Uno que no lo
   estaba queda pendiente.
   ================================================================== */

/* ---------- Los casilleros ---------- */

export const CASILLEROS: readonly CasilleroChequeo[] = ["director", "finanzas"];

/* Cómo se dice cada uno: «Chequeado por el director», «por finanzas». */
export const ROL_DE_CASILLERO: Record<CasilleroChequeo, { corto: string; largo: string; por: string }> = {
  director: { corto: "Director", largo: "Director comercial", por: "el director" },
  finanzas: { corto: "Finanzas", largo: "Finanzas", por: "finanzas" },
};

/* Las columnas de `pagos` que son del control. Las completa la base (el
   trigger de supabase/control-cruzado.sql sella quién y cuándo) y nunca
   viajan en un upsert del cobro entero: una copia vieja de la pantalla
   podría pisar con un «pendiente» lo que otro acaba de chequear. Cada
   chequeo sale como un UPDATE de sus columnas. */
export const COLUMNAS_DE_CONTROL = [
  "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "chequeoDirectorNota",
  "chequeoFinanzas", "chequeoFinanzasPor", "chequeoFinanzasEn", "chequeoFinanzasNota",
] as const;
export const COLUMNAS_QUE_PONE_LA_BASE: readonly string[] = [...COLUMNAS_DE_CONTROL, "cargadoPor"];

type ColumnaDeControl = (typeof COLUMNAS_DE_CONTROL)[number];

/** La fila de un cobro como va a la base en un upsert del cobro entero: sin lo que
 *  pone la base (quién lo cargó y los chequeos). Lo que tiene una pantalla puede ser
 *  más viejo que lo que acaba de chequear otra persona, y mandarlo lo pisaría con un
 *  «pendiente»: los chequeos salen siempre como un UPDATE de sus columnas. */
export function sinColumnasDelControl<T>(fila: T): T {
  const copia = { ...(fila as Record<string, unknown>) };
  for (const k of COLUMNAS_QUE_PONE_LA_BASE) delete copia[k];
  return copia as T;
}

/** Quién usa la app y qué casillero le toca: el de finanzas si edita
 *  Finanzas (la asistente, los dueños); el del director si edita las ventas de
 *  todos y no sólo las suyas. El closer, el setter y marketing no llenan
 *  ninguno: ven el estado y pueden subir otro comprobante. */
export function casilleroDe(a: MiAcceso | null | undefined): CasilleroChequeo | null {
  if (!a) return null;
  if (nivelEn(a, "finanzas") >= 2) return "finanzas";
  if (nivelEn(a, "ventas") >= 2 && !a.soloLoSuyo) return "director";
  return null;
}

/** Lo que deja la base: el casillero de finanzas lo llena quien edita
 *  Finanzas; el del director, quien edita Ventas sin ser «sólo lo suyo». */
export function puedeUsarCasillero(a: MiAcceso | null | undefined, c: CasilleroChequeo): boolean {
  if (!a) return false;
  return c === "finanzas" ? nivelEn(a, "finanzas") >= 2 : nivelEn(a, "ventas") >= 2 && !a.soloLoSuyo;
}

/** Subir o cambiar el comprobante de un cobro ya cargado: quien edita los cobros. */
export const puedeCambiarComprobante = (a: MiAcceso | null | undefined) => puedeEditar(a, "pagos");

/* ---------- Leer el control de un cobro ---------- */

export interface ChequeoDeCasillero {
  casillero: CasilleroChequeo;
  veredicto: VeredictoChequeo;
  por?: string;
  en?: string;
  nota?: string;
}

export function chequeoDe(p: Pago, c: CasilleroChequeo): ChequeoDeCasillero | undefined {
  const veredicto = c === "director" ? p.chequeoDirector : p.chequeoFinanzas;
  if (veredicto !== "chequeado" && veredicto !== "rechazado") return undefined;
  return c === "director"
    ? { casillero: c, veredicto, por: p.chequeoDirectorPor, en: p.chequeoDirectorEn, nota: p.chequeoDirectorNota }
    : { casillero: c, veredicto, por: p.chequeoFinanzasPor, en: p.chequeoFinanzasEn, nota: p.chequeoFinanzasNota };
}

export type EstadoChequeo = "pendiente" | "chequeado" | "rechazado";

export interface ControlDeCobro {
  estado: EstadoChequeo;
  director?: ChequeoDeCasillero;
  finanzas?: ChequeoDeCasillero;
  /** Los que dijeron «chequeado», del primero al último. */
  chequeos: ChequeoDeCasillero[];
  /** Los que rechazaron el comprobante. */
  rechazos: ChequeoDeCasillero[];
  /** Está marcado con el sí/no de antes y ningún casillero dijo nada. */
  deAntes: boolean;
  /** Atado a un cobro de la pasarela: la plata está ahí. */
  conciliado: boolean;
}

const porFecha = (a: ChequeoDeCasillero, b: ChequeoDeCasillero) => (a.en ?? "").localeCompare(b.en ?? "");

/** Cómo está un cobro. Con que un casillero lo rechace queda rechazado hasta que
 *  se arregle (otro comprobante, o quien lo rechazó lo da por bueno); si no, con
 *  que uno lo chequee alcanza; y un cobro sin ninguna de las dos cosas está
 *  pendiente. */
export function controlDeCobro(p: Pago): ControlDeCobro {
  const director = chequeoDe(p, "director");
  const finanzas = chequeoDe(p, "finanzas");
  const dichos = [director, finanzas].filter((x): x is ChequeoDeCasillero => Boolean(x));
  const rechazos = dichos.filter((x) => x.veredicto === "rechazado").sort(porFecha);
  const chequeos = dichos.filter((x) => x.veredicto === "chequeado").sort(porFecha);
  const deAntes = Boolean(p.chequeado) && chequeos.length === 0;
  const estado: EstadoChequeo = rechazos.length > 0 ? "rechazado" : chequeos.length > 0 || deAntes ? "chequeado" : "pendiente";
  return { estado, director, finanzas, chequeos, rechazos, deAntes, conciliado: Boolean(p.movimientoId) };
}

export const estadoDeChequeo = (p: Pago): EstadoChequeo => controlDeCobro(p).estado;

/* ---------- Quién ---------- */

/** Un correo (lo que guarda la base) como lo conoce el equipo: el nombre de
 *  quien tiene ese correo en Equipo; si nadie, el correo. Lo que no es un
 *  correo (el «Responsable» de Ajustes, sin nube) va tal cual. */
export function quienEs(equipo: readonly Pick<MiembroEquipo, "email" | "nombre">[], valor?: string | null): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  if (!v.includes("@")) return v;
  const m = equipo.find((x) => x.email && x.email.trim().toLowerCase() === v.toLowerCase());
  return m?.nombre ?? v;
}

/** «Santiago Burghiani» → «Santiago»; un correo → lo de antes de la arroba. */
export function primerNombre(nombre: string): string {
  const t = nombre.trim();
  if (!t) return "";
  return t.includes("@") ? t.split("@")[0] : t.split(/\s+/)[0];
}

/* ---------- La pastilla: lo que se lee de un vistazo ---------- */

export interface EtiquetaControl {
  texto: string;
  tono: "success" | "warning" | "danger";
  /** Todo el detalle, para el cartelito al pasar el mouse. */
  detalle: string;
}

/** El estado con su dato adentro: «Chequeado · Santi», «Sin chequear»,
 *  «Rechazado · Aldana». `nombreDe` pasa del correo al nombre. */
export function etiquetaDeControl(c: ControlDeCobro, nombreDe: (por?: string) => string = (x) => x ?? ""): EtiquetaControl {
  const quien = (x: ChequeoDeCasillero) => primerNombre(nombreDe(x.por)) || ROL_DE_CASILLERO[x.casillero].corto;
  const linea = (x: ChequeoDeCasillero) =>
    `${x.veredicto === "chequeado" ? "Chequeado" : "Rechazado"} por ${ROL_DE_CASILLERO[x.casillero].por}`
    + `${nombreDe(x.por) ? ` (${nombreDe(x.por)})` : ""}${x.en ? ` · ${fechaHora(x.en)}` : ""}${x.nota ? ` — «${x.nota}»` : ""}`;

  if (c.rechazos.length > 0) {
    return {
      texto: `Rechazado · ${c.rechazos.map(quien).join(" y ")}`, tono: "danger",
      detalle: [...c.rechazos, ...c.chequeos].map(linea).join("\n"),
    };
  }
  if (c.chequeos.length > 0) {
    return { texto: `Chequeado · ${c.chequeos.map(quien).join(" y ")}`, tono: "success", detalle: c.chequeos.map(linea).join("\n") };
  }
  if (c.deAntes) {
    return c.conciliado
      ? { texto: "Chequeado · pasarela", tono: "success", detalle: "Está conciliado con el cobro de la pasarela: la plata está ahí." }
      : { texto: "Chequeado · de antes", tono: "success", detalle: "Estaba marcado como chequeado antes del control cruzado (de la planilla o de Finanzas): no dice quién ni cuándo." };
  }
  return {
    texto: "Sin chequear", tono: "warning",
    detalle: "Todavía no lo miró nadie: el director o finanzas tienen que ver el comprobante y confirmar que coincide con lo cargado.",
  };
}

/* ---------- Conciliación y comprobante ---------- */

export type EstadoConciliacion = "conciliado" | "sin-conciliar" | "a-mano";

/** «Conciliado» es que el cobro está atado al pago de la pasarela. Una cuenta
 *  que no tiene pasarela (la Financiera, efectivo, una transferencia) no se
 *  concilia con nada: se prueba con el comprobante, y dice «a mano». */
export function conciliacionDe(procesadores: readonly Pick<Procesador, "id" | "proveedor">[], p: Pago): EstadoConciliacion {
  if (p.movimientoId) return "conciliado";
  const proc = procesadores.find((x) => x.id === p.procesadorId);
  return proc?.proveedor ? "sin-conciliar" : "a-mano";
}

export type ComprobanteDeCobro =
  | { tipo: "archivo"; comprobante: Comprobante }
  | { tipo: "link"; texto: string; url?: string }
  | { tipo: "ninguno" };

/** La prueba del cobro: el archivo que subió el closer, o el link o texto que
 *  traía la planilla. */
export function comprobanteDeCobro(p: Pago): ComprobanteDeCobro {
  if (p.comprobante) return { tipo: "archivo", comprobante: p.comprobante };
  const texto = p.comprobanteLink?.trim() ?? "";
  if (!texto) return { tipo: "ninguno" };
  return { tipo: "link", texto, url: /https?:\/\/[^\s<>"']+/i.exec(texto)?.[0] };
}

export const tieneComprobante = (p: Pago) => comprobanteDeCobro(p).tipo !== "ninguno";

/* ---------- La lista de cobros ---------- */

export interface FilaCobro { id: string; pago: Pago; cuota?: Cuota; venta?: Venta }

export function filasDeCobros(e: Pick<EstadoApp, "cuotas" | "ventas">, pagos: readonly Pago[]): FilaCobro[] {
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  return pagos.map((pago) => {
    const cuota = cuotaDe.get(pago.cuotaId);
    return { id: pago.id, pago, cuota, venta: cuota ? ventaDe.get(cuota.ventaId) : undefined };
  });
}

export type FiltroControl = "todos" | "sin-chequear" | "rechazados" | "chequeados" | "sin-comprobante" | "sin-conciliar";
export const FILTROS_CONTROL: readonly FiltroControl[] = ["todos", "sin-chequear", "rechazados", "chequeados", "sin-comprobante", "sin-conciliar"];

export const TEXTO_DE_FILTRO: Record<FiltroControl, string> = {
  todos: "Todos",
  "sin-chequear": "Sin chequear",
  rechazados: "Rechazados",
  chequeados: "Chequeados",
  "sin-comprobante": "Sin comprobante",
  "sin-conciliar": "Sin conciliar",
};

export function pasaControl(p: Pago, procesadores: readonly Pick<Procesador, "id" | "proveedor">[], f: FiltroControl): boolean {
  switch (f) {
    case "sin-chequear": return controlDeCobro(p).estado === "pendiente";
    case "rechazados": return controlDeCobro(p).estado === "rechazado";
    case "chequeados": return controlDeCobro(p).estado === "chequeado";
    /* Un cobro atado a la pasarela tiene su prueba ahí: no le falta comprobante. */
    case "sin-comprobante": return !tieneComprobante(p) && !p.movimientoId;
    case "sin-conciliar": return conciliacionDe(procesadores, p) === "sin-conciliar";
    default: return true;
  }
}

export interface ResumenControl {
  total: number;
  pendientes: number;
  chequeados: number;
  rechazados: number;
  sinComprobante: number;
  sinConciliar: number;
}

/** Cuántos cobros hay de cada cosa. `pendientes + chequeados + rechazados`
 *  es siempre `total`: cada cobro está en un solo estado. */
export function resumenDeControl(procesadores: readonly Pick<Procesador, "id" | "proveedor">[], pagos: readonly Pago[]): ResumenControl {
  const r: ResumenControl = { total: pagos.length, pendientes: 0, chequeados: 0, rechazados: 0, sinComprobante: 0, sinConciliar: 0 };
  for (const p of pagos) {
    const estado = controlDeCobro(p).estado;
    if (estado === "pendiente") r.pendientes++;
    else if (estado === "chequeado") r.chequeados++;
    else r.rechazados++;
    if (pasaControl(p, procesadores, "sin-comprobante")) r.sinComprobante++;
    if (pasaControl(p, procesadores, "sin-conciliar")) r.sinConciliar++;
  }
  return r;
}

/** El control de cada venta, para la columna de Ventas: cuántos cobros tiene,
 *  cuántos quedan por chequear y cuántos están rechazados. */
export function controlPorVenta(e: Pick<EstadoApp, "pagos" | "cuotas">): Map<ID, { total: number; pendientes: number; rechazados: number }> {
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const por = new Map<ID, { total: number; pendientes: number; rechazados: number }>();
  for (const p of e.pagos) {
    const v = ventaDeCuota.get(p.cuotaId);
    if (!v) continue;
    const x = por.get(v) ?? { total: 0, pendientes: 0, rechazados: 0 };
    x.total++;
    const estado = controlDeCobro(p).estado;
    if (estado === "pendiente") x.pendientes++;
    else if (estado === "rechazado") x.rechazados++;
    por.set(v, x);
  }
  return por;
}

/* ---------- Los cobros de una venta, para el CRM ---------- */

/** Lo que se puede decir de los cobros de una venta de un vistazo: cuántos tienen su
 *  prueba y cuántos están atados al pago de la pasarela. Es la cuenta de las columnas
 *  «Comprobante» y «Conciliado» de la tabla del CRM, con las mismas reglas que la lista de
 *  cobros (`pasaControl`): lo que se ve en una pantalla es lo que se ve en la otra. */
export interface CobrosDeVenta {
  total: number;
  /** Con prueba: un archivo, el link de la planilla, o el pago de la pasarela. */
  conPrueba: number;
  /** Sin archivo ni link y sin pasarela: les falta el comprobante. */
  sinComprobante: number;
  conciliados: number;
  sinConciliar: number;
  /** La cuenta no tiene pasarela (la Financiera, efectivo): se prueba con el comprobante. */
  aMano: number;
}

/** Los cobros de varias ventas como si fueran una: la llamada de la que salieron dos (la mentoría y un upsell). */
export function sumarCobros(xs: readonly CobrosDeVenta[]): CobrosDeVenta {
  const r: CobrosDeVenta = { total: 0, conPrueba: 0, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 0 };
  for (const x of xs) {
    r.total += x.total; r.conPrueba += x.conPrueba; r.sinComprobante += x.sinComprobante;
    r.conciliados += x.conciliados; r.sinConciliar += x.sinConciliar; r.aMano += x.aMano;
  }
  return r;
}

export function cobrosPorVenta(
  e: Pick<EstadoApp, "pagos" | "cuotas" | "procesadores">,
): Map<ID, CobrosDeVenta> {
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const por = new Map<ID, CobrosDeVenta>();
  for (const p of e.pagos) {
    const v = ventaDeCuota.get(p.cuotaId);
    if (!v) continue;
    const x = por.get(v) ?? { total: 0, conPrueba: 0, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 0 };
    x.total++;
    if (pasaControl(p, e.procesadores, "sin-comprobante")) x.sinComprobante++; else x.conPrueba++;
    const c = conciliacionDe(e.procesadores, p);
    if (c === "conciliado") x.conciliados++;
    else if (c === "sin-conciliar") x.sinConciliar++;
    else x.aMano++;
    por.set(v, x);
  }
  return por;
}

/* ---------- Chequear, rechazar, quitar ---------- */

const columnasDe = (c: CasilleroChequeo): Record<"veredicto" | "por" | "en" | "nota", ColumnaDeControl> =>
  c === "director"
    ? { veredicto: "chequeoDirector", por: "chequeoDirectorPor", en: "chequeoDirectorEn", nota: "chequeoDirectorNota" }
    : { veredicto: "chequeoFinanzas", por: "chequeoFinanzasPor", en: "chequeoFinanzasEn", nota: "chequeoFinanzasNota" };

/** El cobro con el casillero llenado (o vaciado, con `veredicto` null). Es la
 *  misma cuenta que hace la base: lo que se ve acá es lo que va a quedar. */
export function conChequeo(
  p: Pago, c: CasilleroChequeo, veredicto: VeredictoChequeo | null, quien: { por?: string; en: string; nota?: string },
): Pago {
  const k = columnasDe(c);
  const nota = veredicto ? quien.nota?.trim() || undefined : undefined;
  return {
    ...p,
    [k.veredicto]: veredicto ?? undefined,
    [k.por]: veredicto ? quien.por : undefined,
    [k.en]: veredicto ? quien.en : undefined,
    [k.nota]: nota,
  };
}

/** Lo que se manda a la base para llenar o vaciar un casillero: sólo sus
 *  columnas, y null borra. */
export function cambiosDeChequeo(
  c: CasilleroChequeo, veredicto: VeredictoChequeo | null, quien: { por?: string; en: string; nota?: string },
): Record<string, unknown> {
  const k = columnasDe(c);
  return {
    [k.veredicto]: veredicto,
    [k.por]: veredicto ? quien.por ?? null : null,
    [k.en]: veredicto ? quien.en : null,
    [k.nota]: veredicto ? quien.nota?.trim() || null : null,
  };
}

/** Todas las columnas del control en blanco, para mandarlas a la base. */
export const CONTROL_EN_BLANCO: Record<ColumnaDeControl, null> = {
  chequeoDirector: null, chequeoDirectorPor: null, chequeoDirectorEn: null, chequeoDirectorNota: null,
  chequeoFinanzas: null, chequeoFinanzasPor: null, chequeoFinanzasEn: null, chequeoFinanzasNota: null,
};

export interface ComprobanteNuevo {
  pago: Pago;
  /** Lo que se manda a la base. */
  cambios: Record<string, unknown>;
  /** Había chequeos contra el comprobante de antes y vuelven a pendiente. */
  reinicia: boolean;
}

/** El cobro con otro comprobante. Si ya tenía un archivo y es otro, lo que se
 *  chequeó contra el de antes no vale: los dos casilleros y el sí/no de antes
 *  (salvo en un cobro atado a la pasarela, que se prueba con ella) vuelven a
 *  pendiente. Agregar el primero, o un archivo a un cobro que sólo traía un
 *  link de la planilla, no reinicia nada: es la misma prueba, mejor guardada.
 *  La base hace lo mismo con un trigger. */
export function conComprobanteNuevo(p: Pago, nuevo: Comprobante): ComprobanteNuevo {
  const otroArchivo = Boolean(p.comprobante) && p.comprobante?.ruta !== nuevo.ruta;
  if (!otroArchivo) return { pago: { ...p, comprobante: nuevo }, cambios: { comprobante: nuevo }, reinicia: false };
  const habiaChequeos = Boolean(p.chequeoDirector || p.chequeoFinanzas) || (Boolean(p.chequeado) && !p.movimientoId);
  const sinNada = Object.fromEntries(COLUMNAS_DE_CONTROL.map((k) => [k, undefined])) as Partial<Pago>;
  const pago: Pago = { ...p, ...sinNada, comprobante: nuevo, ...(p.movimientoId ? {} : { chequeado: undefined }) };
  return {
    pago, reinicia: habiaChequeos,
    cambios: { comprobante: nuevo, ...CONTROL_EN_BLANCO, ...(p.movimientoId ? {} : { chequeado: null }) },
  };
}
