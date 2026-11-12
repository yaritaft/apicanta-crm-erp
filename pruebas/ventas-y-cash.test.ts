import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";
import {
  AREAS, EDITAN, LEEN, TABLAS_DE_CASH, TIPOS_POR_DEFECTO, areaDeRuta, areasConExtra, nivelDeRuta, puedeEditar, puedeLeer, type MiAcceso,
} from "@/lib/permisos";
import { navPara } from "@/components/shell/nav";
import { construirSemilla } from "@/lib/seed";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { resumenDeCash } from "@/lib/ventas-y-cash";
import type { AreasDeTipo } from "@/lib/types";

/* 12/11: Manuel, por Santiago (Director comercial): «nada más quiere ver los números de ventas y el cash collected». Finanzas era todo o
   nada (con «Ve Finanzas» le llegaron hasta los 588 gastos). Ahora hay un permiso más fino, `cash` («Ventas y cash»): una pantalla con lo
   vendido y lo cobrado, y en la base sólo las lecturas de ventas, cuotas, pagos y devoluciones. */

const director = TIPOS_POR_DEFECTO.find((t) => t.id === "director")!;
const como = (areas: AreasDeTipo, tipo = "x", soloLoSuyo = false): MiAcceso => ({ tipo, nombre: tipo, areas, soloLoSuyo });
const santi = (extra: AreasDeTipo): MiAcceso => ({ tipo: "director", nombre: "Director comercial", areas: areasConExtra(director.areas, extra), areasExtra: extra, soloLoSuyo: false });

const SENSIBLES = ["gastos", "movimientos", "arqueos", "traspasos", "transacciones", "gastos_recurrentes", "honorarios", "liquidaciones", "usuarios_permitidos"];
const RUTAS_FINANZAS = ["/finanzas", "/finanzas/saldos", "/finanzas/flujo", "/finanzas/end-of-day", "/finanzas/resultados", "/finanzas/transacciones", "/finanzas/caja", "/finanzas/detalle", "/conciliacion", "/equipo"];

test("el director con «Ventas y cash» de más ve esa pantalla y ninguna otra de Finanzas", () => {
  const a = santi({ cash: "ver" });
  assert.equal(nivelDeRuta(a, "/finanzas/ventas-y-cash"), 1, "entra a Ventas y cash para mirar");
  for (const ruta of RUTAS_FINANZAS) assert.equal(nivelDeRuta(a, ruta), 0, `${ruta}: no es suya`);
  for (const t of SENSIBLES) assert.equal(puedeLeer(a, t), false, `no lee ${t}`);
  for (const t of ["ventas", "cuotas", "pagos", "devoluciones"]) assert.equal(puedeLeer(a, t), true, `lee ${t}`);
  assert.equal(nivelDeRuta(a, "/crm"), 2, "sigue siendo director");
  assert.equal(puedeEditar(a, "leads") && puedeEditar(a, "ventas"), true);
  assert.equal(puedeEditar(a, "gastos") || puedeEditar(a, "arqueos"), false, "y no escribe Finanzas");
});

test("quien tiene sólo «Ventas y cash» lee lo vendido y lo cobrado, y nada de la plata de adentro", () => {
  const a = como({ cash: "ver" });
  assert.equal(areaDeRuta("/finanzas/ventas-y-cash"), "cash");
  assert.equal(areaDeRuta("/finanzas/ventas-y-cash/lo-que-sea"), "cash");
  assert.equal(areaDeRuta("/finanzas"), "finanzas", "la ruta de más abajo sigue siendo de Finanzas");
  assert.equal(nivelDeRuta(a, "/finanzas/ventas-y-cash"), 1);
  for (const ruta of RUTAS_FINANZAS) assert.equal(nivelDeRuta(a, ruta), 0, ruta);
  for (const t of TABLAS_DE_CASH) assert.equal(puedeLeer(a, t), true, t);
  assert.equal(puedeLeer(a, "devoluciones"), true, "sin devoluciones el Cash Collected saldría de más");
  for (const t of SENSIBLES) assert.equal(puedeLeer(a, t), false, t);
  for (const t of Object.keys(EDITAN)) assert.equal(puedeEditar(a, t), false, `no edita ${t}`);
  const menu = navPara(a).flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(menu, ["/finanzas/ventas-y-cash"], "su menú es esa pantalla y nada más");
});

