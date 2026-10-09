/* Idempotencia y orden de los SQL de supabase/ (control-cruzado, devoluciones, cierre-del-dia, customer-success, registros-webinar,
   gastos-recurrentes y tipos-cuenta) en un Postgres en memoria (PGlite).

   Cada archivo dice «Idempotente: se puede correr de nuevo sin romper nada», y el flujo de publicación corre los SQL de cada lote
   sin repreguntar. Se prueba que correr cada uno varias veces y en cualquier orden permitido (tipos-cuenta.sql primero, que es el
   requisito de todos; después los demás en cualquier orden, y tipos-cuenta.sql de nuevo en cualquier momento) deja EXACTAMENTE el
   mismo esquema que correrlos una vez cada uno en el orden de siempre: columnas, restricciones, índices, vistas, funciones (su
   definición entera), triggers, políticas de RLS (con sus expresiones) y tipos de cuenta. Cada corrida va en una transacción que se
   deshace, así que un solo Postgres sirve para todas las órdenes.

   También: lo que los dueños cambiaron (los áreas de un tipo, un tipo nuevo) y los datos (devoluciones, cobros chequeados)
   sobreviven a volver a correr los archivos.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  Azar, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Pg,
} from "./pg-arnes";

const Pg_ = await cargarPglite();
const saltear = Pg_ ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

const OTROS = ["control-cruzado.sql", "devoluciones.sql", "cierre-del-dia.sql", "customer-success.sql", "registros-webinar.sql", "gastos-recurrentes.sql"];
const TIPOS = "tipos-cuenta.sql";

let compartido: Promise<Pg> | null = null;
async function base(): Promise<Pg> {
  if (!compartido) {
    compartido = (async () => {
      const db = new Pg_!() as Pg;
      await db.exec(ESQUEMA_MINIMO);
      /* Lo que traen comprobantes.sql, modelo-angelo.sql y sql/conciliacion.sql, que control-cruzado.sql da por existente. */
      await db.exec(sqlDe(TIPOS));
      return db;
    })();
  }
  return compartido;
}
after(async () => { if (compartido) await (await compartido).close(); });

const CONSULTAS: Record<string, string> = {
  columnas: `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by table_name, column_name`,
  restricciones: `select conrelid::regclass::text as tabla, conname, pg_get_constraintdef(oid) as def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`,
  indices: `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`,
  rls: `select relname, relrowsecurity::text from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`,
  politicas: `select tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`,
  funciones: `select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`,
  triggers: `select tgrelid::regclass::text as tabla, tgname, pg_get_triggerdef(oid) as def from pg_trigger where not tgisinternal order by 1, 2`,
  vistas: `select viewname, definition from pg_views where schemaname = 'public' order by 1`,
  tipos_cuenta: `select id, nombre, descripcion, areas::text, "soloLoSuyo", orden from public.tipos_cuenta order by id`,
  permisos: `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' order by 2, 3`,
};

async function instantanea(db: Pg): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const [k, sql] of Object.entries(CONSULTAS)) r[k] = (await db.query(sql)).rows;
  return r;
}

/** Corre la lista de archivos dentro de una transacción, saca la foto del esquema y deshace todo. */
async function fotoDe(db: Pg, archivos: string[]): Promise<Record<string, unknown[]>> {
  await db.exec("begin");
  try {
    for (const a of archivos) await db.exec(sqlDe(a));
    await db.exec(PERMISOS_DE_ENSAYO);
    return await instantanea(db);
  } finally { await db.exec("rollback"); }
}

function diferencias(a: Record<string, unknown[]>, b: Record<string, unknown[]>): string[] {
  const d: string[] = [];
  for (const k of Object.keys(a)) {
    const sa = a[k].map((x) => JSON.stringify(x)), sb = b[k].map((x) => JSON.stringify(x));
    const soloA = sa.filter((x) => !sb.includes(x)), soloB = sb.filter((x) => !sa.includes(x));
    if (soloA.length || soloB.length) d.push(`${k}:\n  sólo en la de siempre: ${soloA.slice(0, 3).join(" | ").slice(0, 400)}\n  sólo en esta orden: ${soloB.slice(0, 3).join(" | ").slice(0, 400)}`);
  }
  return d;
}

test("correr cada SQL varias veces y en cualquier orden permitido deja el mismo esquema y las mismas políticas", { skip: saltear }, async () => {
  const db = await base();
  const canonica = await fotoDe(db, OTROS);
  /* Una foto vacía no prueba nada. */
  assert.ok(canonica.politicas.length > 60 && canonica.funciones.length > 15 && canonica.triggers.length >= 3 && canonica.columnas.length > 100,
    `la foto de referencia tiene que ser rica: ${Object.entries(canonica).map(([k, v]) => `${k}=${v.length}`).join(" ")}`);
  for (const semilla of [1, 2, 3, 4, 5]) {
    const az = new Azar(semilla);
    const orden: string[] = [];
    for (const a of az.mezclar(OTROS)) {
      for (let i = 0, veces = 1 + az.entero(3); i < veces; i++) orden.push(a);
      /* tipos-cuenta.sql se puede volver a correr en cualquier momento (es idempotente y no pisa lo que cambiaron los dueños). */
      if (az.bool(0.3)) orden.push(TIPOS);
    }
    const foto = await fotoDe(db, orden);
    const d = diferencias(canonica, foto);
    assert.deepEqual(d, [], `semilla ${semilla}: el orden ${orden.join(" → ")} no deja el mismo esquema:\n${d.join("\n")}`);
  }
});

