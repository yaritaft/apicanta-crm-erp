import test from "node:test";
import assert from "node:assert/strict";
import { CLAVE_OUTBOARDING_FP, bajaResuelta, pedidosDeBaja, pideLaBaja, queFaltaDeLaBaja, type OutboardingHecho } from "@/lib/bajas-falta-de-pago";
import { pasarBajasPorFaltaDePago } from "@/lib/bajas-falta-de-pago-servidor";
import { panelDeServicio } from "@/lib/panel-servicio";
import { CONFIG_POR_DEFECTO, seguimientoVacio } from "@/lib/seguimiento";
import type { Cuota, EstadoApp, SeguimientoAlumno, Venta } from "@/lib/types";

/* Liliana, 23/11: «necesito que la app sí o sí me avise cuando el closer pone "darlo de baja por falta de pago"; si el alumno está
   automatizado, que se realice automáticamente el outboarding; si es un alumno viejo, lo hago a mano. Para ambos casos, que me avise».
   La marca quedaba en la cuota y sólo la veía Finanzas: Mariano la pidió para dos alumnos el 03/11 y nadie de Servicio se enteró. */

const marca = (estado: "baja" | "contactado" | "no-responde", en: string, por = "Mariano Arias", nota?: string) => ({ estado, por, en, ...(nota ? { nota } : {}) });
const cuota = (id: string, ventaId: string, c: Partial<Cuota> = {}): Cuota =>
  ({ id, ventaId, numero: 2, monto: 1000, vence: "2026-10-14T15:00:00.000Z", estado: "pendiente", esReserva: false, ...c }) as Cuota;
const venta = (id: string, v: Partial<Venta> = {}): Venta =>
  ({ id, contactoId: `lead_${id}`, contactoNombre: `Cliente ${id}`, productoId: "prod_it", estado: "activa", moneda: "USD", precioAcordado: 3000, extra: {}, ...v }) as Venta;

test("una cuota pide la baja si está marcada, la venta sigue activa y no se terminó de pagar (la incobrable también)", () => {
  const c = cuota("c1", "v1", { seguimientoCobro: marca("baja", "2026-11-03T13:30:00.000Z") });
  assert.equal(pideLaBaja(c, venta("v1"), 0), true);
  assert.equal(pideLaBaja(c, venta("v1"), 400), true, "a medio pagar, sigue");
  assert.equal(pideLaBaja(c, venta("v1"), 1000), false, "pagó: el pedido se cae solo");
  assert.equal(pideLaBaja(cuota("c1", "v1", { estado: "cancelada", seguimientoCobro: c.seguimientoCobro }), venta("v1"), 0), true, "dada por incobrable: no pagó, sigue pidiendo la baja");
  assert.equal(pideLaBaja(c, venta("v1", { estado: "cancelada" }), 0), false, "la venta se canceló: ya es otra cosa");
  assert.equal(pideLaBaja({ ...c, seguimientoCobro: marca("no-responde", "2026-11-03T13:30:00.000Z") }, venta("v1"), 0), false);
});

test("los pedidos van uno por venta (dos cuotas marcadas son un pedido), con quién y cuándo lo pidió primero", () => {
  const e = {
    ventas: [venta("alex"), venta("pago"), venta("otro")],
    cuotas: [
      cuota("a3", "alex", { numero: 3, monto: 1099.86, vence: "2026-10-14T15:00:00.000Z", seguimientoCobro: marca("baja", "2026-11-03T13:30:00.000Z") }),
      cuota("a2", "alex", { numero: 2, monto: 1099.85, vence: "2026-09-14T15:00:00.000Z", seguimientoCobro: marca("baja", "2026-11-03T13:35:00.000Z", "Mariano Arias", "no contesta") }),
      cuota("p1", "pago", { seguimientoCobro: marca("baja", "2026-11-01T10:00:00.000Z") }),
      cuota("o1", "otro", { seguimientoCobro: marca("contactado", "2026-11-01T10:00:00.000Z") }),
    ],
    pagos: [{ id: "pg1", cuotaId: "p1", monto: 1000, fecha: "2026-11-05T10:00:00.000Z" }],
  } as unknown as EstadoApp;
  const p = pedidosDeBaja(e);
  assert.equal(p.length, 1, "la que pagó y la que sólo está «contactado» no piden nada");
  assert.equal(p[0].venta.id, "alex");
  assert.deepEqual(p[0].cuotas.map((c) => c.numero), [2, 3], "la que vencía antes primero");
  assert.equal(p[0].pidio, "Mariano Arias");
  assert.equal(p[0].en, "2026-11-03T13:30:00.000Z", "la primera marca");
  assert.equal(p[0].nota, "no contesta");
  assert.equal(p[0].debe, 2199.71);
  assert.equal(p[0].hecho, null);
});

