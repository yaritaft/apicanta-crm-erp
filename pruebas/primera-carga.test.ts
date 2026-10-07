import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { filasCrm, tablasDe, entraEnTabla } from "@/lib/crm";
import type { Cuota, EstadoApp, Lead, Sesion, Venta } from "@/lib/types";

/* ==================================================================
   La primera vez que se cargó cada estado, y la venta atada a su llamada
   (F2-02). Se prueba con el store de verdad (en node corre sin nube, con
   los datos de ejemplo):

   - la marca de la primera carga la escribe el store al pasar un estado de
     vacío a cargado, venga de donde venga (todos los caminos pasan por
     editarLlamadas): no se pisa al cambiarlo por otro, se borra al vaciarlo
     y deshacer la deja como estaba;
   - registrar una venta guarda de qué llamada salió (`sesionId`), la que
     dice el cierre del día o, si no, la que se infiere en ese momento;
   - el CRM ata la venta a su llamada por ese id y no por la ventana de días.
   ================================================================== */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const sesionDe = (id: string) => estado().sesiones.find((s) => s.id === id)!;
const ventaDe = (id: string) => estado().ventas.find((v) => v.id === id)!;

/* Una llamada de venta ya hecha y con estado, de la demo. */
function unaLlamada(): Sesion {
  const e = estado();
  const tablas = tablasDe(e.ajustes);
  const s = e.sesiones.find((x) => x.estado === "hecha" && x.estadoLlamada && x.leadId && tablas.some((t) => entraEnTabla(x, t)));
  assert.ok(s, "la demo trae llamadas hechas");
  return s;
}

const hace = (iso: string | undefined) => Date.now() - Date.parse(iso ?? "");

test("al cargar un estado desde cualquier camino queda la marca de la primera vez; ni cambiarlo ni vaciarlo la corren", () => {
  const { id } = unaLlamada();
  /* Una llamada de antes: cargada y sin marca. Cambiarle el estado no inventa una (no se sabe cuándo se cargó). */
  assert.equal(sesionDe(id).estadoLlamadaEn, undefined);
  acciones.editarLlamada(id, { estadoLlamada: "Seguimiento de Pago" }, "Cambiar una de antes");
  assert.equal(sesionDe(id).estadoLlamadaEn, undefined);
  /* Se vacía y se vuelve a cargar: ahí sí es la primera vez que se la ve cargada con marca. */
  acciones.editarLlamada(id, { estadoLlamada: "" }, "Vaciar");
  assert.equal(sesionDe(id).estadoLlamada, undefined);
  assert.equal(sesionDe(id).estadoLlamadaEn, undefined);

  /* De vacío a cargado: la primera vez. */
  acciones.editarLlamada(id, { estadoLlamada: "Seguimiento Nutrición" }, "Cargar");
  const primera = sesionDe(id).estadoLlamadaEn;
  assert.ok(primera && hace(primera) >= 0 && hace(primera) < 5000, "marca de ahora");

  /* Cambiarlo por otro no la corre. */
  acciones.editarLlamada(id, { estadoLlamada: "Compra Full" }, "Cambiar");
  assert.equal(sesionDe(id).estadoLlamada, "Compra Full");
  assert.equal(sesionDe(id).estadoLlamadaEn, primera);

  /* Volver a mandar el mismo estado tampoco. */
  acciones.editarLlamada(id, { estadoLlamada: "Compra Full", notas: "una nota" }, "Otra vez");
  assert.equal(sesionDe(id).estadoLlamadaEn, primera);

  /* Vaciarlo no la borra: la llamada ya se había cargado ese día (hay historia). Y volver a cargarlo tampoco la corre. */
  acciones.editarLlamada(id, { estadoLlamada: "" }, "Vaciar");
  assert.equal(sesionDe(id).estadoLlamada, undefined);
  assert.equal(sesionDe(id).estadoLlamadaEn, primera);
  acciones.editarLlamada(id, { estadoLlamada: "Seguimiento de Pago" }, "Cargar otro");
  assert.equal(sesionDe(id).estadoLlamadaEn, primera);
});

