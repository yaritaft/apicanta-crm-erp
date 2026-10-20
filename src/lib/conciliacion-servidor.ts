import type { SupabaseClient } from "@supabase/supabase-js";
import { CLAVE_CRUCE, type EstadoDelCruce } from "./cruce-nube";
import { palabrasDeNombre } from "./cruce-formularios";
import type { MetodoCruce } from "./registros-webinar";

/* ==================================================================
   Conciliación del origen, del lado del servidor.

   Quien concilia (Aldana en Finanzas, Marketing) no siempre puede leer la tabla
   de formularios: la política de `registros_webinar` es del área Webinars, y
   son los datos de decenas de miles de personas. Acá el servidor, con la clave
   de servicio y después de preguntar el tipo de cuenta (lib/permisos-servidor.ts),
   contesta sólo lo que hace falta para las pocas decenas de personas del mes:
   los formularios que se parecen a ellas, y nada más.
   ================================================================== */

const PAGINA = 1000;
const EN_URL = 100;
/** Cuántos formularios con nombre parecido se traen por persona: después la pantalla se queda con los que de verdad se llaman igual. */
const POR_NOMBRE = 60;

/** Lo que la pantalla necesita de cada formulario: sin IP, navegador, cookies ni respuestas. */
export const COLUMNAS_LIGERAS = "id,email,nombre,telefono,telefonoNorm,pais,utm,adId,webinarId,fechaWebinar,registradoEn,descartados,contactoId,cruce,origen,origenDetalle";

export type FilaLigera = Record<string, unknown> & { id: string };

/** Sólo las columnas ligeras, pase lo que pase con lo que devolvió la base (nunca viaja la IP, el navegador ni las cookies). */
const ligera = (f: FilaLigera): FilaLigera => Object.fromEntries(COLUMNAS_LIGERAS.split(",").filter((k) => k in f).map((k) => [k, f[k]])) as FilaLigera;

type Respuesta = { data: unknown[] | null; error: { message: string } | null };

async function paginado(tabla: string, pedir: (desde: number, hasta: number) => PromiseLike<Respuesta>): Promise<FilaLigera[]> {
  const filas: FilaLigera[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const r = await pedir(desde, desde + PAGINA - 1);
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
    filas.push(...((r.data ?? []) as FilaLigera[]));
    if ((r.data?.length ?? 0) < PAGINA) return filas;
  }
}

const trozos = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Un patrón de `ilike` para una palabra, sin depender de las tildes: cada vocal (y la ñ) vale por cualquier letra. */
export const patronDePalabra = (p: string) => `%${p.replace(/[^\p{L}\p{N}]/gu, "").replace(/[aeiouáéíóúüñ]/giu, "_")}%`;

/** Cuáles de estos contactos ya tienen algún formulario unido. */
export async function contactosConFormulario(db: SupabaseClient, ids: string[]): Promise<string[]> {
  const con = new Set<string>();
  for (const lote of trozos([...new Set(ids)], EN_URL)) {
    const filas = await paginado("registros_webinar", (a, b) => db.from("registros_webinar").select("id,contactoId").in("contactoId", lote).order("id").range(a, b));
    for (const f of filas) if (typeof f.contactoId === "string") con.add(f.contactoId);
  }
  return [...con];
}

export interface PedidoCandidatos { emails: string[]; telefonos: string[]; nombres: string[] }

/** Los formularios sin unir que comparten mail o teléfono con alguna de estas personas, o se llaman parecido. */
export async function candidatos(db: SupabaseClient, p: PedidoCandidatos): Promise<FilaLigera[]> {
  const salida = new Map<string, FilaLigera>();
  const buscar = async (columna: "email" | "telefonoNorm", valores: string[]) => {
    for (const lote of trozos([...new Set(valores)], EN_URL)) {
      const filas = await paginado("registros_webinar", (a, b) =>
        db.from("registros_webinar").select(COLUMNAS_LIGERAS).is("contactoId", null).in(columna, lote).order("id").range(a, b));
      for (const f of filas) salida.set(f.id, f);
    }
  };
  await buscar("email", p.emails);
  await buscar("telefonoNorm", p.telefonos);
  /* Por nombre: las dos palabras más largas (apellido y nombre) tienen que estar. */
  for (const nombre of new Set(p.nombres)) {
    const ps = palabrasDeNombre(nombre).sort((a, b) => b.length - a.length).slice(0, 2);
    if (ps.length < 2) continue;
    const r = await db.from("registros_webinar").select(COLUMNAS_LIGERAS).is("contactoId", null)
      .ilike("nombre", patronDePalabra(ps[0])).ilike("nombre", patronDePalabra(ps[1])).order("registradoEn", { ascending: false }).limit(POR_NOMBRE);
    if (r.error) throw new Error(`registros_webinar: ${r.error.message}`);
    for (const f of (r.data ?? []) as FilaLigera[]) salida.set(f.id, f);
  }
  return [...salida.values()];
}

