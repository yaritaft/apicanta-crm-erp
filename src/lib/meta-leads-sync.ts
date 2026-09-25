import type { SupabaseClient } from "@supabase/supabase-js";
import { idAd, tokenDeSistema } from "./meta";
import {
  datosPersonales, formularioPorId, formulariosDe, leadPorId, leadsDe, paginaPorId, paginasDelNegocio, respuestasDe,
  type FormularioMeta, type LeadMeta, type PaginaMeta,
} from "./meta-leads";
import { aniosDeTexto, nivelDeIngles, respuestaA, webinarDeUtm } from "./calendly";
import { claveEmail, completar } from "./contactos";
import { nubeServidor } from "./servidor";
import { normalizarUtm, reglaQueCalza } from "./utms";
import type { Contacto, Lead, ReglaUtm } from "./types";

/* ==================================================================
   Los formularios de Meta entran solos al CRM.

   Entran por webhook: cada vez que alguien se anota, Meta avisa (ver
   app/api/meta/leads/webhook) y se pide ese lead a la API. No hay un
   cron que consulte cada tanto: con muchos formularios, eso se comería
   el límite de Meta. Lo que ya estaba antes de activar los avisos se
   trae una vez con el botón de Ajustes (los últimos 90 días, lo que
   guarda Meta).

   Por cada lead:
   - El contacto: el mismo email es la misma persona. Si ya estaba, se
     completa lo que le faltaba; si no, se crea. Queda atado al anuncio
     (origenAdId, el de la jerarquía de Meta, así cuenta en el costo por
     lead) y con los UTMs que dice Meta: source facebook/instagram,
     medium "formulario", campaign y content = la campaña y el anuncio.
   - La inscripción queda en el contacto (extra.formulariosMeta): una por
     formulario enviado, con su webinar. Así se cuenta a quien se anota a
     dos webinars, sin abrirle dos oportunidades.
   - La oportunidad, sólo si no tenía ninguna, como con Calendly.
   - El webinar: el de la regla de Ajustes → UTMs que calce, o si no, el
     de la fecha que trae el nombre de la campaña, el conjunto, el anuncio
     o el formulario ("[WEBINAR 23/09]").

   Al final, "Formularios" de cada webinar se completa con las
   inscripciones, sin pisar lo cargado a mano (extra.formulariosAuto,
   como "Asistieron al vivo").

   Reingresar el mismo lead no duplica nada: la inscripción se reconoce
   por el id del lead en Meta.
   ================================================================== */

const DIA = 86_400_000;
const ETIQUETA = "Formulario de Meta";

export interface InscripcionMeta {
  leadgenId: string;
  formularioId: string;
  formulario: string;
  webinarId?: string;
  campania?: string;
  anuncio?: string;
  plataforma?: string;
  creado: string;
  respuestas: { pregunta: string; respuesta: string }[];
}

export interface ResultadoLeadsMeta {
  paginas: string[];
  formularios: { nombre: string; estado: string; leads: number }[];
  leadsLeidos: number;
  inscripcionesNuevas: number;
  contactosNuevos: number;
  leadsNuevos: number;
  webinarsActualizados: number;
  errores: string[];
}

/* PostgREST: undefined no es "dejalo como está", es "no lo mandes". */
const limpio = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const exacto = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const inscripcionesDe = (c: Pick<Contacto, "extra"> | null | undefined): InscripcionMeta[] =>
  Array.isArray(c?.extra?.formulariosMeta) ? (c!.extra.formulariosMeta as InscripcionMeta[]) : [];

/* Lo que Meta dice del origen, como la fila "Pauta Meta" del estándar de
   UTMs: meta / paid / la campaña / el conjunto / el anuncio. */
function utmDeMeta(l: LeadMeta): Record<string, string> {
  return Object.fromEntries(Object.entries({
    utm_source: "meta",
    utm_medium: "paid",
    utm_campaign: l.campania,
    utm_term: l.conjunto,
    utm_content: l.anuncio,
  }).filter(([, v]) => v)) as Record<string, string>;
}

/* "[V2][WEBINAR 23/09] - col, mex y per" → el webinar del 23/09. Se usa el
   mismo criterio que con los UTMs de Calendly (el día y mes en Argentina,
   el más cercano a cuándo se anotó). */