test("deshacer la primera carga saca la marca; deshacer un vaciado la deja como estaba", () => {
  const { id } = unaLlamada();
  acciones.editarLlamada(id, { estadoLlamada: "" }, "Vaciar");
  /* La primera carga, y su deshacer (el cambio de vuelta trae el estado de antes, vacío, y la marca de antes, ninguna). */
  acciones.editarLlamada(id, { estadoLlamada: "Seguimiento Nutrición" }, "Cargar");
  assert.ok(sesionDe(id).estadoLlamadaEn);
  acciones.editarLlamada(id, { estadoLlamada: "", estadoLlamadaEn: undefined }, "Deshacer");
  assert.equal(sesionDe(id).estadoLlamada, undefined);
  assert.equal(sesionDe(id).estadoLlamadaEn, undefined, "sin marca: no quedó cargada ese día");

  /* Un cambio que ya trae la marca (otra pantalla, un deshacer de un vaciado) la deja tal cual. */
  acciones.editarLlamada(id, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: "2026-09-03T15:00:00.000Z" }, "Con una marca vieja");
  assert.equal(sesionDe(id).estadoLlamadaEn, "2026-09-03T15:00:00.000Z");
  acciones.editarLlamada(id, { estadoLlamada: "" }, "Vaciar");
  assert.equal(sesionDe(id).estadoLlamadaEn, "2026-09-03T15:00:00.000Z", "vaciar no la corre");
  acciones.editarLlamada(id, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: "2026-09-03T15:00:00.000Z" }, "Deshacer el vaciado");
  assert.equal(sesionDe(id).estadoLlamadaEn, "2026-09-03T15:00:00.000Z");
});

test("el Estado Pre-Call lleva su propia marca, y las demás cosas que se cargan no marcan nada", () => {
  const { id } = unaLlamada();
  acciones.editarLlamada(id, { estadoPreCall: "" }, "Vaciar");
  assert.equal(sesionDe(id).estadoPreCallEn, undefined);
  acciones.editarLlamada(id, { estadoPreCall: "Confirmado" }, "Cargar");
  const marca = sesionDe(id).estadoPreCallEn;
  assert.ok(marca && hace(marca) < 5000);
  acciones.editarLlamada(id, { estadoPreCall: "Sin Respuesta" }, "Cambiar");
  assert.equal(sesionDe(id).estadoPreCallEn, marca);
  /* Una nota o el Pre-Call del setter no tocan las marcas de los estados. */
  const antes = sesionDe(id).estadoLlamadaEn;
  acciones.editarLlamada(id, { notas: "algo", preCall: "1° Llamada" }, "Nota");
  assert.equal(sesionDe(id).estadoLlamadaEn, antes);
  assert.equal(sesionDe(id).estadoPreCallEn, marca);
});

/* ---------- La venta guarda de qué llamada salió ---------- */

const TIPO = "Llamada de Asesoramiento - Webinar - Team";

/* Una persona nueva, con una sola llamada de venta ya hecha y sin ninguna venta. */
function personaConUnaLlamada(n: number): { s: Sesion; lead: string } {
  const lead = acciones.crear<Lead>("leads", {
    id: `lead_prueba_${n}`, nombre: `Persona ${n}`, email: `persona${n}@mail.com`, fuente: "Webinar", etapaId: estado().etapas[0].id, monto: 0, moneda: "USD",
    responsable: "", etiquetas: [], creadoEn: "2026-09-01T12:00:00.000Z", actualizadoEn: "2026-09-01T12:00:00.000Z", extra: {},
  }, `Persona ${n}`);
  const id = acciones.crear<Sesion>("sesiones", {
    id: `ses_prueba_${n}`, titulo: TIPO, tipo: TIPO, invitado: `Persona ${n}`, leadId: lead, inicia: "2026-09-10T15:00:00.000Z", duracionMin: 45,
    estado: "hecha", origen: "calendly", creadoEn: "2026-09-08T12:00:00.000Z", extra: {}, anfitrion: "Dante Barbieri",
  }, `Llamada ${n}`);
  return { s: sesionDe(id), lead };
}

const nuevaVenta = (id: string, contactoId: string, fecha: string): { venta: Venta; cuotas: Cuota[] } => ({
  venta: {
    id, contactoId, contactoNombre: "Persona de prueba", productoId: estado().productos[0].id, precioAcordado: 1000, moneda: "USD",
    excluidoMarketing: false, estado: "activa", fecha, creadoEn: fecha, extra: {}, closerId: estado().equipo.find((m) => m.rol === "closer")?.id,
  },
  cuotas: [{ id: `${id}_c1`, ventaId: id, numero: 1, monto: 1000, estado: "pendiente", esReserva: false, vence: fecha }],
});

