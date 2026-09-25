"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AccionActividad, Actividad, Ad, AdInsight, Adset, Ajustes, Alumno, Campaign,
  Contacto,
  Campania, CampoPersonalizado, Comentario, Comprobante, Cuota, EntidadNombre, EstadoApp, Etapa, ID,
  Lead, Meta, Movimiento, OpcionCrm, OportunidadCrm, Pago, Reporte, Sesion, Venta, Webinar,
} from "./types";
import type { EsquemaPago, EtapaServicio, Gasto, ID as IdMiembro, Liquidacion, MiembroEquipo, ResultadoLiquidacion } from "./types";
import { nombrePeriodo, tasaParaFinanzas } from "./honorarios";
import {
  alumnoDeVenta, cuotaMensualDeVenta, etapaDelAlumno, etapaInicialDeServicio, etapasDeServicio,
  personaDeVenta, planDeVenta,
} from "./alumnos";
import { pagoDesdeMovimiento } from "./conciliacion";
import { caracteristicaDePago, montoArsDe, tipoVentaDePago, type ResultadoImport } from "./angelo";
import { claveEmail, completar } from "./contactos";
import { construirSemilla, estadoVacio } from "./seed";
import { hayNube, nube, tablaFaltante, TABLAS, TABLAS_DE_DUENOS, TABLAS_OPCIONALES } from "./supabase";
import { idAd, idAdset, idCampaign } from "./meta";
import { entraEnTabla, esCompra, opcionesDe, tablasDe, ventaEsDeLlamada } from "./crm";
import { etapaTrasEventos, eventosDeLlamada, leadDeSesion, type EventoEtapa } from "./etapas-auto";
import { personaDe } from "./persona";

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

/* ---------- almacenamiento local ----------
   Sin la nube, el navegador guarda todo: es lo único que hay.

   Con la nube, el navegador guarda una copia para dibujar al instante al
   abrir, mientras llega la base. Esa copia va sin los anuncios de Meta y
   sus métricas diarias (más de la mitad del peso: 3 de 5,4 MB en septiembre
   de 2026), que se traen enteros de la nube cada vez. Entera pasaba el
   límite del navegador (~5 MB): no se podía escribir y quedaba congelada en
   una versión vieja, con los datos de ejemplo y ventas de menos, que se veía
   unos segundos cada vez que se abría la app. Va en otra clave para no leer
   nunca esa copia vieja, que se borra. */
const CLAVE_NUBE = "apicanta.erp.nube.v1";
const SOLO_EN_LA_NUBE = { campaigns: [], adsets: [], ads: [], adInsights: [] } satisfies Partial<EstadoApp>;
/* Tope de la copia: deja lugar a la sesión de Supabase y a las preferencias,
   que viven en el mismo espacio. */
const TOPE_COPIA = 4_000_000;

/* Con qué se dibuja antes de leer nada: sin la nube, la demo (la semilla);
   con la nube, vacío mientras carga: la semilla son personas y ventas
   inventadas, y se veían unos segundos como si fueran del equipo. */
function inicial(): EstadoApp {
  return hayNube ? { ...estadoVacio(), actividad: [] } : construirSemilla();
}

function leerLocal(): EstadoApp {
  if (typeof window === "undefined") return inicial();
  try {
    if (hayNube) window.localStorage.removeItem(CLAVE);
    const crudo = window.localStorage.getItem(hayNube ? CLAVE_NUBE : CLAVE);
    const base = inicial();
    if (!crudo) return base;
    const parsed = JSON.parse(crudo) as EstadoApp;
    return {
      ...base,
      ...parsed,
      ajustes: { ...base.ajustes, ...(parsed.ajustes ?? {}) },
      etapas: parsed.etapas?.length ? parsed.etapas : base.etapas,
    };
  } catch {
    return inicial();
  }
}

function escribirLocal(e: EstadoApp) {
  if (typeof window === "undefined") return;
  if (!hayNube) {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify(e));
    } catch {
      /* Cuota llena: seguimos en memoria para no cortar la sesion. */
    }
    return;
  }
  /* Con la nube, mejor sin copia que con una vieja: se vería al abrir, y un
     cambio hecho en esos segundos se haría sobre datos viejos. */
  try {
    const json = JSON.stringify({ ...e, ...SOLO_EN_LA_NUBE });
    if (json.length > TOPE_COPIA) window.localStorage.removeItem(CLAVE_NUBE);
    else window.localStorage.setItem(CLAVE_NUBE, json);
  } catch {
    try { window.localStorage.removeItem(CLAVE_NUBE); } catch { /* modo privado */ }
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
  SERVIDOR_CACHE ?? (SERVIDOR_CACHE = inicial());

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
  /* `sacadas` son las columnas que se quitaron por no existir todavia en la
     tabla. Se guarda para no reintentar en loop la misma. */
  | { tipo: "upsert"; tabla: string; filas: unknown[]; sacadas?: Set<string> }
  /* Sólo las columnas que cambiaron (null borra el dato), las mismas en
     todas esas filas. Para filas que también escribe el servidor, como las
     llamadas que trae Calendly: un upsert con la copia entera de esta
     pestaña podría pisar lo que el webhook acaba de cambiar. */
  | { tipo: "update"; tabla: string; ids: ID[]; cambios: Record<string, unknown>; sacadas?: Set<string> }
  | { tipo: "delete"; tabla: string; ids: ID[] };

/* PostgREST avisa con PGRST204 que la fila trae una columna que la tabla no
   tiene (y Postgres con 42703 si la consulta llego hasta el). Pasa en la
   ventana entre que se despliega un modelo nuevo y se corre su ALTER.

   Sin esto, el primer lead que alguien guarde en esa ventana deja la cola
   trabada, y la app dice "No se pudo guardar" para TODO — no para la columna
   nueva. Una tabla que falta ya se toleraba; una columna que falta rompia
   igual de feo y no estaba contemplada. */
function columnaFaltante(e: { code?: string; message?: string } | null): string | null {
  if (!e) return null;
  if (e.code !== "PGRST204" && e.code !== "42703") return null;
  const m = /'([^']+)'|"([^"]+)"/.exec(e.message ?? "");
  return m ? (m[1] ?? m[2] ?? null) : null;
}

const cola: Op[] = [];
let drenando = false;

/* ¿Hay un cambio de esta fila que todavía no llegó a la base? Mientras lo
   haya, lo que avisa Realtime de ella es más viejo que lo que está en
   pantalla: no se aplica (llega otro aviso cuando se termine de escribir). */
export function escrituraPendiente(tabla: string, id: ID): boolean {
  return cola.some((op) => op.tabla === tabla && (
    op.tipo === "upsert" ? (op.filas as { id?: ID }[]).some((f) => f.id === id) : op.ids.includes(id)));
}

function empujar(op: Op) {
  if (!nube) return;
  cola.push(op);
  void drenar();
}

/* El mismo cambio en varias filas va en un solo UPDATE, de a 100 (los ids
   viajan en la URL): cargarle un Pre-Call a 300 agendas no son 300 idas y
   vueltas. */
function empujarUpdate(tabla: string, ids: ID[], cambios: Record<string, unknown>) {
  for (let i = 0; i < ids.length; i += 100) {
    empujar({ tipo: "update", tabla, ids: ids.slice(i, i + 100), cambios });
  }
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
        : op.tipo === "update"
          ? await nube.from(op.tabla).update(op.cambios as never).in("id", op.ids)
          : await nube.from(op.tabla).delete().in("id", op.ids);
      if (r.error) {
        /* Tabla opcional sin crear: se descarta la operacion en vez de
           bloquear la cola. En memoria el dato ya esta. */
        if (TABLAS_OPCIONALES.has(op.tabla) && tablaFaltante(r.error)) {
          cola.shift();
          continue;
        }
        /* Columna que todavia no existe: se saca y se reintenta la MISMA
           operacion. El resto del dato entra, y ese campo se completa solo
           cuando el ALTER este corrido. Si ya se habia sacado, no sirvio y se
           deja fallar en vez de girar para siempre. */
        if (op.tipo === "upsert" || op.tipo === "update") {
          const col = columnaFaltante(r.error);
          if (col && !op.sacadas?.has(col)) {
            op.sacadas = (op.sacadas ?? new Set<string>()).add(col);
            if (op.tipo === "upsert") {
              op.filas = (op.filas as Record<string, unknown>[]).map(
                ({ [col]: _fuera, ...resto }) => resto,
              );
            } else {
              const { [col]: _fuera, ...resto } = op.cambios;
              op.cambios = resto;
            }
            console.warn(`[store] «${col}» no existe en ${op.tabla}: se guarda sin ese campo.`);
            /* Un update que se quedó sin columnas no tiene nada que mandar. */
            if (op.tipo === "update" && Object.keys(op.cambios).length === 0) cola.shift();
            continue;
          }
        }
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
      /* Opcional: sin el SQL corrido (o con la tabla vacía) el pipeline de
         alumnos usa las etapas de siempre en vez de quedarse sin columnas. */
      etapasServicio: porTabla.etapas_servicio?.length
        ? (porTabla.etapas_servicio as EtapaServicio[])
        : base.etapasServicio,
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
      contactos: (porTabla.contactos ?? []) as EstadoApp["contactos"],
      comentarios: ((porTabla.comentarios ?? []) as EstadoApp["comentarios"])
        .sort((a, b) => +new Date(a.creadoEn) - +new Date(b.creadoEn)),
      /* Vacías para quien no es dueño: RLS las esconde. */
      honorarios: (porTabla.honorarios ?? []) as EstadoApp["honorarios"],
      liquidaciones: (porTabla.liquidaciones ?? []) as EstadoApp["liquidaciones"],
      /* Opcional: si la tabla no existe, sin el ?? [] la app rompe al mapear. */
      campanias: (porTabla.campanias ?? []) as Campania[],
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
  "etapas_servicio",
]);

function ordenDeSiembra(e: EstadoApp): [string, unknown[]][] {
  return [
    ["productos", e.productos], ["procesadores", e.procesadores],
    ["embudos", e.embudos], ["equipo", e.equipo],
    /* contactos entre webinars y leads: apunta a webinars, y leads le apunta a
       el. Con la FK en la base, otro orden rechaza la siembra entera. */
    ["etapas", e.etapas], ["webinars", e.webinars], ["contactos", e.contactos], ["leads", e.leads],
    ["alumnos", e.alumnos], ["sesiones", e.sesiones], ["reportes", e.reportes],
    ["campanias", e.campanias], ["metas", e.metas], ["campos", e.campos],
    ["ventas", e.ventas], ["cuotas", e.cuotas], ["movimientos", e.movimientos],
    ["pagos", e.pagos], ["gastos", e.gastos],
    ["comentarios", e.comentarios ?? []],
    ["actividad", e.actividad],
    /* Sin FK desde alumnos a propósito (ver alumnos-servicio.sql): puede ir
       al final sin romper el orden de nadie. */
    ["etapas_servicio", e.etapasServicio],
    /* Sin FK tampoco (ver honorarios.sql). */
    ["honorarios", e.honorarios ?? []], ["liquidaciones", e.liquidaciones ?? []],
  ];
}

