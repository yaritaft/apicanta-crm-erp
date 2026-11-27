import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  avisoDeLaBaja, avisoParaQuienDioDeBaja, CLAVE_SALIDA_POR_BAJA, contratoAnulable, motivoDeLaBaja, sinAccesosPorLaBaja, type SalidaPorBaja,
} from "@/lib/contratos-de-baja";
import { pasarBajasDeVentas, salidaPorBaja } from "@/lib/contratos-de-baja-servidor";
import { bajaQueFrena } from "@/lib/ventas-de-baja-servidor";
import { armarBienvenida } from "@/lib/contratos";
import { ErrorPandadoc } from "@/lib/pandadoc-servidor";

/* Liliana, 27/11: «tenemos el caso de este alumno que no llegó a firmar el contrato (por lo cual no tenía accesos) y se le
   realizó el reembolso. Anulé el contrato manualmente, para prevenir que se le den los accesos. ¿Se podrá anular de manera
   automática? Para asegurar que se le quite toda opción de tener los accesos. Y que se me envíe una notificación».
   La venta se marcó reembolsada a la madrugada y el contrato siguió vivo en PandaDoc: si firmaba, lo pagado estaba completo y
   la app le daba los accesos. Nombres y montos inventados (el repositorio es público). */

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

/* ---------- La regla ---------- */

test("se anula lo que todavía se puede firmar; lo firmado, anulado o rechazado no", () => {
  for (const e of ["creando", "borrador", "enviado", "visto", "error"] as const) assert.equal(contratoAnulable(e), true, e);
  for (const e of ["firmado", "anulado", "rechazado"] as const) assert.equal(contratoAnulable(e), false, e);
  assert.equal(motivoDeLaBaja("reembolsada"), "Se reembolsó la venta");
  assert.equal(motivoDeLaBaja("cancelada"), "Se canceló la venta");
});

test("los accesos no se dan si la venta está de baja y la persona no tiene otra activa", () => {
  assert.match(sinAccesosPorLaBaja({ estado: "reembolsada" }, false)!, /^La venta está reembolsada: no se dan los accesos\./);
  assert.match(sinAccesosPorLaBaja({ estado: "cancelada" }, false)!, /^La venta está cancelada/);
  assert.equal(sinAccesosPorLaBaja({ estado: "reembolsada" }, true), null, "con otra venta activa su servicio sigue con esa");
  assert.equal(sinAccesosPorLaBaja({ estado: "activa" }, false), null);
  assert.equal(sinAccesosPorLaBaja(null, false), null);
});

