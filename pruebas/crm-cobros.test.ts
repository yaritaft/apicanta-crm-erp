import test from "node:test";
import assert from "node:assert/strict";
import { cobrosPorVenta, type CobrosDeVenta } from "@/lib/control-cobros";
import {
  COLUMNA, COLUMNAS, COLUMNAS_DE_COBROS, COMPROBANTE_FALTA, COMPROBANTE_SI, CONCILIADO_A_MANO, CONCILIADO_NO, CONCILIADO_SI,
  filasTabla, opcionesDeColumna, ORDEN_COMPROBANTE, ORDEN_CONCILIADO, ordenarFilas, SIN_COBROS, SIN_VENTA, valoresComprobante, valoresConciliado, VISIBLES_POR_DEFECTO, pasaFiltros,
  type FilaTabla,
} from "@/lib/crm-tabla";
import { puedeLeer, TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Pago, Procesador } from "@/lib/types";

/* ==================================================================
   Las columnas «Comprobante» y «Conciliado» de la tabla del CRM: lo que
   dicen los cobros de la venta de cada llamada (F1-03 y F1-04).
   ================================================================== */

const PROCESADORES = [
  { id: "stripe", proveedor: "stripe" },
  { id: "financiera" },
] as unknown as Procesador[];

const cuotas = [
  { id: "c1", ventaId: "v1" }, { id: "c2", ventaId: "v1" }, { id: "c3", ventaId: "v1" },
  { id: "c4", ventaId: "v2" },
  { id: "c5", ventaId: "v3" },
] as unknown as EstadoApp["cuotas"];

const pago = (extra: Partial<Pago>): Pago => ({
  id: "p", cuotaId: "c1", procesadorId: "financiera", monto: 500, moneda: "USD", feeRate: 0, feeMonto: 0,
  fecha: "2026-10-05T15:00:00.000Z", creadoEn: "2026-10-05T15:00:00.000Z", ...extra,
});
const archivo = { ruta: "a/b.png", nombre: "b.png", tipo: "image/png", tamano: 10 } as unknown as Pago["comprobante"];

const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("cobrosPorVenta cuenta, por venta, los que tienen prueba y los que están atados a la pasarela", () => {
  const pagos = [
    /* v1: un archivo (a mano), un link de la planilla (a mano), uno de Stripe sin conciliar y sin nada */
    pago({ id: "a", cuotaId: "c1", comprobante: archivo }),
    pago({ id: "b", cuotaId: "c2", comprobanteLink: "https://drive.google.com/x" }),
    pago({ id: "c", cuotaId: "c3", procesadorId: "stripe" }),
    /* v2: uno de Stripe atado a su pago, sin archivo: la prueba es la pasarela */
    pago({ id: "d", cuotaId: "c4", procesadorId: "stripe", movimientoId: "mov_1" }),
    /* una cuota de una venta que no existe y un cobro sin cuota: no cuentan */
    pago({ id: "e", cuotaId: "no-existe" }),
  ];
  const r = cobrosPorVenta({ pagos, cuotas, procesadores: PROCESADORES });
  assert.deepEqual(r.get("v1"), { total: 3, conPrueba: 2, sinComprobante: 1, conciliados: 0, sinConciliar: 1, aMano: 2 });
  assert.deepEqual(r.get("v2"), { total: 1, conPrueba: 1, sinComprobante: 0, conciliados: 1, sinConciliar: 0, aMano: 0 });
  assert.equal(r.has("v3"), false, "una venta sin cobros no aparece: quien la mira sabe que tiene cero");
  assert.equal(r.size, 2);
});

