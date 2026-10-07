import type { Devolucion, EstadoApp, ID, Moneda, Pago, ProveedorPasarela, Venta } from "./types";

/* ==================================================================
   Los reembolsos que informa una pasarela, atados a las devoluciones.

   Stripe, Hotmart y Whop saben cuándo se le devolvió la plata a un cliente.
   Hasta ahora esa fila se descartaba ("sin monto positivo: reembolso") y la
   devolución sólo existía si alguien la cargaba a mano. Ahora son dos
   mitades de lo mismo:

     · la que carga Finanzas o el director (con su comprobante), y
     · la que informa la pasarela (su id, el cobro que devuelve, el monto).

   Esta pieza las junta, sin tocar plata:

     1. Si el reembolso ya está atado a una devolución (por su id, o por el
        mismo cobro y el mismo monto), no entra de nuevo.
     2. Si hay UNA devolución cargada a mano que calza (la misma venta o la
        misma persona, el mismo monto, en esos días, por una cuenta de esa
        pasarela), se le ata: queda con la referencia de la pasarela y deja
        de ser «lo que cargó alguien» a secas.
     3. Si no, entra como una PROPUESTA (estado «propuesta»): no cuenta en
        Finanzas hasta que alguien la confirme con su comprobante, la ate a
        una cargada o diga que no es una devolución. Nunca se confirma sola:
        un reembolso de la pasarela es un aviso, no una orden de restar plata.

   Una propuesta sólo sabe de qué venta es si el cobro que devuelve ya está
   cargado (un pago con la misma referencia, o un cobro de la pasarela ya
   conciliado). Con dudas —varias devoluciones que calzan— no se ata nada:
   la propuesta queda con las candidatas anotadas para decidir a mano.

   Todo es puro: el mismo código decide en el servidor (webhook, cron) y en
   el navegador (importar un CSV, «Sincronizar»).
   ================================================================== */

/** Lo que una pasarela informa de plata que le devolvió a un cliente. */
export interface ReembolsoCrudo {
  proveedor: ProveedorPasarela;
  /* El id de ese reembolso en la pasarela ("re_3Q…"). Si la pasarela no tiene
     uno propio (Hotmart), el del cobro con el prefijo «reembolso:». */
  referencia: string;
  /* El/los cobros que se devuelven ("ch_…" y el "pi_…" de Stripe). */
  referenciasCobro?: string[];
  monto: number;
  moneda: Moneda;
  /* Cuándo se devolvió; si la pasarela no lo dice, la del cobro (y se marca). */
  fecha: string;
  fechaDelCobro?: boolean;
  clienteNombre?: string;
  clienteEmail?: string;
  /* Lo que dijo la pasarela: «requested_by_customer», «contracargo»… */
  motivo?: string;
  procesadorId?: ID;
}

/** Cómo queda anotado en `Devolucion.referencia`: «stripe:re_3Q…». */
export const referenciaDeReembolso = (r: Pick<ReembolsoCrudo, "proveedor" | "referencia">): string =>
  `${r.proveedor}:${r.referencia}`;

/** El id de la propuesta sale de la referencia: el servidor y el navegador
 *  arman el mismo, así que guardar dos veces el mismo aviso no duplica nada. */
export const idDePropuesta = (r: Pick<ReembolsoCrudo, "proveedor" | "referencia">): ID =>
  `dev_${r.proveedor}_${r.referencia}`.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 120);

const DIA = 86400000;
/* Cuántos días de diferencia entre la devolución cargada y la de la pasarela
   todavía se toman por la misma: se carga el día que se hace, la pasarela la
   acredita un par de días después. */
export const DIAS_PARA_ATAR = 10;

