import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarPglite, ESQUEMA_MINIMO, armarBanco, sqlDe, type Banco } from "./sql/arnes-pg";
import { darAccesos, marcasDeLaFicha, type Acceso } from "@/lib/accesos-servidor";
import { pasarCortes } from "@/lib/accesos-vencimientos-servidor";
import {
  PROGRAMAS_POR_DEFECTO, claveDeCorte, cortesNormales, esProgramaDownsell, mesesDeCorte, programaDeProducto, programaNormal, sumarMeses, type Programa,
} from "@/lib/programas";
import { modeloDeBienvenida } from "@/lib/bienvenida-alumno";
import { formulariosDe, programasSinReconocer } from "@/lib/reporte-formularios";

/* 12/11: Manuel pasó los downsells nuevos —Downsell (US$ 497, contenido), Plus+ (US$ 997, contenido + bolsa de trabajo + CV) y Hackear IA MID
   (US$ 1.497, contenido + un mes de mentoría grupal)— y preguntó si los accesos se dan solos y si, al terminar el mes, se le puede sacar al MID
   sólo la mentoría grupal y que conserve el contenido grabado. */

const IT = "PRO-it", AI = "PRO-ai";
const GENERAL = "-1004341505711", NOVEDADES = "-1004338558206", BOLSA = "-1004492115716";

const MID: Programa = {
  id: "hackear-ia-mid", nombre: "Hackear IA MID", productos: ["prod_hackear_ia_mid"], plantillaId: "", plantillaNombre: "",
  wisboo: [IT, AI], telegram: [GENERAL, NOVEDADES], zoom: [], bonos: [], activo: true,
  vencen: { [claveDeCorte("telegram", GENERAL)]: 1, [claveDeCorte("telegram", NOVEDADES)]: 1 },
};
const COMPLETO: Programa = {
  id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_hackear_ai"], plantillaId: "", plantillaNombre: "",
  wisboo: [IT, AI], telegram: [GENERAL, NOVEDADES, BOLSA], zoom: [], bonos: [], activo: true,
};

/* ---------- los meses ---------- */

test("sumarMeses: meses calendario, sin pasarse de fin de mes y conservando la hora", () => {
  assert.equal(sumarMeses("2026-11-12T15:00:00.000Z", 1), "2026-12-12T15:00:00.000Z");
  assert.equal(sumarMeses("2026-11-30T09:30:00.000Z", 3), "2027-02-28T09:30:00.000Z", "30/11 + 3 meses: el 28 de febrero, no el 2 de marzo");
  assert.equal(sumarMeses("2026-01-31T12:00:00.000Z", 1), "2026-02-28T12:00:00.000Z");
  assert.equal(sumarMeses("2028-01-31T12:00:00.000Z", 1), "2028-02-29T12:00:00.000Z", "año bisiesto");
  assert.equal(sumarMeses("2026-12-15T12:00:00.000Z", 1), "2027-01-15T12:00:00.000Z", "cruza de año");
  assert.equal(sumarMeses(new Date("2026-11-12T15:00:00.000Z"), 12), "2027-11-12T15:00:00.000Z");
});

test("los cortes leídos de la base: sólo plataformas conocidas y meses enteros de 1 a 36", () => {
  assert.deepEqual(cortesNormales({ "telegram:-100": 1, "zoom:84": 3, "wisboo:PRO-x": 36 }), { "telegram:-100": 1, "zoom:84": 3, "wisboo:PRO-x": 36 });
  assert.deepEqual(cortesNormales({ "whatsapp:1": 1, "telegram:-100": 0, "zoom:84": 1.5, "wisboo:PRO-x": 37, "telegram:": 1, "zoom:1": "2" }), {});
  for (const raro of [null, undefined, "x", 3, [], [1]]) assert.deepEqual(cortesNormales(raro), {});
  const p = programaNormal({ ...MID, vencen: { [claveDeCorte("zoom", "84")]: 2, basura: 1 } })!;
  assert.deepEqual(p.vencen, { "zoom:84": 2 });
  assert.equal(mesesDeCorte(p, "zoom", "84"), 2);
  assert.equal(mesesDeCorte(p, "zoom", "85"), null);
  assert.equal(mesesDeCorte(programaNormal({ id: "x", nombre: "X" })!, "zoom", "84"), null, "un programa sin cortes no corta nada");
});

