import test from "node:test";
import assert from "node:assert/strict";
import { filasClientes, NO_SE_HACIA_CONTRATO } from "@/lib/clientes-cs";
import { panelDeServicio } from "@/lib/panel-servicio";
import { filasDeSeguimiento, seguimientoVacio, CONFIG_POR_DEFECTO } from "@/lib/seguimiento";
import { alumnoDeVenta } from "@/lib/alumnos";
import { enviarPorResend } from "@/lib/reporte-servidor";
import type { EstadoApp, SeguimientoAlumno, Venta } from "@/lib/types";

/* Lili (22/10): Ricardo Auric sólo pagó la reserva de un Downsell y le aparecía «falta el contacto a la semana»; a Agustín
   (reserva de julio) no se le hacía contrato; y los que ella carga a mano no tienen que duplicarse cuando el closer cargue
   la venta. */
const HOY = "2026-10-22";
const AHORA = new Date("2026-10-22T15:00:00.000Z");
const alumno = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, email: `${id}@mail.com`, estado: "activo", inicio: "2026-10-15T12:00:00.000Z", cohorte: "", plan: "", extra: {}, ...extra,
});
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno> = {}): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), ...c });

function estado(): EstadoApp {
  return {
    ajustes: {},
    alumnos: [
      alumno("ricardo", "Ricardo Auric", { ventaId: "v_res", inicio: "2026-10-11T12:00:00.000Z" }),
      alumno("agustin", "Agustin Rosas", { ventaId: "v_jul", inicio: "2026-07-28T12:00:00.000Z" }),
      alumno("ana", "Ana Completa", { ventaId: "v_ok" }),
      alumno("dante", "Dante Downsell", { ventaId: "v_down", inicio: "2026-08-10T12:00:00.000Z" }),
      alumno("manual", "Lili Manual", { inicio: "2026-10-22T12:00:00.000Z" }),
    ],
    leads: [{ id: "l_closer", nombre: "Lili Manual", email: "otro@mail.com", telefono: "+54 9 11 5555-0909" }],
    contactos: [],
    ventas: [
      { id: "v_res", productoId: "p_down", estado: "activa", fecha: "2026-10-11T12:00:00.000Z", moneda: "USD", precioAcordado: 500 },
      { id: "v_jul", productoId: "p_it", estado: "activa", fecha: "2026-07-28T12:00:00.000Z", moneda: "USD", precioAcordado: 2400 },
      { id: "v_ok", productoId: "p_it", estado: "activa", fecha: "2026-10-15T12:00:00.000Z", moneda: "USD", precioAcordado: 2400 },
      { id: "v_down", productoId: "p_down", estado: "activa", fecha: "2026-08-10T12:00:00.000Z", moneda: "USD", precioAcordado: 500 },
    ],
    cuotas: [
      { id: "c1", ventaId: "v_res", numero: 0, esReserva: true, estado: "pagada", monto: 73 },
      { id: "c2", ventaId: "v_res", numero: 1, esReserva: false, estado: "pendiente", monto: 427 },
      { id: "c3", ventaId: "v_jul", numero: 0, esReserva: true, estado: "pagada", monto: 57 },
      { id: "c4", ventaId: "v_ok", numero: 1, esReserva: false, estado: "pagada", monto: 2400 },
      { id: "c5", ventaId: "v_down", numero: 1, esReserva: false, estado: "pagada", monto: 500 },
    ],
    productos: [{ id: "p_down", nombre: "Downsell" }, { id: "p_it", nombre: "Hackear IT" }],
    equipo: [], etapasServicio: [], reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [],
    seguimientos: [seg("manual", { telefono: "11 5555 0909" })],
  } as unknown as EstadoApp;
}

