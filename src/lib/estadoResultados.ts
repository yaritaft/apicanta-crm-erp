import { fechaLarga, pct } from "./format";
import {
  comisionesDelDirector, comisionesPorCloser, feesPorProcesador, gastosPorCategoriaDetalle,
  ingresosPorCliente, type IngresoCliente, type PyL,
} from "./finanzas";
import type { RangoMes } from "./metricas";
import type { Cuota, EstadoApp, Gasto, GrupoGasto } from "./types";

/* ==================================================================
   El estado de resultados como árbol: cada renglón con lo que lo forma.

   Es sólo datos, sin React, para que la pantalla lo dibuje y para poder
   comprobar que cada detalle suma lo mismo que su renglón.

   Todo sale de las mismas funciones que calcularPyL: el detalle de
   Ingresos es pagosDelMes y ventasDelMes agrupados por cliente, el de
   comisiones es comisionesDelMes por persona, y así. Por eso los
   subtotales coinciden con el renglón en las dos columnas.
   ================================================================== */

export interface NodoPyL {
  id: string;
  titulo: string;
  sub?: string;
  /* null: ese renglón no cuenta en esa columna (un pago no es facturado). */
  cc: number | null;
  rev: number | null;
  href?: string;
  /* Con `hijos`, aunque sea una lista vacía, el renglón se abre. */
  hijos?: NodoPyL[];
  vacio?: string;
  /* Van al final del detalle y no suman: márgenes, aclaraciones. */
  notas?: string[];
  estilo?: "resultado" | "neto";
}

export interface BloquePyL { bloque: string; id: string }
export type ItemPyL = NodoPyL | BloquePyL;

export const esBloque = (x: ItemPyL): x is BloquePyL => "bloque" in x;

/* Cuántos renglones se ven antes de "Ver N más": 60 clientes abiertos de
   una empujan el resto del estado fuera de la pantalla. */
export const TOPE = 12;

/* El renglón del P&L en el que cae cada grupo de gasto. Lo usa la página
   para abrir el renglón del gasto que se acaba de cargar. */
export const RENGLON_DE_GRUPO: Record<GrupoGasto, string> = {
  directo: "directos", operativo: "operativos", dueno: "honorarios",
};

export function rutaDeGasto(g: Pick<Gasto, "id" | "grupo" | "categoria">): string[] {
  const r = RENGLON_DE_GRUPO[g.grupo];
  return [r, `${r}/c:${g.categoria}`, `${r}/c:${g.categoria}/g:${g.id}`];
}

export type FmtMonto = (n: number, d?: number) => string;

