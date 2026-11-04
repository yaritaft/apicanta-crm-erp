import test from "node:test";
import assert from "node:assert/strict";
import { armarFilas, parsearPegado } from "@/lib/gastos-masivos";
import { refDeBofa } from "@/lib/gastos-bofa";
import { cruzarConLaApp } from "@/lib/movimientos-del-banco";
import { filasBofaDePlaid, gastosAutomaticos, idDeGastoDeBanco, movimientosDelBancoDePlaid, type PlaidCuenta, type PlaidTransaccion } from "@/lib/plaid";
import { cargarGastosDelBanco, conexion, crearLinkToken, desconectar, guardarConexion, movimientosDeBofa, saldoDeBofa, sinElPermiso, transaccionesDe } from "@/lib/plaid-servidor";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto, Traspaso } from "@/lib/types";

/* ==================================================================
   Bank of America por Plaid (Yari y Manu, 03/11): la cuenta se conecta una vez y los gastos entran solos, de a uno, con las mismas reglas que el CSV.
   Plaid cuenta POSITIVO lo que sale; la app, como el banco, al revés. Las descripciones de abajo tienen la forma de las del banco (el texto de un
   wire, de un depósito de Stripe o de Whop) con datos inventados: el repositorio es público.
   ================================================================== */

const CUENTAS: PlaidCuenta[] = [
  { account_id: "acc_chk", name: "Adv Plus Banking", official_name: "BUSINESS ADV FUNDAMENTALS", mask: "0001", type: "depository", subtype: "checking", balances: { current: 1000.5, available: 990.5, iso_currency_code: "USD" } },
  { account_id: "acc_card", name: "Business Card", mask: "9999", type: "credit", subtype: "credit card", balances: { current: 250.25, available: 4749.75, iso_currency_code: "USD" } },
];

let n = 0;
const tx = (fecha: string, amount: number, descripcion: string, extra: Partial<PlaidTransaccion> = {}): PlaidTransaccion => ({
  transaction_id: `plaid_tx_${++n}`, account_id: "acc_chk", amount, iso_currency_code: "USD", date: fecha, name: descripcion.split(" ")[0], original_description: descripcion, pending: false, ...extra,
});

const WIRE_ENTRA = "WIRE TYPE:WIRE IN DATE: 261027 TIME:1119 ET TRN:2026102700000001 SEQ:00000000000/001245 ORIG:APICANTA LLC ID:000000000001 SND BK:CHOICE FINANCIAL GROUP ID:000000000 PMT DET:internal transfer between apicantallc account";
const STRIPE = "STRIPE DES:TRANSFER ID:ST-AAAAAAAAAAAA INDN:APICANTA LLC CO ID:0000000000 CCD";
const WHOP = "Whop Inc DES:Whop Inc/p ID:0000000_000 INDN:APICANTA LLC CO ID:0000000000 PPD";
const DEPOSITO = "BKOFAMERICA BC 10/27 #000000001 FR CHKG 1 MAIN ST MIAMI FL";

const base = (gastos: Gasto[] = []): EstadoApp => {
  const s = construirSemilla() as EstadoApp;
  return {
    ...s, gastos, ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio: 1450 },
    equipo: [{ id: "eq_angelo", nombre: "Angelo Nisi", rol: "growth", comisionRate: 0, activo: true, sinComision: false }] as EstadoApp["equipo"],
  };
};

