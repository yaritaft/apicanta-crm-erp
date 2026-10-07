import test from "node:test";
import assert from "node:assert/strict";
import { descuentoDesde, diaSinCierreDe, hoyDeNegocio, reglaDeCierre, strikesDe, ventasSinCierre } from "@/lib/cierre-del-dia";
import { calcularPyL, comisionesDelMes, comisionesPorCloser } from "@/lib/finanzas";
import { calcularLiquidacion, liquidacionVacia, rangoDePeriodo } from "@/lib/honorarios";
import { reversasDeComision } from "@/lib/devoluciones";
import { metricasDeWebinar } from "@/lib/webinar";
import { armarEstadoResultados, esBloque, type NodoPyL } from "@/lib/estadoResultados";
import type { ConfigCierreDelDia, EstadoApp, ID, Sesion } from "@/lib/types";
import { conPeso, diaAR, enAR, oraculoDeStrikes, porSemillas, type Azar } from "./azar";
import { MESES, PRENDIDO, escenario } from "./escenario-cierre";

/* ==================================================================
   Propiedad 2: con el interruptor APAGADO nada se descuenta nunca; con el
   interruptor prendido el descuento es exactamente la comisión del closer
   sobre las ventas de un día sin cierre, y aparece como renglón «Descuento
   por cierre del día» que cierra con Finanzas.

   El oráculo de qué ventas no se comisionan está en azar.ts, aparte del
   código de la app. El escenario (escenario-cierre.ts) mezcla cuotas
   heredadas, closers que se van, % por servicio, devoluciones, comisiones
   sobre cash bruto, cobros de tres meses y ventas de llamadas de otro closer.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;
const rangos = MESES.map((m) => rangoDePeriodo(m));
const HOY = hoyDeNegocio();

const APAGADOS: [string, ConfigCierreDelDia | undefined][] = [
  ["sin configurar", undefined],
  ["solo la fecha de arranque", { cuentaDesde: "2026-08-20" }],
  ["apagado explícito", { cuentaDesde: "2026-08-20", descuenta: false, descuentaDesde: "2026-08-20" }],
  ["prendido sin fecha de arranque", { descuenta: true } as ConfigCierreDelDia],
  ["prendido pero con arranque en el futuro", { cuentaDesde: "2099-01-01", descuenta: true }],
  ["rige desde un día que todavía no llegó", { cuentaDesde: "2026-08-20", descuenta: true, descuentaDesde: "2099-01-01" }],
  ["«true» como texto no es prendido", { cuentaDesde: "2026-08-20", descuenta: "true" as unknown as boolean }],
  ["1 no es prendido", { cuentaDesde: "2026-08-20", descuenta: 1 as unknown as boolean }],
  ["fecha de arranque mal escrita", { cuentaDesde: "20/08/2026", descuenta: true }],
];

function fotos(e: EstadoApp) {
  const liq = MESES.map((p) => {
    const { calculadoEn: _q, ...resto } = calcularLiquidacion(e, p, liquidacionVacia(p, "2026-10-01T12:00:00.000Z"));
    void _q;
    return resto;
  });
  return {
    comisiones: rangos.map((m) => comisionesDelMes(e, m)),
    pyl: rangos.map((m) => calcularPyL(e, m)),
    porCloser: rangos.map((m) => comisionesPorCloser(e, m)),
    liquidacion: liq,
    webinars: e.webinars.map((w) => metricasDeWebinar(e, w)),
    reversas: reversasDeComision(e),
    sinCierre: [...ventasSinCierre(e)],
  };
}

const conCierre = (e: EstadoApp, cierre: ConfigCierreDelDia | undefined): EstadoApp =>
  ({ ...e, ajustes: { ...e.ajustes, crm: cierre ? { cierreDelDia: cierre } : undefined } }) as EstadoApp;

/* El conjunto de ventas sin cierre, según el oráculo. */
function sinCierreOraculo(e: EstadoApp): Set<ID> {
  const regla = reglaDeCierre(e.ajustes);
  const out = new Set<ID>();
  if (!regla.descuenta || !regla.cuentaDesde) return out;
  const desde = regla.descuentaDesde && regla.descuentaDesde > regla.cuentaDesde ? regla.descuentaDesde : regla.cuentaDesde;
  const hoy = diaAR(new Date().toISOString());
  const orac = oraculoDeStrikes(e, (s: Sesion) => (s.anfitrion ?? "").trim(), () => true, regla.cuentaDesde, hoy);
  const porId = new Map(e.sesiones.map((s) => [s.id, s]));
  for (const v of e.ventas) {
    if (!v.sesionId || v.estado === "cancelada") continue;
    const s = porId.get(v.sesionId);
    if (!s) continue;
    const d = diaAR(s.inicia);
    if (d < desde) continue;
    const x = orac.get((s.anfitrion ?? "").trim())?.get(d);
    if (x && conPeso(x)) out.add(v.id);
  }
  return out;
}

