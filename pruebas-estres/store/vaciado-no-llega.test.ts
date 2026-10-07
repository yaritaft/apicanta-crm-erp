/* Estrés del almacén: vaciar un campo tiene que llegar a la base.

   El store manda cada cambio con `upsert`, y normalizar() SACA los `undefined` (para que PostgREST
   complete lo que falte con el DEFAULT de la columna en vez de escribir NULL). Pero un upsert sólo
   toca las columnas que vienen en el cuerpo: un campo que se vació con `undefined` queda, en la base,
   con el valor viejo. En pantalla el campo se ve vacío (la memoria manda); al recargar, o en otra
   compu, el dato viejo vuelve.

   El propio código lo sabe: carga-gasto.ts (`vaciar`), FormularioVenta, FichaMiembro, editarDevolucion
   y guardarTraspaso mandan `null` o un UPDATE aparte. Las pruebas de acá son los lugares donde no.
   Cada una compara lo que se ve (memoria) con lo que se vería al recargar (un store nuevo que carga
   de la base). Las marcadas todo son bugs; las que pasan son los caminos que ya lo hacen bien. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, instalar } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

const por = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id) as T;

/* ---------- Lo que está mal ---------- */

/* BUG: desconciliar() manda undefined en pagoId, cuotaId, ventaId, conciliadoEn y conciliadoPor (el detalle está dentro de la prueba) */
test("desconciliar un cobro (conciliado sin vincular) deja en la base el pago, la cuota, la venta y quién lo concilió", { todo: true }, async () => {
  /* BUG: store.ts desconciliar(), rama «no vinculado»: arma el movimiento con esos cinco campos en undefined y hace
     un upsert; la rama «vinculado» (justo arriba) sí manda un UPDATE con null y lo explica en un comentario.
     Al recargar, el movimiento queda «pendiente» pero apuntando a un pago que ya no existe y a una venta de la que
     se deshizo la conciliación. lib/reembolsos.ts (cobroDelReembolso) y lib/conciliacion.ts usan mov.ventaId/cuotaId/pagoId:
     un reembolso de Stripe se ataría a la venta equivocada. */
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  const mov = e0.movimientos.find((m: E) => m.estado === "pendiente");
  const cuota = e0.cuotas.find((c: E) => c.estado === "pendiente");
  await yEsperar(S, () => assert.ok(S.acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: Math.min(mov.monto, cuota.monto) }])));
  await yEsperar(S, () => assert.ok(S.acciones.desconciliar(mov.id)));

  const enPantalla = por<E>(estadoDe(S).movimientos, mov.id);
  assert.equal(enPantalla.estado, "pendiente");
  assert.equal(enPantalla.pagoId, undefined);
  const alRecargar = por<E>((await recargado()).movimientos, mov.id);
  assert.deepEqual(
    { estado: alRecargar.estado, pagoId: alRecargar.pagoId ?? null, cuotaId: alRecargar.cuotaId ?? null, ventaId: alRecargar.ventaId ?? null, conciliadoEn: alRecargar.conciliadoEn ?? null, conciliadoPor: alRecargar.conciliadoPor ?? null },
    { estado: "pendiente", pagoId: null, cuotaId: null, ventaId: null, conciliadoEn: null, conciliadoPor: null },
  );
});

/* BUG: acciones.actualizar() no manda el vaciado (ventaId: undefined) (el detalle está dentro de la prueba) */
test("Alumnos → Editar → «Sin venta enlazada»: el alumno sigue con su venta al recargar", { todo: true }, async () => {
  /* BUG: EditarAlumno (components/alumnos/Servicio.tsx) pone `ventaId: ev.target.value || undefined` y alumnos/page.tsx guarda con
     acciones.actualizar("alumnos", …): la memoria queda sin venta y la base con la de siempre. */
  const S = await conDemo(base);
  const alumno = estadoDe(S).alumnos.find((a: E) => a.ventaId);
  await yEsperar(S, () => S.acciones.actualizar("alumnos", alumno.id, { ventaId: undefined } as never, alumno.nombre));
  assert.equal(por<E>(estadoDe(S).alumnos, alumno.id).ventaId, undefined);
  assert.equal(por<E>((await recargado()).alumnos, alumno.id).ventaId, undefined);
});

/* BUG: acciones.actualizar() no manda el vaciado (FormularioVenta usa `|| undefined`) (el detalle está dentro de la prueba) */
test("Editar una venta y dejar sin atribuir el webinar, el vendedor, el director, el servicio o la estrategia: queda así al recargar", { todo: true }, async () => {
  /* BUG: FormularioVenta.guardar() arma `productoId: f.productoId || undefined`, `webinarId: … || undefined`, `embudoId`, `closerId`,
     `directorId` (que además se vacía solo si el vendedor es Yari, «no comisiona nadie»); su comentario dice «Vacío y no undefined»
     pero el código hace lo contrario. Con «Sin atribuir» / «Sin asignar» elegido, la base conserva el valor viejo. */
  const S = await conDemo(base);
  const venta = estadoDe(S).ventas.find((v: E) => v.webinarId && v.closerId && v.directorId && v.productoId && v.embudoId);
  assert.ok(venta, "la demo tiene una venta con todo atribuido");
  const vaciados = { productoId: undefined, webinarId: undefined, embudoId: undefined, closerId: undefined, directorId: undefined };
  await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, vaciados as never, venta.contactoNombre));
  const alRecargar = por<E>((await recargado()).ventas, venta.id);
  for (const k of Object.keys(vaciados)) assert.equal(alRecargar[k], undefined, `${k} volvió con «${alRecargar[k]}»`);
});

