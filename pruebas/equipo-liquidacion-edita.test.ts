import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";
import { TIPOS_POR_DEFECTO, nivelDeRuta, puedeArmarElEquipo, puedeEditar, puedeLeer, type MiAcceso } from "@/lib/permisos";

/* ==================================================================
   Quien liquida también arma el equipo (Aldana, 11/11): altas, bajas y lo que cobra cada uno, menos lo suyo y menos los accesos a la app.

   Con el SQL REAL (supabase/equipo-liquidacion-edita.sql) en un Postgres de verdad (PGlite): ella crea y cambia personas y esquemas, no borra, no toca
   su propia ficha ni lo que ella cobra, no cambia el correo de nadie y no da accesos; y la pantalla (permisos.ts) dice lo mismo que la base.
   ================================================================== */

const finanzas = { areas: { finanzas: "editar" } as MiAcceso["areas"] };
void TIPOS_POR_DEFECTO;
const como = (areas: MiAcceso["areas"]): MiAcceso => ({ tipo: "x", nombre: "x", areas, areasExtra: {}, soloLoSuyo: false });

test("la pantalla: «Liquidación: editar» arma el equipo y los esquemas; «ver» no; los accesos y tipos de cuenta siguen siendo de los dueños", () => {
  const aldana = como({ ...finanzas.areas, liquidacion: "editar" });
  assert.equal(puedeArmarElEquipo(aldana), true);
  assert.equal(puedeEditar(aldana, "equipo") && puedeEditar(aldana, "honorarios") && puedeEditar(aldana, "liquidaciones"), true);
  assert.equal(puedeEditar(aldana, "usuarios_permitidos"), false, "no da accesos");
  assert.equal(puedeEditar(aldana, "tipos_cuenta"), false, "no cambia los tipos de cuenta");
  assert.equal(puedeLeer(aldana, "honorarios"), true);
  const solo = como({ ...finanzas.areas, liquidacion: "ver" });
  assert.equal(puedeArmarElEquipo(solo), false);
  assert.equal(puedeEditar(solo, "equipo") || puedeEditar(solo, "honorarios"), false);
  assert.equal(puedeEditar(como({ finanzas: "editar" }), "equipo"), false, "Finanzas solo no alcanza");
  assert.equal(nivelDeRuta(aldana, "/equipo") > 0, true);
});

/* ---- la base, con la RLS de verdad ---- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

/* Lo que ya hay en producción antes de este archivo: las dos tablas con sus políticas de dueños (las de `equipo` las pone tipos-cuenta.sql) y la de lectura del permiso «Liquidación». */
const PRODUCCION = `
  create table public.honorarios (id text primary key, "miembroId" text not null, conceptos jsonb not null default '[]'::jsonb, "categoriaGasto" text default 'Equipo / Salarios');
  create table public.liquidaciones (id text primary key, periodo text, estado text default 'abierta', pagos jsonb not null default '{}'::jsonb);
  alter table public.equipo add column if not exists puesto text;
  alter table public.honorarios enable row level security;
  alter table public.liquidaciones enable row level security;
  create policy solo_duenos_honorarios on public.honorarios for all to authenticated using (public.es_dueno()) with check (public.es_dueno());
  create policy solo_duenos_liquidaciones on public.liquidaciones for all to authenticated using (public.es_dueno()) with check (public.es_dueno());
  alter table public.usuarios_permitidos enable row level security;
  create policy duenos_agregan_accesos on public.usuarios_permitidos for insert with check (public.es_dueno());
  create policy duenos_editan_accesos on public.usuarios_permitidos for update using (public.es_dueno()) with check (public.es_dueno());
`;

async function nuevoBanco(conArchivo: boolean): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(PRODUCCION);
  await db.exec(sqlDe("permiso-liquidacion.sql"));
  if (conArchivo) { await db.exec(sqlDe("equipo-liquidacion-edita.sql")); await db.exec(sqlDe("equipo-liquidacion-edita.sql")); }
  await db.exec(PERMISOS_DE_ENSAYO);
  const b = armarBanco(db);
  abiertos.push(b);
  await b.ejecutar(`
    insert into public.tipos_cuenta (id, nombre, areas) values ('contenido_finanzas', 'Contenido y finanzas', '{"finanzas":"editar","liquidacion":"editar"}')
      on conflict (id) do update set areas = excluded.areas;
    insert into public.tipos_cuenta (id, nombre, areas) values ('mirador', 'Mirador', '{"liquidacion":"ver"}') on conflict (id) do update set areas = excluded.areas;
    insert into public.usuarios_permitidos (email, nombre, rol) values
      ('manuel@apicanta.com', 'Manuel Pérez', 'dueno'), ('aldana@apicanta.com', 'Aldana', 'contenido_finanzas'), ('mirada@apicanta.com', 'Mirada', 'mirador');
    insert into public.equipo (id, nombre, email, puesto) values
      ('eq_aldana', 'Aldana', 'aldana@apicanta.com', 'Finanzas'), ('eq_nacho', 'Nacho', null, 'Editor'), ('eq_fabian', 'Fabián', null, 'Editor');
    insert into public.honorarios (id, "miembroId", conceptos) values
      ('hon_eq_aldana', 'eq_aldana', '[{"id":"fijo","monto":1350}]'), ('hon_eq_nacho', 'eq_nacho', '[{"id":"fijo","monto":204}]');
  `);
  return b;
}

