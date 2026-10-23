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

test("Wisboo: la cuenta ya existe (422) y la búsqueda por mail no la trae → se la encuentra por nombre y se dan los cursos", async () => {
  const { db, filas } = baseMinima();
  const { resultado, pedidos } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return { status: 422, json: { code: "DUPLICATE_ERROR", message: "Email already exists" } };
    if (url.pathname.endsWith("/users") && url.searchParams.has("email")) return { status: 200, json: { data: [] } };
    if (url.pathname.endsWith("/users") && url.searchParams.get("name") === "Diana Olivera") {
      return { status: 200, json: { data: [{ id: "usr_diana", email: "FMDiania@Hotmail.com" }] } };
    }
    if (url.pathname.endsWith("/users")) return { status: 200, json: { data: [] } };
    if (url.pathname.endsWith("/product_accesses")) return { status: 200, json: { id: "pa_1" } };
    if (url.pathname.endsWith("/magic_links")) return { status: 200, json: { link: "https://wisboo/entrar" } };
    return { status: 404, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.fallaron, 0);
  assert.equal(resultado.dados, 1);
  assert.equal((filas[0].externo as Fila).usuarioId, "usr_diana");
  /* Primero por mail, después por nombre completo y por nombre corto. */
  assert.ok(pedidos.some((p) => p.includes("name=Diana+Beatriz+Olivera") || p.includes("name=Diana%20Beatriz%20Olivera")));
});

test("Wisboo: 422 y no aparece por ningún lado → el error dice qué contestó Wisboo y qué hacer", async () => {
  const { db, filas } = baseMinima();
  const { resultado } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") return { status: 422, json: { code: "INVALID_EMAIL", message: "Invalid email" } };
    return { status: 200, json: { data: [] } };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.fallaron, 1);
  assert.match(String(filas[0].error), /INVALID_EMAIL · Invalid email/);
  assert.match(String(filas[0].error), /a mano desde Wisboo/);
});

test("el motivo de Wisboo: sólo code y message, cortos", () => {
  assert.equal(motivoWisboo(null), "");
  assert.equal(motivoWisboo({ code: "X", message: "  algo  " }), ": X · algo");
  assert.equal(motivoWisboo({ details: [{ field: "email" }] }), "");
});

test("Wisboo: ni el filtro por mail ni por nombre la traen → se recorre la lista de la tienda hasta dar con el mail", async () => {
  const { db, filas } = baseMinima();
  const pagina = (n: number) => Array.from({ length: 100 }, (_x, i) => ({ id: `usr_${n}_${i}`, email: `otro${n}_${i}@x.com` }));
  const { resultado, pedidos } = await conWisbooFalso((url, init) => {
    if (url.pathname.endsWith("/users") && init?.method === "POST") {
      return { status: 422, json: { code: "INVALID_RESOURCE_VALUES", details: [{ field: "email", explanation: "Ya existe un usuario registrado con este email" }] } };
    }
    if (url.pathname.endsWith("/users") && url.searchParams.has("page")) {
      const n = Number(url.searchParams.get("page"));
      const data = n === 3 ? [...pagina(3).slice(0, 40), { id: "usr_arnold", email: "Arnold.Salazar@Gmail.com " }] : n < 3 ? pagina(n) : [];
      return { status: 200, json: { data, metadata: { total_record_count: 241, page_size: 100, page_number: n } } };
    }
    if (url.pathname.endsWith("/users")) return { status: 200, json: { data: [], metadata: { total_record_count: 0 } } };
    if (url.pathname.endsWith("/product_accesses")) return { status: 200, json: { id: "pa_1" } };
    return { status: 200, json: {} };
  }, () => darAccesos(db, { alumnoId: "alu_1", persona: { nombre: "Arnold Salazar Salazar", email: "arnold.salazar@gmail.com", telefono: "" }, programa: PROGRAMA, origen: "manual", quien: "x" }));
  assert.equal(resultado.dados, 1);
  assert.equal((filas[0].externo as Fila).usuarioId, "usr_arnold");
  assert.equal(pedidos.filter((p) => p.includes("page=")).length, 3, "para en la página donde lo encuentra");
});
