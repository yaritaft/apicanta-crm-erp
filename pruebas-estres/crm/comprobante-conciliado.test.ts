import test from "node:test";
import assert from "node:assert/strict";
import {
  COBROS_EN_CERO, cobrosPorVenta, conciliacionDe, filasDeCobros, pasaControl, resumenDeControl, sumarCobros, tieneComprobante, type CobrosDeVenta,
} from "@/lib/control-cobros";
import {
  COLOR_COBROS, COLUMNA, COMPROBANTE_FALTA, COMPROBANTE_SI, CONCILIADO_A_MANO, CONCILIADO_NO, CONCILIADO_SI, filasTabla, opcionesDeColumna,
  ORDEN_COMPROBANTE, ORDEN_CONCILIADO, SIN_COBROS, SIN_VENTA, valoresComprobante, valoresConciliado,
} from "@/lib/crm-tabla";
import type { EstadoApp, Pago, Procesador, Venta } from "@/lib/types";
import { AHORA, Azar, conSemilla, mundoAzar } from "./gen";

/* ==================================================================
   Frente 5: las columnas «Comprobante» y «Conciliado».
   - Las sumas salen iguales a las de cobrosPorVenta, y un solo valor por
     llamada en cada columna.
   - Mismas reglas que Ventas → Cobros (pasaControl, conciliacionDe,
     resumenDeControl), contra un oráculo escrito aparte, sobre cientos de
     cobros al azar.
   ================================================================== */

/* Las seis cuentas de la primera versión de las columnas (el control cruzado, lo cobrado y quién cargó se prueban en
   pruebas/crm-cobros.test.ts): el oráculo y las comparaciones miran sólo esas seis. */
type Cuenta = Pick<CobrosDeVenta, "total" | "conPrueba" | "sinComprobante" | "conciliados" | "sinConciliar" | "aMano">;
const CERO: Cuenta = { total: 0, conPrueba: 0, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 0 };
const CAMPOS = Object.keys(CERO) as (keyof Cuenta)[];
const seis = (c: Cuenta | null | undefined): Cuenta | null => (c ? (Object.fromEntries(CAMPOS.map((k) => [k, c[k]])) as Cuenta) : null);
const seisMapa = (m: Map<string, Cuenta>): Map<string, Cuenta> => new Map([...m].map(([k, v]) => [k, seis(v)!]));
const completa = (x: Cuenta): CobrosDeVenta => ({ ...COBROS_EN_CERO, cargaron: [], ...x });
const sumar6 = (xs: readonly Cuenta[]): Cuenta => seis(sumarCobros(xs.map(completa)))!;

/* El oráculo: las reglas dichas en los comentarios de control-cobros.ts, escritas de nuevo.
   - Tiene prueba: un archivo, el link o texto de la planilla (con algo escrito), o el pago de la pasarela.
   - Conciliado: atado al pago de la pasarela (movimientoId).
   - Sin conciliar: no está atado y su cuenta tiene pasarela (proveedor).
   - A mano: no está atado y su cuenta no tiene pasarela (o no existe). */
function oraculo(pagos: readonly Pago[], cuotas: EstadoApp["cuotas"], procesadores: readonly Procesador[]): Map<string, Cuenta> {
  const ventaDe = new Map(cuotas.map((c) => [c.id, c.ventaId]));
  const out = new Map<string, Cuenta>();
  for (const p of pagos) {
    const v = ventaDe.get(p.cuotaId);
    if (v === undefined) continue;
    const x = out.get(v) ?? { ...CERO };
    out.set(v, x);
    const conPasarela = Boolean(procesadores.find((pr) => pr.id === p.procesadorId)?.proveedor);
    const prueba = Boolean(p.comprobante) || (typeof p.comprobanteLink === "string" && p.comprobanteLink.trim().length > 0) || Boolean(p.movimientoId);
    x.total++;
    if (prueba) x.conPrueba++; else x.sinComprobante++;
    if (p.movimientoId) x.conciliados++; else if (conPasarela) x.sinConciliar++; else x.aMano++;
  }
  return out;
}

const hoy = (n: number) => ({ id: `p${n}`, cuotaId: "c", monto: 1, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: new Date(AHORA).toISOString(), creadoEn: new Date(AHORA).toISOString() }) as Pago;

