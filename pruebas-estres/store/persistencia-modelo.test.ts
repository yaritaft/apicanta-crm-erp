/* Estrés del almacén, frente 3: la memoria y la base dicen lo mismo después de CUALQUIER secuencia de acciones.

   Se siembra la demo (reiniciarDemo) contra una nube falsa que valida lo que el SQL
   define (NOT NULL, CHECK, tipos, claves foráneas), se corren acciones reales al azar
   (con semilla; catálogo en _acciones.ts) y, después de cada una y de vaciar la cola de
   escritura, se compara lo que hay en memoria con lo que quedó en la base. Cada
   diferencia es algo que, al recargar la página, se vería distinto de lo que había
   en pantalla.

   Las diferencias se separan en dos:
   - «vaciado que no llegó»: la memoria no tiene el dato y la base todavía lo tiene (se vació un
     campo con `undefined` y el upsert saca los undefined: la base se queda con el viejo). Es un
     bug conocido (ver vaciado-no-llega.test.ts) y va en una prueba aparte marcada todo;
   - todo lo demás: tiene que ser vacío.

   Para repetir un caso: PASOS=300 SEMILLAS=7 node --import ./pruebas/registrar.mjs --test pruebas/stress/persistencia-modelo.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
/* _nube va PRIMERO: pone las variables de entorno antes de que nadie importe supabase.ts. */
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { storeNuevo } from "./_fresco";
import { azar } from "./_aleatorio";
import { elegir, NO } from "./_acciones";
import { compararTodo, describir, nulosIndebidos, selladasEnUpsert, ultimoPedido, type Diferencia } from "./_modelo";
import { TABLAS } from "@/lib/supabase";
import { construirSemilla } from "@/lib/seed";

/* Los catálogos de la demo son constantes del módulo seed.ts que TODOS los estados comparten por referencia. Se congelan: si una
   acción modificara uno en su lugar (en vez de armar uno nuevo), lanzaría un TypeError y la prueba lo marcaría. */
function congelar<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) congelar(v); }
  return x;
}
const compartidos = construirSemilla();
for (const k of ["etapas", "etapasServicio", "tiposCuenta", "productos", "procesadores", "embudos", "equipo", "ajustes"] as const) congelar(compartidos[k]);

/* tipos_cuenta no se siembra a propósito (los de fábrica los crea tipos-cuenta.sql). */
const TABLAS_COMPARADAS = TABLAS.filter((t) => t !== "tipos_cuenta");
/* La jerarquía de Meta: importarMeta reemplaza lo que hay en memoria por lo que devuelve Meta (la jerarquía entera),
   y la base conserva lo anterior (decisión de diseño: es un upsert). */
const META = new Set(["campaigns", "adsets", "ads"]);

const base = new BaseFalsa();
instalar(base);

const PASOS = Number(process.env.PASOS ?? 100);
const SEMILLAS = (process.env.SEMILLAS ?? "11,22,33").split(",").map(Number);

const esVaciado = (d: Diferencia) => d.tipo === "campo" && d.memoria === undefined && d.base !== undefined;

interface Corrida { semilla: string; reporte: string[]; vaciados: string[]; corridas: number }

/** `rafaga`: se juntan de 1 a 5 acciones sin esperar a la cola, con la nube frenada (como quien carga varias cosas seguidas con la red lenta);
 *  recién al final se suelta y se compara. Si una acción encola algo que depende de lo que otra todavía no escribió, la base lo rechaza. */
