/* Regresión de los arreglos del estrés de la base (supabase/solo-lo-suyo-seguro.sql, tipos-cuenta.sql, control-cruzado.sql,
   honorarios.sql, cierre-del-dia.sql y pruebas/sql/control-cruzado.ensayo.mjs), con el RLS y los triggers REALES en un Postgres en
   memoria (PGlite). Si PGlite no está en el disco, se saltean (ver pruebas/sql/arnes-pg.ts).

   Qué se cuida:
     1. un closer («sólo lo suyo») no se fabrica acceso a lo de otro escribiendo referencias a ciegas (V1 a V6), y lo legítimo del
        alta de closers sigue andando (la persona, el lead, la venta, las cuotas y el cobro que carga, y lo que edita de lo suyo);
     2. el director, el dueño, Equipo, Administración y el servidor pueden todo lo que podían;
     3. ventas.sesionId no se suelta ni se cambia;
     4. un cobro no se ata a un movimiento inventado (control cruzado);
     5. nombre_corto() saca la tilde de la ñ y la ç, y dos closers con el mismo nombre corto siguen siendo uno para la base, como para la app;
     6. honorarios.sql vuelto a correr después de tipos-cuenta.sql no cambia el tipo de nadie;
     7. el ensayo de RLS del control cruzado vuelve a correr.
   Con SQL_DIR_PRUEBA=<carpeta con los .sql de antes> fallan. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { armarBanco, cargarPglite, montarBanco, sqlDe, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, type Banco, type Pg } from "./sql/arnes-pg";

const Pg_ = await cargarPglite();
const saltear = Pg_ ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= (async () => {
  const b = await montarBanco(Pg_!, ["control-cruzado.sql", "devoluciones.sql", "cierre-del-dia.sql", "solo-lo-suyo-seguro.sql"]);
  await b.ejecutar(`
    insert into public.equipo (id, nombre, email) values
      ('m_dante', 'Dante Closer', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com'), ('m_santi', 'Santi Director', 'santi@x.com');
    insert into public.usuarios_permitidos (email, rol) values
      ('yari@x.com', 'dueno'), ('equipo@x.com', 'equipo'), ('santi@x.com', 'director'), ('dante@x.com', 'closer'),
      ('otro@x.com', 'closer'), ('aldana@x.com', 'admin');`);
  return b;
})());
after(async () => { if (compartido) await (await compartido).db.close(); });

/** Dante y Otro son closers; la venta, el cobro, el lead y la llamada de Otro son lo que Dante no tiene que ver. */
async function sembrar(b: Banco): Promise<void> {
  await b.servicio(`truncate public.devoluciones, public.pagos, public.cuotas, public.ventas, public.sesiones, public.comentarios, public.leads, public.contactos, public.alumnos`);
  await b.ejecutar(`
    insert into public.contactos (id, nombre) values ('ctD', 'Cliente de Dante'), ('ctO', 'Cliente de Otro');
    insert into public.leads (id, responsable, "contactoId", nombre) values ('leadD', 'Dante Closer', 'ctD', 'Cliente de Dante'), ('leadO', 'Otro Closer', 'ctO', 'Cliente de Otro');
    insert into public.comentarios (id, "contactoId", texto) values ('cmD', 'ctD', 'hola'), ('cmO', 'ctO', 'dato privado de otro');
    insert into public.sesiones (id, anfitrion, "leadId", "contactoId") values ('sD', 'Dante Closer', 'leadD', 'ctD'), ('sO', 'Otro Closer', 'leadO', 'ctO');
    insert into public.ventas (id, "closerId", "contactoId", "sesionId", monto) values ('vD', 'm_dante', 'leadD', 'sD', 1000), ('vO', 'm_otro', 'leadO', 'sO', 5000);
    insert into public.cuotas (id, "ventaId") values ('cD', 'vD'), ('cO', 'vO');
    insert into public.pagos (id, "cuotaId", monto, comprobante) values ('pD', 'cD', 1000, '{"ruta":"d"}'), ('pO', 'cO', 5000, '{"ruta":"secreto-de-otro"}');
    insert into public.devoluciones (id, "ventaId", monto) values ('dO', 'vO', 200);`);
}
const cuantas = async (b: Banco, email: string, tabla: string, donde: string): Promise<number> => {
  const r = await b.intentar<{ n: number }>(email, `select count(*)::int n from public.${tabla} where ${donde}`);
  assert.ok(r.ok);
  return r.ok ? r.rows[0].n : -1;
};
const rechazada = (r: Awaited<ReturnType<Banco["intentar"]>>): boolean => !r.ok && r.codigo === "42501";

/* ---------- 1. los seis vectores ---------- */

