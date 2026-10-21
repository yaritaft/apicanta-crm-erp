/* El día que se estaba mirando en «Mis llamadas» (sin dependencias de la app: lo usa lib/recordarVistas.ts y las pruebas). */

/* Con una excepción: si el closer eligió OTRO día en «Mis llamadas» hace poco, al volver a la pantalla (por el menú, un favorito o
   después de irse sin querer con el gesto de «atrás» del trackpad) sigue en ese día. Mariano (21/10): «cuando vuelvo al sitio no me
   vuelve donde había dejado, tengo que marcar nuevamente el día que estaba operando». Vale unas horas: pasado ese tiempo, o si vuelve
   a «Hoy» él mismo, abre en lo de hoy como siempre. Se guarda aparte de las demás vistas. */
const CLAVE_DIA = "apicanta.dia.mis-llamadas";
export const VIGENCIA_DIA = 12 * 60 * 60 * 1000;
export const PARAMS_DIA = ["periodo", "desde", "hasta"];

export function guardarDia(q: URLSearchParams, ahora = Date.now()) {
  try {
    const p = new URLSearchParams();
    for (const k of PARAMS_DIA) { const v = q.get(k); if (v) p.set(k, v); }
    localStorage.setItem(CLAVE_DIA, JSON.stringify({ q: p.toString(), t: ahora }));
  } catch { /* modo privado */ }
}
export function olvidarDia() { try { localStorage.removeItem(CLAVE_DIA); } catch { /* modo privado */ } }
/** El día que se estaba mirando, como query, si fue hace poco. */
export function diaGuardado(ahora = Date.now()): string | null {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE_DIA) ?? "null");
    return x && typeof x.q === "string" && x.q && ahora - Number(x.t) < VIGENCIA_DIA ? x.q : null;
  } catch { return null; }
}
