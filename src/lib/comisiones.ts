import type { AlcanceVentas, ConceptoPago, EsquemaPago, EstadoApp, ID, MiembroEquipo, Producto } from "./types";
import { categoriaPorDefecto, esComisionDeVentas, idEsquema } from "./honorarios";
import { tasaDeComision } from "./finanzas";

/* ==================================================================
   El cuadro «Cómo comisiona cada uno»: quién vende, agenda o dirige, y
   qué % cobra en cada servicio.

   "Quiero ver la configuración de las comisiones de los closers, es
   diferente el % por closer y por servicio vendido" (Angelo, 02/10).

   Cada persona tiene un % general y, si hace falta, uno propio para
   algunos servicios: en esas ventas vale el propio en vez del general.

   Para mirarlo alcanza con el equipo (`comisionRate`, `comisionServicios`),
   que lo ve cualquiera que entra a Finanzas. Para cambiarlo hace falta lo
   que cobra la persona (honorarios, sólo dueños): cada % es un concepto de
   su esquema, y de ahí salen la liquidación y lo que usa Finanzas.

   Sin React ni base, para poder probarlo.
   ================================================================== */

/* Quiénes van en el cuadro, en este orden. */
const ORDEN_ROL: Partial<Record<MiembroEquipo["rol"], number>> = { closer: 0, director: 1, setter: 2, ceo: 3 };

export interface FilaComision {
  miembro: MiembroEquipo;
  /* El % de lo que no tiene uno propio. */
  general: number;
  /* Los servicios con su propio %. */
  propios: Record<ID, number>;
  /* Sus ventas no le dejan comisión a nadie (Yari). */
  noComisiona: boolean;
  inactivo: boolean;
}

export const alcanceDe = (m: Pick<MiembroEquipo, "rol">): AlcanceVentas =>
  m.rol === "director" ? "director" : m.rol === "setter" ? "setter" : "closer";

/** Las personas que comisionan sobre ventas: closers, director y setters
 *  activos; los que ya no están pero siguen con un % (cobran las cuotas de
 *  sus ventas); y quien no comisiona, para que se vea por qué. */
export function quienesComisionan(e: Pick<EstadoApp, "equipo">): FilaComision[] {
  return e.equipo
    .filter((m) => m.rol in ORDEN_ROL && (m.rol !== "ceo" || m.sinComision))
    .map((m): FilaComision => ({
      miembro: m,
      general: m.comisionRate ?? 0,
      propios: m.comisionServicios ?? {},
      noComisiona: Boolean(m.sinComision),
      inactivo: !m.activo,
    }))
    .filter((f) => !f.inactivo || f.general > 0 || Object.values(f.propios).some((t) => t > 0))
    .sort((a, b) => Number(a.inactivo) - Number(b.inactivo)
      || Number(a.noComisiona) - Number(b.noComisiona)
      || (ORDEN_ROL[a.miembro.rol] ?? 9) - (ORDEN_ROL[b.miembro.rol] ?? 9)
      || a.miembro.nombre.localeCompare(b.miembro.nombre, "es"));
}

/** El % de una persona en un servicio: el propio, o el general. */
export const tasaEnServicio = (f: Pick<FilaComision, "miembro">, productoId: ID): number => tasaDeComision(f.miembro, productoId);

/** Los servicios que van como columna: los que alguien comisiona distinto
 *  y los que vendió, agendó o dirigió alguien del cuadro (los más vendidos
 *  primero); más los que se pidan a mano. */
export function serviciosDelCuadro(e: Pick<EstadoApp, "productos" | "ventas">, filas: FilaComision[], extra: ID[] = []): Producto[] {
  const quienes = new Set(filas.filter((f) => !f.noComisiona).map((f) => f.miembro.id));
  const ventas = new Map<ID, number>();
  for (const v of e.ventas) {
    if (v.estado === "cancelada" || !v.productoId) continue;
    if ([v.closerId, v.setterId, v.directorId].some((id) => id && quienes.has(id))) ventas.set(v.productoId, (ventas.get(v.productoId) ?? 0) + 1);
  }
  const conPropio = new Set(filas.flatMap((f) => Object.keys(f.propios)));
  return e.productos
    .filter((p) => ventas.has(p.id) || conPropio.has(p.id) || extra.includes(p.id))
    .sort((a, b) => (ventas.get(b.id) ?? 0) - (ventas.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre, "es"));
}

/* ---------- Cambiar un % ---------- */

const NOMBRE_GENERAL: Record<AlcanceVentas, string> = {
  closer: "Comisión", director: "Comisión de director", setter: "Comisión de setter", todas: "Comisión",
};

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const vale = (c: ConceptoPago, dia: string) => (!c.desde || c.desde.slice(0, 10) <= dia) && (!c.hasta || c.hasta.slice(0, 10) >= dia);

