import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, montarBanco, sqlDe, type Banco } from "./sql/arnes-pg";
import { TIPOS_POR_DEFECTO, puedeEditar, puedeLeer, type MiAcceso } from "@/lib/permisos";

/* supabase/revision-cv.sql con el RLS y las funciones de permisos REALES en un Postgres en memoria (PGlite): la tabla, que se pueda volver a
   correr, que cada tipo de cuenta vea y edite lo mismo que dice la app (permisos.ts), la clave foránea al alumno y las restricciones. Si PGlite
   no está en el disco se saltea (ver pruebas/sql/arnes-pg.ts). */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";

const correo = (tipo: string) => `${tipo}@x.com`;
const abiertos: Banco[] = [];
async function nuevoBanco(): Promise<Banco> {
  /* customer-success.sql siembra el tipo de cuenta de Customer Success (Aldana), que tipos-cuenta.sql no trae. */
  const b = await montarBanco(Pg!, ["customer-success.sql", "revision-cv.sql"]);
  abiertos.push(b);
  await b.ejecutar(`insert into public.usuarios_permitidos (email, rol) values ${TIPOS_POR_DEFECTO.map((t) => `('${correo(t.id)}', '${t.id}')`).join(", ")}`);
  return b;
}
let compartido: Promise<Banco> | null = null;
const banco = () => (compartido ??= nuevoBanco());
after(async () => { for (const b of abiertos) await b.db.close(); });

const acceso = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};
const foto = (b: Banco) => b.servicio<{ columnas: number; politicas: number; rls: boolean; lee: string[]; edita: string[] }>(`
  select (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'revisiones_cv') as columnas,
         (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'revisiones_cv') as politicas,
         (select relrowsecurity from pg_class where oid = 'public.revisiones_cv'::regclass) as rls,
         public.areas_que_leen('revisiones_cv') as lee, public.areas_que_editan('revisiones_cv') as edita`).then((r) => r[0]);

test("la tabla nace con sus 19 columnas, su RLS y sus 4 políticas, es del área Alumnos, y se puede volver a correr sin cambiar nada", { skip: saltear }, async () => {
  const b = await banco();
  const esperado = { columnas: 19, politicas: 4, rls: true, lee: ["alumnos"], edita: ["alumnos"] };
  assert.deepEqual(await foto(b), esperado);
  await b.ejecutar(sqlDe("revision-cv.sql"));
  await b.ejecutar(sqlDe("revision-cv.sql"));
  assert.deepEqual(await foto(b), esperado, "volver a correrlo no duplica ni cambia nada");
  assert.equal((await b.servicio<{ n: number }>(`select count(*)::int n from pg_trigger where tgrelid = 'public.revisiones_cv'::regclass and not tgisinternal`))[0].n, 0);
});

test("cada tipo de cuenta lee, crea, corrige y borra revisiones exactamente como dice la app (permisos.ts): sólo Alumnos, y el que no es de nadie, nada", { skip: saltear }, async () => {
  const b = await banco();
  await b.servicio(`delete from public.revisiones_cv`);
  for (const t of TIPOS_POR_DEFECTO) {
    const a = acceso(t.id), yo = correo(t.id);
    await b.servicio(`insert into public.revisiones_cv (id, nombre, estado) values ('base', 'Ana Prueba', 'En proceso') on conflict (id) do nothing`);
    const lee = await b.intentar<{ n: number }>(yo, `select count(*)::int n from public.revisiones_cv`);
    assert.ok(lee.ok);
    assert.equal(lee.ok && lee.rows[0].n, puedeLeer(a, "revisiones_cv") ? 1 : 0, `${t.id}: lee`);

    const crea = await b.intentar(yo, `insert into public.revisiones_cv (id, nombre) values ('nueva_${t.id}', 'Otra')`);
    if (puedeEditar(a, "revisiones_cv")) assert.ok(crea.ok, `${t.id}: crea (${crea.ok ? "" : crea.mensaje})`);
    else assert.ok(!crea.ok && crea.codigo === "42501", `${t.id}: no crea (42501) y respondió ${JSON.stringify(crea)}`);

    const corrige = await b.intentar(yo, `update public.revisiones_cv set estado = 'Con Yari' where id = 'base'`);
    assert.ok(corrige.ok);
    assert.equal(corrige.ok && corrige.n, puedeEditar(a, "revisiones_cv") ? 1 : 0, `${t.id}: corrige`);
    await b.servicio(`update public.revisiones_cv set estado = 'En proceso' where id = 'base'`);

    const borra = await b.intentar(yo, `delete from public.revisiones_cv where id = 'base'`);
    assert.ok(borra.ok);
    assert.equal(borra.ok && borra.n, puedeEditar(a, "revisiones_cv") ? 1 : 0, `${t.id}: borra`);
    await b.servicio(`delete from public.revisiones_cv`);
  }
  /* Customer Success (Aldana) y el dueño sí; el closer, el setter y marketing no. */
  assert.deepEqual(TIPOS_POR_DEFECTO.filter((t) => puedeEditar(acceso(t.id), "revisiones_cv")).map((t) => t.id).includes("customer_success"), true);
  for (const t of ["closer", "setter", "marketing"]) assert.equal(puedeLeer(acceso(t), "revisiones_cv"), false, t);
  /* Alguien con sesión que no está en la lista de cuentas no ve nada, y el servidor (sin sesión) hace todo. */
  await b.servicio(`insert into public.revisiones_cv (id, nombre) values ('visible', 'Ana Prueba')`);
  const nadie = await b.intentar<{ n: number }>("nadie@x.com", `select count(*)::int n from public.revisiones_cv`);
  assert.equal(nadie.ok && nadie.rows[0].n, 0, "una persona que no es de ninguna cuenta no ve nada");
  assert.ok(!(await b.intentar("nadie@x.com", `insert into public.revisiones_cv (id) values ('x')`)).ok);
  await b.servicio(`delete from public.revisiones_cv`);
});

