import test from "node:test";
import assert from "node:assert/strict";
import { COLUMNAS, filasTabla, PAISES, type FilaTabla } from "@/lib/crm-tabla";
import { filasCrm, ventaEsDeLlamada, DIAS_VENTA } from "@/lib/crm";
import { CANCELADA, CON_CIERRE, estadoVisible, NO_SE_PRESENTO, POR_VENIR, REPROGRAMO, SIN_CARGAR, SIN_CIERRE } from "@/lib/estados";
import { construirSemilla } from "@/lib/seed";
import type { Contacto, EstadoApp, Sesion, Venta } from "@/lib/types";
import { AHORA, Azar, conSemilla, DIA_MS, diaAR3, filasDeMundo, mundoAzar } from "./gen";

/* Las seis cuentas de la primera versión de las columnas; las demás (control cruzado, cobrado, quién cargó) se prueban aparte. */
const seis = (c: { total: number; conPrueba: number; sinComprobante: number; conciliados: number; sinConciliar: number; aMano: number } | null) =>
  c && { total: c.total, conPrueba: c.conPrueba, sinComprobante: c.sinComprobante, conciliados: c.conciliados, sinConciliar: c.sinConciliar, aMano: c.aMano };

/* ==================================================================
   Frente 4: filasTabla con estados raros. Nunca tira excepción, y `cobros`
   es null sólo cuando no hay venta. Además, cómo se elige la venta de cada
   llamada (la que dice haber salido de ella, o la de su ventana), la segunda
   agenda, el día del negocio y que el estado de la tabla sea el mismo que
   ve el resto de la app (estadoVisible).
   ================================================================== */

const DESENLACES = new Set<string>([CON_CIERRE, SIN_CIERRE, NO_SE_PRESENTO, REPROGRAMO, CANCELADA, SIN_CARGAR, POR_VENIR]);
const esIsoConHora = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));

const ses = (o: Partial<Sesion> & { id: string }): Sesion => ({
  titulo: "Asesoramiento", invitado: "Ana", inicia: "2026-10-01T15:00:00.000Z", duracionMin: 45, estado: "agendada",
  tipo: "Asesoramiento Hackear IT", origen: "calendly", creadoEn: "2026-09-25T12:00:00.000Z", extra: {}, ...o,
});
const contacto = (id: string, extra: Partial<Contacto> = {}): Contacto =>
  ({ id, nombre: `Persona ${id}`, email: `${id}@x.com`, creadoEn: "2026-09-01T00:00:00.000Z", extra: {}, ...extra }) as Contacto;
const venta = (o: Partial<Venta> & { id: string }): Venta => ({
  contactoNombre: "x", precioAcordado: 1000, moneda: "USD", excluidoMarketing: false, estado: "activa", fecha: "2026-10-02T15:00:00.000Z",
  creadoEn: "2026-10-02T15:00:00.000Z", extra: {}, ...o,
}) as Venta;

const semilla = construirSemilla();
const base = (sesiones: Sesion[], contactos: Contacto[], ventas: Venta[] = []) =>
  ({ sesiones, contactos, leads: [], ajustes: semilla.ajustes, webinars: [], ventas, productos: [] }) as Pick<EstadoApp, "sesiones" | "contactos" | "leads" | "ajustes" | "webinars" | "ventas" | "productos">;

/* ---------- Fuzz con estados raros ---------- */

