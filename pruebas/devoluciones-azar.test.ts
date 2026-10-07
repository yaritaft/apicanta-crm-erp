import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, liquidacionVacia } from "@/lib/honorarios";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import { calcularPyL, comisionesDelMes, cashCollected, pagosDelMes } from "@/lib/finanzas";
import { devolucionesDelMes, reversasDeComision } from "@/lib/devoluciones";
import { rangoDePeriodo } from "@/lib/periodos";
import type { Devolucion, EstadoApp, Liquidacion, Pago, ResultadoLiquidacion, Venta } from "@/lib/types";
import { concepto, devolucion, esquema, iso, miembro, NOVIEMBRE, OCTUBRE, pago, SEPTIEMBRE } from "./estado-devolucion";

/* ==================================================================
   200 escenarios al azar (siempre los mismos: el generador parte de una
   semilla) con ventas, cuotas heredadas, cobros con comisiones de la
   pasarela sin redondear y devoluciones totales, parciales, de más y
   «sin descontar al closer», con septiembre y octubre cerrándose a mitad
   de camino. Lo que tiene que pasar SIEMPRE:

   - cada renglón de la liquidación cierra exacto con su cuenta;
   - lo que la liquidación revierte es lo que Finanzas resta de las
     comisiones, devolución por devolución;
   - nunca se revierte más de lo comisionado;
   - quien tiene devoluciones nunca cobra en negativo: lo que sobra es una
     deuda que se descuenta del mes siguiente (si ya está cerrado);
   - septiembre no cambia por lo que se devuelve después.
   ================================================================== */

function azar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    entre: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    elige: <T,>(xs: readonly T[]): T => xs[Math.floor(siguiente() * xs.length)],
    si: (p = 0.5) => siguiente() < p,
    plata: (min: number, max: number) => Math.round((min + siguiente() * (max - min)) * 100) / 100,
  };
}

const MESES = [SEPTIEMBRE, OCTUBRE, NOVIEMBRE];
const r2 = (n: number) => Math.round(n * 100) / 100;

