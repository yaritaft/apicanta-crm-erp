import test from "node:test";
import assert from "node:assert/strict";
import { runway } from "@/lib/caja";
import { devolucionesDelMes } from "@/lib/devoluciones";
import { calcularPyL, cashCollected, comisionesDelMes, gastosDelMes, gastosPagadosEn, pagosDelMes } from "@/lib/finanzas";
import { mesClave } from "@/lib/format";
import { calcularLiquidacion, vigenciaEnMes } from "@/lib/honorarios";
import { rangoDeFechas, ultimosMeses, type RangoMes } from "@/lib/metricas";
import { moverPeriodo, periodoDeFecha, rangoDePeriodo } from "@/lib/periodos";
import type { Devolucion, EstadoApp, Gasto, Pago, Webinar } from "@/lib/types";
import { numerosDe, rendimientoPorVia } from "@/lib/vias-webinar";
import { concepto, devolucion, esquema, estadoDeYari, miembro, pago } from "./estado-devolucion";

/* ==================================================================
   Los rangos terminan en el último milisegundo del día (23:59:59,999)

   Los rangos de la app (un mes, un día del Dashboard, la vigencia de un
   concepto de la liquidación, los tres meses cerrados del runway) terminaban
   en 23:59:59,000. Un cobro, una devolución o un gasto con milisegundos entre
   23:59:59,001 y 23:59:59,999 del último día no caía en NINGÚN mes ni en
   ningún día: la plata se perdía sin error ni aviso. No es raro: lo que se
   carga en la pantalla se fecha con new Date().toISOString(). Y la
   liquidación de un closer que se fue perdía el cobro del último día que
   Finanzas sí comisiona.

   Ahora cada rango termina en el último milisegundo (finDelDia, lib/periodos)
   y el siguiente empieza un milisegundo después: cada instante cae en un solo
   mes y en un solo día. Y lo que ya andaba (todo lo que no cae en esa última
   fracción de segundo) da exactamente lo mismo que antes.
   ================================================================== */

const ARGENTINA = "America/Argentina/Buenos_Aires";
/* Husos con y sin horario de verano, y La Habana, que lo cambia justo a la
   medianoche: los rangos tienen que pegar bien en todos. */
const ZONAS = [ARGENTINA, "UTC", "America/New_York", "Europe/Madrid", "America/Havana"];

/** Corre `f` con otro huso horario y deja el de antes. */
function conZona<T>(zona: string, f: () => T): T {
  const antes = process.env.TZ;
  process.env.TZ = zona;
  try {
    return f();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

/* Un instante en la hora de acá (la del huso puesto), en ISO. */
const aca = (a: number, m: number, d: number, h = 12, mi = 0, s = 0, ms = 0): string => new Date(a, m - 1, d, h, mi, s, ms).toISOString();
const diaDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const contiene = (r: RangoMes, t: number) => t >= r.desde.getTime() && t <= r.hasta.getTime();

/** "2026-01" … "2028-03", los dos incluidos. */
function periodosEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let p = desde; p <= hasta; p = moverPeriodo(p, 1)) out.push(p);
  return out;
}

/** Cada día entre dos fechas ("2026-01-01"), las dos incluidas. */
function diasEntre(desde: string, hasta: string): string[] {
  const [a, m, d] = desde.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const dia = diaDe(new Date(a, m - 1, d + i));
    out.push(dia);
    if (dia >= hasta) return out;
  }
}

/* Un generador con semilla (mulberry32): los barridos dan siempre lo mismo. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gasto = (id: string, monto: number, fecha: string, extra: Partial<Gasto> = {}): Gasto => ({
  id, categoria: "Software", grupo: "operativo", concepto: "Software", moneda: "USD", monto, fecha, recurrente: false, creadoEn: fecha, extra: {}, ...extra,
});

/* ---------- La forma de los rangos ---------- */

