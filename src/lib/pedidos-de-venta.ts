import type { EstadoApp, ID, MiembroEquipo, Movimiento, Sesion } from "./types";
import { miembroDeCloser } from "./crm";
import { claveEmail } from "./contactos";
import { normalizar, quienPago } from "./conciliacion";
import { esLlamadaDeResell } from "./resells";

/* ==================================================================
   «Pedir la venta a un closer» (Aldana, 20/10).

   Un cobro entra a una pasarela y nadie cargó la venta: Finanzas no lo puede
   imputar a una cuota porque no hay cuota, y el closer «se cuelga». Finanzas
   sabe de quién es la venta (la llamada la tuvo tal closer): se la pide. El
   pedido queda en el propio cobro (pedidoACloserId, pedidoEn, pedidoPor), le
   aparece al closer en «Pendientes» de su panel con el botón para cargarla y
   se va solo cuando el cobro deja de estar pendiente (se concilió con una
   venta o se dejó sin venta). Si el closer no lo hace, el pedido se pone
   amarillo al día y rojo a los dos días en Finanzas; en el panel del closer es amarillo y a los dos días, rojo.

   Sin React ni red: lo usan la bandeja de Conciliación, el Mi panel y las
   pruebas. El closer ya ve los cobros sin conciliar (supabase/cobros-de-closers.sql):
   no hace falta una tabla aparte.
   ================================================================== */

/* Desde cuántas horas sin cargarse se pone amarillo y desde cuántas, rojo. */
export const HORAS_DE_ATENCION = 24;
export const HORAS_DE_ALARMA = 48;

export type NivelDePedido = "nuevo" | "atrasado" | "urgente";

export interface PedidoDeVenta {
  movimiento: Movimiento;
  closerId: ID;
  /* Cuándo se pidió (ISO) y quién lo pidió, si se sabe. */
  desde: string;
  pidio?: string;
  /* Horas que lleva esperando. */
  horas: number;
  nivel: NivelDePedido;
}

export function nivelDePedido(horas: number): NivelDePedido {
  return horas >= HORAS_DE_ALARMA ? "urgente" : horas >= HORAS_DE_ATENCION ? "atrasado" : "nuevo";
}

