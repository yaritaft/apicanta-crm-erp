import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import {
  closerSugerido, closersPosibles, esperaDe, haceCuanto, HORAS_DE_ALARMA, HORAS_DE_ATENCION, nivelDePedido, pedidosAbiertos, pedidosDeCloser,
  pedidosPorCloser, tienePedidoAbierto,
} from "@/lib/pedidos-de-venta";
import { miPanelDe, rangoDelPanel } from "@/lib/mi-panel";
import { construirSemilla } from "@/lib/seed";
import type { Contacto, EstadoApp, Movimiento, Sesion } from "@/lib/types";

/* Aldana (20/10): «hay alguna forma de ponerle una alerta al closer cuando no me pasa las ventas? Si yo sé que X venta pertenece a tal
   closer que yo se lo asigne para que cargue los datos y le aparezca el pendiente si no lo hace». */

const AHORA = Date.parse("2026-10-21T15:00:00.000Z");
const HORAS = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();
const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const cobro = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `mov_whop_${id}`, proveedor: "whop", referencia: id, monto: 1700.87, moneda: "USD", fee: 0, neto: 1700.87, fecha: "2026-10-20T12:37:00.000Z",
  estado: "pendiente", procesadorId: "proc_whop", clienteNombre: "Julian Parengo", clienteEmail: "parengojulian@gmail.com", creadoEn: "2026-10-20T12:37:00.000Z", origen: "api", ...extra,
} as Movimiento);
const llamada = (id: string, extra: Partial<Sesion> = {}): Sesion => ({
  id, titulo: "Llamada", invitado: "Julian Parengo", email: "parengojulian@gmail.com", inicia: "2026-10-12T18:00:00.000Z", duracionMin: 45, estado: "hecha",
  tipo: "Llamada de venta", origen: "calendly", creadoEn: "2026-10-10T10:00:00.000Z", extra: {}, anfitrion: "Mariano", ...extra,
} as Sesion);
const armar = (movs: Movimiento[], sesiones: Sesion[] = [], contactos: Contacto[] = []) => {
  const e = { ...(construirSemilla() as EstadoApp), ventas: [], cuotas: [], pagos: [], movimientos: movs, gastos: [], traspasos: [], arqueos: [], actividad: [], sesiones, contactos, leads: [] };
  assert.equal(acciones.importar(JSON.stringify(e)), true);
  return hoy();
};

test("el pedido se pone amarillo al día y rojo a los dos días; «hace cuánto» se lee en horas y en días", () => {
  assert.equal(nivelDePedido(0), "nuevo");
  assert.equal(nivelDePedido(HORAS_DE_ATENCION - 0.1), "nuevo");
  assert.equal(nivelDePedido(HORAS_DE_ATENCION), "atrasado");
  assert.equal(nivelDePedido(HORAS_DE_ALARMA - 0.1), "atrasado");
  assert.equal(nivelDePedido(HORAS_DE_ALARMA), "urgente");
  assert.equal(haceCuanto(0.2), "recién");
  assert.equal(haceCuanto(1), "hace 1 hora");
  assert.equal(haceCuanto(5.9), "hace 5 horas");
  assert.equal(haceCuanto(24), "hace 1 día");
  assert.equal(haceCuanto(79), "hace 3 días");
  /* El aviso de Finanzas: uno solo, «hace…»; varios, el más viejo. */
  assert.equal(esperaDe({ n: 1, masViejoHoras: 0.2 }), "recién pedido");
  assert.equal(esperaDe({ n: 3, masViejoHoras: 0.2 }), "todos recién pedidos");
  assert.equal(esperaDe({ n: 1, masViejoHoras: 50 }), "hace 2 días");
  assert.equal(esperaDe({ n: 2, masViejoHoras: 50 }), "el más viejo hace 2 días");
});

test("sólo cuentan los pedidos de cobros que siguen pendientes: al conciliarse o dejarse sin venta, el pedido se va solo", () => {
  const e = armar([
    cobro("a", { pedidoACloserId: "eq_mariano", pedidoEn: HORAS(60) }),
    cobro("b", { pedidoACloserId: "eq_valentin", pedidoEn: HORAS(5), monto: 500 }),
    cobro("c", { pedidoACloserId: "eq_mariano", pedidoEn: HORAS(30), estado: "conciliado" }),
    cobro("d", { pedidoACloserId: "eq_mariano", pedidoEn: HORAS(30), estado: "ignorado", motivo: "No es una venta" }),
    cobro("e"),
  ]);
  assert.deepEqual(e.movimientos.map(tienePedidoAbierto), [true, true, false, false, false]);
  const abiertos = pedidosAbiertos(e, AHORA);
  assert.deepEqual(abiertos.map((p) => p.movimiento.referencia), ["a", "b"], "el más viejo primero");
  assert.deepEqual(abiertos.map((p) => p.nivel), ["urgente", "nuevo"]);
  assert.deepEqual(pedidosDeCloser(e, "eq_mariano", AHORA).map((p) => p.movimiento.referencia), ["a"]);
  assert.deepEqual(pedidosDeCloser(e, "eq_dante", AHORA), []);
  const por = pedidosPorCloser(e, AHORA);
  assert.deepEqual(por.map((x) => [x.closerId, x.n, x.monto, x.nivel]), [["eq_mariano", 1, 1700.87, "urgente"], ["eq_valentin", 1, 500, "nuevo"]]);
});

