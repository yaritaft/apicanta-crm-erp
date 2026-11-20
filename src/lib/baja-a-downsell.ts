import { familiaDePrograma } from "./clientes-cs";
import { esProgramaDeExtension, esProgramaDownsell, mesesDeCorte, sumarMeses, type PlataformaDeAcceso, type Programa } from "./programas";
import { sumarDias } from "./seguimiento";
import type { Cuota, Pago, Producto, Venta } from "./types";

/* ==================================================================
   Pasar a Downsell por falta de pago (Lili, 20/11: «un alumno ingresa a
   Hackear IA pero no puede seguir pagando las cuotas: se toma lo que ya
   abonó y se lo pasa a la modalidad downsell, ajustando el programa y los
   accesos. Que no reinicie ni extienda el plazo de la mentoría: al cumplirse
   el plazo inicial, finaliza su acceso»). Y Yari: «el contenido grabado
   también se pierde pasado el tiempo».

   Un solo paso hace todo lo que antes era a mano:
   - la venta pasa al downsell y vale lo que pagó; las cuotas que no pagó no
     se cobran (quedan «Incobrable» con el motivo, a la vista) y una a medio
     pagar queda saldada en lo que pagó;
   - se le saca hoy lo que el downsell no da (la mentoría: los grupos de
     Telegram y las reuniones de Zoom) y lo que conserva (el contenido de
     Wisboo) se corta solo el día después del fin de su programa;
   - el inicio y el fin NO cambian: la ficha queda con la misma duración,
     aunque el downsell tenga otra, y firmar después el contrato del downsell
     tampoco mueve el inicio (lib/contratos-servidor.ts → alFirmar).

   Lo decide una persona (Customer Success o Finanzas), no la app sola: una
   cuota vencida muchas veces es una que se paga tarde. Este archivo arma el
   plan (puro, se prueba sin base); lo ejecuta lib/baja-a-downsell-servidor.ts.
   ================================================================== */

/** Lo que queda anotado en `venta.extra` al pasarla: de dónde venía, hasta cuándo sigue y quién lo hizo. */
export interface MarcaDeBaja {
  /* El día en que se pasó (aaaa-mm-dd, Argentina). */
  dia: string;
  quien: string;
  motivo: string;
  desdeProductoId: string | null;
  desdePrograma: string;
  precioAnterior: number;
  programa: string;
  /* El fin de su programa (aaaa-mm-dd) y el instante en que se le corta lo que conserva: el día siguiente, a la medianoche de Argentina. */
  fin: string;
  venceEn: string;
  /* Lo que conserva y no dio la app (alumnos de antes): el día del fin se avisa a Customer Success que lo saque a mano. */
  aManoAlFin?: string[];
}

export const CLAVE_DE_BAJA = "bajaADownsell";

/** La marca de una venta que ya pasó a Downsell por falta de pago, o null. */
export function marcaDeBaja(venta: Pick<Venta, "extra"> | null | undefined): MarcaDeBaja | null {
  const m = venta?.extra?.[CLAVE_DE_BAJA];
  if (!m || typeof m !== "object") return null;
  const x = m as Partial<MarcaDeBaja>;
  return typeof x.fin === "string" && typeof x.venceEn === "string" && typeof x.programa === "string" ? (x as MarcaDeBaja) : null;
}

export const MOTIVO_DE_BAJA = "Pasó a Downsell por falta de pago";

export interface AccesoDeBaja {
  id: string; plataforma: PlataformaDeAcceso; recurso: string; recursoNombre: string;
  estado: "pendiente" | "dado" | "entro" | "fallo" | "quitado"; programa: string; venceEn?: string | null;
}

export interface OpcionDeDownsell {
  programaId: string; nombre: string; productoId: string; precio: number;
  /* El más caro que se paga con lo que ya pagó (la opción que sale elegida). */
  alcanza: boolean;
}

/** Los downsells a los que puede pasar (los activos con un producto a la venta; no la extensión del MID), del más barato al más caro.
 *  Sale elegido el más caro que se paga con lo que ya pagó; si no le alcanza para ninguno, el más barato. */
