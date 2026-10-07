import type { Contexto } from "./kpis";
import type { Alumno, Contacto, Devolucion, Gasto, ID, Lead, Movimiento, Pago, Sesion, Venta, Webinar } from "./types";
import type { ComisionVenta, CuotaVencida } from "./finanzas";
import { filasMeta } from "./metricas";
import { evaluarAgenda } from "./calificacion";
import { fecha, money, num, relativo } from "./format";
import { CANCELADA, CON_CIERRE, estadoVisible, HECHA, NO_SE_PRESENTO, POR_VENIR, REPROGRAMO, SIN_CARGAR, SIN_CIERRE } from "./estados";

/* ==================================================================
   Qué forma cada número del Dashboard: los registros que se pueden ir a
   ver (02/10: "que estas cosas sean clickeables... si hago click en
   agendas, que me salgan las agendas; en canceladas, las canceladas; en
   la plata en anuncios, los anuncios").

   Cada lista sale de la MISMA cuenta que el número (lib/kpis.ts la arma
   con su Contexto): el panel no puede sumar distinto que la celda que lo
   abrió. Las tasas y los costos por unidad no tienen qué mostrar: no se
   abren.

   Acá, cómo se ve cada tipo de registro en la lista. Sin pantalla: sale
   texto y a dónde lleva cada fila (la ficha, el anuncio o una pantalla).
   ================================================================== */

export interface FilaDetalle {
  id: string;
  titulo: string;
  detalle?: string;
  valor?: string;
  /* A dónde lleva el clic: la ficha de la persona… */
  ficha?: { id: ID; vista?: "llamadas" | "ventas" | "servicio"; venta?: ID };
  /* …el detalle del anuncio, como en Marketing… */
  anuncio?: ID;
  /* …o una pantalla. */
  href?: string;
  marca?: { texto: string; variante: "success" | "danger" | "warning" | "info" | "neutral" };
}
export interface SeccionDetalle { titulo?: string; total?: string; filas: FilaDetalle[]; vacio?: string }
export interface PartesDetalle { resumen: { etiqueta: string; valor: string }[]; secciones: SeccionDetalle[] }

const plata = (c: Contexto, n: number, decimales = 0) => money(n, c.e.ajustes.monedaBase, decimales);
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
/* El Estado de Llamada de cada una, el mismo del CRM y la Agenda
   (lib/estados.ts); el color, por cómo terminó. */
const TONO: Record<string, NonNullable<FilaDetalle["marca"]>["variante"]> = {
  [CON_CIERRE]: "success", [SIN_CIERRE]: "warning", [NO_SE_PRESENTO]: "danger", [CANCELADA]: "neutral",
  [REPROGRAMO]: "neutral", [SIN_CARGAR]: "warning", [POR_VENIR]: "info",
};
function marcaDeLlamada(c: Contexto, s: Sesion): FilaDetalle["marca"] {
  const ver = estadoVisible(c.e, s);
  return { texto: ver.texto || ver.desenlace, variante: ver.texto === HECHA ? "success" : TONO[ver.desenlace] ?? "neutral" };
}

/* ---------- Llamadas ---------- */

export function deLlamadas(c: Contexto, sesiones: Sesion[], orden: "llamada" | "agendo" = "llamada"): PartesDetalle {
  const persona = (s: Sesion) => c.ix.contactoPorId.get(s.contactoId ?? "") ?? c.ix.leadPorId.get(s.leadId ?? "");
  const cuando = (s: Sesion) => (orden === "agendo" ? s.creadoEn : s.inicia);
  const lista = [...sesiones].sort((a, b) => cuando(b).localeCompare(cuando(a)));
  const calificadas = lista.filter((s) => evaluarAgenda(s, persona(s)).calificada).length;
  return {
    resumen: [{ etiqueta: "Llamadas", valor: num(lista.length) }, { etiqueta: "Calificadas", valor: num(calificadas) }],
    secciones: [{
      filas: lista.map((s) => ({
        id: s.id, titulo: s.invitado || persona(s)?.nombre || "Sin nombre",
        detalle: [`${fecha(s.inicia)} · ${HORA.format(new Date(s.inicia))} hs`, s.anfitrion, orden === "agendo" ? `agendó ${relativo(s.creadoEn)}` : ""].filter(Boolean).join(" · "),
        ficha: { id: s.contactoId ?? s.leadId ?? s.id, vista: "llamadas" as const },
        marca: marcaDeLlamada(c, s),
      })),
      vacio: "Ninguna llamada en este período.",
    }],
  };
}

