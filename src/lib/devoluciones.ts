import type { Devolucion, EstadoApp, ID, Liquidacion, Pago, Venta } from "./types";
import type { RangoMes } from "./metricas";
import { closerDeCuota, cobraDirector, cobraEnFecha, tasaDeComision } from "./comision";
import { moverPeriodo, periodoDeFecha } from "./periodos";
import { descuentaPorCierre, ventasSinCierre } from "./cierre-del-dia";

/* ==================================================================
   Devoluciones: la plata que se le devuelve a un cliente.

   Es una transacción aparte, no un cambio en la venta ni en sus cobros:
   - la venta sigue contando en su mes y lo cobrado, en el mes en que entró;
   - la devolución resta en el mes en que se devuelve la plata (Cash
     Collected, estado de resultados y caja), sin tocar nada del pasado;
   - la comisión de la pasarela queda cobrada (Stripe se la queda aunque se
     devuelva): los fees de los cobros no cambian;
   - al closer y al director se les revierte EXACTAMENTE lo que se les
     comisionó por lo cobrado de esa venta (no el % sobre lo devuelto, que
     daría un poco más porque la comisión se calcula sobre lo cobrado menos
     el procesador), como una línea negativa del mes de la devolución. Si se
     devuelve sólo una parte, se revierte esa parte de lo comisionado. Con
     «no descontar al closer» no se revierte nada.

   Sin React ni base: Finanzas, la liquidación, el resultado de cada webinar
   y las pruebas usan estas mismas cuentas, así los números no pueden dar
   distinto en cada pantalla.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

const enRango = (iso: string, m: RangoMes) => {
  const d = new Date(iso).getTime();
  return d >= m.desde.getTime() && d <= m.hasta.getTime();
};

type ConDevoluciones = { devoluciones?: Devolucion[] };

export const devolucionesDe = (e: ConDevoluciones): Devolucion[] => e.devoluciones ?? [];

/** Cuenta en Finanzas: la confirmada. La propuesta por una pasarela todavía
 *  no (nadie la miró) y la ignorada nunca fue una devolución. */
export const esDevolucionConfirmada = (d: Pick<Devolucion, "estado">): boolean => (d.estado ?? "confirmada") === "confirmada";

/** Las devoluciones que se hicieron en el período: las que restan ahí. */
export function devolucionesDelMes(e: ConDevoluciones, m: RangoMes): Devolucion[] {
  return devolucionesDe(e).filter((d) => esDevolucionConfirmada(d) && enRango(d.fecha, m));
}

/** Lo devuelto en el período. */
export function totalDevuelto(e: ConDevoluciones, m: RangoMes): number {
  return devolucionesDelMes(e, m).reduce((a, d) => a + d.monto, 0);
}

/** Las devoluciones confirmadas de una venta, de la más vieja a la más nueva. */
export function devolucionesDeVenta(e: ConDevoluciones, ventaId: ID): Devolucion[] {
  return devolucionesDe(e)
    .filter((d) => d.ventaId === ventaId && esDevolucionConfirmada(d))
    .sort(masVieja);
}

const masVieja = (a: Devolucion, b: Devolucion) =>
  Date.parse(a.fecha) - Date.parse(b.fecha) || Date.parse(a.creadoEn) - Date.parse(b.creadoEn) || a.id.localeCompare(b.id);

/* ---------- Cuánto se puede devolver ---------- */

export interface Devolvible {
  /* Todo lo cobrado de la venta hasta ese día. */
  cobrado: number;
  /* Lo que ya se devolvió antes (sin la que se está corrigiendo). */
  devuelto: number;
  /* Lo que se puede devolver todavía. */
  queda: number;
}

/** Cuánto se puede devolver de una venta a esa fecha: lo cobrado hasta
 *  entonces menos lo que ya se devolvió. `ignorar` es la devolución que se
 *  está corrigiendo (no cuenta contra sí misma). */
export function devolvibleDeVenta(
  e: Pick<EstadoApp, "pagos" | "cuotas"> & ConDevoluciones, ventaId: ID, hastaIso: string, ignorar?: ID,
): Devolvible {
  const cuotas = new Set(e.cuotas.filter((c) => c.ventaId === ventaId).map((c) => c.id));
  const t = Date.parse(hastaIso);
  const cobrado = r2(e.pagos.filter((p) => cuotas.has(p.cuotaId) && Date.parse(p.fecha) <= t).reduce((a, p) => a + p.monto, 0));
  const devuelto = r2(devolucionesDeVenta(e, ventaId).filter((d) => d.id !== ignorar && Date.parse(d.fecha) <= t).reduce((a, d) => a + d.monto, 0));
  return { cobrado, devuelto, queda: Math.max(0, r2(cobrado - devuelto)) };
}

