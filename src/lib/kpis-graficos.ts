import { Contexto, cuotasExigibles, type Corte } from "./kpis";
import { infoPais, nombreDePais, normalizarPais, OTRO_PAIS, SIN_PAIS, type InfoPais } from "./paises";
import type { Alumno, EstadoApp, ID, Pago, Venta } from "./types";

/* ==================================================================
   El Dashboard en gráficos: la misma tabla, dibujada.

   Angelo (06/10): «en la parte que dice solo tabla hay que crear gráficos de
   una, está bueno, pero la tabla esa déjala, no la saques». Acá no hay
   fórmulas nuevas: cada total sale de los mismos métodos del Contexto que
   las filas de la tabla (facturado(), cobrado(), ventasContables(), pagos(),
   vencidas()), y los desgloses por país, plan de pago, estrategia, servicio
   o proyecto SOLO reparten esos totales entre categorías:

   - Unidades = las ventas que cuentan (sin canceladas ni reservas): fila «Ventas».
   - Revenue  = el precio acordado de las ventas del período, sin canceladas:
                fila «Revenue (facturado)».
   - CC       = los pagos del período, cada uno en la categoría de la venta
                que paga: fila «Cash Collected (CC)».

   Lo que no tiene categoría va a «Sin dato» y no se esconde: la suma de todas
   las categorías da EXACTAMENTE el total de la tabla (hay una prueba que lo
   verifica con cada filtro). Sin React: se prueba con npm test.
   ================================================================== */

/* ---------- Números de un período ---------- */

export interface Medidas {
  /* Las ventas que cuentan como venta: sin canceladas ni «sólo reserva». */
  ventas: number;
  revenue: number;
  cc: number;
  /* CC ÷ Revenue × 100. null si no hubo Revenue. */
  tasaCobro: number | null;
  /* Revenue ÷ ventas. null si no hubo ventas. */
  ticketRev: number | null;
  /* CC ÷ ventas. null si no hubo ventas. */
  ticketCC: number | null;
}

/** Lo que mide un corte, con los mismos métodos que las filas de la tabla
 *  (v_n, v_fact, c_cc, c_tasa y v_ticket). */
export function medidasDe(c: Contexto): Medidas {
  const ventas = c.ventasContables().length, revenue = c.facturado(), cc = c.cobrado();
  return {
    ventas, revenue, cc,
    tasaCobro: revenue > 0 ? (cc / revenue) * 100 : null,
    ticketRev: ventas > 0 ? revenue / ventas : null,
    ticketCC: ventas > 0 ? cc / ventas : null,
  };
}

/* La mora es una foto de HOY (cuotas que ya vencieron y siguen sin pagar):
   no depende del período, sí del filtro de embudo o webinar. */
export interface Mora {
  vencidas: number;
  exigibles: number;
  /* Vencidas ÷ exigibles × 100; 0 si todavía no venció ninguna (igual que la fila). */
  pct: number;
  /* Lo que falta cobrar de esas cuotas. */
  saldo: number;
}

/** Igual que la fila «Tasa de mora» (c_mora) y «Vencido» (c_vencido). */
export function moraDe(c: Contexto): Mora {
  const vencidas = c.vencidas();
  const exigibles = cuotasExigibles(c).length;
  return {
    vencidas: vencidas.length, exigibles,
    pct: exigibles ? (vencidas.length / exigibles) * 100 : 0,
    saldo: vencidas.reduce((a, x) => a + x.saldo, 0),
  };
}

/* ---------- En el tiempo ---------- */

export interface PuntoSerie {
  corte: Corte;
  medidas: Medidas;
  /* Con «Comparar períodos»: lo mismo en el paso anterior (el día, el mes o
     el período anterior, como la tabla). */
  previo?: Medidas;
}

/** Una medida por columna de la tabla (sin la de Total). Cada una se calcula
 *  con su propio Contexto: es el mismo número que da la celda de esa columna. */
