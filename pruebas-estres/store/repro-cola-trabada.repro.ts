/* Verificación independiente del hallazgo «un valor que la base rechaza para siempre traba toda la cola de escritura».
   Correr: node --import ./pruebas/registrar.mjs --test pruebas/stress/repro-cola-trabada.repro.ts
   Afirma lo que pasa HOY (pasa mientras el bug exista; cuando se arregle, REPRO y REPRO 2 tienen que invertirse o borrarse; la
   versión «lo que tiene que pasar» es la prueba con todo:true de cola-escritura.test.ts). No toca src/. Arma el caso como lo arma la pantalla (AsistenteLead.tsx:135 → leads/page.tsx guardar() → acciones.altaDeLead)
   contra la nube falsa, que valida con las reglas del SQL del repo (decimal en un INTEGER = 22P02, igual que Postgres: ver
   pruebas/stress/rls-y-esquema-pglite.test.ts, que compara esa regla con un Postgres de verdad). */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { conDemo, estadoDe, recargado } from "./_escenas";
import type { Store } from "./_fresco";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

/* Lo que hace el <input type="number"> de «Años de experiencia» (AsistenteLead.tsx:135). */
const delInput = (texto: string): number | undefined => (texto === "" ? undefined : Number(texto));

/* Lo que hace la pantalla de Leads al apretar «Crear lead» (leads/page.tsx guardar()). */
function crearLeadComoLaPantalla(S: Store, e: E, textoAnios: string, email: string) {
  const f = {
    nombre: "Ana Medio Año", email, telefono: "", pais: "", fuente: e.ajustes.fuentes[0] ?? "Webinar", campania: "",
    etapaId: e.etapas[0].id, monto: 2400, moneda: "USD", responsable: "", notas: "", etiquetas: [],
    creadoEn: "2026-10-07T12:00:00.000Z", actualizadoEn: "2026-10-07T12:00:00.000Z", extra: {},
    aniosExperiencia: delInput(textoAnios),
  };
  const datos = { ...f, actualizadoEn: new Date().toISOString(), responsable: f.responsable || e.ajustes.responsable };
  S.acciones.altaDeLead(datos as never, f.nombre);
  return f.aniosExperiencia;
}

test("el SQL del repo define las dos columnas como INTEGER (no numeric)", () => {
  for (const t of ["leads", "contactos"]) {
    const col = base.esquema.tablas.get(t)!.columnas.get("aniosExperiencia")!;
    assert.match(col.tipo, /^int/, `${t}.aniosExperiencia es ${col.tipo}`);
  }
});

test("el store no exporta nada para descartar o reintentar la cola: sólo recargar la página la vacía", async () => {
  const S = await conDemo(base);
  const nombres = Object.keys(S).filter((k) => /cola|descart|reintent|vaciar|limpiar|drenar|saltar/i.test(k));
  assert.deepEqual(nombres, [], `exports que tocan la cola: ${nombres.join(", ")}`);
});

test("CONTROL: la misma carga con 2 años (entero) se guarda y lo siguiente también", async () => {
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  assert.equal(crearLeadComoLaPantalla(S, e0, "2", "control@ejemplo.test"), 2);
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  const m = e0.metas[0];
  S.acciones.actualizar("metas", m.id, { nombre: "después del control" } as never, "m");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.equal(base.tabla("metas").get(m.id)!.nombre, "después del control");
  assert.ok([...base.tabla("leads").values()].some((l) => l.email === "control@ejemplo.test" && l.aniosExperiencia === 2));
});

test("REPRO: «Años de experiencia» = 2.5 → la cola se traba y nada de lo que viene atrás llega a la base", async () => {
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  const m = e0.metas[0];
  const nombreOriginal = base.tabla("metas").get(m.id)!.nombre;

  assert.equal(crearLeadComoLaPantalla(S, e0, "2.5", "medio@ejemplo.test"), 2.5, "el input deja pasar 2.5 tal cual");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "error");
  assert.match(S.errorSync(), /contactos: invalid input syntax for type integer.*aniosExperiencia/);

  /* Lo que la persona sigue haciendo después: cambios sin relación alguna con ese lead. */
  base.log = [];
  for (let i = 1; i <= 3; i++) {
    S.acciones.actualizar("metas", m.id, { nombre: `cambio ${i}` } as never, "m");
    await esperarCola(S.estadoSync);
    assert.equal(S.estadoSync(), "error", `sigue trabada después del cambio ${i}`);
  }
  /* En pantalla (memoria) el último cambio se ve; en la base, nunca llegó. */
  assert.equal(estadoDe(S).metas.find((x: E) => x.id === m.id).nombre, "cambio 3");
  assert.equal(base.tabla("metas").get(m.id)!.nombre, nombreOriginal, "la base no recibió ninguno de los 3 cambios");
  assert.equal(base.peticiones("upsert", "metas").length, 0, "ni siquiera se intentó escribir metas: la cabeza de la cola no avanza");
  /* Cada cambio nuevo sólo reintenta la MISMA operación imposible, y recibe la misma respuesta. */
  const intentos = base.log.filter((p) => p.tipo === "upsert");
  assert.deepEqual(intentos.map((p) => `${p.tabla}:${p.codigo}`), ["contactos:22P02", "contactos:22P02", "contactos:22P02"]);
  assert.equal(base.tabla("leads").size, e0.leads.length, "el lead tampoco entró");
  assert.ok(![...base.tabla("contactos").values()].some((c) => c.email === "medio@ejemplo.test"));

  /* Al recargar la página (la única salida) se pierde todo: el lead y los cambios. */
  const r = await recargado();
  assert.ok(!r.leads.some((l: E) => l.email === "medio@ejemplo.test"), "el lead no está");
  assert.equal(r.metas.find((x: E) => x.id === m.id).nombre, nombreOriginal, "ningún cambio sobrevivió");
});

test("REPRO 2: con 1.5 años pasa lo mismo, y con 0, 1 o 40 no (el problema es sólo el decimal)", async () => {
  for (const [texto, traba] of [["1.5", true], ["0", false], ["1", false], ["40", false], ["", false]] as const) {
    const S = await conDemo(base);
    const e0 = estadoDe(S);
    crearLeadComoLaPantalla(S, e0, texto, `x${texto}@ejemplo.test`);
    await esperarCola(S.estadoSync);
    assert.equal(S.estadoSync() === "error", traba, `«${texto}» → ${S.estadoSync()} ${S.errorSync()}`);
  }
});
