"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AccionActividad, Actividad, Ajustes, Alumno, Campania, CampoPersonalizado,
  EntidadNombre, EstadoApp, Etapa, ID, Lead, Meta, Reporte, Sesion, Transaccion, Webinar,
} from "./types";
import { construirSemilla, estadoVacio } from "./seed";

const CLAVE = "apicanta.erp.v1";

/* ------------------------------------------------------------------
   Motor de datos.
   Hoy persiste en el navegador (localStorage). La app entera habla
   con este módulo y nunca con el almacenamiento directamente, así que
   enchufar Supabase más adelante es cambiar sólo `leer` y `guardar`.
------------------------------------------------------------------- */

let estado: EstadoApp | null = null;
const oyentes = new Set<() => void>();

function leer(): EstadoApp {
  if (typeof window === "undefined") return construirSemilla();
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) {
      const inicial = construirSemilla();
      window.localStorage.setItem(CLAVE, JSON.stringify(inicial));
      return inicial;
    }
    const parsed = JSON.parse(crudo) as EstadoApp;
    /* Defensa: si falta una colección (versión vieja), la completamos. */
    const base = construirSemilla();
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

function guardar(siguiente: EstadoApp) {
  estado = siguiente;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify(siguiente));
    } catch {
      /* Cuota llena: seguimos en memoria para no romper la sesión. */
    }
  }
  oyentes.forEach((f) => f());
}

function snapshot(): EstadoApp {
  if (estado === null) estado = leer();
  return estado;
}

const snapshotServidor = (): EstadoApp => {
  return SERVIDOR_CACHE ?? (SERVIDOR_CACHE = construirSemilla());
};
let SERVIDOR_CACHE: EstadoApp | null = null;

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

export function useEstado(): EstadoApp {
  return useSyncExternalStore(suscribir, snapshot, snapshotServidor);
}

export function useSelector<T>(sel: (e: EstadoApp) => T): T {
  const e = useEstado();
  return sel(e);
}

/* ---------- utilidades ---------- */

