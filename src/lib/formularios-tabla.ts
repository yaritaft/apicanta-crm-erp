import { diaDeNegocio } from "./dia-negocio";
import { num, pct } from "./format";
import { VACIAS } from "./crm-tabla";
import type { ColumnaFiltrable, OrdenDe } from "./tabla-filtros";
import { UTMS_FORM, type RegistroForm } from "./registros-webinar";

/* ==================================================================
   Formularios como tabla: las columnas con sus filtros «como en Excel»
   (lib/tabla-filtros.ts) y los cálculos del pie, «como en Notion».

   Debajo de cada columna hay un cálculo sobre lo que se ve con los filtros
   puestos: cuántas filas, cuántas tienen dato, cuántos valores distintos, el
   porcentaje, el rango de fechas, o cuántas tienen un valor en particular
   («Unido», «Sin contactar»). Cada columna arranca con el suyo y se cambia
   con un clic en el pie; la elección va en el link (?calc=telefono=vacios).

   Lógica pura: sin React ni base.
   ================================================================== */

export interface ContextoForm {
  /* El nombre del anuncio del que vino (los anuncios los tiene la app). */
  anuncioDe: (r: RegistroForm) => string;
}

export type GrupoColumnaForm = "Formulario" | "Seguimiento" | "Origen";

export interface ColumnaForm extends ColumnaFiltrable<RegistroForm> {
  grupo: GrupoColumnaForm;
  /* Si la fila «tiene dato» en esta columna (para «con dato», «sin dato» y sus porcentajes). */
  lleno: (r: RegistroForm) => boolean;
  /* Cómo se llama «con dato» en el pie: «Con teléfono». */
  conDato: string;
  /* Los valores fijos de la columna: cada uno se puede contar en el pie («Unido», «No unido»…). */
  fijos?: string[];
  /* El cálculo con el que arranca el pie. */
  calculo: string;
}

export const GRUPO_UNIDO = "Unido";
export const GRUPO_NO_UNIDO = "No unido";
export const GRUPO_SIN_REVISAR = "Sin revisar";
export const CONTACTADO_SI = "Contactado";
export const CONTACTADO_NO = "Sin contactar";
export const CON_AGENDA = "Con agenda";
export const SIN_AGENDA = "Sin agenda";

const FIJOS_GRUPO = [GRUPO_UNIDO, GRUPO_NO_UNIDO, GRUPO_SIN_REVISAR];

/** Cómo se anotó una persona: la landing o la hoja del Excel de la que vino. */
export const origenDe = (r: RegistroForm) => (r.origen === "landing" ? "Landing" : r.origenDetalle ? `Excel · ${r.origenDetalle}` : "Excel");

