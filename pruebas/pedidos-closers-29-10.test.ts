import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { avisoDeImportada, estadoDe, SIN_CARGAR, SIN_DATO_AIRTABLE } from "@/lib/estados";
import { rearmarPlan } from "@/lib/cambio-de-plan";
import type { Cuota, EstadoApp, Pago, Sesion, Venta } from "@/lib/types";

/* Pedidos de Mariano y Dante del 27–29/10. */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const DIA = (d: number) => `2026-10-${String(d).padStart(2, "0")}T15:00:00.000Z`;

/* ---------- Mariano: el cierre del día le pedía llamadas de marzo del Airtable ---------- */

test("una llamada vieja del Airtable sin estado no es una pendiente: dice lo que decía el Airtable", () => {
  const vieja = { estado: "agendada", inicia: "2026-03-06T21:00:00.000Z", origen: "airtable", extra: { airtable: { estadoAirtable: "❌ NO USAR (No compra)" } } } as unknown as Sesion;
  const v = estadoDe(vieja, { opciones: [] });
  assert.equal(v.texto, "Airtable: No compra");
  assert.equal(v.sinCargar, false, "no la pide el cierre del día ni cuenta como sin cargar");
  assert.equal(avisoDeImportada({ origen: "airtable", extra: {} }), SIN_DATO_AIRTABLE);
  assert.equal(avisoDeImportada({ origen: "airtable", extra: { airtable: { estadoAirtable: "❌ NO USAR (En seguimiento)" } } }), "Airtable: En seguimiento");
  /* Una de Calendly (la app) sin estado sigue siendo una pendiente. */
  const deCalendly = { ...vieja, origen: "calendly", extra: {} } as unknown as Sesion;
  assert.equal(estadoDe(deCalendly, { opciones: [] }).texto, SIN_CARGAR);
  assert.equal(estadoDe(deCalendly, { opciones: [] }).sinCargar, true);
  /* Si alguien le carga un estado, vale ése. */
  const cargada = { ...vieja, estadoLlamada: "Lead descartado" } as unknown as Sesion;
  assert.equal(estadoDe(cargada, { opciones: [{ nombre: "Lead descartado" } as never] }).texto, "Lead descartado");
});

/* ---------- Dante: la cuota debía 950 y pagó 1.000 ---------- */

function ventaDePrueba(id: string, cuotas: { monto: number; estado?: Cuota["estado"]; reserva?: boolean }[], precio: number) {
  const base = estado();
  const venta = { ...base.ventas[0], id, contactoId: `lea_${id}`, contactoNombre: `Cliente ${id}`, precioAcordado: precio, estado: "activa", productoId: base.productos[0].id } as Venta;
  const cs: Cuota[] = cuotas.map((c, k) => ({ id: `${id}_c${k}`, ventaId: id, numero: c.reserva ? 0 : k, monto: c.monto, vence: DIA(10 + k), estado: c.estado ?? "pendiente", esReserva: Boolean(c.reserva) }));
  assert.equal(acciones.importar(JSON.stringify({ ...base, ventas: [venta, ...base.ventas.filter((v) => v.id !== id)], cuotas: [...cs, ...base.cuotas.filter((c) => c.ventaId !== id)] })), true);
  return { venta, cuotas: cs };
}
const cobro = (monto: number) => ({ procesadorId: estado().procesadores[0].id, monto, fecha: DIA(27), referencia: "" });

test("pagó de más: la cuota queda en lo que pagó y lo que sobra baja la que sigue", () => {
  const { cuotas } = ventaDePrueba("v_sobra", [{ monto: 1000, estado: "pagada" }, { monto: 950 }, { monto: 1050 }], 3000);
  assert.ok(acciones.registrarPago({ cuotaId: cuotas[1].id, cobros: [cobro(1000)], reajuste: "pendiente", sobrante: "proxima" }));
  const e = estado();
  const c = (k: number) => e.cuotas.find((x) => x.id === cuotas[k].id)!;
  assert.equal(c(1).monto, 1000);
  assert.equal(c(1).estado, "pagada");
  assert.equal(c(2).monto, 1000, "la que sigue baja los 50 que adelantó");
  assert.equal(e.ventas.find((v) => v.id === "v_sobra")!.precioAcordado, 3000, "el valor de la venta no cambia");
});

test("pagó de más y no hay cuotas después (o lo elige así): sube lo que vale la venta", () => {
  const { cuotas } = ventaDePrueba("v_sobra2", [{ monto: 1000, estado: "pagada" }, { monto: 950 }], 1950);
  assert.ok(acciones.registrarPago({ cuotaId: cuotas[1].id, cobros: [cobro(1000)], reajuste: "pendiente", sobrante: "venta" }));
  const e = estado();
  assert.equal(e.cuotas.find((x) => x.id === cuotas[1].id)!.monto, 1000);
  assert.equal(e.ventas.find((v) => v.id === "v_sobra2")!.precioAcordado, 2000);
});

test("lo que sobra cubre la que sigue entera: esa queda pagada y el resto baja la siguiente", () => {
  const { cuotas } = ventaDePrueba("v_sobra3", [{ monto: 500 }, { monto: 100 }, { monto: 400 }], 1000);
  assert.ok(acciones.registrarPago({ cuotaId: cuotas[0].id, cobros: [cobro(700)], reajuste: "pendiente", sobrante: "proxima" }));
  const e = estado();
  const c = (k: number) => e.cuotas.find((x) => x.id === cuotas[k].id)!;
  assert.equal(c(0).monto, 700);
  assert.equal(c(1).monto, 0);
  assert.equal(c(1).estado, "pagada", "la cubrió lo que adelantó");
  assert.equal(c(2).monto, 300);
});