test("el reloj de la prueba: los días del escenario ya pasaron, así el resultado no depende del día en que se corre", () => {
  assert.ok(HOY >= "2026-09-26", `hoy es ${HOY}: el generador pone llamadas hasta el 25/09`);
});

test("APAGADO: Finanzas, la liquidación, el webinar y las devoluciones dan EXACTAMENTE lo mismo que sin configuración (30 semillas × 9 apagados)", () => {
  porSemillas(30, 1, (r, semilla) => {
    const e = escenario(r);
    const base = fotos(conCierre(e, undefined));
    assert.deepEqual(base.sinCierre, []);
    for (const [nombre, cfg] of APAGADOS) {
      const x = conCierre(e, cfg);
      assert.equal(ventasSinCierre(x).size, 0, `${nombre}: nada se descuenta`);
      /* Con el interruptor apagado o sin fecha de arranque no hay fecha de descuento (un arranque en el futuro sí la tiene, y no encuentra nada). */
      if (!reglaDeCierre(x.ajustes).descuenta || !reglaDeCierre(x.ajustes).cuentaDesde) assert.equal(descuentoDesde(reglaDeCierre(x.ajustes)), undefined, nombre);
      assert.deepEqual(fotos(x), base, `${nombre} (semilla ${semilla})`);
      /* Ningún renglón, ningún campo. */
      for (const mes of base.comisiones) for (const c of mes) assert.equal(c.descuentoCierre, undefined);
    }
    for (const p of base.liquidacion) for (const per of p.personas) for (const l of per.lineas) assert.notEqual(l.tipo, "descuento", `renglón de descuento con el interruptor apagado: ${per.nombre}`);
  });
});

test("PRENDIDO: las ventas sin cierre son las que dice el oráculo (con y sin fecha «rige desde», 150 semillas)", () => {
  let total = 0, conVentas = 0;
  porSemillas(150, 500, (r) => {
    const desde = r.elige([undefined, "2026-08-25", "2026-09-05", "2026-09-15"]);
    const arranque = r.elige(["2026-08-20", "2026-08-28", "2026-09-10"]);
    const e = conCierre(escenario(r), { cuentaDesde: arranque, descuenta: true, ...(desde ? { descuentaDesde: desde } : {}) });
    const got = ventasSinCierre(e);
    const esperado = sinCierreOraculo(e);
    assert.deepEqual([...got].sort(), [...esperado].sort());
    total += got.size;
    if (got.size > 0) conVentas++;
    /* Idempotente y con copias nuevas. */
    assert.deepEqual([...ventasSinCierre(e)].sort(), [...got].sort());
    assert.deepEqual([...ventasSinCierre(structuredClone(e))].sort(), [...got].sort());
  });
  assert.ok(total > 300 && conVentas > 80, `el generador tiene que producir ventas sin cierre: ${total} en ${conVentas} escenarios`);
});

