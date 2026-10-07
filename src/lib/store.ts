"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AccionActividad, Actividad, Ad, AdInsight, Adset, Ajustes, Alumno, Campaign,
  Contacto, Devolucion, ProveedorPasarela,
  Arqueo, Campania, CampoPersonalizado, Comentario, Comprobante, Cuota, EntidadNombre, EstadoApp, Etapa, ID,
  Lead, Meta, Movimiento, OpcionCrm, OportunidadCrm, Pago, Reporte, Sesion, Venta, Webinar,
} from "./types";
import type { ConfigSeguimiento, SeguimientoAlumno, Testimonio } from "./types";
import { configSeguimiento, seguimientoVacio } from "./seguimiento";
import type { EsquemaPago, EstadoTraspaso, EtapaServicio, ExtraLiquidacion, Gasto, GastoRecurrente, ID as IdMiembro, Liquidacion, MiembroEquipo, ResultadoLiquidacion, TipoCuenta, Traspaso } from "./types";
import { conciliarPuntas, rutaDe, type Punta } from "./traspasos";
import { gastoAprobado, plantillasDesdeGastos } from "./gastos-recurrentes";
import { cobrosAnulados, NOTA_ANULADO } from "./mercury";
import { conExtraEnMes, mismasTasas, nombrePeriodo, sinExtraEnLiquidacion, tasaParaFinanzas, tasasPorServicio } from "./honorarios";
import {
  alumnoDeVenta, cuotaMensualDeVenta, etapaDelAlumno, etapaInicialDeServicio, etapasDeServicio,
  personaDeVenta, planDeVenta,
} from "./alumnos";
import { pagoDesdeMovimiento, tasaEstimada } from "./conciliacion";
import { cobrosConOtraTasa, conTasa } from "./finanzas";
import { ventasParaAtar, webinarNuevoDeProyecto, webinarsQueFaltan } from "./atar-webinars";
import { caracteristicaDePago, montoArsDe, tipoVentaDePago, type ResultadoImport } from "./angelo";
import { claveEmail, completar } from "./contactos";
import { feeDelPago, feeDesconocido, parcheDeCobro, type ParcheDeCobro } from "./completar-cobros";
import { construirSemilla, estadoVacio } from "./seed";
import { hayNube, nube, tablaFaltante, TABLAS, TABLAS_DE_DUENOS, TABLAS_OPCIONALES } from "./supabase";
import { idAd, idAdset, idCampaign } from "./meta";
import { entraEnTabla, esCompra, opcionesDe, tablasDe, ventaEsDeLlamada } from "./crm";
import { etapaTrasEventos, eventosDeLlamada, leadDeSesion, type EventoEtapa } from "./etapas-auto";
import { estadoDeAgenda, opcionDeCompraPara } from "./estados";
import { personaDe } from "./persona";
import { extraConCorreccion, tituloPerfil, type CampoPerfil } from "./perfil";
import { puedeCargarDevolucion, puedeDarDeBaja, puedeEditar, TIPOS_POR_DEFECTO, type MiAcceso } from "./permisos";
import { esDevolucionConfirmada } from "./devoluciones";
import { atarPropuesta, conciliarReembolsos, type ReembolsoCrudo, type ResultadoReembolsos } from "./reembolsos";
import {
  cambiosDeChequeo, COLUMNAS_QUE_PONE_LA_BASE, conChequeo, conComprobanteNuevo, puedeCambiarComprobante, puedeUsarCasillero,
  quienEs, ROL_DE_CASILLERO, sinColumnasDelControl, type CasilleroChequeo, type VeredictoChequeo,
} from "./control-cobros";

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
   nunca esa copia vieja, que se borra.

   Tampoco van lo que cobra cada uno ni las liquidaciones: son de los dueños
   y no tienen que quedar en una compu, aunque se cierre la sesión o la use
   otro. Se traen de la base cada vez, y al salir se borra la copia entera. */
const CLAVE_NUBE = "apicanta.erp.nube.v1";
const soloEnLaNube = () => ({
  campaigns: [], adsets: [], ads: [], adInsights: [], honorarios: [], liquidaciones: [],
}) satisfies Partial<EstadoApp>;
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
    const copia = hayNube ? { ...parsed, ...soloEnLaNube() } : parsed;
    /* Las copias de antes traían los sueldos: se reescriben sin ellos. */
    if (hayNube && (parsed.honorarios?.length || parsed.liquidaciones?.length)) {
      window.localStorage.setItem(CLAVE_NUBE, JSON.stringify(copia));
    }
    return {
      ...base,
      ...copia,
      ajustes: { ...base.ajustes, ...(parsed.ajustes ?? {}) },
      etapas: parsed.etapas?.length ? parsed.etapas : base.etapas,
    };
  } catch {
    return inicial();
  }
}

/* Al salir se borra la copia, y hasta que la página se recarga no se vuelve
   a escribir: lo que vio esta sesión no queda para el que entre después. */
let sinCopia = false;

export function olvidarCopiaLocal() {
  sinCopia = true;
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(CLAVE_NUBE); } catch { /* modo privado */ }
}