/* BUG: acciones.actualizar() no manda el vaciado (ingresoComunidad: undefined) (el detalle está dentro de la prueba) */
test("Ficha → Ingreso a la comunidad → «Sin definir» queda sin definir al recargar", { todo: true }, async () => {
  const S = await conDemo(base);
  const venta = estadoDe(S).ventas[0];
  await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, { ingresoComunidad: "Si" } as never, venta.contactoNombre));
  await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, { ingresoComunidad: undefined } as never, venta.contactoNombre));
  assert.equal(por<E>(estadoDe(S).ventas, venta.id).ingresoComunidad, undefined);
  assert.equal(por<E>((await recargado()).ventas, venta.id).ingresoComunidad, undefined);
});

/* BUG: guardarGastoRecurrente() no manda el vaciado (el detalle está dentro de la prueba) */
test("Gastos fijos → corregir uno y vaciarle el proveedor, la cuenta o las notas: queda vacío al recargar", { todo: true }, async () => {
  /* BUG: GastosFijos.tsx (el editor) arma `proveedor: proveedor.trim() || undefined`, `cuentaId: cuentaId || undefined`, `notas: … || undefined`
     y llama a acciones.guardarGastoRecurrente(t), que sólo hace upsert. A diferencia de los gastos (carga-gasto.ts `vaciar`) acá nadie manda null. */
  const S = await conDemo(base);
  const cuenta = estadoDe(S).procesadores[0].id;
  const t = { id: "rec_prueba", concepto: "Fathom", categoria: "Software", grupo: "operativo", proveedor: "Fathom Inc", monto: 40, moneda: "USD", diaDelMes: 5, cuentaId: cuenta, notas: "se paga con la tarjeta", activo: true, desde: "2026-10", salteados: [], creadoEn: "2026-10-01T00:00:00.000Z" };
  await yEsperar(S, () => S.acciones.guardarGastoRecurrente(t as never));
  await yEsperar(S, () => S.acciones.guardarGastoRecurrente({ ...t, proveedor: undefined, cuentaId: undefined, notas: undefined } as never));
  const alRecargar = por<E>((await recargado()).gastosRecurrentes, "rec_prueba");
  assert.deepEqual({ p: alRecargar.proveedor, c: alRecargar.cuentaId, n: alRecargar.notas }, { p: undefined, c: undefined, n: undefined });
});

/* ---------- Lo que ya anda (regresión) ---------- */

test("los caminos que mandan null o un UPDATE aparte sí vacían el campo en la base", async () => {
  const S = await conDemo(base);
  const e0 = estadoDe(S);

  /* actualizarParcial: undefined → null. */
  const ses = e0.sesiones.find((s: E) => s.notas);
  await yEsperar(S, () => S.acciones.actualizarParcial("sesiones", ses.id, { notas: undefined } as never, "x"));

  /* editarDevolucion: lo vaciado viaja como null. */
  const venta = e0.ventas.find((v: E) => v.estado === "activa");
  let devId = "";
  await yEsperar(S, () => { devId = S.acciones.registrarDevolucion({ ventaId: venta.id, monto: 50, fecha: "2026-10-05T12:00:00.000Z", motivo: "no encajaba", notas: "x" } as never) as string; });
  await yEsperar(S, () => S.acciones.editarDevolucion(devId, { motivo: undefined, notas: undefined } as never));

  /* guardarTraspaso: lo que se vació al corregir viaja aparte. */
  const [p1, p2] = e0.procesadores;
  const tra = { id: "tra_prueba", fecha: "2026-10-04T12:00:00.000Z", origenId: p1.id, destinoId: p2.id, montoSale: 100, monedaSale: "USD", montoLlega: 99, monedaLlega: "USD", estado: "confirmado", origen: "manual", creadoEn: "2026-10-04T12:00:00.000Z", notas: "algo" };
  await yEsperar(S, () => S.acciones.guardarTraspaso(tra as never, null));
  await yEsperar(S, () => S.acciones.guardarTraspaso({ ...tra, notas: undefined } as never, null));

  /* guardarEsquema + FichaMiembro: «pendiente» se vacía con null. */
  const m = e0.equipo[0];
  await yEsperar(S, () => S.acciones.guardarEsquema({ id: `hon_${m.id}`, miembroId: m.id, conceptos: [], categoriaGasto: "Equipo", actualizadoEn: "", pendiente: "consultar con Yari" } as never, "yo"));
  await yEsperar(S, () => S.acciones.guardarEsquema({ id: `hon_${m.id}`, miembroId: m.id, conceptos: [], categoriaGasto: "Equipo", actualizadoEn: "", pendiente: null } as never, "yo"));

  const r = await recargado();
  assert.equal(por<E>(r.sesiones, ses.id).notas ?? null, null);
  assert.equal(por<E>(r.devoluciones, devId).motivo ?? null, null);
  assert.equal(por<E>(r.devoluciones, devId).notas ?? null, null);
  assert.equal(por<E>(r.traspasos, "tra_prueba").notas ?? null, null);
  assert.equal(por<E>(r.honorarios, `hon_${m.id}`).pendiente ?? null, null);
});

test("los cambios de valor (no los vaciados) siempre llegan: actualizar() deja la fila igual en memoria y en la base", async () => {
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  const v = e0.ventas[3];
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { notas: "Ñandú 'quote' \"dq\" 🚀", ingresoComunidad: "En espera", precioAcordado: 1234.56 } as never, v.contactoNombre));
  const r = por<E>((await recargado()).ventas, v.id);
  assert.equal(r.notas, "Ñandú 'quote' \"dq\" 🚀");
  assert.equal(r.ingresoComunidad, "En espera");
  assert.equal(r.precioAcordado, 1234.56);
});
