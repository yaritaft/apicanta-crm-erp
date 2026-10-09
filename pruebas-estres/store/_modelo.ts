/* Comparar la memoria del store con lo que quedó en la base falsa (no es una prueba).

   Es el «modelo»: después de cada acción, y una vez vaciada la cola de escritura,
   lo que hay en memoria (lo que ven las pantallas) tiene que ser lo que quedó
   guardado (lo que se vería al recargar). Cada diferencia es una de dos cosas:
   un dato que se pierde al recargar, o un dato que la base tiene y la pantalla no. */
import { TABLAS } from "@/lib/supabase";
import { COLUMNAS_QUE_PONE_LA_BASE } from "@/lib/control-cobros";
import { valorPorDefecto } from "./_sql";
import { INTERFACES } from "./_aleatorio";
import ts from "typescript";
import type { BaseFalsa, Fila } from "./_nube";

export const CLAVE_DE_TABLA: Record<string, string> = {
  seguimiento_alumnos: "seguimientos", gastos_recurrentes: "gastosRecurrentes", revisiones_cv: "revisionesCv", ad_insights: "adInsights",
  etapas_servicio: "etapasServicio", tipos_cuenta: "tiposCuenta",
};
export const claveDe = (tabla: string) => CLAVE_DE_TABLA[tabla] ?? tabla;

/** La fila sin null ni undefined (la base devuelve null donde la app no tiene dato) y con las claves ordenadas. */
export function canonico(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canonico(x) ?? null));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = canonico((v as Record<string, unknown>)[k]);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return v;
}

export interface Diferencia {
  tabla: string;
  id: string;
  tipo: "solo-en-memoria" | "solo-en-la-base" | "campo";
  /** Para tipo «campo»: la columna y los dos valores. */
  campo?: string;
  memoria?: unknown;
  base?: unknown;
}

const json = (x: unknown) => JSON.stringify(x);

/** Compara una tabla. `soloEnMemoriaOk`: ids que pueden no estar en la base (p. ej. actividad recortada). */
export function compararTabla(
  base: BaseFalsa, tabla: string, memoria: Fila[], op: { ignorarColumnas?: string[]; permitirDeMas?: boolean } = {},
): Diferencia[] {
  const sql = base.esquema.tablas.get(tabla);
  const salida: Diferencia[] = [];
  const enBase = base.tabla(tabla);
  const idsMem = new Set<string>();
  for (const m of memoria) {
    const id = String(m.id);
    idsMem.add(id);
    const b = enBase.get(id);
    if (!b) { salida.push({ tabla, id, tipo: "solo-en-memoria" }); continue; }
    const cm = (canonico(m) ?? {}) as Record<string, unknown>;
    const cb = (canonico(b) ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(cm), ...Object.keys(cb)])) {
      if (op.ignorarColumnas?.includes(k)) continue;
      if (json(cm[k]) === json(cb[k])) continue;
      /* Memoria sin el dato y la base con el valor por defecto de la columna: es lo mismo. */
      if (cm[k] === undefined && sql?.columnas.has(k)) {
        const d = valorPorDefecto(sql.columnas.get(k)!);
        if (d !== undefined && json(canonico(d)) === json(cb[k])) continue;
      }
      salida.push({ tabla, id, tipo: "campo", campo: k, memoria: cm[k], base: cb[k] });
    }
  }
  if (!op.permitirDeMas) for (const id of enBase.keys()) if (!idsMem.has(id)) salida.push({ tabla, id, tipo: "solo-en-la-base" });
  return salida;
}

/** Compara todo el estado contra la base. */
export function compararTodo(base: BaseFalsa, estado: Record<string, unknown>, tablas: readonly string[] = TABLAS): Diferencia[] {
  const salida: Diferencia[] = [];
  for (const tabla of tablas) {
    const memoria = (estado[claveDe(tabla)] ?? []) as Fila[];
    salida.push(...compararTabla(base, tabla, memoria, {
      /* El cobro lleva, en memoria, quién lo cargó: lo sella la base y no se manda (COLUMNAS_QUE_PONE_LA_BASE). */
      ignorarColumnas: tabla === "pagos" ? ["cargadoPor"] : undefined,
      /* La memoria guarda las últimas 400 de la actividad: la base tiene todas. */
      permitirDeMas: tabla === "actividad",
    }));
  }
  /* Los ajustes son una fila con id 1. */
  salida.push(...compararTabla(base, "ajustes", [{ ...(estado.ajustes as object), id: 1 } as Fila]));
  return salida;
}

