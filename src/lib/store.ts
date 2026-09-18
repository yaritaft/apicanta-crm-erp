"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AccionActividad, Actividad, Ajustes, Alumno, Campania, CampoPersonalizado,
  EntidadNombre, EstadoApp, Etapa, ID, Lead, Meta, Reporte, Sesion, Webinar,
} from "./types";
import { construirSemilla, estadoVacio } from "./seed";
import { hayNube, nube, TABLAS } from "./supabase";

const CLAVE = "apicanta.erp.v1";

/* ------------------------------------------------------------------
   Motor de datos.

   La memoria es la fuente de verdad para dibujar: todas las pantallas
   leen de forma sincronica y responden al instante. Debajo hay dos
   destinos posibles, y la app no se entera de cual esta activo:

   - Sin variables de Supabase: persiste en el navegador.
   - Con variables: carga de la nube al arrancar y empuja cada cambio
     en segundo plano, con una cola que reintenta.
------------------------------------------------------------------- */

let estado: EstadoApp | null = null;
const oyentes = new Set<() => void>();

export type EstadoSync = "local" | "cargando" | "listo" | "guardando" | "error";
let sync: EstadoSync = hayNube ? "cargando" : "local";
let ultimoError = "";

/* useSyncExternalStore compara por identidad: si devolvieramos un objeto
   nuevo en cada lectura, React entraria en bucle. Se rehace solo al cambiar. */
let vistaSync: { estado: EstadoSync; error: string } = { estado: sync, error: "" };
const VISTA_SERVIDOR: { estado: EstadoSync; error: string } = { estado: "local", error: "" };

export const estadoSync = () => sync;
export const errorSync = () => ultimoError;

function marcar(s: EstadoSync, error = "") {
  if (s === sync && error === ultimoError) return;
  sync = s;
  ultimoError = error;
  vistaSync = { estado: s, error };
  oyentes.forEach((f) => f());
}

/* ---------- almacenamiento local ---------- */

function leerLocal(): EstadoApp {
  if (typeof window === "undefined") return construirSemilla();
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    const base = construirSemilla();
    if (!crudo) return base;
    const parsed = JSON.parse(crudo) as EstadoApp;
    return {
      ...base,
      ...parsed,
      ajustes: { ...base.ajustes, ...(parsed.ajustes ?? {}) },
      etapas: parsed.etapas?.length ? parsed.etapas : base.etapas,
    };
  } catch {
    return construirSemilla();
  }
}

function escribirLocal(e: EstadoApp) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(e));
  } catch {
    /* Cuota llena: seguimos en memoria para no cortar la sesion. */
  }
}

function guardar(siguiente: EstadoApp) {
  estado = siguiente;
  escribirLocal(siguiente);
  oyentes.forEach((f) => f());
}

function snapshot(): EstadoApp {
  if (estado === null) estado = leerLocal();
  return estado;
}

let SERVIDOR_CACHE: EstadoApp | null = null;
const snapshotServidor = (): EstadoApp =>
  SERVIDOR_CACHE ?? (SERVIDOR_CACHE = construirSemilla());

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

export function useEstado(): EstadoApp {
  return useSyncExternalStore(suscribir, snapshot, snapshotServidor);
}

export function useSelector<T>(sel: (e: EstadoApp) => T): T {
  return sel(useEstado());
}

export function useSync(): { estado: EstadoSync; error: string } {
  return useSyncExternalStore(suscribir, () => vistaSync, () => VISTA_SERVIDOR);
}

/* ---------- cola de escritura hacia la nube ---------- */

type Op =
  | { tipo: "upsert"; tabla: string; filas: unknown[] }
  | { tipo: "delete"; tabla: string; ids: ID[] };

const cola: Op[] = [];
let drenando = false;

function empujar(op: Op) {
  if (!nube) return;
  cola.push(op);
  void drenar();
}

