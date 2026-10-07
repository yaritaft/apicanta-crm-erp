"use client";

import { useSyncExternalStore } from "react";
import { hayNube, nube, tablaFaltante } from "./supabase";
import { filaParaBase, type RegistroForm } from "./registros-webinar";

/* ==================================================================
   Los registros de la landing, del lado del navegador.

   A diferencia del resto de las tablas, ésta NO se baja entera al abrir la
   app: son miles de filas (una por persona y por webinar, y la base histórica
   del Excel puede pasar las 25.000) y casi nadie las mira. Se piden de a un
   webinar cuando se abre Formularios, y quedan en memoria mientras la
   pestaña esté abierta. El selector de webinars sale de una vista resumida
   (registros_webinar_resumen), que pesa una fila por webinar.

   Sin la nube (la demo local) viven en el navegador. Sin la tabla creada
   (supabase/registros-webinar.sql) la pantalla avisa en vez de romper.
   ================================================================== */

export type EstadoRegistros = "inicial" | "cargando" | "listo" | "local" | "sin-tabla" | "error";

export interface ResumenWebinar {
  fechaWebinar?: string;
  webinarId?: string;
  registros: number;
  unidos: number;
  noUnidos: number;
  contactados: number;
}

interface Vista {
  estado: EstadoRegistros;
  error: string;
  resumen: ResumenWebinar[];
  registros: RegistroForm[];
  /** Qué webinars están cargados en memoria («todos», una fecha o «sin»). */
  cargados: string[];
}

const CLAVE_LOCAL = "apicanta.erp.registros.v1";
const PAGINA = 1000;

const filas = new Map<string, RegistroForm>();
const cargados = new Set<string>();
let resumen: ResumenWebinar[] = [];
let estado: EstadoRegistros = "inicial";
let error = "";
let vista: Vista = { estado, error, resumen, registros: [], cargados: [] };
const oyentes = new Set<() => void>();
const VISTA_SERVIDOR: Vista = { ...vista };

function avisar() {
  vista = { estado, error, resumen, registros: [...filas.values()], cargados: [...cargados] };
  oyentes.forEach((f) => f());
}

function poner(e: EstadoRegistros, msg = "") {
  estado = e; error = msg;
  avisar();
}

export function useRegistrosNube(): Vista {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => { oyentes.delete(f); }; },
    () => vista,
    () => VISTA_SERVIDOR,
  );
}

/* ---------- sin nube: el navegador ---------- */

function leerLocal(): RegistroForm[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE_LOCAL);
    return crudo ? (JSON.parse(crudo) as RegistroForm[]) : [];
  } catch { return []; }
}
function escribirLocal() {
  try { window.localStorage.setItem(CLAVE_LOCAL, JSON.stringify([...filas.values()])); } catch { /* cuota llena o modo privado */ }
}

function resumirLocal(): ResumenWebinar[] {
  const m = new Map<string, ResumenWebinar>();
  for (const r of filas.values()) {
    const k = r.fechaWebinar ?? "sin";
    const x = m.get(k) ?? { fechaWebinar: r.fechaWebinar, webinarId: r.webinarId, registros: 0, unidos: 0, noUnidos: 0, contactados: 0 };
    x.registros++;
    if (r.grupo === "unido") x.unidos++;
    if (r.grupo === "no-unido") x.noUnidos++;
    if (r.contactado) x.contactados++;
    m.set(k, x);
  }
  return [...m.values()];
}

/* ---------- cargar ---------- */

const msg = (e: { message?: string }) => e.message ?? "No se pudo leer la tabla de registros.";