test("el aviso a Servicio cuenta qué se hizo y qué falta a mano", () => {
  /* El caso de Lili: no firmó, no tenía accesos. */
  const juan = avisoDeLaBaja({ nombre: "Tomás Pérez", estado: "reembolsada", anulados: ["Hackear AI"], noAnulados: [], accesos: { quitados: 0, plataformas: [], aMano: [], fallaron: [], teniaDeLaApp: false } })!;
  assert.equal(juan.titulo, "Se reembolsó la venta de Tomás Pérez");
  assert.equal(juan.cuerpo, "Anulamos su contrato de Hackear AI, que no había firmado: ya no lo puede firmar. Como no llegó a firmar, no tenía accesos de la app.");
  assert.equal(juan.pendiente, false);

  const conAccesos = avisoDeLaBaja({ nombre: "Ana", estado: "cancelada", anulados: [], noAnulados: [], accesos: { quitados: 3, plataformas: ["Wisboo", "Telegram"], aMano: ["Zoom"], fallaron: [], teniaDeLaApp: true } })!;
  assert.equal(conAccesos.titulo, "Se canceló la venta de Ana: falta algo a mano");
  assert.equal(conAccesos.cuerpo, "Le sacamos 3 accesos de la app (Wisboo y Telegram). Zoom no figura en la app: si los tiene de antes, sacáselos a mano.");

  const viejo = avisoDeLaBaja({ nombre: "Beto", estado: "reembolsada", anulados: [], noAnulados: [], accesos: { quitados: 0, plataformas: [], aMano: [], fallaron: [], teniaDeLaApp: false } })!;
  assert.match(viejo.cuerpo, /No tenía accesos dados por la app: si tiene alguno de antes/);
  assert.equal(viejo.pendiente, true, "alumno de antes de la app: Servicio lo saca a mano");

  const yaAnulado = avisoDeLaBaja({ nombre: "Tomás Pérez", estado: "reembolsada", anulados: [], noAnulados: [], sinFirmar: true, accesos: { quitados: 0, plataformas: [], aMano: [], fallaron: [], teniaDeLaApp: false } })!;
  assert.equal(yaAnulado.cuerpo, "Como no llegó a firmar, no tenía accesos de la app.", "el contrato ya lo había anulado alguien: no se le pide nada a mano");
  assert.equal(yaAnulado.pendiente, false);

  const fallo = avisoDeLaBaja({ nombre: "Caro", estado: "reembolsada", anulados: [], noAnulados: ["Downsell"], accesos: null })!;
  assert.match(fallo.cuerpo, /^No pudimos anular en PandaDoc su contrato de Downsell: anulalo a mano desde su ficha → Contrato\. Igual, si lo firma, la app no le da accesos\.$/);
  assert.equal(avisoDeLaBaja({ nombre: "X", estado: "cancelada", anulados: [], noAnulados: [], accesos: null }), null, "sin servicio ni contrato: nada que contar");
});

test("el cartel para quien dio de baja la venta", () => {
  assert.deepEqual(avisoParaQuienDioDeBaja({ anulados: 1, noAnulados: 0, quitados: 0, fallaron: 0, avisado: true }), { texto: "Por la baja: anulamos su contrato sin firmar. Le avisamos a Servicio.", error: false });
  assert.deepEqual(avisoParaQuienDioDeBaja({ anulados: 0, noAnulados: 0, quitados: 2, fallaron: 1, avisado: true }), { texto: "Por la baja: le sacamos 2 accesos de la app, pero algo no se pudo hacer solo. Le avisamos a Servicio qué falta.", error: true });
  assert.equal(avisoParaQuienDioDeBaja({ anulados: 0, noAnulados: 0, quitados: 0, fallaron: 0, avisado: true }), null);
});

test("la bienvenida de un contrato firmado con la venta de baja: accesos no activos, sin guía ni soporte", () => {
  const b = armarBienvenida({
    contrato: { estado: "firmado", accesosEn: null, destinatario: { nombre: "Tomás Pérez", email: "t@x.com", telefono: "" }, datos: {} },
    programa: "Hackear AI", accesos: [], linkWisboo: null, accesosAutomaticos: true, deBaja: true,
    guia: { modelo: "completo" } as never,
  });
  assert.equal(b.fase, "terminado");
  assert.equal(b.guia, null);
});

/* ---------- La pasada, con una base de mentira ---------- */

