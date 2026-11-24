import type { ProveedorPasarela } from "./types";

/* ==================================================================
   Cuándo se le preguntó por última vez a cada pasarela y qué contestó
   (tabla `pasarelas_estado`, supabase/pasarelas-estado.sql).

   Por qué existe (Aldana, 24/11: «se volvió a desconectar Whop»): Whop no
   estaba desconectado. El cron de cada hora había traído a las 16:00 los
   cobros de las 15:39–15:53, pero la pantalla tenía la lista de cuando se
   abrió y decía «Último cobro recibido de Whop: 21 nov» (el fin de semana
   no hubo ventas por Whop). Sin saber cuándo se revisó, «el último cobro es
   viejo» y «Whop no anda» se ven igual, y el equipo carga los pagos a mano.

   Ahora:
   · Whop y Hotmart (que no avisan por webhook) se revisan cada 5 minutos
     (api/cron/cobros-al-dia), además del cron de cada hora.
   · Cada revisión deja acá cuándo fue y si falló.
   · El selector de pagos dice «Whop al día · revisado hace 2 min» (verde),
     «sin revisar desde…» (ámbar) o «no responde desde…» (rojo), trae lo
     nuevo de la base al abrirse y tiene «Buscar pagos nuevos».
   · Si una pasarela falla seguido más de una hora, les llega un aviso a
     los dueños por la campanita: una caída de verdad se sabe antes de que
     la note Finanzas.
   ================================================================== */

export interface EstadoPasarela {
  proveedor: ProveedorPasarela;
  revisadoEn: string;
  okEn?: string | null;
  error?: string | null;
  errorDesde?: string | null;
  ultimoCobro?: string | null;
  nuevos?: number;
  fuente?: string | null;
}

/** Las que no mandan aviso por webhook y por eso se revisan cada 5 minutos (las demás, con el cron de cada hora; Stripe avisa al instante). */
export const PASARELAS_RAPIDAS: ProveedorPasarela[] = ["whop", "hotmart"];

/** Las que se pueden revisar a pedido desde el selector de pagos: sólo traen cobros (Mercury también trae pases entre cuentas y
 *  anulaciones, que van por el cron completo o por «Buscar en las cuentas» de la Caja). */
export const PASARELAS_A_PEDIDO: ProveedorPasarela[] = ["whop", "hotmart", "stripe", "dlocal", "mercadopago"];

/** Cuánto puede pasar sin revisar antes de que se vea en ámbar: el cron rápido corre cada 5 minutos y el completo cada hora. */
export const minutosDeMargen = (p: ProveedorPasarela): number => (PASARELAS_RAPIDAS.includes(p) ? 20 : 90);

/** Fallando seguido más de esto, se les avisa a los dueños (un aviso por pasarela y por día). */
export const MINUTOS_PARA_AVISAR = 60;

/** A pedido, no más de una vez cada tanto: si recién se revisó, se contesta con eso (dos personas tocando el botón no le pegan dos veces). */
export const SEGUNDOS_ENTRE_PEDIDOS = 20;

export interface Revision {
  ok: boolean;
  error?: string;
  /** La fecha del cobro más nuevo que trajo esta revisión (si trajo alguno). */
  ultimoCobro?: string;
  nuevos?: number;
  fuente: "cron" | "rapido" | "pantalla" | "webhook";
}

const masNuevo = (a?: string | null, b?: string | null): string | null => {
  const ta = Date.parse(a ?? ""), tb = Date.parse(b ?? "");
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? new Date(tb).toISOString() : null;
  if (!Number.isFinite(tb)) return new Date(ta).toISOString();
  return new Date(Math.max(ta, tb)).toISOString();
};

/** La fila que queda después de una revisión. Si falla, se guarda desde cuándo falla seguido (no se pisa con cada intento); si anda,
 *  se borra el error. El último cobro nunca retrocede: una revisión de 3 días no borra lo que trajo la de 60. */
