/* Estrés de las políticas de RLS de cinco tablas, con el RLS de verdad (Postgres en memoria, PGlite): devoluciones
   (supabase/devoluciones.sql), gastos_recurrentes (gastos-recurrentes.sql), registros_webinar (registros-webinar.sql),
   seguimiento_alumnos y testimonios (customer-success.sql), sobre tipos-cuenta.sql.

   Para cada tipo de cuenta de fábrica y 14 tipos inventados al azar (áreas 'ver'/'editar' y «sólo lo suyo» a gusto), más una
   persona que no está en la lista y la clave de servicio, se prueba qué filas LEE y qué puede INSERTAR, CORREGIR y BORRAR, y se
   compara con lo que dice src/lib/permisos.ts (LEEN, EDITAN, puedeLeer, puedeEditar, puedeCargarDevolucion):
     · devoluciones: la ve quien ve las ventas (el closer, sólo las de sus ventas); la carga/corrige/borra Finanzas editable o
       Ventas editable sin «sólo lo suyo»;
     · gastos_recurrentes, seguimiento_alumnos, testimonios: LEEN y EDITAN;
     · registros_webinar (no está en permisos.ts: manda el encabezado de su SQL): la ve quien ve Webinars y no es «sólo lo suyo»,
       y la cambia quien edita Webinars y no lo es; la vista registros_webinar_resumen respeta lo mismo.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { AREAS, EDITAN, LEEN, nivelDeAreas, puedeCargarDevolucion, puedeEditar, puedeLeer, nivelEn, TIPOS_POR_DEFECTO, type AreasDeTipo, type MiAcceso } from "@/lib/permisos";
import {
  altaDeTiposAlAzar, Azar, cargarPglite, lit, montarBanco, personasPorDefecto, type Banco, type PersonaConAcceso,
} from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, {
  archivos: ["devoluciones.sql", "gastos-recurrentes.sql", "registros-webinar.sql", "customer-success.sql", "customer-success-lili.sql"], veces: 2,
}));
after(async () => { if (compartido) await (await compartido).db.close(); });

/* ---------- los datos ---------- */

/** Las ventas y a quién pertenece cada una: closer, setter o cuota heredada. */
interface VentaDe { id: string; closerId: string; setterId?: string; hereda?: string }
let ventas: VentaDe[] = [];
let personas: PersonaConAcceso[] = [];
/** A qué venta pertenece cada devolución sembrada (null: la propuesta de la pasarela que todavía no sabe de qué venta es). */
let ventaDeDevolucion: Record<string, string | null> = {};

/** Las ventas de uno: es su closer, su setter, o tiene cuotas heredadas (lo que dice el encabezado de tipos-cuenta.sql). */
const misVentas = (miembroId?: string): Set<string> => new Set(
  miembroId ? ventas.filter((v) => v.closerId === miembroId || v.setterId === miembroId || v.hereda === miembroId).map((v) => v.id) : [],
);

async function sembrarBase(b: Banco): Promise<void> {
  await b.servicio(`truncate public.devoluciones, public.gastos_recurrentes, public.registros_webinar, public.seguimiento_alumnos, public.testimonios, public.alumnos, public.cuotas, public.ventas`);
  ventas = [
    { id: "v1", closerId: "m_dante" }, { id: "v2", closerId: "m_otro" }, { id: "v3", closerId: "m_santi", setterId: "m_dante" },
    { id: "v4", closerId: "m_otro", hereda: "m_dante" },
  ];
  personas.forEach((p, i) => { if (p.miembroId) ventas.push({ id: `vx${i}`, closerId: p.miembroId }); });
  /* Algunos de los tipos inventados reciben una cuota heredada de la venta de otro, y otros son el setter de una venta. */
  for (const p of personas.filter((x) => x.tipo.startsWith("tz_")).slice(0, 3)) ventas.push({ id: `vh_${p.miembroId}`, closerId: "m_otro", hereda: p.miembroId });
  for (const p of personas.filter((x) => x.tipo.startsWith("tz_")).slice(3, 6)) ventas.push({ id: `vs_${p.miembroId}`, closerId: "m_otro", setterId: p.miembroId });
  await b.servicio(`insert into public.ventas (id, "closerId", "setterId") values ${ventas.map((v) => `(${lit(v.id)}, ${lit(v.closerId)}, ${lit(v.setterId ?? null)})`).join(", ")}`);
  await b.servicio(`insert into public.cuotas (id, "ventaId", "closerId") values ${ventas.map((v) => `(${lit(`c_${v.id}`)}, ${lit(v.id)}, ${lit(v.hereda ?? null)})`).join(", ")}`);
}

