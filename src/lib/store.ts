"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AccionActividad, Actividad, Ad, AdInsight, Adset, Ajustes, Alumno, Campaign,
  Contacto,
  Campania, CampoPersonalizado, Comprobante, Cuota, EntidadNombre, EstadoApp, Etapa, ID,
  Lead, Meta, Movimiento, Pago, Reporte, Sesion, Venta, Webinar,
} from "./types";
import { pagoDesdeMovimiento } from "./conciliacion";
import { claveEmail, completar } from "./contactos";
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
  /* `sacadas` son las columnas que se quitaron por no existir todavia en la
     tabla. Se guarda para no reintentar en loop la misma. */
  | { tipo: "upsert"; tabla: string; filas: unknown[]; sacadas?: Set<string> }
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
        if (op.tipo === "upsert") {
          const col = columnaFaltante(r.error);
          if (col && !op.sacadas?.has(col)) {
            op.sacadas = (op.sacadas ?? new Set<string>()).add(col);
            op.filas = (op.filas as Record<string, unknown>[]).map(
              ({ [col]: _fuera, ...resto }) => resto,
            );
            console.warn(`[store] «${col}» no existe en ${op.tabla}: se guarda sin ese campo.`);
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
    "campanias", "reportes", "sesiones", "alumnos", "leads", "contactos", "webinars",
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
    if (!c) return;
    const actualizado: Contacto = { ...c, ...conValor };
    guardar({
      ...ahoraE,
      contactos: ahoraE.contactos.map((x) => (x.id === contactoId ? actualizado : x)),
    });
    empujar({ tipo: "upsert", tabla: "contactos", filas: [actualizado] });
  },

  /* ---------- Alta completa de una venta ----------
     El asistente junta la venta, su plan de cuotas y los cobros que ya
     entraron. Se escribe todo junto: media venta cargada (cuotas sin
     venta, pagos sin cuota) es peor que ninguna. */

  registrarVenta(datos: {
    venta: Venta;
    cuotas: Cuota[];
    cobros: {
      cuotaId: ID; procesadorId?: ID; monto: number; fecha: string; referencia?: string;
      movimientoId?: ID; comprobante?: Comprobante;
    }[];
  }): ID {
    const e = snapshot();
    const { venta } = datos;

    const nuevosPagos: Pago[] = [];

    for (const cobro of datos.cobros) {
      if (cobro.monto <= 0.001) continue;
      const mov = cobro.movimientoId ? e.movimientos.find((m) => m.id === cobro.movimientoId) : undefined;

      if (mov) {
        /* El fee lo dice la pasarela, no la tabla de procesadores. */
        nuevosPagos.push({
          ...pagoDesdeMovimiento(mov, cobro.cuotaId, cobro.monto), id: nuevoId("pag"),
          ...(cobro.comprobante ? { comprobante: cobro.comprobante } : {}),
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
        creadoEn: ahora(),
      });
    }

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
    cobros: {
      procesadorId?: ID; monto: number; fecha: string; referencia?: string;
      movimientoId?: ID; comprobante?: Comprobante;
    }[];
    reajuste: "repartir" | "proxima" | "pendiente";
  }): boolean {
    const e = snapshot();
    const cuota = e.cuotas.find((c) => c.id === datos.cuotaId);
    const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
    if (!cuota || !venta) return false;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const nuevosPagos: Pago[] = [];
    for (const cobro of datos.cobros) {
      if (cobro.monto <= 0.001) continue;
      const mov = cobro.movimientoId ? e.movimientos.find((m) => m.id === cobro.movimientoId) : undefined;
      if (mov) {
        nuevosPagos.push({
          ...pagoDesdeMovimiento(mov, cuota.id, cobro.monto), id: nuevoId("pag"),
          ...(cobro.comprobante ? { comprobante: cobro.comprobante } : {}),
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
        comprobante: cobro.comprobante, creadoEn: ahora(),
      });
    }
    if (nuevosPagos.length === 0) return false;

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
