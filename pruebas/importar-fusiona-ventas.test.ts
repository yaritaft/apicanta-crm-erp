import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNA_LINK_COMPROBANTE, comprobanteConLink, estadoDespuesDeImportar, importarPlanilla, leerFilasVentas, type FilaVentas, type ResultadoImport,
} from "@/lib/angelo";
import { construirSemilla } from "@/lib/seed";
import type { Alumno, Cuota, EstadoApp, Lead, Movimiento, Pago, Venta } from "@/lib/types";

/* ==================================================================
   Importar la planilla cuando el equipo ya cargó a mano en la app las mismas ventas
   (daily con los closers, 16/10): Valentín y Dante cargaron sus ventas en la app y el
   Centro de control las trae con la fecha de verdad. Sin fusionarlas, cada una quedaba
   dos veces (octubre, +US$ 15.888 de cobrado).
   ================================================================== */

const dia = (d: number, mes = 10) => `2026-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const fila = (n: number, o: Partial<FilaVentas> = {}): FilaVentas => ({
  fila: n, fecha: dia(11), nombre: "Walther Prueba", email: "walther@ejemplo.test", pais: "Perú", telefono: "",
  vendedor: "Mariano Arias", servicio: "Mentoría", proyecto: "MENT", estrategia: "Lanzamiento", tipoPago: "Contado", plan: "1 pago",
  caracteristica: "Paid in full", tipoVenta: "Venta Nueva", cuenta: "Whop", valorTotal: 3000, montoUsd: 3000, chequeado: false,
  pagador: "", cuit: "", comprobante: "", observaciones: "", setter: "", referidor: "", referidorTelefono: "", ingresoComunidad: "", ...o,
});

function estadoBase(): EstadoApp {
  const e = construirSemilla();
  for (const k of ["ventas", "cuotas", "pagos", "contactos", "leads", "movimientos", "devoluciones", "alumnos"] as const) (e as unknown as Record<string, unknown[]>)[k] = [];
  return e;
}

/* Una venta cargada a mano: la oportunidad de Calendly, la llamada, una cuota y sus cobros. */
function conVentaDeLaApp(e: EstadoApp, o: { cobros: { monto: number; cuenta?: string; fecha?: string; movimiento?: string }[]; total?: number; nombre?: string; lead?: string }): EstadoApp {
  const lead: Lead = {
    id: o.lead ?? "lea_cal_walther", nombre: o.nombre ?? "Walther Prueba", email: "walther@ejemplo.test", etapaId: e.etapas[0].id,
    fuente: "Calendly", monto: 0, moneda: "USD", responsable: "Valentín", etiquetas: [], creadoEn: dia(1), actualizadoEn: dia(1), extra: {},
  } as unknown as Lead;
  const producto = e.productos.find((p) => p.nombre === "Mentoría")!;
  const venta: Venta = {
    id: "ven_mano_1", contactoId: lead.id, contactoNombre: lead.nombre, productoId: producto.id, precioAcordado: o.total ?? 3000, moneda: "USD",
    closerId: "eq_valentin_abadia", excluidoMarketing: false, estado: "activa", fecha: dia(12), creadoEn: dia(12), extra: {}, sesionId: "cal_walther",
  };
  const cuota: Cuota = { id: "cuo_mano_1", ventaId: venta.id, numero: 1, monto: 3000, vence: dia(12), estado: "pagada", esReserva: false };
  const proc = (c?: string) => e.procesadores.find((p) => p.nombre === (c ?? "Stripe"))!;
  const pagos = o.cobros.map((c, i): Pago => ({
    id: `pag_mano_${i}`, cuotaId: cuota.id, procesadorId: proc(c.cuenta).id, monto: c.monto, moneda: "USD", feeRate: 0.03, feeMonto: Math.round(c.monto * 3) / 100,
    fecha: c.fecha ?? dia(16), creadoEn: c.fecha ?? dia(16), movimientoId: c.movimiento, chequeado: c.movimiento ? true : undefined,
  }));
  const movimientos: Movimiento[] = o.cobros.filter((c) => c.movimiento).map((c, i) => ({
    id: c.movimiento!, proveedor: "stripe", monto: c.monto, moneda: "USD", fee: 0.5, neto: c.monto - 0.5, fecha: c.fecha ?? dia(16),
    estado: "conciliado", pagoId: `pag_mano_${o.cobros.indexOf(c)}`, cuotaId: cuota.id, ventaId: venta.id, origen: "api", creadoEn: dia(16), referencia: `ref${i}`,
  } as unknown as Movimiento));
  const alumno = { id: "alu_mano_1", nombre: lead.nombre, email: "walther@ejemplo.test", ventaId: venta.id, cohorte: "x", plan: "x", cuotaMensual: 0, moneda: "USD" } as unknown as Alumno;
  return { ...e, leads: [lead], ventas: [venta], cuotas: [cuota], pagos, movimientos, alumnos: [alumno] };
}

function importar(e: EstadoApp, filas: FilaVentas[]): { e: EstadoApp; r: ResultadoImport; x: ReturnType<typeof estadoDespuesDeImportar> } {
  const r = importarPlanilla(e, filas);
  const x = estadoDespuesDeImportar(e, r);
  return { e: { ...e, ...x.estado }, r, x };
}
const total = (e: EstadoApp) => Math.round(e.pagos.reduce((a, p) => a + p.monto, 0) * 100) / 100;

test("una venta cargada a mano que la planilla ya trae se fusiona: queda la de la planilla, con la llamada, el alumno y la persona que ya tenía", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 3000 }] });
  const { e, r, x } = importar(base, [fila(2)]);
  assert.equal(r.fusionesDeVentas.length, 1);
  assert.deepEqual(r.fusionesDeVentas[0].viejaId, "ven_mano_1");
  assert.equal(e.ventas.length, 1, "una sola venta");
  const v = e.ventas[0];
  assert.ok(v.id.includes("ven_ef_"), "queda la de la planilla");
  assert.equal(v.sesionId, "cal_walther", "con la llamada de la que salió");
  assert.equal(v.contactoId, "lea_cal_walther", "con la persona que ya tenía");
  assert.equal(r.leads.length, 0, "no se crea otra oportunidad para la misma persona");
  assert.equal(r.contactos.length, 0);
  assert.equal(total(e), 3000, "el cobrado no se duplica");
  assert.equal(e.pagos.length, 1);
  assert.deepEqual(x.quitaVentas, ["ven_mano_1"]);
  assert.deepEqual(x.quitaPagos, ["pag_mano_0"]);
  assert.deepEqual(x.quitaCuotas, ["cuo_mano_1"]);
  assert.equal(e.alumnos[0].ventaId, v.id, "el alumno pasa a la venta de la planilla");
  assert.equal(x.alumnosReapuntados.length, 1);
});

test("el cobro conciliado con una pasarela se fusiona con el de la planilla y conserva su pago real", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 3000, cuenta: "Whop", fecha: dia(11), movimiento: "mov_whop_1" }] });
  const { e, r } = importar(base, [fila(2)]);
  assert.equal(r.fusiones.length, 1);
  const pago = e.pagos[0];
  assert.equal(pago.movimientoId, "mov_whop_1");
  const mov = e.movimientos.find((m) => m.id === "mov_whop_1")!;
  assert.equal(mov.estado, "conciliado");
  assert.equal(mov.pagoId, pago.id, "el pago de la pasarela apunta al cobro de la planilla");
  assert.equal(mov.ventaId, e.ventas[0].id);
  assert.equal(total(e), 3000);
});

test("un cobro conciliado sin gemelo en la planilla suelta su pago de la pasarela (vuelve a «sin conciliar»)", () => {
  /* La app tenía 2.000 + 1.000 conciliados con dos pagos; la planilla trae un solo cobro de 3.000. */
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 2000, cuenta: "Whop", movimiento: "mov_a", fecha: dia(11) }, { monto: 1000, cuenta: "Whop", movimiento: "mov_b", fecha: dia(11) }] });
  const { e, r } = importar(base, [fila(2)]);
  assert.deepEqual([...r.movimientosLiberados].sort(), ["mov_a", "mov_b"]);
  for (const id of ["mov_a", "mov_b"]) {
    const m = e.movimientos.find((x) => x.id === id)!;
    assert.equal(m.estado, "pendiente");
    assert.equal(m.pagoId, undefined);
    assert.equal(m.ventaId, undefined);
  }
  assert.equal(total(e), 3000, "queda sólo lo de la planilla");
});

test("dos cobros iguales de cada lado se emparejan en orden", () => {
  const base = conVentaDeLaApp(estadoBase(), { total: 100, cobros: [
    { monto: 3.66, cuenta: "Stripe", movimiento: "mov_s1", fecha: dia(11) }, { monto: 3.66, cuenta: "Stripe", movimiento: "mov_s2", fecha: dia(11) }] });
  const { e, r } = importar(base, [
    fila(2, { montoUsd: 3.66, valorTotal: 7.32, cuenta: "Stripe", caracteristica: "Reserva", comprobante: "a" }),
    fila(3, { montoUsd: 3.66, valorTotal: 0, cuenta: "Stripe", caracteristica: "Reserva", comprobante: "b" }),
  ]);
  assert.equal(r.fusiones.length, 2, "los dos pagos de la pasarela quedaron atados");
  assert.equal(r.movimientosLiberados.length, 0);
  assert.equal(e.pagos.filter((p) => p.movimientoId).length, 2);
  assert.equal(new Set(e.pagos.map((p) => p.movimientoId)).size, 2, "cada pago, con el suyo");
});

test("si lo cobrado no coincide no se toca nada: quedan las dos y se avisa", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 2500 }] });
  const { e, r } = importar(base, [fila(2)]);
  assert.equal(r.fusionesDeVentas.length, 0);
  assert.equal(e.ventas.length, 2);
  assert.ok(r.protegidos.some((p) => p.id === "ven_mano_1" && /no suma lo mismo/.test(p.motivo)));
  assert.ok(r.avisos.some((a) => a.tipo === "venta-de-la-app-distinta"));
});

test("distinto servicio o fecha lejana: no es la misma venta", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 3000 }] });
  assert.equal(importar(base, [fila(2, { servicio: "Downsell" })]).r.fusionesDeVentas.length, 0);
  assert.equal(importar(base, [fila(2, { fecha: dia(25) })]).r.fusionesDeVentas.length, 0);
});

test("la misma persona con otro correo en la planilla: se reconoce por el nombre y no se crea una persona nueva", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 3000 }] });
  const { e, r } = importar(base, [fila(2, { email: "otro.correo@ejemplo.test" })]);
  assert.equal(r.fusionesDeVentas.length, 1);
  assert.equal(r.leads.length, 0, "no queda una oportunidad suelta");
  assert.equal(r.contactos.length, 0);
  assert.equal(e.ventas[0].contactoId, "lea_cal_walther");
});

test("reimportar después de fusionar no cambia nada", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 3000, cuenta: "Whop", movimiento: "mov_whop_1", fecha: dia(11) }] });
  const uno = importar(base, [fila(2)]);
  const dos = importar(uno.e, [fila(2)]);
  assert.equal(dos.r.fusionesDeVentas.length, 0);
  assert.equal(dos.r.ventasQueSobran.length, 0);
  assert.equal(dos.r.pagosQueSobran.length, 0);
  assert.equal(dos.e.ventas.length, 1);
  assert.equal(total(dos.e), 3000);
});

test("la venta de la planilla ya estaba importada (de una importación anterior) y el equipo la cargó a mano después: se fusionan igual", () => {
  const sinMano = importar(estadoBase(), [fila(2)]);
  /* Después de importar, Valentín carga a mano la misma venta (otro id, con la llamada). */
  const mano = conVentaDeLaApp({ ...sinMano.e, leads: sinMano.e.leads }, { cobros: [{ monto: 3000 }], lead: sinMano.e.leads[0].id });
  const e0: EstadoApp = { ...mano, ventas: [...sinMano.e.ventas, ...mano.ventas], cuotas: [...sinMano.e.cuotas, ...mano.cuotas], pagos: [...sinMano.e.pagos, ...mano.pagos], leads: sinMano.e.leads };
  assert.equal(e0.ventas.length, 2);
  const { e, r } = importar(e0, [fila(2)]);
  assert.equal(r.fusionesDeVentas.length, 1);
  assert.equal(e.ventas.length, 1);
  assert.equal(e.ventas[0].sesionId, "cal_walther");
  assert.equal(total(e), 3000, "no queda duplicado");
});

test("un cobro cargado a mano sobre una venta ya importada y que la planilla trae después se saca: queda el de la planilla", () => {
  const plan = (n: number) => [
    fila(2, { montoUsd: 1500, valorTotal: 3000, plan: "2 pagos", caracteristica: "Cuota #1", fecha: dia(3), cuenta: "Stripe" }),
    ...(n === 2 ? [fila(3, { montoUsd: 1500, valorTotal: 0, plan: "2 pagos", caracteristica: "Cuota #2", fecha: dia(12), cuenta: "Stripe" })] : []),
  ];
  const uno = importar(estadoBase(), plan(1));
  assert.equal(total(uno.e), 1500);
  /* El closer registra la segunda cuota en la app (sin pasarela), con un id propio. */
  const cuota2 = uno.e.cuotas.find((c) => !c.esReserva && c.numero === 2)!;
  const manual: Pago = { id: "pag_mano_cuota2", cuotaId: cuota2.id, procesadorId: uno.e.pagos[0].procesadorId, monto: 1500, moneda: "USD", feeRate: 0.03, feeMonto: 45, fecha: dia(13), creadoEn: dia(13) };
  const dos = importar({ ...uno.e, pagos: [manual, ...uno.e.pagos] }, plan(2));
  assert.equal(total(dos.e), 3000, "la segunda cuota cuenta una sola vez");
  assert.equal(dos.e.pagos.length, 2);
  assert.ok(dos.x.quitaPagos.includes("pag_mano_cuota2"), "se saca el cargado a mano");
  assert.ok(dos.e.pagos.every((p) => p.id.includes("pag_ef_")));
});

test("el nombre con más palabras en un lado que en el otro se reconoce como la misma persona", () => {
  const base = conVentaDeLaApp(estadoBase(), { cobros: [{ monto: 3000 }], nombre: "Ignacio Fernandez", lead: "lea_cal_ignacio" });
  const { r } = importar(base, [fila(2, { nombre: "Ignacio Fernandez Rocha", email: "nacho@ejemplo.test" })]);
  assert.equal(r.fusionesDeVentas.length, 1);
  assert.equal(importar(base, [fila(2, { nombre: "Ignacio", email: "nacho@ejemplo.test" })]).r.fusionesDeVentas.length, 0, "una sola palabra no alcanza");
});

test("un pago de pasarela conciliado que apunta a una venta que ya no existe queda apuntando a la cuota y la venta de su cobro", () => {
  const uno = importar(estadoBase(), [fila(2)]);
  const pago = uno.e.pagos[0];
  const mov = {
    id: "mov_viejo", proveedor: "whop", monto: pago.monto, moneda: "USD", fee: 0, neto: pago.monto, fecha: pago.fecha, estado: "conciliado",
    pagoId: pago.id, cuotaId: "cuo_que_ya_no_esta", ventaId: "ven_que_ya_no_esta", origen: "api", creadoEn: pago.fecha, referencia: "x",
  } as unknown as Movimiento;
  const dos = importar({ ...uno.e, movimientos: [mov] }, [fila(2)]);
  const m = dos.e.movimientos.find((x) => x.id === "mov_viejo")!;
  assert.equal(m.ventaId, uno.e.ventas[0].id);
  assert.equal(m.cuotaId, pago.cuotaId);
  assert.equal(dos.x.movimientosAjustados.length, 1, "y se manda a la base");
  assert.equal(m.estado, "conciliado");
  assert.equal(m.pagoId, pago.id);
});

/* ---------- El link escondido del comprobante (17/10: los de octubre vinieron sin link) ---------- */


test("el comprobante conserva el link escondido de la celda y el cobro sigue con el mismo id", () => {
  const nombre = "WhatsApp Image 2026-10-10 at 4.18.39 PM - Valentín Abadía.jpeg";
  const link = "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv";
  const sinLink = importar(estadoBase(), [fila(2, { comprobante: nombre })]).e.pagos;
  const conLink = importar(estadoBase(), [fila(2, { comprobante: nombre, comprobanteUrl: link })]).e.pagos;
  assert.equal(sinLink.length, 1);
  assert.equal(conLink.length, 1);
  assert.equal(conLink[0].id, sinLink[0].id, "el link no cambia el id: reimportar no duplica ni borra cobros");
  assert.equal(sinLink[0].comprobanteLink, nombre);
  assert.equal(conLink[0].comprobanteLink, `${nombre} ${link}`, "queda el nombre del archivo y, al lado, el link");
});

test("comprobanteConLink: sin link queda el texto; si el texto ya es el link no se repite; sin nada no hay comprobante", () => {
  const url = "https://drive.google.com/open?id=abc";
  assert.equal(comprobanteConLink("foto.png"), "foto.png");
  assert.equal(comprobanteConLink("foto.png", url), `foto.png ${url}`);
  assert.equal(comprobanteConLink(url, url), url);
  assert.equal(comprobanteConLink("", url), url);
  assert.equal(comprobanteConLink("  ", "  "), undefined);
  assert.equal(comprobanteConLink(undefined), undefined);
});

test("la columna «Comprobante (link)» que agrega hojas_a_json.py se lee sin ser imprescindible", () => {
  const cab = ["Fecha del pago", "Email", "Servicio adquirido", "Monto abonado USD", "Valor total de la venta", "Comprobante"];
  const datos = ["2026-10-10", "a@ejemplo.test", "Mentoría", "500", "500", "foto.png"];
  const sin = leerFilasVentas([cab, datos]);
  assert.equal(sin.filas.length, 1);
  assert.equal(sin.filas[0].comprobanteUrl, undefined, "una planilla de antes, sin la columna, anda igual");
  const con = leerFilasVentas([[...cab, COLUMNA_LINK_COMPROBANTE], [...datos, "https://drive.google.com/open?id=zzz"]]);
  assert.equal(con.filas[0].comprobante, "foto.png");
  assert.equal(con.filas[0].comprobanteUrl, "https://drive.google.com/open?id=zzz");
});
