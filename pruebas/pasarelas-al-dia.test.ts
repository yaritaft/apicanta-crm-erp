import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  avisosDeCaida, comoEsta, hayQueAvisar, horaArgentina, minutosDeMargen, PASARELAS_A_PEDIDO, PASARELAS_RAPIDAS, siguienteEstado,
  type EstadoPasarela,
} from "@/lib/pasarelas-estado";
import { anotarRevision, cobroMasNuevo } from "@/lib/cobros-al-dia-servidor";
import { mismosMovimientos } from "@/lib/store";
import { whop } from "@/lib/pasarelas-api";
import type { Movimiento } from "@/lib/types";

/* ==================================================================
   Aldana, 24/11: «se volvió a desconectar Whop». No: el cron de cada hora
   había traído los cobros de las 15:39–15:53 a las 16:00, pero su pantalla
   tenía la lista de cuando la abrió y decía «Último cobro recibido de Whop:
   21 nov». Cargó cinco pagos a mano con el cobro ya en la base.
   Ahora Whop y Hotmart se revisan cada 5 minutos, cada revisión se anota,
   el selector dice si la pasarela está al día y trae lo nuevo de la base.
   ================================================================== */

const T0 = Date.parse("2026-11-24T19:00:00Z");
const MIN = 60_000;

test("siguienteEstado: si anda borra el error; si falla guarda desde cuándo falla seguido", () => {
  const ok = siguienteEstado(null, "whop", { ok: true, ultimoCobro: "2026-11-24T18:53:00Z", nuevos: 3, fuente: "rapido" }, T0);
  assert.equal(ok.okEn, new Date(T0).toISOString());
  assert.equal(ok.error, null);
  assert.equal(ok.ultimoCobro, "2026-11-24T18:53:00.000Z");
  assert.equal(ok.nuevos, 3);

  const f1 = siguienteEstado(ok, "whop", { ok: false, error: "Whop respondió 401: clave inválida", fuente: "rapido" }, T0 + 5 * MIN);
  assert.equal(f1.errorDesde, new Date(T0 + 5 * MIN).toISOString());
  assert.equal(f1.okEn, ok.okEn, "la última vez que anduvo no se pierde");
  const f2 = siguienteEstado(f1, "whop", { ok: false, error: "Whop respondió 401: clave inválida", fuente: "rapido" }, T0 + 10 * MIN);
  assert.equal(f2.errorDesde, f1.errorDesde, "fallando seguido, el «desde» no se corre");
  assert.equal(f2.ultimoCobro, ok.ultimoCobro, "el último cobro no se borra porque falle");

  const vuelve = siguienteEstado(f2, "whop", { ok: true, fuente: "cron" }, T0 + 15 * MIN);
  assert.equal(vuelve.error, null);
  assert.equal(vuelve.errorDesde, null);
  assert.equal(vuelve.ultimoCobro, ok.ultimoCobro, "una revisión sin cobros no hace retroceder el último");
});

test("siguienteEstado: el último cobro nunca retrocede (la revisión de 3 días no pisa la de 60)", () => {
  const previo: EstadoPasarela = { proveedor: "whop", revisadoEn: new Date(T0).toISOString(), ultimoCobro: "2026-11-24T21:46:37Z" };
  const r = siguienteEstado(previo, "whop", { ok: true, ultimoCobro: "2026-11-21T23:55:00Z", fuente: "cron" }, T0 + MIN);
  assert.equal(r.ultimoCobro, "2026-11-24T21:46:37.000Z");
});

test("comoEsta: verde revisado hace poco, ámbar si no se revisa, rojo si no responde", () => {
  const est = (min: number, extra: Partial<EstadoPasarela> = {}): EstadoPasarela =>
    ({ proveedor: "whop", revisadoEn: new Date(T0 - min * MIN).toISOString(), ...extra });
  assert.deepEqual(comoEsta(est(2), "Whop", T0), { tono: "ok", texto: "Whop al día · revisado hace 2 min" });
  assert.equal(comoEsta(est(0), "Whop", T0)?.texto, "Whop al día · revisado recién");
  const atrasada = comoEsta(est(45), "Whop", T0);
  assert.equal(atrasada?.tono, "atrasada");
  assert.match(atrasada!.texto, /Whop no se revisa desde las 15:15 \(hace 45 min\)/, "en hora argentina");
  const caida = comoEsta(est(1, { error: "Whop respondió 401: la clave no sirve", errorDesde: new Date(T0 - 90 * MIN).toISOString() }), "Whop", T0);
  assert.equal(caida?.tono, "error");
  assert.match(caida!.texto, /no responde desde las 14:30 \(hace 2 h\): los pagos nuevos no están entrando/);
  assert.equal(caida?.detalle, "Whop respondió 401: la clave no sirve");
  assert.equal(comoEsta(null, "Whop", T0), null, "sin fila no se inventa nada");
});