for (const conArchivo of [false, true]) {
  const donde = conArchivo ? "con equipo-liquidacion-edita.sql (corrido dos veces)" : "antes del archivo";
  let compartido: Promise<Banco> | null = null;
  const banco = () => (compartido ??= nuevoBanco(conArchivo));
  const ok = async (b: Banco, email: string, sql: string) => { const r = await b.intentar(email, sql); assert.ok(r.ok, r.ok ? "" : r.mensaje); return r; };

  test(`${donde}: Aldana ${conArchivo ? "da de alta, corrige y da de baja a otros" : "todavía no puede nada"}`, { skip: saltear }, async () => {
    const b = await banco();
    const alta = await b.intentar("aldana@apicanta.com", `insert into public.equipo (id, nombre, puesto) values ('eq_enzo', 'Enzo Epuyao', 'Editor')`);
    const cambio = await b.intentar("aldana@apicanta.com", `update public.equipo set nombre = 'Enzo Ariel Epuyao' where id = 'eq_fabian'`);
    const baja = await b.intentar("aldana@apicanta.com", `update public.equipo set activo = false where id = 'eq_nacho'`);
    if (!conArchivo) {
      assert.ok(!alta.ok, "no puede dar de alta");
      assert.ok(!cambio.ok || cambio.n === 0, "no puede corregir");
      assert.ok(!baja.ok || baja.n === 0, "no puede dar de baja");
      return;
    }
    assert.ok(alta.ok && alta.n === 1, alta.ok ? "" : alta.mensaje);
    assert.ok(cambio.ok && cambio.n === 1);
    assert.ok(baja.ok && baja.n === 1);
    const [nacho] = (await ok(b, "manuel@apicanta.com", `select activo from public.equipo where id = 'eq_nacho'`)).rows as { activo: boolean }[];
    assert.equal(nacho.activo, false);
  });

  test(`${donde}: Aldana ${conArchivo ? "carga y cambia lo que cobra cada uno, pero no lo borra" : "no cambia lo que cobra nadie"}`, { skip: saltear }, async () => {
    const b = await banco();
    const nuevo = await b.intentar("aldana@apicanta.com", `insert into public.honorarios (id, "miembroId", conceptos) values ('hon_eq_fabian', 'eq_fabian', '[{"id":"fijo","monto":380}]')`);
    const cambia = await b.intentar("aldana@apicanta.com", `update public.honorarios set conceptos = '[{"id":"fijo","monto":380}]' where id = 'hon_eq_nacho'`);
    const borra = await b.intentar("aldana@apicanta.com", `delete from public.honorarios where id = 'hon_eq_nacho'`);
    if (!conArchivo) { assert.ok(!nuevo.ok && (!cambia.ok || cambia.n === 0)); return; }
    assert.ok(nuevo.ok && nuevo.n === 1, nuevo.ok ? "" : nuevo.mensaje);
    assert.ok(cambia.ok && cambia.n === 1);
    assert.ok(!borra.ok || borra.n === 0, "no borra esquemas");
    const del = await b.intentar("aldana@apicanta.com", `delete from public.equipo where id = 'eq_fabian'`);
    assert.ok(!del.ok || del.n === 0, "una persona se da de baja, no se borra");
  });

  test(`${donde}: lo suyo y los correos son de los dueños`, { skip: saltear }, async () => {
    const b = await banco();
    const propia = await b.intentar("aldana@apicanta.com", `update public.equipo set puesto = 'Dueña' where id = 'eq_aldana'`);
    const sueldo = await b.intentar("aldana@apicanta.com", `update public.honorarios set conceptos = '[{"id":"fijo","monto":9999}]' where id = 'hon_eq_aldana'`);
    const correo = await b.intentar("aldana@apicanta.com", `update public.equipo set email = 'otro@apicanta.com' where id = 'eq_nacho'`);
    const alta = await b.intentar("aldana@apicanta.com", `insert into public.equipo (id, nombre, email) values ('eq_yo2', 'Aldana otra vez', 'aldana@apicanta.com')`);
    if (!conArchivo) { assert.ok(!propia.ok || propia.n === 0); return; }
    assert.ok(!propia.ok && /Tu ficha/.test(propia.mensaje), "no cambia su ficha");
    assert.ok(!sueldo.ok && /Lo que cobrás vos/.test(sueldo.mensaje), "no cambia lo que cobra ella");
    assert.ok(!correo.ok && /correo de una persona/.test(correo.mensaje), "no cambia el correo de nadie");
    assert.ok(!alta.ok, "ni se da de alta con su propio correo");
    /* Un dueño sí cambia todo eso, y el servidor (sin sesión de una persona) también. */
    const dueno = await b.intentar("manuel@apicanta.com", `update public.honorarios set conceptos = '[{"id":"fijo","monto":1400}]' where id = 'hon_eq_aldana'`);
    assert.ok(dueno.ok && dueno.n === 1);
    await b.ejecutar(`update public.equipo set email = 'nacho@apicanta.com' where id = 'eq_nacho'`);
  });

  test(`${donde}: quien sólo ve la liquidación no arma nada, y los accesos siguen siendo de los dueños`, { skip: saltear }, async () => {
    const b = await banco();
    const alta = await b.intentar("mirada@apicanta.com", `insert into public.equipo (id, nombre) values ('eq_m', 'Mirada')`);
    assert.ok(!alta.ok, "con «ver» no se crea nada");
    const acceso = await b.intentar("aldana@apicanta.com", `insert into public.usuarios_permitidos (email, nombre, rol) values ('nuevo@apicanta.com', 'Nuevo', 'dueno')`);
    assert.ok(!acceso.ok || acceso.n === 0, "no se da accesos ni se hace dueña");
    const tipo = await b.intentar("aldana@apicanta.com", `update public.tipos_cuenta set areas = '{}' where id = 'contenido_finanzas'`);
    assert.ok(!tipo.ok || tipo.n === 0, "no cambia los tipos de cuenta");
  });
}
