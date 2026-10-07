import type { MiembroEquipo, Sesion, TipoCuenta } from "./types";
import { miembroDeCloser, sinTildes } from "./crm";
import { CANCELADA } from "./estados";
import { anfitrionesPorMiembro } from "./pasar-llamadas";

/* ==================================================================
   La cuenta del closer, a prueba de tontos (reunión del 02/10: «veo mis
   llamadas y veo cómo completar el estado de mis llamadas, punto»).

   Un closer ve sólo lo suyo, y la base sabe qué es suyo por dos cosas:
   - quién es: el correo con el que entra tiene que estar cargado en su
     ficha de Equipo;
   - cuáles son sus llamadas: el anfitrión del evento de Calendly tiene que
     llamarse como él en Equipo (las dos primeras palabras, sin tildes: la
     misma regla de miembroDeCloser, que usan el CRM, el cierre del día y
     las políticas de la base).
   Si cualquiera de las dos falla, entra y no ve nada, sin ningún aviso.

   Acá está la cuenta que dice, closer por closer, si va a ver sus
   llamadas, y qué hacer si no: para los dueños (Equipo → Accesos) y, del
   lado del closer, el aviso de por qué no ve nada. Y el resumen de su día
   para «Mis llamadas».
   ================================================================== */

export interface AccesoDeCuenta { email: string; nombre: string; rol: string }

export const correoDe = (m: Pick<MiembroEquipo, "email">) => m.email?.trim().toLowerCase() ?? "";

export interface AnfitrionContado { nombre: string; llamadas: number }

export type ProblemaDeCloser =
  /* Falta su correo en Equipo. `sugerido`: un acceso sin dueño que se llama como él. */
  | { tipo: "sin-correo"; sugerido?: AccesoDeCuenta }
  /* Tiene correo, pero ese correo no tiene acceso a la app. */
  | { tipo: "sin-acceso" }
  /* Ningún anfitrión de Calendly se llama como él. `candidatos`: anfitriones sin dueño que se le parecen. */
  | { tipo: "sin-anfitrion"; candidatos: AnfitrionContado[] };

export interface CloserEvaluado {
  miembro: MiembroEquipo;
  correo: string;
  /* null: ese correo no tiene acceso. undefined: no se sabe (no llegó la lista de accesos). */
  acceso: AccesoDeCuenta | null | undefined;
  /* Los anfitriones de Calendly que son suyos, con sus llamadas. */
  anfitriones: AnfitrionContado[];
  /* Su acceso ve todo (Todo menos honorarios, el director): lo suyo no depende de su nombre ni de Calendly. */
  veTodo: boolean;
  /* «no-ve»: entra y no ve nada; «sin-acceso»: todavía no puede entrar; «ok»: ve sus llamadas. */
  estado: "ok" | "no-ve" | "sin-acceso";
  problemas: ProblemaDeCloser[];
}

export interface AccesoSinCloser {
  acceso: AccesoDeCuenta;
  /* Closers activos sin correo: de uno de ellos es este acceso. Los que se le parecen, primero. */
  candidatos: MiembroEquipo[];
}

export interface AnfitrionSinDueno extends AnfitrionContado {
  /* Closers activos a los que se parece (comparten el nombre o el apellido). */
  candidatos: MiembroEquipo[];
}

export interface EstadoDeClosers {
  closers: CloserEvaluado[];
  /* Entran como closer pero su correo no está en Equipo: no ven nada. */
  accesosSinMiembro: AccesoSinCloser[];
  /* Anfitriones de Calendly con llamadas que no son de nadie del equipo: sólo los dueños las ven. */
  anfitrionesSinDueno: AnfitrionSinDueno[];
  /* Cuántos no van a ver nada. */
  sinVer: number;
}

const DIA = 86_400_000;
const palabras = (t: string) => sinTildes(t).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((p) => p.length > 1);

/** Se parecen si comparten el nombre de pila o el apellido («V. Abadia» y
 *  «Valentín Abadía» comparten el apellido). Es una sugerencia: la persona
 *  confirma; no es la regla que une llamadas con closers. */
export function seParecen(a: string, b: string): boolean {
  const x = palabras(a), y = palabras(b);
  if (x.length === 0 || y.length === 0) return false;
  return x[0] === y[0] || x[x.length - 1] === y[y.length - 1];
}

/** Quién va a ver sus llamadas, closer por closer.
 *  `accesos`: los de la app (sólo los dueños pueden leerlos); null si no se
 *  sabe (la app local no tiene login). `desde`: las llamadas de antes de esa
 *  fecha no cuentan para los anfitriones sin dueño (un anfitrión de prueba
 *  de hace meses no es un problema de hoy). */