export function columnasDeFormularios(ctx: ContextoForm): ColumnaForm[] {
  const telefono = (r: RegistroForm) => [r.telefono, r.telefonoNorm].filter(Boolean).join(" ");
  const utms = (r: RegistroForm) => UTMS_FORM.filter((u) => r.utm?.[u]).map((u) => `${u.replace(/^utm_/, "")}: ${r.utm![u]}`);
  return [
    {
      clave: "nombre", titulo: "Persona", grupo: "Formulario", calculo: "contar", conDato: "Con nombre",
      valores: (r) => [r.nombre || r.email || VACIAS], orden: (r) => (r.nombre ?? r.email).toLowerCase(),
      texto: (r) => `${r.nombre ?? ""} ${r.email}`, lleno: (r) => Boolean(r.nombre),
    },
    {
      clave: "registro", titulo: "Se anotó", grupo: "Formulario", calculo: "rango", conDato: "Con fecha", fecha: true,
      valores: (r) => [diaDeNegocio(r.registradoEn) || VACIAS], orden: (r) => +new Date(r.registradoEn), lleno: (r) => Boolean(r.registradoEn),
    },
    {
      clave: "email", titulo: "Email", grupo: "Formulario", calculo: "unicos", conDato: "Con mail",
      valores: (r) => [r.email || VACIAS], orden: (r) => r.email, lleno: (r) => Boolean(r.email),
    },
    {
      clave: "telefono", titulo: "Teléfono", grupo: "Formulario", calculo: "llenos", conDato: "Con teléfono",
      valores: (r) => [r.telefono ? "Con teléfono" : "Sin teléfono"], orden: (r) => r.telefonoNorm ?? r.telefono ?? "",
      texto: telefono, lleno: (r) => Boolean(r.telefono),
    },
    {
      clave: "pais", titulo: "País", grupo: "Formulario", calculo: "unicos", conDato: "Con país",
      valores: (r) => [r.pais || VACIAS], orden: (r) => r.pais ?? "", lleno: (r) => Boolean(r.pais),
    },
    {
      clave: "respuestas", titulo: "Respuestas", grupo: "Formulario", calculo: "llenos", conDato: "Con respuestas",
      valores: (r) => [r.respuestas.length ? "Con respuestas" : "Sin respuestas"], orden: (r) => r.respuestas.length,
      texto: (r) => r.respuestas.map((x) => `${x.pregunta} ${x.respuesta}`).join(" "), lleno: (r) => r.respuestas.length > 0,
    },
    {
      clave: "grupo", titulo: "Grupo de WhatsApp", grupo: "Seguimiento", calculo: `valor:${GRUPO_UNIDO}`, conDato: "Revisados", fijos: FIJOS_GRUPO,
      valores: (r) => [r.grupo === "unido" ? GRUPO_UNIDO : r.grupo === "no-unido" ? GRUPO_NO_UNIDO : GRUPO_SIN_REVISAR],
      orden: (r) => (r.grupo === "unido" ? 2 : r.grupo === "no-unido" ? 1 : 0), lleno: (r) => Boolean(r.grupo),
    },
    {
      clave: "contactado", titulo: "Contactado", grupo: "Seguimiento", calculo: `valor:${CONTACTADO_SI}`, conDato: "Contactados", fijos: [CONTACTADO_SI, CONTACTADO_NO],
      valores: (r) => [r.contactado ? CONTACTADO_SI : CONTACTADO_NO], orden: (r) => (r.contactado ? +new Date(r.contactadoEn ?? 0) || 1 : 0),
      lleno: (r) => r.contactado,
    },
    {
      clave: "anuncio", titulo: "Anuncio", grupo: "Origen", calculo: "llenos", conDato: "Con anuncio",
      valores: (r) => [ctx.anuncioDe(r) || VACIAS], orden: (r) => ctx.anuncioDe(r), lleno: (r) => Boolean(ctx.anuncioDe(r)),
    },
    {
      clave: "utm", titulo: "UTMs", grupo: "Origen", calculo: "llenos", conDato: "Con UTMs",
      valores: (r) => (utms(r).length ? utms(r) : [VACIAS]), orden: (r) => Object.values(r.utm ?? {}).join(" "),
      texto: (r) => utms(r).join(" "), lleno: (r) => utms(r).length > 0,
    },
    {
      clave: "agenda", titulo: "Agenda", grupo: "Origen", calculo: `valor:${CON_AGENDA}`, conDato: "Con agenda", fijos: [CON_AGENDA, SIN_AGENDA],
      valores: (r) => [r.contactoId ? CON_AGENDA : SIN_AGENDA], orden: (r) => (r.contactoId ? 1 : 0), lleno: (r) => Boolean(r.contactoId),
    },
    {
      clave: "origen", titulo: "Origen del dato", grupo: "Origen", calculo: "unicos", conDato: "Con origen",
      valores: (r) => [origenDe(r)], orden: (r) => r.origen, lleno: () => true,
    },
  ];
}

export const columnasPorClave = (cols: ColumnaForm[]): Record<string, ColumnaForm> => Object.fromEntries(cols.map((c) => [c.clave, c]));

export const ORDEN_FORM_POR_DEFECTO: OrdenDe[] = [{ clave: "registro", desc: true }];

/* ---------- Los cálculos del pie ---------- */

export const SIN_CALCULO = "ninguno";

export interface OpcionCalculo { id: string; texto: string }

