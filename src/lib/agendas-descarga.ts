import { esReagendar, NO_SE_PRESENTO, REPROGRAMO, type Desenlace } from "./estados";
import { numeroParaCopiar } from "./contacto-telefono";
import { claveEmail } from "./contactos";
import { aCSV } from "./exportarPlanilla";
import { celdaParaCsv, COLUMNAS, COLUMNAS_DE_COBROS, filasTabla, type ClaveColumna, type ColumnaTabla, type FilaTabla } from "./crm-tabla";
import type { Sesion } from "./types";

/* ==================================================================
   Bajar las agendas de un webinar para mandarles un broadcast: los que no
   vinieron, los que pidieron otra fecha y los que cancelaron (Santi,
   23/10: «necesito descargar los no shows y reagendas y mandarles
   broadcast»). Hasta hoy las agendas de un webinar sólo se veían una por
   una en su ficha, y la Agenda mezclaba todos los embudos.

   Una persona que reagendó tiene dos agendas (la vieja, cancelada como
   «Reprogramada», y la nueva): en la descarga entra una sola vez, con su
   agenda más reciente. El teléfono sale con el «+» y el código de país, para
   pegarlo o importarlo tal cual en WhatsApp o ManyChat.

   Después de esas columnas van todas las de la tabla del CRM, con lo mismo
   que dice cada celda (Santi, 24/10: «¿hay manera que en el csv me descargue
   datos como cash collected, producto y todo eso?»). Antes eran nueve columnas
   escritas a mano y cada dato nuevo pedía tocar esto: ahora una columna que se
   suma al CRM sale sola en el CSV. Ver crmDeDescarga.
   ================================================================== */

/* Qué le pasó a la agenda. Una puede estar en más de una (no vino y pidió
   reagendar): por eso es una lista y no un solo valor. */
export type ClaseAgenda = "no-vino" | "reagendo" | "cancelo";

export const NOMBRE_CLASE: Record<ClaseAgenda, string> = {
  "no-vino": "No vinieron", reagendo: "Reagendaron", cancelo: "Cancelaron",
};

/* Pidió otra fecha o ya la tiene (la agenda de después de una reprogramación). */
export const reagendo = (s: Pick<Sesion, "estadoPreCall" | "reprogramadaDe" | "motivoCancelacion">, desenlace?: Desenlace): boolean =>
  esReagendar(s.estadoPreCall) || desenlace === REPROGRAMO || Boolean(s.reprogramadaDe) || /reprogram/i.test(s.motivoCancelacion ?? "");

/** Qué le pasó a la llamada. `desenlace` es el del Estado de Llamada tal cual
    se ve (lib/estados.ts: estadoVisible). Una cancelada por haber reprogramado
    no es una cancelación: es una reagenda. */
export function clasesDe(
  s: Pick<Sesion, "estado" | "estadoPreCall" | "reprogramadaDe" | "motivoCancelacion">, desenlace?: Desenlace,
): ClaseAgenda[] {
  const out: ClaseAgenda[] = [];
  const reagendada = reagendo(s, desenlace);
  if (s.estado !== "cancelada" && (s.estado === "no-show" || desenlace === NO_SE_PRESENTO)) out.push("no-vino");
  if (reagendada) out.push("reagendo");
  if (s.estado === "cancelada" && !reagendada) out.push("cancelo");
  return out;
}

type Persona = { nombre?: string; email?: string; telefono?: string; pais?: string } | undefined;

export interface FilaDescarga {
  s: Sesion;
  /* El estado de llamada tal cual se ve (Inasistió, Compra Full…). */
  estado: string;
  /* Qué le pasó (clasesDe, con el desenlace de su estado). */
  clases: ClaseAgenda[];
  persona?: Persona;
  /* Columnas propias de cada pantalla (el webinar, si fue en el vivo o después). */
  extra?: string[];
}