const T_DEVOLUCIONES = "devoluciones", T_GASTOS = "gastos_recurrentes", T_REGISTROS = "registros_webinar", T_SEGUIMIENTO = "seguimiento_alumnos", T_TESTIMONIOS = "testimonios";

async function sembrarTabla(b: Banco, tabla: string): Promise<string[]> {
  await b.servicio(`truncate public.${tabla}`);
  if (tabla === T_DEVOLUCIONES) {
    const ids = [...ventas.map((v) => v.id), null, "venta-borrada"];
    ventaDeDevolucion = Object.fromEntries(ids.map((v, i) => [`d${i}`, v]));
    await b.servicio(`insert into public.devoluciones (id, "ventaId", monto) values ${ids.map((v, i) => `('d${i}', ${lit(v)}, ${10 + i})`).join(", ")}`);
    return ids.map((_, i) => `d${i}`);
  }
  if (tabla === T_GASTOS) {
    await b.servicio(`insert into public.gastos_recurrentes (id, concepto, categoria, desde) values ('g1','Fathom','Software','2026-10'), ('g2','EverWebinar','Software','2026-10')`);
    return ["g1", "g2"];
  }
  if (tabla === T_REGISTROS) {
    await b.servicio(`insert into public.registros_webinar (id, email, "fechaWebinar") values ('r1','a@x.com','2026-10-01'), ('r2','b@x.com','2026-10-01'), ('r3','c@x.com','2026-10-08')`);
    return ["r1", "r2", "r3"];
  }
  await b.servicio(`insert into public.alumnos (id) values ${Array.from({ length: 60 }, (_, i) => `('a${i}')`).join(", ")} on conflict (id) do nothing`);
  if (tabla === T_SEGUIMIENTO) {
    await b.servicio(`insert into public.seguimiento_alumnos (id, "alumnoId") values ('s1','a1'), ('s2','a2')`);
    return ["s1", "s2"];
  }
  await b.servicio(`insert into public.testimonios (id, "alumnoId") values ('t1','a1'), ('t2','a2')`);
  return ["t1", "t2"];
}

/* ---------- lo que dice permisos.ts (o el SQL, donde permisos.ts no dice) ---------- */

const veVentas = (a: MiAcceso) => puedeLeer(a, "devoluciones");
const soloSuyo = (a: MiAcceso) => a.soloLoSuyo && a.tipo !== "dueno";

function puedeVerFila(tabla: string, a: MiAcceso, id: string): boolean {
  switch (tabla) {
    case T_DEVOLUCIONES: {
      if (!veVentas(a)) return false;
      if (!soloSuyo(a)) return true;
      const venta = ventaDeDevolucion[id];
      return venta !== null && venta !== undefined && misVentas(a.miembroId).has(venta);
    }
    case T_GASTOS: return puedeLeer(a, T_GASTOS);
    case T_REGISTROS: return nivelEn(a, "webinars") >= 1 && !soloSuyo(a);
    default: return puedeLeer(a, tabla);
  }
}
function puedeEscribirTabla(tabla: string, a: MiAcceso): boolean {
  switch (tabla) {
    case T_DEVOLUCIONES: return puedeCargarDevolucion(a);
    case T_REGISTROS: return nivelEn(a, "webinars") >= 2 && !soloSuyo(a);
    default: return puedeEditar(a, tabla);
  }
}

/* ---------- la prueba ---------- */

const INSERTS: Record<string, (n: number) => string> = {
  [T_DEVOLUCIONES]: (n) => `insert into public.devoluciones (id, "ventaId", monto) values ('dn${n}', 'v1', 5)`,
  [T_GASTOS]: (n) => `insert into public.gastos_recurrentes (id, concepto, categoria, desde) values ('gn${n}', 'Nuevo', 'Software', '2026-10')`,
  [T_REGISTROS]: (n) => `insert into public.registros_webinar (id, email, "fechaWebinar") values ('rn${n}', 'n${n}@x.com', '2026-10-01')`,
  [T_SEGUIMIENTO]: (n) => `insert into public.seguimiento_alumnos (id, "alumnoId") values ('sn${n}', 'a${10 + n}')`,
  [T_TESTIMONIOS]: (n) => `insert into public.testimonios (id, "alumnoId") values ('tn${n}', 'a${10 + n}')`,
};
const UPDATES: Record<string, (id: string) => string> = {
  [T_DEVOLUCIONES]: (id) => `update public.devoluciones set notas = 'x' where id = '${id}'`,
  [T_GASTOS]: (id) => `update public.gastos_recurrentes set notas = 'x' where id = '${id}'`,
  [T_REGISTROS]: (id) => `update public.registros_webinar set notas = 'x' where id = '${id}'`,
  [T_SEGUIMIENTO]: (id) => `update public.seguimiento_alumnos set notas = 'x' where id = '${id}'`,
  [T_TESTIMONIOS]: (id) => `update public.testimonios set notas = 'x' where id = '${id}'`,
};

