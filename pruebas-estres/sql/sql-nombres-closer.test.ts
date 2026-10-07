/* Estrés de las funciones que deciden qué es «lo suyo» de un closer por su NOMBRE (supabase/tipos-cuenta.sql: nombre_corto(),
   miembro_de_nombre(), son_mios(), mis_anfitriones()) contra su gemela en la app (lib/crm.ts: miembroDeCloser), en un Postgres en
   memoria (PGlite).

   El anfitrión de Calendly es un nombre («Dante Barbieri», «Agustin Nunez») y el miembro de Equipo otro («Dante», «Agustín Núñez»): la
   base y la app tienen que decidir lo mismo sobre quién es quién, porque lo que ve un closer lo decide la base y lo que se le atribuye en
   pantalla lo decide la app. «Como nombreCorto() de src/lib/crm.ts», dice el SQL.

   Pasan: acentos, mayúsculas, primer nombre solo, apellido de más, espacios de más. Falla con la ñ y la ç (BUG: las dos tablas de
   translate() de nombre_corto no tienen el mismo largo: 48 y 49 caracteres) y con dos closers cuyos nombres empiezan con las mismas
   dos palabras (María José, Ana Laura, Juan Pablo…).

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { miembroDeCloser } from "@/lib/crm";
import { Azar, cargarPglite, lit, montarBanco, type Banco } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, { archivos: [], sinPersonas: true }));
after(async () => { if (compartido) await (await compartido).db.close(); });

interface Miembro { id: string; nombre: string; activo: boolean }
const NOMBRES = ["Dante", "Valentín", "María José", "Ana Laura", "Juan Cruz", "Noelia", "Agustín", "Lucía", "Martín", "Ángeles", "Joaquín", "Sofía", "Éric", "Úrsula", "Inés"];
const APELLIDOS = ["Abadía", "Pérez", "Gómez", "Barbieri", "Álvarez", "Müller", "De la Fuente", "López-Sosa", "O'Connor", "Fernández"];

async function cargarEquipo(b: Banco, az: Azar, nombres: readonly string[], apellidos: readonly string[], cuantos = 6): Promise<Miembro[]> {
  await b.servicio(`truncate public.equipo`);
  const equipo: Miembro[] = [];
  const claves = new Set<string>();
  while (equipo.length < cuantos) {
    const nombre = `${az.elegir(nombres)}${az.bool(0.7) ? ` ${az.elegir(apellidos)}` : ""}`;
    const clave = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(" ").slice(0, 2).join(" ");
    if (claves.has(clave)) continue;   // los que chocan se prueban aparte (más abajo)
    claves.add(clave);
    equipo.push({ id: `m${equipo.length}`, nombre, activo: az.bool(0.85) });
  }
  await b.ejecutar(`insert into public.equipo (id, nombre, activo) values ${equipo.map((m) => `(${lit(m.id)}, ${lit(m.nombre)}, ${m.activo})`).join(", ")}`);
  return equipo;
}

/** Cómo escribiría Calendly el nombre de un miembro: igual, en mayúsculas, sin tildes, sólo el primer nombre, con otro apellido, con espacios de más. */
const variantes = (m: Miembro, az: Azar, apellidos: readonly string[]): string[] => {
  const partes = m.nombre.split(" ");
  return [m.nombre, m.nombre.toUpperCase(), m.nombre.normalize("NFD").replace(/[̀-ͯ]/g, ""), partes[0], `${m.nombre} Extra`, m.nombre.replace(" ", "  "), `${partes[0]} ${az.elegir(apellidos)}`];
};

async function comparar(b: Banco, equipo: Miembro[], probe: string): Promise<{ sql: string | null; ts: string | null }> {
  const sql = (await b.servicio<{ r: string | null }>(`select public.miembro_de_nombre(${lit(probe)}) as r`))[0].r;
  const ordenado = [...equipo].sort((x, y) => Number(y.activo) - Number(x.activo) || x.id.localeCompare(y.id));
  return { sql, ts: miembroDeCloser(probe, ordenado)?.id ?? null };
}

test("miembro_de_nombre() (base) y miembroDeCloser() (app) deciden lo mismo con acentos, mayúsculas, apellidos de más y espacios de más", { skip: saltear }, async () => {
  const b = await banco();
  let comparados = 0, resueltos = 0;
  for (const semilla of [1, 2, 3]) {
    const az = new Azar(semilla);
    const equipo = await cargarEquipo(b, az, NOMBRES, APELLIDOS);
    for (let i = 0; i < 35; i++) {
      const probe = az.elegir(variantes(az.elegir(equipo), az, APELLIDOS));
      const { sql, ts } = await comparar(b, equipo, probe);
      comparados++;
      if (sql !== null) resueltos++;
      assert.equal(sql, ts, `semilla ${semilla}: «${probe}» en un equipo de ${equipo.map((m) => `${m.nombre}${m.activo ? "" : " (inactivo)"}`).join(", ")}`);
    }
  }
  assert.ok(comparados >= 100 && resueltos >= 70, `se probó poco (${comparados}, ${resueltos} resueltos)`);
});

