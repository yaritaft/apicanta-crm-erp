import test from "node:test";
import assert from "node:assert/strict";
import { deudaVencida, followUpAlVolver, followUpsParaVolver, pedidoDeReanudar, problemaParaReanudar, DIAS_PARA_REANUDAR } from "@/lib/reanudar-accesos";
import { ErrorReanudar, pasarReanudaciones, reanudarAlumno } from "@/lib/reanudar-accesos-servidor";
import { mensajeDeVuelta } from "@/lib/accesos-alumnos";
import { hojaDelAviso } from "@/lib/avisos";
import { panelDeServicio } from "@/lib/panel-servicio";
import { CONFIG_POR_DEFECTO, seguimientoVacio } from "@/lib/seguimiento";
import type { Programa } from "@/lib/programas";
import type { Cuota, EstadoApp, SeguimientoAlumno, Venta } from "@/lib/types";

/* Liliana, 27/11: «El 20/11 se hizo el outboarding por falta de pago. Ayer se cargó la 2da cuota. Tendríamos que tener una opción de
   "reanudar accesos", porque tenemos que volver a darle accesos. La app debería notificarme cuando reanude para enviarle mensaje».
   La baja por falta de pago era de un solo lado: el pago no traía al alumno de vuelta y nadie se enteraba. (Nombres inventados.) */

const AHORA = new Date("2026-11-27T23:00:00.000Z");
const HOY = "2026-11-27";
const venta = (id: string, v: Partial<Venta> = {}): Venta =>
  ({ id, contactoId: `lead_${id}`, contactoNombre: `Cliente ${id}`, productoId: "prod_ai", estado: "activa", moneda: "USD", precioAcordado: 3000, closerId: "eq_closer", extra: {}, ...v }) as Venta;
const cuota = (id: string, ventaId: string, numero: number, vence: string, estado: Cuota["estado"] = "pendiente", c: Partial<Cuota> = {}): Cuota =>
  ({ id, ventaId, numero, monto: 1000, vence: `${vence}T15:00:00+00:00`, estado, esReserva: false, ...c }) as Cuota;
const pago = (id: string, cuotaId: string, creadoEn: string, monto = 1000) => ({ id, cuotaId, monto, creadoEn, fecha: creadoEn });

/* El caso: 3 cuotas de 1.000; la 2 vencía el 31/10 y se cargó el 26/11, la 3 vence el 15/12. Outboarding desde el 20/11. */
const cuotasDelCaso = () => [
  cuota("c1", "v1", 1, "2026-10-01", "pagada"),
  cuota("c2", "v1", 2, "2026-10-31", "pagada"),
  cuota("c3", "v1", 3, "2026-12-15"),
];
const pagosDelCaso = () => [pago("p1", "c1", "2026-10-01T15:00:00+00:00"), pago("p2", "c2", "2026-11-26T14:39:41+00:00")];
const caso = (x: Partial<Parameters<typeof pedidoDeReanudar>[0]> = {}) => pedidoDeReanudar({
  followUp: "Outboarding", estadoAlumno: "baja", venta: venta("v1"), cuotas: cuotasDelCaso(), pagos: pagosDelCaso(), fin: "2027-01-02", ahora: AHORA, ...x,
});

test("pide que lo reanuden: estaba en Outboarding, pagó la cuota atrasada y ya no debe nada vencido", () => {
  const p = caso();
  assert.ok(p);
  assert.equal(p.cuota.numero, 2);
  assert.equal(p.pago.id, "p2");
  assert.equal(p.pagoEl, "2026-11-26");
  assert.equal(p.vencia, "2026-10-31");
  assert.ok(caso({ followUp: "Avanzando", estadoAlumno: "baja" }), "de baja con otro Follow Up también está afuera");
  assert.ok(caso({ fin: null }), "sin fin conocido, puede volver");
});