test("finDelDia: el último milisegundo del día, venga la hora que venga", async () => {
  const { finDelDia } = await import("@/lib/periodos");
  for (const zona of ZONAS) {
    conZona(zona, () => {
      const horas = [
        new Date(2026, 8, 30, 0, 0, 0, 0), new Date(2026, 8, 30, 12, 34, 56, 789), new Date(2026, 8, 30, 23, 59, 59, 0),
        new Date(2026, 8, 30, 23, 59, 59, 999), new Date(2028, 1, 29, 7), new Date(2026, 11, 31, 18),
      ];
      for (const d of horas) {
        const f = finDelDia(d);
        assert.equal(diaDe(f), diaDe(d), `${zona}: ${d.toISOString()} es del mismo día`);
        assert.deepEqual([f.getHours(), f.getMinutes(), f.getSeconds(), f.getMilliseconds()], [23, 59, 59, 999], `${zona}: ${d.toISOString()}`);
      }
    });
  }
});

test("un mes termina en el último milisegundo y el siguiente empieza justo después: sin hueco ni solapamiento, en cualquier huso", () => {
  for (const zona of ZONAS) {
    conZona(zona, () => {
      /* Incluye el 29 de febrero de 2028. */
      const periodos = periodosEntre("2026-01", "2028-03");
      const rangos = periodos.map(rangoDePeriodo);
      rangos.forEach((r, i) => {
        const ultimo = new Date(r.desde.getFullYear(), r.desde.getMonth() + 1, 0).getDate();
        assert.deepEqual(
          [r.hasta.getDate(), r.hasta.getHours(), r.hasta.getMinutes(), r.hasta.getSeconds(), r.hasta.getMilliseconds()],
          [ultimo, 23, 59, 59, 999], `${zona}: ${periodos[i]} termina el último milisegundo de su último día`,
        );
        assert.equal(r.desde.getDate(), 1, `${zona}: ${periodos[i]} empieza el 1`);
        if (i > 0) assert.equal(rangos[i - 1].hasta.getTime() + 1, r.desde.getTime(), `${zona}: de ${periodos[i - 1]} a ${periodos[i]} no hay hueco`);
      });
    });
  }
});

test("el mes en la hora de Argentina cierra a las 02:59:59,999Z del día 1 siguiente, y ahí empieza el que viene", () => {
  conZona(ARGENTINA, () => {
    for (const p of periodosEntre("2026-01", "2028-03")) {
      const [a, m] = p.split("-").map(Number);
      const r = rangoDePeriodo(p), siguiente = rangoDePeriodo(moverPeriodo(p, 1));
      assert.equal(r.hasta.toISOString(), new Date(Date.UTC(a, m, 1, 2, 59, 59, 999)).toISOString(), p);
      assert.equal(siguiente.desde.toISOString(), new Date(Date.UTC(a, m, 1, 3, 0, 0, 0)).toISOString(), p);
    }
  });
});

test("un día del Dashboard termina en el último milisegundo, y el rango de un mes entero es el mismo que el de Finanzas", () => {
  for (const zona of ZONAS) {
    conZona(zona, () => {
      const dias = diasEntre("2026-01-01", "2028-03-31");
      const rangos = dias.map((d) => rangoDeFechas(d, d, d));
      rangos.forEach((r, i) => {
        assert.deepEqual([r.hasta.getHours(), r.hasta.getMinutes(), r.hasta.getSeconds(), r.hasta.getMilliseconds()], [23, 59, 59, 999], `${zona}: ${dias[i]}`);
        assert.equal(diaDe(r.hasta), dias[i], `${zona}: ${dias[i]} termina el mismo día`);
        if (i > 0) assert.equal(rangos[i - 1].hasta.getTime() + 1, r.desde.getTime(), `${zona}: de ${dias[i - 1]} a ${dias[i]} no hay hueco`);
      });
      /* «Este mes» del Dashboard (por fechas) y el mes de Finanzas (por período) cortan en el mismo lugar. */
      for (const p of periodosEntre("2026-01", "2028-03")) {
        const [a, m] = p.split("-").map(Number);
        const ultimo = new Date(a, m, 0).getDate();
        const porFechas = rangoDeFechas(`${p}-01`, `${p}-${String(ultimo).padStart(2, "0")}`, p), porPeriodo = rangoDePeriodo(p);
        assert.equal(porFechas.desde.getTime(), porPeriodo.desde.getTime(), `${zona}: ${p} desde`);
        assert.equal(porFechas.hasta.getTime(), porPeriodo.hasta.getTime(), `${zona}: ${p} hasta`);
      }
    });
  }
});

