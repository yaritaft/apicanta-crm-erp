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

/* ---------- Índices ----------
   Lo que se busca una y otra vez (cuánto se pagó de cada cuota, la venta de
   una cuota, por qué medios pagó cada venta) se arma una vez por estado.
   Sin esto, proponer a qué cuota va cada cobro recorría todos los pagos por
   cada cuota y por cada cobro: casi un segundo con los datos de hoy, y la
   pantalla lo pide en cada render. */

interface Indice {
  pagos: EstadoApp["pagos"]; cuotas: EstadoApp["cuotas"]; ventas: EstadoApp["ventas"];
  leads: EstadoApp["leads"]; productos: EstadoApp["productos"];
  pagadoCuota: Map<ID, number>;
  imputadoMov: Map<ID, number>;
  cuota: Map<ID, Cuota>;
  venta: Map<ID, Venta>;
  lead: Map<ID, EstadoApp["leads"][number]>;
  producto: Map<ID, string>;
  /* Por qué medios (procesadorId) ya pagó cada venta. */
  medios: Map<ID, Set<ID | undefined>>;
  /* Los pagos sin conciliar de cada cuenta, para buscar los ya cargados. */
  sueltosPorCuenta: Map<ID, Pago[]>;
}

let IX: Indice | null = null;

function indice(e: EstadoApp): Indice {
  if (IX && IX.pagos === e.pagos && IX.cuotas === e.cuotas && IX.ventas === e.ventas
    && IX.leads === e.leads && IX.productos === e.productos) return IX;
  const cuota = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const pagadoCuota = new Map<ID, number>();
  const imputadoMov = new Map<ID, number>();
  const medios = new Map<ID, Set<ID | undefined>>();
  const sueltosPorCuenta = new Map<ID, Pago[]>();
  for (const p of e.pagos) {
    pagadoCuota.set(p.cuotaId, (pagadoCuota.get(p.cuotaId) ?? 0) + p.monto);
    if (p.movimientoId) imputadoMov.set(p.movimientoId, (imputadoMov.get(p.movimientoId) ?? 0) + p.monto);
    const v = cuota.get(p.cuotaId)?.ventaId;
    if (v) { const m = medios.get(v) ?? new Set(); m.add(p.procesadorId); medios.set(v, m); }
    if (!p.movimientoId && p.procesadorId) {
      const xs = sueltosPorCuenta.get(p.procesadorId);
      if (xs) xs.push(p); else sueltosPorCuenta.set(p.procesadorId, [p]);
    }
  }
  IX = {
    pagos: e.pagos, cuotas: e.cuotas, ventas: e.ventas, leads: e.leads, productos: e.productos,
    pagadoCuota, imputadoMov, cuota, medios, sueltosPorCuenta,
    venta: new Map(e.ventas.map((v) => [v.id, v] as const)),
    lead: new Map(e.leads.map((l) => [l.id, l] as const)),
    producto: new Map(e.productos.map((x) => [x.id, x.nombre] as const)),
  };
  return IX;
}

/* ---------- Saldos ---------- */