test("el signo de Plaid se da vuelta una vez: lo que sale es negativo, lo que entra positivo; no entra lo pending, lo que no es dólar ni lo de monto cero", () => {
  const filas = filasBofaDePlaid([
    tx("2026-10-28", 15, "Wire Transfer Fee"),
    tx("2026-10-29", -7396.51, WHOP),
    tx("2026-10-30", 20, "CHECKCARD 1030 NOTION LABS INC NOTION.SO CA", { pending: true }),
    tx("2026-10-30", 30, "CHECKCARD 1030 EN EUROS", { iso_currency_code: "EUR" }),
    tx("2026-10-30", 0, "AJUSTE EN CERO"),
  ], CUENTAS);
  assert.deepEqual(filas.map((x) => [x.fila.fecha, x.fila.monto, x.fila.origen]), [["2026-10-28", -15, "cuenta"], ["2026-10-29", 7396.51, "cuenta"]]);
  /* Para mirar la cuenta, lo pending sí se muestra (marcado). */
  assert.equal(filasBofaDePlaid([tx("2026-10-30", 20, "NOTION", { pending: true })], CUENTAS, { pendientes: true }).length, 1);
  /* Lo de una tarjeta de crédito se lee como el archivo de la tarjeta. */
  assert.equal(filasBofaDePlaid([tx("2026-10-30", 5.3, "STARBUCKS STORE 1", { account_id: "acc_card" })], CUENTAS)[0].fila.origen, "tarjeta");
});

test("los iguales del mismo día son dos movimientos y llevan su número, en un orden que no cambia entre lecturas", () => {
  const a = tx("2026-10-02", 23.98, "CHECKCARD 1001 UBER *TRIP HELP.UBER.COM CA");
  const b = tx("2026-10-02", 23.98, "CHECKCARD 1001 UBER *TRIP HELP.UBER.COM CA");
  const uno = filasBofaDePlaid([a, b], CUENTAS).map((x) => refDeBofa(x.fila));
  const otro = filasBofaDePlaid([b, a], CUENTAS).map((x) => refDeBofa(x.fila));
  assert.equal(new Set(uno).size, 2);
  assert.deepEqual([...uno].sort(), [...otro].sort(), "sale lo mismo aunque Plaid los mande en otro orden");
});

test("«Qué pasó en la cuenta»: cada movimiento con su tipo y la misma referencia con la que se guarda el gasto", () => {
  const movs = movimientosDelBancoDePlaid([
    tx("2026-10-27", -18302, WIRE_ENTRA), tx("2026-10-27", -100, DEPOSITO), tx("2026-10-28", -4038.26, STRIPE), tx("2026-10-28", 15, "Wire Transfer Fee"),
    tx("2026-10-29", 23.98, "CHECKCARD 1029 UBER *TRIP HELP.UBER.COM CA"), tx("2026-10-30", 500, "Zelle payment to Angelo Nisi Conf# abc"),
    tx("2026-10-31", 1658.48, "BANK OF AMERICA CREDIT CARD Bill Payment"), tx("2026-11-02", 20, "CHECKCARD 1102 NOTION", { pending: true }),
  ], CUENTAS);
  const tipo = (txt: RegExp) => movs.find((m) => txt.test(m.detalle ?? m.contraparte))!;
  assert.equal(tipo(/WIRE IN/).tipo, "pase");
  assert.equal(tipo(/STRIPE/).tipo, "pase");
  assert.equal(tipo(/BKOFAMERICA/).tipo, "entrada");
  assert.equal(tipo(/Wire Transfer Fee/).tipo, "comision");
  assert.equal(tipo(/UBER/).tipo, "compra-tarjeta");
  assert.equal(tipo(/Zelle/).tipo, "salida");
  assert.equal(tipo(/CREDIT CARD/).tipo, "pago-tarjeta");
  assert.equal(tipo(/NOTION/).pendiente, true);
  assert.equal(tipo(/WIRE IN/).monto, 18302);
  assert.ok(movs.every((m) => m.cuentaId === "proc_bofa" && m.ref.startsWith("bofa:") && m.refApp.length === 1));
  assert.deepEqual(movs.map((m) => m.fecha), [...movs.map((m) => m.fecha)].sort().reverse(), "los más nuevos primero");
});

