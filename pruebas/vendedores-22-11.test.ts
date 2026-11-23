import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { datoAlPrender, nombresDeVendedores, vende, vendePorRol, vendedores } from "@/lib/vendedores";
import type { MiembroEquipo } from "@/lib/types";

/* ==================================================================
   Aldana (22/11): «¿nos podrás agregar a Yari como opción de closer a la
   hora de cargar una venta?». El asistente escondía a Yari (CEO) a todos
   menos a ella misma, y cada pantalla que elige al vendedor armaba su
   propia lista con otra regla (unas con CEO, otras sin). Ahora hay UNA
   regla (lib/vendedores.ts), igual para cualquiera que cargue, y esta
   prueba frena a la pantalla que vuelva a armar la suya.
   ================================================================== */

const m = (id: string, nombre: string, rol: MiembroEquipo["rol"], activo = true, sinComision = false): MiembroEquipo =>
  ({ id, nombre, rol, activo, sinComision, comisionRate: 0.1 });

/* El equipo de producción del 22/11, resumido. */
const EQUIPO: MiembroEquipo[] = [
  m("eq_yari", "Yari", "ceo", true, true),
  m("eq_dante", "Dante Barbieri", "closer"),
  m("eq_mariano", "Mariano Arias", "closer"),
  m("eq_valentin", "Valentín", "closer", false),
  m("eq_valentin_abadia", "Valentin Abadía", "closer"),
  m("eq_director", "Santiago Burghiani", "director"),
  m("eq_aldana", "Aldana Ytzcovich", "otro"),
  m("eq_daniel", "Daniel Rodriguez", "setter"),
  m("eq_socio", "Nahuel Abadía", "socio"),
];

test("Yari aparece como vendedora junto a los closers activos, por nombre", () => {
  assert.deepEqual(vendedores(EQUIPO).map((x) => x.id), ["eq_dante", "eq_mariano", "eq_valentin_abadia", "eq_yari"]);
  assert.deepEqual(nombresDeVendedores(EQUIPO), ["Dante Barbieri", "Mariano Arias", "Valentin Abadía", "Yari"]);
});

test("no venden: director, setter, socio ni el resto del equipo; tampoco el closer que ya no está", () => {
  for (const id of ["eq_director", "eq_aldana", "eq_daniel", "eq_socio", "eq_valentin"]) {
    assert.ok(!vendedores(EQUIPO).some((x) => x.id === id), id);
  }
  assert.equal(vende(m("x", "X", "closer", false)), true, "vende es el rol (o la ficha); activo lo mira vendedores()");
});

test("al editar una venta vieja, su vendedor que ya no está sigue en la lista", () => {
  assert.ok(vendedores(EQUIPO, "eq_valentin").some((x) => x.id === "eq_valentin"));
  assert.ok(!vendedores(EQUIPO, "").some((x) => x.id === "eq_valentin"));
});

test("a quien entra como closer de Equipo (rol Closer) se lo ofrece sin tocar código", () => {
  const conManu = [...EQUIPO, m("eq_manu", "Manuel Pérez", "closer")];
  assert.ok(vendedores(conManu).some((x) => x.id === "eq_manu"));
});

/* ---------- Juan Cruz (22/11): «que haya manera de que ellos puedan editar eso para luego desactivarlo» ---------- */

test("apagarle «Aparece como vendedor» a Yari la saca de la lista sin cambiarle el rol", () => {
  const apagada = EQUIPO.map((x) => (x.id === "eq_yari" ? { ...x, apareceComoVendedor: false } : x));
  assert.ok(!vendedores(apagada).some((x) => x.id === "eq_yari"));
  assert.equal(apagada.find((x) => x.id === "eq_yari")?.rol, "ceo");
  assert.ok(vendedores(apagada).some((x) => x.id === "eq_dante"), "los demás siguen");
});

test("prenderlo suma a alguien de otro rol (un director que cierra) sin cambiarle el rol", () => {
  const conSanti = EQUIPO.map((x) => (x.id === "eq_director" ? { ...x, apareceComoVendedor: true } : x));
  assert.ok(vendedores(conSanti).some((x) => x.id === "eq_director"));
  const inactivo = conSanti.map((x) => (x.id === "eq_director" ? { ...x, activo: false } : x));
  assert.ok(!vendedores(inactivo).some((x) => x.id === "eq_director"), "si se fue, no aparece aunque esté prendido");
});

