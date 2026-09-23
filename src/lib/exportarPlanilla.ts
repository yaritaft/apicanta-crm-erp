import type { EstadoApp, Pago, Venta } from "./types";
import { COLUMNAS_VENTAS, planDePago, tipoDePago } from "./angelo";
import { comisionReferidorDePago, comisionSetterDePago } from "./finanzas";

/* ==================================================================
   La hoja Ventas de la planilla de Angelo, armada desde la app.

   Las mismas 36 columnas, en el mismo orden y con los mismos valores:
   una fila por cobro, el "Valor total de la venta" sólo en la primera
   fila de cada venta (como la cargaba la planilla) y los "¿Tuvo
   setter?" / "¿Es referido?" en SI. Una venta sin cobros va igual, con
   el monto en cero, para que no se pierda.

   Sirve para seguir usando los reportes de la planilla, o para volver
   a pegarla en Google Sheets.
   ================================================================== */

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/* El día en Argentina: la planilla anota el día del negocio. */
function partes(iso: string) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600000);
  return { dia: d.getUTCDate(), mes: d.getUTCMonth(), anio: d.getUTCFullYear() };
}
const fecha = (iso: string) => { const p = partes(iso); return `${p.dia}/${p.mes + 1}/${p.anio}`; };
const mes = (iso: string) => { const p = partes(iso); return `${MESES[p.mes]}-${String(p.anio).slice(2)}`; };
const numero = (n: number | undefined | null) => (n === undefined || n === null || !Number.isFinite(n) ? "" : String(Math.round(n * 100) / 100));

export function filasParaPlanilla(e: EstadoApp): string[][] {
  const cuotasDe = new Map<string, EstadoApp["cuotas"]>();
  for (const c of e.cuotas) cuotasDe.set(c.ventaId, [...(cuotasDe.get(c.ventaId) ?? []), c]);
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const pagosDe = new Map<string, Pago[]>();
  for (const p of e.pagos) {
    const c = cuotaDe.get(p.cuotaId);
    if (c) pagosDe.set(c.ventaId, [...(pagosDe.get(c.ventaId) ?? []), p]);
  }

  const persona = (v: Venta) => {
    const c = v.contactoId ? e.contactos.find((x) => x.id === v.contactoId) : undefined;
    const l = !c && v.contactoId ? e.leads.find((x) => x.id === v.contactoId) : undefined;
    return {
      nombre: c?.nombre || l?.nombre || v.contactoNombre, email: c?.email || l?.email || "",
      pais: c?.pais || l?.pais || "", telefono: c?.telefono || l?.telefono || "",
    };
  };

  const filas: { orden: string; celdas: string[] }[] = [];
  for (const v of e.ventas) {
    const cuotas = cuotasDe.get(v.id) ?? [];
    const pagos = [...(pagosDe.get(v.id) ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const quien = persona(v);
    const closer = e.equipo.find((x) => x.id === v.closerId)?.nombre ?? "";
    const setter = e.equipo.find((x) => x.id === v.setterId)?.nombre ?? "";
    const comunes = {
      servicio: e.productos.find((x) => x.id === v.productoId)?.nombre ?? "",
      estrategia: e.embudos.find((x) => x.id === v.embudoId)?.nombre ?? "",
      tipo: tipoDePago(v, cuotas), plan: planDePago(v, cuotas),
    };
    const lineas: (Pago | null)[] = pagos.length ? pagos : [null];
    lineas.forEach((p, k) => {
      const cuota = p ? cuotaDe.get(p.cuotaId) : undefined;
      const monto = p?.monto ?? 0;
      const caracteristica = p?.caracteristica
        ?? (cuota ? (cuota.esReserva ? "Reserva" : `Cuota #${cuota.numero}`) : v.estado === "reembolsada" ? "Reembolso" : "");
      const tipoVenta = p?.tipoVenta ?? (k === 0 ? (cuotas.every((c) => c.esReserva) && cuotas.length ? "Solo Reserva" : "Venta Nueva") : "Cuota");
      const comSetter = p ? comisionSetterDePago(e, v, monto) : 0;
      const comReferidor = p ? comisionReferidorDePago(e, v, monto) : 0;
      const cuando = p?.fecha ?? v.fecha;
      filas.push({
        orden: `${cuando}|${v.id}|${k}`,
        celdas: [
          fecha(cuando), mes(cuando), quien.nombre, quien.email, quien.pais, quien.telefono, closer,
          "FALSE", comunes.servicio, v.proyecto ?? "", comunes.estrategia, comunes.tipo, comunes.plan,
          caracteristica, tipoVenta, e.procesadores.find((x) => x.id === p?.procesadorId)?.nombre ?? "",
          numero(k === 0 ? v.precioAcordado : 0), numero(monto), p?.chequeado ? "TRUE" : "FALSE",
          numero(p?.montoArs), numero(p?.tipoCambio), p?.pagador ?? "", p?.cuit ?? "",
          numero(p?.feeMonto ?? 0), "", numero(p?.feeMonto ?? 0),
          p?.comprobanteLink ?? p?.comprobante?.nombre ?? "", k === 0 ? v.notas ?? "" : "",
          v.setterId ? "SI" : "", setter, comSetter ? numero(comSetter) : "",
          v.referidorNombre ? "SI" : "", v.referidorNombre ?? "", v.referidorTelefono ?? "",
          comReferidor ? numero(comReferidor) : "", v.ingresoComunidad ?? "",
        ],
      });
    });
  }
  filas.sort((a, b) => a.orden.localeCompare(b.orden));
  return [[...COLUMNAS_VENTAS], ...filas.map((f) => f.celdas)];
}

/** La tabla como CSV, con las comillas donde hacen falta. */
export function aCSV(tabla: string[][]): string {
  const celda = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return tabla.map((f) => f.map(celda).join(",")).join("\n");
}