test("volver a correr los SQL no pisa lo que cambiaron los dueños ni los datos", { skip: saltear }, async () => {
  const db = await base();
  await db.exec("begin");
  try {
    for (const a of OTROS) await db.exec(sqlDe(a));
    await db.exec(PERMISOS_DE_ENSAYO);
    await db.exec(`
      insert into public.tipos_cuenta (id, nombre, areas, "soloLoSuyo", orden) values ('mio', 'Mi tipo', '{"ventas":"ver"}', true, 50);
      update public.tipos_cuenta set areas = '{"panel":"ver"}', nombre = 'Director a mi manera' where id = 'director';
      update public.tipos_cuenta set descripcion = 'lo cambió Yari', areas = '{"alumnos":"editar"}' where id = 'customer_success';
      insert into public.ventas (id, "closerId") values ('v1', 'm_dante');
      insert into public.cuotas (id, "ventaId") values ('c1', 'v1');
      insert into public.pagos (id, "cuotaId", monto, chequeado, "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn") values ('p1', 'c1', 10, true, 'chequeado', 'santi@x.com', now());
      insert into public.devoluciones (id, "ventaId", monto) values ('d1', 'v1', 5);
      insert into public.sesiones (id, anfitrion, "estadoLlamada", "estadoLlamadaEn") values ('s1', 'Dante', 'Compra Full', '2026-10-01T10:00:00Z');`);
    const antes = JSON.stringify([
      (await db.query(`select * from public.tipos_cuenta order by id`)).rows, (await db.query(`select * from public.pagos`)).rows,
      (await db.query(`select * from public.devoluciones`)).rows, (await db.query(`select * from public.sesiones`)).rows,
    ]);
    for (const a of [TIPOS, ...OTROS, ...OTROS, TIPOS]) await db.exec(sqlDe(a));
    const despues = JSON.stringify([
      (await db.query(`select * from public.tipos_cuenta order by id`)).rows, (await db.query(`select * from public.pagos`)).rows,
      (await db.query(`select * from public.devoluciones`)).rows, (await db.query(`select * from public.sesiones`)).rows,
    ]);
    assert.equal(despues, antes, "los tipos de cuenta que editaron los dueños y los datos tienen que quedar igual");
  } finally { await db.exec("rollback"); }
});

test("el tipo «Customer Success» queda en el mismo lugar (orden 7, como CUSTOMER_SUCCESS de permisos.ts) corra cuando corra", { skip: saltear }, async () => {
  const db = await base();
  for (const archivos of [OTROS, [...OTROS].reverse(), ["customer-success.sql", "devoluciones.sql", TIPOS, "customer-success.sql"]]) {
    await db.exec("begin");
    try {
      for (const a of archivos) await db.exec(sqlDe(a));
      const r = await db.query<{ orden: number; areas: string }>(`select orden, areas::text from public.tipos_cuenta where id = 'customer_success'`);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].orden, 7);
      assert.deepEqual(JSON.parse(r.rows[0].areas), { alumnos: "editar", clientes: "ver" });
    } finally { await db.exec("rollback"); }
  }
});

/* BUG: honorarios.sql dice «Idempotente: se puede correr de nuevo sin duplicar ni pisar nada» pero su primer UPDATE
   (update usuarios_permitidos set rol = 'equipo' where rol is null or rol not in ('dueno', 'equipo')) vuelve a «Todo menos honorarios»
   a cada closer, director, setter, administración, marketing y Customer Success en cuanto se corre DESPUÉS de tipos-cuenta.sql, y
   deja de nuevo el CHECK usuarios_permitidos_rol_ck (sólo dueno o equipo), que impide dar de alta cualquier otro tipo hasta que se
   vuelva a correr tipos-cuenta.sql. Es lo mismo que correr «todos los SQL pendientes» de un lote: ningún aviso, y los closers pasan a ver
   y editar Finanzas. */
test("BUG: volver a correr honorarios.sql después de tipos-cuenta.sql no debería cambiarle el tipo de cuenta a nadie", { skip: saltear }, async () => {
  const db = await base();
  await db.exec("begin");
  try {
    await db.exec(sqlDe("customer-success.sql"));
    await db.exec(`
      insert into public.usuarios_permitidos (email, rol) values ('yari.taft@gmail.com', 'dueno'), ('dante@x.com', 'closer'), ('santi@x.com', 'director'), ('aldana@x.com', 'admin'), ('lili@x.com', 'customer_success')
        on conflict (email) do update set rol = excluded.rol;`);
    const antes = (await db.query<{ email: string; rol: string }>(`select email, rol from public.usuarios_permitidos order by email`)).rows;
    await db.exec(sqlDe("honorarios.sql"));
    const despues = (await db.query<{ email: string; rol: string }>(`select email, rol from public.usuarios_permitidos order by email`)).rows;
    assert.deepEqual(despues, antes, "los tipos de cuenta tienen que quedar como estaban");
  } finally { await db.exec("rollback"); }
});