/* ---------- los tres programas de fábrica ---------- */

test("los tres downsells son programas aparte y cada producto lleva al suyo", () => {
  const ids = (id: string) => PROGRAMAS_POR_DEFECTO.find((p) => p.id === id)!;
  assert.deepEqual(ids("downsell").productos, ["prod_downsell"]);
  assert.deepEqual(ids("downsell-plus").productos, ["prod_downsell_plus"]);
  assert.deepEqual(ids("hackear-ia-mid").productos, ["prod_hackear_ia_mid"]);
  assert.equal(programaDeProducto(PROGRAMAS_POR_DEFECTO, "prod_downsell_plus")?.id, "downsell-plus");
  assert.equal(programaDeProducto(PROGRAMAS_POR_DEFECTO, "prod_hackear_ia_mid")?.id, "hackear-ia-mid");
  for (const id of ["downsell", "downsell-plus", "hackear-ia-mid"]) assert.deepEqual(ids(id).wisboo.length, 2, `${id}: el contenido grabado (los dos cursos)`);
  assert.equal(esProgramaDownsell("hackear-ia-mid") && esProgramaDownsell("downsell-plus") && esProgramaDownsell("downsell"), true);
  assert.equal(esProgramaDownsell("hackear-ai") || esProgramaDownsell(""), false);
  assert.equal(esProgramaDownsell(null), false);
});

test("para la ficha y la bienvenida los tres son downsell; el programa completo, no", () => {
  const acc = (programa: string) => ({ plataforma: "wisboo" as const, estado: "dado" as const, programa });
  for (const id of ["downsell", "downsell-plus", "hackear-ia-mid"]) {
    assert.equal(marcasDeLaFicha([acc(id)]).acceso, "Downsell", id);
    assert.equal(modeloDeBienvenida({ programa: id }), "downsell", id);
  }
  assert.equal(marcasDeLaFicha([acc("hackear-ia-mid"), acc("hackear-ai")]).acceso, "Completos", "pasó al programa completo");
  assert.equal(marcasDeLaFicha([]).acceso, "Sin acceso");
  assert.equal(modeloDeBienvenida({ programa: "hackear-ai" }), "completo");
  assert.equal(modeloDeBienvenida({ programa: "hackear-ia-mid", reserva: true }), "reserva", "la reserva manda");
});

test("Hackear IA MID no recibe el formulario semanal (es un downsell, no el programa completo)", () => {
  assert.deepEqual(formulariosDe(["Hackear IA MID"]), []);
  assert.deepEqual(formulariosDe(["Hackear IA MID", "Hackear Biz"]).map((f) => f.id), formulariosDe(["Hackear Biz"]).map((f) => f.id), "con otro programa sólo cuenta el otro");
  assert.deepEqual(formulariosDe(["Downsell Plus+"]), []);
  assert.equal(formulariosDe(["Hackear AI"]).length, 1, "el programa completo sigue igual");
  assert.equal(formulariosDe(["Hackear IA"]).length, 1);
  assert.deepEqual(programasSinReconocer(["Hackear IA MID"], null), [], "y no se avisa de «programa sin reconocer»");
  assert.deepEqual(programasSinReconocer(["Downsell Plus+"], null), []);
});

/* ---------- una base y un Wisboo/Telegram de mentira ---------- */

type Fila = Record<string, unknown>;

