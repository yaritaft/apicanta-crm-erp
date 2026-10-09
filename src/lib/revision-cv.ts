import type { RevisionCv } from "./types";

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
