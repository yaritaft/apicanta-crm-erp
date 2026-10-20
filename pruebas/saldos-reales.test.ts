import test from "node:test";
import assert from "node:assert/strict";
import { controlarSaldos, quePasa, saldoDeBilleteraEn, type SaldoReal, type Transferencia } from "@/lib/saldos-reales";
import { cuentaDeGasto, gastosSinCuenta, saldosEsperados } from "@/lib/traspasos";
import { ESPERAS_DE_TRON, saldoDeMercury, saldoDeStripe, saldoDeTrust, saldosReales } from "@/lib/pasarelas-api";
import { GET as rutaDeSaldos } from "@/app/api/pasarelas/saldos/route";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto } from "@/lib/types";

/* Aldana (20/10): el saldo de USDT Trust se sabe exacto (la red es pública) y el arqueo tiene que compararlo solo con lo que la app
   esperaba: si no da, falta cargar algo. */

const ARG = (dia: string) => Date.parse(`${dia}T23:59:59-03:00`);
const MI_BILLETERA = "TArDsU3C6Hb7NdeNUoPvEvgixR36FeGajR";

/* Los movimientos reales de la billetera (red pública) desde el 28/09; hoy tiene 27.121,058672. */
const REALES: Transferencia[] = [
  { de: "TJ7hhYhVhaxNx6BPyq7yFpqZrQULL3JSdb", a: MI_BILLETERA, micro: 125_000_000, ts: Date.parse("2026-10-04T17:03:09Z") },
  { de: "TJ7hhYhVhaxNx6BPyq7yFpqZrQULL3JSdb", a: MI_BILLETERA, micro: 60_500_000, ts: Date.parse("2026-10-06T17:14:33Z") },
  { de: "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf", a: MI_BILLETERA, micro: 2_698_500_000, ts: Date.parse("2026-10-09T16:59:00Z") },
  { de: "TTRMwhxtUdgykYPoeq6eEUKLmj26Y4KtcG", a: MI_BILLETERA, micro: 99_370_000, ts: Date.parse("2026-10-16T18:22:00Z") },
  { de: "TTRMwhxtUdgykYPoeq6eEUKLmj26Y4KtcG", a: MI_BILLETERA, micro: 1_150_000_000, ts: Date.parse("2026-10-20T00:11:00Z") },
];
const HOY_MICRO = 27_121_058_672;

test("saldo de la billetera en un día pasado: el de hoy menos lo que entró después (los números reales de Aldana)", () => {
  assert.equal(saldoDeBilleteraEn(HOY_MICRO, REALES, MI_BILLETERA, null), 27121.06, "ahora");
  assert.equal(saldoDeBilleteraEn(HOY_MICRO, REALES, MI_BILLETERA, ARG("2026-09-28")), 22987.69, "cierre del 28/09 (su planilla decía 22.978,55)");
  assert.equal(saldoDeBilleteraEn(HOY_MICRO, REALES, MI_BILLETERA, ARG("2026-10-07")), 23173.19, "cierre del 07/10 (su planilla decía 23.159,25)");
  assert.equal(saldoDeBilleteraEn(HOY_MICRO, REALES, MI_BILLETERA, ARG("2026-10-12")), 25871.69);
  assert.equal(saldoDeBilleteraEn(HOY_MICRO, REALES, MI_BILLETERA, ARG("2026-10-19")), 27121.06, "la entrada de 1.150 es de las 21:11 del 19/10 (00:11 UTC del 20): entra en el 19");
  /* Lo que salió después se suma de vuelta; lo que va de la billetera a sí misma no cambia nada. */
  const conSalida: Transferencia[] = [...REALES, { de: MI_BILLETERA, a: "TXXX", micro: 500_000_000, ts: Date.parse("2026-10-15T12:00:00Z") }, { de: MI_BILLETERA, a: MI_BILLETERA, micro: 9_000_000, ts: Date.parse("2026-10-15T13:00:00Z") }];
  assert.equal(saldoDeBilleteraEn(HOY_MICRO - 500_000_000, conSalida, MI_BILLETERA, ARG("2026-10-12")), 25871.69);
  assert.equal(saldoDeBilleteraEn(0, [], MI_BILLETERA, ARG("2026-10-12")), 0, "una billetera vacía");
});

const procs = [
  { id: "proc_mercury", nombre: "ACH-WIRE Mercury" }, { id: "proc_stripe", nombre: "Stripe" }, { id: "proc_trust", nombre: "USDT Trust" },
  { id: "proc_financiera", nombre: "Financiera" }, { id: "proc_financiera_ars", nombre: "Financiera ARS Juan" }, { id: "proc_financiera_usd", nombre: "Financiera USD Juan" },
];

