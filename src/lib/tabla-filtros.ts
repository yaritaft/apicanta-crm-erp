import { sinTildes } from "./crm";
import { hayFiltro, partirValores, seVe, unirValores, VACIAS, type FiltroColumna } from "./crm-tabla";

/* ==================================================================
   Los filtros de una tabla «como en Excel», para cualquier tabla.

   El CRM los trae atados a sus columnas (lib/crm-tabla.ts); esto es lo mismo
   sin atarlo a una tabla en particular, para que otras pantallas (Formularios)
   usen el mismo menú de columna (components/crm-tabla/FiltroColumna) y el mismo
   formato de link:
     ?solo-pais=Argentina|México   ?sin-grupo=Unido   ?con-nombre=garcia
     ?desde-registro=2026-10-01    ?orden=pais,-registro

   Una columna dice qué valores tiene cada fila (una lista: una fila con varios
   valores aparece tildando cualquiera) y, si hace falta, cómo se ordena y qué
   texto mira «contiene». Lógica pura: sin React.
   ================================================================== */

export interface ColumnaFiltrable<F> {
  clave: string;
  titulo: string;
  /* Los valores por los que se filtra; lo vacío va como VACIAS. */
  valores: (f: F) => string[];
  /* Cómo se ordena; si falta, por el primer valor. */
  orden?: (f: F) => string | number;
  /* El texto que mira «contiene», si no son los valores del filtro. */
  texto?: (f: F) => string;
  /* Los valores son días (aaaa-mm-dd): se filtra desde y hasta. */
  fecha?: boolean;
  /* Se ordena por un número: «de menor a mayor». */
  numerica?: boolean;
}

export type ColumnasDe<F> = Record<string, ColumnaFiltrable<F>>;
export type FiltrosDe = Record<string, FiltroColumna>;

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;

export const textoDeColumna = <F,>(f: F, col: ColumnaFiltrable<F>) =>
  col.texto ? col.texto(f) : col.valores(f).filter((v) => v !== VACIAS).join(", ");

/** Si una fila pasa los filtros de todas las columnas (menos `salvo`: para contar las opciones de esa columna). */
export function pasaFiltros<F>(cols: ColumnasDe<F>, f: F, filtros: FiltrosDe, salvo?: string): boolean {
  for (const [k, fc] of Object.entries(filtros)) {
    if (k === salvo || !hayFiltro(fc)) continue;
    const col = cols[k];
    if (!col) continue;
    const valores = col.valores(f);
    /* Una fila con varios valores se ve si alguno se ve. */
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

/** Los filtros de la URL, sólo de las columnas que existen. */
export function filtrosDeURL<F>(cols: ColumnasDe<F>, params: URLSearchParams): FiltrosDe {
  const out: FiltrosDe = {};
  const de = (clave: string) => (out[clave] ??= { modo: "solo", valores: [] });
  for (const [k, v] of params.entries()) {
    const m = /^(solo|sin|con|nocon|desde|hasta)-(.+)$/.exec(k);
    if (!m || !v || !Object.prototype.hasOwnProperty.call(cols, m[2])) continue;
    const clave = m[2];
    if (m[1] === "solo" || m[1] === "sin") {
      const valores = partirValores(v);
      if (valores.length) Object.assign(de(clave), { modo: m[1], valores });
    } else if (m[1] === "con") de(clave).contiene = v;
    else if (m[1] === "nocon") de(clave).noContiene = v;
    else if (ES_DIA.test(v) && cols[clave].fecha) de(clave)[m[1] as "desde" | "hasta"] = v;
  }
  for (const k of Object.keys(out)) if (!hayFiltro(out[k])) delete out[k];
  return out;
}

/** Lo que hay que escribir en la URL para dejar una columna con este filtro (null borra). */
export function filtroAURL(clave: string, fc: FiltroColumna | null): Record<string, string | null> {
  return {
    [`solo-${clave}`]: fc?.modo === "solo" && fc.valores.length ? unirValores(fc.valores) : null,
    [`sin-${clave}`]: fc?.modo === "sin" && fc.valores.length ? unirValores(fc.valores) : null,
    [`con-${clave}`]: fc?.contiene?.trim() || null,
    [`nocon-${clave}`]: fc?.noContiene?.trim() || null,
    [`desde-${clave}`]: fc?.desde || null,
    [`hasta-${clave}`]: fc?.hasta || null,
  };
}

/** Los valores de una columna para su menú, con cuántas filas tiene cada uno según los DEMÁS filtros (como en Excel). */
export function opcionesDeColumna<F>(
  cols: ColumnasDe<F>, filas: readonly F[], filtros: FiltrosDe, clave: string, orden?: string[],
): { valor: string; cuenta: number }[] {
  const col = cols[clave];
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    if (!pasaFiltros(cols, f, filtros, clave)) continue;
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

/* ---------- Ordenar: por una columna o por varias, en el link: ?orden=pais,-registro ---------- */

export interface OrdenDe { clave: string; desc: boolean }
export const MAX_ORDENES = 3;

export function ordenesDeURL<F>(cols: ColumnasDe<F>, valor: string | null | undefined, porDefecto: OrdenDe[]): OrdenDe[] {
  const out: OrdenDe[] = [];
  for (const x of (valor ?? "").split(",")) {
    const desc = x.startsWith("-");
    const clave = desc ? x.slice(1) : x;
    if (Object.prototype.hasOwnProperty.call(cols, clave) && !out.some((o) => o.clave === clave)) out.push({ clave, desc });
  }
  return out.length ? out.slice(0, MAX_ORDENES) : porDefecto;
}

const enTexto = (os: OrdenDe[]) => os.map((o) => `${o.desc ? "-" : ""}${o.clave}`).join(",");

/** null si es el orden de siempre: no se escribe en el link. */
export function ordenesAURL(os: OrdenDe[], porDefecto: OrdenDe[]): string | null {
  const t = enTexto(os);
  return !t || t === enTexto(porDefecto) ? null : t;
}

/** Lo vacío va siempre al final, se ordene para donde se ordene. */
export function ordenarFilas<F>(cols: ColumnasDe<F>, filas: readonly F[], ordenes: OrdenDe[]): F[] {
  const criterios = ordenes.filter((o) => cols[o.clave]).map((o) => {
    const col = cols[o.clave];
    const valor = (f: F): string | number => {
      const v = col.orden ? col.orden(f) : col.valores(f)[0];
      return v === VACIAS ? "" : v;
    };
    return { valor, signo: o.desc ? -1 : 1 };
  });
  if (!criterios.length) return [...filas];
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
