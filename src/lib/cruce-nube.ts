import type { SupabaseClient } from "@supabase/supabase-js";
import { cruceAutomatico, personasDeAgendaYVentas, type DatosCruce, type HerenciaAutomatica } from "./cruce-auto";
import { telefonoNormDe, type RegistroForm } from "./registros-webinar";
import type { Contacto } from "./types";

/* ==================================================================
   El cruce automático de Formularios contra la base (lo corre el cron
   /api/cron/cruce-formularios cada media hora).

   No baja los 50 mil registros: baja las personas que agendaron o compraron
   (unas pocas decenas de miles de bytes) y busca, entre los registros que
   todavía no están unidos, sólo los que comparten con ellas el mail o el
   teléfono. La cascada y la herencia son las de lib/cruce-auto.ts.
   ================================================================== */

const PAGINA = 1000;
const EN_URL = 100;

export interface ResumenCruceNube {
  personas: number;
  candidatos: number;
  unidos: number;
  contactosCompletados: number;
  dudosas: number;
  errores: string[];
}

async function paginado<T>(tabla: string, pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const r = await pedir(desde, desde + PAGINA - 1);
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
    filas.push(...((r.data ?? []) as T[]));
    if ((r.data?.length ?? 0) < PAGINA) return filas;
  }
}

export async function ejecutarCruceAutomatico(db: SupabaseClient, opciones: { limite?: number } = {}): Promise<ResumenCruceNube> {
  const limite = opciones.limite ?? 1000;
  const res: ResumenCruceNube = { personas: 0, candidatos: 0, unidos: 0, contactosCompletados: 0, dudosas: 0, errores: [] };

  const base = {
    contactos: await paginado<Contacto>("contactos", (a, b) => db.from("contactos").select("*").order("id").range(a, b)),
    sesiones: await paginado<DatosCruce["sesiones"][number]>("sesiones", (a, b) => db.from("sesiones").select("id,contactoId,email,invitado,inicia,estado").order("id").range(a, b)),
    leads: await paginado<DatosCruce["leads"][number]>("leads", (a, b) => db.from("leads").select("id,contactoId,nombre,email,telefono,pais").order("id").range(a, b)),
    ventas: await paginado<DatosCruce["ventas"][number]>("ventas", (a, b) => db.from("ventas").select("id,contactoId,contactoNombre,fecha").order("id").range(a, b)),
  };
  const personas = personasDeAgendaYVentas(base);
  res.personas = personas.length;

  /* Los registros sin unir que comparten mail o teléfono con alguna de esas personas. */
  const mails = [...new Set(personas.flatMap((p) => p.emails))];
  const telefonos = [...new Set(personas.map((p) => telefonoNormDe(p.telefono, p.pais)).filter((t): t is string => Boolean(t)))];
  const candidatos = new Map<string, RegistroForm>();
  const buscar = async (columna: "email" | "telefonoNorm", valores: string[]) => {
    for (let i = 0; i < valores.length; i += EN_URL) {
      const lote = valores.slice(i, i + EN_URL);
      const filas = await paginado<RegistroForm>("registros_webinar", (a, b) =>
        db.from("registros_webinar").select("*").is("contactoId", null).in(columna, lote).order("id").range(a, b));
      for (const f of filas) candidatos.set(f.id, f);
    }
  };
  await buscar("email", mails);
  await buscar("telefonoNorm", telefonos);
  res.candidatos = candidatos.size;
  if (candidatos.size === 0) return res;

  const plan = cruceAutomatico({ ...base, registros: [...candidatos.values()] });
  res.dudosas = plan.dudosas;
  const uniones = plan.uniones.slice(0, limite);

  /* Atar cada registro a su contacto: de a un contacto y un método. */
  const grupos = new Map<string, string[]>();
  for (const u of uniones) {
    const k = `${u.contactoId}|${u.metodo}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(u.registroId);
  }
  const ahora = new Date().toISOString();
  const atados = new Set<string>();
  for (const [k, ids] of grupos) {
    const [contactoId, metodo] = k.split("|");
    const r = await db.from("registros_webinar").update({ contactoId, cruce: metodo, cruceEn: ahora } as never).in("id", ids).is("contactoId", null);
    if (r.error) { res.errores.push(`registros_webinar: ${r.error.message}`); continue; }
    for (const id of ids) atados.add(id);
  }
  res.unidos = atados.size;

  /* Lo que heredan los contactos: el anuncio y el webinar sólo si existen (son claves foráneas). */
  const existentes = async (tabla: "ads" | "webinars", ids: string[]): Promise<Set<string>> => {
    const ok = new Set<string>();
    for (let i = 0; i < ids.length; i += EN_URL) {
      const r = await db.from(tabla).select("id").in("id", ids.slice(i, i + EN_URL));
      if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
      for (const x of (r.data ?? []) as { id: string }[]) ok.add(x.id);
    }
    return ok;
  };
  const conUnion = new Set(uniones.filter((u) => atados.has(u.registroId)).map((u) => u.contactoId));
  const herencias = plan.herencias.filter((h) => conUnion.has(h.contactoId));
  const ads = await existentes("ads", [...new Set(herencias.map((h) => h.cambios.origenAdId).filter((x): x is string => Boolean(x)))]);
  const webinars = await existentes("webinars", [...new Set(herencias.map((h) => h.cambios.origenWebinarId).filter((x): x is string => Boolean(x)))]);
  for (const h of herencias) {
    const cambios: HerenciaAutomatica["cambios"] = { ...h.cambios };
    if (cambios.origenAdId && !ads.has(cambios.origenAdId)) delete cambios.origenAdId;
    if (cambios.origenWebinarId && !webinars.has(cambios.origenWebinarId)) delete cambios.origenWebinarId;
    if (Object.keys(cambios).length === 0) continue;
    const r = await db.from("contactos").update(cambios as never).eq("id", h.contactoId);
    if (r.error) res.errores.push(`contactos ${h.contactoId}: ${r.error.message}`);
    else res.contactosCompletados++;
  }
  return res;
}