function baseEnMemoria(inicial: Record<string, Fila[]> = {}) {
  const tablas: Record<string, Fila[]> = { ...inicial };
  const escritos: { tabla: string; tipo: string; filas: Fila[] }[] = [];
  const from = (tabla: string) => {
    const todas = (tablas[tabla] ??= []);
    let sel = [...todas];
    let cambios: Fila | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { sel = sel.filter((f) => f[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { sel = sel.filter((f) => vs.includes(f[c])); return q; },
      not: (c: string, _op: string, v: unknown) => { sel = sel.filter((f) => (v === null ? f[c] !== null && f[c] !== undefined : f[c] !== v)); return q; },
      lte: (c: string, v: string) => { sel = sel.filter((f) => String(f[c]) <= v); return q; },
      or: () => q,
      order: () => q,
      limit: (n: number) => { sel = sel.slice(0, n); return q; },
      update: (c: Fila) => { cambios = c; return q; },
      upsert: async (v: Fila | Fila[]) => {
        const filas = Array.isArray(v) ? v : [v];
        for (const r of filas) {
          const i = todas.findIndex((f) => f.id === r.id);
          if (i >= 0) {
            if (!(r as { ignoreDuplicates?: boolean }).ignoreDuplicates) todas[i] = { ...todas[i], ...r };
          } else todas.push({ ...r });
        }
        escritos.push({ tabla, tipo: "upsert", filas });
        return { error: null };
      },
      insert: async (v: Fila | Fila[]) => { const filas = Array.isArray(v) ? v : [v]; todas.push(...filas.map((f) => ({ ...f }))); escritos.push({ tabla, tipo: "insert", filas }); return { error: null }; },
      maybeSingle: async () => ({ data: sel[0] ?? null, error: null }),
      then: (ok: (r: { data: Fila[]; error: null }) => unknown) => {
        if (cambios) { for (const f of sel) Object.assign(f, cambios); escritos.push({ tabla, tipo: "update", filas: sel.map((f) => ({ ...f })) }); }
        return Promise.resolve(ok({ data: sel, error: null }));
      },
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, tablas, escritos };
}

async function conServiciosFalsos<T>(correr: () => Promise<T>): Promise<T> {
  const antes = { fetch: globalThis.fetch, w: process.env.WISBOO_API_KEY, s: process.env.WISBOO_STORE_ID, t: process.env.TELEGRAM_BOT_TOKEN };
  process.env.WISBOO_API_KEY = "x"; process.env.WISBOO_STORE_ID = "tienda"; process.env.TELEGRAM_BOT_TOKEN = "bot";
  let n = 0;
  globalThis.fetch = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
    if (url.hostname === "api.telegram.org") {
      if (url.pathname.endsWith("/createChatInviteLink")) return json(200, { ok: true, result: { invite_link: `https://t.me/+${++n}` } });
      return json(200, { ok: true, result: {} });
    }
    if (url.pathname.endsWith("/users") && init?.method === "POST") return json(201, { id: "usr_1" });
    if (url.pathname.endsWith("/product_accesses") && init?.method === "POST") return json(200, { id: `pa_${++n}` });
    if (url.pathname.endsWith("/magic_links")) return json(200, { link: "https://w/entrar" });
    return json(200, {});
  }) as typeof fetch;
  try { return await correr(); }
  finally {
    globalThis.fetch = antes.fetch;
    for (const [k, v] of [["WISBOO_API_KEY", antes.w], ["WISBOO_STORE_ID", antes.s], ["TELEGRAM_BOT_TOKEN", antes.t]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const persona = { nombre: "Ana Prueba", email: "ana@x.com" };
const filaDe = (tablas: Record<string, Fila[]>, plataforma: string, recurso: string) => tablas.accesos_alumno.find((f) => f.plataforma === plataforma && f.recurso === recurso)!;
const casiAhora = (iso: unknown, meses: number, desde = Date.now()) => {
  const esperado = new Date(sumarMeses(new Date(desde), meses)).getTime();
  assert.ok(typeof iso === "string" && Math.abs(new Date(iso).getTime() - esperado) < 60_000, `${String(iso)} debería ser ~${new Date(esperado).toISOString()}`);
};

test("darAccesos del MID: la mentoría (grupos de Telegram) vence al mes y el contenido de Wisboo no vence nunca", async () => {
  const { db, tablas } = baseEnMemoria();
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: MID, origen: "automatico", quien: "t" }));
  assert.equal(r.fallaron, 0);
  assert.equal(r.dados, 4);
  for (const curso of [IT, AI]) assert.equal(filaDe(tablas, "wisboo", curso).venceEn, null, `Wisboo ${curso}: el contenido queda`);
  casiAhora(filaDe(tablas, "telegram", GENERAL).venceEn, 1);
  casiAhora(filaDe(tablas, "telegram", NOVEDADES).venceEn, 1);
  assert.equal(filaDe(tablas, "wisboo", IT).estado, "dado");
});

test("darAccesos: si el servicio arranca más adelante, el mes cuenta desde el inicio; si ya arrancó, desde hoy", async () => {
  const futuro = new Date(Date.now() + 10 * 86400000).toISOString();
  const a = baseEnMemoria();
  await conServiciosFalsos(() => darAccesos(a.db, { alumnoId: "alu_1", persona, programa: MID, origen: "automatico", quien: "t", desde: futuro }));
  casiAhora(filaDe(a.tablas, "telegram", GENERAL).venceEn, 1, new Date(futuro).getTime());
  const b = baseEnMemoria();
  await conServiciosFalsos(() => darAccesos(b.db, { alumnoId: "alu_1", persona, programa: MID, origen: "automatico", quien: "t", desde: "2020-01-01T15:00:00.000Z" }));
  casiAhora(filaDe(b.tablas, "telegram", GENERAL).venceEn, 1);
  const c = baseEnMemoria();
  await conServiciosFalsos(() => darAccesos(c.db, { alumnoId: "alu_1", persona, programa: MID, origen: "automatico", quien: "t", desde: "no es una fecha" }));
  casiAhora(filaDe(c.tablas, "telegram", GENERAL).venceEn, 1);
});

test("un programa sin cortes (el Downsell, el Plus+, el programa completo) no deja nada para cortar", async () => {
  const { db, tablas } = baseEnMemoria();
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: COMPLETO, origen: "automatico", quien: "t" }));
  assert.ok(tablas.accesos_alumno.length >= 5);
  assert.ok(tablas.accesos_alumno.every((f) => f.venceEn === null), "ninguno vence");
});