export function serieTemporal(e: EstadoApp, cortes: Corte[]): PuntoSerie[] {
  return cortes
    .filter((c) => !c.total)
    .map((corte) => ({
      corte,
      medidas: medidasDe(new Contexto(e, corte)),
      previo: corte.previo ? medidasDe(new Contexto(e, corte.previo)) : undefined,
    }));
}

/* ---------- Qué se ve ---------- */

export interface QueSeVe {
  /* Revenue, ventas y ticket sobre Revenue viven en la sección Ventas de la
     tabla; CC, tasa de cobro y mora, en Cobranza. El ticket sobre CC mezcla
     las dos. Con un tipo de cuenta que no ve una sección, sus números no se
     dibujan (la tabla tampoco los muestra). */
  revenue: boolean;
  unidades: boolean;
  ticketRev: boolean;
  cc: boolean;
  tasaCobro: boolean;
  mora: boolean;
  ticketCC: boolean;
  ninguno: boolean;
}

export function queSeVe(verVentas: boolean, verCobranza: boolean): QueSeVe {
  return {
    revenue: verVentas, unidades: verVentas, ticketRev: verVentas,
    cc: verCobranza, tasaCobro: verCobranza, mora: verCobranza,
    ticketCC: verVentas && verCobranza,
    ninguno: !verVentas && !verCobranza,
  };
}

/* ---------- Desgloses ---------- */

export type DimensionId = "plan" | "pais" | "estrategia" | "servicio" | "proyecto";
export type MetricaDesglose = "unidades" | "revenue" | "cc";

export interface DefDimension {
  id: DimensionId;
  titulo: string;
  /* «por plan de pago», «por país»… */
  por: string;
  /* De dónde sale la categoría de cada venta. */
  origen: string;
  /* Se ordena por su orden natural (1 pago, 2, 3, 4+) y no por valor. */
  natural?: boolean;
}

export const DIMENSIONES: DefDimension[] = [
  { id: "plan", titulo: "Plan de pago", por: "por plan de pago", natural: true,
    origen: "las cuotas de la venta, sin contar la reserva (en 1 pago, 2, 3 o 4 cuotas o más: las mismas filas «En 1 pago» a «En 4 cuotas o más» de la tabla)" },
  { id: "pais", titulo: "País", por: "por país",
    origen: "el país de la persona de la venta (el del contacto o, si no tiene, el del lead o el del alumno), escrito de cualquier forma: «México», «Mexico» y «MX» son el mismo" },
  { id: "estrategia", titulo: "Estrategia", por: "por estrategia", origen: "la estrategia (el embudo) cargada en la venta" },
  { id: "servicio", titulo: "Servicio", por: "por servicio", origen: "el servicio adquirido (el producto) cargado en la venta" },
  { id: "proyecto", titulo: "Proyecto", por: "por proyecto", origen: "el proyecto cargado en la venta (MENT, DOWN, WEB-13/04/26…)" },
];

export const METRICAS: { id: MetricaDesglose; titulo: string }[] = [
  { id: "unidades", titulo: "Unidades" },
  { id: "revenue", titulo: "Revenue" },
  { id: "cc", titulo: "Cash Collected (CC)" },
];

export interface Categoria {
  clave: string;
  nombre: string;
  /* «Sin dato», «Sin país» o «Sin identificar»: lo que no se pudo ubicar. */
  sinDato: boolean;
  unidades: number;
  revenue: number;
  cc: number;
  /* La mora de la categoría, a hoy. */
  exigibles: number;
  vencidas: number;
  saldoVencido: number;
  /* Lo que decía el campo cuando no se reconoció (el país): para corregirlo. */
  crudos?: string[];
}

export interface TotalesDesglose {
  unidades: number;
  revenue: number;
  cc: number;
  exigibles: number;
  vencidas: number;
  saldoVencido: number;
}