test("cargar solo: sale de la cuenta Bank of America, de a uno, con su categoría; lo que no es gasto queda afuera y el pago al equipo va marcado", () => {
  const e = base();
  const r = gastosAutomaticos([
    tx("2026-10-27", -18302, WIRE_ENTRA), tx("2026-10-28", -4038.26, STRIPE), tx("2026-10-29", -7396.51, WHOP), tx("2026-10-28", 15, "Wire Transfer Fee"),
    tx("2026-10-29", 23.98, "CHECKCARD 1029 UBER *TRIP HELP.UBER.COM CA"), tx("2026-10-29", 23.98, "CHECKCARD 1029 UBER *TRIP HELP.UBER.COM CA"),
    tx("2026-10-30", 500, "Zelle payment to Angelo Nisi Conf# abc"), tx("2026-10-31", 1658.48, "BANK OF AMERICA CREDIT CARD Bill Payment"),
    tx("2026-11-02", 20, "CHECKCARD 1102 NOTION", { pending: true }),
  ], CUENTAS, e, { desde: "2026-10-26", ahora: new Date("2026-11-03T15:00:00.000Z") });
  assert.equal(r.gastos.length, 4, "la comisión, los dos Uber y el pago a Angelo; lo pending no, y lo demás queda afuera");
  assert.equal(r.afuera, 4, "wire que entra, Stripe, Whop y el pago de la tarjeta");
  assert.ok(r.gastos.every((g) => g.extra.cuenta === "Bank of America" && g.moneda === "USD" && g.extra.origen === "bofa-plaid" && g.extra.cargaAutomatica === true));
  assert.equal(new Set(r.gastos.map((g) => g.id)).size, 4, "cada gasto con su propio id, también los dos Uber iguales");
  assert.ok(r.gastos.every((g) => g.id === idDeGastoDeBanco(String(g.extra.bancoRef))));
  assert.deepEqual(r.gastos.filter((g) => g.extra.pagoDeEquipo === true).map((g) => g.monto), [500]);
  assert.ok(r.gastos.every((g) => g.categoria), "todos con categoría (si no se sabe, «Pendiente de revisión»)");
  const comision = r.gastos.find((g) => /Wire Transfer Fee/.test(g.concepto))!;
  assert.equal(comision.monto, 15);
});

test("pasar otra vez por lo mismo no carga nada más: ya están por su referencia, y un gasto cargado a mano o con el CSV se reconoce", () => {
  const ts = [tx("2026-10-28", 15, "Wire Transfer Fee"), tx("2026-10-29", 23.98, "CHECKCARD 1029 UBER *TRIP HELP.UBER.COM CA")];
  const opciones = { desde: "2026-10-26", ahora: new Date("2026-11-03T15:00:00.000Z") };
  const primera = gastosAutomaticos(ts, CUENTAS, base(), opciones);
  assert.equal(primera.gastos.length, 2);
  const segunda = gastosAutomaticos(ts, CUENTAS, base(primera.gastos), opciones);
  assert.equal(segunda.gastos.length, 0);
  assert.equal(segunda.yaCargados, 2);
  /* El mismo Uber cargado antes por el CSV del banco (otra referencia: el texto del CSV no es idéntico) y otro cargado a mano un día antes. */
  const csv = ["Date,Description,Amount,Running Bal.", '10/29/2026,"CHECKCARD 1029 UBER *TRIP HELP.UBER.COM CA 24692165275100012345678","-23.98","100.00"'].join("\n");
  const delCsv = armarFilas(parsearPegado(csv), [], false, { e: base() }).filter((f) => f.incluir).map((f, i): Gasto => ({
    id: `csv${i}`, categoria: "Viáticos equipo", grupo: "operativo", concepto: f.concepto, monto: 23.98, moneda: "USD", fecha: `${f.fecha}T15:00:00.000Z`, recurrente: false, creadoEn: "2026-11-03T12:00:00.000Z", extra: f.extraGasto ?? {},
  } as Gasto));
  assert.equal(gastosAutomaticos([ts[1]], CUENTAS, base(delCsv), opciones).gastos.length, 0, "el del CSV no se repite");
  const aMano = { id: "m1", categoria: "Software", grupo: "operativo", concepto: "Uber", monto: 23.98, moneda: "USD", fecha: "2026-10-28T15:00:00.000Z", recurrente: false, creadoEn: "2026-10-28T15:00:00.000Z", extra: {} } as Gasto;
  assert.equal(gastosAutomaticos([ts[1]], CUENTAS, base([aMano]), opciones).gastos.length, 0, "el cargado a mano un día antes tampoco");
});

