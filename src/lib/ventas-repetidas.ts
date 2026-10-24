import type { EstadoApp, ID, Venta } from "./types";

/* ==================================================================
   Una venta cargada dos veces (Aldana, 24/10).

   Jorge David Llamas Olivero: el closer cargó su venta de Hackear AI (US$ 3.000) con un pago a mano que Finanzas chequeó con el comprobante, y horas
   después se cargó otra igual con el cobro que la pasarela había conciliado. Era la misma plata y la misma compra: quedó «Pagó todo US$ 6.000». La
   cancelaron, pero una venta cancelada conserva lo cobrado (es plata que existe), así que seguía sumando.

   Dos piezas:
   · `ventasIdenticas` para avisar ANTES de cargar una venta que ya existe (misma persona, mismo servicio, mismo precio, en esos días);
   · `gruposDeVentasRepetidas` para encontrar las que ya quedaron cargadas dos veces, también cuando una ya se canceló pero sigue cobrada.

   Es un aviso, no una prohibición: a veces es de verdad otra compra (dos hermanos que pagan con el mismo mail, una renovación por el mismo precio).
   ================================================================== */

/** Cuántos días de diferencia entre dos ventas iguales todavía se toman por la misma carga. */
export const DIAS_PARA_REPETIDA = 3;
const DIA = 86400000;

const sinTildes = (s: string | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const solo9 = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-9);

export interface QuienCompra { contactoId?: ID; nombre?: string; email?: string; telefono?: string }

type Base = Pick<EstadoApp, "ventas" | "cuotas" | "pagos" | "contactos" | "leads">;

/** Quién es la persona de una venta, con lo que se sepa de su contacto. */
export function quienDeLaVenta(e: Pick<EstadoApp, "contactos" | "leads">, v: Pick<Venta, "contactoId" | "contactoNombre">): QuienCompra {
  const c = v.contactoId ? (e.contactos ?? []).find((x) => x.id === v.contactoId) ?? (e.leads ?? []).find((x) => x.id === v.contactoId) : undefined;
  return { contactoId: v.contactoId, nombre: c?.nombre ?? v.contactoNombre, email: c?.email, telefono: c?.telefono };
}

/** ¿Es la misma persona? El mismo contacto, el mismo mail, el mismo teléfono o el mismo nombre entero. Un nombre parecido no alcanza. */
export function mismaPersona(a: QuienCompra, b: QuienCompra): boolean {
  if (a.contactoId && a.contactoId === b.contactoId) return true;
  if (a.email && b.email && sinTildes(a.email) === sinTildes(b.email)) return true;
  const ta = solo9(a.telefono);
  if (ta.length >= 8 && ta === solo9(b.telefono)) return true;
  const na = sinTildes(a.nombre);
  return na.length > 0 && na === sinTildes(b.nombre);
}

/** Lo cobrado de una venta: la suma de los pagos de sus cuotas. */
export function cobradoDeVenta(e: Pick<EstadoApp, "cuotas" | "pagos">, ventaId: ID): number {
  const cuotas = new Set(e.cuotas.filter((c) => c.ventaId === ventaId).map((c) => c.id));
  return Math.round(e.pagos.filter((p) => cuotas.has(p.cuotaId)).reduce((a, p) => a + p.monto, 0) * 100) / 100;
}

/** Las dos ventas que alguien ya revisó y dijo «son compras distintas» (`extra.noEsRepetida`, en cualquiera de las dos): no se vuelven a proponer. */
export const noSonRepetidas = (a: Pick<Venta, "id" | "extra">, b: Pick<Venta, "id" | "extra">): boolean => {
  const marca = (v: Pick<Venta, "extra">) => (Array.isArray(v.extra?.noEsRepetida) ? (v.extra.noEsRepetida as unknown[]) : []);
  return marca(a).includes(b.id) || marca(b).includes(a.id);
};