async function probarTabla(b: Banco, tabla: string, quienes: (PersonaConAcceso | null)[], visto: Record<string, number>): Promise<void> {
  for (const [n, persona] of quienes.entries()) {
    const email = persona?.email ?? null;
    const a = persona?.acceso;
    const nombre = `${tabla} / ${persona ? `${persona.tipo} ${JSON.stringify(a?.areas)} soloLoSuyo=${a?.soloLoSuyo}` : "servicio"}`;
    const filas = await sembrarTabla(b, tabla);
    const esperadasVer = persona === null ? filas : filas.filter((id) => puedeVerFila(tabla, a!, id));

    /* leer */
    const r = await b.intentar<{ id: string }>(email, `select id from public.${tabla} order by id`);
    assert.ok(r.ok, `${nombre}: leer\n${r.ok ? "" : r.mensaje}`);
    assert.deepEqual(r.rows.map((x) => x.id).sort(), [...esperadasVer].sort(), `${nombre}: qué filas lee`);
    if (esperadasVer.length) visto.leyo++;
    if (tabla === T_DEVOLUCIONES && a && soloSuyo(a) && veVentas(a)) { visto.soloSuyoVe += esperadasVer.length > 0 ? 1 : 0; visto.soloSuyoNoVeAjenas += esperadasVer.length < filas.length ? 1 : 0; }

    const escribe = persona === null ? true : puedeEscribirTabla(tabla, a!);
    /* insertar: el INSERT sólo mira el permiso de escribir (WITH CHECK), no lo que ve */
    const ins = await b.intentar(email, INSERTS[tabla](n));
    if (escribe) { assert.ok(ins.ok, `${nombre}: tenía que poder insertar\n${ins.ok ? "" : ins.mensaje}`); visto.inserto++; }
    else { assert.ok(!ins.ok && ins.codigo === "42501", `${nombre}: no tenía que poder insertar y respondió ${JSON.stringify(ins)}`); visto.rechazado++; }

    /* corregir y borrar: sólo las filas que ve Y puede escribir (una muestra repartida, para no gastar de más) */
    const muestra = filas.filter((_, i) => filas.length <= 8 || i % Math.ceil(filas.length / 8) === 0 || i === filas.length - 1);
    for (const id of muestra) {
      const quedan = persona === null || (escribe && puedeVerFila(tabla, a!, id));
      const up = await b.intentar(email, UPDATES[tabla](id));
      assert.ok(up.ok, `${nombre}: update ${id}`);
      assert.equal(up.ok && up.n, quedan ? 1 : 0, `${nombre}: corregir ${id}`);
    }
    for (const id of muestra) {
      const quedan = persona === null || (escribe && puedeVerFila(tabla, a!, id));
      const del = await b.intentar(email, `delete from public.${tabla} where id = '${id}'`);
      assert.ok(del.ok, `${nombre}: delete ${id}`);
      assert.equal(del.ok && del.n, quedan ? 1 : 0, `${nombre}: borrar ${id}`);
    }
  }
}

test("devoluciones, gastos fijos, registros del webinar, seguimiento y testimonios: lo que cada tipo lee y escribe es lo que dicen LEEN y EDITAN", { skip: saltear }, async () => {
  const b = await banco();
  const az = new Azar(2026);
  personas = [...personasPorDefecto(), ...(await altaDeTiposAlAzar(b, az, 13))];
  /* Una persona que no está en la lista de accesos. */
  const intruso: PersonaConAcceso = { email: "intruso@x.com", tipo: "ninguno", acceso: { tipo: "ninguno", nombre: "", areas: {}, soloLoSuyo: false } };
  const visto = { leyo: 0, inserto: 0, rechazado: 0, soloSuyoVe: 0, soloSuyoNoVeAjenas: 0 };
  await sembrarBase(b);
  for (const tabla of [T_DEVOLUCIONES, T_GASTOS, T_REGISTROS, T_SEGUIMIENTO, T_TESTIMONIOS]) {
    await probarTabla(b, tabla, [...personas, intruso, null], visto);
  }
  assert.ok(visto.leyo >= 30 && visto.inserto >= 12 && visto.rechazado >= 50 && visto.soloSuyoVe >= 2 && visto.soloSuyoNoVeAjenas >= 2, `el generador tiene que llegar a todos los casos: ${JSON.stringify(visto)}`);
});