test("no carga nada anterior al día desde el que se conectó", () => {
  const r = gastosAutomaticos([tx("2026-10-10", 15, "Wire Transfer Fee"), tx("2026-11-01", 20, "CHECKCARD 1101 NOTION LABS INC NOTION.SO CA")], CUENTAS, base(), { desde: "2026-10-26", ahora: new Date("2026-11-03T15:00:00.000Z") });
  assert.deepEqual(r.gastos.map((g) => g.monto), [20]);
});

/* ---------- Con Plaid y la base de mentira ---------- */

type Fila = Record<string, unknown>;
/** Una base en memoria con lo justo del cliente de Supabase que usa el servidor: select, eq, maybeSingle, update, delete y upsert con select. */
function baseFalsa(tablas: Record<string, Fila[]>) {
  const llamadas: string[] = [];
  const db = {
    from(nombre: string) {
      const filas = (tablas[nombre] ??= []);
      let modo: "select" | "update" | "delete" | "upsert" = "select";
      let cambios: Fila = {};
      let filtro: [string, unknown] | null = null;
      let subidas: Fila[] = [];
      let opciones: { ignoreDuplicates?: boolean } = {};
      const coincide = (f: Fila) => !filtro || f[filtro[0]] === filtro[1];
      const ejecutar = () => {
        llamadas.push(`${modo}:${nombre}`);
        if (modo === "update") { filas.filter(coincide).forEach((f) => Object.assign(f, cambios)); return { data: null, error: null }; }
        if (modo === "delete") { tablas[nombre] = filas.filter((f) => !coincide(f)); return { data: null, error: null }; }
        if (modo === "upsert") {
          const nuevas: Fila[] = [];
          for (const s of subidas) {
            const i = filas.findIndex((f) => f.id === s.id);
            if (i >= 0) { if (!opciones.ignoreDuplicates) filas[i] = { ...filas[i], ...s }; } else { filas.push(s); nuevas.push(s); }
          }
          return { data: opciones.ignoreDuplicates ? nuevas : subidas, error: null };
        }
        return { data: filas.filter(coincide), error: null };
      };
      const cadena = {
        select: () => cadena, eq: (c: string, v: unknown) => { filtro = [c, v]; return cadena; },
        update: (c: Fila) => { modo = "update"; cambios = c; return cadena; }, delete: () => { modo = "delete"; return cadena; },
        upsert: (s: Fila | Fila[], o: { ignoreDuplicates?: boolean } = {}) => { modo = "upsert"; subidas = Array.isArray(s) ? s : [s]; opciones = o; return cadena; },
        maybeSingle: async () => { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: null }; },
        then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, no),
      };
      return cadena;
    },
  };
  return { db: db as unknown as Parameters<typeof conexion>[0], tablas, llamadas };
}