test("ultimosMeses: cada mes termina en el último milisegundo, igual que el período, y el siguiente empieza justo después", () => {
  for (const zona of ZONAS) {
    conZona(zona, () => {
      const antes = mesClave(new Date());
      const meses = ultimosMeses(8);
      const despues = mesClave(new Date());
      assert.equal(meses.length, 8);
      assert.ok([antes, despues].includes(meses[meses.length - 1].clave), "el último es el mes de hoy");
      meses.forEach((m, i) => {
        const p = rangoDePeriodo(m.clave);
        assert.equal(m.hasta.getMilliseconds(), 999, `${zona}: ${m.clave}`);
        assert.equal(m.desde.getTime(), p.desde.getTime(), `${zona}: ${m.clave} desde`);
        assert.equal(m.hasta.getTime(), p.hasta.getTime(), `${zona}: ${m.clave} hasta`);
        if (i > 0) assert.equal(meses[i - 1].hasta.getTime() + 1, m.desde.getTime(), `${zona}: de ${meses[i - 1].clave} a ${m.clave} no hay hueco`);
      });
    });
  }
});

/* ---------- El barrido: cada instante, en un mes y en un día ---------- */

test("cada instante cae en exactamente un mes y en exactamente un día, también los últimos milisegundos, en cualquier huso", () => {
  for (const zona of ZONAS) {
    conZona(zona, () => {
      const periodos = periodosEntre("2026-01", "2028-03");
      const meses = periodos.map(rangoDePeriodo);
      const dias = diasEntre("2026-01-01", "2028-03-31").map((dia) => ({ dia, rango: rangoDeFechas(dia, dia, dia) }));
      const sortea = azar(20261007);
      const instantes: number[] = [];
      meses.forEach((m, i) => {
        const a = m.desde.getTime(), b = m.hasta.getTime();
        /* Los bordes: el primer milisegundo, el último segundo con distintos milisegundos y el que viene después. */
        instantes.push(a, a + 1, b - 1000, b - 999, b - 500, b - 1, b);
        if (i < meses.length - 1) instantes.push(b + 1);
        for (let k = 0; k < 40; k++) instantes.push(a + Math.floor(sortea() * (b - a + 1)));
      });
      /* Y el último segundo de cada día, con milisegundos al azar. */
      for (const { rango } of dias) {
        const b = rango.hasta.getTime();
        instantes.push(b - Math.floor(sortea() * 1000), b);
      }
      assert.ok(instantes.length > 2500, "hay un barrido de verdad");
      for (const t of instantes) {
        const iso = new Date(t).toISOString();
        const mesesQueLoTienen = periodos.filter((_, i) => contiene(meses[i], t));
        assert.equal(mesesQueLoTienen.length, 1, `${zona}: ${iso} cae en ${mesesQueLoTienen.length} meses (${mesesQueLoTienen.join(", ")})`);
        assert.equal(mesesQueLoTienen[0], periodoDeFecha(iso), `${zona}: ${iso} cae en un mes y periodoDeFecha dice otro`);
        const diasQueLoTienen = dias.filter((d) => contiene(d.rango, t));
        assert.equal(diasQueLoTienen.length, 1, `${zona}: ${iso} cae en ${diasQueLoTienen.length} días (${diasQueLoTienen.map((d) => d.dia).join(", ")})`);
        assert.equal(diasQueLoTienen[0].dia, diaDe(new Date(t)), `${zona}: ${iso} cae en un día y el calendario dice otro`);
      }
    });
  }
});

/* ---------- La plata de los últimos milisegundos ---------- */

