/* Estrés del almacén, frente 7: el estado vacío (el de la nube mientras carga) y la semilla (la demo) no divergen.

   Las pantallas leen `e.leads.map(…)`, `e.pagos.filter(…)`: si una lista fuera undefined en uno de los dos estados, la app se
   caería sólo con nube (mientras carga) o sólo sin ella. Se compara la forma (qué claves, qué es lista) contra EstadoApp de
   types.ts, y se mira que las tres colecciones opcionales (seguimientos, testimonios, gastosRecurrentes) se lean siempre con `?? []`. */
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

test("las colecciones opcionales (seguimientos, testimonios, gastosRecurrentes) siempre se leen con ?? []", () => {
  assert.deepEqual([...OPCIONALES].sort(), ["gastosRecurrentes", "seguimientos", "testimonios"], "cambió el conjunto de colecciones opcionales: revisá cada lugar que las lee");
  const sinGuarda: string[] = [];
  const recorrer = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const ruta = resolve(dir, f);
      if (statSync(ruta).isDirectory()) { recorrer(ruta); continue; }
      if (!/\.(ts|tsx)$/.test(f) || f === "types.ts") continue;
      const lineas = readFileSync(ruta, "utf8").split("\n");
      lineas.forEach((l, i) => {
        for (const m of l.matchAll(new RegExp(String.raw`\.(${OPCIONALES.join("|")})\b(.{0,6})`, "g"))) {
          const sigue = m[2];
          /* con guarda (?? [], ?.) o como dependencia de un hook ([e.gastos, e.gastosRecurrentes]) */
          if (/^\s*(\?\?|\?\.|\])/.test(sigue)) continue;
          if (/porTabla\./.test(l.slice(0, (m.index ?? 0) + 1))) continue;
          sinGuarda.push(`${ruta.replace(RAIZ, "")}:${i + 1}: ${l.trim().slice(0, 100)}`);
        }
      });
    }
  };
  recorrer(resolve(RAIZ, "src"));
  assert.deepEqual(sinGuarda, [], `lecturas sin «?? []»: con la nube, el estado inicial no tiene estas colecciones`);
});