interface LlamadaPlaid { ruta: string; cuerpo: Record<string, unknown>; host: string; cabeceras: Record<string, string> }
/** Reemplaza fetch: contesta como Plaid según la ruta. Una respuesta puede ser un error de Plaid ({ status, error_code }). */
function fingirPlaid(respuestas: Record<string, (cuerpo: Record<string, unknown>) => { status?: number; json: unknown }>) {
  const llamadas: LlamadaPlaid[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const cuerpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const ruta = u.pathname.slice(1);
    llamadas.push({ ruta, cuerpo, host: u.origin, cabeceras: init?.headers as Record<string, string> });
    const f = respuestas[ruta];
    const r = f ? f(cuerpo) : { status: 404, json: { error_code: "NO_FINGIDA", error_message: ruta } };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

const conClaves = async (entorno: string | undefined, fn: () => Promise<void>) => {
  const antes = { c: process.env.PLAID_CLIENT_ID, s: process.env.PLAID_SECRET, e: process.env.PLAID_ENV };
  process.env.PLAID_CLIENT_ID = "cliente-de-prueba"; process.env.PLAID_SECRET = "secreto-de-prueba";
  if (entorno === undefined) delete process.env.PLAID_ENV; else process.env.PLAID_ENV = entorno;
  try { await fn(); } finally {
    for (const [k, v] of [["PLAID_CLIENT_ID", antes.c], ["PLAID_SECRET", antes.s], ["PLAID_ENV", antes.e]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

const FILA_DE_CONEXION = (extra: Fila = {}): Fila => ({
  id: "bofa", accessToken: "access-sandbox-secreto", itemId: "item_1", institucion: "Bank of America", cuentas: [], autoCargar: true,
  desdeAuto: "2026-10-26T00:00:00.000Z", pideReautorizar: false, ultimaLectura: null, ultimoError: null, ultimosCargados: 0, conectadoPor: "yari@apicanta.com", conectadoEn: "2026-11-03T12:00:00.000Z", ...extra,
});

test("conectar: el permiso de un solo uso se cambia por el permanente, que se guarda y nunca vuelve a la pantalla", async () => {
  await conClaves(undefined, async () => {
    const { db, tablas } = baseFalsa({ conexion_bancaria: [] });
    const plaid = fingirPlaid({
      "item/public_token/exchange": () => ({ json: { access_token: "access-sandbox-nuevo", item_id: "item_2" } }),
      "accounts/get": () => ({ json: { accounts: CUENTAS } }),
    });
    try {
      const estado = await guardarConexion("public-sandbox-abc-123", "Bank of America", "yari@apicanta.com", db);
      assert.equal(tablas.conexion_bancaria.length, 1);
      assert.equal(tablas.conexion_bancaria[0].accessToken, "access-sandbox-nuevo");
      assert.deepEqual(estado.cuentas.map((c) => [c.nombre, c.mascara, c.tipo]), [["BUSINESS ADV FUNDAMENTALS", "0001", "depository"], ["Business Card", "9999", "credit"]]);
      assert.ok(!("accessToken" in estado) && !("itemId" in estado), "la pantalla nunca recibe el permiso");
      assert.ok(!JSON.stringify(estado).includes("access-sandbox"));
      assert.equal(estado.autoCargar, true);
      /* Sin PLAID_ENV se habla con el banco de prueba de Plaid, nunca con el real. */
      assert.ok(plaid.llamadas.every((l) => l.host === "https://sandbox.plaid.com"));
      assert.equal(plaid.llamadas[0].cabeceras["PLAID-CLIENT-ID"], "cliente-de-prueba");
      assert.equal(plaid.llamadas[0].cabeceras["PLAID-SECRET"], "secreto-de-prueba");
    } finally { plaid.restaurar(); }
  });
});

test("volver a conectar con otro item da de baja el permiso viejo (se factura por conexión); con el mismo, no", async () => {
  await conClaves("production", async () => {
    const { db } = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION({ autoCargar: false })] });
    const plaid = fingirPlaid({
      "item/public_token/exchange": () => ({ json: { access_token: "access-production-nuevo", item_id: "item_otro" } }),
      "accounts/get": () => ({ json: { accounts: CUENTAS } }),
      "item/remove": () => ({ json: {} }),
    });
    try {
      const estado = await guardarConexion("public-production-xyz-9", "", "manu@apicanta.com", db);
      assert.ok(plaid.llamadas.some((l) => l.ruta === "item/remove" && l.cuerpo.access_token === "access-sandbox-secreto"));
      assert.ok(plaid.llamadas.every((l) => l.host === "https://production.plaid.com"));
      assert.equal(estado.autoCargar, false, "lo que alguien apagó sigue apagado");
      assert.equal(estado.desdeAuto, "2026-10-26T00:00:00.000Z", "no se vuelve a mirar todo el historial");
      assert.equal(estado.institucion, "Bank of America");
    } finally { plaid.restaurar(); }
    /* Si la que se volvió a autorizar es la misma conexión, el permiso viejo sigue valiendo: no se da de baja. */
    const misma = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION()] });
    const igual = fingirPlaid({
      "item/public_token/exchange": () => ({ json: { access_token: "access-production-renovado", item_id: "item_1" } }),
      "accounts/get": () => ({ json: { accounts: CUENTAS } }),
    });
    try {
      await guardarConexion("public-production-xyz-9", "Bank of America", "manu@apicanta.com", misma.db);
      assert.ok(!igual.llamadas.some((l) => l.ruta === "item/remove"));
      assert.equal(misma.tablas.conexion_bancaria[0].accessToken, "access-production-renovado");
    } finally { igual.restaurar(); }
  });
});