test("filasTabla nunca tira excepción con datos raros (referencias rotas, null, fechas inválidas, ids repetidos) y cumple sus invariantes", () => {
  for (let semillaN = 1; semillaN <= 120; semillaN++) {
    const r = new Azar(semillaN);
    const mundo = mundoAzar(r, { sesiones: r.entre(0, 50), raro: true });
    let filas: FilaTabla[] = [];
    assert.doesNotThrow(() => { filas = filasTabla(mundo, AHORA); }, conSemilla(semillaN, "filasTabla tiró una excepción"));
    /* Las llamadas que entran: las de las dos tablas (asesoramiento / auditoría / resell) y no las reprogramadas. */
    const reemplazadas = new Set(mundo.sesiones.map((s) => s.reprogramadaDe).filter(Boolean));
    const entran = mundo.sesiones.filter((s) => {
      const t = s.tipo ?? "";
      if (!(/asesoramiento/i.test(t) || /auditor|resell/i.test(t))) return false;
      return !(s.estado === "cancelada" && (s.motivoCancelacion === "Reprogramada" || reemplazadas.has(s.id)));
    });
    assert.equal(filas.length, entran.length, conSemilla(semillaN, "cantidad de filas"));
    for (const f of filas) {
      const ctx = conSemilla(semillaN, `fila ${f.id}`);
      /* Cobros: null sólo si no hay venta. */
      assert.equal(f.cobros === null, !f.fila.venta, `${ctx}: cobros ${f.cobros === null ? "null" : "con valor"} y venta ${f.fila.venta ? "sí" : "no"}`);
      if (f.cobros) {
        assert.equal(f.cobros.total, f.cobros.conPrueba + f.cobros.sinComprobante, `${ctx}: total ≠ con prueba + sin comprobante`);
        assert.equal(f.cobros.total, f.cobros.conciliados + f.cobros.sinConciliar + f.cobros.aMano, `${ctx}: total ≠ conciliados + sin conciliar + a mano`);
      }
      assert.equal(f.venta !== "", Boolean(f.fila.venta), `${ctx}: texto de venta`);
      /* El estado. */
      assert.ok(DESENLACES.has(f.resultado), `${ctx}: resultado raro ${f.resultado}`);
      assert.ok(!(f.estadoLlamada && f.aviso), `${ctx}: tiene estado y aviso a la vez`);
      if (f.estadoAuto) assert.ok(f.estadoLlamada, `${ctx}: automático sin estado`);
      if (f.sinCargar) assert.equal(f.resultado, SIN_CARGAR, `${ctx}: sinCargar sin el desenlace`);
      assert.ok(["Sí", "No"].includes(f.calificada), ctx);
      assert.ok(f.tecnologias.every((x) => typeof x === "string" && x), `${ctx}: tecnologías`);
      assert.ok(f.formacion.every((x) => typeof x === "string" && x), `${ctx}: formación`);
      /* País: el cargado, o el del prefijo (uno de la lista), o nada. */
      if (f.paisCargado) assert.equal(f.pais, f.paisCargado, ctx); else assert.ok(f.pais === "" || PAISES.includes(f.pais), `${ctx}: país ${f.pais}`);
      /* El día en Argentina, calculado a mano. */
      if (esIsoConHora(f.sesion.inicia)) assert.equal(f.dia, diaAR3(Date.parse(f.sesion.inicia)), `${ctx}: día de ${f.sesion.inicia}`);
      assert.equal(typeof f.dia, "string", ctx);
      /* Toda columna se puede leer, filtrar y ordenar en cualquier fila. */
      for (const c of COLUMNAS) {
        const v = c.valores(f);
        assert.ok(Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string"), `${ctx}: valores de ${c.clave}`);
        const o = c.orden?.(f);
        assert.ok(o === undefined || typeof o === "string" || typeof o === "number", `${ctx}: orden de ${c.clave}`);
      }
    }
    /* Sin los cobros (quien sólo mira llamadas): todas null, y sin excepción. */
    const { pagos: _p, cuotas: _c, procesadores: _pr, ...sinCobros } = mundo;
    void _p; void _c; void _pr;
    assert.ok(filasTabla(sinCobros, AHORA).every((f) => f.cobros === null), conSemilla(semillaN, "sin cobros no inventa"));
  }
});

test("el estado de cada fila es el mismo que ve el resto de la app (estadoVisible): texto, aviso, color, desenlace y «sin cargar»", () => {
  for (let semillaN = 1; semillaN <= 40; semillaN++) {
    const r = new Azar(semillaN + 70);
    const mundo = mundoAzar(r, { sesiones: 60, raro: r.bool() });
    for (const f of filasTabla(mundo, AHORA)) {
      const v = estadoVisible(mundo, f.sesion, AHORA);
      const ctx = conSemilla(semillaN, `fila ${f.id}`);
      assert.equal(f.estadoLlamada || f.aviso, v.texto, ctx);
      assert.equal(f.estadoLlamada === "", v.vacio, ctx);
      assert.equal(f.resultado, v.desenlace, ctx);
      assert.equal(f.sinCargar, v.sinCargar, ctx);
      assert.equal(f.estadoAuto, v.auto && !v.vacio, ctx);
    }
  }
});

/* ---------- Casos armados a mano ---------- */

test("una llamada sin contacto, sin lead, sin mail ni nombre es una fila con persona vacía, no una excepción", () => {
  const s = ses({ id: "huerfana", invitado: "", email: undefined, contactoId: undefined, leadId: undefined });
  const [f] = filasTabla({ ...base([s], []), pagos: [], cuotas: [], procesadores: [] }, AHORA);
  assert.equal(f.nombre, "");
  assert.equal(f.personaId, "huerfana", "sin persona, la llamada es su propia persona");
  assert.deepEqual(f.cobros, null);
  assert.equal(f.email, "");
  assert.equal(f.telefono, "");
  assert.equal(f.pais, "");
  assert.equal(f.calificada, "No");
});

test("dos llamadas sin ningún dato de la persona no se toman por segundas agendas una de la otra", () => {
  const a = ses({ id: "a", invitado: "", email: undefined, creadoEn: "2026-09-20T12:00:00.000Z" });
  const b = ses({ id: "b", invitado: "", email: undefined, creadoEn: "2026-09-21T12:00:00.000Z" });
  const filas = filasTabla(base([a, b], []), AHORA);
  assert.deepEqual(filas.map((f) => f.fila.estadoAuto), [false, false]);
});

test("ventas con la llamada de otra persona, de una llamada que no existe, canceladas o reembolsadas: sin excepción y sin cobros inventados", () => {
  const c = contacto("c1");
  const s = ses({ id: "s1", contactoId: "c1" });
  const ventas = [
    venta({ id: "v_otra", sesionId: "s_que_no_existe", contactoId: "c1" }),
    venta({ id: "v_cancelada", sesionId: "s1", contactoId: "c1", estado: "cancelada" }),
  ];
  const e = { ...base([s], [c], ventas), pagos: [], cuotas: [{ id: "q1", ventaId: "v_otra" }, { id: "q2", ventaId: "v_cancelada" }] as EstadoApp["cuotas"], procesadores: [] };
  const [f] = filasTabla(e, AHORA);
  assert.equal(f.fila.venta, undefined, "ni la que apunta a otra llamada ni la cancelada son la venta de esta llamada");
  assert.equal(f.cobros, null);
  assert.equal(f.venta, "");
  /* Una reembolsada sola sí se muestra (hay que mirar sus cobros), y con un cobro sin comprobante, falta. */
  const e2 = { ...e, ventas: [venta({ id: "v_reem", sesionId: "s1", contactoId: "c1", estado: "reembolsada" })], cuotas: [{ id: "q3", ventaId: "v_reem" }] as EstadoApp["cuotas"],
    pagos: [{ id: "p1", cuotaId: "q3", procesadorId: "financiera" }] as EstadoApp["pagos"], procesadores: [{ id: "financiera" }] as EstadoApp["procesadores"] };
  const [g] = filasTabla(e2, AHORA);
  assert.equal(g.fila.venta?.id, "v_reem");
  assert.deepEqual(seis(g.cobros), { total: 1, conPrueba: 0, sinComprobante: 1, conciliados: 0, sinConciliar: 0, aMano: 1 });
});

test("cuotas huérfanas, pagos sin cuota, con cuota de una venta que no existe o con un procesador que no existe no rompen ni se cuelgan de ninguna llamada", () => {
  const c = contacto("c1");
  const s = ses({ id: "s1", contactoId: "c1" });
  const v = venta({ id: "v1", sesionId: "s1", contactoId: "c1" });
  const e = {
    ...base([s], [c], [v]),
    cuotas: [{ id: "q1", ventaId: "v1" }, { id: "q_huerfana", ventaId: "v_no_existe" }, { id: "q_sin_venta", ventaId: "" }] as EstadoApp["cuotas"],
    pagos: [
      { id: "p1", cuotaId: "q1", procesadorId: "no_existe" },
      { id: "p2", cuotaId: "q_huerfana", procesadorId: "stripe" },
      { id: "p3", cuotaId: "no_existe" }, { id: "p4", cuotaId: "" }, { id: "p5", cuotaId: undefined },
      { id: "p6", cuotaId: "q_sin_venta" },
    ] as unknown as EstadoApp["pagos"],
    procesadores: [{ id: "stripe", proveedor: "stripe" }] as EstadoApp["procesadores"],
  };
  const [f] = filasTabla(e, AHORA);
  /* Sólo el p1 es de la venta; su procesador no existe: se prueba con el comprobante («a mano»). */
  assert.deepEqual(seis(f.cobros), { total: 1, conPrueba: 0, sinComprobante: 1, conciliados: 0, sinConciliar: 0, aMano: 1 });
});

test("pagos sin lista de cuotas, de procesadores o de pagos: la llamada trae sus columnas vacías, no inventadas", () => {
  const s = ses({ id: "s1", contactoId: "c1" });
  const c = contacto("c1");
  const v = venta({ id: "v1", sesionId: "s1", contactoId: "c1" });
  for (const faltan of [["pagos"], ["cuotas"], ["procesadores"], ["pagos", "cuotas", "procesadores"]]) {
    const e = { ...base([s], [c], [v]), pagos: [], cuotas: [], procesadores: [] } as Record<string, unknown>;
    for (const k of faltan) delete e[k];
    const [f] = filasTabla(e as never, AHORA);
    assert.equal(f.cobros, null, `sin ${faltan.join(", ")}`);
    assert.equal(f.fila.venta?.id, "v1");
  }
});

test("un ciclo de reprogramaciones (A viene de B y B viene de A) o una que se reprograma a sí misma no cuelga ni rompe", () => {
  const a = ses({ id: "a", reprogramadaDe: "b", estado: "cancelada", motivoCancelacion: "Reprogramada" });
  const b = ses({ id: "b", reprogramadaDe: "a" });
  const c = ses({ id: "c", reprogramadaDe: "c" });
  const filas = filasTabla(base([a, b, c], []), AHORA);
  /* a se esconde (reprogramada); b también está en el set de «reemplazadas» pero no está cancelada; c tampoco. */
  assert.deepEqual(filas.map((f) => f.id), ["b", "c"]);
});

test("el día de la llamada es el de Argentina: justo antes y justo después de las 3 de la mañana UTC", () => {
  const casos: [string, string][] = [
    ["2026-10-02T02:59:59.999Z", "2026-10-01"], ["2026-10-02T03:00:00.000Z", "2026-10-02"], ["2026-10-01T23:59:59.999Z", "2026-10-01"],
    ["2026-10-01T00:00:00.000Z", "2026-09-30"], ["2026-12-31T23:30:00.000Z", "2026-12-31"], ["2027-01-01T02:59:00.000Z", "2026-12-31"], ["2027-01-01T03:00:00.000Z", "2027-01-01"],
    ["2026-03-01T02:30:00.000000Z", "2026-02-28"], ["2026-10-05", "2026-10-05"], ["2026-10-05T12:00:00-03:00", "2026-10-05"], ["2026-10-05T23:30:00-03:00", "2026-10-05"],
    ["2026-10-05T23:30:00+00:00", "2026-10-05"], ["2026-10-05T02:30:00+00:00", "2026-10-04"],
  ];
  for (const [inicia, dia] of casos) {
    const [f] = filasTabla(base([ses({ id: "x", inicia, creadoEn: inicia })], []), AHORA);
    assert.equal(f.dia, dia, inicia);
  }
  /* Y el oráculo por millones de instantes al azar, con el borde de las 3 UTC bien representado. */
  const r = new Azar(77);
  for (let i = 0; i < 400; i++) {
    const t = Date.UTC(2026, r.int(12), r.entre(1, 28), r.pick([0, 1, 2, 3, 4, 12, 23]), r.pick([0, 59, 30]), r.pick([0, 59]), r.pick([0, 999]));
    const [f] = filasTabla(base([ses({ id: "x", inicia: new Date(t).toISOString() })], []), AHORA);
    assert.equal(f.dia, diaAR3(t), new Date(t).toISOString());
  }
});

/* ---------- Segunda agenda ---------- */

test("segunda agenda: en cada (tabla, persona) la más vieja por fecha de agendado queda sola y las demás dicen «2da Agenda (auto)»", () => {
  for (let semillaN = 1; semillaN <= 60; semillaN++) {
    const r = new Azar(semillaN + 800);
    const sesiones: Sesion[] = [];
    const n = r.entre(2, 14);
    for (let i = 0; i < n; i++) {
      const persona = r.pick(["c1", "c2", "c3"]);
      sesiones.push(ses({
        id: `s${i}`, contactoId: r.bool(0.85) ? persona : undefined, email: `${persona}@x.com`,
        tipo: r.pick(["Asesoramiento A", "Auditoría con alumnos", "Asesoramiento B"]), estado: r.pick(["agendada", "agendada", "agendada", "no-show", "cancelada"] as const),
        creadoEn: new Date(AHORA - (i * 7 + r.int(5)) * DIA_MS - i * 1000).toISOString(), inicia: new Date(AHORA + r.entre(-30, 20) * DIA_MS).toISOString(),
        motivoCancelacion: undefined,
      }));
    }
    const filas = filasTabla(base(r.shuffle(sesiones), [contacto("c1"), contacto("c2"), contacto("c3")]), AHORA);
    const tabla = (t: string) => (/asesoramiento/i.test(t) ? "booking" : "resells");
    const grupos = new Map<string, FilaTabla[]>();
    for (const f of filas) {
      const k = `${tabla(f.sesion.tipo)}|${f.sesion.contactoId || f.sesion.email}`;
      grupos.set(k, [...(grupos.get(k) ?? []), f]);
    }
    for (const [k, fs] of grupos) {
      const porAgendo = [...fs].sort((a, b) => a.sesion.creadoEn.localeCompare(b.sesion.creadoEn));
      porAgendo.forEach((f, i) => {
        const esperado = f.sesion.estado === "no-show" ? "Inasistió" : f.sesion.estado === "cancelada" ? "Canceló (auto)" : i > 0 ? "2da Agenda (auto)" : "";
        assert.equal(f.fila.estadoLlamada, esperado, conSemilla(semillaN, `${k}: ${f.id} (agendó ${i + 1}°)`));
        assert.equal(f.fila.estadoAuto, esperado !== "", conSemilla(semillaN, `${k}: ${f.id}`));
      });
    }
  }
});

/* ---------- Qué venta es la de cada llamada ---------- */

test("la venta de una llamada: la que dice haber salido de ella (la que sigue en pie, y la más vieja) o, si ninguna lo dice, la primera de su ventana", () => {
  const D = DIA_MS;
  for (let semillaN = 1; semillaN <= 300; semillaN++) {
    const r = new Azar(semillaN + 1200);
    const creado = Date.parse("2026-09-20T12:00:00.000Z");
    const inicia = creado + r.entre(0, 15) * D;
    const s = ses({ id: "s1", contactoId: "c1", leadId: r.bool(0.3) ? "l1" : undefined, creadoEn: new Date(creado).toISOString(), inicia: new Date(inicia).toISOString() });
    const desde = creado - D, hasta = Math.max(inicia, desde) + DIAS_VENTA * D;
    const bordes = [desde - 1, desde, desde + 1, hasta - 1, hasta, hasta + 1, creado, inicia, hasta + 10 * D, desde - 30 * D];
    const ventas: Venta[] = [];
    const usadas = new Set<number>();
    for (let i = r.int(6); i > 0; i--) {
      let f = r.bool(0.7) ? r.pick(bordes) : desde + r.int(hasta - desde);
      while (usadas.has(f)) f++;
      usadas.add(f);
      ventas.push(venta({
        id: `v${ventas.length}`, fecha: new Date(f).toISOString(), estado: r.pick(["activa", "activa", "reembolsada", "cancelada"] as const),
        sesionId: r.pick([undefined, undefined, "s1", "s1", "otra", "s_no_existe"]), contactoId: r.pick(["c1", "c1", "l1", "otro", undefined]),
      }));
    }
    const [fila] = filasCrm(base([s], [contacto("c1")], ventas));
    const vivas = ventas.filter((v) => v.estado !== "cancelada");
    const rango = (v: Venta) => (v.estado === "reembolsada" ? 1 : 0);
    const mejor = (xs: Venta[]) => [...xs].sort((a, b) => rango(a) - rango(b) || Date.parse(a.fecha) - Date.parse(b.fecha))[0];
    const explicitas = vivas.filter((v) => v.sesionId === "s1");
    let esperada: Venta | undefined;
    if (explicitas.length) esperada = mejor(explicitas);
    else {
      const personas = new Set(["c1", ...(s.leadId ? [s.leadId] : [])]);
      esperada = mejor(vivas.filter((v) => !v.sesionId && v.contactoId && personas.has(v.contactoId) && Date.parse(v.fecha) >= desde && Date.parse(v.fecha) <= hasta));
    }
    assert.equal(fila.venta?.id, esperada?.id, conSemilla(semillaN, `ventas: ${JSON.stringify(ventas.map((v) => [v.id, v.estado, v.sesionId, v.contactoId, v.fecha]))}`));
  }
  /* La ventana, en sus bordes, con la función que la define. */
  const c = "2026-09-20T12:00:00.000Z", i = "2026-09-25T12:00:00.000Z";
  const t = (ms: number) => new Date(ms).toISOString();
  const d = Date.parse(c) - DIA_MS, h = Date.parse(i) + DIAS_VENTA * DIA_MS;
  assert.ok(ventaEsDeLlamada({ creadoEn: c, inicia: i }, t(d)));
  assert.ok(!ventaEsDeLlamada({ creadoEn: c, inicia: i }, t(d - 1)));
  assert.ok(ventaEsDeLlamada({ creadoEn: c, inicia: i }, t(h)));
  assert.ok(!ventaEsDeLlamada({ creadoEn: c, inicia: i }, t(h + 1)));
});

test("el orden en que llegan las ventas no cambia cuál es la de la llamada (con fechas distintas)", () => {
  for (let semillaN = 1; semillaN <= 100; semillaN++) {
    const r = new Azar(semillaN + 1700);
    const s = ses({ id: "s1", contactoId: "c1" });
    const ventas = Array.from({ length: r.entre(2, 6) }, (_, i) => venta({
      id: `v${i}`, fecha: new Date(Date.parse("2026-09-26T12:00:00.000Z") + i * 3600_000 * 7).toISOString(),
      estado: r.pick(["activa", "reembolsada"] as const), sesionId: r.pick([undefined, "s1"]), contactoId: "c1",
    }));
    const a = filasCrm(base([s], [contacto("c1")], ventas))[0].venta?.id;
    const b = filasCrm(base([{ ...s }], [contacto("c1")], r.shuffle(ventas)))[0].venta?.id;
    /* Entre las que dicen salir de la llamada ganan siempre; si ninguna lo dice, la primera de la persona. */
    assert.equal(a, b, conSemilla(semillaN, "cambió con el orden de las ventas"));
  }
});

/* ---------- Un hallazgo de la memoria de filasCrm ---------- */

test("BUG: la fila recuerda la fecha de su venta: si se corrige la fecha de la venta (mismo id y mismo texto), la llamada sigue mostrando la vieja", () => {
  /* filasCrm reusa la fila de una agenda mientras no cambie la agenda, su persona, la tabla, ajustes ni webinars, y
     compara de la venta sólo `id` y `texto` (producto · monto). `VentaDeFila.fecha` no entra en la comparación y se
     muestra en la ficha del registro del CRM («Venta cargada: … · {fecha}»). */
  const s = ses({ id: "s1", contactoId: "c1" });
  const c = contacto("c1");
  const antes = venta({ id: "v1", sesionId: "s1", contactoId: "c1", fecha: "2026-10-02T15:00:00.000Z" });
  const despues = { ...antes, fecha: "2026-10-04T15:00:00.000Z" };
  const e1 = base([s], [c], [antes]);
  assert.equal(filasCrm(e1)[0].venta?.fecha, "2026-10-02T15:00:00.000Z");
  /* La venta se edita (el store reemplaza la venta, no la agenda). */
  const e2 = { ...e1, ventas: [despues] };
  assert.equal(filasCrm(e2)[0].venta?.fecha, "2026-10-04T15:00:00.000Z", "la fila quedó con la fecha de antes");
});

test("variante sana de lo anterior: si cambia el monto o el producto de la venta, la fila sí se vuelve a armar", () => {
  const s = ses({ id: "s1", contactoId: "c1" });
  const c = contacto("c1");
  const v1 = venta({ id: "v1", sesionId: "s1", contactoId: "c1", precioAcordado: 1000 });
  const e1 = base([s], [c], [v1]);
  const a = filasCrm(e1)[0];
  const b = filasCrm({ ...e1, ventas: [{ ...v1, precioAcordado: 2000 }] })[0];
  assert.notEqual(a.venta?.texto, b.venta?.texto);
});

/* ---------- Un mundo grande sin datos raros: coherencia de toda la tabla ---------- */

test("en un mundo normal, cada llamada con venta trae cobros y cada llamada sin venta no", () => {
  for (let semillaN = 1; semillaN <= 25; semillaN++) {
    const r = new Azar(semillaN + 3100);
    const { filas } = filasDeMundo(r, { sesiones: 90, ventas: 60, pagos: 120 });
    assert.ok(filas.some((f) => f.cobros), conSemilla(semillaN, "el generador no armó ninguna llamada con venta"));
    for (const f of filas) assert.equal(f.cobros === null, !f.fila.venta, conSemilla(semillaN, f.id));
  }
});
