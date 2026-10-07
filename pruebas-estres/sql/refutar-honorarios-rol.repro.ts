/* Intento de REFUTAR el hallazgo «volver a correr honorarios.sql después de tipos-cuenta.sql le baja el tipo de cuenta a todos».
   A diferencia del test de sql-idempotencia.test.ts, acá NO se usa el es_dueno() de juguete del arnés: se arma la base en el orden
   REAL de producción (accesos de siempre con un solo nivel 'admin' → honorarios.sql del 23/09 → tipos-cuenta.sql del 30/09 →
   customer-success.sql), con es_dueno()/nivel_acceso() y los triggers que crea honorarios.sql de verdad, los accesos los da un dueño
   por RLS (como la pantalla Equipo → Accesos) y se mira qué ve cada closer. Se imprime cada paso. Sólo PGlite en memoria.

   Node: node --import ./pruebas/registrar.mjs --test pruebas/stress/refutar-honorarios-rol.repro.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, armarBanco, cargarPglite, sqlDe, type Banco, type Pg } from "./pg-arnes";

const Pg_ = await cargarPglite();
const saltear = Pg_ ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

/** El esquema ANTERIOR a honorarios.sql: sin es_dueno() de juguete y con el único nivel de entonces ('admin') por defecto. */
const ESQUEMA_ANTERIOR = (() => {
  const sinDueno = ESQUEMA_MINIMO.replace(/create function public\.es_dueno\(\)[\s\S]*?\$\$;/, "");
  assert.notEqual(sinDueno, ESQUEMA_MINIMO, "no encontré el es_dueno() de juguete para sacarlo");
  const conAdmin = sinDueno.replace("rol text not null default 'equipo'", "rol text not null default 'admin'");
  assert.notEqual(conAdmin, sinDueno, "no encontré el default de usuarios_permitidos.rol");
  return conAdmin;
})();

const ACCESOS: [email: string, tipo: string][] = [
  ["dante@x.com", "closer"], ["otro@x.com", "closer"], ["santi@x.com", "director"], ["aldana@x.com", "admin"],
  ["lili@x.com", "customer_success"], ["seti@x.com", "setter"], ["marta@x.com", "marketing"],
];
const DUENOS = ["yari.taft@gmail.com", "ceo@tumetamorfosis.com"];

const roles = async (db: Pg) =>
  Object.fromEntries((await db.query<{ email: string; rol: string }>(`select email, rol from public.usuarios_permitidos order by email`)).rows.map((r) => [r.email, r.rol]));