async function drenar() {
  if (drenando || !nube) return;
  drenando = true;
  marcar("guardando");
  try {
    while (cola.length > 0) {
      const op = cola[0];
      const r = op.tipo === "upsert"
        ? await nube.from(op.tabla).upsert(normalizar(op.filas) as never[], OPCIONES_UPSERT)
        : await nube.from(op.tabla).delete().in("id", op.ids);
      if (r.error) throw new Error(`${op.tabla}: ${r.error.message}`);
      cola.shift();
    }
    marcar("listo");
  } catch (err) {
    /* La operacion queda en la cola: se reintenta en el proximo cambio. */
    marcar("error", err instanceof Error ? err.message : "No se pudo guardar en la nube.");
  } finally {
    drenando = false;
  }
}

/* La fila de ajustes es unica y lleva id fijo. */
const filaAjustes = (a: Ajustes) => ({ ...a, id: 1 });

/* Nuestros objetos no siempre traen todas las claves: una etapa puede no
   tener esGanada, un lead puede no tener campania. Sacamos los undefined y
   mandamos las filas con defaultToNull:false, asi PostgREST completa lo que
   falte con el DEFAULT de la columna en vez de escribir null (que romperia
   cualquier columna NOT NULL). */
function normalizar(filas: unknown[]): Record<string, unknown>[] {
  return (filas as Record<string, unknown>[]).map((o) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)),
  );
}

const OPCIONES_UPSERT = { defaultToNull: false } as const;

/* ---------- carga inicial desde la nube ---------- */

let yaCargo = false;

/* Al entrar o salir hay que volver a traer: los datos dependen de quien sos. */
export function reiniciarCarga() {
  yaCargo = false;
  marcar(hayNube ? "cargando" : "local");
}

export async function cargarDeLaNube(): Promise<void> {
  if (!nube || yaCargo) return;
  const db = nube;
  yaCargo = true;
  marcar("cargando");
  try {
    const [ajustesRes, ...resto] = await Promise.all([
      db.from("ajustes").select("*").eq("id", 1).maybeSingle(),
      ...TABLAS.map((t) => db.from(t).select("*")),
    ]);

    for (const r of resto) if (r.error) throw new Error(r.error.message);
    if (ajustesRes.error) throw new Error(ajustesRes.error.message);

    const porTabla = Object.fromEntries(
      TABLAS.map((t, i) => [t, (resto[i].data ?? []) as unknown[]]),
    ) as Record<string, unknown[]>;

    /* Antes de decidir nada, confirmamos que podemos leer de verdad: si RLS
       nos esconde todo por falta de permisos, las listas tambien vienen
       vacias y no hay que confundir eso con una base sin sembrar. */
    const permiso = await db.from("etapas").select("id", { count: "exact", head: true });
    if (permiso.error) {
      marcar("error", "Tu usuario no tiene acceso a estos datos. Pedí que te agreguen al equipo.");
      return;
    }

    /* Base nueva: se siembra entera con lo que haya en este navegador. */
    if (porTabla.etapas.length === 0) {
      await sembrarNube(snapshot());
      marcar("listo");
      return;
    }

    /* Base ya cargada pero con tablas nuevas vacias (una version anterior
       del modelo): se completan solo esas. */
    const semilla = construirSemilla();
    const vacias = new Set(
      Object.entries(porTabla).filter(([, filas]) => filas.length === 0).map(([t]) => t),
    );
    if (vacias.size > 0) {
      await completarNube(semilla, vacias);
      for (const t of vacias) {
        const r = await db.from(t).select("*");
        if (!r.error) porTabla[t] = (r.data ?? []) as unknown[];
      }
    }

    const base = semilla;
    const { id: _id, ...ajustes } = ajustesRes.data as Ajustes & { id: number };
    void _id;

    guardar({
      version: 1,
      ajustes: { ...base.ajustes, ...ajustes },
      etapas: porTabla.etapas as Etapa[],
      webinars: porTabla.webinars as Webinar[],
      productos: porTabla.productos as EstadoApp["productos"],
      procesadores: porTabla.procesadores as EstadoApp["procesadores"],
      embudos: porTabla.embudos as EstadoApp["embudos"],
      equipo: porTabla.equipo as EstadoApp["equipo"],
      ventas: porTabla.ventas as EstadoApp["ventas"],
      cuotas: porTabla.cuotas as EstadoApp["cuotas"],
      pagos: porTabla.pagos as EstadoApp["pagos"],
      gastos: porTabla.gastos as EstadoApp["gastos"],
      leads: porTabla.leads as Lead[],
      alumnos: porTabla.alumnos as Alumno[],
      sesiones: porTabla.sesiones as Sesion[],
      reportes: porTabla.reportes as Reporte[],
      campanias: porTabla.campanias as Campania[],
      metas: porTabla.metas as Meta[],
      campos: porTabla.campos as CampoPersonalizado[],
      actividad: (porTabla.actividad as Actividad[])
        .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)),
    });
    marcar("listo");
  } catch (err) {
    /* Si la nube falla, la app sigue con lo local. Nunca pantalla en blanco. */
    marcar("error", err instanceof Error ? err.message : "No se pudo conectar con la nube.");
  }
}