test("al editar una venta de alguien apagado, su vendedor sigue en la lista de esa venta", () => {
  const apagada = EQUIPO.map((x) => (x.id === "eq_yari" ? { ...x, apareceComoVendedor: false } : x));
  assert.ok(vendedores(apagada, "eq_yari").some((x) => x.id === "eq_yari"));
});

test("lo que coincide con el rol no se guarda (null): un cambio de rol después vuelve a mandar", () => {
  const yari = EQUIPO.find((x) => x.id === "eq_yari")!;
  assert.equal(datoAlPrender(yari, false), false);
  assert.equal(datoAlPrender(yari, true), null);
  const aldana = EQUIPO.find((x) => x.id === "eq_aldana")!;
  assert.equal(datoAlPrender(aldana, true), true);
  assert.equal(datoAlPrender(aldana, false), null);
  assert.equal(vende({ ...yari, apareceComoVendedor: null }), true);
  const yariApagada: MiembroEquipo = { ...yari, apareceComoVendedor: false };
  assert.equal(vendePorRol(yariApagada), true, "vendePorRol no mira lo de la ficha");
  assert.equal(vende(yariApagada), false);
});

test("la ficha de Equipo tiene el interruptor, la lista marca lo que se cambió a mano y la base tiene la columna", () => {
  const ficha = readFileSync(join(RAIZ, "components/equipo/FichaMiembro.tsx"), "utf8");
  assert.match(ficha, /Aparece como vendedor al cargar una venta/);
  assert.match(ficha, /checked=\{vende\(m\)\}/);
  assert.match(ficha, /apareceComoVendedor: datoAlPrender\(m, v\)/);
  assert.match(readFileSync(join(RAIZ, "components/equipo/ListaEquipo.tsx"), "utf8"), /vende\(f\) === vendePorRol\(f\)/);
  const sql = readFileSync(join(process.cwd(), "supabase/equipo-aparece-como-vendedor.sql"), "utf8");
  assert.match(sql, /alter table public\.equipo add column if not exists "apareceComoVendedor" boolean;/);
});

/* ---------- La guardia: ninguna pantalla arma su propia lista de vendedores ---------- */

const RAIZ = join(process.cwd(), "src");
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(tsx|ts)$/.test(n) ? [p] : [];
  });
}

/* Las pantallas que eligen o sugieren al vendedor de una venta. */
const ELIGEN_VENDEDOR = [
  "components/ventas/AsistenteVenta.tsx",
  "components/ventas/FormularioVenta.tsx",
  "components/cs/FichaClienteCs.tsx",
  "components/cs/ResellsCs.tsx",
  "components/cs/edicionCliente.tsx",
];

test("las pantallas que eligen al vendedor usan lib/vendedores y no filtran por rol ni por quién está cargando", () => {
  for (const rel of ELIGEN_VENDEDOR) {
    const src = readFileSync(join(RAIZ, rel), "utf8");
    assert.match(src, /from "@\/lib\/vendedores"/, `${rel} tiene que usar lib/vendedores`);
    assert.doesNotMatch(src, /rol === "closer"|rol === "ceo"|rol !== "closer"|rol !== "ceo"/, `${rel} arma su propia lista por rol`);
    assert.doesNotMatch(src, /veCeo/, `${rel} vuelve a esconder a alguien según quién carga`);
  }
});

test("cualquier selector «Vendedor» nuevo sale de lib/vendedores", () => {
  const conSelector = archivos(RAIZ).filter((p) => /aria-label="Vendedor"|label="Vendedor"/.test(readFileSync(p, "utf8")));
  assert.ok(conSelector.length >= 2, "se encontraron los selectores de hoy");
  for (const p of conSelector) {
    assert.match(readFileSync(p, "utf8"), /\bvendedores\(/, `${p.slice(RAIZ.length + 1)} tiene un selector de vendedor que no usa vendedores()`);
  }
});
