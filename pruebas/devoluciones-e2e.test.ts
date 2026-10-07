import test from "node:test";
import assert from "node:assert/strict";
import { acciones, alElegirDevolucion, alNegarseEscritura, fijarAcceso } from "@/lib/store";
import {
  calcularLiquidacion, diferenciasDesdeElCierre, gastosDeLiquidacion, liquidacionVacia, renglonDe,
} from "@/lib/honorarios";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import { calcularPyL, cashCollected } from "@/lib/finanzas";
import { devolucionesDeVenta } from "@/lib/devoluciones";
import { rangoDePeriodo } from "@/lib/periodos";
import { ACCESO_DUENO, puedeCargarDevolucion, puedeDarDeBaja, type MiAcceso } from "@/lib/permisos";
import { estadoVacio } from "@/lib/seed";
import type { Alumno, EstadoApp, Lead, Sesion } from "@/lib/types";
import { estadoDeYari, iso, OCTUBRE, SEPTIEMBRE } from "./estado-devolucion";

/* ==================================================================
   La prueba de punta a punta que pidió Yari (reunión del 02/10, minuto
   1:32): venta del 28/09 con cuotas pagadas y, con septiembre ya cerrado,
   la devolución del 03/10. Septiembre no cambia; octubre muestra la
   devolución en Finanzas, en la caja y en la liquidación.

   A diferencia de las otras pruebas, ésta pasa por las acciones del
   store (las mismas que usa la pantalla): cerrar una liquidación, cargar
   la devolución, quién puede y quién no, y qué se entera el CRM.
   ================================================================== */

const sept = rangoDePeriodo(SEPTIEMBRE);
const oct = rangoDePeriodo(OCTUBRE);
const r2 = (n: number) => Math.round(n * 100) / 100;
const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;

/* El caso de Yari con su persona, su llamada y su servicio, y una tercera cuota que no se llegó a pagar. */
function armar() {
  const yari = estadoDeYari();
  const lead = {
    id: "lead_belen", contactoId: "lead_belen", nombre: "Belén Godoy", email: "belen@example.com", fuente: "Webinar",
    etapaId: "et_inscripto", monto: 3500, moneda: "USD", responsable: "Mariano Arias", etiquetas: [],
    creadoEn: iso(SEPTIEMBRE, 20), actualizadoEn: iso(SEPTIEMBRE, 28), extra: {},
  } as Lead;
  const llamada = (id: string, estadoLlamada?: string): Sesion => ({
    id, titulo: "Llamada de asesoramiento", tipo: "Llamada de Asesoramiento", leadId: "lead_belen", invitado: "Belén Godoy",
    email: "belen@example.com", inicia: iso(SEPTIEMBRE, 27), duracionMin: 45, estado: "hecha", origen: "calendly",
    creadoEn: iso(SEPTIEMBRE, 20), extra: {}, anfitrion: "Mariano Arias", ...(estadoLlamada ? { estadoLlamada } : {}),
  });
  const alumno = {
    id: "alu_belen", nombre: "Belén Godoy", email: "belen@example.com", cohorte: "", plan: "Mentoría", cuotaMensual: 1500, moneda: "USD",
    estado: "activo", inicio: iso(SEPTIEMBRE, 28), progreso: 0, notas: "", creadoEn: iso(SEPTIEMBRE, 28), extra: {}, etapaServicioId: "ets_nueva", ventaId: "v1",
  } as Alumno;
  const e = {
    ...estadoVacio(), ...yari,
    ventas: yari.ventas.map((v) => ({ ...v, contactoId: "lead_belen", precioAcordado: 3500 })),
    cuotas: [...yari.cuotas, { id: "c1c", ventaId: "v1", numero: 3, monto: 500, vence: iso("2026-11", 1), estado: "pendiente", esReserva: false }],
    leads: [lead], sesiones: [llamada("ses_belen", "Compra Cuotas"), llamada("ses_otra", "Seguimiento Nutrición")], alumnos: [alumno],
    actividad: [], gastos: [],
  } as unknown as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}

const closer: MiAcceso = { tipo: "closer", nombre: "Closer", areas: { crm: "editar", ventas: "editar" }, soloLoSuyo: true, miembroId: "mariano" };
const director: MiAcceso = { tipo: "director", nombre: "Director comercial", areas: { panel: "ver", leads: "editar", crm: "editar", ventas: "editar", webinars: "ver" }, soloLoSuyo: false };
const administracion: MiAcceso = { tipo: "admin", nombre: "Administración", areas: { panel: "ver", ventas: "editar", finanzas: "editar" }, soloLoSuyo: false };
const setter: MiAcceso = { tipo: "setter", nombre: "Setter", areas: { leads: "editar", crm: "ver" }, soloLoSuyo: false };