test("no pide nada si no se fue por falta de pago o no está al día", () => {
  assert.equal(caso({ followUp: "Avanzando", estadoAlumno: "activo" }), null, "ya está adentro");
  assert.equal(caso({ venta: venta("v1", { estado: "reembolsada" }) }), null, "la baja es de la venta");
  assert.equal(caso({ fin: "2026-11-20" }), null, "su programa ya terminó: es un egresado que pagó tarde, no vuelve");
  /* Pagó la 2 pero la 3 también venció y no la pagó. */
  assert.equal(caso({ ahora: new Date("2026-12-20T15:00:00.000Z") }), null, "todavía debe una vencida");
  /* Pagó en fecha: nunca estuvo atrasado (como el que dijo que no renueva y está en Outboarding antes de terminar). */
  assert.equal(caso({ pagos: [pago("p1", "c1", "2026-10-01T15:00:00+00:00"), pago("p2", "c2", "2026-10-30T12:00:00+00:00")] }), null);
  /* El pago atrasado fue hace más de 30 días: ya se entiende que no vuelve. */
  assert.equal(caso({ ahora: new Date(new Date("2026-11-26T15:00:00Z").getTime() + (DIAS_PARA_REANUDAR + 2) * 86_400_000), cuotas: cuotasDelCaso().slice(0, 2) }), null);
  /* Un reembolso (monto negativo) no es un pago. */
  assert.equal(caso({ pagos: [pago("p1", "c1", "2026-10-01T15:00:00+00:00"), pago("p2", "c2", "2026-10-30T12:00:00+00:00"), pago("r1", "c2", "2026-11-26T12:00:00+00:00", -1000)] }), null);
});

test("lo que debe vencido es la cuenta de las cuotas vencidas (pendiente, vencida y con saldo)", () => {
  const cs = [cuota("a", "v", 1, "2026-10-01"), cuota("b", "v", 2, "2026-11-01", "cancelada"), cuota("c", "v", 3, "2026-12-30")];
  assert.equal(deudaVencida(cs, [pago("x", "a", "2026-10-05T00:00:00Z", 400)], AHORA), 600, "a medio pagar cuenta el saldo; la cancelada y la que no venció, no");
  assert.equal(deudaVencida(cs, [pago("x", "a", "2026-10-05T00:00:00Z", 1000)], AHORA), 0);
});

test("el botón: se puede reanudar a quien está afuera y no terminó; las fechas no se tocan", () => {
  const base = { followUp: "Outboarding", estadoAlumno: "baja", venta: venta("v1"), fin: "2027-01-02", hoy: HOY };
  assert.equal(problemaParaReanudar(base), null);
  assert.match(problemaParaReanudar({ ...base, followUp: "Módulo 3", estadoAlumno: "activo" })!, /Ya está activo/);
  assert.match(problemaParaReanudar({ ...base, venta: venta("v1", { estado: "cancelada" }) })!, /esa baja es de la venta/);
  assert.match(problemaParaReanudar({ ...base, fin: "2026-11-01" })!, /terminó el 01\/11\/2026: para volver tiene que renovar/);
  assert.equal(problemaParaReanudar({ ...base, venta: null }), null, "sin venta enlazada igual se puede");
});

test("el Follow Up con el que vuelve: el elegido de la lista, nunca Outboarding ni Reserva", () => {
  const lista = ["Onboarding", "Módulo 3", "Avanzando", "Outboarding", "Reserva"];
  assert.equal(followUpAlVolver("Módulo 3", lista), "Módulo 3");
  assert.equal(followUpAlVolver("Outboarding", lista), "Avanzando");
  assert.equal(followUpAlVolver("Reserva", lista), "Avanzando");
  assert.equal(followUpAlVolver("Inventado", lista), "Avanzando");
  assert.equal(followUpAlVolver(undefined, lista), "Avanzando");
  assert.deepEqual(followUpsParaVolver(lista), ["Onboarding", "Módulo 3", "Avanzando"]);
});

test("el mensaje para mandarle cuando vuelve", () => {
  const m = mensajeDeVuelta("Tomás Ruiz", "Hackear AI", [
    { plataforma: "wisboo", nombre: "Wisboo (entrar a los cursos)", url: "https://w/x" },
    { plataforma: "telegram", nombre: "General", url: "https://t.me/+a" },
  ]);
  assert.match(m, /^¡Hola Tomás! Ya registramos tu pago y te reactivamos Hackear AI\. Te dejo tus accesos de nuevo:\n\nTus cursos/);
  assert.match(m, /Tus grupos de Telegram \(cada link es personal y se usa una sola vez\):\n• General: https:\/\/t\.me\/\+a/);
  assert.equal(mensajeDeVuelta("Tomás Ruiz", "Hackear AI", []), "¡Hola Tomás! Ya registramos tu pago y te reactivamos Hackear AI.", "sin links (accesos a mano)");
  assert.equal(hojaDelAviso("reanudar"), "accesos", "el aviso abre la ficha donde está el botón");
});

/* ---------- El panel de Lili ---------- */

const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), ...c });
const alumno = (id: string, nombre: string, ventaId: string, estado = "baja") => ({
  id, nombre, email: `${id}@mail.com`, estado, inicio: "2026-10-02T15:00:00.000Z", cohorte: "", plan: "", extra: {}, ventaId, leadId: `lead_${ventaId}`,
});

