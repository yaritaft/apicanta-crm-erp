import { sinTildes } from "./crm";
import { crearMotor, siNo, uno, type ColumnaCs, type OrdenCs } from "./tabla-cs";
import type { Alumno, EstadoApp, ID, RevisionCv } from "./types";

/* La revisión de CVs de Customer Success (supabase/revision-cv.sql): lo que Aldana llevaba en su base de Notion «REVISION DE CVS».
   Acá, lo que se guarda de cada revisión; la pantalla, el contador por estado y el importador de su Notion van encima de esto. */

/* Los estados de fábrica, en el orden del proceso: los seis de su Notion (con «Outboarding» escrito como ella lo escribe, que es
   como están cargados). Customer Success los ajusta; lo ya cargado no se reescribe si se cambia un nombre. */
export const ESTADOS_CV: readonly string[] = ["En proceso", "Esperando cliente", "Segunda ronda", "Con Yari", "Cerrado", "Outboarding"];

const textoLimpio = (x: unknown): string => (typeof x === "string" ? x.trim() : "");
const aBool = (x: unknown): boolean => x === true || x === "true" || x === "t" || x === 1;
/** «aaaa-mm-dd» (se descarta la hora si vino), o null: un día suelto se guarda como texto para que no se corra un día. */
const aDia = (x: unknown): string | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);

/** Una revisión con todas sus columnas, limpia: lo que no viene queda vacío, no se inventa nada. */
export function revisionCvNormal(r: Partial<RevisionCv> & Pick<RevisionCv, "id">): RevisionCv {
  const ahora = new Date().toISOString();
  return {
    id: r.id,
    nombre: textoLimpio(r.nombre),
    telefono: textoLimpio(r.telefono),
    alumnoId: typeof r.alumnoId === "string" && r.alumnoId ? r.alumnoId : null,
    estado: textoLimpio(r.estado),
    cvRecibido: aBool(r.cvRecibido),
    correccion1: aBool(r.correccion1),
    correccion2: aBool(r.correccion2),
    fechaInicio: aDia(r.fechaInicio),
    linkCv: textoLimpio(r.linkCv),
    linkLinkedin: textoLimpio(r.linkLinkedin),
    linkCorreccion: textoLimpio(r.linkCorreccion),
    linkLoom: textoLimpio(r.linkLoom),
    notas: typeof r.notas === "string" ? r.notas : "",
    mensajes: typeof r.mensajes === "string" ? r.mensajes : "",
    origen: r.origen === "importado" ? "importado" : "manual",
    creadoEn: r.creadoEn ?? ahora,
    actualizadoEn: r.actualizadoEn ?? ahora,
    actualizadoPor: textoLimpio(r.actualizadoPor),
  };
}

/* ---------- La tabla ---------- */

/** El estado de una revisión que todavía no tiene ninguno. */
export const SIN_ESTADO_CV = "Sin estado";
/** Los estados en los que la corrección ya terminó: no se cuentan como pendientes (Aldana pidió contar sólo lo que falta). */
export const ESTADOS_FINALES_CV: readonly string[] = ["Cerrado", "Outboarding"];

/* Sin mayúsculas ni tildes: en la base de Notion los estados están escritos de varias maneras («Con yari», «Con Yari»). */
const clave = (t: string): string => sinTildes(t.trim()).toLowerCase();

export interface FilaRevisionCv {
  id: ID;
  revision: RevisionCv;
  /* El estado, o «Sin estado». */
  estado: string;
  /* El alumno de la app, si la revisión está atada a uno. */
  alumno?: Alumno;
}

export function filasRevisionesCv(e: Pick<EstadoApp, "revisionesCv" | "alumnos">): FilaRevisionCv[] {
  const alumnos = new Map(e.alumnos.map((a) => [a.id, a] as const));
  return (e.revisionesCv ?? []).map((r0) => {
    const r = revisionCvNormal(r0);
    return { id: r.id, revision: r, estado: r.estado || SIN_ESTADO_CV, alumno: r.alumnoId ? alumnos.get(r.alumnoId) : undefined };
  });
}

export type ClaveRevisionCv =
  | "nombre" | "telefono" | "alumno" | "estado" | "cvRecibido" | "correccion1" | "correccion2" | "fechaInicio"
  | "linkCv" | "linkLinkedin" | "linkCorreccion" | "linkLoom" | "mensajes" | "notas";

const conLink = (t: string): string[] => [t.trim() ? "Con link" : "Sin link"];

