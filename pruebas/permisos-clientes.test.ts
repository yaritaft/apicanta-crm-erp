import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AREAS, CUSTOMER_SUCCESS, EDITAN, esDueno, LEEN, nivelDeAreas, nivelDeRuta, nivelEn, puedeEditar, puedeLeer,
  resumenDeTipo, TIPOS_POR_DEFECTO, type MiAcceso,
} from "@/lib/permisos";
import { inicioPara, navPara } from "@/components/shell/nav";

const acceso = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("los tipos que ven Ventas siguen viendo Clientes, sin tocar nada", () => {
  for (const id of ["equipo", "director", "closer", "admin"]) {
    assert.ok(nivelDeRuta(acceso(id), "/clientes") > 0, `${id} tiene que seguir viendo Clientes`);
  }
  assert.equal(nivelDeAreas({ ventas: "editar" }, "clientes"), 2);
  assert.equal(nivelDeAreas({ ventas: "ver" }, "clientes"), 1);
  /* Los que no ven Ventas ni Clientes, no. */
  for (const id of ["setter", "marketing"]) assert.equal(nivelDeRuta(acceso(id), "/clientes"), 0, id);
});

test("Clientes se puede dar solo, y no da Ventas", () => {
  const a: MiAcceso = { tipo: "x", nombre: "X", areas: { clientes: "ver" }, soloLoSuyo: false };
  assert.equal(nivelEn(a, "clientes"), 1);
  assert.equal(nivelEn(a, "ventas"), 0);
  assert.equal(nivelDeRuta(a, "/clientes"), 1);
  assert.equal(nivelDeRuta(a, "/ventas"), 0);
  /* Lo que lee la pantalla Clientes. */
  for (const t of ["ventas", "cuotas", "pagos", "contactos", "leads", "comentarios"]) assert.ok(puedeLeer(a, t), t);
  assert.ok(!puedeEditar(a, "ventas"));
});

test("«Customer Success» ve Alumnos y Clientes, y sólo eso", () => {
  assert.ok(TIPOS_POR_DEFECTO.some((t) => t.id === CUSTOMER_SUCCESS.id), "viene entre los tipos de fábrica");
  const a = acceso("customer_success");
  const rutas = navPara(a).flatMap((g) => g.items.map((i) => i.href));
  assert.ok(rutas.includes("/clientes"));
  assert.ok(rutas.includes("/alumnos"));
  /* D12: Reportes y Pipeline de servicio siguen en el menú (son del área Alumnos). */
  assert.ok(rutas.includes("/reportes"));
  assert.ok(rutas.includes("/alumnos?seccion=pipeline"));
  for (const r of ["/panel", "/leads", "/crm", "/agenda", "/ventas", "/webinars", "/marketing", "/finanzas", "/finanzas/caja", "/conciliacion", "/equipo", "/ajustes"]) {
    assert.ok(!rutas.includes(r), `no tiene que ver ${r}`);
  }
  assert.equal(inicioPara(a), "/alumnos?seccion=hoy");
  /* Edita lo de Alumnos y no toca lo demás. */
  assert.ok(puedeEditar(a, "alumnos") && puedeEditar(a, "seguimiento_alumnos") && puedeEditar(a, "testimonios"));
  for (const t of ["ventas", "cuotas", "pagos", "gastos", "sesiones", "ajustes", "equipo", "honorarios"]) assert.ok(!puedeEditar(a, t), t);
  assert.ok(!puedeLeer(a, "gastos") && !puedeLeer(a, "honorarios") && !puedeLeer(a, "sesiones"));
  assert.match(resumenDeTipo(CUSTOMER_SUCCESS), /Edita Alumnos; ve Clientes/);
});

test("el menú de los demás no cambia: el Dashboard sigue siendo el inicio", () => {
  assert.equal(inicioPara(acceso("equipo")), "/panel");
  /* El closer arranca en «Mis llamadas» desde el lote del menú mínimo. */
  assert.equal(inicioPara(acceso("closer")), "/mis-llamadas");
  assert.ok(esDueno({ tipo: "dueno", nombre: "Dueño", areas: {}, soloLoSuyo: false }));
  assert.ok(AREAS.some((a) => a.id === "clientes"));
});

/* La base y la app tienen que decir lo mismo: lo que lee y edita cada área. Se aplica el mismo
   parche que supabase/customer-success.sql sobre lo que dejó tipos-cuenta.sql y se compara. */
function cuerpo(sql: string, funcion: string): string {
  const i = sql.indexOf(`create or replace function public.${funcion}`);
  return sql.slice(i, sql.indexOf("$$;", i));
}
function parchar(def: string, tablasClientes: string[]): Record<string, string[]> {
  let t = def.replace(new RegExp(`(when '(${tablasClientes.join("|")})'\\s+then array\\[)`, "g"), "$1'clientes',");
  t = t.replace(/select case tabla/, "select case tabla\n when 'seguimiento_alumnos' then array['alumnos']\n when 'testimonios' then array['alumnos']");
  const m: Record<string, string[]> = {};
  for (const x of t.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) m[x[1]] = [...x[2].matchAll(/'([a-z_*]+)'/g)].map((y) => y[1]);
  return m;
}

test("la base (tipos-cuenta.sql + customer-success.sql) dice lo mismo que LEEN y EDITAN", () => {
  const base = readFileSync(new URL("../supabase/tipos-cuenta.sql", import.meta.url), "utf8");
  const leen = parchar(cuerpo(base, "areas_que_leen"), ["leads", "contactos", "comentarios", "ventas", "cuotas", "pagos"]);
  const editan = parchar(cuerpo(base, "areas_que_editan"), ["contactos", "comentarios"]);
  /* Las tablas cuya política usa nivel_area('finanzas') directo, sin pasar por estas dos funciones
     (supabase/gastos-recurrentes.sql y supabase/devoluciones.sql): la app las lista en LEEN y EDITAN pero la base no. */
  const PROPIAS = new Set(["gastos_recurrentes", "devoluciones"]);
  for (const [tabla, areas] of Object.entries(LEEN)) {
    if (areas.length === 0 || PROPIAS.has(tabla)) continue;
    assert.deepEqual([...(leen[tabla] ?? [])].sort(), [...areas].sort(), `lee ${tabla}`);
  }
  for (const [tabla, areas] of Object.entries(EDITAN)) if (!PROPIAS.has(tabla)) assert.deepEqual([...(editan[tabla] ?? [])].sort(), [...areas].sort(), `edita ${tabla}`);
});
