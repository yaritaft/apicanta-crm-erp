/* Escalamientos de privilegio de un closer («sólo lo suyo») sobre las ventas, las llamadas, los cobros y las devoluciones de otro,
   con el RLS de verdad (Postgres en memoria, PGlite) de tipos-cuenta.sql + devoluciones.sql + cierre-del-dia.sql.

   Primero lo que SÍ está bien cerrado (pruebas que pasan: regresión), después los agujeros que se encontraron (marcados «BUG:» y
   con { todo: true }, para que no rompan la suite hasta que se arreglen; al arreglarlos, sacar el todo).

   El patrón de los agujeros es el mismo: «lo suyo» de un closer se calcula con referencias que él mismo puede escribir (una cuota
   con su closerId, una venta con su closerId y el contactoId de otro, una llamada suya con el leadId de otro). Le alcanza con saber
   el id de lo ajeno (los ids de venta son nuevoId(): prefijo + hora en base 36 + 5 letras al azar) para quedárselo.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, montarBanco, type Banco } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, { archivos: ["devoluciones.sql", "cierre-del-dia.sql"], veces: 1 }));
after(async () => { if (compartido) await (await compartido).db.close(); });

/** Dante y Otro son closers; la venta, el cobro, la devolución, el lead y la llamada de Otro son lo que Dante no tiene que ver. */
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
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  return r.ok ? r.rows[0].n : -1;
};

/* ---------- lo que está bien cerrado ---------- */

test("un closer, sin trucos, no lee ni escribe lo de otro closer (ventas, cuotas, cobros, devoluciones, llamadas, leads, personas, chat)", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  for (const [tabla, donde] of [
    ["ventas", "id = 'vO'"], ["cuotas", "id = 'cO'"], ["pagos", "id = 'pO'"], ["devoluciones", "id = 'dO'"], ["sesiones", "id = 'sO'"],
    ["leads", "id = 'leadO'"], ["contactos", "id = 'ctO'"], ["comentarios", "id = 'cmO'"],
  ] as const) assert.equal(await cuantas(b, "dante@x.com", tabla, donde), 0, `${tabla}: Dante no tiene que ver lo de Otro`);
  assert.equal(await cuantas(b, "dante@x.com", "ventas", "id = 'vD'"), 1, "y lo suyo sí");
  assert.equal(await cuantas(b, "dante@x.com", "devoluciones", "true"), 0, "no hay devoluciones de sus ventas");
  for (const sql of [
    `update public.ventas set monto = 1 where id = 'vO'`, `update public.ventas set "sesionId" = null where id = 'vO'`,
    `update public.cuotas set "closerId" = 'm_dante' where id = 'cO'`, `update public.pagos set monto = 1 where id = 'pO'`,
    `update public.sesiones set notas = 'x' where id = 'sO'`, `update public.leads set nombre = 'x' where id = 'leadO'`,
    `delete from public.ventas where id = 'vO'`, `delete from public.pagos where id = 'pO'`,
  ]) {
    const r = await b.intentar("dante@x.com", sql);
    assert.ok(r.ok && r.n === 0, `${sql} no tiene que tocar nada`);
  }
  const ins = await b.intentar("dante@x.com", `insert into public.devoluciones (id, "ventaId", monto) values ('dx', 'vD', 1)`);
  assert.ok(!ins.ok && ins.codigo === "42501", "el closer no carga devoluciones");
  const pagoAjeno = await b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto) values ('px', 'cO', 1)`);
  assert.ok(!pagoAjeno.ok && pagoAjeno.codigo === "42501", "ni cobros en una cuota ajena");
  const ventaAjena = await b.intentar("dante@x.com", `insert into public.ventas (id, "closerId") values ('vx', 'm_otro')`);
  assert.ok(!ventaAjena.ok && ventaAjena.codigo === "42501", "ni una venta a nombre de otro");
});

test("un closer no puede llenar los casilleros de control de un cobro propio ni cambiar quién lo cargó", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  const r = await b.intentar("dante@x.com", `update public.pagos set "chequeoDirector" = 'chequeado', "chequeoFinanzas" = 'chequeado', "cargadoPor" = 'yari@x.com', "chequeoDirectorPor" = 'santi@x.com' where id = 'pD'`);
  assert.ok(!r.ok || r.n === 1);
  const [p] = await b.servicio<Record<string, unknown>>(`select * from public.pagos where id = 'pD'`);
  assert.equal(p.chequeoDirector ?? null, null);
  assert.equal(p.chequeoFinanzas ?? null, null);
  assert.ok(p.cargadoPor === null || p.cargadoPor === undefined || p.cargadoPor === "dante@x.com");
});

/* ---------- los agujeros ---------- */

/* BUG: lo «suyo» de un closer (mis_ventas(), mis_cuotas(), mis_leads(), mis_contactos() de tipos-cuenta.sql) se arma con referencias que
   el propio closer puede escribir, y las políticas de escritura sólo le piden que la fila nueva lo nombre a él o que ya sea suya. Cada una
   de estas escrituras, hechas como dante@x.com con el id de algo de Otro, le abre a Dante lo de Otro. Hace falta saber el id (los de las
   ventas nuevas son «ven_» + hora en base 36 + 5 letras al azar; los de la planilla de Angelo, «ven_ef_» + un hash de datos conocidos del
   cliente; los leads, un id derivado de la reserva de Calendly).

     V1  cuotas:  insert (id, ventaId = venta ajena, closerId = yo)       →  la venta, sus cuotas, cobros (con comprobante) y devoluciones
     V2  cuotas:  update de una cuota mía, ventaId = venta ajena          →  idem
     V3  ventas:  insert (closerId = yo, contactoId = lead ajeno)         →  el lead, la persona y su chat
     V4  ventas:  update de una venta mía, contactoId = lead ajeno        →  idem
     V5  sesiones: update de una llamada mía, leadId = lead ajeno         →  idem
     V6  leads:   update de un lead mío, contactoId = persona ajena       →  la persona y su chat
*/
const VECTORES: { nombre: string; sql: string; veria: [string, string][] }[] = [
  { nombre: "V1 una cuota «heredada» propia sobre la venta de otro", sql: `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`,
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
];
for (const v of VECTORES) {
  test(`BUG: un closer no debería abrirse lo de otro con ${v.nombre}`, { skip: saltear, todo: true }, async () => {
    const b = await banco();
    await sembrar(b);
    await b.intentar("dante@x.com", v.sql);
    for (const [tabla, donde] of v.veria) assert.equal(await cuantas(b, "dante@x.com", tabla, donde), 0, `${v.sql}\n→ no tendría que ver ${tabla} ${donde}`);
  });
}

test("BUG: un closer no debería poder cambiar el closer de la venta de otro (robarle la comisión) tras reclamarla con una cuota propia", { skip: saltear, todo: true }, async () => {
  const b = await banco();
  await sembrar(b);
  await b.intentar("dante@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`);
  await b.intentar("dante@x.com", `update public.ventas set "closerId" = 'm_dante' where id = 'vO'`);
  const [v] = await b.servicio<{ closerId: string }>(`select "closerId" from public.ventas where id = 'vO'`);
  assert.equal(v.closerId, "m_otro", "la venta de Otro tiene que seguir siendo de Otro");
});