test("desconectar le avisa a Plaid y borra el permiso, aunque Plaid no conteste", async () => {
  await conClaves("production", async () => {
    const { db, tablas } = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION()] });
    const plaid = fingirPlaid({ "item/remove": () => ({ status: 500, json: { error_code: "INTERNAL_SERVER_ERROR", error_message: "x" } }) });
    try {
      await desconectar(db);
      assert.equal(tablas.conexion_bancaria.length, 0);
      assert.equal(plaid.llamadas[0].ruta, "item/remove");
    } finally { plaid.restaurar(); }
  });
});

test("la ventana de Plaid: un permiso nuevo pide transacciones; volver a autorizar usa el permiso que ya hay, sin productos", async () => {
  await conClaves("production", async () => {
    const { db } = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION()] });
    const plaid = fingirPlaid({ "link/token/create": () => ({ json: { link_token: "link-production-1" } }) });
    try {
      assert.equal(await crearLinkToken("yari", false, db), "link-production-1");
      assert.deepEqual(plaid.llamadas[0].cuerpo.products, ["transactions"]);
      assert.equal(plaid.llamadas[0].cuerpo.access_token, undefined);
      assert.deepEqual(plaid.llamadas[0].cuerpo.country_codes, ["US"]);
      await crearLinkToken("yari", true, db);
      assert.equal(plaid.llamadas[1].cuerpo.access_token, "access-sandbox-secreto");
      assert.equal(plaid.llamadas[1].cuerpo.products, undefined);
    } finally { plaid.restaurar(); }
  });
});

test("sin conexión o sin claves, nada se lee ni se carga y nada falla", async () => {
  const { db } = baseFalsa({ conexion_bancaria: [] });
  assert.equal(await conexion(db), null);
  assert.deepEqual(await movimientosDeBofa(new Date("2026-10-01"), db), { movimientos: [], avisos: [], conectada: false });
  assert.equal(await saldoDeBofa(db), null);
  assert.equal((await cargarGastosDelBanco(db)).estado, "no-conectada");
  await conClaves("production", async () => {
    assert.equal((await cargarGastosDelBanco(db)).estado, "no-conectada", "con claves pero sin cuenta conectada");
  });
});