test("qué le toca a Servicio, en una línea", () => {
  assert.equal(queFaltaDeLaBaja(null), "Outboarding a mano (sus accesos no son de la app)");
  const todo: OutboardingHecho = { dia: "2026-11-23", en: "2026-11-23T17:25:00.000Z", pidio: "Mariano Arias", quitados: ["Wisboo", "Telegram", "Zoom"], aMano: [], fallaron: [] };
  assert.equal(queFaltaDeLaBaja(todo), "Le sacamos solos Wisboo, Telegram y Zoom: revisá y pasalo a Outboarding");
  assert.equal(queFaltaDeLaBaja({ ...todo, quitados: ["Telegram"], aMano: ["Wisboo", "Zoom"] }), "Le sacamos solos Telegram; falta a mano: Wisboo y Zoom");
  assert.equal(queFaltaDeLaBaja({ ...todo, quitados: [], aMano: [], fallaron: ["General"] }), "Outboarding a mano: General", "no se pudo sacar nada");
  assert.equal(bajaResuelta("OUTBOARDING"), true);
  assert.equal(bajaResuelta("Outbording"), true, "como venía del Airtable");
  assert.equal(bajaResuelta("RESERVA", "baja"), true, "el alumno ya está de baja");
  assert.equal(bajaResuelta("No contesta", "activo"), false);
});

/* ---------- El panel de Lili ---------- */

const HOY = "2026-11-23";
const AHORA = new Date("2026-11-23T18:00:00.000Z");
const alumno = (id: string, nombre: string, ventaId: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, email: `${id}@mail.com`, estado: "activo", inicio: "2026-09-01T12:00:00.000Z", cohorte: "", plan: "", extra: {}, ventaId, leadId: `lead_${ventaId}`, ...extra,
});
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), ...c });

function estadoPanel(): EstadoApp {
  return {
    ajustes: {}, leads: [], contactos: [], equipo: [], etapasServicio: [], reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [],
    productos: [{ id: "prod_it", nombre: "Hackear IT" }, { id: "prod_ai", nombre: "Hackear AI" }],
    alumnos: [alumno("alu_fran", "Carla Medina", "fran"), alumno("alu_alex", "Diego Soler", "alex"), alumno("alu_jorge", "Bruno Ibáñez", "jorge")],
    seguimientos: [seg("alu_fran", { followUp: "RESERVA" }), seg("alu_alex", { followUp: "OUTBOARDING" }), seg("alu_jorge", { followUp: "MAS ENTREVISTAS" })],
    ventas: [
      venta("fran", { productoId: "prod_ai" }), venta("alex"),
      venta("jorge", { productoId: "prod_ai", extra: { [CLAVE_OUTBOARDING_FP]: { j3: { dia: HOY, en: "2026-11-23T17:25:00.000Z", pidio: "Mariano Arias", quitados: ["Telegram"], aMano: ["Wisboo", "Zoom"], fallaron: [] } } } }),
      venta("sinficha", { contactoNombre: "Pedro Sin Ficha" }),
    ],
    cuotas: [
      cuota("f1", "fran", { numero: 1, monto: 2400, seguimientoCobro: marca("baja", "2026-11-03T13:35:00.000Z") }),
      cuota("a2", "alex", { seguimientoCobro: marca("baja", "2026-11-03T13:35:00.000Z") }),
      cuota("j3", "jorge", { numero: 3, monto: 449.08, seguimientoCobro: marca("baja", "2026-11-23T17:02:00.000Z") }),
      cuota("s1", "sinficha", { numero: 1, monto: 400, seguimientoCobro: marca("baja", "2026-10-29T18:48:00.000Z", "Dante Barbieri") }),
    ],
    pagos: [],
  } as unknown as EstadoApp;
}