test("quien ve Finanzas ya ve Ventas y cash, y al revés no", () => {
  assert.equal(nivelDeRuta(como({ finanzas: "ver" }), "/finanzas/ventas-y-cash"), 1);
  assert.equal(nivelDeRuta(como({ finanzas: "editar" }), "/finanzas/ventas-y-cash"), 2);
  assert.equal(nivelDeRuta(como({ cash: "ver" }), "/finanzas"), 0);
  assert.equal(nivelDeRuta(como({ ventas: "editar", panel: "ver" }), "/finanzas/ventas-y-cash"), 0, "ver Ventas no alcanza: es otro permiso");
});

test("CANDADO: «cash» no está en ninguna tabla que no sea de ventas y cobros (ni se puede escribir con él)", () => {
  const conCash = Object.entries(LEEN).filter(([, areas]) => areas.includes("cash")).map(([t]) => t).sort();
  assert.deepEqual(conCash, ["cuotas", "devoluciones", "pagos", "ventas"], "si hace falta otra tabla, que lo decida una persona, no un copiar y pegar");
  for (const [t, areas] of Object.entries(EDITAN)) assert.ok(!areas.includes("cash"), `${t}: cash no escribe`);
  for (const t of SENSIBLES) assert.ok(!(LEEN[t] ?? []).includes("cash"), t);
});

test("el permiso se ofrece con su nombre, y Finanzas dice de verdad qué abre", () => {
  const cash = AREAS.find((x) => x.id === "cash")!;
  assert.equal(cash.nombre, "Ventas y cash");
  const finanzas = AREAS.find((x) => x.id === "finanzas")!;
  assert.match(finanzas.pantallas, /gastos/);
  assert.match(finanzas.pantallas, /honorarios/);
});

test("el Dashboard no manda a nadie a una pantalla que no puede ver: el Cash Collected lleva a Ventas y cash", () => {
  const kpis = readFileSync(new URL("../src/lib/kpis.ts", import.meta.url), "utf8");
  assert.match(kpis, /id: "c_cc"[^\n]*href: "\/finanzas\/ventas-y-cash"/);
  assert.match(kpis, /id: "c_tasa"[^\n]*href: "\/finanzas\/ventas-y-cash"/);
  const tabla = readFileSync(new URL("../src/components/panel/TablaKpis.tsx", import.meta.url), "utf8");
  assert.match(tabla, /nivelDeRuta\(acceso, href\) > 0/, "el link sólo existe si la persona entra a esa pantalla");
});

/* ---- los números son los del Dashboard ---- */

const e = construirSemilla();
const porId = new Map(catalogo(e).map((d) => [d.id, d]));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const HASTA = iso(new Date());
const casi = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.015, `${msg}: ${a} ≠ ${b}`);

for (const [nombre, desde] of [["todo", "2000-01-01"], ["el mes", `${HASTA.slice(0, 8)}01`], ["los últimos 30 días", iso(new Date(Date.now() - 29 * 86400000))]] as const) {
  test(`Ventas y cash (${nombre}): lo que dice es lo que dice el Dashboard, y las partes suman el total`, () => {
    const r = resumenDeCash(e, desde, HASTA, nombre);
    const corte: Corte = { clave: "t", titulo: nombre, desde, hasta: HASTA, foto: true, total: true };
    const c = new Contexto(e, corte);
    const kpi = (id: string) => valorEn(porId.get(id)!, c)!;
    assert.ok(r.cobros > 0 || nombre === "el mes", "hay con qué probar");
    casi(r.cobrado, kpi("c_cc"), "Cash Collected");
    casi(r.facturado, kpi("v_fact"), "Revenue");
    assert.equal(r.ventas, kpi("v_n"));
    casi(r.devuelto, kpi("c_devoluciones") ?? 0, "devoluciones");
    casi(r.porCobrar, kpi("c_porcobrar"), "por cobrar");
    casi(r.vencido, kpi("c_vencido"), "vencido");
    casi(r.cobrado, r.entrado - r.devuelto, "CC = entró − devuelto");
    const suma = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
    casi(suma(r.porServicio.map((f) => f.cobrado)), r.cobrado, "por servicio suma el CC");
    casi(suma(r.porVendedor.map((f) => f.cobrado)), r.cobrado, "por vendedor suma el CC");
    casi(suma(r.porDia.map((d) => d.cobrado)), r.cobrado, "día por día suma el CC");
    casi(suma(r.porServicio.map((f) => f.facturado)), r.facturado, "facturado por servicio");
    casi(suma(r.porVendedor.map((f) => f.facturado)), r.facturado, "facturado por vendedor");
    assert.equal(suma(r.porServicio.map((f) => f.ventas)), r.ventas);
    assert.equal(suma(r.porVendedor.map((f) => f.ventas)), r.ventas);
    assert.equal(suma(r.porDia.map((d) => d.cobros)), r.cobros);
    if (r.facturado > 0) casi(r.tasaDeCobro!, (r.cobrado / r.facturado) * 100, "tasa de cobro");
  });
}