test("el margen depende de cada cuánto se revisa: Whop y Hotmart cada 5 minutos, el resto cada hora", () => {
  assert.deepEqual(PASARELAS_RAPIDAS, ["whop", "hotmart"]);
  assert.equal(minutosDeMargen("whop"), 20);
  assert.equal(minutosDeMargen("stripe"), 90);
  const stripe: EstadoPasarela = { proveedor: "stripe", revisadoEn: new Date(T0 - 50 * MIN).toISOString() };
  assert.equal(comoEsta(stripe, "Stripe", T0)?.tono, "ok", "Stripe revisado hace 50 min está al día (cron de cada hora + webhook)");
  assert.ok(!PASARELAS_A_PEDIDO.includes("mercury"), "Mercury trae pases y anulaciones: no se revisa desde el selector");
});

test("hayQueAvisar: un tropiezo suelto no; fallando seguido más de una hora, sí", () => {
  const base: EstadoPasarela = { proveedor: "whop", revisadoEn: new Date(T0).toISOString(), error: "502", errorDesde: new Date(T0 - 30 * MIN).toISOString() };
  assert.equal(hayQueAvisar(base, T0), false);
  assert.equal(hayQueAvisar({ ...base, errorDesde: new Date(T0 - 61 * MIN).toISOString() }, T0), true);
  assert.equal(hayQueAvisar({ ...base, error: null }, T0), false);
});

test("avisosDeCaida: uno por dueño y por día, sin repetir mails", () => {
  const est: EstadoPasarela = { proveedor: "whop", revisadoEn: new Date(T0).toISOString(), error: "Whop respondió 401.", errorDesde: new Date(T0 - 2 * 3600_000).toISOString() };
  const filas = avisosDeCaida(est, "Whop", ["Juan@apicanta.com", "juan@apicanta.com ", "yari@apicanta.com", ""], "20261124", (s) => s.length.toString());
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => f.para), ["juan@apicanta.com", "yari@apicanta.com"]);
  assert.match(filas[0].id, /^av_pasarela_whop_20261124_/);
  assert.equal(filas[0].titulo, "Whop no está trayendo los cobros");
  assert.match(filas[0].cuerpo, /Falla desde las 14:00: Whop respondió 401\./);
  assert.equal(filas[0].tipo, "pasarela");
  assert.deepEqual(avisosDeCaida({ ...est, error: null }, "Whop", ["juan@apicanta.com"], "20261124", (s) => s), []);
});

test("horaArgentina: UTC−3 sin depender del reloj de la máquina", () => {
  assert.equal(horaArgentina("2026-11-24T18:39:00Z"), "15:39");
  assert.equal(horaArgentina("2026-11-25T01:05:00Z"), "22:05");
});

test("cobroMasNuevo: la fecha del cobro más nuevo, o nada", () => {
  assert.equal(cobroMasNuevo([{ fecha: "2026-11-24T18:39:00Z" }, { fecha: "2026-11-24T18:53:00Z" }, { fecha: "2026-11-21T23:55:00Z" }]), "2026-11-24T18:53:00.000Z");
  assert.equal(cobroMasNuevo([]), undefined);
});

/* Una base de mentira con lo justo que usa anotarRevision: pasarelas_estado, usuarios_permitidos y avisos. */
function baseDePrueba(conTabla = true) {
  const tablas: Record<string, Record<string, unknown>[]> = {
    pasarelas_estado: [],
    usuarios_permitidos: [{ email: "juan@apicanta.com", rol: "dueno" }, { email: "aldana@apicanta.com", rol: "admin" }],
    avisos: [],
  };
  const db = {
    from(tabla: string) {
      const filtros: [string, unknown][] = [];
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filtros.push([c, v]); return q; },
        async maybeSingle() {
          if (!conTabla && tabla === "pasarelas_estado") return { data: null, error: { message: "relation does not exist" } };
          return { data: tablas[tabla].find((f) => filtros.every(([c, v]) => f[c] === v)) ?? null, error: null };
        },
        then(ok: (x: unknown) => void) { ok({ data: tablas[tabla].filter((f) => filtros.every(([c, v]) => f[c] === v)), error: null }); },
        async upsert(filas: Record<string, unknown> | Record<string, unknown>[], o: { onConflict: string; ignoreDuplicates?: boolean }) {
          for (const f of Array.isArray(filas) ? filas : [filas]) {
            const i = tablas[tabla].findIndex((x) => x[o.onConflict] === f[o.onConflict]);
            if (i < 0) tablas[tabla].push(f);
            else if (!o.ignoreDuplicates) tablas[tabla][i] = f;
          }
          return { error: null };
        },
      };
      return q;
    },
  };
  return { db: db as never, tablas };
}

