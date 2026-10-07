import type { EstadoApp, Gasto, GrupoGasto, Moneda } from "./types";
import { CATEGORIAS_GASTO, type CategoriaGasto } from "./seed";
import { periodoDeFecha } from "./periodos";
import { isoDia } from "./format";

/* ==================================================================
   Gastos: los tres bloques del P&L, qué categoría le corresponde a lo
   que se pagó, y cómo se guarda un gasto pagado en otra moneda.
   ================================================================== */

export interface GrupoInfo {
  grupo: GrupoGasto;
  titulo: string;
  corto: string;
  /* Cómo se dice de un gasto de este grupo: «Va en: Contador · gasto operativo». */
  tipo: string;
  ayuda: string;
  /* Una línea que dice en qué renglón del estado de resultados cae: es la
     que se lee al elegir categoría, para que no queden dudas de a dónde va. */
  renglon: string;
}

/* Los bloques del estado de resultados en los que puede caer un gasto, en
   el orden en que se leen. */
export const GRUPOS_GASTO: GrupoInfo[] = [
  {
    grupo: "directo", titulo: "Costos directos", corto: "Directo", tipo: "costo directo",
    ayuda: "Restan antes de la utilidad bruta: lo que cuesta cada venta.",
    renglon: "Cae en «Otros costos directos», antes de la utilidad bruta: lo que cuesta cada venta.",
  },
  {
    grupo: "operativo", titulo: "Gastos operativos", corto: "Operativo", tipo: "gasto operativo",
    ayuda: "Lo que cuesta tener el negocio andando.",
    renglon: "Cae en «Gastos operativos», antes del resultado operativo: lo que cuesta tener el negocio andando.",
  },
  {
    grupo: "dueno", titulo: "Honorarios del dueño", corto: "Dueño", tipo: "honorarios del dueño",
    ayuda: "Lo que se lleva el dueño, después del resultado operativo.",
    renglon: "Cae en «Honorarios del CEO», después del resultado operativo: lo que se lleva el dueño.",
  },
  {
    grupo: "retiro", titulo: "Retiros del dueño", corto: "Retiro", tipo: "retiro del dueño",
    ayuda: "Plata que sale de la caja pero no es un gasto: el retiro de beneficios. No resta del profit.",
    renglon: "No cae en el estado de resultados: sale de la caja pero no resta del profit.",
  },
];

export function infoGrupo(g: GrupoGasto) {
  return GRUPOS_GASTO.find((x) => x.grupo === g) ?? GRUPOS_GASTO[1];
}

/* Sin tildes, en minúscula y con un solo espacio: "Pauta  META" y
   "pauta meta" tienen que ser lo mismo. */
export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const masReciente = (a: Gasto, b: Gasto) =>
  +new Date(b.creadoEn || b.fecha) - +new Date(a.creadoEn || a.fecha);

/* El catálogo más las categorías que ya se usaron y no están en él: datos
   viejos, o una que alguien creó a mano. Si no aparecieran, un gasto con
   esa categoría no se podría editar sin perderla. */
export function categoriasDisponibles(e: EstadoApp): CategoriaGasto[] {
  const conocidas = new Set(CATEGORIAS_GASTO.map((c) => c.categoria));
  const extra = new Map<string, CategoriaGasto>();
  for (const g of [...e.gastos].sort(masReciente)) {
    if (!g.categoria || conocidas.has(g.categoria) || extra.has(g.categoria)) continue;
    /* El grupo lo decide el gasto más reciente con esa categoría. */
    extra.set(g.categoria, { categoria: g.categoria, grupo: g.grupo, ayuda: "Categoría que ya usaste" });
  }
  const propias = [...extra.values()].sort((a, b) => a.categoria.localeCompare(b.categoria, "es"));
  return [...CATEGORIAS_GASTO, ...propias];
}

export function categoriaDe(e: EstadoApp, nombre: string): CategoriaGasto | undefined {
  return categoriasDisponibles(e).find((c) => c.categoria === nombre);
}

/* Una clave cuenta si empieza una palabra: "curso" encuentra "cursos" pero
   no "recursos", y "cena" no se confunde con "escena". */
const patrones = new Map<string, RegExp>();
function aparece(texto: string, clave: string): boolean {
  /* Se arma una vez por clave: la sugerencia corre en cada tecla. */
  let re = patrones.get(clave);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    patrones.set(clave, re);
  }
  return re.test(texto);
}

/** La categoría que probablemente corresponde a lo que se escribió.
 *  Primero lo que ya se cargó con ese mismo concepto; si no, la palabra
 *  clave más específica (la más larga) que aparezca. */