/* Una tabla de dueños que rechaza a quien no lo es: se saltea, como una
   tabla opcional que falta. Cortar ahí dejaría la base a medio restaurar. */
const esDeDuenosSinPermiso = (tabla: string, e: { code?: string }) => TABLAS_DE_DUENOS.has(tabla) && e.code === "42501";

async function sembrarNube(e: EstadoApp) {
  if (!nube) return;
  const ra = await nube.from("ajustes").upsert(filaAjustes(e.ajustes));
  if (ra.error) throw errorDeTabla("ajustes", ra.error);
  for (const [tabla, filas] of ordenDeSiembra(e)) {
    if (filas.length === 0) continue;
    const r = await nube.from(tabla).upsert(normalizar(filas) as never[], OPCIONES_UPSERT);
    if (r.error && !(TABLAS_OPCIONALES.has(tabla) && tablaFaltante(r.error)) && !esDeDuenosSinPermiso(tabla, r.error)) {
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
  /* Al reves del alta: primero los hijos. Las de dueños, para quien no lo
     es, no borran nada (RLS) y no dan error. */
  const orden = [
    "liquidaciones", "honorarios",
    "actividad", "comentarios", "campos", "metas", "pagos", "movimientos", "cuotas", "ventas", "gastos",
    "campanias", "reportes", "sesiones", "alumnos", "leads", "contactos", "webinars",
    "etapas", "equipo", "embudos", "procesadores", "productos",
    "etapas_servicio",
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

function nuevaActividad(
  e: EstadoApp, entidad: Actividad["entidad"], entidadId: ID,
  titulo: string, accion: AccionActividad, detalle: string, id = nuevoId("act"),
): Actividad {
  return { id, entidad, entidadId, titulo, accion, detalle, actor: e.ajustes.responsable || "Apicanta", fecha: ahora() };
}

function registrar(
  e: EstadoApp, entidad: Actividad["entidad"], entidadId: ID,
  titulo: string, accion: AccionActividad, detalle: string,
): { lista: Actividad[]; nuevo: Actividad } {
  const nuevo = nuevaActividad(e, entidad, entidadId, titulo, accion, detalle);
  return { lista: [nuevo, ...e.actividad].slice(0, 400), nuevo };
}

/* Lo que el CRM carga sobre una agenda. `estado` sólo lo manda deshacer:
   devuelve la llamada a como estaba. */
type CambiosLlamada = Partial<Pick<Sesion, "preCall" | "estadoPreCall" | "estadoLlamada" | "notas" | "grabacion" | "estado">>;
type PedidoLlamada = { id: ID; cambios: CambiosLlamada; detalle: string };
export type CambioEtapa = { antes: ID; despues: ID };

/* ---------- Llamadas, y la etapa de sus leads ----------
   Lo que cambia al cargar algo en una o varias llamadas, todavía sin
   guardar: las agendas nuevas, lo que va a la base y, si la llamada dice
   algo de la oportunidad (se hizo, compró, se perdió), la etapa de su lead
   (lib/etapas-auto.ts). Lo guardan el CRM, la Agenda y el alta de una venta,
   cada uno junto con lo suyo y de una sola vez. */
interface Tanda {
  sesiones: Map<ID, Sesion>;
  aLaNube: Map<ID, Record<string, unknown>>;
  leads: Map<ID, Lead>;
  /* Cada lead que la tanda movió: de qué etapa a cuál. Con eso se deshace. */
  etapas: Record<ID, CambioEtapa>;
  actividad: Actividad[];
  cuando: string;
  /* Un id de actividad por tanda, más el orden: con miles en el mismo
     milisegundo, los sufijos al azar de nuevoId llegaban a repetirse, y un
     upsert con dos filas del mismo id falla entero. */
  base: string;
}

function nuevaTanda(): Tanda {
  return { sesiones: new Map(), aLaNube: new Map(), leads: new Map(), etapas: {}, actividad: [], cuando: ahora(), base: nuevoId("act") };
}

function anotar(t: Tanda, e: EstadoApp, entidad: Actividad["entidad"], id: ID, titulo: string, accion: AccionActividad, detalle: string) {
  t.actividad.push(nuevaActividad(e, entidad, id, titulo, accion, detalle, `${t.base}_${t.actividad.length.toString(36)}`));
}

/* Pasa un lead de etapa dentro de la tanda (si los eventos lo mueven). */
function moverEnTanda(t: Tanda, e: EstadoApp, lead: Lead, eventos: EventoEtapa[], motivo: string) {
  const actual = t.leads.get(lead.id) ?? lead;
  const nueva = etapaTrasEventos(actual.etapaId, eventos, e.etapas);
  if (!nueva) return;
  fijarEtapa(t, e, actual, nueva, motivo);
}

function fijarEtapa(t: Tanda, e: EstadoApp, lead: Lead, etapaId: ID, motivo: string) {
  const actual = t.leads.get(lead.id) ?? lead;
  if (actual.etapaId === etapaId) return;
  t.etapas[lead.id] = { antes: t.etapas[lead.id]?.antes ?? actual.etapaId, despues: etapaId };
  t.leads.set(lead.id, { ...actual, etapaId, actualizadoEn: t.cuando });
  const nombre = (id: ID) => e.etapas.find((x) => x.id === id)?.nombre ?? "—";
  anotar(t, e, "lead", lead.id, lead.nombre, "movio", `${lead.nombre}: ${nombre(actual.etapaId)} → ${nombre(etapaId)} (${motivo}).`);
}

/* Las llamadas de la tanda, con lo que cada cambio dice de su lead. Con
   `restaurar` (deshacer), cada lead vuelve a la etapa de antes en vez de
   moverse solo, salvo que otra cosa lo haya movido después (se cargó la
   venta): ahí manda lo último. */
function cargarLlamadas(t: Tanda, e: EstadoApp, lista: PedidoLlamada[], restaurar?: Record<ID, CambioEtapa>) {
  const opciones = opcionesDe(e.ajustes, "estadoLlamada");
  const porId = new Map(e.sesiones.map((s) => [s.id, s]));
  const tocadas = new Set<ID>();
  for (const { id, cambios, detalle } of lista) {
    const s = t.sesiones.get(id) ?? porId.get(id);
    if (!s) continue;
    tocadas.add(id);
    const limpio: Partial<Sesion> = {};
    for (const [k, v] of Object.entries(cambios)) {
      (limpio as Record<string, unknown>)[k] = typeof v === "string" && v.trim() === "" ? undefined : v;
    }
    if (limpio.estadoLlamada && !("estado" in cambios)) {
      const op = opciones.find((o) => o.nombre === limpio.estadoLlamada);
      if (op?.llamada && s.estado !== op.llamada) limpio.estado = op.llamada;
    }
    if ("estado" in cambios && !cambios.estado) delete limpio.estado;
    t.sesiones.set(id, { ...s, ...limpio });
    t.aLaNube.set(id, { ...t.aLaNube.get(id), ...Object.fromEntries(Object.entries(limpio).map(([k, v]) => [k, v ?? null])) });
    anotar(t, e, "sesion", id, `${s.tipo} — ${s.invitado}`, "actualizo", detalle);
  }
  if (restaurar) {
    for (const [leadId, { antes, despues }] of Object.entries(restaurar)) {
      const lead = t.leads.get(leadId) ?? e.leads.find((l) => l.id === leadId);
      if (lead && lead.etapaId === despues) fijarEtapa(t, e, lead, antes, "se deshizo el cambio");
    }
    return;
  }
  for (const id of tocadas) {
    const antes = porId.get(id), despues = t.sesiones.get(id);
    if (!antes || !despues) continue;
    const eventos = eventosDeLlamada(antes, despues, opciones);
    const lead = eventos.length ? leadDeSesion(e.leads, despues) : undefined;
    if (lead) moverEnTanda(t, e, lead, eventos, `por su llamada del ${fechaCorta(despues.inicia)}`);
  }
}

/* Lo que la tanda manda a la base: las agendas y los leads con el mismo
   cambio van juntos en un UPDATE; la actividad, de a 500. */
function empujarTanda(t: Tanda) {
  const agrupar = (filas: Iterable<[ID, Record<string, unknown>]>) => {
    const grupos = new Map<string, { cambios: Record<string, unknown>; ids: ID[] }>();
    for (const [id, cambios] of filas) {
      const clave = JSON.stringify(cambios);
      const g = grupos.get(clave);
      if (g) g.ids.push(id); else grupos.set(clave, { cambios, ids: [id] });
    }
    return grupos.values();
  };
  for (const g of agrupar(t.aLaNube)) empujarUpdate("sesiones", g.ids, g.cambios);
  for (const g of agrupar([...t.leads.values()].map((l) => [l.id, { etapaId: l.etapaId, actualizadoEn: l.actualizadoEn }] as [ID, Record<string, unknown>]))) {
    empujarUpdate("leads", g.ids, g.cambios);
  }
  empujarEnLotes("actividad", t.actividad);
}

/* El estado con la tanda aplicada (sin guardarlo). */
function conTanda(e: EstadoApp, t: Tanda): EstadoApp {
  return {
    ...e,
    sesiones: t.sesiones.size ? e.sesiones.map((x) => t.sesiones.get(x.id) ?? x) : e.sesiones,
    leads: t.leads.size ? e.leads.map((l) => t.leads.get(l.id) ?? l) : e.leads,
    actividad: [...[...t.actividad].reverse(), ...e.actividad].slice(0, 400),
  };
}

/* La llamada de la que salió una venta: la del CRM desde la que se cargó
   o, si no, la última llamada de venta de esa persona hasta el día de la
   venta y dentro de su ventana (lib/crm.ts): una agenda posterior, o una de
   hace meses de alguien que vuelve a comprar, es otra historia. */
function llamadaDeVenta(e: EstadoApp, venta: Venta, sesionId?: ID): Sesion | undefined {
  if (sesionId) return e.sesiones.find((s) => s.id === sesionId);
  const p = venta.contactoId ? personaDe(e, venta.contactoId) : null;
  if (!p) return undefined;
  const tablas = tablasDe(e.ajustes);
  const tope = new Date(venta.fecha).getTime() + 86_400_000;
  return p.sesiones.find((s) => s.estado !== "cancelada" && tablas.some((x) => entraEnTabla(s, x))
    && new Date(s.inicia).getTime() <= tope && ventaEsDeLlamada(s, venta.fecha));
}

/* El estado de compra que corresponde a una venta: de downsell si el
   producto lo es, con reserva si el plan arranca con una, en cuotas si son
   varias y, si no, al contado. */
function opcionDeCompra(e: EstadoApp, venta: Venta, cuotas: Cuota[]): OpcionCrm | undefined {
  const opciones = opcionesDe(e.ajustes, "estadoLlamada");
  const regulares = cuotas.filter((c) => !c.esReserva && c.estado !== "cancelada");
  const tipo: OportunidadCrm = e.productos.find((p) => p.id === venta.productoId)?.tipo === "downsell" ? "downsell"
    : cuotas.some((c) => c.esReserva) ? "reserva"
    : regulares.length > 1 ? "compra-cuotas" : "compra-full";
  return opciones.find((o) => o.oportunidad === tipo) ?? opciones.find((o) => esCompra(o));
}

const fechaCorta = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getDate()}/${d.getMonth() + 1}` : "—";
};

type Coleccion =
  | "contactos" | "leads" | "sesiones" | "webinars" | "alumnos" | "reportes"
  | "campanias" | "metas" | "campos" | "etapas"
  | "productos" | "procesadores" | "embudos" | "equipo"
  | "ventas" | "cuotas" | "pagos" | "gastos" | "movimientos";

const ENTIDAD_DE: Record<string, Actividad["entidad"]> = {
  contactos: "contacto", leads: "lead", sesiones: "sesion", webinars: "webinar", alumnos: "alumno",
  campanias: "campania", metas: "meta",
  ventas: "transaccion", cuotas: "transaccion", pagos: "transaccion", gastos: "transaccion",
  movimientos: "transaccion",
  reportes: "config", campos: "config", etapas: "config",
  productos: "config", procesadores: "config", embudos: "config", equipo: "config",
};

/* ---------- A que contacto va cada lead ----------

   UN solo lugar lo decide: el formulario, el import de CSV y la restauracion
   de un backup pasan todos por aca. Si cada camino tuviera su version, volveria
   a pasar lo que la separacion venia a arreglar — dos verdades para la misma
   persona.

   - Si el lead ya apunta a un contacto que existe, se respeta.
   - Si no, se busca por email, sin mayusculas ni espacios: es la misma persona
     volviendo, incluso dos filas del mismo CSV.
   - Si no hay, nace uno con el id del lead, igual que en la migracion.

   Al reusar un contacto se completan los huecos, no se pisa lo que ya habia.
   "Hueco" incluye el string vacio: un input de React manda "" y no undefined,
   y con `??` un telefono vacio no se completaba nunca. */

function asignarContactos(leads: Lead[], contactos: Contacto[]): {
  leads: Lead[]; contactos: Contacto[]; tocados: Contacto[];
} {
  const porId = new Map(contactos.map((c) => [c.id, c] as const));
  const porEmail = new Map<string, Contacto>();
  for (const c of contactos) {
    const k = claveEmail(c.email);
    if (k && !porEmail.has(k)) porEmail.set(k, c);
  }
  const tocados = new Map<ID, Contacto>();

  const salida = leads.map((l) => {
    if (l.contactoId && porId.has(l.contactoId)) return l;
    const k = claveEmail(l.email);
    const previo = porId.get(l.id) ?? (k ? porEmail.get(k) : undefined);
    const canal = l.webinarId ? ("webinar" as const) : undefined;
    const c: Contacto = previo
      ? {
          ...previo,
          telefono: completar(previo.telefono, l.telefono),
          pais: completar(previo.pais, l.pais),
          inglesNivel: completar(previo.inglesNivel, l.inglesNivel),
          aniosExperiencia: completar(previo.aniosExperiencia, l.aniosExperiencia),
          origenWebinarId: completar(previo.origenWebinarId, l.webinarId),
          origenCanal: completar(previo.origenCanal, canal),
        }
      : {
          id: l.id,
          /* NOT NULL en la base. Una fila de CSV sin mail no puede trabar la
             cola entera con un error que dice "No se pudo guardar". */
          nombre: l.nombre ?? "", email: l.email ?? "",
          telefono: l.telefono, pais: l.pais,
          inglesNivel: l.inglesNivel, aniosExperiencia: l.aniosExperiencia,
          origenCanal: canal, origenWebinarId: l.webinarId,
          notas: l.notas, creadoEn: l.creadoEn ?? new Date().toISOString(), extra: {},
        };
    porId.set(c.id, c);
    if (k) porEmail.set(k, c);
    tocados.set(c.id, c);
    return { ...l, contactoId: c.id };
  });

  return { leads: salida, contactos: [...porId.values()], tocados: [...tocados.values()] };
}

/* ---------- El alumno de cada venta ----------

   Quien compra pasa a ser alumno solo, al registrar la venta. Antes había que
   acordarse de cargarlo a mano en Alumnos, y el que no se cargaba no entraba
   nunca al pipeline de servicio: nadie le hacía el onboarding.

   No duplica. Si esa persona ya es alumno (la misma venta, el mismo lead o el
   mismo mail: la regla vive en lib/alumnos.ts y es la misma del asistente),
   se le enlaza la venta si no tenía ninguna, y si ya tenía, no se toca: una
   segunda compra (un upsell) no es un alumno nuevo.

   Si nace, nace con los datos de la persona (el contacto o el lead de la
   venta; si no hay, el nombre que se escribió), el producto como plan, activo
   y en la primera etapa del servicio.

   Es pura: devuelve la lista entera y el alumno a subir (null si no cambió
   nada), así registrarVenta lo guarda en el MISMO `guardar` que la venta y
   la pantalla nunca ve una venta sin su alumno. `cuotas` es el plan de la
   venta que se está registrando, que todavía no está en `e.cuotas`. */
export function alumnoDesdeVenta(e: EstadoApp, venta: Venta, cuotas?: Cuota[]): {
  alumnos: Alumno[]; tocado: Alumno | null;
} {
  const sinCambios = { alumnos: e.alumnos, tocado: null };
  const ya = alumnoDeVenta(e, venta);
  if (ya) {
    if (ya.ventaId) return sinCambios;
    const enlazado: Alumno = { ...ya, ventaId: venta.id, leadId: ya.leadId ?? venta.contactoId };
    return { alumnos: e.alumnos.map((a) => (a.id === ya.id ? enlazado : a)), tocado: enlazado };
  }
  if (venta.estado !== "activa") return sinCambios;
  const persona = personaDeVenta(e, venta);
  if (!persona.nombre) return sinCambios;
  const nuevo: Alumno = {
    id: nuevoId("alu"),
    nombre: persona.nombre,
    email: persona.email,
    pais: persona.pais || undefined,
    /* La cohorte no sale de la venta: se completa en el onboarding. */
    cohorte: "",
    plan: planDeVenta(e, venta),
    cuotaMensual: cuotaMensualDeVenta(cuotas ?? e.cuotas.filter((c) => c.ventaId === venta.id)),
    moneda: venta.moneda,
    estado: "activo",
    inicio: venta.fecha,
    progreso: 0,
    leadId: venta.contactoId,
    notas: "",
    creadoEn: ahora(),
    extra: {},
    etapaServicioId: etapaInicialDeServicio(e),
    ventaId: venta.id,
  };
  return { alumnos: [nuevo, ...e.alumnos], tocado: nuevo };
}

/* ---------- API publica (identica a la de antes) ---------- */

/* Lo que la planilla de Angelo guarda de cada cobro ("Característica de
   pago", "Ventas Nuevas vs Cuotas", el monto en pesos), calculado cuando el
   cobro entra. Se guarda y no se recalcula: es lo que se dijo ese día,
   igual que en la planilla. */
function conDatosDePlanilla(nuevos: Pago[], cuotasVenta: Cuota[], pagosVentaAntes: Pago[], esAlta: boolean): Pago[] {
  const cobradoAntes = pagosVentaAntes.reduce((a, p) => a + p.monto, 0);
  const cobradoAhora = nuevos.reduce((a, p) => a + p.monto, 0);
  const tipoVenta = tipoVentaDePago({ cuotasVenta, esAlta: esAlta || pagosVentaAntes.length === 0 });
  return nuevos.map((p) => {
    const cuota = cuotasVenta.find((c) => c.id === p.cuotaId);
    return {
      ...p,
      caracteristica: p.caracteristica
        ?? (cuota ? caracteristicaDePago({ cuota, cuotasVenta, cobradoAntes, cobradoAhora }) : undefined),
      tipoVenta: p.tipoVenta ?? tipoVenta,
      montoArs: p.montoArs ?? montoArsDe(p.monto, p.tipoCambio),
    };
  });
}

/* Lo que se carga de un cobro además del monto: los datos de la planilla. */
export interface DatosCobro {
  procesadorId?: ID; monto: number; fecha: string; referencia?: string;
  movimientoId?: ID; comprobante?: Comprobante;
  tipoCambio?: number; pagador?: string; cuit?: string; chequeado?: boolean;
  cvu?: string; tipoCambioBlue?: number; tipoCambioFuente?: string;
}

/* Los datos de la planilla que trae el cobro, sin los vacíos. El blue de
   referencia va sólo con un tipo de cambio: es contra qué se compara. */
function extrasDeCobro(c: DatosCobro): Partial<Pago> {
  const conCambio = Boolean(c.tipoCambio && c.tipoCambio > 0);
  return {
    ...(conCambio ? { tipoCambio: c.tipoCambio } : {}),
    ...(conCambio && c.tipoCambioBlue && c.tipoCambioBlue > 0
      ? { tipoCambioBlue: c.tipoCambioBlue, tipoCambioFuente: c.tipoCambioFuente } : {}),
    ...(c.pagador?.trim() ? { pagador: c.pagador.trim() } : {}),
    ...(c.cuit?.trim() ? { cuit: c.cuit.trim() } : {}),
    ...(c.cvu?.trim() ? { cvu: c.cvu.replace(/[\s.-]/g, "") } : {}),
    ...(c.chequeado ? { chequeado: true } : {}),
  };
}

export const acciones = {
  crear<T extends { id: ID }>(coleccion: Coleccion, registro: Omit<T, "id"> & { id?: ID }, etiqueta: string): ID {
    const e = snapshot();
    const nuevo = { ...registro, id: registro.id ?? nuevoId(coleccion.slice(0, 3)) } as T;
    const { lista, nuevo: act } = registrar(e, ENTIDAD_DE[coleccion] ?? "config", nuevo.id, etiqueta, "creo", `Se creó «${etiqueta}».`);
    /* Una llamada agendada a mano en la Agenda mueve a su lead igual que
       una de Calendly: a Sesión agendada (lib/etapas-auto.ts). */
    const t = nuevaTanda();
    if (coleccion === "sesiones") {
      const s = nuevo as unknown as Sesion;
      const lead = s.estado !== "cancelada" ? leadDeSesion(e.leads, s) : undefined;
      if (lead) moverEnTanda(t, e, lead, s.estado === "hecha" ? ["agendo", "llamada-hecha"] : ["agendo"], "agendó una llamada");
    }
    const siguiente = { ...e, [coleccion]: [nuevo, ...(e[coleccion] as unknown as T[])], actividad: lista } as EstadoApp;
    guardar(t.leads.size ? conTanda(siguiente, t) : siguiente);
    empujar({ tipo: "upsert", tabla: coleccion, filas: [nuevo] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [act] });
    if (t.leads.size) empujarTanda(t);
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

  /* Como actualizar, pero a la base va sólo lo que cambió (un UPDATE de esas
     columnas, no la fila entera). Para las filas que también escriben otros
     —las llamadas: el webhook de Calendly, el CRM desde otra pestaña—, que
     esta copia puede tener vieja: con la fila entera, marcar «Se hizo» en la
     Agenda borraba lo que el setter había cargado en el CRM esa mañana. */
  actualizarParcial<T extends { id: ID }>(coleccion: Coleccion, id: ID, cambios: Partial<T>, etiqueta: string, detalle?: string) {
    if (Object.keys(cambios).length === 0) return;
    const e = snapshot();
    const lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    const { lista: act, nuevo } = registrar(e, ENTIDAD_DE[coleccion] ?? "config", id, etiqueta, "actualizo", detalle ?? `Se editó «${etiqueta}».`);
    /* Una llamada marcada como hecha en la Agenda pasa a su lead a
       Propuesta, igual que desde el CRM (lib/etapas-auto.ts). */
    const t = nuevaTanda();
    if (coleccion === "sesiones") {
      const antes = e.sesiones.find((s) => s.id === id);
      const despues = (lista as unknown as Sesion[]).find((s) => s.id === id);
      const eventos = antes && despues ? eventosDeLlamada(antes, despues, opcionesDe(e.ajustes, "estadoLlamada")) : [];
      const lead = eventos.length && despues ? leadDeSesion(e.leads, despues) : undefined;
      if (lead && despues) moverEnTanda(t, e, lead, eventos, `por su llamada del ${fechaCorta(despues.inicia)}`);
    }
    const siguiente = { ...e, [coleccion]: lista, actividad: act } as EstadoApp;
    guardar(t.leads.size ? conTanda(siguiente, t) : siguiente);
    empujarUpdate(coleccion, [id], Object.fromEntries(Object.entries(cambios).map(([k, v]) => [k, v === undefined ? null : v])));
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    if (t.leads.size) empujarTanda(t);
  },

  /* Lo que cambió en la base sin pasar por esta pantalla (lo escriben el
     cron o un webhook): se aplica SÓLO en memoria, sin volver a escribirlo.
     Si se empujara, una pestaña vieja podría pisar un número más nuevo. */
  aplicarDeLaNube<T extends { id: ID }>(coleccion: Coleccion, cambiosPorId: Record<ID, Partial<T>>) {
    const e = snapshot();
    let cambio = false;
    const lista = (e[coleccion] as unknown as T[]).map((x) => {
      const c = cambiosPorId[x.id];
      if (!c) return x;
      const distinto = Object.entries(c).some(([k, v]) => JSON.stringify((x as Record<string, unknown>)[k]) !== JSON.stringify(v));
      if (!distinto) return x;
      cambio = true;
      return { ...x, ...c };
    });
    if (cambio) guardar({ ...e, [coleccion]: lista } as EstadoApp);
  },

  actualizarSilencioso<T extends { id: ID }>(coleccion: Coleccion, id: ID, cambios: Partial<T>) {
    const e = snapshot();
    const lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    guardar({ ...e, [coleccion]: lista } as EstadoApp);
    const fila = lista.find((x) => x.id === id);
    if (fila) empujar({ tipo: "upsert", tabla: coleccion, filas: [fila] });
  },

  /* Filas que llegaron por Realtime (una agenda nueva de Calendly, una
     cancelación, lo que cargó otro del equipo): entran a la memoria sin
     volver a escribirse. A diferencia de aplicarDeLaNube, también suma las
     que no estaban y saca las que se borraron. */
  recibirDeLaNube<T extends { id: ID }>(coleccion: Coleccion, filas: T[], borrados: ID[] = []) {
    const e = snapshot();
    const llegan = new Map(filas.map((f) => [f.id, f] as const));
    const fuera = new Set(borrados);
    let cambio = false;
    const lista = (e[coleccion] as unknown as T[]).flatMap((x) => {
      if (fuera.has(x.id)) { cambio = true; return []; }
      const n = llegan.get(x.id);
      if (!n) return [x];
      llegan.delete(x.id);
      const junto = { ...x, ...n };
      if (JSON.stringify(junto) === JSON.stringify(x)) return [x];
      cambio = true;
      return [junto];
    });
    const nuevas = [...llegan.values()];
    if (!cambio && nuevas.length === 0) return;
    guardar({ ...e, [coleccion]: [...nuevas, ...lista] } as EstadoApp);
  },

  /* ---------- El CRM ----------
     Lo que el equipo carga sobre una agenda: Pre-Call, Estado de Llamada,
     notas, grabación y Estado Pre-Call. A la base va sólo lo que cambió.

     El Estado de Llamada dice además si la llamada se hizo: elegir «Compra
     Full» es lo mismo que marcar «Se hizo» en la Agenda, e «Inasistió», que
     «No vino». Así la asistencia del Dashboard no se carga dos veces. */
  editarLlamada(id: ID, cambios: CambiosLlamada, detalle: string) {
    acciones.editarLlamadas([{ id, cambios, detalle }]);
  },

  /* Lo mismo en varias agendas de una vez (elegir filas y cargarles el
     mismo Pre-Call, o deshacerlo): se guarda una sola vez. Agenda por agenda,
     con miles cargadas, cada una volvía a escribir todo el estado y la
     pantalla se quedaba congelada.

     Devuelve de qué etapa a cuál pasó cada lead que se movió, para
     deshacerlo: con `restaurarEtapas` vuelven a la de antes en vez de
     moverse solos (si nada los movió después). */
  editarLlamadas(lista: PedidoLlamada[], restaurarEtapas?: Record<ID, CambioEtapa>): {
    etapas: Record<ID, CambioEtapa>;
    /* A qué etapa pasó cada lead que se movió, para avisarlo. */
    movidos: { leadId: ID; etapa: string }[];
  } {
    const e = snapshot();
    const t = nuevaTanda();
    cargarLlamadas(t, e, lista, restaurarEtapas);
    if (t.sesiones.size === 0 && t.leads.size === 0) return { etapas: {}, movidos: [] };
    guardar(conTanda(e, t));
    empujarTanda(t);
    return {
      etapas: t.etapas,
      movidos: [...t.leads.values()].map((l) => ({ leadId: l.id, etapa: e.etapas.find((x) => x.id === l.etapaId)?.nombre ?? "" })),
    };
  },

  /* La configuración del CRM (opciones de cada campo, qué agendas entran en
     cada tabla). Renombrar una opción renombra también lo que ya estaba
     cargado con ella, como en Airtable. */
  configurarCrm(crm: NonNullable<Ajustes["crm"]>, renombres: { campo: "preCall" | "estadoPreCall" | "estadoLlamada"; de: string; a: string }[] = [], detalle = "Se cambió la configuración del CRM.") {
    const e = snapshot();
    /* Todos los renombres de una vez, desde el valor original: intercambiar
       dos nombres (A→B y B→A) o renombrar a uno que se borra no se pisan. */
    const mapas = new Map<string, Map<string, string>>();
    for (const r of renombres) {
      if (!mapas.has(r.campo)) mapas.set(r.campo, new Map());
      mapas.get(r.campo)!.set(r.de, r.a);
    }
    const tocadas: Sesion[] = [];
    const sesiones = renombres.length === 0 ? e.sesiones : e.sesiones.map((s) => {
      let y = s;
      for (const [campo, mapa] of mapas) {
        const actual = s[campo as "preCall"];
        if (actual !== undefined && mapa.has(actual)) y = { ...y, [campo]: mapa.get(actual) || undefined };
      }
      if (y !== s) tocadas.push(y);
      return y;
    });
    const ajustes = { ...e.ajustes, crm };
    const { lista, nuevo } = registrar(e, "config", "crm", "CRM", "actualizo", detalle);
    guardar({ ...e, ajustes, sesiones, actividad: lista });
    empujar({ tipo: "upsert", tabla: "ajustes", filas: [filaAjustes(ajustes)] });
    const grupos = new Map<string, { cambios: Record<string, unknown>; ids: ID[] }>();
    for (const s of tocadas) {
      const cambios: Record<string, unknown> = {};
      for (const campo of mapas.keys()) cambios[campo] = s[campo as "preCall"] ?? null;
      const clave = JSON.stringify(cambios);
      const g = grupos.get(clave);
      if (g) g.ids.push(s.id); else grupos.set(clave, { cambios, ids: [s.id] });
    }
    for (const g of grupos.values()) empujarUpdate("sesiones", g.ids, g.cambios);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
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
      etapaServicioId: etapaInicialDeServicio(e),
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

  /* ---------- Pipeline de servicio ----------
     Las etapas viven en `etapas_servicio`, que no se llama como su colección
     (`etapasServicio`): por eso tienen acciones propias y no pasan por
     crear/actualizar/eliminar, que usan el nombre de la colección como tabla. */

  /* El servicio de una compra que no lo tiene (ventas cargadas antes de
     que el alumno naciera solo): la misma regla que al registrar la venta. */
  crearServicioDeVenta(ventaId: ID): ID | null {
    const e = snapshot();
    const venta = e.ventas.find((v) => v.id === ventaId);
    if (!venta) return null;
    const r = alumnoDesdeVenta(e, venta);
    if (!r.tocado) return alumnoDeVenta(e, venta)?.id ?? null;
    const { lista, nuevo } = registrar(
      e, "alumno", r.tocado.id, r.tocado.nombre, "creo",
      `Se creó el servicio de ${r.tocado.nombre} (${r.tocado.plan || "sin plan"}).`,
    );
    guardar({ ...e, alumnos: r.alumnos, actividad: lista });
    empujar({ tipo: "upsert", tabla: "alumnos", filas: [r.tocado] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return r.tocado.id;
  },

  moverAlumno(alumnoId: ID, etapaServicioId: ID) {
    const e = snapshot();
    const alumno = e.alumnos.find((a) => a.id === alumnoId);
    const destino = e.etapasServicio.find((x) => x.id === etapaServicioId);
    if (!alumno || !destino || alumno.etapaServicioId === etapaServicioId) return;
    const origen = etapaDelAlumno(etapasDeServicio(e), alumno);
    const actualizado: Alumno = { ...alumno, etapaServicioId };
    const { lista, nuevo } = registrar(
      e, "alumno", alumnoId, alumno.nombre, "movio",
      `${alumno.nombre}: ${origen?.nombre ?? "—"} → ${destino.nombre}.`,
    );
    guardar({ ...e, alumnos: e.alumnos.map((a) => (a.id === alumnoId ? actualizado : a)), actividad: lista });
    empujar({ tipo: "upsert", tabla: "alumnos", filas: [actualizado] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  crearEtapaServicio(datos: { nombre: string; color: EtapaServicio["color"] }): ID {
    const e = snapshot();
    const etapa: EtapaServicio = {
      id: nuevoId("ets"), nombre: datos.nombre.trim(), color: datos.color,
      orden: Math.max(-1, ...e.etapasServicio.map((x) => x.orden)) + 1, creadoEn: ahora(),
    };
    const { lista, nuevo } = registrar(e, "config", etapa.id, etapa.nombre, "creo", `Se creó la etapa de servicio «${etapa.nombre}».`);
    guardar({ ...e, etapasServicio: [...e.etapasServicio, etapa], actividad: lista });
    empujar({ tipo: "upsert", tabla: "etapas_servicio", filas: [etapa] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return etapa.id;
  },

  editarEtapaServicio(id: ID, cambios: Partial<Pick<EtapaServicio, "nombre" | "color">>) {
    const e = snapshot();
    const etapa = e.etapasServicio.find((x) => x.id === id);
    if (!etapa) return;
    const actualizada: EtapaServicio = { ...etapa, ...cambios, nombre: (cambios.nombre ?? etapa.nombre).trim() };
    const detalle = actualizada.nombre !== etapa.nombre
      ? `La etapa de servicio «${etapa.nombre}» pasó a llamarse «${actualizada.nombre}».`
      : `Se editó la etapa de servicio «${etapa.nombre}».`;
    const { lista, nuevo } = registrar(e, "config", id, actualizada.nombre, "actualizo", detalle);
    guardar({ ...e, etapasServicio: e.etapasServicio.map((x) => (x.id === id ? actualizada : x)), actividad: lista });
    empujar({ tipo: "upsert", tabla: "etapas_servicio", filas: [actualizada] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Recibe los ids en el orden nuevo y reescribe el `orden` de cada una: al
     arrastrar, una etapa puede saltar varias posiciones de una vez. */
  ordenarEtapasServicio(ids: ID[]) {
    const e = snapshot();
    const cambiadas: EtapaServicio[] = [];
    const etapasServicio = e.etapasServicio.map((x) => {
      const i = ids.indexOf(x.id);
      if (i < 0 || x.orden === i) return x;
      const y = { ...x, orden: i };
      cambiadas.push(y);
      return y;
    });
    if (cambiadas.length === 0) return;
    guardar({ ...e, etapasServicio });
    empujar({ tipo: "upsert", tabla: "etapas_servicio", filas: cambiadas });
  },

  /* Borrar una etapa con alumnos adentro los pasa antes a otra: un alumno no
     puede quedar colgado de una columna que ya no existe. "Adentro" es donde
     se lo ve: si se borra la primera, también se llevan los que no tenían
     etapa, que se dibujaban ahí. Siempre queda al menos una etapa. */
  eliminarEtapaServicio(id: ID, destinoId?: ID) {
    const e = snapshot();
    const etapas = etapasDeServicio(e);
    const etapa = etapas.find((x) => x.id === id);
    if (!etapa || etapas.length <= 1) return;
    const restantes = etapas.filter((x) => x.id !== id);
    const destino = restantes.find((x) => x.id === destinoId) ?? restantes[0];
    const movidos: Alumno[] = [];
    const alumnos = e.alumnos.map((a) => {
      if (etapaDelAlumno(etapas, a)?.id !== id) return a;
      const y: Alumno = { ...a, etapaServicioId: destino.id };
      movidos.push(y);
      return y;
    });
    const detalle = movidos.length
      ? `Se eliminó la etapa de servicio «${etapa.nombre}»: ${movidos.length} ${movidos.length === 1 ? "alumno pasó" : "alumnos pasaron"} a «${destino.nombre}».`
      : `Se eliminó la etapa de servicio «${etapa.nombre}».`;
    const { lista, nuevo } = registrar(e, "config", id, etapa.nombre, "elimino", detalle);
    guardar({
      ...e, alumnos, actividad: lista,
      etapasServicio: e.etapasServicio.filter((x) => x.id !== id),
    });
    /* Primero los alumnos y después la etapa: si algo se corta en el medio,
       queda una etapa de más, no alumnos apuntando a una que no existe. */
    if (movidos.length) empujarEnLotes("alumnos", movidos);
    empujar({ tipo: "delete", tabla: "etapas_servicio", ids: [id] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* ---------- Alta de lead con su contacto ----------

     Un lead nuevo SIEMPRE nace con un contacto. Sin esto la separacion es
     decorativa: `contactos` se queda con los que migraron y todo lo que entra
     despues vuelve a tener la identidad metida adentro de la oportunidad.

     Si ya existe un contacto con ese email, se REUSA — es la misma persona
     volviendo. Ahi es donde la separacion empieza a pagar: la segunda
     oportunidad hereda de que anuncio vino la primera vez, que es exactamente
     lo que hoy se pierde.

     El contacto nuevo se queda con el id del lead, igual que en la migracion.
     `ventas.contactoId` guarda hoy ids de LEADS (lo leen alumnos, conciliacion
     y metricas), asi que mientras los ids coincidan ese campo es cierto de las
     dos maneras. Para una persona que vuelve, el lead nuevo tiene otro id que
     su contacto: la venta de ESE lead sigue resolviendo contra `leads`, que es
     lo que el codigo de ventas hace hoy. Cuando ventas pase a apuntar al
     contacto, esa ambiguedad se termina; hasta entonces existe y conviene
     saberlo. */
  altaDeLead(datos: Omit<Lead, "id" | "contactoId">, etiqueta: string): ID {
    const e = snapshot();
    const leadId = nuevoId("lea");
    const { leads: [lead], contactos, tocados } = asignarContactos(
      [{ ...datos, id: leadId, contactoId: undefined } as Lead], e.contactos,
    );
    const reusado = lead.contactoId !== leadId;
    const { lista, nuevo: act } = registrar(
      e, "lead", leadId, etiqueta, "creo",
      reusado ? `Se creó «${etiqueta}» sobre un contacto que ya existía.` : `Se creó «${etiqueta}».`,
    );
    guardar({ ...e, contactos, leads: [lead, ...e.leads], actividad: lista });
    /* Primero el contacto: la FK leads→contactos rechaza un lead que apunte a
       un contacto todavia no escrito, y la cola respeta el orden. */
    empujar({ tipo: "upsert", tabla: "contactos", filas: tocados });
    empujar({ tipo: "upsert", tabla: "leads", filas: [lead] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [act] });
    return leadId;
  },

  /* Editar un lead arrastra a su contacto en los campos que son de la PERSONA.
     Si no, se editan en Leads y el contacto queda con el nombre viejo: dos
     verdades para el mismo dato, que es lo que la separacion venia a evitar. */
  editarLead(id: ID, cambios: Partial<Lead>, etiqueta: string) {
    const e = snapshot();
    const lead = e.leads.find((l) => l.id === id);
    const contactoId = lead?.contactoId ?? id;
    const dePersona = {
      nombre: cambios.nombre, email: cambios.email, telefono: cambios.telefono,
      pais: cambios.pais, inglesNivel: cambios.inglesNivel,
      aniosExperiencia: cambios.aniosExperiencia,
    };
    /* Vacio NO es un dato: un input de texto de React manda "" cuando esta
       vacio, nunca undefined. Sin este filtro, editar un lead que no tenia
       telefono le borraba el telefono al contacto — que es compartido, asi que
       el dato bueno de OTRA oportunidad de la misma persona desaparecia.
       Para borrar un dato de la persona esta la ficha del contacto; desde una
       oportunidad se completa, no se vacia. */
    const conValor = Object.fromEntries(
      Object.entries(dePersona).filter(([, v]) => v !== undefined && v !== ""),
    );
    const tocaPersona = Object.keys(conValor).length > 0;

    acciones.actualizar<Lead>("leads", id, cambios, etiqueta);
    if (!tocaPersona) return;

    /* Despues del actualizar: ese guardar ya dejo el estado nuevo, y leerlo de
       `e` escribiria el contacto con los datos viejos del lead. */
    const ahoraE = snapshot();
    const c = ahoraE.contactos.find((x) => x.id === contactoId);
    if (c) {
      const actualizado: Contacto = { ...c, ...conValor };
      guardar({
        ...ahoraE,
        contactos: ahoraE.contactos.map((x) => (x.id === contactoId ? actualizado : x)),
      });
      empujar({ tipo: "upsert", tabla: "contactos", filas: [actualizado] });
    }

    /* Y el nombre, el mail o el teléfono que se corrigieron, en todo lo
       demás de la persona: sus llamadas (CRM y Agenda), sus ventas, su
       servicio y sus otras oportunidades. Sólo lo que cambió en este
       formulario: guardar otro dato no reescribe el nombre en todos lados. */
    const cambio = (k: "nombre" | "email" | "telefono") =>
      cambios[k] !== undefined && cambios[k] !== "" && cambios[k] !== lead?.[k] ? cambios[k] : undefined;
    acciones.corregirPersona(id, { nombre: cambio("nombre"), email: cambio("email"), telefono: cambio("telefono") });
  },

  /* ---------- Los datos de la persona, una sola versión ----------
     El nombre, el mail y el teléfono se corrigen donde sea (Leads, la
     ficha, la Agenda, el servicio, una venta) y quedan corregidos en todos
     lados: el contacto, sus oportunidades, sus llamadas (el CRM y la
     Agenda), sus ventas y su servicio. Vacío no es un dato: no borra nada.
     A la base va sólo esa columna de cada fila, no la fila entera. */
  corregirPersona(idPersona: ID, cambios: { nombre?: string; email?: string; telefono?: string }) {
    const e = snapshot();
    const p = personaDe(e, idPersona);
    if (!p) return;
    const nombre = cambios.nombre?.trim() || undefined;
    const email = cambios.email?.trim() || undefined;
    const telefono = cambios.telefono?.trim() || undefined;
    if (!nombre && !email && !telefono) return;

    /* Cada colección con sus nombres de columna para lo mismo. */
    const tocar = <T extends { id: ID }>(filas: T[], campos: Partial<Record<keyof T, string | undefined>>) => {
      const valores = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)) as Partial<T>;
      const claves = Object.keys(valores) as (keyof T)[];
      return claves.length === 0 ? [] : filas.filter((x) => claves.some((k) => x[k] !== valores[k])).map((x) => ({ fila: { ...x, ...valores }, valores }));
    };
    const contactos = p.contacto ? tocar([p.contacto], { nombre, email, telefono }) : [];
    const leads = tocar(p.leads, { nombre, email, telefono });
    const sesiones = tocar(p.sesiones, { invitado: nombre, email });
    const ventas = tocar(p.ventas, { contactoNombre: nombre });
    const alumnos = tocar(p.alumnos, { nombre, email });
    const total = contactos.length + leads.length + sesiones.length + ventas.length + alumnos.length;
    if (total === 0) return;

    const cuando = ahora();
    const reemplazar = <T extends { id: ID }>(lista: T[], cambiadas: { fila: T }[], extra: Partial<T> = {}) => {
      if (cambiadas.length === 0) return lista;
      const por = new Map(cambiadas.map((c) => [c.fila.id, { ...c.fila, ...extra }]));
      return lista.map((x) => por.get(x.id) ?? x);
    };
    const que = [nombre && `el nombre (${nombre})`, email && `el mail (${email})`, telefono && `el teléfono (${telefono})`].filter(Boolean).join(", ");
    const { lista, nuevo } = registrar(e, "contacto", p.clave, nombre ?? p.nombre, "actualizo",
      `Se corrigió ${que} en todos lados: ${total} ${total === 1 ? "registro" : "registros"} (contacto, oportunidades, llamadas, ventas y servicio).`);
    guardar({
      ...e,
      contactos: reemplazar(e.contactos, contactos),
      leads: reemplazar(e.leads, leads, { actualizadoEn: cuando }),
      sesiones: reemplazar(e.sesiones, sesiones),
      ventas: reemplazar(e.ventas, ventas),
      alumnos: reemplazar(e.alumnos, alumnos),
      actividad: lista,
    });
    const aLaBase = (tabla: string, cambiadas: { fila: { id: ID }; valores: object }[], extra: object = {}) => {
      if (cambiadas.length) empujarUpdate(tabla, cambiadas.map((c) => c.fila.id), { ...cambiadas[0].valores, ...extra });
    };
    aLaBase("contactos", contactos);
    aLaBase("leads", leads, { actualizadoEn: cuando });
    aLaBase("sesiones", sesiones);
    aLaBase("ventas", ventas);
    aLaBase("alumnos", alumnos);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* ---------- Chat del equipo, en la ficha de cada persona ---------- */

  comentar(contactoId: ID, texto: string, autor: string, autorEmail?: string): void {
    const limpio = texto.trim();
    if (!limpio) return;
    const e = snapshot();
    const c: Comentario = {
      id: nuevoId("com"), contactoId, autor, texto: limpio, creadoEn: ahora(),
      ...(autorEmail ? { autorEmail } : {}),
    };
    guardar({ ...e, comentarios: [...(e.comentarios ?? []), c] });
    empujar({ tipo: "upsert", tabla: "comentarios", filas: [c] });
  },

  borrarComentario(id: ID): void {
    const e = snapshot();
    guardar({ ...e, comentarios: (e.comentarios ?? []).filter((c) => c.id !== id) });
    empujar({ tipo: "delete", tabla: "comentarios", ids: [id] });
  },

  /* ---------- Alta completa de una venta ----------
     El asistente junta la venta, su plan de cuotas y los cobros que ya
     entraron. Se escribe todo junto: media venta cargada (cuotas sin
     venta, pagos sin cuota) es peor que ninguna. */

  registrarVenta(datos: {
    venta: Venta;
    cuotas: Cuota[];
    cobros: (DatosCobro & { cuotaId: ID })[];
    /* La llamada del CRM desde la que se cargó (si no, la última de la persona). */
    sesionId?: ID;
  }): ID {
    const e = snapshot();
    const { venta } = datos;

    let nuevosPagos: Pago[] = [];

    for (const cobro of datos.cobros) {
      if (cobro.monto <= 0.001) continue;
      const mov = cobro.movimientoId ? e.movimientos.find((m) => m.id === cobro.movimientoId) : undefined;

      if (mov) {
        /* El fee lo dice la pasarela, no la tabla de procesadores. */
        nuevosPagos.push({
          ...pagoDesdeMovimiento(mov, cobro.cuotaId, cobro.monto), id: nuevoId("pag"),
          ...(cobro.comprobante ? { comprobante: cobro.comprobante } : {}),
          ...extrasDeCobro(cobro), chequeado: true,
        } as Pago);
        continue;
      }

      const proc = e.procesadores.find((x) => x.id === cobro.procesadorId);
      const feeRate = proc?.feeRate ?? 0;
      nuevosPagos.push({
        id: nuevoId("pag"), cuotaId: cobro.cuotaId, procesadorId: cobro.procesadorId,
        monto: Math.round(cobro.monto * 100) / 100, moneda: venta.moneda,
        feeRate, feeMonto: Math.round(cobro.monto * feeRate * 100) / 100,
        fecha: cobro.fecha, referencia: cobro.referencia || undefined,
        comprobante: cobro.comprobante,
        ...extrasDeCobro(cobro),
        creadoEn: ahora(),
      });
    }
    nuevosPagos = conDatosDePlanilla(nuevosPagos, datos.cuotas, [], true);

    /* Un pago de pasarela puede cubrir más de una cuota (la reserva y la
       primera, juntas) o quedar a medias: se da por conciliado recién
       cuando lo imputado, contando lo que ya estaba en la base, llega a
       su monto. Igual que en conciliar(). */
    const movimientosTocados = new Map<ID, Movimiento>();
    for (const id of new Set(nuevosPagos.map((p) => p.movimientoId).filter(Boolean) as ID[])) {
      const mov = e.movimientos.find((m) => m.id === id);
      if (!mov) continue;
      const suyos = [...nuevosPagos, ...e.pagos].filter((p) => p.movimientoId === id);
      const imputado = suyos.reduce((a, p) => a + p.monto, 0);
      const saldado = imputado >= mov.monto - 0.01;
      const unaSola = suyos.length === 1;
      movimientosTocados.set(id, {
        ...mov,
        estado: saldado ? "conciliado" : "pendiente",
        pagoId: unaSola ? suyos[0].id : mov.pagoId,
        cuotaId: unaSola ? suyos[0].cuotaId : mov.cuotaId,
        ventaId: venta.id,
        conciliadoEn: saldado ? ahora() : mov.conciliadoEn,
        conciliadoPor: saldado ? (e.ajustes.responsable || "Apicanta") : mov.conciliadoPor,
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

    /* Quien compra pasa a ser alumno (o se enlaza al que ya era), y eso
       también queda en la actividad: si no, el alumno aparecía de la nada. */
    const conAlumno = alumnoDesdeVenta(e, venta, cuotas);
    let actividad = lista;
    const registros = [nuevo];
    const alumnoNuevo = conAlumno.tocado && !e.alumnos.some((a) => a.id === conAlumno.tocado!.id) ? conAlumno.tocado : null;
    if (alumnoNuevo) {
      const r = registrar(
        { ...e, actividad: lista }, "alumno", alumnoNuevo.id, alumnoNuevo.nombre, "creo",
        `${alumnoNuevo.nombre} pasó a Alumnos con su compra (${alumnoNuevo.plan || "sin plan"}).`,
      );
      actividad = r.lista;
      registros.push(r.nuevo);
    }

    /* El CRM se entera: la llamada de la que salió la venta toma el estado
       de compra que corresponde (si nadie le había puesto uno) y su lead
       pasa a la etapa ganada (lib/etapas-auto.ts). */
    const t = nuevaTanda();
    const llamada = llamadaDeVenta(e, venta, datos.sesionId);
    if (llamada && !llamada.estadoLlamada) {
      const op = opcionDeCompra(e, venta, cuotas);
      if (op) {
        cargarLlamadas(t, e, [{
          id: llamada.id, cambios: { estadoLlamada: op.nombre },
          detalle: `${llamada.invitado}: Estado de Llamada → ${op.nombre} (por la venta).`,
        }]);
      }
    }
    const lead = (venta.contactoId ? e.leads.find((l) => l.id === venta.contactoId) : undefined)
      ?? (venta.contactoId ? leadDeSesion(e.leads, { contactoId: venta.contactoId }) : undefined)
      ?? (llamada ? leadDeSesion(e.leads, llamada) : undefined);
    if (lead) moverEnTanda(t, e, t.leads.get(lead.id) ?? lead, ["compro"], "cargó la venta");

    guardar(conTanda({
      ...e,
      alumnos: conAlumno.alumnos,
      ventas: [venta, ...e.ventas],
      cuotas: [...cuotas, ...e.cuotas],
      pagos: [...nuevosPagos, ...e.pagos],
      movimientos,
      actividad,
    }, t));

    empujar({ tipo: "upsert", tabla: "ventas", filas: [venta] });
    if (conAlumno.tocado) empujar({ tipo: "upsert", tabla: "alumnos", filas: [conAlumno.tocado] });
    empujar({ tipo: "upsert", tabla: "cuotas", filas: cuotas });
    if (nuevosPagos.length) empujar({ tipo: "upsert", tabla: "pagos", filas: nuevosPagos });
    if (movimientosTocados.size) empujar({ tipo: "upsert", tabla: "movimientos", filas: [...movimientosTocados.values()] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: registros });
    empujarTanda(t);
    return venta.id;
  },

  /* ---------- Pago de una cuota ya cargada ----------
     Uno o varios cobros (uno por medio de pago), conciliados contra una
     pasarela o con su comprobante. Si lo cobrado no cubre la cuota, el
     saldo se reacomoda según `reajuste`:
     - "repartir": la cuota queda en lo que se pagó y el saldo se reparte
       parejo entre las cuotas pendientes que siguen;
     - "proxima": el saldo se suma entero a la próxima cuota pendiente;
     - "pendiente": la cuota queda como estaba, con su saldo.
     Si no hay cuotas después, el saldo pasa a una cuota nueva un mes más
     tarde. El total de la venta no cambia nunca: sólo se mueve el saldo. */

  registrarPago(datos: {
    cuotaId: ID;
    cobros: DatosCobro[];
    reajuste: "repartir" | "proxima" | "pendiente";
  }): boolean {
    const e = snapshot();
    const cuota = e.cuotas.find((c) => c.id === datos.cuotaId);
    const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
    if (!cuota || !venta) return false;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    let nuevosPagos: Pago[] = [];
    for (const cobro of datos.cobros) {
      if (cobro.monto <= 0.001) continue;
      const mov = cobro.movimientoId ? e.movimientos.find((m) => m.id === cobro.movimientoId) : undefined;
      if (mov) {
        nuevosPagos.push({
          ...pagoDesdeMovimiento(mov, cuota.id, cobro.monto), id: nuevoId("pag"),
          ...(cobro.comprobante ? { comprobante: cobro.comprobante } : {}),
          ...extrasDeCobro(cobro), chequeado: true,
        } as Pago);
        continue;
      }
      const proc = e.procesadores.find((x) => x.id === cobro.procesadorId);
      const feeRate = proc?.feeRate ?? 0;
      nuevosPagos.push({
        id: nuevoId("pag"), cuotaId: cuota.id, procesadorId: cobro.procesadorId,
        monto: r2(cobro.monto), moneda: venta.moneda,
        feeRate, feeMonto: r2(cobro.monto * feeRate),
        fecha: cobro.fecha, referencia: cobro.referencia || undefined,
        comprobante: cobro.comprobante, ...extrasDeCobro(cobro), creadoEn: ahora(),
      });
    }
    if (nuevosPagos.length === 0) return false;
    {
      const cuotasVenta = e.cuotas.filter((c) => c.ventaId === venta.id);
      const idsCuotas = new Set(cuotasVenta.map((c) => c.id));
      nuevosPagos = conDatosDePlanilla(nuevosPagos, cuotasVenta, e.pagos.filter((p) => idsCuotas.has(p.cuotaId)), false);
    }

    const pagos = [...nuevosPagos, ...e.pagos];
    const cubierto = r2(pagos.filter((p) => p.cuotaId === cuota.id).reduce((a, p) => a + p.monto, 0));
    const saldo = r2(cuota.monto - cubierto);

    const cambiadas = new Map<ID, Cuota>();
    let nueva: Cuota | undefined;
    let detalleReajuste = "";

    if (saldo <= 0.01) {
      cambiadas.set(cuota.id, { ...cuota, estado: "pagada" });
    } else if (datos.reajuste !== "pendiente") {
      /* La cuota queda en lo que se pagó, y saldada. */
      cambiadas.set(cuota.id, { ...cuota, monto: cubierto, estado: "pagada" });
      const orden = (c: Cuota) => c.numero;
      const siguientes = e.cuotas
        .filter((c) => c.ventaId === venta.id && c.id !== cuota.id && c.estado === "pendiente" && orden(c) > orden(cuota))
        .sort((a, b) => orden(a) - orden(b));

      if (siguientes.length === 0) {
        const ultima = e.cuotas.filter((c) => c.ventaId === venta.id).sort((a, b) => orden(b) - orden(a))[0] ?? cuota;
        const vence = new Date(ultima.vence ?? cuota.vence ?? ahora());
        vence.setMonth(vence.getMonth() + 1);
        nueva = {
          id: nuevoId("cuo"), ventaId: venta.id, numero: orden(ultima) + 1, monto: saldo,
          vence: vence.toISOString(), estado: "pendiente", esReserva: false,
        };
        detalleReajuste = ` El saldo de ${saldo} pasó a una cuota nueva, la ${nueva.numero}.`;
      } else if (datos.reajuste === "proxima") {
        const prox = siguientes[0];
        cambiadas.set(prox.id, { ...prox, monto: r2(prox.monto + saldo) });
        detalleReajuste = ` El saldo de ${saldo} se sumó a la cuota ${prox.numero}.`;
      } else {
        const parte = Math.floor((saldo / siguientes.length) * 100) / 100;
        siguientes.forEach((c, k) => {
          const extra = k === siguientes.length - 1 ? r2(saldo - parte * (siguientes.length - 1)) : parte;
          cambiadas.set(c.id, { ...c, monto: r2(c.monto + extra) });
        });
        detalleReajuste = ` El saldo de ${saldo} se repartió en ${siguientes.length === 1 ? "la cuota que sigue" : `las ${siguientes.length} cuotas que siguen`}.`;
      }
    }

    const cuotas = [
      ...(nueva ? [nueva] : []),
      ...e.cuotas.map((c) => cambiadas.get(c.id) ?? c),
    ];

    /* Igual que al registrar una venta: el pago de pasarela se da por
       conciliado cuando lo imputado llega a su monto. */
    const movimientosTocados = new Map<ID, Movimiento>();
    for (const id of new Set(nuevosPagos.map((p) => p.movimientoId).filter(Boolean) as ID[])) {
      const mov = e.movimientos.find((m) => m.id === id);
      if (!mov) continue;
      const suyos = pagos.filter((p) => p.movimientoId === id);
      const saldado = suyos.reduce((a, p) => a + p.monto, 0) >= mov.monto - 0.01;
      const unaSola = suyos.length === 1;
      movimientosTocados.set(id, {
        ...mov,
        estado: saldado ? "conciliado" : "pendiente",
        pagoId: unaSola ? suyos[0].id : mov.pagoId,
        cuotaId: unaSola ? suyos[0].cuotaId : mov.cuotaId,
        ventaId: venta.id,
        conciliadoEn: saldado ? ahora() : mov.conciliadoEn,
        conciliadoPor: saldado ? (e.ajustes.responsable || "Apicanta") : mov.conciliadoPor,
      });
    }
    const movimientos = movimientosTocados.size === 0
      ? e.movimientos
      : e.movimientos.map((m) => movimientosTocados.get(m.id) ?? m);

    const cobrado = r2(nuevosPagos.reduce((a, p) => a + p.monto, 0));
    const nombreCuota = cuota.esReserva ? "la reserva" : `la cuota ${cuota.numero}`;
    const { lista, nuevo } = registrar(
      e, "transaccion", venta.id, venta.contactoNombre, "actualizo",
      `Se registró un pago de ${cobrado} en ${nombreCuota} de ${venta.contactoNombre}.${detalleReajuste}`,
    );

    guardar({ ...e, pagos, cuotas, movimientos, actividad: lista });
    empujar({ tipo: "upsert", tabla: "pagos", filas: nuevosPagos });
    const cuotasEscritas = [...(nueva ? [nueva] : []), ...cambiadas.values()];
    if (cuotasEscritas.length) empujar({ tipo: "upsert", tabla: "cuotas", filas: cuotasEscritas });
    if (movimientosTocados.size) empujar({ tipo: "upsert", tabla: "movimientos", filas: [...movimientosTocados.values()] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
  },

  /* ---------- Importar la hoja Ventas de la planilla de Angelo ----------
     Lo que armó importarPlanilla (lib/angelo.ts) entra de una: lo que ya
     estaba con el mismo id se reemplaza, lo nuevo se suma. Por eso se puede
     reimportar la planilla las veces que haga falta sin duplicar nada. */
  importarPlanilla(r: ResultadoImport): void {
    const e = snapshot();
    const reemplazar = <T extends { id: ID }>(lista: T[], nuevos: T[]): T[] => {
      const ids = new Set(nuevos.map((x) => x.id));
      return [...nuevos, ...lista.filter((x) => !ids.has(x.id))];
    };
    /* Una cuota que el plan nuevo ya no tiene se borra, salvo que tenga un
       cobro cargado en la app (no en la planilla): ese no se pierde. */
    const pagosImportados = new Set(r.pagos.map((p) => p.id));
    const conCobroPropio = new Set(e.pagos.filter((p) => !pagosImportados.has(p.id)).map((p) => p.cuotaId));
    const sobran = new Set(r.cuotasQueSobran.filter((id) => !conCobroPropio.has(id)));

    const ajustes = r.proyectos.length
      ? { ...e.ajustes, proyectos: [...(e.ajustes.proyectos ?? []), ...r.proyectos] }
      : e.ajustes;
    const { lista, nuevo } = registrar(
      e, "transaccion", "planilla-angelo", "Planilla de Angelo", "importo",
      `Se importó la hoja Ventas: ${r.resumen.ventas} ventas y ${r.resumen.cobros} cobros de ${r.resumen.personas} personas (${r.resumen.filas} filas).`,
    );

    guardar({
      ...e,
      ajustes,
      equipo: reemplazar(e.equipo, r.equipo),
      productos: reemplazar(e.productos, r.productos),
      procesadores: reemplazar(e.procesadores, r.procesadores),
      embudos: reemplazar(e.embudos, r.embudos),
      contactos: reemplazar(e.contactos, r.contactos),
      leads: reemplazar(e.leads, r.leads),
      ventas: reemplazar(e.ventas, r.ventas),
      cuotas: reemplazar(e.cuotas.filter((c) => !sobran.has(c.id)), r.cuotas),
      pagos: reemplazar(e.pagos, r.pagos),
      actividad: lista,
    });

    /* En orden: primero lo que los demás nombran. */
    if (r.equipo.length) empujar({ tipo: "upsert", tabla: "equipo", filas: r.equipo });
    if (r.productos.length) empujar({ tipo: "upsert", tabla: "productos", filas: r.productos });
    if (r.procesadores.length) empujar({ tipo: "upsert", tabla: "procesadores", filas: r.procesadores });
    if (r.embudos.length) empujar({ tipo: "upsert", tabla: "embudos", filas: r.embudos });
    if (r.proyectos.length) empujar({ tipo: "upsert", tabla: "ajustes", filas: [filaAjustes(ajustes)] });
    empujarEnLotes("contactos", r.contactos);
    empujarEnLotes("leads", r.leads);
    empujarEnLotes("ventas", r.ventas);
    empujarEnLotes("cuotas", r.cuotas);
    empujarEnLotes("pagos", r.pagos);
    if (sobran.size) empujar({ tipo: "delete", tabla: "cuotas", ids: [...sobran] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* ---------- Un cobro ya cargado: lo que se corrige desde Finanzas ----------
     La comisión del procesador de un cobro que no se concilió (la
     Financiera, Trust, una transferencia): se pone a mano y queda marcada,
     así no la pisa la tasa de la cuenta. La de un cobro conciliado no se
     toca: es la real de la pasarela. También el tilde de "Pasado Financiera
     / Chequeado en plataforma" y los datos de quien pagó. */
  editarPago(id: ID, cambios: {
    feeMonto?: number; chequeado?: boolean; pagador?: string; cuit?: string; tipoCambio?: number; cvu?: string;
  }): boolean {
    const e = snapshot();
    const pago = e.pagos.find((p) => p.id === id);
    if (!pago) return false;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const actualizado: Pago = { ...pago };
    const partes: string[] = [];

    if (cambios.feeMonto !== undefined && !pago.movimientoId) {
      const fee = Math.max(0, r2(cambios.feeMonto));
      if (fee !== pago.feeMonto || !pago.feeManual) {
        actualizado.feeMonto = fee;
        actualizado.feeRate = pago.monto > 0 ? Math.round((fee / pago.monto) * 10000) / 10000 : 0;
        actualizado.feeManual = true;
        partes.push(`la comisión del procesador quedó en ${fee}`);
      }
    }
    if (cambios.chequeado !== undefined && cambios.chequeado !== Boolean(pago.chequeado)) {
      actualizado.chequeado = cambios.chequeado;
      partes.push(cambios.chequeado ? "quedó chequeado" : "dejó de estar chequeado");
    }
    if (cambios.pagador !== undefined && cambios.pagador.trim() !== (pago.pagador ?? "")) {
      actualizado.pagador = cambios.pagador.trim();
      partes.push("se cambió quién transfirió");
    }
    if (cambios.cuit !== undefined && cambios.cuit.trim() !== (pago.cuit ?? "")) {
      actualizado.cuit = cambios.cuit.trim();
      partes.push("se cambió el CUIT");
    }
    if (cambios.cvu !== undefined && cambios.cvu.replace(/[\s.-]/g, "") !== (pago.cvu ?? "")) {
      actualizado.cvu = cambios.cvu.replace(/[\s.-]/g, "");
      partes.push("se cambió el CBU/CVU");
    }
    if (cambios.tipoCambio !== undefined && cambios.tipoCambio !== pago.tipoCambio) {
      const tc = cambios.tipoCambio > 0 ? cambios.tipoCambio : undefined;
      actualizado.tipoCambio = tc;
      actualizado.montoArs = tc ? r2(pago.monto * tc) : undefined;
      partes.push(tc ? `el tipo de cambio quedó en ${tc}` : "se sacó el tipo de cambio");
    }
    if (partes.length === 0) return false;

    const cuota = e.cuotas.find((c) => c.id === pago.cuotaId);
    const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
    const { lista, nuevo } = registrar(
      e, "transaccion", venta?.id ?? pago.id, venta?.contactoNombre ?? "Cobro", "actualizo",
      `Cobro del ${pago.fecha.slice(0, 10)}${venta ? ` de ${venta.contactoNombre}` : ""}: ${partes.join(", ")}.`,
    );
    guardar({ ...e, pagos: e.pagos.map((p) => (p.id === id ? actualizado : p)), actividad: lista });
    empujar({ tipo: "upsert", tabla: "pagos", filas: [actualizado] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
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

    let nuevosPagos: Pago[] = [];
    for (const imp of imputaciones) {
      if (imp.monto <= 0.001) continue;
      if (!e.cuotas.some((c) => c.id === imp.cuotaId)) continue;
      nuevosPagos.push({ ...pagoDesdeMovimiento(mov, imp.cuotaId, imp.monto), id: nuevoId("pag") } as Pago);
    }
    if (nuevosPagos.length === 0) return false;
    {
      /* Un movimiento puede repartirse entre cuotas de ventas distintas: la
         característica se calcula venta por venta. */
      const porVenta = new Map<ID, Pago[]>();
      for (const p of nuevosPagos) {
        const v = e.cuotas.find((c) => c.id === p.cuotaId)?.ventaId ?? "";
        porVenta.set(v, [...(porVenta.get(v) ?? []), p]);
      }
      nuevosPagos = [...porVenta.entries()].flatMap(([v, ps]) => {
        const cuotasVenta = e.cuotas.filter((c) => c.ventaId === v);
        const ids = new Set(cuotasVenta.map((c) => c.id));
        return conDatosDePlanilla(ps, cuotasVenta, e.pagos.filter((p) => ids.has(p.cuotaId)), false);
      });
    }

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

  /* El origen que sale de las UTMs (Ajustes → UTMs), en las ventas que no
     lo tenían: una sola entrada en la actividad para todas. */
  completarOrigenes(lista: { id: ID; cambios: Partial<Venta> }[]): number {
    if (lista.length === 0) return 0;
    const e = snapshot();
    const porId = new Map(lista.map((x) => [x.id, x.cambios]));
    const tocadas: Venta[] = [];
    const ventas = e.ventas.map((v) => {
      const c = porId.get(v.id);
      if (!c) return v;
      const nueva = { ...v, ...c };
      tocadas.push(nueva);
      return nueva;
    });
    const { lista: actividad, nuevo } = registrar(
      e, "config", "utms", "UTMs", "actualizo",
      `Se completó el origen de ${tocadas.length} ${tocadas.length === 1 ? "venta" : "ventas"} con las UTMs.`,
    );
    guardar({ ...e, ventas, actividad });
    empujarEnLotes("ventas", tocadas);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return tocadas.length;
  },

  ajustesSilencioso(cambios: Partial<Ajustes>) {
    const e = snapshot();
    const ajustes = { ...e.ajustes, ...cambios };
    guardar({ ...e, ajustes });
    empujar({ tipo: "upsert", tabla: "ajustes", filas: [filaAjustes(ajustes)] });
  },

  importarLeads(filas: Omit<Lead, "id">[]): number {
    const e = snapshot();
    /* Cada fila nace con su contacto, y dos filas del mismo mail —dentro del
       CSV o contra lo que ya estaba— van al MISMO contacto. Antes el import
       creaba leads sin persona: justo el camino por donde entran mas. */
    const { leads: nuevos, contactos, tocados } = asignarContactos(
      filas.map((f) => ({ ...f, id: nuevoId("lead"), contactoId: undefined } as Lead)),
      e.contactos,
    );
    const { lista, nuevo } = registrar(e, "lead", "import", "Importación", "importo", `Se importaron ${nuevos.length} leads.`);
    guardar({ ...e, contactos, leads: [...nuevos, ...e.leads], actividad: lista });
    /* Contactos antes que leads, por la FK. En lotes: un CSV grande de una
       sola vez es lo que PostgREST no se banca. */
    empujarEnLotes("contactos", tocados);
    empujarEnLotes("leads", nuevos);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return nuevos.length;
  },

  /* ---------- Equipo y honorarios ----------
     Lo que cobra cada uno no pasa por Actividad: la lee todo el equipo, y
     esto es sólo de los dueños. La única huella que deja ahí es la de los
     gastos que la liquidación carga en Finanzas, sin montos por persona. */

  /* Crea o edita a alguien del equipo. Si cambia su rol, la tasa con la
     que Finanzas lo calcula se vuelve a leer de lo que cobra. */
  guardarMiembro(m: MiembroEquipo) {
    const e = snapshot();
    const tasa = tasaParaFinanzas(m, e.honorarios.find((h) => h.miembroId === m.id));
    const fila = tasa === undefined ? m : { ...m, comisionRate: tasa };
    const existe = e.equipo.some((x) => x.id === m.id);
    guardar({ ...e, equipo: existe ? e.equipo.map((x) => (x.id === m.id ? fila : x)) : [...e.equipo, fila] });
    empujar({ tipo: "upsert", tabla: "equipo", filas: [fila] });
  },

  /* Guarda lo que cobra alguien y alinea su comisionRate: la tasa con la
     que Finanzas calcula su comisión (o el reparto) tiene que ser la del
     esquema, o Finanzas y la liquidación dirían números distintos. */
  guardarEsquema(esq: EsquemaPago, por?: string) {
    const e = snapshot();
    const actualizado: EsquemaPago = { ...esq, actualizadoEn: ahora(), ...(por ? { actualizadoPor: por } : {}) };
    const existe = e.honorarios.some((h) => h.id === esq.id);
    const honorarios = existe ? e.honorarios.map((h) => (h.id === esq.id ? actualizado : h)) : [...e.honorarios, actualizado];
    const m = e.equipo.find((x) => x.id === esq.miembroId);
    const tasa = m ? tasaParaFinanzas(m, actualizado) : undefined;
    let equipo = e.equipo;
    if (m && tasa !== undefined && Math.abs(tasa - m.comisionRate) > 1e-9) {
      const fila = { ...m, comisionRate: tasa };
      equipo = e.equipo.map((x) => (x.id === m.id ? fila : x));
      empujar({ tipo: "upsert", tabla: "equipo", filas: [fila] });
    }
    guardar({ ...e, equipo, honorarios });
    empujar({ tipo: "upsert", tabla: "honorarios", filas: [actualizado] });
  },

  /* Lo que se carga mientras la liquidación está abierta: cantidades,
     bonos, correcciones, montos a mano, el tipo de cambio. */
  guardarLiquidacion(liq: Liquidacion) {
    const e = snapshot();
    const actualizada: Liquidacion = { ...liq, actualizadoEn: ahora() };
    const existe = e.liquidaciones.some((x) => x.id === liq.id);
    guardar({
      ...e,
      liquidaciones: existe ? e.liquidaciones.map((x) => (x.id === liq.id ? actualizada : x)) : [...e.liquidaciones, actualizada],
    });
    empujar({ tipo: "upsert", tabla: "liquidaciones", filas: [actualizada] });
  },

  /* Cerrar: se guarda la foto de lo que se paga y los sueldos entran a
     Finanzas como gastos del mes (uno por categoría, sin nombres). Si la
     liquidación ya había cargado gastos (se reabrió), se reemplazan. */
  cerrarLiquidacion(liq: Liquidacion, resultado: ResultadoLiquidacion, gastos: Gasto[], por: string) {
    const e = snapshot();
    const cuando = ahora();
    const cerrada: Liquidacion = {
      ...liq, estado: "cerrada", resultado, gastoIds: gastos.map((g) => g.id),
      cerradaEn: cuando, cerradaPor: por, actualizadoEn: cuando,
    };
    const nuevos = new Set(gastos.map((g) => g.id));
    const viejos = e.gastos.filter((g) => g.extra?.liquidacionId === liq.id && !nuevos.has(g.id)).map((g) => g.id);
    const nombre = nombrePeriodo(liq.periodo);
    const { lista, nuevo } = registrar(
      e, "transaccion", liq.id, `Sueldos de ${nombre}`, "creo",
      gastos.length
        ? `Se cerró la liquidación de ${nombre}: los sueldos entraron a Finanzas en ${gastos.length === 1 ? "un gasto" : `${gastos.length} gastos`}.`
        : `Se cerró la liquidación de ${nombre}.`,
    );
    const existe = e.liquidaciones.some((x) => x.id === liq.id);
    guardar({
      ...e,
      liquidaciones: existe ? e.liquidaciones.map((x) => (x.id === liq.id ? cerrada : x)) : [...e.liquidaciones, cerrada],
      gastos: [...gastos, ...e.gastos.filter((g) => g.extra?.liquidacionId !== liq.id)],
      actividad: lista,
    });
    if (viejos.length) empujar({ tipo: "delete", tabla: "gastos", ids: viejos });
    if (gastos.length) empujar({ tipo: "upsert", tabla: "gastos", filas: gastos });
    empujar({ tipo: "upsert", tabla: "liquidaciones", filas: [cerrada] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Reabrir: vuelve a calcularse con los datos de hoy y sus gastos salen de
     Finanzas. Lo marcado como pagado se desmarca: lo que se pague va a ser
     lo que dé al volver a cerrar. */
  reabrirLiquidacion(liq: Liquidacion) {
    const e = snapshot();
    const abierta: Liquidacion = {
      ...liq, estado: "abierta", resultado: null, pagos: {}, gastoIds: [],
      cerradaEn: null, cerradaPor: null, actualizadoEn: ahora(),
    };
    const sacar = e.gastos.filter((g) => g.extra?.liquidacionId === liq.id).map((g) => g.id);
    const nombre = nombrePeriodo(liq.periodo);
    const { lista, nuevo } = registrar(
      e, "transaccion", liq.id, `Sueldos de ${nombre}`, "actualizo",
      `Se reabrió la liquidación de ${nombre}: sus gastos salieron de Finanzas hasta que se vuelva a cerrar.`,
    );
    guardar({
      ...e,
      liquidaciones: e.liquidaciones.map((x) => (x.id === liq.id ? abierta : x)),
      gastos: e.gastos.filter((g) => g.extra?.liquidacionId !== liq.id),
      actividad: lista,
    });
    if (sacar.length) empujar({ tipo: "delete", tabla: "gastos", ids: sacar });
    empujar({ tipo: "upsert", tabla: "liquidaciones", filas: [abierta] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  marcarPagado(liq: Liquidacion, miembroId: IdMiembro, pagado: boolean, por?: string) {
    const pagos = { ...liq.pagos };
    if (pagado) pagos[miembroId] = { pagadoEn: ahora(), ...(por ? { por } : {}) };
    else delete pagos[miembroId];
    acciones.guardarLiquidacion({ ...liq, pagos });
  },

  async reiniciarDemo() {
    const semilla = construirSemilla();
    const { leads, contactos } = asignarContactos(semilla.leads, semilla.contactos);
    const nuevoEstado = { ...semilla, leads, contactos };
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
      const armado = { ...base, ...parsed, ajustes: { ...base.ajustes, ...(parsed.ajustes ?? {}) } };
      /* Un backup de antes de la separacion trae leads sin contacto. */
      const { leads, contactos } = asignarContactos(armado.leads, armado.contactos ?? []);
      const nuevoEstado = { ...armado, leads, contactos };
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
