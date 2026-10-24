import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { agendasParaMarcar, setterDeAgendas } from "@/lib/setter-agendas";
import { esAutomatica, quienPagoVsCliente, sugerenciasPara } from "@/lib/conciliacion";
import { miPanelDe } from "@/lib/mi-panel";
import { rangoDeFechas } from "@/lib/metricas";
import type { EstadoApp, MiembroEquipo, Movimiento, Sesion, Venta } from "@/lib/types";

/* Pedidos del equipo del 24/10:
   - Daniel (setter): marcar él las agendas que setteó, sin avisarle a cada closer.
   - Dante (closer): cargó la seña de Andres Lopez en la venta de Andres Gallego; el mismo cobro de Stripe quedó en dos ventas. */

const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const DIA = (d: number, h = 15) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const setter: MiembroEquipo = { id: "eq_daniel", nombre: "Daniel Rodriguez", rol: "setter", activo: true, email: "daniel@apicanta.com" } as MiembroEquipo;
const closer: MiembroEquipo = { id: "eq_dante", nombre: "Dante Barbieri", rol: "closer", activo: true, email: "dante@apicanta.com" } as MiembroEquipo;
const S = (id: string, d: number, extra: Partial<Sesion> = {}): Sesion => ({
  id, titulo: "Llamada de asesoramiento", invitado: `Persona ${id}`, email: `${id}@mail.com`, inicia: DIA(d), duracionMin: 45,
  estado: "agendada", tipo: "venta", origen: "calendly", creadoEn: DIA(d - 2), contactoId: `lea_${id}`, leadId: `lea_${id}`, anfitrion: "Dante Barbieri", ...extra,
} as Sesion);

/* ---------- La regla: de qué agenda sale el setter de una venta ---------- */

test("la venta toma el setter de su propia llamada; si no está marcada, el de la última agenda marcada de esa persona (45 días)", () => {
  const ses = [
    S("a", 1, { contactoId: "lea_x", setterId: "eq_daniel" }),
    S("b", 20, { contactoId: "lea_x" }),
    S("c", 21, { contactoId: "lea_y", setterId: "eq_otro" }),
  ];
  assert.equal(setterDeAgendas(ses, { sesionId: "c", contactoId: "lea_y", fecha: DIA(21) }), "eq_otro", "la llamada misma");
  assert.equal(setterDeAgendas(ses, { sesionId: "b", contactoId: "lea_x", fecha: DIA(20) }), "eq_daniel", "otra agenda marcada de la persona");
  assert.equal(setterDeAgendas(ses, { contactoId: "lea_x", fecha: "2026-11-20T15:00:00.000Z" }), undefined, "más de 45 días después ya no cuenta");
  assert.equal(setterDeAgendas(ses, { contactoId: "lea_x", fecha: "2026-09-25T15:00:00.000Z" }), undefined, "una agenda posterior a la venta no cuenta");
  assert.equal(setterDeAgendas(ses, { contactoId: "lea_z", fecha: DIA(21) }), undefined);
});

test("para sumar: 3 semanas atrás y 2 adelante, sin canceladas ni resells, y dice quién la marcó", () => {
  const e = {
    ...construirSemilla(),
    equipo: [setter, closer],
    sesiones: [
      S("hoy", 24), S("vieja", 1), S("lejana", 31 /* 31/10 */), S("cancelada", 23, { estado: "cancelada" }),
      S("resell", 22, { titulo: "Llamada de Asesoramiento - Próximos pasos", tipo: "resell" }), S("marcada", 22, { setterId: "eq_daniel" }),
      S("noviembre", 1, { inicia: "2026-11-15T15:00:00.000Z" }),
      S("link", 20, { utm: { utm_source: "setter", utm_medium: "outbound", utm_campaign: "setter_daniel" } }),
    ],
  } as unknown as EstadoApp;
  const r = agendasParaMarcar(e, "eq_daniel", Date.parse(DIA(24)));
  assert.deepEqual(r.map((x) => x.sesion.id), ["hoy", "lejana", "marcada", "link"], "primero las que vienen (la más próxima arriba) y después las que pasaron (la más reciente arriba)");
  assert.equal(r.find((x) => x.sesion.id === "link")?.porLink, true, "la que entró por su link ya es suya");
  const ids = r.map((x) => x.sesion.id);
  assert.ok(ids.includes("hoy") && ids.includes("lejana") && ids.includes("marcada"));
  assert.ok(!ids.includes("vieja") && !ids.includes("cancelada") && !ids.includes("noviembre") && !ids.includes("resell"));
  assert.equal(r.find((x) => x.sesion.id === "marcada")?.marcadaPor?.nombre, "Daniel Rodriguez");
  assert.deepEqual(agendasParaMarcar(e, "eq_daniel", Date.parse(DIA(24)), "persona hoy").map((x) => x.sesion.id), ["hoy"], "busca por nombre sin importar mayúsculas");
});

