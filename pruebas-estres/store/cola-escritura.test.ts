/* Estrés del almacén, frente 5: la cola de escritura hacia la nube.

   Contra la nube falsa (con las reglas del SQL) se prueba lo que promete src/lib/store.ts:
   - el orden (primero entró, primero sale) y que, editada dos veces la misma fila, queda la última;
   - una operación en vuelo cuenta como pendiente (escrituraPendiente: lo que avisa Realtime de esa
     fila es más viejo y no se aplica);
   - lo que se puede arreglar solo (columna que falta, tabla opcional que falta) no traba nada;
   - lo que no se va a poder nunca por permisos (42501) o por una clave que otra cosa usa (23503) se
     descarta y se avisa;
   - una falla pasajera se reintenta en el cambio siguiente, sin perder ni reordenar nada;
   - los lotes (500 filas por upsert, 100 ids por UPDATE).
   Y la que falla: un valor que la base rechaza para siempre traba TODA la cola. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar, respirar } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";
import { storeNuevo } from "./_fresco";
import { TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("dos ediciones seguidas de la misma fila: queda la última y salen en orden", async () => {
  const S = await conDemo(base);
  const lead = estadoDe(S).leads[0];
  base.log = [];
  S.acciones.actualizar("leads", lead.id, { notas: "primera" } as never, lead.nombre);
  S.acciones.actualizar("leads", lead.id, { notas: "segunda" } as never, lead.nombre);
  S.acciones.actualizar("leads", lead.id, { notas: "tercera" } as never, lead.nombre);
  await esperarCola(S.estadoSync);
  const escrituras = base.peticiones("upsert", "leads").map((p) => p.filas![0].notas);
  assert.deepEqual(escrituras, ["primera", "segunda", "tercera"], "el orden de salida es el de entrada");
  assert.equal(base.tabla("leads").get(lead.id)!.notas, "tercera");
  assert.equal((await recargado()).leads.find((l: E) => l.id === lead.id).notas, "tercera");
});

test("una operación en vuelo cuenta como pendiente, y deja de serlo cuando la base la recibió", async () => {
  const S = await conDemo(base);
  const lead = estadoDe(S).leads[1];
  let soltar!: () => void;
  base.compuerta = new Promise<void>((r) => { soltar = r; });
  S.acciones.actualizar("leads", lead.id, { notas: "en vuelo" } as never, lead.nombre);
  await respirar();
  assert.equal(S.estadoSync(), "guardando");
  assert.ok(S.escrituraPendiente("leads", lead.id), "mientras se escribe, lo que avise Realtime de esa fila no se aplica");
  assert.ok(S.escrituraPendiente("actividad", estadoDe(S).actividad[0].id));
  assert.ok(!S.escrituraPendiente("leads", "otro"), "otra fila no está pendiente");
  /* Una segunda edición mientras la primera viaja. */
  S.acciones.actualizar("leads", lead.id, { notas: "segunda" } as never, lead.nombre);
  base.compuerta = null;
  soltar();
  await esperarCola(S.estadoSync);
  assert.ok(!S.escrituraPendiente("leads", lead.id));
  assert.equal(base.tabla("leads").get(lead.id)!.notas, "segunda");
});

test("una columna que la base todavía no tiene se saca y se reintenta: el resto del dato entra y la cola sigue", async () => {
  const S = await conDemo(base);
  const venta = estadoDe(S).ventas[2];
  const avisos: string[] = [];
  const warn = console.warn;
  console.warn = (...x: unknown[]) => { avisos.push(x.join(" ")); };
  try {
    base.columnasFaltantes.set("ventas", new Set(["sesionId"]));
    await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, { sesionId: "ses_x", notas: "llega igual" } as never, venta.contactoNombre));
    assert.equal(S.estadoSync(), "listo", S.errorSync());
    const fila = base.tabla("ventas").get(venta.id)!;
    assert.equal(fila.notas, "llega igual");
    assert.ok(!("sesionId" in fila) || fila.sesionId === undefined, "la columna que no existe no se guardó");
    assert.ok(avisos.some((a) => /«sesionId» no existe en ventas/.test(a)), "avisa por consola");
    /* y lo que viene después sigue andando */
    await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, { notas: "otra" } as never, venta.contactoNombre));
    assert.equal(base.tabla("ventas").get(venta.id)!.notas, "otra");
  } finally { console.warn = warn; }
});