/* ---------- Lo que se revierte de las comisiones ---------- */

/* Una persona a la que se le comisionó algo por esa venta: el closer (o los
   closers, si parte de las cuotas las heredó otro) y el director. */
export interface ParteReversa {
  rol: "closer" | "director";
  miembroId?: ID;
  nombre: string;
  /* El % con el que se le comisionó (el de su servicio, o el general). */
  tasa: number;
  /* Los cobros que le comisionaron, hasta el día de la devolución. */
  cobros: Pago[];
  /* Lo cobrado, lo que se quedaron los procesadores y lo que quedó post pasarelas. */
  cobrado: number;
  fees: number;
  neto: number;
  /* Lo que se le calculó por esos cobros: neto × %. */
  comision: number;
  /* Lo que ya se le había revertido con devoluciones anteriores de esta venta. */
  yaRevertido: number;
  /* Lo que quedaba por revertir. */
  quedaba: number;
  /* Lo que se le revierte con esta devolución: lo que quedaba × la parte devuelta. */
  reversa: number;
  /* El closer de la venta, si esta parte es de cuotas que heredó otro. */
  heredadaDe?: string;
}

export interface Reversa {
  devolucion: Devolucion;
  venta: Venta;
  /* Todo lo cobrado de la venta hasta ese día y lo que ya se había devuelto. */
  cobradoVenta: number;
  yaDevuelto: number;
  /* Lo que quedaba cobrado sin devolver, lo que se devuelve ahora (nunca más
     que eso) y qué fracción es. */
  quedaba: number;
  devuelto: number;
  parte: number;
  /* «No descontar al closer»: se le sigue pagando todo. */
  sinDescuento: boolean;
  partes: ParteReversa[];
}

type EstadoDeReversas = Pick<EstadoApp, "ventas" | "cuotas" | "pagos" | "equipo"> & ConDevoluciones
  & Partial<Pick<EstadoApp, "sesiones" | "ajustes">>;

/** Lo que se revierte de las comisiones con cada devolución confirmada, de
 *  todas las fechas. Una venta cancelada no comisionó nada (Finanzas la
 *  saca), así que no hay nada que revertir. Con varias devoluciones de una
 *  misma venta se van descontando en orden: cada una revierte lo que
 *  quedaba por revertir, así entre todas no pueden pasar de lo comisionado. */