test("un cobro, una devolución y un gasto de los últimos milisegundos del mes cuentan en ese mes y en ningún otro", () => {
  for (const ms of [1, 250, 500, 998, 999]) {
    const t = aca(2026, 9, 30, 23, 59, 59, ms);
    const e = estadoDeYari({
      pagos: [pago("p_x", "c1a", 100, 0, t)],
      devoluciones: [devolucion({ id: "d_x", ventaId: "v1", monto: 40, fecha: t })],
      gastos: [gasto("g_x", 70, t, { fechaPago: t })],
    });
    const sep = rangoDePeriodo("2026-09"), oct = rangoDePeriodo("2026-10");
    const enSep = calcularPyL(e, sep), enOct = calcularPyL(e, oct);
    assert.equal(enSep.cobrado, 100, `el cobro de ${t} es de septiembre`);
    assert.equal(enSep.devoluciones, 40, `la devolución de ${t} es de septiembre`);
    assert.equal(enSep.gastosOperativos, 70, `el gasto de ${t} es de septiembre`);
    assert.equal(enSep.cashCollected, 60);
    assert.equal(enOct.cobrado, 0, `el cobro de ${t} no es de octubre`);
    assert.equal(enOct.devoluciones, 0);
    assert.equal(enOct.gastosOperativos, 0);
    assert.equal(gastosPagadosEn(e, sep).length, 1, "la caja lo paga en septiembre");
    assert.equal(gastosPagadosEn(e, oct).length, 0);
  }
  /* Y el primer instante de octubre ya es de octubre. */
  const e = estadoDeYari({ pagos: [pago("p_y", "c1a", 5, 0, aca(2026, 10, 1, 0, 0, 0, 0))], devoluciones: [], gastos: [] });
  assert.equal(calcularPyL(e, rangoDePeriodo("2026-09")).cobrado, 0);
  assert.equal(calcularPyL(e, rangoDePeriodo("2026-10")).cobrado, 5);
});

test("las columnas por día del Dashboard suman lo que el mes: un cobro de los últimos milisegundos de cada día está en su día", () => {
  const sortea = azar(77);
  const pagos: Pago[] = [];
  const dias = diasEntre("2026-09-01", "2026-09-30");
  dias.forEach((dia, i) => {
    const [a, m, d] = dia.split("-").map(Number);
    pagos.push(pago(`p${i}`, "c1a", 10 + i, 0, aca(a, m, d, 23, 59, 59, 1 + Math.floor(sortea() * 999))));
    pagos.push(pago(`q${i}`, "c1a", 1000 + i, 0, aca(a, m, d, 23, 59, 59, 999)));
  });
  const e = estadoDeYari({ pagos, devoluciones: [devolucion({ id: "d1", ventaId: "v1", monto: 300, fecha: aca(2026, 9, 30, 23, 59, 59, 600) })], gastos: [] });
  const total = pagos.reduce((a, p) => a + p.monto, 0) - 300;
  assert.equal(cashCollected(e, rangoDePeriodo("2026-09")), total, "el mes tiene todo");
  const porDia = dias.map((d) => cashCollected(e, rangoDeFechas(d, d, d)));
  porDia.forEach((n, i) => assert.equal(n, 10 + i + 1000 + i - (i === dias.length - 1 ? 300 : 0), `el día ${dias[i]} tiene sus dos cobros`));
  assert.equal(porDia.reduce((a, n) => a + n, 0), total, "la suma de los 30 días da el mes");
  /* Y todo el mes por fechas (el «Este mes» del selector) también. */
  assert.equal(cashCollected(e, rangoDeFechas("2026-09-01", "2026-09-30", "Este mes")), total);
});

/* Un mundo con ventas, cuotas, cobros, devoluciones y gastos al azar entre julio y diciembre, con
   un tercio de los instantes en los bordes del mes. `conHueco`: algunos caen en la última fracción
   de segundo del mes (23:59:59,001 a 23:59:59,999); sin eso, ninguno. */
const MESES_DEL_MUNDO = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

