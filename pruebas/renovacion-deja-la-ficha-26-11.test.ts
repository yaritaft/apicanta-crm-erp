import test, { after } from "node:test";
import assert from "node:assert/strict";
import { alumnoSinVentaConLaCompra, renuevaSinVentaCargada } from "@/lib/alumnos";
import { alumnoDesdeVenta } from "@/lib/store";
import { DURACION_POR_DEFECTO, DURACION_POR_PROGRAMA, familiaDePrograma, mesesDePrograma, programasYDuracion } from "@/lib/clientes-cs";
import { PROGRAMAS_POR_DEFECTO } from "@/lib/programas";
import { cargarPglite, sqlDe, type Pg } from "./sql/arnes-pg";
import type { Alumno, EstadoApp, Venta } from "@/lib/types";

/* Liliana, 26/11: «Todos los alumnos que renuevan Principals, el contrato es por 12 meses. Algunos que renovaron aparecen por 3 meses».
   Los 13 que renovaron del 24 al 26/11 pasaron a Principals (venta, plan e inicio) pero su ficha de Servicio siguió con el programa y la
   duración de la compra anterior («HACKEAR IA», 3 meses): el fin del programa caía a los 3 meses y el outboarding les iba a sacar los
   accesos. LA RAÍZ: el programa y la duración de la ficha son de UNA compra y al renovar nadie los pasaba a la nueva. Ahora lo hace la
   base en el momento en que la compra pasa a ser el servicio (supabase/renovacion-deja-la-ficha-26-11.sql), una pestaña abierta desde
   antes no los devuelve a los de la compra anterior, y el alumno de antes sin venta cargada (Luis Carlos J.) renueva igual. */

const AHORA = Date.parse("2026-11-26T15:00:00.000Z");
const productos = [
  { id: "prod_hackear_ai", nombre: "Hackear AI", tipo: "principal" },
  { id: "prod_principals", nombre: "Principals", tipo: "principal" },
  { id: "prod_downsell", nombre: "Downsell", tipo: "downsell" },
  { id: "prod_extension_mid", nombre: "Extensión mentoría MID (+2 meses)", tipo: "upsell" },
  { id: "prod_cena", nombre: "Cena", tipo: "evento" },
] as EstadoApp["productos"];

const compra = (extra: Partial<Venta> = {}): Venta =>
  ({ id: "ven_nueva", contactoId: "lead_1", contactoNombre: "Luis Prueba", estado: "activa", productoId: "prod_principals", fecha: "2026-11-25T22:54:12.000Z", moneda: "USD", precioAcordado: 1500, ...extra }) as Venta;

const deAntes: Alumno = {
  id: "alu_1", nombre: "Luis Prueba", email: "luis@x.com", cohorte: "", plan: "", cuotaMensual: 0, moneda: "USD", estado: "baja",
  inicio: "2025-01-17T15:00:00.000Z", progreso: 0, creadoEn: "2026-10-19T22:56:36.000Z", extra: {},
};

const estado = (a: Partial<Alumno> = {}): EstadoApp => ({
  productos, ventas: [], leads: [{ id: "lead_1", nombre: "Luis Prueba", email: "luis@x.com" }], contactos: [], seguimientos: [], cuotas: [],
  alumnos: [{ ...deAntes, ...a }], ajustes: { programas: PROGRAMAS_POR_DEFECTO },
} as unknown as EstadoApp);

/* ---------- la app: el alumno de antes, sin venta cargada, que vuelve a comprar ---------- */

test("Luis Carlos: de baja desde 2025 y sin venta, compra Principals → vuelve a activo, pasa a ese plan y su programa arranca con la compra", () => {
  const e = estado();
  assert.equal(renuevaSinVentaCargada(e, e.alumnos[0], compra(), AHORA), true);
  const a = alumnoSinVentaConLaCompra(e, e.alumnos[0], compra(), AHORA);
  assert.equal(a.id, "alu_1", "el mismo alumno");
  assert.equal(a.ventaId, "ven_nueva");
  assert.equal(a.estado, "activo");
  assert.equal(a.plan, "Principals");
  assert.equal(a.inicio, "2026-11-25T22:54:12.000Z");
  assert.equal(a.leadId, "lead_1", "queda atado a su persona del CRM");
});