/* "2026-10-21 19:00": el día y la hora de Argentina, que es como se lee en la app. */
function cuando(iso?: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const CABECERA = ["Nombre", "Teléfono", "Email", "País", "Estado de llamada", "Qué pasó", "Closer", "Agendó el", "Llamada el"];

/* ---------- Lo del CRM: la venta, lo cobrado, el origen y el perfil ---------- */

export interface CrmDeDescarga {
  /* La fila del CRM de cada agenda (lib/crm-tabla.ts → filasTabla) y, para la agenda que el CRM no muestra (una
     reprogramada, un evento que no es de sus tablas), la de esa persona con venta (o la última): el CSV es una fila
     por persona. */
  porSesion: Map<string, FilaTabla>;
  porPersona: Map<string, FilaTabla>;
  /* Las columnas del CRM que van, en su orden. */
  columnas: ColumnaTabla[];
  /* El valor de cada venta: con él van «Valor de la venta» y «Falta cobrar» (sólo quien ve los cobros). */
  valorDeVenta?: Map<string, number>;
}

/* Las del CRM que ya están entre las de siempre. */
const YA_ESTAN: ClaveColumna[] = ["llamada", "nombre", "closer", "estadoLlamada", "email", "telefono", "pais", "agendo"];
/* Las que salen de las ventas: quien no las lee (un setter) vería «Sin venta» en todas. */
const DE_VENTAS: ClaveColumna[] = ["venta", "producto"];
const VALOR = "Valor de la venta";
const FALTA = "Falta cobrar";
const numero = (n: number) => String(Math.round(n * 100) / 100);

/** Lo que suma el CRM a la descarga, según lo que puede ver quien la baja: las ventas (producto, venta) y los
    cobros (lo cobrado, el valor, lo que falta, comprobante, conciliado, chequeo). Igual que la tabla del CRM. */
export function crmDeDescarga(
  e: Parameters<typeof filasTabla>[0], ve: { ventas: boolean; cobros: boolean }, ahora = Date.now(),
): CrmDeDescarga {
  const columnas = COLUMNAS.filter((c) => !YA_ESTAN.includes(c.clave)
    && (ve.ventas || !DE_VENTAS.includes(c.clave))
    && (ve.cobros || !COLUMNAS_DE_COBROS.includes(c.clave)));
  const filas = filasTabla(e, ahora);
  const porPersona = new Map<string, FilaTabla>();
  /* De cada persona, la que tiene venta (si hay más de una, la última) o, si ninguna, la última. */
  const pesa = (f: FilaTabla) => (f.ventaIds.length ? 1 : 0);
  for (const f of filas) {
    const antes = porPersona.get(f.personaId);
    if (!antes || pesa(f) > pesa(antes) || (pesa(f) === pesa(antes) && f.llamada > antes.llamada)) porPersona.set(f.personaId, f);
  }
  return {
    porSesion: new Map(filas.map((f) => [f.sesion.id, f] as const)),
    porPersona,
    columnas,
    ...(ve.ventas && ve.cobros ? { valorDeVenta: new Map(e.ventas.map((v) => [v.id, v.precioAcordado] as const)) } : {}),
  };
}

/* La cabecera y la celda de cada columna del CRM; una que se llama igual que otra que ya está (la «Vía» del
   webinar) no se repite. «Valor de la venta» y «Falta cobrar» van después de lo cobrado. */
function columnasDelCrm(crm: CrmDeDescarga, yaEstan: string[]): { titulo: string; celda: (f: FilaTabla) => string }[] {
  const usados = new Set(yaEstan.map((t) => t.toLowerCase()));
  const out: { titulo: string; celda: (f: FilaTabla) => string }[] = [];
  const valor = (f: FilaTabla) => f.ventaIds.reduce((a, id) => a + (crm.valorDeVenta?.get(id) ?? 0), 0);
  for (const c of crm.columnas) {
    if (usados.has(c.titulo.toLowerCase())) continue;
    out.push({ titulo: c.titulo, celda: (f) => celdaParaCsv(c, f) });
    if (c.clave === "cobrado" && crm.valorDeVenta) {
      out.push({ titulo: VALOR, celda: (f) => (f.ventaIds.length ? numero(valor(f)) : "") });
      out.push({ titulo: FALTA, celda: (f) => (f.ventaIds.length ? numero(Math.max(0, valor(f) - (f.cobrado ?? 0))) : "") });
    }
  }
  return out;
}

/* De quién es la agenda: su persona si la tiene; si no, el mail; si no, el teléfono. */
const claveDe = ({ s, persona }: FilaDescarga) =>
  s.contactoId ?? (s.email ?? persona?.email ?? "").trim().toLowerCase();

/* La fila del CRM de la agenda o, si el CRM no la muestra, la de su persona. */
const filaDelCrm = (crm: CrmDeDescarga | undefined, s: Sesion): FilaTabla | undefined =>
  crm?.porSesion.get(s.id) ?? crm?.porPersona.get(s.contactoId ?? "") ?? crm?.porPersona.get(s.leadId ?? "")
  ?? crm?.porPersona.get(claveEmail(s.email));

/** La tabla de la descarga: una fila por persona (la agenda más reciente) y,
    al final, las columnas que sume cada pantalla. */
export function tablaDeDescarga(filas: FilaDescarga[], cabeceraExtra: string[] = [], crm?: CrmDeDescarga): { tabla: string[][]; personas: number } {
  const ultima = new Map<string, FilaDescarga>();
  const sinClave: FilaDescarga[] = [];
  for (const f of filas) {
    const k = claveDe(f);
    if (!k) { sinClave.push(f); continue; }
    const antes = ultima.get(k);
    if (!antes || Date.parse(f.s.creadoEn) >= Date.parse(antes.s.creadoEn)) ultima.set(k, f);
  }
  const unicas = [...ultima.values(), ...sinClave].sort((a, b) => Date.parse(b.s.inicia) - Date.parse(a.s.inicia));
  const delCrm = crm ? columnasDelCrm(crm, [...CABECERA, ...cabeceraExtra]) : [];
  const tabla = [
    [...CABECERA, ...cabeceraExtra, ...delCrm.map((c) => c.titulo)],
    ...unicas.map(({ s, estado, clases, persona, extra }) => {
      const pais = persona?.pais ?? "";
      return [
        s.invitado || persona?.nombre || "",
        numeroParaCopiar(persona?.telefono, pais),
        s.email || persona?.email || "",
        pais,
        estado,
        clases.map((c) => NOMBRE_CLASE[c]).join(" · "),
        s.anfitrion ?? "",
        cuando(s.creadoEn),
        cuando(s.inicia),
        /* Una por columna de la pantalla, aunque la fila no traiga todas: si no, lo del CRM se correría de lugar. */
        ...cabeceraExtra.map((_, i) => extra?.[i] ?? ""),
        ...delCrm.map((c) => { const f = filaDelCrm(crm, s); return f ? c.celda(f) : ""; }),
      ];
    }),
  ];
  return { tabla, personas: unicas.length };
}

/** El archivo, con la marca que hace que Excel lea bien las tildes. */
export const csvDeDescarga = (tabla: string[][]) => `﻿${aCSV(tabla)}`;

/** Baja el CSV en el navegador. */
export function bajarCSV(nombre: string, tabla: string[][]) {
  const blob = new Blob([csvDeDescarga(tabla)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}