/** La base de producción tal como queda hoy: honorarios.sql (23/09) → tipos-cuenta.sql (30/09) → customer-success.sql, con los accesos dados por un dueño. */
async function produccion(): Promise<Banco> {
  const db = new Pg_!() as Pg;
  await db.exec(ESQUEMA_ANTERIOR);
  // Los accesos que había antes de honorarios.sql (un solo nivel: «admin»).
  await db.exec(`insert into public.usuarios_permitidos (email, rol) values
    ('yari.taft@gmail.com', 'admin'), ('ceo@tumetamorfosis.com', 'admin'), ('test@apicanta.com', 'admin'), ('admin@apicanta.com', 'admin')`);
  await db.exec(sqlDe("honorarios.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(sqlDe("customer-success.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(`insert into public.equipo (id, nombre, email) values
    ('m_dante', 'Dante Closer', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com'), ('m_santi', 'Santi Director', 'santi@x.com')`);
  const b = armarBanco(db);
  // Datos: dos ventas (de Dante y de Otro) y un gasto de Finanzas.
  await b.ejecutar(`
    insert into public.ventas (id, "closerId", monto) values ('vD', 'm_dante', 1000), ('vO', 'm_otro', 5000);
    insert into public.gastos (id) values ('g1'), ('g2');`);
  // Un dueño da los accesos por RLS, como la pantalla Equipo → Accesos.
  for (const [email, tipo] of ACCESOS) {
    const r = await b.intentar(DUENOS[0], `insert into public.usuarios_permitidos (email, rol) values ('${email}', '${tipo}')`);
    assert.ok(r.ok, `el dueño tendría que poder dar el acceso «${tipo}»: ${JSON.stringify(r)}`);
  }
  return b;
}

const cuantas = async (b: Banco, email: string, tabla: string) => {
  const r = await b.intentar<{ n: number }>(email, `select count(*)::int n from public.${tabla}`);
  assert.ok(r.ok);
  return r.ok ? r.rows[0].n : -1;
};

test("REPRO: honorarios.sql corrido de nuevo después de tipos-cuenta.sql baja a todos a «equipo» y vuelve a trabar los tipos", { skip: saltear }, async () => {
  const b = await produccion();
  try {
    const antes = await roles(b.db);
    console.log("  tipos de cuenta ANTES:", JSON.stringify(antes));
    assert.equal(antes["dante@x.com"], "closer");
    assert.equal(antes["santi@x.com"], "director");
    assert.equal(antes["lili@x.com"], "customer_success");
    assert.equal(antes["yari.taft@gmail.com"], "dueno");

    // Lo que ve un closer con su tipo de verdad.
    const gastosAntes = await cuantas(b, "dante@x.com", "gastos");
    const ventasAntes = await cuantas(b, "dante@x.com", "ventas");
    const escribirAntes = await b.intentar("dante@x.com", `insert into public.gastos (id) values ('gx_antes')`);
    console.log(`  Dante (closer) ANTES: ve ${gastosAntes} gastos y ${ventasAntes} venta(s); insertar un gasto → ${JSON.stringify(escribirAntes)}`);
    assert.equal(gastosAntes, 0);
    assert.equal(ventasAntes, 1);
    assert.ok(!escribirAntes.ok && escribirAntes.codigo === "42501");

    // El paso del hallazgo: la CLI corre honorarios.sql («idempotente») otra vez.
    const salida = await b.db.exec(sqlDe("honorarios.sql"));
    const diag = (salida as { rows?: Record<string, unknown>[] }[]).at(-1)?.rows?.[0];
    console.log("  lo único que imprime honorarios.sql al terminar (su «diagnóstico»):", JSON.stringify(diag));
    await b.db.exec(PERMISOS_DE_ENSAYO);

    const despues = await roles(b.db);
    console.log("  tipos de cuenta DESPUÉS:", JSON.stringify(despues));
    for (const [email, tipo] of ACCESOS) {
      assert.equal(despues[email], "equipo", `${email}: era «${tipo}» y pasó a «${despues[email]}»`);
    }
    for (const d of DUENOS) assert.equal(despues[d], "dueno");

    // Y lo que ve Dante ahora.
    const gastosDespues = await cuantas(b, "dante@x.com", "gastos");
    const ventasDespues = await cuantas(b, "dante@x.com", "ventas");
    const escribirDespues = await b.intentar("dante@x.com", `insert into public.gastos (id) values ('gx_despues')`);
    console.log(`  Dante (ahora «equipo») DESPUÉS: ve ${gastosDespues} gastos y ${ventasDespues} venta(s); insertar un gasto → ${JSON.stringify(escribirDespues)}`);
    assert.equal(gastosDespues, 2, "ve todos los gastos de Finanzas (los dos que hay)");
    assert.equal(ventasDespues, 2, "ve también la venta de otro closer");
    assert.ok(escribirDespues.ok, "escribe en Finanzas");

    // Y el CHECK de dos valores vuelve a trabar cualquier otro tipo.
    const alta = await b.intentar(DUENOS[0], `insert into public.usuarios_permitidos (email, rol) values ('x@x.com', 'director')`);
    console.log("  dar un acceso «director» después:", JSON.stringify(alta));
    assert.ok(!alta.ok && alta.codigo === "23514" && /usuarios_permitidos_rol_ck/.test(alta.mensaje));
  } finally { await b.db.close(); }
});

test("CONTROL de daño: correr tipos-cuenta.sql de nuevo destraba el CHECK pero NO devuelve los tipos (el daño queda)", { skip: saltear }, async () => {
  const b = await produccion();
  try {
    await b.db.exec(sqlDe("honorarios.sql"));
    await b.db.exec(sqlDe("tipos-cuenta.sql"));
    await b.db.exec(PERMISOS_DE_ENSAYO);
    const r = await roles(b.db);
    console.log("  tipos de cuenta después de honorarios.sql + tipos-cuenta.sql:", JSON.stringify(r));
    for (const [email] of ACCESOS) assert.equal(r[email], "equipo");
    const alta = await b.intentar(DUENOS[0], `insert into public.usuarios_permitidos (email, rol) values ('x@x.com', 'director')`);
    assert.ok(alta.ok, "el CHECK ya no está");
  } finally { await b.db.close(); }
});

test("CONTROL de alcance: sólo honorarios.sql lo hace; volver a correr los SQL de los lotes y tipos-cuenta.sql no toca los tipos", { skip: saltear }, async () => {
  const b = await produccion();
  try {
    const antes = await roles(b.db);
    for (const a of ["tipos-cuenta.sql", "customer-success.sql", "control-cruzado.sql", "devoluciones.sql", "cierre-del-dia.sql", "registros-webinar.sql", "gastos-recurrentes.sql", "tipos-cuenta.sql"]) {
      await b.db.exec(sqlDe(a));
    }
    assert.deepEqual(await roles(b.db), antes, "ningún otro archivo cambia los tipos");
    console.log("  los tipos siguen igual después de correr de nuevo todos los demás SQL.");
  } finally { await b.db.close(); }
});

test("CONTROL de contexto: en su orden original (antes de tipos-cuenta.sql) honorarios.sql SÍ es idempotente", { skip: saltear }, async () => {
  const db = new Pg_!() as Pg;
  try {
    await db.exec(ESQUEMA_ANTERIOR);
    await db.exec(`insert into public.usuarios_permitidos (email, rol) values
      ('yari.taft@gmail.com', 'admin'), ('ceo@tumetamorfosis.com', 'admin'), ('admin@apicanta.com', 'admin')`);
    await db.exec(sqlDe("honorarios.sql"));
    const una = await roles(db);
    await db.exec(sqlDe("honorarios.sql"));
    await db.exec(sqlDe("honorarios.sql"));
    const tres = await roles(db);
    console.log("  honorarios.sql una vez / tres veces:", JSON.stringify(una), "/", JSON.stringify(tres));
    assert.deepEqual(tres, una);
    assert.deepEqual(una, { "yari.taft@gmail.com": "dueno", "ceo@tumetamorfosis.com": "dueno", "admin@apicanta.com": "equipo" });
  } finally { await db.close(); }
});

test("CONTROL de causa: con el UPDATE y el CHECK de honorarios.sql guardados por «tipos-cuenta.sql ya corrió», la nueva corrida no toca a nadie", { skip: saltear }, async () => {
  const original = sqlDe("honorarios.sql");
  const guardado = original
    .replace(
      "update public.usuarios_permitidos set rol = 'equipo' where rol is null or rol not in ('dueno', 'equipo');",
      "update public.usuarios_permitidos set rol = 'equipo' where to_regclass('public.tipos_cuenta') is null and (rol is null or rol not in ('dueno', 'equipo'));")
    .replace(
      "alter table public.usuarios_permitidos drop constraint if exists usuarios_permitidos_rol_ck;\nalter table public.usuarios_permitidos add constraint usuarios_permitidos_rol_ck\n  check (rol in ('dueno', 'equipo'));",
      "do $c$ begin\n  if to_regclass('public.tipos_cuenta') is null then\n    alter table public.usuarios_permitidos drop constraint if exists usuarios_permitidos_rol_ck;\n    alter table public.usuarios_permitidos add constraint usuarios_permitidos_rol_ck check (rol in ('dueno', 'equipo'));\n  end if;\nend $c$;");
  assert.notEqual(guardado, original, "el parche no cambió nada");
  assert.equal((guardado.match(/to_regclass\('public\.tipos_cuenta'\)/g) ?? []).length, 2, "el parche tendría que haber entrado dos veces (UPDATE y CHECK)");

  // 1) El parche no cambia la primera corrida (antes de tipos-cuenta.sql): el mismo resultado que el original.
  const primera = async (sql: string) => {
    const db = new Pg_!() as Pg;
    try {
      await db.exec(ESQUEMA_ANTERIOR);
      await db.exec(`insert into public.usuarios_permitidos (email, rol) values ('yari.taft@gmail.com', 'admin'), ('admin@apicanta.com', 'admin')`);
      await db.exec(sql);
      return { roles: await roles(db), ck: (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'usuarios_permitidos_rol_ck'`)).rows };
    } finally { await db.close(); }
  };
  assert.deepEqual(await primera(guardado), await primera(original), "la primera corrida tiene que quedar igual");

  // 2) Después de tipos-cuenta.sql, volver a correrlo no cambia ningún tipo y no vuelve a poner el CHECK.
  const b = await produccion();
  try {
    const antes = await roles(b.db);
    await b.db.exec(guardado);
    await b.db.exec(PERMISOS_DE_ENSAYO);
    assert.deepEqual(await roles(b.db), antes);
    const alta = await b.intentar(DUENOS[0], `insert into public.usuarios_permitidos (email, rol) values ('x@x.com', 'director')`);
    assert.ok(alta.ok, "se puede seguir dando cualquier tipo");
    console.log("  [parchado] los tipos quedan igual y se puede seguir dando un tipo nuevo.");
  } finally { await b.db.close(); }
});
