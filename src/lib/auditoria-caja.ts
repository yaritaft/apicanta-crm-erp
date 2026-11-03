import type { EstadoApp, Gasto } from "./types";
import { arqueoVivo, esperadoDelArqueo } from "./arqueo";
import { ultimoArqueo } from "./caja";
import { cuentaDeGasto, situacionDe } from "./traspasos";
import { esPagoDeEquipo } from "./finanzas";
import { fechaDePago, montoOriginal } from "./gastos";
import { personaDelEquipo } from "./gastos-mercury";

/* ==================================================================
   Auditoría de la caja (03/11): lo que, con los datos de hoy, puede hacer que un arqueo no dé sin que nadie se equivoque al contar.

   Nació del arqueo del 31/10 (US$ 30.084 «de más») y de lo que apareció al revisar los datos reales: un cobro a la Financiera ARS sin su
   cambio y gastos cargados en dólares desde esa cuenta, que la cuenta no descontaba. Cada hallazgo dice qué es y cuánto mueve. Se corre con
   `node --import ./pruebas/registrar.mjs scripts/auditar-caja.ts <estado.json>` y la prueba pruebas/auditoria-caja.test.ts la fija.

   Sin React ni red.
   ================================================================== */

export type Gravedad = "error" | "aviso";
export interface Hallazgo { clave: string; gravedad: Gravedad; titulo: string; detalle: string; monto?: number; ids?: string[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `US$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function auditarCaja(e: EstadoApp, ahora = new Date().toISOString()): Hallazgo[] {
  const out: Hallazgo[] = [];
  const arqueos = [...(e.arqueos ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const desdeUltimo = ultimoArqueo(e, ahora)?.fecha ?? null;
  const despuesDelUltimo = (g: Gasto) => !desdeUltimo || fechaDePago(g) > desdeUltimo;

  /* 1 · Cada arqueo: la suma de las cuentas y el total tienen que dar lo mismo, salvo lo que tiene nombre. */
  for (const a of arqueos) {
    if (a.esperado === null || a.esperado === undefined) continue;
    const x = esperadoDelArqueo(e, a);
    const c = x.conciliacion;
    if (c && Math.abs(c.sinExplicar) >= 1) {
      out.push({ clave: `arqueo-sin-explicar:${a.id}`, gravedad: "error", titulo: `El arqueo del ${a.fecha.slice(0, 10)} no concilia`, monto: c.sinExplicar,
        detalle: `La suma de lo que tendría que haber en cada cuenta y el total de la Caja se separan en ${usd(c.sinExplicar)} sin explicación: es un error de la app, no de quien contó.` });
    }
    const v = arqueoVivo(e, a);
    if (v.cambio) {
      out.push({ clave: `arqueo-cambio:${a.id}`, gravedad: "aviso", titulo: `El arqueo del ${a.fecha.slice(0, 10)} cambió desde que se guardó`, monto: r2((v.diferencia ?? 0) - (v.guardada.diferencia ?? 0)),
        detalle: `Al guardarlo daba ${usd(v.guardada.diferencia ?? 0)}; con los datos de hoy, ${usd(v.diferencia ?? 0)}. Se cargó o se corrigió algo de esas fechas.` });
    }
  }

  /* 2 · Gastos sin una cuenta que se reconozca, después del último arqueo: el total los resta, ninguna cuenta. */
  const sinCuenta = e.gastos.filter((g) => !g.extra?.traspasoId && !g.extra?.liquidacionId && !cuentaDeGasto(g, e.procesadores) && despuesDelUltimo(g));
  if (sinCuenta.length) out.push({ clave: "gastos-sin-cuenta", gravedad: "aviso", titulo: `${sinCuenta.length} gastos sin cuenta desde el último arqueo`, monto: r2(sinCuenta.reduce((s, g) => s + g.monto, 0)), ids: sinCuenta.map((g) => g.id),
    detalle: "No dicen de qué cuenta salieron: el arqueo los descuenta del total pero de ninguna cuenta, y la cuenta de la que salieron va a dar de más." });

  /* 3 · Cobros a una cuenta en pesos sin su cambio: se anotan con el de Ajustes, que puede no ser el del día. */
  const pesos = new Set(e.procesadores.filter((p) => p.moneda === "ARS").map((p) => p.id));
  const sinCambio = e.pagos.filter((p) => p.procesadorId && pesos.has(p.procesadorId) && !(p.tipoCambio && p.tipoCambio > 0) && p.montoArs == null);
  if (sinCambio.length) out.push({ clave: "cobros-pesos-sin-cambio", gravedad: "aviso", titulo: `${sinCambio.length} cobros en una cuenta en pesos sin su tipo de cambio`, monto: r2(sinCambio.reduce((s, p) => s + p.monto, 0)), ids: sinCambio.map((p) => p.id),
    detalle: "La cuenta los pasa a pesos con el cambio de Ajustes: si el del día fue otro, la cuenta en pesos da un poco distinto." });

  /* 4 · Gastos en dólares que salieron de una cuenta en pesos sin decir cuántos pesos. */
  const enDolaresDesdePesos = e.gastos.filter((g) => { const c = cuentaDeGasto(g, e.procesadores); return c && pesos.has(c) && montoOriginal(g)?.moneda !== "ARS"; });
  if (enDolaresDesdePesos.length) out.push({ clave: "gastos-dolares-desde-pesos", gravedad: "aviso", titulo: `${enDolaresDesdePesos.length} gastos en dólares que salieron de una cuenta en pesos`, monto: r2(enDolaresDesdePesos.reduce((s, g) => s + g.monto, 0)), ids: enDolaresDesdePesos.map((g) => g.id),
    detalle: "No dicen cuántos pesos salieron: la cuenta los descuenta al cambio de Ajustes. Mejor cargarlos en pesos." });

  /* 5 · Pagos a alguien del equipo cargados como gasto y sin marcar: en Finanzas cuentan dos veces (el pago y la liquidación). */
  const sinMarcar = e.gastos.filter((g) => !esPagoDeEquipo(g) && g.grupo !== "dueno" && g.grupo !== "retiro" && !g.extra?.liquidacionId && personaDelEquipo(`${g.concepto} ${g.proveedor ?? ""}`, e));
  if (sinMarcar.length) out.push({ clave: "pagos-equipo-sin-marcar", gravedad: "aviso", titulo: `${sinMarcar.length} gastos que parecen pagos al equipo y no están marcados`, monto: r2(sinMarcar.reduce((s, g) => s + g.monto, 0)), ids: sinMarcar.map((g) => g.id),
    detalle: "La caja los cuenta bien (salieron), pero el costo del mes los suma además de la liquidación. Se marcan en Equipo → Liquidación → Gastos que cuentan." });

  /* 6 · Pases que esperan una decisión: mientras tanto el arqueo no sabe dónde está esa plata. */
  const pendientes = (e.traspasos ?? []).filter((t) => ["por-confirmar", "no-llego"].includes(situacionDe(t, Date.parse(ahora))));
  if (pendientes.length) out.push({ clave: "pases-pendientes", gravedad: "aviso", titulo: `${pendientes.length} movimientos entre cuentas sin decidir`, ids: pendientes.map((t) => t.id),
    detalle: "Hasta que se confirmen o descarten, la plata no está en ninguna cuenta para la app." });

  /* 7 · Un pase y un gasto por la misma plata (el pase ya la movió). */
  const pases = (e.traspasos ?? []).filter((t) => t.estado === "confirmado");
  const dobles = e.gastos.filter((g) => !g.extra?.traspasoId && pases.some((t) => t.origenId === cuentaDeGasto(g, e.procesadores)
    && Math.abs(t.montoSale - (montoOriginal(g)?.monto ?? g.monto)) < 0.01 && Math.abs(Date.parse(t.fecha) - Date.parse(fechaDePago(g))) <= 3 * 86400000));
  if (dobles.length) out.push({ clave: "pase-y-gasto", gravedad: "aviso", titulo: `${dobles.length} gastos con el mismo monto y día que un movimiento entre cuentas`, monto: r2(dobles.reduce((s, g) => s + g.monto, 0)), ids: dobles.map((g) => g.id),
    detalle: "Si son la misma plata, sale dos veces de la cuenta: revisar y borrar el gasto." });

  return out;
}