test("la reserva sin completar no entra al seguimiento: ni el primer contacto, ni la lista de hoy", () => {
  const e = estado();
  const filas = filasClientes(e, HOY);
  const ricardo = filas.find((f) => f.id === "ricardo")!;
  assert.equal(ricardo.enReserva, true);
  assert.equal(ricardo.situacion, "reserva");
  assert.equal(ricardo.estadoAlumno, "Reserva", "se lee que todavía no está activo");
  assert.equal(filas.find((f) => f.id === "ana")!.enReserva, false);
  const p = panelDeServicio(e, HOY, AHORA);
  const nuevos = p.secciones.find((s) => s.id === "nuevos")!.items.map((i) => i.alumnoId);
  assert.ok(!nuevos.includes("ricardo"), "no le falta el primer contacto: todavía no arrancó");
  assert.ok(nuevos.includes("ana"));
  assert.equal(filasDeSeguimiento(e, HOY).find((f) => f.id === "ricardo")?.situacion, "reserva", "tampoco en «A contactar hoy»");
});

test("el Follow Up «Reserva» la marca a mano (la reserva se pagó por fuera de la app)", () => {
  const e = estado();
  e.seguimientos = [...(e.seguimientos ?? []), seg("ana", { followUp: "Reserva" })];
  assert.equal(filasClientes(e, HOY).find((f) => f.id === "ana")!.situacion, "reserva");
});

test("a las reservas y al Downsell de antes del 22/09 no se les hacía contrato: se sugiere y no figura como pendiente", () => {
  const e = estado();
  const filas = filasClientes(e, HOY);
  const agustin = filas.find((f) => f.id === "agustin")!;
  assert.equal(agustin.contrato, NO_SE_HACIA_CONTRATO);
  assert.equal(agustin.contratoSugerido, true);
  assert.equal(filas.find((f) => f.id === "dante")!.contrato, NO_SE_HACIA_CONTRATO, "Downsell de agosto");
  assert.equal(filas.find((f) => f.id === "ricardo")!.contrato, "", "la reserva de octubre sí lleva contrato");
  const sinFirmar = panelDeServicio(e, HOY, AHORA).secciones.find((s) => s.id === "contratos")!.items.map((i) => i.alumnoId);
  assert.ok(!sinFirmar.includes("agustin") && !sinFirmar.includes("dante"));
  /* Si Lili ya cargó algo, manda lo suyo. */
  e.seguimientos = [...(e.seguimientos ?? []), seg("dante", { contratoFirmado: "Firmado" })];
  assert.equal(filasClientes(e, HOY).find((f) => f.id === "dante")!.contrato, "Firmado");
});

test("la venta que carga el closer encuentra al alumno que Lili cargó a mano, aunque tenga otro mail", () => {
  const e = estado();
  const venta = { id: "v_nueva", contactoId: "l_closer", contactoNombre: "Lili Manual", estado: "activa" } as Venta;
  assert.equal(alumnoDeVenta(e, venta)?.id, "manual", "mismo teléfono y nombre");
  e.leads = [{ ...e.leads[0], nombre: "Otra Persona" }];
  e.alumnos = e.alumnos.map((a) => (a.id === "manual" ? { ...a, nombre: "Otra Distinta" } : a));
  assert.equal(alumnoDeVenta(e, { ...venta, contactoNombre: "Otra Persona" }), undefined, "con otro nombre no se junta sola");
});

test("el mail de bienvenida sale con «responder a» la persona de soporte", async () => {
  let cuerpo: Record<string, unknown> = {};
  const pedir = (async (_u: string, init: { body: string }) => {
    cuerpo = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await enviarPorResend({ clave: "x", desde: "Hackear IT <bienvenida@ejemplo.com>" }, { para: "a@b.com", asunto: "Hola", texto: "t", html: "h", responderA: "soporte@ejemplo.com" }, pedir);
  assert.equal(r.ok, true);
  assert.equal(cuerpo.reply_to, "soporte@ejemplo.com");
  await enviarPorResend({ clave: "x", desde: "x <x@x.com>" }, { para: "a@b.com", asunto: "Hola", texto: "t", html: "h" }, pedir);
  assert.equal(cuerpo.reply_to, undefined, "sin dato, no se manda");
});