test("PRENDIDO: lo que se descuenta es exactamente la comisión del closer de esas ventas, y nada más (Finanzas, fila por fila, 150 semillas)", () => {
  let descontadas = 0, heredadasSinTocar = 0;
  porSemillas(150, 900, (r) => {
    const base = escenario(r);
    const off = conCierre(base, undefined), on = conCierre(base, PRENDIDO);
    const sin = sinCierreOraculo(on);
    for (const m of rangos) {
      /* Las filas de devolución se prueban aparte: con el descuento, la del closer que no cobró esa venta desaparece (no hay nada que revertirle). */
      const a = comisionesDelMes(off, m).filter((c) => !c.devolucionId), b = comisionesDelMes(on, m).filter((c) => !c.devolucionId);
      assert.equal(a.length, b.length, "las mismas filas");
      for (let i = 0; i < a.length; i++) {
        const x = a[i], y = b[i];
        assert.equal(x.id, y.id);
        const descuenta = sin.has(x.ventaId) && !x.devolucionId && Boolean(x.closerId) && x.closerId === base.ventas.find((v) => v.id === x.ventaId)?.closerId;
        /* Lo que no es del closer no cambia nunca. */
        assert.equal(y.comisionDirector, x.comisionDirector);
        assert.equal(y.netoProcesador, x.netoProcesador);
        assert.equal(y.cobradoEnMes, x.cobradoEnMes);
        assert.equal(y.tasaCloser, x.tasaCloser);
        if (x.devolucionId) continue;           // las devoluciones se prueban aparte
        if (descuenta && x.comisionCloser > 0) {
          descontadas++;
          assert.equal(y.comisionCloser, 0, `la fila ${x.id} debería quedar en 0`);
          assert.equal(y.descuentoCierre, x.comisionCloser, "el descuento es exactamente lo que se habría pagado");
        } else {
          assert.equal(y.comisionCloser, x.comisionCloser, `la fila ${x.id} no es de un día sin cierre`);
          assert.equal(y.descuentoCierre, undefined);
          if (sin.has(x.ventaId) && x.heredadaDe) heredadasSinTocar++;
        }
        assert.ok(y.comisionCloser >= 0 && (y.descuentoCierre ?? 0) >= 0);
      }
    }
  });
  assert.ok(descontadas > 200, `filas descontadas: ${descontadas}`);
  assert.ok(heredadasSinTocar > 5, `cuotas heredadas de ventas sin cierre que no se tocan: ${heredadasSinTocar}`);
});

test("PRENDIDO + devoluciones: de una venta sin cierre no se le revierte al closer lo que no se le pagó; el neto de su comisión nunca es negativo (120 semillas)", () => {
  let reversas = 0, sinPagar = 0;
  porSemillas(120, 1300, (r) => {
    const base = escenario(r, undefined, { devoluciones: true });
    const on = conCierre(base, PRENDIDO), off = conCierre(base, undefined);
    const sin = sinCierreOraculo(on);
    const ra = reversasDeComision(off), rb = reversasDeComision(on);
    assert.equal(ra.length, rb.length);
    for (let i = 0; i < ra.length; i++) {
      reversas++;
      ra[i].partes.forEach((p, k) => {
        const q = rb[i].partes[k];
        const venta = base.ventas.find((v) => v.id === ra[i].venta.id)!;
        const nopaga = p.rol === "closer" && sin.has(venta.id) && Boolean(p.miembroId) && p.miembroId === venta.closerId && !p.heredadaDe;
        if (nopaga) { sinPagar++; assert.equal(q.reversa, 0); assert.equal(q.comision, 0); }
        else assert.equal(q.reversa, p.reversa);
      });
    }
    /* Neto por venta y por closer, sumando todos los meses con sus reversas: nunca negativo. */
    const neto = new Map<string, number>();
    for (const m of rangos) for (const c of comisionesDelMes(on, m)) {
      const k = `${c.ventaId}|${c.closerId ?? ""}`;
      neto.set(k, (neto.get(k) ?? 0) + c.comisionCloser);
    }
    for (const [k, v] of neto) assert.ok(v > -0.011, `${k}: neto de comisión ${v}`);
    /* Una venta sin cierre deja 0 neto al closer que la cerró, con o sin devolución. */
    for (const venta of base.ventas) {
      if (!sin.has(venta.id) || !venta.closerId) continue;
      const v = neto.get(`${venta.id}|${venta.closerId}`);
      if (v !== undefined) assert.ok(Math.abs(v) < 0.011, `${venta.id}: debería quedar en 0 y quedó en ${v}`);
    }
  });
  assert.ok(reversas > 50 && sinPagar > 5, `reversas ${reversas}, sin pagar ${sinPagar}`);
});