test("Ventas y cash: un período sin nada da ceros y listas vacías, sin romper", () => {
  const r = resumenDeCash(e, "1999-01-01", "1999-01-31", "enero de 1999");
  assert.equal(r.cobrado, 0);
  assert.equal(r.ventas, 0);
  assert.equal(r.tasaDeCobro, null);
  assert.equal(r.ticket, null);
  assert.deepEqual([r.porServicio, r.porVendedor, r.porDia], [[], [], []]);
});

test("la pantalla de Ventas y cash no toca nada de Finanzas: ni gastos, ni cuentas, ni comisiones", () => {
  /* Se miran las líneas de código, no los comentarios (que explican justamente lo que NO hay). */
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fuentes = ["../src/lib/ventas-y-cash.ts", "../src/components/finanzas/vistas/VentasYCashVista.tsx"].map((f) => sinComentarios(readFileSync(new URL(f, import.meta.url), "utf8"))).join("\n");
  for (const prohibido of [/e\.gastos/, /e\.movimientos/, /e\.arqueos/, /e\.traspasos/, /e\.transacciones/, /e\.honorarios/, /e\.liquidaciones/, /calcularPyL/, /comision/i, /saldos/i, /honorario/i]) {
    assert.doesNotMatch(fuentes, prohibido, `no debería mirar ${prohibido}`);
  }
});

/* ---- la base, con la RLS de verdad ---- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

/** La base como estaba en producción antes de esto (las listas de lectura SIN `cash`, y la política de devoluciones de siempre). */
async function bancoDeAntes(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec(sqlDe("tipos-cuenta.sql").replaceAll("'cash',", ""));
  await db.exec(sqlDe("permisos-por-persona.sql"));
  await db.exec(`
    create table public.devoluciones (id text primary key, "ventaId" text, monto numeric default 0);
    alter table public.devoluciones enable row level security;
    create policy ver_devoluciones on public.devoluciones for select to authenticated using (
      (((select public.nivel_area('ventas')) >= 1 or (select public.nivel_area('finanzas')) >= 1 or (select public.nivel_area('webinars')) >= 1
        or (select public.nivel_area('marketing')) >= 1 or (select public.nivel_area('alumnos')) >= 1 or (select public.nivel_area('clientes')) >= 1)
       and ((select not public.solo_lo_suyo()) or "ventaId" = any ((select public.mis_ventas())::text[]))));
    create table public.movimientos (id text primary key);
    create table public.arqueos (id text primary key);
    alter table public.movimientos enable row level security; alter table public.arqueos enable row level security;
    create policy ver_movimientos on public.movimientos for select to authenticated using ((select public.ve('movimientos')));
    create policy ver_arqueos on public.arqueos for select to authenticated using ((select public.ve('arqueos')));
  `);
  await db.exec(PERMISOS_DE_ENSAYO);
  const b = armarBanco(db);
  abiertos.push(b);
  await b.ejecutar(`
    insert into public.tipos_cuenta (id, nombre, areas) values ('solo_cash', 'Sólo ventas y cash', '{"cash":"ver"}'::jsonb);
    insert into public.usuarios_permitidos (email, nombre, rol, "areasExtra") values
      ('manuel@apicanta.com', 'Manuel Pérez', 'dueno', '{}'),
      ('santiago@apicanta.com', 'Santiago Burghiani', 'director', '{"cash":"ver"}'),
      ('cash@apicanta.com', 'Sólo cash', 'solo_cash', '{}'),
      ('mariano@apicanta.com', 'Mariano Arias', 'closer', '{}');
    insert into public.ventas (id, monto) values ('ven_1', 2500);
    insert into public.cuotas (id, "ventaId") values ('cuo_1', 'ven_1');
    insert into public.pagos (id, "cuotaId", monto) values ('pag_1', 'cuo_1', 1000);
    insert into public.devoluciones (id, "ventaId", monto) values ('dev_1', 'ven_1', 100);
    insert into public.gastos (id) values ('gas_1');
    insert into public.movimientos (id) values ('mov_1');
    insert into public.arqueos (id) values ('arq_1');
  `);
  return b;
}