export function pagadoDeCuota(e: EstadoApp, cuotaId: ID): number {
  return indice(e).pagadoCuota.get(cuotaId) ?? 0;
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

  const ix = indice(e);
  const ventas = ix.venta;
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
    const lead = venta.contactoId ? ix.lead.get(venta.contactoId) : undefined;
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
    const yaUso = Boolean(ix.medios.get(venta.id)?.has(mov.procesadorId));
    if (yaUso) { puntaje += 6; motivos.push("Ya pagó por acá antes"); }

    /* 5. Qué compró */
    const producto = venta.productoId ? ix.producto.get(venta.productoId) : undefined;
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

/* ---------- El cobro ya está cargado ----------
   Muchos cobros de pasarela ya están en la app como pago: se cargaron a
   mano o vinieron de la planilla de Angelo. Imputarlos a una cuota
   crearía otro pago por la misma plata (y el motor, que busca cuotas con
   saldo, propondría la siguiente cuota de la misma persona). Lo correcto
   es atarlos al pago que ya existe: no suma plata y le pone la comisión
   real de la pasarela. Se busca en la misma cuenta, con el mismo monto
   (±2%) y hasta 7 días de diferencia. */

export interface PagoYaCargado {
  pago: Pago;
  cuota?: Cuota;
  venta?: Venta;
  puntaje: number;
  motivos: string[];
  dias: number;
}

export function pagosYaCargados(e: EstadoApp, mov: Movimiento): PagoYaCargado[] {
  if (mov.estado !== "pendiente") return [];
  const proc = procesadorDeMovimiento(e, mov);
  if (!proc) return [];
  const ix = indice(e);
  const out: PagoYaCargado[] = [];
  const t = new Date(mov.fecha).getTime();
  for (const p of ix.sueltosPorCuenta.get(proc.id) ?? []) {
    if (Math.abs(p.monto - mov.monto) > Math.max(1, mov.monto * 0.02)) continue;
    const dias = Math.abs(new Date(p.fecha).getTime() - t) / DIA;
    if (dias > 7) continue;
    const cuota = ix.cuota.get(p.cuotaId);
    const venta = cuota ? ix.venta.get(cuota.ventaId) : undefined;
    const motivos: string[] = [];
    let puntaje = 0;
    if (Math.abs(p.monto - mov.monto) <= 0.01) { puntaje += 40; motivos.push("mismo monto"); } else { puntaje += 25; motivos.push("monto casi igual"); }
    if (dias < 1) { puntaje += 30; motivos.push("mismo día"); } else if (dias <= 3) { puntaje += 20; motivos.push(`${Math.round(dias)} días de diferencia`); } else { puntaje += 8; motivos.push(`${Math.round(dias)} días de diferencia`); }
    const nombre = Math.max(parecido(mov.clienteNombre, venta?.contactoNombre), parecido(mov.clienteNombre, p.pagador));
    if (nombre >= 0.99) { puntaje += 30; motivos.push("mismo nombre"); } else if (nombre >= 0.5) { puntaje += 15; motivos.push("nombre parecido"); }
    out.push({ pago: p, cuota, venta, puntaje, motivos, dias });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje || a.dias - b.dias);
}

/** Cada cobro con el pago ya cargado que es seguro que es él: buen
 *  puntaje, le gana claro al segundo y ningún otro cobro lo reclama mejor
 *  (un pago va con un solo cobro). */
export function vinculosSeguros(e: EstadoApp, movs?: Movimiento[]): { movimiento: Movimiento; pago: Pago }[] {
  const lista = movs ?? e.movimientos.filter((m) => m.estado === "pendiente");
  const candidatos = lista.flatMap((movimiento) => {
    const [primero, segundo] = pagosYaCargados(e, movimiento);
    if (!primero || primero.puntaje < 70) return [];
    if (segundo && primero.puntaje - segundo.puntaje < 15) return [];
    return [{ movimiento, pago: primero.pago, puntaje: primero.puntaje }];
  }).sort((a, b) => b.puntaje - a.puntaje);
  const usados = new Set<ID>();
  const out: { movimiento: Movimiento; pago: Pago }[] = [];
  for (const c of candidatos) {
    if (usados.has(c.pago.id)) continue;
    usados.add(c.pago.id);
    out.push({ movimiento: c.movimiento, pago: c.pago });
  }
  return out;
}

export interface Propuesta {
  movimiento: Movimiento;
  sugerencias: Sugerencia[];
  automatica: boolean;
  /* Ya hay un pago cargado que puede ser este cobro: no se imputa solo. */
  yaCargado: boolean;
}

export function propuestas(e: EstadoApp, movs?: Movimiento[]): Propuesta[] {
  const lista = movs ?? e.movimientos.filter((m) => m.estado === "pendiente");
  return lista.map((movimiento) => {
    const ss = sugerenciasPara(e, movimiento);
    const yaCargado = pagosYaCargados(e, movimiento).length > 0;
    return { movimiento, sugerencias: ss, automatica: !yaCargado && esAutomatica(ss), yaCargado };
  });
}

/* ---------- Números de la bandeja ---------- */

export function resumenConciliacion(e: EstadoApp) {
  const pendientes = e.movimientos.filter((m) => m.estado === "pendiente");
  const conciliados = e.movimientos.filter((m) => m.estado === "conciliado");
  /* Lo que falta imputar: de un pago usado a medias, sólo lo que queda. */
  const sinConciliar = pendientes.reduce((a, m) => a + restoDeMovimiento(e, m), 0);
  const autos = propuestas(e, pendientes).filter((p) => p.automatica);
  const vinculos = vinculosSeguros(e, pendientes);
  return {
    /* Cobros que ya están cargados como pago y se atan solos. */
    vinculables: vinculos.length,
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
    /* Conciliado es chequeado en la plataforma: la plata está en la pasarela. */
    chequeado: true,
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
  const imputado = indice(e).imputadoMov.get(mov.id) ?? 0;
  return Math.round((mov.monto - imputado) * 100) / 100;
}
