import { fechaLarga, pct, tasaTexto } from "./format";
import {
  comisionesDelDirector, comisionesPorCloser, devolucionesDelMes, feesPorProcesador, gastosPorCategoriaDetalle,
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
  /* Los retiros no están en el estado de resultados: no hay renglón que abrir. */
  directo: "directos", operativo: "operativos", dueno: "honorarios", retiro: "",
};

export function rutaDeGasto(g: Pick<Gasto, "id" | "grupo" | "categoria">): string[] {
  const r = RENGLON_DE_GRUPO[g.grupo];
  if (!r) return [];
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
  const servicioDe = (id?: string) => (producto(id) ? ` · ${producto(id)}` : "");
  /* El % de un closer en sus ventas del período: uno solo, o de cuánto a
     cuánto si comisiona distinto según el servicio. */
  const tasasDe = (ts: number[]) => {
    const u = [...new Set(ts.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
    return u.length <= 1 ? tasaTexto(u[0] ?? 0) : `${tasaTexto(u[0])} a ${tasaTexto(u[u.length - 1])} (según el servicio)`;
  };

  /* ---------- Ingresos: por cliente, pagos a lo cobrado y ventas a lo facturado ---------- */
  const subCliente = (c: IngresoCliente) =>
    [c.ventas.length ? cant(c.ventas.length, "venta", "ventas") : "", c.pagos.length ? cant(c.pagos.length, "cobro", "cobros") : ""]
      .filter(Boolean).join(" · ");

  const ingresos: NodoPyL = {
    id: "ingresos", titulo: "Ingresos", cc: p.cobrado, rev: p.revenue,
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
    notas: [
      "Lo cobrado son los pagos que entraron en el período; lo facturado, el precio de las ventas cerradas en el período."
      + (p.devoluciones > 0 ? " Lo que se devolvió se resta en el renglón de abajo." : ""),
    ],
  };

  /* ---------- Devoluciones: lo que se devolvió a clientes en el período ---------- */
  const devs = devolucionesDelMes(e, mes).sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
  const devolucion = (id?: string) => (id ? (e.devoluciones ?? []).find((d) => d.id === id) : undefined);
  const devoluciones: NodoPyL | null = devs.length === 0 ? null : {
    id: "devoluciones", titulo: "Devoluciones", sub: "Plata devuelta a clientes",
    cc: -p.devoluciones, rev: -p.devoluciones,
    hijos: devs.map((d): NodoPyL => ({
      id: `devoluciones/d:${d.id}`,
      titulo: ventaDe(d.ventaId)?.contactoNombre ?? "Venta sin identificar",
      sub: [
        `devuelta el ${fechaLarga(d.fecha)}`, medio(d.procesadorId), producto(ventaDe(d.ventaId)?.productoId),
        d.noDescontarAlCloser ? "sin descontar al closer" : "", d.referencia ? "la confirma la pasarela" : "",
      ].filter(Boolean).join(" · "),
      cc: -d.monto, rev: -d.monto, href: hrefVenta(d.ventaId),
    })),
    notas: [
      "Resta en el mes en que se devolvió la plata, en las dos columnas. La venta sigue contando en su mes y la comisión de la pasarela no se devuelve.",
    ],
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
          ? `${tasasDe(g.ventas.map((c) => c.tasaCloser))} del cobrado neto de procesador · ${cant(g.ventas.length, "venta", "ventas")}`
          : `Ventas sin closer · ${cant(g.ventas.length, "venta", "ventas")}`,
      cc: -g.total, rev: -g.total,
      hijos: g.ventas.map((c): NodoPyL => ({
        id: `closers/${g.clave}/v:${c.id}`,
        titulo: c.devolucionId ? `Devolución de ${ventaDe(c.ventaId)?.contactoNombre ?? "una venta"}` : ventaDe(c.ventaId)?.contactoNombre ?? "Venta",
        sub: c.devolucionId
          ? `Se revierte lo que se le comisionó (${tasaTexto(c.tasaCloser)} de ${M(-c.netoProcesador, 2)} neto de procesador, la parte devuelta el ${fechaLarga(devolucion(c.devolucionId)?.fecha)})${servicioDe(c.productoId)}`
          : c.sinComision
          ? `${M(c.cobradoEnMes, 2)} cobrado · sin comisión`
          : `${tasaTexto(c.tasaCloser)} de ${M(c.netoProcesador, 2)} neto de procesador (${M(c.cobradoEnMes, 2)} cobrado)${servicioDe(c.productoId)}${c.heredadaDe ? ` · cuotas heredadas de ${c.heredadaDe}` : ""}`,
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
        id: `director/v:${c.id}`,
        titulo: c.devolucionId ? `Devolución de ${ventaDe(c.ventaId)?.contactoNombre ?? "una venta"}` : ventaDe(c.ventaId)?.contactoNombre ?? "Venta",
        sub: c.devolucionId
          ? `${d?.nombre ?? "Director"} · se revierte lo que se le comisionó (${tasaTexto(c.tasaDirector)} de lo cobrado neto de procesador, la parte devuelta el ${fechaLarga(devolucion(c.devolucionId)?.fecha)})${servicioDe(c.productoId)}`
          : `${d?.nombre ?? "Director"} · ${tasaTexto(c.tasaDirector)} de ${M(c.netoProcesador, 2)} neto de procesador${servicioDe(c.productoId)}`,
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
      { id: "bruta/ingresos", titulo: "Ingresos", cc: p.cobrado, rev: p.revenue },
      ...(devoluciones ? [{ id: "bruta/devoluciones", titulo: "Devoluciones", cc: -p.devoluciones, rev: -p.devoluciones }] : []),
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
    id: "neto", titulo: "Profit neto", sub: "Rentabilidad neta: Profit on CC y Profit on Revenue", cc: p.netoCC, rev: p.netoRev, estilo: "neto",
    hijos: [
      { id: "neto/resultado", titulo: "Resultado operativo", cc: p.operativoCC, rev: p.operativoRev },
      { id: "neto/honorarios", titulo: "Honorarios del dueño", cc: -p.honorariosCeo, rev: -p.honorariosCeo },
    ],
    notas: [
      `Profit on Cash Collected (CC), lo que de verdad quedó: ${M(p.netoCC, 2)} · Profit on Revenue, lo que en teoría ganaste por las ventas: ${M(p.netoRev, 2)}.`,
      `Margen neto: ${margen(p.netoCC, p.cashCollected)} sobre lo cobrado · ${margen(p.netoRev, p.revenue)} sobre lo facturado.`,
    ],
  };

  return [
    ingresos,
    ...(devoluciones ? [devoluciones] : []),
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

/* ==================================================================
   «Cómo se calcula» de cada renglón del estado de resultados.

   Angelo (06/10): cada métrica con su ícono de información, para ver la
   cuenta y no confiarse. Los números salen del mismo PyL que dibuja la
   pantalla: no se recalcula nada.
   ================================================================== */

export interface FilaAyuda { concepto: string; valor: string; signo?: "+" | "−" | "="; nota?: string }
export interface SeccionAyuda { titulo: string; filas: FilaAyuda[] }
export interface AyudaRenglon {
  ayuda: string;
  formula: string;
  ejemplo?: string;
  /* Con los números del período, una sección por columna. */
  secciones?: SeccionAyuda[];
}

export function ayudaDeRenglon(id: string, p: PyL, M: FmtMonto): AyudaRenglon | undefined {
  const f = (concepto: string, n: number, signo?: FilaAyuda["signo"], nota?: string): FilaAyuda => ({ concepto, valor: M(n, 2), signo, nota });
  const costos = (): FilaAyuda[] => [
    f("Comisiones de closers", p.comisionCloser, "−"), f("Comisión del director", p.comisionDirector, "−"),
    f("Procesadores de pago", p.feesProcesador, "−"), f("Otros costos directos", p.otrosDirectos, "−"),
  ];

  switch (id) {
    case "ingresos": return {
      ayuda: "Lo que entró a la cuenta y lo que se vendió en el período: son las dos columnas del estado de resultados.",
      formula: "Sobre lo cobrado: suma de los pagos que entraron en el período, sin importar cuándo se hizo la venta.\nSobre lo facturado: suma del precio de las ventas cerradas en el período, sin las canceladas, se hayan cobrado o no.\nLo que se devolvió no se resta acá: va en su propio renglón, justo abajo.",
      ejemplo: "Si vendiste US$ 16.000 y de eso (más cuotas de meses anteriores) entraron US$ 10.000, Ingresos muestra US$ 10.000 cobrado y US$ 16.000 facturado.",
    };
    case "devoluciones": return {
      ayuda: "La plata que se le devolvió a clientes en el período. Resta en el mes en que se devuelve la plata, no en el de la venta.",
      formula: "Suma de las devoluciones con fecha del período. Resta en las dos columnas: de lo cobrado (así el Cash Collected queda sin lo devuelto) y de lo facturado.\nLa venta sigue contando en su mes, y la comisión de la pasarela no se devuelve: sigue en «Procesadores de pago».\nA los closers y al director se les revierte lo que se les había comisionado (menos si la devolución dice «no descontar al closer»): sale como una línea en negativo en sus comisiones.",
      ejemplo: "Una venta de septiembre se devuelve el 3 de octubre: septiembre queda como estaba; octubre muestra la devolución restando del Cash Collected, y la comisión que se le había pagado al closer vuelve como una línea en negativo.",
    };
    case "closers": return {
      ayuda: "Lo que se les debe a los closers por lo que se cobró en el período.",
      formula: "Por cada venta con cobros en el período: (lo cobrado − lo que se quedó el procesador) × % del closer en ese servicio.\nSi la cerró alguien que no comisiona (Yari), nadie comisiona.\nSi en el período se devolvió plata de una venta, se resta lo que se le había comisionado por lo devuelto (una línea en negativo), salvo que la devolución diga «no descontar al closer».",
      ejemplo: "Un closer cobró US$ 2.000 de un cliente y el procesador se quedó US$ 100: comisiona sobre US$ 1.900. Con un 10%, son US$ 190.",
    };
    case "director": return {
      ayuda: "Lo que se le debe al director por lo que se cobró en el período.",
      formula: "Por cada venta con cobros en el período: (lo cobrado − lo que se quedó el procesador) × % del director en ese servicio.\nUna devolución le resta lo que se le había comisionado por lo devuelto (una línea en negativo), salvo que diga «no descontar al closer».",
    };
    case "procesadores": return {
      ayuda: "Lo que se quedaron Stripe, Hotmart y compañía de los pagos del período.",
      formula: "Suma, de cada pago del período, de monto × la tasa de la cuenta recaudadora (o la comisión real, si el cobro se concilió con la pasarela).",
    };
    case "directos": return {
      ayuda: "Costos de vender que no son comisiones ni procesadores: setters, financieras, referidores.",
      formula: "Suma de los gastos del período cargados como costos directos.",
    };
    case "bruta": return {
      ayuda: "Lo que queda de los ingresos después de los costos directos de vender.",
      formula: "Ingresos − Devoluciones − Comisiones de closers − Comisión del director − Procesadores de pago − Otros costos directos",
      ejemplo: "Cobraste US$ 10.000 y los costos directos fueron US$ 2.000: la utilidad bruta es US$ 8.000.",
      secciones: [
        {
          titulo: "Sobre lo cobrado",
          filas: p.devoluciones
            ? [f("Cobrado en el período", p.cobrado), f("Devoluciones", p.devoluciones, "−", "Cash Collected (CC) = cobrado − devoluciones"), ...costos(), f("Utilidad bruta", p.brutoCC, "=")]
            : [f("Cash Collected (CC)", p.cashCollected), ...costos(), f("Utilidad bruta", p.brutoCC, "=")],
        },
        {
          titulo: "Sobre lo facturado",
          filas: [f("Revenue", p.revenue), ...(p.devoluciones ? [f("Devoluciones", p.devoluciones, "−")] : []), ...costos(), f("Utilidad bruta", p.brutoRev, "=")],
        },
      ],
    };
    case "operativos": return {
      ayuda: "Lo que cuesta tener el negocio andando, publicidad incluida.",
      formula: "Suma de los gastos del período cargados como operativos: publicidad (Meta, Google y TikTok), sueldos fijos, herramientas.",
    };
    case "resultado": return {
      ayuda: "Lo que deja el negocio antes de los honorarios del dueño. De acá sale el reparto del growth partner y del socio.",
      formula: "Utilidad bruta − Gastos operativos",
      secciones: [
        { titulo: "Sobre lo cobrado", filas: [f("Utilidad bruta", p.brutoCC), f("Gastos operativos", p.gastosOperativos, "−"), f("Resultado operativo", p.operativoCC, "=")] },
        { titulo: "Sobre lo facturado", filas: [f("Utilidad bruta", p.brutoRev), f("Gastos operativos", p.gastosOperativos, "−"), f("Resultado operativo", p.operativoRev, "=")] },
      ],
    };
    case "honorarios": return {
      ayuda: "Lo que se lleva el dueño por su trabajo.",
      formula: "Suma de los gastos del período cargados como honorarios del dueño.",
    };
    case "neto": return {
      ayuda: "Lo que de verdad queda. Sobre lo cobrado se llama Profit on Cash Collected (CC); sobre lo facturado, Profit on Revenue.",
      formula: "Resultado operativo − Honorarios del dueño\n= Cash Collected (CC) o Revenue − costos directos − gastos operativos − honorarios",
      ejemplo: "Entraron US$ 10.000 y se vendieron US$ 16.000; los costos directos son US$ 2.000, los gastos operativos US$ 4.000 y los honorarios US$ 1.000. Profit on CC = 3.000. Profit on Revenue = 9.000.",
      secciones: [
        { titulo: "Profit on Cash Collected (CC)", filas: [f("Resultado operativo (cobrado)", p.operativoCC), f("Honorarios del dueño", p.honorariosCeo, "−"), f("Profit on Cash Collected (CC)", p.netoCC, "=")] },
        { titulo: "Profit on Revenue", filas: [f("Resultado operativo (facturado)", p.operativoRev), f("Honorarios del dueño", p.honorariosCeo, "−"), f("Profit on Revenue", p.netoRev, "=")] },
      ],
    };
    default: return undefined;
  }
}