/** El resumen por webinar (una fila por webinar). */
export async function cargarResumen(): Promise<void> {
  if (!nube) {
    if (!cargados.has("todos")) { for (const r of leerLocal()) filas.set(r.id, r); cargados.add("todos"); }
    resumen = resumirLocal();
    poner("local");
    return;
  }
  if (estado === "inicial") poner("cargando");
  const r = await nube.from("registros_webinar_resumen").select("*").order("fechaWebinar", { ascending: false });
  if (r.error) {
    /* La vista o la tabla no existe: hay que correr el SQL. */
    if (tablaFaltante(r.error)) { poner("sin-tabla"); return; }
    poner("error", msg(r.error));
    return;
  }
  resumen = ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
    fechaWebinar: (x.fechaWebinar as string | null) ?? undefined,
    webinarId: (x.webinarId as string | null) ?? undefined,
    registros: Number(x.registros ?? 0), unidos: Number(x.unidos ?? 0), noUnidos: Number(x.no_unidos ?? 0), contactados: Number(x.contactados ?? 0),
  }));
  poner("listo");
}

/* Lo que vuelve de la base trae null donde no hay dato: se pasa a «sin dato». */
function deBase(x: Record<string, unknown>): RegistroForm {
  const o = Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null)) as unknown as RegistroForm;
  return { ...o, respuestas: Array.isArray(o.respuestas) ? o.respuestas : [], descartados: Array.isArray(o.descartados) ? o.descartados : [], contactado: Boolean(o.contactado) };
}

/** Trae los registros de un webinar (su fecha, aaaa-mm-dd), de los que no
 *  tienen fecha («sin») o todos («todos»: de a mil, puede tardar). Con `forzar`
 *  vuelve a pedirlos aunque ya estén. */
export async function cargarRegistros(clave: string, forzar = false): Promise<void> {
  if (!nube) { await cargarResumen(); return; }
  if (cargados.has("todos") || (cargados.has(clave) && !forzar)) return;
  poner("cargando");
  try {
    for (let desde = 0; ; desde += PAGINA) {
      let q = nube.from("registros_webinar").select("*");
      if (clave === "sin") q = q.is("fechaWebinar", null);
      else if (clave !== "todos") q = q.eq("fechaWebinar", clave);
      const r = await q.order("registradoEn", { ascending: false }).order("id").range(desde, desde + PAGINA - 1);
      if (r.error) {
        if (tablaFaltante(r.error)) { poner("sin-tabla"); return; }
        throw new Error(msg(r.error));
      }
      for (const x of (r.data ?? []) as Record<string, unknown>[]) filas.set(x.id as string, deBase(x));
      if ((r.data?.length ?? 0) < PAGINA) break;
    }
    cargados.add(clave);
    poner("listo");
  } catch (e) {
    poner("error", e instanceof Error ? e.message : "No se pudo leer la tabla de registros.");
  }
}

/** Los registros que ya están para esas fechas (para el importador: saber a
 *  quién no duplicar y qué marcas del equipo conservar). */
export async function existentesDeFechas(fechas: (string | undefined)[]): Promise<Map<string, RegistroForm>> {
  for (const f of new Set(fechas.map((x) => x ?? "sin"))) {
    await cargarRegistros(f);
    /* Sin saber lo que ya hay no se importa: se tomaría por nuevo a alguien
       que ya estaba y se le pisarían las marcas del equipo. */
    if (nube && !cargados.has("todos") && !cargados.has(f)) {
      throw new Error(estado === "sin-tabla"
        ? "Falta crear la tabla de registros: corré supabase/registros-webinar.sql."
        : `No se pudo leer lo que ya hay del webinar ${f}. ${error}`.trim());
    }
  }
  return new Map([...filas.entries()]);
}

/* ---------- escribir ---------- */

export interface ResultadoEscritura { ok: boolean; error?: string; escritos: number }

