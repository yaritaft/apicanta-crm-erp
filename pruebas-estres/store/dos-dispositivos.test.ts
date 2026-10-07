/* Estrés del almacén, frente 5: la misma fila editada dos veces, o desde dos dispositivos.

   Dos stores distintos (cada uno es «una pestaña o una compu») contra la misma base:
   - la última edición de un mismo campo es la que queda, también al recargar desde el otro lado;
   - lo que se manda como UPDATE de columnas (las llamadas del CRM, los chequeos de un cobro, los cambios de closer en cuotas) no pisa lo que
     el otro dispositivo cambió en OTRAS columnas de la misma fila;
   - lo que llega por Realtime (recibirDeLaNube, aplicarDeLaNube) entra a la memoria sin volver a escribirse en la base (si no, una pestaña vieja
     pisaría un número más nuevo), suma lo nuevo y saca lo borrado;
   - mientras una fila tiene una escritura pendiente, escrituraPendiente lo dice (es lo que mira Crm.tsx para no aplicar un aviso más viejo que lo
     que se ve en pantalla);
   - traerTraspasos espera a que no quede nada de ellos por escribir antes de reemplazar la memoria con la base.
   No se prueba lo que es del diseño: dos personas que editan campos DISTINTOS de la misma fila de una tabla que se guarda entera (leads, ventas…)
   desde copias viejas se pisan entre sí (el código lo dice en actualizarParcial; sólo las llamadas y los chequeos se protegieron). */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar, respirar } from "./_nube";
import { conDemo, estadoDe, yEsperar } from "./_escenas";
import { storeNuevo } from "./_fresco";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

const S0 = await conDemo(base);
const FOTO = base.foto();
void S0;

async function dosDispositivos() {
  base.restaurar(FOTO);
  const A = await storeNuevo(); await A.cargarDeLaNube();
  const B = await storeNuevo(); await B.cargarDeLaNube();
  return { A, B };
}
const fila = (e: E, tabla: string, id: string) => (e[tabla] as E[]).find((x) => x.id === id);

test("la última edición de un mismo campo es la que queda, desde cualquiera de los dos", async () => {
  const { A, B } = await dosDispositivos();
  const lead = estadoDe(A).leads[0];
  await yEsperar(A, () => A.acciones.actualizar("leads", lead.id, { notas: "de A" } as never, lead.nombre));
  await yEsperar(B, () => B.acciones.actualizar("leads", lead.id, { notas: "de B" } as never, lead.nombre));
  assert.equal(base.tabla("leads").get(lead.id)!.notas, "de B");
  await yEsperar(A, () => A.acciones.actualizar("leads", lead.id, { notas: "de A otra vez" } as never, lead.nombre));
  assert.equal(base.tabla("leads").get(lead.id)!.notas, "de A otra vez");
  const C = await storeNuevo(); await C.cargarDeLaNube();
  assert.equal(fila(estadoDe(C), "leads", lead.id).notas, "de A otra vez");
});

test("las llamadas se guardan por columnas: lo que cargó un dispositivo no lo pisa el otro desde una copia vieja", async () => {
  const { A, B } = await dosDispositivos();
  const s = estadoDe(A).sesiones.find((x: E) => x.estado === "hecha");
  /* A carga el Pre-Call; B (que no se enteró) carga las notas y la grabación. */
  await yEsperar(A, () => A.acciones.editarLlamadas([{ id: s.id, cambios: { preCall: "1° Mje Enviado" }, detalle: "a" }]));
  await yEsperar(B, () => B.acciones.editarLlamadas([{ id: s.id, cambios: { notas: "notas de B", grabacion: "https://fathom.video/share/x" }, detalle: "b" }]));
  await yEsperar(B, () => B.acciones.actualizarParcial("sesiones", s.id, { estado: "no-show" } as never, "x"));
  const enBase = base.tabla("sesiones").get(s.id)!;
  assert.equal(enBase.preCall, "1° Mje Enviado", "lo de A se conserva");
  assert.equal(enBase.notas, "notas de B");
  assert.equal(enBase.estado, "no-show");
});

test("el chequeo de un cobro no lo pisa un upsert del cobro entero que hace el otro dispositivo (las columnas del control no viajan)", async () => {
  const { A, B } = await dosDispositivos();
  const p = estadoDe(A).pagos.find((x: E) => !x.movimientoId);
  await yEsperar(A, () => assert.ok(A.acciones.chequearPago(p.id, { casillero: "director", veredicto: "chequeado" })));
  assert.equal(base.tabla("pagos").get(p.id)!.chequeoDirector, "chequeado");
  /* B tiene el cobro como estaba (sin chequeo) y corrige la comisión: upsert de la fila entera. */
  assert.equal(fila(estadoDe(B), "pagos", p.id).chequeoDirector, undefined);
  await yEsperar(B, () => assert.ok(B.acciones.editarPago(p.id, { feeMonto: 12.34 })));
  const enBase = base.tabla("pagos").get(p.id)!;
  assert.equal(enBase.chequeoDirector, "chequeado", "el chequeo de A sobrevivió al upsert de B");
  assert.equal(enBase.feeMonto, 12.34);
  assert.ok(!base.peticiones("upsert", "pagos").some((x) => x.filas!.some((f) => "chequeoDirector" in f)), "ningún upsert de cobros lleva las columnas del control");
});

