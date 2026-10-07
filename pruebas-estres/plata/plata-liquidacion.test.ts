import { azar, art, cerca, clonar, congelar, devolucion, donde, gasto, liquidacionCerradaCon, miembro, mundo, pago, r2, sinCalculadoEn, type Azar } from "./plata-mundo";
import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularLiquidacion, conExtraEnMes, diferenciasDesdeElCierre, gastosDeLiquidacion, liquidacionCsv, liquidacionVacia, sinExtraEnLiquidacion, tasaParaFinanzas, textoParaEnviar,
} from "@/lib/honorarios";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import { calcularPyL, comisionesDelMes } from "@/lib/finanzas";
import { liquidadaEn, mesDeLiquidacion, reversasDeComision } from "@/lib/devoluciones";
import { rangoDePeriodo } from "@/lib/periodos";
import type { Devolucion, EstadoApp, Liquidacion, ResultadoLiquidacion } from "@/lib/types";

/* ==================================================================
   Frente «la plata» · la liquidación con datos al azar.

   P5  los renglones de la liquidación cierran al centavo con Finanzas, con montos fraccionarios y en pesos y
       dólares: la comisión de cada closer y del director es la de Finanzas; el total de cada persona es la suma de
       sus renglones; lo que se carga como gasto al cerrar es lo que suman los renglones; el profit es el de Finanzas
       una vez cargados esos gastos.
   P4  una liquidación CERRADA nunca cambia por nada que se cargue después (devolución, cobro, gasto), y lo que se
       descuenta entra, una sola vez, en la primera abierta: la plata no se pierde ni se cuenta dos veces.
   ================================================================== */

const MESES_LIQ = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"] as const;
const MESES_DATOS = MESES_LIQ.slice(0, 4);
const opciones = { esquemas: true, meses: MESES_DATOS, devoluciones: 8, gastos: 6, ventas: 16, bordes: 0.25 } as const;
const opcionesConBajas = { ...opciones, inactivos: true } as const;

const lineasDe = (res: ResultadoLiquidacion) => res.personas.flatMap((p) => p.lineas.map((l) => ({ p, l })));

/* ---------- P5 ---------- */

test("P5 · cada renglón de cada mes cierra con su cuenta, los totales suman sus renglones y las comisiones son las de Finanzas", () => {
  let renglones = 0, conPesos = 0, conDevolucion = 0, conDeuda = 0, comisiones = 0;
  for (let semilla = 1; semilla <= 50; semilla++) {
    const { e } = mundo(semilla, opciones);
    for (const periodo of MESES_DATOS) {
      const res = calcularLiquidacion(e, periodo, undefined);
      const filas = comisionesDelMes(e, rangoDePeriodo(periodo));
      for (const p of res.personas) {
        const d = (...x: (string | number)[]) => donde(semilla, periodo, p.nombre, ...x);
        const suma: Record<string, number> = {};
        for (const l of p.lineas) {
          assert.ok(l.desglose, d("renglón sin desglose", l.nombre));
          assert.deepEqual(evaluarPasos(l.desglose.pasos).fallas, [], d(l.nombre));
          assert.equal(resultadoDelDesglose(l.desglose), l.desglose.correccion ? l.desglose.correccion.cuentaDaba : l.monto, d("la cuenta no cierra", l.nombre));
          assert.ok(Number.isFinite(l.monto) && Number.isFinite(l.montoBase), d("monto no finito", l.nombre));
          suma[l.moneda] = r2((suma[l.moneda] ?? 0) + l.monto);
          renglones++;
          if (l.moneda === "ARS") conPesos++;
          if (l.tipo === "devolucion") conDevolucion++;
        }
        /* El total de cada moneda y el total en dólares son la suma de los renglones. */
        for (const [mon, n] of Object.entries(suma)) assert.equal(r2(p.aPagar[mon as "USD"] ?? 0), n, d("aPagar", mon));
        assert.ok(cerca(p.total, p.lineas.reduce((a, l) => a + l.montoBase, 0), 0.0051), d("total en USD", p.total, "renglones", p.lineas.reduce((a, l) => a + l.montoBase, 0)));
        /* Por línea, en pesos: montoBase es monto / tipo de cambio, a centavos. */
        for (const l of p.lineas) if (l.moneda === "ARS") assert.ok(cerca(l.montoBase, l.monto / res.tipoCambio, 0.0051), d("pasaje a dólares", l.nombre));
        if (p.deuda) conDeuda++;

        /* Las comisiones de closers y del director: la liquidación dice lo que Finanzas (a lo sumo un centavo por renglón de %). */
        const m = e.equipo.find((x) => x.id === p.miembroId)!;
        if (m.rol === "closer" || m.rol === "director") {
          const esperado = m.rol === "closer"
            ? filas.filter((f) => f.closerId === m.id).reduce((a, f) => a + f.comisionCloser, 0)
            : filas.filter((f) => f.directorId === m.id).reduce((a, f) => a + f.comisionDirector, 0);
          const delMotor = p.lineas.filter((l) => l.enFinanzas && l.tipo !== "arrastre" && l.base !== "profit");
          const porcentajes = delMotor.filter((l) => l.tipo !== "devolucion").length;
          const real = delMotor.reduce((a, l) => a + l.monto, 0);
          assert.ok(cerca(real, esperado, 0.0076 * porcentajes + 0.0005), d("la liquidación dice", r2(real), "y Finanzas", r2(esperado), "(", porcentajes, "renglones de %)"));
          comisiones++;
        }
      }
      /* El total del equipo es la suma de las personas. */
      assert.ok(cerca(res.total, res.personas.reduce((a, p) => a + p.total, 0), 0.0051 * res.personas.length), donde(semilla, periodo, "total del equipo"));
    }
  }
  assert.ok(renglones > 2000 && conPesos > 300 && conDevolucion > 60 && comisiones > 600, `cobertura: ${renglones} renglones, ${conPesos} en pesos, ${conDevolucion} de devolución, ${comisiones} comisiones, ${conDeuda} con deuda`);
});

