/* ==================================================================
   Las llamadas de equipo de Fathom (F2-04, reunión del 02/10).

   Yari: «tiene My Calls y Team Calls; las que hay que usar son las Team
   Calls… poné el equipo de ventas». La API de Fathom no tiene un endpoint
   aparte: GET /meetings devuelve lo que la cuenta dueña de la clave puede
   ver y acepta `teams[]=<nombre del equipo>` para acotar; GET /teams lista
   los equipos. «Traer lo anterior» pasa entonces dos veces: primero por
   todo lo que la clave ve y después, una vez por cada equipo de ventas, por
   las llamadas de ese equipo. Lo que ya llegó no se vuelve a contar.

   Acá, lo que no toca la red: qué equipos son de ventas y cómo la pantalla
   sigue de una pasada a la otra (el «cursor» que va y viene es opaco para
   ella).
   ================================================================== */

import { miembroDeCloser } from "./crm";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Los nombres de los equipos de un GET /teams (items con `name`). */
export function leerEquipos(items: unknown[]): string[] {
  const nombres: string[] = [];
  for (const x of items) {
    const n = x && typeof x === "object" ? (x as { name?: unknown }).name : undefined;
    if (typeof n === "string" && n.trim() && !nombres.includes(n.trim())) nombres.push(n.trim());
  }
  return nombres;
}

/** Si el nombre de un equipo de Fathom parece el de ventas: «Sales»,
    «Equipo de ventas», «Closers». */
export function esEquipoDeVentas(nombre: string): boolean {
  return /\b(sales?|ventas?|closers?|comercial(es)?)\b/.test(sinTildes(nombre));
}

/** Los equipos por los que se pide: los que dice FATHOM_EQUIPOS en Vercel
    (separados por coma; se piden aunque Fathom no los liste, por si /teams
    no los muestra) y, si no dice nada, los de `todos` que parecen de ventas. */
export function equiposDeVentas(todos: string[], configurados?: string | null): string[] {
  const dichos = (configurados ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const lista = dichos.length ? dichos : todos.filter(esEquipoDeVentas);
  return lista.filter((n, i) => lista.findIndex((m) => sinTildes(m) === sinTildes(n)) === i);
}

/* ---------- la pasada de «Traer lo anterior» ---------- */

/** Dónde está «Traer lo anterior»: `i` = -1 es la pasada por todo lo que la
    clave ve; de 0 en adelante, el equipo `e[i]`. `c` es el cursor de la
    página siguiente de Fathom en esa pasada. `e` no está hasta que termina
    la pasada general. */
export interface Pasada { e?: string[]; i: number; c: string | null }

export const PRIMERA_PASADA: Pasada = { i: -1, c: null };

/** El cursor que ve la pantalla (opaco) como una pasada; sin cursor, o con
    uno que no se entiende, es la primera. */
export function leerPasada(cursor: string | null | undefined): Pasada {
  if (!cursor) return PRIMERA_PASADA;
  try {
    const p = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<Pasada>;
    const e = Array.isArray(p.e) ? p.e.filter((x): x is string => typeof x === "string") : undefined;
    const i = typeof p.i === "number" && Number.isInteger(p.i) ? p.i : -1;
    if (i >= 0 && (!e || i >= e.length)) return PRIMERA_PASADA;
    const c = typeof p.c === "string" && p.c ? p.c : null;
    return e ? { e, i, c } : { i, c };
  } catch { return PRIMERA_PASADA; }
}

export const escribirPasada = (p: Pasada): string => Buffer.from(JSON.stringify(p), "utf8").toString("base64url");

/** El equipo que se pide en esa pasada (null = todo lo que la clave ve). */
export const equipoDeLaPasada = (p: Pasada): string | null => (p.i >= 0 ? p.e?.[p.i] ?? null : null);

/** Qué sigue después de una página: la página siguiente de Fathom en la
    misma pasada; si no hay, la pasada del próximo equipo; y al final, nada
    (null). `deVentas` son los equipos de ventas, que se averiguan recién
    cuando termina la pasada general (una sola vez por «Traer lo anterior»). */
export function seguir(p: Pasada, siguienteDeFathom: string | null, deVentas: () => Promise<string[]>): Promise<Pasada | null> {
  if (siguienteDeFathom) return Promise.resolve({ ...p, c: siguienteDeFathom });
  if (p.i < 0) {
    return deVentas().then((e) => (e.length ? { e, i: 0, c: null } : null));
  }
  const e = p.e ?? [];
  return Promise.resolve(p.i + 1 < e.length ? { e, i: p.i + 1, c: null } : null);
}

/** Si una reunión de Fathom la grabó ese closer: por su mail de Equipo o,
    si grabó con otra cuenta, por su nombre. Para el cierre del día, cuando
    buscar por el mail no encuentra nada y se mira entre las del equipo de
    ventas (sólo las de él: las de los demás no se listan). */
export function grabadaPor(item: unknown, correo: string, nombreDelCloser: string): boolean {
  const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const m = (o.meeting && typeof o.meeting === "object" ? o.meeting : o) as Record<string, unknown>;
  const quien = (m.recorded_by && typeof m.recorded_by === "object" ? m.recorded_by : {}) as { email?: unknown; name?: unknown };
  const email = typeof quien.email === "string" ? quien.email.trim().toLowerCase() : "";
  if (email && correo && email === correo.trim().toLowerCase()) return true;
  return typeof quien.name === "string" && Boolean(quien.name.trim()) && Boolean(miembroDeCloser(quien.name, [{ nombre: nombreDelCloser }]));
}