test("registros_webinar_resumen (security_invoker) cuenta sólo lo que cada persona ve", { skip: saltear }, async () => {
  const b = await banco();
  await sembrarTabla(b, T_REGISTROS);
  for (const p of personasPorDefecto()) {
    const r = await b.intentar<{ registros: number }>(p.email, `select coalesce(sum(registros), 0)::int registros from public.registros_webinar_resumen`);
    assert.ok(r.ok, `${p.tipo}: ${r.ok ? "" : r.mensaje}`);
    assert.equal(r.ok && r.rows[0].registros, puedeVerFila(T_REGISTROS, p.acceso, "r1") ? 3 : 0, `${p.tipo}: lo que cuenta el resumen`);
  }
});

test("el tipo Dueño sigue viendo y editando todo aunque alguien le vacíe las áreas o le ponga «sólo lo suyo» por SQL", { skip: saltear }, async () => {
  const b = await banco();
  await sembrarBase(b);
  await b.servicio(`update public.tipos_cuenta set areas = '{}'::jsonb, "soloLoSuyo" = true where id = 'dueno'`);
  try {
    for (const tabla of [T_DEVOLUCIONES, T_GASTOS, T_REGISTROS, T_SEGUIMIENTO, T_TESTIMONIOS]) {
      const filas = await sembrarTabla(b, tabla);
      const r = await b.intentar<{ id: string }>("yari@x.com", `select id from public.${tabla}`);
      assert.ok(r.ok);
      assert.equal(r.ok && r.rows.length, filas.length, `${tabla}: el dueño ve todo`);
      const ins = await b.intentar("yari@x.com", INSERTS[tabla](30));
      assert.ok(ins.ok, `${tabla}: el dueño inserta`);
    }
  } finally {
    await b.servicio(`update public.tipos_cuenta set areas = '{"panel":"editar","leads":"editar","crm":"editar","ventas":"editar","webinars":"editar","marketing":"editar","alumnos":"editar","finanzas":"editar","ajustes":"editar"}'::jsonb, "soloLoSuyo" = false where id = 'dueno'`);
  }
});

test("el correo de la sesión se compara sin mayúsculas, y una sesión sin correo no es nadie", { skip: saltear }, async () => {
  const b = await banco();
  await sembrarBase(b);
  await sembrarTabla(b, T_GASTOS);
  const mayus = await b.intentar<{ id: string }>("ALDANA@X.COM", `select id from public.gastos_recurrentes`);
  assert.ok(mayus.ok && mayus.rows.length === 2, "Administración con el correo en mayúsculas ve los gastos fijos");
  const sinCorreo = await b.intentar<{ id: string }>("", `select id from public.gastos_recurrentes`);
  assert.ok(sinCorreo.ok && sinCorreo.rows.length === 0, "una sesión sin correo no ve nada");
  const sinCorreoEscribe = await b.intentar("", INSERTS[T_GASTOS](5));
  assert.ok(!sinCorreoEscribe.ok, "ni escribe");
});

/* ve(tabla) y edita(tabla) de la base (las que usan las políticas de todas las tablas) contra puedeLeer() y puedeEditar() de la app,
   para TODAS las tablas de LEEN y EDITAN y cualquier combinación de áreas: la lista de la app y la de la base no se pueden separar. */
test("ve() y edita() de la base dicen lo mismo que puedeLeer() y puedeEditar() para todas las tablas y 30 tipos inventados", { skip: saltear }, async () => {
  const b = await banco();
  const az = new Azar(404);
  const todas = [...new Set([...Object.keys(LEEN), ...Object.keys(EDITAN), "ajustes", "equipo", "webinars", "tipos_cuenta", "actividad_inexistente"])].sort();
  /* Las tablas cuya regla no pasa por areas_que_leen()/areas_que_editan(): tienen su política propia (devoluciones, gastos_recurrentes,
     alumnos, registros_webinar) o son de cualquiera que entre (actividad y preferencias). */
  const PROPIAS_LEER = new Set(["devoluciones", "gastos_recurrentes", "whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros", "whatsapp_qr"]);
  const PROPIAS_EDITAR = new Set(["devoluciones", "gastos_recurrentes", "alumnos", "actividad", "preferencias", "whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros", "whatsapp_qr"]);
  const gente: PersonaConAcceso[] = [...personasPorDefecto(), ...(await altaDeTiposAlAzar(b, az, 30, "tv"))];
  let comparadas = 0;
  for (const p of gente) {
    const r = await b.intentar<{ t: string; ve: boolean; edita: boolean }>(p.email,
      `select t, public.ve(t) as ve, public.edita(t) as edita from unnest(array[${todas.map((t) => lit(t)).join(",")}]::text[]) as t`);
    assert.ok(r.ok, r.ok ? "" : r.mensaje);
    for (const x of r.ok ? r.rows : []) {
      if (!PROPIAS_LEER.has(x.t)) { assert.equal(x.ve, puedeLeer(p.acceso, x.t), `ve('${x.t}') como ${p.tipo} ${JSON.stringify(p.acceso.areas)}`); comparadas++; }
      if (!PROPIAS_EDITAR.has(x.t)) { assert.equal(x.edita, puedeEditar(p.acceso, x.t), `edita('${x.t}') como ${p.tipo} ${JSON.stringify(p.acceso.areas)}`); comparadas++; }
    }
  }
  assert.ok(comparadas > 2000, `se probó poco (${comparadas})`);
});