async function correr(semilla: number, pasos: number, rafaga = false): Promise<Corrida> {
  base.vaciar();
  const S = await storeNuevo();
  await S.acciones.reiniciarDemo();
  const a = azar(semilla);
  const vistas = new Set<string>();
  const reporte: string[] = [], vaciados: string[] = [];
  let corridas = 0;
  const cobertura = new Map<string, number>();
  for (let i = 0; i < pasos; i++) {
    const desde = ultimoPedido(base);
    const nombres: string[] = [];
    let soltar: (() => void) | null = null;
    if (rafaga) base.compuerta = new Promise<void>((res) => { soltar = res; });
    for (let k = 0, n = rafaga ? a.entero(1, 5) : 1; k < n; k++) {
      const accion = elegir(a);
      const e = JSON.parse(S.acciones.exportar());
      let r: unknown;
      try { r = accion.correr(a, e, S); }
      catch (err) { reporte.push(`#${i} ${accion.nombre}: la acción lanzó ${(err as Error).message}`); continue; }
      if (r === NO) continue;
      corridas++;
      nombres.push(accion.nombre);
      cobertura.set(accion.nombre, (cobertura.get(accion.nombre) ?? 0) + 1);
    }
    if (nombres.length === 0) { if (soltar) { base.compuerta = null; (soltar as () => void)(); } continue; }
    if (soltar) { base.compuerta = null; (soltar as () => void)(); }
    const accion = { nombre: nombres.join(" + ") };
    await esperarCola(S.estadoSync);
    for (const n of [...nulosIndebidos(base, desde), ...selladasEnUpsert(base, desde)]) reporte.push(`#${i} ${accion.nombre} → ${n}`);
    if (S.estadoSync() === "error") { reporte.push(`#${i} ${accion.nombre}: la cola quedó trabada: ${S.errorSync()}`); break; }
    for (const d of compararTodo(base, JSON.parse(S.acciones.exportar()), TABLAS_COMPARADAS)) {
      if (META.has(d.tabla) && d.tipo === "solo-en-la-base") continue;
      const clave = `${d.tabla}|${d.id}|${d.tipo}|${d.campo ?? ""}|${JSON.stringify(d.memoria)}|${JSON.stringify(d.base)}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      (esVaciado(d) ? vaciados : reporte).push(`#${i} ${accion.nombre} → ${describir(d)}`);
    }
  }
  if (process.env.COBERTURA) console.log(semilla, [...cobertura].map(([k, v]) => `${k}:${v}`).join(" "));
  return { semilla: String(semilla), reporte, vaciados, corridas };
}

/* Las secuencias se corren una vez y las dos pruebas de abajo leen el resultado. */
const corridas: Corrida[] = [];
for (const semilla of SEMILLAS) corridas.push(await correr(semilla, PASOS));
const RAFAGAS = (process.env.RAFAGAS ?? "41,42").split(",").filter(Boolean).map(Number);
for (const semilla of RAFAGAS) { const c = await correr(semilla, Math.round(PASOS * 0.6), true); corridas.push({ ...c, semilla: `${semilla} (en ráfagas, con la nube frenada)` }); }

/* Va después de las secuencias: node:test arranca cada prueba apenas se declara y todas comparten la misma base falsa. */
test("sembrar la demo en la nube deja la base igual a la memoria", async () => {
  base.vaciar();
  const S = await storeNuevo();
  await S.acciones.reiniciarDemo();
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  const dif = compararTodo(base, JSON.parse(S.acciones.exportar()), TABLAS_COMPARADAS);
  assert.deepEqual(dif.map(describir), []);
});

for (const c of corridas) {
  test(`acciones al azar (semilla ${c.semilla}): lo que se ve es lo que queda guardado, salvo los vaciados`, () => {
    assert.ok(c.corridas > PASOS / 3, `sólo se pudieron correr ${c.corridas} de ${PASOS} acciones`);
    assert.deepEqual(c.reporte, [], `semilla ${c.semilla}\n${c.reporte.slice(0, 40).join("\n")}`);
  });
}

/* BUG: vaciar un campo con `undefined` no llega a la base (acciones.actualizar, guardarGastoRecurrente y desconciliar:
   normalizar() saca los undefined y el upsert no toca las columnas que no vienen). Ver vaciado-no-llega.test.ts. */
/* BUG: normalizar() saca los undefined y la base conserva el valor viejo (el detalle está dentro de la prueba) */
test("el vaciado de campos llega a la base en todas las acciones", { todo: true }, () => {
  const todos = corridas.flatMap((c) => c.vaciados.map((x) => `[semilla ${c.semilla}] ${x}`));
  assert.deepEqual(todos, [], `\n${todos.slice(0, 30).join("\n")}`);
});
