/* Regresión de los arreglos del estrés de la base (supabase/solo-lo-suyo-seguro.sql, tipos-cuenta.sql, control-cruzado.sql,
   honorarios.sql, cierre-del-dia.sql y pruebas/sql/control-cruzado.ensayo.mjs), con el RLS y los triggers REALES en un Postgres en
   memoria (PGlite). Si PGlite no está en el disco, se saltean (ver pruebas/sql/arnes-pg.ts).

   Qué se cuida:
     1. un closer («sólo lo suyo») no se fabrica acceso a lo de otro escribiendo referencias a ciegas (V1 a V6), y lo legítimo del
        alta de closers sigue andando (la persona, el lead, la venta, las cuotas y el cobro que carga, y lo que edita de lo suyo);
     2. el director, el dueño, Equipo, Administración y el servidor pueden todo lo que podían;
     3. ventas.sesionId no se suelta ni se cambia;
     4. un cobro no se ata a un movimiento inventado (control cruzado);
     5. nombre_corto() tiene tablas del mismo largo, y dos closers con el mismo nombre corto no se pisan;
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

/** Los dos argumentos de translate(…) de cada función de un .sql. */
function tablasDeTranslate(sql: string): { origen: string; destino: string }[] {
  return [...sql.matchAll(/translate\(coalesce\(t, ''\),\s*'([^']+)',\s*'([^']+)'\)/g)].map((m) => ({ origen: m[1], destino: m[2] }));
}
/** El texto de una función de un .sql, sin los espacios de más. */
function funcionDe(sql: string, nombre: string): string {
  const m = new RegExp(`create or replace function public\\.${nombre}\\(.*?\\n\\$\\$;\\n`, "s").exec(sql);
  assert.ok(m, `no está ${nombre} en el archivo`);
  return m![0].replace(/\s+/g, " ").trim();
}

test("nombre_corto(): las dos cadenas del translate() tienen el mismo largo, en tipos-cuenta.sql y en el delta", () => {
  for (const archivo of ["tipos-cuenta.sql", "solo-lo-suyo-seguro.sql"]) {
    const texto = sqlDe(archivo);
    const tablas = tablasDeTranslate(texto);
    assert.ok(tablas.length >= 1, `${archivo}: no se encontró el translate()`);
    for (const t of tablas) {
      assert.equal([...t.origen].length, [...t.destino].length, `${archivo}: ${[...t.origen].length} contra ${[...t.destino].length} caracteres`);
      /* Cada letra con tilde se traduce a su letra sin ella (la misma que saca NFD en la app). */
      [...t.origen].forEach((c, i) => assert.equal([...t.destino][i], c.normalize("NFD").replace(/[̀-ͯ]/g, ""), `${archivo}: ${c}`));
    }
  }
});

test("las funciones de los nombres son idénticas en tipos-cuenta.sql y en solo-lo-suyo-seguro.sql (volver a correr uno no deshace al otro)", () => {
  const a = sqlDe("tipos-cuenta.sql"), b = sqlDe("solo-lo-suyo-seguro.sql");
  for (const f of ["nombre_completo", "nombre_corto", "miembro_de_nombre", "son_mios"]) assert.equal(funcionDe(b, f), funcionDe(a, f), f);
});

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

test("dos closers con el mismo nombre corto: cada uno ve sus llamadas; si el anfitrión no trae el nombre entero, el de antes; y se pueden listar los que chocan", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`
    truncate public.sesiones;
    insert into public.equipo (id, nombre, email) values ('m_perez', 'Ana Laura Perez', 'perez@x.com'), ('m_gomez', 'Ana Laura Gomez', 'gomez@x.com'), ('m_baja', 'Ana Laura Baja', 'baja@x.com');
    update public.equipo set activo = false where id = 'm_baja';
    insert into public.usuarios_permitidos (email, rol) values ('perez@x.com', 'closer'), ('gomez@x.com', 'closer');
    insert into public.sesiones (id, anfitrion) values ('sP', 'Ana Laura Perez'), ('sG', 'Ana Laura Gomez'), ('sS', 'Ana Laura');`);
  const ids = async (email: string) => { const r = await b.intentar<{ id: string }>(email, `select id from public.sesiones order by id`); return r.ok ? r.rows.map((x) => x.id) : r; };
  /* «Ana Laura» a secas no dice cuál: se queda como antes (el de menor id entre los activos). */
  assert.deepEqual(await ids("perez@x.com"), ["sP"]);
  assert.deepEqual(await ids("gomez@x.com"), ["sG", "sS"]);
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
    assert.equal(r.rows[0].n, 4);
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