export function reversasDeComision(e: EstadoDeReversas): Reversa[] {
  const todas = devolucionesDe(e).filter((d) => esDevolucionConfirmada(d) && d.ventaId);
  if (todas.length === 0) return [];

  const ventaPorId = new Map(e.ventas.map((v) => [v.id, v] as const));
  const cuotaPorId = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const miembro = new Map(e.equipo.map((x) => [x.id, x] as const));
  const pagosPorVenta = new Map<ID, Pago[]>();
  for (const p of e.pagos) {
    const v = cuotaPorId.get(p.cuotaId)?.ventaId;
    if (!v) continue;
    const xs = pagosPorVenta.get(v);
    if (xs) xs.push(p); else pagosPorVenta.set(v, [p]);
  }
  /* Las ventas de un día sin cierre cargado ese mismo día (el interruptor del
     cierre del día): a su closer no se le pagó esa comisión, así que no hay
     nada que revertirle. Vacío con el interruptor apagado. */
  const sinCierre = e.sesiones && e.ajustes
    ? ventasSinCierre(e as Pick<EstadoApp, "sesiones" | "ventas" | "equipo" | "ajustes">)
    : new Set<ID>();
  const dePorVenta = new Map<ID, Devolucion[]>();
  for (const d of todas) dePorVenta.set(d.ventaId!, [...(dePorVenta.get(d.ventaId!) ?? []), d]);

  const out: Reversa[] = [];
  for (const [ventaId, devs] of dePorVenta) {
    const venta = ventaPorId.get(ventaId);
    if (!venta || venta.estado === "cancelada") continue;
    const pagos = pagosPorVenta.get(ventaId) ?? [];
    const deLaVenta = venta.closerId ? miembro.get(venta.closerId) : undefined;
    const sinComision = Boolean(deLaVenta?.sinComision);
    const director = venta.directorId ? miembro.get(venta.directorId) : undefined;
    const yaRevertido = new Map<string, number>();
    let yaDevuelto = 0;

    for (const d of devs.sort(masVieja)) {
      const t = Date.parse(d.fecha);
      const hasta = pagos.filter((p) => Date.parse(p.fecha) <= t);
      const cobradoVenta = r2(hasta.reduce((a, p) => a + p.monto, 0));
      const quedaba = Math.max(0, r2(cobradoVenta - yaDevuelto));
      const devuelto = Math.min(r2(d.monto), quedaba);
      const parte = quedaba > 0 ? devuelto / quedaba : 0;

      const parteDe = (
        clave: string, rol: ParteReversa["rol"], cobros: Pago[], quien: { id?: ID; nombre: string } | undefined, tasa: number, heredadaDe?: string,
      ): ParteReversa => {
        const cobrado = r2(cobros.reduce((a, p) => a + p.monto, 0));
        const fees = r2(cobros.reduce((a, p) => a + p.feeMonto, 0));
        const neto = r2(cobrado - fees);
        const comision = r2(neto * tasa);
        const antes = yaRevertido.get(clave) ?? 0;
        const queda = r2(comision - antes);
        const reversa = r2(Math.max(0, queda) * parte);
        yaRevertido.set(clave, r2(antes + reversa));
        return {
          rol, miembroId: quien?.id, nombre: quien?.nombre ?? "Sin asignar", tasa, cobros, cobrado, fees, neto, comision,
          yaRevertido: antes, quedaba: queda, reversa, ...(heredadaDe ? { heredadaDe } : {}),
        };
      };

      const partes: ParteReversa[] = [];
      /* Los cobros de cada closer: el de la venta y el que heredó alguna cuota. */
      const porCloser = new Map<string, Pago[]>();
      for (const p of hasta) {
        const k = closerDeCuota(venta, cuotaPorId.get(p.cuotaId)) ?? "";
        const xs = porCloser.get(k);
        if (xs) xs.push(p); else porCloser.set(k, [p]);
      }
      for (const [k, cobrosDelCloser] of porCloser) {
        const closer = k ? miembro.get(k) : undefined;
        partes.push(parteDe(
          `c:${k}`, "closer", cobrosDelCloser.filter((p) => cobraEnFecha(closer, p.fecha)),
          closer ? { id: closer.id, nombre: closer.nombre } : undefined,
          sinComision || descuentaPorCierre(sinCierre, venta, k) ? 0 : tasaDeComision(closer, venta.productoId),
          k && k !== venta.closerId ? deLaVenta?.nombre ?? "otro closer" : undefined,
        ));
      }
      if (director) {
        partes.push(parteDe(
          "d", "director", hasta.filter((p) => cobraDirector(director, p.fecha)),
          { id: director.id, nombre: director.nombre }, sinComision ? 0 : tasaDeComision(director, venta.productoId),
        ));
      }

      out.push({
        devolucion: d, venta, cobradoVenta, yaDevuelto: r2(yaDevuelto), quedaba, devuelto: r2(devuelto), parte,
        sinDescuento: Boolean(d.noDescontarAlCloser), partes,
      });
      yaDevuelto = r2(yaDevuelto + devuelto);
    }
  }
  return out;
}

/** Las reversas que restan en Finanzas en ese período (las del mes de la
 *  devolución) y se descuentan de verdad: sin las de «no descontar». */
export function reversasDelMes(e: EstadoDeReversas, m: RangoMes): Reversa[] {
  return reversasDeComision(e).filter((r) => !r.sinDescuento && enRango(r.devolucion.fecha, m));
}

/* ---------- En qué liquidación entra ---------- */

/** En qué liquidación se le descuenta al closer una devolución. Finanzas la
 *  resta el día que se devolvió la plata, pero una liquidación cerrada no se
 *  reescribe: si el mes de la devolución ya está cerrado, el descuento va a
 *  la primera liquidación abierta que sigue (la deuda que se descuenta «el
 *  mes que viene»). Si alguna liquidación cerrada ya la incluyó en su foto,
 *  es ésa. */
export function mesDeLiquidacion(
  d: Pick<Devolucion, "id" | "fecha">, liquidaciones: Pick<Liquidacion, "periodo" | "estado" | "resultado">[],
  /* Si se piden muchas, `liquidadaEn` se arma una vez y se pasa. */
  liquidadas: Map<ID, string> = liquidadaEn(liquidaciones),
): string {
  const enFoto = liquidadas.get(d.id);
  if (enFoto) return enFoto;
  const cerrados = new Set(liquidaciones.filter((l) => l.estado === "cerrada").map((l) => l.periodo));
  let p = periodoDeFecha(d.fecha);
  if (!p) return "";
  for (let i = 0; i < 36 && cerrados.has(p); i++) p = moverPeriodo(p, 1);
  return p;
}

/** Las devoluciones que ya están en la foto de una liquidación cerrada, y en
 *  cuál. */
export function liquidadaEn(liquidaciones: Pick<Liquidacion, "periodo" | "estado" | "resultado">[]): Map<ID, string> {
  const out = new Map<ID, string>();
  for (const l of liquidaciones) {
    if (l.estado !== "cerrada" || !l.resultado) continue;
    for (const p of l.resultado.personas) for (const x of p.lineas) if (x.devolucionId && !out.has(x.devolucionId)) out.set(x.devolucionId, l.periodo);
  }
  return out;
}