test("lo que dice cada columna: sin venta, sin cobros, lo que falta y lo que está", () => {
  const c = (extra: Partial<CobrosDeVenta>): CobrosDeVenta => ({ total: 1, conPrueba: 1, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 1, ...extra });
  assert.deepEqual(valoresComprobante(null), [SIN_VENTA]);
  assert.deepEqual(valoresConciliado(null), [SIN_VENTA]);
  assert.deepEqual(valoresComprobante(c({ total: 0, conPrueba: 0, aMano: 0 })), [SIN_COBROS]);
  assert.deepEqual(valoresConciliado(c({ total: 0, conPrueba: 0, aMano: 0 })), [SIN_COBROS]);
  assert.deepEqual(valoresComprobante(c({})), [COMPROBANTE_SI]);
  /* Con que a un cobro le falte, la venta falta. */
  assert.deepEqual(valoresComprobante(c({ total: 3, conPrueba: 2, sinComprobante: 1, aMano: 3 })), [COMPROBANTE_FALTA]);
  /* Conciliado: un solo valor por venta, el peor caso, como dice la celda. */
  assert.deepEqual(valoresConciliado(c({ total: 3, conPrueba: 3, conciliados: 1, sinConciliar: 1, aMano: 1 })), [CONCILIADO_NO]);
  assert.deepEqual(valoresConciliado(c({ total: 2, conPrueba: 2, conciliados: 1, sinConciliar: 0, aMano: 1 })), [CONCILIADO_SI]);
  assert.deepEqual(valoresConciliado(c({ conciliados: 1, aMano: 0 })), [CONCILIADO_SI]);
  assert.deepEqual(valoresConciliado(c({})), [CONCILIADO_A_MANO]);
});

test("las dos columnas existen, se ven de entrada, y son de las que sólo mira quien puede leer los cobros", () => {
  for (const k of ["comprobante", "conciliado"] as const) {
    assert.ok(COLUMNAS.some((x) => x.clave === k), k);
    assert.ok(VISIBLES_POR_DEFECTO.includes(k), `${k} se ve de entrada`);
    assert.ok(COLUMNAS_DE_COBROS.includes(k), k);
  }
  assert.equal(COLUMNA.comprobante.titulo, "Comprobante");
  assert.equal(COLUMNA.conciliado.titulo, "Conciliado");
  /* El closer (sólo lo suyo) y los dueños leen los cobros; el setter no: él no ve las dos columnas. */
  assert.ok(puedeLeer(acceso("closer"), "pagos"));
  assert.ok(puedeLeer(acceso("dueno"), "pagos"));
  assert.ok(!puedeLeer(acceso("setter"), "pagos"));
});

/* La semilla no ata ninguna venta a una llamada: se le ata una, con tres cuotas y dos cobros, y se arman
   las filas para compararlas con la cuenta directa. */
function estadoConVentas(): { e: EstadoApp; filas: FilaTabla[]; sesionId: string } {
  const semilla = construirSemilla();
  const filaCrm = filasTabla(semilla)[0];
  const s = filaCrm.sesion;
  const venta = { ...semilla.ventas[0], id: "v_ensayo", sesionId: s.id, contactoId: s.contactoId ?? s.leadId, estado: "activa" as const };
  const cuotasEnsayo = ["a", "b", "c"].map((k) => ({ ...semilla.cuotas[0], id: `cu_${k}`, ventaId: venta.id }));
  const pagosEnsayo = [
    pago({ id: "pg_a", cuotaId: "cu_a", procesadorId: undefined, comprobante: archivo }),
    pago({ id: "pg_b", cuotaId: "cu_b", procesadorId: undefined }),
  ];
  const e: EstadoApp = {
    ...semilla,
    ventas: [...semilla.ventas.filter((v) => v.sesionId !== s.id), venta],
    cuotas: [...semilla.cuotas, ...cuotasEnsayo],
    pagos: [...semilla.pagos, ...pagosEnsayo],
  };
  return { e, filas: filasTabla(e), sesionId: s.id };
}

test("cada llamada con venta trae los cobros de esa venta, y la que no tiene venta no trae nada", () => {
  const { e, filas, sesionId } = estadoConVentas();
  const directo = cobrosPorVenta(e);
  const conVenta = filas.filter((f) => f.fila.venta);
  assert.ok(conVenta.some((f) => f.sesion.id === sesionId), "la llamada a la que se le ató la venta la trae");
  const suya = conVenta.find((f) => f.sesion.id === sesionId)!;
  assert.deepEqual(suya.cobros, { total: 2, conPrueba: 1, sinComprobante: 1, conciliados: 0, sinConciliar: 0, aMano: 2 });
  assert.deepEqual(COLUMNA.comprobante.valores(suya), [COMPROBANTE_FALTA]);
  assert.deepEqual(COLUMNA.conciliado.valores(suya), [CONCILIADO_A_MANO]);
  for (const f of conVenta) {
    const esperado = directo.get(f.fila.venta!.id);
    assert.ok(f.cobros, "una llamada con venta siempre trae su cuenta (cero si no tiene cobros)");
    assert.deepEqual(f.cobros, esperado ?? { total: 0, conPrueba: 0, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 0 });
  }
  for (const f of filas.filter((x) => !x.fila.venta)) assert.equal(f.cobros, null);
  /* Cada llamada con venta cae en un solo valor de «Comprobante». */
  for (const f of conVenta) assert.equal(COLUMNA.comprobante.valores(f).length, 1);
});