test("cobrosPorVenta coincide con las reglas, escritas aparte, sobre cientos de cobros al azar (con cobros raros)", () => {
  let pagosTotales = 0;
  for (let semilla = 1; semilla <= 50; semilla++) {
    const r = new Azar(semilla);
    const m = mundoAzar(r, { sesiones: 30, ventas: r.entre(5, 40), pagos: r.entre(30, 150), raro: r.bool(0.7) });
    pagosTotales += m.pagos.length;
    const real = cobrosPorVenta(m);
    const esperado = oraculo(m.pagos, m.cuotas, m.procesadores);
    assert.deepEqual(seisMapa(real), esperado, conSemilla(semilla, "cobrosPorVenta"));
    for (const [id, x] of real) {
      assert.equal(x.total, x.conPrueba + x.sinComprobante, conSemilla(semilla, `${id}: total ≠ con prueba + sin comprobante`));
      assert.equal(x.total, x.conciliados + x.sinConciliar + x.aMano, conSemilla(semilla, `${id}: total ≠ conciliados + sin conciliar + a mano`));
    }
  }
  assert.ok(pagosTotales >= 500, `se probaron ${pagosTotales} cobros`);
});

test("paridad con Ventas → Cobros: la suma por venta de «sin comprobante» y «sin conciliar» es la de pasaControl y resumenDeControl sobre los mismos cobros", () => {
  for (let semilla = 1; semilla <= 40; semilla++) {
    const r = new Azar(semilla + 100);
    const m = mundoAzar(r, { sesiones: 30, ventas: 30, pagos: r.entre(40, 160), raro: true });
    const porVenta = cobrosPorVenta(m);
    const cuotaIds = new Set(m.cuotas.map((c) => c.id));
    const conVenta = m.pagos.filter((p) => cuotaIds.has(p.cuotaId));
    const suma = (k: keyof Cuenta) => [...porVenta.values()].reduce((s, x) => s + x[k], 0);
    assert.equal(suma("total"), conVenta.length, conSemilla(semilla, "total"));
    assert.equal(suma("sinComprobante"), conVenta.filter((p) => pasaControl(p, m.procesadores, "sin-comprobante")).length, conSemilla(semilla, "sin comprobante"));
    assert.equal(suma("sinConciliar"), conVenta.filter((p) => pasaControl(p, m.procesadores, "sin-conciliar")).length, conSemilla(semilla, "sin conciliar"));
    assert.equal(suma("conciliados"), conVenta.filter((p) => conciliacionDe(m.procesadores, p) === "conciliado").length, conSemilla(semilla, "conciliados"));
    assert.equal(suma("aMano"), conVenta.filter((p) => conciliacionDe(m.procesadores, p) === "a-mano").length, conSemilla(semilla, "a mano"));
    assert.equal(suma("conPrueba"), conVenta.filter((p) => tieneComprobante(p) || Boolean(p.movimientoId)).length, conSemilla(semilla, "con prueba"));
    /* Y con los contadores de la lista de cobros (todos los cobros, también los sin cuota). */
    const res = resumenDeControl(m.procesadores, m.pagos);
    const huerfanos = m.pagos.filter((p) => !cuotaIds.has(p.cuotaId));
    assert.equal(res.sinComprobante, suma("sinComprobante") + huerfanos.filter((p) => pasaControl(p, m.procesadores, "sin-comprobante")).length, conSemilla(semilla, "resumenDeControl.sinComprobante"));
    assert.equal(res.sinConciliar, suma("sinConciliar") + huerfanos.filter((p) => pasaControl(p, m.procesadores, "sin-conciliar")).length, conSemilla(semilla, "resumenDeControl.sinConciliar"));
    /* La lista de cobros agrupada por venta dice lo mismo que la cuenta del CRM. */
    const filasLista = filasDeCobros(m, m.pagos);
    const agrupado = new Map<string, Cuenta>();
    for (const f of filasLista) {
      if (!f.cuota) continue;
      const x = agrupado.get(f.cuota.ventaId) ?? { ...CERO };
      agrupado.set(f.cuota.ventaId, x);
      x.total++;
      if (pasaControl(f.pago, m.procesadores, "sin-comprobante")) x.sinComprobante++; else x.conPrueba++;
      const c = conciliacionDe(m.procesadores, f.pago);
      if (c === "conciliado") x.conciliados++; else if (c === "sin-conciliar") x.sinConciliar++; else x.aMano++;
    }
    assert.deepEqual(seisMapa(porVenta), agrupado, conSemilla(semilla, "la lista de cobros agrupada por venta"));
  }
});