test("el que Lili dio de alta esperando la venta sigue igual: se le pega y deja de esperarla, sin tocarle nada más", () => {
  const e = estado({ estado: "activo", plan: "Hackear AI", inicio: "2026-10-01T15:00:00.000Z", extra: { ventaPendiente: { desde: "2026-10-01T15:00:00.000Z" }, otra: 1 } });
  const a = alumnoSinVentaConLaCompra(e, e.alumnos[0], compra(), AHORA);
  assert.equal(a.ventaId, "ven_nueva");
  assert.equal(a.plan, "Hackear AI");
  assert.equal(a.inicio, "2026-10-01T15:00:00.000Z");
  assert.deepEqual(a.extra, { otra: 1 });
});

test("no renueva: una venta vieja cargada tarde, un alta de estos días, un evento, un downsell, la extensión o una venta cancelada", () => {
  const e = estado();
  const a = e.alumnos[0];
  assert.equal(renuevaSinVentaCargada(e, a, compra({ fecha: "2026-09-01T15:00:00.000Z" }), AHORA), false, "una venta de hace meses que alguien carga hoy no lo reactiva");
  assert.equal(renuevaSinVentaCargada(e, { ...a, inicio: "2026-11-10T15:00:00.000Z" }, compra(), AHORA), false, "dado de alta hace dos semanas: es su primera venta");
  assert.equal(renuevaSinVentaCargada(e, { ...a, inicio: "2026-10-26T15:00:00.000Z" }, compra(), AHORA), false, "justo un mes: todavía no");
  assert.equal(renuevaSinVentaCargada(e, { ...a, inicio: "2026-10-25T15:00:00.000Z" }, compra(), AHORA), true, "más de un mes: sí");
  assert.equal(renuevaSinVentaCargada(e, a, compra({ productoId: "prod_cena" }), AHORA), false);
  assert.equal(renuevaSinVentaCargada(e, a, compra({ productoId: "prod_downsell" }), AHORA), false);
  assert.equal(renuevaSinVentaCargada(e, a, compra({ productoId: "prod_extension_mid" }), AHORA), false);
  assert.equal(renuevaSinVentaCargada(e, a, compra({ estado: "cancelada" }), AHORA), false);
  assert.equal(renuevaSinVentaCargada(e, { ...a, ventaId: "ven_otra" }, compra(), AHORA), false, "con venta va por alumnoConLaCompra");
  assert.equal(renuevaSinVentaCargada(e, { ...a, inicio: "" }, compra(), AHORA), false, "sin inicio no se sabe");
  /* El que no renueva queda como antes: con la venta pegada y nada más. */
  const pegado = alumnoSinVentaConLaCompra(e, a, compra({ productoId: "prod_cena" }), AHORA);
  assert.deepEqual({ ventaId: pegado.ventaId, estado: pegado.estado, plan: pegado.plan, inicio: pegado.inicio }, { ventaId: "ven_nueva", estado: "baja", plan: "", inicio: deAntes.inicio });
});

test("al registrar la venta, la app deja al alumno igual que la base (lo sube entero después de la venta: si difiriera, la pisaría)", () => {
  const hoy = new Date().toISOString();
  const { tocado } = alumnoDesdeVenta(estado(), compra({ fecha: hoy }), []);
  assert.deepEqual({ estado: tocado?.estado, plan: tocado?.plan, inicio: tocado?.inicio, ventaId: tocado?.ventaId }, { estado: "activo", plan: "Principals", inicio: hoy, ventaId: "ven_nueva" });
});

/* ---------- la duración de cada programa: una sola cuenta ---------- */

const NOMBRES = ["Principals", "PRINCIPALS", "Principal Mastermind", "Principals Mastermind", "Hackear Biz", "HACKEAR BIZ", "Hackear AI", "HACKEAR IA", "Hackear IT",
  "Hackear IA MID", "Hackear IA MID · extensión", "Downsell", "DOWNSELL", "Downsell Plus+", "Mentoría", "Algo Nuevo", "", ...PROGRAMAS_POR_DEFECTO.map((p) => p.nombre)];