/* Los tipos de fábrica de permisos.ts («los mismos que siembra supabase/tipos-cuenta.sql») y los que sembró la base (con customer-success.sql). */
test("los tipos de cuenta que siembra la base son los de TIPOS_POR_DEFECTO (nombre, descripción, áreas, «sólo lo suyo», orden)", { skip: saltear }, async () => {
  const b = await banco();
  const filas = await b.servicio<{ id: string; nombre: string; descripcion: string; areas: Record<string, string>; soloLoSuyo: boolean; orden: number }>(
    `select id, nombre, descripcion, areas, "soloLoSuyo", orden from public.tipos_cuenta where id not like 'tz\\_%' and id not like 'tv\\_%' and id not like 'solo\\_%' order by orden`);
  assert.deepEqual(filas.map((f) => f.id), TIPOS_POR_DEFECTO.map((t) => t.id).sort((x, y) => TIPOS_POR_DEFECTO.findIndex((t) => t.id === x) - TIPOS_POR_DEFECTO.findIndex((t) => t.id === y)));
  for (const t of TIPOS_POR_DEFECTO) {
    const f = filas.find((x) => x.id === t.id)!;
    assert.equal(f.nombre, t.nombre, `${t.id}: nombre`);
    assert.equal(f.descripcion, t.descripcion, `${t.id}: descripción`);
    assert.equal(f.soloLoSuyo, t.soloLoSuyo, `${t.id}: sólo lo suyo`);
    assert.equal(f.orden, t.orden, `${t.id}: orden`);
    /* La app agrega «clientes» a los dos tipos de «todo» (TODO recorre AREAS) y la base no: da lo mismo, Clientes cuelga de Ventas (nivelDeAreas). */
    for (const a of AREAS) assert.equal(nivelDeAreas(f.areas as AreasDeTipo, a.id), nivelDeAreas(t.areas, a.id), `${t.id}: nivel de ${a.id}`);
  }
});

test("mi_acceso() (lo que pide la pantalla al entrar) devuelve el acceso que espera la app", { skip: saltear }, async () => {
  const b = await banco();
  for (const p of personasPorDefecto()) {
    const r = await b.intentar<{ a: Record<string, unknown> }>(p.email, `select public.mi_acceso() as a`);
    assert.ok(r.ok, r.ok ? "" : r.mensaje);
    const a = r.ok ? r.rows[0].a : {};
    const t = TIPOS_POR_DEFECTO.find((x) => x.id === p.tipo)!;
    assert.equal(a.tipo, t.id); assert.equal(a.nombre, t.nombre); assert.equal(a.soloLoSuyo, t.soloLoSuyo);
    for (const x of AREAS) assert.equal(nivelDeAreas(a.areas as AreasDeTipo, x.id), nivelDeAreas(t.areas, x.id), `${p.tipo}: nivel de ${x.id}`);
    /* El miembro de Equipo por el correo: sólo si la persona está cargada en Equipo. */
    if (p.miembroId) assert.equal(a.miembroId, p.miembroId, `${p.tipo}: quién es en Equipo`);
    else assert.ok(a.miembroId === null || a.miembroId === undefined || a.miembroId === "m_santi", `${p.tipo}: no está en Equipo (salvo el director de ensayo)`);
  }
  const intruso = await b.intentar<{ a: unknown }>("intruso@x.com", `select public.mi_acceso() as a`);
  assert.ok(intruso.ok && intruso.rows[0].a === null, "quien no está en la lista no tiene acceso");
});