export interface Desglose {
  dimension: DimensionId;
  /* Todas las categorías con algo, el «Sin dato» incluido: ordenadas por Revenue. */
  categorias: Categoria[];
  /* El total del corte: lo mismo que las filas de la tabla. */
  total: TotalesDesglose;
}

interface Clasif { clave: string; nombre: string; sinDato: boolean; crudo?: string }

const SIN_DATO: Clasif = { clave: SIN_PAIS, nombre: "Sin dato", sinDato: true };

const PLANES: Clasif[] = [
  { clave: "1", nombre: "En 1 pago", sinDato: false },
  { clave: "2", nombre: "En 2 cuotas", sinDato: false },
  { clave: "3", nombre: "En 3 cuotas", sinDato: false },
  { clave: "4+", nombre: "En 4 cuotas o más", sinDato: false },
];
const SIN_CUOTAS: Clasif = { clave: "0", nombre: "Sin cuotas (sólo reserva)", sinDato: false };
const ORDEN_PLAN = ["1", "2", "3", "4+", "0", SIN_PAIS];

/* Los alumnos por la venta que los trajo: cuando la persona de la venta no
   tiene país, el alumno a veces sí. */
const ALUMNO_DE_VENTA = new WeakMap<EstadoApp, Map<ID, Alumno>>();
function alumnoDeVenta(e: EstadoApp, id: ID): Alumno | undefined {
  let m = ALUMNO_DE_VENTA.get(e);
  if (!m) {
    m = new Map();
    for (const a of e.alumnos) if (a.ventaId && !m.has(a.ventaId)) m.set(a.ventaId, a);
    ALUMNO_DE_VENTA.set(e, m);
  }
  return m.get(id);
}

/** Lo que dice el país de la persona de una venta, sin normalizar. La venta
 *  apunta a un contacto o a un lead (el lead apunta a su contacto): primero el
 *  país del contacto, que es la fuente de verdad; si no tiene, el del lead y,
 *  por último, el del alumno que nació de esa venta. */
export function textoDePais(c: Contexto, v: Venta): string {
  const { contactoPorId, leadPorId } = c.ix;
  const lead = v.contactoId ? leadPorId.get(v.contactoId) : undefined;
  const contacto = v.contactoId ? contactoPorId.get(v.contactoId) ?? (lead ? contactoPorId.get(lead.contactoId ?? lead.id) : undefined) : undefined;
  return contacto?.pais?.trim() || lead?.pais?.trim() || alumnoDeVenta(c.e, v.id)?.pais?.trim() || "";
}

function clasificador(c: Contexto, dim: DimensionId): (v: Venta | undefined) => Clasif {
  switch (dim) {
    case "plan":
      return (v) => {
        if (!v) return SIN_DATO;
        const n = c.cuotasDe(v).length;
        return n === 0 ? SIN_CUOTAS : PLANES[Math.min(n, 4) - 1];
      };
    case "pais": {
      const memo = new Map<string, string>();
      return (v) => {
        const texto = v ? textoDePais(c, v) : "";
        let k = memo.get(texto);
        if (k === undefined) { k = normalizarPais(texto); memo.set(texto, k); }
        return { clave: k, nombre: nombreDePais(k), sinDato: k === SIN_PAIS || k === OTRO_PAIS, crudo: k === OTRO_PAIS ? texto : undefined };
      };
    }
    case "estrategia": {
      const nombres = new Map(c.e.embudos.map((x) => [x.id, x.nombre]));
      return (v) => { const n = v?.embudoId ? nombres.get(v.embudoId) : undefined; return n ? { clave: `e:${v!.embudoId}`, nombre: n, sinDato: false } : SIN_DATO; };
    }
    case "servicio": {
      const nombres = new Map(c.e.productos.map((x) => [x.id, x.nombre]));
      return (v) => { const n = v?.productoId ? nombres.get(v.productoId) : undefined; return n ? { clave: `s:${v!.productoId}`, nombre: n, sinDato: false } : SIN_DATO; };
    }
    case "proyecto":
      return (v) => { const t = v?.proyecto?.trim(); return t ? { clave: `p:${t}`, nombre: t, sinDato: false } : SIN_DATO; };
  }
}

