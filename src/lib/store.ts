"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AccionActividad, Actividad, Ad, AdInsight, Adset, Ajustes, Alumno, Campaign,
  Campania, CampoPersonalizado, Cuota, EntidadNombre, EstadoApp, Etapa, ID,
  Lead, Meta, Movimiento, Pago, Reporte, Sesion, Venta, Webinar,
} from "./types";
import { pagoDesdeMovimiento } from "./conciliacion";
import { construirSemilla, estadoVacio } from "./seed";
import { hayNube, nube, tablaFaltante, TABLAS, TABLAS_OPCIONALES } from "./supabase";
import { idAd, idAdset, idCampaign } from "./meta";

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

/* ---------- errores de la nube ---------- */

const SIN_ACCESO = "Tu usuario no tiene acceso a estos datos. Pedí que te agreguen al equipo.";

/* 42501 es la violacion de RLS de Postgres. Sin traducirlo llega a la barra
   lateral como "new row violates row-level security policy for table...",
   que no le dice nada a nadie y encima suena a que se rompio algo. */
function errorDeTabla(tabla: string, e: { message: string; code?: string }): Error {
  if (e.code === "42501") return new Error(SIN_ACCESO);
  return new Error(`${tabla}: ${e.message}`);
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
      /* Tabla opcional sin crear: se descarta la operacion en vez de
         bloquear la cola. En memoria el dato ya esta. */
      if (r.error && !(TABLAS_OPCIONALES.has(op.tabla) && tablaFaltante(r.error))) {
        throw errorDeTabla(op.tabla, r.error);
      }
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

/* PostgREST se atraganta con un upsert de miles de filas de una. Los 6.809
   dias de spend de Meta van de a 500. La cola procesa en orden, asi que
   partirlo no rompe el orden de las FKs: campaigns antes que adsets, adsets
   antes que ads, ads antes que insights. */
function empujarEnLotes(tabla: string, filas: unknown[], tamano = 500) {
  for (let i = 0; i < filas.length; i += tamano) {
    empujar({ tipo: "upsert", tabla, filas: filas.slice(i, i + tamano) });
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

/* PostgREST corta en 1000 filas por defecto y NO avisa: devuelve 200 con
   menos datos. Medido en produccion: la base tenia 2.751 anuncios y la app
   cargaba exactamente 1000, sin un solo error.

   Es la misma clase de falla que RLS escondiendo filas — el sistema informa
   exito y trae menos — y muerde a cualquier tabla que pase las mil: hoy `ads`,
   manana `leads` o `pagos`. Se pide por paginas hasta que una venga incompleta,
   que es la senal de que no hay mas. */
const PAGINA = 1000;

async function traerTabla(db: NonNullable<typeof nube>, tabla: string) {
  const filas: unknown[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const r = await db.from(tabla).select("*").range(desde, desde + PAGINA - 1);
    if (r.error) return { data: null, error: r.error };
    filas.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < PAGINA) return { data: filas, error: null };
  }
}

export async function cargarDeLaNube(): Promise<void> {
  if (!nube || yaCargo) return;
  const db = nube;
  yaCargo = true;
  marcar("cargando");
  try {
    const [ajustesRes, ...resto] = await Promise.all([
      db.from("ajustes").select("*").eq("id", 1).maybeSingle(),
      ...TABLAS.map((t) => traerTabla(db, t)),
    ]);

    for (const [i, r] of resto.entries()) {
      if (!r.error) continue;
      /* Una tabla opcional que todavia no se creo no rompe la sesion. */
      if (TABLAS_OPCIONALES.has(TABLAS[i]) && tablaFaltante(r.error)) continue;
      throw errorDeTabla(TABLAS[i], r.error);
    }
    if (ajustesRes.error) throw errorDeTabla("ajustes", ajustesRes.error);

    const porTabla = Object.fromEntries(
      TABLAS.map((t, i) => [t, (resto[i].data ?? []) as unknown[]]),
    ) as Record<string, unknown[]>;

    /* RLS no avisa cuando esconde: un SELECT que la politica rechaza vuelve
       vacio y con 200, no con error, asi que mirar el .error no alcanzaba y
       un usuario sin permiso terminaba aca creyendo que la base estaba sin
       sembrar. Se lo preguntamos derecho a la base: es la unica forma de no
       confundir "no tengo acceso" con "base nueva", y de no volcarle el
       localStorage de este navegador encima a datos que si existen. */
    const permiso = await db.rpc("puede_entrar");
    if (!permiso.error && permiso.data === false) {
      marcar("error", SIN_ACCESO);
      return;
    }

    /* Base nueva: se siembra entera con lo que haya en este navegador. */
    if (porTabla.etapas.length === 0) {
      await sembrarNube(snapshot());
      marcar("listo");
      return;
    }

    /* Base ya cargada pero con tablas nuevas vacias (una version anterior
       del modelo): se completan solo esas, y solo si son catalogos. */
    const semilla = construirSemilla();
    const vacias = new Set(
      Object.entries(porTabla)
        .filter(([tabla, filas]) => filas.length === 0 && CATALOGOS.has(tabla))
        .map(([t]) => t),
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
      movimientos: (porTabla.movimientos ?? []) as EstadoApp["movimientos"],
      leads: porTabla.leads as Lead[],
      alumnos: porTabla.alumnos as Alumno[],
      sesiones: porTabla.sesiones as Sesion[],
      reportes: porTabla.reportes as Reporte[],
      campanias: porTabla.campanias as Campania[],
      campaigns: (porTabla.campaigns ?? []) as EstadoApp["campaigns"],
      adsets: (porTabla.adsets ?? []) as EstadoApp["adsets"],
      ads: (porTabla.ads ?? []) as EstadoApp["ads"],
      adInsights: (porTabla.ad_insights ?? []) as EstadoApp["adInsights"],
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
/* Lo que la app necesita para funcionar, y que no depende de nadie: sin
   productos ni procesadores no se puede cargar una venta. Son las unicas
   tablas que se completan solas.

   Las transaccionales (ventas, cuotas, pagos, gastos, leads, alumnos...) se
   quedan vacias a proposito: tienen que venir del uso real. Completarlas con
   la semilla metia ventas inventadas en la base del equipo y encima rompia,
   porque el closerId de la semilla apunta a un equipo que en la nube tiene
   otros ids. Si alguien quiere la demo completa, la siembra entera sigue
   estando para una base nueva. */
const CATALOGOS = new Set([
  "productos", "procesadores", "embudos", "equipo", "etapas", "campos",
]);

function ordenDeSiembra(e: EstadoApp): [string, unknown[]][] {
  return [
    ["productos", e.productos], ["procesadores", e.procesadores],
    ["embudos", e.embudos], ["equipo", e.equipo],
    ["etapas", e.etapas], ["webinars", e.webinars], ["leads", e.leads],
    ["alumnos", e.alumnos], ["sesiones", e.sesiones], ["reportes", e.reportes],
    ["campanias", e.campanias], ["metas", e.metas], ["campos", e.campos],
    ["ventas", e.ventas], ["cuotas", e.cuotas], ["movimientos", e.movimientos],
    ["pagos", e.pagos], ["gastos", e.gastos],
    ["actividad", e.actividad],
  ];
}

async function sembrarNube(e: EstadoApp) {
  if (!nube) return;
  const ra = await nube.from("ajustes").upsert(filaAjustes(e.ajustes));
  if (ra.error) throw errorDeTabla("ajustes", ra.error);
  for (const [tabla, filas] of ordenDeSiembra(e)) {
    if (filas.length === 0) continue;
    const r = await nube.from(tabla).upsert(normalizar(filas) as never[], OPCIONES_UPSERT);
    if (r.error && !(TABLAS_OPCIONALES.has(tabla) && tablaFaltante(r.error))) {
      throw errorDeTabla(tabla, r.error);
    }
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
    if (r.error && !(TABLAS_OPCIONALES.has(tabla) && tablaFaltante(r.error))) {
      throw errorDeTabla(tabla, r.error);
    }
  }
}

async function vaciarNube() {
  if (!nube) return;
  /* Al reves del alta: primero los hijos. */
  const orden = [
    "actividad", "campos", "metas", "pagos", "movimientos", "cuotas", "ventas", "gastos",
    "campanias", "reportes", "sesiones", "alumnos", "leads", "webinars",
    "etapas", "equipo", "embudos", "procesadores", "productos",
  ];
  for (const tabla of orden) {
    const r = await nube.from(tabla).delete().neq("id", "__nunca__");
    if (r.error && !(TABLAS_OPCIONALES.has(tabla) && tablaFaltante(r.error))) {
      throw errorDeTabla(tabla, r.error);
    }
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
  | "ventas" | "cuotas" | "pagos" | "gastos" | "movimientos";

const ENTIDAD_DE: Record<string, Actividad["entidad"]> = {
  leads: "lead", sesiones: "sesion", webinars: "webinar", alumnos: "alumno",
  campanias: "campania", metas: "meta",
  ventas: "transaccion", cuotas: "transaccion", pagos: "transaccion", gastos: "transaccion",
  movimientos: "transaccion",
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

  /* ---------- Alta completa de una venta ----------
     El asistente junta la venta, su plan de cuotas y los cobros que ya
     entraron. Se escribe todo junto: media venta cargada (cuotas sin
     venta, pagos sin cuota) es peor que ninguna. */

  registrarVenta(datos: {
    venta: Venta;
    cuotas: Cuota[];
    cobros: { cuotaId: ID; procesadorId?: ID; monto: number; fecha: string; referencia?: string; movimientoId?: ID }[];
  }): ID {
    const e = snapshot();
    const { venta } = datos;

    const nuevosPagos: Pago[] = [];
    const movimientosTocados = new Map<ID, Movimiento>();

    for (const cobro of datos.cobros) {
      if (cobro.monto <= 0.001) continue;
      const mov = cobro.movimientoId ? e.movimientos.find((m) => m.id === cobro.movimientoId) : undefined;

      if (mov) {
        /* El fee lo dice la pasarela, no la tabla de procesadores. */
        nuevosPagos.push({ ...pagoDesdeMovimiento(mov, cobro.cuotaId, cobro.monto), id: nuevoId("pag") } as Pago);
        movimientosTocados.set(mov.id, {
          ...mov, estado: "conciliado",
          cuotaId: cobro.cuotaId, ventaId: venta.id,
          conciliadoEn: ahora(), conciliadoPor: e.ajustes.responsable || "Apicanta",
        });
        continue;
      }

      const proc = e.procesadores.find((x) => x.id === cobro.procesadorId);
      const feeRate = proc?.feeRate ?? 0;
      nuevosPagos.push({
        id: nuevoId("pag"), cuotaId: cobro.cuotaId, procesadorId: cobro.procesadorId,
        monto: Math.round(cobro.monto * 100) / 100, moneda: venta.moneda,
        feeRate, feeMonto: Math.round(cobro.monto * feeRate * 100) / 100,
        fecha: cobro.fecha, referencia: cobro.referencia || undefined,
        creadoEn: ahora(),
      });
    }

    /* Cuota saldada por los cobros que vinieron con el alta */
    const cuotas = datos.cuotas.map((c) => {
      const cubierto = nuevosPagos.filter((p) => p.cuotaId === c.id).reduce((a, p) => a + p.monto, 0);
      return cubierto >= c.monto - 0.01 ? { ...c, estado: "pagada" as const } : c;
    });

    const movimientos = movimientosTocados.size === 0
      ? e.movimientos
      : e.movimientos.map((m) => movimientosTocados.get(m.id) ?? m);

    const cobrado = nuevosPagos.reduce((a, p) => a + p.monto, 0);
    const detalle = cobrado > 0
      ? `Se cargó la venta de ${venta.contactoNombre} en ${cuotas.length} ${cuotas.length === 1 ? "cuota" : "cuotas"}, con ${nuevosPagos.length} ${nuevosPagos.length === 1 ? "cobro" : "cobros"} ya registrados.`
      : `Se cargó la venta de ${venta.contactoNombre} en ${cuotas.length} ${cuotas.length === 1 ? "cuota" : "cuotas"}.`;
    const { lista, nuevo } = registrar(e, "transaccion", venta.id, venta.contactoNombre, "creo", detalle);

    guardar({
      ...e,
      ventas: [venta, ...e.ventas],
      cuotas: [...cuotas, ...e.cuotas],
      pagos: [...nuevosPagos, ...e.pagos],
      movimientos,
      actividad: lista,
    });

    empujar({ tipo: "upsert", tabla: "ventas", filas: [venta] });
    empujar({ tipo: "upsert", tabla: "cuotas", filas: cuotas });
    if (nuevosPagos.length) empujar({ tipo: "upsert", tabla: "pagos", filas: nuevosPagos });
    if (movimientosTocados.size) empujar({ tipo: "upsert", tabla: "movimientos", filas: [...movimientosTocados.values()] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return venta.id;
  },

  /* ---------- Conciliación ----------
     Conciliar toca tres tablas a la vez: nace el pago, la cuota puede
     quedar saldada y el movimiento deja de estar suelto. Va todo en un
     solo guardar para que la pantalla no muestre estados intermedios
     ni queden mitades si algo falla. */

  conciliar(movimientoId: ID, imputaciones: { cuotaId: ID; monto: number }[]): boolean {
    const e = snapshot();
    const mov = e.movimientos.find((m) => m.id === movimientoId);
    if (!mov || mov.estado !== "pendiente" || imputaciones.length === 0) return false;

    const nuevosPagos: Pago[] = [];
    for (const imp of imputaciones) {
      if (imp.monto <= 0.001) continue;
      if (!e.cuotas.some((c) => c.id === imp.cuotaId)) continue;
      nuevosPagos.push({ ...pagoDesdeMovimiento(mov, imp.cuotaId, imp.monto), id: nuevoId("pag") } as Pago);
    }
    if (nuevosPagos.length === 0) return false;

    const pagos = [...nuevosPagos, ...e.pagos];

    /* Una cuota se marca pagada cuando la suma de sus pagos la cubre. */
    const tocadas = new Set(nuevosPagos.map((p) => p.cuotaId));
    const cuotasCambiadas: Cuota[] = [];
    const cuotas = e.cuotas.map((c) => {
      if (!tocadas.has(c.id) || c.estado !== "pendiente") return c;
      const cubierto = pagos.filter((p) => p.cuotaId === c.id).reduce((a, p) => a + p.monto, 0);
      if (cubierto < c.monto - 0.01) return c;
      const actualizada: Cuota = { ...c, estado: "pagada" };
      cuotasCambiadas.push(actualizada);
      return actualizada;
    });

    /* El movimiento puede repartirse entre varias cuotas: sigue pendiente
       mientras quede plata sin imputar. */
    const imputado = pagos.filter((p) => p.movimientoId === mov.id).reduce((a, p) => a + p.monto, 0);
    const saldado = imputado >= mov.monto - 0.01;
    const unaSola = nuevosPagos.length === 1 && saldado;
    const venta = e.cuotas.find((c) => c.id === nuevosPagos[0].cuotaId)?.ventaId;

    const actualizado: Movimiento = {
      ...mov,
      estado: saldado ? "conciliado" : "pendiente",
      pagoId: unaSola ? nuevosPagos[0].id : mov.pagoId,
      cuotaId: unaSola ? nuevosPagos[0].cuotaId : mov.cuotaId,
      ventaId: unaSola ? venta : mov.ventaId,
      conciliadoEn: saldado ? ahora() : mov.conciliadoEn,
      conciliadoPor: saldado ? (e.ajustes.responsable || "Apicanta") : mov.conciliadoPor,
    };
    const movimientos = e.movimientos.map((m) => (m.id === mov.id ? actualizado : m));

    const nombre = e.ventas.find((v) => v.id === venta)?.contactoNombre ?? mov.clienteNombre ?? "cobro";
    const { lista, nuevo } = registrar(
      e, "transaccion", mov.id, `Cobro de ${nombre}`, "actualizo",
      `Se concilió ${mov.referencia} con ${nuevosPagos.length === 1 ? "una cuota" : `${nuevosPagos.length} cuotas`} de ${nombre}.`,
    );

    guardar({ ...e, pagos, cuotas, movimientos, actividad: lista });
    empujar({ tipo: "upsert", tabla: "pagos", filas: nuevosPagos });
    if (cuotasCambiadas.length) empujar({ tipo: "upsert", tabla: "cuotas", filas: cuotasCambiadas });
    empujar({ tipo: "upsert", tabla: "movimientos", filas: [actualizado] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
  },

  /* Deshacer: se borran los pagos que nacieron del movimiento y las cuotas
     vuelven a estar pendientes. Sin esto, un error de conciliación sólo se
     arregla a mano y en tres pantallas distintas. */
  desconciliar(movimientoId: ID): boolean {
    const e = snapshot();
    const mov = e.movimientos.find((m) => m.id === movimientoId);
    if (!mov) return false;

    const suyos = e.pagos.filter((p) => p.movimientoId === mov.id);
    const ids = suyos.map((p) => p.id);
    const pagos = e.pagos.filter((p) => !ids.includes(p.id));

    const tocadas = new Set(suyos.map((p) => p.cuotaId));
    const cuotasCambiadas: Cuota[] = [];
    const cuotas = e.cuotas.map((c) => {
      if (!tocadas.has(c.id) || c.estado !== "pagada") return c;
      const cubierto = pagos.filter((p) => p.cuotaId === c.id).reduce((a, p) => a + p.monto, 0);
      if (cubierto >= c.monto - 0.01) return c;
      const actualizada: Cuota = { ...c, estado: "pendiente" };
      cuotasCambiadas.push(actualizada);
      return actualizada;
    });

    const actualizado: Movimiento = {
      ...mov, estado: "pendiente",
      pagoId: undefined, cuotaId: undefined, ventaId: undefined,
      conciliadoEn: undefined, conciliadoPor: undefined,
    };
    const movimientos = e.movimientos.map((m) => (m.id === mov.id ? actualizado : m));

    const { lista, nuevo } = registrar(
      e, "transaccion", mov.id, `Cobro ${mov.referencia}`, "actualizo",
      `Se deshizo la conciliación de ${mov.referencia}.`,
    );

    guardar({ ...e, pagos, cuotas, movimientos, actividad: lista });
    if (ids.length) empujar({ tipo: "delete", tabla: "pagos", ids });
    if (cuotasCambiadas.length) empujar({ tipo: "upsert", tabla: "cuotas", filas: cuotasCambiadas });
    empujar({ tipo: "upsert", tabla: "movimientos", filas: [actualizado] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
  },

  marcarMovimiento(movimientoId: ID, estado: Movimiento["estado"]) {
    const e = snapshot();
    const mov = e.movimientos.find((m) => m.id === movimientoId);
    if (!mov) return;
    const actualizado: Movimiento = { ...mov, estado };
    guardar({ ...e, movimientos: e.movimientos.map((m) => (m.id === mov.id ? actualizado : m)) });
    empujar({ tipo: "upsert", tabla: "movimientos", filas: [actualizado] });
  },

  /* Importar de un CSV o de la API: el mismo cobro traído dos veces tiene
     que seguir siendo uno solo, así que la referencia manda. */
  importarMovimientos(filas: Omit<Movimiento, "id" | "estado" | "creadoEn" | "origen">[], origen: string): { nuevos: number; repetidos: number } {
    const e = snapshot();
    const vistos = new Set(e.movimientos.map((m) => `${m.proveedor}:${m.referencia}`));
    const nuevos: Movimiento[] = [];

    for (const f of filas) {
      const clave = `${f.proveedor}:${f.referencia}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      nuevos.push({ ...f, id: nuevoId("mov"), estado: "pendiente", origen, creadoEn: ahora() });
    }

    if (nuevos.length === 0) return { nuevos: 0, repetidos: filas.length };

    const { lista, nuevo } = registrar(
      e, "transaccion", "import", "Cobros importados", "importo",
      `Entraron ${nuevos.length} cobros de pasarela (${origen}).`,
    );
    guardar({ ...e, movimientos: [...nuevos, ...e.movimientos], actividad: lista });
    empujar({ tipo: "upsert", tabla: "movimientos", filas: nuevos });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return { nuevos: nuevos.length, repetidos: filas.length - nuevos.length };
  },

  /* Guarda lo que trajo el sync de Meta: la jerarquia entera mas los insights
     del rango pedido.

     Los ids son DETERMINISTICOS a partir del id de Meta. Con eso resincronizar
     pisa en vez de duplicar, y las FKs se resuelven sin buscar nada: el adset
     ya sabe el id de su campania sin consultar la tabla. */
  importarMeta(datos: {
    campaigns: { id: string; nombre: string; objetivo: string; estado: string; desde?: string; hasta?: string }[];
    adsets: { id: string; campaignId: string; nombre: string; estado: string; desde?: string; hasta?: string }[];
    ads: { id: string; adsetId: string; campaignId: string; nombre: string; estado: string }[];
    insights: {
      adId: string; dia: string;
      inversion: number; impresiones: number; clicks: number; leads: number;
      alcance: number; frecuencia: number; ctr: number; cpm: number; cpc: number;
      clicksEnlace: number; ctrEnlace: number; costoPorClickEnlace: number;
      acciones: Record<string, number>; tipoDeLead?: string;
    }[];
    cuentaId?: string;
  }): { campaigns: number; adsets: number; ads: number; dias: number } {
    const e = snapshot();
    const t = ahora();
    /* Los mismos que usa el cron: una sola definicion, en lib/meta.ts. */
    const cid = idCampaign, sid = idAdset, aid = idAd;

    const campaigns: Campaign[] = datos.campaigns.map((c) => ({
      id: cid(c.id), metaId: c.id, nombre: c.nombre, objetivo: c.objetivo,
      estado: c.estado, cuentaId: datos.cuentaId, desde: c.desde, hasta: c.hasta,
      creadoEn: t, extra: {},
    }));
    const adsets: Adset[] = datos.adsets.map((a) => ({
      id: sid(a.id), metaId: a.id, campaignId: cid(a.campaignId), nombre: a.nombre,
      estado: a.estado, desde: a.desde, hasta: a.hasta, creadoEn: t, extra: {},
    }));
    const ads: Ad[] = datos.ads.map((a) => ({
      id: aid(a.id), metaId: a.id, adsetId: sid(a.adsetId), campaignId: cid(a.campaignId),
      nombre: a.nombre, estado: a.estado, creadoEn: t, extra: {},
    }));

    /* Un anuncio del que Meta no devolvio estructura no puede tener insights:
       la FK los rechazaria y la cola se frenaria entera en ese lote. */
    const conocidos = new Set(ads.map((a) => a.id));
    const nuevos: AdInsight[] = datos.insights
      .filter((i) => conocidos.has(aid(i.adId)))
      .map((i) => ({
        id: `${aid(i.adId)}_${i.dia}`, adId: aid(i.adId), dia: i.dia,
        inversion: i.inversion, impresiones: i.impresiones, clicks: i.clicks, leads: i.leads,
        alcance: i.alcance, frecuencia: i.frecuencia,
        ctr: i.ctr, cpm: i.cpm, cpc: i.cpc,
        clicksEnlace: i.clicksEnlace, ctrEnlace: i.ctrEnlace,
        costoPorClickEnlace: i.costoPorClickEnlace,
        acciones: i.acciones, tipoDeLead: i.tipoDeLead, creadoEn: t,
      }));

    /* El sync trae UN rango. Lo de afuera de ese rango se conserva: si no,
       sincronizar septiembre borraria agosto. */
    const pisados = new Set(nuevos.map((i) => i.id));
    const adInsights = [...e.adInsights.filter((i) => !pisados.has(i.id)), ...nuevos];

    const { lista, nuevo } = registrar(
      e, "campania", "meta", "Meta", "importo",
      `Se trajeron ${campaigns.length} campañas, ${ads.length} anuncios y ${nuevos.length} días de datos.`,
    );
    guardar({ ...e, campaigns, adsets, ads, adInsights, actividad: lista });

    /* El orden importa por las FKs. */
    empujarEnLotes("campaigns", campaigns);
    empujarEnLotes("adsets", adsets);
    empujarEnLotes("ads", ads);
    empujarEnLotes("ad_insights", nuevos);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });

    return { campaigns: campaigns.length, adsets: adsets.length, ads: ads.length, dias: nuevos.length };
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
