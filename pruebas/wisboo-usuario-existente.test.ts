import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { darAccesos, motivoWisboo } from "@/lib/accesos-servidor";

/* ==================================================================
   Wisboo con una cuenta que ya existe (23/10: Diana y Sergio). Crear el
   usuario devuelve 422 cuando ya hay una cuenta con ese mail en la tienda;
   la búsqueda por mail no la había traído y los cursos quedaban en
   «fallo». Ahora se la busca por nombre y se le dan los cursos igual.
   Contra un Wisboo falso (fetch reemplazado) y una base en memoria.
   ================================================================== */

type Fila = Record<string, unknown>;

function baseMinima() {
  const filas: Fila[] = [];
  const db = {
    from: (tabla: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        update: () => q,
        insert: async () => ({ error: null }),
        upsert: async (v: Fila) => { if (tabla === "accesos_alumno") filas.push(v); return { error: null }; },
        then: (listo: (r: { data: Fila[]; error: null }) => unknown) => Promise.resolve(listo({ data: [], error: null })),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, filas };
}

const PROGRAMA = {
  id: "hackear-ai", nombre: "Hackear AI", productos: [], plantillaId: "", plantillaNombre: "",
  wisboo: ["PRO-ai"], telegram: [], zoom: [], bonos: [], activo: true,
};

async function conWisbooFalso<T>(responder: (url: URL, init?: RequestInit) => { status: number; json: unknown }, correr: () => Promise<T>) {
  const antes = { fetch: globalThis.fetch, clave: process.env.WISBOO_API_KEY, tienda: process.env.WISBOO_STORE_ID };
  const pedidos: string[] = [];
  process.env.WISBOO_API_KEY = "clave-de-prueba";
  process.env.WISBOO_STORE_ID = "tienda";
  globalThis.fetch = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    pedidos.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const r = responder(url, init);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try { return { resultado: await correr(), pedidos }; }
  finally {
    globalThis.fetch = antes.fetch;
    if (antes.clave === undefined) delete process.env.WISBOO_API_KEY; else process.env.WISBOO_API_KEY = antes.clave;
    if (antes.tienda === undefined) delete process.env.WISBOO_STORE_ID; else process.env.WISBOO_STORE_ID = antes.tienda;
  }
}

const persona = { nombre: "Diana Beatriz Olivera", email: "fmdiania@hotmail.com", telefono: "" };
const YA_EXISTE = { status: 422, json: { code: "INVALID_RESOURCE_VALUES", message: "El modelo \"User\" contiene errores", details: [{ field: "email", explanation: "Ya existe un usuario registrado con este email" }] } };
const pagina = (n: number) => Array.from({ length: 100 }, (_x, i) => ({ id: `usr_${n}_${i}`, email: `otro${n}_${i}@x.com` }));

test("Wisboo: alumno nuevo → se crea el usuario y se dan los cursos, sin recorrer nada", async () => {
  const { db, filas } = baseMinima();
  const { resultado, pedidos } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return { status: 201, json: { id: "usr_nuevo" } };
    if (url.pathname.endsWith("/product_accesses")) return { status: 200, json: { id: "pa_1" } };
    return { status: 200, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.dados, 1);
  assert.equal((filas[0].externo as Fila).usuarioId, "usr_nuevo");
  assert.equal(pedidos.filter((p) => p.startsWith("GET") && p.includes("/users")).length, 0);
});

test("Wisboo: ya tiene cuenta (422) y el filtro por mail no sirve → se recorre la lista desde el final y se dan los cursos", async () => {
  const { db, filas } = baseMinima();
  const { resultado, pedidos } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return YA_EXISTE;
    if (url.pathname.endsWith("/users")) {
      const n = Number(url.searchParams.get("page") ?? 1);
      /* 972 cuentas: las más nuevas al final (Brian estaba en la última página). */
      const data = n === 10 ? [...pagina(10).slice(0, 71), { id: "usr_diana", email: "FMDiania@Hotmail.com " }] : n < 10 ? pagina(n) : [];
      return { status: 200, json: { data, metadata: { total_record_count: 972, page_size: 100, page_number: n } } };
    }
    if (url.pathname.endsWith("/product_accesses")) return { status: 200, json: { id: "pa_1" } };
    return { status: 200, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.fallaron, 0);
  assert.equal(resultado.dados, 1);
  assert.equal((filas[0].externo as Fila).usuarioId, "usr_diana");
  /* La primera para saber cuántas hay y después la última: dos pedidos, no diez. */
  assert.deepEqual(pedidos.filter((p) => p.includes("page=")).map((p) => new URL(`http://x${p.split(" ")[1]}`).searchParams.get("page")), ["1", "10"]);
});

test("Wisboo: 422 y no está en la lista → el error dice qué contestó Wisboo y qué hacer", async () => {
  const { db, filas } = baseMinima();
  const { resultado } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return YA_EXISTE;
    if (url.pathname.endsWith("/users")) return { status: 200, json: { data: url.searchParams.get("page") === "1" ? pagina(1) : [], metadata: { total_record_count: 100 } } };
    return { status: 200, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.fallaron, 1);
  assert.match(String(filas[0].error), /INVALID_RESOURCE_VALUES/);
  assert.match(String(filas[0].error), /a mano desde Wisboo/);
});

test("Wisboo: si no da el curso, el error lleva lo que contestó", async () => {
  const { db, filas } = baseMinima();
  const { resultado } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return { status: 201, json: { id: "usr_1" } };
    if (url.pathname.endsWith("/product_accesses")) return { status: 400, json: { code: "BAD_REQUEST", message: "user_id inválido" } };
    return { status: 200, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.fallaron, 1);
  assert.match(String(filas[0].error), /contestó 400: BAD_REQUEST · user_id inválido/);
});

test("el motivo de Wisboo: sólo code y message, cortos", () => {
  assert.equal(motivoWisboo(null), "");
  assert.equal(motivoWisboo({ code: "X", message: "  algo  " }), ": X · algo");
  assert.equal(motivoWisboo({ details: [{ field: "email" }] }), "");
});

test("Wisboo: devuelve 50 por página aunque se pidan 100 → igual llega a la última (donde están los nuevos)", async () => {
  const { db, filas } = baseMinima();
  const de50 = (n: number) => Array.from({ length: 50 }, (_x, i) => ({ id: `usr_${n}_${i}`, email: `otro${n}_${i}@x.com` }));
  const { resultado, pedidos } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return YA_EXISTE;
    if (url.pathname.endsWith("/users")) {
      const n = Number(url.searchParams.get("page") ?? 1);
      const data = n === 20 ? [...de50(20).slice(0, 21), { id: "usr_brian", email: "fmdiania@hotmail.com" }] : n < 20 ? de50(n) : [];
      return { status: 200, json: { data, metadata: { total_record_count: 972, page_size: 50 } } };
    }
    if (url.pathname.endsWith("/product_accesses")) return { status: 200, json: { id: "pa_1" } };
    return { status: 200, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.dados, 1);
  assert.equal((filas[0].externo as Fila).usuarioId, "usr_brian");
  assert.equal(pedidos.filter((p) => p.includes("page=")).length, 2);
});