export function siguienteEstado(previo: EstadoPasarela | null, proveedor: ProveedorPasarela, r: Revision, ahora: number): EstadoPasarela {
  const cuando = new Date(ahora).toISOString();
  const ultimoCobro = masNuevo(previo?.ultimoCobro, r.ultimoCobro);
  if (r.ok) {
    return { proveedor, revisadoEn: cuando, okEn: cuando, error: null, errorDesde: null, ultimoCobro, nuevos: r.nuevos ?? 0, fuente: r.fuente };
  }
  return {
    proveedor, revisadoEn: cuando, okEn: previo?.okEn ?? null,
    error: (r.error || "Error desconocido.").slice(0, 500),
    errorDesde: previo?.error && previo.errorDesde ? previo.errorDesde : cuando,
    ultimoCobro, nuevos: 0, fuente: r.fuente,
  };
}

export type Tono = "ok" | "atrasada" | "error";

/** Hora argentina (UTC−3) de una fecha, para los textos que arma el servidor (el navegador ya está en hora argentina). */
export function horaArgentina(iso: string): string {
  const d = new Date(Date.parse(iso) - 3 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const minutos = (desde: string, ahora: number) => Math.max(0, Math.round((ahora - Date.parse(desde)) / 60_000));
const hace = (min: number) => (min < 1 ? "recién" : min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`);

/** Cómo está una pasarela para quien busca un pago: verde si se revisó hace poco y anduvo, ámbar si hace rato que no se revisa
 *  (el cron no corrió), rojo si la última vez falló. Sin fila (nunca se anotó), no se dice nada. */
export function comoEsta(est: EstadoPasarela | null | undefined, nombre: string, ahora: number): { tono: Tono; texto: string; detalle?: string } | null {
  if (!est?.revisadoEn || !Number.isFinite(Date.parse(est.revisadoEn))) return null;
  if (est.error) {
    const desde = est.errorDesde ?? est.revisadoEn;
    return {
      tono: "error",
      texto: `${nombre} no responde desde las ${horaArgentina(desde)} (${hace(minutos(desde, ahora))}): los pagos nuevos no están entrando.`,
      detalle: est.error,
    };
  }
  const min = minutos(est.revisadoEn, ahora);
  if (min > minutosDeMargen(est.proveedor)) {
    return { tono: "atrasada", texto: `${nombre} no se revisa desde las ${horaArgentina(est.revisadoEn)} (${hace(min)}). Tocá «Buscar pagos nuevos».` };
  }
  return { tono: "ok", texto: `${nombre} al día · revisado ${hace(min)}` };
}

/** Fallando seguido hace más de una hora: hay que avisar. Un tropiezo suelto (un 502, un 429) se arregla en la vuelta siguiente. */
export function hayQueAvisar(est: EstadoPasarela, ahora: number): boolean {
  if (!est.error || !est.errorDesde) return false;
  const t = Date.parse(est.errorDesde);
  return Number.isFinite(t) && ahora - t >= MINUTOS_PARA_AVISAR * 60_000;
}

export interface AvisoDePasarela {
  id: string; para: string; tipo: "pasarela"; titulo: string; cuerpo: string; de: string; contactoId: null; persona: null;
}

/** El aviso a los dueños cuando una pasarela no anda: uno por pasarela, por persona y por día (el id repetido no se vuelve a insertar). */
export function avisosDeCaida(est: EstadoPasarela, nombre: string, duenos: string[], dia: string, hash: (s: string) => string): AvisoDePasarela[] {
  if (!est.error) return [];
  const desde = est.errorDesde ?? est.revisadoEn;
  const titulo = `${nombre} no está trayendo los cobros`;
  const cuerpo = `Falla desde las ${horaArgentina(desde)}: ${est.error.slice(0, 220)} Mientras tanto los pagos de ${nombre} no aparecen para conciliar y el equipo los va a tener que cargar a mano. Si dice que no acepta la clave, hay que generar una nueva en ${nombre} y cargarla en Vercel.`;
  return [...new Set(duenos.map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@")))].map((mail) => ({
    id: `av_pasarela_${est.proveedor}_${dia}_${hash(mail)}`, para: mail, tipo: "pasarela" as const, de: nombre, contactoId: null, persona: null, titulo, cuerpo,
  }));
}