test("quien pasa del MID al programa completo conserva la mentoría: el corte se le levanta", async () => {
  const { db, tablas } = baseEnMemoria();
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: MID, origen: "automatico", quien: "t" }));
  assert.ok(filaDe(tablas, "telegram", GENERAL).venceEn, "con el MID vence");
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: COMPLETO, origen: "manual", quien: "t" }));
  assert.ok(r.yaEstaban >= 4, "lo que ya tenía no se vuelve a dar");
  assert.equal(filaDe(tablas, "telegram", GENERAL).venceEn, null, "General ya no vence");
  assert.equal(filaDe(tablas, "telegram", NOVEDADES).venceEn, null);
  assert.ok(filaDe(tablas, "telegram", BOLSA), "y se le suma la bolsa de trabajo que le faltaba");
});

test("volver a dar el MID no le estira el mes: el corte que ya tenía se queda", async () => {
  const { db, tablas } = baseEnMemoria();
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: MID, origen: "automatico", quien: "t" }));
  const antes = filaDe(tablas, "telegram", GENERAL).venceEn;
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: MID, origen: "manual", quien: "t" }));
  assert.equal(filaDe(tablas, "telegram", GENERAL).venceEn, antes);
});

test("darAccesos: un acceso que falló no queda con fecha de corte", async () => {
  const { db, tablas } = baseEnMemoria();
  const antes = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    await darAccesos(db, { alumnoId: "alu_1", persona, programa: { ...MID, wisboo: [] }, origen: "automatico", quien: "t" });
  } finally { if (antes !== undefined) process.env.TELEGRAM_BOT_TOKEN = antes; }
  assert.equal(filaDe(tablas, "telegram", GENERAL).estado, "fallo");
  assert.equal(filaDe(tablas, "telegram", GENERAL).venceEn, null);
});

/* ---------- la pasada de cada hora ---------- */

const hoy = new Date("2026-12-12T16:25:00.000Z");
const acceso = (id: string, alumnoId: string, plataforma: string, recurso: string, nombre: string, estado: string, venceEn: string | null): Fila => (
  { id, alumnoId, plataforma, recurso, recursoNombre: nombre, estado, programa: "hackear-ia-mid", venceEn, externo: {}, error: null });