test("la revisión se ata al alumno con clave foránea (si el alumno se borra, la revisión queda sin atadura), y el nombre no es único", { skip: saltear }, async () => {
  const b = await banco();
  await b.servicio(`delete from public.revisiones_cv`);
  await b.servicio(`insert into public.alumnos (id) values ('al_cv') on conflict (id) do nothing`);
  /* Un alumno que no existe no se acepta. */
  const sinAlumno = await b.intentar(null, `insert into public.revisiones_cv (id, nombre, "alumnoId") values ('cv_fk_mal', 'x', 'alumno_que_no_existe')`);
  assert.ok(!sinAlumno.ok && sinAlumno.codigo === "23503", `FK al alumno: ${JSON.stringify(sinAlumno)}`);
  assert.ok((await b.intentar(null, `insert into public.revisiones_cv (id, nombre, "alumnoId") values ('cv_fk_bien', 'x', 'al_cv')`)).ok);
  /* Borrar el alumno no borra la revisión: sólo se desata. */
  await b.servicio(`delete from public.alumnos where id = 'al_cv'`);
  const [r] = await b.servicio<{ alumnoId: string | null }>(`select "alumnoId" from public.revisiones_cv where id = 'cv_fk_bien'`);
  assert.ok(r, "la revisión sigue estando");
  assert.equal(r.alumnoId, null);
  /* Dos con el mismo nombre conviven: en la base de Notion hay nombres repetidos. */
  assert.ok((await b.intentar(null, `insert into public.revisiones_cv (id, nombre) values ('cv_rep_1', 'Ana Prueba'), ('cv_rep_2', 'Ana Prueba')`)).ok);
  await b.servicio(`delete from public.revisiones_cv`);
});

test("las restricciones: el origen es manual o importado, los booleanos no admiten null, y lo que no se pone queda vacío (nada inventado)", { skip: saltear }, async () => {
  const b = await banco();
  await b.servicio(`delete from public.revisiones_cv`);
  const origenRaro = await b.intentar(null, `insert into public.revisiones_cv (id, origen) values ('cv_o', 'calendly')`);
  assert.ok(!origenRaro.ok && origenRaro.codigo === "23514", `origen: ${JSON.stringify(origenRaro)}`);
  const nulo = await b.intentar(null, `insert into public.revisiones_cv (id, "cvRecibido") values ('cv_n', null)`);
  assert.ok(!nulo.ok && nulo.codigo === "23502", `booleano null: ${JSON.stringify(nulo)}`);
  await b.servicio(`insert into public.revisiones_cv (id) values ('cv_vacia')`);
  const [v] = await b.servicio<Record<string, unknown>>(`select * from public.revisiones_cv where id = 'cv_vacia'`);
  assert.deepEqual([v.nombre, v.telefono, v.alumnoId, v.estado, v.cvRecibido, v.correccion1, v.correccion2, v.fechaInicio, v.linkCv, v.linkLoom, v.notas, v.mensajes, v.origen],
    ["", "", null, "", false, false, false, null, "", "", "", "", "manual"]);
  assert.equal(typeof v.fechaInicio === "string" || v.fechaInicio === null, true, "el día es texto, no una fecha con hora");
  await b.servicio(`delete from public.revisiones_cv`);
});

test("si se vuelve a correr tipos-cuenta.sql se pierde el parche de áreas (la lectura queda abierta a cualquier cuenta con sesión, como la de resells); volver a correr revision-cv.sql la cierra", { skip: saltear }, async () => {
  /* Está avisado en el encabezado del SQL: las dos listas de áreas se parchean sobre la definición vigente, no se copian. Una tabla que la
     función no conoce se lee con '*' (cualquiera que entre) y no la edita nadie salvo el dueño. */
  const b = await nuevoBanco();
  await b.servicio(`insert into public.revisiones_cv (id, nombre) values ('visible', 'Ana Prueba')`);
  const closerVe = async () => { const r = await b.intentar<{ n: number }>(correo("closer"), `select count(*)::int n from public.revisiones_cv`); return r.ok ? r.rows[0].n : -1; };
  assert.equal(await closerVe(), 0, "con el parche, el closer no la ve");
  await b.ejecutar(sqlDe("tipos-cuenta.sql"));
  assert.deepEqual((await foto(b)).lee, ["*"], "sin el parche, se lee con «*»");
  assert.deepEqual((await foto(b)).edita, [], "y sigue sin editarla nadie más que el dueño");
  assert.equal(await closerVe(), 1, "advertencia: hasta volver a correr revision-cv.sql, la ve cualquiera");
  assert.ok(!(await b.intentar(correo("closer"), `insert into public.revisiones_cv (id) values ('x')`)).ok, "escribir sigue cerrado");
  await b.ejecutar(sqlDe("revision-cv.sql"));
  assert.deepEqual([(await foto(b)).lee, (await foto(b)).edita], [["alumnos"], ["alumnos"]]);
  assert.equal(await closerVe(), 0, "con el parche otra vez, el closer no la ve");
});