test("de qué cuenta salió un gasto: el id exacto, el nombre entero o una palabra del nombre de una sola cuenta; si no, no se sabe", () => {
  const c = (extra: Record<string, unknown>) => cuentaDeGasto({ extra }, procs);
  assert.equal(c({ cuentaId: "proc_x" }), "proc_x", "el id manda");
  assert.equal(c({ cuenta: "Mercury" }), "proc_mercury", "«Mercury» es una palabra de «ACH-WIRE Mercury»");
  assert.equal(c({ cuenta: "ach-wire mercury" }), "proc_mercury");
  assert.equal(c({ cuenta: "Stripe" }), "proc_stripe");
  assert.equal(c({ cuenta: "usdt trust" }), "proc_trust");
  assert.equal(c({ cuenta: "Financiera ARS Juan" }), "proc_financiera_ars", "el nombre entero gana aunque otras lo contengan");
  assert.equal(c({ cuenta: "Financiera" }), "proc_financiera", "igual a una sola");
  assert.equal(c({ cuenta: "Juan" }), undefined, "«Juan» está en dos cuentas");
  assert.equal(c({ cuenta: "Banco inventado" }), undefined);
  assert.equal(c({}), undefined);
  assert.equal(c({ cuenta: "   " }), undefined);
});

const DIA = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const gasto = (id: string, monto: number, dia: string, extra: Record<string, unknown> = {}): Gasto => ({
  id, categoria: "Software", grupo: "operativo", concepto: id, monto, moneda: "USD", fecha: dia, recurrente: false, creadoEn: dia, extra,
});
const estado = (gastos: Gasto[], saldos: { procesadorId: string; monto: number }[] = [{ procesadorId: "proc_mercury", monto: 1000 }, { procesadorId: "proc_trust", monto: 500 }]): EstadoApp => ({
  ...(construirSemilla() as EstadoApp), ventas: [], cuotas: [], pagos: [], movimientos: [], traspasos: [], devoluciones: [], gastos,
  arqueos: [{ id: "a1", fecha: "2026-10-07T23:00:00.000Z", saldos: saldos.map((s) => ({ ...s, moneda: "USD", montoBase: s.monto })), total: saldos.reduce((a, s) => a + s.monto, 0), creadoEn: "2026-10-07T23:00:00.000Z" }],
} as EstadoApp);

test("lo esperado por cuenta ahora descuenta los gastos que dicen de qué cuenta se pagaron, y cuenta los que no lo dicen", () => {
  const e = estado([
    gasto("uber", 30, DIA(10, 10), { cuenta: "Mercury" }),
    gasto("notion", 20, DIA(10, 11), { cuenta: "Mercury" }),
    gasto("viejo", 99, DIA(10, 3), { cuenta: "Mercury" }),          // antes del arqueo: ya estaba contado
    gasto("hotel", -80, DIA(10, 12), { cuenta: "Mercury", ingreso: true }), // plata que volvió
    gasto("sin", 45, DIA(10, 13)),
    gasto("sueldo", 10, DIA(10, 14), { cuenta: "Banco inventado" }),
  ]);
  const s = saldosEsperados(e, e.arqueos![0], "2026-10-20T18:00:00.000Z");
  assert.equal(s.get("proc_mercury")!.salio, -30, "30 + 20 − 80");
  assert.equal(s.get("proc_mercury")!.esperado, 1030);
  assert.equal(s.get("proc_trust")!.esperado, 500);
  assert.deepEqual(gastosSinCuenta(e, e.arqueos![0].fecha, "2026-10-20T18:00:00.000Z"), { n: 2, total: 55 }, "el que no dice cuenta y el de una cuenta que no existe");
});

const real = (cuentaId: string, saldo: number, extra: Partial<SaldoReal> = {}): SaldoReal => ({ cuentaId, saldo, moneda: "USD", al: "2026-10-20T18:00:00.000Z", fuente: "la fuente", ...extra });