test("los cobros raros (link en blanco, comprobante null, movimiento vacío, proveedor vacío, procesador que no existe) caen donde dicen las reglas", () => {
  const procs = [{ id: "stripe", proveedor: "stripe" }, { id: "trust", proveedor: "" }, { id: "fin" }] as unknown as Procesador[];
  const cuotas = [{ id: "c", ventaId: "v" }] as unknown as EstadoApp["cuotas"];
  const casos: [string, Partial<Pago>, Partial<Cuenta>][] = [
    ["nada, sin pasarela", { procesadorId: "fin" }, { sinComprobante: 1, aMano: 1 }],
    ["link en blanco", { procesadorId: "fin", comprobanteLink: "   " }, { sinComprobante: 1, aMano: 1 }],
    ["link con texto sin url", { procesadorId: "fin", comprobanteLink: "se pagó en efectivo" }, { conPrueba: 1, aMano: 1 }],
    ["comprobante null", { procesadorId: "fin", comprobante: null as never }, { sinComprobante: 1, aMano: 1 }],
    ["movimientoId vacío", { procesadorId: "stripe", movimientoId: "" }, { sinComprobante: 1, sinConciliar: 1 }],
    ["atado a la pasarela", { procesadorId: "stripe", movimientoId: "m1" }, { conPrueba: 1, conciliados: 1 }],
    ["atado y sin pasarela (Mercury)", { procesadorId: "fin", movimientoId: "m1" }, { conPrueba: 1, conciliados: 1 }],
    ["proveedor vacío", { procesadorId: "trust" }, { sinComprobante: 1, aMano: 1 }],
    ["procesador que no existe", { procesadorId: "fantasma" }, { sinComprobante: 1, aMano: 1 }],
    ["sin procesador", { procesadorId: undefined }, { sinComprobante: 1, aMano: 1 }],
    ["procesador null", { procesadorId: null as never }, { sinComprobante: 1, aMano: 1 }],
    ["pasarela con archivo", { procesadorId: "stripe", comprobante: { ruta: "r", nombre: "n", tipo: "image/png", tamano: 1 } as never }, { conPrueba: 1, sinConciliar: 1 }],
  ];
  for (const [que, extra, cuenta] of casos) {
    const r = cobrosPorVenta({ pagos: [{ ...hoy(1), ...extra }], cuotas, procesadores: procs });
    assert.deepEqual(seis(r.get("v")), { ...CERO, total: 1, ...cuenta }, que);
  }
});

/* ---------- La cuenta de una llamada ---------- */

/* Las ventas que cuentan para una llamada: las suyas (que dicen haber salido de ella) en pie; la reembolsada sólo si no hay otra;
   y si la venta de la fila no dice de qué llamada salió (las de antes), esa sola. */
function idsDeVentas(f: { sesionId: string; ventaId: string }, ventas: readonly Venta[]): string[] {
  const suyas = ventas.filter((v) => v.sesionId === f.sesionId && v.estado !== "cancelada");
  if (!suyas.some((v) => v.id === f.ventaId)) return [f.ventaId];
  const enPie = suyas.filter((v) => v.estado !== "reembolsada");
  return (enPie.length ? enPie : suyas).map((v) => v.id);
}