const VECTORES: { nombre: string; sql: string; veria: [string, string][] }[] = [
  { nombre: "V1 una cuota heredada propia sobre la venta de otro", sql: `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`,
    veria: [["ventas", "id = 'vO'"], ["cuotas", "id = 'cO'"], ["pagos", "id = 'pO'"], ["devoluciones", "id = 'dO'"]] },
  { nombre: "V2 mover una cuota propia a la venta de otro", sql: `update public.cuotas set "ventaId" = 'vO', "closerId" = 'm_dante' where id = 'cD'`,
    veria: [["ventas", "id = 'vO'"], ["pagos", "id = 'pO'"], ["devoluciones", "id = 'dO'"]] },
  { nombre: "V3 una venta propia nueva que apunta al lead de otro", sql: `insert into public.ventas (id, "closerId", "contactoId") values ('vx', 'm_dante', 'leadO')`,
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "V4 apuntar una venta propia al lead de otro", sql: `update public.ventas set "contactoId" = 'leadO' where id = 'vD'`,
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "V5 apuntar una llamada propia al lead de otro", sql: `update public.sesiones set "leadId" = 'leadO', "contactoId" = 'ctO' where id = 'sD'`,
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "V6 apuntar un lead propio a la persona de otro", sql: `update public.leads set "contactoId" = 'ctO' where id = 'leadD'`,
    veria: [["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  /* Las mismas por la puerta del upsert (como guarda la app) y por la creación de una fila nueva. */
  { nombre: "V3b la misma venta nueva, por el upsert", sql: `insert into public.ventas (id, "closerId", "contactoId") values ('vy', 'm_dante', 'leadO') on conflict (id) do update set "contactoId" = excluded."contactoId"`,
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"]] },
  { nombre: "V5b una llamada propia nueva con el lead de otro", sql: `insert into public.sesiones (id, anfitrion, "leadId") values ('sx', 'Dante Closer', 'leadO')`,
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"]] },
  { nombre: "V6b un lead propio nuevo con la persona de otro", sql: `insert into public.leads (id, "contactoId", nombre) values ('lx', 'ctO', 'x')`,
    veria: [["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "V1b una cuota heredada propia nueva, por el upsert", sql: `insert into public.cuotas (id, "ventaId", "closerId") values ('cz', 'vO', 'm_dante') on conflict (id) do update set "ventaId" = excluded."ventaId"`,
    veria: [["ventas", "id = 'vO'"], ["pagos", "id = 'pO'"]] },
];
for (const v of VECTORES) {
  test(`un closer no se abre lo de otro con ${v.nombre}`, { skip: saltear }, async () => {
    const b = await banco();
    await sembrar(b);
    const r = await b.intentar("dante@x.com", v.sql);
    assert.ok(rechazada(r), `${v.sql}\n→ la base tenía que rechazarlo (42501) y respondió ${JSON.stringify(r)}`);
    for (const [tabla, donde] of v.veria) assert.equal(await cuantas(b, "dante@x.com", tabla, donde), 0, `no tendría que ver ${tabla} ${donde}`);
  });
}

test("robarle la comisión a otro closer ya no se puede ni reclamando la venta con una cuota propia", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  await b.intentar("dante@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`);
  const r = await b.intentar("dante@x.com", `update public.ventas set "closerId" = 'm_dante' where id = 'vO'`);
  assert.ok(r.ok && r.n === 0);
  const [v] = await b.servicio<{ closerId: string }>(`select "closerId" from public.ventas where id = 'vO'`);
  assert.equal(v.closerId, "m_otro");
});

/* ---------- 2. lo legítimo del alta de closers sigue andando ---------- */

test("un closer puede cargar una persona, su lead, su venta, las cuotas y el cobro, y editar lo suyo (el recorrido de la app)", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  const pasos: [string, string][] = [
    ["la persona nueva", `insert into public.contactos (id, nombre) values ('ctN', 'Nueva') on conflict (id) do update set nombre = excluded.nombre`],
    ["su lead (el contacto lo escribió él un instante antes)", `insert into public.leads (id, "contactoId", nombre) values ('leadN', 'ctN', 'Nueva') on conflict (id) do update set "contactoId" = excluded."contactoId", nombre = excluded.nombre`],
    ["la venta a ese lead, atada a su llamada", `insert into public.ventas (id, "closerId", "contactoId", "sesionId", monto) values ('vN', 'm_dante', 'leadN', 'sD', 700) on conflict (id) do update set monto = excluded.monto`],
    ["las cuotas de la venta", `insert into public.cuotas (id, "ventaId") values ('cN1', 'vN'), ('cN2', 'vN') on conflict (id) do update set "ventaId" = excluded."ventaId"`],
    ["el cobro de la primera", `insert into public.pagos (id, "cuotaId", monto) values ('pN', 'cN1', 350)`],
    ["guardar de nuevo la venta entera (upsert igual a lo que ya está)", `insert into public.ventas (id, "closerId", "contactoId", "sesionId", monto) values ('vN', 'm_dante', 'leadN', 'sD', 701) on conflict (id) do update set "closerId" = excluded."closerId", "contactoId" = excluded."contactoId", "sesionId" = excluded."sesionId", monto = excluded.monto`],
    ["guardar de nuevo la llamada entera con las mismas referencias", `insert into public.sesiones (id, anfitrion, "leadId", "contactoId", notas) values ('sD', 'Dante Closer', 'leadD', 'ctD', 'nota') on conflict (id) do update set anfitrion = excluded.anfitrion, "leadId" = excluded."leadId", "contactoId" = excluded."contactoId", notas = excluded.notas`],
    ["cambiar una nota de la llamada", `update public.sesiones set notas = 'otra' where id = 'sD'`],
    ["guardar de nuevo su lead entero", `insert into public.leads (id, "contactoId", nombre) values ('leadD', 'ctD', 'Cliente de Dante') on conflict (id) do update set "contactoId" = excluded."contactoId", nombre = excluded.nombre`],
    ["pasar la venta a otro lead propio", `update public.ventas set "contactoId" = 'leadD' where id = 'vN'`],
    ["una venta sin persona", `insert into public.ventas (id, "closerId", monto) values ('vS', 'm_dante', 5)`],
    ["una cuota nueva (el saldo) en su venta", `insert into public.cuotas (id, "ventaId") values ('cN3', 'vN')`],
    ["mover una cuota entre dos ventas suyas", `update public.cuotas set "ventaId" = 'vD' where id = 'cN3'`],
    ["el chat de su persona", `insert into public.comentarios (id, "contactoId", texto) values ('cmN', 'ctN', 'hola')`],
  ];
  for (const [que, sql] of pasos) {
    const r = await b.intentar("dante@x.com", sql);
    assert.ok(r.ok, `${que}: ${r.ok ? "" : r.mensaje}`);
  }
  assert.equal(await cuantas(b, "dante@x.com", "ventas", "id = 'vN'"), 1);
  assert.equal(await cuantas(b, "dante@x.com", "pagos", "id = 'pN'"), 1);
});

test("la cuota heredada que le asigna un director sigue andando: el closer ve la venta y edita esa cuota", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  assert.equal(await cuantas(b, "dante@x.com", "ventas", "id = 'vO'"), 0);
  const asigna = await b.intentar("santi@x.com", `update public.cuotas set "closerId" = 'm_dante' where id = 'cO'`);
  assert.ok(asigna.ok && asigna.n === 1);
  assert.equal(await cuantas(b, "dante@x.com", "ventas", "id = 'vO'"), 1, "hereda la venta");
  const edita = await b.intentar("dante@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cO', 'vO', 'm_dante') on conflict (id) do update set "ventaId" = excluded."ventaId", "closerId" = excluded."closerId"`);
  assert.ok(edita.ok, edita.ok ? "" : edita.mensaje);
  const cobra = await b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto) values ('pH', 'cO', 10)`);
  assert.ok(cobra.ok);
});

/* ---------- 3. los demás tipos de cuenta y el servidor no pierden nada ---------- */

test("el dueño, Equipo, el director y el servidor siguen escribiendo todas esas referencias; Administración las de ventas y cuotas", { skip: saltear }, async () => {
  const b = await banco();
  const completos = [
    `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`,
    `update public.cuotas set "ventaId" = 'vD' where id = 'cO'`,
    `insert into public.ventas (id, "closerId", "contactoId", "sesionId") values ('vx', 'm_dante', 'leadO', 'sO')`,
    `update public.ventas set "contactoId" = 'leadO', "sesionId" = null where id = 'vD'`,
    `update public.sesiones set "leadId" = 'leadO', "contactoId" = 'ctO' where id = 'sD'`,
    `update public.leads set "contactoId" = 'ctO' where id = 'leadD'`,
  ];
  for (const quien of ["yari@x.com", "equipo@x.com", "santi@x.com", null]) {
    await sembrar(b);
    for (const sql of completos) {
      const r = await b.intentar(quien, sql);
      assert.ok(r.ok, `${quien ?? "servicio"}: ${sql}\n${r.ok ? "" : r.mensaje}`);
    }
    const [v] = await b.servicio<{ sesionId: string | null; contactoId: string }>(`select "sesionId", "contactoId" from public.ventas where id = 'vD'`);
    assert.deepEqual([v.sesionId, v.contactoId], [null, "leadO"], `${quien ?? "servicio"} sí puede soltar y cambiar`);
  }
  await sembrar(b);
  for (const sql of completos.slice(0, 4)) {
    const r = await b.intentar("aldana@x.com", sql);
    assert.ok(r.ok, `administración: ${sql}\n${r.ok ? "" : r.mensaje}`);
  }
});

/* ---------- 4. ventas.sesionId ---------- */

test("ventas.sesionId: una vez puesto no se suelta ni se cambia (silencioso), y al crearla tiene que ser una llamada suya", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  for (const sql of [`update public.ventas set "sesionId" = null where id = 'vD'`, `update public.ventas set "sesionId" = 'sO' where id = 'vD'`,
    `insert into public.ventas (id, "closerId", "sesionId") values ('vD', 'm_dante', null) on conflict (id) do update set "sesionId" = excluded."sesionId"`]) {
    const r = await b.intentar("dante@x.com", sql);
    assert.ok(r.ok, `${sql}\n${r.ok ? "" : r.mensaje}`);
  }
  const [v] = await b.servicio<{ sesionId: string | null }>(`select "sesionId" from public.ventas where id = 'vD'`);
  assert.equal(v.sesionId, "sD", "sigue atada a su llamada");

  assert.ok(rechazada(await b.intentar("dante@x.com", `insert into public.ventas (id, "closerId", "sesionId") values ('vz', 'm_dante', 'sO')`)), "crear atada a la llamada de otro");
  assert.ok((await b.intentar("dante@x.com", `insert into public.ventas (id, "closerId", "sesionId") values ('vz', 'm_dante', 'sD')`)).ok, "crear atada a la suya");
  /* Una venta que venía sin llamada (las de antes) se puede atar a una suya, no a una ajena. */
  await b.servicio(`insert into public.ventas (id, "closerId") values ('vV', 'm_dante')`);
  assert.ok(rechazada(await b.intentar("dante@x.com", `update public.ventas set "sesionId" = 'sO' where id = 'vV'`)));
  assert.ok((await b.intentar("dante@x.com", `update public.ventas set "sesionId" = 'sD' where id = 'vV'`)).ok);
});

/* ---------- 5. el control cruzado ---------- */

test("control cruzado: un closer no ata ni desata un cobro a un movimiento; el director, finanzas y el servidor sí", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  /* El tilde de antes con un movimiento inventado no cuenta. */
  assert.ok((await b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto, chequeado, "movimientoId") values ('p1', 'cD', 9999, true, 'mov-inventado')`)).ok);
  const [p1] = await b.servicio<{ chequeado: boolean | null; movimientoId: string | null }>(`select chequeado, "movimientoId" from public.pagos where id = 'p1'`);
  assert.deepEqual([p1.chequeado, p1.movimientoId], [null, null], "al crear");

  await b.servicio(`insert into public.pagos (id, "cuotaId", monto, chequeado, "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn") values ('p2', 'cD', 100, true, 'chequeado', 'santi@x.com', now())`);
  assert.ok((await b.intentar("dante@x.com", `update public.pagos set "movimientoId" = 'mov-inventado', monto = 999999 where id = 'p2'`)).ok);
  const [p2] = await b.servicio<Record<string, unknown>>(`select chequeado, "chequeoDirector", "movimientoId" from public.pagos where id = 'p2'`);
  assert.deepEqual([p2.chequeado, p2.chequeoDirector, p2.movimientoId], [null, null, null], "al corregir: los dos casilleros y el tilde de antes vuelven a pendiente");

  /* Un cobro ya atado por la conciliación: el closer no lo desata (la app le deja el botón) ni lo cambia; sigue conservando su atadura. */
  await b.servicio(`insert into public.pagos (id, "cuotaId", monto, chequeado, "movimientoId") values ('p3', 'cD', 50, true, 'mov-real')`);
  assert.ok((await b.intentar("dante@x.com", `update public.pagos set "movimientoId" = null, notas = 'x' where id = 'p3'`)).ok);
  assert.ok((await b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto, "movimientoId", notas) values ('p3', 'cD', 50, null, 'y') on conflict (id) do update set "movimientoId" = excluded."movimientoId", notas = excluded.notas`)).ok);
  const [p3] = await b.servicio<Record<string, unknown>>(`select chequeado, "movimientoId", notas from public.pagos where id = 'p3'`);
  assert.deepEqual([p3.chequeado, p3.movimientoId, p3.notas], [true, "mov-real", "y"], "el closer edita lo suyo y la atadura queda");

  /* Quien concilia sí. */
  for (const quien of ["santi@x.com", "aldana@x.com", "yari@x.com", null]) {
    await b.servicio(`insert into public.pagos (id, "cuotaId", monto) values ('pc', 'cD', 10) on conflict (id) do update set "movimientoId" = null, chequeado = null`);
    const ata = await b.intentar(quien, `update public.pagos set "movimientoId" = 'mov-9', chequeado = true where id = 'pc'`);
    assert.ok(ata.ok, `${quien ?? "servicio"}: ${ata.ok ? "" : ata.mensaje}`);
    let [f] = await b.servicio<Record<string, unknown>>(`select chequeado, "movimientoId" from public.pagos where id = 'pc'`);
    assert.deepEqual([f.chequeado, f.movimientoId], [true, "mov-9"], `${quien ?? "servicio"} ata`);
    await b.intentar(quien, `update public.pagos set "movimientoId" = null where id = 'pc'`);
    [f] = await b.servicio<Record<string, unknown>>(`select "movimientoId" from public.pagos where id = 'pc'`);
    assert.equal(f.movimientoId, null, `${quien ?? "servicio"} desata`);
    await b.servicio(`delete from public.pagos where id = 'pc'`);
    const nuevo = await b.intentar(quien, `insert into public.pagos (id, "cuotaId", monto, chequeado, "movimientoId") values ('pc', 'cD', 10, true, 'mov-9')`);
    assert.ok(nuevo.ok);
    [f] = await b.servicio<Record<string, unknown>>(`select chequeado, "movimientoId" from public.pagos where id = 'pc'`);
    assert.deepEqual([f.chequeado, f.movimientoId], [true, "mov-9"], `${quien ?? "servicio"} crea ya atado`);
    await b.servicio(`delete from public.pagos where id = 'pc'`);
  }
});

/* ---------- 6. los nombres ---------- */

/* El largo de las dos cadenas del translate() de tipos-cuenta.sql y nombre-corto.sql lo controla pruebas/fix-sql-menores.test.ts. */

test("nombre_corto() saca la tilde de la ñ y la ç, y sigue igual con lo demás", { skip: saltear }, async () => {
  const b = await banco();
  for (const [entrada, esperado] of [["Núñez", "nunez"], ["Peña", "pena"], ["Muñoz", "munoz"], ["Ñandú", "nandu"], ["garçon", "garcon"], ["Ibáñez Çelik", "ibanez celik"],
    ["Valentín Abadía", "valentin abadia"], ["  Dante   BARBIERI  Extra ", "dante barbieri"], ["", ""], ["Juan", "juan"]] as const) {
    const [{ c }] = await b.servicio<{ c: string }>(`select public.nombre_corto('${entrada}') as c`);
    assert.equal(c, esperado, `nombre_corto(${entrada})`);
  }
});

test("un closer con ñ ve sus llamadas aunque Calendly escriba el anfitrión sin tilde", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`
    truncate public.sesiones; delete from public.equipo where id = 'm_agus'; delete from public.usuarios_permitidos where email = 'agus@x.com';
    insert into public.equipo (id, nombre, email) values ('m_agus', 'Agustín Núñez', 'agus@x.com');
    insert into public.usuarios_permitidos (email, rol) values ('agus@x.com', 'closer');
    insert into public.sesiones (id, anfitrion) values ('s1', 'Agustin Nunez');`);
  const r = await b.intentar<{ id: string }>("agus@x.com", `select id from public.sesiones`);
  assert.deepEqual(r.ok && r.rows.map((x) => x.id), ["s1"]);
  await b.ejecutar(`delete from public.equipo where id = 'm_agus'; delete from public.usuarios_permitidos where email = 'agus@x.com'; truncate public.sesiones`);
});

test("dos closers con el mismo nombre corto: la base elige uno solo, el mismo que la app (activo, menor id), y se pueden listar los que chocan", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`
    truncate public.sesiones;
    insert into public.equipo (id, nombre, email) values ('m_perez', 'Ana Laura Perez', 'perez@x.com'), ('m_gomez', 'Ana Laura Gomez', 'gomez@x.com'), ('m_baja', 'Ana Laura Baja', 'baja@x.com');
    update public.equipo set activo = false where id = 'm_baja';
    insert into public.usuarios_permitidos (email, rol) values ('perez@x.com', 'closer'), ('gomez@x.com', 'closer');
    insert into public.sesiones (id, anfitrion) values ('sP', 'Ana Laura Perez'), ('sG', 'Ana Laura Gomez'), ('sS', 'Ana Laura');`);
  const ids = async (email: string) => { const r = await b.intentar<{ id: string }>(email, `select id from public.sesiones order by id`); return r.ok ? r.rows.map((x) => x.id) : r; };
  /* Para la base «Ana Laura» es una sola persona: el activo de menor id (m_gomez < m_perez), igual que miembroDeCloser() de la
     app. Cambiarlo sólo de un lado haría que la pantalla y la base se contradigan: por eso sólo se avisa quiénes chocan. */
  assert.deepEqual(await ids("gomez@x.com"), ["sG", "sP", "sS"]);
  assert.deepEqual(await ids("perez@x.com"), []);
  const choques = await b.servicio<{ clave: string; ids: string[] }>(`select clave, ids from public.equipo_nombres_que_chocan()`);
  assert.deepEqual(choques.map((c) => [c.clave, [...c.ids].sort()]), [["ana laura", ["m_gomez", "m_perez"]]], "los inactivos no cuentan");
  await b.ejecutar(`delete from public.equipo where id in ('m_perez', 'm_gomez', 'm_baja'); delete from public.usuarios_permitidos where email in ('perez@x.com', 'gomez@x.com'); truncate public.sesiones`);
});

/* ---------- 7. honorarios.sql ---------- */

test("honorarios.sql vuelto a correr después de tipos-cuenta.sql no cambia el tipo de nadie ni deja el CHECK de dos niveles", { skip: saltear }, async () => {
  const b = await montarBanco(Pg_!, ["customer-success.sql"]);
  try {
    await b.ejecutar(`insert into public.usuarios_permitidos (email, rol) values ('yari.taft@gmail.com', 'dueno'), ('dante@x.com', 'closer'), ('santi@x.com', 'director'), ('aldana@x.com', 'admin'), ('lili@x.com', 'customer_success'), ('seti@x.com', 'setter')`);
    const antes = await b.servicio(`select email, rol from public.usuarios_permitidos order by email`);
    await b.ejecutar(sqlDe("honorarios.sql"));
    await b.ejecutar(sqlDe("honorarios.sql"));
    assert.deepEqual(await b.servicio(`select email, rol from public.usuarios_permitidos order by email`), antes);
    await b.ejecutar(`insert into public.usuarios_permitidos (email, rol) values ('x@x.com', 'marketing')`);
    assert.equal((await b.servicio<{ n: number }>(`select count(*)::int n from pg_constraint where conname = 'usuarios_permitidos_rol_ck'`))[0].n, 0);
  } finally { await b.db.close(); }
});

test("honorarios.sql en una base de dos niveles (sin tipos de cuenta) sigue haciendo lo de siempre", { skip: saltear }, async () => {
  const db = new Pg_!() as Pg;
  try {
    await db.exec(ESQUEMA_MINIMO);
    await db.exec(`insert into public.usuarios_permitidos (email, rol) values ('ceo@tumetamorfosis.com', 'admin'), ('otra@x.com', 'admin'), ('sin@x.com', 'nada')`);
    await db.exec(sqlDe("honorarios.sql"));
    await db.exec(sqlDe("honorarios.sql"));
    const b = armarBanco(db);
    assert.deepEqual(await b.servicio(`select email, rol from public.usuarios_permitidos order by email`),
      [{ email: "ceo@tumetamorfosis.com", rol: "dueno" }, { email: "otra@x.com", rol: "equipo" }, { email: "sin@x.com", rol: "equipo" }]);
    const r = await b.intentar(null, `insert into public.usuarios_permitidos (email, rol) values ('z@x.com', 'director')`);
    assert.ok(!r.ok && r.codigo === "23514", "el CHECK de dueño o equipo sigue donde todavía no hay tipos de cuenta");
  } finally { await db.close(); }
});

/* ---------- 8. el delta y el ensayo ---------- */

test("solo-lo-suyo-seguro.sql se puede correr de nuevo sin cambiar nada y antes o después de los demás", { skip: saltear }, async () => {
  const db = new Pg_!() as Pg;
  try {
    await db.exec(ESQUEMA_MINIMO);
    await db.exec(sqlDe("tipos-cuenta.sql"));
    await db.exec(PERMISOS_DE_ENSAYO);
    for (const a of ["solo-lo-suyo-seguro.sql", "control-cruzado.sql", "solo-lo-suyo-seguro.sql", "devoluciones.sql", "tipos-cuenta.sql", "solo-lo-suyo-seguro.sql"]) await db.exec(sqlDe(a));
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname like '%_guarda_del_closer' and not tgisinternal`);
    assert.equal(r.rows[0].n, 5);
  } finally { await db.close(); }
});

test("el ensayo de RLS del control cruzado (pruebas/sql/control-cruzado.ensayo.mjs) vuelve a correr y dice que todo está bien", { skip: saltear }, () => {
  const r = spawnSync(process.execPath, ["pruebas/sql/control-cruzado.ensayo.mjs"], {
    cwd: new URL("../", import.meta.url).pathname, encoding: "utf8", env: { ...process.env, PGLITE_DIR: process.env.PGLITE_DIR ?? "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite" },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Todo bien/);
  assert.doesNotMatch(r.stdout, /FALLA/);
});

/* ---------- 9. segunda ronda: los espacios de ids de leads y personas no se mezclan ---------- */

/* Cada cadena es un ataque entero: los pasos se corren en orden (alguno tiene que dar 42501) y al final Dante no ve nada de Otro.
   Son los de la verificación independiente de la primera versión, que aceptaba una referencia si estaba en cualquiera de los dos
   espacios: el closer se creaba una persona con el id del lead de otro (o un lead con el id de su persona) y esa fila, «suya» por
   haberla creado él, dejaba pasar la referencia. */
const CADENAS: { nombre: string; pasos: string[]; veria: [string, string][] }[] = [
  { nombre: "una persona con el id del lead de otro y una venta nueva que lo nombra",
    pasos: [`insert into public.contactos (id, nombre) values ('leadO', 'x')`, `insert into public.ventas (id, "closerId", "contactoId") values ('vx', 'm_dante', 'leadO')`],
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "un lead con el id de la persona de otro y una llamada propia que la nombra",
    pasos: [`insert into public.leads (id, nombre) values ('ctO', 'x')`, `update public.sesiones set "contactoId" = 'ctO' where id = 'sD'`],
    veria: [["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "una persona con el id del lead de otro y una llamada propia que lo nombra",
    pasos: [`insert into public.contactos (id, nombre) values ('leadO', 'x')`, `update public.sesiones set "leadId" = 'leadO' where id = 'sD'`],
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "una persona con el id del lead de otro y una venta propia que se mueve a él",
    pasos: [`insert into public.contactos (id, nombre) values ('leadO', 'x')`, `update public.ventas set "contactoId" = 'leadO' where id = 'vD'`],
    veria: [["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
  { nombre: "un lead con el id de la persona de otro y un lead propio que la nombra",
    pasos: [`insert into public.leads (id, nombre) values ('ctO', 'x')`, `update public.leads set "contactoId" = 'ctO' where id = 'leadD'`],
    veria: [["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"]] },
];
for (const c of CADENAS) {
  test(`un closer no mezcla los espacios de ids para abrirse lo de otro: ${c.nombre}`, { skip: saltear }, async () => {
    const b = await banco();
    await sembrar(b);
    const resultados = [];
    for (const sql of c.pasos) resultados.push(await b.intentar("dante@x.com", sql));
    assert.ok(resultados.some(rechazada), `alguno de los pasos tenía que dar 42501: ${JSON.stringify(resultados)}`);
    for (const [tabla, donde] of c.veria) assert.equal(await cuantas(b, "dante@x.com", tabla, donde), 0, `no tendría que ver ${tabla} ${donde}`);
  });
}

test("cada columna mira su espacio: una persona o un lead con el id de otro espacio se rechaza si no es suyo, y se acepta si es suyo", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  /* Lo de otro: no. */
  assert.ok(rechazada(await b.intentar("dante@x.com", `insert into public.contactos (id, nombre) values ('leadO', 'x')`)), "persona con el id del lead de otro");
  assert.ok(rechazada(await b.intentar("dante@x.com", `insert into public.leads (id, nombre) values ('ctO', 'x')`)), "lead con el id de la persona de otro");
  /* sesiones.leadId es un lead (no una persona suya) y sesiones.contactoId una persona (no un lead suyo). */
  assert.ok(rechazada(await b.intentar("dante@x.com", `update public.sesiones set "leadId" = 'ctD' where id = 'sD'`)), "una persona suya donde va un lead");
  assert.ok(rechazada(await b.intentar("dante@x.com", `update public.sesiones set "contactoId" = 'leadD' where id = 'sD'`)), "un lead suyo donde va una persona");
  assert.ok(rechazada(await b.intentar("dante@x.com", `update public.leads set "contactoId" = 'leadD' where id = 'leadD'`)), "un lead suyo donde va la persona del lead");
  /* Lo suyo: sí. */
  for (const [que, sql] of [
    ["una persona con el id de su propio lead", `insert into public.contactos (id, nombre) values ('leadD', 'x') on conflict (id) do nothing`],
    ["una llamada con su lead y su persona", `update public.sesiones set "leadId" = 'leadD', "contactoId" = 'ctD' where id = 'sD'`],
    ["una venta que apunta a su lead", `insert into public.ventas (id, "closerId", "contactoId") values ('vL', 'm_dante', 'leadD')`],
    /* La app a veces guarda en ventas.contactoId una persona: vale si no hay un lead con ese id y la persona es suya. */
    ["una venta que apunta a una persona suya que no es un lead", `insert into public.ventas (id, "closerId", "contactoId") values ('vP', 'm_dante', 'ctD')`],
  ] as const) {
    const r = await b.intentar("dante@x.com", sql);
    assert.ok(r.ok, `${que}: ${r.ok ? "" : r.mensaje}`);
  }
  assert.ok(rechazada(await b.intentar("dante@x.com", `insert into public.ventas (id, "closerId", "contactoId") values ('vQ', 'm_dante', 'ctO')`)), "una venta que apunta a la persona de otro");
  /* Los demás tipos de cuenta y el servidor siguen creando con cualquier id. */
  for (const quien of ["yari@x.com", "equipo@x.com", "santi@x.com", null]) {
    await sembrar(b);
    for (const sql of [`insert into public.contactos (id, nombre) values ('leadO2', 'x')`, `insert into public.leads (id, nombre) values ('ctO2', 'x')`]) {
      const r = await b.intentar(quien, sql);
      assert.ok(r.ok, `${quien ?? "servicio"}: ${sql}\n${r.ok ? "" : r.mensaje}`);
    }
  }
});

/* ---------- 10. segunda ronda: nadie puede llamar a las funciones de ayuda ---------- */

test("las funciones del delta no quedan ejecutables por anon ni por authenticated (no hay un oráculo de existencia) y los triggers siguen andando", { skip: saltear }, async () => {
  const db = new Pg_!() as Pg;
  try {
    await db.exec(ESQUEMA_MINIMO);
    /* Como en Supabase: las funciones nuevas nacen con permiso para anon y authenticated (y para PUBLIC, por defecto en Postgres). */
    await db.exec(`create role anon; alter default privileges in schema public grant execute on functions to anon, authenticated;`);
    await db.exec(sqlDe("tipos-cuenta.sql"));
    /* Sólo los permisos de tablas (no el «grant execute on all functions» del arnés, que taparía lo que se prueba). */
    await db.exec(`grant usage on schema public, auth to anon, authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant execute on function auth.jwt() to anon, authenticated;`);
    /* Las dos funciones de la primera versión (nunca llegaron a producción) tienen que desaparecer. */
    await db.exec(`create function public.fila_ya_existe(tabla text, id text) returns boolean language sql as $$ select true $$;
      create function public.referencia_a_gente_es_mia(id text) returns boolean language sql as $$ select true $$;`);
    await db.exec(sqlDe("solo-lo-suyo-seguro.sql"));
    await db.exec(sqlDe("solo-lo-suyo-seguro.sql"));
    const b = armarBanco(db);

    for (const f of ["fila_ya_existe(text,text)", "referencia_a_gente_es_mia(text)"]) {
      assert.equal((await db.query<{ n: string | null }>(`select to_regprocedure('public.${f}')::text as n`)).rows[0].n, null, `${f} tenía que borrarse`);
    }
    const AYUDA = ["anfitrion_es_mio(text)", "es_mi_llamada(text)", "es_mi_venta(text)", "es_mi_lead(text)", "es_mi_persona(text)", "venta_apunta_a_lo_mio(text)",
      "ventas_guarda_del_closer()", "cuotas_guarda_del_closer()", "sesiones_guarda_del_closer()", "leads_guarda_del_closer()", "contactos_guarda_del_closer()"];
    for (const f of AYUDA) {
      for (const rol of ["anon", "authenticated"]) {
        const r = await db.query<{ p: boolean }>(`select has_function_privilege('${rol}', 'public.${f}', 'execute') as p`);
        assert.equal(r.rows[0].p, false, `${rol} no tendría que poder ejecutar ${f}`);
      }
    }
    /* El diagnóstico sí lo puede mirar quien tiene sesión, y anon no. */
    assert.equal((await db.query<{ p: boolean }>(`select has_function_privilege('authenticated', 'public.equipo_nombres_que_chocan()', 'execute') as p`)).rows[0].p, true);
    assert.equal((await db.query<{ p: boolean }>(`select has_function_privilege('anon', 'public.equipo_nombres_que_chocan()', 'execute') as p`)).rows[0].p, false);

    /* De verdad: anon y una persona con sesión reciben «permiso denegado» (42501) al llamarlas a mano. */
    for (const rol of ["anon", "authenticated"]) {
      await db.exec(`set role ${rol}`);
      try {
        await assert.rejects(() => db.query(`select public.es_mi_lead('x')`), (e: { code?: string }) => e.code === "42501", `${rol}: es_mi_lead`);
        await assert.rejects(() => db.query(`select public.es_mi_persona('x')`), (e: { code?: string }) => e.code === "42501", `${rol}: es_mi_persona`);
      } finally { await db.exec(`reset role`); }
    }

    /* Y sin ningún permiso de ejecución para los demás, el closer sigue pudiendo lo suyo y sigue frenado en lo de otro. */
    await b.ejecutar(`
      insert into public.equipo (id, nombre, email) values ('m_dante', 'Dante Closer', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com');
      insert into public.usuarios_permitidos (email, rol) values ('yari@x.com', 'dueno'), ('dante@x.com', 'closer'), ('otro@x.com', 'closer');
      insert into public.contactos (id, nombre) values ('ctO', 'Cliente de Otro');
      insert into public.leads (id, responsable, "contactoId", nombre) values ('leadO', 'Otro Closer', 'ctO', 'Cliente de Otro');`);
    for (const sql of [`insert into public.contactos (id, nombre) values ('ctN', 'Nueva')`,
      `insert into public.leads (id, "contactoId", nombre) values ('leadN', 'ctN', 'Nueva')`,
      `insert into public.ventas (id, "closerId", "contactoId", monto) values ('vN', 'm_dante', 'leadN', 700)`,
      `insert into public.cuotas (id, "ventaId") values ('cN', 'vN')`]) {
      const r = await b.intentar("dante@x.com", sql);
      assert.ok(r.ok, `${sql}\n${r.ok ? "" : r.mensaje}`);
    }
    assert.ok(rechazada(await b.intentar("dante@x.com", `insert into public.ventas (id, "closerId", "contactoId") values ('vx', 'm_dante', 'leadO')`)));
    assert.ok(rechazada(await b.intentar("dante@x.com", `insert into public.contactos (id, nombre) values ('leadO', 'x')`)));
  } finally { await db.close(); }
});

/* ---------- 11. segunda ronda: «¿es mío?» con un solo id dice lo mismo que la lista entera ---------- */

test("es_mi_lead, es_mi_persona, es_mi_venta y es_mi_llamada dicen lo mismo que mis_leads(), mis_contactos(), mis_ventas() y mis_sesiones() con datos al azar", { skip: saltear }, async () => {
  const b = await montarBanco(Pg_!, ["solo-lo-suyo-seguro.sql"]);
  try {
    let semilla = 20261009;
    const azar = () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const elige = <T>(xs: T[]): T => xs[Math.floor(azar() * xs.length)];
    const lit = (v: string | null) => (v === null ? "null" : `'${v}'`);
    const miembros = [["m_dante", "Dante Closer", "dante@x.com"], ["m_otro", "Otro Closer", "otro@x.com"], ["m_tercer", "Tercer Closer", "tercer@x.com"], ["m_ana", "Ana Laura Perez", "ana@x.com"]];
    const correos = miembros.map((m) => m[2]);
    /* Nombres como los escribe Calendly: iguales, en minúscula, de a una palabra, con algo de más, de alguien que no es del equipo, vacíos. */
    const nombres: (string | null)[] = ["Dante Closer", "dante closer", "Dante", "Dante Closer Extra", "Otro Closer", "Otro", "Tercer Closer", "Ana Laura Perez", "Ana Laura", "Persona Ajena", "", null];
    const N = { contactos: 60, leads: 80, sesiones: 110, ventas: 60, cuotas: 90 };
    const ctIds = Array.from({ length: N.contactos }, (_, i) => `ct${i}`);
    const leadIds = Array.from({ length: N.leads }, (_, i) => `l${i}`);
    const ventaIds = Array.from({ length: N.ventas }, (_, i) => `v${i}`);
    const sesionIds = Array.from({ length: N.sesiones }, (_, i) => `s${i}`);

    const filas = (tabla: string, columnas: string, valores: (string | null)[][]) =>
      `insert into public.${tabla} (${columnas}) values ${valores.map((v) => `(${v.map(lit).join(", ")})`).join(", ")};`;
    await b.ejecutar([
      filas("equipo", "id, nombre, email", miembros.map((m) => [...m])),
      filas("contactos", "id, nombre, \"creadoPor\"", ctIds.map((id) => [id, "x", elige([...correos, "", null])])),
      filas("leads", "id, responsable, \"contactoId\", nombre, \"creadoPor\"",
        leadIds.map((id) => [id, elige(nombres), elige([...ctIds, null, "ct_fantasma"]), "x", elige([...correos, "", null])])),
      filas("sesiones", "id, anfitrion, \"leadId\", \"contactoId\"",
        sesionIds.map((id) => [id, elige(nombres), elige([...leadIds, null, "l_fantasma"]), elige([...ctIds, null, "ct_fantasma"])])),
      /* ventas.contactoId es el lead, pero la app a veces guarda una persona: se mezclan a propósito. */
      filas("ventas", "id, \"closerId\", \"setterId\", \"contactoId\"",
        ventaIds.map((id) => [id, elige([...miembros.map((m) => m[0]), null]), elige([...miembros.map((m) => m[0]), null, null]), elige([...leadIds, ...ctIds, null])])),
      filas("cuotas", "id, \"ventaId\", \"closerId\"",
        Array.from({ length: N.cuotas }, (_, i) => [`c${i}`, elige([...ventaIds, "v_fantasma"]), elige([...miembros.map((m) => m[0]), null, null])])),
    ].join("\n"));

    const ESPACIOS = [
      { que: "leads", puntual: "es_mi_lead", lista: "mis_leads", ids: [...leadIds, ...ctIds, "l_fantasma", "ct_fantasma"] },
      { que: "personas", puntual: "es_mi_persona", lista: "mis_contactos", ids: [...ctIds, ...leadIds, "ct_fantasma", "l_fantasma"] },
      { que: "ventas", puntual: "es_mi_venta", lista: "mis_ventas", ids: [...ventaIds, "v_fantasma"] },
      { que: "llamadas", puntual: "es_mi_llamada", lista: "mis_sesiones", ids: [...sesionIds, "s_fantasma"] },
    ];
    const grandes: Record<string, number[]> = {};
    for (const email of correos) {
      /* Con el correo de esa persona pero con poder de ejecutar (las funciones puntuales no son para los clientes). */
      await b.db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', false)`);
      for (const e of ESPACIOS) {
        const r = await b.db.query<{ i: string; p: boolean; s: boolean }>(
          `select i, public.${e.puntual}(i) as p, i = any(public.${e.lista}()) as s from unnest(array[${e.ids.map((x) => `'${x}'`).join(",")}]::text[]) as i`);
        const distintos = r.rows.filter((f) => f.p !== f.s).map((f) => f.i);
        assert.deepEqual(distintos, [], `${email} · ${e.que}: ${e.puntual}() y ${e.lista}() no dicen lo mismo en ${distintos.join(", ")}`);
        (grandes[e.que] ??= []).push(r.rows.filter((f) => f.s).length);
      }
    }
    /* Que la prueba diga algo: para algún closer hay unos y otros, y no todos tienen lo mismo. */
    for (const [que, cuantos] of Object.entries(grandes)) {
      assert.ok(cuantos.some((n) => n > 0), `${que}: nadie tiene nada, la prueba no probó nada`);
      assert.ok(new Set(cuantos).size > 1, `${que}: todos tienen lo mismo (${cuantos.join(", ")}), la prueba no distingue a nadie`);
    }
  } finally { await b.db.close(); }
});
