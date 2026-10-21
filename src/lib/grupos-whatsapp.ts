import { diaDeNegocio } from "./dia-negocio";
import { pct } from "./format";
import { VACIAS } from "./crm-tabla";
import { csvDe } from "./csv";
import { clavesDeTelefono } from "./telefonos-wpp";
import { normalizarTelefono, telefonoLegible } from "./telefonos";
import { isoDePais, type RegistroForm } from "./registros-webinar";
import type { ColumnasDe } from "./tabla-filtros";
import type { GrupoWhatsapp, MiembroWhatsapp } from "./whatsapp";

/* ==================================================================
   Grupos de WhatsApp: cada grupo con sus números, y todos sus integrantes.

   Lo que dice el lector (servicios/whatsapp-lector) de cada grupo:
   - Integrantes: cuántos están adentro hoy (con teléfono).
   - En WhatsApp: los de arriba más los que tienen el número oculto: es la cifra que cuenta WhatsApp en la información del grupo.
   - Entraron: todos los que pasaron por el grupo = los que están + los que salieron.
   - Salieron: los que estuvieron y ya no están.
   - Retención: los que siguen adentro sobre todos los que entraron.
   (Sólo cuenta desde que el lector mira el grupo: quien salió antes de eso no se ve.)
   WhatsApp esconde el teléfono de algunos integrantes: van aparte, «Sin teléfono».

   Lógica pura: sin React ni base. La pantalla (components/grupos-whatsapp)
   la dibuja con los mismos filtros tipo Excel y el mismo pie que Formularios.
   ================================================================== */

export interface WebinarParaGrupo { id: string; titulo: string; fecha: string }

export interface FilaGrupo {
  id: string;
  nombre: string;
  webinarId: string | null;
  /** «21/10/2026» (con su título si dice algo más que la fecha), o «Sin webinar». */
  webinar: string;
  /** Adentro hoy, con teléfono. */
  dentro: number;
  /** Adentro hoy, con teléfono y sin él (número oculto): lo que dice WhatsApp en la información del grupo. */
  total: number;
  /** Los que pasaron por el grupo: los que están más los que salieron. */
  entraron: number;
  salieron: number;
  /** Los que siguen adentro sobre los que entraron (0 a 100); null si nadie entró. */
  retencion: number | null;
  /** Integrantes que WhatsApp muestra sin teléfono. */
  sinTelefono: number;
  ultimaFoto: string | null;
}

const fechaLinda = (iso: string) => diaDeNegocio(iso).split("-").reverse().join("/");
export const SIN_WEBINAR = "Sin webinar";

/** El día del webinar, y su título si dice algo más que esa fecha («Taller 21/10/2026» no hace falta repetirlo). */
export function textoDeWebinar(w: WebinarParaGrupo | undefined): string {
  if (!w) return SIN_WEBINAR;
  const dia = fechaLinda(w.fecha);
  return w.titulo.includes(dia) ? dia : `${dia} · ${w.titulo}`;
}

export function filasDeGrupos(grupos: readonly GrupoWhatsapp[], miembros: readonly MiembroWhatsapp[], webinars: readonly WebinarParaGrupo[]): FilaGrupo[] {
  const cuenta = new Map<string, { dentro: number; salieron: number }>();
  for (const m of miembros) {
    const c = cuenta.get(m.grupoId) ?? cuenta.set(m.grupoId, { dentro: 0, salieron: 0 }).get(m.grupoId)!;
    if (m.dentro) c.dentro++; else c.salieron++;
  }
  const porWebinar = new Map(webinars.map((w) => [w.id, w]));
  return grupos.map((g) => {
    const c = cuenta.get(g.id) ?? { dentro: 0, salieron: 0 };
    const entraron = c.dentro + c.salieron;
    return {
      id: g.id, nombre: g.nombre || "Grupo sin nombre", webinarId: g.webinarId, webinar: textoDeWebinar(g.webinarId ? porWebinar.get(g.webinarId) : undefined),
      dentro: c.dentro, total: c.dentro + g.sinTelefono, entraron, salieron: c.salieron, retencion: entraron > 0 ? (c.dentro / entraron) * 100 : null,
      sinTelefono: g.sinTelefono, ultimaFoto: g.ultimaFoto,
    };
  });
}