/** La búsqueda a mano: por mail, por teléfono o por nombre. Trae también los ya unidos (la pantalla los muestra sin dejar unirlos). */
export async function buscar(db: SupabaseClient, q: string, limite = 30): Promise<FilaLigera[]> {
  const texto = q.trim().slice(0, 120);
  if (texto.length < 3) return [];
  let consulta = db.from("registros_webinar").select(COLUMNAS_LIGERAS);
  const digitos = texto.replace(/\D/g, "");
  if (texto.includes("@")) consulta = consulta.ilike("email", `%${texto.replace(/[%_]/g, "")}%`);
  else if (digitos.length >= 6 && digitos.length >= texto.replace(/\s/g, "").length - 3) consulta = consulta.like("telefonoNorm", `%${digitos}%`);
  else {
    const palabras = texto.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length >= 2).slice(0, 4);
    if (palabras.length === 0) return [];
    for (const w of palabras) consulta = consulta.ilike("nombre", patronDePalabra(w));
  }
  const r = await consulta.order("registradoEn", { ascending: false }).limit(limite);
  if (r.error) throw new Error(`registros_webinar: ${r.error.message}`);
  return (r.data ?? []) as FilaLigera[];
}

export type ResultadoUnir = { ok: true; registro: FilaLigera } | { ok: false; error: string };

/** Une un formulario con un contacto. Sólo si sigue sin unir: si otra persona (o el proceso automático) llegó antes, no lo pisa. */
export async function unir(db: SupabaseClient, registroId: string, contactoId: string, cruce: MetodoCruce): Promise<ResultadoUnir> {
  const c = await db.from("contactos").select("id").eq("id", contactoId).limit(1);
  if (c.error) return { ok: false, error: c.error.message };
  if (!c.data?.length) return { ok: false, error: "Esa persona no tiene ficha de contacto: no se puede unir." };
  const r = await db.from("registros_webinar")
    .update({ contactoId, cruce, cruceEn: new Date().toISOString() } as never)
    .eq("id", registroId).is("contactoId", null).select(COLUMNAS_LIGERAS);
  if (r.error) return { ok: false, error: r.error.message };
  const fila = (r.data ?? [])[0] as FilaLigera | undefined;
  if (!fila) return { ok: false, error: "Ese formulario ya se unió con otra persona, o ya no está. Actualizá la lista." };
  return { ok: true, registro: ligera(fila) };
}

/** «No es esta persona»: el formulario no se vuelve a proponer para ella. */
export async function noEs(db: SupabaseClient, registroId: string, personaId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await db.from("registros_webinar").select("descartados").eq("id", registroId).limit(1);
  if (r.error) return { ok: false, error: r.error.message };
  const fila = (r.data ?? [])[0] as { descartados?: unknown } | undefined;
  if (!fila) return { ok: false, error: "Ese formulario ya no está." };
  const ya = Array.isArray(fila.descartados) ? (fila.descartados as string[]) : [];
  if (ya.includes(personaId)) return { ok: true };
  const w = await db.from("registros_webinar").update({ descartados: [...ya, personaId] } as never).eq("id", registroId);
  return w.error ? { ok: false, error: w.error.message } : { ok: true };
}

export type EstadoLeido = { sinTabla: true } | { sinTabla?: false; estado: EstadoDelCruce | null };

/** Cuándo corrió por última vez el cruce automático y qué hizo. */
export async function estadoDelCruce(db: SupabaseClient): Promise<EstadoLeido> {
  const r = await db.from("cron_estado").select("ejecutadoEn,ok,resultado,ultimaUnionEn").eq("clave", CLAVE_CRUCE).limit(1);
  if (r.error) {
    /* La tabla no existe todavía (no se corrió supabase/cron-estado.sql). */
    if (r.error.code === "42P01" || r.error.code === "PGRST205" || /does not exist|could not find the table/i.test(r.error.message)) return { sinTabla: true };
    throw new Error(`cron_estado: ${r.error.message}`);
  }
  return { estado: ((r.data ?? [])[0] as EstadoDelCruce | undefined) ?? null };
}