test("un UPDATE parcial al que se le va la única columna no se manda vacío ni traba", async () => {
  const S = await conDemo(base);
  const ses = estadoDe(S).sesiones.find((s: E) => s.estado === "hecha");
  const warn = console.warn;
  console.warn = () => {};
  try {
    base.columnasFaltantes.set("sesiones", new Set(["estadoLlamadaEn", "estadoLlamada"]));
    await yEsperar(S, () => S.acciones.editarLlamadas([{ id: ses.id, cambios: { estadoLlamada: "Compra Full" }, detalle: "x" }]));
    assert.equal(S.estadoSync(), "listo", S.errorSync());
  } finally { console.warn = warn; }
});

test("una tabla opcional que no existe: se descarta la escritura, queda marcada como sin crear y no traba lo demás", async () => {
  const S = await conDemo(base);
  base.existentes = new Set(base.tablas.keys());
  base.existentes.delete("devoluciones");
  const venta = estadoDe(S).ventas.find((v: E) => v.estado === "activa");
  await yEsperar(S, () => { S.acciones.registrarDevolucion({ ventaId: venta.id, monto: 10, fecha: "2026-10-05T12:00:00.000Z" } as never); });
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.ok(S.tablaSinCrear("devoluciones"));
  assert.ok(!S.tablaSinCrear("ventas"));
  assert.equal(estadoDe(S).devoluciones.length, 1, "en memoria está");
  await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, { notas: "sigue" } as never, venta.contactoNombre));
  assert.equal(base.tabla("ventas").get(venta.id)!.notas, "sigue");
  base.existentes = null;
});

test("una tabla obligatoria que falta es un error de verdad (no se descarta)", async () => {
  const S = await conDemo(base);
  base.existentes = new Set([...base.tablas.keys()].filter((t) => t !== "metas"));
  S.acciones.crear("metas", { nombre: "m", metrica: "ingresos", objetivo: 1, unidad: "cantidad", periodo: "2026-10", creadoEn: "2026-10-01" } as never, "m");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "error");
  assert.match(S.errorSync(), /metas/);
  base.existentes = null;
});

test("sin permiso en la base (42501): se descarta, se avisa y lo que viene atrás se escribe", async () => {
  const S = await conDemo(base);
  const negadas: string[] = [];
  const baja = S.alNegarseEscritura((t) => negadas.push(t));
  base.puedeEscribir = (tabla) => tabla !== "ventas";
  const venta = estadoDe(S).ventas[0], lead = estadoDe(S).leads[0];
  S.acciones.actualizar("ventas", venta.id, { notas: "no pasa" } as never, "v");
  S.acciones.actualizar("leads", lead.id, { notas: "pasa" } as never, "l");
  await esperarCola(S.estadoSync);
  baja();
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.deepEqual(negadas, ["ventas"]);
  assert.equal(base.tabla("leads").get(lead.id)!.notas, "pasa");
  base.puedeEscribir = null;
});

test("con un tipo de cuenta que no edita la tabla, la cola ni lo intenta (no manda a la base lo que va a rechazar)", async () => {
  const S = await conDemo(base);
  S.fijarAcceso(acceso("setter"));
  const negadas: string[] = [];
  const baja = S.alNegarseEscritura((t) => negadas.push(t));
  base.log = [];
  const venta = estadoDe(S).ventas[0];
  S.acciones.actualizar("ventas", venta.id, { notas: "setter no edita ventas" } as never, "v");
  await respirar();
  baja();
  S.fijarAcceso(null);
  assert.ok(negadas.includes("ventas"));
  assert.equal(base.peticiones("upsert", "ventas").length, 0);
});