export function evaluarClosers(
  e: { equipo: MiembroEquipo[]; sesiones: Pick<Sesion, "anfitrion" | "inicia">[] },
  accesos: AccesoDeCuenta[] | null,
  tipos: Pick<TipoCuenta, "id" | "soloLoSuyo">[],
  ahora = Date.now(),
): EstadoDeClosers {
  const soloLoSuyoDe = (rol: string) => {
    const t = tipos.find((x) => x.id === rol);
    return Boolean(t?.soloLoSuyo) && rol !== "dueno";
  };
  const porCorreo = new Map((accesos ?? []).map((a) => [a.email.trim().toLowerCase(), a]));
  const correosDeEquipo = new Set(e.equipo.map(correoDe).filter(Boolean));
  const suyos = anfitrionesPorMiembro(e.sesiones, e.equipo);
  const activos = e.equipo.filter((m) => m.activo && m.rol === "closer");
  const sinCorreo = activos.filter((m) => !correoDe(m));

  /* Los accesos de closer cuyo correo no está en Equipo. */
  const accesosSinMiembro: AccesoSinCloser[] = (accesos ?? [])
    .filter((a) => soloLoSuyoDe(a.rol) && !correosDeEquipo.has(a.email.trim().toLowerCase()))
    .map((acceso) => ({
      acceso,
      candidatos: [...sinCorreo].sort((a, b) => Number(seParecen(acceso.nombre, b.nombre)) - Number(seParecen(acceso.nombre, a.nombre))),
    }));

  const closers = activos.map((m): CloserEvaluado => {
    const correo = correoDe(m);
    const acceso = accesos === null ? undefined : correo ? porCorreo.get(correo) ?? null : null;
    const anfitriones = suyos.get(m.id) ?? [];
    /* Con un acceso que ve todo (Todo menos honorarios, el director), lo suyo no es un problema. */
    const veTodo = Boolean(acceso) && !soloLoSuyoDe(acceso!.rol);
    const problemas: ProblemaDeCloser[] = [];
    if (!veTodo) {
      if (!correo) {
        const sugerido = accesosSinMiembro.find((x) => miembroDeCloser(x.acceso.nombre, [m]))?.acceso;
        problemas.push({ tipo: "sin-correo", ...(sugerido ? { sugerido } : {}) });
      }
      if (anfitriones.length === 0) problemas.push({ tipo: "sin-anfitrion", candidatos: [] });
      if (correo && acceso === null) problemas.push({ tipo: "sin-acceso" });
    }
    const estado = problemas.some((p) => p.tipo !== "sin-acceso") ? "no-ve" : problemas.length ? "sin-acceso" : "ok";
    return { miembro: m, correo, acceso, anfitriones, veTodo, estado, problemas };
  });

  /* Los anfitriones de Calendly que no son de nadie, de las llamadas de hace poco o que vienen. */
  const desde = ahora - 60 * DIA;
  const cuenta = new Map<string, number>();
  for (const s of e.sesiones) {
    const a = s.anfitrion?.trim();
    if (a && Date.parse(s.inicia) >= desde) cuenta.set(a, (cuenta.get(a) ?? 0) + 1);
  }
  const anfitrionesSinDueno: AnfitrionSinDueno[] = [...cuenta.entries()]
    .filter(([nombre]) => !miembroDeCloser(nombre, e.equipo))
    .map(([nombre, llamadas]) => ({ nombre, llamadas, candidatos: activos.filter((m) => seParecen(nombre, m.nombre)) }))
    .sort((a, b) => b.llamadas - a.llamadas || a.nombre.localeCompare(b.nombre, "es"));

  /* Los candidatos de «sin anfitrión»: los anfitriones sin dueño que se le parecen. */
  for (const c of closers) {
    const p = c.problemas.find((x): x is Extract<ProblemaDeCloser, { tipo: "sin-anfitrion" }> => x.tipo === "sin-anfitrion");
    if (p) p.candidatos = anfitrionesSinDueno.filter((a) => a.candidatos.some((m) => m.id === c.miembro.id)).map(({ nombre, llamadas }) => ({ nombre, llamadas }));
  }

  return {
    closers, accesosSinMiembro, anfitrionesSinDueno,
    sinVer: closers.filter((c) => c.estado === "no-ve").length + accesosSinMiembro.length,
  };
}

/* ---------- Del lado del closer: por qué no ve nada ---------- */

export type AvisoDeCuenta =
  /* Su correo no está en Equipo: la app no sabe quién es. */
  | { tipo: "sin-miembro"; email: string }
  /* Está en Equipo pero no hay ninguna llamada a su nombre. */
  | { tipo: "sin-llamadas"; nombre: string }
  | null;

/** Lo que le conviene saber a un closer (una cuenta de «sólo lo suyo») que
 *  entra y no ve nada. Sin sesión (la app local) o con datos todavía sin
 *  traer, no dice nada: sólo cuando se sabe. */
export function avisoDeCuenta(i: {
  soloLoSuyo: boolean; email: string | null; miembro?: Pick<MiembroEquipo, "nombre">; llamadasVisibles: number; cargado: boolean;
}): AvisoDeCuenta {
  if (!i.soloLoSuyo || !i.email || !i.cargado) return null;
  if (!i.miembro) return { tipo: "sin-miembro", email: i.email };
  return i.llamadasVisibles === 0 ? { tipo: "sin-llamadas", nombre: i.miembro.nombre } : null;
}

/* ---------- El día de «Mis llamadas» ---------- */

export interface ResumenDelDia {
  /* Las de hoy, sin las canceladas. */
  hoy: number;
  /* De hoy, ya pasaron y nadie cargó cómo terminaron. */
  sinCargarHoy: number;
  /* De días anteriores (hasta dos semanas, como el cierre del día), todavía sin cargar. */
  sinCargarAntes: number;
}

export const DIAS_DE_ANTES = 14;

/** `filas`: las llamadas del closer (lib/crm-tabla: FilaTabla). */
export function resumenDelDia(
  filas: { dia: string; resultado: string; sinCargar: boolean }[], hoy: string,
): ResumenDelDia {
  const desde = new Date(Date.parse(`${hoy}T12:00:00Z`) - DIAS_DE_ANTES * DIA).toISOString().slice(0, 10);
  const r: ResumenDelDia = { hoy: 0, sinCargarHoy: 0, sinCargarAntes: 0 };
  for (const f of filas) {
    if (f.dia === hoy) {
      if (f.resultado !== CANCELADA) r.hoy++;
      if (f.sinCargar) r.sinCargarHoy++;
    } else if (f.dia < hoy && f.dia >= desde && f.sinCargar) r.sinCargarAntes++;
  }
  return r;
}
