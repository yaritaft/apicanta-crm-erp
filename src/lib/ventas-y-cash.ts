import { Contexto, type Corte } from "./kpis";
import { diaDeNegocio } from "./dia-negocio";
import { cuotasPorCobrar } from "./finanzas";
import type { EstadoApp, ID } from "./types";

/* ==================================================================
   Ventas y cash: lo vendido y lo cobrado, y nada más.

   Santiago (12/11): «nada más quiere ver los números de ventas y el cash collected». Finanzas era todo o nada, así que esto es lo único
   que sale de Finanzas para quien tiene el permiso «Ventas y cash» (permisos.ts, área `cash`): no lee gastos, movimientos, cuentas,
   honorarios ni comisiones. Sólo ventas, cuotas y cobros, que es lo que ya ve cualquiera que ve Ventas.

   Los números son los del Dashboard (Contexto, lib/kpis.ts), no otra cuenta: el Cash Collected de acá es el CC de allá.
   ================================================================== */

export interface FilaCash {
  id: string;
  nombre: string;
  /* Ventas del período, sin canceladas ni las que son sólo una reserva (como el Dashboard). */
  ventas: number;
  facturado: number;
  /* Lo que entró en el período de las ventas de esta fila, menos lo devuelto. */
  cobrado: number;
}

export interface DiaCash { dia: string; cobrado: number; cobros: number }

export interface ResumenCash {
  etiqueta: string;
  /* Cash Collected (CC): lo que entró menos lo devuelto. */
  cobrado: number;
  entrado: number;
  devuelto: number;
  /* Revenue: el precio acordado de las ventas del período, se haya cobrado o no. */
  facturado: number;
  /* CC sobre Revenue, en %. null si no se facturó nada. */
  tasaDeCobro: number | null;
  ventas: number;
  ticket: number | null;
  cobros: number;
  /* Fotos de hoy, no del período. */
  porCobrar: number;
  vencido: number;
  porServicio: FilaCash[];
  porVendedor: FilaCash[];
  porDia: DiaCash[];
}

const SIN = { servicio: "Sin servicio", vendedor: "Sin vendedor" };
const redondo = (n: number) => Math.round(n * 100) / 100;

/** Los números de ventas y cash de un período (días del negocio, inclusive). */
export function resumenDeCash(e: EstadoApp, desde: string, hasta: string, etiqueta = ""): ResumenCash {
  const corte: Corte = { clave: `${desde}_${hasta}`, titulo: etiqueta || `${desde} a ${hasta}`, desde, hasta, foto: true, total: true };
  const c = new Contexto(e, corte);
  const nombreDeServicio = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
  const nombreDeVendedor = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));

  const filas = {
    servicio: new Map<string, FilaCash>(),
    vendedor: new Map<string, FilaCash>(),
  };
  const fila = (tipo: "servicio" | "vendedor", id: ID | undefined): FilaCash => {
    const mapa = filas[tipo];
    const clave = id ?? "";
    let f = mapa.get(clave);
    if (!f) {
      const nombre = !id ? SIN[tipo] : (tipo === "servicio" ? nombreDeServicio : nombreDeVendedor).get(id) ?? SIN[tipo];
      f = { id: clave || `sin-${tipo}`, nombre, ventas: 0, facturado: 0, cobrado: 0 };
      mapa.set(clave, f);
    }
    return f;
  };
  const dias = new Map<string, DiaCash>();
  const dia = (d: string) => {
    let x = dias.get(d);
    if (!x) { x = { dia: d, cobrado: 0, cobros: 0 }; dias.set(d, x); }
    return x;
  };

  const contables = new Set(c.ventasContables().map((v) => v.id));
  for (const v of c.ventas()) {
    for (const [tipo, id] of [["servicio", v.productoId], ["vendedor", v.closerId]] as const) {
      const f = fila(tipo, id);
      f.facturado += v.precioAcordado;
      if (contables.has(v.id)) f.ventas += 1;
    }
  }
  for (const p of c.pagos()) {
    const venta = c.ix.ventaPorId.get(c.ix.cuotaPorId.get(p.cuotaId)?.ventaId ?? "");
    fila("servicio", venta?.productoId).cobrado += p.monto;
    fila("vendedor", venta?.closerId).cobrado += p.monto;
    const d = dia(diaDeNegocio(p.fecha));
    d.cobrado += p.monto;
    d.cobros += 1;
  }
  for (const dv of c.devoluciones()) {
    const venta = dv.ventaId ? c.ix.ventaPorId.get(dv.ventaId) : undefined;
    fila("servicio", venta?.productoId).cobrado -= dv.monto;
    fila("vendedor", venta?.closerId).cobrado -= dv.monto;
    dia(diaDeNegocio(dv.fecha)).cobrado -= dv.monto;
  }

  const ordenadas = (mapa: Map<string, FilaCash>) =>
    [...mapa.values()]
      .map((f) => ({ ...f, facturado: redondo(f.facturado), cobrado: redondo(f.cobrado) }))
      .filter((f) => f.ventas > 0 || Math.abs(f.cobrado) >= 0.005 || f.facturado > 0)
      .sort((a, b) => b.cobrado - a.cobrado || b.facturado - a.facturado || a.nombre.localeCompare(b.nombre, "es"));

  const cobrado = c.cobrado();
  const facturado = c.facturado();
  const ventas = c.ventasContables().length;
  return {
    etiqueta: corte.titulo,
    cobrado: redondo(cobrado), entrado: redondo(c.entrado()), devuelto: redondo(c.devuelto()),
    facturado: redondo(facturado),
    tasaDeCobro: facturado > 0 ? (cobrado / facturado) * 100 : null,
    ventas,
    ticket: ventas > 0 ? facturado / ventas : null,
    cobros: c.pagos().length,
    porCobrar: redondo(cuotasPorCobrar(e).reduce((a, x) => a + x.saldo, 0)),
    vencido: redondo(c.vencidas().reduce((a, x) => a + x.saldo, 0)),
    porServicio: ordenadas(filas.servicio),
    porVendedor: ordenadas(filas.vendedor),
    porDia: [...dias.values()].map((d) => ({ ...d, cobrado: redondo(d.cobrado) })).sort((a, b) => b.dia.localeCompare(a.dia)),
  };
}
