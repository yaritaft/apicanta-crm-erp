import type { ID, Pago, Procesador } from "./types";
import { diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   Cuándo se acredita un cobro (Aldana, 28/10/2026): «Hotmart ahora retiene
   el dinero 15 días: entró un pago ayer y recién el 11/11 lo veo acreditado.
   Que el closer no lo comisione y que la caja no lo registre hasta esa fecha».

   Una cuenta con `diasDeRetencion` acredita lo que cobra esos días después
   del pago, para los pagos desde `retencionDesde`. Hasta ese día el cobro
   existe (la cuota figura pagada, el cliente pagó) pero no cuenta como plata:
   ni para la caja, ni para el cash collected del mes, ni para las comisiones.
   Todo eso sale de `pagosDelMes` (lib/finanzas.ts) y de `saldosEsperados`
   (lib/traspasos.ts), que miran este día y no el del pago.
   ================================================================== */

type Cuenta = Pick<Procesador, "id" | "diasDeRetencion" | "retencionDesde">;
export interface Retencion { dias: number; desde: string }

const DIA_MS = 86_400_000;

/** Las cuentas que retienen, por id. Sin ninguna, el mapa viene vacío y todo cuenta el día del pago. */
export function retenciones(procesadores: readonly Cuenta[] | undefined): Map<ID, Retencion> {
  const out = new Map<ID, Retencion>();
  for (const p of procesadores ?? []) {
    const dias = Math.floor(Number(p.diasDeRetencion ?? 0));
    if (dias > 0) out.set(p.id, { dias, desde: (p.retencionDesde ?? "").slice(0, 10) });
  }
  return out;
}

/** El día (ISO) en que el cobro cuenta como plata: el del pago, o ese más los días que retiene su cuenta. */
export function fechaDeAcreditacion(p: Pick<Pago, "fecha" | "procesadorId">, ret: ReadonlyMap<ID, Retencion>): string {
  const r = p.procesadorId ? ret.get(p.procesadorId) : undefined;
  if (!r) return p.fecha;
  if (r.desde && diaDeNegocio(p.fecha) < r.desde) return p.fecha;
  const t = Date.parse(p.fecha);
  return Number.isFinite(t) ? new Date(t + r.dias * DIA_MS).toISOString() : p.fecha;
}

/** ¿El cobro todavía no se acreditó al momento `ahora`? */
export function estaPorAcreditar(p: Pick<Pago, "fecha" | "procesadorId">, ret: ReadonlyMap<ID, Retencion>, ahora = Date.now()): boolean {
  const a = fechaDeAcreditacion(p, ret);
  return a !== p.fecha && Date.parse(a) > ahora;
}

/** Lo que las cuentas con retención tienen cobrado y sin acreditar: cuántos cobros y cuánto (en la moneda base de los pagos). */
export function porAcreditar(
  e: { pagos: readonly Pick<Pago, "fecha" | "procesadorId" | "monto" | "feeMonto">[]; procesadores: readonly Cuenta[] },
  ahora = Date.now(),
): { cobros: number; monto: number } {
  const ret = retenciones(e.procesadores);
  if (ret.size === 0) return { cobros: 0, monto: 0 };
  let cobros = 0, monto = 0;
  for (const p of e.pagos) {
    if (!estaPorAcreditar(p, ret, ahora)) continue;
    cobros++;
    monto += p.monto - p.feeMonto;
  }
  return { cobros, monto: Math.round(monto * 100) / 100 };
}