test("borrar algo que otra cosa todavía usa (23503): se descarta con aviso y no traba", async () => {
  const S = await conDemo(base);
  const mensajes: (string | undefined)[] = [];
  const baja = S.alNegarseEscritura((_t, m) => mensajes.push(m));
  /* un lead con ventas: ventas.contactoId → leads.id */
  const e = estadoDe(S);
  const lead = e.leads.find((l: E) => e.ventas.some((v: E) => v.contactoId === l.id));
  assert.ok(lead, "la demo tiene un lead con ventas");
  S.acciones.eliminar("leads", lead.id, lead.nombre);
  S.acciones.actualizar("metas", e.metas[0].id, { nombre: "después" } as never, "m");
  await esperarCola(S.estadoSync);
  baja();
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.ok(base.tabla("leads").has(lead.id), "la base conserva lo que otra cosa usa");
  assert.match(String(mensajes[0]), /todavía lo usa otra cosa/);
  assert.equal(base.tabla("metas").get(e.metas[0].id)!.nombre, "después");
});

test("una falla pasajera (la base devuelve 503) se reintenta en el cambio siguiente: no se pierde nada y el orden se respeta", async () => {
  const S = await conDemo(base);
  const [l1, l2] = estadoDe(S).leads;
  let fallas = 2;
  base.falla = (p) => (p.tipo === "upsert" && p.tabla === "leads" && fallas-- > 0 ? { status: 503, body: { code: "XX000", message: "se cayó" } } : null);
  base.log = [];
  S.acciones.actualizar("leads", l1.id, { notas: "uno" } as never, "l1");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "error");
  assert.match(S.errorSync(), /se cayó/);
  assert.notEqual(base.tabla("leads").get(l1.id)!.notas, "uno", "todavía no llegó");
  S.acciones.actualizar("leads", l2.id, { notas: "dos" } as never, "l2");
  await esperarCola(S.estadoSync);
  /* la segunda falla también (fallas = 2 → una por intento); el tercer cambio ya pasa */
  S.acciones.actualizar("leads", l2.id, { notas: "tres" } as never, "l2");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.equal(base.tabla("leads").get(l1.id)!.notas, "uno");
  assert.equal(base.tabla("leads").get(l2.id)!.notas, "tres");
  const orden = base.peticiones("upsert", "leads").filter((p) => p.codigo === "201").map((p) => p.filas![0].notas);
  assert.deepEqual(orden, ["uno", "dos", "tres"], "salen en el orden en que se cargaron");
});

test("sin red (fetch rechaza) tampoco se pierde lo pendiente: al volver, se escribe", async () => {
  const S = await conDemo(base);
  const m = estadoDe(S).metas[0];
  base.falla = () => ({ status: 0 });
  S.acciones.actualizar("metas", m.id, { objetivo: 777 } as never, "m");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "error");
  base.falla = null;
  S.acciones.actualizar("metas", m.id, { nombre: "volvió" } as never, "m");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  const fila = base.tabla("metas").get(m.id)!;
  assert.equal(fila.objetivo, 777);
  assert.equal(fila.nombre, "volvió");
});

test("los lotes: 500 filas por upsert y 100 ids por UPDATE", async () => {
  const S = await conDemo(base);
  base.log = [];
  const etapaId = estadoDe(S).etapas[0].id;
  const filas = Array.from({ length: 1234 }, (_x, i) => ({
    nombre: `Persona ${i}`, email: `p${i}@ejemplo.test`, fuente: "CSV", etapaId, monto: 0, moneda: "USD",
    responsable: "Yari Taft", etiquetas: [], creadoEn: "2026-10-01T00:00:00.000Z", actualizadoEn: "2026-10-01T00:00:00.000Z", extra: {},
  }));
  await yEsperar(S, () => { S.acciones.importarLeads(filas as never); });
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  const tam = (t: string) => base.peticiones("upsert", t).map((p) => p.filas!.length);
  assert.deepEqual(tam("leads"), [500, 500, 234]);
  assert.deepEqual(tam("contactos"), [500, 500, 234]);
  const antes = base.tabla("leads").size;
  assert.ok(antes >= 1234);

  base.log = [];
  const ids = estadoDe(S).sesiones.slice(0, 250).map((s: E) => s.id);
  await yEsperar(S, () => S.acciones.reasignarCuotas(estadoDe(S).cuotas.slice(0, 250).map((c: E) => c.id), null, "x"));
  const tamU = base.peticiones("update", "cuotas").map((p) => p.ids!.length);
  assert.deepEqual(tamU, [100, 100, 50]);
  void ids;
});

