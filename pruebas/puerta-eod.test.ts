import test from "node:test";
import assert from "node:assert/strict";
import { cambiosDelEod, faltaEnRespuesta, respuestaDe, type RespuestaEod } from "@/lib/eod";
import { OPCIONES_POR_DEFECTO } from "@/lib/crm";
import type { Ajustes, Sesion } from "@/lib/types";

/* ==================================================================
   La puerta del cierre del día (F2-02): si el estado es de compra, no se
   termina el día sin la venta cargada; la única salida es avisar que la
   carga otra persona, y queda anotado quién lo dijo y cuándo.
   ================================================================== */

const opciones = OPCIONES_POR_DEFECTO.estadoLlamada;
const ajustes = { crm: undefined } as unknown as Ajustes;
const COMPRA = "Compra Full";

test("sin puerta, una compra no pide nada más (como antes); con puerta, pide la venta o el aviso", () => {
  const r: RespuestaEod = { estadoLlamada: COMPRA };
  assert.equal(faltaEnRespuesta(r, opciones), null);
  assert.equal(faltaEnRespuesta(r, opciones, { tieneVenta: true }), null, "con la venta cargada, pasa");
  assert.equal(faltaEnRespuesta(r, opciones, { tieneVenta: false }), "Cargá la venta o avisá que la carga otra persona");
  assert.equal(faltaEnRespuesta({ ...r, ventaPorOtro: true }, opciones, { tieneVenta: false }), null, "la salida: la carga otra persona");
  assert.equal(faltaEnRespuesta({ ...r, ventaPorOtro: false }, opciones, { tieneVenta: false }), "Cargá la venta o avisá que la carga otra persona", "se deshizo el aviso");
});

test("la puerta es sólo de las compras: lo demás se pide como siempre", () => {
  const puerta = { tieneVenta: false };
  for (const n of ["Compra Cuotas", "Reserva", "Compra Downsell"]) assert.ok(faltaEnRespuesta({ estadoLlamada: n }, opciones, puerta), n);
  /* Seguimiento y perdida piden por qué no cerró, no una venta. */
  assert.equal(faltaEnRespuesta({ estadoLlamada: "Seguimiento Nutrición" }, opciones, puerta), "Elegí por qué no cerró");
  assert.equal(faltaEnRespuesta({ estadoLlamada: "NO Calificado", objecion: "No califica", hizoOferta: false }, opciones, puerta), null);
  /* No vino y los que no piden nada. */
  assert.equal(faltaEnRespuesta({ estadoLlamada: "Inasistió" }, opciones, puerta), null);
  /* Sin estado: lo de siempre. */
  assert.equal(faltaEnRespuesta(undefined, opciones, puerta), "Elegí cómo terminó la llamada");
  assert.equal(faltaEnRespuesta({ estadoPreCall: "Reagendar" }, opciones, puerta), null);
});

test("la salida queda anotada con quién y cuándo, y no se pisa al volver a guardar", () => {
  const sin = { notas: undefined, estadoLlamada: COMPRA, estadoPreCall: undefined, ventaPorOtro: undefined } as Pick<Sesion, "notas" | "estadoLlamada" | "estadoPreCall" | "ventaPorOtro">;
  const c = cambiosDelEod({ estadoLlamada: COMPRA, ventaPorOtro: true }, sin, ajustes, "Dante Barbieri", "2026-10-08T21:30:00.000Z");
  assert.deepEqual(c.ventaPorOtro, { por: "Dante Barbieri", en: "2026-10-08T21:30:00.000Z" });

  /* Ya anotada: otro guardado no cambia ni quién ni cuándo. */
  const anotada = { ...sin, ventaPorOtro: { por: "Dante Barbieri", en: "2026-10-08T21:30:00.000Z" } };
  const otra = cambiosDelEod({ estadoLlamada: COMPRA, ventaPorOtro: true }, anotada, ajustes, "Santi", "2026-10-09T10:00:00.000Z");
  assert.equal("ventaPorOtro" in otra, false);

  /* Sin avisar, no se anota nada. */
  assert.equal("ventaPorOtro" in cambiosDelEod({ estadoLlamada: COMPRA }, sin, ajustes, "Dante", "2026-10-08T21:30:00.000Z"), false);
});

test("si el closer se arrepiente, o la llamada deja de ser una compra, la salida se borra", () => {
  const anotada = { notas: undefined, estadoLlamada: COMPRA, estadoPreCall: undefined, ventaPorOtro: { por: "Dante", en: "2026-10-08T21:30:00.000Z" } } as Pick<Sesion, "notas" | "estadoLlamada" | "estadoPreCall" | "ventaPorOtro">;
  const arrepentido = cambiosDelEod({ estadoLlamada: COMPRA, ventaPorOtro: false }, anotada, ajustes, "Dante", "2026-10-09T10:00:00.000Z");
  assert.ok("ventaPorOtro" in arrepentido && arrepentido.ventaPorOtro === undefined);
  const noCompra = cambiosDelEod({ estadoLlamada: "Seguimiento Nutrición", objecion: "Plata", hizoOferta: true, cierreEstimado: "2026-10-30" }, anotada, ajustes, "Dante", "2026-10-09T10:00:00.000Z");
  assert.ok("ventaPorOtro" in noCompra && noCompra.ventaPorOtro === undefined);
});

test("lo que ya tiene la llamada trae el aviso, para seguir desde ahí", () => {
  const s = { id: "s1", estadoLlamada: COMPRA, ventaPorOtro: { por: "Dante", en: "2026-10-08T21:30:00.000Z" } } as unknown as Sesion;
  assert.equal(respuestaDe(s)?.ventaPorOtro, true);
  assert.equal(respuestaDe({ ...s, ventaPorOtro: undefined })?.ventaPorOtro, undefined);
  assert.equal(respuestaDe({ id: "s2" } as unknown as Sesion), undefined);
});