test("control de saldos: da, sobra, falta o no hay con qué comparar; y la alarma salta si alguna no da", () => {
  const e = estado([gasto("uber", 30, DIA(10, 10), { cuenta: "Mercury" }), gasto("sin", 45, DIA(10, 13))]);
  const ahora = "2026-10-20T18:00:00.000Z";
  /* Mercury esperaba 970: hay 970 → da. */
  let c = controlarSaldos(e, [real("proc_mercury", 970)], ahora);
  assert.equal(c.filas[0].lectura, "da"); assert.equal(c.hayAlarma, false);
  assert.deepEqual(c.sinCuenta, { n: 1, total: 45 }); assert.equal(c.desde, e.arqueos![0].fecha);
  /* Hay 900: faltan 70 → falta cargar un gasto. */
  c = controlarSaldos(e, [real("proc_mercury", 900), real("proc_trust", 500.4)], ahora);
  assert.equal(c.filas[0].lectura, "falta"); assert.equal(c.filas[0].diferencia, -70); assert.equal(c.hayAlarma, true);
  assert.equal(c.filas[1].lectura, "da", "menos de un dólar de diferencia es lo mismo");
  assert.match(quePasa(c.filas[0]), /US\$\s*70.* menos de lo que la app esperaba: falta cargar un gasto, un retiro o un movimiento entre cuentas que salió de ACH-WIRE Mercury/);
  /* Hay 185,50 más en Trust: falta cargar un cobro o un movimiento que llegó. */
  c = controlarSaldos(e, [real("proc_trust", 685.5)], ahora);
  assert.equal(c.filas[0].lectura, "sobra"); assert.equal(c.filas[0].diferencia, 185.5);
  assert.match(quePasa(c.filas[0]), /más de lo que la app esperaba: falta cargar un cobro o un movimiento entre cuentas que llegó a USDT Trust/);
  /* Stripe no estaba en el arqueo: no hay con qué comparar, y eso no es una alarma. */
  c = controlarSaldos(e, [real("proc_stripe", 100)], ahora);
  assert.equal(c.filas[0].lectura, "sin-punto-de-partida"); assert.equal(c.hayAlarma, false);
  assert.match(quePasa(c.filas[0]), /Todavía no hay un arqueo de esta cuenta/);
  /* Sin ningún arqueo: no hay nada que comparar ni gastos sin cuenta que contar. */
  const sin = { ...e, arqueos: [] };
  const v = controlarSaldos(sin, [real("proc_trust", 10)], ahora);
  assert.equal(v.filas[0].lectura, "sin-punto-de-partida"); assert.deepEqual(v.sinCuenta, { n: 0, total: 0 }); assert.equal(v.desde, undefined);
});

/* ---------- Leer cada cuenta (con las respuestas de las API simuladas) ---------- */

