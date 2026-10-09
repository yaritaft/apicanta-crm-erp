import { hayFiltro, MAX_ORDENES, partirValores, seVe, unirValores, VACIAS, type FiltroColumna } from "./crm-tabla";
import { sinTildes } from "./crm";

/* ==================================================================
   El motor de las tablas de Customer Success (Clientes, Testimonios y Resells).

   Es el mismo de la tabla del CRM (lib/crm-tabla.ts) pero para cualquier tabla:
   una lista de columnas, cada una con los valores por los que se filtra, y
   todo lo demás sale de ahí: tildar los valores que se quieren ver, filtrar
   por un texto o entre dos fechas, ordenar por una o por varias columnas, y
   que todo viaje en el link. Se reutilizan las piezas del CRM que no dependen
   de sus columnas (el filtro, cómo se escapan los valores) y se escribe acá lo
   que sí dependía de ellas.

   Cada tabla tiene su `ns` (clientes: «cli», testimonios: «tes», resells:
   «res») para no pisar los parámetros de las demás: las tres viven en la
   misma pantalla (Alumnos) y un filtro de País de una no tiene que aparecer,
   escondido, en la otra.
     ?solo-cli_pais=Argentina|México   ?con-cli_comentarios=cuotas
     ?desde-cli_inicio=2026-09-01      ?orden-cli=-inicio,nombre
   ================================================================== */

export interface ColumnaCs<F, K extends string = string> {
  clave: K;
  titulo: string;
  /* En qué apartado del selector de columnas va. */
  grupo: string;
  /* Los valores por los que se filtra (una lista: una fila con varios programas aparece tildando cualquiera). */
  valores: (f: F) => string[];
  /* Cómo se ordena; si falta, por el primer valor. */
  orden?: (f: F) => string | number;
  /* Lo que mira «contiene», si no son los valores del filtro. */
  texto?: (f: F) => string;
  /* Los valores son días (aaaa-mm-dd): se filtra desde y hasta. */
  fecha?: boolean;
  /* Se ordena por un número, «de menor a mayor». */
  numerica?: boolean;
  ancho?: number;
  /* Qué dice la ayuda del título. */
  ayuda?: string;
}

export interface OrdenCs<K extends string = string> { clave: K; desc: boolean }
export type FiltrosCs<K extends string = string> = Partial<Record<K, FiltroColumna>>;

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
export const uno = (x: string | null | undefined): string[] => [x && x.trim() ? x : VACIAS];
export const varios = (xs: readonly string[]): string[] => (xs.length ? [...xs] : [VACIAS]);

export interface Motor<F, K extends string> {
  ns: string;
  columnas: ColumnaCs<F, K>[];
  columna: Record<K, ColumnaCs<F, K>>;
  esColumna: (k: string) => k is K;
  pasaFiltros: (f: F, filtros: FiltrosCs<K>, salvo?: K) => boolean;
  filtrosDeURL: (params: URLSearchParams) => FiltrosCs<K>;
  filtroAURL: (clave: K, fc: FiltroColumna | null) => Record<string, string | null>;
  opcionesDeColumna: (filas: F[], filtros: FiltrosCs<K>, clave: K, orden?: string[]) => { valor: string; cuenta: number }[];
  ordenesDeURL: (valor: string | null | undefined, porDefecto: OrdenCs<K>[]) => OrdenCs<K>[];
  ordenesAURL: (os: OrdenCs<K>[], porDefecto: OrdenCs<K>[]) => string | null;
  ordenarFilas: (filas: F[], ordenes: OrdenCs<K>[], ordenValores?: Partial<Record<K, string[]>>) => F[];
  textoDeColumna: (f: F, col: ColumnaCs<F, K>) => string;
  /* Los nombres de los parámetros del link. */
  paramOrden: string;
  paramBusqueda: string;
  paramPagina: string;
  paramColumnas: string;
}