/* ---------- El store: marcar, cargar la venta y Mi panel ---------- */

function armar(sesiones: Sesion[]) {
  const base = construirSemilla() as EstadoApp;
  const e = { ...base, equipo: [setter, closer, ...base.equipo.filter((m) => m.id !== setter.id && m.id !== closer.id)], sesiones, ventas: [], cuotas: [], pagos: [], movimientos: [], actividad: [] };
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}

test("el setter marca una agenda (sin nube queda en memoria) y la venta de esa persona lo toma sola", async () => {
  armar([S("s1", 23), S("s2", 23, { invitado: "Otra persona" })]);
  const r = await acciones.marcarAgendaDeSetter("s1", true, "eq_daniel");
  assert.deepEqual(r, { ok: true, ventas: 0 });
  assert.equal(hoy().sesiones.find((s) => s.id === "s1")?.setterId, "eq_daniel");

  const venta = (id: string, contactoId: string, extra: Partial<Venta> = {}) => ({
    id, contactoId, contactoNombre: "Persona", estado: "activa", fecha: DIA(24), precioAcordado: 500, moneda: "USD", closerId: "eq_dante", creadoEn: DIA(24), extra: {}, ...extra,
  } as Venta);
  acciones.registrarVenta({ venta: venta("v1", "lea_s1"), cuotas: [], cobros: [] });
  assert.equal(hoy().ventas.find((v) => v.id === "v1")?.setterId, "eq_daniel", "sin elegir setter, la venta toma el de la agenda");
  acciones.registrarVenta({ venta: venta("v2", "lea_s1", { setterId: "eq_otro" }), cuotas: [], cobros: [] });
  assert.equal(hoy().ventas.find((v) => v.id === "v2")?.setterId, "eq_otro", "si el closer eligió otro, queda el que eligió");
  acciones.registrarVenta({ venta: venta("v3", "lea_s2"), cuotas: [], cobros: [] });
  assert.equal(hoy().ventas.find((v) => v.id === "v3")?.setterId, undefined, "la agenda que no marcó nadie no trae setter");

  /* Mi panel: la marcada aparece entre sus agendas, aunque no entró por su link. */
  const panel = miPanelDe(hoy(), setter, rangoDeFechas("2026-10-20", "2026-10-26", "esta semana"), Date.parse(DIA(24)));
  const suyas = panel.agendasDeSetter.map((a) => `${a.sesion.id}:${a.marcada ? "marcada" : ""}${a.porLink ? "link" : ""}`);
  assert.deepEqual(suyas, ["s1:marcada"]);

  await acciones.marcarAgendaDeSetter("s1", false, "eq_daniel");
  assert.equal(hoy().sesiones.find((s) => s.id === "s1")?.setterId, undefined, "desmarcar la saca");
});

/* ---------- El selector de cobros: dos «Andres» con seña de US$ 50 ---------- */