test("el panel de Lili: «Bajas por falta de pago» arriba de todo, hasta que lo pasa a Outboarding", () => {
  const p = panelDeServicio(estadoPanel(), HOY, AHORA);
  assert.equal(p.secciones[0].id, "bajas", "lo primero de «Para hoy»");
  const b = p.secciones[0];
  assert.deepEqual(b.items.map((i) => i.nombre), ["Pedro Sin Ficha", "Carla Medina", "Bruno Ibáñez"], "el más viejo primero; Alex ya está en Outboarding");
  const fran = b.items.find((i) => i.alumnoId === "alu_fran")!;
  assert.equal(fran.detalle, "Outboarding a mano (sus accesos no son de la app) · lo pidió Mariano Arias el 3 nov · no pagó la cuota 1 de Hackear AI (US$ 2.400)");
  assert.equal(fran.tono, "rojo", "hace 20 días");
  assert.equal(fran.cuando, "hace 20 d");
  const jorge = b.items.find((i) => i.alumnoId === "alu_jorge")!;
  assert.match(jorge.detalle, /^Le sacamos solos Telegram; falta a mano: Wisboo y Zoom · lo pidió Mariano Arias el 23 nov · /, "lo que hizo la pasada automática, primero");
  assert.equal(jorge.tono, "ambar", "lo pidieron hoy: todavía a tiempo");
  const pedro = b.items.find((i) => i.nombre === "Pedro Sin Ficha")!;
  assert.equal(pedro.alumnoId, undefined);
  assert.match(pedro.detalle, /^Sin ficha de alumno: outboarding a mano · lo pidió Dante Barbieri el 29 oct · no pagó la cuota 1/);
  assert.equal(b.rojos, 2);
});

/* ---------- La pasada automática ---------- */

/* Una base de mentira: filtra en memoria lo que pide la pasada (también `seguimientoCobro->>estado`) y anota lo que escribe. */
function base(tablas: Record<string, Record<string, unknown>[]>) {
  const escritos: { tabla: string; op: string; filas: unknown; donde?: unknown }[] = [];
  const valor = (f: Record<string, unknown>, c: string) => {
    const [col, clave] = c.split("->>");
    const v = f[col];
    return clave ? (v as Record<string, unknown> | null)?.[clave] : v;
  };
  return {
    escritos, tablas,
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      let cambios: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        in: (c: string, v: unknown[]) => { filas = filas.filter((f) => v.includes(valor(f, c))); return q; },
        eq: (c: string, v: unknown) => {
          filas = filas.filter((f) => valor(f, c) === v);
          if (cambios) {
            for (const f of filas) Object.assign(f, cambios);
            escritos.push({ tabla, op: "update", filas: cambios, donde: v });
            return Promise.resolve({ error: null });
          }
          return q;
        },
        or: () => q,
        maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
        update: (c: Record<string, unknown>) => { cambios = c; return q; },
        insert: (f: unknown) => { escritos.push({ tabla, op: "insert", filas: f }); return Promise.resolve({ error: null }); },
        upsert: (f: unknown) => { escritos.push({ tabla, op: "upsert", filas: f }); return Promise.resolve({ error: null }); },
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok, mal),
      };
      return q;
    },
  };
}

function baseDeLaPasada() {
  return base({
    cuotas: [
      { id: "c_auto", ventaId: "v_auto", numero: 2, esReserva: false, monto: 200, vence: "2026-09-05T15:00:00.000Z", seguimientoCobro: marca("baja", "2026-11-23T17:01:00.000Z") },
      { id: "c_viejo", ventaId: "v_viejo", numero: 3, esReserva: false, monto: 449, vence: "2026-09-07T15:00:00.000Z", seguimientoCobro: marca("baja", "2026-11-23T17:02:00.000Z") },
      { id: "c_pago", ventaId: "v_pago", numero: 1, esReserva: false, monto: 300, vence: "2026-09-07T15:00:00.000Z", seguimientoCobro: marca("baja", "2026-11-20T10:00:00.000Z") },
    ],
    pagos: [{ cuotaId: "c_pago", monto: 300 }],
    ventas: [
      { id: "v_auto", estado: "activa", contactoId: "lead_auto", contactoNombre: "Tomás Auto", extra: { otraCosa: 1 } },
      { id: "v_viejo", estado: "activa", contactoId: "lead_viejo", contactoNombre: "Bruno Viejo", extra: {} },
      { id: "v_pago", estado: "activa", contactoId: "lead_pago", contactoNombre: "Pagó Después", extra: {} },
    ],
    alumnos: [
      { id: "alu_auto", nombre: "Tomás Auto", ventaId: null, leadId: "lead_auto", estado: "activo" },
      { id: "alu_viejo", nombre: "Bruno Viejo", ventaId: "v_viejo", leadId: "lead_viejo", estado: "activo" },
      { id: "alu_pago", nombre: "Pagó Después", ventaId: "v_pago", leadId: "lead_pago", estado: "activo" },
    ],
    accesos_alumno: [
      { alumnoId: "alu_auto", estado: "dado" },
      { alumnoId: "alu_pago", estado: "dado" },
    ],
    equipo: [{ email: " Liliana@Apicanta.com ", activo: true }],
  });
}

