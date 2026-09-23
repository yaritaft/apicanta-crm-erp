import type { MensajeChat, MuestraVivo } from "./youtube";

/* ==================================================================
   Las cuentas del vivo, a partir de las muestras minuto a minuto.

   Todo sale de "cuántos estaban mirando" en cada minuto, que es lo único
   que YouTube da durante un vivo. De ahí: el pico, cuánto se quedó la
   gente y qué pasó desde que arrancó el pitch. Lo que es aproximado se
   llama aproximado: no hay espectadores únicos, así que el tiempo medio
   por persona se estima con las vistas.
   ================================================================== */

export interface PuntoVivo {
  /* Minutos desde que arrancó el vivo */
  min: number;
  t: string;
  espectadores: number;
  chat: number;
}

export interface Momento { min: number; t: string; espectadores: number }

export interface Caida {
  desde: Momento;
  hasta: Momento;
  /* Gente que se fue en esa ventana */
  perdidos: number;
  /* Sobre los que había al principio de la ventana, 0…1 */
  proporcion: number;
}

export interface AnalisisPitch {
  enElPitch: Momento;
  /* Los que había a los 5, 10, 15 y 30 minutos del pitch (si llegó). */
  despues: { minutos: number; momento: Momento; retenidos: number }[];
  alFinal: Momento;
  /* Del pitch al final, 0…1 */
  retenidosAlFinal: number;
  /* Gente que se iba por minuto en los primeros 10 minutos del pitch, y
     antes del pitch (los 10 minutos previos): la comparación dice si el
     pitch aceleró la fuga. */
  fugaPorMinuto: number;
  fugaPorMinutoAntes?: number;
  /* Mensajes por minuto en el chat antes y durante el pitch */
  chatAntes: number;
  chatDurante: number;
}

export interface AnalisisVivo {
  puntos: PuntoVivo[];
  inicio: string;
  duracionMin: number;
  pico: Momento;
  promedio: number;
  /* Promedio sobre el pico, 0…1: qué tan llena estuvo la sala en promedio. */
  retencionMedia: number;
  /* Suma de espectadores × minuto: el tiempo de reproducción en vivo. */
  minutosVistos: number;
  /* Minutos vistos / vistas del video al terminar el vivo. Aproximado. */
  tiempoMedioMin?: number;
  vistasAlFinal?: number;
  /* Las tres ventanas de 5 minutos en que más gente se fue. */
  caidas: Caida[];
  mensajes: number;
  pitch?: AnalisisPitch;
}

const MIN = 60_000;

/* Dos muestras del mismo minuto pueden llegar corridas unos segundos: se
   cuenta en minutos enteros desde el inicio. */
const minutosEntre = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / MIN);

function momento(p: PuntoVivo): Momento {
  return { min: p.min, t: p.t, espectadores: p.espectadores };
}

/* El punto que estaba vigente en ese minuto: el último que no lo pasa. */
function enMinuto(puntos: PuntoVivo[], min: number): PuntoVivo | undefined {
  let elegido: PuntoVivo | undefined;
  for (const p of puntos) {
    if (p.min <= min) elegido = p;
    else break;
  }
  return elegido;
}