test("P5b · lo que se carga como gasto al cerrar es lo que suman los renglones (a lo sumo medio centavo por renglón en pesos) y el profit es el de Finanzas una vez cargado", () => {
  let grupos = 0, peor = 0, enPesos = 0;
  for (let semilla = 1; semilla <= 40; semilla++) {
    const { e } = mundo(semilla, opciones);
    for (const periodo of MESES_DATOS) {
      const res = calcularLiquidacion(e, periodo, undefined);
      const gs = gastosDeLiquidacion(e, { id: `liq_${periodo}`, periodo }, res);
      const lineas = lineasDe(res).filter(({ l }) => !l.enFinanzas && Math.abs(l.monto) >= 0.005);
      const enLineas = lineas.reduce((a, { l }) => a + l.montoBase, 0);
      const enGastos = gs.reduce((a, g) => a + g.monto, 0);
      /* Sin pesos en juego, el total que se carga en Finanzas es el de los renglones, exacto. Cada renglón en pesos
         se pasa a dólares y se redondea por separado, y el gasto se pasa una sola vez por grupo: de ahí la holgura. */
      const nPesos = lineas.filter(({ l }) => l.moneda !== "USD").length;
      const tol = 0.0051 * nPesos + 0.0005;
      assert.ok(cerca(enGastos, enLineas, tol), donde(semilla, periodo, "gastos", r2(enGastos), "renglones", r2(enLineas), "renglones en pesos", nPesos));
      peor = Math.max(peor, Math.abs(enGastos - enLineas));
      grupos += gs.length;
      enPesos += nPesos;
      /* El profit de la liquidación es el resultado operativo de Finanzas con esos gastos adentro. */
      const rango = rangoDePeriodo(periodo);
      const conGastos = { ...e, gastos: [...e.gastos, ...gs] } as EstadoApp;
      for (const g of gs) assert.ok(Date.parse(g.fecha) >= rango.desde.getTime() && Date.parse(g.fecha) <= rango.hasta.getTime(), donde(semilla, periodo, "el gasto cae fuera del mes", g.fecha));
      const pylDespues = calcularPyL(conGastos, rango);
      assert.ok(cerca(res.profit, pylDespues.operativoCC, 0.0051 * nPesos + 0.0005 + 0.0051), donde(semilla, periodo, "profit de la liquidación", res.profit, "profit de Finanzas", r2(pylDespues.operativoCC)));
      /* El reparto del growth partner y del socio: la línea de la liquidación es lo que Finanzas calcula una vez cargado el cierre. */
      for (const [id, esperado] of [["gro", pylDespues.growth], ["soc", pylDespues.socio]] as const) {
        const linea = res.personas.find((p) => p.miembroId === id)?.lineas.find((l) => l.base === "profit");
        assert.ok(linea, donde(semilla, periodo, id, "sin renglón de profit"));
        assert.ok(cerca(linea.monto, esperado, 0.0051 * nPesos + 0.0105), donde(semilla, periodo, id, "la liquidación dice", linea.monto, "y Finanzas", r2(esperado)));
      }
      /* Y cada gasto es una sola vez: ids distintos y deterministas. */
      assert.equal(new Set(gs.map((g) => g.id)).size, gs.length, donde(semilla, periodo, "gastos con el mismo id"));
      assert.deepEqual(gastosDeLiquidacion(e, { id: `liq_${periodo}`, periodo }, res).map((g) => [g.id, g.monto]), gs.map((g) => [g.id, g.monto]), donde(semilla, periodo, "idempotencia"));
    }
  }
  assert.ok(grupos > 200 && enPesos > 200, `cobertura: ${grupos} gastos de liquidación, ${enPesos} renglones en pesos (el peor desfasaje fue ${r2(peor)})`);
});

test("P5d · lo que se mide sobre todo el cash del negocio es el Cash Collected de Finanzas, ya sin lo devuelto", () => {
  let medidos = 0, conDevolucion = 0;
  for (let semilla = 1; semilla <= 40; semilla++) {
    const { e } = mundo(semilla, opciones);
    for (const periodo of MESES_DATOS) {
      const rango = rangoDePeriodo(periodo);
      const p = calcularPyL(e, rango);
      const res = calcularLiquidacion(e, periodo, undefined);
      const otro = res.personas.find((x) => x.miembroId === "otro");
      assert.ok(otro, donde(semilla, periodo, "falta la gerencia"));
      const pct = otro.lineas.find((l) => l.clave === "pct")!;      // 2% del cash (bruto), todas las ventas
      const tramo = otro.lineas.find((l) => l.clave === "tramo")!;  // tramos del cash post pasarelas, todas las ventas
      const d = (...x: (string | number)[]) => donde(semilla, periodo, ...x);
      /* Lo medido no baja de cero: si el mes devolvió más de lo que entró, no hay cash sobre el que comisionar. */
      assert.equal(pct.medido, Math.max(0, r2(p.cashCollected)), d("cash medido", pct.medido, "Cash Collected", r2(p.cashCollected)));
      assert.equal(tramo.medido, Math.max(0, r2(p.cashCollected - p.feesProcesador)), d("cash post pasarelas medido", tramo.medido));
      medidos += 2;
      if (p.devoluciones > 0) conDevolucion++;
    }
  }
  assert.ok(medidos === 320 && conDevolucion > 40, `cobertura: ${medidos} medidas, ${conDevolucion} meses con devolución`);
});