test("los meses de un programa salen de una sola tabla, se escriba como se escriba; la ficha sugiere 12 para «PRINCIPALS»", () => {
  assert.equal(mesesDePrograma("Principals"), 12);
  assert.equal(mesesDePrograma("PRINCIPALS"), 12);
  assert.equal(mesesDePrograma("Principals Mastermind"), 12);
  assert.equal(mesesDePrograma("Hackear Biz"), 6);
  assert.equal(mesesDePrograma("HACKEAR IA"), 3);
  assert.equal(mesesDePrograma("Lo que sea"), DURACION_POR_DEFECTO);
  for (const [nombre, meses] of Object.entries(DURACION_POR_PROGRAMA)) assert.equal(mesesDePrograma(nombre), meses);
  const sin = { programas: ["PRINCIPALS", "HACKEAR IA"], duracionMeses: null };
  assert.equal(programasYDuracion(sin, "Principals", []).duracion, 12, "antes buscaba el nombre exacto y caía en 3");
  assert.equal(programasYDuracion({ ...sin, duracionMeses: 9 }, "Principals", []).duracion, 9, "la escrita manda");
});

/* ---------- la base (Postgres de verdad, en memoria) ---------- */

const Pglite = await cargarPglite();
const saltear = Pglite ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Pg[] = [];
after(async () => { for (const db of abiertos) await db.close(); });

const deL20 = sqlDe("compra-nueva-mismo-alumno-20-11.sql");
const TOMA_EL_SERVICIO = deL20.slice(deL20.indexOf("create or replace function public.compra_toma_el_servicio"), deL20.indexOf("create or replace function public.compra_al_alumno"));
const PROGRAMAS = JSON.stringify(PROGRAMAS_POR_DEFECTO.map((p) => ({ id: p.id, nombre: p.nombre, productos: p.productos, activo: p.activo, ...(p.sumaTiempo ? { sumaTiempo: true } : {}) })));