test("el cron: trae lo asentado, carga los gastos que faltan una sola vez y anota la lectura", async () => {
  await conClaves("production", async () => {
    const s = construirSemilla() as EstadoApp;
    const { db, tablas } = baseFalsa({
      conexion_bancaria: [FILA_DE_CONEXION()], gastos: [], equipo: s.equipo as unknown as Fila[], procesadores: s.procesadores as unknown as Fila[],
      ajustes: [{ id: 1, ...s.ajustes, monedaBase: "USD", tipoCambio: 1450 } as unknown as Fila],
    });
    const lista = [tx("2026-10-28", 15, "Wire Transfer Fee"), tx("2026-10-28", -4038.26, STRIPE), tx("2026-11-02", 20, "CHECKCARD 1102 NOTION", { pending: true })];
    const plaid = fingirPlaid({ "transactions/get": () => ({ json: { transactions: lista, accounts: CUENTAS, total_transactions: lista.length } }) });
    try {
      const ahora = new Date("2026-11-03T15:00:00.000Z");
      const r = await cargarGastosDelBanco(db, ahora);
      assert.deepEqual([r.estado, r.cargados], ["ok", 1]);
      assert.equal(tablas.gastos.length, 1);
      assert.equal(tablas.gastos[0].monto, 15);
      assert.equal((tablas.gastos[0].extra as Fila).origen, "bofa-plaid");
      assert.equal(tablas.conexion_bancaria[0].ultimaLectura, ahora.toISOString());
      assert.equal(tablas.conexion_bancaria[0].ultimosCargados, 1);
      const pedido = plaid.llamadas[0].cuerpo as { start_date: string; options: { include_original_description: boolean } };
      assert.equal(pedido.start_date, "2026-10-26", "desde que se conectó, no 45 días atrás");
      assert.equal(pedido.options.include_original_description, true);
      /* La pasada de la hora siguiente no repite nada. */
      const otra = await cargarGastosDelBanco(db, new Date("2026-11-03T16:00:00.000Z"));
      assert.deepEqual([otra.estado, otra.cargados], ["ok", 0]);
      assert.equal(tablas.gastos.length, 1);
      /* Apagada, no carga; «Traer ahora» sí. */
      tablas.conexion_bancaria[0].autoCargar = false;
      assert.equal((await cargarGastosDelBanco(db, new Date("2026-11-03T17:00:00.000Z"))).estado, "apagada");
      assert.equal((await cargarGastosDelBanco(db, new Date("2026-11-03T17:00:00.000Z"), { aunqueEsteApagada: true })).estado, "ok");
    } finally { plaid.restaurar(); }
  });
});

test("si Bank of America pide volver a entrar, queda anotado y la pantalla lo dice; si Plaid todavía arma el historial, no es un error", async () => {
  await conClaves("production", async () => {
    const s = construirSemilla() as EstadoApp;
    const { db, tablas } = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION()], gastos: [], equipo: [], procesadores: s.procesadores as unknown as Fila[], ajustes: [] });
    let error = "ITEM_LOGIN_REQUIRED";
    const plaid = fingirPlaid({ "transactions/get": () => ({ status: 400, json: { error_type: "ITEM_ERROR", error_code: error, error_message: "x" } }) });
    try {
      const r = await cargarGastosDelBanco(db, new Date("2026-11-03T15:00:00.000Z"));
      assert.equal(r.estado, "error");
      assert.match(r.mensaje ?? "", /volver a autorizar/i);
      assert.equal(tablas.conexion_bancaria[0].pideReautorizar, true);
      assert.match(String(tablas.conexion_bancaria[0].ultimoError), /volver a autorizar/i);
      const m = await movimientosDeBofa(new Date("2026-10-26"), db).catch((e: Error) => e);
      assert.ok(m instanceof Error && /volver a autorizar/i.test(m.message));
      error = "PRODUCT_NOT_READY";
      tablas.conexion_bancaria[0].pideReautorizar = false;
      const listo = await cargarGastosDelBanco(db, new Date("2026-11-03T16:00:00.000Z"));
      assert.deepEqual([listo.estado, listo.cargados], ["ok", 0]);
      const mov = await movimientosDeBofa(new Date("2026-10-26"), db);
      assert.equal(mov.conectada, true);
      assert.match(mov.avisos.join(" "), /todavía está trayendo/i);
    } finally { plaid.restaurar(); }
  });
});