test("sin fecha del pedido cuenta desde que entró el cobro; una fecha rota no tira nada", () => {
  const e = armar([cobro("a", { pedidoACloserId: "eq_mariano" }), cobro("b", { pedidoACloserId: "eq_mariano", pedidoEn: "no es una fecha" })]);
  const p = pedidosAbiertos(e, AHORA);
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => Number.isFinite(x.horas) && x.horas >= 0));
});

test("a quién se le puede pedir: los closers activos del equipo, en orden", () => {
  const e = armar([]);
  const c = closersPosibles([...e.equipo, { ...e.equipo.find((m) => m.id === "eq_dante")!, id: "eq_ex", nombre: "Alguien que se fue", activo: false }]);
  assert.ok(c.length >= 4 && c.every((m) => m.rol === "closer" && m.activo));
  assert.ok(!c.some((m) => m.id === "eq_ex") && !c.some((m) => m.id === "eq_yari"));
  assert.deepEqual(c.map((m) => m.nombre), [...c.map((m) => m.nombre)].sort((a, b) => a.localeCompare(b, "es")));
});

test("el closer sugerido es el que tuvo la llamada con esa persona: por correo, por su ficha o por su nombre", () => {
  const m = cobro("a");
  /* Por el correo de la llamada. */
  let e = armar([m], [llamada("s1")]);
  let s = closerSugerido(e, e.movimientos[0]);
  assert.equal(s?.miembro.id, "eq_mariano");
  assert.equal(s?.por, "correo");
  /* Otro closer atendió una llamada más vieja: gana la última antes del cobro. */
  e = armar([m], [llamada("s0", { inicia: "2026-10-05T18:00:00.000Z", anfitrion: "Valentín" }), llamada("s1")]);
  assert.equal(closerSugerido(e, e.movimientos[0])?.miembro.id, "eq_mariano");
  /* Una llamada cancelada o de resell no cuenta. */
  e = armar([m], [llamada("s1", { estado: "cancelada" })]);
  assert.equal(closerSugerido(e, e.movimientos[0]), undefined);
  e = armar([m], [llamada("s1", { tipo: "Resell", titulo: "Resell", utm: { utm_campaign: "resell" } })]);
  assert.equal(closerSugerido(e, e.movimientos[0]), undefined);
  /* Por la ficha: agendó con otro correo, pero la llamada está unida a su contacto (el del correo con el que pagó). */
  const contacto = { id: "con_1", nombre: "Julian Parengo", email: "parengojulian@gmail.com", creadoEn: "2026-10-01T00:00:00.000Z" } as Contacto;
  e = armar([cobro("a", { clienteNombre: undefined })], [llamada("s1", { email: "x@y.com", invitado: "J. P.", contactoId: "con_1" })], [contacto]);
  s = closerSugerido(e, e.movimientos[0]);
  assert.equal(s?.miembro.id, "eq_mariano");
  assert.equal(s?.por, "ficha");
  /* Por el nombre, sólo si no hay dos personas distintas con ese nombre. */
  e = armar([cobro("a", { clienteEmail: undefined })], [llamada("s1", { email: undefined })]);
  assert.equal(closerSugerido(e, e.movimientos[0])?.por, "nombre");
  e = armar([cobro("a", { clienteEmail: undefined })], [llamada("s1", { email: "uno@x.com" }), llamada("s2", { email: "dos@x.com", anfitrion: "Valentín" })]);
  assert.equal(closerSugerido(e, e.movimientos[0]), undefined, "dos Julian Parengo distintos: no se adivina");
});

test("sin llamada de esa persona o con un anfitrión que no es del equipo, no sugiere a nadie", () => {
  let e = armar([cobro("a")], []);
  assert.equal(closerSugerido(e, e.movimientos[0]), undefined);
  e = armar([cobro("a")], [llamada("s1", { anfitrion: "Alguien Ajeno" })]);
  assert.equal(closerSugerido(e, e.movimientos[0]), undefined);
});