type Fila = Record<string, unknown>;
const valor = (f: Fila, c: string): unknown => {
  const [col, sub] = c.split("->>");
  const v = f[col.replace(/"/g, "")];
  return sub ? (v as Fila | null | undefined)?.[sub] : v;
};

function base(tablas: Record<string, Fila[]>) {
  const escritos: { tabla: string; op: string; filas: unknown }[] = [];
  return {
    escritos, tablas,
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      let cambios: Fila | null = null;
      const aplicar = () => {
        if (!cambios) return;
        for (const f of filas) Object.assign(f, cambios);
        escritos.push({ tabla, op: "update", filas: cambios });
        cambios = null;
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filas = filas.filter((f) => valor(f, c) === v); return q; },
        neq: (c: string, v: unknown) => { filas = filas.filter((f) => valor(f, c) !== v); return q; },
        in: (c: string, v: unknown[]) => { filas = filas.filter((f) => v.includes(valor(f, c))); return q; },
        is: (c: string, v: unknown) => { filas = filas.filter((f) => (valor(f, c) ?? null) === v); return q; },
        gte: (c: string, v: string) => { filas = filas.filter((f) => typeof valor(f, c) === "string" && (valor(f, c) as string) >= v); return q; },
        or: (expr: string) => {
          const partes = expr.split(",").map((p) => p.match(/^(\w+)\.eq\.(.+)$/));
          if (partes.every(Boolean)) filas = filas.filter((f) => partes.some((m) => String(f[m![1]]) === m![2]));
          return q;
        },
        limit: () => q,
        order: () => q,
        maybeSingle: () => { aplicar(); return Promise.resolve({ data: filas[0] ?? null, error: null }); },
        update: (c: Fila) => { cambios = c; return q; },
        insert: (f: Fila | Fila[]) => {
          const lista = Array.isArray(f) ? f : [f];
          tablas[tabla] = [...(tablas[tabla] ?? []), ...lista];
          escritos.push({ tabla, op: "insert", filas: f });
          return Promise.resolve({ error: null });
        },
        upsert: (f: Fila[]) => {
          const nuevas = f.filter((x) => !(tablas[tabla] ?? []).some((y) => y.id === x.id));
          tablas[tabla] = [...(tablas[tabla] ?? []), ...nuevas];
          escritos.push({ tabla, op: "upsert", filas: nuevas });
          return Promise.resolve({ error: null });
        },
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => { aplicar(); return Promise.resolve({ data: filas, error: null }).then(ok, mal); },
      };
      return q;
    },
  };
}

const BAJA = "2026-11-27T17:50:04.000Z";
const contrato = (id: string, c: Fila = {}): Fila => ({
  id, ventaId: "v_tomas", leadId: "lead_tomas", alumnoId: "alu_tomas", programa: "hackear-ai", plantillaNombre: "Contrato de Mentoría - Hackear AI",
  estado: "visto", modo: "produccion", documentoId: `doc_${id}`, creadoEn: "2026-11-26T14:29:02.000Z", destinatario: { nombre: "Tomás Pérez", email: "t@x.com" }, datos: {}, ...c,
});

function baseDelCaso(t: Partial<Record<string, Fila[]>> = {}) {
  return base({
    ventas: [{ id: "v_tomas", estado: "reembolsada", contactoId: "lead_tomas", contactoNombre: "Tomás Pérez", extra: { bajaEn: BAJA, otraCosa: 1 } }],
    alumnos: [{ id: "alu_tomas", nombre: "Tomás Pérez", ventaId: "v_tomas", leadId: "lead_tomas", estado: "baja" }],
    contratos: [contrato("ctr_1")],
    accesos_alumno: [],
    ajustes: [{}],
    equipo: [{ email: " Liliana@Apicanta.com ", activo: true, puesto: "Customer Success" }],
    contrato_eventos: [], avisos: [], actividad: [],
    ...t,
  });
}

/* El anular de verdad le habla a PandaDoc: acá se anota y se deja la fila como la dejaría. */
const anularDeMentira = (llamados: string[], falla?: (id: string) => Error | null) => (async (db: ReturnType<typeof base>, c: Fila, motivo: string, quien: string) => {
  const error = falla?.(String(c.id));
  if (error) throw error;
  llamados.push(`${c.id}:${motivo}:${quien}`);
  const fila = db.tablas.contratos.find((x) => x.id === c.id)!;
  fila.estado = "anulado";
}) as never;

const quitarDeMentira = (llamados: string[]) => (async (_db: unknown, a: { alumnoId: string; quien: string }) => {
  llamados.push(`${a.alumnoId}:${a.quien}`);
  return {
    quitados: 2, fallaron: 0,
    accesos: [
      { plataforma: "wisboo", estado: "quitado", error: null, recurso: "w1", recursoNombre: "Hackear AI" },
      { plataforma: "telegram", estado: "quitado", error: null, recurso: "-100", recursoNombre: "General" },
    ],
  };
}) as never;