/** Reparte el corte entre las categorías de una dimensión. Cada venta cuenta
 *  en la categoría que tiene cargada y cada cobro, en la de la venta que paga
 *  (un cobro que no encuentra su venta cae en «Sin dato»): nada se pierde. */
export function desglosePor(c: Contexto, dim: DimensionId): Desglose {
  const clasificar = clasificador(c, dim);
  const porClave = new Map<string, Categoria>();
  const crudos = new Map<string, Set<string>>();
  const de = (k: Clasif): Categoria => {
    let x = porClave.get(k.clave);
    if (!x) {
      x = { clave: k.clave, nombre: k.nombre, sinDato: k.sinDato, unidades: 0, revenue: 0, cc: 0, exigibles: 0, vencidas: 0, saldoVencido: 0 };
      porClave.set(k.clave, x);
    }
    if (k.crudo) { const s = crudos.get(k.clave) ?? new Set(); s.add(k.crudo); crudos.set(k.clave, s); }
    return x;
  };
  const ventaDe = (ventaId: ID | undefined) => (ventaId ? c.ix.ventaPorId.get(ventaId) : undefined);

  for (const v of c.ventas()) de(clasificar(v)).revenue += v.precioAcordado;
  for (const v of c.ventasContables()) de(clasificar(v)).unidades += 1;
  for (const p of c.pagos()) de(clasificar(ventaDe(c.ix.cuotaPorId.get(p.cuotaId)?.ventaId))).cc += p.monto;
  for (const q of cuotasExigibles(c)) de(clasificar(ventaDe(q.ventaId))).exigibles += 1;
  for (const q of c.vencidas()) { const x = de(clasificar(ventaDe(q.ventaId))); x.vencidas += 1; x.saldoVencido += q.saldo; }

  for (const [k, s] of crudos) { const x = porClave.get(k); if (x) x.crudos = [...s].sort((a, b) => a.localeCompare(b, "es")).slice(0, 8); }
  const categorias = ordenar([...porClave.values()], "revenue");
  const total = categorias.reduce<TotalesDesglose>((a, x) => ({
    unidades: a.unidades + x.unidades, revenue: a.revenue + x.revenue, cc: a.cc + x.cc,
    exigibles: a.exigibles + x.exigibles, vencidas: a.vencidas + x.vencidas, saldoVencido: a.saldoVencido + x.saldoVencido,
  }), { unidades: 0, revenue: 0, cc: 0, exigibles: 0, vencidas: 0, saldoVencido: 0 });
  return { dimension: dim, categorias, total };
}

/** Las ventas de una categoría, con la misma regla con la que cuenta cada
 *  métrica: «unidades» son las que cuentan como venta; «revenue», todas las que
 *  suman al Revenue. Es lo que abre el detalle desde el gráfico. */
export function ventasDeCategoria(c: Contexto, dim: DimensionId, clave: string, base: "unidades" | "revenue"): Venta[] {
  const clasificar = clasificador(c, dim);
  return (base === "unidades" ? c.ventasContables() : c.ventas()).filter((v) => clasificar(v).clave === clave);
}

/** Los cobros de una categoría: los pagos del período de las ventas que ella tiene. */
export function pagosDeCategoria(c: Contexto, dim: DimensionId, clave: string): Pago[] {
  const clasificar = clasificador(c, dim);
  return c.pagos().filter((p) => clasificar(c.ix.ventaPorId.get(c.ix.cuotaPorId.get(p.cuotaId)?.ventaId ?? "")).clave === clave);
}