/* Las tablas con clave foranea van despues de sus padres. */
function ordenDeSiembra(e: EstadoApp): [string, unknown[]][] {
  return [
    ["productos", e.productos], ["procesadores", e.procesadores],
    ["embudos", e.embudos], ["equipo", e.equipo],
    ["etapas", e.etapas], ["webinars", e.webinars], ["leads", e.leads],
    ["alumnos", e.alumnos], ["sesiones", e.sesiones], ["reportes", e.reportes],
    ["campanias", e.campanias], ["metas", e.metas], ["campos", e.campos],
    ["ventas", e.ventas], ["cuotas", e.cuotas], ["pagos", e.pagos], ["gastos", e.gastos],
    ["actividad", e.actividad],
  ];
}

async function sembrarNube(e: EstadoApp) {
  if (!nube) return;
  const ra = await nube.from("ajustes").upsert(filaAjustes(e.ajustes));
  if (ra.error) throw new Error(`ajustes: ${ra.error.message}`);
  for (const [tabla, filas] of ordenDeSiembra(e)) {
    if (filas.length === 0) continue;
    const r = await nube.from(tabla).upsert(normalizar(filas) as never[], OPCIONES_UPSERT);
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
  }
}

/* Siembra sólo lo que falta. Sirve cuando la base ya tiene datos de una
   versión anterior y aparecen tablas nuevas: se llenan esas y nada más,
   sin tocar lo que ya está cargado. */
async function completarNube(e: EstadoApp, vacias: Set<string>) {
  if (!nube) return;
  for (const [tabla, filas] of ordenDeSiembra(e)) {
    if (!vacias.has(tabla) || filas.length === 0) continue;
    const r = await nube.from(tabla).upsert(normalizar(filas) as never[], OPCIONES_UPSERT);
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
  }
}

async function vaciarNube() {
  if (!nube) return;
  /* Al reves del alta: primero los hijos. */
  const orden = [
    "actividad", "campos", "metas", "pagos", "cuotas", "ventas", "gastos",
    "campanias", "reportes", "sesiones", "alumnos", "leads", "webinars",
    "etapas", "equipo", "embudos", "procesadores", "productos",
  ];
  for (const tabla of orden) {
    const r = await nube.from(tabla).delete().neq("id", "__nunca__");
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
  }
}

/* ---------- utilidades ---------- */