function escenario() {
  return baseEnMemoria({
    accesos_alumno: [
      acceso("a1", "alu_ana", "telegram", GENERAL, "General", "entro", "2026-12-12T15:00:00.000Z"),
      acceso("a2", "alu_ana", "telegram", NOVEDADES, "Novedades - Mentoría", "dado", "2026-12-12T15:00:00.000Z"),
      acceso("a3", "alu_ana", "wisboo", IT, "Mentoría (Hackear IT)", "dado", null),
      acceso("a4", "alu_ana", "wisboo", AI, "Mentoría (Hackear AI)", "dado", null),
      acceso("b1", "alu_beto", "telegram", GENERAL, "General", "entro", "2026-12-20T15:00:00.000Z"),
      acceso("c1", "alu_cata", "telegram", GENERAL, "General", "quitado", "2026-12-01T15:00:00.000Z"),
      acceso("d1", "alu_dani", "telegram", GENERAL, "General", "fallo", "2026-12-01T15:00:00.000Z"),
    ],
    alumnos: [{ id: "alu_ana", nombre: "Ana Prueba", leadId: "lea_ana" }],
    equipo: [{ email: "liliana@apicanta.com", activo: true }, { email: "  ", activo: true }],
    avisos: [],
  });
}

test("la pasada saca sólo lo vencido (no lo vigente, no lo ya quitado, no lo que falló) y deja el contenido", async () => {
  const { db, tablas } = escenario();
  const llamados: { alumnoId: string; ids?: string[]; quien: string }[] = [];
  const quitar = (async (_db: unknown, a: { alumnoId: string; ids?: string[]; quien: string }) => {
    llamados.push(a);
    for (const f of tablas.accesos_alumno) if (a.ids?.includes(String(f.id))) f.estado = "quitado";
    return { quitados: a.ids?.length ?? 0, fallaron: 0, accesos: [] };
  }) as unknown as Parameters<typeof pasarCortes>[2];

  const r = await pasarCortes(db, hoy, quitar);
  assert.equal(r.vencidos, 2, "General y Novedades de Ana");
  assert.deepEqual(llamados, [{ alumnoId: "alu_ana", ids: ["a1", "a2"], quien: "Corte automático" }], "sólo esos dos, nunca «todo»");
  assert.deepEqual(r.alumnos, [{ alumnoId: "alu_ana", quitados: 2, fallaron: 0 }]);
  const estado = (id: string) => tablas.accesos_alumno.find((f) => f.id === id)!.estado;
  assert.equal(estado("a3"), "dado", "el contenido de Wisboo se queda");
  assert.equal(estado("a4"), "dado");
  assert.equal(estado("b1"), "entro", "a Beto todavía no le toca");

  const avisos = tablas.avisos;
  assert.equal(avisos.length, 1, "una persona de Customer Success con mail");
  assert.equal(avisos[0].para, "liliana@apicanta.com");
  assert.equal(avisos[0].contactoId, "lea_ana", "abre su ficha");
  assert.equal(avisos[0].titulo, "Le sacamos la mentoría a Ana Prueba");
  assert.match(String(avisos[0].cuerpo), /se le sacó: General, Novedades - Mentoría\./);
  assert.match(String(avisos[0].cuerpo), /Sigue con: Mentoría \(Hackear IT\), Mentoría \(Hackear AI\)\./);
  assert.match(String(avisos[0].cuerpo), /Vencía el 12\/12\./);
});

test("si algo no se puede sacar, el aviso lo dice y queda vencido para la próxima pasada", async () => {
  const { db, tablas } = escenario();
  const quitar = (async () => ({
    quitados: 1, fallaron: 1,
    accesos: [{ error: "No se sabe su usuario de Telegram: sacalo a mano del grupo.", recursoNombre: "General", recurso: GENERAL }],
  })) as unknown as Parameters<typeof pasarCortes>[2];
  await pasarCortes(db, hoy, quitar);
  assert.equal(tablas.avisos[0].titulo, "Corte de Ana Prueba: falta sacar algo a mano");
  assert.match(String(tablas.avisos[0].cuerpo), /No se pudo sacar: General\. Hacelo a mano/);
  assert.equal(tablas.accesos_alumno.find((f) => f.id === "a1")!.venceEn, "2026-12-12T15:00:00.000Z", "sigue con su fecha: se reintenta");
});