function estadoPanel(followUp = "Outboarding", estado = "baja"): EstadoApp {
  return {
    ajustes: {}, leads: [], contactos: [], equipo: [], etapasServicio: [], reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [],
    productos: [{ id: "prod_ai", nombre: "Hackear AI" }],
    alumnos: [alumno("alu_tomas", "Tomás Ruiz", "v1", estado), alumno("alu_debe", "Ana Debe", "v2")],
    seguimientos: [seg("alu_tomas", { followUp, duracionMeses: 3 }), seg("alu_debe", { followUp: "Outboarding", duracionMeses: 3 })],
    ventas: [venta("v1"), venta("v2")],
    cuotas: [...cuotasDelCaso(), cuota("d1", "v2", 1, "2026-10-01", "pagada"), cuota("d2", "v2", 2, "2026-10-31")],
    pagos: [...pagosDelCaso(), pago("q1", "d1", "2026-11-25T12:00:00Z")],
  } as unknown as EstadoApp;
}

test("el panel de Lili: «Pagaron estando afuera», hasta que lo reanuda", () => {
  const p = panelDeServicio(estadoPanel(), HOY, AHORA);
  assert.deepEqual(p.secciones.slice(0, 2).map((s) => s.id), ["bajas", "reanudar"], "justo después de las bajas");
  const r = p.secciones[1];
  assert.deepEqual(r.items.map((i) => i.nombre), ["Tomás Ruiz"], "la que pagó tarde la 1 pero debe la 2 no está");
  assert.equal(r.items[0].detalle, "Reanudale los accesos · pagó la cuota 2 el 26 nov (vencía el 31 oct) y ya no debe nada vencido · está en Outboarding");
  assert.equal(r.items[0].tono, "ambar", "pagó ayer");
  /* Lo reanudó: vuelve a cursar y sale de la lista. */
  assert.equal(panelDeServicio(estadoPanel("Avanzando", "activo"), HOY, AHORA).secciones[1].items.length, 0);
});

/* ---------- Reanudar, contra una base de mentira ---------- */

type Fila = Record<string, unknown>;
function base(tablas: Record<string, Fila[]>) {
  const escritos: { tabla: string; op: string; filas: unknown; donde?: [string, unknown][] }[] = [];
  return {
    escritos, tablas,
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      let cambios: Fila | null = null;
      const donde: [string, unknown][] = [];
      const aplicar = () => {
        if (!cambios) return;
        for (const f of filas) Object.assign(f, cambios);
        escritos.push({ tabla, op: "update", filas: cambios, donde: [...donde] });
        cambios = null;
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filas = filas.filter((f) => f[c] === v); donde.push([c, v]); return q; },
        in: (c: string, v: unknown[]) => { filas = filas.filter((f) => v.includes(f[c])); return q; },
        gte: (c: string, v: string) => { filas = filas.filter((f) => String(f[c] ?? "") >= v); return q; },
        ilike: (c: string, v: string) => { filas = filas.filter((f) => String(f[c] ?? "").toLowerCase() === v.toLowerCase()); return q; },
        like: (c: string, v: string) => { const pre = v.replace(/%$/, ""); filas = filas.filter((f) => String(f[c] ?? "").startsWith(pre)); donde.push([c, v]); return q; },
        is: (c: string, v: unknown) => { filas = filas.filter((f) => (f[c] ?? null) === v); return q; },
        /* Sólo lo que usa mailsDeServicio: «col.ilike.%texto%,…». */
        or: (expr: string) => {
          const partes = expr.split(",").map((x) => x.split(".ilike."));
          filas = filas.filter((f) => partes.some(([c, v]) => String(f[c] ?? "").toLowerCase().includes(v.replace(/%/g, "").toLowerCase())));
          return q;
        },
        limit: () => q,
        maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
        update: (c: Fila) => { cambios = c; return q; },
        insert: (f: Fila) => { escritos.push({ tabla, op: "insert", filas: f }); (tablas[tabla] ??= []).push(f); return Promise.resolve({ error: null }); },
        upsert: (f: Fila[]) => { escritos.push({ tabla, op: "upsert", filas: f }); return Promise.resolve({ error: null }); },
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => { aplicar(); return Promise.resolve({ data: filas, error: null }).then(ok, mal); },
      };
      return q;
    },
  };
}

const PROGRAMA = { id: "hackear-ai", nombre: "Hackear AI", activo: true, productos: ["prod_ai"], wisboo: ["w1"], telegram: ["-100"], zoom: ["z1"] } as unknown as Programa;