test("P5c · con el cierre del día prendido y closers que se fueron: nadie que comisione en Finanzas queda afuera, y la comisión más el descuento es lo que dice Finanzas", () => {
  let personas = 0, conDescuento = 0, sinCierre = 0, faltan = 0;
  const o2 = { esquemas: true, cierreDelDia: true, inactivos: true, meses: ["2026-07", "2026-08", "2026-09"], devoluciones: 8, gastos: 3, ventas: 16, bordes: 0.2 } as const;
  for (let semilla = 1; semilla <= 50; semilla++) {
    const { e } = mundo(semilla, o2);
    sinCierre += e.ventas.filter((v) => (v as { sesionId?: string }).sesionId).length;
    for (const periodo of o2.meses) {
      const res = calcularLiquidacion(e, periodo, undefined);
      const filas = comisionesDelMes(e, rangoDePeriodo(periodo));
      for (const m of e.equipo) {
        if (m.rol !== "closer" && m.rol !== "director") continue;
        const esperado = m.rol === "closer"
          ? filas.filter((f) => f.closerId === m.id).reduce((a, f) => a + f.comisionCloser, 0)
          : filas.filter((f) => f.directorId === m.id).reduce((a, f) => a + f.comisionDirector, 0);
        const p = res.personas.find((x) => x.miembroId === m.id);
        const d = (...x: (string | number)[]) => donde(semilla, periodo, m.nombre, ...x);
        if (!p) {
          if (Math.abs(esperado) >= 0.005) faltan++;
          assert.ok(Math.abs(esperado) < 0.005, d("Finanzas comisiona", r2(esperado), "y la liquidación no tiene a la persona (activo", String(m.activo), "hasta", m.hasta ?? "-", ")"));
          continue;
        }
        const delMotor = p.lineas.filter((l) => l.enFinanzas && l.tipo !== "arrastre" && l.base !== "profit");
        const redondeadas = delMotor.filter((l) => l.tipo !== "devolucion").length;
        const real = delMotor.reduce((a, l) => a + l.monto, 0);
        assert.ok(cerca(real, esperado, 0.0076 * redondeadas + 0.0005), d("la liquidación dice", r2(real), "y Finanzas", r2(esperado)));
        if (p.lineas.some((l) => l.tipo === "descuento")) conDescuento++;
        personas++;
      }
    }
  }
  assert.ok(personas > 500 && conDescuento > 60 && sinCierre > 150, `cobertura: ${personas} personas-mes, ${conDescuento} con descuento por cierre, ${sinCierre} ventas con llamada (${faltan} faltantes)`);
});

test("calcularLiquidacion es pura: sobre datos congelados da lo mismo dos veces y no escribe nada", () => {
  for (let semilla = 1; semilla <= 10; semilla++) {
    const { e } = mundo(semilla, opciones);
    const antes = JSON.stringify(e);
    congelar(e);
    for (const periodo of MESES_LIQ) {
      const a = calcularLiquidacion(e, periodo, undefined), b = calcularLiquidacion(e, periodo, undefined);
      assert.deepEqual(sinCalculadoEn(a), sinCalculadoEn(b), donde(semilla, periodo));
    }
    assert.equal(JSON.stringify(e), antes);
  }
});

/* ---------- P4 ---------- */

function repartir<T>(r: Azar, xs: T[], n: number): T[][] {
  const out: T[][] = Array.from({ length: n }, () => []);
  for (const x of xs) out[r.entre(0, n - 1)].push(x);
  return out;
}