/** Una venta que todavía cuenta: activa, o dada de baja pero con plata cobrada (esa plata sigue sumando). */
const cuenta = (e: Pick<EstadoApp, "cuotas" | "pagos">, v: Pick<Venta, "id" | "estado">) => v.estado === "activa" || cobradoDeVenta(e, v.id) > 0.01;

export interface DatosDeVenta {
  quien: QuienCompra;
  productoId?: ID;
  precioAcordado: number;
  fecha: string;
}

const mismaCompra = (a: DatosDeVenta, b: DatosDeVenta, dias: number): boolean =>
  (a.productoId ?? "") === (b.productoId ?? "") && Math.abs(a.precioAcordado - b.precioAcordado) <= 0.01
  && Math.abs(Date.parse(a.fecha) - Date.parse(b.fecha)) <= dias * DIA && mismaPersona(a.quien, b.quien);

const datosDe = (e: Pick<EstadoApp, "contactos" | "leads">, v: Venta): DatosDeVenta => ({
  quien: quienDeLaVenta(e, v), productoId: v.productoId, precioAcordado: v.precioAcordado, fecha: v.fecha,
});

/** Las ventas ya cargadas que son idénticas a esta (la que se está por cargar, o una que ya está): misma persona, mismo servicio, mismo precio, en esos días. */
export function ventasIdenticas(e: Base, dato: DatosDeVenta, opciones: { ignorar?: ID; dias?: number } = {}): Venta[] {
  const dias = opciones.dias ?? DIAS_PARA_REPETIDA;
  return (e.ventas ?? [])
    .filter((v) => v.id !== opciones.ignorar && cuenta(e, v) && mismaCompra(dato, datosDe(e, v), dias))
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
}

/** Los grupos de ventas que parecen la misma compra cargada más de una vez (cada grupo con dos o más). Sólo cuentan las que todavía suman. */
export function gruposDeVentasRepetidas(e: Base, soloDe?: QuienCompra): Venta[][] {
  const vivas = (e.ventas ?? []).filter((v) => cuenta(e, v));
  /* Se junta por servicio y precio para no comparar todas contra todas. */
  const cubos = new Map<string, Venta[]>();
  for (const v of vivas) {
    const k = `${v.productoId ?? ""}|${Math.round(v.precioAcordado * 100)}`;
    cubos.set(k, [...(cubos.get(k) ?? []), v]);
  }
  const grupos: Venta[][] = [];
  for (const lista of cubos.values()) {
    if (lista.length < 2) continue;
    const datos = new Map(lista.map((v) => [v.id, datosDe(e, v)] as const));
    const visto = new Set<ID>();
    for (const v of lista) {
      if (visto.has(v.id)) continue;
      const grupo = [v];
      visto.add(v.id);
      /* Un grupo crece: A igual a B y B igual a C (aunque A y C estén más lejos) es una sola carga repetida. */
      for (let i = 0; i < grupo.length; i++) {
        for (const w of lista) {
          if (!visto.has(w.id) && !noSonRepetidas(grupo[i], w) && mismaCompra(datos.get(grupo[i].id)!, datos.get(w.id)!, DIAS_PARA_REPETIDA)) { grupo.push(w); visto.add(w.id); }
        }
      }
      if (grupo.length > 1) grupos.push(grupo.sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn)));
    }
  }
  const filtrados = soloDe ? grupos.filter((g) => g.some((v) => mismaPersona(quienDeLaVenta(e, v), soloDe))) : grupos;
  return filtrados.sort((a, b) => Date.parse(b[0].creadoEn) - Date.parse(a[0].creadoEn));
}

/** De un grupo repetido, la que conviene dejar: la que está activa y, entre varias, la primera que se cargó (la que ya tiene su servicio, su contrato y su cobro). */
export function ventaParaDejar(e: Pick<EstadoApp, "cuotas" | "pagos">, grupo: readonly Venta[]): Venta {
  const activas = grupo.filter((v) => v.estado === "activa");
  const candidatas = activas.length ? activas : [...grupo];
  return [...candidatas].sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn) || cobradoDeVenta(e, b.id) - cobradoDeVenta(e, a.id))[0];
}