const r2 = (n: number) => Math.round(n * 100) / 100;
const sinTildes = (s: string | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const quien = (e: Pick<EstadoApp, "contactos" | "leads">, v: Venta): { nombre: string; email: string } => {
  const c = v.contactoId ? (e.contactos ?? []).find((x) => x.id === v.contactoId) ?? (e.leads ?? []).find((x) => x.id === v.contactoId) : undefined;
  return { nombre: sinTildes(c?.nombre ?? v.contactoNombre), email: sinTildes(c?.email) };
};

type Base = Pick<EstadoApp, "ventas" | "cuotas" | "pagos" | "movimientos" | "devoluciones" | "procesadores" | "contactos" | "leads">;

/* ---------- De qué venta es el cobro que se devuelve ---------- */

export interface CobroDevuelto {
  venta: Venta;
  pago?: Pago;
}

/** El cobro que se devuelve, si ya está cargado: un pago con esa referencia, o
 *  un cobro de la pasarela ya conciliado. Sin cobro cargado no se adivina la
 *  venta. */
export function cobroDelReembolso(e: Base, r: Pick<ReembolsoCrudo, "proveedor" | "referenciasCobro">): CobroDevuelto | null {
  const refs = (r.referenciasCobro ?? []).filter(Boolean);
  if (refs.length === 0) return null;
  const ventaPorId = new Map((e.ventas ?? []).map((v) => [v.id, v] as const));
  const cuotaPorId = new Map((e.cuotas ?? []).map((c) => [c.id, c] as const));

  const pago = (e.pagos ?? []).find((p) => p.referencia && refs.includes(p.referencia));
  if (pago) {
    const v = ventaPorId.get(cuotaPorId.get(pago.cuotaId)?.ventaId ?? "");
    if (v) return { venta: v, pago };
  }
  const mov = (e.movimientos ?? []).find((m) => m.proveedor === r.proveedor && refs.includes(m.referencia) && (m.ventaId || m.cuotaId || m.pagoId));
  if (mov) {
    const p = mov.pagoId ? (e.pagos ?? []).find((x) => x.id === mov.pagoId) : undefined;
    const v = ventaPorId.get(mov.ventaId ?? "") ?? ventaPorId.get(cuotaPorId.get(mov.cuotaId ?? p?.cuotaId ?? "")?.ventaId ?? "");
    if (v) return { venta: v, pago: p };
  }
  return null;
}

/* ---------- Con qué devolución cargada calza ---------- */

/** ¿Esa devolución puede ser la misma que informó la pasarela? Sin referencia
 *  propia (todavía no está atada), por la misma venta o la misma persona, el
 *  mismo monto y en esos días; y, si dice por qué cuenta salió, que sea una de
 *  esa pasarela. */
export function calzaConReembolso(
  e: Base, d: Devolucion, r: ReembolsoCrudo, cobro: CobroDevuelto | null,
): boolean {
  if (d.estado !== "confirmada" || d.referencia) return false;
  if (Math.abs(d.monto - r.monto) > 0.01) return false;
  if (!r.fechaDelCobro && Math.abs(Date.parse(d.fecha) - Date.parse(r.fecha)) > DIAS_PARA_ATAR * DIA) return false;

  const cuenta = d.procesadorId ? (e.procesadores ?? []).find((p) => p.id === d.procesadorId) : undefined;
  if (cuenta?.proveedor && cuenta.proveedor !== r.proveedor) return false;

  const venta = d.ventaId ? (e.ventas ?? []).find((v) => v.id === d.ventaId) : undefined;
  if (!venta) return false;
  if (cobro) return cobro.venta.id === venta.id;
  /* Sin cobro cargado: la misma persona. El correo es lo más firme; sin él,
     el nombre entero. */
  const q = quien(e, venta);
  if (r.clienteEmail && q.email) return sinTildes(r.clienteEmail) === q.email;
  return Boolean(r.clienteNombre && q.nombre && sinTildes(r.clienteNombre) === q.nombre);
}

/** Las devoluciones cargadas a mano con las que puede estar atada una propuesta
 *  (o un reembolso): las que decide `calzaConReembolso`. */
export function candidatasDe(e: Base, r: ReembolsoCrudo): Devolucion[] {
  const cobro = cobroDelReembolso(e, r);
  return (e.devoluciones ?? []).filter((d) => calzaConReembolso(e, d, r, cobro));
}

/** Una propuesta ya guardada, de vuelta a lo que informó la pasarela: sirve para
 *  buscar sus candidatas con las mismas reglas. */
export function reembolsoDePropuesta(d: Devolucion): ReembolsoCrudo | null {
  if (d.estado !== "propuesta" || !d.referencia || !d.proveedor) return null;
  const extra = d.extra ?? {};
  const refs = Array.isArray(extra.referenciasCobro) ? (extra.referenciasCobro as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    proveedor: d.proveedor,
    referencia: d.referencia.startsWith(`${d.proveedor}:`) ? d.referencia.slice(d.proveedor.length + 1) : d.referencia,
    referenciasCobro: refs,
    monto: d.monto, moneda: d.moneda, fecha: d.fecha,
    fechaDelCobro: extra.fechaDelCobro === true,
    clienteNombre: typeof extra.clienteNombre === "string" ? extra.clienteNombre : undefined,
    clienteEmail: typeof extra.clienteEmail === "string" ? extra.clienteEmail : undefined,
    motivo: d.motivo, procesadorId: d.procesadorId,
  };
}

/* ---------- Propuestas ---------- */

/** El reembolso como propuesta de devolución: no cuenta hasta que alguien la
 *  confirma. Guarda lo que hace falta para volver a buscarle candidatas. */
export function propuestaDe(r: ReembolsoCrudo, ventaId: ID | undefined, ahora: string): Devolucion {
  return {
    id: idDePropuesta(r),
    ...(ventaId ? { ventaId } : {}),
    monto: r2(r.monto), moneda: r.moneda, fecha: r.fecha,
    ...(r.procesadorId ? { procesadorId: r.procesadorId } : {}),
    noDescontarAlCloser: false,
    estado: "propuesta",
    ...(r.motivo ? { motivo: r.motivo } : {}),
    referencia: referenciaDeReembolso(r), proveedor: r.proveedor,
    creadoEn: ahora,
    extra: {
      origen: "pasarela",
      ...(r.referenciasCobro?.length ? { referenciasCobro: r.referenciasCobro } : {}),
      ...(r.fechaDelCobro ? { fechaDelCobro: true } : {}),
      ...(r.clienteNombre ? { clienteNombre: r.clienteNombre } : {}),
      ...(r.clienteEmail ? { clienteEmail: r.clienteEmail } : {}),
    },
  };
}

export interface ResultadoReembolsos {
  /* Devoluciones cargadas a mano a las que se les ató el reembolso de la pasarela. */
  atadas: { devolucionId: ID; referencia: string; cambios: Partial<Devolucion> }[];
  /* Propuestas nuevas para confirmar. */
  nuevas: Devolucion[];
  /* Ya estaban atados o propuestos: no se repiten. */
  yaEstaban: number;
  /* Calzan con más de una devolución cargada: quedaron como propuesta, con las
     candidatas anotadas, para decidir a mano. */
  dudosas: number;
}

/** Qué hacer con lo que informó una pasarela, dado lo que ya hay cargado. No
 *  escribe nada: devuelve qué atar y qué proponer. */
export function conciliarReembolsos(e: Base, crudos: ReembolsoCrudo[], ahora: string): ResultadoReembolsos {
  const out: ResultadoReembolsos = { atadas: [], nuevas: [], yaEstaban: 0, dudosas: 0 };
  const referencias = new Set((e.devoluciones ?? []).map((d) => d.referencia).filter(Boolean) as string[]);
  const idsUsados = new Set((e.devoluciones ?? []).map((d) => d.id));
  /* Dos fuentes pueden informar el mismo reembolso con otro id (el CSV trae el
     cargo; la API, el re_…): el mismo cobro y el mismo monto es el mismo. */
  const yaDeCobro = (r: ReembolsoCrudo) => (e.devoluciones ?? []).some((d) => {
    if (!d.referencia || d.proveedor !== r.proveedor || Math.abs(d.monto - r.monto) > 0.01) return false;
    const cobros = Array.isArray(d.extra?.referenciasCobro) ? (d.extra.referenciasCobro as unknown[]) : [];
    return (r.referenciasCobro ?? []).some((c) => cobros.includes(c));
  });
  const ocupadas = new Set<ID>();

  for (const r of crudos) {
    if (!r.referencia || !(r.monto > 0)) continue;
    const ref = referenciaDeReembolso(r);
    if (referencias.has(ref) || idsUsados.has(idDePropuesta(r)) || yaDeCobro(r)) { out.yaEstaban++; continue; }

    const cobro = cobroDelReembolso(e, r);
    const candidatas = candidatasDe(e, r).filter((d) => !ocupadas.has(d.id));
    if (candidatas.length === 1) {
      const d = candidatas[0];
      ocupadas.add(d.id);
      referencias.add(ref);
      out.atadas.push({
        devolucionId: d.id, referencia: ref,
        cambios: {
          referencia: ref, proveedor: r.proveedor, conciliadaEn: ahora,
          ...(d.procesadorId || !r.procesadorId ? {} : { procesadorId: r.procesadorId }),
          extra: { ...(d.extra ?? {}), ...(r.referenciasCobro?.length ? { referenciasCobro: r.referenciasCobro } : {}) },
        },
      });
      continue;
    }
    const p = propuestaDe(r, cobro?.venta.id, ahora);
    if (candidatas.length > 1) {
      p.extra = { ...p.extra, candidatas: candidatas.map((d) => d.id) };
      out.dudosas++;
    }
    referencias.add(ref);
    idsUsados.add(p.id);
    out.nuevas.push(p);
  }
  return out;
}

/** Atar una propuesta a una devolución cargada a mano (lo que se decide cuando
 *  hay dudas, o cuando la persona sabe que es la misma): la cargada toma la
 *  referencia de la pasarela y la propuesta se va. */
export function atarPropuesta(
  e: Pick<EstadoApp, "devoluciones">, propuestaId: ID, devolucionId: ID, ahora: string,
): { devolucionId: ID; cambios: Partial<Devolucion>; quitarPropuesta: ID } | null {
  const lista = e.devoluciones ?? [];
  const p = lista.find((d) => d.id === propuestaId);
  const d = lista.find((x) => x.id === devolucionId);
  if (!p || p.estado !== "propuesta" || !p.referencia || !d || d.estado !== "confirmada" || d.referencia) return null;
  const refs = Array.isArray(p.extra?.referenciasCobro) ? p.extra.referenciasCobro : undefined;
  return {
    devolucionId, quitarPropuesta: propuestaId,
    cambios: {
      referencia: p.referencia, proveedor: p.proveedor, conciliadaEn: ahora,
      ...(d.procesadorId || !p.procesadorId ? {} : { procesadorId: p.procesadorId }),
      extra: { ...(d.extra ?? {}), ...(refs ? { referenciasCobro: refs } : {}) },
    },
  };
}

/** Las propuestas que todavía esperan una decisión, de la más nueva a la más vieja. */
export function propuestasPendientes(e: Pick<EstadoApp, "devoluciones">): Devolucion[] {
  return (e.devoluciones ?? [])
    .filter((d) => d.estado === "propuesta")
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
}

/** Cuántas propuestas calzan con UNA sola devolución cargada: se pueden atar
 *  todas juntas con un clic. */
export function propuestasAtables(e: Base): { propuestaId: ID; devolucionId: ID }[] {
  const out: { propuestaId: ID; devolucionId: ID }[] = [];
  const usadas = new Set<ID>();
  for (const p of propuestasPendientes(e)) {
    const r = reembolsoDePropuesta(p);
    if (!r) continue;
    const c = candidatasDe(e, r).filter((d) => !usadas.has(d.id));
    if (c.length !== 1) continue;
    usadas.add(c[0].id);
    out.push({ propuestaId: p.id, devolucionId: c[0].id });
  }
  return out;
}