/** Una línea legible por diferencia. */
export function describir(d: Diferencia): string {
  const corto = (x: unknown) => { const s = json(x) ?? "undefined"; return s.length > 90 ? `${s.slice(0, 90)}…` : s; };
  if (d.tipo === "campo") return `${d.tabla}[${d.id}].${d.campo}: memoria=${corto(d.memoria)} base=${corto(d.base)}`;
  return `${d.tabla}[${d.id}]: ${d.tipo}`;
}

/* Las columnas de pagos que la base sella (útil para quien arme sus propias comparaciones). */
export const SELLADAS_POR_LA_BASE = COLUMNAS_QUE_PONE_LA_BASE;

/* ---------- El contrato de lo que sale hacia la base ---------- */

/** Qué interface de types.ts es la fila de cada tabla. */
export const INTERFAZ_DE_TABLA: Record<string, string> = {
  pagos: "Pago", ventas: "Venta", cuotas: "Cuota", sesiones: "Sesion", gastos: "Gasto", procesadores: "Procesador",
  ajustes: "Ajustes", contactos: "Contacto", leads: "Lead", alumnos: "Alumno", movimientos: "Movimiento",
  devoluciones: "Devolucion", gastos_recurrentes: "GastoRecurrente", revisiones_cv: "RevisionCv", seguimiento_alumnos: "SeguimientoAlumno",
  testimonios: "Testimonio", equipo: "MiembroEquipo", webinars: "Webinar", tipos_cuenta: "TipoCuenta",
  etapas_servicio: "EtapaServicio", honorarios: "EsquemaPago", liquidaciones: "Liquidacion", traspasos: "Traspaso",
  arqueos: "Arqueo", comentarios: "Comentario", campaigns: "Campaign", adsets: "Adset", ads: "Ad", ad_insights: "AdInsight",
  embudos: "Embudo", actividad: "Actividad", productos: "Producto", etapas: "Etapa", campos: "CampoPersonalizado", metas: "Meta",
  reportes: "Reporte", campanias: "Campania",
};

const admiteNull = (t: ts.TypeNode): boolean =>
  t.kind === ts.SyntaxKind.NullKeyword || (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword)
  || (ts.isUnionTypeNode(t) && t.types.some(admiteNull)) || (ts.isParenthesizedTypeNode(t) && admiteNull(t.type));

/** Los `null` que un upsert manda en campos que el tipo declara obligatorios y sin null. Es lo que queda de un NaN o un
 *  Infinity (JSON.stringify los vuelve null) o de un campo obligatorio que quedó sin valor. Los opcionales sí pueden
 *  llevar null: es como se vacía un campo a propósito. */
export function nulosIndebidos(base: BaseFalsa, desde: number): string[] {
  const salida: string[] = [];
  for (const p of base.log) {
    if (p.n <= desde || p.tipo !== "upsert") continue;
    const interfaz = INTERFAZ_DE_TABLA[p.tabla];
    const campos = interfaz ? INTERFACES.get(interfaz) : undefined;
    if (!campos) continue;
    for (const fila of p.filas ?? []) {
      for (const [k, v] of Object.entries(fila)) {
        if (v !== null) continue;
        const campo = campos.find((c) => c.nombre === k);
        if (campo && !campo.opcional && !admiteNull(campo.tipo)) salida.push(`${p.tabla}[${String(fila.id)}].${k} = null (el tipo no lo admite)`);
      }
    }
  }
  return salida;
}

/** El número del último pedido registrado: para mirar sólo lo que viene después. */
export const ultimoPedido = (base: BaseFalsa) => base.log.length ? base.log[base.log.length - 1].n : 0;

/** Las columnas que sella la base (COLUMNAS_QUE_PONE_LA_BASE) que algún upsert de cobros mandó desde `desde`. Un upsert del cobro
 *  entero con esas columnas puede pisar con «pendiente» lo que otra persona acaba de chequear: sólo viajan por UPDATE. */
export function selladasEnUpsert(base: BaseFalsa, desde: number): string[] {
  const salida: string[] = [];
  for (const p of base.log) {
    if (p.n <= desde || p.tipo !== "upsert" || p.tabla !== "pagos") continue;
    for (const f of p.filas ?? []) for (const k of COLUMNAS_QUE_PONE_LA_BASE) if (k in f) salida.push(`pagos[${String(f.id)}].${k} viaja en un upsert`);
  }
  return salida;
}