test("anotarRevision: anota cada vuelta y avisa a los dueños recién después de una hora fallando (una vez por día)", async () => {
  const { db, tablas } = baseDePrueba();
  await anotarRevision(db, "whop", { ok: true, ultimoCobro: "2026-11-24T18:53:00Z", fuente: "rapido" }, T0);
  assert.equal(tablas.pasarelas_estado.length, 1);
  for (let m = 5; m <= 60; m += 5) await anotarRevision(db, "whop", { ok: false, error: "Whop respondió 401.", fuente: "rapido" }, T0 + m * MIN);
  assert.equal(tablas.avisos.length, 0, "55 minutos fallando: todavía no");
  await anotarRevision(db, "whop", { ok: false, error: "Whop respondió 401.", fuente: "rapido" }, T0 + 66 * MIN);
  assert.equal(tablas.avisos.length, 1, "más de una hora: aviso al dueño (no a Administración)");
  assert.equal(tablas.avisos[0].para, "juan@apicanta.com");
  await anotarRevision(db, "whop", { ok: false, error: "Whop respondió 401.", fuente: "rapido" }, T0 + 71 * MIN);
  assert.equal(tablas.avisos.length, 1, "el mismo día no se repite");
  const est = tablas.pasarelas_estado[0];
  assert.equal(est.errorDesde, new Date(T0 + 5 * MIN).toISOString());
  assert.equal(est.ultimoCobro, "2026-11-24T18:53:00.000Z");
});

test("anotarRevision: sin la tabla todavía no rompe a quien la llama", async () => {
  const { db } = baseDePrueba(false);
  assert.equal(await anotarRevision(db, "whop", { ok: true, fuente: "cron" }, T0), null);
});

test("mismosMovimientos: misma lista en otro orden no repinta; un cobro nuevo o un cambio de estado, sí", () => {
  const m = (id: string, estado: Movimiento["estado"] = "pendiente") => ({ id, proveedor: "whop", referencia: id, monto: 500, fee: 25, neto: 475, fecha: "2026-11-24T18:39:00Z", estado }) as unknown as Movimiento;
  assert.equal(mismosMovimientos([m("a"), m("b")], [m("b"), m("a")]), true);
  assert.equal(mismosMovimientos([m("a")], [m("a"), m("b")]), false);
  assert.equal(mismosMovimientos([m("a"), m("b")], [m("a"), m("b", "conciliado")]), false);
});

test("whop() en la revisión rápida no anota «no trajo cobros en 48 h» (un fin de semana sin ventas no es una falla)", async () => {
  const anterior = process.env.WHOP_API_KEY;
  const fetchAnterior = globalThis.fetch;
  process.env.WHOP_API_KEY = "whop_prueba";
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [], pagination: { total_pages: 1 } }), { status: 200 })) as typeof fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const rapida: string[] = [];
    await whop(new Date(Date.now() - 3 * 86400_000), { diagnosticos: rapida, revisionRapida: true });
    assert.deepEqual(rapida, []);
    const completa: string[] = [];
    await whop(new Date(Date.now() - 60 * 86400_000), { diagnosticos: completa });
    assert.equal(completa.length, 1, "el cron de cada hora lo sigue diciendo");
  } finally {
    console.warn = warn;
    globalThis.fetch = fetchAnterior;
    if (anterior === undefined) delete process.env.WHOP_API_KEY; else process.env.WHOP_API_KEY = anterior;
  }
});

test("el cron de cada 5 minutos existe y la tabla nace con RLS y sin escritura desde la app", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/cobros-al-dia" && c.schedule === "*/5 * * * *"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/pasarelas/sync" && c.schedule === "0 * * * *"), "el completo de cada hora sigue");
  const sql = readFileSync("supabase/pasarelas-estado.sql", "utf8");
  assert.match(sql, /alter table public\.pasarelas_estado enable row level security/);
  assert.match(sql, /for select to authenticated/);
  assert.match(sql, /revoke insert, update, delete on public\.pasarelas_estado from authenticated/);
  assert.match(sql, /revoke all on public\.pasarelas_estado from anon/);
  const ruta = readFileSync("src/app/api/cron/cobros-al-dia/route.ts", "utf8");
  assert.match(ruta, /Bearer \$\{secreto\}/, "sólo el cron de Vercel");
  const pedido = readFileSync("src/app/api/pasarelas/al-dia/route.ts", "utf8");
  assert.match(pedido, /exigirArea\(peticion, \["ventas", "finanzas"\], 2, \{ cerrado: true \}\)/, "quien carga ventas o edita Finanzas, con sesión");
  assert.doesNotMatch(pedido, /movimientos:/, "contesta cifras, nunca la lista de cobros con datos de clientes");
});

test("el selector trae lo nuevo al abrirse y el Shell cada dos minutos", () => {
  const sel = readFileSync("src/components/cobros/SelectorMovimiento.tsx", "utf8");
  assert.match(sel, /usePasarelaAlDia\(todas \? undefined : proveedor, abierto\)/);
  assert.match(sel, /Buscar pagos nuevos/);
  const cliente = readFileSync("src/lib/pasarelas-al-dia-cliente.ts", "utf8");
  assert.match(cliente, /acciones\.traerMovimientos\(\)/);
  const shell = readFileSync("src/components/shell/Shell.tsx", "utf8");
  assert.match(shell, /acciones\.traerMovimientos\(\)/);
});