/* ---------- Ventas ---------- */

export function deVentas(c: Contexto, ventas: Venta[]): PartesDetalle {
  const lista = [...ventas].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const producto = new Map(c.e.productos.map((p) => [p.id, p.nombre]));
  const closer = new Map(c.e.equipo.map((m) => [m.id, m.nombre]));
  return {
    resumen: [{ etiqueta: "Ventas", valor: num(lista.length) }, { etiqueta: "Facturado", valor: plata(c, lista.reduce((a, v) => a + v.precioAcordado, 0)) }],
    secciones: [{
      filas: lista.map((v) => {
        const cuotas = c.cuotasDe(v).length;
        return {
          id: v.id, titulo: v.contactoNombre || "Venta sin nombre", valor: money(v.precioAcordado, v.moneda),
          detalle: [(v.productoId && producto.get(v.productoId)) || "Venta", fecha(v.fecha), v.closerId ? closer.get(v.closerId) : "", cuotas > 1 ? `${cuotas} cuotas` : cuotas === 1 ? "1 pago" : ""].filter(Boolean).join(" · "),
          ficha: { id: v.id, vista: "ventas" as const, venta: v.id },
          marca: v.estado === "cancelada" ? { texto: "Cancelada", variante: "danger" as const }
            : v.estado === "reembolsada" ? { texto: "Reembolsada", variante: "warning" as const } : undefined,
        };
      }),
      vacio: "Ninguna venta en este período.",
    }],
  };
}

/* ---------- Pagos, comisiones y fees ---------- */