/** Los columnas de la tabla de grupos, para los filtros tipo Excel (lib/tabla-filtros.ts). */
export const COLUMNAS_GRUPOS: ColumnasDe<FilaGrupo> = {
  nombre: { clave: "nombre", titulo: "Grupo", valores: (f) => [f.nombre], orden: (f) => f.nombre.toLowerCase() },
  webinar: { clave: "webinar", titulo: "Webinar", valores: (f) => [f.webinar], orden: (f) => (f.webinarId ? f.webinar.split(" · ")[0].split("/").reverse().join("-") : "") },
  dentro: { clave: "dentro", titulo: "Integrantes", numerica: true, valores: (f) => [String(f.dentro)], orden: (f) => f.dentro },
  total: { clave: "total", titulo: "En WhatsApp", numerica: true, valores: (f) => [String(f.total)], orden: (f) => f.total },
  entraron: { clave: "entraron", titulo: "Entraron", numerica: true, valores: (f) => [String(f.entraron)], orden: (f) => f.entraron },
  salieron: { clave: "salieron", titulo: "Salieron", numerica: true, valores: (f) => [String(f.salieron)], orden: (f) => f.salieron },
  retencion: { clave: "retencion", titulo: "Retención", numerica: true, valores: (f) => [f.retencion === null ? VACIAS : pct(f.retencion, 0)], orden: (f) => f.retencion ?? "" },
  sinTelefono: { clave: "sinTelefono", titulo: "Sin teléfono", numerica: true, valores: (f) => [String(f.sinTelefono)], orden: (f) => f.sinTelefono },
  ultima: { clave: "ultima", titulo: "Última lectura", fecha: true, valores: (f) => [f.ultimaFoto ? diaDeNegocio(f.ultimaFoto) : VACIAS], orden: (f) => (f.ultimaFoto ? +new Date(f.ultimaFoto) : "") },
};
export const ORDEN_GRUPOS_POR_DEFECTO = [{ clave: "webinar", desc: true }, { clave: "nombre", desc: false }];

/** Los totales del pie de la tabla de grupos, sobre lo que se ve. */
export function totalesDeGrupos(filas: readonly FilaGrupo[]) {
  const t = { grupos: filas.length, webinars: new Set(filas.filter((f) => f.webinarId).map((f) => f.webinarId)).size, sinWebinar: filas.filter((f) => !f.webinarId).length,
    dentro: 0, total: 0, entraron: 0, salieron: 0, sinTelefono: 0, retencion: null as number | null };
  for (const f of filas) { t.dentro += f.dentro; t.total += f.total; t.entraron += f.entraron; t.salieron += f.salieron; t.sinTelefono += f.sinTelefono; }
  t.retencion = t.entraron > 0 ? (t.dentro / t.entraron) * 100 : null;
  return t;
}

export function csvDeGrupos(filas: readonly FilaGrupo[]): string {
  return csvDe(
    ["Grupo", "Webinar", "Integrantes", "En WhatsApp", "Entraron", "Salieron", "Retención %", "Sin teléfono", "Última lectura"],
    filas.map((f) => [f.nombre, f.webinar, f.dentro, f.total, f.entraron, f.salieron, f.retencion === null ? "" : Math.round(f.retencion), f.sinTelefono, f.ultimaFoto ? diaDeNegocio(f.ultimaFoto) : ""]),
  );
}

/* ---------- Los integrantes ---------- */

export type EstadoIntegrante = "Dentro" | "Salió";

export interface FilaIntegrante {
  /** El grupo y el teléfono: único en toda la tabla. */
  id: string;
  /** La clave del lector (código de país + número, sin signos). */
  telefono: string;
  grupoId: string;
  grupo: string;
  webinar: string;
  estado: EstadoIntegrante;
  entro: string | null;
  salio: string | null;
  /** El nombre con el que se anotó, si se pudo reconocer su teléfono entre los registros del webinar. */
  persona: string;
}

/** Quién es cada clave de teléfono, según los registros del webinar (Formularios): nombre, o el mail si no dejó nombre. */
export function personasPorTelefono(registros: readonly Pick<RegistroForm, "nombre" | "email" | "telefono" | "pais">[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of registros) {
    const quien = r.nombre?.trim() || r.email;
    for (const clave of clavesDeTelefono(r.telefono, isoDePais(r.pais))) if (!m.has(clave)) m.set(clave, quien);
  }
  return m;
}

export function filasDeIntegrantes(
  miembros: readonly MiembroWhatsapp[], grupos: readonly GrupoWhatsapp[], webinars: readonly WebinarParaGrupo[], personas: ReadonlyMap<string, string> = new Map(),
): FilaIntegrante[] {
  const porGrupo = new Map(grupos.map((g) => [g.id, g]));
  const porWebinar = new Map(webinars.map((w) => [w.id, w]));
  return miembros.map((m) => {
    const g = porGrupo.get(m.grupoId);
    return {
      id: `${m.grupoId}|${m.telefono}`, telefono: m.telefono, grupoId: m.grupoId, grupo: g?.nombre || "Grupo sin nombre",
      webinar: textoDeWebinar(g?.webinarId ? porWebinar.get(g.webinarId) : undefined),
      estado: m.dentro ? "Dentro" : "Salió", entro: m.entro, salio: m.salio, persona: personas.get(m.telefono) ?? "",
    };
  });
}

