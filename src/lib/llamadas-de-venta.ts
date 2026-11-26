import { esLlamadaDeResell } from "./resells";

/* ==================================================================
   Qué llamada de la agenda es una llamada de VENTA.

   A la agenda entran por Calendly tres cosas distintas: las llamadas de venta
   (el closer con un lead), las de resell (se cargan en su propia agenda,
   lib/resells.ts) y las sesiones 1 a 1 con el mentor. Estas últimas son un
   bono del contrato (Lili, 26/11: «un extra que tiene el alumno», con Yari,
   con Nahuel o con ella; el alumno trae un tema puntual): son de Servicio y
   quedan en la ficha del alumno (Servicio → Bonos), no son una oportunidad.

   Hasta el 26/11 las 1 a 1 contaban como una llamada más en el Dashboard y
   en las listas del closer. Con el link de Nahuel para todos los alumnos
   (181 sesiones incluidas en contratos contra ~300 agendas por mes) iban a
   inflar las agendas y a bajar el % de cierre. Puro y sin dependencias
   pesadas: lo usan el Dashboard, el CRM, el cierre del día y el servidor.
   ================================================================== */

/** Si una llamada de la agenda es una sesión 1 a 1 (los eventos «Sesión 1 a 1» de Yari y «Sesión 1 a 1 (Nahuel)»: Lili, 04/11 y 26/11).
    Entran solas a la ficha (supabase/sesiones-1a1-y-avisos-de-resell.sql, es_sesion_uno_a_uno: el mismo criterio). */
export function esSesionUnoAUno(s: { tipo?: string | null; titulo?: string | null }): boolean {
  const t = `${s.tipo ?? ""} ${s.titulo ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /(^|[^0-9])1\s*(a|:|-a-|-)\s*1([^0-9]|$)|uno a uno/.test(t);
}

/** Una llamada de venta: ni de resell ni una sesión 1 a 1 con el mentor. Las listas del closer (CRM, cierre del día, Mi panel, su % de
    cierre) y las del setter son de éstas. */
export const esLlamadaDeVenta = (s: { tipo?: string | null; titulo?: string | null; utm?: Record<string, string> | null }): boolean =>
  !esLlamadaDeResell(s) && !esSesionUnoAUno(s);