export function armarEstadoResultados(
  e: EstadoApp, mes: RangoMes, p: PyL, M: FmtMonto, hrefGasto: (id: string) => string,
): ItemPyL[] {
  const producto = (id?: string) => e.productos.find((x) => x.id === id)?.nombre;
  const medio = (id?: string) => e.procesadores.find((x) => x.id === id)?.nombre;
  const ventaDe = (id?: string) => (id ? e.ventas.find((v) => v.id === id) : undefined);
  const hrefVenta = (id?: string) => (id ? `/ventas?ver=${id}` : undefined);
  const cuota = (c?: Cuota) => (!c ? "Pago" : c.esReserva ? "Reserva" : `Cuota ${c.numero}`);
  const cant = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const margen = (a: number, b: number) => (b > 0 ? pct((a / b) * 100, 1) : "—");

  /* ---------- Ingresos: por cliente, pagos a lo cobrado y ventas a lo facturado ---------- */
  const subCliente = (c: IngresoCliente) =>
    [c.ventas.length ? cant(c.ventas.length, "venta", "ventas") : "", c.pagos.length ? cant(c.pagos.length, "cobro", "cobros") : ""]
      .filter(Boolean).join(" · ");

  const ingresos: NodoPyL = {
    id: "ingresos", titulo: "Ingresos", cc: p.cashCollected, rev: p.revenue,
    vacio: "No entró ningún pago ni se cerró ninguna venta en este período.",
    hijos: ingresosPorCliente(e, mes).map((c) => ({
      id: `ingresos/${c.clave}`, titulo: c.nombre, sub: subCliente(c),
      /* Sin pagos o sin ventas en el período, esa columna va con raya y no
         con un cero: no es que haya facturado cero, es que no vendió acá. */
      cc: c.pagos.length ? c.cobrado : null,
      rev: c.ventas.length ? c.facturado : null,
      hijos: [
        ...c.ventas.map((v): NodoPyL => ({
          id: `ingresos/${c.clave}/v:${v.id}`,
          titulo: `Venta: ${producto(v.productoId) ?? "sin producto"}`,
          sub: `cerrada el ${fechaLarga(v.fecha)}`,
          cc: null, rev: v.precioAcordado, href: hrefVenta(v.id),
        })),
        ...c.pagos.map((x): NodoPyL => ({
          id: `ingresos/${c.clave}/p:${x.pago.id}`,
          titulo: `Cobro: ${cuota(x.cuota).toLowerCase()}`,
          sub: [`entró el ${fechaLarga(x.pago.fecha)}`, medio(x.pago.procesadorId)].filter(Boolean).join(" · "),
          cc: x.pago.monto, rev: null, href: hrefVenta(x.venta?.id),
        })),
      ],
    })),
    notas: ["Lo cobrado son los pagos que entraron en el período; lo facturado, el precio de las ventas cerradas en el período."],
  };

  /* ---------- Comisiones de closers: por persona y dentro por venta ---------- */
  const closers: NodoPyL = {
    id: "closers", titulo: "Comisiones de closers", cc: -p.comisionCloser, rev: -p.comisionCloser,
    vacio: "No entró plata de ninguna venta en este período.",
    hijos: comisionesPorCloser(e, mes).map((g) => ({
      id: `closers/${g.clave}`, titulo: g.nombre,
      sub: g.sinComision
        ? `No comisiona nadie · ${cant(g.ventas.length, "venta", "ventas")}`
        : g.closerId
          ? `${pct(g.tasa * 100, 0)} del cobrado neto de procesador · ${cant(g.ventas.length, "venta", "ventas")}`
          : `Ventas sin closer · ${cant(g.ventas.length, "venta", "ventas")}`,
      cc: -g.total, rev: -g.total,
      hijos: g.ventas.map((c): NodoPyL => ({
        id: `closers/${g.clave}/v:${c.ventaId}`,
        titulo: ventaDe(c.ventaId)?.contactoNombre ?? "Venta",
        sub: c.sinComision
          ? `${M(c.cobradoEnMes, 2)} cobrado · sin comisión`
          : `${M(c.cobradoEnMes, 2)} cobrado · ${M(c.netoProcesador, 2)} neto de procesador`,
        cc: -c.comisionCloser, rev: -c.comisionCloser, href: hrefVenta(c.ventaId),
      })),
    })),
  };

  /* ---------- Comisión del director: por venta ---------- */
  const dir = comisionesDelDirector(e, mes);
  const director: NodoPyL = {
    id: "director", titulo: "Comisión del director", cc: -p.comisionDirector, rev: -p.comisionDirector,
    vacio: "Ninguna venta cobrada en este período le deja comisión al director.",
    hijos: dir.ventas.map((c): NodoPyL => {
      const d = e.equipo.find((x) => x.id === c.directorId);
      return {
        id: `director/v:${c.ventaId}`,
        titulo: ventaDe(c.ventaId)?.contactoNombre ?? "Venta",
        sub: `${d?.nombre ?? "Director"} · ${pct((d?.comisionRate ?? 0) * 100, 0)} de ${M(c.netoProcesador, 2)} neto de procesador`,
        cc: -c.comisionDirector, rev: -c.comisionDirector, href: hrefVenta(c.ventaId),
      };
    }),
    notas: dir.sinComision > 0
      ? [`${cant(dir.sinComision, "venta cobrada no le deja", "ventas cobradas no le dejan")} comisión: las cerró alguien que no comisiona, o no tienen director.`]
      : undefined,
  };

  /* ---------- Procesadores: por medio de pago ---------- */
  const fees = feesPorProcesador(e, mes);
  const procesadores: NodoPyL = {
    id: "procesadores", titulo: "Procesadores de pago", cc: -p.feesProcesador, rev: -p.feesProcesador,
    vacio: "Ningún cobro del período dejó costo de procesador.",
    hijos: fees.procesadores.map((g) => ({
      id: `procesadores/${g.clave}`, titulo: g.nombre, sub: cant(g.pagos.length, "cobro", "cobros"),
      cc: -g.total, rev: -g.total,
      hijos: g.pagos.map((x): NodoPyL => ({
        id: `procesadores/${g.clave}/p:${x.pago.id}`,
        titulo: x.venta?.contactoNombre ?? "Pago sin venta",
        sub: `${cuota(x.cuota)} · ${fechaLarga(x.pago.fecha)} · ${pct(x.pago.feeRate * 100, 1)} de ${M(x.pago.monto, 2)}`,
        cc: -x.pago.feeMonto, rev: -x.pago.feeMonto, href: hrefVenta(x.venta?.id),
      })),
    })),
    notas: fees.sinFee > 0
      ? [`${cant(fees.sinFee, "cobro no tuvo", "cobros no tuvieron")} costo de procesador (transferencias, USDT, efectivo).`]
      : undefined,
  };

  /* ---------- Gastos: por categoría, y cada categoría en sus gastos ---------- */
  const gastos = (id: string, titulo: string, grupo: GrupoGasto, total: number, vacio: string): NodoPyL => {
    const categorias = gastosPorCategoriaDetalle(e, mes, grupo).map((c): NodoPyL => ({
      id: `${id}/c:${c.categoria}`, titulo: c.categoria, sub: cant(c.gastos.length, "gasto", "gastos"),
      cc: -c.total, rev: -c.total,
      hijos: c.gastos.map((g): NodoPyL => ({
        id: `${id}/c:${c.categoria}/g:${g.id}`,
        titulo: g.concepto || c.categoria,
        sub: [fechaLarga(g.fecha), g.proveedor, g.recurrente ? "fijo" : ""].filter(Boolean).join(" · "),
        cc: -g.monto, rev: -g.monto, href: hrefGasto(g.id),
      })),
    }));
    /* Una sola categoría que se llama igual que el renglón ("Honorarios del
       CEO" dentro de "Honorarios del CEO") es un escalón que no dice nada:
       se ven sus gastos directo. */
    const hijos = categorias.length === 1 && categorias[0].titulo === titulo ? categorias[0].hijos : categorias;
    return { id, titulo, cc: -total, rev: -total, vacio, hijos };
  };

  const otrosDirectos = gastos("directos", "Otros costos directos", "directo", p.otrosDirectos,
    "No cargaste costos directos en este período: setters, financiera, referidores.");

  const operativos = gastos("operativos", "Gastos operativos", "operativo", p.gastosOperativos,
    "No cargaste gastos operativos en este período.");
  if (p.inversionAds > 0) {
    operativos.notas = [`De esto, ${M(p.inversionAds, 2)} es publicidad (Meta, Google y TikTok): con eso se calculan el ROAS y el CAC.`];
  }

  const honorarios = gastos("honorarios", "Honorarios del CEO", "dueno", p.honorariosCeo,
    "No hay honorarios cargados en este período.");

  /* ---------- Los resultados se abren en su cuenta ---------- */
  const bruta: NodoPyL = {
    id: "bruta", titulo: "Utilidad bruta", cc: p.brutoCC, rev: p.brutoRev, estilo: "resultado",
    hijos: [
      { id: "bruta/ingresos", titulo: "Ingresos", cc: p.cashCollected, rev: p.revenue },
      { id: "bruta/directos", titulo: "Costos directos", sub: "Closers, director, procesadores y otros", cc: -p.totalDirectos, rev: -p.totalDirectos },
    ],
    notas: [`Margen bruto: ${margen(p.brutoCC, p.cashCollected)} sobre lo cobrado · ${margen(p.brutoRev, p.revenue)} sobre lo facturado.`],
  };

  const reparto = p.growth > 0 || p.socio > 0
    ? [`Del resultado sobre lo cobrado sale el reparto: growth partner ${M(p.growth, 2)} y socio ${M(p.socio, 2)}. No se resta acá.`]
    : [];
  const resultado: NodoPyL = {
    id: "resultado", titulo: "Resultado operativo", cc: p.operativoCC, rev: p.operativoRev, estilo: "resultado",
    hijos: [
      { id: "resultado/bruta", titulo: "Utilidad bruta", cc: p.brutoCC, rev: p.brutoRev },
      { id: "resultado/operativos", titulo: "Gastos operativos", cc: -p.gastosOperativos, rev: -p.gastosOperativos },
    ],
    notas: [
      `Margen operativo: ${margen(p.operativoCC, p.cashCollected)} sobre lo cobrado · ${margen(p.operativoRev, p.revenue)} sobre lo facturado.`,
      ...reparto,
    ],
  };

  const neto: NodoPyL = {
    id: "neto", titulo: "Rentabilidad neta", cc: p.netoCC, rev: p.netoRev, estilo: "neto",
    hijos: [
      { id: "neto/resultado", titulo: "Resultado operativo", cc: p.operativoCC, rev: p.operativoRev },
      { id: "neto/honorarios", titulo: "Honorarios del dueño", cc: -p.honorariosCeo, rev: -p.honorariosCeo },
    ],
    notas: [`Margen neto: ${margen(p.netoCC, p.cashCollected)} sobre lo cobrado · ${margen(p.netoRev, p.revenue)} sobre lo facturado.`],
  };

  return [
    ingresos,
    { bloque: "Costos directos", id: "b-directos" },
    closers, director, procesadores, otrosDirectos,
    bruta,
    operativos,
    resultado,
    /* Como antes: el bloque del dueño aparece cuando hay algo cargado. */
    ...(p.honorariosCeo !== 0 ? [{ bloque: "Honorarios del dueño", id: "b-dueno" }, honorarios] : []),
    neto,
  ];
}

/* Los ids de todo lo que se puede abrir: lo que abre «Expandir todo». */
export function abribles(items: ItemPyL[]): string[] {
  const out: string[] = [];
  const recorrer = (n: NodoPyL) => {
    if (!n.hijos) return;
    out.push(n.id);
    n.hijos.forEach(recorrer);
  };
  items.forEach((x) => { if (!esBloque(x)) recorrer(x); });
  return out;
}