function baseDelCaso() {
  return base({
    alumnos: [{ id: "alu_tomas", nombre: "Tomás Ruiz", email: "tomas@mail.com", estado: "baja", inicio: "2026-10-02T15:00:00+00:00", plan: "Mentoría", ventaId: "v1", leadId: "lead_v1" }],
    seguimiento_alumnos: [{ ...seg("alu_tomas", { followUp: "Outboarding", duracionMeses: 3, fechaEgreso: "2027-01-02", telefono: "57 300 000 0000" }), id: "seg_alu_tomas" }],
    ventas: [{ ...venta("v1"), contactoNombre: "Tomás Ruiz" }],
    cuotas: [
      ...cuotasDelCaso(),
    ].map((c): Fila => (c.id === "c2" ? { ...c, seguimientoCobro: { estado: "baja", por: "Dante Barbieri", en: "2026-11-05T12:00:00.000Z" } } : { ...c })),
    pagos: pagosDelCaso(),
    ajustes: [{ id: 1, seguimiento: null }],
    productos: [{ id: "prod_ai", nombre: "Hackear AI" }],
    equipo: [
      { id: "eq_lili", nombre: "Liliana Riveros", email: "liliana@apicanta.com", activo: true, puesto: "Customer Success" },
      { id: "eq_closer", nombre: "Dante Barbieri", email: "dante@apicanta.com", activo: true, puesto: "Closer" },
    ],
    leads: [],
    avisos: [{ id: "av_reanudar_v1_p2_abc", leidoEn: null }],
  });
}

const darDeMentira = (llamados: unknown[]) => (async (_db: unknown, a: { alumnoId: string; programa: Programa; origen: string; quien: string; persona: unknown }) => {
  llamados.push({ alumnoId: a.alumnoId, programa: a.programa.id, origen: a.origen, quien: a.quien, persona: a.persona });
  return { dados: 3, fallaron: 0, yaEstaban: 0, extendidos: 0, accesos: [], links: [{ plataforma: "telegram", nombre: "General", url: "https://t.me/+nuevo" }] };
}) as never;

test("«Reanudar accesos»: vuelve a activo, saca la marca de baja, le da los accesos y no toca las fechas", async () => {
  const db = baseDelCaso();
  const llamados: unknown[] = [];
  const r = await reanudarAlumno(db as never, {
    alumnoId: "alu_tomas", quien: "liliana@apicanta.com", quienNombre: "Liliana Riveros", followUp: "Módulo 3", darAccesos: true, programas: [PROGRAMA], ahora: AHORA,
  }, darDeMentira(llamados));

  assert.equal(r.followUp, "Módulo 3");
  assert.equal(db.tablas.seguimiento_alumnos[0].followUp, "Módulo 3");
  assert.equal(db.tablas.seguimiento_alumnos[0].fechaEgreso, "2027-01-02", "las fechas no se corren");
  assert.equal(db.tablas.alumnos[0].estado, "activo");
  assert.equal(db.tablas.alumnos[0].inicio, "2026-10-02T15:00:00+00:00", "el inicio tampoco");
  assert.equal(r.fin, "2027-01-02");
  assert.equal(r.marcasSacadas, 1);
  const c2 = db.tablas.cuotas.find((c) => c.id === "c2")!;
  assert.equal((c2.seguimientoCobro as { estado: string }).estado, "contactado", "ya no pide la baja (si no, la pasada lo volvería a poner en la lista)");
  assert.deepEqual(llamados, [{ alumnoId: "alu_tomas", programa: "hackear-ai", origen: "manual", quien: "liliana@apicanta.com", persona: { nombre: "Tomás Ruiz", email: "tomas@mail.com", telefono: "57 300 000 0000" } }]);
  assert.match(r.mensaje, /^¡Hola Tomás! Ya registramos tu pago y te reactivamos Hackear AI\. Te dejo tus accesos de nuevo:/);
  assert.match(r.mensaje, /https:\/\/t\.me\/\+nuevo/);

  const act = db.escritos.filter((x) => x.tabla === "actividad").map((x) => x.filas as Fila);
  assert.equal(act.length, 1);
  assert.equal(act[0].entidadId, "alu_tomas");
  assert.equal(act[0].actor, "Liliana Riveros");
  assert.match(String(act[0].detalle), /vuelve a activo con el Follow Up «Módulo 3»\. Accesos de Hackear AI: 3 dados\. Se sacó la marca de «Pido la baja» de 1 cuota\. Las fechas no se corren: su programa termina el 02\/01\/2027\./);

  const avisos = db.escritos.filter((x) => x.tabla === "avisos" && x.op === "upsert").flatMap((x) => x.filas as Fila[]);
  assert.deepEqual(avisos.map((a) => a.para), ["dante@apicanta.com"], "a Lili no (lo hizo ella), al closer sí");
  assert.equal(avisos[0].titulo, "Tomás Ruiz volvió al programa");
  const leidos = db.escritos.filter((x) => x.tabla === "avisos" && x.op === "update");
  assert.equal(leidos.length, 1, "el aviso de «pagó estando afuera» queda leído");
});