function filaDePago(c: Contexto, p: Pago, valor: number, titulo?: string): FilaDetalle {
  const cuota = c.ix.cuotaPorId.get(p.cuotaId);
  const v = cuota ? c.ix.ventaPorId.get(cuota.ventaId) : undefined;
  const procesador = c.e.procesadores.find((x) => x.id === p.procesadorId)?.nombre;
  return {
    id: p.id, titulo: titulo ?? v?.contactoNombre ?? "Pago sin venta", valor: plata(c, valor, Math.abs(valor) < 10 ? 2 : 0),
    detalle: [titulo ? v?.contactoNombre : "", !cuota ? "Pago" : cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`, fecha(p.fecha), procesador].filter(Boolean).join(" · "),
    ficha: v ? { id: v.id, vista: "ventas" as const, venta: v.id } : undefined,
  };
}

export function dePagos(c: Contexto, pagos: Pago[]): PartesDetalle {
  const lista = [...pagos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return {
    resumen: [{ etiqueta: "Cobrado", valor: plata(c, lista.reduce((a, p) => a + p.monto, 0)) }, { etiqueta: "Pagos", valor: num(lista.length) }],
    secciones: [{ filas: lista.map((p) => filaDePago(c, p, p.monto)), vacio: "No entró ningún pago en este período." }],
  };
}

/** Las devoluciones del período, una por una: cada una con su cliente, el
 *  medio por el que salió la plata y a qué venta lleva. */
export function deDevoluciones(c: Contexto, devoluciones: Devolucion[]): PartesDetalle {
  const lista = [...devoluciones].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const filaDeDevolucion = (d: Devolucion): FilaDetalle => {
    const v = d.ventaId ? c.ix.ventaPorId.get(d.ventaId) : undefined;
    const procesador = c.e.procesadores.find((x) => x.id === d.procesadorId)?.nombre;
    return {
      id: d.id, titulo: v?.contactoNombre ?? "Venta sin identificar", valor: plata(c, -d.monto, Math.abs(d.monto) < 10 ? 2 : 0),
      detalle: ["Devolución", fecha(d.fecha), procesador, d.noDescontarAlCloser ? "sin descontar al closer" : ""].filter(Boolean).join(" · "),
      ficha: v ? { id: v.id, vista: "ventas" as const, venta: v.id } : undefined,
      marca: { texto: "Devuelto", variante: "danger" as const },
    };
  };
  return {
    resumen: [{ etiqueta: "Devuelto", valor: plata(c, lista.reduce((a, d) => a + d.monto, 0)) }, { etiqueta: "Devoluciones", valor: num(lista.length) }],
    secciones: [{ filas: lista.map(filaDeDevolucion), vacio: "No se devolvió plata en este período." }],
  };
}

/** El Cash Collected: los pagos que entraron y, aparte, lo que se devolvió, que
 *  resta. Las dos listas son las mismas que cuenta el número. */
export function deCashCollected(c: Contexto): PartesDetalle {
  const cobros = dePagos(c, c.pagos());
  const devoluciones = c.devoluciones();
  if (devoluciones.length === 0) return cobros;
  const devueltas = deDevoluciones(c, devoluciones);
  return {
    resumen: [
      { etiqueta: "Cobrado", valor: plata(c, c.entrado()) },
      { etiqueta: "Devuelto", valor: plata(c, -c.devuelto()) },
      { etiqueta: "Cash Collected (CC)", valor: plata(c, c.cobrado()) },
    ],
    secciones: [
      { titulo: "Lo que entró", total: cobros.resumen[0].valor, filas: cobros.secciones[0].filas, vacio: "No entró ningún pago en este período." },
      { titulo: "Lo que se devolvió", total: plata(c, -c.devuelto()), filas: devueltas.secciones[0].filas },
    ],
  };
}

/** Lo que se quedaron las pasarelas de cada pago. */
export function deFees(c: Contexto, pagos: Pago[]): PartesDetalle {
  const lista = pagos.filter((p) => p.feeMonto > 0).sort((a, b) => b.feeMonto - a.feeMonto);
  return {
    resumen: [{ etiqueta: "Procesadores", valor: plata(c, lista.reduce((a, p) => a + p.feeMonto, 0)) }, { etiqueta: "Pagos con fee", valor: num(lista.length) }],
    secciones: [{ filas: lista.map((p) => ({ ...filaDePago(c, p, p.feeMonto), id: `${p.id}_fee` })), vacio: "Ningún pago con fee en este período." }],
  };
}

/** Lo que comisiona cada venta por lo cobrado en el período. */
export function deComisiones(c: Contexto, comisiones: ComisionVenta[], quien: "closer" | "director"): PartesDetalle {
  const monto = (x: ComisionVenta) => (quien === "closer" ? x.comisionCloser : x.comisionDirector);
  const nombre = (x: ComisionVenta) => (quien === "closer" ? x.closerNombre : c.e.equipo.find((m) => m.id === x.directorId)?.nombre ?? "Director");
  /* Con las líneas en negativo de las devoluciones (lo que se revierte): el
     total tiene que ser el del número. */
  const lista = comisiones.filter((x) => monto(x) !== 0).sort((a, b) => monto(b) - monto(a));
  return {
    resumen: [{ etiqueta: "Comisiones", valor: plata(c, lista.reduce((a, x) => a + monto(x), 0)) }, { etiqueta: "Ventas", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((x) => ({
        id: `${x.id}_${quien}`, titulo: nombre(x), valor: plata(c, monto(x)),
        detalle: x.devolucionId
          ? `Devolución de ${c.ix.ventaPorId.get(x.ventaId)?.contactoNombre ?? "—"}: se revierte lo que se le comisionó`
          : `Venta de ${c.ix.ventaPorId.get(x.ventaId)?.contactoNombre ?? "—"} · cobrado ${plata(c, x.cobradoEnMes)}`,
        ficha: { id: x.ventaId, vista: "ventas" as const, venta: x.ventaId },
        ...(x.devolucionId ? { marca: { texto: "Devolución", variante: "danger" as const } } : {}),
      })),
      vacio: "Sin comisiones en este período.",
    }],
  };
}

/* ---------- Personas y oportunidades ---------- */

export function dePersonas(c: Contexto, contactos: Contacto[]): PartesDetalle {
  const lista = [...contactos].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  return {
    resumen: [{ etiqueta: "Personas", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((x) => ({ id: x.id, titulo: x.nombre || "Sin nombre", detalle: [`entró ${relativo(x.creadoEn)}`, x.email, x.pais].filter(Boolean).join(" · "), ficha: { id: x.id } })),
      vacio: "Nadie entró en este período.",
    }],
  };
}

export function deLeads(c: Contexto, leads: Lead[]): PartesDetalle {
  const etapa = new Map(c.e.etapas.map((x) => [x.id, x.nombre]));
  const lista = [...leads].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  return {
    resumen: [{ etiqueta: "Leads", valor: num(lista.length) }, { etiqueta: "Valor", valor: plata(c, lista.reduce((a, l) => a + l.monto, 0)) }],
    secciones: [{
      filas: lista.map((l) => ({
        id: l.id, titulo: l.nombre || "Sin nombre", valor: money(l.monto, l.moneda), ficha: { id: l.id },
        detalle: [etapa.get(l.etapaId) ?? "Sin etapa", l.fuente || "Sin fuente", `entró ${relativo(l.creadoEn)}`].join(" · "),
      })),
      vacio: "Ningún lead.",
    }],
  };
}

/* ---------- Gastos ---------- */

export function deGastos(c: Contexto, gastos: Gasto[], etiqueta = "Gastos"): PartesDetalle {
  const lista = [...gastos].sort((a, b) => b.monto - a.monto);
  return {
    resumen: [{ etiqueta, valor: plata(c, lista.reduce((a, g) => a + g.monto, 0)) }, { etiqueta: "Cargas", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((g) => ({ id: g.id, titulo: g.concepto || g.categoria, detalle: [g.categoria, fecha(g.fecha), g.proveedor].filter(Boolean).join(" · "), valor: plata(c, g.monto) })),
      vacio: "Ningún gasto en este período.",
    }],
  };
}

/* ---------- Anuncios de Meta ----------
   Los anuncios del período, del que más pesa en esa métrica al que menos.
   Cada uno abre su detalle, el mismo de Marketing, con el anuncio arriba. */

type MetricaAnuncio = "inversion" | "impresiones" | "leads" | "clicks";

export function deAnuncios(c: Contexto, metrica: MetricaAnuncio = "inversion"): PartesDetalle {
  const filas = filasMeta(c.e, c.corte.desde, c.corte.hasta, "anuncio")
    .filter((f) => f[metrica] > 0)
    .sort((a, b) => b[metrica] - a[metrica]);
  const total = filas.reduce((a, f) => a + f[metrica], 0);
  const valor = (n: number) => (metrica === "inversion" ? plata(c, n, n !== 0 && n < 10 ? 2 : 0) : num(n));
  const ETIQUETA: Record<MetricaAnuncio, string> = { inversion: "Gasto en Meta", impresiones: "Impresiones", leads: "Leads según Meta", clicks: "Clicks" };
  return {
    resumen: [{ etiqueta: ETIQUETA[metrica], valor: valor(total) }, { etiqueta: "Anuncios", valor: num(filas.length) }],
    secciones: [{
      filas: filas.map((f) => ({
        id: f.id, titulo: f.nombre || "Anuncio sin nombre", valor: valor(f[metrica]), anuncio: f.id,
        /* Las copias de un anuncio se llaman igual: su conjunto las distingue. */
        detalle: [f.adsetNombre ?? f.campaignNombre, metrica === "inversion" ? (f.leads > 0 ? `${num(f.leads)} leads` : "") : plata(c, f.inversion)].filter(Boolean).join(" · "),
      })),
      vacio: "Ningún anuncio con actividad en este período.",
    }],
  };
}

/** La inversión en publicidad de Finanzas: los gastos cargados y, al lado,
    los anuncios de Meta de esos mismos días. */
export function dePublicidad(c: Contexto, gastos: Gasto[]): PartesDetalle {
  const cargados = deGastos(c, gastos, "Cargado en Finanzas");
  const anuncios = deAnuncios(c, "inversion");
  return {
    resumen: [cargados.resumen[0], anuncios.resumen[0]],
    secciones: [
      { titulo: "Gastos cargados en Finanzas", total: cargados.resumen[0].valor, filas: cargados.secciones[0].filas, vacio: "Ningún gasto de publicidad cargado en este período." },
      { titulo: "Anuncios de Meta en esos días", total: anuncios.resumen[0].valor, filas: anuncios.secciones[0].filas, vacio: "Meta no informó gasto en este período." },
    ],
  };
}

/* ---------- Webinars ---------- */

export function deWebinars(c: Contexto, webinars: Webinar[], cuenta: (w: Webinar) => number | null, formato: "moneda" | "cantidad", etiqueta: string): PartesDetalle {
  const valor = (n: number) => (formato === "moneda" ? plata(c, n) : num(n));
  const lista = [...webinars].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const total = lista.reduce((a, w) => a + (cuenta(w) ?? 0), 0);
  return {
    resumen: [{ etiqueta, valor: valor(total) }, { etiqueta: "Webinars", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((w) => {
        const n = cuenta(w);
        return { id: w.id, titulo: w.titulo, detalle: fecha(w.fecha), valor: n === null ? "—" : valor(n), href: `/webinars/${w.id}` };
      }),
      vacio: "Ningún webinar en este período.",
    }],
  };
}

/* ---------- Cuotas vencidas ---------- */

export function deVencidas(c: Contexto, cuotas: CuotaVencida[]): PartesDetalle {
  const lista = [...cuotas].sort((a, b) => b.diasAtraso - a.diasAtraso);
  return {
    resumen: [{ etiqueta: "Vencido", valor: plata(c, lista.reduce((a, x) => a + x.saldo, 0)) }, { etiqueta: "Cuotas", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((x) => ({
        id: x.cuotaId, titulo: x.contacto || "Venta sin contacto", valor: plata(c, x.saldo),
        detalle: `Cuota ${x.numero} · venció ${fecha(x.vence)}${x.pagado > 0 ? ` · pagó ${plata(c, x.pagado)}` : ""}`,
        ficha: { id: x.ventaId, vista: "ventas" as const, venta: x.ventaId },
        marca: { texto: `${num(x.diasAtraso)} ${x.diasAtraso === 1 ? "día" : "días"}`, variante: x.diasAtraso >= 20 ? "danger" as const : "warning" as const },
      })),
      vacio: "Ninguna cuota vencida.",
    }],
  };
}

/** Las ventas con una cuota atrasada `dias` o más, con su cuota más vieja. */
export function deAtrasados(c: Contexto, cuotas: CuotaVencida[], dias: number): PartesDetalle {
  const peor = new Map<ID, CuotaVencida>();
  for (const x of cuotas) {
    if (x.diasAtraso < dias) continue;
    const y = peor.get(x.ventaId);
    if (!y || x.diasAtraso > y.diasAtraso) peor.set(x.ventaId, x);
  }
  const deudaDe = (ventaId: ID) => cuotas.filter((x) => x.ventaId === ventaId).reduce((a, x) => a + x.saldo, 0);
  const lista = [...peor.values()].sort((a, b) => b.diasAtraso - a.diasAtraso);
  return {
    resumen: [{ etiqueta: "Clientes", valor: num(lista.length) }, { etiqueta: "Deben", valor: plata(c, lista.reduce((a, x) => a + deudaDe(x.ventaId), 0)) }],
    secciones: [{
      filas: lista.map((x) => ({
        id: x.ventaId, titulo: x.contacto || "Venta sin contacto", valor: plata(c, deudaDe(x.ventaId)),
        detalle: `Su cuota más vieja venció ${fecha(x.vence)}`,
        ficha: { id: x.ventaId, vista: "ventas" as const, venta: x.ventaId },
        marca: { texto: `${num(x.diasAtraso)} días`, variante: x.diasAtraso >= 20 ? "danger" as const : "warning" as const },
      })),
      vacio: "Nadie con ese atraso.",
    }],
  };
}

/* ---------- Alumnos ---------- */

export function deAlumnos(c: Contexto, alumnos: Alumno[]): PartesDetalle {
  const lista = [...alumnos].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return {
    resumen: [{ etiqueta: "Alumnos", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((a) => ({ id: a.id, titulo: a.nombre, detalle: [a.plan, a.cohorte, a.inicio ? `empezó ${fecha(a.inicio)}` : ""].filter(Boolean).join(" · "), ficha: { id: a.id, vista: "servicio" as const } })),
      vacio: "Ningún alumno.",
    }],
  };
}

/* ---------- Cobros sin conciliar ---------- */

export function deMovimientos(c: Contexto, movimientos: Movimiento[]): PartesDetalle {
  const lista = [...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return {
    resumen: [{ etiqueta: "Sin conciliar", valor: plata(c, lista.reduce((a, m) => a + m.monto, 0)) }, { etiqueta: "Cobros", valor: num(lista.length) }],
    secciones: [{
      filas: lista.map((m) => ({ id: m.id, titulo: m.clienteNombre || m.clienteEmail || "Cobro sin nombre", detalle: [m.proveedor, fecha(m.fecha)].filter(Boolean).join(" · "), valor: money(m.monto, m.moneda), href: "/conciliacion" })),
      vacio: "Nada pendiente de conciliar.",
    }],
  };
}