test("venta reembolsada con el contrato abierto y sin firmar: se anula en PandaDoc, Lili recibe el aviso y queda anotado en la venta", async () => {
  const db = baseDelCaso();
  const anulados: string[] = [], quitados: string[] = [];
  const r = (await salidaPorBaja(db as never, "v_tomas", { quien: "yari@apicanta.com", anularFn: anularDeMentira(anulados), quitarFn: quitarDeMentira(quitados) }))!;
  assert.deepEqual(anulados, ["ctr_1:Se reembolsó la venta:yari@apicanta.com"]);
  assert.deepEqual(quitados, [], "no tenía accesos de la app: no se llama a nadie");
  assert.deepEqual(r.anulados, ["ctr_1"]);
  assert.equal(r.avisado, true);
  assert.deepEqual(r.aviso, { texto: "Por la baja: anulamos su contrato sin firmar. Le avisamos a Servicio.", error: false });

  const avisos = db.tablas.avisos;
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].para, "liliana@apicanta.com");
  assert.equal(avisos[0].tipo, "outboarding");
  assert.equal(avisos[0].titulo, "Se reembolsó la venta de Tomás Pérez");
  assert.equal(avisos[0].cuerpo, "Anulamos su contrato de Hackear AI, que no había firmado: ya no lo puede firmar. Como no llegó a firmar, no tenía accesos de la app.");
  assert.equal(avisos[0].contactoId, "lead_tomas", "abre su ficha");

  const extra = db.tablas.ventas[0].extra as Fila;
  assert.equal(extra.otraCosa, 1, "no pisa lo que había en la venta");
  assert.deepEqual((extra[CLAVE_SALIDA_POR_BAJA] as SalidaPorBaja).contratos, ["Hackear AI"]);
  assert.equal(db.tablas.actividad.length, 1, "queda en la historia de la venta");
  assert.match(String(db.tablas.actividad[0].detalle), /^Se reembolsó la venta: se anuló su contrato sin firmar \(Hackear AI\)\.$/);

  /* La pasada de cada hora vuelve a pasar: nada nuevo, nada repetido. */
  const otra: string[] = [];
  const r2 = (await salidaPorBaja(db as never, "v_tomas", { quien: "pasada de cada hora", anularFn: anularDeMentira(otra), quitarFn: quitarDeMentira(otra) }))!;
  assert.deepEqual(otra, []);
  assert.equal(r2.aviso, null);
  assert.equal(db.tablas.avisos.length, 1);
});

test("con accesos de la app: se sacan una sola vez (si Servicio se los vuelve a dar, no se repite)", async () => {
  const db = baseDelCaso({ contratos: [contrato("ctr_1", { estado: "firmado" })], accesos_alumno: [{ id: "a1", alumnoId: "alu_tomas", estado: "dado" }, { id: "a2", alumnoId: "alu_tomas", estado: "entro" }] });
  const anulados: string[] = [], quitados: string[] = [];
  const r = (await salidaPorBaja(db as never, "v_tomas", { quien: "aldana@apicanta.com", anularFn: anularDeMentira(anulados), quitarFn: quitarDeMentira(quitados) }))!;
  assert.deepEqual(anulados, [], "el firmado no se anula");
  assert.deepEqual(quitados, ["alu_tomas:Se reembolsó la venta (aldana@apicanta.com)"]);
  assert.equal(r.quitados, 2);
  assert.match(String(db.tablas.avisos[0].cuerpo), /^Le sacamos 2 accesos de la app \(Wisboo y Telegram\)\. Zoom no figura en la app/);
  const otra: string[] = [];
  await salidaPorBaja(db as never, "v_tomas", { quien: "pasada de cada hora", anularFn: anularDeMentira(otra), quitarFn: quitarDeMentira(otra) });
  assert.deepEqual(otra, [], "una vez por baja");
});

