import React from "react";
import { sinTildes } from "@/lib/crm";

/* Las pastillas de las listas de Customer Success (stack, acceso, follow-up, contrato, reporte…): el color sale de lo que
   dice el valor, así sirve también para una opción que se agregó en Ajustes. */

export type TonoPastilla = "ok" | "aviso" | "malo" | "info" | "neutra";

const MALO = /(no avanzando|no contesta|sin acceso|inactivo|\bbaja\b|no quiso|no renueva|no quiere|rechazad|cancelad)/;
const AVISO = /(pendiente|falta|atrasad|pausad|downsell|no agendada|lo piensa|sin definir|no se present|^seguimiento$|garantia extendida|outbording)/;
const OK = /(corregido|firmado|al dia|completos|avanzando|subido a youtube|activo|renueva|publicad|upgrade|vigente)/;
const INFO = /(enviado|subido a drive|egresado|agendada|agendado|onboarding|2da agenda)/;

export function tonoDe(valor: string): TonoPastilla {
  const t = sinTildes(valor);
  if (!t) return "neutra";
  if (MALO.test(t)) return "malo";
  if (AVISO.test(t)) return "aviso";
  if (OK.test(t)) return "ok";
  if (INFO.test(t)) return "info";
  return "neutra";
}

/** El color de un estado de resell (Lili, 19/11: «se me marean los colores»). Una sola regla: Upgrade (y Renueva) en verde, lo que sale del
    programa (Outbording, no quiere renovar o grabar) en rojo y todo lo demás —2da Agenda, Seguimiento, Alumno activo, Reservó, Garantía…— en amarillo. */
export function tonoDeResell(valor: string): TonoPastilla {
  const t = sinTildes(valor).trim();
  if (!t) return "neutra";
  if (/(outbo+a?rding|no quiere|no quiso|no renueva)/.test(t)) return "malo";
  if (/(upgrade|^renueva$)/.test(t)) return "ok";
  return "aviso";
}

export function Pastilla({ texto, tono, tenue, title }: { texto: string; tono?: TonoPastilla; tenue?: boolean; title?: string }) {
  if (!texto) return <span className="t-subtle">—</span>;
  const t = tono ?? tonoDe(texto);
  return <span className={`cs-pastilla cs-pastilla--${t}${tenue ? " cs-sugerido" : ""}`} title={title ?? texto}>{texto}</span>;
}