test("P4 · una liquidación cerrada no cambia por lo que se carga después, y lo que se descuenta entra una sola vez en la primera abierta", () => {
  let cerradas = 0, tardias = 0, enAbierta = 0, conDeuda = 0, conArrastre = 0, enFoto = 0;
  for (let semilla = 1; semilla <= 50; semilla++) {
    const { e: W } = mundo(semilla, opcionesConBajas);
    const r = azar(semilla * 31);
    const tarde = W.devoluciones.filter(() => r.si(0.5));
    const conocidas = W.devoluciones.filter((x) => !tarde.includes(x));
    const plan = r.baraja(MESES_DATOS).slice(0, r.entre(1, 3));
    const lotes = repartir(r, tarde, plan.length + 1);
    let e = { ...W, devoluciones: conocidas, liquidaciones: [] as Liquidacion[] } as EstadoApp;
    const fotos: { periodo: string; texto: string; liq: Liquidacion }[] = [];
    const ordenDeCierre: string[] = [];

    for (let i = 0; i < plan.length; i++) {
      const periodo = plan[i];
      const base = liquidacionVacia(periodo, "2026-10-01T12:00:00.000Z");
      const resultado = calcularLiquidacion(e, periodo, base);
      const liq = congelar({ ...base, estado: "cerrada" as const, resultado: clonar(resultado), cerradaEn: "2026-10-01T12:00:00.000Z" }) as Liquidacion;
      fotos.push({ periodo, texto: JSON.stringify(liq.resultado), liq });
      ordenDeCierre.push(periodo);
      /* Después de cerrar llega de todo: devoluciones atrasadas (de cualquier mes), un cobro tardío con su venta y un gasto de ese mes. */
      const [a, m] = periodo.split("-").map(Number);
      const tardio = {
        venta: { id: `vt${i}`, contactoNombre: `Tardío ${i}`, precioAcordado: 1500, fecha: art(a, m, 3), moneda: "USD", productoId: "p1", closerId: "c2", directorId: "d2", excluidoMarketing: false, estado: "activa", creadoEn: art(a, m, 3), extra: {} },
        cuota: { id: `ct${i}`, ventaId: `vt${i}`, numero: 1, monto: 1500, estado: "pagada", esReserva: false },
        pago: pago(`pt${i}`, `ct${i}`, 1500.37, 43.511, art(a, m, 20, 10), "proc_stripe"),
      };
      e = {
        ...e,
        liquidaciones: [...e.liquidaciones, liq],
        devoluciones: [...e.devoluciones, ...lotes[i]],
        ventas: [...e.ventas, tardio.venta], cuotas: [...e.cuotas, tardio.cuota], pagos: [...e.pagos, tardio.pago],
        gastos: [...e.gastos, gasto({ id: `gt${i}`, monto: 321.99, fecha: art(a, m, 15, 9) })],
      } as unknown as EstadoApp;
      tardias += lotes[i].length;
    }
    e = { ...e, devoluciones: [...e.devoluciones, ...lotes[plan.length]] } as EstadoApp;
    tardias += lotes[plan.length].length;
    congelar(e);
    const d = (...x: (string | number)[]) => donde(semilla, "cerradas", plan.join(","), ...x);
    cerradas += plan.length;

    /* A · las fotos son exactamente lo que eran, aunque se recalcule todo lo demás. */
    const abiertos = MESES_LIQ.filter((p) => !plan.includes(p as never));
    const calculadas = new Map(abiertos.map((p) => [p, calcularLiquidacion(e, p, undefined)] as const));
    for (const f of fotos) {
      assert.equal(JSON.stringify(f.liq.resultado), f.texto, d("la foto de", f.periodo, "cambió"));
      /* Recalcular una cerrada (el aviso «algo cambió») tampoco la toca. */
      diferenciasDesdeElCierre(e, f.liq);
      assert.equal(JSON.stringify(f.liq.resultado), f.texto, d("diferenciasDesdeElCierre tocó la foto de", f.periodo));
    }

    /* B · cada reversa entra UNA sola vez, en el lugar que corresponde. */
    const liquidadas = liquidadaEn(e.liquidaciones);
    const lugares = new Map<string, { periodo: string; monto: number }[]>();
    const anotar = (periodo: string, res: ResultadoLiquidacion) => {
      for (const { p, l } of lineasDe(res)) {
        if (l.tipo !== "devolucion") continue;
        const k = `${p.miembroId}|${l.clave}`;
        lugares.set(k, [...(lugares.get(k) ?? []), { periodo, monto: l.monto }]);
      }
    };
    for (const f of fotos) anotar(f.periodo, f.liq.resultado!);
    for (const [p, res] of calculadas) anotar(p, res);

    for (const rv of reversasDeComision(e)) {
      if (rv.sinDescuento) continue;
      for (const parte of rv.partes) {
        if (!parte.miembroId || parte.reversa < 0.005) continue;
        const k = `${parte.miembroId}|devolucion:${rv.devolucion.id}:${parte.rol}`;
        const donde2 = (...x: (string | number)[]) => d(k, ...x);
        const sitios = lugares.get(k) ?? [];
        assert.equal(sitios.length, 1, donde2("aparece en", sitios.map((s) => s.periodo).join(",") || "ningún mes"));
        const enFotoDe = liquidadas.get(rv.devolucion.id);
        if (enFotoDe) { assert.equal(sitios[0].periodo, enFotoDe, donde2("está en la foto de", enFotoDe)); enFoto++; }
        else {
          const destino = mesDeLiquidacion(rv.devolucion, e.liquidaciones, liquidadas);
          assert.equal(sitios[0].periodo, destino, donde2("va a", destino));
          assert.ok(!plan.includes(destino as never), donde2("va a un mes cerrado"));
          /* Es el primero abierto desde el mes de la devolución. */
          const mesDev = rangoDePeriodo(destino).clave;
          assert.ok(mesDev >= (rv.devolucion.fecha ? rangoMesDe(rv.devolucion.fecha) : ""), donde2("va a un mes anterior"));
          assert.equal(sitios[0].monto, -parte.reversa, donde2("el monto no es la reversa de Finanzas"));
          enAbierta++;
        }
      }
    }
    /* Y ninguna línea de devolución es de algo que no existe o no se descuenta. */
    const validas = new Set(reversasDeComision(e).filter((x) => !x.sinDescuento).flatMap((x) => x.partes.filter((q) => q.miembroId && q.reversa >= 0.005).map((q) => `${q.miembroId}|devolucion:${x.devolucion.id}:${q.rol}`)));
    for (const k of lugares.keys()) {
      /* Las de las fotos se calcularon con lo que se sabía entonces: pueden ser de una devolución que después cambió, pero existe. */
      assert.ok(validas.has(k) || e.devoluciones.some((x) => k.includes(`devolucion:${x.id}:`)), d("línea de una devolución inexistente", k));
    }

    /* C · la deuda de una cerrada es un renglón negativo del mes siguiente, si ése se cerró después o sigue abierto. */
    for (const f of fotos) {
      for (const p of f.liq.resultado!.personas) {
        for (const [mon, deuda] of Object.entries(p.deuda ?? {})) {
          conDeuda++;
          const sig = (() => { const [a, m] = f.periodo.split("-").map(Number); return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`; })();
          const clave = `arrastre-entra:${f.periodo}:${mon}`;
          if (abiertos.includes(sig as never)) {
            const x = calculadas.get(sig)!.personas.find((q) => q.miembroId === p.miembroId);
            const l = x?.lineas.find((y) => y.clave === clave);
            assert.ok(l, d(p.nombre, "debía", deuda, mon, "de", f.periodo, "y no pasó a", sig));
            assert.equal(l.monto, -(deuda as number), d("la deuda que entra"));
            conArrastre++;
          } else if (plan.includes(sig as never) && ordenDeCierre.indexOf(sig) > ordenDeCierre.indexOf(f.periodo)) {
            const foto = fotos.find((q) => q.periodo === sig)!;
            const l = foto.liq.resultado!.personas.find((q) => q.miembroId === p.miembroId)?.lineas.find((y) => y.clave === clave);
            assert.ok(l, d(p.nombre, "debía", deuda, mon, "de", f.periodo, "y la foto de", sig, "no la trae"));
            assert.equal(l.monto, -(deuda as number));
          }
        }
      }
    }
  }
  assert.ok(cerradas > 60 && tardias > 50 && enAbierta > 45 && enFoto > 15 && conDeuda > 6, `cobertura: ${cerradas} cerradas, ${tardias} devoluciones tardías, ${enAbierta} descontadas en abiertas, ${enFoto} en fotos, ${conDeuda} deudas, ${conArrastre} arrastres`);
});

const rangoMesDe = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

test("P4b · el caso de Yari: septiembre cerrada, la devolución de un cobro de septiembre llega tarde: septiembre no cambia y se descuenta en octubre", () => {
  const equipo = [miembro("c1", "Mariano", "closer", 0.15), miembro("dir", "Santi", "director", 0.05)];
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: art(2026, 9, 10), moneda: "USD", productoId: "p1", closerId: "c1", directorId: "dir", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 9, 10), extra: {} };
  const cuotas = [{ id: "q1", ventaId: "v1", numero: 1, monto: 3000, estado: "pagada", esReserva: false }];
  const pagos = [pago("p1", "q1", 3000, 90, art(2026, 9, 12, 10))];
  const honorarios = [
    { id: "hon_c1", miembroId: "c1", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos: [{ id: "k", tipo: "porcentaje", nombre: "Comisión", moneda: "USD", tasa: 0.15, base: "cash-neto", alcance: "closer" }] },
    { id: "hon_dir", miembroId: "dir", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos: [{ id: "k", tipo: "porcentaje", nombre: "Comisión", moneda: "USD", tasa: 0.05, base: "cash-neto", alcance: "director" }] },
  ];
  const base = { equipo, honorarios, ventas: [venta], cuotas, pagos, gastos: [], sesiones: [], devoluciones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 }, productos: [{ id: "p1", nombre: "M" }], procesadores: [{ id: "proc_stripe", nombre: "Stripe" }] } as unknown as EstadoApp;
  const foto = calcularLiquidacion(base, "2026-09", undefined);
  const sept = liquidacionCerradaCon("2026-09", foto);
  const dev: Devolucion = devolucion({ id: "d1", monto: 3000, fecha: art(2026, 9, 20, 12) });
  const e = congelar({ ...base, liquidaciones: [sept], devoluciones: [dev] }) as EstadoApp;
  /* Septiembre: lo de siempre, aunque la devolución sea de septiembre. */
  assert.deepEqual(diferenciasDesdeElCierre(e, sept), [], "septiembre cerrada no cambia por una devolución de septiembre cargada tarde");
  assert.equal(JSON.stringify(sept.resultado), JSON.stringify(foto));
  /* Octubre: la línea «Devolución de Belén» y la deuda (no cobró nada en octubre). */
  const oct = calcularLiquidacion(e, "2026-10", undefined);
  const mariano = oct.personas.find((p) => p.miembroId === "c1")!;
  assert.equal(mariano.lineas.find((l) => l.clave === "devolucion:d1:closer")!.monto, -436.5);
  assert.deepEqual(mariano.deuda, { USD: 436.5 });
  assert.equal(mariano.total, 0);
  /* Y noviembre, con octubre abierta, no la vuelve a descontar. */
  const nov = calcularLiquidacion(e, "2026-11", undefined);
  assert.ok(!nov.personas.some((p) => p.lineas.some((l) => l.tipo === "devolucion" || l.tipo === "arrastre")));
});

/* ---------- BUG: el último día de quien se fue ---------- */

test("BUG: un cobro del último día de un closer que se fue, en la última fracción de segundo, lo comisiona Finanzas y no la liquidación", () => {
  const equipo = [miembro("c1", "Mariano", "closer", 0.15, { hasta: "2026-09-15" })];
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: art(2026, 9, 10), moneda: "USD", productoId: "p1", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 9, 10), extra: {} };
  const cuotas = [{ id: "q1", ventaId: "v1", numero: 1, monto: 3000, estado: "pagada", esReserva: false }];
  const pagos = [pago("p1", "q1", 1000, 0, art(2026, 9, 15, 23, 59, 59, 500))];
  const honorarios = [{ id: "hon_c1", miembroId: "c1", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos: [{ id: "k", tipo: "porcentaje", nombre: "Comisión", moneda: "USD", tasa: 0.15, base: "cash-neto", alcance: "closer" }] }];
  const e = { equipo, honorarios, ventas: [venta], cuotas, pagos, gastos: [], sesiones: [], devoluciones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 }, productos: [], procesadores: [] } as unknown as EstadoApp;
  const finanzas = comisionesDelMes(e, rangoDePeriodo("2026-09")).reduce((a, f) => a + f.comisionCloser, 0);
  const liquidacion = calcularLiquidacion(e, "2026-09", undefined).personas.find((p) => p.miembroId === "c1")?.lineas.find((l) => l.clave === "k")?.monto ?? 0;
  assert.equal(finanzas, 150, "Finanzas lo comisiona (cobraEnFecha: antes de las 24:00 del último día)");
  assert.equal(liquidacion, finanzas, "la liquidación debería decir lo mismo que Finanzas");
});


/* ---------- Lo que sale de la liquidación: CSV, texto y montos a mano ---------- */

/* Un lector de CSV mínimo: comillas, comas y comillas dobles escapadas. */
function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  fila.push(campo); filas.push(fila);
  return filas;
}

test("el CSV de la liquidación se lee de vuelta: cada total de persona suma sus renglones y el del equipo suma las personas", () => {
  for (let semilla = 1; semilla <= 30; semilla++) {
    const { e } = mundo(semilla, opciones);
    /* Nombres con comas y comillas: el CSV no puede romperse. */
    const raro = { ...e, equipo: e.equipo.map((m, i) => (i % 3 === 0 ? { ...m, nombre: `${m.nombre}, "el ${i}"` } : m)) } as EstadoApp;
    for (const periodo of MESES_DATOS) {
      const res = calcularLiquidacion(raro, periodo, undefined);
      const filas = leerCsv(liquidacionCsv(res, periodo));
      const cuerpo = filas.slice(3);
      assert.ok(cuerpo.every((f) => f.length === 8 || f.length === 1), donde(semilla, periodo, "filas con columnas de más o de menos"));
      for (const p of res.personas) {
        const suyas = cuerpo.filter((f) => f[0] === p.nombre);
        const total = suyas.find((f) => f[2] === "Total");
        assert.ok(total, donde(semilla, periodo, p.nombre, "sin fila de total"));
        const renglones = suyas.filter((f) => f[2] !== "Total").reduce((a, f) => a + Number(f[6]), 0);
        assert.ok(cerca(Number(total[5]), renglones, 0.0101), donde(semilla, periodo, p.nombre, "total", total[5], "renglones", r2(renglones)));
        assert.equal(suyas.filter((f) => f[2] !== "Total").length, p.lineas.length, donde(semilla, periodo, p.nombre, "renglones del CSV"));
      }
      const equipo = cuerpo.find((f) => f[0] === "Todo el equipo");
      assert.ok(equipo && cerca(Number(equipo[5]), res.total, 0.0051), donde(semilla, periodo, "total del equipo"));
      /* El texto para mandar dice lo mismo que la liquidación. */
      for (const p of res.personas) {
        const t = textoParaEnviar(p, periodo);
        assert.ok(t.startsWith("Hola ") && t.includes("Total:"), donde(semilla, periodo, p.nombre, "texto"));
        assert.equal(t.split("\n").filter((l) => l.startsWith("• ")).length, p.lineas.length);
      }
    }
  }
});

test("P7d · un monto a mano con el mismo id entra una sola vez, y quitarlo dos veces no rompe nada; en una liquidación cerrada no entra", () => {
  const r = azar(5);
  for (let i = 0; i < 100; i++) {
    const periodo = r.elige(MESES_LIQ);
    const extra = { id: `x${r.entre(1, 5)}`, miembroId: "c1", concepto: "Descuento", monto: -r.plata(1, 500), moneda: r.elige(["USD", "ARS"] as const) };
    const cerradas = r.si(0.3) ? [liquidacionCerradaCon(periodo, calcularLiquidacion(mundo(1, opciones).e, "2026-08", undefined))] : [];
    const uno = conExtraEnMes(cerradas, periodo, extra);
    if (cerradas.length) { assert.equal(uno, null, "en una cerrada no entra"); continue; }
    assert.ok(uno);
    const dos = conExtraEnMes(uno.liquidaciones, periodo, extra);
    assert.ok(dos);
    assert.deepEqual(dos.liquidacion.extras, uno.liquidacion.extras, "el mismo monto dos veces entró dos veces");
    assert.equal(dos.liquidaciones.length, 1);
    const sin = sinExtraEnLiquidacion(dos.liquidaciones, uno.liquidacion.id, extra.id);
    assert.ok(sin && sin.liquidacion.extras.length === 0);
    assert.equal(sinExtraEnLiquidacion(sin.liquidaciones, uno.liquidacion.id, extra.id), null, "quitarlo dos veces");
  }
});

/* ---------- BUG: pesos y centavos ---------- */

test("BUG: el total de una liquidación en pesos no es lo que se carga como gasto en Finanzas (cada renglón se redondea por separado)", { todo: "linea() redondea montoBase renglón por renglón; gastosDeLiquidacion convierte el total del grupo una sola vez: con N renglones en pesos difieren hasta N × medio centavo" }, () => {
  /* Cuatro personas con US$ 66,6649 cada una (99.997,35 pesos a 1.500): cada renglón da 66,66; el grupo, 266,6596 → 266,66 y no 266,64. */
  const equipo = ["a", "b", "c", "d"].map((id) => miembro(id, `Persona ${id}`, "otro"));
  const honorarios = equipo.map((m) => ({
    id: `hon_${m.id}`, miembroId: m.id, categoriaGasto: "Equipo / Salarios", actualizadoEn: "",
    conceptos: [{ id: "k", tipo: "fijo", nombre: "Sueldo", moneda: "ARS", monto: 99997.35 }],
  }));
  const e = { equipo, honorarios, ventas: [], cuotas: [], pagos: [], gastos: [], sesiones: [], devoluciones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 }, productos: [], procesadores: [] } as unknown as EstadoApp;
  const res = calcularLiquidacion(e, "2026-09", undefined);
  const enLiquidacion = r2(res.personas.reduce((a, p) => a + p.total, 0));
  const enFinanzas = r2(gastosDeLiquidacion(e, { id: "liq_2026-09", periodo: "2026-09" }, res).reduce((a, g) => a + g.monto, 0));
  assert.equal(enLiquidacion, enFinanzas, `la liquidación suma US$ ${enLiquidacion} y a Finanzas le llegan US$ ${enFinanzas}`);
});

/* ---------- BUG: pasar las cuotas de un closer que se fue ---------- */

test("BUG: pasar a otro closer una cuota que ya tiene un cobro le quita a quien cerró la venta la comisión de lo que ya cobró", { todo: "reasignarCuotas sólo escribe cuota.closerId y closerDeCuota lo aplica a TODOS los cobros de la cuota; el aviso de CuotasDelCloser promete «Lo que ya se cobró sigue siendo de {closer}»" }, () => {
  const equipo = [miembro("c1", "Mariano", "closer", 0.1), miembro("c2", "Dante", "closer", 0.1)];
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 1500, fecha: art(2026, 9, 1), moneda: "USD", productoId: "p1", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 9, 1), extra: {} };
  /* Una cuota de 1.500 de la que ya entraron 600 el 5/09; faltan 900. */
  const cuota = { id: "q1", ventaId: "v1", numero: 1, monto: 1500, estado: "pendiente", esReserva: false };
  const pagos = [pago("p1", "q1", 600, 0, art(2026, 9, 5, 10))];
  const honorarios = ["c1", "c2"].map((id) => ({ id: `hon_${id}`, miembroId: id, categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos: [{ id: "k", tipo: "porcentaje", nombre: "Comisión", moneda: "USD", tasa: 0.1, base: "cash-neto", alcance: "closer" }] }));
  const e = (c: typeof cuota & { closerId?: string }) => ({ equipo, honorarios, ventas: [venta], cuotas: [c], pagos, gastos: [], sesiones: [], devoluciones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 }, productos: [], procesadores: [] }) as unknown as EstadoApp;
  const sept = rangoDePeriodo("2026-09");
  const de = (st: EstadoApp, id: string) => comisionesDelMes(st, sept).filter((f) => f.closerId === id).reduce((a, f) => a + f.comisionCloser, 0);
  assert.equal(de(e(cuota), "c1"), 60);
  /* Mariano se va: se le pasa la cuota por cobrar (queda en la lista porque faltan 900) a Dante. */
  const despues = e({ ...cuota, closerId: "c2" });
  assert.equal(de(despues, "c1"), 60, "los 600 que ya había cobrado siguen siendo de Mariano");
  assert.equal(de(despues, "c2"), 0, "y Dante sólo comisiona lo que se cobre desde ahora");
});

/* ---------- Contra un oráculo hecho aparte ---------- */

test("P5e · lo que mide un concepto sobre el cash (con filtros de servicio, marketing y ventas sin comisión, y fechas de vigencia) es lo que dan las listas crudas, con las devoluciones restadas", () => {
  let medidos = 0, conDevolucion = 0, parciales = 0;
  for (let semilla = 1; semilla <= 100; semilla++) {
    const r = azar(semilla * 53);
    const { e: base } = mundo(semilla, { esquemas: false, devoluciones: 8, ventas: 16, meses: MESES_DATOS, bordes: 0.2 });
    const periodo = r.elige(MESES_DATOS);
    const [a, m] = periodo.split("-").map(Number);
    const conceptos = Array.from({ length: 4 }, (_, i) => ({
      id: `k${i}`, tipo: "porcentaje" as const, nombre: `Concepto ${i}`, moneda: "USD" as const, tasa: 0.05,
      base: r.elige(["cash", "cash-neto"] as const), alcance: r.elige(["todas", "todas", "closer"] as const),
      ...(r.si(0.4) ? { productoIds: [r.elige(["p1", "p2"])] } : {}),
      ...(r.si(0.3) ? { sinExcluidasMarketing: true } : {}),
      ...(r.si(0.3) ? { sinVentasSinComision: true } : {}),
      ...(r.si(0.3) ? { desde: `${periodo}-${String(r.entre(2, 15)).padStart(2, "0")}` } : {}),
      ...(r.si(0.3) ? { hasta: `${periodo}-${String(r.entre(16, 28)).padStart(2, "0")}` } : {}),
    }));
    /* Medidos sobre todo el negocio: la gerencia (alcance «todas»); el de closer es de Closer Uno. */
    const e = { ...base, honorarios: [
      { id: "hon_otro", miembroId: "otro", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos: conceptos.filter((c) => c.alcance === "todas") },
      { id: "hon_c1", miembroId: "c1", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos: conceptos.filter((c) => c.alcance === "closer").map((c) => ({ ...c, id: `${c.id}c` })) },
    ] } as unknown as EstadoApp;
    const res = calcularLiquidacion(e, periodo, undefined);
    const mes = rangoDePeriodo(periodo);
    const ventaDe = new Map(e.ventas.map((v) => [v.id, v]));
    const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, ventaDe.get(c.ventaId)]));
    const closerSinComision = (v?: { closerId?: string }) => Boolean(v?.closerId && e.equipo.find((x) => x.id === v.closerId)?.sinComision);

    for (const c of conceptos) {
      const persona = res.personas.find((p) => p.miembroId === (c.alcance === "closer" ? "c1" : "otro"));
      const l = persona?.lineas.find((x) => x.clave === (c.alcance === "closer" ? `${c.id}c` : c.id));
      /* La vigencia: de qué día a qué día vale en el mes. */
      const desde = c.desde ? new Date(a, m - 1, Number(c.desde.slice(8, 10))) : mes.desde;
      const hasta = c.hasta ? new Date(a, m - 1, Number(c.hasta.slice(8, 10)), 23, 59, 59) : mes.hasta;
      const dentro = (iso: string) => { const t = Date.parse(iso); return t >= desde.getTime() && t <= hasta.getTime(); };
      const sinFiltros = (c.alcance ?? "todas") === "todas" && !c.productoIds && !c.sinVentasSinComision && !c.sinExcluidasMarketing;
      const cuenta = (v: { estado: string; productoId?: string; excluidoMarketing: boolean; closerId?: string } | undefined, deCloser?: string) => {
        if (sinFiltros) return true;
        if (!v || v.estado === "cancelada") return false;
        if (c.alcance === "closer" && deCloser !== "c1") return false;
        if (c.productoIds && !(v.productoId && c.productoIds.includes(v.productoId))) return false;
        if ((c.alcance !== "todas" || c.sinVentasSinComision) && closerSinComision(v)) return false;
        if (c.sinExcluidasMarketing && v.excluidoMarketing) return false;
        return true;
      };
      let valor = 0;
      for (const p of e.pagos) {
        if (!dentro(p.fecha)) continue;
        const v = ventaDeCuota.get(p.cuotaId) as never;
        const cuota = e.cuotas.find((x) => x.id === p.cuotaId) as { closerId?: string } | undefined;
        const deCloser = cuota?.closerId || (v as { closerId?: string } | undefined)?.closerId;
        if (!cuenta(v, deCloser)) continue;
        valor += c.base === "cash" ? p.monto : p.monto - p.feeMonto;
      }
      let dev = 0;
      /* Las comisiones de ventas (closer) no netean: se revierte lo comisionado con su propia línea. */
      if (c.alcance !== "closer") {
        for (const d of e.devoluciones) {
          if (d.estado !== "confirmada" || !dentro(d.fecha)) continue;
          if (!cuenta(d.ventaId ? ventaDe.get(d.ventaId) as never : undefined)) continue;
          dev += d.monto;
        }
      }
      /* El closer de cada cobro puede no ser el de la venta (cuotas heredadas) y quien se fue no cobra lo posterior: se mira sólo lo que no depende de eso. */
      if (c.alcance === "closer") continue;
      const esperado = Math.max(0, r2(valor - dev));
      assert.ok(l, donde(semilla, periodo, c.id, "falta el renglón"));
      assert.ok(cerca(l.medido ?? NaN, esperado, 0.0101), donde(semilla, periodo, c.id, JSON.stringify({ base: c.base, productoIds: c.productoIds, mkt: c.sinExcluidasMarketing, sc: c.sinVentasSinComision, desde: c.desde, hasta: c.hasta }), "mide", l.medido, "oráculo", esperado));
      medidos++;
      if (dev > 0) conDevolucion++;
      if (c.desde || c.hasta) parciales++;
    }
  }
  assert.ok(medidos > 150 && conDevolucion > 50 && parciales > 80, `cobertura: ${medidos} medidas, ${conDevolucion} con devolución, ${parciales} con vigencia parcial`);
});

/* ---------- BUG: cambiar el % de un closer reescribe los meses anteriores en Finanzas ---------- */

test("BUG: al subirle el % a un closer (con vigencia), Finanzas recalcula los meses anteriores con el % nuevo y deja de coincidir con la liquidación de esos meses", { todo: "equipo.comisionRate (tasaParaFinanzas) es el % de HOY y Finanzas no tiene historia de tasas; la liquidación sí respeta la vigencia de cada concepto. El README promete «así los dos lados dan lo mismo»" }, () => {
  /* Hasta fines de 2025 comisionaba el 10%; desde 2026, el 15%. Se cobró en noviembre de 2025. */
  const conceptos = [
    { id: "viejo", tipo: "porcentaje", nombre: "Comisión (hasta 2025)", moneda: "USD", tasa: 0.1, base: "cash-neto", alcance: "closer", hasta: "2025-12-31" },
    { id: "nuevo", tipo: "porcentaje", nombre: "Comisión (desde 2026)", moneda: "USD", tasa: 0.15, base: "cash-neto", alcance: "closer", desde: "2026-01-01" },
  ];
  const esq = { id: "hon_c1", miembroId: "c1", categoriaGasto: "Equipo / Salarios", actualizadoEn: "", conceptos };
  const c1 = miembro("c1", "Mariano", "closer", 0.1);
  /* Lo que escribe la app al guardar el esquema: el % que vale hoy. */
  const equipo = [{ ...c1, comisionRate: tasaParaFinanzas(c1, esq as never) ?? 0.1 }];
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: art(2025, 11, 3), moneda: "USD", productoId: "p1", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2025, 11, 3), extra: {} };
  const e = {
    equipo, honorarios: [esq], ventas: [venta], cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [pago("p1", "q1", 1000, 0, art(2025, 11, 10, 10))], gastos: [], sesiones: [], devoluciones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 }, productos: [], procesadores: [],
  } as unknown as EstadoApp;
  const nov = rangoDePeriodo("2025-11");
  const enFinanzas = comisionesDelMes(e, nov).reduce((a, f) => a + f.comisionCloser, 0);
  const enLiquidacion = calcularLiquidacion(e, "2025-11", undefined).personas.find((p) => p.miembroId === "c1")!.lineas.filter((l) => l.enFinanzas).reduce((a, l) => a + l.monto, 0);
  assert.equal(enLiquidacion, 100, "la liquidación de noviembre de 2025 aplica el 10% de ese mes");
  assert.equal(enFinanzas, enLiquidacion, "Finanzas dice " + enFinanzas + " para ese mes");
});
