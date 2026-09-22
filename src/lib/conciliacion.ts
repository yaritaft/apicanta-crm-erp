import type { Cuota, EstadoApp, ID, Movimiento, Pago, Venta } from "./types";
import { nombrePasarela } from "./pasarelas";

/* ==================================================================
   Conciliación.

   Un movimiento es plata que entró a una pasarela. Una cuota es plata
   que alguien nos debe. Conciliar es decir cuál pagó a cuál: recién
   ahí nace el Pago, y recién ahí el cash collected se mueve.

   El motor no decide solo salvo que esté muy seguro. Cuando no lo
   está, propone y muestra por qué: el que concilia tiene que poder
   discutirle.
   ================================================================== */

const DIA = 86400000;

/* ---------- Texto ---------- */

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "da", "dos", "van", "mr", "sr", "sra"]);

function tokens(s: string): string[] {
  return normalizar(s).split(" ").filter((t) => t.length >= 3 && !VACIAS.has(t));
}

/** 0 a 1. Cuántos de los nombres de uno aparecen en el otro. */
export function parecido(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const comunes = ta.filter((t) => tb.includes(t)).length;
  return comunes / Math.min(ta.length, tb.length);
}

/* ---------- Saldos ---------- */

export function pagadoDeCuota(e: EstadoApp, cuotaId: ID): number {
  return e.pagos.filter((p) => p.cuotaId === cuotaId).reduce((a, p) => a + p.monto, 0);
}

export function saldoDeCuota(e: EstadoApp, cuota: Cuota): number {
  return Math.round((cuota.monto - pagadoDeCuota(e, cuota.id)) * 100) / 100;
}

/* ---------- Sugerencias ---------- */

export interface Sugerencia {
  cuotaId: ID;
  ventaId: ID;
  contacto: string;
  etiqueta: string;
  monto: number;
  saldo: number;
  vence?: string;
  puntaje: number;
  motivos: string[];
  reparos: string[];
  /* Lo que va a pasar si se concilia así */
  dejaSaldo: number;
  sobra: number;
}

const etiquetaCuota = (c: Cuota) => (c.esReserva ? "Reserva" : `Cuota ${c.numero}`);

export function sugerenciasPara(e: EstadoApp, mov: Movimiento, limite = 4): Sugerencia[] {
  if (mov.estado !== "pendiente") return [];
  /* De un pago ya usado en parte (la reserva de una venta), sólo lo que queda. */
  const monto = restoDeMovimiento(e, mov);
  if (monto <= 0.01) return [];

  const ventas = new Map<ID, Venta>(e.ventas.map((v) => [v.id, v]));
  const out: Sugerencia[] = [];

  for (const c of e.cuotas) {
    if (c.estado === "cancelada") continue;
    const venta = ventas.get(c.ventaId);
    if (!venta || venta.estado === "cancelada") continue;

    const saldo = saldoDeCuota(e, c);
    if (saldo <= 0.01) continue;

    const motivos: string[] = [];
    const reparos: string[] = [];
    let puntaje = 0;

    /* 1. El monto, que es lo que más pesa */
    const dif = Math.abs(monto - saldo);
    if (dif <= 0.5) {
      puntaje += 55;
      motivos.push("El monto calza exacto con lo que falta");
    } else if (dif / saldo <= 0.01) {
      puntaje += 44;
      motivos.push("El monto calza con menos de 1% de diferencia");
    } else if (Math.abs(monto - c.monto) <= 0.5) {
      puntaje += 40;
      motivos.push("Es el total de la cuota");
    } else if (monto < saldo) {
      puntaje += 16;
      reparos.push("Alcanza para una parte de la cuota");
    } else if (monto <= saldo * 2) {
      puntaje += 8;
      reparos.push("Entró más de lo que falta en esta cuota");
    } else {
      continue; /* más del doble: no es de acá */
    }

    /* 2. Quién pagó */
    const lead = venta.contactoId ? e.leads.find((l) => l.id === venta.contactoId) : undefined;
    const mismoMail = Boolean(
      mov.clienteEmail && lead?.email && mov.clienteEmail.toLowerCase() === lead.email.toLowerCase(),
    );
    if (mismoMail) {
      puntaje += 32;
      motivos.push("El correo es el del cliente");
    }
    const sim = parecido(mov.clienteNombre, venta.contactoNombre);
    if (sim >= 0.99) { puntaje += 30; motivos.push("El nombre es el mismo"); }
    else if (sim >= 0.5) { puntaje += 20; motivos.push("El nombre se parece"); }
    else if (mov.clienteNombre && !mismoMail) { reparos.push("El nombre no coincide"); }

    /* 3. Cuándo */
    if (c.vence) {
      const dias = Math.abs(new Date(mov.fecha).getTime() - new Date(c.vence).getTime()) / DIA;
      if (dias <= 3) { puntaje += 14; motivos.push("Entró el día del vencimiento"); }
      else if (dias <= 10) { puntaje += 10; motivos.push("Entró cerca del vencimiento"); }
      else if (dias <= 30) puntaje += 5;
      else if (dias > 120) reparos.push("Muy lejos del vencimiento");
    }

    /* 4. Por dónde */
    const cuotasVenta = e.cuotas.filter((x) => x.ventaId === venta.id).map((x) => x.id);
    const yaUso = e.pagos.some((p) => cuotasVenta.includes(p.cuotaId) && p.procesadorId === mov.procesadorId);
    if (yaUso) { puntaje += 6; motivos.push("Ya pagó por acá antes"); }

    /* 5. Qué compró */
    const producto = e.productos.find((p) => p.id === venta.productoId)?.nombre;
    if (producto && mov.descripcion && parecido(mov.descripcion, producto) >= 0.5) {
      puntaje += 6;
      motivos.push("El concepto es el del producto");
    }

    if (mov.moneda !== venta.moneda) {
      puntaje -= 25;
      reparos.push(`El cobro vino en ${mov.moneda} y la venta está en ${venta.moneda}`);
    }

    out.push({
      cuotaId: c.id,
      ventaId: venta.id,
      contacto: venta.contactoNombre,
      etiqueta: etiquetaCuota(c),
      monto: c.monto,
      saldo,
      vence: c.vence,
      puntaje: Math.max(0, Math.min(100, Math.round(puntaje))),
      motivos,
      reparos,
      dejaSaldo: Math.max(0, Math.round((saldo - monto) * 100) / 100),
      sobra: Math.max(0, Math.round((monto - saldo) * 100) / 100),
    });
  }

  return out.sort((a, b) => b.puntaje - a.puntaje).slice(0, limite);
}