export function nuevoId(prefijo: string): string {
  return `${prefijo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const ahora = () => new Date().toISOString();

function registrar(
  e: EstadoApp,
  entidad: Actividad["entidad"],
  entidadId: ID,
  titulo: string,
  accion: AccionActividad,
  detalle: string,
): Actividad[] {
  const act: Actividad = {
    id: nuevoId("act"),
    entidad, entidadId, titulo, accion, detalle,
    actor: e.ajustes.responsable || "Apicanta",
    fecha: ahora(),
  };
  return [act, ...e.actividad].slice(0, 400);
}

type Coleccion = "leads" | "sesiones" | "webinars" | "alumnos" | "reportes" | "campanias" | "transacciones" | "metas" | "campos" | "etapas";

const ENTIDAD_DE: Record<string, Actividad["entidad"]> = {
  leads: "lead", sesiones: "sesion", webinars: "webinar", alumnos: "alumno",
  campanias: "campania", transacciones: "transaccion", metas: "meta",
  reportes: "config", campos: "config", etapas: "config",
};

/* ---------- API pública ---------- */

export const acciones = {
  /* Crear cualquier registro. Devuelve el id nuevo. */
  crear<T extends { id: ID }>(coleccion: Coleccion, registro: Omit<T, "id"> & { id?: ID }, etiqueta: string): ID {
    const e = snapshot();
    const nuevo = { ...registro, id: registro.id ?? nuevoId(coleccion.slice(0, 3)) } as T;
    const lista = [nuevo, ...(e[coleccion] as unknown as T[])];
    guardar({
      ...e,
      [coleccion]: lista,
      actividad: registrar(e, ENTIDAD_DE[coleccion] ?? "config", nuevo.id, etiqueta, "creo", `Se creó «${etiqueta}».`),
    } as EstadoApp);
    return nuevo.id;
  },

  /* Actualizar parcialmente por id. */
  actualizar<T extends { id: ID }>(coleccion: Coleccion, id: ID, cambios: Partial<T>, etiqueta: string, detalle?: string) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    guardar({
      ...e,
      [coleccion]: lista,
      actividad: registrar(e, ENTIDAD_DE[coleccion] ?? "config", id, etiqueta, "actualizo", detalle ?? `Se editó «${etiqueta}».`),
    } as EstadoApp);
  },

  /* Actualizar sin dejar rastro en la actividad (drag de kanban, toggles rápidos). */
  actualizarSilencioso<T extends { id: ID }>(coleccion: Coleccion, id: ID, cambios: Partial<T>) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    guardar({ ...e, [coleccion]: lista } as EstadoApp);
  },

  eliminar(coleccion: Coleccion, id: ID, etiqueta: string) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as { id: ID }[]).filter((x) => x.id !== id);
    guardar({
      ...e,
      [coleccion]: lista,
      actividad: registrar(e, ENTIDAD_DE[coleccion] ?? "config", id, etiqueta, "elimino", `Se eliminó «${etiqueta}».`),
    } as EstadoApp);
  },

  /* Mover un lead de etapa (pipeline). Deja rastro con el nombre de la etapa. */
  moverLead(leadId: ID, etapaId: ID) {
    const e = snapshot();
    const lead = e.leads.find((l) => l.id === leadId);
    if (!lead || lead.etapaId === etapaId) return;
    const destino = e.etapas.find((x) => x.id === etapaId);
    const origen = e.etapas.find((x) => x.id === lead.etapaId);
    const leads = e.leads.map((l) => (l.id === leadId ? { ...l, etapaId, actualizadoEn: ahora() } : l));
    guardar({
      ...e,
      leads,
      actividad: registrar(e, "lead", leadId, lead.nombre, "movio", `${lead.nombre}: ${origen?.nombre ?? "—"} → ${destino?.nombre ?? "—"}.`),
    });
  },

  /* Convertir un lead ganado en alumno. */
  convertirEnAlumno(leadId: ID, datos: { plan: string; cuotaMensual: number; cohorte: string; inicio: string }): ID | null {
    const e = snapshot();
    const lead = e.leads.find((l) => l.id === leadId);
    if (!lead) return null;
    if (e.alumnos.some((a) => a.leadId === leadId)) return null;
    const ganada = e.etapas.find((x) => x.esGanada);
    const alumno: Alumno = {
      id: nuevoId("alu"),
      nombre: lead.nombre, email: lead.email, pais: lead.pais,
      cohorte: datos.cohorte, plan: datos.plan, cuotaMensual: datos.cuotaMensual,
      moneda: lead.moneda, estado: "activo", inicio: datos.inicio, progreso: 0,
      leadId: lead.id, notas: "", creadoEn: ahora(), extra: {},
    };
    guardar({
      ...e,
      alumnos: [alumno, ...e.alumnos],
      leads: e.leads.map((l) => (l.id === leadId ? { ...l, etapaId: ganada?.id ?? l.etapaId, actualizadoEn: ahora() } : l)),
      actividad: registrar(e, "alumno", alumno.id, alumno.nombre, "creo", `${lead.nombre} pasó de lead a alumno (${datos.plan}).`),
    });
    return alumno.id;
  },

  ajustes(cambios: Partial<Ajustes>, detalle = "Se actualizaron los ajustes.") {
    const e = snapshot();
    guardar({
      ...e,
      ajustes: { ...e.ajustes, ...cambios },
      actividad: registrar(e, "config", "ajustes", "Ajustes", "actualizo", detalle),
    });
  },

  ajustesSilencioso(cambios: Partial<Ajustes>) {
    const e = snapshot();
    guardar({ ...e, ajustes: { ...e.ajustes, ...cambios } });
  },

  /* Importar leads desde CSV ya parseado. */
  importarLeads(filas: Omit<Lead, "id">[]): number {
    const e = snapshot();
    const nuevos = filas.map((f) => ({ ...f, id: nuevoId("lead") } as Lead));
    guardar({
      ...e,
      leads: [...nuevos, ...e.leads],
      actividad: registrar(e, "lead", "import", "Importación", "importo", `Se importaron ${nuevos.length} leads.`),
    });
    return nuevos.length;
  },

  reiniciarDemo() { guardar(construirSemilla()); },
  vaciarTodo() { guardar(estadoVacio()); },

  exportar(): string { return JSON.stringify(snapshot(), null, 2); },

  importar(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as EstadoApp;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.leads)) return false;
      const base = construirSemilla();
      guardar({ ...base, ...parsed, ajustes: { ...base.ajustes, ...(parsed.ajustes ?? {}) } });
      return true;
    } catch { return false; }
  },
};

/* ---------- hooks de conveniencia ---------- */

export function useAcciones() {
  return acciones;
}

export function useTema(): ["dark" | "light", (t: "dark" | "light") => void] {
  const tema = useSelector((e) => e.ajustes.tema);
  const set = useCallback((t: "dark" | "light") => {
    acciones.ajustesSilencioso({ tema: t });
    if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
  }, []);
  return [tema, set];
}

export type { EstadoApp, Lead, Alumno, Sesion, Webinar, Campania, Transaccion, Meta, Etapa, Reporte, CampoPersonalizado, EntidadNombre };