test("quién carga una devolución y quién puede dar de baja una venta", () => {
  assert.equal(puedeCargarDevolucion(ACCESO_DUENO), true);
  assert.equal(puedeCargarDevolucion(director), true, "el director comercial");
  assert.equal(puedeCargarDevolucion(administracion), true, "el asistente de finanzas");
  assert.equal(puedeCargarDevolucion(closer), false, "el closer sólo la ve");
  assert.equal(puedeCargarDevolucion(setter), false);
  assert.equal(puedeCargarDevolucion(null), false);
  assert.equal(puedeDarDeBaja(closer), false, "el closer no cancela ni marca reembolsada");
  assert.equal(puedeDarDeBaja(director), true);
  assert.equal(puedeDarDeBaja(administracion), true);
  assert.equal(puedeDarDeBaja(setter), false);
});

test("el closer no puede cargar una devolución ni cancelar o reembolsar su venta", () => {
  armar();
  fijarAcceso(closer);
  /* La pantalla se entera de cada cosa que no se pudo (y vuelve a como estaba). */
  const negadas: [string, string | undefined][] = [];
  const dejarDeEscuchar = alNegarseEscritura((tabla, motivo) => negadas.push([tabla, motivo]));
  try {
    assert.equal(acciones.registrarDevolucion({ ventaId: "v1", monto: 1500, fecha: iso(OCTUBRE, 3) }), null);
    acciones.actualizar("ventas", "v1", { estado: "cancelada" }, "Belén Godoy");
    acciones.actualizar("ventas", "v1", { estado: "reembolsada" }, "Belén Godoy");
    assert.deepEqual(negadas.map(([t]) => t), ["devoluciones", "ventas", "ventas"]);
    assert.match(negadas[1][1]!, /no puede cancelar, devolver ni reactivar una venta/);
    const e = hoy();
    assert.equal(e.devoluciones.length, 0);
    assert.equal(e.ventas[0].estado, "activa");
    assert.equal(e.cuotas.find((c) => c.id === "c1c")!.estado, "pendiente");
    /* Pero sí edita su venta mientras siga activa. */
    acciones.actualizar("ventas", "v1", { notas: "Pidió factura" }, "Belén Godoy");
    assert.equal(hoy().ventas[0].notas, "Pidió factura");
    assert.equal(negadas.length, 3);
  } finally {
    dejarDeEscuchar();
    fijarAcceso(null);
  }
});