test("PRENDIDO: el Estado de Resultados baja la comisión de closers exactamente en lo descontado (sin devoluciones) y el director no cambia (120 semillas)", () => {
  porSemillas(120, 1700, (r) => {
    const base = escenario(r, undefined, { devoluciones: false });
    const off = conCierre(base, undefined), on = conCierre(base, PRENDIDO);
    for (const m of rangos) {
      const a = calcularPyL(off, m), b = calcularPyL(on, m);
      const descuento = comisionesDelMes(on, m).reduce((x, c) => x + (c.descuentoCierre ?? 0), 0);
      assert.ok(Math.abs(a.comisionCloser - b.comisionCloser - descuento) < 1e-6, `${m.clave}: ${a.comisionCloser} - ${b.comisionCloser} ≠ ${descuento}`);
      assert.equal(b.comisionDirector, a.comisionDirector);
      assert.ok(Math.abs((b.operativoCC - a.operativoCC) - descuento) < 1e-6, "lo que no se paga de comisión es profit");
    }
  });
});

test("PRENDIDO: el renglón «Descuento por cierre del día» cierra con Finanzas, closer por closer (100 semillas, sin devoluciones, % por servicio incluido)", () => {
  let renglones = 0, personasConDescuento = 0;
  porSemillas(100, 2100, (r) => {
    const base = escenario(r, undefined, { devoluciones: false, heredadas: true, tasasPorServicio: true, salidas: true, bases: "neto" });
    const on = conCierre(base, PRENDIDO);
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const liq = calcularLiquidacion(on, periodo, liquidacionVacia(periodo, "2026-10-01T12:00:00.000Z"));
      const enFinanzas = comisionesPorCloser(on, m);
      const descFinanzas = new Map<string, number>();
      for (const c of comisionesDelMes(on, m)) if (c.closerId) descFinanzas.set(c.closerId, (descFinanzas.get(c.closerId) ?? 0) + (c.descuentoCierre ?? 0));
      for (const closer of ["c1", "c2", "c3"]) {
        const persona = liq.personas.find((p) => p.miembroId === closer);
        const miembro = on.equipo.find((x) => x.id === closer)!;
        if (!persona) {
          /* Sólo puede faltar quien ya no está y no deja nada en el mes (comisión y descuento se anulan): no hay nada que pagarle. */
          assert.ok(!miembro.activo || on.honorarios.every((h) => h.miembroId !== closer), `${periodo} ${closer} falta en la liquidación`);
          assert.ok(Math.abs(enFinanzas.find((c) => c.closerId === closer)?.total ?? 0) < 0.011, `${periodo} ${closer}: no sale en la liquidación pero Finanzas le paga`);
          continue;
        }
        const lineasF = (persona?.lineas ?? []).filter((l) => l.enFinanzas && l.tipo !== "devolucion" && l.tipo !== "arrastre");
        const sumaLiq = lineasF.reduce((a, l) => a + l.montoBase, 0);
        const deFinanzas = enFinanzas.find((c) => c.closerId === closer)?.total ?? 0;
        assert.ok(Math.abs(sumaLiq - deFinanzas) < 0.03, `${periodo} ${closer}: la liquidación suma ${r2(sumaLiq)} y Finanzas ${r2(deFinanzas)}`);
        const desc = (persona?.lineas ?? []).filter((l) => l.tipo === "descuento");
        const totalDesc = desc.reduce((a, l) => a - l.montoBase, 0);
        const esperado = descFinanzas.get(closer) ?? 0;
        assert.ok(Math.abs(totalDesc - esperado) < 0.03, `${periodo} ${closer}: renglón de descuento ${r2(totalDesc)} y Finanzas ${r2(esperado)}`);
        for (const l of desc) {
          renglones++;
          assert.ok(l.monto < 0 && l.nombre === "Descuento por cierre del día" && l.variable && l.clave.startsWith("cierre:"), JSON.stringify(l.clave));
          assert.equal(l.enFinanzas, true, "Finanzas ya lo descuenta: al cerrar no se carga de nuevo");
        }
        if (desc.length) personasConDescuento++;
        /* Si Finanzas descontó algo, hay renglón; si no, no hay. */
        assert.equal(desc.length > 0, esperado >= 0.005 || totalDesc >= 0.005, `${periodo} ${closer}: renglón sí/no`);
      }
      /* Nadie más tiene renglón de descuento. */
      for (const p of liq.personas) if (!["c1", "c2", "c3"].includes(p.miembroId)) assert.ok(p.lineas.every((l) => l.tipo !== "descuento"), p.nombre);
    }
  });
  assert.ok(renglones > 100 && personasConDescuento > 100, `renglones ${renglones}, personas ${personasConDescuento}`);
});