test("venta activa o con otra venta activa de la misma persona: no se toca nada", async () => {
  const activa = baseDelCaso();
  activa.tablas.ventas[0].estado = "activa";
  const llamados: string[] = [];
  assert.equal(await salidaPorBaja(activa as never, "v_tomas", { quien: "x", anularFn: anularDeMentira(llamados), quitarFn: quitarDeMentira(llamados) }), null);

  const conOtra = baseDelCaso();
  conOtra.tablas.ventas.push({ id: "v_nueva", estado: "activa", contactoId: "lead_tomas", contactoNombre: "Tomás Pérez", extra: {} });
  const r = (await salidaPorBaja(conOtra as never, "v_tomas", { quien: "x", anularFn: anularDeMentira(llamados), quitarFn: quitarDeMentira(llamados) }))!;
  assert.equal(r.otraVentaActiva, true);
  assert.deepEqual(llamados, []);
  assert.equal(conOtra.tablas.avisos.length, 0);
  assert.equal(conOtra.tablas.contratos[0].estado, "visto");
});

test("si PandaDoc no lo deja anular: uno que el alumno ya tenía queda abierto y se avisa; uno que PandaDoc ya no tiene se anula en la app", async () => {
  const db = baseDelCaso({ contratos: [contrato("ctr_vivo"), contrato("ctr_borrado")] });
  const falla = (id: string) => (id === "ctr_vivo" ? new ErrorPandadoc(502, "PandaDoc no contestó.") : id === "ctr_borrado" ? new ErrorPandadoc(404, "No existe.") : null);
  const r = (await salidaPorBaja(db as never, "v_tomas", { quien: "x", anularFn: anularDeMentira([], falla), quitarFn: quitarDeMentira([]) }))!;
  assert.deepEqual(r.noAnulados.map((x) => x.id), ["ctr_vivo"]);
  assert.deepEqual(r.anulados, ["ctr_borrado"]);
  assert.equal(db.tablas.contratos.find((c) => c.id === "ctr_borrado")!.estado, "anulado");
  assert.equal(db.tablas.contratos.find((c) => c.id === "ctr_vivo")!.estado, "visto");
  assert.equal(db.tablas.contrato_eventos.length, 1, "el anulado en la app deja su evento");
  assert.equal(r.aviso?.error, true);
  assert.match(String(db.tablas.avisos[0].titulo), /falta algo a mano$/);
  assert.match(String(db.tablas.avisos[0].cuerpo), /No pudimos anular en PandaDoc su contrato de Hackear AI/);
});

test("un contrato mandado a mano (sin venta) de la misma persona: se anula si salió antes de la baja, no si es de después", async () => {
  const db = baseDelCaso({
    contratos: [
      contrato("ctr_antes", { ventaId: null, alumnoId: null, creadoEn: "2026-11-26T10:00:00.000Z" }),
      contrato("ctr_despues", { ventaId: null, alumnoId: null, creadoEn: "2026-12-10T10:00:00.000Z" }),
    ],
  });
  const anulados: string[] = [];
  await salidaPorBaja(db as never, "v_tomas", { quien: "x", anularFn: anularDeMentira(anulados), quitarFn: quitarDeMentira([]) });
  assert.deepEqual(anulados.map((x) => x.split(":")[0]), ["ctr_antes"], "el de después puede ser de una compra nueva que todavía no se cargó");
});

