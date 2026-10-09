/* Estrés del almacén, frente 1: cada tabla aparece de forma coherente en TODOS lados.

   Pruebas estáticas (leen los archivos como texto, sin correr el store):
   TABLAS · TABLAS_OPCIONALES · TABLAS_DE_DUENOS (src/lib/supabase.ts), la siembra
   (ordenDeSiembra), el vaciado (vaciarNube) y la carga (cargarDeLaNube) de
   src/lib/store.ts, LEEN / EDITAN (src/lib/permisos.ts) y los supabase/*.sql,
   incluido el orden de las claves foráneas.

   Si una prueba de acá falla, casi siempre es que alguien agregó una tabla y se
   olvidó de uno de los lugares. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TABLAS, TABLAS_DE_DUENOS, TABLAS_OPCIONALES } from "@/lib/supabase";
import { EDITAN, LEEN, TIPOS_POR_DEFECTO, puedeEditar, puedeLeer, type MiAcceso } from "@/lib/permisos";
import { INTERFACES, RAIZ } from "./_aleatorio";
import { archivosSql, leerEsquema } from "./_sql";

const store = readFileSync(resolve(RAIZ, "src/lib/store.ts"), "utf8");
const esquema = leerEsquema();

/* Las tablas que nacieron en los lotes del 07/10 y viven en el almacén del store. */
const NUEVAS_DEL_STORE = ["devoluciones", "gastos_recurrentes", "seguimiento_alumnos", "testimonios"] as const;
/* Las que tienen su propio almacén aparte (no están en el estado de la app). */
const DEL_SERVIDOR = ["registros_webinar", "whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros", "whatsapp_qr"] as const;

/* Qué colección del estado es cada tabla (lo que no coincide por nombre). */
const CLAVE_DE_TABLA: Record<string, string> = {
  seguimiento_alumnos: "seguimientos", gastos_recurrentes: "gastosRecurrentes", revisiones_cv: "revisionesCv", ad_insights: "adInsights",
  etapas_servicio: "etapasServicio", tipos_cuenta: "tiposCuenta",
};

/* ---------- Leer store.ts ---------- */

function cuerpoDe(texto: string, inicio: RegExp): string {
  const m = inicio.exec(texto);
  assert.ok(m, `no encontré ${inicio} en store.ts`);
  const desde = m.index;
  const fin = texto.indexOf("\n}\n", desde);
  return texto.slice(desde, fin + 3);
}