function mundoAlAzar(semilla: number, conHueco: boolean): { e: EstadoApp; enElHueco: number; pagos: Pago[]; devoluciones: Devolucion[]; gastos: Gasto[] } {
  const sortea = azar(semilla);
  const entre = (a: number, b: number) => a + Math.floor(sortea() * (b - a + 1));
  const elige = <T>(xs: readonly T[]): T => xs[entre(0, xs.length - 1)];
  let enElHueco = 0;
  const instante = (): string => {
    const [a, m] = elige(MESES_DEL_MUNDO).split("-").map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    const bordes = [[1, 0, 0, 0, 0], [1, 0, 0, 0, 1], [ultimo, 23, 59, 58, 999], [ultimo, 23, 59, 59, 0]];
    if (conHueco) bordes.push([ultimo, 23, 59, 59, 1], [ultimo, 23, 59, 59, 500], [ultimo, 23, 59, 59, 999]);
    let [d, h, mi, s, ms] = sortea() < 0.35 ? elige(bordes) : [entre(1, ultimo), entre(0, 23), entre(0, 59), entre(0, 59), entre(0, 999)];
    const ultimoSegundo = d === ultimo && h === 23 && mi === 59 && s === 59;
    if (ultimoSegundo && !conHueco) ms = 0;
    if (ultimoSegundo && ms > 0) enElHueco++;
    return new Date(a, m - 1, d, h, mi, s, ms).toISOString();
  };

  const ventas: unknown[] = [], cuotas: unknown[] = [];
  const pagos: Pago[] = [], devoluciones: Devolucion[] = [], gastos: Gasto[] = [];
  const nVentas = entre(3, 8);
  for (let i = 0; i < nVentas; i++) {
    const fecha = instante();
    ventas.push({
      id: `v${i}`, contactoNombre: `Cliente ${i}`, precioAcordado: entre(500, 6000), fecha, moneda: "USD", productoId: "p_ment",
      closerId: elige(["mariano", "dante"]), directorId: "santi", excluidoMarketing: false, estado: "activa", creadoEn: fecha, extra: {},
    });
    for (let j = 0; j < entre(1, 3); j++) {
      cuotas.push({ id: `c${i}_${j}`, ventaId: `v${i}`, numero: j + 1, monto: 100, estado: "pagada", esReserva: false });
      for (let q = 0; q < entre(0, 2); q++) {
        const monto = entre(50, 2500) + entre(0, 99) / 100;
        pagos.push(pago(`p${i}_${j}_${q}`, `c${i}_${j}`, monto, Math.round(monto * 3) / 100, instante()));
      }
    }
    for (let k = 0; k < entre(0, 1); k++) {
      devoluciones.push(devolucion({ id: `d${i}_${k}`, ventaId: `v${i}`, monto: entre(10, 300), fecha: instante() }));
    }
  }
  for (let i = 0, n = entre(2, 9); i < n; i++) {
    gastos.push(gasto(`g${i}`, entre(10, 3000) + entre(0, 99) / 100, instante(), {
      grupo: elige(["directo", "operativo", "dueno", "retiro"] as const), ...(sortea() < 0.4 ? { fechaPago: instante() } : {}),
    }));
  }
  const e = { ...estadoDeYari(), ventas, cuotas, pagos, devoluciones, gastos } as unknown as EstadoApp;
  return { e, enElHueco, pagos, devoluciones, gastos };
}

/* El mes como se armaba antes: el mismo, pero terminando en 23:59:59,000. */
const rangoDeAntes = (p: string): RangoMes => {
  const [a, m] = p.split("-").map(Number);
  return { ...rangoDePeriodo(p), hasta: new Date(a, m, 0, 23, 59, 59) };
};

