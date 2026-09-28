import { CAMPO, type ClaveCampo, type Condicion, type Operador, type Orden } from "@/lib/crm";
import type { CampoOpcionesCrm } from "@/lib/types";
import { ALTOS, type AltoFila } from "./Grilla";
import type { AjusteVista } from "./useVistas";

/* ==================================================================
   Una vista del CRM dentro de un link.

   Las vistas son de cada uno (useVistas): un link con ?v=<id> sólo abre lo
   mismo si quien lo recibe tiene esa vista igual, y una vista propia ni
   siquiera existe en otro navegador. Por eso «Copiar link» mete la vista
   entera en ?compartida (filtros, orden, agrupar, columnas, anchos, color
   y alto), y quien lo abre la recibe como una vista propia nueva, con el
   mismo nombre. El mismo link abierto dos veces no la duplica.
   ================================================================== */

export type VistaEnLink = {
  nombre: string;
  filtros: Condicion[];
  conjuncion: "y" | "o";
  orden: Orden[];
  ocultos: ClaveCampo[];
} & Pick<AjusteVista, "columnas" | "anchos" | "alto" | "agrupar" | "color">;

const OPERADORES: readonly Operador[] = [
  "contiene", "no-contiene", "es", "no-es", "alguno", "ninguno", "todos", "vacio", "no-vacio", "periodo",
];
const CAMPOS_CON_OPCIONES: readonly CampoOpcionesCrm[] = ["preCall", "estadoLlamada", "estadoPreCall"];

const esCampo = (k: unknown): k is ClaveCampo => typeof k === "string" && (k === "lanzamiento" || k in CAMPO);
const esTexto = (x: unknown): x is string => typeof x === "string";

/* JSON → base64url, pasando por UTF-8: los nombres llevan tildes. */
function aBase64Url(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const vistaALink = (v: VistaEnLink): string => aBase64Url(JSON.stringify(v));

/* Lo que llega de un link se revisa campo por campo: un link viejo o
   escrito a mano no puede romper la grilla. Lo que no se entiende se
   descarta; si no queda nada que se entienda, es null. */
export function vistaDeLink(texto: string): VistaEnLink | null {
  let x: Record<string, unknown>;
  try {
    const leido: unknown = JSON.parse(deBase64Url(texto));
    if (!leido || typeof leido !== "object") return null;
    x = leido as Record<string, unknown>;
  } catch { return null; }

  const filtros: Condicion[] = (Array.isArray(x.filtros) ? x.filtros : []).flatMap((c: unknown) => {
    const k = c as Partial<Condicion>;
    if (!k || !esCampo(k.campo) || !OPERADORES.includes(k.op as Operador)) return [];
    const valor = Array.isArray(k.valor) ? k.valor.filter(esTexto) : esTexto(k.valor) ? k.valor : undefined;
    return [{ id: esTexto(k.id) ? k.id : `c-${Math.random().toString(36).slice(2, 8)}`, campo: k.campo, op: k.op as Operador, valor }];
  });
  const orden: Orden[] = (Array.isArray(x.orden) ? x.orden : []).flatMap((o: unknown) => {
    const k = o as Partial<Orden>;
    return k && esCampo(k.campo) ? [{ campo: k.campo, desc: Boolean(k.desc) }] : [];
  });
  const campos = (v: unknown): ClaveCampo[] | undefined => (Array.isArray(v) ? v.filter(esCampo) : undefined);
  const anchos: Record<string, number> | undefined = x.anchos && typeof x.anchos === "object"
    ? Object.fromEntries(Object.entries(x.anchos as Record<string, unknown>)
      .flatMap(([k, n]) => (esCampo(k) && typeof n === "number" && n > 0 ? [[k, n] as const] : [])))
    : undefined;

  return {
    nombre: esTexto(x.nombre) && x.nombre.trim() ? x.nombre.trim().slice(0, 80) : "Vista compartida",
    filtros,
    conjuncion: x.conjuncion === "o" ? "o" : "y",
    orden,
    ocultos: campos(x.ocultos) ?? [],
    columnas: campos(x.columnas),
    anchos,
    alto: esTexto(x.alto) && x.alto in ALTOS ? (x.alto as AltoFila) : undefined,
    agrupar: esCampo(x.agrupar) ? x.agrupar : null,
    color: CAMPOS_CON_OPCIONES.includes(x.color as CampoOpcionesCrm) ? (x.color as CampoOpcionesCrm) : null,
  };
}

/* El mismo link da el mismo id: abrirlo otra vez no suma otra vista. */
export function idDeVistaEnLink(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `link-${(h >>> 0).toString(36)}`;
}
