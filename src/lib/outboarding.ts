/* ==================================================================
   El outboarding automático (Lili, 26/10: «¿cómo se hace el outboarding
   automático, que le quite el acceso a Wisboo, Zoom y Telegram?»).

   Cuando el Follow Up de un alumno dice «Outboarding» (lo pone Lili en la
   ficha o en Clientes, o con «No renueva»), la app le saca los accesos que dio
   ella (los cursos de Wisboo, los grupos de Telegram y las reuniones de Zoom)
   el día después de que termina su programa. Si ya terminó, o no se sabe
   cuándo termina, en la próxima pasada. «No renueva» se toca hasta 30 días
   antes del fin: así nadie pierde días que pagó. Volver el Follow Up a otra
   cosa antes de ese día lo cancela.

   Lo corre la pasada de cada hora (api/cron/contratos →
   lib/outboarding-servidor.ts); la ficha lo muestra con la misma cuenta.
   ================================================================== */

import { sinTildes } from "./crm";
import { sumarDias } from "./seguimiento";

/** El Follow Up de outboarding: «OUTBOARDING», «Outboarding», «Outbording» (como venía del Airtable). «Caso de éxito» no. */
export function esOutboarding(followUp: string | null | undefined): boolean {
  const f = sinTildes(String(followUp ?? "")).trim().toLowerCase();
  return f.startsWith("outboarding") || f.startsWith("outbording");
}

/** El día en que se le sacan los accesos: el siguiente al fin del programa, o hoy si ya pasó o no se sabe. */
export function diaDelOutboarding(fin: string | null | undefined, hoy: string): string {
  if (!fin) return hoy;
  const despues = sumarDias(fin.slice(0, 10), 1);
  return despues > hoy ? despues : hoy;
}

/** Si hoy le toca: está en outboarding y ya terminó su programa (o no se sabe cuándo termina). */
export const tocaOutboarding = (followUp: string | null | undefined, fin: string | null | undefined, hoy: string): boolean =>
  esOutboarding(followUp) && diaDelOutboarding(fin, hoy) <= hoy;