test("mundos al azar con instantes en la última fracción de segundo: lo cobrado, devuelto y gastado de todos los meses suma el total, y los 184 días también", () => {
  let enElHueco = 0;
  for (let semilla = 1; semilla <= 40; semilla++) {
    const { e, enElHueco: n, pagos, devoluciones, gastos } = mundoAlAzar(semilla, true);
    enElHueco += n;
    const porMes = (f: (m: RangoMes) => number) => MESES_DEL_MUNDO.reduce((a, p) => a + f(rangoDePeriodo(p)), 0);
    const cerca = (a: number, b: number, d: string) => assert.ok(Math.abs(a - b) < 1e-6, `semilla ${semilla}: ${d} (${a} contra ${b})`);
    cerca(porMes((m) => calcularPyL(e, m).cobrado), pagos.reduce((a, p) => a + p.monto, 0), "lo cobrado de todos los meses");
    cerca(porMes((m) => calcularPyL(e, m).devoluciones), devoluciones.reduce((a, d) => a + d.monto, 0), "lo devuelto de todos los meses");
    assert.equal(MESES_DEL_MUNDO.reduce((a, p) => a + pagosDelMes(e, rangoDePeriodo(p)).length, 0), pagos.length, `semilla ${semilla}: cantidad de cobros`);
    assert.equal(MESES_DEL_MUNDO.reduce((a, p) => a + devolucionesDelMes(e, rangoDePeriodo(p)).length, 0), devoluciones.length, `semilla ${semilla}: cantidad de devoluciones`);
    assert.equal(MESES_DEL_MUNDO.reduce((a, p) => a + gastosDelMes(e, rangoDePeriodo(p)).length, 0), gastos.length, `semilla ${semilla}: gastos por mes (devengo)`);
    assert.equal(MESES_DEL_MUNDO.reduce((a, p) => a + gastosPagadosEn(e, rangoDePeriodo(p)).length, 0), gastos.length, `semilla ${semilla}: gastos por mes (pago)`);
    /* Día por día, como las columnas del Dashboard. */
    const dias = diasEntre("2026-07-01", "2026-12-31");
    const porDia = dias.reduce((a, d) => a + cashCollected(e, rangoDeFechas(d, d, d)), 0);
    cerca(porDia, pagos.reduce((a, p) => a + p.monto, 0) - devoluciones.reduce((a, d) => a + d.monto, 0), "el Cash Collected de los 184 días");
  }
  assert.ok(enElHueco > 25, `cobertura: ${enElHueco} instantes en la última fracción de segundo`);
});

test("lo que ya andaba da exactamente lo mismo: sin eventos en la última fracción de segundo, el estado de resultados, las comisiones y los gastos pagados no cambian", () => {
  let meses = 0, conPlata = 0;
  for (let semilla = 1; semilla <= 60; semilla++) {
    const { e, enElHueco } = mundoAlAzar(semilla, false);
    assert.equal(enElHueco, 0);
    for (const p of MESES_DEL_MUNDO) {
      const nuevo = rangoDePeriodo(p), antes = rangoDeAntes(p);
      assert.deepEqual(calcularPyL(e, nuevo), calcularPyL(e, antes), `semilla ${semilla}, ${p}: el estado de resultados`);
      assert.deepEqual(comisionesDelMes(e, nuevo), comisionesDelMes(e, antes), `semilla ${semilla}, ${p}: las comisiones`);
      assert.deepEqual(gastosPagadosEn(e, nuevo), gastosPagadosEn(e, antes), `semilla ${semilla}, ${p}: los gastos pagados`);
      assert.deepEqual(devolucionesDelMes(e, nuevo), devolucionesDelMes(e, antes), `semilla ${semilla}, ${p}: las devoluciones`);
      meses++;
      if (calcularPyL(e, nuevo).cobrado > 0) conPlata++;
    }
  }
  assert.ok(meses === 360 && conPlata > 150, `cobertura: ${meses} meses, ${conPlata} con plata`);
});

/* ---------- La liquidación ---------- */

/* Mariano, closer, comisiona el 15%. */
const comisionDeMariano = esquema("c1", [concepto({ id: "k", tipo: "porcentaje", nombre: "Comisión", tasa: 0.15, base: "cash-neto", alcance: "closer" })]);

function estadoDeMariano(cobroEn: string, extra: { hasta?: string } = {}, esq = comisionDeMariano): EstadoApp {
  const venta = {
    id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: aca(2026, 9, 10), moneda: "USD", productoId: "p_ment", closerId: "c1",
    excluidoMarketing: false, estado: "activa", creadoEn: aca(2026, 9, 10), extra: {},
  };
  return estadoDeYari({
    equipo: [miembro("c1", "Mariano", "closer", 0.15, extra)], honorarios: [esq],
    ventas: [venta] as unknown as EstadoApp["ventas"],
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 3000, estado: "pagada", esReserva: false }] as unknown as EstadoApp["cuotas"],
    pagos: [pago("p1", "q1", 1000, 0, cobroEn)], devoluciones: [], gastos: [],
  });
}

const comisionEnFinanzas = (e: EstadoApp, periodo: string) => comisionesDelMes(e, rangoDePeriodo(periodo)).reduce((a, f) => a + f.comisionCloser, 0);
const comisionEnLiquidacion = (e: EstadoApp, periodo: string) =>
  calcularLiquidacion(e, periodo, undefined).personas.find((p) => p.miembroId === "c1")?.lineas.find((l) => l.clave === "k")?.monto ?? 0;

