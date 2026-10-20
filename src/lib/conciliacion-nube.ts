import { hayNube, nube } from "./supabase";
import { nuevoRegistro, telefonoNormDe, type MetodoCruce, type RegistroForm } from "./registros-webinar";
import { palabrasDeNombre } from "./cruce-formularios";
import type { Pendiente } from "./pendientes-conciliar";
import type { EstadoDelCruce } from "./cruce-nube";

/* ==================================================================
   Conciliación del origen, del lado del navegador: habla con /api/conciliacion
   (lib/conciliacion-servidor.ts), que contesta sólo lo que hace falta de la
   tabla de formularios. Quien concilia no lee esa tabla de punta a punta.
   ================================================================== */

export { hayNube };

export class ErrorConciliacion extends Error {}

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nube) {
    const { data } = await nube.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let r: Response;
  try {
    r = await fetch("/api/conciliacion", { method: "POST", headers, body: JSON.stringify(cuerpo) });
  } catch {
    throw new ErrorConciliacion("No hay conexión: no pude consultar los formularios.");
  }
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (r.status === 401) throw new ErrorConciliacion("Tu sesión venció. Volvé a entrar.");
  if (!r.ok || !j || j.error) throw new ErrorConciliacion(j?.error ?? "No pude consultar los formularios.");
  return j;
}

/** Una fila ligera de la ruta, como el registro que entiende la lógica del cruce. */
export function aRegistro(x: Record<string, unknown>): RegistroForm {
  const o = Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null)) as unknown as RegistroForm;
  return { ...nuevoRegistro({ ...o, email: o.email ?? "" }, o.registradoEn), ...o, respuestas: [], contactado: false, descartados: Array.isArray(o.descartados) ? o.descartados : [] };
}

/** De estos contactos, cuáles ya tienen un formulario unido. */
export async function pedirUnidos(contactoIds: string[]): Promise<Set<string>> {
  const salida = new Set<string>();
  for (let i = 0; i < contactoIds.length; i += 400) {
    const r = await llamar<{ unidos: string[] }>({ accion: "unidos", contactoIds: contactoIds.slice(i, i + 400) });
    for (const id of r.unidos) salida.add(id);
  }
  return salida;
}

/** Los formularios sin unir que se parecen a estas personas (mismo mail o teléfono, o nombre parecido). */
export async function pedirCandidatos(pendientes: Pendiente[]): Promise<RegistroForm[]> {
  const emails = [...new Set(pendientes.flatMap((p) => p.persona.emails))];
  const telefonos = [...new Set(pendientes.map((p) => telefonoNormDe(p.persona.telefono, p.persona.pais)).filter((t): t is string => Boolean(t)))];
  const nombres = pendientes.map((p) => p.persona.nombre).filter((n) => palabrasDeNombre(n).length >= 2);
  if (emails.length + telefonos.length + nombres.length === 0) return [];
  const r = await llamar<{ registros: Record<string, unknown>[] }>({ accion: "candidatos", emails, telefonos, nombres: nombres.slice(0, 200) });
  return r.registros.map(aRegistro);
}

export async function buscarFormularios(q: string): Promise<RegistroForm[]> {
  const r = await llamar<{ registros: Record<string, unknown>[] }>({ accion: "buscar", q });
  return r.registros.map(aRegistro);
}

export async function unirFormulario(registroId: string, contactoId: string, cruce: MetodoCruce): Promise<RegistroForm> {
  const r = await llamar<{ registro: Record<string, unknown> }>({ accion: "unir", registroId, contactoId, cruce });
  return aRegistro(r.registro);
}

export async function descartarFormulario(registroId: string, personaId: string): Promise<void> {
  await llamar({ accion: "noes", registroId, personaId });
}

export type EstadoDelCruceLeido = { sinTabla: true } | { sinTabla?: false; estado: EstadoDelCruce | null };

export async function pedirEstadoDelCruce(): Promise<EstadoDelCruceLeido> {
  return llamar<EstadoDelCruceLeido>({ accion: "estado" });
}