test("si lo reanuda otra persona, a Lili le llega el aviso para mandarle el mensaje; sin accesos de la app no llama a nadie", async () => {
  const db = baseDelCaso();
  const llamados: unknown[] = [];
  const r = await reanudarAlumno(db as never, {
    alumnoId: "alu_tomas", quien: "ceo@apicanta.com", quienNombre: "Juan Cruz Russo", darAccesos: false, programas: [PROGRAMA], ahora: AHORA,
  }, darDeMentira(llamados));
  assert.equal(r.followUp, "Avanzando", "sin elegir, sigue cursando");
  assert.deepEqual(llamados, []);
  assert.equal(r.accesos, null);
  assert.equal(r.mensaje, "¡Hola Tomás! Ya registramos tu pago y te reactivamos Hackear AI.");
  const avisos = db.escritos.filter((x) => x.tabla === "avisos" && x.op === "upsert").flatMap((x) => x.filas as Fila[]);
  assert.deepEqual(avisos.map((a) => a.para).sort(), ["dante@apicanta.com", "liliana@apicanta.com"]);
  assert.match(String(avisos.find((a) => a.para === "liliana@apicanta.com")!.titulo), /^Juan Cruz Russo le reanudó los accesos a Tomás Ruiz$/);
});

test("no se reanuda a quien ya está activo ni a quien terminó el programa (no se escribe nada)", async () => {
  const activo = baseDelCaso();
  activo.tablas.seguimiento_alumnos[0].followUp = "Módulo 2";
  activo.tablas.alumnos[0].estado = "activo";
  await assert.rejects(reanudarAlumno(activo as never, { alumnoId: "alu_tomas", quien: "x", quienNombre: "X", darAccesos: true, programas: [PROGRAMA], ahora: AHORA }, darDeMentira([])), ErrorReanudar);
  const termino = baseDelCaso();
  termino.tablas.seguimiento_alumnos[0].fechaEgreso = "2026-11-10";
  await assert.rejects(reanudarAlumno(termino as never, { alumnoId: "alu_tomas", quien: "x", quienNombre: "X", darAccesos: true, programas: [PROGRAMA], ahora: AHORA }, darDeMentira([])), /terminó el 10\/11\/2026/);
  assert.equal(activo.escritos.length + termino.escritos.length, 0);
});

/* ---------- La pasada de cada hora: el aviso ---------- */

test("la pasada le avisa a Customer Success que pagó estando afuera, una vez por pago", async () => {
  const db = baseDelCaso();
  const r = await pasarReanudaciones(db as never, AHORA);
  assert.equal(r.pagos, 1, "sólo los pagos cargados en los últimos días");
  assert.deepEqual(r.avisados, [{ alumnoId: "alu_tomas", pagoId: "p2" }]);
  const avisos = db.escritos.filter((x) => x.tabla === "avisos").flatMap((x) => x.filas as Fila[]);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].para, "liliana@apicanta.com");
  assert.equal(avisos[0].tipo, "reanudar");
  assert.equal(avisos[0].titulo, "Tomás Ruiz pagó y está en Outboarding");
  assert.equal(avisos[0].contactoId, "lead_v1", "abre su ficha");
  assert.match(String(avisos[0].id), /^av_reanudar_v1_p2_[0-9a-f]{10}$/, "un id por pago: la pasada siguiente no lo repite");
  assert.match(String(avisos[0].cuerpo), /^Se cargó la cuota 2 \(US\$ 1\.000, vencía el 31\/10\) y ya no debe nada vencido\. Si vuelve, en su ficha → Accesos tocá «Reanudar accesos»/);

  /* Ya reanudado: no avisa. */
  const vuelto = baseDelCaso();
  vuelto.tablas.seguimiento_alumnos[0].followUp = "Módulo 3";
  vuelto.tablas.alumnos[0].estado = "activo";
  assert.deepEqual((await pasarReanudaciones(vuelto as never, AHORA)).avisados, []);
  /* Todavía debe una vencida: no avisa. */
  const debe = baseDelCaso();
  debe.tablas.cuotas.push({ ...cuota("c0", "v1", 0, "2026-11-01") });
  assert.deepEqual((await pasarReanudaciones(debe as never, AHORA)).avisados, []);
});
