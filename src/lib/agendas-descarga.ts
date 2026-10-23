import { esReagendar, NO_SE_PRESENTO, REPROGRAMO, type Desenlace } from "./estados";
import { numeroParaCopiar } from "./contacto-telefono";
import { aCSV } from "./exportarPlanilla";
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

/* De quién es la agenda: su persona si la tiene; si no, el mail; si no, el teléfono. */
const claveDe = ({ s, persona }: FilaDescarga) =>
  s.contactoId ?? (s.email ?? persona?.email ?? "").trim().toLowerCase();

/** La tabla de la descarga: una fila por persona (la agenda más reciente) y,
    al final, las columnas que sume cada pantalla. */
export function tablaDeDescarga(filas: FilaDescarga[], cabeceraExtra: string[] = []): { tabla: string[][]; personas: number } {
  const ultima = new Map<string, FilaDescarga>();
  const sinClave: FilaDescarga[] = [];
  for (const f of filas) {
    const k = claveDe(f);
    if (!k) { sinClave.push(f); continue; }
    const antes = ultima.get(k);
    if (!antes || Date.parse(f.s.creadoEn) >= Date.parse(antes.s.creadoEn)) ultima.set(k, f);
  }
  const unicas = [...ultima.values(), ...sinClave].sort((a, b) => Date.parse(b.s.inicia) - Date.parse(a.s.inicia));
  const tabla = [
    [...CABECERA, ...cabeceraExtra],
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
        ...(extra ?? []),
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