async function banco(): Promise<Pg> {
  const db = new Pglite!();
  abiertos.push(db);
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.alumnos (id text primary key, nombre text, email text, plan text default '', moneda text default 'USD', estado text default 'activo',
      inicio timestamptz, "leadId" text, extra jsonb default '{}'::jsonb, "ventaId" text, "creadoEn" timestamptz default now());
    create table public.ventas (id text primary key, "contactoId" text, "contactoNombre" text, "productoId" text, estado text default 'activa', fecha timestamptz default now(), moneda text default 'USD');
    create table public.productos (id text primary key, nombre text, tipo text);
    create table public.ajustes (id int primary key, programas jsonb);
    create table public.leads (id text primary key, "contactoId" text);
    create table public.seguimiento_alumnos (id text primary key, "alumnoId" text not null unique, programas jsonb not null default '[]'::jsonb, "duracionMeses" integer,
      "ultimoContacto" text, "followUp" text default '', "planDePago" text not null default '');
    create table public.actividad (id text primary key, accion text, actor text, entidad text, "entidadId" text, titulo text, fecha timestamptz, detalle text);
    insert into public.productos (id, nombre, tipo) values ('prod_hackear_ai', 'Hackear AI', 'principal'), ('prod_principals', 'Principals', 'principal'),
      ('prod_resell', 'Resell Mentoría', 'principal'), ('prod_biz', 'Hackear Biz', 'principal'), ('prod_downsell', 'Downsell', 'downsell'),
      ('prod_upsell', 'Upsell', 'upsell'), ('prod_cena', 'Cena', 'evento'), ('prod_extension_mid', 'Extensión mentoría MID (+2 meses)', 'upsell');
  `);
  await db.query(`insert into public.ajustes (id, programas) values (1, $1::jsonb)`, [PROGRAMAS]);
  await db.exec(TOMA_EL_SERVICIO);
  await db.exec(sqlDe("renovacion-deja-la-ficha-26-11.sql"));
  await db.exec(sqlDe("renovacion-deja-la-ficha-26-11.sql")); // se puede volver a correr
  return db;
}

type Ficha = { programas: string[]; duracionMeses: number | null; cicloDeVenta: string | null; ultimoContacto: string | null; followUp: string; planDePago: string };
const fichaDe = async (db: Pg, alumno: string) => (await db.query<Ficha>(`select programas, "duracionMeses", "cicloDeVenta", "ultimoContacto", "followUp", "planDePago" from public.seguimiento_alumnos where "alumnoId" = $1`, [alumno])).rows[0];
type Fila = { estado: string; plan: string; ventaId: string | null; leadId: string | null; dia: string; extra: Record<string, unknown> };
const alumnoDe = async (db: Pg, id: string) => (await db.query<Fila>(`select estado, plan, "ventaId", "leadId", extra, to_char(inicio at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') dia from public.alumnos where id = $1`, [id])).rows[0];
const hoyArg = async (db: Pg) => (await db.query<{ d: string }>(`select to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') d`)).rows[0].d;
const pasar = async (db: Pg, alumno: string, venta: string) => (await db.query<{ r: boolean }>(`select public.compra_al_alumno($1, $2) r`, [alumno, venta])).rows[0].r;

/* Un alumno de Hackear AI (ficha «HACKEAR IA», 3 meses) que renueva: como los 13 del 24 al 26/11. */
async function conAlumnoDeHackearAi(db: Pg, programas = '["HACKEAR IA"]', duracion: number | null = 3) {
  await db.exec(`
    insert into public.ventas (id, "contactoId", "productoId", fecha) values ('ven_ai', 'lead_1', 'prod_hackear_ai', now() - interval '70 days');
    insert into public.alumnos (id, nombre, plan, inicio, "leadId", "ventaId") values ('alu_1', 'Betsabeth Prueba', 'Hackear AI', now() - interval '70 days', 'lead_1', 'ven_ai');
    insert into public.seguimiento_alumnos (id, "alumnoId", programas, "duracionMeses", "ultimoContacto", "planDePago") values ('seg_1', 'alu_1', '${programas}'::jsonb, ${duracion === null ? "null" : duracion}, '2026-11-01', 'PIF 3000 USD');
  `);
}

test("renovar a Principals deja la ficha en «Principals · HACKEAR IA», 12 meses, con el plan de pago de la compra anterior en blanco, y lo anota", { skip: saltear }, async () => {
  const db = await banco();
  await conAlumnoDeHackearAi(db);
  await db.exec(`insert into public.ventas (id, "contactoId", "productoId") values ('ven_pr', 'lead_1', 'prod_principals')`);
  assert.equal(await pasar(db, "alu_1", "ven_pr"), true);
  assert.deepEqual(await fichaDe(db, "alu_1"), { programas: ["Principals", "HACKEAR IA"], duracionMeses: 12, cicloDeVenta: "ven_pr", ultimoContacto: "2026-11-01", followUp: "", planDePago: "" });
  const a = await alumnoDe(db, "alu_1");
  assert.deepEqual({ plan: a.plan, ventaId: a.ventaId, dia: a.dia }, { plan: "Principals", ventaId: "ven_pr", dia: await hoyArg(db) });
  assert.deepEqual(a.extra.ventasAnteriores, ["ven_ai"]);
  const nota = (await db.query<{ detalle: string }>(`select detalle from public.actividad where id = 'act_compra_alu_1_ven_pr'`)).rows[0].detalle;
  assert.match(nota, /compró Principals: su servicio pasa a ser Principals \(antes Hackear AI\), su programa arranca el .* su ficha de Servicio queda en Principals, 12 meses \(antes 3\) y su plan de pago pasa a ser el de esta compra \(el escrito era «PIF 3000 USD»\)\./);
  /* Volver a pasarla no cambia nada (ni repite el programa). */
  assert.equal(await pasar(db, "alu_1", "ven_pr"), false);
  assert.deepEqual((await fichaDe(db, "alu_1")).programas, ["Principals", "HACKEAR IA"]);
});

test("una pestaña abierta desde antes de la renovación guarda la fila entera: su programa, su duración y su plan de pago viejos no pisan los nuevos; lo demás sí se guarda", { skip: saltear }, async () => {
  const db = await banco();
  await conAlumnoDeHackearAi(db);
  await db.exec(`insert into public.ventas (id, "contactoId", "productoId") values ('ven_pr', 'lead_1', 'prod_principals')`);
  await pasar(db, "alu_1", "ven_pr");
  /* Lili, con la app abierta desde la mañana, marca «Se lo contactó»: la app manda la fila como la tenía (así se guarda: upsert de la fila). */
  const guardar = (f: Partial<Ficha>) => db.query(
    `insert into public.seguimiento_alumnos (id, "alumnoId", programas, "duracionMeses", "cicloDeVenta", "ultimoContacto", "followUp", "planDePago") values ('seg_1', 'alu_1', $1::jsonb, $2, $3, $4, $5, $6)
     on conflict (id) do update set programas = excluded.programas, "duracionMeses" = excluded."duracionMeses", "cicloDeVenta" = excluded."cicloDeVenta",
       "ultimoContacto" = excluded."ultimoContacto", "followUp" = excluded."followUp", "planDePago" = excluded."planDePago"`,
    [JSON.stringify(f.programas), f.duracionMeses, f.cicloDeVenta, f.ultimoContacto, f.followUp, f.planDePago]);
  await guardar({ programas: ["HACKEAR IA"], duracionMeses: 3, cicloDeVenta: null, ultimoContacto: "2026-11-26", followUp: "Onboarding", planDePago: "PIF 3000 USD" });
  assert.deepEqual(await fichaDe(db, "alu_1"), { programas: ["Principals", "HACKEAR IA"], duracionMeses: 12, cicloDeVenta: "ven_pr", ultimoContacto: "2026-11-26", followUp: "Onboarding", planDePago: "" });
  /* Con la pestaña al día (trae la marca de esta compra) se cambian a mano como siempre: Lili le da 9 meses y le saca el programa viejo. */
  await guardar({ programas: ["Principals"], duracionMeses: 9, cicloDeVenta: "ven_pr", ultimoContacto: "2026-11-27", followUp: "Onboarding", planDePago: "2 x 750 USD" });
  assert.deepEqual(await fichaDe(db, "alu_1"), { programas: ["Principals"], duracionMeses: 9, cicloDeVenta: "ven_pr", ultimoContacto: "2026-11-27", followUp: "Onboarding", planDePago: "2 x 750 USD" });
  /* Nadie se hace pasar por la base escribiendo la marca de otra compra: tampoco pisa. */
  await guardar({ programas: ["HACKEAR IA"], duracionMeses: 3, cicloDeVenta: "ven_inventada", ultimoContacto: "2026-11-28", followUp: "Onboarding", planDePago: "PIF 3000 USD" });
  assert.deepEqual(await fichaDe(db, "alu_1"), { programas: ["Principals"], duracionMeses: 9, cicloDeVenta: "ven_pr", ultimoContacto: "2026-11-28", followUp: "Onboarding", planDePago: "2 x 750 USD" });
  /* Una actualización de una sola columna (el servidor: el contrato firmado, los accesos) no trae marca y pasa. */
  await db.exec(`update public.seguimiento_alumnos set "followUp" = 'Activo' where id = 'seg_1'`);
  assert.equal((await fichaDe(db, "alu_1")).followUp, "Activo");
});

test("la renovación siguiente vuelve a pasar la ficha a la compra nueva (la duración es la de ese programa, no la que quedó escrita)", { skip: saltear }, async () => {
  const db = await banco();
  await conAlumnoDeHackearAi(db);
  await db.exec(`insert into public.ventas (id, "contactoId", "productoId", fecha) values ('ven_pr', 'lead_1', 'prod_principals', now() - interval '20 days')`);
  await pasar(db, "alu_1", "ven_pr");
  await db.exec(`update public.seguimiento_alumnos set "duracionMeses" = 9, "planDePago" = '2 x 750 USD' where id = 'seg_1'`);
  await db.exec(`insert into public.ventas (id, "contactoId", "productoId") values ('ven_biz', 'lead_1', 'prod_biz')`);
  assert.equal(await pasar(db, "alu_1", "ven_biz"), true);
  assert.deepEqual(await fichaDe(db, "alu_1"), { programas: ["Hackear Biz", "Principals", "HACKEAR IA"], duracionMeses: 6, cicloDeVenta: "ven_biz", ultimoContacto: "2026-11-01", followUp: "", planDePago: "" });
});

test("renovar el mismo programa no lo repite en la ficha («HACKEAR IA» ya es Hackear AI) y la duración vuelve a la del programa", { skip: saltear }, async () => {
  const db = await banco();
  await conAlumnoDeHackearAi(db, '["HACKEAR IA"]', 5);
  await db.exec(`insert into public.ventas (id, "contactoId", "productoId") values ('ven_re', 'lead_1', 'prod_resell')`);
  await pasar(db, "alu_1", "ven_re");
  assert.deepEqual(await fichaDe(db, "alu_1"), { programas: ["HACKEAR IA"], duracionMeses: 3, cicloDeVenta: "ven_re", ultimoContacto: "2026-11-01", followUp: "", planDePago: "" });
});

test("lo que no arranca un programa no toca la ficha: un evento, un downsell o un alumno sin ficha todavía; un producto sin programa sólo deja el plan de pago en blanco", { skip: saltear }, async () => {
  const db = await banco();
  await conAlumnoDeHackearAi(db);
  const igual = { programas: ["HACKEAR IA"], duracionMeses: 3, cicloDeVenta: null, ultimoContacto: "2026-11-01", followUp: "", planDePago: "PIF 3000 USD" };
  await db.exec(`insert into public.ventas (id, "contactoId", "productoId") values ('ven_cena', 'lead_1', 'prod_cena'), ('ven_up', 'lead_1', 'prod_upsell'), ('ven_ds', 'lead_1', 'prod_downsell')`);
  assert.equal(await pasar(db, "alu_1", "ven_cena"), false);
  assert.deepEqual(await fichaDe(db, "alu_1"), igual);
  assert.equal(await pasar(db, "alu_1", "ven_ds"), true);
  assert.deepEqual(await fichaDe(db, "alu_1"), igual, "el downsell lo suma el contrato al firmarse, como siempre");
  /* El Upsell es una compra nueva que no es de ningún programa de Ajustes: programa y duración quedan, el plan de pago viejo no. */
  await db.exec(`update public.ventas set fecha = now() + interval '1 minute' where id = 'ven_up'`);
  assert.equal(await pasar(db, "alu_1", "ven_up"), true);
  assert.deepEqual(await fichaDe(db, "alu_1"), { ...igual, cicloDeVenta: "ven_up", planDePago: "" });
  /* Sin ficha: la compra pasa igual (la ficha nace después, sugerida por la venta). */
  await db.exec(`
    insert into public.ventas (id, "contactoId", "productoId", fecha) values ('ven_b1', 'lead_2', 'prod_hackear_ai', now() - interval '60 days'), ('ven_b2', 'lead_2', 'prod_principals', now());
    insert into public.alumnos (id, nombre, plan, inicio, "leadId", "ventaId") values ('alu_2', 'Sin Ficha', 'Hackear AI', now() - interval '60 days', 'lead_2', 'ven_b1');`);
  assert.equal(await pasar(db, "alu_2", "ven_b2"), true);
  assert.equal((await alumnoDe(db, "alu_2")).plan, "Principals");
});

test("Luis Carlos en la base: de baja desde 2025 y sin venta → activo, Principals, arranca hoy, y su ficha vacía queda en Principals, 12 meses", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(`
    insert into public.alumnos (id, nombre, plan, estado, inicio) values ('alu_l', 'Luis Carlos Prueba', '', 'baja', '2025-01-17T15:00:00Z');
    insert into public.seguimiento_alumnos (id, "alumnoId", "followUp") values ('seg_l', 'alu_l', 'Outboarding');
    insert into public.ventas (id, "contactoId", "productoId") values ('ven_l', 'lead_l', 'prod_principals');`);
  assert.equal(await pasar(db, "alu_l", "ven_l"), true);
  const a = await alumnoDe(db, "alu_l");
  assert.deepEqual({ estado: a.estado, plan: a.plan, ventaId: a.ventaId, leadId: a.leadId, dia: a.dia }, { estado: "activo", plan: "Principals", ventaId: "ven_l", leadId: "lead_l", dia: await hoyArg(db) });
  assert.ok(!("ventasAnteriores" in a.extra), "no tenía venta: no hay anterior que anotar");
  assert.deepEqual(await fichaDe(db, "alu_l"), { programas: ["Principals"], duracionMeses: 12, cicloDeVenta: "ven_l", ultimoContacto: null, followUp: "Outboarding", planDePago: "" });
  const nota = (await db.query<{ detalle: string }>(`select detalle from public.actividad where id = 'act_compra_alu_l_ven_l'`)).rows[0].detalle;
  assert.match(nota, /vuelve a estar activo/);
});

test("sin venta, pero no es una renovación: el que espera la venta, una venta vieja cargada tarde y un alta de estos días sólo reciben la venta", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(`
    insert into public.alumnos (id, nombre, plan, estado, inicio, extra) values
      ('alu_espera', 'Espera La Venta', 'Hackear AI', 'activo', now() - interval '60 days', '{"ventaPendiente":{"desde":"2026-10-01"},"otra":1}'),
      ('alu_tarde', 'Venta Cargada Tarde', '', 'baja', '2025-01-17T15:00:00Z', '{}'),
      ('alu_nuevo', 'Alta De La Semana', 'Hackear AI', 'activo', now() - interval '10 days', '{}');
    insert into public.ventas (id, "contactoId", "productoId", fecha) values
      ('ven_espera', 'lead_e', 'prod_principals', now()), ('ven_tarde', 'lead_t', 'prod_principals', now() - interval '90 days'), ('ven_nuevo', 'lead_n', 'prod_principals', now());`);
  for (const [alu, ven] of [["alu_espera", "ven_espera"], ["alu_tarde", "ven_tarde"], ["alu_nuevo", "ven_nuevo"]]) assert.equal(await pasar(db, alu, ven), true);
  const espera = await alumnoDe(db, "alu_espera");
  assert.deepEqual({ plan: espera.plan, ventaId: espera.ventaId, extra: espera.extra }, { plan: "Hackear AI", ventaId: "ven_espera", extra: { otra: 1 } });
  const tarde = await alumnoDe(db, "alu_tarde");
  assert.deepEqual({ estado: tarde.estado, plan: tarde.plan, ventaId: tarde.ventaId, dia: tarde.dia }, { estado: "baja", plan: "", ventaId: "ven_tarde", dia: "2025-01-17" });
  assert.equal((await alumnoDe(db, "alu_nuevo")).plan, "Hackear AI");
});