function webinarDeNombres(nombres: (string | undefined)[], webinars: { id: string; fecha: string }[], cuando: string): string | undefined {
  for (const n of nombres) {
    /* El estándar: la campaña se llama webinar_aaaammdd. */
    const estandar = webinarDeUtm({ utm_campaign: (n ?? "").trim().toLowerCase() }, webinars, cuando);
    if (estandar) return estandar;
    if (!n || !/webinar|lanzamiento|\bweb\b/i.test(n)) continue;
    const m = n.match(/(\d{1,2})[/.-](\d{1,2})(?!\d)/);
    if (!m) continue;
    const id = webinarDeUtm({ utm_source: "Webinar", utm_medium: `${m[1]}-${m[2]}` }, webinars, cuando);
    if (id) return id;
  }
  return undefined;
}

interface Contexto {
  db: SupabaseClient;
  webinars: { id: string; fecha: string }[];
  reglas: ReglaUtm[];
  etapaInicial: string | null;
  /* Las inscripciones que ya están guardadas: para no volver a procesarlas. */
  conocidas: Set<string>;
}

/* `conConocidas`: para la carga de 90 días, las inscripciones que ya están,
   así no se vuelven a procesar. El webhook trae de a una y no le hace falta:
   reingresar la misma reemplaza la inscripción, no la duplica. */