/* BUG: nombre_corto() (supabase/tipos-cuenta.sql) usa translate() con dos tablas de distinto largo (48 y 49 caracteres): la
   minúscula «ñ» sale como «u» y la «ç» como «n» («Núñez» → «nuuez», «Peña» → «peua»). La app (NFD) los trata bien. Un closer cuyo nombre en
   Equipo tiene ñ y cuyo anfitrión de Calendly está escrito de otra manera («Agustin Nunez» / «Agustín Núñez») no se encuentra: no ve
   ninguna de sus llamadas, ni sus leads, y la app sí se las atribuye. Repro: select public.nombre_corto('Núñez')  →  'nuuez'. */
test("BUG: nombre_corto() tiene que sacarle la tilde a la ñ y a la ç igual que la app (NFD)", { skip: saltear, todo: true }, async () => {
  const b = await banco();
  for (const [entrada, esperado] of [["Núñez", "nunez"], ["Peña", "pena"], ["Muñoz", "munoz"], ["Ñandú", "nandu"], ["garçon", "garcon"], ["Ibáñez Çelik", "ibanez celik"]] as const) {
    const [{ c }] = await b.servicio<{ c: string }>(`select public.nombre_corto(${lit(entrada)}) as c`);
    assert.equal(c, esperado, `nombre_corto(${entrada})`);
  }
});

test("BUG: un closer con ñ en su nombre ve sus llamadas aunque Calendly escriba el anfitrión sin tilde", { skip: saltear, todo: true }, async () => {
  const b = await banco();
  await b.ejecutar(`
    truncate public.equipo, public.sesiones;
    delete from public.usuarios_permitidos;
    insert into public.equipo (id, nombre, email) values ('m_agus', 'Agustín Núñez', 'agus@x.com');
    insert into public.usuarios_permitidos (email, rol) values ('agus@x.com', 'closer');
    insert into public.sesiones (id, anfitrion) values ('s1', 'Agustin Nunez');`);
  const r = await b.intentar<{ id: string }>("agus@x.com", `select id from public.sesiones`);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.rows.map((x) => x.id), ["s1"], "la llamada de Agustín tiene que ser de Agustín");
});

/* BUG: nombre_corto() se queda con las DOS primeras palabras, y miembro_de_nombre() / son_mios() eligen un solo miembro por nombre
   (`order by activo desc, id limit 1`): dos closers con el mismo primer nombre compuesto (Ana Laura Pérez y Ana Laura Gómez, Juan Pablo…)
   son «la misma persona» para la base. El de menor id ve las llamadas de los dos y el otro no ve ninguna, y la app (que elige el primero
   de la lista) decide otra cosa. Repro: equipo 'Ana Laura Perez' (m_perez) y 'Ana Laura Gomez' (m_gomez), llamadas con anfitrión
   igual a cada nombre completo: m_gomez ve las dos, m_perez ninguna. */
test("BUG: dos closers cuyos nombres empiezan con las mismas dos palabras ven cada uno sólo sus llamadas", { skip: saltear, todo: true }, async () => {
  const b = await banco();
  await b.ejecutar(`
    truncate public.equipo, public.sesiones;
    delete from public.usuarios_permitidos;
    insert into public.equipo (id, nombre, email) values ('m_perez', 'Ana Laura Perez', 'perez@x.com'), ('m_gomez', 'Ana Laura Gomez', 'gomez@x.com');
    insert into public.usuarios_permitidos (email, rol) values ('perez@x.com', 'closer'), ('gomez@x.com', 'closer');
    insert into public.sesiones (id, anfitrion) values ('sP', 'Ana Laura Perez'), ('sG', 'Ana Laura Gomez');`);
  const perez = await b.intentar<{ id: string }>("perez@x.com", `select id from public.sesiones order by id`);
  const gomez = await b.intentar<{ id: string }>("gomez@x.com", `select id from public.sesiones order by id`);
  assert.deepEqual(perez.ok && perez.rows.map((x) => x.id), ["sP"], "Pérez ve la suya y no la de Gómez");
  assert.deepEqual(gomez.ok && gomez.rows.map((x) => x.id), ["sG"], "Gómez ve la suya y no la de Pérez");
});