test("el saldo real: lo que hay en la cuenta (en vivo), con lo que se debe de la tarjeta aparte; si el banco no da el saldo en vivo, el guardado, avisándolo", async () => {
  await conClaves("production", async () => {
    const { db } = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION()] });
    const enVivo = fingirPlaid({ "accounts/balance/get": () => ({ json: { accounts: CUENTAS } }) });
    try {
      const s = (await saldoDeBofa(db))!;
      assert.deepEqual([s.cuentaId, s.saldo, s.moneda], ["proc_bofa", 1000.5, "USD"]);
      assert.equal(s.pendientes?.tarjeta, 250.25);
      assert.equal(s.nota, undefined);
      assert.match(s.fuente, /Bank of America/);
    } finally { enVivo.restaurar(); }
    const guardado = fingirPlaid({
      "accounts/balance/get": () => ({ status: 400, json: { error_code: "PRODUCTS_NOT_SUPPORTED", error_message: "x" } }),
      "accounts/get": () => ({ json: { accounts: [CUENTAS[0]] } }),
    });
    try {
      const s = (await saldoDeBofa(db))!;
      assert.equal(s.saldo, 1000.5);
      assert.equal(s.pendientes, undefined);
      assert.match(s.nota ?? "", /unas horas/);
    } finally { guardado.restaurar(); }
  });
});

test("las transacciones se piden de a 500 hasta traerlas todas", async () => {
  await conClaves("production", async () => {
    const { db } = baseFalsa({ conexion_bancaria: [FILA_DE_CONEXION()] });
    const total = 730;
    const plaid = fingirPlaid({
      "transactions/get": (c) => {
        const desde = Number((c.options as { offset: number }).offset);
        const lote = Array.from({ length: Math.min(500, total - desde) }, (_, i) => tx("2026-10-28", 1 + i, `COMPRA ${desde + i}`));
        return { json: { transactions: lote, accounts: CUENTAS, total_transactions: total } };
      },
    });
    try {
      const c = (await conexion(db))!;
      const r = await transaccionesDe(c, new Date("2026-10-01"), db, new Date("2026-11-03"));
      assert.equal(r.transacciones.length, total);
      assert.equal(plaid.llamadas.length, 2);
      assert.deepEqual(sinElPermiso(c).cuentas, []);
    } finally { plaid.restaurar(); }
  });
});

test("«Qué pasó en la cuenta»: el depósito de Stripe ya está como pase si la app dio por llegado su retiro; el de Whop, que nadie cargó, falta", () => {
  const e = base();
  const retiro: Traspaso = {
    id: "tr_stripe_1", fecha: "2026-10-27T15:00:00.000Z", origenId: "proc_stripe", destinoId: "proc_bofa", montoSale: 4038.26, monedaSale: "USD", montoLlega: 4038.26, monedaLlega: "USD",
    estado: "confirmado", salidaRef: "stripe:po_AAA", contraparte: "STRIPE", origen: "api", creadoEn: "2026-10-27T16:00:00.000Z",
  };
  const movs = movimientosDelBancoDePlaid([tx("2026-10-28", -4038.26, STRIPE), tx("2026-10-29", -7396.51, WHOP)], CUENTAS);
  const cruzados = cruzarConLaApp({ ...e, movimientos: [], traspasos: [retiro], devoluciones: [] }, movs);
  const stripe = cruzados.find((m) => m.monto === 4038.26)!;
  assert.equal(stripe.estadoApp, "cargado");
  assert.match(stripe.donde ?? "", /dio por llegado/);
  assert.equal(stripe.traspasoId, "tr_stripe_1");
  assert.equal(cruzados.find((m) => m.monto === 7396.51)!.estadoApp, "falta");
  /* Un retiro ya visto llegar por otro lado (tiene su llegada) no se vuelve a usar para otro depósito igual. */
  const conLlegada = cruzarConLaApp({ ...e, movimientos: [], traspasos: [{ ...retiro, llegadaRef: "mercury:xyz" }], devoluciones: [] }, movs);
  assert.equal(conLlegada.find((m) => m.monto === 4038.26)!.estadoApp, "falta");
});