export function crearMotor<F, K extends string>(columnas: ColumnaCs<F, K>[], ns: string): Motor<F, K> {
  const columna = Object.fromEntries(columnas.map((c) => [c.clave, c])) as Record<K, ColumnaCs<F, K>>;
  /* hasOwnProperty: «constructor» o «__proto__» en un link no son columnas. */
  const esColumna = (k: string): k is K => Object.prototype.hasOwnProperty.call(columna, k);
  const prefijo = `${ns}_`;
  const param = (modo: string, clave: string) => `${modo}-${prefijo}${clave}`;

  const textoDeColumna = (f: F, col: ColumnaCs<F, K>) =>
    col.texto ? col.texto(f) : col.valores(f).filter((v) => v !== VACIAS).join(", ");

  function pasaFiltros(f: F, filtros: FiltrosCs<K>, salvo?: K): boolean {
    for (const [k, fc] of Object.entries(filtros) as [K, FiltroColumna][]) {
      if (k === salvo || !hayFiltro(fc) || !esColumna(k)) continue;
      const col = columna[k];
      const valores = col.valores(f);
      /* Una fila con varios valores (programas) se ve si alguno se ve. */
      if (!valores.some((v) => seVe(v, fc))) return false;
      if (fc.contiene || fc.noContiene) {
        const t = sinTildes(textoDeColumna(f, col));
        if (fc.contiene && !t.includes(sinTildes(fc.contiene))) return false;
        if (fc.noContiene && t.includes(sinTildes(fc.noContiene))) return false;
      }
      if (fc.desde || fc.hasta) {
        /* Sin fecha no entra en ningún período. */
        const d = valores[0];
        if (!ES_DIA.test(d) || (fc.desde && d < fc.desde) || (fc.hasta && d > fc.hasta)) return false;
      }
    }
    return true;
  }

  function filtrosDeURL(params: URLSearchParams): FiltrosCs<K> {
    const out: FiltrosCs<K> = {};
    const de = (clave: K) => (out[clave] ??= { modo: "solo", valores: [] });
    const re = new RegExp(`^(solo|sin|con|nocon|desde|hasta)-${prefijo}(.+)$`);
    for (const [k, v] of params.entries()) {
      const m = re.exec(k);
      if (!m || !esColumna(m[2]) || !v) continue;
      const clave = m[2] as K;
      if (m[1] === "solo" || m[1] === "sin") {
        const valores = partirValores(v);
        if (valores.length) Object.assign(de(clave), { modo: m[1], valores });
      } else if (m[1] === "con") de(clave).contiene = v;
      else if (m[1] === "nocon") de(clave).noContiene = v;
      else if (ES_DIA.test(v) && columna[clave].fecha) de(clave)[m[1] as "desde" | "hasta"] = v;
    }
    for (const k of Object.keys(out) as K[]) if (!hayFiltro(out[k])) delete out[k];
    return out;
  }

  const filtroAURL = (clave: K, fc: FiltroColumna | null): Record<string, string | null> => ({
    [param("solo", clave)]: fc?.modo === "solo" && fc.valores.length ? unirValores(fc.valores) : null,
    [param("sin", clave)]: fc?.modo === "sin" && fc.valores.length ? unirValores(fc.valores) : null,
    [param("con", clave)]: fc?.contiene?.trim() || null,
    [param("nocon", clave)]: fc?.noContiene?.trim() || null,
    [param("desde", clave)]: fc?.desde || null,
    [param("hasta", clave)]: fc?.hasta || null,
  });

  /* Los valores de una columna para su filtro, con cuántas filas tiene cada uno según los DEMÁS filtros (como en
     Excel: lo que ya está filtrado en otra columna no aparece). */
  function opcionesDeColumna(filas: F[], filtros: FiltrosCs<K>, clave: K, orden?: string[]) {
    const col = columna[clave];
    const cuenta = new Map<string, number>();
    for (const f of filas) {
      if (!pasaFiltros(f, filtros, clave)) continue;
      for (const v of new Set(col.valores(f))) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
    }
    /* Lo elegido sigue en la lista aunque no quede ninguna fila con eso. */
    for (const v of filtros[clave]?.valores ?? []) if (!cuenta.has(v)) cuenta.set(v, 0);
    return [...cuenta.entries()]
      .map(([valor, n]) => ({ valor, cuenta: n }))
      .sort((a, b) => {
        if (a.valor === VACIAS) return 1;
        if (b.valor === VACIAS) return -1;
        if (orden) {
          const ia = orden.indexOf(a.valor), ib = orden.indexOf(b.valor);
          if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        }
        /* Las fechas, de la más nueva a la más vieja. */
        if (col.fecha) return b.valor.localeCompare(a.valor);
        return a.valor.localeCompare(b.valor, "es", { numeric: true });
      });
  }

  function ordenesDeURL(valor: string | null | undefined, porDefecto: OrdenCs<K>[]): OrdenCs<K>[] {
    const out: OrdenCs<K>[] = [];
    for (const x of (valor ?? "").split(",")) {
      const desc = x.startsWith("-");
      const clave = desc ? x.slice(1) : x;
      if (esColumna(clave) && !out.some((o) => o.clave === clave)) out.push({ clave, desc });
    }
    return out.length ? out.slice(0, MAX_ORDENES) : porDefecto;
  }

  const enTexto = (os: OrdenCs<K>[]) => os.map((o) => `${o.desc ? "-" : ""}${o.clave}`).join(",");

  /* null si es el orden de siempre: no se escribe en el link. */
  const ordenesAURL = (os: OrdenCs<K>[], porDefecto: OrdenCs<K>[]) => {
    const t = enTexto(os);
    return !t || t === enTexto(porDefecto) ? null : t;
  };

  /* `ordenValores`: el orden propio de los valores de una columna (las opciones de una lista, como se cargaron).
     Lo vacío va siempre al final, se ordene para donde se ordene. */
  function ordenarFilas(filas: F[], ordenes: OrdenCs<K>[], ordenValores: Partial<Record<K, string[]>> = {}): F[] {
    const criterios = ordenes.filter((o) => esColumna(o.clave)).map((o) => {
      const col = columna[o.clave];
      const lista = ordenValores[o.clave];
      const valor = (f: F): string | number => {
        if (lista) {
          const v = col.valores(f)[0];
          const i = lista.indexOf(v);
          return v === VACIAS ? "" : i >= 0 ? i : lista.length;
        }
        const v = col.orden ? col.orden(f) : col.valores(f)[0];
        return v === VACIAS ? "" : v;
      };
      return { valor, signo: o.desc ? -1 : 1 };
    });
    if (!criterios.length) return filas;
    /* Los valores se calculan una vez por fila, no en cada comparación. */
    const claves = new Map(filas.map((f) => [f, criterios.map((c) => c.valor(f))]));
    return [...filas].sort((a, b) => {
      const va = claves.get(a)!, vb = claves.get(b)!;
      for (let i = 0; i < criterios.length; i++) {
        const x = va[i], y = vb[i];
        if (x === y) continue;
        if (x === "") return 1;
        if (y === "") return -1;
        const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true });
        if (cmp !== 0) return cmp * criterios[i].signo;
      }
      return 0;
    });
  }

  return {
    ns, columnas, columna, esColumna, pasaFiltros, filtrosDeURL, filtroAURL, opcionesDeColumna, ordenesDeURL, ordenesAURL,
    ordenarFilas, textoDeColumna,
    paramOrden: `orden-${ns}`, paramBusqueda: `q-${ns}`, paramPagina: `pag-${ns}`, paramColumnas: `cols-${ns}`,
  };
}

/* ---------- Valores que se repiten en las columnas ---------- */

export const SI = "Sí";
export const NO = "No";
export const siNo = (b: boolean): string[] => [b ? SI : NO];
export const ORDEN_SI_NO = [SI, NO];

/** Un número como valor de filtro (sin decimales de más); vacío si no hay. */
export const numeroComoValor = (n: number | null | undefined): string[] =>
  uno(n === null || n === undefined || !Number.isFinite(n) ? "" : String(Math.round(n * 100) / 100));