const quitarDeMentira = (llamados: string[]) => (async (_db: unknown, a: { alumnoId: string; quien: string }) => {
  llamados.push(`${a.alumnoId}:${a.quien}`);
  return {
    quitados: 2, fallaron: 1,
    accesos: [
      { plataforma: "telegram", estado: "quitado", error: null, recurso: "-100", recursoNombre: "General" },
      { plataforma: "wisboo", estado: "quitado", error: null, recurso: "w1", recursoNombre: "Hackear AI" },
      { plataforma: "zoom", estado: "dado", error: "Zoom no canceló la inscripción (contestó 500).", recurso: "z1", recursoNombre: "Mentoría martes" },
    ],
  };
}) as unknown as Parameters<typeof pasarBajasPorFaltaDePago>[2];

test("la pasada le saca los accesos de la app a quien le pidieron la baja; al alumno viejo y al que pagó no los toca", async () => {
  const db = baseDeLaPasada();
  const llamados: string[] = [];
  const r = await pasarBajasPorFaltaDePago(db as never, new Date("2026-11-23T17:25:00.000Z"), quitarDeMentira(llamados));
  assert.deepEqual(llamados, ["alu_auto:Baja por falta de pago (la pidió Mariano Arias)"], "sólo el que tiene accesos de la app (se lo encuentra por el lead)");
  assert.equal(r.pedidos, 2, "el que pagó ya no pide nada");
  assert.deepEqual(r.hechos, [{ alumnoId: "alu_auto", ventaId: "v_auto", quitados: 2, fallaron: 1 }]);

  const v = db.tablas.ventas.find((x) => x.id === "v_auto")!;
  const extra = v.extra as Record<string, unknown>;
  assert.equal(extra.otraCosa, 1, "no pisa lo que había en la venta");
  const hecho = (extra[CLAVE_OUTBOARDING_FP] as Record<string, OutboardingHecho>).c_auto;
  assert.deepEqual({ quitados: hecho.quitados, aMano: hecho.aMano, fallaron: hecho.fallaron, pidio: hecho.pidio, dia: hecho.dia },
    { quitados: ["Telegram", "Wisboo"], aMano: [], fallaron: ["Mentoría martes"], pidio: "Mariano Arias", dia: "2026-11-23" });

  const avisos = db.escritos.filter((x) => x.tabla === "avisos").flatMap((x) => x.filas as Record<string, unknown>[]);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].para, "liliana@apicanta.com");
  assert.equal(avisos[0].titulo, "Baja de Tomás Auto: falta sacar algo a mano");
  assert.equal(avisos[0].contactoId, "lead_auto", "abre su ficha");
  assert.match(String(avisos[0].cuerpo), /^Mariano Arias pidió la baja por falta de pago: le sacamos 2 accesos de la app \(Telegram y Wisboo\)\./);
  assert.match(String(avisos[0].cuerpo), /No se pudo sacar: Mentoría martes\./);
  assert.match(String(avisos[0].cuerpo), /pasalo a Outboarding/);
  const act = db.escritos.filter((x) => x.tabla === "actividad").flatMap((x) => [x.filas as Record<string, unknown>]);
  assert.equal(act.length, 1, "queda en la historia de la venta");
  assert.equal(act[0].entidadId, "v_auto");

  /* La pasada siguiente (o si Lili le vuelve a dar accesos): no se repite. */
  const otra: string[] = [];
  await pasarBajasPorFaltaDePago(db as never, new Date("2026-11-23T18:25:00.000Z"), quitarDeMentira(otra));
  assert.deepEqual(otra, [], "una vez por cuota");
});

test("sin cuotas marcadas no lee nada más; un alumno ya dado de baja no se toca", async () => {
  const vacia = base({ cuotas: [] });
  const r = await pasarBajasPorFaltaDePago(vacia as never, new Date(), (async () => { throw new Error("no"); }) as never);
  assert.deepEqual(r, { pedidos: 0, hechos: [] });

  const db = baseDeLaPasada();
  db.tablas.alumnos.find((a) => a.id === "alu_auto")!.estado = "baja";
  const llamados: string[] = [];
  await pasarBajasPorFaltaDePago(db as never, new Date("2026-11-23T17:25:00.000Z"), quitarDeMentira(llamados));
  assert.deepEqual(llamados, []);
});