/* La comisión de las ventas de esta persona según su rol. */
const esSuya = (m: Pick<MiembroEquipo, "rol">, c: ConceptoPago) => esComisionDeVentas(c) && c.alcance === alcanceDe(m);

function idLibre(conceptos: ConceptoPago[], base: string): string {
  let id = base;
  for (let i = 2; conceptos.some((c) => c.id === id); i++) id = `${base}_${i}`;
  return id;
}

const esquemaDe = (esq: EsquemaPago | undefined, m: MiembroEquipo): EsquemaPago =>
  esq ?? { id: idEsquema(m.id), miembroId: m.id, conceptos: [], categoriaGasto: categoriaPorDefecto(m), actualizadoEn: "" };

/* La comisión general de la persona: la que vale hoy, o la que haya. */
function general(conceptos: ConceptoPago[], m: MiembroEquipo): ConceptoPago | undefined {
  const es = (c: ConceptoPago) => esSuya(m, c) && !c.productoIds?.length;
  const dia = hoy();
  return conceptos.find((c) => es(c) && vale(c, dia)) ?? conceptos.find(es);
}

/* Sin comisión general cargada, la que Finanzas ya le venía aplicando: si
   no, al guardar lo demás quedaría en 0%. */
function conGeneral(conceptos: ConceptoPago[], m: MiembroEquipo, tasa = m.comisionRate ?? 0): ConceptoPago[] {
  if (general(conceptos, m)) return conceptos;
  const alcance = alcanceDe(m);
  return [{
    id: idLibre(conceptos, "com_general"), tipo: "porcentaje", nombre: NOMBRE_GENERAL[alcance], moneda: "USD",
    tasa, base: "cash-neto", alcance,
  }, ...conceptos];
}

const tasaValida = (t: number) => Number.isFinite(t) && t >= 0 && t <= 1;

/** Lo que cobra la persona con ese % general (lo demás queda igual). */
export function conComisionGeneral(esq: EsquemaPago | undefined, m: MiembroEquipo, tasa: number): EsquemaPago {
  if (!tasaValida(tasa)) throw new Error("El porcentaje tiene que estar entre 0 y 100.");
  const base = esquemaDe(esq, m);
  const g = general(base.conceptos, m);
  const conceptos = g
    ? base.conceptos.map((c) => (c.id === g.id ? { ...c, tasa } : c))
    : conGeneral(base.conceptos, m, tasa);
  /* Un servicio que tenía «su propio %» igual al general nuevo ya no lo necesita. */
  return { ...base, conceptos: sinPropiosIguales(conceptos, m, tasa) };
}

function sinPropiosIguales(conceptos: ConceptoPago[], m: MiembroEquipo, tasaGeneral: number): ConceptoPago[] {
  return conceptos.filter((c) => !(esSuya(m, c) && c.productoIds?.length && c.id.startsWith("com_") && Math.abs((c.tasa ?? 0) - tasaGeneral) < 1e-9));
}

/** Lo que cobra la persona con ese % en ese servicio. `null` (o el mismo %
 *  que el general) lo devuelve a la comisión general. */
export function conComisionDeServicio(
  esq: EsquemaPago | undefined, m: MiembroEquipo, producto: Pick<Producto, "id" | "nombre">, tasa: number | null,
): EsquemaPago {
  if (tasa !== null && !tasaValida(tasa)) throw new Error("El porcentaje tiene que estar entre 0 y 100.");
  const base = esquemaDe(esq, m);
  let conceptos = conGeneral(base.conceptos, m);
  const tasaGeneral = general(conceptos, m)?.tasa ?? 0;
  const alcance = alcanceDe(m);

  /* Se saca el servicio de donde estuviera: una comisión que nombraba
     varios sigue con los demás; la que se queda sin ninguno, se va. */
  conceptos = conceptos.flatMap((c) => {
    if (!esSuya(m, c) || !c.productoIds?.includes(producto.id)) return [c];
    const resto = c.productoIds.filter((id) => id !== producto.id);
    return resto.length ? [{ ...c, productoIds: resto }] : [];
  });

  if (tasa !== null && Math.abs(tasa - tasaGeneral) > 1e-9) {
    conceptos = [...conceptos, {
      id: idLibre(conceptos, `com_${producto.id}`), tipo: "porcentaje", nombre: `Comisión · ${producto.nombre}`, moneda: "USD",
      tasa, base: general(conceptos, m)?.base ?? "cash-neto", alcance, productoIds: [producto.id],
    }];
  }
  return { ...base, conceptos };
}