test("un nombre en común no alcanza para «Coincide»: hace falta el mail o nombre y apellido", () => {
  const mov = (clienteNombre?: string, clienteEmail?: string) => ({ clienteNombre, clienteEmail } as Pick<Movimiento, "clienteNombre" | "clienteEmail">);
  const lopez = mov("Andres Lopez", "andreslq520@gmail.com");
  assert.equal(quienPagoVsCliente(lopez, { nombre: "Andres Gallego", email: "afgallegoz@gmail.com" }), "otra-persona", "el caso de Dante");
  assert.equal(quienPagoVsCliente(lopez, { nombre: "Andres Lopez", email: "otro@mail.com" }), "es", "nombre y apellido");
  assert.equal(quienPagoVsCliente(lopez, { nombre: "Andrés Felipe López Trejos" }), "es", "con tildes y segundo nombre");
  assert.equal(quienPagoVsCliente(mov("Tarjeta empresa SA", "andreslq520@gmail.com"), { nombre: "Andres Lopez", email: "AndresLQ520@gmail.com" }), "es", "mismo mail");
  assert.equal(quienPagoVsCliente(mov("JORGE DAVID LLAMAS O"), { nombre: "Jorge David Llamas Olivero" }), "es", "nombre cortado por la pasarela");
  assert.equal(quienPagoVsCliente(mov("Andres"), { nombre: "Andres Gallego" }), "sin-dato", "un solo nombre: no se sabe");
  assert.equal(quienPagoVsCliente(mov(undefined, undefined), { nombre: "Andres Gallego" }), "sin-dato", "la pasarela no dice quién pagó");
  assert.equal(quienPagoVsCliente(lopez, undefined), "sin-dato", "sin cliente no se compara");
});

test("Conciliación: el pago de Andres Lopez no «se parece» a la seña de Andres Gallego y no se ata solo", () => {
  const base = construirSemilla() as EstadoApp;
  const venta = { id: "v_gallego", contactoId: "lea_gallego", contactoNombre: "Andres Gallego", estado: "activa", fecha: DIA(24), precioAcordado: 500, moneda: "USD", creadoEn: DIA(24), extra: {} } as Venta;
  const e = {
    ...base,
    leads: [{ ...base.leads[0], id: "lea_gallego", nombre: "Andres Gallego", email: "afgallegoz@gmail.com" }],
    ventas: [venta], pagos: [],
    cuotas: [{ id: "c_reserva", ventaId: "v_gallego", numero: 0, monto: 50, vence: DIA(23), estado: "pendiente", esReserva: true }],
  } as unknown as EstadoApp;
  const mov = { id: "m_lopez", proveedor: "stripe", procesadorId: "proc_stripe", referencia: "ch_1", monto: 50, moneda: "USD", fee: 2.5, neto: 47.5, fecha: DIA(23, 19), clienteNombre: "Andres Lopez", clienteEmail: "andreslq520@gmail.com", estado: "pendiente", origen: "api", creadoEn: DIA(23, 19) } as Movimiento;
  const ss = sugerenciasPara(e, mov);
  assert.equal(ss.length, 1, "se puede proponer (mismo monto y fecha), pero con reparo");
  assert.ok(!ss[0].motivos.includes("El nombre se parece"));
  assert.ok(ss[0].reparos.includes("El nombre no coincide"));
  assert.equal(esAutomatica(ss), false, "no se concilia solo");
});

/* ---------- La base: las dos migraciones dicen lo que la app supone ---------- */

test("las migraciones: el setter sólo por marca y un cobro de pasarela una sola vez", () => {
  const setterSql = readFileSync("supabase/setter-marca-agendas.sql", "utf8");
  assert.match(setterSql, /rol <> 'setter'/, "sólo un setter marca");
  assert.match(setterSql, /interval '45 days'/, "la misma ventana que DIAS_DE_LA_MARCA");
  assert.match(setterSql, /mes_de_cobro_cerrado\(v\.fecha\)/, "no toca ventas de un mes liquidado");
  const cobroSql = readFileSync("supabase/cobro-de-pasarela-una-vez.sql", "utf8");
  /* El mensaje tiene que empezar como los que la app muestra tal cual (store.ts → drenar). */
  assert.match(cobroSql, /raise exception 'Un pago de la pasarela se usa una sola vez/);
  assert.match(cobroSql, /after insert or update or delete on public\.pagos/);
});