/** Guarda (o completa) registros, de a 500. Los pone en memoria al toque. */
export async function guardarRegistros(lista: RegistroForm[], alAvanzar?: (hechos: number) => void): Promise<ResultadoEscritura> {
  if (!nube) {
    for (const r of lista) filas.set(r.id, r);
    escribirLocal();
    resumen = resumirLocal();
    poner("local");
    return { ok: true, escritos: lista.length };
  }
  let hechos = 0;
  for (let i = 0; i < lista.length; i += 500) {
    const lote = lista.slice(i, i + 500);
    const r = await nube.from("registros_webinar").upsert(lote.map(filaParaBase) as never[], { defaultToNull: false });
    if (r.error) {
      if (tablaFaltante(r.error)) { poner("sin-tabla"); return { ok: false, escritos: hechos, error: "Falta crear la tabla: corré supabase/registros-webinar.sql." }; }
      return { ok: false, escritos: hechos, error: r.error.code === "42501" ? "Tu tipo de cuenta no puede guardar registros." : msg(r.error) };
    }
    for (const x of lote) filas.set(x.id, x);
    hechos += lote.length;
    alAvanzar?.(hechos);
  }
  avisar();
  void cargarResumen();
  return { ok: true, escritos: hechos };
}

/** Cambia un registro (una marca, una nota, el cruce): se ve al instante y
 *  se guarda; si la base lo rechaza, vuelve a como estaba. `quitar` son las
 *  columnas que se vacían (null). */
export async function cambiarRegistro(id: string, cambios: Partial<RegistroForm>, quitar: (keyof RegistroForm)[] = []): Promise<ResultadoEscritura> {
  const antes = filas.get(id);
  if (!antes) return { ok: false, escritos: 0, error: "El registro ya no está." };
  const despues = { ...antes, ...cambios } as RegistroForm;
  for (const k of quitar) delete (despues as unknown as Record<string, unknown>)[k];
  filas.set(id, despues);
  if (!nube) { escribirLocal(); resumen = resumirLocal(); poner("local"); return { ok: true, escritos: 1 }; }
  avisar();
  const payload: Record<string, unknown> = { ...cambios };
  for (const k of quitar) payload[k] = null;
  const r = await nube.from("registros_webinar").update(payload as never).eq("id", id);
  if (r.error) {
    filas.set(id, antes);
    avisar();
    return { ok: false, escritos: 0, error: r.error.code === "42501" ? "Tu tipo de cuenta puede mirar los formularios, pero no cambiarlos." : msg(r.error) };
  }
  void cargarResumen();
  return { ok: true, escritos: 1 };
}

/** Cambia lo mismo en varios registros de una vez (por ejemplo «Unido» a los
 *  que el lector de WhatsApp ve adentro del grupo): se ve al instante y se
 *  guarda de a 100 con una sola escritura por tanda; si la base lo rechaza,
 *  los que no llegaron vuelven a como estaban. */
export async function cambiarRegistros(ids: string[], cambios: Partial<RegistroForm>): Promise<ResultadoEscritura> {
  const antes = new Map<string, RegistroForm>();
  for (const id of ids) {
    const r = filas.get(id);
    if (!r) continue;
    antes.set(id, r);
    filas.set(id, { ...r, ...cambios } as RegistroForm);
  }
  if (antes.size === 0) return { ok: true, escritos: 0 };
  if (!nube) { escribirLocal(); resumen = resumirLocal(); poner("local"); return { ok: true, escritos: antes.size }; }
  avisar();
  const lista = [...antes.keys()];
  let hechos = 0;
  for (let i = 0; i < lista.length; i += 100) {
    const lote = lista.slice(i, i + 100);
    const r = await nube.from("registros_webinar").update(cambios as never).in("id", lote);
    if (r.error) {
      for (const id of lista.slice(i)) filas.set(id, antes.get(id)!);
      avisar();
      return { ok: false, escritos: hechos, error: r.error.code === "42501" ? "Tu tipo de cuenta puede mirar los formularios, pero no cambiarlos." : msg(r.error) };
    }
    hechos += lote.length;
  }
  void cargarResumen();
  return { ok: true, escritos: hechos };
}

export { hayNube };