test("sin nada vencido no llama a nadie, y un error al sacar a uno no frena a los demás", async () => {
  const vacio = baseEnMemoria({ accesos_alumno: [acceso("a1", "alu_ana", "telegram", GENERAL, "General", "dado", "2027-01-01T00:00:00.000Z")] });
  assert.deepEqual(await pasarCortes(vacio.db, hoy, (async () => { throw new Error("no debería llamar"); }) as never), { vencidos: 0, alumnos: [] });

  const { db } = baseEnMemoria({
    accesos_alumno: [
      acceso("x1", "alu_uno", "telegram", GENERAL, "General", "dado", "2026-12-01T00:00:00.000Z"),
      acceso("y1", "alu_dos", "telegram", GENERAL, "General", "dado", "2026-12-02T00:00:00.000Z"),
    ],
    equipo: [], avisos: [],
  });
  const vistos: string[] = [];
  const visto = console.error; console.error = () => {};
  try {
    const r = await pasarCortes(db, hoy, (async (_d: unknown, a: { alumnoId: string }) => {
      vistos.push(a.alumnoId);
      if (a.alumnoId === "alu_uno") throw new Error("Telegram se cayó");
      return { quitados: 1, fallaron: 0, accesos: [] };
    }) as never);
    assert.deepEqual(vistos, ["alu_uno", "alu_dos"]);
    assert.deepEqual(r.alumnos, [{ alumnoId: "alu_dos", quitados: 1, fallaron: 0 }]);
  } finally { console.error = visto; }
});