export function nuevoId(prefijo: string): string {
  return `${prefijo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const ahora = () => new Date().toISOString();

function registrar(
  e: EstadoApp, entidad: Actividad["entidad"], entidadId: ID,
  titulo: string, accion: AccionActividad, detalle: string,
): { lista: Actividad[]; nuevo: Actividad } {
  const nuevo: Actividad = {
    id: nuevoId("act"), entidad, entidadId, titulo, accion, detalle,
    actor: e.ajustes.responsable || "Apicanta", fecha: ahora(),
  };
  return { lista: [nuevo, ...e.actividad].slice(0, 400), nuevo };
}

type Coleccion =
  | "leads" | "sesiones" | "webinars" | "alumnos" | "reportes"
  | "campanias" | "metas" | "campos" | "etapas"
  | "productos" | "procesadores" | "embudos" | "equipo"
  | "ventas" | "cuotas" | "pagos" | "gastos";

const ENTIDAD_DE: Record<string, Actividad["entidad"]> = {
  leads: "lead", sesiones: "sesion", webinars: "webinar", alumnos: "alumno",
  campanias: "campania", metas: "meta",
  ventas: "transaccion", cuotas: "transaccion", pagos: "transaccion", gastos: "transaccion",
  reportes: "config", campos: "config", etapas: "config",
  productos: "config", procesadores: "config", embudos: "config", equipo: "config",
};

/* ---------- API publica (identica a la de antes) ---------- */

export const acciones = {
  crear<T extends { id: ID }>(coleccion: Coleccion, registro: Omit<T, "id"> & { id?: ID }, etiqueta: string): ID {
    const e = snapshot();
    const nuevo = { ...registro, id: registro.id ?? nuevoId(coleccion.slice(0, 3)) } as T;
    const { lista, nuevo: act } = registrar(e, ENTIDAD_DE[coleccion] ?? "config", nuevo.id, etiqueta, "creo", `Se creó «${etiqueta}».`);
    guardar({ ...e, [coleccion]: [nuevo, ...(e[coleccion] as unknown as T[])], actividad: lista } as EstadoApp);
    empujar({ tipo: "upsert", tabla: coleccion, filas: [nuevo] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [act] });
    return nuevo.id;
  },

  actualizar<T extends { id: ID }>(coleccion: Coleccion, id: ID, cambios: Partial<T>, etiqueta: string, detalle?: string) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    const { lista: act, nuevo } = registrar(e, ENTIDAD_DE[coleccion] ?? "config", id, etiqueta, "actualizo", detalle ?? `Se editó «${etiqueta}».`);
    guardar({ ...e, [coleccion]: lista, actividad: act } as EstadoApp);
    const fila = lista.find((x) => x.id === id);
    if (fila) empujar({ tipo: "upsert", tabla: coleccion, filas: [fila] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  actualizarSilencioso<T extends { id: ID }>(coleccion: Coleccion, id: ID, cambios: Partial<T>) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    guardar({ ...e, [coleccion]: lista } as EstadoApp);
    const fila = lista.find((x) => x.id === id);
    if (fila) empujar({ tipo: "upsert", tabla: coleccion, filas: [fila] });
  },

  eliminar(coleccion: Coleccion, id: ID, etiqueta: string) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as { id: ID }[]).filter((x) => x.id !== id);
    const { lista: act, nuevo } = registrar(e, ENTIDAD_DE[coleccion] ?? "config", id, etiqueta, "elimino", `Se eliminó «${etiqueta}».`);
    guardar({ ...e, [coleccion]: lista, actividad: act } as EstadoApp);
    empujar({ tipo: "delete", tabla: coleccion, ids: [id] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  moverLead(leadId: ID, etapaId: ID) {
    const e = snapshot();
    const lead = e.leads.find((l) => l.id === leadId);
    if (!lead || lead.etapaId === etapaId) return;
    const destino = e.etapas.find((x) => x.id === etapaId);
    const origen = e.etapas.find((x) => x.id === lead.etapaId);
    const leads = e.leads.map((l) => (l.id === leadId ? { ...l, etapaId, actualizadoEn: ahora() } : l));
    const { lista, nuevo } = registrar(e, "lead", leadId, lead.nombre, "movio", `${lead.nombre}: ${origen?.nombre ?? "—"} → ${destino?.nombre ?? "—"}.`);
    guardar({ ...e, leads, actividad: lista });
    const fila = leads.find((l) => l.id === leadId);
    if (fila) empujar({ tipo: "upsert", tabla: "leads", filas: [fila] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  convertirEnAlumno(leadId: ID, datos: { plan: string; cuotaMensual: number; cohorte: string; inicio: string }): ID | null {
    const e = snapshot();
    const lead = e.leads.find((l) => l.id === leadId);
    if (!lead || e.alumnos.some((a) => a.leadId === leadId)) return null;
    const ganada = e.etapas.find((x) => x.esGanada);
    const alumno: Alumno = {
      id: nuevoId("alu"), nombre: lead.nombre, email: lead.email, pais: lead.pais,
      cohorte: datos.cohorte, plan: datos.plan, cuotaMensual: datos.cuotaMensual,
      moneda: lead.moneda, estado: "activo", inicio: datos.inicio, progreso: 0,
      leadId: lead.id, notas: "", creadoEn: ahora(), extra: {},
    };
    const leads = e.leads.map((l) => (l.id === leadId ? { ...l, etapaId: ganada?.id ?? l.etapaId, actualizadoEn: ahora() } : l));
    const { lista, nuevo } = registrar(e, "alumno", alumno.id, alumno.nombre, "creo", `${lead.nombre} pasó de lead a alumno (${datos.plan}).`);
    guardar({ ...e, alumnos: [alumno, ...e.alumnos], leads, actividad: lista });
    const fila = leads.find((l) => l.id === leadId);
    if (fila) empujar({ tipo: "upsert", tabla: "leads", filas: [fila] });
    empujar({ tipo: "upsert", tabla: "alumnos", filas: [alumno] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return alumno.id;
  },

  ajustes(cambios: Partial<Ajustes>, detalle = "Se actualizaron los ajustes.") {
    const e = snapshot();
    const ajustes = { ...e.ajustes, ...cambios };
    const { lista, nuevo } = registrar(e, "config", "ajustes", "Ajustes", "actualizo", detalle);
    guardar({ ...e, ajustes, actividad: lista });
    empujar({ tipo: "upsert", tabla: "ajustes", filas: [filaAjustes(ajustes)] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  ajustesSilencioso(cambios: Partial<Ajustes>) {
    const e = snapshot();
    const ajustes = { ...e.ajustes, ...cambios };
    guardar({ ...e, ajustes });
    empujar({ tipo: "upsert", tabla: "ajustes", filas: [filaAjustes(ajustes)] });
  },

  importarLeads(filas: Omit<Lead, "id">[]): number {
    const e = snapshot();
    const nuevos = filas.map((f) => ({ ...f, id: nuevoId("lead") } as Lead));
    const { lista, nuevo } = registrar(e, "lead", "import", "Importación", "importo", `Se importaron ${nuevos.length} leads.`);
    guardar({ ...e, leads: [...nuevos, ...e.leads], actividad: lista });
    if (nuevos.length) empujar({ tipo: "upsert", tabla: "leads", filas: nuevos });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return nuevos.length;
  },

  async reiniciarDemo() {
    const nuevoEstado = construirSemilla();
    guardar(nuevoEstado);
    if (!nube) return;
    marcar("guardando");
    try { await vaciarNube(); await sembrarNube(nuevoEstado); marcar("listo"); }
    catch (err) { marcar("error", err instanceof Error ? err.message : "No se pudo reiniciar en la nube."); }
  },

  async vaciarTodo() {
    const nuevoEstado = estadoVacio();
    guardar(nuevoEstado);
    if (!nube) return;
    marcar("guardando");
    try { await vaciarNube(); await sembrarNube(nuevoEstado); marcar("listo"); }
    catch (err) { marcar("error", err instanceof Error ? err.message : "No se pudo vaciar la nube."); }
  },

  exportar(): string { return JSON.stringify(snapshot(), null, 2); },

  importar(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as EstadoApp;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.leads)) return false;
      const base = construirSemilla();
      const nuevoEstado = { ...base, ...parsed, ajustes: { ...base.ajustes, ...(parsed.ajustes ?? {}) } };
      guardar(nuevoEstado);
      if (nube) {
        marcar("guardando");
        void vaciarNube()
          .then(() => sembrarNube(nuevoEstado))
          .then(() => marcar("listo"))
          .catch((err: unknown) => marcar("error", err instanceof Error ? err.message : "No se pudo subir el respaldo."));
      }
      return true;
    } catch { return false; }
  },
};

export function useAcciones() { return acciones; }

export function useTema(): ["dark" | "light", (t: "dark" | "light") => void] {
  const tema = useSelector((e) => e.ajustes.tema);
  const set = useCallback((t: "dark" | "light") => {
    acciones.ajustesSilencioso({ tema: t });
    if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
  }, []);
  return [tema, set];
}

export { hayNube };
export type {
  EstadoApp, Lead, Alumno, Sesion, Webinar, Campania,
  Meta, Etapa, Reporte, CampoPersonalizado, EntidadNombre,
};