async function contexto(db: SupabaseClient, conConocidas = true): Promise<Contexto> {
  const [w, a, et, c] = await Promise.all([
    db.from("webinars").select("id,fecha"),
    db.from("ajustes").select("reglasUtm").limit(1),
    db.from("etapas").select("id,orden,esGanada,esPerdida"),
    conConocidas
      ? db.from("contactos").select("extra").not("extra->formulariosMeta", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [w, a, et, c]) if (r.error) throw new Error(r.error.message);
  const etapas = ((et.data ?? []) as { id: string; orden: number; esGanada?: boolean; esPerdida?: boolean }[])
    .filter((x) => !x.esGanada && !x.esPerdida)
    .sort((x, y) => x.orden - y.orden);
  const conocidas = new Set<string>();
  for (const fila of (c.data ?? []) as Pick<Contacto, "extra">[]) for (const i of inscripcionesDe(fila)) conocidas.add(i.leadgenId);
  return {
    db,
    webinars: (w.data ?? []) as { id: string; fecha: string }[],
    reglas: (((a.data ?? [])[0] as { reglasUtm?: ReglaUtm[] } | undefined)?.reglasUtm ?? []),
    etapaInicial: etapas[0]?.id ?? null,
    conocidas,
  };
}

/** Guarda un lead de Meta: contacto, inscripción y, si hace falta, la oportunidad. */
async function ingresar(ctx: Contexto, l: LeadMeta, f: FormularioMeta, res: ResultadoLeadsMeta): Promise<void> {
  const { db } = ctx;
  const persona = datosPersonales(l);
  const qa = respuestasDe(l, f);
  const utm = utmDeMeta(l);
  const regla = reglaQueCalza(ctx.reglas, normalizarUtm(utm));
  const webinarId = regla?.webinarId
    ?? webinarDeNombres([l.campania, l.conjunto, l.anuncio, f.nombre], ctx.webinars, l.creado);
  const inscripcion: InscripcionMeta = {
    leadgenId: l.id, formularioId: f.id, formulario: f.nombre, webinarId,
    campania: l.campania, anuncio: l.anuncio, plataforma: l.plataforma, creado: l.creado, respuestas: qa,
  };
  const del = {
    telefono: persona.telefono,
    pais: persona.pais,
    inglesNivel: nivelDeIngles(respuestaA(qa, /ingles/)),
    aniosExperiencia: aniosDeTexto(respuestaA(qa, /(anos.*program|program.*anos|experiencia)/)),
    tecnologias: respuestaA(qa, /(lenguaje|framework|tecnolog)/),
    formacion: respuestaA(qa, /(formacion|estudio)/),
    sueldoUsd: respuestaA(qa, /(ganas|sueldo|salario)/),
  };

  /* ---------- 1. El contacto: el mismo email es la misma persona ---------- */
  const email = claveEmail(persona.email);
  const busqueda = email
    ? await db.from("contactos").select("*").ilike("email", exacto(email)).limit(1)
    : { data: [], error: null };
  if (busqueda.error) throw new Error(`contactos: ${busqueda.error.message}`);
  const previo = (busqueda.data?.[0] ?? null) as Contacto | null;
  const ya = inscripcionesDe(previo);

  const contacto: Contacto = previo
    ? {
        ...previo,
        telefono: completar(previo.telefono, del.telefono),
        pais: completar(previo.pais, del.pais),
        inglesNivel: completar(previo.inglesNivel, del.inglesNivel),
        aniosExperiencia: completar(previo.aniosExperiencia, del.aniosExperiencia),
        tecnologias: completar(previo.tecnologias, del.tecnologias),
        formacion: completar(previo.formacion, del.formacion),
        sueldoUsd: completar(previo.sueldoUsd, del.sueldoUsd),
        origenAdId: completar(previo.origenAdId, l.anuncioId ? idAd(l.anuncioId) : undefined),
        origenWebinarId: completar(previo.origenWebinarId, webinarId),
        utm: completar(previo.utm, utm),
        extra: { ...(previo.extra ?? {}), formulariosMeta: [...ya.filter((i) => i.leadgenId !== l.id), inscripcion] },
      }
    : {
        id: `con_meta_${l.id}`,
        nombre: persona.nombre || persona.email || persona.telefono || "Sin nombre",
        email: persona.email ?? "",
        ...del,
        origenCanal: webinarId ? "webinar" : "otro",
        origenAdId: l.anuncioId ? idAd(l.anuncioId) : undefined,
        origenWebinarId: webinarId, utm,
        creadoEn: l.creado,
        extra: { formulariosMeta: [inscripcion] },
      };
  const rc = await db.from("contactos").upsert(limpio(contacto), { defaultToNull: false });
  if (rc.error) throw new Error(`contactos: ${rc.error.message}`);
  if (!previo) res.contactosNuevos++;
  res.inscripcionesNuevas++;
  ctx.conocidas.add(l.id);

  /* ---------- 2. La oportunidad: sólo si no tenía ninguna ---------- */
  const suya = await db.from("leads").select("id").eq("contactoId", contacto.id).limit(1);
  if (suya.error) throw new Error(`leads: ${suya.error.message}`);
  if (suya.data?.length) return;
  const ahora = new Date().toISOString();
  const lead: Lead = {
    id: contacto.id, contactoId: contacto.id,
    nombre: contacto.nombre, email: contacto.email, telefono: contacto.telefono, pais: contacto.pais,
    fuente: ETIQUETA, campania: l.campania, inglesNivel: contacto.inglesNivel, aniosExperiencia: contacto.aniosExperiencia,
    etapaId: ctx.etapaInicial ?? "", monto: 0, moneda: "USD",
    responsable: "", etiquetas: [ETIQUETA], webinarId,
    creadoEn: l.creado, actualizadoEn: ahora, extra: {},
  };
  const rl = await db.from("leads").upsert(limpio({ ...lead, etapaId: lead.etapaId || undefined }), { defaultToNull: false });
  if (rl.error) throw new Error(`leads: ${rl.error.message}`);
  res.leadsNuevos++;
}

/* "Formularios" de cada webinar = sus inscripciones. Como "Asistieron al
   vivo": no se pisa un número cargado a mano; sólo se escribe si el campo
   está en 0 o todavía tiene el último número que puso esto. */
async function completarFormularios(ctx: Contexto, res: ResultadoLeadsMeta, soloWebinars?: Set<string>): Promise<void> {
  const { db } = ctx;
  const c = await db.from("contactos").select("extra").not("extra->formulariosMeta", "is", null);
  if (c.error) { res.errores.push(`contactos: ${c.error.message}`); return; }
  const porWebinar = new Map<string, number>();
  for (const fila of (c.data ?? []) as Pick<Contacto, "extra">[]) {
    for (const i of inscripcionesDe(fila)) {
      if (i.webinarId && (!soloWebinars || soloWebinars.has(i.webinarId))) porWebinar.set(i.webinarId, (porWebinar.get(i.webinarId) ?? 0) + 1);
    }
  }
  if (porWebinar.size === 0) return;
  const w = await db.from("webinars").select("id,formularios,extra").in("id", [...porWebinar.keys()]);
  if (w.error) { res.errores.push(`webinars: ${w.error.message}`); return; }
  for (const fila of (w.data ?? []) as { id: string; formularios: number; extra?: Record<string, unknown> | null }[]) {
    const n = porWebinar.get(fila.id) ?? 0;
    const extra = { ...(fila.extra ?? {}) };
    const auto = typeof extra.formulariosAuto === "number" ? extra.formulariosAuto : undefined;
    const aMano = fila.formularios !== 0 && fila.formularios !== auto;
    if (aMano || n === fila.formularios) continue;
    extra.formulariosAuto = n;
    const u = await db.from("webinars").update({ formularios: n, extra }).eq("id", fila.id);
    if (u.error) { res.errores.push(`webinar ${fila.id}: ${u.error.message}`); continue; }
    res.webinarsActualizados++;
  }
}

const resultadoVacio = (): ResultadoLeadsMeta => ({
  paginas: [], formularios: [], leadsLeidos: 0, inscripcionesNuevas: 0,
  contactosNuevos: 0, leadsNuevos: 0, webinarsActualizados: 0, errores: [],
});

export interface AvisoLeadgen { leadgen_id?: string; page_id?: string; form_id?: string }

/**
 * Lo que manda el webhook: por cada aviso, se pide el lead a la API (el
 * cuerpo del aviso no se usa para los datos: lo podría haber escrito
 * cualquiera; la firma se revisa antes, en la ruta) y se guarda.
 */
export async function ingresarAvisosMeta(avisos: AvisoLeadgen[]): Promise<ResultadoLeadsMeta> {
  const res = resultadoVacio();
  const token = tokenDeSistema();
  if (!token) { res.errores.push("Falta META_SYSTEM_TOKEN."); return res; }
  const db = nubeServidor();
  if (!db) { res.errores.push("Falta SUPABASE_SERVICE_ROLE_KEY."); return res; }
  const ctx = await contexto(db, false);
  const paginas = new Map<string, PaginaMeta>();
  const formularios = new Map<string, FormularioMeta>();
  const webinarsTocados = new Set<string>();

  for (const a of avisos) {
    if (!a.leadgen_id || !a.page_id) continue;
    try {
      let p = paginas.get(a.page_id);
      if (!p) { p = await paginaPorId(a.page_id, token); paginas.set(a.page_id, p); }
      const l = await leadPorId(a.leadgen_id, a.form_id ?? "", p);
      const fid = l.formularioId || a.form_id || "";
      let f = formularios.get(fid);
      if (!f) {
        f = fid ? await formularioPorId(fid, p) : { id: "", nombre: "Formulario de Meta", estado: "", preguntas: {} };
        formularios.set(fid, f);
      }
      res.leadsLeidos++;
      const antes = res.inscripcionesNuevas;
      await ingresar(ctx, l, f, res);
      if (res.inscripcionesNuevas > antes) {
        const regla = reglaQueCalza(ctx.reglas, normalizarUtm(utmDeMeta(l)));
        const w = regla?.webinarId ?? webinarDeNombres([l.campania, l.conjunto, l.anuncio, f.nombre], ctx.webinars, l.creado);
        if (w) webinarsTocados.add(w);
      }
    } catch (err) {
      res.errores.push(`lead ${a.leadgen_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  res.paginas = [...paginas.values()].map((p) => p.nombre);
  if (webinarsTocados.size) await completarFormularios(ctx, res, webinarsTocados);
  return res;
}

/**
 * Trae los leads de los formularios de Meta de los últimos `dias` y los
 * guarda: la carga de lo anterior a los avisos, con el botón de Ajustes. `limite` corta cuántos nuevos procesa por corrida: lo que queda,
 * lo toma la siguiente (reingresar no duplica).
 */
export async function sincronizarLeadsMeta({ dias = 3, limite = 400 }: { dias?: number; limite?: number } = {}): Promise<ResultadoLeadsMeta> {
  const res = resultadoVacio();
  const token = tokenDeSistema();
  if (!token) { res.errores.push("Falta META_SYSTEM_TOKEN: sin el token de sistema no se pueden leer los formularios."); return res; }
  const db = nubeServidor();
  if (!db) { res.errores.push("Falta SUPABASE_SERVICE_ROLE_KEY: no se pueden guardar los leads."); return res; }

  let paginas: PaginaMeta[];
  try {
    paginas = await paginasDelNegocio(token);
  } catch (err) {
    res.errores.push(err instanceof Error ? err.message : String(err));
    return res;
  }
  res.paginas = paginas.map((p) => p.nombre);
  if (paginas.length === 0) {
    res.errores.push("El usuario del sistema no tiene ninguna página asignada: asignale la página en el Business Manager (con pages_show_list).");
    return res;
  }

  const ctx = await contexto(db);
  const desde = new Date(Date.now() - Math.min(Math.max(dias, 1), 90) * DIA);
  let procesados = 0;

  for (const p of paginas) {
    let formularios: FormularioMeta[];
    try {
      formularios = await formulariosDe(p);
    } catch (err) {
      res.errores.push(`${p.nombre}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const f of formularios) {
      let leads: LeadMeta[];
      try {
        leads = await leadsDe(f, p, desde);
      } catch (err) {
        res.errores.push(`${f.nombre}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      res.formularios.push({ nombre: f.nombre, estado: f.estado, leads: leads.length });
      res.leadsLeidos += leads.length;
      for (const l of leads.sort((a, b) => a.creado.localeCompare(b.creado))) {
        if (ctx.conocidas.has(l.id)) continue;
        if (procesados >= limite) break;
        try {
          await ingresar(ctx, l, f, res);
        } catch (err) {
          res.errores.push(`lead ${l.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
        procesados++;
      }
    }
  }

  await completarFormularios(ctx, res);
  return res;
}