export const valorDe = (x: Pick<Categoria, "unidades" | "revenue" | "cc">, m: MetricaDesglose): number =>
  m === "unidades" ? x.unidades : m === "revenue" ? x.revenue : x.cc;

/** De mayor a menor por la métrica (a igual valor, por nombre). El «Sin dato»
 *  va donde le toca por valor: si es grande, que se vea. */
export function ordenar(categorias: Categoria[], metrica: MetricaDesglose): Categoria[] {
  return [...categorias].sort((a, b) => valorDe(b, metrica) - valorDe(a, metrica) || a.nombre.localeCompare(b.nombre, "es"));
}

/** En el orden de lo que se mira: por valor, o el natural del plan de pago
 *  (1 pago, 2 cuotas, 3, 4 o más, sin cuotas). */
export function ordenDeDimension(d: Desglose, metrica: MetricaDesglose): Categoria[] {
  if (!DIMENSIONES.find((x) => x.id === d.dimension)?.natural) return ordenar(d.categorias, metrica);
  const lugar = (k: string) => { const i = ORDEN_PLAN.indexOf(k); return i < 0 ? ORDEN_PLAN.length : i; };
  return [...d.categorias].sort((a, b) => lugar(a.clave) - lugar(b.clave));
}

/** Las categorías con algo en la métrica elegida. Las que están en cero no
 *  dibujan nada: salvo el «Sin dato», que se queda mientras tenga plata en
 *  cualquier métrica (para que se vea que falta cargar algo). */
export function conMovimiento(lista: Categoria[], metrica: MetricaDesglose): Categoria[] {
  return lista.filter((x) => valorDe(x, metrica) > 0 || (x.sinDato && (x.unidades > 0 || x.revenue > 0 || x.cc > 0)));
}

/** Las primeras `max`; el «Sin dato» siempre entra, aunque quede más abajo. */
export function recortar(lista: Categoria[], max: number): { visibles: Categoria[]; resto: Categoria[] } {
  if (lista.length <= max) return { visibles: lista, resto: [] };
  const primeras = lista.slice(0, max);
  const faltaSinDato = lista.slice(max).filter((x) => x.sinDato);
  const visibles = [...primeras.slice(0, max - faltaSinDato.length), ...faltaSinDato];
  const vistos = new Set(visibles.map((x) => x.clave));
  return { visibles: lista.filter((x) => vistos.has(x.clave)), resto: lista.filter((x) => !vistos.has(x.clave)) };
}

export const tasaCobro = (x: Pick<Categoria, "revenue" | "cc">): number | null => (x.revenue > 0 ? (x.cc / x.revenue) * 100 : null);
export const moraCategoria = (x: Pick<Categoria, "exigibles" | "vencidas">): number | null => (x.exigibles > 0 ? (x.vencidas / x.exigibles) * 100 : null);
export const pesoDe = (valor: number, total: number): number | null => (total > 0 ? (valor / total) * 100 : null);

/* ---------- Mapa ---------- */

export interface PaisMapa extends Categoria, Pick<InfoPais, "iso" | "lat" | "lon"> {}

/** De las categorías de «país»: las que se dibujan en el mapa (con su
 *  centroide) y las que no se pueden ubicar («Sin país» y «Sin identificar»). */
export function paisesDelMapa(d: Desglose): { enMapa: PaisMapa[]; sinUbicar: Categoria[] } {
  const enMapa: PaisMapa[] = [];
  const sinUbicar: Categoria[] = [];
  for (const x of d.categorias) {
    const info = infoPais(x.clave);
    if (info) enMapa.push({ ...x, iso: info.iso, lat: info.lat, lon: info.lon });
    else sinUbicar.push(x);
  }
  return { enMapa, sinUbicar };
}