test("liquidación: el cobro de los últimos milisegundos del último día de un closer que se fue lo comisiona la liquidación igual que Finanzas", () => {
  conZona(ARGENTINA, () => {
    for (const ms of [0, 1, 500, 999]) {
      const e = estadoDeMariano(aca(2026, 9, 15, 23, 59, 59, ms), { hasta: "2026-09-15" });
      assert.equal(comisionEnFinanzas(e, "2026-09"), 150, `Finanzas comisiona el cobro de las 23:59:59,${ms}`);
      assert.equal(comisionEnLiquidacion(e, "2026-09"), 150, `la liquidación también (23:59:59,${ms})`);
    }
    /* El cobro de las 00:00 del día siguiente ya no es suyo, ni en una cuenta ni en la otra. */
    const despues = estadoDeMariano(aca(2026, 9, 16, 0, 0, 0, 0), { hasta: "2026-09-15" });
    assert.equal(comisionEnFinanzas(despues, "2026-09"), 0);
    assert.equal(comisionEnLiquidacion(despues, "2026-09"), 0);
  });
});

test("liquidación: un concepto con vigencia hasta el último día del mes mide el mes entero, también su último milisegundo", () => {
  conZona(ARGENTINA, () => {
    const hastaFinDeMes = esquema("c1", [concepto({ id: "k", tipo: "porcentaje", nombre: "Comisión", tasa: 0.15, base: "cash-neto", alcance: "closer", hasta: "2026-09-30" })]);
    for (const ms of [0, 500, 999]) {
      const e = estadoDeMariano(aca(2026, 9, 30, 23, 59, 59, ms), {}, hastaFinDeMes);
      assert.equal(comisionEnFinanzas(e, "2026-09"), 150, `Finanzas (23:59:59,${ms})`);
      assert.equal(comisionEnLiquidacion(e, "2026-09"), 150, `la liquidación (23:59:59,${ms})`);
    }
  });
});

test("vigenciaEnMes: el último día de la vigencia termina en el último milisegundo, y el mes entero termina donde termina el mes", () => {
  const sep = rangoDePeriodo("2026-09");
  const entera = vigenciaEnMes({ hasta: "2026-09-30" }, sep)!;
  assert.equal(entera.rango.hasta.getTime(), sep.hasta.getTime(), "hasta el 30: termina con el mes");
  assert.deepEqual([entera.dias, entera.diasMes], [30, 30]);

  const mitad = vigenciaEnMes({ hasta: "2026-09-15" }, sep)!;
  assert.equal(mitad.rango.hasta.getTime(), new Date(2026, 8, 15, 23, 59, 59, 999).getTime(), "hasta el 15: el último milisegundo del 15");
  assert.equal(mitad.rango.hasta.getTime() + 1, new Date(2026, 8, 16).getTime(), "y el 16 empieza justo después");
  assert.deepEqual([mitad.dias, mitad.diasMes], [15, 30]);

  const desdeElDiez = vigenciaEnMes({ desde: "2026-09-10" }, sep)!;
  assert.equal(desdeElDiez.rango.desde.getTime(), new Date(2026, 8, 10).getTime());
  assert.equal(desdeElDiez.rango.hasta.getTime(), sep.hasta.getTime());
  assert.deepEqual([desdeElDiez.dias, desdeElDiez.diasMes], [21, 30]);

  const unDia = vigenciaEnMes({ desde: "2026-09-15", hasta: "2026-09-15" }, sep)!;
  assert.deepEqual([unDia.rango.desde.getTime(), unDia.rango.hasta.getTime()], [new Date(2026, 8, 15).getTime(), new Date(2026, 8, 15, 23, 59, 59, 999).getTime()]);
  assert.equal(unDia.dias, 1);

  /* Lo que termina antes del mes o empieza después no vale ningún día de él. */
  assert.equal(vigenciaEnMes({ hasta: "2026-08-31" }, sep), null);
  assert.equal(vigenciaEnMes({ desde: "2026-10-01" }, sep), null);
});

/* ---------- Los tres meses cerrados del runway ---------- */