function escenario(semilla: number): EstadoApp {
  const r = azar(semilla);
  const tc = r.elige([0.1, 0.125, 0.15, 0.0725]);
  const td = r.elige([0.05, 0.03]);
  const equipo = [
    miembro("yari", "Yari", "ceo", 0, { sinComision: true }),
    miembro("c1", "Closer Uno", "closer", tc, r.si(0.2) ? { hasta: iso(OCTUBRE, 10).slice(0, 10) } : {}),
    miembro("c2", "Closer Dos", "closer", 0.1),
    miembro("dir", "Director", "director", td),
    miembro("ger", "Gerente", "otro"),
  ];
  const honorarios = [
    esquema("c1", [concepto({ id: "k", tipo: "porcentaje", nombre: "Comisión", tasa: tc, base: "cash-neto", alcance: "closer" })]),
    esquema("c2", [concepto({ id: "k", tipo: "porcentaje", nombre: "Comisión", tasa: 0.1, base: "cash-neto", alcance: "closer" })]),
    esquema("dir", [concepto({ id: "k", tipo: "porcentaje", nombre: "Comisión", tasa: td, base: "cash-neto", alcance: "director" })]),
    /* Un tramo y un porcentaje del negocio entero: miden el cash, así que netean las devoluciones. */
    esquema("ger", [
      concepto({ id: "t", tipo: "tramo", nombre: "Tramo", monto: 100, cada: r.elige([500, 1000, 2500]), base: "cash-neto", alcance: "todas" }),
      concepto({ id: "p", tipo: "porcentaje", nombre: "Porcentaje", tasa: 0.02, base: "cash", alcance: "todas" }),
    ]),
  ];
  const ventas: Venta[] = [];
  const cuotas: { id: string; ventaId: string; numero: number; monto: number; estado: string; esReserva: boolean; closerId?: string }[] = [];
  const pagos: Pago[] = [];
  const n = r.entre(3, 12);
  for (let i = 0; i < n; i++) {
    const mes = r.elige(MESES);
    ventas.push({
      id: `v${i}`, contactoNombre: `Cliente ${i}`, precioAcordado: r.plata(500, 6000), fecha: iso(mes, r.entre(1, 28)), moneda: "USD",
      productoId: "p_ment", closerId: r.elige(["yari", "c1", "c1", "c2", "c2"]), ...(r.si(0.7) ? { directorId: "dir" } : {}),
      excluidoMarketing: false, estado: r.si(0.08) ? "cancelada" : "activa", creadoEn: iso(mes, 1), extra: {},
    });
    const k = r.entre(1, 3);
    for (let j = 0; j < k; j++) {
      cuotas.push({ id: `c${i}_${j}`, ventaId: `v${i}`, numero: j + 1, monto: 100, estado: "pagada", esReserva: false, ...(r.si(0.12) ? { closerId: r.elige(["c1", "c2"]) } : {}) });
      if (r.si(0.9)) {
        const monto = r.plata(100, 2500);
        const fee = monto * r.elige([0.029, 0.045, 0.06]);
        pagos.push({ ...pago(`p${i}_${j}`, `c${i}_${j}`, monto, fee, iso(r.elige(MESES), r.entre(1, 28))), feeMonto: fee });
      }
    }
  }
  /* Devoluciones: de cualquier venta con cobros, totales, parciales o de más. */
  const devoluciones: Devolucion[] = [];
  const conCobros = ventas.filter((v) => pagos.some((p) => cuotas.find((c) => c.id === p.cuotaId)?.ventaId === v.id));
  const nd = conCobros.length ? r.entre(0, Math.min(5, conCobros.length)) : 0;
  for (let i = 0; i < nd; i++) {
    const v = r.elige(conCobros);
    const cobrado = pagos.filter((p) => cuotas.find((c) => c.id === p.cuotaId)?.ventaId === v.id).reduce((a, p) => a + p.monto, 0);
    devoluciones.push(devolucion({
      id: `d${i}`, ventaId: v.id, monto: r2(cobrado * r.elige([0.25, 0.5, 1, 1, 1.2])), fecha: iso(r.elige(MESES), r.entre(1, 28)),
      noDescontarAlCloser: r.si(0.2), estado: r.si(0.08) ? "propuesta" : "confirmada",
    }));
  }
  return {
    ajustes: { monedaBase: "USD", tipoCambio: 1500 }, equipo, honorarios, ventas, cuotas, pagos, devoluciones,
    gastos: [], sesiones: [], liquidaciones: [], productos: [{ id: "p_ment", nombre: "Mentoría" }],
    procesadores: [{ id: "proc_stripe", nombre: "Stripe", moneda: "USD" }],
  } as unknown as EstadoApp;
}

const cerrar = (e: EstadoApp, periodo: string): Liquidacion => {
  const base = liquidacionVacia(periodo, "2026-10-01T12:00:00.000Z");
  return { ...base, estado: "cerrada", resultado: JSON.parse(JSON.stringify(calcularLiquidacion(e, periodo, base))) as ResultadoLiquidacion };
};