test("reasignar cuotas a otro closer sale como UPDATE de closerId (no pisa el monto que cambió el otro dispositivo)", async () => {
  const { A, B } = await dosDispositivos();
  const c = estadoDe(A).cuotas.find((x: E) => x.estado === "pendiente");
  const closer = estadoDe(A).equipo.find((m: E) => m.rol === "closer");
  await yEsperar(B, () => B.acciones.actualizar("cuotas", c.id, { monto: c.monto + 1 } as never, "x"));
  await yEsperar(A, () => A.acciones.reasignarCuotas([c.id], closer.id, "pasar"));
  const enBase = base.tabla("cuotas").get(c.id)!;
  assert.equal(enBase.closerId, closer.id);
  assert.equal(enBase.monto, c.monto + 1);
});

test("recibirDeLaNube y aplicarDeLaNube entran a la memoria sin escribir nada en la base", async () => {
  const { A } = await dosDispositivos();
  const e = estadoDe(A);
  const s = e.sesiones[0];
  base.log = [];
  /* Una agenda nueva (la escribió el webhook), un cambio de una existente y una borrada. */
  A.acciones.recibirDeLaNube("sesiones", [{ ...s, notas: "llegó por Realtime" }, { ...e.sesiones[1], id: "ses_nueva", notas: "nueva" } as never], [e.sesiones[2].id]);
  A.acciones.aplicarDeLaNube("sesiones", { [e.sesiones[3].id]: { notas: "aplicada" } } as never);
  await respirar(5);
  const n = estadoDe(A);
  assert.equal(fila(n, "sesiones", s.id).notas, "llegó por Realtime");
  assert.ok(fila(n, "sesiones", "ses_nueva"));
  assert.equal(fila(n, "sesiones", e.sesiones[2].id), undefined);
  assert.equal(fila(n, "sesiones", e.sesiones[3].id).notas, "aplicada");
  assert.equal(base.log.filter((p) => p.tipo !== "select").length, 0, "no escribió nada");
  assert.equal(A.estadoSync(), "listo");
});

test("recibirDeLaNube: una fila que no cambió no vuelve a pintar (y no crea una copia nueva del estado)", async () => {
  const { A } = await dosDispositivos();
  const antes = A.acciones.exportar();
  const s = estadoDe(A).sesiones[0];
  A.acciones.recibirDeLaNube("sesiones", [s]);
  A.acciones.recibirDeLaNube("sesiones", []);
  A.acciones.aplicarDeLaNube("sesiones", { [s.id]: { notas: s.notas } } as never);
  assert.equal(A.acciones.exportar(), antes);
});

test("escrituraPendiente: una fila con un UPDATE o un DELETE en la cola cuenta, y deja de contar al terminar", async () => {
  const { A } = await dosDispositivos();
  const e = estadoDe(A);
  const s = e.sesiones[0], m = e.metas[0];
  let soltar!: () => void;
  base.compuerta = new Promise<void>((r) => { soltar = r; });
  A.acciones.actualizarParcial("sesiones", s.id, { notas: "x" } as never, "x");
  A.acciones.eliminar("metas", m.id, "m");
  await respirar();
  assert.ok(A.escrituraPendiente("sesiones", s.id), "update");
  assert.ok(A.escrituraPendiente("metas", m.id), "delete");
  base.compuerta = null;
  soltar();
  await esperarCola(A.estadoSync);
  assert.ok(!A.escrituraPendiente("sesiones", s.id) && !A.escrituraPendiente("metas", m.id));
});

test("traerTraspasos espera a que se escriban los traspasos pendientes antes de reemplazar la memoria con la base", async () => {
  const { A } = await dosDispositivos();
  const procs = estadoDe(A).procesadores;
  let soltar!: () => void;
  base.compuerta = new Promise<void>((r) => { soltar = r; });
  A.acciones.guardarTraspaso({ id: "tra_x", fecha: "2026-10-04T12:00:00.000Z", origenId: procs[0].id, destinoId: procs[1].id, montoSale: 10, monedaSale: "USD", montoLlega: 9, monedaLlega: "USD", estado: "confirmado", origen: "manual", creadoEn: "2026-10-04T12:00:00.000Z" } as never, null);
  await respirar();
  const promesa = A.acciones.traerTraspasos();
  await new Promise((r) => setTimeout(r, 200));
  /* Todavía no llegó nada: en memoria sigue el traspaso local. */
  assert.ok(fila(estadoDe(A), "traspasos", "tra_x"), "mientras hay uno pendiente la memoria no se pisa");
  base.compuerta = null;
  soltar();
  assert.equal(await promesa, true);
  assert.ok(fila(estadoDe(A), "traspasos", "tra_x"), "después de escribirse, sigue ahí");
  assert.ok(base.tabla("traspasos").has("tra_x"));
});

test("el estado de sincronización recorre cargando → listo → guardando → listo", async () => {
  base.restaurar(FOTO);
  const A = await storeNuevo();
  const vistos: string[] = [A.estadoSync()];
  await A.cargarDeLaNube();
  vistos.push(A.estadoSync());
  A.acciones.ajustesSilencioso({ tourVisto: true } as never);
  vistos.push(A.estadoSync());
  await esperarCola(A.estadoSync);
  vistos.push(A.estadoSync());
  assert.deepEqual(vistos, ["cargando", "listo", "guardando", "listo"]);
});
