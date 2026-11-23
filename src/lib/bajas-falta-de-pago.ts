import type { Cuota, EstadoApp, ID, Venta } from "./types";
import { esOutboarding } from "./outboarding";

/* ==================================================================
   La baja por falta de pago (Liliana, 23/11): «necesito que la app sí o sí me
   avise cuando el closer pone "darlo de baja por falta de pago"; si el alumno
   está automatizado, que se realice automáticamente el outboarding; si es un
   alumno viejo, yo procedo a realizarlo manualmente. Para ambos casos necesitamos
   que me avise para chequear».

   Qué pasaba: «Pido la baja por falta de pago» (lib/cobranza-seguimiento.ts) era
   una etiqueta en la cuota que sólo veía Finanzas. Nadie de Servicio se enteraba:
   Mariano la marcó a dos alumnos el 03/11 y veinte días después
   seguían sin outboarding (en el video intenta etiquetar a Lili en la nota,
   y la nota no avisa a nadie).

   Ahora el pedido tiene dueño en los tres lugares, con ESTA regla:
     · la base le avisa a Customer Success apenas se marca (supabase/baja-por-falta-de-pago.sql),
       entre por la pantalla que entre;
     · la pasada de cada hora le saca los accesos que dio la app (lib/bajas-falta-de-pago-servidor.ts);
     · el panel de Lili lo deja en «Bajas por falta de pago» hasta que ella lo pasa a Outboarding.

   Una cuota pide la baja mientras tenga la marca, su venta siga activa y no se
   haya terminado de pagar: si el alumno paga, el pedido se cae solo. Una cuota
   dada por incobrable (cancelada) la sigue pidiendo: no pagó.
   ================================================================== */

/* Lo que hizo la pasada automática, en `venta.extra[CLAVE_OUTBOARDING_FP]`, una entrada por cuota: así no se repite (si
   Servicio le vuelve a dar accesos a mano, no se los saca de nuevo) y el panel dice qué se sacó y qué queda a mano. */
export const CLAVE_OUTBOARDING_FP = "outboardingPorFaltaDePago";

export interface OutboardingHecho {
  /* Día del negocio (aaaa-mm-dd) e instante (ISO) en que se sacaron. */
  dia: string;
  en: string;
  /* Quién lo pidió (el closer que marcó la cuota). */
  pidio: string;
  /* Las plataformas que se sacaron solas («Telegram») y las que hay que sacar a mano porque no las dio la app. */
  quitados: string[];
  aMano: string[];
  /* Lo que la app dio y no pudo sacar (el recurso). */
  fallaron: string[];
}

/** Lo que hizo la pasada para la venta: la entrada de cualquiera de sus cuotas (la más reciente), o null. */
export function outboardingHecho(venta: Pick<Venta, "extra"> | null | undefined, cuotaIds?: readonly ID[]): OutboardingHecho | null {
  const todo = venta?.extra?.[CLAVE_OUTBOARDING_FP];
  if (!todo || typeof todo !== "object") return null;
  const entradas = Object.entries(todo as Record<string, OutboardingHecho>)
    .filter(([id, h]) => (!cuotaIds || cuotaIds.includes(id)) && h && typeof h.en === "string")
    .map(([, h]) => h)
    .sort((a, b) => b.en.localeCompare(a.en));
  return entradas[0] ?? null;
}

/** ¿Esta cuota pide la baja hoy? Marcada «Pido la baja por falta de pago», con la venta activa y sin terminar de pagar. */
export function pideLaBaja(c: Pick<Cuota, "monto" | "seguimientoCobro">, venta: Pick<Venta, "estado"> | null | undefined, pagado: number): boolean {
  return c.seguimientoCobro?.estado === "baja" && venta?.estado === "activa" && pagado < (Number(c.monto) || 0) - 0.01;
}

export interface PedidoDeBaja {
  venta: Venta;
  /* Las cuotas que la piden, la que vencía antes primero. */
  cuotas: Cuota[];
  /* Quién y cuándo la pidió (la primera marca), y su nota si dejó una. */
  pidio: string;
  en: string;
  nota?: string;
  /* Lo que falta pagar de esas cuotas. */
  debe: number;
  /* Lo que hizo la pasada automática, si le sacó algo. */
  hecho: OutboardingHecho | null;
}

/** Los pedidos de baja vigentes, uno por venta (dos cuotas marcadas de la misma venta son un solo pedido), el más viejo primero. */
export function pedidosDeBaja(e: Pick<EstadoApp, "cuotas" | "ventas" | "pagos">): PedidoDeBaja[] {
  const marcadas = e.cuotas.filter((c) => c.seguimientoCobro?.estado === "baja");
  if (!marcadas.length) return [];
  const ids = new Set(marcadas.map((c) => c.id));
  const pagado = new Map<ID, number>();
  for (const p of e.pagos ?? []) if (ids.has(p.cuotaId)) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + (Number(p.monto) || 0));
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const porVenta = new Map<ID, Cuota[]>();
  for (const c of marcadas) {
    const v = ventas.get(c.ventaId);
    if (!pideLaBaja(c, v, pagado.get(c.id) ?? 0)) continue;
    porVenta.set(c.ventaId, [...(porVenta.get(c.ventaId) ?? []), c]);
  }
  const out: PedidoDeBaja[] = [];
  for (const [ventaId, cuotas] of porVenta) {
    const venta = ventas.get(ventaId)!;
    cuotas.sort((a, b) => (a.vence ?? "").localeCompare(b.vence ?? "") || a.numero - b.numero);
    const primera = [...cuotas].sort((a, b) => a.seguimientoCobro!.en.localeCompare(b.seguimientoCobro!.en))[0].seguimientoCobro!;
    const nota = cuotas.map((c) => c.seguimientoCobro?.nota?.trim()).filter(Boolean).join(" · ") || undefined;
    const debe = Math.round(cuotas.reduce((s, c) => s + Math.max(0, (Number(c.monto) || 0) - (pagado.get(c.id) ?? 0)), 0) * 100) / 100;
    out.push({ venta, cuotas, pidio: primera.por, en: primera.en, nota, debe, hecho: outboardingHecho(venta, cuotas.map((c) => c.id)) });
  }
  return out.sort((a, b) => a.en.localeCompare(b.en));
}

/** ¿Servicio ya cerró el pedido? Cuando el alumno pasa a Outboarding (o a baja), el pedido sale de su lista. */
export const bajaResuelta = (followUp: string | null | undefined, estadoAlumno?: string | null): boolean =>
  esOutboarding(followUp) || estadoAlumno === "baja";

const unirConY = (xs: readonly string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Qué le toca a Servicio, en pocas palabras (va primero en su lista, donde el renglón se corta): lo que se sacó solo y lo que queda a mano. */
export function queFaltaDeLaBaja(hecho: OutboardingHecho | null): string {
  if (!hecho) return "Outboarding a mano (sus accesos no son de la app)";
  const falta = [...hecho.aMano, ...hecho.fallaron];
  if (!hecho.quitados.length) return `Outboarding a mano: ${unirConY(falta)}`;
  return `Le sacamos solos ${unirConY(hecho.quitados)}${falta.length ? `; falta a mano: ${unirConY(falta)}` : ": revisá y pasalo a Outboarding"}`;
}