export function analizarVivo(
  muestras: MuestraVivo[], chat: MensajeChat[], opciones: { inicio?: string; pitchEn?: string | null } = {},
): AnalisisVivo | null {
  const conDato = muestras
    .filter((m) => m.enVivo && m.espectadores !== undefined)
    .sort((a, b) => +new Date(a.t) - +new Date(b.t));
  if (conDato.length === 0) return null;

  /* El inicio real lo da YouTube; si no está, la primera muestra. */
  const inicio = opciones.inicio && +new Date(opciones.inicio) <= +new Date(conDato[0].t)
    ? opciones.inicio
    : conDato[0].t;

  const chatPorMinuto = new Map<number, number>();
  for (const m of chat) {
    const k = Math.floor((+new Date(m.t) - +new Date(inicio)) / MIN);
    if (k >= 0) chatPorMinuto.set(k, (chatPorMinuto.get(k) ?? 0) + 1);
  }

  const puntos: PuntoVivo[] = conDato.map((m) => {
    const min = minutosEntre(inicio, m.t);
    return { min, t: m.t, espectadores: m.espectadores ?? 0, chat: chatPorMinuto.get(min) ?? 0 };
  });

  let pico = puntos[0];
  for (const p of puntos) if (p.espectadores > pico.espectadores) pico = p;

  const promedio = puntos.reduce((s, p) => s + p.espectadores, 0) / puntos.length;

  /* Cada muestra vale por los minutos hasta la siguiente. Un hueco largo
     (el cron no corrió) no se rellena con más de 5 minutos. */
  let minutosVistos = 0;
  for (let i = 0; i < puntos.length; i++) {
    const hasta = puntos[i + 1]?.min ?? puntos[i].min + 1;
    minutosVistos += puntos[i].espectadores * Math.min(5, Math.max(1, hasta - puntos[i].min));
  }

  const ultimaConVistas = [...conDato].reverse().find((m) => m.vistas !== undefined);
  const vistasAlFinal = ultimaConVistas?.vistas;
  const tiempoMedioMin = vistasAlFinal ? minutosVistos / vistasAlFinal : undefined;

  /* Las caídas: ventanas de 5 minutos, sin pisarse, de la más grande a la
     más chica. Después del pico: antes, la sala se está llenando. */
  const candidatas: Caida[] = [];
  for (const p of puntos) {
    if (p.min < pico.min) continue;
    const q = enMinuto(puntos, p.min + 5);
    if (!q || q.min <= p.min || p.espectadores === 0) continue;
    const perdidos = p.espectadores - q.espectadores;
    if (perdidos > 0) candidatas.push({ desde: momento(p), hasta: momento(q), perdidos, proporcion: perdidos / p.espectadores });
  }
  candidatas.sort((a, b) => b.perdidos - a.perdidos);
  const caidas: Caida[] = [];
  for (const c of candidatas) {
    if (caidas.some((x) => c.desde.min < x.hasta.min && x.desde.min < c.hasta.min)) continue;
    caidas.push(c);
    if (caidas.length === 3) break;
  }
  caidas.sort((a, b) => a.desde.min - b.desde.min);

  const ultimo = puntos[puntos.length - 1];
  const mensajes = chat.length;

  let pitch: AnalisisPitch | undefined;
  if (opciones.pitchEn) {
    const minPitch = minutosEntre(inicio, opciones.pitchEn);
    const p0 = enMinuto(puntos, minPitch) ?? puntos[0];
    if (minPitch <= ultimo.min && p0.espectadores > 0) {
      const despues = [5, 10, 15, 30]
        .filter((d) => minPitch + d <= ultimo.min)
        .map((d) => {
          const q = enMinuto(puntos, minPitch + d) ?? p0;
          return { minutos: d, momento: momento(q), retenidos: q.espectadores / p0.espectadores };
        });
      const a10 = enMinuto(puntos, Math.min(minPitch + 10, ultimo.min)) ?? ultimo;
      const tramo = Math.max(1, a10.min - p0.min);
      const antes = minPitch >= 10 ? enMinuto(puntos, minPitch - 10) : undefined;

      const porMinuto = (desde: number, hasta: number) => {
        const largo = Math.max(1, hasta - desde);
        let n = 0;
        for (const [k, v] of chatPorMinuto) if (k >= desde && k < hasta) n += v;
        return n / largo;
      };

      pitch = {
        enElPitch: momento(p0),
        despues,
        alFinal: momento(ultimo),
        retenidosAlFinal: ultimo.espectadores / p0.espectadores,
        fugaPorMinuto: (p0.espectadores - a10.espectadores) / tramo,
        fugaPorMinutoAntes: antes && antes.min < p0.min
          ? (antes.espectadores - p0.espectadores) / (p0.min - antes.min)
          : undefined,
        chatAntes: porMinuto(Math.max(0, minPitch - 15), minPitch),
        chatDurante: porMinuto(minPitch, Math.min(ultimo.min + 1, minPitch + 15)),
      };
    }
  }

  return {
    puntos,
    inicio,
    duracionMin: ultimo.min,
    pico: momento(pico),
    promedio,
    retencionMedia: pico.espectadores > 0 ? promedio / pico.espectadores : 0,
    minutosVistos,
    tiempoMedioMin,
    vistasAlFinal,
    caidas,
    mensajes,
    pitch,
  };
}

/* "1:05" para el minuto 65 del vivo; "min 12" para los cortos. */
export function minutoLegible(min: number): string {
  if (min < 60) return `min ${min}`;
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
}

/* ---------- Quién es quién ----------

   Los nombres de YouTube son los que la gente eligió ("Juan Pérez",
   "juanchi_dev"). Se cruzan con los de la base sólo si son nombre y
   apellido y coinciden enteros, sin tildes ni mayúsculas: "Juan" solo
   coincidiría con media base. */

export function normalizarNombre(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/^@/, "").replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function nombreCruzable(s: string | undefined | null): string | null {
  const n = normalizarNombre(s);
  return n.split(" ").filter((p) => p.length >= 2).length >= 2 ? n : null;
}

/* ---------- Ejemplo ----------

   Una curva inventada con la forma típica de un vivo de venta: la sala se
   llena los primeros 15 minutos, se sostiene, y al pitch cae. Sólo para
   mostrar cómo va a quedar antes de que haya un vivo registrado; la
   pantalla la marca como ejemplo. Sale de una semilla: siempre la misma. */
export function vivoDeEjemplo(semilla: string, inicioIso: string): { muestras: MuestraVivo[]; chat: MensajeChat[]; pitchEn: string } {
  let h = 0;
  for (const c of semilla) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => { h = (h * 1103515245 + 12345) >>> 0; return (h % 1000) / 1000; };
  const inicio = +new Date(inicioIso);
  const pico = 380 + Math.round(rand() * 400);
  const minPitch = 58 + Math.round(rand() * 12);
  const largo = minPitch + 42;
  const muestras: MuestraVivo[] = [];
  const chat: MensajeChat[] = [];
  let vistas = 0;
  for (let m = 0; m <= largo; m++) {
    let base: number;
    if (m < 15) base = pico * (0.25 + 0.75 * (m / 15));
    else if (m < minPitch) base = pico * (1 - 0.18 * ((m - 15) / (minPitch - 15)));
    else base = pico * 0.82 * Math.exp(-(m - minPitch) / 26);
    const esp = Math.max(0, Math.round(base * (0.96 + rand() * 0.08)));
    vistas += Math.round(esp * 0.06);
    muestras.push({ t: new Date(inicio + m * MIN).toISOString(), enVivo: true, espectadores: esp, vistas: Math.round(pico * 1.4) + vistas });
    const n = Math.round((m < minPitch ? 3 : 6) * rand());
    for (let i = 0; i < n; i++) {
      chat.push({ id: `ej_${m}_${i}`, t: new Date(inicio + m * MIN + i * 7000).toISOString(), autor: "Ejemplo", texto: "" });
    }
  }
  return { muestras, chat, pitchEn: new Date(inicio + minPitch * MIN).toISOString() };
}