test("PRENDIDO: el resultado del webinar resta lo mismo que Finanzas (todas las fechas, con devoluciones, 100 semillas)", () => {
  porSemillas(100, 2700, (r) => {
    const base = escenario(r);
    for (const cfg of [undefined, PRENDIDO]) {
      const e = conCierre(base, cfg);
      for (const w of e.webinars) {
        const ids = new Set(e.ventas.filter((v) => v.webinarId === w.id && v.estado !== "cancelada").map((v) => v.id));
        const deFinanzas = rangos.flatMap((m) => comisionesDelMes(e, m)).filter((c) => ids.has(c.ventaId)).reduce((a, c) => a + c.comisionCloser + c.comisionDirector, 0);
        const deWebinar = metricasDeWebinar(e, w).comisiones;
        assert.ok(Math.abs(deWebinar - deFinanzas) < 0.011, `${w.id} ${cfg ? "prendido" : "apagado"}: webinar ${r2(deWebinar)} y Finanzas ${r2(deFinanzas)}`);
      }
    }
  });
});

test("el interruptor es del closer: si el cobro lo heredó otro closer, ese closer cobra entero, aunque la venta sea de un día sin cierre", () => {
  let vistas = 0;
  porSemillas(150, 3300, (r) => {
    const base = escenario(r, undefined, { devoluciones: false, heredadas: true });
    const on = conCierre(base, PRENDIDO);
    const sin = sinCierreOraculo(on);
    const off = conCierre(base, undefined);
    for (const m of rangos) {
      const a = new Map(comisionesDelMes(off, m).map((c) => [c.id, c])), b = comisionesDelMes(on, m);
      for (const c of b) {
        if (!c.heredadaDe || !sin.has(c.ventaId)) continue;
        vistas++;
        assert.equal(c.comisionCloser, a.get(c.id)!.comisionCloser, `${c.id}: heredada por ${c.closerNombre}`);
        assert.equal(c.descuentoCierre, undefined);
      }
    }
  });
  assert.ok(vistas > 10, `heredadas de ventas sin cierre: ${vistas}`);
});