/** [tabla, clave del estado] en el orden de ordenDeSiembra. */
function siembra(): { tabla: string; clave: string }[] {
  const c = cuerpoDe(store, /function ordenDeSiembra\(/);
  return [...c.matchAll(/\["([a-z_]+)",\s*e\.(\w+)/g)].map((m) => ({ tabla: m[1], clave: m[2] }));
}
/** Las tablas en el orden en que las vacía vaciarNube. */
function vaciado(): string[] {
  const c = cuerpoDe(store, /async function vaciarNube\(/);
  const lista = /const orden = \[([\s\S]*?)\];/.exec(c);
  assert.ok(lista, "vaciarNube ya no tiene `const orden = [...]`");
  return [...lista[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}
/** [clave del estado, tabla] de lo que cargarDeLaNube arma. */
function carga(): { clave: string; tabla: string }[] {
  const c = cuerpoDe(store, /export async function cargarDeLaNube\(/);
  const g = c.slice(c.indexOf("guardar({"));
  return [...g.matchAll(/^\s{6}(\w+):\s*\(*porTabla\.(\w+)/gm)].map((m) => ({ clave: m[1], tabla: m[2] }));
}
/** Las claves que `soloEnLaNube` deja fuera de la copia del navegador. */
function soloEnLaNube(): string[] {
  const m = /const soloEnLaNube = \(\) => \(\{([\s\S]*?)\}\)/.exec(store);
  assert.ok(m);
  return [...m[1].matchAll(/(\w+):\s*\[\]/g)].map((x) => x[1]);
}

const SIEMBRA = siembra();
const VACIADO = vaciado();
const CARGA = carga();

/* Las tablas que a propósito no se siembran ni se vacían al reiniciar la demo o restaurar un respaldo:
   - las cuatro de Meta se traen con la sincronización (soloEnLaNube: no entran en la copia del navegador ni en el respaldo);
   - tipos_cuenta: `usuarios_permitidos.rol` apunta a ella (FK) y los tipos de cuenta no son datos de la demo. */
const FUERA_DEL_REINICIO = new Set(["campaigns", "adsets", "ads", "ad_insights", "tipos_cuenta"]);

test("TABLAS: sin repetidas, y las opcionales y las de dueños son un subconjunto", () => {
  assert.equal(new Set(TABLAS).size, TABLAS.length, "hay una tabla repetida en TABLAS");
  for (const t of TABLAS_OPCIONALES) assert.ok((TABLAS as readonly string[]).includes(t), `${t} está en TABLAS_OPCIONALES pero no en TABLAS`);
  for (const t of TABLAS_DE_DUENOS) assert.ok((TABLAS as readonly string[]).includes(t), `${t} está en TABLAS_DE_DUENOS pero no en TABLAS`);
  /* Las de dueños no pueden ser obligatorias: un usuario que no es dueño recibe vacío (RLS), y una base de antes no las tiene. */
  for (const t of TABLAS_DE_DUENOS) assert.ok(TABLAS_OPCIONALES.has(t), `${t} es sólo de dueños y tendría que ser opcional`);
});

test("las tablas nuevas del store están en TABLAS, son opcionales, se siembran, se vacían, se cargan y tienen su SQL", () => {
  for (const t of NUEVAS_DEL_STORE) {
    assert.ok((TABLAS as readonly string[]).includes(t), `${t} falta en TABLAS`);
    assert.ok(TABLAS_OPCIONALES.has(t), `${t} falta en TABLAS_OPCIONALES: sin su SQL la app se caería al cargar`);
    assert.ok(SIEMBRA.some((s) => s.tabla === t), `${t} falta en ordenDeSiembra: el respaldo y «volver al ejemplo» la dejarían afuera`);
    assert.ok(VACIADO.includes(t), `${t} falta en vaciarNube: restaurar un respaldo duplicaría o mezclaría lo que había`);
    assert.ok(CARGA.some((c) => c.tabla === t), `${t} no se asigna en cargarDeLaNube`);
    assert.ok(esquema.tablas.get(t)?.creada, `no hay un supabase/*.sql que cree ${t}`);
  }
});

test("lo que se siembra y lo que se vacía es lo mismo (menos lo que a propósito se deja)", () => {
  const siembraT = SIEMBRA.map((s) => s.tabla);
  assert.equal(new Set(siembraT).size, siembraT.length, "una tabla se siembra dos veces");
  assert.equal(new Set(VACIADO).size, VACIADO.length, "una tabla se vacía dos veces");
  const esperadas = (TABLAS as readonly string[]).filter((t) => !FUERA_DEL_REINICIO.has(t)).sort();
  assert.deepEqual([...siembraT].sort(), esperadas, "ordenDeSiembra no cubre las mismas tablas que TABLAS");
  assert.deepEqual([...VACIADO].sort(), esperadas, "vaciarNube no cubre las mismas tablas que TABLAS");
  /* Lo que se deja afuera no puede quedar a medias: si no se vacía, no se siembra, y al revés. */
  for (const t of FUERA_DEL_REINICIO) {
    assert.ok(!siembraT.includes(t) && !VACIADO.includes(t), `${t} está a medias: se siembra o se vacía pero no las dos`);
  }
  /* Y lo que no entra en la copia local (soloEnLaNube) es justo lo de Meta. */
  assert.deepEqual(soloEnLaNube().filter((k) => k !== "honorarios" && k !== "liquidaciones").sort(), ["adInsights", "adsets", "ads", "campaigns"].sort());
});

test("cada tabla se carga en la colección que la siembra usa, y esa colección existe en EstadoApp", () => {
  const estado = new Set((INTERFACES.get("EstadoApp") ?? []).map((c) => c.nombre));
  assert.ok(estado.size > 20, "no pude leer EstadoApp de types.ts");
  const cargaPorTabla = new Map(CARGA.map((c) => [c.tabla, c.clave] as const));
  for (const t of TABLAS) {
    const clave = cargaPorTabla.get(t);
    assert.ok(clave, `cargarDeLaNube no asigna ${t}: se bajaría de la base y se tiraría`);
    assert.ok(estado.has(clave), `cargarDeLaNube pone ${t} en «${clave}», que no es un campo de EstadoApp`);
    assert.equal(clave, CLAVE_DE_TABLA[t] ?? t, `${t} se carga en «${clave}»: la convención del proyecto es la colección con el mismo nombre (o una de CLAVE_DE_TABLA)`);
  }
  for (const s of SIEMBRA) {
    assert.equal(cargaPorTabla.get(s.tabla), s.clave, `${s.tabla}: la siembra lee e.${s.clave} pero la carga escribe e.${cargaPorTabla.get(s.tabla)}`);
  }
  /* Y al revés: toda colección de EstadoApp que sea una lista de filas viene de alguna tabla. */
  const sinTabla = [...estado].filter((k) => !["version", "ajustes"].includes(k) && !CARGA.some((c) => c.clave === k));
  assert.deepEqual(sinTabla, [], `colecciones de EstadoApp que nunca se cargan de la base: ${sinTabla.join(", ")}`);
});

/* ---------- Claves foráneas ---------- */

const FKS = [...esquema.fks, { hijo: "ventas", columna: "contactoId", padre: "leads", alBorrar: "restrict" as const, archivo: "(memoria del proyecto)" }]
  .filter((f) => (TABLAS as readonly string[]).includes(f.hijo));

test("la siembra pone cada padre antes que su hijo (claves foráneas del SQL)", () => {
  const orden = SIEMBRA.map((s) => s.tabla);
  for (const fk of FKS) {
    if (!orden.includes(fk.hijo)) continue;
    if (!orden.includes(fk.padre)) {
      /* El padre no se siembra: tiene que sobrevivir al vaciado, o la restauración cortaría a la mitad. */
      assert.ok(!VACIADO.includes(fk.padre), `${fk.hijo}.${fk.columna} apunta a ${fk.padre}, que se vacía pero no se siembra`);
      continue;
    }
    assert.ok(orden.indexOf(fk.padre) < orden.indexOf(fk.hijo), `${fk.padre} tiene que sembrarse antes que ${fk.hijo} (${fk.hijo}.${fk.columna}, ${fk.archivo})`);
  }
});

test("el vaciado borra cada hijo antes que su padre", () => {
  for (const fk of FKS) {
    if (!VACIADO.includes(fk.hijo) || !VACIADO.includes(fk.padre)) continue;
    assert.ok(VACIADO.indexOf(fk.hijo) < VACIADO.indexOf(fk.padre), `${fk.hijo} tiene que vaciarse antes que ${fk.padre} (${fk.hijo}.${fk.columna}, ${fk.archivo})`);
  }
});

/* ---------- LEEN / EDITAN ---------- */

/* Escrita contra la versión anterior del lote de WhatsApp (tablas sin whatsapp_qr ni la columna «estado», con whatsapp_contactados, estados del lector sin «esperando-qr» y leerJson por caracteres): hay que actualizarla al esquema nuevo. */
test("cada tabla con LEEN/EDITAN existe en TABLAS o es una tabla del servidor conocida", { todo: true }, () => {
  const conocidas = new Set<string>([...TABLAS, "ajustes", "transacciones", "yt_analytics", "yt_chat", "yt_estado", "yt_muestras", "usuarios_permitidos"]);
  for (const t of [...Object.keys(LEEN), ...Object.keys(EDITAN)]) assert.ok(conocidas.has(t), `LEEN/EDITAN nombran ${t}, que no es ninguna tabla conocida (un typo deja la tabla abierta o cerrada)`);
});

test("las tablas de TABLAS que no están en EDITAN son las de «sólo dueños», y ahí la base dice lo mismo", () => {
  const LIBRES = new Set(["actividad", "preferencias"]);
  const sinEditan = (TABLAS as readonly string[]).filter((t) => !(t in EDITAN) && !LIBRES.has(t)).sort();
  assert.deepEqual(sinEditan, ["equipo", "honorarios", "liquidaciones", "tipos_cuenta"], "cambió el conjunto de tablas que sólo escribe un dueño");
  const tc = archivosSql().find((a) => a.nombre === "supabase/tipos-cuenta.sql")!.texto;
  const editan = /create or replace function public\.areas_que_editan[\s\S]*?\$\$;/.exec(tc)![0];
  for (const t of sinEditan) assert.ok(!new RegExp(`when '${t}'\\s+then`).test(editan), `${t} no está en EDITAN pero la base le da un área en areas_que_editan`);
});

test("lo que sólo escriben los dueños y se siembra tiene que estar en TABLAS_DE_DUENOS (si no, restaurar siendo otro tipo de cuenta corta la siembra)", () => {
  /* La UI sólo deja restaurar al dueño (Ajustes → Datos), así que hoy no se llega. Pero el store no lo verifica:
     la regla «las de dueños se saltean» es la que impide dejar la base a la mitad. */
  const soloDuenos = (TABLAS as readonly string[]).filter((t) => !(t in EDITAN) && t !== "actividad");
  const faltan = soloDuenos.filter((t) => SIEMBRA.some((s) => s.tabla === t) && !TABLAS_DE_DUENOS.has(t));
  assert.deepEqual(faltan, ["equipo"], "si esto cambia, actualizá el test y el hallazgo");
});

function politicas(tabla: string): { op: string; expr: string; archivo: string }[] {
  const salida: { op: string; expr: string; archivo: string }[] = [];
  for (const { nombre, texto } of archivosSql()) {
    const re = new RegExp(String.raw`create\s+policy\s+\w+\s+on\s+public\.${tabla}\s+for\s+(\w+)\s+to\s+authenticated\s+(using|with check)\s*\(([\s\S]*?)\);`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) salida.push({ op: m[1].toLowerCase(), expr: m[3], archivo: nombre });
  }
  return salida;
}
const areasEnNivel = (expr: string, nivel: number) =>
  [...new Set([...expr.matchAll(/nivel_area\('(\w+)'\)\)?\s*>=\s*(\d)/g)].filter((m) => Number(m[2]) === nivel).map((m) => m[1]))];

test("gastos_recurrentes: las políticas del SQL (nivel_area directo) dicen lo mismo que LEEN y EDITAN", () => {
  const ps = politicas("gastos_recurrentes");
  const ver = ps.find((p) => p.op === "select")!;
  assert.deepEqual(areasEnNivel(ver.expr, 1).sort(), [...LEEN.gastos_recurrentes].sort());
  for (const op of ["insert", "update", "delete"]) {
    const p = ps.filter((x) => x.op === op);
    assert.ok(p.length >= 1, `falta la política de ${op}`);
    for (const x of p) assert.deepEqual(areasEnNivel(x.expr, 2).sort(), [...EDITAN.gastos_recurrentes].sort(), `${op} de gastos_recurrentes`);
  }
});

test("devoluciones: ve quien ve ventas; carga finanzas o ventas sin «sólo lo suyo» (la regla de puedeEditar)", () => {
  const ps = politicas("devoluciones");
  const ver = ps.find((p) => p.op === "select")!;
  assert.deepEqual(areasEnNivel(ver.expr, 1).sort(), [...LEEN.devoluciones].sort(), "LEEN.devoluciones ≠ política de lectura");
  for (const op of ["insert", "update", "delete"]) {
    for (const x of ps.filter((p) => p.op === op)) {
      assert.deepEqual(areasEnNivel(x.expr, 2).sort(), [...EDITAN.devoluciones].sort(), `EDITAN.devoluciones ≠ política de ${op}`);
      assert.match(x.expr, /not public\.solo_lo_suyo\(\)/, `${op}: el closer no tiene que cargar devoluciones`);
    }
  }
  /* Y la función de la app, contra cada tipo de cuenta de fábrica. */
  for (const t of TIPOS_POR_DEFECTO) {
    const a: MiAcceso = { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
    const sql = t.id === "dueno" || (t.areas.finanzas === "editar") || (t.areas.ventas === "editar" && !t.soloLoSuyo);
    assert.equal(puedeEditar(a, "devoluciones"), sql, `devoluciones: ${t.id}`);
  }
});

test("seguimiento_alumnos y testimonios: sólo el área Alumnos, en la app y en la base", () => {
  const tc = archivosSql().find((a) => a.nombre === "supabase/tipos-cuenta.sql")!.texto;
  for (const f of ["areas_que_leen", "areas_que_editan"]) {
    const fn = new RegExp(`create or replace function public\\.${f}[\\s\\S]*?\\$\\$;`).exec(tc)![0];
    for (const t of ["seguimiento_alumnos", "testimonios"]) assert.match(fn, new RegExp(`when '${t}'\\s+then array\\['alumnos'\\]`), `${f}(${t})`);
  }
  for (const t of ["seguimiento_alumnos", "testimonios"]) {
    assert.deepEqual(LEEN[t], ["alumnos"]);
    assert.deepEqual(EDITAN[t], ["alumnos"]);
  }
  /* Customer Success las ve y las edita; el closer ni las ve. */
  const cs = TIPOS_POR_DEFECTO.find((t) => t.id === "customer_success")!;
  const acs: MiAcceso = { tipo: cs.id, nombre: cs.nombre, areas: cs.areas, soloLoSuyo: cs.soloLoSuyo };
  const closer = TIPOS_POR_DEFECTO.find((t) => t.id === "closer")!;
  const ac: MiAcceso = { tipo: closer.id, nombre: closer.nombre, areas: closer.areas, soloLoSuyo: closer.soloLoSuyo };
  for (const t of ["seguimiento_alumnos", "testimonios"]) {
    assert.ok(puedeLeer(acs, t) && puedeEditar(acs, t));
    assert.ok(!puedeLeer(ac, t) && !puedeEditar(ac, t));
  }
});

/* ---------- Las tablas que no están en el estado de la app ---------- */

/* Escrita contra la versión anterior del lote de WhatsApp (tablas sin whatsapp_qr ni la columna «estado», con whatsapp_contactados, estados del lector sin «esperando-qr» y leerJson por caracteres): hay que actualizarla al esquema nuevo. */
test("registros_webinar y whatsapp_*: no están en TABLAS (tienen almacén propio), existen en el SQL y tienen RLS", { todo: true }, () => {
  for (const t of DEL_SERVIDOR) {
    assert.ok(!(TABLAS as readonly string[]).includes(t), `${t} no tiene colección en EstadoApp: no puede estar en TABLAS`);
    assert.ok(esquema.tablas.get(t)?.creada, `no hay SQL que cree ${t}`);
    const archivos = [...(esquema.tablas.get(t)?.archivos ?? [])];
    const texto = archivos.map((a) => archivosSql().find((x) => x.nombre === a)!.texto).join("\n");
    assert.match(texto, new RegExp(`alter table public\\.${t}\\s+enable row level security`, "i"), `${t} sin RLS: la clave pública alcanzaría para leerla`);
  }
  /* Las del lector de WhatsApp las escribe sólo el servidor: ninguna política de escritura. */
  for (const t of ["whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros"]) {
    const escribe = politicas(t).filter((p) => p.op !== "select");
    assert.deepEqual(escribe, [], `${t} tiene una política de escritura para authenticated`);
    assert.deepEqual(politicas(t).map((p) => p.op), ["select"]);
  }
  /* registros_webinar: lo ve y lo escribe quien ve/edita Webinars y no ve «sólo lo suyo» (el closer no los ve). */
  const ps = politicas("registros_webinar");
  assert.deepEqual(ps.map((p) => p.op).sort(), ["delete", "insert", "select", "update"]);
  for (const p of ps) assert.match(p.expr, /not public\.solo_lo_suyo\(\)/, `registros_webinar ${p.op}: el closer no tiene que ver los registros de la landing`);
});

test("toda tabla creada en un supabase/*.sql tiene RLS prendido (la clave pública viaja en el JavaScript de la app)", () => {
  const SIN_RLS_A_PROPOSITO = new Set(["capi_enviados", "fathom_conexion", "grabaciones", "yt_conexion"]);
  const flojas: string[] = [];
  for (const [nombre, t] of esquema.tablas) {
    if (!t.creada || [...t.archivos].every((a) => a.startsWith("sql/"))) continue;
    if (SIN_RLS_A_PROPOSITO.has(nombre)) continue;
    const texto = [...t.archivos].map((a) => archivosSql().find((x) => x.nombre === a)!.texto).join("\n");
    const directo = new RegExp(`alter table (public\\.)?${nombre}\\s+enable row level security`, "i").test(texto);
    /* o en un bucle: foreach t in array array['a', 'b'] loop … enable row level security */
    const enBucle = new RegExp(`array\\[[^\\]]*'${nombre}'[^\\]]*\\][\\s\\S]{0,400}?enable row level security`, "i").test(texto);
    if (!directo && !enBucle) flojas.push(nombre);
  }
  /* `grabaciones`, `fathom_conexion`, `capi_enviados` y `yt_conexion` son del servidor (clave de servicio). */
  assert.deepEqual(flojas, [], `tablas sin RLS en el SQL: ${flojas.join(", ")}`);
});