export const telefonoDeClave = (clave: string) => telefonoLegible(`+${clave}`);

export const COLUMNAS_INTEGRANTES: ColumnasDe<FilaIntegrante> = {
  telefono: { clave: "telefono", titulo: "Teléfono", valores: (f) => [f.telefono], orden: (f) => f.telefono, texto: (f) => `${f.telefono} ${telefonoDeClave(f.telefono)}` },
  persona: { clave: "persona", titulo: "Persona", valores: (f) => [f.persona || VACIAS], orden: (f) => f.persona.toLowerCase() },
  grupo: { clave: "grupo", titulo: "Grupo", valores: (f) => [f.grupo], orden: (f) => f.grupo.toLowerCase() },
  webinar: { clave: "webinar", titulo: "Webinar", valores: (f) => [f.webinar], orden: (f) => (f.webinar === SIN_WEBINAR ? "" : f.webinar.split(" · ")[0].split("/").reverse().join("-")) },
  estado: { clave: "estado", titulo: "Estado", valores: (f) => [f.estado], orden: (f) => (f.estado === "Dentro" ? 1 : 0) },
  entro: { clave: "entro", titulo: "Entró", fecha: true, valores: (f) => [f.entro ? diaDeNegocio(f.entro) : VACIAS], orden: (f) => (f.entro ? +new Date(f.entro) : "") },
  salio: { clave: "salio", titulo: "Salió", fecha: true, valores: (f) => [f.salio ? diaDeNegocio(f.salio) : VACIAS], orden: (f) => (f.salio ? +new Date(f.salio) : "") },
};
export const ORDEN_INTEGRANTES_POR_DEFECTO = [{ clave: "webinar", desc: true }, { clave: "grupo", desc: false }, { clave: "estado", desc: true }];

/** Los totales del pie de la tabla de integrantes. */
export function totalesDeIntegrantes(filas: readonly FilaIntegrante[]) {
  const dentro = filas.filter((f) => f.estado === "Dentro").length;
  return { total: filas.length, dentro, salieron: filas.length - dentro, grupos: new Set(filas.map((f) => f.grupoId)).size, conNombre: filas.filter((f) => f.persona).length };
}

export function csvDeIntegrantes(filas: readonly FilaIntegrante[]): string {
  return csvDe(
    ["Teléfono", "Persona", "Grupo", "Webinar", "Estado", "Entró", "Salió"],
    filas.map((f) => [`+${f.telefono}`, f.persona, f.grupo, f.webinar === SIN_WEBINAR ? "" : f.webinar, f.estado, f.entro ? diaDeNegocio(f.entro) : "", f.salio ? diaDeNegocio(f.salio) : ""]),
  );
}

/* ---------- Para ManyChat: los registrados a quienes escribirles ---------- */

/** El teléfono como lo pide WhatsApp para escribirle: con «+» y el país; un celular argentino lleva el 9 («+54 9 11…»), que la clave interna de
    la app no tiene. Vacío si no se entiende como teléfono. */
export function telefonoParaImportar(telefono: string | null | undefined, pais: string | null | undefined): string {
  const n = normalizarTelefono(telefono, isoDePais(pais ?? undefined));
  if (!n.e164) return "";
  return n.cc === "54" && n.nacional.length === 10 ? `+549${n.nacional}` : n.e164;
}

/** El CSV para importar en ManyChat (Contactos → Importar): nombre, apellido, teléfono con el «+» y mail. `sinTelefono` son los que no
    tienen un teléfono que se entienda: van igual, con el mail, pero ManyChat los va a rechazar si tampoco tienen mail. */
export function csvParaManyChat(registros: readonly Pick<RegistroForm, "nombre" | "email" | "telefono" | "pais" | "fechaWebinar">[]): { texto: string; sinTelefono: number } {
  let sinTelefono = 0;
  const filas = registros.map((r) => {
    const partes = (r.nombre ?? "").trim().split(/\s+/).filter(Boolean);
    const telefono = telefonoParaImportar(r.telefono, r.pais);
    if (!telefono) sinTelefono++;
    return [partes[0] ?? "", partes.slice(1).join(" "), telefono, r.email ?? "", r.pais ?? "", r.fechaWebinar ?? ""];
  });
  return { texto: csvDe(["First Name", "Last Name", "Phone", "Email", "Country", "Webinar"], filas), sinTelefono };
}