test("PRENDIDO, comisión sobre el cash bruto (no es de Finanzas): la comisión y su renglón de descuento suman lo cobrado en días con cierre × el % (100 semillas)", () => {
  let conBruto = 0, conRenglon = 0;
  porSemillas(100, 3900, (r) => {
    const base = escenario(r, undefined, { devoluciones: false, heredadas: true, tasasPorServicio: false, salidas: true, bases: "mezcla" });
    const on = conCierre(base, PRENDIDO);
    const sin = sinCierreOraculo(on);
    const cuotaPorId = new Map(on.cuotas.map((c) => [c.id, c]));
    const ventaPorId = new Map(on.ventas.map((v) => [v.id, v]));
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const liq = calcularLiquidacion(on, periodo, liquidacionVacia(periodo, "2026-10-01T12:00:00.000Z"));
      for (const closer of ["c1", "c2", "c3"]) {
        const miembro = on.equipo.find((x) => x.id === closer)!;
        const concepto = on.honorarios.find((h) => h.miembroId === closer)?.conceptos.find((c) => c.id === "com");
        const persona = liq.personas.find((p) => p.miembroId === closer);
        if (concepto?.base !== "cash" || !persona) continue;
        conBruto++;
        let suma = 0;
        for (const p of on.pagos) {
          const t = new Date(p.fecha).getTime();
          if (t < m.desde.getTime() || t > m.hasta.getTime()) continue;
          const cuota = cuotaPorId.get(p.cuotaId), v = cuota && ventaPorId.get(cuota.ventaId);
          if (!cuota || !v || v.estado === "cancelada") continue;
          const k = cuota.closerId || v.closerId;
          if (k !== closer) continue;
          if (v.closerId && on.equipo.find((x) => x.id === v.closerId)?.sinComision) continue;
          if (miembro.hasta && new Date(p.fecha).getTime() - 3 * 3600000 >= new Date(`${miembro.hasta}T00:00:00Z`).getTime() + 86400000) continue;
          if (sin.has(v.id) && k === v.closerId) continue;
          suma += p.monto;
        }
        const lineas = persona.lineas.filter((l) => l.conceptoId === "com" || l.clave === "cierre:com");
        const neto = lineas.reduce((a, l) => a + l.monto, 0);
        if (lineas.some((l) => l.tipo === "descuento")) conRenglon++;
        assert.ok(Math.abs(neto - suma * (concepto.tasa ?? 0)) < 0.03, `${periodo} ${closer}: la liquidación deja ${r2(neto)} y debería dejar ${r2(suma * (concepto.tasa ?? 0))}`);
        for (const l of lineas) assert.equal(l.enFinanzas, false, "una comisión sobre el cash bruto no es de Finanzas: se carga como gasto al cerrar");
      }
    }
  });
  assert.ok(conBruto > 30 && conRenglon > 5, `comisiones sobre el bruto ${conBruto}, con renglón de descuento ${conRenglon}`);
});

test("el generador toca de todo: % por servicio con renglón propio, cuotas heredadas, salidas, devoluciones (si falla, dejó de estresar algo)", () => {
  let porServicio = 0, conSalida = 0, conDevolucion = 0, conWebinar = 0, sinEsquema = 0;
  porSemillas(100, 2100, (r) => {
    const base = conCierre(escenario(r, undefined, { devoluciones: true }), PRENDIDO);
    if (base.equipo.some((m) => m.hasta)) conSalida++;
    if ((base.devoluciones ?? []).length > 0) conDevolucion++;
    if (base.ventas.some((v) => v.webinarId)) conWebinar++;
    if (base.equipo.some((m) => m.rol === "closer" && !base.honorarios.some((h) => h.miembroId === m.id))) sinEsquema++;
    const liq = calcularLiquidacion(base, "2026-09", liquidacionVacia("2026-09", "2026-10-01T12:00:00.000Z"));
    if (liq.personas.some((p) => p.lineas.some((l) => l.clave === "cierre:com_pa"))) porServicio++;
  });
  assert.ok(porServicio > 3 && conSalida > 30 && conDevolucion > 50 && conWebinar > 90 && sinEsquema > 10, `${porServicio} ${conSalida} ${conDevolucion} ${conWebinar} ${sinEsquema}`);
});

/* ---------- Quién cobra y de quién es el día ---------- */

/* BUG (a confirmar con Yari/Angelo: es una decisión de diseño que no está escrita): el día con strike es el del closer que
   ATIENDE la llamada (su anfitrión, `closerDe`), pero el descuento se le saca al closer de la VENTA (`v.closerId`). Si las dos
   personas son distintas, uno paga el día malo del otro. Pasa en la práctica porque lib/pasar-llamadas.ts deja la venta ya
   cargada «con quien la atendió» y mueve el anfitrión: pasar una llamada de Mariano a Dante (que tiene otra llamada sin
   cargar ese día) le saca a Mariano la comisión de una venta cuyo cierre cargó a tiempo; y al revés, pasar la llamada de un
   día con strike de Mariano a Dante le devuelve la comisión que habría perdido. */