test("quien arma las filas sin los cobros (sólo mira llamadas) no inventa nada", () => {
  const e = construirSemilla();
  const { pagos: _p, cuotas: _c, procesadores: _pr, ...sinCobros } = e;
  void _p; void _c; void _pr;
  const filas = filasTabla(sinCobros);
  assert.ok(filas.length > 0);
  assert.ok(filas.every((f) => f.cobros === null));
});

test("se filtra y se ordena como cualquier columna: «Falta comprobante» y «Sin conciliar» quedan arriba", () => {
  const { filas, sesionId } = estadoConVentas();
  const base = filas.find((f) => f.sesion.id === sesionId)!;
  const con = (cobros: CobrosDeVenta | null): FilaTabla => ({ ...base, id: `x${Math.random()}`, cobros });
  const falta = con({ total: 2, conPrueba: 1, sinComprobante: 1, conciliados: 0, sinConciliar: 1, aMano: 1 });
  const ok = con({ total: 1, conPrueba: 1, sinComprobante: 0, conciliados: 1, sinConciliar: 0, aMano: 0 });
  const sinCobros = con({ total: 0, conPrueba: 0, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 0 });
  const sinVenta = con(null);
  const todas = [sinVenta, sinCobros, ok, falta];
  const orden = ordenarFilas(todas, [{ clave: "comprobante", desc: false }], {});
  assert.deepEqual(orden.map((f) => f.cobros), [falta.cobros, ok.cobros, sinCobros.cobros, sinVenta.cobros]);
  const ordenC = ordenarFilas(todas, [{ clave: "conciliado", desc: false }], {});
  assert.equal(ordenC[0].cobros, falta.cobros, "lo que está sin conciliar, primero");
  /* Con los valores en el orden de las opciones (lo que usa la tabla) da lo mismo, y «al revés» deja lo pendiente al final. */
  const conLista = ordenarFilas(todas, [{ clave: "comprobante", desc: false }], { comprobante: ORDEN_COMPROBANTE });
  assert.deepEqual(conLista.map((f) => f.cobros), orden.map((f) => f.cobros));
  const alReves = ordenarFilas(todas, [{ clave: "comprobante", desc: true }], { comprobante: ORDEN_COMPROBANTE });
  assert.equal(alReves[alReves.length - 1].cobros, falta.cobros);
  /* El filtro: sólo las que les falta el comprobante. */
  const filtro = { comprobante: { modo: "solo" as const, valores: [COMPROBANTE_FALTA] } };
  assert.deepEqual(todas.filter((f) => pasaFiltros(f, filtro)), [falta]);
  const sinConciliar = { conciliado: { modo: "solo" as const, valores: [CONCILIADO_NO] } };
  assert.deepEqual(todas.filter((f) => pasaFiltros(f, sinConciliar)), [falta]);
});

test("el filtro del título ofrece los valores de cada columna con cuántas llamadas hay de cada uno", () => {
  const { filas, sesionId } = estadoConVentas();
  const base = filas.find((f) => f.sesion.id === sesionId)!;
  const con = (cobros: CobrosDeVenta | null, id: string): FilaTabla => ({ ...base, id, cobros });
  const todas = [
    con({ total: 1, conPrueba: 0, sinComprobante: 1, conciliados: 0, sinConciliar: 1, aMano: 0 }, "a"),
    con({ total: 2, conPrueba: 2, sinComprobante: 0, conciliados: 1, sinConciliar: 0, aMano: 1 }, "b"),
    con(null, "c"), con(null, "d"),
  ];
  const cuentas = (clave: "comprobante" | "conciliado") => Object.fromEntries(opcionesDeColumna(todas, {}, clave).map((o) => [o.valor, o.cuenta]));
  assert.deepEqual(cuentas("comprobante"), { [COMPROBANTE_FALTA]: 1, [COMPROBANTE_SI]: 1, [SIN_VENTA]: 2 });
  /* Una venta con cobros de dos clases cuenta una sola vez, en el peor caso: lo que se filtra es lo que se ve. */
  assert.deepEqual(cuentas("conciliado"), { [CONCILIADO_NO]: 1, [CONCILIADO_SI]: 1, [SIN_VENTA]: 2 });
  const lista = opcionesDeColumna(todas, {}, "conciliado", ORDEN_CONCILIADO).map((o) => o.valor);
  assert.deepEqual(lista, [CONCILIADO_NO, CONCILIADO_SI, SIN_VENTA], "lo que hay que mirar, primero");
});