test("runway: un gasto de los últimos milisegundos de cada uno de los tres meses cerrados entra en el promedio", () => {
  const hoy = new Date(2026, 9, 7, 12);
  const e = estadoDeYari({
    pagos: [], devoluciones: [], ventas: [], cuotas: [],
    gastos: [
      gasto("jul", 150, aca(2026, 7, 31, 23, 59, 59, 999), { grupo: "dueno" }),
      gasto("ago", 90, aca(2026, 8, 1, 0, 0, 0, 0)),
      gasto("sep", 300, aca(2026, 9, 30, 23, 59, 59, 500)),
      /* Octubre ya no es un mes cerrado. */
      gasto("oct", 7000, aca(2026, 10, 1, 0, 0, 0, 0)),
      /* Y un retiro no es un costo. */
      gasto("retiro", 9999, aca(2026, 9, 30, 23, 59, 59, 700), { grupo: "retiro" }),
    ],
  });
  const x = runway(e, 5400, hoy);
  assert.equal(x.meses, "jul, ago y sep");
  assert.equal(x.gastoMensual, 180, "(150 + 90 + 300) / 3");
  assert.equal(x.mesesDeVida, 30);
  assert.equal(x.colchon, 1080);
});

/* ---------- Las vías del webinar ---------- */

test("vías del webinar: una agenda de las 23:59:59,5 del día de la venta cuenta para esa venta; la de las 00:00 del día siguiente, no", () => {
  const webinar = {
    id: "w1", titulo: "Webinar 15/09", fecha: "2026-09-15T22:00:00.000Z", duracionMin: 90, estado: "finalizado", registrados: 0, asistentes: 0,
    inversion: 0, formularios: 0, grupoWpp: 0, llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0, llamadasInasistidas: 0,
    llamadasNoCalificadas: 0, llamadasCalificadas: 0, inversionDmAds: 0, costoWhatsappApi: 0, creadoEn: "2026-09-01T12:00:00.000Z", extra: {},
  } as unknown as Webinar;
  const armar = (agendadaEn: string): EstadoApp => ({
    ...estadoDeYari(),
    webinars: [webinar], contactos: [], leads: [],
    ventas: [{
      id: "v1", contactoNombre: "Belén", contactoId: "ct1", precioAcordado: 1000, fecha: "2026-09-16T15:00:00.000Z", moneda: "USD", productoId: "p_ment",
      closerId: "mariano", webinarId: "w1", excluidoMarketing: false, estado: "activa", creadoEn: "2026-09-16T15:00:00.000Z", extra: {},
    }],
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [pago("p1", "q1", 1000, 0, "2026-09-16T16:00:00.000Z")], devoluciones: [],
    sesiones: [{
      id: "s1", titulo: "Llamada", tipo: "Llamada de Asesoramiento - Webinar", invitado: "Belén", inicia: "2026-09-20T15:00:00.000Z", duracionMin: 45,
      estado: "agendada", origen: "calendly", creadoEn: agendadaEn, contactoId: "ct1", extra: {},
      utm: { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20260915", utm_content: "replay" },
    }],
  } as unknown as EstadoApp);

  /* El 16/09 en Argentina termina a las 02:59:59,999Z del 17/09. */
  const justoAntes = rendimientoPorVia(armar("2026-09-17T02:59:59.500Z"), webinar);
  assert.equal(justoAntes.sinAgenda.ventas, 0, "la venta no queda sin agenda");
  assert.equal(numerosDe(justoAntes, "webinar").ventas, 1, "es una venta de la vía del webinar");
  assert.equal(justoAntes.total.ventas, 1);

  const ultimoMs = rendimientoPorVia(armar("2026-09-17T02:59:59.999Z"), webinar);
  assert.equal(numerosDe(ultimoMs, "webinar").ventas, 1, "tampoco el último milisegundo");

  const despues = rendimientoPorVia(armar("2026-09-17T03:00:00.000Z"), webinar);
  assert.equal(despues.sinAgenda.ventas, 1, "la agenda del día siguiente no es de esa venta");
  assert.equal(numerosDe(despues, "webinar").ventas, 0);
  assert.equal(despues.total.ventas, 1, "la venta cuenta una sola vez");
});