/* ---------- Dante: dejó la seña para Hackear AI y al final compra el Downsell ---------- */

test("rearmar el plan: lo cobrado queda, lo pendiente sin cobros se va y lo que falta va en cuotas nuevas", () => {
  const cuotas: Cuota[] = [
    { id: "r", ventaId: "v", numero: 0, monto: 300, estado: "pagada", esReserva: true, vence: DIA(1) },
    { id: "c1", ventaId: "v", numero: 1, monto: 1350, estado: "pendiente", esReserva: false, vence: DIA(20) },
    { id: "c2", ventaId: "v", numero: 2, monto: 1350, estado: "pendiente", esReserva: false, vence: DIA(30) },
  ];
  const pagos = [{ cuotaId: "r", monto: 300 }, { cuotaId: "c1", monto: 50 }] as Pick<Pago, "cuotaId" | "monto">[];
  let n = 0;
  const p = rearmarPlan(cuotas, pagos, { ventaId: "v", precio: 500, cantidad: 1, primera: "2026-11-05", nuevoId: () => `nueva${++n}` });
  assert.equal(p.cobrado, 350);
  assert.deepEqual(p.saldadas.map((c) => [c.id, c.monto, c.estado]), [["c1", 50, "pagada"]], "la que tenía un cobro queda saldada en eso");
  assert.deepEqual(p.quitadas.map((c) => c.id), ["c2"]);
  assert.equal(p.falta, 150);
  assert.deepEqual(p.nuevas.map((c) => [c.numero, c.monto]), [[2, 150]]);
  /* En dos cuotas, la última se lleva el redondeo. */
  const dos = rearmarPlan(cuotas, pagos, { ventaId: "v", precio: 500.01, cantidad: 2, primera: "2026-11-05", nuevoId: () => "x" });
  assert.deepEqual(dos.nuevas.map((c) => c.monto), [75, 75.01]);
  /* Si ya pagó más de lo que vale ahora, no se crean cuotas. */
  const menos = rearmarPlan(cuotas, pagos, { ventaId: "v", precio: 200, cantidad: 3, primera: "2026-11-05", nuevoId: () => "x" });
  assert.equal(menos.nuevas.length, 0);
  assert.equal(menos.falta, -150);
});

test("rearmar el plan desde el store: cambia producto, precio, cuotas y el plan del alumno", () => {
  const base = construirSemilla() as EstadoApp;
  const [ai, downsell] = base.productos;
  const { venta, cuotas } = ventaDePrueba("v_down", [{ monto: 300, estado: "pagada", reserva: true }, { monto: 2700 }], 3000);
  const e0 = estado();
  acciones.importar(JSON.stringify({
    ...e0,
    ventas: e0.ventas.map((v) => (v.id === venta.id ? { ...v, productoId: ai.id } : v)),
    pagos: [{ id: "p_res", cuotaId: cuotas[0].id, monto: 300, procesadorId: e0.procesadores[0].id, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: DIA(10), creadoEn: DIA(10) }, ...e0.pagos],
    alumnos: [{ ...(e0.alumnos[0] ?? {}), id: "alu_down", ventaId: venta.id, plan: ai.nombre, nombre: "Cliente v_down" }, ...e0.alumnos],
  }));
  const dicho = acciones.rearmarPlanDeVenta(venta.id, { precio: 500, productoId: downsell.id, cantidad: 1, primera: "2026-11-05" });
  assert.ok(dicho && /Cambió de/.test(dicho), dicho ?? "");
  const e = estado();
  const v = e.ventas.find((x) => x.id === venta.id)!;
  assert.equal(v.precioAcordado, 500);
  assert.equal(v.productoId, downsell.id);
  const suyas = e.cuotas.filter((c) => c.ventaId === venta.id).sort((a, b) => a.numero - b.numero);
  assert.deepEqual(suyas.map((c) => [c.numero, c.monto, c.estado]), [[0, 300, "pagada"], [1, 200, "pendiente"]]);
  assert.equal(e.alumnos.find((a) => a.id === "alu_down")!.plan, downsell.nombre);
});

/* ---------- Mariano: avisos de cuotas, fechas a medida y sin fecha de nacimiento ---------- */

test("el cron de cuotas por cobrar existe, corre una vez por día y la base no repite avisos", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/cuotas-a-cobrar" && c.schedule === "0 12 * * *"));
  const sql = readFileSync("supabase/avisos-cuotas.sql", "utf8");
  assert.match(sql, /on conflict \(id\) do nothing/, "un aviso por cuota y por momento");
  assert.match(sql, /hoy - 1 and hoy \+ 1/, "el día antes, el día y el día después");
  assert.match(sql, /revoke all on function public\.avisar_cuotas_por_cobrar\(date\) from public, anon, authenticated/);
});

test("el plan de pago ofrece fechas a medida y el contrato ya no pide la fecha de nacimiento", () => {
  const asistente = readFileSync("src/components/ventas/AsistenteVenta.tsx", "utf8");
  assert.match(asistente, /\{ valor: "medida", texto: "Fechas a medida" \}/);
  assert.match(asistente, /cambios\.vence \? \{ frecuencia: "medida"/, "cambiar una fecha a mano lo marca a medida");
  const contrato = readFileSync("src/components/contratos/DatosDelContrato.tsx", "utf8");
  assert.doesNotMatch(contrato, /label="Fecha de nacimiento"/);
  /* Igual sigue llegando sola de Calendly a los datos del contrato (y de ahí a la ficha). */
  assert.match(asistente, /nacimientoDeLaPersona\(e, b\.contactoId\)/);
});