/* ---------- Lo que falta para poder cargarla ---------- */

export const MENSAJE_COMPROBANTE_DEVOLUCION = "Falta el comprobante de la devolución";

export interface BorradorDevolucion {
  ventaId?: ID;
  monto: number;
  fecha: string;
  procesadorId?: ID;
  tieneComprobante: boolean;
  /* Si la pasarela la informó, su registro es la prueba. */
  tienePasarela?: boolean;
}

/** Lo que está mal de una devolución, en el orden en que se lee la pantalla,
 *  o null si se puede guardar. */
export function problemaDeDevolucion(
  e: Pick<EstadoApp, "pagos" | "cuotas"> & ConDevoluciones, b: BorradorDevolucion, ignorar?: ID,
): string | null {
  if (!b.ventaId) return "Elegí la venta que se devuelve";
  if (!(b.monto > 0)) return "Escribí cuánto se devolvió";
  if (Number.isNaN(Date.parse(b.fecha))) return "Elegí el día que se devolvió";
  if (!b.procesadorId) return "Elegí por qué medio salió la plata";
  const d = devolvibleDeVenta(e, b.ventaId, b.fecha, ignorar);
  if (b.monto > d.queda + 0.01) {
    return d.cobrado <= 0
      ? "Esta venta no tiene cobros hasta ese día: no hay nada que devolver"
      : `No se puede devolver más de lo cobrado: quedan US$ ${d.queda.toLocaleString("es-AR", { maximumFractionDigits: 2 })} para devolver`;
  }
  if (!b.tieneComprobante && !b.tienePasarela) return MENSAJE_COMPROBANTE_DEVOLUCION;
  return null;
}

/* ---------- De qué venta es el pedido ----------
   La devolución se pide desde la ficha de una venta (se sabe cuál), desde una
   llamada que quedó en «Devolución» o desde una persona: ahí hay que elegir
   entre sus ventas. */

export interface PedidoDeVentas { ventaId?: ID; personaId?: ID; sesionId?: ID }

const sinTildes = (s: string | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Las ventas de las que puede ser la devolución, de la más nueva a la más
 *  vieja. Una llamada o una persona se reconocen por su contacto, su correo o
 *  su nombre entero; no se adivina nada más. */
export function ventasDelPedido(
  e: Pick<EstadoApp, "ventas" | "sesiones" | "leads" | "contactos">, p: PedidoDeVentas,
): Venta[] {
  if (p.ventaId) {
    const v = e.ventas.find((x) => x.id === p.ventaId);
    return v ? [v] : [];
  }
  const sesion = p.sesionId ? e.sesiones.find((s) => s.id === p.sesionId) : undefined;
  const ids = new Set<ID>([p.personaId, sesion?.leadId].filter((x): x is ID => Boolean(x)));
  const emails = new Set<string>();
  const nombres = new Set<string>();
  if (sesion?.email) emails.add(sinTildes(sesion.email));
  if (sesion?.invitado) nombres.add(sinTildes(sesion.invitado));
  for (const id of [...ids]) {
    const c = (e.contactos ?? []).find((x) => x.id === id) ?? (e.leads ?? []).find((x) => x.id === id);
    if (!c) continue;
    if ((c as { contactoId?: ID }).contactoId) ids.add((c as { contactoId?: ID }).contactoId as ID);
    if (c.email) emails.add(sinTildes(c.email));
    if (c.nombre) nombres.add(sinTildes(c.nombre));
  }
  if (ids.size === 0 && emails.size === 0 && nombres.size === 0) return [];
  const delContacto = (v: Venta) => {
    const c = v.contactoId ? (e.contactos ?? []).find((x) => x.id === v.contactoId) ?? (e.leads ?? []).find((x) => x.id === v.contactoId) : undefined;
    return c?.email ? sinTildes(c.email) : "";
  };
  return e.ventas
    .filter((v) => (v.contactoId && ids.has(v.contactoId)) || (delContacto(v) && emails.has(delContacto(v))) || nombres.has(sinTildes(v.contactoNombre)))
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
}

/** La cuenta por la que probablemente salió la plata: la del último cobro de la
 *  venta (la misma con la que se pagó). */
export function procesadorDeLaVenta(e: Pick<EstadoApp, "pagos" | "cuotas" | "procesadores">, ventaId: ID): ID | undefined {
  const cuotas = new Set(e.cuotas.filter((c) => c.ventaId === ventaId).map((c) => c.id));
  const ultimo = e.pagos
    .filter((p) => cuotas.has(p.cuotaId) && p.procesadorId && e.procesadores.some((x) => x.id === p.procesadorId))
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha))[0];
  return ultimo?.procesadorId;
}