test("el cron de cada hora corre la pasada de cortes, después de los contratos y del outboarding", async () => {
  const { readFileSync } = await import("node:fs");
  const ruta = readFileSync(new URL("../src/app/api/cron/contratos/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /pasarCortes\(db\)/);
  assert.ok(ruta.indexOf("pasarOutboardings(db)") < ruta.indexOf("pasarCortes(db)"), "primero el outboarding");
  assert.match(ruta, /cortes, \.\.\.\(sueltos/);
});

/* ---------- la migración, en un Postgres de verdad ---------- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

/* Los programas guardados en producción el 12/11, antes de esto. */
const PROGRAMAS_DE_ANTES = [
  { id: "hackear-ai", nombre: "Hackear AI", zoom: ["84681899646"], bonos: [], activo: true, wisboo: [IT, AI], telegram: [GENERAL], productos: ["prod_hackear_ai"], plantillaId: "u8", plantillaNombre: "Mentoría" },
  { id: "downsell", nombre: "Downsell", zoom: [], bonos: [], activo: true, wisboo: ["PRO-019fd69d87b070648850ba3e5e53e", "PRO-019fd69d7de5799e85772a1c877c7"], telegram: [BOLSA], productos: ["prod_downsell"], plantillaId: "7uUS5z4i2f3FAPXwuNHkUC", plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX" },
];

async function bancoParaCortes(programas: unknown = PROGRAMAS_DE_ANTES): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec(`
    create table public.accesos_alumno (id text primary key, "alumnoId" text not null, estado text not null default 'dado');
    create table public.productos (id text primary key, nombre text not null, "precioLista" numeric not null default 0, tipo text not null, activo boolean not null default true, orden integer not null default 0);
    alter table public.ajustes alter column id type smallint using 1;   -- en producción es smallint (la fila única es id = 1)
    alter table public.ajustes add column programas jsonb;
    insert into public.productos (id, nombre, "precioLista", tipo, orden) values ('prod_downsell', 'Downsell', 500, 'downsell', 7), ('prod_mentoria', 'Mentoría', 3000, 'principal', 14);
  `);
  await db.query(`insert into public.ajustes (id, programas) values (1, $1::jsonb)`, [JSON.stringify(programas)]);
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

test("migración: agrega la columna, los dos productos y los dos programas; el MID corta la mentoría al mes y deja el contenido", { skip: saltear }, async () => {
  const b = await bancoParaCortes();
  const sql = sqlDe("downsells-y-cortes.sql");
  await b.ejecutar(sql);
  await b.ejecutar(sql); // corrida dos veces: no duplica nada

  const col = await b.servicio<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'accesos_alumno' and column_name = 'venceEn'`);
  assert.equal(col[0].n, 1);
  const prod = await b.servicio<{ id: string; precio: string; tipo: string; orden: number }>(`select id, "precioLista"::text as precio, tipo, orden from public.productos order by orden`);
  assert.deepEqual(prod.map((p) => [p.id, Number(p.precio), p.tipo]), [
    ["prod_downsell", 497, "downsell"], ["prod_mentoria", 3000, "principal"], ["prod_downsell_plus", 997, "downsell"], ["prod_hackear_ia_mid", 1497, "downsell"],
  ]);
  assert.ok(prod[2].orden > prod[1].orden && prod[3].orden > prod[2].orden, "al final del catálogo, sin pisar el orden de nadie");

  const r = await b.servicio<{ programas: Programa[] }>(`select programas from public.ajustes where id = 1`);
  const programas = r[0].programas;
  assert.deepEqual(programas.map((p) => p.id), ["hackear-ai", "downsell", "downsell-plus", "hackear-ia-mid"], "los de antes primero y sin repetir");
  const por = (id: string) => programas.find((p) => p.id === id)!;
  assert.deepEqual(por("hackear-ai"), PROGRAMAS_DE_ANTES[0], "el programa completo no se toca");
  assert.deepEqual(por("downsell").telegram, [], "el Downsell queda con el contenido solo");
  assert.equal(por("downsell").wisboo.length, 2);
  assert.deepEqual(por("downsell-plus").telegram, [BOLSA], "el Plus+ trae la bolsa de trabajo");
  assert.deepEqual(por("downsell-plus").productos, ["prod_downsell_plus"]);

  const mid = por("hackear-ia-mid");
  assert.deepEqual(mid.productos, ["prod_hackear_ia_mid"]);
  assert.equal(mid.wisboo.length, 2, "el contenido grabado");
  assert.equal(mid.telegram.length, 4);
  assert.equal(mid.zoom.length, 3);
  /* El corte de cada grupo y reunión es de 1 mes y el contenido de Wisboo no tiene ninguno. */
  const normal = programaNormal(mid)!;
  for (const g of mid.telegram) assert.equal(mesesDeCorte(normal, "telegram", g), 1, `telegram ${g}`);
  for (const z of mid.zoom) assert.equal(mesesDeCorte(normal, "zoom", z), 1, `zoom ${z}`);
  for (const w of mid.wisboo) assert.equal(mesesDeCorte(normal, "wisboo", w), null, `wisboo ${w}`);
  assert.equal(Object.keys(mid.vencen ?? {}).length, 7);

  const respaldo = await b.servicio<{ n: number; programas: Programa[] }>(`select count(*) over ()::int as n, programas from respaldo.ajustes_programas_1211`);
  assert.equal(respaldo.length, 1, "el respaldo se guarda una sola vez");
  assert.deepEqual(respaldo[0].programas, PROGRAMAS_DE_ANTES, "y es el de antes");
});

test("migración: lo que alguien cambió a mano no se pisa (el Downsell con otro grupo, un Plus+ ya cargado, un precio distinto)", { skip: saltear }, async () => {
  const propios = [
    { ...PROGRAMAS_DE_ANTES[1], telegram: ["-100999"] },
    { id: "downsell-plus", nombre: "Plus+ a mi manera", productos: ["prod_downsell_plus"], wisboo: [], telegram: [], zoom: [], bonos: [], activo: true },
  ];
  const b = await bancoParaCortes(propios);
  await b.ejecutar(`update public.productos set "precioLista" = 520 where id = 'prod_downsell'`);
  await b.ejecutar(sqlDe("downsells-y-cortes.sql"));
  const r = await b.servicio<{ programas: Programa[] }>(`select programas from public.ajustes where id = 1`);
  const por = (id: string) => r[0].programas.find((p) => p.id === id)!;
  assert.deepEqual(por("downsell").telegram, ["-100999"], "no se le saca un grupo que eligió una persona");
  assert.equal(por("downsell-plus").nombre, "Plus+ a mi manera", "no se pisa el que ya estaba");
  assert.equal(r[0].programas.filter((p) => p.id === "downsell-plus").length, 1);
  assert.ok(r[0].programas.some((p) => p.id === "hackear-ia-mid"), "y el MID se agrega igual");
  const precio = await b.servicio<{ p: string }>(`select "precioLista"::text as p from public.productos where id = 'prod_downsell'`);
  assert.equal(Number(precio[0].p), 520, "un precio cambiado a mano se respeta");
});

test("migración: si los programas no están guardados como lista, avisa y no toca nada", { skip: saltear }, async () => {
  const b = await bancoParaCortes(null);
  await assert.rejects(() => b.ejecutar(sqlDe("downsells-y-cortes.sql")), /ajustes\.programas no está guardado como lista/);
});