function escribirLocal(e: EstadoApp) {
  if (typeof window === "undefined" || sinCopia) return;
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
    const json = JSON.stringify({ ...e, ...soloEnLaNube() });
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

/* Las tablas opcionales que la base todavía no tiene (falta correr su SQL):
   mientras tanto lo que se carga vive sólo en este navegador, y las pantallas
   que guardan plata lo avisan (una devolución que no se guarda no puede
   pasar de largo). */
const sinCrear = new Set<string>();
export const tablaSinCrear = (tabla: string): boolean => sinCrear.has(tabla);

/* ¿Hay un cambio de esta fila que todavía no llegó a la base? Mientras lo
   haya, lo que avisa Realtime de ella es más viejo que lo que está en
   pantalla: no se aplica (llega otro aviso cuando se termine de escribir). */
export function escrituraPendiente(tabla: string, id: ID): boolean {
  return cola.some((op) => op.tabla === tabla && (
    op.tipo === "upsert" ? (op.filas as { id?: ID }[]).some((f) => f.id === id) : op.ids.includes(id)));
}

/* ---------- quién escribe ----------
   El Shell avisa quién está usando la app (lib/acceso.ts, fijarAcceso). Con
   eso la cola no manda lo que la base va a rechazar por su tipo de cuenta
   (supabase/tipos-cuenta.sql): se avisa y se vuelve a traer todo, así la
   pantalla muestra lo que de verdad quedó. Mientras no se sabe quién es,
   manda todo y decide la base. */
let acceso: MiAcceso | null = null;
export function fijarAcceso(a: MiAcceso | null) { acceso = a; }

/* Lo que la cuenta puede editar; mientras no se sabe quién es, todo (decide
   la base). Lo usan los cambios que un gesto hace solo en otras tablas: la
   etapa del lead, la llamada de la que salió una venta, el nombre corregido
   en todos lados. Si la cuenta no edita esa tabla, se saltean en silencio:
   quien carga una venta desde Administración no tiene por qué ver un error
   por la llamada del CRM, que no es suya. Lo que la persona cambia a
   propósito sí pasa por empujar(), que avisa si no se puede. */
const puedo = (tabla: string) => !acceso || puedeEditar(acceso, tabla);

/* ---------- quién es ----------
   El correo de la sesión. El control de los cobros anota quién cargó y quién
   chequeó cada uno: la base lo sella con la misma sesión (supabase/control-
   cruzado.sql) y acá se pone igual, para que se vea al instante sin esperar a
   volver a leer. Sin nube nadie inicia sesión: va el «Responsable» de Ajustes. */
let correoDeSesion: string | null = null;
if (nube && typeof window !== "undefined") {
  void nube.auth.getSession().then(({ data }) => { correoDeSesion = data.session?.user?.email?.toLowerCase() ?? null; });
  nube.auth.onAuthStateChange((_evento, sesion) => { correoDeSesion = sesion?.user?.email?.toLowerCase() ?? null; });
}
const quienSoy = (e: EstadoApp): string => correoDeSesion ?? (e.ajustes.responsable || "Apicanta");
/* Cómo se lee en la actividad: el nombre que tiene en Equipo, no el correo. */
const nombreDeQuien = (e: EstadoApp, por: string): string => quienEs(e.equipo, por) || por;
/* Los cobros que se cargan en esta sesión llevan quién los cargó. */
const cargadosAhora = (e: EstadoApp, pagos: Pago[]): Pago[] => pagos.map((p) => (p.cargadoPor ? p : { ...p, cargadoPor: quienSoy(e) }));

const oyentesNegadas = new Set<(tabla: string, motivo?: string) => void>();
export function alNegarseEscritura(f: (tabla: string, motivo?: string) => void): () => void {
  oyentesNegadas.add(f);
  return () => { oyentesNegadas.delete(f); };
}

/* Avisa que una llamada quedó en «Devolución» (en el CRM, el cierre del día,
   la Agenda o la ficha): quien puede cargar la devolución ve el formulario, y
   el que no (el closer) se entera de que la carga Finanzas. Se avisa desde el
   store, así cualquier pantalla que cambie el estado lo dispara sin saber de
   devoluciones. */
export interface AvisoDevolucion { sesionId: ID }
const oyentesDevolucion = new Set<(a: AvisoDevolucion) => void>();
export function alElegirDevolucion(f: (a: AvisoDevolucion) => void): () => void {
  oyentesDevolucion.add(f);
  return () => { oyentesDevolucion.delete(f); };
}

let resincronizar: number | undefined;
function negada(tabla: string, motivo?: string) {
  oyentesNegadas.forEach((f) => f(tabla, motivo));
  resincronizarAlVaciarse();
}

/* Se vuelve a traer todo recién cuando la cola se vació. Si quedan
   escrituras que la base sí acepta (una venta, sus cuotas y sus cobros van
   en varias), traer antes pisaría la memoria con una base que todavía no
   las tiene: la venta desaparecía de la pantalla hasta la próxima carga,
   aunque en la base quedaba bien (lo vio la sesión del CRM). Si la cola
   quedó trabada por un error, no se trae nada: se perdería lo pendiente. */
function resincronizarAlVaciarse() {
  if (typeof window === "undefined") return;
  window.clearTimeout(resincronizar);
  resincronizar = window.setTimeout(() => {
    if (cola.length > 0 || drenando) {
      if (!drenando && sync === "error") return;
      resincronizarAlVaciarse();
      return;
    }
    reiniciarCarga();
    void cargarDeLaNube();
  }, 400);
}

/* Las columnas del control de un cobro (quién lo cargó, quién lo chequeó) no
   viajan en el upsert del cobro entero (sinColumnasDelControl): las pone la
   base, y cada chequeo sale como un UPDATE aparte. */
function empujar(op: Op) {
  if (!nube) return;
  if (acceso && !puedeEditar(acceso, op.tabla)) { negada(op.tabla); return; }
  cola.push(op.tipo === "upsert" && op.tabla === "pagos" ? { ...op, filas: op.filas.map(sinColumnasDelControl) } : op);
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
        /* La base no lo deja por el tipo de cuenta de quien escribe: se
           descarta (no se va a poder nunca) en vez de trabar todo lo que
           viene atrás, y se avisa. */
        if (r.error.code === "42501") {
          cola.shift();
          negada(op.tabla);
          continue;
        }
        /* Un borrado que la base frena porque otra cosa todavía lo usa (un
           tipo de cuenta con gente): tampoco se va a poder, no traba nada. */
        if (r.error.code === "23503" && op.tipo === "delete") {
          cola.shift();
          negada(op.tabla, "No se pudo borrar: todavía lo usa otra cosa. Vuelve a como estaba.");
          continue;
        }
        /* Tabla opcional sin crear: se descarta la operacion en vez de
           bloquear la cola. En memoria el dato ya esta. */
        if (TABLAS_OPCIONALES.has(op.tabla) && tablaFaltante(r.error)) {
          sinCrear.add(op.tabla);
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
      if (TABLAS_OPCIONALES.has(TABLAS[i]) && tablaFaltante(r.error)) { sinCrear.add(TABLAS[i]); continue; }
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

    /* Sembrar o completar catálogos sólo lo hace un dueño: a otro tipo de
       cuenta una tabla vacía puede ser algo que no le toca ver, no una base
       nueva. Sin la función (una base de antes), como siempre. */
    const dueno = await db.rpc("es_dueno");
    const soyDueno = dueno.error ? true : dueno.data === true;

    /* Base nueva: se siembra entera con lo que haya en este navegador. */
    if (porTabla.etapas.length === 0 && soyDueno) {
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
    if (vacias.size > 0 && soyDueno) {
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
      /* Opcional: sin supabase/tipos-cuenta.sql, los de siempre. */
      tiposCuenta: porTabla.tipos_cuenta?.length ? (porTabla.tipos_cuenta as TipoCuenta[]) : TIPOS_POR_DEFECTO,
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
      arqueos: ((porTabla.arqueos ?? []) as EstadoApp["arqueos"])
        .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)),
      /* Opcional: sin supabase/traspasos.sql, ninguno. */
      traspasos: (porTabla.traspasos ?? []) as EstadoApp["traspasos"],
      /* Opcional: sin supabase/devoluciones.sql, ninguna. */
      devoluciones: (porTabla.devoluciones ?? []) as EstadoApp["devoluciones"],
      /* Opcionales: sin supabase/customer-success.sql, ninguno. */
      seguimientos: (porTabla.seguimiento_alumnos ?? []) as SeguimientoAlumno[],
      testimonios: (porTabla.testimonios ?? []) as Testimonio[],
      /* Opcional: sin supabase/gastos-recurrentes.sql, ninguno. */
      gastosRecurrentes: (porTabla.gastos_recurrentes ?? []) as GastoRecurrente[],
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
    ["pagos", e.pagos], ["devoluciones", e.devoluciones ?? []], ["gastos", e.gastos],
    ["comentarios", e.comentarios ?? []],
    ["arqueos", e.arqueos ?? []],
    ["traspasos", e.traspasos ?? []],
    ["gastos_recurrentes", e.gastosRecurrentes ?? []],
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
    "actividad", "comentarios", "arqueos", "traspasos", "gastos_recurrentes", "campos", "metas", "devoluciones", "pagos", "movimientos", "cuotas", "ventas", "gastos",
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

/* Lo que el CRM carga sobre una agenda. `estado` lo mandan deshacer
   (devuelve la llamada a como estaba) y la tabla del CRM, que corrige el
   estado y el closer en la celda. `extra` lo manda pasar una llamada a otro
   closer (lib/pasar-llamadas.ts), que deja anotado ahí que se eligió a mano. */
export type CambiosLlamada = Partial<Pick<Sesion, "preCall" | "estadoPreCall" | "estadoLlamada" | "notas" | "grabacion" | "estado"
  | "resultado" | "objecion" | "hizoOferta" | "cierreEstimado" | "eodEn" | "eodPor" | "anfitrion" | "extra"
  | "estadoLlamadaEn" | "estadoPreCallEn" | "ventaPorOtro">>;
type PedidoLlamada = { id: ID; cambios: CambiosLlamada; detalle: string };
const MARCAS_DE_ESTADO = [["estadoLlamada", "estadoLlamadaEn"], ["estadoPreCall", "estadoPreCallEn"]] as const;
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
  if (actual.etapaId === etapaId || !puedo("leads")) return;
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
    /* El Estado de Llamada dice además cómo quedó la agenda: hecha, que no
       vino o cancelada (lib/estados.ts). Y lo que cargaba el cierre del
       día de antes deja de valer: ahora lo dice el estado. */
    if ("estadoLlamada" in cambios) {
      if (!("estado" in cambios)) {
        const agenda = estadoDeAgenda(s, limpio.estadoLlamada, opciones);
        if (agenda) limpio.estado = agenda;
      }
      if (s.resultado && !("resultado" in cambios)) limpio.resultado = undefined;
    }
    if ("estado" in cambios && !cambios.estado) delete limpio.estado;
    /* La primera vez que se carga cada estado queda marcada, venga de donde
       venga (el cierre del día, la tabla del CRM, la Agenda, la ficha o una
       venta): con eso se cuentan los strikes (lib/cierre-del-dia.ts). Pasar de
       vacío a cargado la pone; después no se corre ni se borra (cambiar el
       estado, vaciarlo o borrar la opción no la tocan: hay historia). Si el
       cambio ya trae la marca (deshacer la primera carga la saca), vale esa. */
    for (const [campo, marca] of MARCAS_DE_ESTADO) {
      if (!(campo in cambios) || marca in cambios) continue;
      if (limpio[campo] && !s[campo] && !s[marca]) limpio[marca] = t.cuando;
    }
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
  /* La que la venta dice (se guarda al cargarla); sólo si no la dice, se infiere. */
  const dicha = sesionId ?? venta.sesionId;
  if (dicha) return e.sesiones.find((s) => s.id === dicha);
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
  return opcionDeCompraPara(opciones, tipo);
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
  tipoCambio?: number; montoArs?: number; pagador?: string; cuit?: string;
  cvu?: string; tipoCambioBlue?: number; tipoCambioFuente?: string;
}

/* Lo que se carga de una devolución (lib/devoluciones.ts). */
export interface DatosDevolucion {
  ventaId?: ID;
  monto: number;
  fecha: string;
  procesadorId?: ID;
  montoArs?: number;
  tipoCambio?: number;
  comprobante?: Comprobante;
  noDescontarAlCloser?: boolean;
  motivo?: string;
  notas?: string;
  /* La llamada de la que salió la venta; si no, la última de la persona. */
  sesionId?: ID;
  /* Qué más pasa: dar de baja la venta (como reembolsada) y dejar la llamada en «Devolución». */
  darDeBaja?: boolean;
  marcarLlamada?: boolean;
  /* Lo que informa la pasarela. */
  referencia?: string;
  proveedor?: ProveedorPasarela;
  /* La propuesta de la pasarela que se confirma con estos datos. */
  confirmaId?: ID;
  por?: string;
  extra?: Record<string, unknown>;
}

/* Los datos de la planilla que trae el cobro, sin los vacíos. El blue de
   referencia va sólo con un tipo de cambio: es contra qué se compara. El
   tilde de «chequeado» ya no lo pone quien carga: lo chequea otra persona
   (lib/control-cobros.ts). */
function extrasDeCobro(c: DatosCobro): Partial<Pago> {
  const conCambio = Boolean(c.tipoCambio && c.tipoCambio > 0);
  return {
    ...(conCambio ? { tipoCambio: c.tipoCambio } : {}),
    ...(conCambio && c.montoArs && c.montoArs > 0 ? { montoArs: c.montoArs } : {}),
    ...(conCambio && c.tipoCambioBlue && c.tipoCambioBlue > 0
      ? { tipoCambioBlue: c.tipoCambioBlue, tipoCambioFuente: c.tipoCambioFuente } : {}),
    ...(c.pagador?.trim() ? { pagador: c.pagador.trim() } : {}),
    ...(c.cuit?.trim() ? { cuit: c.cuit.trim() } : {}),
    ...(c.cvu?.trim() ? { cvu: c.cvu.replace(/[\s.-]/g, "") } : {}),
  };
}

/* ---------- La baja de una venta ----------
   Cancelada o reembolsada, la venta se va: las cuotas que faltaban cobrar
   se cancelan y su servicio pasa a baja. Es un borrado lógico, como pidió
   Yari: las cuotas quedan escritas como canceladas, no se borran, y lo
   cobrado queda como historial. Una cuota con algo pagado no se cancela
   (su plata existe); deja de contar como por cobrar porque la venta ya no
   está activa. Si la venta vuelve a activarse, esas mismas cuotas vuelven
   a estar pendientes y el servicio, al estado que tenía. */

const CUOTAS_DE_LA_BAJA = "cuotasCanceladasConLaBaja";
const ESTADO_ANTES_DE_LA_BAJA = "estadoAntesDeLaBaja";

export const esBaja = (v: Pick<Venta, "estado">) => v.estado === "cancelada" || v.estado === "reembolsada";

/** Las cuotas que cancelaría dar de baja la venta: pendientes y sin nada pagado. */
export function cuotasQueCancelaLaBaja(e: EstadoApp, ventaId: ID): Cuota[] {
  const pagado = new Map<ID, number>();
  for (const p of e.pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
  return e.cuotas.filter((c) => c.ventaId === ventaId && c.estado === "pendiente" && (pagado.get(c.id) ?? 0) < 0.01);
}

function efectoDeBaja(e: EstadoApp, antes: Venta, despues: Venta): { venta: Venta; cuotas: Cuota[]; alumnos: Alumno[] } | null {
  if (esBaja(antes) === esBaja(despues)) {
    /* Editar una venta que sigue de baja no le borra qué cuotas canceló. */
    if (esBaja(despues) && antes.extra?.[CUOTAS_DE_LA_BAJA] && !despues.extra?.[CUOTAS_DE_LA_BAJA]) {
      return { venta: { ...despues, extra: { ...despues.extra, [CUOTAS_DE_LA_BAJA]: antes.extra[CUOTAS_DE_LA_BAJA] } }, cuotas: [], alumnos: [] };
    }
    return null;
  }
  if (esBaja(despues)) {
    const cuotas = cuotasQueCancelaLaBaja(e, despues.id).map((c) => ({ ...c, estado: "cancelada" as const }));
    const alumnos = e.alumnos.filter((a) => a.ventaId === despues.id && a.estado !== "baja")
      .map((a) => ({ ...a, estado: "baja" as const, extra: { ...a.extra, [ESTADO_ANTES_DE_LA_BAJA]: a.estado } }));
    return {
      venta: { ...despues, extra: { ...despues.extra, [CUOTAS_DE_LA_BAJA]: cuotas.map((c) => c.id), bajaEn: ahora() } },
      cuotas, alumnos,
    };
  }
  /* Vuelve: lo que canceló la baja, pendiente otra vez. */
  const ids = new Set((antes.extra?.[CUOTAS_DE_LA_BAJA] as ID[] | undefined) ?? []);
  const cuotas = e.cuotas.filter((c) => ids.has(c.id) && c.estado === "cancelada").map((c) => ({ ...c, estado: "pendiente" as const }));
  const alumnos = e.alumnos.filter((a) => a.ventaId === despues.id && a.estado === "baja" && a.extra?.[ESTADO_ANTES_DE_LA_BAJA])
    .map((a) => {
      const { [ESTADO_ANTES_DE_LA_BAJA]: previo, ...extra } = a.extra;
      return { ...a, estado: previo as Alumno["estado"], extra };
    });
  const { [CUOTAS_DE_LA_BAJA]: _c, bajaEn: _b, ...extra } = { ...antes.extra, ...despues.extra };
  return { venta: { ...despues, extra }, cuotas, alumnos };
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
    /* El closer no cancela, devuelve ni reactiva una venta (Yari, 02/10): la base
       lo traba igual (supabase/devoluciones.sql); acá ni se intenta. */
    if (coleccion === "ventas" && acceso && !puedeDarDeBaja(acceso)) {
      const antesV = e.ventas.find((v) => v.id === id);
      const nuevo = (cambios as Partial<Venta>).estado;
      if (antesV && nuevo !== undefined && nuevo !== antesV.estado && (esBaja({ estado: nuevo }) || esBaja(antesV))) {
        negada("ventas", "Tu tipo de cuenta no puede cancelar, devolver ni reactivar una venta: lo hace Finanzas o el director comercial.");
        return;
      }
    }
    let lista = (e[coleccion] as unknown as T[]).map((x) => (x.id === id ? { ...x, ...cambios } : x));
    const { lista: act, nuevo } = registrar(e, ENTIDAD_DE[coleccion] ?? "config", id, etiqueta, "actualizo", detalle ?? `Se editó «${etiqueta}».`);
    /* Una venta que se da de baja (o vuelve) arrastra sus cuotas y su servicio. */
    const antes = coleccion === "ventas" ? e.ventas.find((v) => v.id === id) : undefined;
    const baja = antes ? efectoDeBaja(e, antes, (lista as unknown as Venta[]).find((v) => v.id === id) ?? antes) : null;
    if (baja) lista = (lista as unknown as Venta[]).map((v) => (v.id === id ? baja.venta : v)) as unknown as T[];
    const cuotasPorId = new Map((baja?.cuotas ?? []).map((c) => [c.id, c] as const));
    const alumnosPorId = new Map((baja?.alumnos ?? []).map((a) => [a.id, a] as const));
    guardar({
      ...e, [coleccion]: lista, actividad: act,
      ...(baja ? {
        cuotas: e.cuotas.map((c) => cuotasPorId.get(c.id) ?? c),
        alumnos: e.alumnos.map((a) => alumnosPorId.get(a.id) ?? a),
      } : {}),
    } as EstadoApp);
    const fila = lista.find((x) => x.id === id);
    if (fila) empujar({ tipo: "upsert", tabla: coleccion, filas: [fila] });
    if (baja?.cuotas.length) empujarEnLotes("cuotas", baja.cuotas);
    if (baja?.alumnos.length) empujar({ tipo: "upsert", tabla: "alumnos", filas: baja.alumnos });
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
    /* Una llamada que pasó a «Devolución» (no al deshacer): hay una devolución que cargar. */
    if (!restaurarEtapas && oyentesDevolucion.size > 0) {
      const opciones = opcionesDe(e.ajustes, "estadoLlamada");
      const porId = new Map(e.sesiones.map((x) => [x.id, x] as const));
      for (const [id, despues] of t.sesiones) {
        const op = despues.estadoLlamada ? opciones.find((o) => o.nombre === despues.estadoLlamada) : undefined;
        if (op?.oportunidad === "devolucion" && porId.get(id)?.estadoLlamada !== despues.estadoLlamada) {
          oyentesDevolucion.forEach((f) => f({ sesionId: id }));
        }
      }
    }
    return {
      etapas: t.etapas,
      movidos: [...t.leads.values()].map((l) => ({ leadId: l.id, etapa: e.etapas.find((x) => x.id === l.etapaId)?.nombre ?? "" })),
    };
  },

  /* Pasar cuotas a otro closer: desde ahora sus cobros comisionan para él
     (lib/finanzas.ts: closerDeCuota). La venta sigue a nombre de quien la
     cerró. `null` las devuelve al closer de la venta. Una sola escritura a
     la base y un registro en la actividad. */
  reasignarCuotas(ids: ID[], closerId: ID | null, detalle: string) {
    if (ids.length === 0) return;
    const e = snapshot();
    const cuales = new Set(ids);
    const cuotas = e.cuotas.map((c) => (cuales.has(c.id) ? { ...c, closerId: closerId ?? undefined } : c));
    const { lista: act, nuevo } = registrar(e, "config", closerId ?? ids[0], "Cuotas de closer", "actualizo", detalle);
    guardar({ ...e, cuotas, actividad: act });
    empujarUpdate("cuotas", ids, { closerId });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Los tipos de cuenta (Equipo → Tipos de cuenta). Los escriben sólo los
     dueños (la base rechaza a cualquier otro) y el de Dueño no se toca. */
  guardarTipoCuenta(t: TipoCuenta, detalle: string) {
    if (t.id === "dueno") return;
    const e = snapshot();
    const fila: TipoCuenta = { ...t, actualizadoEn: ahora() };
    const existe = e.tiposCuenta.some((x) => x.id === t.id);
    const tiposCuenta = existe ? e.tiposCuenta.map((x) => (x.id === t.id ? fila : x)) : [...e.tiposCuenta, fila];
    const { lista, nuevo } = registrar(e, "config", t.id, "Tipos de cuenta", existe ? "actualizo" : "creo", detalle);
    guardar({ ...e, tiposCuenta, actividad: lista });
    empujar({ tipo: "upsert", tabla: "tipos_cuenta", filas: [fila] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  borrarTipoCuenta(id: ID, detalle: string) {
    if (id === "dueno" || id === "equipo") return;
    const e = snapshot();
    const { lista, nuevo } = registrar(e, "config", id, "Tipos de cuenta", "elimino", detalle);
    guardar({ ...e, tiposCuenta: e.tiposCuenta.filter((x) => x.id !== id), actividad: lista });
    empujar({ tipo: "delete", tabla: "tipos_cuenta", ids: [id] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
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
    /* Sólo en lo que la cuenta edita: el resto queda como está. */
    const si = <T,>(tabla: string, cambiadas: T[]) => (puedo(tabla) ? cambiadas : []);
    const contactos = si("contactos", p.contacto ? tocar([p.contacto], { nombre, email, telefono }) : []);
    const leads = si("leads", tocar(p.leads, { nombre, email, telefono }));
    const sesiones = si("sesiones", tocar(p.sesiones, { invitado: nombre, email }));
    const ventas = si("ventas", tocar(p.ventas, { contactoNombre: nombre }));
    const alumnos = si("alumnos", tocar(p.alumnos, { nombre, email }));
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

  /* ---------- Lo que se sabe de la persona, corregido a mano ----------
     El país y lo que contestó al agendar (edad, tecnologías, inglés,
     experiencia, formación, cuánto gana y cuánto puede invertir) se
     corrigen en la celda del CRM o en la ficha. Queda en la persona —su
     contacto o, si no tiene, su lead— y vale para todas sus llamadas
     (lib/perfil.ts). Vacío saca la corrección: vuelve a lo que contestó. */
  corregirPerfil(idPersona: ID, campo: CampoPerfil | "pais", valor: string, detalle?: string): boolean {
    const e = snapshot();
    const p = personaDe(e, idPersona);
    if (!p) return false;
    const limpio = valor.trim();
    const contacto = p.contacto;
    const lead = contacto ? undefined : p.leads[0];
    if (!contacto && !lead) return false;
    const que = campo === "pais" ? "País" : tituloPerfil(campo);
    const { lista, nuevo } = registrar(e, "contacto", p.clave, p.nombre, "actualizo",
      detalle ?? (limpio ? `${p.nombre}: ${que} → ${limpio}.` : `${p.nombre}: se vació ${que}.`));

    if (campo === "pais") {
      /* El país es una columna de la persona y de sus oportunidades. */
      const leads = p.leads.filter((l) => (l.pais ?? "") !== limpio);
      const cuando = ahora();
      guardar({
        ...e,
        contactos: contacto ? e.contactos.map((c) => (c.id === contacto.id ? { ...c, pais: limpio || undefined } : c)) : e.contactos,
        leads: leads.length ? e.leads.map((l) => (leads.some((x) => x.id === l.id) ? { ...l, pais: limpio || undefined, actualizadoEn: cuando } : l)) : e.leads,
        actividad: lista,
      });
      if (contacto) empujarUpdate("contactos", [contacto.id], { pais: limpio || null });
      if (leads.length && puedo("leads")) empujarUpdate("leads", leads.map((l) => l.id), { pais: limpio || null, actualizadoEn: cuando });
    } else if (contacto) {
      const extra = extraConCorreccion(contacto.extra, campo, limpio);
      guardar({ ...e, contactos: e.contactos.map((c) => (c.id === contacto.id ? { ...c, extra } : c)), actividad: lista });
      empujarUpdate("contactos", [contacto.id], { extra });
    } else if (lead) {
      const extra = extraConCorreccion(lead.extra, campo, limpio);
      const cuando = ahora();
      guardar({ ...e, leads: e.leads.map((l) => (l.id === lead.id ? { ...l, extra, actualizadoEn: cuando } : l)), actividad: lista });
      empujarUpdate("leads", [lead.id], { extra, actualizadoEn: cuando });
    }
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
  },

  /* ---------- Lo que la agenda hereda del formulario (lib/cruce-formularios.ts) ----------
     Al unir un registro de la landing con una persona de la agenda, el contacto
     toma lo que le faltaba (teléfono, país, anuncio) y los UTMs de la pauta.
     `cambios` ya viene decidido por herenciaDeFormulario: acá sólo se guarda. */
  heredarDeFormulario(contactoId: ID, cambios: Partial<Contacto>, detalle: string): boolean {
    const e = snapshot();
    const c = e.contactos.find((x) => x.id === contactoId);
    if (!c || !puedo("contactos") || Object.keys(cambios).length === 0) return false;
    const { lista, nuevo } = registrar(e, "contacto", c.id, c.nombre, "actualizo", detalle);
    guardar({ ...e, contactos: e.contactos.map((x) => (x.id === c.id ? { ...x, ...cambios } : x)), actividad: lista });
    empujar({ tipo: "update", tabla: "contactos", ids: [c.id], cambios: cambios as Record<string, unknown> });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
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

  /* ---------- Arqueo de caja (lib/caja.ts) ---------- */

  guardarArqueo(arqueo: Arqueo): void {
    const e = snapshot();
    const lista = [...(e.arqueos ?? []).filter((a) => a.id !== arqueo.id), arqueo]
      .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha));
    const dif = arqueo.diferencia;
    const { lista: act, nuevo } = registrar(
      e, "transaccion", arqueo.id, "Arqueo de caja", "creo",
      `Arqueo del ${arqueo.fecha.slice(0, 10)}: en las cuentas hay ${Math.round(arqueo.total).toLocaleString("es-AR")}`
      + (dif === null || dif === undefined ? "." : Math.abs(dif) < 1 ? ", justo lo que esperaba la app."
        : `, ${Math.round(Math.abs(dif)).toLocaleString("es-AR")} ${dif > 0 ? "más" : "menos"} de lo que esperaba la app.`),
    );
    guardar({ ...e, arqueos: lista, actividad: act });
    empujar({ tipo: "upsert", tabla: "arqueos", filas: [arqueo] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  borrarArqueo(id: ID): void {
    const e = snapshot();
    guardar({ ...e, arqueos: (e.arqueos ?? []).filter((a) => a.id !== id) });
    empujar({ tipo: "delete", tabla: "arqueos", ids: [id] });
  },

  /* ---------- Customer Success (lib/seguimiento.ts) ----------
     El seguimiento de cada alumno y sus testimonios. Quedan anotados en la
     actividad del alumno: quién lo contactó y cuándo. */

  /* Cambia el seguimiento de un alumno (lo crea si todavía no tenía) y anota qué
     pasó. Devuelve cómo estaba, para ofrecer «Deshacer» (restaurarSeguimiento). */
  guardarSeguimiento(
    alumnoId: ID, cambio: (s: SeguimientoAlumno, quien: string) => SeguimientoAlumno,
    detalle: (despues: SeguimientoAlumno) => string,
  ): SeguimientoAlumno | null {
    const e = snapshot();
    const alumno = e.alumnos.find((a) => a.id === alumnoId);
    if (!alumno) return null;
    const antes = (e.seguimientos ?? []).find((s) => s.alumnoId === alumnoId)
      ?? seguimientoVacio(alumnoId, configSeguimiento(e.ajustes.seguimiento));
    const quien = e.equipo.find((m) => m.id === acceso?.miembroId)?.nombre ?? e.ajustes.responsable ?? "";
    const despues = cambio(antes, quien);
    const { lista, nuevo } = registrar(e, "alumno", alumnoId, alumno.nombre, "actualizo", detalle(despues));
    guardar({ ...e, seguimientos: [...(e.seguimientos ?? []).filter((s) => s.alumnoId !== alumnoId), despues], actividad: lista });
    empujar({ tipo: "upsert", tabla: "seguimiento_alumnos", filas: [despues] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return antes;
  },

  /* Vuelve el seguimiento de un alumno a como estaba (el «Deshacer» del aviso). */
  restaurarSeguimiento(fila: SeguimientoAlumno, detalle: string): void {
    const e = snapshot();
    const alumno = e.alumnos.find((a) => a.id === fila.alumnoId);
    if (!alumno) return;
    const { lista, nuevo } = registrar(e, "alumno", alumno.id, alumno.nombre, "actualizo", detalle);
    guardar({ ...e, seguimientos: [...(e.seguimientos ?? []).filter((s) => s.alumnoId !== fila.alumnoId), fila], actividad: lista });
    empujar({ tipo: "upsert", tabla: "seguimiento_alumnos", filas: [fila] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Guarda un testimonio (nuevo o corregido) de un alumno. */
  guardarTestimonio(t: Testimonio): void {
    const e = snapshot();
    const alumno = e.alumnos.find((a) => a.id === t.alumnoId);
    const existe = (e.testimonios ?? []).some((x) => x.id === t.id);
    const texto = { pedido: "se pidió", grabado: "se grabó", publicado: "se publicó" }[t.estado];
    const { lista, nuevo } = registrar(e, "alumno", t.alumnoId, alumno?.nombre ?? "Alumno", existe ? "actualizo" : "creo",
      `Testimonio: ${texto}${t.link ? ` (${t.link})` : ""}.`);
    guardar({ ...e, testimonios: [t, ...(e.testimonios ?? []).filter((x) => x.id !== t.id)], actividad: lista });
    empujar({ tipo: "upsert", tabla: "testimonios", filas: [t] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  borrarTestimonio(id: ID): void {
    const e = snapshot();
    const t = (e.testimonios ?? []).find((x) => x.id === id);
    if (!t) return;
    const alumno = e.alumnos.find((a) => a.id === t.alumnoId);
    const { lista, nuevo } = registrar(e, "alumno", t.alumnoId, alumno?.nombre ?? "Alumno", "elimino", "Se borró un testimonio.");
    guardar({ ...e, testimonios: (e.testimonios ?? []).filter((x) => x.id !== id), actividad: lista });
    empujar({ tipo: "delete", tabla: "testimonios", ids: [id] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Las cadencias y los reintentos del seguimiento (Ajustes.seguimiento). */
  configurarSeguimiento(cfg: ConfigSeguimiento): void {
    const e = snapshot();
    const ajustes = { ...e.ajustes, seguimiento: configSeguimiento(cfg) };
    const { lista, nuevo } = registrar(e, "config", "seguimiento", "Seguimiento de alumnos", "actualizo", "Se cambió la configuración del seguimiento de alumnos.");
    guardar({ ...e, ajustes, actividad: lista });
    empujar({ tipo: "upsert", tabla: "ajustes", filas: [filaAjustes(ajustes)] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* ---------- Movimientos entre cuentas (lib/traspasos.ts) ----------
     Plata que pasa de una cuenta propia a otra: no es ingreso ni gasto. */

  /* Guarda uno (nuevo o corregido) y, junto, el gasto con lo que costó:
     `gasto` es el que le toca ahora (null si no costó nada o no se quiere
     cargar); el que tenía antes se borra. */
  guardarTraspaso(t: Traspaso, gasto: Gasto | null = null): void {
    const e = snapshot();
    const antes = (e.traspasos ?? []).find((x) => x.id === t.id);
    const con: Traspaso = { ...t, gastoId: gasto?.id };
    const viejo = antes?.gastoId && antes.gastoId !== gasto?.id ? antes.gastoId : undefined;
    const gastos = [...e.gastos.filter((g) => g.id !== viejo && g.id !== gasto?.id), ...(gasto ? [gasto] : [])];
    const { lista: act, nuevo } = registrar(
      e, "transaccion", t.id, "Movimiento entre cuentas", antes ? "actualizo" : "creo",
      `${antes ? "Se corrigió" : "Se cargó"} un movimiento entre cuentas: ${rutaDe(e, t)}, ${Math.round(t.montoSale).toLocaleString("es-AR")} ${t.monedaSale}`
      + (gasto ? `; costó ${Math.round(gasto.monto).toLocaleString("es-AR")}, que quedó como gasto.` : "."),
    );
    guardar({ ...e, traspasos: [...(e.traspasos ?? []).filter((x) => x.id !== t.id), con], gastos, actividad: act });
    empujar({ tipo: "upsert", tabla: "traspasos", filas: [con] });
    /* Lo que se vació al corregir (la nota, el gasto) viaja aparte: una
       clave que falta no pisa lo que hay en la base. */
    const vaciado = antes
      ? Object.keys(antes).filter((k) => (antes as unknown as Record<string, unknown>)[k] !== undefined && (con as unknown as Record<string, unknown>)[k] === undefined)
      : [];
    if (vaciado.length) empujarUpdate("traspasos", [t.id], Object.fromEntries(vaciado.map((k) => [k, null])));
    if (gasto) empujar({ tipo: "upsert", tabla: "gastos", filas: [gasto] });
    if (viejo) empujar({ tipo: "delete", tabla: "gastos", ids: [viejo] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Confirmar el que propuso la sincronización, o decir que no es un pase
     (ahí se va también el gasto de su costo, si tenía). */
  marcarTraspaso(id: ID, estado: EstadoTraspaso): void {
    const e = snapshot();
    const t = (e.traspasos ?? []).find((x) => x.id === id);
    if (!t || t.estado === estado) return;
    const sinGasto = estado === "ignorado" ? t.gastoId : undefined;
    const { lista: act, nuevo } = registrar(
      e, "transaccion", id, "Movimiento entre cuentas", "actualizo",
      estado === "ignorado" ? `Se marcó que no es un movimiento entre cuentas: ${rutaDe(e, t)}.`
        : `Se confirmó el movimiento entre cuentas: ${rutaDe(e, t)}.`,
    );
    guardar({
      ...e,
      traspasos: (e.traspasos ?? []).map((x) => (x.id === id ? { ...x, estado, ...(sinGasto ? { gastoId: undefined } : {}) } : x)),
      gastos: sinGasto ? e.gastos.filter((g) => g.id !== sinGasto) : e.gastos,
      actividad: act,
    });
    empujarUpdate("traspasos", [id], { estado, ...(sinGasto ? { gastoId: null } : {}) });
    if (sinGasto) empujar({ tipo: "delete", tabla: "gastos", ids: [sinGasto] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  borrarTraspaso(id: ID): void {
    const e = snapshot();
    const t = (e.traspasos ?? []).find((x) => x.id === id);
    if (!t) return;
    guardar({
      ...e,
      traspasos: (e.traspasos ?? []).filter((x) => x.id !== id),
      gastos: t.gastoId ? e.gastos.filter((g) => g.id !== t.gastoId) : e.gastos,
    });
    empujar({ tipo: "delete", tabla: "traspasos", ids: [id] });
    if (t.gastoId) empujar({ tipo: "delete", tabla: "gastos", ids: [t.gastoId] });
  },

  /* Lo que vio la sincronización de las cuentas (un depósito de Stripe en
     Mercury, un retiro de Stripe): la punta que ya está no se repite, la
     que es de un pase cargado se le ata y el resto son pases nuevos. Las
     mismas reglas que usa el cron del servidor. */
  importarPuntas(puntas: Punta[]): { nuevos: number; conciliados: number } {
    const e = snapshot();
    const r = conciliarPuntas(e.traspasos ?? [], puntas, ahora());
    if (r.nuevos.length === 0 && r.cambios.length === 0) return { nuevos: 0, conciliados: 0 };
    const cambios = new Map(r.cambios.map((c) => [c.id, c.cambios] as const));
    guardar({
      ...e,
      traspasos: [...(e.traspasos ?? []).map((t) => (cambios.has(t.id) ? { ...t, ...cambios.get(t.id) } : t)), ...r.nuevos],
    });
    if (r.nuevos.length) empujarEnLotes("traspasos", r.nuevos);
    for (const c of r.cambios) empujarUpdate("traspasos", [c.id], c.cambios as Record<string, unknown>);
    return { nuevos: r.nuevos.length, conciliados: r.conciliados };
  },

  /* Vuelve a traer los movimientos entre cuentas de la base: el servidor
     acaba de guardar lo que encontró en las cuentas (o lo hizo el cron) y
     así se ve sin recargar. Antes espera a que no quede nada de ellos por
     escribir, para no pisar con la base lo que todavía no le llegó. */
  async traerTraspasos(): Promise<boolean> {
    if (!nube) return false;
    const pendiente = () => cola.some((op) => op.tabla === "traspasos");
    for (let i = 0; i < 40 && pendiente(); i++) await new Promise((r) => setTimeout(r, 150));
    if (pendiente()) return false;
    const r = await traerTabla(nube, "traspasos");
    if (r.error || pendiente()) return false;
    guardar({ ...snapshot(), traspasos: (r.data ?? []) as Traspaso[] });
    return true;
  },


  /* ---------- Gastos fijos (lib/gastos-recurrentes.ts) ----------
     La plantilla de lo que se paga todos los meses. Nada se carga sin
     aprobar: aprobar es lo único que crea el gasto. */

  guardarGastoRecurrente(t: GastoRecurrente): void {
    const e = snapshot();
    const antes = (e.gastosRecurrentes ?? []).find((x) => x.id === t.id);
    const { lista: act, nuevo } = registrar(
      e, "transaccion", t.id, "Gasto fijo", antes ? "actualizo" : "creo",
      `${antes ? "Se corrigió" : "Se creó"} el gasto fijo «${t.concepto}» (${Math.round(t.monto).toLocaleString("es-AR")} ${t.moneda}, el día ${t.diaDelMes}).`,
    );
    guardar({ ...e, gastosRecurrentes: [...(e.gastosRecurrentes ?? []).filter((x) => x.id !== t.id), t], actividad: act });
    empujar({ tipo: "upsert", tabla: "gastos_recurrentes", filas: [t] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  borrarGastoRecurrente(id: ID): void {
    const e = snapshot();
    const t = (e.gastosRecurrentes ?? []).find((x) => x.id === id);
    if (!t) return;
    const { lista: act, nuevo } = registrar(e, "transaccion", id, "Gasto fijo", "elimino", `Se borró el gasto fijo «${t.concepto}». Los gastos que ya se cargaron quedan.`);
    guardar({ ...e, gastosRecurrentes: (e.gastosRecurrentes ?? []).filter((x) => x.id !== id), actividad: act });
    empujar({ tipo: "delete", tabla: "gastos_recurrentes", ids: [id] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Aprobar lo propuesto de uno o de varios (con el monto que se dijo): carga
     los gastos y deja el monto aprobado como el habitual para el mes que
     viene. Los que ya estaban cargados ese mes no se repiten. */
  aprobarGastosFijos(items: { id: ID; mes: string; monto: number }[]): Gasto[] {
    const e = snapshot();
    const ahoraIso = ahora();
    const nuevos: Gasto[] = [];
    const plantillas = new Map((e.gastosRecurrentes ?? []).map((t) => [t.id, t] as const));
    const cambiadas = new Map<ID, GastoRecurrente>();
    const yaHay = new Set(e.gastos.map((g) => g.id));
    for (const it of items) {
      const t = plantillas.get(it.id);
      if (!t || !(it.monto > 0)) continue;
      const g = gastoAprobado(t, it.mes, it.monto, ahoraIso, e.ajustes.responsable || undefined);
      if (yaHay.has(g.id)) continue;
      yaHay.add(g.id);
      nuevos.push(g);
      /* El monto del último mes aprobado pasa a ser el habitual. */
      const nueva = { ...(cambiadas.get(t.id) ?? t), monto: g.monto };
      cambiadas.set(t.id, nueva);
    }
    if (nuevos.length === 0) return [];
    const { lista: act, nuevo } = registrar(
      e, "transaccion", nuevos[0].id, "Gastos fijos", "creo",
      nuevos.length === 1 ? `Se aprobó el gasto fijo «${nuevos[0].concepto}» (${Math.round(nuevos[0].monto).toLocaleString("es-AR")} ${nuevos[0].moneda}).`
        : `Se aprobaron ${nuevos.length} gastos fijos: ${nuevos.map((g) => g.concepto).join(", ")}.`,
    );
    guardar({
      ...e,
      gastos: [...nuevos, ...e.gastos],
      gastosRecurrentes: (e.gastosRecurrentes ?? []).map((t) => cambiadas.get(t.id) ?? t),
      actividad: act,
    });
    empujarEnLotes("gastos", nuevos);
    for (const t of cambiadas.values()) empujar({ tipo: "upsert", tabla: "gastos_recurrentes", filas: [t] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return nuevos;
  },

  /* «Este mes no»: el mes queda saltado y no vuelve a proponerse. */
  saltearGastoFijo(id: ID, mes: string): void {
    const e = snapshot();
    const t = (e.gastosRecurrentes ?? []).find((x) => x.id === id);
    if (!t || t.salteados.includes(mes)) return;
    const nueva: GastoRecurrente = { ...t, salteados: [...t.salteados, mes].sort() };
    const { lista: act, nuevo } = registrar(e, "transaccion", id, "Gasto fijo", "actualizo", `Se salteó «${t.concepto}» en ${mes}.`);
    guardar({ ...e, gastosRecurrentes: (e.gastosRecurrentes ?? []).map((x) => (x.id === id ? nueva : x)), actividad: act });
    empujar({ tipo: "upsert", tabla: "gastos_recurrentes", filas: [nueva] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
  },

  /* Deshace un «saltear» (el mes vuelve a aparecer para aprobar). */
  volverAProponerGastoFijo(id: ID, mes: string): void {
    const e = snapshot();
    const t = (e.gastosRecurrentes ?? []).find((x) => x.id === id);
    if (!t || !t.salteados.includes(mes)) return;
    const nueva: GastoRecurrente = { ...t, salteados: t.salteados.filter((m) => m !== mes) };
    guardar({ ...e, gastosRecurrentes: (e.gastosRecurrentes ?? []).map((x) => (x.id === id ? nueva : x)) });
    empujar({ tipo: "upsert", tabla: "gastos_recurrentes", filas: [nueva] });
  },

  /* Arma las plantillas con los gastos «Fijo» que ya se cargaron (uno por
     concepto, con el monto y el día del último). Devuelve cuántas armó. */
  armarGastosFijos(): number {
    const e = snapshot();
    const hechas = plantillasDesdeGastos(e, ahora(), () => nuevoId("rec"));
    if (hechas.length === 0) return 0;
    const { lista: act, nuevo } = registrar(e, "transaccion", hechas[0].id, "Gastos fijos", "creo", `Se armaron ${hechas.length} gastos fijos con los gastos «Fijo» ya cargados.`);
    guardar({ ...e, gastosRecurrentes: [...(e.gastosRecurrentes ?? []), ...hechas], actividad: act });
    empujarEnLotes("gastos_recurrentes", hechas);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return hechas.length;
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
    /* La llamada de la que salió la venta: la del CRM desde la que se cargó
       o, si no, la última de la persona. Queda guardada en la venta
       (`sesionId`): la puerta del cierre del día, los strikes y el descuento
       la necesitan, y inferirla cada vez daba falsos «sin venta». */
    const llamada = llamadaDeVenta(e, datos.venta, datos.sesionId);
    const venta: Venta = llamada && !datos.venta.sesionId ? { ...datos.venta, sesionId: llamada.id } : datos.venta;

    let nuevosPagos: Pago[] = [];

    for (const cobro of datos.cobros) {
      if (cobro.monto <= 0.001) continue;
      const mov = cobro.movimientoId ? e.movimientos.find((m) => m.id === cobro.movimientoId) : undefined;

      if (mov) {
        /* El fee lo dice la pasarela, no la tabla de procesadores. */
        nuevosPagos.push({
          ...pagoDesdeMovimiento(mov, cobro.cuotaId, cobro.monto, tasaEstimada(e, mov)), id: nuevoId("pag"),
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
    nuevosPagos = cargadosAhora(e, conDatosDePlanilla(nuevosPagos, datos.cuotas, [], true));

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
    if (llamada && !llamada.estadoLlamada && puedo("sesiones")) {
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
          ...pagoDesdeMovimiento(mov, cuota.id, cobro.monto, tasaEstimada(e, mov)), id: nuevoId("pag"),
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
      nuevosPagos = cargadosAhora(e, conDatosDePlanilla(nuevosPagos, cuotasVenta, e.pagos.filter((p) => idsCuotas.has(p.cuotaId)), false));
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

  /* ---------- Devoluciones (lib/devoluciones.ts) ----------
     Una devolución es una transacción aparte: no cambia la venta ni sus cobros.
     Resta en el mes en que se devuelve la plata y revierte lo comisionado.
     Además, si se pide: la venta se da de baja (como reembolsada: sus cuotas
     sin pagos se cancelan y su servicio pasa a baja) y la llamada de la que
     salió queda en «Devolución» (su oportunidad pasa a Perdido). La carga
     Finanzas o el director comercial; el closer sólo la ve. */

  registrarDevolucion(datos: DatosDevolucion): ID | null {
    const e = snapshot();
    const venta = datos.ventaId ? e.ventas.find((v) => v.id === datos.ventaId) : undefined;
    if (!venta) return null;
    if (acceso && !puedeCargarDevolucion(acceso)) {
      negada("devoluciones", "Tu tipo de cuenta no carga devoluciones: las cargan Finanzas o el director comercial.");
      return null;
    }
    const monto = Math.round(datos.monto * 100) / 100;
    if (!(monto > 0)) return null;
    const cuando = ahora();
    const previa = datos.confirmaId ? (e.devoluciones ?? []).find((x) => x.id === datos.confirmaId) : undefined;
    const id = previa?.id ?? nuevoId("dev");

    /* La venta se da de baja si se pidió y sigue activa. */
    const baja = datos.darDeBaja && venta.estado === "activa" ? efectoDeBaja(e, venta, { ...venta, estado: "reembolsada" }) : null;

    /* La llamada de la que salió la venta queda en «Devolución»: el CRM se entera. */
    const t = nuevaTanda();
    let llamada: Sesion | undefined;
    if (datos.marcarLlamada) {
      llamada = llamadaDeVenta(e, venta, datos.sesionId);
      const op = opcionesDe(e.ajustes, "estadoLlamada").find((o) => o.oportunidad === "devolucion");
      if (llamada && op && llamada.estadoLlamada !== op.nombre && puedo("sesiones")) {
        cargarLlamadas(t, e, [{
          id: llamada.id, cambios: { estadoLlamada: op.nombre },
          detalle: `${llamada.invitado}: Estado de Llamada → ${op.nombre} (por la devolución).`,
        }]);
      }
    }

    const d: Devolucion = {
      ...(previa ?? {}),
      id, ventaId: venta.id, monto, moneda: venta.moneda, fecha: datos.fecha,
      procesadorId: datos.procesadorId, montoArs: datos.montoArs, tipoCambio: datos.tipoCambio,
      comprobante: datos.comprobante, noDescontarAlCloser: Boolean(datos.noDescontarAlCloser), estado: "confirmada",
      motivo: datos.motivo?.trim() || undefined, notas: datos.notas?.trim() || undefined,
      sesionId: llamada?.id ?? datos.sesionId ?? previa?.sesionId,
      referencia: datos.referencia ?? previa?.referencia, proveedor: datos.proveedor ?? previa?.proveedor,
      conciliadaEn: (datos.referencia ?? previa?.referencia) ? previa?.conciliadaEn ?? cuando : undefined,
      cargadaPor: datos.por || e.ajustes.responsable || "Apicanta", creadoEn: previa?.creadoEn ?? cuando,
      extra: { ...(previa?.extra ?? {}), ...(datos.extra ?? {}) },
    };

    const nombre = venta.contactoNombre;
    const cuanto = `${Math.round(monto).toLocaleString("es-AR")} ${venta.moneda}`;
    const { lista, nuevo } = registrar(
      e, "transaccion", venta.id, nombre, previa ? "actualizo" : "creo",
      `Se ${previa ? "confirmó" : "cargó"} una devolución de ${cuanto} de la venta de ${nombre} (el ${d.fecha.slice(0, 10)})`
      + `${d.noDescontarAlCloser ? ", sin descontarle la comisión al closer" : ""}`
      + `${baja ? "; la venta quedó reembolsada" : ""}.`,
    );
    const cuotasPorId = new Map((baja?.cuotas ?? []).map((c) => [c.id, c] as const));
    const alumnosPorId = new Map((baja?.alumnos ?? []).map((a) => [a.id, a] as const));
    guardar(conTanda({
      ...e,
      devoluciones: previa ? (e.devoluciones ?? []).map((x) => (x.id === id ? d : x)) : [d, ...(e.devoluciones ?? [])],
      actividad: lista,
      ...(baja ? {
        ventas: e.ventas.map((v) => (v.id === venta.id ? baja.venta : v)),
        cuotas: e.cuotas.map((c) => cuotasPorId.get(c.id) ?? c),
        alumnos: e.alumnos.map((a) => alumnosPorId.get(a.id) ?? a),
      } : {}),
    }, t));
    empujar({ tipo: "upsert", tabla: "devoluciones", filas: [d] });
    if (baja) {
      empujar({ tipo: "upsert", tabla: "ventas", filas: [baja.venta] });
      if (baja.cuotas.length) empujarEnLotes("cuotas", baja.cuotas);
      if (baja.alumnos.length) empujar({ tipo: "upsert", tabla: "alumnos", filas: baja.alumnos });
    }
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    empujarTanda(t);
    return id;
  },

  /* Corregir una devolución ya cargada (el monto, el día, el medio, el
     comprobante, la marca). Lo que se vacía viaja como null. */
  editarDevolucion(id: ID, cambios: Partial<Omit<Devolucion, "id">>): boolean {
    const e = snapshot();
    const antes = (e.devoluciones ?? []).find((x) => x.id === id);
    if (!antes) return false;
    if (acceso && !puedeCargarDevolucion(acceso)) {
      negada("devoluciones", "Tu tipo de cuenta no corrige devoluciones: las corrigen Finanzas o el director comercial.");
      return false;
    }
    const nueva: Devolucion = { ...antes, ...cambios, id };
    if (nueva.monto !== antes.monto) nueva.monto = Math.round(nueva.monto * 100) / 100;
    const venta = nueva.ventaId ? e.ventas.find((v) => v.id === nueva.ventaId) : undefined;
    const { lista, nuevo } = registrar(
      e, "transaccion", venta?.id ?? id, venta?.contactoNombre ?? "Devolución", "actualizo",
      `Se corrigió la devolución de ${Math.round(nueva.monto).toLocaleString("es-AR")} ${nueva.moneda}${venta ? ` de la venta de ${venta.contactoNombre}` : ""}.`,
    );
    guardar({ ...e, devoluciones: (e.devoluciones ?? []).map((x) => (x.id === id ? nueva : x)), actividad: lista });
    empujar({ tipo: "upsert", tabla: "devoluciones", filas: [nueva] });
    const vaciado = Object.keys(antes).filter((k) => (antes as unknown as Record<string, unknown>)[k] !== undefined && (nueva as unknown as Record<string, unknown>)[k] === undefined);
    if (vaciado.length) empujarUpdate("devoluciones", [id], Object.fromEntries(vaciado.map((k) => [k, null])));
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
  },

  /* «No es una devolución»: la que informó una pasarela y nadie reconoce. */
  ignorarDevolucion(id: ID): boolean {
    const e = snapshot();
    const antes = (e.devoluciones ?? []).find((x) => x.id === id);
    if (!antes || antes.estado === "ignorada") return false;
    if (acceso && !puedeCargarDevolucion(acceso)) {
      negada("devoluciones", "Tu tipo de cuenta no puede decidir sobre las devoluciones.");
      return false;
    }
    const nueva: Devolucion = { ...antes, estado: "ignorada" };
    guardar({ ...e, devoluciones: (e.devoluciones ?? []).map((x) => (x.id === id ? nueva : x)) });
    empujarUpdate("devoluciones", [id], { estado: "ignorada" });
    return true;
  },

  borrarDevolucion(id: ID): boolean {
    const e = snapshot();
    const antes = (e.devoluciones ?? []).find((x) => x.id === id);
    if (!antes) return false;
    if (acceso && !puedeCargarDevolucion(acceso)) {
      negada("devoluciones", "Tu tipo de cuenta no borra devoluciones: las borran Finanzas o el director comercial.");
      return false;
    }
    const venta = antes.ventaId ? e.ventas.find((v) => v.id === antes.ventaId) : undefined;
    const { lista, nuevo } = registrar(
      e, "transaccion", venta?.id ?? id, venta?.contactoNombre ?? "Devolución", "elimino",
      `Se borró la devolución de ${Math.round(antes.monto).toLocaleString("es-AR")} ${antes.moneda}${venta ? ` de la venta de ${venta.contactoNombre}` : ""}: vuelve a contar lo cobrado y lo comisionado.`,
    );
    guardar({ ...e, devoluciones: (e.devoluciones ?? []).filter((x) => x.id !== id), actividad: lista });
    empujar({ tipo: "delete", tabla: "devoluciones", ids: [id] });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return true;
  },

  /* ---------- Reembolsos de las pasarelas (lib/reembolsos.ts) ----------
     Lo que Stripe, Hotmart o Whop dicen que devolvieron: si calza con UNA
     devolución cargada a mano se le ata (queda con la referencia de la
     pasarela); si no, entra como propuesta, que no cuenta en Finanzas hasta
     que alguien la confirma. Nunca resta plata solo. Lo hace quien carga
     devoluciones; para el resto no hace nada (los cobros se importan igual). */

  importarReembolsos(crudos: ReembolsoCrudo[]): ResultadoReembolsos | null {
    const e = snapshot();
    if (acceso && !puedeCargarDevolucion(acceso)) return null;
    const r = conciliarReembolsos(e, crudos, ahora());
    if (!r.atadas.length && !r.nuevas.length) return r;
    const cambios = new Map(r.atadas.map((a) => [a.devolucionId, a.cambios] as const));
    const devoluciones = [
      ...r.nuevas,
      ...(e.devoluciones ?? []).map((d) => (cambios.has(d.id) ? { ...d, ...cambios.get(d.id) } as Devolucion : d)),
    ];
    const partes = [
      r.atadas.length ? `${r.atadas.length === 1 ? "se ató 1" : `se ataron ${r.atadas.length}`} a una devolución ya cargada` : "",
      r.nuevas.length ? `${r.nuevas.length === 1 ? "queda 1 propuesta" : `quedan ${r.nuevas.length} propuestas`} para confirmar` : "",
    ].filter(Boolean).join(" y ");
    const { lista, nuevo } = registrar(
      e, "transaccion", "reembolsos", "Reembolsos de las pasarelas", "creo",
      `Las pasarelas informaron ${crudos.length === 1 ? "1 reembolso" : `${crudos.length} reembolsos`}: ${partes}.`,
    );
    guardar({ ...e, devoluciones, actividad: lista });
    if (r.nuevas.length) empujar({ tipo: "upsert", tabla: "devoluciones", filas: r.nuevas });
    for (const a of r.atadas) empujarUpdate("devoluciones", [a.devolucionId], a.cambios as Record<string, unknown>);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return r;
  },

  /* Atar propuestas de la pasarela a las devoluciones cargadas a mano a las
     que corresponden: la cargada toma la referencia de la pasarela y la
     propuesta se va. Devuelve cuántas se ataron. */
  atarReembolsos(pares: { propuestaId: ID; devolucionId: ID }[]): number {
    const e = snapshot();
    if (acceso && !puedeCargarDevolucion(acceso)) {
      negada("devoluciones", "Tu tipo de cuenta no decide sobre las devoluciones: las atan Finanzas o el director comercial.");
      return 0;
    }
    let devoluciones = e.devoluciones ?? [];
    const quitar: ID[] = [];
    const cambios: { id: ID; cambios: Partial<Devolucion> }[] = [];
    for (const par of pares) {
      const r = atarPropuesta({ devoluciones }, par.propuestaId, par.devolucionId, ahora());
      if (!r) continue;
      devoluciones = devoluciones.filter((d) => d.id !== r.quitarPropuesta)
        .map((d) => (d.id === r.devolucionId ? { ...d, ...r.cambios } as Devolucion : d));
      quitar.push(r.quitarPropuesta);
      cambios.push({ id: r.devolucionId, cambios: r.cambios });
    }
    if (cambios.length === 0) return 0;
    const { lista, nuevo } = registrar(
      e, "transaccion", "reembolsos", "Reembolsos de las pasarelas", "actualizo",
      `${cambios.length === 1 ? "Se ató 1 reembolso" : `Se ataron ${cambios.length} reembolsos`} de la pasarela a una devolución ya cargada.`,
    );
    guardar({ ...e, devoluciones, actividad: lista });
    for (const c of cambios) empujarUpdate("devoluciones", [c.id], c.cambios as Record<string, unknown>);
    empujar({ tipo: "delete", tabla: "devoluciones", ids: quitar });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return cambios.length;
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
    const pagoViejo = new Map(e.pagos.map((p) => [p.id, p] as const));
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
      /* Reimportar no borra lo que ya se chequeó en la app ni quién cargó el cobro. */
      pagos: reemplazar(e.pagos, r.pagos.map((n) => {
        const viejo = pagoViejo.get(n.id);
        if (!viejo) return n;
        const control = Object.fromEntries(COLUMNAS_QUE_PONE_LA_BASE.map((k) => [k, (viejo as unknown as Record<string, unknown>)[k]]));
        return { ...n, ...control } as Pago;
      })),
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
     toca: es la real de la pasarela. También los datos de quien pagó. El
     chequeo del cobro ya no es un tilde acá: lo hacen el director y finanzas
     desde su ventana (chequearPago). */
  editarPago(id: ID, cambios: {
    feeMonto?: number; pagador?: string; cuit?: string; tipoCambio?: number; cvu?: string;
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

  /* ---------- El control cruzado de un cobro (lib/control-cobros.ts) ----------
     El director o finanzas miran el comprobante y dicen «chequeado» o lo
     rechazan con el motivo; o quitan lo que habían dicho. Cada casillero es
     de uno: el de finanzas lo llena quien edita Finanzas; el del director,
     quien edita las ventas de todos. No cambia ningún número del cobro.

     Va a la base como un UPDATE de las columnas de ese casillero y nada más: la
     base sella quién y cuándo con la sesión (supabase/control-cruzado.sql), y
     un cobro entero de esta pantalla, que puede ser más viejo, no pisa lo que
     otro acaba de chequear. */
  chequearPago(id: ID, datos: { casillero: CasilleroChequeo; veredicto: VeredictoChequeo | null; nota?: string }): boolean {
    const e = snapshot();
    const pago = e.pagos.find((p) => p.id === id);
    if (!pago) return false;
    if (acceso && !puedeUsarCasillero(acceso, datos.casillero)) return false;
    /* Rechazar sin decir por qué no le sirve a quien tiene que arreglarlo. */
    if (datos.veredicto === "rechazado" && !datos.nota?.trim()) return false;
    const quien = { por: quienSoy(e), en: ahora(), nota: datos.nota };
    const actualizado = conChequeo(pago, datos.casillero, datos.veredicto, quien);

    const cuota = e.cuotas.find((c) => c.id === pago.cuotaId);
    const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
    const rol = ROL_DE_CASILLERO[datos.casillero].por;
    const yo = nombreDeQuien(e, quien.por);
    const de = venta ? ` de ${venta.contactoNombre}` : "";
    const que = datos.veredicto === "chequeado" ? `lo chequeó ${rol}`
      : datos.veredicto === "rechazado" ? `lo rechazó ${rol}: «${datos.nota?.trim()}»`
        : `se sacó lo que había dicho ${rol}`;
    const { nuevo } = registrar(
      e, "transaccion", venta?.id ?? pago.id, venta?.contactoNombre ?? "Cobro", "actualizo",
      `Cobro del ${pago.fecha.slice(0, 10)}${de}: ${que} (${yo}).`,
    );
    const act = { ...nuevo, actor: yo };
    guardar({ ...e, pagos: e.pagos.map((p) => (p.id === id ? actualizado : p)), actividad: [act, ...e.actividad].slice(0, 400) });
    empujarUpdate("pagos", [id], cambiosDeChequeo(datos.casillero, datos.veredicto, quien));
    empujar({ tipo: "upsert", tabla: "actividad", filas: [act] });
    return true;
  },

  /* Subir o cambiar el comprobante de un cobro ya cargado (hasta acá sólo se
     subía al cargarlo): el closer arregla uno rechazado, la asistente adjunta
     el que le llegó por otro lado. Si ya había otro archivo y se cambia, lo
     que se chequeó contra el de antes vuelve a pendiente. El archivo de antes
     queda guardado: es lo que se miró cuando se chequeó o se rechazó. */
  cambiarComprobante(id: ID, comprobante: Comprobante): boolean {
    const e = snapshot();
    const pago = e.pagos.find((p) => p.id === id);
    if (!pago) return false;
    if (acceso && !puedeCambiarComprobante(acceso)) return false;
    const { pago: actualizado, cambios, reinicia } = conComprobanteNuevo(pago, comprobante);
    const cuota = e.cuotas.find((c) => c.id === pago.cuotaId);
    const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
    const yo = nombreDeQuien(e, quienSoy(e));
    const { nuevo } = registrar(
      e, "transaccion", venta?.id ?? pago.id, venta?.contactoNombre ?? "Cobro", "actualizo",
      `Cobro del ${pago.fecha.slice(0, 10)}${venta ? ` de ${venta.contactoNombre}` : ""}: ${pago.comprobante ? "se cambió" : "se subió"} el comprobante (${comprobante.nombre})`
      + `${reinicia ? "; los chequeos vuelven a quedar pendientes" : ""} (${yo}).`,
    );
    const act = { ...nuevo, actor: yo };
    guardar({ ...e, pagos: e.pagos.map((p) => (p.id === id ? actualizado : p)), actividad: [act, ...e.actividad].slice(0, 400) });
    empujarUpdate("pagos", [id], cambios);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [act] });
    return true;
  },

  /* ---------- Qué webinar trajo cada venta (lib/atar-webinars.ts) ----------
     Crea los webinars viejos que nombran los proyectos WEB- de la planilla y
     ata cada venta sin webinar al suyo. A la base va sólo el webinarId de
     cada venta (un UPDATE), así no pisa nada que se haya editado en otro lado. */
  atarVentasAWebinars(): { webinars: number; ventas: number } {
    const e0 = snapshot();
    const cuando = ahora();
    const nuevos = webinarsQueFaltan(e0).map((w) => webinarNuevoDeProyecto(w, nuevoId("web"), cuando));
    const e = nuevos.length ? { ...e0, webinars: [...e0.webinars, ...nuevos] } : e0;
    const atar = ventasParaAtar(e);
    if (nuevos.length === 0 && atar.length === 0) return { webinars: 0, ventas: 0 };
    const porVenta = new Map(atar.map((a) => [a.venta.id, a.webinarId] as const));
    const { lista, nuevo } = registrar(
      e, "webinar", "atar-webinars", "Ventas de cada webinar", "actualizo",
      `Se ataron ${atar.length} ventas a su webinar (${atar.filter((a) => a.motivo === "proyecto").length} por el proyecto, `
      + `${atar.filter((a) => a.motivo === "utm").length} por los UTMs y ${atar.filter((a) => a.motivo === "fecha").length} por la fecha)`
      + (nuevos.length ? ` y se ${nuevos.length === 1 ? "creó un webinar" : `crearon ${nuevos.length} webinars`} de la planilla.` : "."),
    );
    guardar({
      ...e, actividad: lista,
      ventas: e.ventas.map((v) => (porVenta.has(v.id) ? { ...v, webinarId: porVenta.get(v.id) } : v)),
    });
    if (nuevos.length) empujarEnLotes("webinars", nuevos);
    const porWebinar = new Map<ID, ID[]>();
    for (const a of atar) porWebinar.set(a.webinarId, [...(porWebinar.get(a.webinarId) ?? []), a.venta.id]);
    for (const [webinarId, ids] of porWebinar) empujarUpdate("ventas", ids, { webinarId });
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return { webinars: nuevos.length, ventas: atar.length };
  },

  /* ---------- La tasa de una cuenta, en los cobros que ya la usaban ----------
     Al cambiar la comisión de una cuenta recaudadora, quien la cambia elige
     si los cobros ya cargados con la tasa de la cuenta pasan a la nueva.
     Los conciliados y los corregidos a mano no se tocan (cobrosConOtraTasa). */
  aplicarTasaDeCuenta(procesadorId: ID): number {
    const e = snapshot();
    const proc = e.procesadores.find((p) => p.id === procesadorId);
    if (!proc) return 0;
    const cambiados = cobrosConOtraTasa(e, proc.id, proc.feeRate).map((p) => conTasa(p, proc.feeRate));
    if (cambiados.length === 0) return 0;
    const porId = new Map(cambiados.map((p) => [p.id, p] as const));
    const pct = `${(proc.feeRate * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
    const { lista, nuevo } = registrar(
      e, "transaccion", proc.id, proc.nombre, "actualizo",
      `La comisión de ${proc.nombre} quedó en ${pct}: se recalcularon ${cambiados.length === 1 ? "un cobro" : `${cambiados.length} cobros`} que usaban la tasa de la cuenta.`,
    );
    guardar({ ...e, pagos: e.pagos.map((p) => porId.get(p.id) ?? p), actividad: lista });
    empujarEnLotes("pagos", cambiados);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return cambiados.length;
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
      nuevosPagos.push({ ...pagoDesdeMovimiento(mov, imp.cuotaId, imp.monto, tasaEstimada(e, mov)), id: nuevoId("pag") } as Pago);
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
      nuevosPagos = cargadosAhora(e, [...porVenta.entries()].flatMap(([v, ps]) => {
        const cuotasVenta = e.cuotas.filter((c) => c.ventaId === v);
        const ids = new Set(cuotasVenta.map((c) => c.id));
        return conDatosDePlanilla(ps, cuotasVenta, e.pagos.filter((p) => ids.has(p.cuotaId)), false);
      }));
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

  /* Atar un cobro de pasarela al pago que ya estaba cargado (de la planilla
     o a mano): no nace otro pago ni se mueve el cash collected. El pago toma
     la comisión real de la pasarela y queda chequeado. Ver pagosYaCargados. */
  vincularConPagos(pares: { movimientoId: ID; pagoId: ID }[]): number {
    const e = snapshot();
    const movPorId = new Map(e.movimientos.map((m) => [m.id, m] as const));
    const pagoPorId = new Map(e.pagos.map((p) => [p.id, p] as const));
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const pagosCambiados = new Map<ID, Pago>();
    const movsCambiados = new Map<ID, Movimiento>();
    const cuando = ahora();
    for (const { movimientoId, pagoId } of pares) {
      const mov = movPorId.get(movimientoId);
      const pago = pagoPorId.get(pagoId);
      if (!mov || mov.estado !== "pendiente" || !pago || pago.movimientoId || pagosCambiados.has(pago.id)) continue;
      /* Con la comisión real el pago toma la suya. Si la pasarela todavía
         no la mandó (Whop no la traía, Stripe tarda), conserva la que tenía:
         ponerle 0 inflaba el cash post pasarelas y las comisiones. */
      const real = !feeDesconocido(mov);
      const fee = !real ? pago.feeMonto : mov.monto > 0 ? r2(mov.fee * (pago.monto / mov.monto)) : 0;
      pagosCambiados.set(pago.id, {
        ...pago, movimientoId: mov.id, feeMonto: fee,
        feeRate: !real ? pago.feeRate : pago.monto > 0 ? Math.round((fee / pago.monto) * 10000) / 10000 : 0,
        feeManual: false, chequeado: true, referencia: pago.referencia || mov.referencia,
      });
      movsCambiados.set(mov.id, {
        ...mov, estado: "conciliado", vinculado: true, pagoId: pago.id, cuotaId: pago.cuotaId,
        ventaId: e.cuotas.find((c) => c.id === pago.cuotaId)?.ventaId,
        conciliadoEn: cuando, conciliadoPor: e.ajustes.responsable || "Apicanta",
      });
    }
    if (pagosCambiados.size === 0) return 0;
    const { lista, nuevo } = registrar(
      e, "transaccion", "vincular-cobros", "Conciliación", "actualizo",
      pagosCambiados.size === 1
        ? "Se ató un cobro de pasarela al pago que ya estaba cargado: tiene la comisión real y no se suma plata."
        : `Se ataron ${pagosCambiados.size} cobros de pasarela a los pagos que ya estaban cargados: tienen la comisión real y no se suma plata.`,
    );
    guardar({
      ...e, actividad: lista,
      pagos: e.pagos.map((p) => pagosCambiados.get(p.id) ?? p),
      movimientos: e.movimientos.map((m) => movsCambiados.get(m.id) ?? m),
    });
    empujarEnLotes("pagos", [...pagosCambiados.values()]);
    empujarEnLotes("movimientos", [...movsCambiados.values()]);
    empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return pagosCambiados.size;
  },

  /* Deshacer: se borran los pagos que nacieron del movimiento y las cuotas
     vuelven a estar pendientes. Sin esto, un error de conciliación sólo se
     arregla a mano y en tres pantallas distintas. Si el cobro se había
     atado a un pago que ya estaba cargado, se desata: el pago queda (vuelve
     a la tasa de su cuenta) y el cobro vuelve a la bandeja. */
  desconciliar(movimientoId: ID): boolean {
    const e = snapshot();
    const mov = e.movimientos.find((m) => m.id === movimientoId);
    if (!mov) return false;
    if (mov.vinculado) {
      const tasa = (id?: ID) => e.procesadores.find((p) => p.id === id)?.feeRate ?? 0;
      const desatados = e.pagos.filter((p) => p.movimientoId === mov.id).map((p) => ({
        ...p, movimientoId: undefined, feeRate: tasa(p.procesadorId), feeMonto: Math.round(p.monto * tasa(p.procesadorId) * 100) / 100,
      }));
      const actualizado: Movimiento = {
        ...mov, estado: "pendiente", vinculado: false,
        pagoId: undefined, cuotaId: undefined, ventaId: undefined, conciliadoEn: undefined, conciliadoPor: undefined,
      };
      const porId = new Map(desatados.map((p) => [p.id, p] as const));
      const { lista, nuevo } = registrar(
        e, "transaccion", mov.id, `Cobro ${mov.referencia}`, "actualizo",
        `Se desató ${mov.referencia} del pago que ya estaba cargado: el pago queda y el cobro vuelve a la bandeja.`,
      );
      guardar({
        ...e, actividad: lista,
        pagos: e.pagos.map((p) => porId.get(p.id) ?? p),
        movimientos: e.movimientos.map((m) => (m.id === mov.id ? actualizado : m)),
      });
      /* undefined no viaja: movimientoId tiene que ir como null para que la base lo borre. */
      for (const p of desatados) empujarUpdate("pagos", [p.id], { movimientoId: null, feeRate: p.feeRate, feeMonto: p.feeMonto });
      empujarUpdate("movimientos", [mov.id], { estado: "pendiente", vinculado: false, pagoId: null, cuotaId: null, ventaId: null, conciliadoEn: null, conciliadoPor: null });
      empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
      return true;
    }

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
  importarMovimientos(filas: Omit<Movimiento, "id" | "estado" | "creadoEn" | "origen">[], origen: string): { nuevos: number; repetidos: number; completados: number } {
    const e = snapshot();
    const porClave = new Map<string, Movimiento>(e.movimientos.map((m) => [`${m.proveedor}:${m.referencia}`, m]));
    const vistos = new Set<string>(porClave.keys());
    const nuevos: Movimiento[] = [];
    /* Los que ya estaban no se duplican, pero se completa lo que les faltaba:
       quién pagó, cómo, y la comisión real si todavía no se sabía. */
    const parches = new Map<ID, ParcheDeCobro>();

    for (const f of filas) {
      const clave = `${f.proveedor}:${f.referencia}`;
      const ya = porClave.get(clave);
      if (ya) {
        const p = parcheDeCobro({ ...ya, ...(parches.get(ya.id) ?? {}) }, f);
        if (p) parches.set(ya.id, { ...(parches.get(ya.id) ?? {}), ...p });
        continue;
      }
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      nuevos.push({ ...f, id: nuevoId("mov"), estado: "pendiente", origen, creadoEn: ahora() });
    }

    if (nuevos.length === 0 && parches.size === 0) return { nuevos: 0, repetidos: filas.length, completados: 0 };

    /* Los pagos de un cobro conciliado toman la comisión real, en proporción. */
    const pagosCambiados = new Map<ID, Pago>();
    for (const [id, parche] of parches) {
      if (parche.fee === undefined) continue;
      const mov = e.movimientos.find((m) => m.id === id)!;
      for (const pago of e.pagos) {
        if (pago.movimientoId !== id) continue;
        const cambio = feeDelPago(pago, mov, parche.fee);
        if (cambio) pagosCambiados.set(pago.id, { ...pago, ...cambio });
      }
    }

    let lista = e.actividad;
    let nuevo: ReturnType<typeof registrar>["nuevo"] | undefined;
    if (nuevos.length > 0) {
      ({ lista, nuevo } = registrar(
        e, "transaccion", "import", "Cobros importados", "importo",
        `Entraron ${nuevos.length} cobros de pasarela (${origen}).`,
      ));
    }
    guardar({
      ...e,
      movimientos: [...nuevos, ...e.movimientos.map((m) => (parches.has(m.id) ? { ...m, ...parches.get(m.id) } : m))],
      pagos: pagosCambiados.size ? e.pagos.map((p) => pagosCambiados.get(p.id) ?? p) : e.pagos,
      actividad: lista,
    });
    if (nuevos.length) empujar({ tipo: "upsert", tabla: "movimientos", filas: nuevos });
    for (const [id, parche] of parches) empujarUpdate("movimientos", [id], parche);
    for (const p of pagosCambiados.values()) empujarUpdate("pagos", [p.id], { feeMonto: p.feeMonto, feeRate: p.feeRate });
    if (nuevo) empujar({ tipo: "upsert", tabla: "actividad", filas: [nuevo] });
    return { nuevos: nuevos.length, repetidos: filas.length - nuevos.length, completados: parches.size };
  },

  /* Los cobros de Mercury que el banco anuló después de entrar a la bandeja
     (fallaron, se cancelaron, se revirtieron): si siguen sin conciliar, se
     descartan solos, con una nota. Los conciliados no se tocan. */
  descartarAnuladosMercury(referencias: string[]): number {
    const e = snapshot();
    const ids = new Set(cobrosAnulados(e.movimientos, referencias));
    if (ids.size === 0) return 0;
    const cambios = new Map<ID, Pick<Movimiento, "estado" | "descripcion">>();
    for (const m of e.movimientos) {
      if (ids.has(m.id)) cambios.set(m.id, { estado: "ignorado", descripcion: [m.descripcion, NOTA_ANULADO].filter(Boolean).join(" · ") });
    }
    guardar({ ...e, movimientos: e.movimientos.map((m) => (cambios.has(m.id) ? { ...m, ...cambios.get(m.id) } : m)) });
    for (const [id, c] of cambios) empujarUpdate("movimientos", [id], c);
    return cambios.size;
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
     que Finanzas lo calcula (la general y la de cada servicio que comisiona
     distinto) se vuelve a leer de lo que cobra. */
  guardarMiembro(m: MiembroEquipo) {
    const e = snapshot();
    const esq = e.honorarios.find((h) => h.miembroId === m.id);
    const tasa = tasaParaFinanzas(m, esq);
    const servicios = tasasPorServicio(m, esq);
    const fila = tasa === undefined ? m : { ...m, comisionRate: tasa, ...(servicios ? { comisionServicios: servicios } : {}) };
    const existe = e.equipo.some((x) => x.id === m.id);
    guardar({ ...e, equipo: existe ? e.equipo.map((x) => (x.id === m.id ? fila : x)) : [...e.equipo, fila] });
    empujar({ tipo: "upsert", tabla: "equipo", filas: [fila] });
  },

  /* Guarda lo que cobra alguien y alinea su comisionRate y su % por
     servicio: la tasa con la que Finanzas calcula su comisión (o el reparto)
     tiene que ser la del esquema, o Finanzas y la liquidación dirían números
     distintos. */
  guardarEsquema(esq: EsquemaPago, por?: string) {
    const e = snapshot();
    const actualizado: EsquemaPago = { ...esq, actualizadoEn: ahora(), ...(por ? { actualizadoPor: por } : {}) };
    const existe = e.honorarios.some((h) => h.id === esq.id);
    const honorarios = existe ? e.honorarios.map((h) => (h.id === esq.id ? actualizado : h)) : [...e.honorarios, actualizado];
    const m = e.equipo.find((x) => x.id === esq.miembroId);
    const tasa = m ? tasaParaFinanzas(m, actualizado) : undefined;
    const servicios = m ? tasasPorServicio(m, actualizado) : undefined;
    let equipo = e.equipo;
    if (m && tasa !== undefined && (Math.abs(tasa - m.comisionRate) > 1e-9 || !mismasTasas(servicios, m.comisionServicios))) {
      const fila = { ...m, comisionRate: tasa, comisionServicios: servicios ?? {} };
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

  /* Suma o descuenta un monto en la liquidación de un mes, también en uno que
     viene («el mes que viene hay que descontárselo»). Si ese mes todavía no
     tiene liquidación se crea con lo único que tiene: el monto. Lee el estado
     de este momento y no el de la pantalla, así lo que se anota desde otro
     mes no pisa ni se pierde con lo que se carga mirando éste. Devuelve false
     si ese mes ya está cerrado: lo cerrado no cambia. */
  agregarExtraLiquidacion(periodo: string, extra: ExtraLiquidacion): boolean {
    const e = snapshot();
    const r = conExtraEnMes(e.liquidaciones, periodo, extra, ahora());
    if (!r) return false;
    guardar({ ...e, liquidaciones: r.liquidaciones });
    empujar({ tipo: "upsert", tabla: "liquidaciones", filas: [r.liquidacion] });
    return true;
  },

  /* Saca un monto anotado de una liquidación abierta. */
  quitarExtraLiquidacion(liquidacionId: ID, extraId: ID): boolean {
    const e = snapshot();
    const r = sinExtraEnLiquidacion(e.liquidaciones, liquidacionId, extraId, ahora());
    if (!r) return false;
    guardar({ ...e, liquidaciones: r.liquidaciones });
    empujar({ tipo: "upsert", tabla: "liquidaciones", filas: [r.liquidacion] });
    return true;
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

/* El tema es de quien mira, en este navegador: antes iba en los ajustes de
   todos, y un closer que lo cambiaba escribía la configuración del negocio.
   Lo de los ajustes queda de valor inicial. layout.tsx lo lee antes de
   pintar. */
const CLAVE_TEMA = "apicanta:tema";
let temaPropio: "dark" | "light" | null | undefined;
const oyentesTema = new Set<() => void>();

function leerTema(): "dark" | "light" | null {
  if (temaPropio === undefined) {
    try {
      const t = typeof window === "undefined" ? null : window.localStorage.getItem(CLAVE_TEMA);
      temaPropio = t === "dark" || t === "light" ? t : null;
    } catch { temaPropio = null; }
  }
  return temaPropio;
}

function suscribirTema(f: () => void) {
  oyentesTema.add(f);
  return () => { oyentesTema.delete(f); };
}

export function useTema(): ["dark" | "light", (t: "dark" | "light") => void] {
  const deAjustes = useSelector((e) => e.ajustes.tema);
  const propio = useSyncExternalStore(suscribirTema, leerTema, () => null);
  const set = useCallback((t: "dark" | "light") => {
    temaPropio = t;
    try { window.localStorage.setItem(CLAVE_TEMA, t); } catch { /* modo privado */ }
    oyentesTema.forEach((f) => f());
    if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
  }, []);
  return [propio ?? deAjustes, set];
}

export { hayNube };
export type {
  EstadoApp, Lead, Alumno, Sesion, Webinar, Campania,
  Meta, Etapa, Reporte, CampoPersonalizado, EntidadNombre,
};