test("BUG: el descuento de una venta depende del día de quien la comisiona: pasar la llamada a otro closer no se lo saca ni se lo devuelve", { todo: true }, () => {
  const base = escenario(crearAzarFijo(1), undefined, { devoluciones: false, heredadas: false, salidas: false });
  const dia = "2026-09-10";
  const ll = (id: string, host: string, extra = {}) => ({
    id, titulo: "t", tipo: "Llamada de Asesoramiento - Webinar - Team", invitado: id, inicia: enAR(dia, 15), duracionMin: 45, estado: "hecha", origen: "calendly",
    creadoEn: enAR(dia, 9), extra: {}, anfitrion: host, ...extra,
  }) as Sesion;
  const venta = { id: "vx", contactoNombre: "X", precioAcordado: 1000, moneda: "USD", fecha: enAR(dia, 16), excluidoMarketing: false, estado: "activa", creadoEn: enAR(dia, 16), extra: {}, productoId: "pa", closerId: "c1", sesionId: "x" };
  const e = {
    ...base, ventas: [venta], cuotas: [{ id: "cx", ventaId: "vx", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [{ id: "px", cuotaId: "cx", monto: 1000, feeMonto: 0, fecha: "2026-09-12T12:00:00.000Z", procesadorId: "s", moneda: "USD", feeRate: 0, creadoEn: "2026-09-12T12:00:00.000Z" }],
    /* X: la llamada de Closer Uno, cargada a tiempo. Y: otra llamada de Closer Dos ese día, sin cargar. */
    sesiones: [ll("x", "Closer Uno", { estadoLlamada: "Compra Full", estadoLlamadaEn: enAR(dia, 20) }), ll("y", "Closer Dos")],
    ajustes: { ...base.ajustes, crm: { cierreDelDia: { cuentaDesde: "2026-09-01", descuenta: true, descuentaDesde: "2026-09-01" } } },
  } as unknown as EstadoApp;
  assert.equal(ventasSinCierre(e).size, 0, "Closer Uno cerró su día a tiempo: se le paga");
  /* El director le pasa la llamada a Closer Dos (la venta se queda con Closer Uno). */
  const pasada = { ...e, sesiones: e.sesiones.map((s) => (s.id === "x" ? { ...s, anfitrion: "Closer Dos" } : s)) } as EstadoApp;
  assert.equal(ventasSinCierre(pasada).size, 0, "Closer Uno no tiene ningún día con strike: no se le tendría que sacar la comisión por el día malo de Closer Dos");
});

function crearAzarFijo(semilla: number): Azar {
  let res!: Azar;
  porSemillas(1, semilla, (r) => { res = r; });
  return res;
}

/* BUG: el Estado de Resultados (Finanzas → Estado de resultados, lib/estadoResultados.ts) arma la fila de cada venta con
   «15% de US$ 1.455 neto de procesador», pero cuando la comisión se descontó por el cierre del día el monto de la fila es 0 y
   el renglón no dice por qué (la página «Comisiones» sí lo dice, con «−X por cierre del día»). La cuenta que muestra no da el
   número que muestra al lado. */
test("BUG: la fila del Estado de Resultados de una venta sin cierre dice por qué su comisión es cero", () => {
  const base = escenario(crearAzarFijo(1), undefined, { devoluciones: false, heredadas: false, salidas: false });
  const dia = "2026-09-10";
  const ll = (id: string, host: string, extra = {}) => ({
    id, titulo: "t", tipo: "Llamada de Asesoramiento - Webinar - Team", invitado: id, inicia: enAR(dia, 15), duracionMin: 45, estado: "hecha", origen: "calendly",
    creadoEn: enAR(dia, 9), extra: {}, anfitrion: host, ...extra,
  }) as Sesion;
  const e = {
    ...base,
    /* La venta se cargó dos días después de la llamada, y la llamada nunca tuvo estado: día con strike. */
    ventas: [{ id: "vx", contactoNombre: "X", precioAcordado: 1000, moneda: "USD", fecha: enAR(dia, 16), excluidoMarketing: false, estado: "activa", creadoEn: enAR("2026-09-12", 11), extra: {}, productoId: "pa", closerId: "c1", sesionId: "x" }],
    cuotas: [{ id: "cx", ventaId: "vx", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [{ id: "px", cuotaId: "cx", monto: 1000, feeMonto: 0, fecha: "2026-09-12T12:00:00.000Z", procesadorId: "s", moneda: "USD", feeRate: 0, creadoEn: "2026-09-12T12:00:00.000Z" }],
    sesiones: [ll("x", "Closer Uno")],
    ajustes: { ...base.ajustes, crm: { cierreDelDia: { cuentaDesde: "2026-09-01", descuenta: true, descuentaDesde: "2026-09-01" } } },
  } as unknown as EstadoApp;
  const mes = rangoDePeriodo("2026-09");
  const fila = comisionesDelMes(e, mes).find((c) => c.ventaId === "vx")!;
  assert.equal(fila.comisionCloser, 0);
  assert.ok((fila.descuentoCierre ?? 0) > 0, "la venta es de un día sin cierre");
  const arbol = armarEstadoResultados(e, mes, calcularPyL(e, mes), (n, d = 0) => n.toFixed(d), () => "#");
  const nodos = arbol.filter((x): x is NodoPyL => !esBloque(x));
  const closers = nodos.find((n) => n.id === "closers")!;
  const hoja = closers.hijos!.flatMap((g) => g.hijos ?? []).find((n) => n.id.endsWith(`v:${fila.id}`))!;
  assert.equal(hoja.cc, -0);
  assert.match(hoja.sub ?? "", /cierre/i, `la fila dice «${hoja.sub}» y vale 0: tendría que decir que se descontó por el cierre del día`);
});

test("las tres lecturas de «día sin cierre» coinciden: ventasSinCierre, diaSinCierreDe y los strikes que se le muestran al closer (150 semillas)", () => {
  let cruces = 0;
  porSemillas(150, 4700, (r) => {
    const arranque = r.elige(["2026-08-20", "2026-08-28", "2026-09-10"]);
    const e = conCierre(escenario(r), { cuentaDesde: arranque, descuenta: true, descuentaDesde: r.elige([arranque, "2026-09-05"]) });
    const hoy = diaAR(new Date().toISOString());
    const regla = reglaDeCierre(e.ajustes);
    const desde = descuentoDesde(regla)!;
    const sin = ventasSinCierre(e);
    const porId = new Map(e.sesiones.map((s) => [s.id, s]));
    for (const v of e.ventas) {
      const s = v.sesionId ? porId.get(v.sesionId) : undefined;
      if (!s) { assert.equal(diaSinCierreDe(e, v), undefined, "sin llamada no hay día"); continue; }
      const dia = diaAR(s.inicia);
      const key = (s.anfitrion ?? "").trim();
      const strikes = strikesDe(e, key, hoy);
      const diaConStrike = strikes.dias.some((d) => d.dia === dia);
      /* El día sin cierre de la venta es el del strike de quien la atendió. */
      assert.equal(diaSinCierreDe(e, v) !== undefined, diaConStrike, `${v.id}: día ${dia} de ${key}`);
      if (diaConStrike) assert.equal(diaSinCierreDe(e, v), dia);
      /* Y se descuenta si ese día es de los que rigen y la venta sigue en pie. */
      assert.equal(sin.has(v.id), diaConStrike && dia >= desde && v.estado !== "cancelada", `${v.id}`);
      cruces++;
    }
  });
  assert.ok(cruces > 1000, `ventas cruzadas ${cruces}`);
});
