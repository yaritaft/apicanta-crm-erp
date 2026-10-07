/* Intento de refutar: «sembrarNube no tolera una columna que la base todavía no tiene (PGRST204)».
   Resultado: NO se refuta, se reproduce con acciones reales del store (nada de meter datos a mano en el respaldo).
   Las marcadas todo (A, B, B2, E) son el bug; C y D son los controles que pasan:
     C  la misma columna que falta, por la cola (drenar), se tolera: la fila se guarda sin ella;
     D  el mismo flujo de A con la base al día restaura todo. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarHasta, instalar } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";

const base = new BaseFalsa();
instalar(base);

const TABLAS_VISTAS = ["productos", "procesadores", "embudos", "equipo", "etapas", "webinars", "leads", "ventas", "cuotas", "pagos", "gastos", "actividad", "etapas_servicio"];
const tamanos = () => Object.fromEntries(TABLAS_VISTAS.map((t) => [t, base.tabla(t).size]));
const callar = async <T>(f: () => Promise<T>): Promise<T> => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };

/* Las columnas que agrega supabase/control-cruzado.sql a pagos. Mientras no se corra, el README y el propio SQL dicen
   «Sin esto la app anda igual: los chequeos quedan sólo en el navegador de quien los hace (ver columnaFaltante en store.ts)». */
const CONTROL = ["cargadoPor", "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "chequeoDirectorNota", "chequeoFinanzas", "chequeoFinanzasPor", "chequeoFinanzasEn", "chequeoFinanzasNota"];

/** Un director chequea un cobro con la base sin las columnas del control: la cola lo tolera (así está pensado). */
async function chequearSinColumnas() {
  const S = await conDemo(base);
  base.columnasFaltantes.set("pagos", new Set(CONTROL));
  const pagoId = estadoDe(S).pagos[0].id;
  await callar(() => yEsperar(S, () => { assert.ok(S.acciones.chequearPago(pagoId, { casillero: "director", veredicto: "chequeado" })); }));
  assert.equal(S.estadoSync(), "listo", `la cola tolera la columna que falta: ${S.errorSync()}`);
  assert.equal(estadoDe(S).pagos.find((p: { id: string }) => p.id === pagoId).chequeoDirector, "chequeado", "queda en memoria");
  assert.equal(base.tabla("pagos").get(pagoId)!.chequeoDirector, undefined, "no llegó a la base (no tiene la columna)");
  return S;
}

test("A. modo documentado «anda igual» (sin control-cruzado.sql): chequear un cobro anda, pero bajar el respaldo y restaurarlo deja la base vaciada", { todo: true }, async () => {
  const S = await chequearSinColumnas();
  const antes = tamanos();
  /* El dueño baja el respaldo (Ajustes → Datos) y lo restaura (el botón no pide confirmación). */
  assert.equal(S.acciones.importar(S.acciones.exportar()), true);
  await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
  const despues = tamanos();
  console.log("A) estado:", S.estadoSync(), "|", S.errorSync());
  console.log("A) filas antes :", JSON.stringify(antes));
  console.log("A) filas después:", JSON.stringify(despues));
  assert.deepEqual(despues, antes, "restaurar el respaldo que se acaba de bajar dejó la base a medias");
});

test("B. sin ningún dato a mano: «Volver a los datos de ejemplo» con procesadores.moneda sin crear (utms-y-financiera.sql: «antes o después del deploy»)", { todo: true }, async () => {
  const S = await conDemo(base);
  const antes = tamanos();
  base.columnasFaltantes.set("procesadores", new Set(["moneda"]));
  await callar(() => S.acciones.reiniciarDemo());
  const despues = tamanos();
  console.log("B) estado:", S.estadoSync(), "|", S.errorSync());
  console.log("B) filas antes :", JSON.stringify(antes));
  console.log("B) filas después:", JSON.stringify(despues));
  assert.deepEqual(despues, antes, "volver a la demo dejó la base a medias");
});

test("B2. lo mismo con «Vaciar todo» (sólo catálogos): también los pierde", { todo: true }, async () => {
  const S = await conDemo(base);
  base.columnasFaltantes.set("procesadores", new Set(["moneda"]));
  await callar(() => S.acciones.vaciarTodo());
  const despues = tamanos();
  console.log("B2) estado:", S.estadoSync(), "|", S.errorSync());
  console.log("B2) filas después:", JSON.stringify(despues));
  assert.ok(despues.procesadores > 0 && despues.etapas > 0 && despues.equipo > 0, "los catálogos tendrían que quedar");
});

test("C. control: la MISMA columna que falta, por la cola, no rompe nada (por eso el contraste)", async () => {
  const S = await conDemo(base);
  base.columnasFaltantes.set("procesadores", new Set(["moneda"]));
  const proc = estadoDe(S).procesadores[0];
  await callar(() => yEsperar(S, () => S.acciones.actualizar("procesadores", proc.id, { moneda: "ARS", nombre: "cambiado" } as never, "x")));
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.equal(base.tabla("procesadores").get(proc.id)!.nombre, "cambiado", "el resto de la fila se guardó");
});

test("D. control: el mismo flujo de A con la base al día (columnas creadas) deja la base completa", async () => {
  const S = await conDemo(base);
  const pagoId = estadoDe(S).pagos[0].id;
  await yEsperar(S, () => { assert.ok(S.acciones.chequearPago(pagoId, { casillero: "director", veredicto: "chequeado" })); });
  const antes = tamanos();
  S.acciones.importar(S.acciones.exportar());
  await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.deepEqual(tamanos(), antes);
});

test("E. después de la falla de A y de correr el ALTER: al recargar, la app dice «listo» y muestra ventas sin sus cobros ni gastos (nadie avisa)", { todo: true }, async () => {
  const S = await chequearSinColumnas();
  const ventasAntes = base.tabla("ventas").size, pagosAntes = base.tabla("pagos").size, gastosAntes = base.tabla("gastos").size;
  S.acciones.importar(S.acciones.exportar());
  await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
  assert.equal(S.estadoSync(), "error");
  base.columnasFaltantes.clear();          // ya corrieron el SQL: la base acepta todo
  const R = await recargado();             // otra persona del equipo (o el mismo dueño) abre la app
  console.log(`E) tras recargar: ventas ${R.ventas.length}/${ventasAntes}, pagos ${R.pagos.length}/${pagosAntes}, gastos ${R.gastos.length}/${gastosAntes}`);
  assert.equal(R.pagos.length, pagosAntes, "los cobros se perdieron");
});