/** Las zonas a las que se acerca el mapa: [oeste, sur, este, norte] en grados. */
export const ZONAS_MAPA = [
  { id: "mundo", titulo: "Mundo", caja: [-180, -58, 180, 84] },
  { id: "americas", titulo: "Américas", caja: [-168, -57, -34, 72] },
  { id: "latam", titulo: "Latinoamérica", caja: [-118, -56, -34, 33] },
  { id: "europa", titulo: "Europa", caja: [-25, 34, 45, 72] },
] as const satisfies readonly { id: string; titulo: string; caja: readonly [number, number, number, number] }[];
export type ZonaMapa = (typeof ZONAS_MAPA)[number]["id"];

/* ---------- Cómo se calcula (el ícono ⓘ de cada gráfico) ---------- */

export type SignoG = "+" | "−" | "×" | "÷" | "=";
export interface ComponenteG {
  concepto: string;
  valor: number | null;
  formato: "moneda" | "cantidad" | "pct";
  signo?: SignoG;
  nota?: string;
}

export interface TextoGrafico {
  titulo: string;
  ayuda: string;
  formula: string;
  ejemplo?: string;
}

export const TEXTOS: Record<"revenueCC" | "soloRevenue" | "soloCC" | "tasaCobro" | "mora" | "ticket" | "ticketRev" | "ticketCC" | "mapa", TextoGrafico> = {
  revenueCC: {
    titulo: "Revenue vs Cash Collected (CC)",
    ayuda: "Lo vendido contra lo que entró, en cada columna de la tabla. Revenue es el precio acordado de las ventas del período, se haya cobrado o no; Cash Collected (CC), la plata que entró en el período, de ventas de cualquier fecha. Por eso un día puede tener más CC que Revenue.",
    formula: "Revenue = suma del precio acordado de las ventas con fecha de la columna, sin las canceladas\nCash Collected (CC) = suma de los pagos que entraron con fecha de la columna, sin importar cuándo se hizo la venta",
    ejemplo: "Un lunes cerrás una venta de US$ 3.000 y ese día entran US$ 500 de esa venta y US$ 1.000 de la cuota de una venta de la semana pasada: el Revenue del lunes es US$ 3.000 y el CC, US$ 1.500.",
  },
  soloRevenue: {
    titulo: "Revenue en el tiempo",
    ayuda: "Lo vendido en cada columna de la tabla: el precio acordado de las ventas del período, se haya cobrado o no.",
    formula: "Revenue = suma del precio acordado de las ventas con fecha de la columna, sin las canceladas",
    ejemplo: "Si en el mes cerraste dos ventas de US$ 2.500 y una de US$ 5.000, el Revenue es US$ 10.000, aunque no haya entrado ningún pago.",
  },
  soloCC: {
    titulo: "Cash Collected (CC) en el tiempo",
    ayuda: "La plata que entró en cada columna de la tabla, de ventas de cualquier fecha.",
    formula: "Cash Collected (CC) = suma de los pagos que entraron con fecha de la columna, sin importar cuándo se hizo la venta",
    ejemplo: "Si en septiembre entraron tres pagos de US$ 1.000, US$ 1.500 y US$ 500, el Cash Collected (CC) de septiembre es US$ 3.000, aunque uno sea la cuota de una venta de agosto.",
  },
  tasaCobro: {
    titulo: "Tasa de cobro",
    ayuda: "De todo lo que vendemos, cuánto entra. Es la fila «Tasa de cobro» de la tabla, columna por columna. Un día puede pasar del 100%: el CC de ese día incluye cuotas de ventas anteriores, y el Revenue sólo las ventas de ese día.",
    formula: "Cash Collected (CC) ÷ Revenue × 100",
    ejemplo: "Facturaste US$ 10.000 y entraron US$ 6.000: la tasa de cobro es 60%.",
  },
  mora: {
    titulo: "Tasa de mora",
    ayuda: "Cuotas vencidas sin pagar sobre todas las que ya vencieron. El que se atrasa pero sigue no es una cancelación. Es una foto de hoy: no cambia con el período, sólo con el filtro de embudo o webinar.",
    formula: "Cuotas vencidas sin pagar ÷ Cuotas que ya vencieron × 100 (de ventas activas, sin las canceladas)",
    ejemplo: "Si ya vencieron 40 cuotas y 6 siguen sin pagar, la tasa de mora es 15%.",
  },
  ticket: {
    titulo: "Ticket promedio",
    ayuda: "Cuánto vale en promedio una venta, de dos maneras: sobre Revenue, contando lo vendido aunque todavía no se haya cobrado (el «Ticket promedio» de la tabla), y sobre CC, la plata que entró en el período por cada venta cerrada en el período. El ticket sobre CC no es lo que pagó cada cliente: el CC incluye cuotas de ventas de antes, y las ventas de este período van a seguir pagando después.",
    formula: "Ticket sobre Revenue = Revenue ÷ Ventas\nTicket sobre CC = Cash Collected (CC) ÷ Ventas\n(Ventas = las del período, sin las canceladas ni las que son sólo una reserva)",
    ejemplo: "US$ 10.000 facturados y US$ 6.000 cobrados en 3 ventas: el ticket sobre Revenue es US$ 3.333 y el ticket sobre CC, US$ 2.000.",
  },
  ticketRev: {
    titulo: "Ticket promedio sobre Revenue",
    ayuda: "Cuánto vale en promedio una venta, contando lo vendido aunque todavía no se haya cobrado. Es el «Ticket promedio» de la tabla, columna por columna.",
    formula: "Revenue ÷ Ventas\n(Ventas = las del período, sin las canceladas ni las que son sólo una reserva)",
    ejemplo: "US$ 10.000 facturados en 3 ventas: el ticket promedio es US$ 3.333.",
  },
  ticketCC: {
    titulo: "Ticket promedio sobre CC",
    ayuda: "Cuánta plata entró en el período por cada venta cerrada en el período. No es lo que pagó cada cliente: el CC incluye cuotas de ventas de antes, y las ventas de este período van a seguir pagando después.",
    formula: "Cash Collected (CC) ÷ Ventas\n(Ventas = las del período, sin las canceladas ni las que son sólo una reserva)",
    ejemplo: "Entraron US$ 6.000 y se cerraron 3 ventas: el ticket sobre CC es US$ 2.000.",
  },
  mapa: {
    titulo: "Mapa de países",
    ayuda: "Dónde están los clientes. Cada país se pinta según el Revenue de las ventas de su gente (amarillo) o el Cash Collected (CC) de los pagos de esas ventas (verde), a elección: cuanto más intenso el color, más monto. El peso es la parte de cada país sobre el total de la tabla. Lo que no tiene país cargado va a «Sin país»; lo que está escrito pero no se reconoce, a «Sin identificar».",
    formula: "Peso de un país = Revenue (o CC) del país ÷ Revenue (o CC) total × 100\nPaís de una venta = el de su contacto (o lead, o alumno), normalizado: «México», «Mexico» y «MX» son el mismo",
  },
};