const veTodo = async (b: Banco, email: string) => {
  const r = await b.intentar<{ x: boolean }>(email, `select public.ve('ventas') and public.ve('cuotas') and public.ve('pagos') as x`);
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  return r.rows[0].x;
};
const cuantas = async (b: Banco, email: string, tabla: string) => {
  const r = await b.intentar<{ id: string }>(email, `select id from public.${tabla}`);
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  return r.rows.length;
};

test("base: antes del archivo, «Ventas y cash» no leía nada; con ventas-y-cash.sql (corrido dos veces) lee lo vendido y lo cobrado y nada más", { skip: saltear }, async () => {
  const b = await bancoDeAntes();
  /* Antes: la persona que sólo tiene cash no ve nada. */
  assert.equal(await veTodo(b, "cash@apicanta.com"), false);
  assert.equal(await cuantas(b, "cash@apicanta.com", "ventas"), 0);
  await b.ejecutar(sqlDe("ventas-y-cash.sql"));
  await b.ejecutar(sqlDe("ventas-y-cash.sql"));
  const lista = await b.servicio<{ l: string[] }>(`select public.areas_que_leen('ventas') as l`);
  assert.equal(lista[0].l.filter((x) => x === "cash").length, 1, "una sola vez, aunque se corra dos veces");
  for (const email of ["cash@apicanta.com", "santiago@apicanta.com"]) {
    assert.equal(await veTodo(b, email), true, `${email}: ve ventas, cuotas y pagos`);
    assert.equal(await cuantas(b, email, "ventas"), 1);
    assert.equal(await cuantas(b, email, "cuotas"), 1);
    assert.equal(await cuantas(b, email, "pagos"), 1);
    assert.equal(await cuantas(b, email, "devoluciones"), 1, `${email}: ve las devoluciones, o el Cash Collected saldría de más`);
    /* Lo de Finanzas, nada: la tabla llega vacía y ve() dice que no. */
    assert.equal(await cuantas(b, email, "gastos"), 0, `${email}: no ve los gastos`);
    assert.equal(await cuantas(b, email, "movimientos"), 0);
    assert.equal(await cuantas(b, email, "arqueos"), 0);
    for (const t of ["gastos", "movimientos", "arqueos", "traspasos", "transacciones"]) {
      const r = await b.intentar<{ x: boolean }>(email, `select public.ve('${t}') as x`);
      assert.ok(r.ok && r.rows[0].x === false, `${email}: ve('${t}') es falso`);
    }
  }
  /* No escribe nada: ni una venta, ni un cobro. */
  const edita = await b.intentar<{ x: boolean }>("cash@apicanta.com", `select public.edita('ventas') or public.edita('pagos') or public.edita('gastos') as x`);
  assert.ok(edita.ok && edita.rows[0].x === false);
  const insertar = await b.intentar("cash@apicanta.com", `insert into public.pagos (id, "cuotaId", monto) values ('pag_x', 'cuo_1', 1)`);
  assert.ok(!insertar.ok, "no puede cargar un cobro");
});

test("base: el director sigue siendo director con «Ventas y cash», y un cierre de ventas de otro no se le abre a quien ve sólo lo suyo", { skip: saltear }, async () => {
  const b = await bancoDeAntes();
  await b.ejecutar(sqlDe("ventas-y-cash.sql"));
  const r = await b.intentar<{ x: boolean }>("santiago@apicanta.com", `select public.edita('leads') and public.edita('ventas') as x`);
  assert.ok(r.ok && r.rows[0].x === true, "sigue editando leads y ventas");
  /* Un closer (sólo lo suyo) sigue sin ver las ventas de otros: la política no cambió. */
  assert.equal(await cuantas(b, "mariano@apicanta.com", "ventas"), 0);
  /* Los dueños, igual que siempre. */
  assert.equal(await cuantas(b, "manuel@apicanta.com", "gastos"), 1);
  assert.equal(await cuantas(b, "manuel@apicanta.com", "devoluciones"), 1);
});

test("base: tipos-cuenta.sql y devoluciones.sql traen lo mismo que el archivo nuevo", () => {
  const base = sqlDe("tipos-cuenta.sql");
  for (const t of ["ventas", "cuotas", "pagos"]) assert.match(base, new RegExp(`when '${t}'\\s+then array\\['cash',`), `${t} con cash en tipos-cuenta.sql`);
  assert.match(sqlDe("devoluciones.sql"), /nivel_area\('cash'\)\) >= 1/);
  const nuevo = sqlDe("ventas-y-cash.sql");
  assert.match(nuevo, /nivel_area\('cash'\)\) >= 1/);
  assert.doesNotMatch(nuevo.replace(/--.*$/gm, ""), /create or replace function public\.areas_que_editan/, "no toca lo que se puede escribir");
});