/* BUG: `sesionId` de la venta es lo que ata la venta a su llamada para el «venta que no se cargó el mismo día, no se comisiona»
   (lib/cierre-del-dia.ts: ventasSinCierre ignora las ventas sin sesionId). Nada en la base lo sella después de crear la venta
   (cargadoPor, los chequeos, las marcas y la baja sí están cuidados por triggers) y la app nunca lo cambia después de crearla:
   el closer dueño de la venta puede dejarlo en NULL o atarlo a otra llamada y la venta deja de contar para el descuento.
   Repro: como dante@x.com, update ventas set "sesionId" = null where id = 'vD'. */
test("BUG: un closer no debería poder soltar su venta de la llamada de la que salió (ventas.sesionId) después de cargarla", { skip: saltear, todo: true }, async () => {
  const b = await banco();
  await sembrar(b);
  await b.intentar("dante@x.com", `update public.ventas set "sesionId" = null where id = 'vD'`);
  await b.intentar("dante@x.com", `update public.ventas set "sesionId" = 'sO' where id = 'vD'`);
  const [v] = await b.servicio<{ sesionId: string | null }>(`select "sesionId" from public.ventas where id = 'vD'`);
  assert.equal(v.sesionId, "sD", "la venta tiene que seguir atada a su llamada");
});

/* Arreglado (07/10): supabase/devoluciones.sql frena también el DELETE de una venta para quien ve «sólo lo suyo»
   (ventas_sin_baja_del_closer); el servidor y quienes ven todo pueden. */
test("un closer ya no puede borrar una venta suya (se iban con ella las cuotas y los cobros)", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b);
  const r = await b.intentar("dante@x.com", `delete from public.ventas where id = 'vD'`);
  assert.ok(!r.ok || r.n === 0, "el freno de supabase/devoluciones.sql mira también el DELETE");
});