/** Cómo se calcula un desglose: de dónde sale la categoría y qué es cada métrica. */
export function textoDeDesglose(dim: DefDimension, metrica: MetricaDesglose): TextoGrafico {
  const m = METRICAS.find((x) => x.id === metrica)!.titulo;
  return {
    titulo: `${m} ${dim.por}`,
    ayuda: `Reparte el total de la tabla entre las categorías de ${dim.titulo.toLowerCase()}: cada venta cuenta en la categoría que tiene cargada y cada cobro, en la de la venta que paga. Lo que no tiene dato va a «${dim.id === "pais" ? "Sin país" : "Sin dato"}» y no se esconde: la suma de todas las categorías da el total de la tabla.`,
    formula: [
      `Categoría de una venta = ${dim.origen}`,
      "Unidades = ventas del período, sin las canceladas ni las que son sólo una reserva (fila «Ventas»)",
      "Revenue = precio acordado de esas ventas, sin las canceladas (fila «Revenue (facturado)»)",
      "Cash Collected (CC) = pagos del período, cada uno en la categoría de la venta que paga (fila «Cash Collected (CC)»)",
      "% del total = valor de la categoría ÷ total × 100\nTasa de cobro = CC ÷ Revenue de la categoría × 100",
    ].join("\n"),
  };
}