export function downsellsPosibles(programas: readonly Programa[], productos: readonly Pick<Producto, "id" | "precioLista" | "activo">[], cobrado: number): OpcionDeDownsell[] {
  const opciones = programas
    .filter((p) => p.activo && esProgramaDownsell(p.id) && !esProgramaDeExtension(p.id))
    .map((p) => {
      const prod = p.productos.map((id) => productos.find((x) => x.id === id)).find((x) => x && x.activo !== false);
      return prod ? { programaId: p.id, nombre: p.nombre, productoId: prod.id, precio: Number(prod.precioLista) || 0, alcanza: false } : null;
    })
    .filter((x): x is OpcionDeDownsell => x !== null)
    .sort((a, b) => a.precio - b.precio);
  const pagables = opciones.filter((o) => o.precio <= cobrado + 0.009);
  const elegida = pagables.length ? pagables[pagables.length - 1] : opciones[0];
  return opciones.map((o) => ({ ...o, alcanza: o === elegida }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const vigente = (a: Pick<AccesoDeBaja, "estado">) => a.estado === "dado" || a.estado === "entro" || a.estado === "pendiente";

/** Lo que no deja pasarla, o null. */
export function problemaDeBaja(a: {
  venta: Pick<Venta, "estado" | "precioAcordado" | "extra"> | null; origen: Programa | null; cobrado: number; fin: string | null; opciones: readonly OpcionDeDownsell[];
}): string | null {
  if (!a.venta) return "No encuentro la venta de su programa.";
  if (marcaDeBaja(a.venta)) return "Ya pasó a Downsell.";
  if (a.venta.estado !== "activa") return "La venta está dada de baja.";
  if (!a.origen) return "El producto de su venta no es un programa con accesos (Ajustes → Programas).";
  if (esProgramaDownsell(a.origen.id)) return `Ya está en un downsell (${a.origen.nombre}).`;
  if (a.cobrado <= 0.009) return "Todavía no pagó nada: no hay con qué pasarlo a Downsell. Si se va, dale de baja la venta.";
  if (a.cobrado >= a.venta.precioAcordado - 0.009) return "Ya pagó todo su programa: no hay nada que ajustar.";
  if (!a.fin) return "No se sabe cuándo termina su programa: cargá el inicio y la duración en su ficha y volvé a intentar.";
  if (!a.opciones.length) return "No hay ningún downsell activo con producto (Ajustes → Programas).";
  return null;
}

export interface PlanDeBaja {
  cobrado: number;
  precioAnterior: number;
  /* Las cuotas pendientes sin nada pagado: quedan «Incobrable». */
  noSeCobran: Cuota[];
  /* Las que estaban a medio pagar: quedan saldadas en lo que se pagó. */
  saldadas: Cuota[];
  /* Lo que tiene de la app y el downsell no da (o da por menos tiempo del que ya cursó): se le saca hoy. */
  seSacan: AccesoDeBaja[];
  /* Lo que conserva, con el día en que se le corta. */
  quedan: { acceso: AccesoDeBaja; venceEn: string }[];
  /* Lo que el downsell da y no tiene de la app (quizás se lo dieron a mano antes de la app): no se da solo. */
  noTiene: { plataforma: PlataformaDeAcceso; recurso: string }[];
  fin: string;
  venceEn: string;
  /* Los programas de la ficha: el del programa completo cambiado por el downsell. */
  programasFicha: string[];
  /* Pagó menos que el precio de lista del downsell: queda igual en lo que pagó, pero conviene saberlo. */
  pagoMenos: number;
}

/** El instante en que se corta lo que conserva: el día después del fin, a la medianoche de Argentina (como el outboarding: lib/outboarding.ts). */
export const corteDelFin = (fin: string): string => `${sumarDias(fin, 1)}T03:00:00.000Z`;

/** Las familias de nombres del programa completo en la ficha («HACKEAR IA», «Hackear AI», «Mentoría»…): el nombre del programa y el de sus productos. */
function familiasDelOrigen(origen: Programa, productos: readonly Pick<Producto, "id" | "nombre">[]): Set<string> {
  const nombres = [origen.nombre, ...origen.productos.map((id) => productos.find((p) => p.id === id)?.nombre ?? "")];
  return new Set(nombres.map(familiaDePrograma).filter(Boolean));
}

/** Los programas de la ficha después del cambio: sale el completo y entra el downsell; lo demás que tenga (otro programa) queda. */
export function programasDespues(actuales: readonly string[], origen: Programa, destino: Programa, productos: readonly Pick<Producto, "id" | "nombre">[]): string[] {
  const fuera = familiasDelOrigen(origen, productos);
  const quedan = actuales.filter((p) => !fuera.has(familiaDePrograma(p)));
  return quedan.some((p) => familiaDePrograma(p) === familiaDePrograma(destino.nombre)) ? quedan : [...quedan, destino.nombre];
}

export function planDeBaja(a: {
  venta: Pick<Venta, "id" | "precioAcordado">;
  cuotas: readonly Cuota[]; pagos: readonly Pick<Pago, "cuotaId" | "monto">[];
  origen: Programa; destino: Programa; precioDestino: number;
  productos: readonly Pick<Producto, "id" | "nombre">[];
  accesos: readonly AccesoDeBaja[];
  /* El inicio del servicio (ISO) y el fin de su programa (aaaa-mm-dd), calculados ANTES del cambio. */
  inicio: string; fin: string;
  programasFicha: readonly string[];
  ahora?: Date;
}): PlanDeBaja {
  const ahora = (a.ahora ?? new Date()).toISOString();
  const deLaVenta = a.cuotas.filter((c) => c.ventaId === a.venta.id);
  const cobradoDe = (c: Cuota) => r2(a.pagos.filter((p) => p.cuotaId === c.id).reduce((t, p) => t + p.monto, 0));
  const cobrado = r2(deLaVenta.reduce((t, c) => t + cobradoDe(c), 0));
  const noSeCobran: Cuota[] = [];
  const saldadas: Cuota[] = [];
  for (const c of deLaVenta) {
    if (c.estado !== "pendiente") continue;
    const cob = cobradoDe(c);
    if (cob > 0.009) saldadas.push({ ...c, monto: cob, estado: "pagada", notas: c.notas ? `${c.notas} | Quedó en ${cob} (lo pagado): ${MOTIVO_DE_BAJA.toLowerCase()}` : `Quedó en ${cob} (lo pagado): ${MOTIVO_DE_BAJA.toLowerCase()}` });
    else noSeCobran.push(c);
  }

  const venceEn = corteDelFin(a.fin);
  const daDestino = (x: AccesoDeBaja) =>
    (x.plataforma === "wisboo" && a.destino.wisboo.includes(x.recurso))
    || (x.plataforma === "telegram" && a.destino.telegram.includes(x.recurso))
    || (x.plataforma === "zoom" && a.destino.zoom.includes(x.recurso));
  const seSacan: AccesoDeBaja[] = [];
  const quedan: PlanDeBaja["quedan"] = [];
  /* Lo del programa que deja y lo de un downsell anterior (quien subió del Plus+ al completo conserva esas filas con el programa de antes).
     Lo de otro programa que tenga (Hackear Biz) no se toca. */
  for (const x of a.accesos.filter((y) => vigente(y) && (y.programa === a.origen.id || esProgramaDownsell(y.programa)))) {
    if (!daDestino(x)) { seSacan.push(x); continue; }
    /* Lo que el downsell corta a los N meses (la mentoría del MID) cuenta desde el inicio de siempre; si eso ya pasó, se saca hoy. */
    const meses = mesesDeCorte(a.destino, x.plataforma, x.recurso);
    const propio = meses ? sumarMeses(a.inicio, meses) : null;
    const corte = propio && propio < venceEn ? propio : venceEn;
    if (corte <= ahora) seSacan.push(x);
    else quedan.push({ acceso: x, venceEn: corte });
  }
  const tiene = (pl: PlataformaDeAcceso, rec: string) => a.accesos.some((x) => vigente(x) && x.plataforma === pl && x.recurso === rec);
  const noTiene = [
    ...a.destino.wisboo.map((recurso) => ({ plataforma: "wisboo" as const, recurso })),
    ...a.destino.telegram.map((recurso) => ({ plataforma: "telegram" as const, recurso })),
    ...a.destino.zoom.map((recurso) => ({ plataforma: "zoom" as const, recurso })),
  ].filter((x) => !tiene(x.plataforma, x.recurso));

  return {
    cobrado, precioAnterior: a.venta.precioAcordado, noSeCobran, saldadas, seSacan, quedan, noTiene,
    fin: a.fin, venceEn, programasFicha: programasDespues(a.programasFicha, a.origen, a.destino, a.productos),
    pagoMenos: r2(Math.max(0, a.precioDestino - cobrado)),
  };
}

/** Las notas de una cuota que no se va a cobrar: la misma marca que «Dar por incobrable» (lib/cuota-incobrable.ts). */
export const notasDeNoSeCobra = (c: Pick<Cuota, "notas">, motivo: string): string =>
  `Incobrable: ${MOTIVO_DE_BAJA}${motivo.trim() ? ` (${motivo.trim()})` : ""}${c.notas ? ` | ${c.notas}` : ""}`;