test("de punta a punta: septiembre cerrada, devolución del 03/10, septiembre igual y octubre con la devolución", () => {
  armar();
  fijarAcceso(ACCESO_DUENO);

  /* 1. Se cierra la liquidación de septiembre, como en el caso real. */
  const antes = hoy();
  const pylSeptAntes = calcularPyL(antes, sept);
  const liq = liquidacionVacia(SEPTIEMBRE, iso("2026-10", 1));
  const resultado = calcularLiquidacion(antes, SEPTIEMBRE, liq);
  acciones.cerrarLiquidacion(liq, resultado, gastosDeLiquidacion(antes, liq, resultado), "Juan Cruz");
  const cerrada = hoy().liquidaciones.find((l) => l.periodo === SEPTIEMBRE)!;
  assert.equal(cerrada.estado, "cerrada");
  const fotoSept = JSON.stringify(cerrada.resultado);

  /* 2. El 03/10 Belén pide la plata. La cargan con comprobante: se devuelve todo lo cobrado, la venta se da
        de baja y la llamada queda en «Devolución». */
  const id = acciones.registrarDevolucion({
    ventaId: "v1", monto: 3000, fecha: iso(OCTUBRE, 3), procesadorId: "proc_stripe",
    comprobante: { ruta: "pagos/2026/10/reembolso-stripe.pdf", nombre: "reembolso-stripe.pdf", tipo: "application/pdf", tamanio: 12000, subidoEn: iso(OCTUBRE, 3) },
    motivo: "Pidió la plata de vuelta a los 5 días", darDeBaja: true, marcarLlamada: true, sesionId: "ses_belen", por: "Aldana",
  });
  assert.ok(id);
  const e = hoy();

  /* La devolución quedó como transacción aparte, con quién la cargó. */
  const [d] = devolucionesDeVenta(e, "v1");
  assert.equal(d.monto, 3000);
  assert.equal(d.estado, "confirmada");
  assert.equal(d.cargadaPor, "Aldana");
  assert.equal(d.sesionId, "ses_belen");
  assert.equal(d.noDescontarAlCloser, false);

  /* La venta, el servicio y la llamada se enteran. */
  assert.equal(e.ventas[0].estado, "reembolsada");
  assert.equal(e.cuotas.find((c) => c.id === "c1c")!.estado, "cancelada", "la cuota que faltaba cobrar se cancela");
  assert.equal(e.cuotas.find((c) => c.id === "c1a")!.estado, "pagada", "lo ya cobrado no se toca");
  assert.equal(e.alumnos[0].estado, "baja");
  assert.equal(e.sesiones.find((s) => s.id === "ses_belen")!.estadoLlamada, "Devolución");
  assert.equal(e.sesiones.find((s) => s.id === "ses_otra")!.estadoLlamada, "Seguimiento Nutrición", "otra llamada no se toca");
  assert.equal(e.leads[0].etapaId, "et_perdido", "una devolución pierde la oportunidad aunque haya comprado");
  assert.ok(e.actividad.some((a) => /devolución de 3\.000 USD/.test(a.detalle)), "queda en la actividad");

  /* 3. Septiembre no cambia: ni sus números, ni su liquidación cerrada, ni «Algo del mes cambió». */
  assert.deepEqual(calcularPyL(e, sept), pylSeptAntes);
  const septCerrada = e.liquidaciones.find((l) => l.periodo === SEPTIEMBRE)!;
  assert.equal(JSON.stringify(septCerrada.resultado), fotoSept);
  assert.deepEqual(diferenciasDesdeElCierre(e, septCerrada), []);

  /* 4. Octubre muestra la devolución: Cash Collected, caja y liquidación. */
  const p = calcularPyL(e, oct);
  assert.equal(p.devoluciones, 3000);
  assert.equal(p.cashCollected, -1500);
  assert.equal(cashCollected(e, oct), -1500);
  assert.equal(p.revenue, 0, "la venta sigue contando en septiembre");
  const r = calcularLiquidacion(e, OCTUBRE, e.liquidaciones.find((l) => l.periodo === OCTUBRE));
  const mariano = r.personas.find((x) => x.miembroId === "mariano")!;
  const roja = mariano.lineas.find((l) => l.tipo === "devolucion")!;
  assert.equal(roja.nombre, "Devolución de Belén Godoy");
  assert.equal(roja.monto, -436.5);
  assert.deepEqual(evaluarPasos(roja.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(roja.desglose!), roja.monto);
  assert.deepEqual(mariano.deuda, { USD: 218.25 }, "la comisión de la cuota 2 no alcanza: queda debiendo y pasa a noviembre");
  assert.ok(renglonDe(r, "santi", "devolucion:" + d.id + ":director"));

  /* 5. Corregir la devolución (el monto) mueve los números; borrarla los devuelve. */
  assert.equal(acciones.editarDevolucion(d.id, { monto: 1500 }), true);
  assert.equal(calcularPyL(hoy(), oct).devoluciones, 1500);
  assert.equal(acciones.borrarDevolucion(d.id), true);
  assert.equal(hoy().devoluciones.length, 0);
  assert.equal(calcularPyL(hoy(), oct).cashCollected, 1500);
});

test("«Devolución» en el CRM avisa para cargarla, y deshacer no vuelve a avisar", () => {
  armar();
  fijarAcceso(ACCESO_DUENO);
  const avisos: string[] = [];
  const dejarDeEscuchar = alElegirDevolucion((a) => avisos.push(a.sesionId));
  try {
    acciones.editarLlamadas([{ id: "ses_otra", cambios: { estadoLlamada: "Devolución" }, detalle: "x" }]);
    assert.deepEqual(avisos, ["ses_otra"]);
    /* Elegir el mismo estado otra vez no es un cambio. */
    acciones.editarLlamadas([{ id: "ses_otra", cambios: { estadoLlamada: "Devolución" }, detalle: "x" }]);
    assert.deepEqual(avisos, ["ses_otra"]);
    /* Otro estado cualquiera no avisa. */
    acciones.editarLlamadas([{ id: "ses_belen", cambios: { estadoLlamada: "Compra Full" }, detalle: "x" }]);
    assert.deepEqual(avisos, ["ses_otra"]);
    /* Cargar la devolución desde la ficha de la venta deja la llamada en «Devolución» sin volver a avisar. */
    acciones.registrarDevolucion({ ventaId: "v1", monto: 500, fecha: iso(OCTUBRE, 4), procesadorId: "proc_stripe", marcarLlamada: true, sesionId: "ses_belen",
      comprobante: { ruta: "x", nombre: "x.pdf", tipo: "application/pdf", tamanio: 1, subidoEn: iso(OCTUBRE, 4) } });
    assert.equal(hoy().sesiones.find((s) => s.id === "ses_belen")!.estadoLlamada, "Devolución");
    assert.deepEqual(avisos, ["ses_otra"]);
  } finally {
    dejarDeEscuchar();
  }
});

test("el director la carga; sin venta o sin monto no hay nada que cargar; una propuesta de la pasarela se puede ignorar", () => {
  armar();
  fijarAcceso(director);
  /* El director sí. */
  const id = acciones.registrarDevolucion({ ventaId: "v1", monto: 100, fecha: iso(OCTUBRE, 3), procesadorId: "proc_stripe", comprobante: { ruta: "x", nombre: "x", tipo: "image/png", tamanio: 1, subidoEn: iso(OCTUBRE, 3) } });
  assert.ok(id);
  /* Sin venta, o con un monto en cero, no hay nada que cargar. */
  assert.equal(acciones.registrarDevolucion({ ventaId: "no-existe", monto: 100, fecha: iso(OCTUBRE, 3) }), null);
  assert.equal(acciones.registrarDevolucion({ ventaId: "v1", monto: 0, fecha: iso(OCTUBRE, 3) }), null);
  /* Una propuesta de la pasarela se ignora sin tocar los números. */
  fijarAcceso(ACCESO_DUENO);
  assert.equal(acciones.ignorarDevolucion(id!), true);
  assert.equal(calcularPyL(hoy(), oct).devoluciones, 0);
  fijarAcceso(null);
});