export const COLUMNAS_REVISIONES_CV: ColumnaCs<FilaRevisionCv, ClaveRevisionCv>[] = [
  { clave: "nombre", titulo: "Nombre", grupo: "Alumno", valores: (f) => uno(f.revision.nombre), orden: (f) => sinTildes(f.revision.nombre), ancho: 220 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Alumno", valores: (f) => uno(f.revision.telefono), ancho: 150 },
  { clave: "alumno", titulo: "Alumno en la app", grupo: "Alumno", valores: (f) => uno(f.alumno?.nombre ?? "Sin atar"), orden: (f) => sinTildes(f.alumno?.nombre ?? ""), ancho: 180,
    ayuda: "El alumno de la app al que está atada la revisión, si se pudo saber de quién es." },
  { clave: "estado", titulo: "Estado", grupo: "Revisión", valores: (f) => [f.estado], ancho: 150 },
  { clave: "cvRecibido", titulo: "CV recibido", grupo: "Revisión", valores: (f) => siNo(f.revision.cvRecibido), ancho: 110 },
  { clave: "correccion1", titulo: "Corrección 1 enviada", grupo: "Revisión", valores: (f) => siNo(f.revision.correccion1), ancho: 140 },
  { clave: "correccion2", titulo: "Corrección 2 enviada", grupo: "Revisión", valores: (f) => siNo(f.revision.correccion2), ancho: 140 },
  { clave: "fechaInicio", titulo: "Fecha de inicio", grupo: "Revisión", valores: (f) => uno(f.revision.fechaInicio), orden: (f) => f.revision.fechaInicio ?? "", fecha: true, ancho: 130 },
  { clave: "linkCv", titulo: "CV (Drive)", grupo: "Links", valores: (f) => conLink(f.revision.linkCv), texto: (f) => f.revision.linkCv, ancho: 130 },
  { clave: "linkLinkedin", titulo: "LinkedIn", grupo: "Links", valores: (f) => conLink(f.revision.linkLinkedin), texto: (f) => f.revision.linkLinkedin, ancho: 130 },
  { clave: "linkCorreccion", titulo: "Documento de corrección", grupo: "Links", valores: (f) => conLink(f.revision.linkCorreccion), texto: (f) => f.revision.linkCorreccion, ancho: 170 },
  { clave: "linkLoom", titulo: "Loom de Yari", grupo: "Links", valores: (f) => conLink(f.revision.linkLoom), texto: (f) => f.revision.linkLoom, ancho: 130 },
  { clave: "mensajes", titulo: "Mensajes", grupo: "Seguimiento", valores: (f) => uno(f.revision.mensajes), ancho: 150 },
  { clave: "notas", titulo: "Notas", grupo: "Seguimiento", valores: (f) => [f.revision.notas.trim() ? "Con notas" : "Sin notas"], texto: (f) => f.revision.notas, ancho: 240 },
];

/* Las de su base de Notion; el CV, el LinkedIn y el alumno atado se pueden sumar desde «Columnas». */
export const VISIBLES_REVISIONES_CV: ClaveRevisionCv[] = [
  "nombre", "estado", "cvRecibido", "correccion1", "correccion2", "fechaInicio", "linkCorreccion", "linkLoom", "telefono", "mensajes", "notas",
];
export const ORDEN_REVISIONES_CV: OrdenCs<ClaveRevisionCv>[] = [{ clave: "fechaInicio", desc: true }];
export const MOTOR_REVISIONES_CV = crearMotor(COLUMNAS_REVISIONES_CV, "cvr");

export function coincideRevisionCv(f: FilaRevisionCv, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  const r = f.revision;
  return [r.nombre, r.telefono, r.notas, r.mensajes, r.linkCorreccion, r.linkLoom, f.alumno?.nombre].some((x) => sinTildes(x ?? "").includes(t));
}

/* ---------- Lo que se cuenta arriba de la tabla ---------- */

export interface ContadorCv {
  /* Como está escrito en la lista de estados. */
  estado: string;
  n: number;
  /* Cómo están escritos en las filas los estados que cuentan (para filtrar por ellos). */
  valores: string[];
}

/** Cuántas revisiones hay en cada estado pendiente de la lista (lo que ya terminó, «Cerrado» y «Outboarding», no se cuenta), y las que no tienen
 *  estado. Se compara sin mayúsculas ni tildes. «Segunda ronda» cuenta: la corrección todavía no terminó. */
export function contadoresCv(filas: readonly FilaRevisionCv[], lista: readonly string[]): ContadorCv[] {
  const finales = new Set(ESTADOS_FINALES_CV.map(clave));
  const por = new Map<string, string[]>();
  for (const f of filas) {
    const k = clave(f.estado);
    const escritos = por.get(k) ?? [];
    if (!escritos.includes(f.estado)) escritos.push(f.estado);
    por.set(k, escritos);
  }
  const cuenta = (estado: string): ContadorCv => {
    const k = clave(estado);
    return { estado, n: filas.filter((f) => clave(f.estado) === k).length, valores: por.get(k) ?? [estado] };
  };
  const pendientes = lista.filter((estado, i) => !finales.has(clave(estado)) && lista.findIndex((x) => clave(x) === clave(estado)) === i).map(cuenta);
  const sinEstado = cuenta(SIN_ESTADO_CV);
  return sinEstado.n > 0 ? [...pendientes, sinEstado] : pendientes;
}