test("un id con coma o paréntesis viaja bien en el UPDATE y en el DELETE (se comilla)", async () => {
  const S = await conDemo(base);
  const id = "met_a,b(c)d";
  S.acciones.crear("metas", { id, nombre: "raro", metrica: "ingresos", objetivo: 1, unidad: "cantidad", periodo: "2026-10", creadoEn: "2026-10-01" } as never, "raro");
  await esperarCola(S.estadoSync);
  assert.ok(base.tabla("metas").has(id));
  S.acciones.actualizarParcial("sesiones", estadoDe(S).sesiones[0].id, { notas: "x" } as never, "x");
  S.acciones.eliminar("metas", id, "raro");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.ok(!base.tabla("metas").has(id), "se borró la fila con el id raro");
});

/* ---------- Lo que falla ---------- */

/* BUG: la cola reintenta para siempre una operación imposible y deja sin guardar todo lo demás (el detalle está dentro de la prueba) */
test("un valor que la base rechaza para siempre (23xxx/22xxx) no tiene que trabar lo que se cargue después", { todo: true }, async () => {
  /* BUG: drenar() sólo descarta 42501, 23503-en-delete, tabla opcional que falta y columna que falta. Cualquier otro error de la
     base (NOT NULL, CHECK, tipo inválido, clave duplicada) hace `throw`: la operación queda al frente de la cola y se reintenta
     en cada cambio, así que NADA de lo que viene atrás se guarda; y al recargar se pierde todo lo pendiente.
     Caso real: «Años de experiencia» del asistente de Lead (components/leads/AsistenteLead.tsx) es un <input type="number">
     que pasa por Number(): «2.5» llega como 2.5 a leads.aniosExperiencia y contactos.aniosExperiencia, que son INTEGER. */
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  S.acciones.altaDeLead({
    nombre: "Con experiencia decimal", email: "decimal@ejemplo.test", fuente: "Webinar", etapaId: e0.etapas[0].id, monto: 0, moneda: "USD",
    responsable: "Yari Taft", aniosExperiencia: 2.5, etiquetas: [], creadoEn: "2026-10-07T12:00:00.000Z", actualizadoEn: "2026-10-07T12:00:00.000Z", extra: {},
  } as never, "Lead decimal");
  await esperarCola(S.estadoSync);
  /* Lo siguiente, que no tiene nada que ver, tiene que guardarse. */
  const m = e0.metas[0];
  await yEsperar(S, () => S.acciones.actualizar("metas", m.id, { nombre: "no tiene nada que ver" } as never, "m"));
  assert.equal(base.tabla("metas").get(m.id)!.nombre, "no tiene nada que ver", `la cola quedó trabada: ${S.errorSync()}`);
});

test("el estado de error se limpia solo cuando la cola se vacía (no queda un cartel viejo)", async () => {
  const S = await conDemo(base);
  base.falla = () => ({ status: 503, body: { code: "XX000", message: "boom" } });
  S.acciones.actualizar("metas", estadoDe(S).metas[0].id, { nombre: "x" } as never, "m");
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "error");
  base.falla = null;
  S.acciones.ajustesSilencioso({ tourVisto: true } as never);
  await esperarCola(S.estadoSync);
  assert.equal(S.estadoSync(), "listo");
  assert.equal(S.errorSync(), "");
  void storeNuevo;
});