/** «hace 3 horas», «hace 1 día», «hace 2 días»: lo que lleva esperando, en la voz de la pantalla. */
export function haceCuanto(horas: number): string {
  if (horas < 1) return "recién";
  if (horas < 24) { const h = Math.floor(horas); return `hace ${h} ${h === 1 ? "hora" : "horas"}`; }
  const d = Math.floor(horas / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Lo que lleva esperando lo que le pidieron a un closer, para el aviso de Finanzas: «hace 2 días» si es uno solo, «el más viejo hace 2 días» si son varios. */
export function esperaDe(x: Pick<PedidosDeUnCloser, "n" | "masViejoHoras">): string {
  const t = haceCuanto(x.masViejoHoras);
  if (t === "recién") return x.n === 1 ? "recién pedido" : "todos recién pedidos";
  return x.n === 1 ? t : `el más viejo ${t}`;
}

/** El cobro tiene un pedido que sigue abierto: está pendiente y alguien tiene que cargar su venta. */
export const tienePedidoAbierto = (m: Pick<Movimiento, "estado" | "pedidoACloserId">): boolean =>
  m.estado === "pendiente" && Boolean(m.pedidoACloserId);

function pedidoDe(m: Movimiento, ahora: number): PedidoDeVenta {
  const desde = m.pedidoEn ?? m.creadoEn;
  const t = Date.parse(desde);
  const horas = Number.isFinite(t) ? Math.max(0, (ahora - t) / 3_600_000) : 0;
  return { movimiento: m, closerId: m.pedidoACloserId!, desde, pidio: m.pedidoPor, horas, nivel: nivelDePedido(horas) };
}

/** Todos los pedidos abiertos, el más viejo primero. */
export function pedidosAbiertos(e: Pick<EstadoApp, "movimientos">, ahora = Date.now()): PedidoDeVenta[] {
  /* Un estado armado a mano (una prueba, una importación vieja) puede no traer la lista: sin cobros, sin pedidos. */
  return (e.movimientos ?? []).filter(tienePedidoAbierto).map((m) => pedidoDe(m, ahora)).sort((a, b) => b.horas - a.horas);
}

/** Los pedidos abiertos de un closer. */
export function pedidosDeCloser(e: Pick<EstadoApp, "movimientos">, closerId: ID, ahora = Date.now()): PedidoDeVenta[] {
  return pedidosAbiertos(e, ahora).filter((p) => p.closerId === closerId);
}

export interface PedidosDeUnCloser { closerId: ID; n: number; monto: number; masViejoHoras: number; nivel: NivelDePedido }

/** Cuántos le debe cada closer a Finanzas: el que más lleva esperando, primero. */
export function pedidosPorCloser(e: Pick<EstadoApp, "movimientos">, ahora = Date.now()): PedidosDeUnCloser[] {
  const por = new Map<ID, PedidosDeUnCloser>();
  for (const p of pedidosAbiertos(e, ahora)) {
    const x = por.get(p.closerId) ?? { closerId: p.closerId, n: 0, monto: 0, masViejoHoras: 0, nivel: "nuevo" as NivelDePedido };
    x.n += 1;
    x.monto = Math.round((x.monto + p.movimiento.monto) * 100) / 100;
    x.masViejoHoras = Math.max(x.masViejoHoras, p.horas);
    x.nivel = nivelDePedido(x.masViejoHoras);
    por.set(p.closerId, x);
  }
  return [...por.values()].sort((a, b) => b.masViejoHoras - a.masViejoHoras);
}

/** A quién se le puede pedir: los closers que siguen en el equipo. */
export function closersPosibles(equipo: readonly MiembroEquipo[]): MiembroEquipo[] {
  return equipo.filter((m) => m.rol === "closer" && m.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/* ---------- A quién pedírselo ---------- */

export interface CloserSugerido {
  miembro: MiembroEquipo;
  /* La llamada en la que se apoya: la persona agendó con este closer. */
  llamada: Pick<Sesion, "id" | "inicia" | "anfitrion">;
  /* Cómo se la encontró: el correo de la llamada, la ficha de la persona o el nombre. */
  por: "correo" | "ficha" | "nombre";
}

const DIA = 86_400_000;

/** El closer que tuvo la llamada con quien pagó: se busca la llamada de esa persona (por correo, por su ficha o por su nombre
 *  si no hay dos iguales) y se toma la última antes del cobro; sin ninguna antes, la más cercana. No adivina: sin llamada, nada. */
export function closerSugerido(e: EstadoApp, mov: Movimiento): CloserSugerido | undefined {
  const quien = quienPago(e, mov);
  const correos = new Set([claveEmail(mov.clienteEmail), claveEmail(quien.email)].filter(Boolean));
  const fichas = new Set<string>();
  if (quien.fichaId) fichas.add(quien.fichaId);
  for (const c of e.contactos ?? []) if (correos.has(claveEmail(c.email))) fichas.add(c.id);

  const llamadas = e.sesiones.filter((s) => s.estado !== "cancelada" && Boolean(s.anfitrion?.trim()) && !esLlamadaDeResell(s));
  const hallar = (f: (s: Sesion) => boolean, por: CloserSugerido["por"]): { lista: Sesion[]; por: CloserSugerido["por"] } | undefined => {
    const lista = llamadas.filter(f);
    return lista.length ? { lista, por } : undefined;
  };
  let hallo = hallar((s) => correos.has(claveEmail(s.email)), "correo")
    ?? hallar((s) => Boolean(s.contactoId) && fichas.has(s.contactoId!), "ficha")
    ?? hallar((s) => Boolean(s.leadId) && fichas.has(s.leadId!), "ficha");
  if (!hallo && mov.clienteNombre) {
    const nombre = normalizar(mov.clienteNombre);
    const parecidas = llamadas.filter((s) => normalizar(s.invitado ?? "") === nombre);
    /* Un nombre solo no alcanza si dos personas distintas se llaman igual: tienen que ser de la misma persona (mismo correo o ninguno). */
    const correosDeEllas = new Set(parecidas.map((s) => claveEmail(s.email)).filter(Boolean));
    if (parecidas.length && correosDeEllas.size <= 1) hallo = { lista: parecidas, por: "nombre" };
  }
  if (!hallo) return undefined;

  const cuando = Date.parse(mov.fecha);
  const orden = [...hallo.lista].sort((a, b) => Date.parse(b.inicia) - Date.parse(a.inicia));
  /* La última llamada hasta dos días después del cobro (una venta cerrada en la llamada se cobra horas después, nunca antes de agendar). */
  const antes = orden.find((s) => Date.parse(s.inicia) <= cuando + 2 * DIA);
  const llamada = antes ?? orden.reduce((a, b) => (Math.abs(Date.parse(b.inicia) - cuando) < Math.abs(Date.parse(a.inicia) - cuando) ? b : a));
  const miembro = miembroDeCloser(llamada.anfitrion!, e.equipo.filter((m) => m.rol === "closer" && m.activo));
  if (!miembro) return undefined;
  return { miembro, llamada: { id: llamada.id, inicia: llamada.inicia, anfitrion: llamada.anfitrion }, por: hallo.por };
}