test("al registrar una venta desde una llamada queda su id en la venta, y la llamada toma el estado de compra con su marca", () => {
  const { s, lead } = personaConUnaLlamada(1);
  assert.equal(s.estadoLlamada, undefined, "esa llamada todavía no tiene estado");
  const { venta, cuotas } = nuevaVenta("v_prueba_1", lead, new Date(Date.parse(s.inicia) + 3600_000).toISOString());
  acciones.registrarVenta({ venta, cuotas, cobros: [], sesionId: s.id });
  assert.equal(ventaDe("v_prueba_1").sesionId, s.id);
  assert.equal(sesionDe(s.id).estadoLlamada, "Compra Full");
  const marca = sesionDe(s.id).estadoLlamadaEn;
  assert.ok(marca && hace(marca) < 5000, "la venta también marca cuándo se cargó el estado");
});

test("sin el id del cierre del día, la venta guarda la llamada que se infiere en ese momento", () => {
  const { s, lead } = personaConUnaLlamada(2);
  const { venta, cuotas } = nuevaVenta("v_prueba_2", lead, new Date(Date.parse(s.inicia) + 3600_000).toISOString());
  acciones.registrarVenta({ venta, cuotas, cobros: [] });
  assert.equal(ventaDe("v_prueba_2").sesionId, s.id);
  assert.equal(sesionDe(s.id).estadoLlamada, "Compra Full");
});

test("una venta de alguien sin llamadas no inventa una", () => {
  const { venta, cuotas } = nuevaVenta("v_prueba_3", "nadie", new Date().toISOString());
  acciones.registrarVenta({ venta: { ...venta, contactoId: undefined }, cuotas, cobros: [] });
  assert.equal(ventaDe("v_prueba_3").sesionId, undefined);
  /* Y un id de llamada que no existe tampoco se guarda. */
  const otra = nuevaVenta("v_prueba_4", "nadie", new Date().toISOString());
  acciones.registrarVenta({ venta: { ...otra.venta, contactoId: undefined }, cuotas: otra.cuotas, cobros: [], sesionId: "no-existe" });
  assert.equal(ventaDe("v_prueba_4").sesionId, undefined);
});

/* ---------- El CRM ata la venta a su llamada por ese id ---------- */

test("la venta que dice de qué llamada salió se ata a ésa y a ninguna otra; las de antes siguen por la ventana de días", () => {
  const dia = (d: number) => `2026-09-${String(d).padStart(2, "0")}T15:00:00.000Z`;
  const tipo = "Llamada de Asesoramiento - Webinar - Team";
  const llamada = (id: string, d: number): Sesion => ({
    id, titulo: tipo, tipo, invitado: "Ana", inicia: dia(d), duracionMin: 45, estado: "hecha", origen: "calendly", creadoEn: dia(d - 1), extra: {},
    leadId: "l1", contactoId: "l1", anfitrion: "Dante",
  }) as Sesion;
  const base = {
    sesiones: [llamada("a", 3), llamada("b", 20)], contactos: [], leads: [{ id: "l1", nombre: "Ana", email: "ana@mail.com" }], webinars: [],
    ajustes: {}, productos: [{ id: "pm", nombre: "Mentoría" }],
  };
  const v = (extra: Partial<Venta>) => ({
    id: "v1", contactoId: "l1", productoId: "pm", precioAcordado: 2400, moneda: "USD", estado: "activa", fecha: dia(22), ...extra,
  }) as Venta;
  const conVentas = (ventas: Venta[]) => filasCrm({ ...base, ventas } as unknown as Parameters<typeof filasCrm>[0]).map((f) => [f.id, f.venta?.id ?? null]);

  /* Sin el dato (las de antes): la ventana de -1/+60 días la da a las dos llamadas. */
  assert.deepEqual(conVentas([v({})]), [["a", "v1"], ["b", "v1"]]);
  /* Con el dato: sólo a la que dice. */
  assert.deepEqual(conVentas([v({ sesionId: "b" })]), [["a", null], ["b", "v1"]]);
  assert.deepEqual(conVentas([v({ sesionId: "a" })]), [["a", "v1"], ["b", null]]);
  /* Aunque la venta apunte a otra persona (los ids no siempre coinciden), si dice la llamada, es esa. */
  assert.deepEqual(conVentas([v({ sesionId: "b", contactoId: "otro" })]), [["a", null], ["b", "v1"]]);
  /* Una cancelada no cuenta. */
  assert.deepEqual(conVentas([v({ sesionId: "b", estado: "cancelada" })]), [["a", null], ["b", null]]);
});
