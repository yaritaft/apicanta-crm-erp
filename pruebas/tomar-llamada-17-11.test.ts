import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { destinoDe, paseDeLaVenta } from "@/lib/pasar-llamadas";
import { pasadaDe, anfitrionTrasCalendly } from "@/lib/pasada-closer";
import { paseDeLlamadas, type MiAcceso } from "@/lib/permisos";
import type { EstadoApp, Lead, MiembroEquipo, Sesion, Venta } from "@/lib/types";

/* Mariano, 17/11 (WhatsApp): «esta llamada la tomé yo y la cerré, ¿cómo hago para cambiar el propietario para cargarla
   correctamente?». La llamada de Kevin la había repartido Calendly a Dante; Mariano la atendió, cargó la venta a su nombre y
   la llamada siguió figurando de Dante (y el lead también), porque sólo dueños y director podían cambiar el closer.

   La raíz, en dos partes:
   1) la venta dice quién atendió: al cargarla, la llamada pasa sola a nombre del vendedor;
   2) el closer que ve las llamadas de todos puede poner a su nombre una que figura de otro (sólo a su nombre). */

const DIA = (d: number, h = 15) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const M = (id: string, nombre: string, extra: Partial<MiembroEquipo> = {}): MiembroEquipo =>
  ({ id, nombre, rol: "closer", comisionRate: 0.1, activo: true, sinComision: false, email: `${id}@apicanta.com`, ...extra }) as MiembroEquipo;
const EQUIPO = [M("eq_mariano", "Mariano Arias"), M("eq_dante", "Dante Barbieri"), M("eq_yari", "Yari Taft", { rol: "ceo" }), M("eq_aldana", "Aldana Ytzcovich", { rol: "director" })];
const S = (id: string, anfitrion: string | undefined, extra: Partial<Sesion> = {}): Sesion => ({
  id, titulo: "Llamada de Asesoramiento - Setter", invitado: "Kevin Castañeda", email: "kevin@mail.com", inicia: DIA(16, 21), duracionMin: 60,
  estado: "hecha", tipo: "Llamada de Asesoramiento - Setter", origen: "calendly", creadoEn: DIA(14), contactoId: `lea_${id}`, leadId: `lea_${id}`,
  anfitrion, extra: { agendaAntes: "agendada" }, ...extra,
} as Sesion);
const L = (id: string, responsable: string): Lead => ({
  id, contactoId: id, nombre: "Kevin Castañeda", email: "kevin@mail.com", etapaId: "et_inscripto", responsable, etiquetas: [], moneda: "USD", monto: 0,
  creadoEn: DIA(14), actualizadoEn: DIA(14),
} as unknown as Lead);
const V = (id: string, contactoId: string, closerId: string | undefined, extra: Partial<Venta> = {}): Venta => ({
  id, contactoId, contactoNombre: "Kevin Castañeda", estado: "activa", fecha: DIA(16, 23), precioAcordado: 2500, moneda: "USD", closerId, creadoEn: DIA(16, 23), extra: {}, ...extra,
} as Venta);

function armar(sesiones: Sesion[], leads: Lead[] = []) {
  const base = construirSemilla() as EstadoApp;
  const e = { ...base, equipo: EQUIPO, sesiones, leads, ventas: [], cuotas: [], pagos: [], movimientos: [], actividad: [] };
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}

/* ---------- 1. La venta dice quién atendió ---------- */

test("el caso de Mariano: la venta a su nombre pasa la llamada (que Calendly le había dado a Dante) y el lead con ella", () => {
  armar([S("k", "Dante Barbieri"), S("m", "Mariano Arias", { invitado: "Otra", contactoId: "lea_m", leadId: "lea_m" })], [L("lea_k", "Dante Barbieri")]);
  acciones.registrarVenta({ venta: V("v1", "lea_k", "eq_mariano"), cuotas: [], cobros: [], sesionId: "k" });

  const e = hoy();
  const s = e.sesiones.find((x) => x.id === "k")!;
  assert.equal(s.anfitrion, "Mariano Arias", "queda con el nombre con el que Calendly ya trae a Mariano");
  const marca = pasadaDe(s);
  assert.equal(marca?.a, "Mariano Arias");
  assert.equal(marca?.calendly, "Dante Barbieri", "se anota lo que decía Calendly, para poder volver");
  assert.equal((s.extra as Record<string, unknown>).agendaAntes, "agendada", "lo demás del extra no se pierde");
  assert.equal(e.leads.find((l) => l.id === "lea_k")?.responsable, "Mariano Arias", "el responsable era quien figuraba atendiéndola: se va con la llamada");
  assert.equal(e.ventas.find((v) => v.id === "v1")?.sesionId, "k");
  assert.ok(e.actividad.some((a) => a.entidad === "sesion" && /pasó de Dante Barbieri a Mariano Arias, que es el vendedor/.test(a.detalle ?? "")), "queda en la actividad con el porqué");
  /* Calendly vuelve a mandar la agenda (un no-show, una reprogramación): no la devuelve a Dante. */
  assert.equal(anfitrionTrasCalendly("Dante Barbieri", s).anfitrion, "Mariano Arias");
});