/** «Con tus números» de un desglose: cada categoría y, al final, el total
 *  (el de la fila de la tabla). Sumarlas da el total. */
export function piezasDeDesglose(d: Desglose, metrica: MetricaDesglose, nombreTotal: string): ComponenteG[] {
  const lista = conMovimiento(ordenDeDimension(d, metrica), metrica);
  const formato = metrica === "unidades" ? "cantidad" : "moneda";
  return [
    ...lista.map((x, i): ComponenteG => ({ concepto: x.nombre, valor: valorDe(x, metrica), formato, signo: i === 0 ? undefined : "+" })),
    { concepto: nombreTotal, valor: valorDe(d.total, metrica), formato, signo: "=" },
  ];
}

export const piezasDeTicket = (m: Medidas, sobre: "revenue" | "cc"): ComponenteG[] => [
  { concepto: sobre === "revenue" ? "Revenue" : "Cash Collected (CC)", valor: sobre === "revenue" ? m.revenue : m.cc, formato: "moneda" },
  { concepto: "Ventas", valor: m.ventas, formato: "cantidad", signo: "÷", nota: "sin las canceladas ni las que son sólo reserva" },
  { concepto: sobre === "revenue" ? "Ticket promedio sobre Revenue" : "Ticket promedio sobre CC", valor: sobre === "revenue" ? m.ticketRev : m.ticketCC, formato: "moneda", signo: "=" },
];

export const piezasDeTasa = (m: Medidas): ComponenteG[] => [
  { concepto: "Cash Collected (CC)", valor: m.cc, formato: "moneda" },
  { concepto: "Revenue", valor: m.revenue, formato: "moneda", signo: "÷" },
  { concepto: "Tasa de cobro", valor: m.tasaCobro, formato: "pct", signo: "=" },
];

export const piezasDeMora = (m: Mora): ComponenteG[] => [
  { concepto: "Cuotas vencidas sin pagar", valor: m.vencidas, formato: "cantidad" },
  { concepto: "Cuotas que ya vencieron", valor: m.exigibles, formato: "cantidad", signo: "÷", nota: "pagadas o no" },
  { concepto: "Tasa de mora", valor: m.pct, formato: "pct", signo: "=" },
];

/** Lo de la tarjeta de Revenue y CC según lo que se ve: las dos, o sólo una. */
export const piezasDeSerie = (m: Medidas, ve: Pick<QueSeVe, "revenue" | "cc">): ComponenteG[] =>
  ve.revenue && ve.cc ? piezasDeRevenueCC(m)
    : ve.revenue ? [{ concepto: "Revenue", valor: m.revenue, formato: "moneda", nota: `${m.ventas} ${m.ventas === 1 ? "venta" : "ventas"}, sin las canceladas ni las que son sólo reserva` }]
      : [{ concepto: "Cash Collected (CC)", valor: m.cc, formato: "moneda" }];

export const piezasDeRevenueCC = (m: Medidas): ComponenteG[] => [
  { concepto: "Revenue", valor: m.revenue, formato: "moneda", nota: `${m.ventas} ${m.ventas === 1 ? "venta" : "ventas"}, sin las canceladas ni las que son sólo reserva` },
  { concepto: "Cash Collected (CC)", valor: m.cc, formato: "moneda" },
  { concepto: "Tasa de cobro (CC ÷ Revenue)", valor: m.tasaCobro, formato: "pct", signo: "=" },
];