export function sugerirCategoria(texto: string, e: EstadoApp): CategoriaGasto | null {
  const t = normalizar(texto);
  if (t.length < 2) return null;
  const disponibles = categoriasDisponibles(e);

  const previo = [...e.gastos].sort(masReciente).find((g) => normalizar(g.concepto) === t);
  const dePrevio = previo && disponibles.find((c) => c.categoria === previo.categoria);
  if (dePrevio) return dePrevio;

  let mejor: { c: CategoriaGasto; largo: number } | null = null;
  for (const c of disponibles) {
    for (const k of [normalizar(c.categoria), ...(c.claves ?? [])]) {
      if (aparece(t, k) && (!mejor || k.length > mejor.largo)) mejor = { c, largo: k.length };
    }
  }
  return mejor?.c ?? null;
}

/** Gastos ya cargados cuyo concepto se parece a lo que se está escribiendo,
 *  uno por concepto, del más reciente al más viejo. Sirven para repetir un
 *  gasto de todos los meses sin volver a elegir todo. */
export function gastosParecidos(texto: string, e: EstadoApp, max = 5): Gasto[] {
  const t = normalizar(texto);
  const vistos = new Set<string>();
  const out: Gasto[] = [];
  for (const g of [...e.gastos].sort(masReciente)) {
    const c = normalizar(g.concepto);
    if (!c || vistos.has(c)) continue;
    if (t.length >= 2 ? !c.includes(t) : !g.recurrente) continue;
    vistos.add(c);
    out.push(g);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------- Dos fechas: a qué mes corresponde y cuándo se pagó ----------
   Yari y Juan Cruz (02/10): un gasto de septiembre que se paga el 2 de octubre
   tiene que restar en septiembre —ahí lo generó el negocio— pero la plata sale
   de la caja en octubre. Por eso un gasto tiene dos fechas:

     fecha      el mes al que corresponde (el devengo): el estado de resultados
                lo cuenta ahí. Es la de siempre.
     fechaPago  el día que se pagó: la caja y el arqueo lo cuentan ahí.

   Sin `fechaPago` es la misma `fecha`: así están todos los gastos que ya había,
   y no cambia ninguna cuenta de lo ya cargado. */

type ConFechas = Pick<Gasto, "fecha" | "fechaPago">;

/** El día que se pagó el gasto: la caja lo cuenta ahí. */
export function fechaDePago(g: ConFechas): string {
  return g.fechaPago || g.fecha;
}

/** ¿Se pagó otro día que el que dice «a qué mes corresponde»? Sólo entonces
 *  vale la pena mostrar las dos fechas. */
export function tieneOtraFechaDePago(g: ConFechas): boolean {
  return Boolean(g.fechaPago) && isoDia(g.fechaPago) !== isoDia(g.fecha);
}

/** ¿Se pagó en un mes distinto del que le corresponde? Es el caso de Yari: el
 *  estado de resultados y la caja lo ven en meses distintos. */
export function pagadoEnOtroMes(g: ConFechas): boolean {
  return tieneOtraFechaDePago(g) && periodoDeFecha(g.fechaPago) !== periodoDeFecha(g.fecha);
}

/* ---------- Moneda ----------
   El estado de resultados suma todo en la moneda base, igual que los
   pagos. Un gasto pagado en otra moneda se guarda convertido, y lo que se
   pagó de verdad queda en `extra`: es lo mismo que hace la planilla con
   sus columnas Monto ARS, Monto USD y TDC. */

export function aMonedaBase(monto: number, moneda: Moneda, base: Moneda, tipoCambio: number): number {
  if (moneda === base) return monto;
  if (!(tipoCambio > 0)) return 0;
  /* El tipo de cambio es pesos por dólar. */
  return base === "USD" ? monto / tipoCambio : monto * tipoCambio;
}

export interface MontoOriginal { monto: number; moneda: Moneda; tipoCambio: number }

export function montoOriginal(g: Pick<Gasto, "extra">): MontoOriginal | null {
  const x = g.extra ?? {};
  const monto = Number(x.montoOriginal);
  const tipoCambio = Number(x.tipoCambio);
  const moneda = x.monedaOriginal;
  if (!Number.isFinite(monto) || !Number.isFinite(tipoCambio) || (moneda !== "USD" && moneda !== "ARS")) return null;
  return { monto, moneda, tipoCambio };
}

/* leerMonto y escribirMonto viven en monto.ts (junto con lo que se ve en el campo
   mientras se escribe) y se reexportan acá para no tocar a quien ya los importa. */
export { leerMonto, escribirMonto } from "./monto";