test("si la llamada tiene dos ventas, la reembolsada no tapa a la que sigue en pie", () => {
  const semilla = construirSemilla();
  const s = filasTabla(semilla)[0].sesion;
  const base = { ...semilla.ventas[0], sesionId: s.id, contactoId: s.contactoId ?? s.leadId };
  const vieja = { ...base, id: "v_vieja", estado: "reembolsada" as const, fecha: "2026-10-01T15:00:00.000Z" };
  const activa = { ...base, id: "v_activa", estado: "activa" as const, fecha: "2026-10-03T15:00:00.000Z" };
  const fila = (ventas: EstadoApp["ventas"]) => filasTabla({ ...semilla, ventas: [...semilla.ventas.filter((v) => v.sesionId !== s.id), ...ventas] }).find((f) => f.sesion.id === s.id)!;
  assert.equal(fila([vieja, activa]).fila.venta?.id, "v_activa", "aunque la reembolsada sea más vieja");
  assert.equal(fila([activa, vieja]).fila.venta?.id, "v_activa");
  assert.equal(fila([vieja]).fila.venta?.id, "v_vieja", "si es la única, es la que hay");
  /* Entre dos activas, la primera, como siempre. */
  const otra = { ...activa, id: "v_otra", fecha: "2026-10-04T15:00:00.000Z" };
  assert.equal(fila([otra, activa]).fila.venta?.id, "v_activa");
});

test("una llamada de la que salieron dos ventas junta los cobros de las dos: lo que falta en una no lo tapa la otra", () => {
  const semilla = construirSemilla();
  const s = filasTabla(semilla)[0].sesion;
  const base = { ...semilla.ventas[0], sesionId: s.id, contactoId: s.contactoId ?? s.leadId, estado: "activa" as const };
  const mentoria = { ...base, id: "v_ment", fecha: "2026-10-01T15:00:00.000Z" };
  const upsell = { ...base, id: "v_ups", fecha: "2026-10-02T15:00:00.000Z" };
  const reembolsada = { ...base, id: "v_reem", estado: "reembolsada" as const, fecha: "2026-09-30T15:00:00.000Z" };
  const cuota = (id: string, ventaId: string) => ({ ...semilla.cuotas[0], id, ventaId });
  const cuotas = [cuota("cu_m", "v_ment"), cuota("cu_u", "v_ups"), cuota("cu_r", "v_reem")];
  const pagos = [
    pago({ id: "pg_m", cuotaId: "cu_m", procesadorId: undefined, comprobante: archivo }),
    pago({ id: "pg_u", cuotaId: "cu_u", procesadorId: undefined }),
    pago({ id: "pg_r", cuotaId: "cu_r", procesadorId: undefined }),
  ];
  const fila = (ventas: EstadoApp["ventas"]) => filasTabla({
    ...semilla, ventas: [...semilla.ventas.filter((v) => v.sesionId !== s.id), ...ventas], cuotas: [...semilla.cuotas, ...cuotas], pagos: [...semilla.pagos, ...pagos],
  }).find((f) => f.sesion.id === s.id)!;
  /* La mentoría tiene su comprobante y el upsell no: la fila dice que falta. */
  const dos = fila([mentoria, upsell]);
  assert.deepEqual(dos.cobros, { total: 2, conPrueba: 1, sinComprobante: 1, conciliados: 0, sinConciliar: 0, aMano: 2 });
  assert.deepEqual(COLUMNA.comprobante.valores(dos), [COMPROBANTE_FALTA]);
  /* Una reembolsada no suma si hay otra en pie, y sola es la que hay. */
  assert.equal(fila([reembolsada, mentoria]).cobros?.total, 1);
  assert.equal(fila([reembolsada]).cobros?.total, 1);
  /* Una sola venta, como antes. */
  assert.deepEqual(fila([mentoria]).cobros, { total: 1, conPrueba: 1, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 1 });
});