/* Una sugerencia se aplica sola cuando saca buen puntaje, le gana claro a
   la segunda y el monto no obliga a partir nada. Con cualquier duda, la
   decisión vuelve a ser de una persona. */
export function esAutomatica(ss: Sugerencia[]): boolean {
  const [primera, segunda] = ss;
  if (!primera) return false;
  if (primera.puntaje < 80) return false;
  if (primera.dejaSaldo > 0.01 || primera.sobra > 0.01) return false;
  if (segunda && primera.puntaje - segunda.puntaje < 15) return false;
  return true;
}

export interface Propuesta {
  movimiento: Movimiento;
  sugerencias: Sugerencia[];
  automatica: boolean;
}

export function propuestas(e: EstadoApp, movs?: Movimiento[]): Propuesta[] {
  const lista = movs ?? e.movimientos.filter((m) => m.estado === "pendiente");
  return lista.map((movimiento) => {
    const ss = sugerenciasPara(e, movimiento);
    return { movimiento, sugerencias: ss, automatica: esAutomatica(ss) };
  });
}

/* ---------- Números de la bandeja ---------- */

export function resumenConciliacion(e: EstadoApp) {
  const pendientes = e.movimientos.filter((m) => m.estado === "pendiente");
  const conciliados = e.movimientos.filter((m) => m.estado === "conciliado");
  /* Lo que falta imputar: de un pago usado a medias, sólo lo que queda. */
  const sinConciliar = pendientes.reduce((a, m) => a + restoDeMovimiento(e, m), 0);
  const autos = propuestas(e, pendientes).filter((p) => p.automatica);
  return {
    pendientes: pendientes.length,
    sinConciliar,
    conciliados: conciliados.length,
    automaticos: autos.length,
    montoAutomatico: autos.reduce((a, p) => a + p.movimiento.monto, 0),
    /* Lo que la pasarela se quedó de verdad contra lo que estimábamos */
    feeReal: conciliados.reduce((a, m) => a + m.fee, 0),
  };
}

/* ---------- Pago que nace de un movimiento ---------- */

export function pagoDesdeMovimiento(mov: Movimiento, cuotaId: ID, montoImputado: number): Omit<Pago, "id"> {
  /* El fee se prorratea si el movimiento se parte entre dos cuotas: el
     total que se quedó la pasarela no cambia. */
  const proporcion = mov.monto > 0 ? montoImputado / mov.monto : 1;
  const feeMonto = Math.round(mov.fee * proporcion * 100) / 100;
  return {
    cuotaId,
    procesadorId: mov.procesadorId,
    movimientoId: mov.id,
    monto: Math.round(montoImputado * 100) / 100,
    moneda: mov.moneda,
    feeRate: mov.monto > 0 ? Math.round((mov.fee / mov.monto) * 10000) / 10000 : 0,
    feeMonto,
    fecha: mov.fecha,
    referencia: mov.referencia,
    creadoEn: new Date().toISOString(),
  };
}

/* ---------- Medio de pago de un movimiento ----------
   Con qué se registra el cobro: el procesador de Apicanta atado a esa
   pasarela ("USDT (Trust)", "ACH / Wire (Mercury)"); si no hay, el
   nombre de la pasarela. Es lo que la gente reconoce, no "ST". */

export function procesadorDeMovimiento(e: EstadoApp, mov: Movimiento) {
  return (mov.procesadorId ? e.procesadores.find((p) => p.id === mov.procesadorId) : undefined)
    ?? e.procesadores.find((p) => p.proveedor === mov.proveedor);
}

export function medioDeMovimiento(e: EstadoApp, mov: Movimiento): string {
  return procesadorDeMovimiento(e, mov)?.nombre ?? nombrePasarela(mov.proveedor);
}

/* Lo que queda sin imputar de un movimiento: un pago de pasarela puede
   repartirse entre varias cuotas (la reserva y la primera cuota juntas). */
export function restoDeMovimiento(e: EstadoApp, mov: Movimiento): number {
  const imputado = e.pagos.filter((p) => p.movimientoId === mov.id).reduce((a, p) => a + p.monto, 0);
  return Math.round((mov.monto - imputado) * 100) / 100;
}