test("cada llamada con venta dice lo que dicen los cobros de sus ventas (suma, comprobante y conciliado), con las reglas de la lista de cobros", () => {
  let llamadasConCobros = 0, faltas = 0, sinConciliar = 0, conciliadas = 0, aMano = 0, variasVentas = 0;
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = new Azar(semilla + 300);
    const m = mundoAzar(r, { sesiones: 60, ventas: 50, pagos: r.entre(60, 180), raro: r.bool(0.5) });
    const filas = filasTabla(m, AHORA);
    const porVenta = oraculo(m.pagos, m.cuotas, m.procesadores);
    for (const f of filas) {
      const ctx = conSemilla(semilla, `llamada ${f.id}`);
      if (!f.fila.venta) { assert.equal(f.cobros, null, ctx); assert.deepEqual(COLUMNA.comprobante.valores(f), [SIN_VENTA], ctx); assert.deepEqual(COLUMNA.conciliado.valores(f), [SIN_VENTA], ctx); continue; }
      const ids = idsDeVentas({ sesionId: f.id, ventaId: f.fila.venta.id }, m.ventas);
      if (ids.length > 1) variasVentas++;
      const esperado = ids.reduce<Cuenta>((s, id) => { const x = porVenta.get(id) ?? CERO; return { total: s.total + x.total, conPrueba: s.conPrueba + x.conPrueba, sinComprobante: s.sinComprobante + x.sinComprobante, conciliados: s.conciliados + x.conciliados, sinConciliar: s.sinConciliar + x.sinConciliar, aMano: s.aMano + x.aMano }; }, { ...CERO });
      assert.deepEqual(seis(f.cobros), esperado, ctx);
      /* Un solo valor en cada columna, el de lo que dicen los cobros. */
      const comp = COLUMNA.comprobante.valores(f), conc = COLUMNA.conciliado.valores(f);
      assert.equal(comp.length, 1, ctx); assert.equal(conc.length, 1, ctx);
      assert.deepEqual(comp, [esperado.total === 0 ? SIN_COBROS : esperado.sinComprobante > 0 ? COMPROBANTE_FALTA : COMPROBANTE_SI], ctx);
      assert.deepEqual(conc, [esperado.total === 0 ? SIN_COBROS : esperado.sinConciliar > 0 ? CONCILIADO_NO : esperado.conciliados > 0 ? CONCILIADO_SI : CONCILIADO_A_MANO], ctx);
      /* Las reglas de la lista de cobros, cobro por cobro, sobre las cuotas de esas ventas. */
      const cuotasDe = new Set(m.cuotas.filter((c) => ids.includes(c.ventaId)).map((c) => c.id));
      const suyos = m.pagos.filter((p) => cuotasDe.has(p.cuotaId));
      assert.equal(suyos.some((p) => pasaControl(p, m.procesadores, "sin-comprobante")), comp[0] === COMPROBANTE_FALTA, `${ctx}: «Falta comprobante» ≠ filtro «Sin comprobante» de Cobros`);
      assert.equal(suyos.some((p) => pasaControl(p, m.procesadores, "sin-conciliar")), conc[0] === CONCILIADO_NO, `${ctx}: «Sin conciliar» ≠ filtro «Sin conciliar» de Cobros`);
      if (esperado.total > 0) llamadasConCobros++;
      if (comp[0] === COMPROBANTE_FALTA) faltas++;
      if (conc[0] === CONCILIADO_NO) sinConciliar++;
      if (conc[0] === CONCILIADO_SI) conciliadas++;
      if (conc[0] === CONCILIADO_A_MANO) aMano++;
    }
  }
  /* El generador cubrió todos los casos (si no, la prueba no probaba nada). */
  assert.ok(llamadasConCobros > 100 && faltas > 20 && sinConciliar > 20 && conciliadas > 20 && aMano > 5 && variasVentas > 3,
    `cobertura: ${JSON.stringify({ llamadasConCobros, faltas, sinConciliar, conciliadas, aMano, variasVentas })}`);
});

test("lo que ofrece el menú de las dos columnas está completo: toda llamada cae en un valor listado, con color y con lugar en el orden", () => {
  for (let semilla = 1; semilla <= 20; semilla++) {
    const r = new Azar(semilla + 900);
    const m = mundoAzar(r, { sesiones: 80, ventas: 50, pagos: 120 });
    const filas = filasTabla(m, AHORA);
    for (const [clave, orden] of [["comprobante", ORDEN_COMPROBANTE], ["conciliado", ORDEN_CONCILIADO]] as const) {
      const ops = opcionesDeColumna(filas, {}, clave, orden);
      assert.equal(ops.reduce((s, o) => s + o.cuenta, 0), filas.length, conSemilla(semilla, `${clave}: una vez por llamada`));
      for (const o of ops) {
        assert.ok(orden.includes(o.valor), conSemilla(semilla, `${clave}: «${o.valor}» no está en el orden`));
        assert.ok(COLOR_COBROS[o.valor], conSemilla(semilla, `${clave}: «${o.valor}» sin color`));
      }
      /* Lo que hay que mirar primero va primero. */
      const posiciones = ops.map((o) => orden.indexOf(o.valor));
      assert.deepEqual(posiciones, [...posiciones].sort((a, b) => a - b), conSemilla(semilla, `${clave}: orden del menú`));
      for (const f of filas) assert.ok((COLUMNA[clave].orden!(f) as number) <= 4, "rango desconocido");
    }
  }
  assert.deepEqual([...new Set(ORDEN_COMPROBANTE)].length, ORDEN_COMPROBANTE.length);
  assert.deepEqual([...new Set(ORDEN_CONCILIADO)].length, ORDEN_CONCILIADO.length);
  for (const v of [...ORDEN_COMPROBANTE, ...ORDEN_CONCILIADO]) assert.ok(COLOR_COBROS[v], v);
});