test("sin elegir la llamada también: la venta la encuentra por la persona y la pasa igual", () => {
  armar([S("k", "Dante Barbieri")], [L("lea_k", "Dante Barbieri")]);
  acciones.registrarVenta({ venta: V("v1", "lea_k", "eq_mariano"), cuotas: [], cobros: [] });
  assert.equal(hoy().sesiones.find((x) => x.id === "k")?.anfitrion, "Mariano Arias");
});

test("no toca nada cuando no corresponde: la llamada ya es del vendedor, la venta no tiene vendedor o el lead es de un tercero", () => {
  armar([S("k", "Mariano Arias")], [L("lea_k", "Mariano Arias")]);
  acciones.registrarVenta({ venta: V("v1", "lea_k", "eq_mariano"), cuotas: [], cobros: [], sesionId: "k" });
  let s = hoy().sesiones.find((x) => x.id === "k")!;
  assert.equal(s.anfitrion, "Mariano Arias");
  assert.equal(pasadaDe(s), undefined, "ya era suya: no se le pone la marca de «pasada a mano»");

  armar([S("k", "Dante Barbieri")], [L("lea_k", "Dante Barbieri")]);
  acciones.registrarVenta({ venta: V("v2", "lea_k", undefined), cuotas: [], cobros: [], sesionId: "k" });
  s = hoy().sesiones.find((x) => x.id === "k")!;
  assert.equal(s.anfitrion, "Dante Barbieri", "sin vendedor no hay a quién pasarla");

  armar([S("k", "Dante Barbieri")], [L("lea_k", "Yari Taft")]);
  acciones.registrarVenta({ venta: V("v3", "lea_k", "eq_mariano"), cuotas: [], cobros: [], sesionId: "k" });
  const e = hoy();
  assert.equal(e.sesiones.find((x) => x.id === "k")?.anfitrion, "Mariano Arias");
  assert.equal(e.leads.find((l) => l.id === "lea_k")?.responsable, "Yari Taft", "el responsable era otro (no quien la atendía): no se toca");
});

test("la regla sola: cancelada no se pasa; una llamada sin closer queda del vendedor; quien no figura como closer igual puede quedar", () => {
  const e = { equipo: EQUIPO, sesiones: [S("a", "Mariano Arias"), S("b", "Dante Barbieri")] };
  const ctx = { por: "Mariano Arias", cuando: DIA(16, 23) };
  assert.equal(paseDeLaVenta(S("x", "Dante Barbieri", { estado: "cancelada" }), "eq_mariano", e, ctx), null);
  assert.equal(paseDeLaVenta(S("x", "Dante Barbieri"), undefined, e, ctx), null);
  assert.equal(paseDeLaVenta(S("x", "Dante Barbieri"), "eq_dante", e, ctx), null, "ya es suya");
  const sinCloser = paseDeLaVenta(S("x", undefined), "eq_mariano", e, ctx)!;
  assert.equal(sinCloser.plan.cambios.anfitrion, "Mariano Arias");
  assert.match(sinCloser.plan.detalle, /no tenía closer/);
  /* Aldana (acá, alguien que no es closer) no atendió llamadas: no está en la lista para pasar, pero si es la vendedora de la venta, la llamada queda suya. */
  assert.equal(destinoDe(e, "eq_aldana")?.anfitrion, "Aldana Ytzcovich");
  assert.equal(destinoDe(e, "eq_nadie"), undefined);
  /* Vuelve a quien dice Calendly: se saca la marca (igual que un pase a mano). */
  const pasada = S("x", "Mariano Arias", { extra: { pasada: { a: "Mariano Arias", calendly: "Dante Barbieri", por: "Santi", en: DIA(15) } } });
  const vuelve = paseDeLaVenta(pasada, "eq_dante", e, ctx)!;
  assert.equal(vuelve.plan.cambios.anfitrion, "Dante Barbieri");
  assert.equal(pasadaDe({ extra: vuelve.plan.cambios.extra }), undefined);
});

/* ---------- 2. Quién puede cambiar el closer de una llamada ---------- */

test("dueños y director pasan a cualquiera; el closer con las llamadas de todos sólo la toma; el de «sólo lo suyo» y quien no edita, nada", () => {
  const a = (extra: Partial<MiAcceso>): MiAcceso => ({ tipo: "x", nombre: "x", areas: { crm: "editar", ventas: "editar" }, soloLoSuyo: false, ...extra });
  assert.equal(paseDeLlamadas(a({ tipo: "dueno", areas: {} })), "pasar");
  assert.equal(paseDeLlamadas(a({ tipo: "director" })), "pasar");
  assert.equal(paseDeLlamadas(a({ tipo: "closer_ve_leads", soloLoSuyo: true, veTodosLosLeads: true })), "tomar", "Mariano y Dante");
  assert.equal(paseDeLlamadas(a({ tipo: "closer", soloLoSuyo: true })), null, "la base no le muestra las de otros");
  assert.equal(paseDeLlamadas(a({ tipo: "marketing", areas: { crm: "ver" } })), null, "sólo mira el CRM");
  assert.equal(paseDeLlamadas(null), null);
});
