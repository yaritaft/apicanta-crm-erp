/* Estrés del almacén, frente 7: el estado vacío (el de la nube mientras carga) y la semilla (la demo) no divergen.

   Las pantallas leen `e.leads.map(…)`, `e.pagos.filter(…)`: si una lista fuera undefined en uno de los dos estados, la app se
   caería sólo con nube (mientras carga) o sólo sin ella. Se compara la forma (qué claves, qué es lista) contra EstadoApp de
   types.ts, y se mira que las colecciones opcionales (seguimientos, testimonios, resells, gastosRecurrentes) se lean siempre con `?? []`. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { construirSemilla, estadoVacio } from "@/lib/seed";
import { INTERFACES, RAIZ } from "./_aleatorio";
import { TIPOS_POR_DEFECTO } from "@/lib/permisos";

const campos = INTERFACES.get("EstadoApp")!;
const OPCIONALES = campos.filter((c) => c.opcional).map((c) => c.nombre);
const OBLIGATORIOS = campos.filter((c) => !c.opcional).map((c) => c.nombre);

test("las claves obligatorias de EstadoApp están en el estado vacío y en la semilla, y las que son listas, son listas", () => {
  const vacio = estadoVacio() as unknown as Record<string, unknown>, semilla = construirSemilla() as unknown as Record<string, unknown>;
  for (const [nombre, e] of [["estadoVacio", vacio], ["construirSemilla", semilla]] as const) {
    for (const k of OBLIGATORIOS) assert.ok(k in e && e[k] !== undefined, `${nombre}() no tiene «${k}»`);
    for (const c of campos.filter((x) => !x.opcional && x.tipo.getText().endsWith("[]"))) assert.ok(Array.isArray(e[c.nombre]), `${nombre}().${c.nombre} no es una lista`);
    /* ni una clave de más: un campo que types.ts no conoce */
    for (const k of Object.keys(e)) assert.ok(campos.some((c) => c.nombre === k), `${nombre}() tiene «${k}», que EstadoApp no declara`);
  }
  assert.deepEqual(Object.keys(vacio).sort(), Object.keys(semilla).sort(), "el vacío y la semilla tienen que tener las mismas claves");
});

test("el vacío y la semilla comparten los mismos catálogos (sin ellos la app no puede cargar una venta ni dibujar el pipeline)", () => {
  const vacio = estadoVacio(), semilla = construirSemilla();
  for (const k of ["etapas", "etapasServicio", "tiposCuenta", "productos", "procesadores", "embudos", "equipo"] as const) {
    assert.ok(vacio[k].length > 0, `${k} vacío en estadoVacio()`);
    assert.deepEqual(vacio[k], semilla[k], `${k} difiere entre el vacío y la semilla`);
  }
  assert.deepEqual(vacio.tiposCuenta.map((t) => t.id), TIPOS_POR_DEFECTO.map((t) => t.id));
  /* En el vacío no hay personas ni plata inventadas. */
  for (const k of ["leads", "contactos", "sesiones", "webinars", "alumnos", "ventas", "cuotas", "pagos", "gastos", "movimientos", "devoluciones", "campaigns", "ads"] as const) {
    assert.deepEqual(vacio[k], [], `estadoVacio().${k} tendría que estar vacío`);
  }
  assert.ok(semilla.leads.length > 0 && semilla.ventas.length > 0);
});

test("cada llamada devuelve colecciones nuevas: modificar una lista del vacío no cambia la siguiente", () => {
  const a = estadoVacio(), b = estadoVacio();
  for (const k of ["leads", "sesiones", "ventas", "pagos", "gastos", "actividad", "comentarios", "arqueos", "traspasos", "devoluciones", "honorarios", "liquidaciones"] as const) {
    assert.notEqual(a[k], b[k], `${k} es la misma lista en dos llamadas`);
  }
  a.leads.push({ id: "x" } as never);
  assert.equal(estadoVacio().leads.length, 0);
});

test("los catálogos de la semilla y del vacío son los mismos objetos (están compartidos): nadie los puede modificar en su lugar", () => {
  /* Si una acción hiciera `e.productos[0].nombre = …`, cambiaría la demo para siempre y el vacío de la próxima sesión.
     Las pruebas de persistencia-modelo corren con estos catálogos congelados. */
  assert.equal(estadoVacio().productos, construirSemilla().productos);
});