test("valoresComprobante / valoresConciliado: un solo valor, el peor caso, para cualquier cuenta consistente (todas las combinaciones chicas)", () => {
  for (let total = 0; total <= 4; total++) for (let sinComp = 0; sinComp <= total; sinComp++) for (let conc = 0; conc <= total; conc++) for (let sinConc = 0; sinConc <= total - conc; sinConc++) {
    const c: Cuenta = { total, conPrueba: total - sinComp, sinComprobante: sinComp, conciliados: conc, sinConciliar: sinConc, aMano: total - conc - sinConc };
    const a = valoresComprobante(c), b = valoresConciliado(c);
    assert.equal(a.length, 1); assert.equal(b.length, 1);
    assert.equal(a[0], total === 0 ? SIN_COBROS : sinComp > 0 ? COMPROBANTE_FALTA : COMPROBANTE_SI);
    assert.equal(b[0], total === 0 ? SIN_COBROS : sinConc > 0 ? CONCILIADO_NO : conc > 0 ? CONCILIADO_SI : CONCILIADO_A_MANO);
  }
});

test("sumarCobros: la cuenta de varias ventas es la suma, vacía da ceros, no se pisa lo que se le pasa y conserva las invariantes", () => {
  assert.deepEqual(sumar6([]), CERO);
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = new Azar(semilla + 1100);
    const xs: Cuenta[] = Array.from({ length: r.int(6) }, () => {
      const total = r.int(5), sc = r.int(total + 1), co = r.int(total + 1), si = r.int(total - co + 1);
      return { total, conPrueba: total - sc, sinComprobante: sc, conciliados: co, sinConciliar: si, aMano: total - co - si };
    });
    const copia = JSON.parse(JSON.stringify(xs));
    const s = sumar6(xs);
    assert.deepEqual(xs, copia, conSemilla(semilla, "modificó lo que le pasaron"));
    for (const k of Object.keys(CERO) as (keyof Cuenta)[]) assert.equal(s[k], xs.reduce((a, x) => a + x[k], 0), conSemilla(semilla, k));
    assert.equal(s.total, s.conPrueba + s.sinComprobante); assert.equal(s.total, s.conciliados + s.sinConciliar + s.aMano);
    /* Mismo resultado en cualquier orden, y de a pares. */
    assert.deepEqual(sumar6(r.shuffle(xs)), s, conSemilla(semilla, "el orden importa"));
    if (xs.length > 1) assert.deepEqual(sumar6([sumar6(xs.slice(0, 1)), sumar6(xs.slice(1))]), s, conSemilla(semilla, "asociatividad"));
    /* El resultado es un objeto nuevo: cambiarlo no toca los de entrada. */
    if (xs.length) { const antes = xs[0].total; s.total += 99; assert.equal(xs[0].total, antes); }
  }
  /* Una sola venta: la misma cuenta, pero no el mismo objeto (la fila no comparte estado con la tabla de cobros). */
  const uno: Cuenta = { ...CERO, total: 2, conPrueba: 1, sinComprobante: 1, aMano: 2 };
  const s = sumar6([uno]);
  assert.deepEqual(s, uno); assert.notEqual(s, uno);
});

test("las filas de una llamada no comparten el objeto de cobros con otra: tocar uno no cambia a las demás", () => {
  const r = new Azar(4);
  const m = mundoAzar(r, { sesiones: 60, ventas: 50, pagos: 100 });
  const filas = filasTabla(m, AHORA).filter((f) => f.cobros);
  assert.ok(filas.length > 5);
  const objetos = new Set(filas.map((f) => f.cobros));
  assert.equal(objetos.size, filas.length, "dos llamadas comparten el mismo objeto de cobros");
  const antes = JSON.stringify(filasTabla(m, AHORA).map((f) => f.cobros));
  filas[0].cobros!.total = 12345;
  assert.equal(JSON.stringify(filasTabla(m, AHORA).map((f) => f.cobros)), antes, "tocar una fila cambió el estado de la app");
});

test("el filtro de la columna deja justo las llamadas que dice (Falta comprobante, Sin conciliar, Sin cobros, Sin venta…) y la suma da todas", () => {
  for (let semilla = 1; semilla <= 15; semilla++) {
    const r = new Azar(semilla + 1300);
    const m = mundoAzar(r, { sesiones: 70, ventas: 45, pagos: 110 });
    const filas = filasTabla(m, AHORA);
    for (const clave of ["comprobante", "conciliado"] as const) {
      const ops = opcionesDeColumna(filas, {}, clave);
      for (const { valor, cuenta } of ops) {
        const quedan = filas.filter((f) => COLUMNA[clave].valores(f)[0] === valor);
        assert.equal(quedan.length, cuenta, conSemilla(semilla, `${clave} = ${valor}`));
      }
    }
    /* Sin venta no es lo mismo que sin cobros: una llamada con venta y sin ningún cobro cargado dice «Sin cobros». */
    for (const f of filas) assert.equal(COLUMNA.comprobante.valores(f)[0] === SIN_VENTA, !f.fila.venta, conSemilla(semilla, f.id));
  }
});