test("la base y la app cuentan igual: el nombre de siempre de cada programa, sus meses y el programa de cada producto", { skip: saltear }, async () => {
  const db = await banco();
  for (const n of NOMBRES) {
    const r = (await db.query<{ f: string; m: number }>(`select public.familia_de_programa($1) f, public.meses_de_programa($1) m`, [n])).rows[0];
    assert.equal(r.f, familiaDePrograma(n), `familia de «${n}»`);
    assert.equal(r.m, mesesDePrograma(n), `meses de «${n}»`);
  }
  for (const p of ["prod_principals", "prod_hackear_ai", "prod_resell", "prod_biz", "prod_downsell", "prod_extension_mid", "prod_upsell", "prod_cena"]) {
    const r = (await db.query<{ n: string | null }>(`select public.programa_de_producto($1) n`, [p])).rows[0].n;
    assert.equal(r, PROGRAMAS_POR_DEFECTO.find((x) => x.activo && x.productos.includes(p))?.nombre ?? null, `programa de ${p}`);
  }
  /* Un programa inactivo no cuenta, y sin programas guardados la ficha no se toca. */
  await db.exec(`update public.ajustes set programas = '[{"id":"x","nombre":"Viejo","productos":["prod_principals"],"activo":false},{"id":"principals","nombre":"Principals","productos":["prod_principals"]}]'`);
  assert.equal((await db.query<{ n: string }>(`select public.programa_de_producto('prod_principals') n`)).rows[0].n, "Principals");
  await db.exec(`update public.ajustes set programas = null`);
  assert.equal((await db.query<{ n: string | null }>(`select public.programa_de_producto('prod_principals') n`)).rows[0].n, null);
});

test("la app devuelve la marca tal cual: la ficha completa la conserva y no la inventa", async () => {
  const { seguimientoCompleto } = await import("@/lib/clientes-cs");
  const { configSeguimiento } = await import("@/lib/seguimiento");
  const cfg = configSeguimiento(undefined);
  assert.equal(seguimientoCompleto({ alumnoId: "alu_1", cicloDeVenta: "ven_pr" }, cfg).cicloDeVenta, "ven_pr");
  assert.ok(!("cicloDeVenta" in seguimientoCompleto({ alumnoId: "alu_1" }, cfg)), "una fila de antes no manda la columna: la base la deja como está");
});