const ENV = ["TRUST_WALLET_ADDRESS", "MERCURY_API_TOKEN", "STRIPE_SECRET_KEY", "TRONGRID_API_KEY"] as const;
async function conRespuestas<T>(env: Partial<Record<(typeof ENV)[number], string>>, rutas: (url: string, init?: RequestInit) => unknown, f: () => Promise<T>): Promise<{ r: T; pedidos: string[] }> {
  const antesEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const fetchOriginal = globalThis.fetch;
  const pedidos: string[] = [];
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, env);
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url); pedidos.push(u);
    const d = rutas(u, init) as { status?: number; cuerpo: unknown };
    return new Response(JSON.stringify(d.cuerpo), { status: d.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { return { r: await f(), pedidos }; } finally {
    globalThis.fetch = fetchOriginal;
    for (const k of ENV) { if (antesEnv[k] === undefined) delete process.env[k]; else process.env[k] = antesEnv[k]; }
  }
}

ESPERAS_DE_TRON.splice(0, ESPERAS_DE_TRON.length, 1, 1);
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const cuentaTron = { data: [{ trc20: [{ OTRO: "5" }, { [USDT]: String(HOY_MICRO) }] }] };
const mov = (de: string, a: string, micro: number, ts: number) => ({ from: de, to: a, value: String(micro), block_timestamp: ts });

test("USDT Trust: el saldo de hoy sale de la red; el de un día pasado, de lo movido desde entonces (con varias páginas)", async () => {
  const tienePag2 = (u: string) => u.includes("fingerprint=pag2");
  const rutas = (u: string) => {
    if (/\/v1\/accounts\/[^/?]+\?/.test(u)) return { cuerpo: cuentaTron };
    if (tienePag2(u)) return { cuerpo: { data: REALES.slice(2).map((t) => mov(t.de, t.a, t.micro, t.ts)), meta: {} } };
    return { cuerpo: { data: REALES.slice(0, 2).map((t) => mov(t.de, t.a, t.micro, t.ts)), meta: { fingerprint: "pag2" } } };
  };
  const hoy = await conRespuestas({ TRUST_WALLET_ADDRESS: MI_BILLETERA }, rutas, () => saldoDeTrust());
  assert.equal(hoy.r!.saldo, 27121.06); assert.equal(hoy.r!.cuentaId, "proc_trust"); assert.equal(hoy.pedidos.length, 1, "sólo el saldo, sin movimientos");
  assert.match(hoy.pedidos[0], /only_confirmed=true/);
  const pasado = await conRespuestas({ TRUST_WALLET_ADDRESS: MI_BILLETERA, TRONGRID_API_KEY: "clave" }, rutas, () => saldoDeTrust(new Date(ARG("2026-09-28"))));
  assert.equal(pasado.r!.saldo, 22987.69);
  assert.equal(pasado.pedidos.length, 3, "el saldo y dos páginas de movimientos");
  assert.ok(pasado.pedidos[1].includes(`min_timestamp=${ARG("2026-09-28") + 1}`));
  assert.equal(pasado.r!.al, new Date(ARG("2026-09-28")).toISOString());
  const sin = await conRespuestas({}, () => ({ cuerpo: {} }), () => saldoDeTrust());
  assert.equal(sin.r, null, "sin la billetera configurada no hay nada que leer"); assert.equal(sin.pedidos.length, 0);
  await assert.rejects(conRespuestas({ TRUST_WALLET_ADDRESS: "TConError3333333333333333333333333333" }, () => ({ status: 403, cuerpo: { error: "clave inválida" } }), () => saldoDeTrust()), /TronGrid \(saldo\) respondió 403/);
  /* Una cuenta nueva, sin nada: saldo cero. */
  const vacia = await conRespuestas({ TRUST_WALLET_ADDRESS: "TCuentaNueva444444444444444444444444" }, () => ({ cuerpo: { data: [] } }), () => saldoDeTrust());
  assert.equal(vacia.r!.saldo, 0);
});

test("Mercury suma las cuentas del banco sin las de crédito y avisa lo no acreditado; Stripe suma lo disponible y lo pendiente en dólares", async () => {
  const m = await conRespuestas({ MERCURY_API_TOKEN: "abc" }, (u, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret-token:abc", "completa el prefijo del token");
    return { cuerpo: { accounts: [
      { id: "a", kind: "checking", currentBalance: 70000.5, availableBalance: 69900.5 },
      { id: "b", kind: "savings", currentBalance: 3368.53, availableBalance: 3368.53 },
      { id: "c", kind: "creditCard", currentBalance: -2500, availableBalance: 10000 },
    ] } };
  }, () => saldoDeMercury());
  assert.equal(m.r!.saldo, 73369.03); assert.match(m.r!.nota ?? "", /US\$\s*73\.269,03 disponibles/);
  await assert.rejects(conRespuestas({ MERCURY_API_TOKEN: "abc" }, () => ({ cuerpo: { accounts: [{ id: "a", kind: "checking" }] } }), () => saldoDeMercury()), /no mandó el saldo/);
  await assert.rejects(conRespuestas({ MERCURY_API_TOKEN: "abc" }, () => ({ status: 401, cuerpo: { message: "no autorizado" } }), () => saldoDeMercury()), /Mercury \(cuentas\) respondió 401/);

  const s = await conRespuestas({ STRIPE_SECRET_KEY: "sk" }, () => ({ cuerpo: { available: [{ amount: 100050, currency: "usd" }, { amount: 5000, currency: "eur" }], pending: [{ amount: 25000, currency: "usd" }] } }), () => saldoDeStripe());
  assert.equal(s.r!.saldo, 1250.5); assert.match(s.r!.nota ?? "", /250,00 están pendientes/); assert.match(s.r!.nota ?? "", /EUR/);
  assert.equal((await conRespuestas({}, () => ({ cuerpo: {} }), () => saldoDeStripe())).r, null);
});

test("saldosReales: lo que no está conectado, lo que falla y lo que sólo se sabe de hoy viajan aparte y nadie tumba a nadie", async () => {
  const rutas = (u: string) => {
    if (u.includes("trongrid")) return { cuerpo: cuentaTron };
    if (u.includes("mercury")) return { status: 500, cuerpo: { message: "caído" } };
    return { cuerpo: {} };
  };
  const a = await conRespuestas({ TRUST_WALLET_ADDRESS: MI_BILLETERA, MERCURY_API_TOKEN: "abc" }, rutas, () => saldosReales());
  assert.deepEqual(a.r.saldos.map((s) => s.cuentaId), ["proc_trust"]);
  assert.deepEqual(a.r.errores.map((x) => x.cuentaId), ["proc_mercury"]); assert.match(a.r.errores[0].mensaje, /Mercury \(cuentas\) respondió 500/);
  assert.deepEqual(a.r.sinConexion, ["proc_stripe"]); assert.deepEqual(a.r.soloHoy, []);
  /* Pedir un día pasado: la red lo reconstruye; el banco y Stripe sólo dicen lo de ahora. */
  const b = await conRespuestas({ TRUST_WALLET_ADDRESS: MI_BILLETERA, MERCURY_API_TOKEN: "abc", STRIPE_SECRET_KEY: "sk" }, (u) => (u.includes("transactions/trc20") ? { cuerpo: { data: [], meta: {} } } : rutas(u)), () => saldosReales(undefined, new Date(Date.now() - 5 * 86400000)));
  assert.deepEqual(b.r.saldos.map((s) => s.cuentaId), ["proc_trust"]);
  assert.deepEqual(b.r.soloHoy.sort(), ["proc_mercury", "proc_stripe"]);
  assert.equal(b.pedidos.some((u) => u.includes("mercury") || u.includes("stripe")), false, "no se les pregunta lo que no pueden responder");
  /* Pedir sólo una; una desconocida se ignora. */
  const c = await conRespuestas({ TRUST_WALLET_ADDRESS: MI_BILLETERA }, rutas, () => saldosReales(["proc_trust", "proc_inventada"]));
  assert.deepEqual(c.r.saldos.map((s) => s.cuentaId), ["proc_trust"]); assert.deepEqual(c.r.errores, []);
});

test("la ruta de saldos no contesta nada sin una sesión del equipo (ni con basura)", async () => {
  const antes = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  try {
    for (const [url, anon] of [[undefined, undefined], ["http://127.0.0.1:1", "anon"]] as const) {
      if (url) { process.env.NEXT_PUBLIC_SUPABASE_URL = url; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon; } else { delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; }
      for (const cab of [{}, { authorization: "Bearer undefined" }, { authorization: "Bearer " }, { authorization: "basura" }] as Record<string, string>[]) {
        const r = await rutaDeSaldos(new Request("http://localhost/api/pasarelas/saldos?cuentas=proc_trust", { headers: cab }));
        assert.ok(r.status === 401 || r.status === 503, `sin credencial buena contestó ${r.status}`);
        const t = await r.text();
        assert.ok(!/saldo|USDT|\d{4,}/i.test(t.replace(/Hace falta iniciar sesión|No pudimos comprobar tu permiso, probá de nuevo/g, "")), "no filtra ningún dato");
      }
    }
  } finally {
    if (antes.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = antes.url;
    if (antes.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = antes.anon;
  }
});

test("TronGrid sin clave sólo deja una consulta por segundo: ante un 429 espera y reintenta, y el saldo de hoy se recuerda unos segundos", async () => {
  let pedidos = 0;
  const rutas = (u: string) => {
    pedidos++;
    if (pedidos === 1) return { status: 429, cuerpo: { Error: "request rate exceeded the allowed_rps(1), suspended for 5 s" } };
    return { cuerpo: { data: [{ trc20: [{ [USDT]: "1500000000" }] }] } };
  };
  /* Una billetera propia de esta prueba: no comparte la memoria con las de arriba. */
  const billetera = "TPruebaDeMemoria1111111111111111111";
  const a = await conRespuestas({ TRUST_WALLET_ADDRESS: billetera }, rutas, () => saldoDeTrust());
  assert.equal(a.r!.saldo, 1500); assert.equal(a.pedidos.length, 2, "el 429 y el reintento");
  /* Otra vez enseguida (la tarjeta de la Caja y el botón del arqueo): no vuelve a preguntar. */
  const b = await conRespuestas({ TRUST_WALLET_ADDRESS: billetera }, () => { throw new Error("no tendría que preguntar"); }, () => saldoDeTrust());
  assert.equal(b.r!.saldo, 1500); assert.equal(b.pedidos.length, 0);
  /* Un día pasado no usa la memoria. */
  const c = await conRespuestas({ TRUST_WALLET_ADDRESS: billetera }, () => ({ cuerpo: { data: [{ trc20: [{ [USDT]: "1500000000" }] }], meta: {} } }), () => saldoDeTrust(new Date(Date.now() - 3 * 86400000)));
  assert.ok(c.pedidos.length >= 2);
  /* Si sigue en 429 después de todos los reintentos, el error lo dice. */
  await assert.rejects(conRespuestas({ TRUST_WALLET_ADDRESS: "TOtraBilletera22222222222222222222222" }, () => ({ status: 429, cuerpo: { Error: "rps" } }), () => saldoDeTrust()), /TronGrid \(saldo\) respondió 429/);
});