/* Objetos que tienen una propiedad con el mismo nombre que una colección opcional del estado pero NO son el estado de la app: lo que arma el
   importador de Customer Success (`plan`, `lote`), su contador de puntos y el resultado crudo de leer las tablas de la nube (`porTabla`). */
const NO_ES_EL_ESTADO = new Set(["plan", "lote", "puntos", "porTabla"]);

/** Las lecturas de una colección opcional del estado que la USAN sin guarda en esa línea: se le pide `.map`, `.length` o un índice, o se la esparce
 *  (`[...e.x]` revienta con undefined). Con guarda (`?? []`, `?.`) no revienta, y tampoco si sólo se la pasa de largo —un argumento
 *  (`reemplazar(e.x, …)`) o un elemento de la lista de dependencias de un hook—: ahí la función que la recibe tiene que aceptarla sin definir,
 *  y eso lo exige el compilador, porque en EstadoApp están marcadas con «?». */
export function lecturasSinGuarda(linea: string, opcionales: string[]): string[] {
  const malas: string[] = [];
  for (const m of linea.matchAll(new RegExp(String.raw`([A-Za-z_$][\w$]*)\.(${opcionales.join("|")})\b(.{0,6})`, "g"))) {
    const [, objeto, coleccion, sigue] = m;
    if (NO_ES_EL_ESTADO.has(objeto)) continue;
    if (/^\s*(\?\?|\?\.)/.test(sigue)) continue;
    const esparcida = /\.\.\.\s*\(?\s*$/.test(linea.slice(0, m.index ?? 0));
    const pasadaDeLargo = /^\s*(\]|,|\))/.test(sigue) && !/^\s*\)\s*[.[]/.test(sigue);
    if (pasadaDeLargo && !esparcida) continue;
    malas.push(`${objeto}.${coleccion}`);
  }
  return malas;
}

test("el buscador de lecturas sin guarda marca el uso de una colección opcional sin proteger y deja pasar lo demás", () => {
  const cuantas = (l: string) => lecturasSinGuarda(l, ["gastosRecurrentes", "resells", "seguimientos", "testimonios"]).length;
  for (const l of ["e.resells.map((r) => r.id)", "const n = e.testimonios.length;", "e.seguimientos[0]", "[...e.testimonios, x]", "foo(...e.gastosRecurrentes)", "(e.resells).filter(Boolean)"]) {
    assert.equal(cuantas(l), 1, `tenía que marcar: ${l}`);
  }
  for (const l of ["(e.resells ?? []).map(f)", "e.resells?.length", "reemplazar(e.testimonios, lote.testimonios)", "[e.alumnos, e.seguimientos, e.resells, e.reportes]",
    "plan.resells.push(x)", "lote.seguimientos.map(f)", "puntos.resells += 2", "const x = porTabla.resells ?? [];", "useMemo(() => 1, [e.testimonios])"]) {
    assert.equal(cuantas(l), 0, `no tenía que marcar: ${l}`);
  }
});

test("las colecciones opcionales (seguimientos, testimonios, resells, gastosRecurrentes) siempre se leen con ?? []", () => {
  assert.deepEqual([...OPCIONALES].sort(), ["gastosRecurrentes", "resells", "seguimientos", "testimonios"], "cambió el conjunto de colecciones opcionales: revisá cada lugar que las lee");
  const sinGuarda: string[] = [];
  const recorrer = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const ruta = resolve(dir, f);
      if (statSync(ruta).isDirectory()) { recorrer(ruta); continue; }
      if (!/\.(ts|tsx)$/.test(f) || f === "types.ts") continue;
      readFileSync(ruta, "utf8").split("\n").forEach((l, i) => {
        for (const lectura of lecturasSinGuarda(l, OPCIONALES)) sinGuarda.push(`${ruta.replace(RAIZ, "")}:${i + 1}: ${lectura} · ${l.trim().slice(0, 100)}`);
      });
    }
  };
  recorrer(resolve(RAIZ, "src"));
  assert.deepEqual(sinGuarda, [], `lecturas sin «?? []»: con la nube, el estado inicial no tiene estas colecciones`);
});