test("200 escenarios al azar: la liquidación y Finanzas dicen lo mismo de las devoluciones, y todo cierra", () => {
  let renglones = 0, conDevolucion = 0, conDeuda = 0, conArrastre = 0, escenariosConDev = 0, netas = 0;
  for (let semilla = 1; semilla <= 200; semilla++) {
    const e0 = escenario(semilla);
    const donde = `semilla ${semilla}`;
    /* Septiembre se cierra con lo que se sabía entonces (lo devuelto en septiembre); octubre, a veces. */
    const aLaFecha = (hasta: string): EstadoApp => ({ ...e0, devoluciones: e0.devoluciones.filter((d) => d.fecha.slice(0, 7) <= hasta) }) as EstadoApp;
    const liquidaciones: Liquidacion[] = [cerrar(aLaFecha(SEPTIEMBRE), SEPTIEMBRE)];
    const e1 = { ...e0, liquidaciones } as EstadoApp;
    if (semilla % 2 === 0) liquidaciones.push(cerrar(e1, OCTUBRE));
    const e = { ...e0, liquidaciones } as EstadoApp;
    if (e.devoluciones.some((d) => d.estado === "confirmada")) escenariosConDev++;

    /* A. Cada renglón de cada mes cierra con su cuenta. */
    const porMes = new Map<string, ResultadoLiquidacion>();
    for (const periodo of MESES) {
      const liq = liquidaciones.find((l) => l.periodo === periodo);
      /* Un mes cerrado se mira con su foto; el abierto, calculado. */
      const res = liq?.resultado ?? calcularLiquidacion(e, periodo, undefined);
      porMes.set(periodo, res);
      for (const p of res.personas) {
        const suma: Record<string, number> = {};
        for (const l of p.lineas) {
          const donde2 = `${donde} · ${periodo} · ${p.nombre} · «${l.nombre}»`;
          assert.ok(l.desglose, donde2);
          const d = l.desglose;
          assert.deepEqual(evaluarPasos(d.pasos).fallas, [], donde2);
          assert.equal(resultadoDelDesglose(d), d.correccion ? d.correccion.cuentaDaba : l.monto, donde2);
          for (const x of d.pasos) assert.ok(Number.isFinite(x.valor), donde2);
          renglones++;
          if (l.tipo === "devolucion") conDevolucion++;
          if (l.tipo === "arrastre") conArrastre++;
          suma[l.moneda] = r2((suma[l.moneda] ?? 0) + l.monto);
        }
        /* G. El total de la persona es la suma de sus renglones. */
        for (const [mon, n] of Object.entries(suma)) assert.equal(r2(p.aPagar[mon as "USD"] ?? 0), n, `${donde} · ${periodo} · ${p.nombre}`);
        /* F. Con devoluciones nadie cobra en negativo: lo que sobra es deuda. */
        if (p.lineas.some((l) => l.tipo === "devolucion" || l.tipo === "arrastre")) {
          assert.ok((p.aPagar.USD ?? 0) >= -0.005, `${donde} · ${periodo} · ${p.nombre}: cobra en negativo`);
          if (p.deuda) conDeuda++;
        }
      }
    }

    /* B. Lo que la liquidación revierte es lo que Finanzas resta, devolución por devolución. */
    const enLiquidacion = new Map<string, number>();
    for (const res of porMes.values()) {
      for (const p of res.personas) for (const l of p.lineas) if (l.devolucionId) enLiquidacion.set(l.devolucionId, r2((enLiquidacion.get(l.devolucionId) ?? 0) + l.monto));
    }
    const enFinanzas = new Map<string, number>();
    for (const periodo of MESES) {
      for (const f of comisionesDelMes(e, rangoDePeriodo(periodo))) {
        if (f.devolucionId) enFinanzas.set(f.devolucionId, r2((enFinanzas.get(f.devolucionId) ?? 0) + f.comisionCloser + f.comisionDirector));
      }
    }
    for (const [id, monto] of enFinanzas) {
      /* Los dos salen de la misma cuenta (lib/devoluciones.ts): ni un centavo de diferencia. */
      assert.equal(enLiquidacion.get(id) ?? 0, monto, `${donde} · ${id}: la liquidación revierte ${enLiquidacion.get(id) ?? 0} y Finanzas ${monto}`);
    }
    for (const id of enLiquidacion.keys()) assert.ok(enFinanzas.has(id), `${donde} · ${id}: la liquidación la revierte y Finanzas no`);

    /* C. Nunca se revierte más de lo comisionado, ni de lo que quedaba. */
    for (const rv of reversasDeComision(e)) {
      for (const p of rv.partes) {
        assert.ok(p.reversa >= 0 && p.reversa <= Math.max(0, p.quedaba) + 0.005, `${donde} · ${rv.devolucion.id}: revierte ${p.reversa} de ${p.quedaba}`);
      }
      assert.ok(rv.devuelto <= rv.quedaba + 0.005 && rv.parte <= 1 + 1e-9 && rv.parte >= 0);
    }
    /* Entre todas las devoluciones de una venta, a cada persona no se le revierte más de lo que se le comisionó
       (lo comisionado crece con cada cobro: vale el máximo de lo que dice cada devolución). */
    const porVenta = new Map<string, { revertido: number; comisionado: number }>();
    for (const rv of reversasDeComision(e)) for (const p of rv.partes) {
      const k = `${rv.venta.id}:${p.rol}:${p.miembroId}`;
      const x = porVenta.get(k) ?? { revertido: 0, comisionado: 0 };
      porVenta.set(k, { revertido: r2(x.revertido + p.reversa), comisionado: Math.max(x.comisionado, p.comision) });
    }
    for (const [k, x] of porVenta) assert.ok(x.revertido <= x.comisionado + 0.05, `${donde} · ${k}: se revierte ${x.revertido} y se comisionó ${x.comisionado}`);

    /* D. El Cash Collected es lo que entró menos lo devuelto, y la utilidad bruta cierra. */
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const p = calcularPyL(e, m);
      const entro = pagosDelMes(e, m).reduce((a, x) => a + x.monto, 0);
      const devuelto = devolucionesDelMes(e, m).reduce((a, x) => a + x.monto, 0);
      assert.ok(Math.abs(p.cashCollected - (entro - devuelto)) < 1e-6, `${donde} · ${periodo}`);
      assert.equal(p.cashCollected, cashCollected(e, m));
      assert.ok(Math.abs(p.brutoCC - (p.cashCollected - p.totalDirectos)) < 1e-6);
      assert.ok(Math.abs(p.brutoRev - (p.revenue - p.devoluciones - p.totalDirectos)) < 1e-6);
      if (devuelto > 0) netas++;
    }

    /* H. Septiembre no cambia por lo que se devuelve después. */
    const sinTardias = { ...e0, devoluciones: e0.devoluciones.filter((d) => d.fecha.slice(0, 7) <= SEPTIEMBRE) } as EstadoApp;
    assert.deepEqual(calcularPyL(e0, rangoDePeriodo(SEPTIEMBRE)), calcularPyL(sinTardias, rangoDePeriodo(SEPTIEMBRE)), donde);

    /* E. La deuda de un mes cerrado es un renglón del mes que sigue (si ese mes está abierto). */
    for (const l of liquidaciones) {
      const siguiente = l.periodo === SEPTIEMBRE ? OCTUBRE : NOVIEMBRE;
      if (liquidaciones.some((x) => x.periodo === siguiente)) continue;
      const sigRes = calcularLiquidacion(e, siguiente, undefined);
      for (const p of l.resultado!.personas) {
        for (const [mon, deuda] of Object.entries(p.deuda ?? {})) {
          const x = sigRes.personas.find((q) => q.miembroId === p.miembroId);
          const entra = x?.lineas.find((y) => y.clave === `arrastre-entra:${l.periodo}:${mon}`);
          assert.ok(entra, `${donde} · ${p.nombre}: la deuda de ${l.periodo} no pasó a ${siguiente}`);
          assert.equal(entra.monto, -deuda);
        }
      }
    }
  }
  /* Que el azar haya tocado de todo: si esto falla, el generador dejó de estresar algo. */
  assert.ok(renglones > 1000, `renglones ${renglones}`);
  assert.ok(escenariosConDev > 120, `escenarios con devoluciones ${escenariosConDev}`);
  assert.ok(conDevolucion > 100, `líneas de devolución ${conDevolucion}`);
  assert.ok(conDeuda > 5, `con deuda ${conDeuda}`);
  assert.ok(conArrastre > 10, `con arrastre ${conArrastre}`);
  assert.ok(netas > 100, `meses con plata devuelta ${netas}`);
  console.log(`  (renglones ${renglones}, de devolución ${conDevolucion}, de deuda ${conArrastre}, personas con deuda ${conDeuda}, meses con devoluciones ${netas})`);
});