test("la pasada de cada hora: sólo las bajas desde el arreglo (las de antes las revisa Servicio a mano)", async () => {
  const db = baseDelCaso();
  db.tablas.ventas.push({ id: "v_vieja", estado: "reembolsada", contactoId: "lead_v", contactoNombre: "Vieja", extra: { bajaEn: "2026-11-02T18:20:31.700Z" } });
  /* La del caso que lo motivó (00:50 del 27/11) ya la había resuelto Lili a mano: tampoco se repasa. */
  db.tablas.ventas.push({ id: "v_lili", estado: "reembolsada", contactoId: "lead_l", contactoNombre: "Ya resuelta", extra: { bajaEn: "2026-11-27T03:50:04.441Z" } });
  db.tablas.contratos.push(contrato("ctr_viejo", { ventaId: "v_vieja", leadId: "lead_v", alumnoId: null, estado: "error" }));
  const anulados: string[] = [];
  const r = await pasarBajasDeVentas(db as never, new Date("2026-11-27T18:25:00.000Z"), { anularFn: anularDeMentira(anulados), quitarFn: quitarDeMentira([]) });
  assert.equal(r.revisadas, 1);
  assert.deepEqual(anulados.map((x) => x.split(":")[0]), ["ctr_1"]);
});

test("al firmar: con la venta de baja no se dan accesos; con otra venta activa o activa, sí", async () => {
  const db = baseDelCaso();
  assert.match((await bajaQueFrena(db as never, { ventaId: "v_tomas" }, "alu_tomas"))!, /^La venta está reembolsada/);
  assert.match((await bajaQueFrena(db as never, { ventaId: null }, "alu_tomas"))!, /reembolsada/, "sin venta en el contrato, la del servicio");
  db.tablas.ventas.push({ id: "v_nueva", estado: "activa", contactoId: "lead_tomas", contactoNombre: "Tomás Pérez", extra: {} });
  assert.equal(await bajaQueFrena(db as never, { ventaId: "v_tomas" }, "alu_tomas"), null);
  assert.equal(await bajaQueFrena(db as never, { ventaId: "v_nueva" }, "alu_tomas"), null);
});

/* ---------- Que esté enchufado donde tiene que estar ---------- */

test("alFirmar mira la baja antes de la bienvenida, la ficha y los accesos; «Dar los accesos» también", () => {
  const s = leer("src/lib/contratos-servidor.ts");
  const alFirmar = s.slice(s.indexOf("export async function alFirmar"), s.indexOf("/** La marca de «pasó a Downsell"));
  assert.ok(alFirmar.indexOf("bajaQueFrena(") > 0 && alFirmar.indexOf("bajaQueFrena(") < alFirmar.indexOf("mandarBienvenida("), "antes del mail de bienvenida");
  assert.ok(alFirmar.indexOf("bajaQueFrena(") < alFirmar.indexOf("darAccesos("));
  const dar = s.slice(s.indexOf("export async function darAccesosAhora"));
  assert.ok(dar.indexOf("bajaQueFrena(") > 0 && dar.indexOf("bajaQueFrena(") < dar.indexOf("alFirmar("));
});

test("la baja se resuelve sola: el store le avisa al servidor desde los dos lugares que dan de baja, y la pasada de cada hora la repasa", () => {
  const store = leer("src/lib/store.ts");
  assert.equal((store.match(/pedirSalidaPorBaja\(/g) ?? []).length, 3, "la definición + actualizar + registrarDevolucion");
  assert.match(store, /if \(baja && esBaja\(baja\.venta\)\) pedirSalidaPorBaja\(id\);/);
  assert.match(store, /if \(baja\) pedirSalidaPorBaja\(venta\.id\);/);
  const cron = leer("src/app/api/cron/contratos/route.ts");
  assert.match(cron, /pasarBajasDeVentas\(db\)/);
  assert.ok(cron.indexOf("sincronizar(db, c") < cron.indexOf("pasarBajasDeVentas(db)"), "después de sincronizar los contratos");
  assert.match(cron, /ventasDeBaja, outboarding/);
  const ruta = leer("src/app/api/contratos/baja/route.ts");
  assert.match(ruta, /exigirArea\(peticion, \["ventas", "finanzas"\], 2, \{ cerrado: true \}\)/);
  assert.match(ruta, /mia\.from\("ventas"\)/, "mira con la sesión de quien pide que la vea");
});
