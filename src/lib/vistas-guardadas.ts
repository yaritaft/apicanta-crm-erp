/* ==================================================================
   Vistas guardadas, como en Notion: una pantalla con sus filtros, su
   orden, su período y sus columnas, con nombre, para volver con un clic.
   Cada una se guarda sólo para quien la armó o para todo el equipo.

   Una vista es el link de lo que se está viendo: los mismos parámetros
   que ya van en la URL (lib/useParamsURL.ts) más lo que suma cada
   pantalla al copiar el link, como las columnas (lib/compartirLink.ts).
   Por eso un link copiado y una vista abren exactamente lo mismo.

   - Las propias van con las preferencias del usuario (lib/preferencias).
   - Las del equipo, en la tabla `vistas` (supabase/vistas.sql): las ve
     quien entra a la app y las guarda quien ve todo (no las cuentas
     «sólo lo suyo», como el closer).

   Acá, lo que no depende del navegador; lo demás, en useVistasGuardadas.
   ================================================================== */

export interface VistaGuardada {
  id: string;
  nombre: string;
  /* La query de la pantalla, sin lo que no es de la vista y en orden. */
  consulta: string;
  deEquipo: boolean;
  /* El correo de quien la guardó (las del equipo). */
  creadoPor?: string;
  creadoEn: string;
}

/* La vista elegida va en el link: quien lo abre y la tiene, la ve marcada. */
export const PARAM_VISTA = "v";

/* Lo que es de un solo uso: una ficha abierta, un asistente por abrir, la
   vuelta del login o de conectar Meta. No es parte de lo que se mira, así
   que ni se recuerda (lib/recordarVistas.ts) ni entra en una vista. */
export const DE_UN_USO = new Set([
  "nuevo", "ver", "editar", "ficha", "vista", "venta", "registro", "persona", "anuncio", "compartida",
  "meta", "code", "error", "error_code", "error_description",
]);

const esDePagina = (k: string) => k === "pag" || k.startsWith("pag-");

/** La query como se guarda en una vista: sin la página, sin lo de un solo
    uso y sin la vista elegida, con las claves en orden para poder comparar.
    `extra` es lo que la pantalla suma al link (las columnas). */
export function consultaDeVista(query: string | URLSearchParams, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(typeof query === "string" ? query.replace(/^\?/, "") : query.toString());
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const pares = [...q.entries()]
    .filter(([k, v]) => v !== "" && k !== PARAM_VISTA && !esDePagina(k) && !DE_UN_USO.has(k))
    .sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
  return new URLSearchParams(pares).toString();
}

export const mismaConsulta = (a: string, b: string) => consultaDeVista(a) === consultaDeVista(b);

/** A dónde va la pantalla al abrir una vista. */
export function destinoDeVista(ruta: string, v: Pick<VistaGuardada, "id" | "consulta">): string {
  const q = new URLSearchParams(v.consulta);
  q.set(PARAM_VISTA, v.id);
  return `${ruta}?${q.toString()}`;
}

export const NOMBRE_MAXIMO = 60;

/** El nombre limpio, o por qué no sirve. */
export function nombreDeVista(nombre: string, otras: Pick<VistaGuardada, "id" | "nombre" | "deEquipo">[], deEquipo: boolean, salvo?: string): { nombre: string } | { error: string } {
  const n = nombre.trim().replace(/\s+/g, " ").slice(0, NOMBRE_MAXIMO);
  if (!n) return { error: "Ponele un nombre a la vista." };
  const igual = otras.find((v) => v.id !== salvo && v.deEquipo === deEquipo && v.nombre.toLocaleLowerCase("es") === n.toLocaleLowerCase("es"));
  if (igual) return { error: `Ya hay una vista «${igual.nombre}»${deEquipo ? " del equipo" : ""}. Elegí otro nombre o actualizá esa.` };
  return { nombre: n };
}

/** Las vistas propias tal cual se guardan en las preferencias. */
export function validarVistas(x: unknown): VistaGuardada[] | null {
  if (!Array.isArray(x)) return null;
  const out: VistaGuardada[] = [];
  for (const v of x as Record<string, unknown>[]) {
    if (!v || typeof v.id !== "string" || typeof v.nombre !== "string" || typeof v.consulta !== "string") continue;
    out.push({ id: v.id, nombre: v.nombre, consulta: v.consulta, deEquipo: false, creadoEn: typeof v.creadoEn === "string" ? v.creadoEn : "" });
  }
  return out;
}

/** Una fila de la tabla `vistas`. */
export function vistaDeEquipo(f: Record<string, unknown>): VistaGuardada | null {
  if (typeof f.id !== "string" || typeof f.nombre !== "string") return null;
  return {
    id: f.id, nombre: f.nombre, consulta: typeof f.consulta === "string" ? f.consulta : "", deEquipo: true,
    creadoPor: typeof f.creadoPor === "string" ? f.creadoPor : undefined,
    creadoEn: typeof f.creadoEn === "string" ? f.creadoEn : "",
  };
}

export const porNombre = (a: VistaGuardada, b: VistaGuardada) => a.nombre.localeCompare(b.nombre, "es", { numeric: true });