test("pedir la venta: queda en el cobro, anotado en la actividad; al mismo closer no corre el reloj, a otro sí; se puede sacar", () => {
  armar([cobro("a")]);
  assert.equal(acciones.pedirVentaACloser("mov_whop_a", "eq_mariano", "Aldana"), true);
  let m = hoy().movimientos[0];
  assert.equal(m.pedidoACloserId, "eq_mariano");
  assert.equal(m.pedidoPor, "Aldana");
  assert.ok(Number.isFinite(Date.parse(m.pedidoEn!)));
  assert.ok(hoy().actividad.some((a) => /le pidió a Mariano que cargue la venta/i.test(a.detalle ?? "")), "queda anotado");
  const primera = m.pedidoEn;
  assert.equal(acciones.pedirVentaACloser("mov_whop_a", "eq_mariano", "Otra persona"), true);
  assert.equal(hoy().movimientos[0].pedidoEn, primera, "al mismo closer no se corre el reloj");
  assert.equal(hoy().movimientos[0].pedidoPor, "Aldana");
  assert.equal(acciones.pedirVentaACloser("mov_whop_a", "eq_valentin", "Aldana"), true);
  m = hoy().movimientos[0];
  assert.equal(m.pedidoACloserId, "eq_valentin");
  assert.equal(acciones.quitarPedidoDeVenta("mov_whop_a"), true);
  m = hoy().movimientos[0];
  assert.equal(m.pedidoACloserId, undefined);
  assert.equal(m.pedidoEn, undefined);
  assert.equal(acciones.quitarPedidoDeVenta("mov_whop_a"), false, "no había pedido");
});

test("no se pide la venta de un cobro que ya no está pendiente, ni a alguien que no existe", () => {
  armar([cobro("a", { estado: "ignorado", motivo: "Se reembolsó" }), cobro("b"), cobro("c", { estado: "conciliado" })]);
  assert.equal(acciones.pedirVentaACloser("mov_whop_a", "eq_mariano"), false);
  assert.equal(acciones.pedirVentaACloser("mov_whop_c", "eq_mariano"), false);
  assert.equal(acciones.pedirVentaACloser("mov_whop_b", "eq_no_existe"), false);
  assert.equal(acciones.pedirVentaACloser("mov_no_existe", "eq_mariano"), false);
  assert.ok(hoy().movimientos.every((m) => !m.pedidoACloserId));
});

test("el closer ve el pedido en Pendientes de su panel (primero, con el botón para cargar la venta) y los otros closers no", () => {
  const e = armar([
    cobro("a", { pedidoACloserId: "eq_mariano", pedidoEn: HORAS(60) }),
    cobro("b", { pedidoACloserId: "eq_mariano", pedidoEn: HORAS(3), clienteNombre: "Ana Gómez", monto: 450 }),
    cobro("c", { pedidoACloserId: "eq_valentin", pedidoEn: HORAS(3) }),
  ]);
  const rango = rangoDelPanel("2026-10-01", "2026-10-31", "octubre");
  const mariano = miPanelDe(e, e.equipo.find((m) => m.id === "eq_mariano")!, rango, AHORA);
  assert.equal(mariano.pedidos.length, 2);
  const pv = mariano.avisos.filter((a) => a.clave.startsWith("pv|"));
  assert.deepEqual(pv.map((a) => a.clave), ["pv|mov_whop_a", "pv|mov_whop_b"], "el más viejo primero");
  assert.deepEqual(pv.map((a) => a.tono), ["danger", "warning"].map((t, i) => (i === 0 ? "danger" : "warning")), "rojo a los dos días; antes, amarillo");
  assert.equal(pv[0].resaltado, "Julian Parengo");
  assert.match(pv[0].texto, /Finanzas te pide cargar la venta de su cobro de US\$ 1\.701 por .* del 20\/10 \(hace 2 días\)\./);
  assert.deepEqual(pv[0].accion, { texto: "Cargar la venta", ir: "cargar-venta", id: "mov_whop_a" });
  assert.equal(mariano.avisos[0].clave, "pv|mov_whop_a", "van antes que lo demás");
  assert.ok(mariano.totalAvisos >= 2);
  const valentin = miPanelDe(e, e.equipo.find((m) => m.id === "eq_valentin")!, rango, AHORA);
  assert.deepEqual(valentin.avisos.filter((a) => a.clave.startsWith("pv|")).map((a) => a.clave), ["pv|mov_whop_c"]);
  const dante = miPanelDe(e, e.equipo.find((m) => m.id === "eq_dante")!, rango, AHORA);
  assert.equal(dante.pedidos.length, 0);
  assert.ok(!dante.avisos.some((a) => a.clave.startsWith("pv|")));
});

test("el aviso desaparece cuando el cobro se concilia", () => {
  const e = armar([cobro("a", { pedidoACloserId: "eq_mariano", pedidoEn: HORAS(10) })]);
  const rango = rangoDelPanel("2026-10-01", "2026-10-31", "octubre");
  const mariano = e.equipo.find((m) => m.id === "eq_mariano")!;
  assert.equal(miPanelDe(e, mariano, rango, AHORA).pedidos.length, 1);
  const conciliado = { ...e, movimientos: e.movimientos.map((m) => ({ ...m, estado: "conciliado" as const })) };
  const sin = miPanelDe(conciliado, mariano, rango, AHORA);
  assert.equal(sin.pedidos.length, 0);
  assert.ok(!sin.avisos.some((a) => a.clave.startsWith("pv|")));
});