/** Lo que se puede calcular debajo de una columna, en el orden del menú. */
export function opcionesDeCalculo(col: ColumnaForm): OpcionCalculo[] {
  const o: OpcionCalculo[] = [
    { id: SIN_CALCULO, texto: "Ninguno" },
    { id: "contar", texto: "Contar filas" },
    { id: "llenos", texto: col.conDato },
    { id: "vacios", texto: "Sin dato" },
    { id: "pct-llenos", texto: "% con dato" },
    { id: "pct-vacios", texto: "% sin dato" },
    { id: "unicos", texto: "Valores distintos" },
  ];
  if (col.fecha) o.push({ id: "rango", texto: "Rango de fechas" });
  for (const v of col.fijos ?? []) o.push({ id: `valor:${v}`, texto: v });
  return o;
}

export interface ResultadoCalculo {
  /* Qué es lo que se cuenta, en chico: «Con teléfono». */
  etiqueta: string;
  /* El número (o el rango), en grande. */
  valor: string;
  /* El porcentaje sobre las filas que se ven, si lo hay. */
  sub?: string;
}

const ES_CALCULO_DE_VALOR = /^valor:/;

/** Si el cálculo existe para esa columna; si no, el que trae de entrada. */
export const calculoValido = (col: ColumnaForm, id: string | undefined): string =>
  id && opcionesDeCalculo(col).some((o) => o.id === id) ? id : col.calculo;

const porciento = (n: number, total: number) => (total > 0 ? pct((n / total) * 100, 0) : "—");
const diaCorto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** El cálculo de una columna sobre las filas que se ven; null si se eligió «Ninguno». */
export function calcular(col: ColumnaForm, filas: readonly RegistroForm[], calculo: string): ResultadoCalculo | null {
  const id = calculoValido(col, calculo);
  const total = filas.length;
  switch (true) {
    case id === SIN_CALCULO:
      return null;
    case id === "contar":
      return { etiqueta: "Filas", valor: num(total) };
    case id === "llenos": {
      const n = filas.filter(col.lleno).length;
      return { etiqueta: col.conDato, valor: num(n), sub: porciento(n, total) };
    }
    case id === "vacios": {
      const n = filas.filter((r) => !col.lleno(r)).length;
      return { etiqueta: "Sin dato", valor: num(n), sub: porciento(n, total) };
    }
    case id === "pct-llenos":
      return { etiqueta: "% con dato", valor: porciento(filas.filter(col.lleno).length, total) };
    case id === "pct-vacios":
      return { etiqueta: "% sin dato", valor: porciento(filas.filter((r) => !col.lleno(r)).length, total) };
    case id === "unicos": {
      const distintos = new Set(filas.flatMap((r) => col.valores(r)).filter((v) => v !== VACIAS));
      return { etiqueta: "Distintos", valor: num(distintos.size) };
    }
    case id === "rango": {
      const dias = filas.map((r) => col.valores(r)[0]).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      if (!dias.length) return { etiqueta: "Rango", valor: "—" };
      const [a, b] = [dias[0], dias[dias.length - 1]];
      return { etiqueta: "Rango", valor: a === b ? diaCorto(a) : `${diaCorto(a)} al ${diaCorto(b)}` };
    }
    case ES_CALCULO_DE_VALOR.test(id): {
      const v = id.slice("valor:".length);
      const n = filas.filter((r) => col.valores(r).includes(v)).length;
      return { etiqueta: v, valor: num(n), sub: porciento(n, total) };
    }
    default:
      return null;
  }
}

/* ---------- En el link: ?calc=telefono=vacios,grupo=valor:No unido ---------- */

export function calculosDeURL(cols: ColumnaForm[], texto: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const par of (texto ?? "").split(",")) {
    const i = par.indexOf("=");
    if (i < 1) continue;
    const col = cols.find((c) => c.clave === par.slice(0, i));
    if (col) out[col.clave] = calculoValido(col, par.slice(i + 1));
  }
  return out;
}

/** Lo que se escribe en el link: sólo lo que no es lo de siempre (null si todo está como arrancó). */
export function calculosAURL(cols: ColumnaForm[], elegidos: Record<string, string>): string | null {
  const t = cols
    .filter((c) => elegidos[c.clave] !== undefined && elegidos[c.clave] !== c.calculo)
    .map((c) => `${c.clave}=${elegidos[c.clave]}`)
    .join(",");
  return t || null;
}
