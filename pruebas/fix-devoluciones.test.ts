import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cambioParaDevolver, devolvibleDeVenta, MENSAJE_COMPROBANTE_DEVOLUCION, MENSAJE_PESOS_DEVOLUCION, mediodiaDeNegocio, pesosDeLaDevolucion,
  pesosQueSalieron, problemaDeDevolucion, reversasDeComision,
} from "@/lib/devoluciones";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { saldosEsperados } from "@/lib/traspasos";
import { acciones, fijarAcceso } from "@/lib/store";
import { ACCESO_DUENO } from "@/lib/permisos";
import { estadoVacio } from "@/lib/seed";
import type { Devolucion, EstadoApp } from "@/lib/types";
import { devolucion, miembro, pago } from "./estado-devolucion";

/* ==================================================================
   Arreglos del estrés (lote «dev»): lo que se puede devolver y por qué cuenta.

   1. «Hasta ese día» es hasta el final del día de negocio (Argentina), no hasta
      el instante en que el formulario guarda la fecha (las 12:00).
   2. El tope mira la línea de tiempo completa: en cada día, lo devuelto
      acumulado no pasa de lo cobrado acumulado.
   3. Una devolución por una cuenta en pesos guarda los pesos y el cambio, y la
      cuenta cae a un cambio razonable cuando falta.

   Todos los instantes se arman con el −03:00 de Argentina para que den lo mismo
   en cualquier máquina.
   ================================================================== */

/** Un instante de Argentina: `ar("2026-09-30", "16:00:00")`. */
const ar = (dia: string, hora = "12:00:00", ms = "000") => new Date(`${dia}T${hora}.${ms}-03:00`).toISOString();

/** Una venta (v1) con un cobro por cada [fecha, monto], y las devoluciones que se le pasen. */
function conCobros(cobros: [string, number][], devoluciones: Devolucion[] = []): EstadoApp {
  const cuotas = cobros.map(([, monto], i) => ({ id: `q${i}`, ventaId: "v1", numero: i + 1, monto, estado: "pagada", esReserva: false }));
  const pagos = cobros.map(([fecha, monto], i) => pago(`p${i}`, `q${i}`, monto, 0, fecha));
  return { cuotas, pagos, devoluciones } as unknown as EstadoApp;
}

const intentar = (e: EstadoApp, monto: number, fecha: string, ignorar?: string) =>
  problemaDeDevolucion(e, { ventaId: "v1", monto, fecha, procesadorId: "proc_stripe", tieneComprobante: true }, ignorar);

/* ---------- 1 · «hasta ese día» es hasta el final del día de negocio ---------- */

test("mismo día · un cobro de las 16:00 cuenta para una devolución del mismo día, guardada a las 12:00", () => {
  const e = conCobros([[ar("2026-09-30", "16:00:00"), 1500]]);
  assert.equal(intentar(e, 1500, ar("2026-09-30")), null, "se rechazaba con «no tiene cobros hasta ese día»");
  assert.deepEqual(devolvibleDeVenta(e, "v1", ar("2026-09-30")), { cobrado: 1500, devuelto: 0, queda: 1500 });
  /* Tampoco importa a qué hora del día se mire: es el mismo día. */
  for (const hora of ["00:00:00", "08:00:00", "23:59:59"]) {
    assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-30", hora)).cobrado, 1500, hora);
  }
});

test("mismo día · el día es el de Argentina, no el de UTC: un cobro de las 22:00 (ya es el día siguiente en UTC) es de su día", () => {
  const e = conCobros([[ar("2026-09-30", "22:00:00"), 1000]]);
  assert.equal(ar("2026-09-30", "22:00:00").slice(0, 10), "2026-10-01", "en UTC ya es el 1° de octubre");
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-30")).cobrado, 1000);
  assert.equal(intentar(e, 1000, ar("2026-09-30")), null);
  /* Y una devolución del 29/09 no lo ve. */
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-29", "23:59:59", "999")).cobrado, 0);
});

test("mismo día · cuenta hasta el último milisegundo del día y no el primero del siguiente", () => {
  const e = conCobros([[ar("2026-09-30", "23:59:59", "999"), 700], [ar("2026-10-01", "00:00:00", "000"), 300]]);
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-30")).cobrado, 700);
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-10-01")).cobrado, 1000);
  assert.match(intentar(conCobros([[ar("2026-10-01", "00:00:00"), 300]]), 300, ar("2026-09-30"))!, /no tiene cobros hasta ese día/);
});

test("mismo día · lo ya devuelto el mismo día también cuenta, a la hora que se haya cargado", () => {
  const e = conCobros([[ar("2026-10-02", "09:00:00"), 1000]], [devolucion({ id: "a", monto: 400, fecha: ar("2026-10-02", "18:30:00") })]);
  assert.deepEqual(devolvibleDeVenta(e, "v1", ar("2026-10-02")), { cobrado: 1000, devuelto: 400, queda: 600 });
  assert.equal(intentar(e, 600, ar("2026-10-02")), null);
  assert.match(intentar(e, 601, ar("2026-10-02"))!, /No se puede devolver más de lo cobrado: quedan US\$ 600 para devolver/);
});

const equipo = [miembro("c1", "Closer", "closer", 0.1)];
const ventaV1 = {
  id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: ar("2026-09-28"), moneda: "USD", closerId: "c1",
  excluidoMarketing: false, estado: "activa", creadoEn: ar("2026-09-28"), extra: {},
};
const conVenta = (e: EstadoApp) => ({ ...e, equipo, ventas: [ventaV1], honorarios: [], gastos: [], sesiones: [], liquidaciones: [] }) as unknown as EstadoApp;

test("mismo día · la reversa de comisión incluye los cobros del día de la devolución, a la hora que sean", () => {
  /* 1.500 el 28/09 a las 10:00 y 1.500 el 03/10 a las 16:00; se devuelven los 3.000 el 03/10 (a las 12:00 del formulario). */
  const cobros: [string, number][] = [[ar("2026-09-28", "10:00:00"), 1500], [ar("2026-10-03", "16:00:00"), 1500]];
  const [rv] = reversasDeComision(conVenta(conCobros(cobros, [devolucion({ id: "d1", monto: 3000, fecha: ar("2026-10-03") })])));
  assert.equal(rv.cobradoVenta, 3000);
  assert.equal(rv.parte, 1);
  const closer = rv.partes.find((p) => p.miembroId === "c1")!;
  assert.equal(closer.comision, 300, "se le comisionó 150 + 150");
  assert.equal(closer.reversa, 300, "revertía 150 de 300: el cobro de la tarde no entraba");
  /* La misma devolución al día siguiente revierte lo mismo: la hora del cobro no cambia nada. */
  const [dia1] = reversasDeComision(conVenta(conCobros(cobros, [devolucion({ id: "d1", monto: 3000, fecha: ar("2026-10-04") })])));
  assert.equal(dia1.partes.find((p) => p.miembroId === "c1")!.reversa, 300);
});

test("mismo día · una devolución del 03/10 no ve un cobro del 04/10 por temprano que sea", () => {
  const cobros: [string, number][] = [[ar("2026-09-28", "10:00:00"), 1500], [ar("2026-10-04", "00:00:00", "001"), 1500]];
  const [rv] = reversasDeComision(conVenta(conCobros(cobros, [devolucion({ id: "d1", monto: 1500, fecha: ar("2026-10-03", "23:59:59", "999") })])));
  assert.equal(rv.cobradoVenta, 1500);
  assert.equal(rv.partes.find((p) => p.miembroId === "c1")!.reversa, 150);
});

test("mismo día · la ficha de la venta (ahora) y el formulario (las 12:00 del día) dicen lo mismo", () => {
  /* Hoy es el 07/10 a las 20:00 y el cobro entró a las 18:00: la ficha lo contaba y el formulario no. */
  const ahora = ar("2026-10-07", "20:00:00");
  const e = conCobros([[ar("2026-10-07", "18:00:00"), 1500]]);
  const ficha = devolvibleDeVenta(e, "v1", ahora);
  const formulario = devolvibleDeVenta(e, "v1", mediodiaDeNegocio("2026-10-07"));
  assert.deepEqual(formulario, ficha);
  assert.equal(formulario.queda, 1500);
});

test("mismo día · el formulario guarda las 12:00 de Argentina del día elegido, y ese día se lee igual desde cualquier zona", () => {
  assert.equal(mediodiaDeNegocio("2026-09-30"), "2026-09-30T15:00:00.000Z");
  assert.equal(mediodiaDeNegocio("2026-03-01"), "2026-03-01T15:00:00.000Z", "sin horario de verano");
  for (let d = new Date("2026-01-01T12:00:00Z"); d.getUTCFullYear() === 2026; d = new Date(d.getTime() + 86400000)) {
    const dia = d.toISOString().slice(0, 10);
    assert.equal(diaDeNegocio(mediodiaDeNegocio(dia)), dia, dia);
  }
});

/* ---------- 2 · el tope mira la línea de tiempo completa ---------- */

/** El caso del estrés: una venta de US$ 3.000 cobrada el 01/10 y devuelta por completo el 10/10. */
const cobradaYDevuelta = () => conCobros([[ar("2026-10-01", "10:00:00"), 3000]], [devolucion({ id: "a", monto: 3000, fecha: ar("2026-10-10") })]);

test("tope · cargar una devolución con fecha ANTERIOR a otra ya cargada cuenta la de después (no se devuelve dos veces lo mismo)", () => {
  const e = cobradaYDevuelta();
  const mal = intentar(e, 3000, ar("2026-10-05"));
  assert.match(mal!, /No se puede devolver más de lo cobrado/);
  assert.match(mal!, /10\/10\/2026/, "dice con qué devolución choca");
  assert.match(mal!, /quedan US\$ 0 para devolver/);
  /* Una más chica tampoco entra: ya no queda nada. */
  assert.notEqual(intentar(e, 0.05, ar("2026-10-05")), null);
  /* Después de la otra, o el mismo día, ya se rechazaba. */
  assert.notEqual(intentar(e, 3000, ar("2026-10-12")), null);
  assert.notEqual(intentar(e, 3000, ar("2026-10-10")), null);
});

test("tope · lo que queda con una devolución de después es lo que sobra en el día que más aprieta", () => {
  /* Cobros de 1.000 el 01/10 y el 03/10; ya está cargada la A de 1.500 del 04/10. */
  const e = conCobros(
    [[ar("2026-10-01"), 1000], [ar("2026-10-03"), 1000]],
    [devolucion({ id: "a", monto: 1500, fecha: ar("2026-10-04") })],
  );
  /* El 02/10 se cobró 1.000, pero de ahí a la A de 1.500 sólo sobran 500 (2.000 cobrados al 04/10). */
  const dev = devolvibleDeVenta(e, "v1", ar("2026-10-02"));
  assert.deepEqual(dev, { cobrado: 1000, devuelto: 0, queda: 500, limitadaPor: { dia: "2026-10-04", cobrado: 2000, devuelto: 1500 } });
  assert.equal(intentar(e, 500, ar("2026-10-02")), null, "justo lo que sobra");
  assert.match(intentar(e, 600, ar("2026-10-02"))!, /hasta el 04\/10\/2026 ya hay devoluciones por US\$ 1\.500 y se cobró US\$ 2\.000; quedan US\$ 500 para devolver/);
  /* Entre el 03/10 y el 04/10 sobra lo mismo; después de la A, lo que sobra es lo de siempre. */
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-10-03")).queda, 500);
  assert.deepEqual(devolvibleDeVenta(e, "v1", ar("2026-10-05")), { cobrado: 2000, devuelto: 1500, queda: 500 });
});

test("tope · la propuesta simple (restar todas las otras sin mirar la fecha) rechazaría un caso válido: acá se acepta", () => {
  /* Cobros de 1.000 en t1 y en t3, devolución A de 1.500 en t4 y se carga B de 400 en t2. */
  const e = conCobros(
    [[ar("2026-10-01"), 1000], [ar("2026-10-03"), 1000]],
    [devolucion({ id: "a", monto: 1500, fecha: ar("2026-10-04") })],
  );
  assert.equal(intentar(e, 400, ar("2026-10-02")), null, "400 el 02/10 y 1.500 el 04/10: 1.900 de 2.000 al final, 400 de 1.000 antes");
});

test("tope · corregir hacia arriba una devolución con fecha anterior también cuenta la de después", () => {
  const e = conCobros(
    [[ar("2026-10-01", "10:00:00"), 3000]],
    [devolucion({ id: "a", monto: 1000, fecha: ar("2026-10-10") }), devolucion({ id: "b", monto: 1000, fecha: ar("2026-10-05") })],
  );
  assert.notEqual(intentar(e, 3000, ar("2026-10-05"), "b"), null, "quedaría devuelto 4.000 de 3.000");
  assert.equal(intentar(e, 2000, ar("2026-10-05"), "b"), null, "con 2.000 el 05/10 y 1.000 el 10/10 da justo 3.000");
  assert.notEqual(intentar(e, 2001, ar("2026-10-05"), "b"), null);
  /* Pasarla de día también se mira: del 05/10 a después de la A no hay lugar para 2.500. */
  assert.notEqual(intentar(e, 2500, ar("2026-10-12"), "b"), null);
  assert.equal(intentar(e, 2000, ar("2026-10-12"), "b"), null);
});

test("tope · el caso realista: se confirma la de la pasarela (07/10) y después se carga a mano la misma con la fecha en que se hizo (05/10)", () => {
  const e = conCobros(
    [[ar("2026-10-01", "10:00:00"), 3000]],
    [devolucion({ id: "dev_stripe_re_1", monto: 3000, fecha: ar("2026-10-07"), referencia: "stripe:re_1", proveedor: "stripe" })],
  );
  assert.match(intentar(e, 3000, ar("2026-10-05"))!, /No se puede devolver más de lo cobrado/);
});

test("tope · en cualquier orden de carga se aceptan las mismas devoluciones cuando la línea de tiempo es válida", () => {
  /* Dos cobros de 1.500 (01/10 y 08/10) y dos devoluciones de 1.500 (05/10 y 10/10): las dos órdenes son legítimas. */
  const cobros: [string, number][] = [[ar("2026-10-01"), 1500], [ar("2026-10-08"), 1500]];
  const primera = devolucion({ id: "a", monto: 1500, fecha: ar("2026-10-05") });
  const segunda = devolucion({ id: "b", monto: 1500, fecha: ar("2026-10-10") });
  assert.equal(intentar(conCobros(cobros, [primera]), 1500, ar("2026-10-10")), null, "en orden");
  assert.equal(intentar(conCobros(cobros, [segunda]), 1500, ar("2026-10-05")), null, "al revés");
  /* Y una tercera no entra en ninguna fecha. */
  const las2 = conCobros(cobros, [primera, segunda]);
  for (const dia of ["2026-10-02", "2026-10-06", "2026-10-09", "2026-10-11"]) assert.notEqual(intentar(las2, 1, ar(dia)), null, dia);
});

test("tope · lo devuelto el mismo día suma entero sin importar el orden ni la hora", () => {
  const e = conCobros([[ar("2026-10-02", "12:00:00"), 1000]], [devolucion({ id: "a", monto: 600, fecha: ar("2026-10-02", "15:00:00") })]);
  assert.equal(intentar(e, 400, ar("2026-10-02", "09:00:00")), null, "antes de la hora de la otra");
  assert.notEqual(intentar(e, 401, ar("2026-10-02", "09:00:00")), null);
});

test("tope · una propuesta de la pasarela o una ignorada no limitan a la que se carga", () => {
  const e = conCobros([[ar("2026-10-01"), 3000]], [
    devolucion({ id: "p", monto: 3000, fecha: ar("2026-10-10"), estado: "propuesta" }),
    devolucion({ id: "i", monto: 3000, fecha: ar("2026-10-10"), estado: "ignorada" }),
  ]);
  assert.equal(intentar(e, 3000, ar("2026-10-05")), null);
  assert.deepEqual(devolvibleDeVenta(e, "v1", ar("2026-10-05")), { cobrado: 3000, devuelto: 0, queda: 3000 });
});

test("tope · las devoluciones de otra venta no cuentan", () => {
  const e = conCobros([[ar("2026-10-01"), 3000]], [devolucion({ id: "x", ventaId: "v2", monto: 3000, fecha: ar("2026-10-10") })]);
  assert.equal(intentar(e, 3000, ar("2026-10-05")), null);
});

test("tope · corregir sin subir el monto ni cambiar el día se deja pasar aunque la venta ya tenga devoluciones de más (si no, no se podrían arreglar)", () => {
  /* Antes del arreglo se cargaron las dos: 6.000 devueltos de una venta de 3.000. */
  const e = conCobros(
    [[ar("2026-10-01", "10:00:00"), 3000]],
    [devolucion({ id: "a", monto: 3000, fecha: ar("2026-10-10") }), devolucion({ id: "b", monto: 3000, fecha: ar("2026-10-05") })],
  );
  assert.equal(intentar(e, 3000, ar("2026-10-05"), "b"), null, "la misma, por si sólo se le cambia el medio o el comprobante");
  assert.equal(intentar(e, 3000, ar("2026-10-05", "18:00:00"), "b"), null, "a otra hora del mismo día");
  assert.equal(intentar(e, 1000, ar("2026-10-05"), "b"), null, "bajarle el monto");
  assert.equal(intentar(e, 3000, ar("2026-10-10"), "a"), null, "la de después, igual");
  /* Subirla o cambiarle el día no: empeora. */
  assert.notEqual(intentar(e, 3001, ar("2026-10-05"), "b"), null);
  assert.notEqual(intentar(e, 3000, ar("2026-10-06"), "b"), null);
  /* Y una nueva, tampoco: ya hay de más. */
  assert.notEqual(intentar(e, 1, ar("2026-10-03")), null);
  /* Se arreglan de a una: bajando la B a 1.000, la A a 2.000. */
  const arreglada = conCobros([[ar("2026-10-01", "10:00:00"), 3000]], [devolucion({ id: "a", monto: 3000, fecha: ar("2026-10-10") }), devolucion({ id: "b", monto: 1000, fecha: ar("2026-10-05") })]);
  assert.equal(intentar(arreglada, 2000, ar("2026-10-10"), "a"), null);
});

test("tope · una propuesta que se confirma (no está confirmada todavía) no se salta el tope por «corregir»", () => {
  const e = conCobros([[ar("2026-10-01"), 1000]], [devolucion({ id: "p", monto: 5000, fecha: ar("2026-10-05"), estado: "propuesta" })]);
  assert.notEqual(intentar(e, 5000, ar("2026-10-05"), "p"), null);
});

/* ---------- La línea de tiempo contra un oráculo hecho a mano ---------- */

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
    baraja: <T,>(xs: readonly T[]): T[] => {
      const ys = [...xs];
      for (let i = ys.length - 1; i > 0; i--) { const j = Math.floor(siguiente() * (i + 1)); [ys[i], ys[j]] = [ys[j], ys[i]]; }
      return ys;
    },
  };
}

/* Los 14 días de la ventana, uno por uno: el oráculo los recorre todos, sin atajos. */
const DIAS = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
interface Hecho { dia: string; hora: number; centavos: number; min?: number }
const hechoAr = (h: Hecho) => ar(h.dia, `${String(h.hora).padStart(2, "0")}:${String(h.min ?? 30).padStart(2, "0")}:00`);
const hasta = (xs: Hecho[], dia: string) => xs.filter((x) => x.dia <= dia).reduce((a, x) => a + x.centavos, 0);

/** Lo más que se puede devolver el día `dia`: el que sobre en cada día de ahí en adelante, mirándolos todos. */
function maximo(cobros: Hecho[], devs: Hecho[], dia: string): number {
  let max = Infinity;
  for (const d of DIAS) if (d >= dia) max = Math.min(max, hasta(cobros, d) - hasta(devs, d));
  return Math.max(0, max);
}

const aEstado = (cobros: Hecho[], devs: Hecho[]) =>
  conCobros(cobros.map((c) => [hechoAr(c), c.centavos / 100] as [string, number]), devs.map((d, i) => devolucion({ id: `d${i}`, monto: d.centavos / 100, fecha: hechoAr(d) })));

test("tope · contra un oráculo que recorre todos los días: se acepta exactamente lo que deja la línea de tiempo válida (400 ventas al azar)", () => {
  let aceptadas = 0, rechazadasPorDespues = 0, corregidas = 0;
  for (let semilla = 1; semilla <= 400; semilla++) {
    const r = azar(semilla);
    const cobros: Hecho[] = Array.from({ length: r.entre(1, 4) }, () => ({ dia: r.elige(DIAS.slice(0, 9)), hora: r.entre(0, 23), centavos: r.entre(1000, 90000) }));
    const devs: Hecho[] = [];
    for (let i = 0; i < 9; i++) {
      const dia = r.elige(DIAS);
      const corrige = devs.length > 0 && r.si(0.25) ? r.entre(0, devs.length - 1) : -1;
      const otras = devs.filter((_, k) => k !== corrige);
      const max = maximo(cobros, otras, dia);
      let centavos = r.elige([max, max + 2, max + 500, Math.max(1, max - 1), Math.max(1, Math.floor(max / 2)), 1, r.entre(1, 100000)]);
      /* Cero no es una devolución, y un centavo de más entra por la tolerancia de redondeo (0,01): ese borde no se prueba con decimales de float. */
      if (centavos < 1 || centavos === max + 1) centavos = max + 2;
      const hecho: Hecho = { dia, hora: r.elige([12, 12, 0, 9, 23]), centavos };
      const e = aEstado(cobros, devs);
      const mal = intentar(e, centavos / 100, hechoAr(hecho), corrige >= 0 ? `d${corrige}` : undefined);
      const debeEntrar = centavos <= max;
      assert.equal(mal === null, debeEntrar, `semilla ${semilla} · paso ${i} · ${hecho.dia} ${centavos / 100} (máximo ${max / 100}): ${mal}`);
      if (mal === null) {
        aceptadas++;
        if (corrige >= 0) { devs[corrige] = hecho; corregidas++; } else devs.push(hecho);
      } else if (/hasta el/.test(mal)) rechazadasPorDespues++;
      /* El invariante, día por día, con las que están. */
      for (const d of DIAS) assert.ok(hasta(devs, d) <= hasta(cobros, d), `semilla ${semilla} · ${d}: devuelto ${hasta(devs, d)} > cobrado ${hasta(cobros, d)}`);
    }
  }
  assert.ok(aceptadas > 1200 && rechazadasPorDespues > 100 && corregidas > 100, `cobertura: ${aceptadas} aceptadas, ${rechazadasPorDespues} rechazadas por una de después, ${corregidas} correcciones`);
});

test("tope · lo que queda por devolver coincide con el oráculo en cualquier día, con devoluciones antes y después", () => {
  for (let semilla = 1; semilla <= 80; semilla++) {
    const r = azar(semilla * 7);
    const cobros: Hecho[] = Array.from({ length: r.entre(1, 4) }, () => ({ dia: r.elige(DIAS.slice(0, 9)), hora: r.entre(0, 23), centavos: r.entre(1000, 90000) }));
    const devs: Hecho[] = [];
    for (let i = 0; i < 6; i++) {
      const dia = r.elige(DIAS);
      const centavos = r.entre(1, Math.max(1, maximo(cobros, devs, dia)));
      if (maximo(cobros, devs, dia) > 0) devs.push({ dia, hora: 12, centavos });
    }
    const e = aEstado(cobros, devs);
    for (const dia of DIAS) {
      const d = devolvibleDeVenta(e, "v1", ar(dia));
      assert.equal(Math.round(d.queda * 100), maximo(cobros, devs, dia), `semilla ${semilla} · ${dia}`);
      assert.equal(Math.round(d.cobrado * 100), hasta(cobros, dia), `semilla ${semilla} · ${dia} · cobrado`);
      assert.equal(Math.round(d.devuelto * 100), hasta(devs, dia), `semilla ${semilla} · ${dia} · devuelto`);
    }
  }
});

test("tope · el orden en que se cargan no importa: un conjunto válido entra entero en cualquier orden", () => {
  let conjuntos = 0;
  for (let semilla = 1; semilla <= 120; semilla++) {
    const r = azar(semilla * 13);
    const cobros: Hecho[] = Array.from({ length: r.entre(1, 4) }, () => ({ dia: r.elige(DIAS.slice(0, 9)), hora: r.entre(0, 23), centavos: r.entre(1000, 90000) }));
    const valido: Hecho[] = [];
    for (let i = 0; i < 6; i++) {
      const dia = r.elige(DIAS);
      const max = maximo(cobros, valido, dia);
      if (max > 0) valido.push({ dia, hora: 12, centavos: r.entre(1, max) });
    }
    if (valido.length < 2) continue;
    conjuntos++;
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const cargadas: Hecho[] = [];
      for (const h of r.baraja(valido)) {
        const mal = intentar(aEstado(cobros, cargadas), h.centavos / 100, hechoAr(h));
        assert.equal(mal, null, `semilla ${semilla} · vuelta ${vuelta} · ${h.dia} ${h.centavos / 100}: ${mal}`);
        cargadas.push(h);
      }
    }
  }
  assert.ok(conjuntos > 80, `cobertura: ${conjuntos} conjuntos`);
});

/* ---------- Lo que ya andaba da exactamente lo mismo ---------- */

/** La cuenta de antes (por instante, sin mirar las devoluciones de después). */
function devolvibleDeAntes(e: EstadoApp, ventaId: string, hastaIso: string, ignorar?: string) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const cuotas = new Set(e.cuotas.filter((c) => c.ventaId === ventaId).map((c) => c.id));
  const t = Date.parse(hastaIso);
  const cobrado = r2(e.pagos.filter((p) => cuotas.has(p.cuotaId) && Date.parse(p.fecha) <= t).reduce((a, p) => a + p.monto, 0));
  const devuelto = r2(e.devoluciones.filter((d) => d.ventaId === ventaId && (d.estado ?? "confirmada") === "confirmada" && d.id !== ignorar && Date.parse(d.fecha) <= t).reduce((a, d) => a + d.monto, 0));
  return { cobrado, devuelto, queda: Math.max(0, r2(cobrado - devuelto)) };
}

test("lo que ya andaba (devoluciones en orden, después de todos los cobros del día) da exactamente los mismos números que antes", () => {
  let comparados = 0;
  for (let semilla = 1; semilla <= 150; semilla++) {
    const r = azar(semilla * 31);
    /* Cobros de la mañana, así que a las 12:00 de su día (o después) ya entraron en las dos cuentas. */
    const cobros: Hecho[] = Array.from({ length: r.entre(1, 4) }, () => ({ dia: r.elige(DIAS.slice(0, 6)), hora: r.entre(0, 11), centavos: r.entre(1000, 90000) }));
    const ultimo = cobros.map((c) => c.dia).sort().at(-1)!;
    let desde = DIAS.indexOf(ultimo);
    const devs: Hecho[] = [];
    for (let i = 0; i < 5; i++) {
      desde = Math.min(DIAS.length - 1, desde + r.entre(0, 2));
      const dia = DIAS[desde];
      const devuelto = hasta(devs, dia), cobrado = hasta(cobros, dia);
      if (cobrado - devuelto <= 0) break;
      /* A las 12:00 de cada día, como el formulario. */
      const hecho: Hecho = { dia, hora: 12, min: 0, centavos: r.entre(1, cobrado - devuelto) };
      const e = aEstado(cobros, devs);
      const mio = (e: EstadoApp, dia: string) => devolvibleDeVenta(e, "v1", ar(dia, "12:00:00"));
      assert.deepEqual(mio(e, dia), devolvibleDeAntes(e, "v1", ar(dia, "12:00:00")), `semilla ${semilla} · ${dia}`);
      devs.push(hecho);
      comparados++;
    }
  }
  assert.ok(comparados > 300, `cobertura: ${comparados}`);
});

/* ---------- 3 · devolver por una cuenta en pesos ---------- */

/** El caso del estrés: un cobro de US$ 1.000 por la Financiera (en pesos) a 1.500, con sus 1.500.000 pesos. */
const cobroEnPesos = (id: string, cuotaId: string, monto: number, tipoCambio: number | undefined, fecha: string, extra: Record<string, unknown> = {}) =>
  ({ ...pago(id, cuotaId, monto, 0, fecha, "proc_fin"), ...(tipoCambio ? { tipoCambio, montoArs: Math.round(monto * tipoCambio) } : {}), ...extra });

const cuentas = [
  { id: "proc_fin", nombre: "Financiera ARS", moneda: "ARS", feeRate: 0, activo: true, automatico: false },
  { id: "proc_stripe", nombre: "Stripe", moneda: "USD", feeRate: 0.029, activo: true, automatico: false },
];

function conPesos(pagos: unknown[], devoluciones: Devolucion[], ajustes: Record<string, unknown> = { monedaBase: "USD", tipoCambio: 1450 }): EstadoApp {
  return {
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }, { id: "q2", ventaId: "v1", numero: 2, monto: 1000, estado: "pagada", esReserva: false }],
    pagos, devoluciones, gastos: [], traspasos: [], procesadores: cuentas, ajustes,
  } as unknown as EstadoApp;
}
const previo = { fecha: ar("2026-09-01"), saldos: [{ procesadorId: "proc_fin", monto: 0, moneda: "ARS", montoBase: 0 }, { procesadorId: "proc_stripe", monto: 0, moneda: "USD", montoBase: 0 }] } as unknown as Parameters<typeof saldosEsperados>[1];
const fin = (e: EstadoApp) => saldosEsperados(e, previo, ar("2026-09-30", "23:00:00")).get("proc_fin")!;

test("pesos · una devolución sin montoArs ni tipoCambio por una cuenta en pesos sale de esa cuenta, al cambio del cobro", () => {
  const e = conPesos([cobroEnPesos("p1", "q1", 1000, 1500, ar("2026-09-12", "10:00:00"))], [devolucion({ id: "d1", monto: 400, fecha: ar("2026-09-20"), procesadorId: "proc_fin" })]);
  const s = fin(e);
  assert.equal(s.entro, 1_500_000);
  assert.equal(s.salio, 600_000, "400 × 1.500; antes quedaba en 0 y el arqueo de la cuenta tenía una diferencia permanente");
  assert.equal(s.esperado, 900_000);
});

test("pesos · lo que trae la devolución manda sobre cualquier cambio de afuera (montoArs, y si no, monto × tipoCambio)", () => {
  const cobro = cobroEnPesos("p1", "q1", 1000, 1500, ar("2026-09-12", "10:00:00"));
  const sale = (extra: Partial<Devolucion>) => fin(conPesos([cobro], [devolucion({ id: "d1", monto: 400, fecha: ar("2026-09-20"), procesadorId: "proc_fin", ...extra })])).salio;
  assert.equal(sale({ montoArs: 610_000, tipoCambio: 1525 }), 610_000);
  assert.equal(sale({ tipoCambio: 1400 }), 560_000);
  assert.equal(sale({ montoArs: 610_000 }), 610_000);
});

test("pesos · sin un cobro de esa venta por esa cuenta, cae al tipo de cambio de Ajustes", () => {
  /* Se cobró por Stripe (dólares) y se devolvió por la Financiera. */
  const e = conPesos([pago("p1", "q1", 1000, 0, ar("2026-09-12", "10:00:00"))], [devolucion({ id: "d1", monto: 100, fecha: ar("2026-09-20"), procesadorId: "proc_fin" })]);
  assert.equal(fin(e).salio, 145_000, "100 × 1.450 (Ajustes)");
  /* Y sin Ajustes ni cobro no hay de dónde: no se inventa nada (como antes). */
  assert.equal(fin(conPesos([pago("p1", "q1", 1000, 0, ar("2026-09-12"))], [devolucion({ id: "d1", monto: 100, fecha: ar("2026-09-20"), procesadorId: "proc_fin" })], { monedaBase: "USD", tipoCambio: 0 })).salio, 0);
});

test("pesos · una cuenta en dólares, una propuesta y una devolución fuera del rango no cambian", () => {
  const cobro = cobroEnPesos("p1", "q1", 1000, 1500, ar("2026-09-12", "10:00:00"));
  const e = conPesos([cobro, pago("p2", "q2", 500, 0, ar("2026-09-13", "10:00:00"))], [
    devolucion({ id: "usd", monto: 200, fecha: ar("2026-09-20"), procesadorId: "proc_stripe" }),
    devolucion({ id: "prop", monto: 100, fecha: ar("2026-09-21"), procesadorId: "proc_fin", estado: "propuesta" }),
    devolucion({ id: "ign", monto: 100, fecha: ar("2026-09-21"), procesadorId: "proc_fin", estado: "ignorada" }),
    devolucion({ id: "despues", monto: 100, fecha: ar("2026-10-02"), procesadorId: "proc_fin" }),
  ]);
  const todas = saldosEsperados(e, previo, ar("2026-09-30", "23:00:00"));
  assert.equal(todas.get("proc_stripe")!.salio, 200, "en dólares, el monto entero");
  assert.equal(todas.get("proc_fin")!.salio, 0);
});

test("pesos · el cambio que se propone: el del último cobro de esa venta por esa cuenta, y si no hay, el de Ajustes", () => {
  const e = conPesos([
    cobroEnPesos("p1", "q1", 1000, 1400, ar("2026-09-01", "10:00:00")),
    cobroEnPesos("p2", "q2", 1000, 1500, ar("2026-09-12", "10:00:00")),
    cobroEnPesos("pOtra", "qX", 1000, 9999, ar("2026-09-15", "10:00:00")),
    { ...cobroEnPesos("pStripe", "q1", 1000, 7777, ar("2026-09-20", "10:00:00")), procesadorId: "proc_stripe" },
  ], []);
  assert.deepEqual(cambioParaDevolver(e, "v1", "proc_fin"), { tipoCambio: 1500, fuente: "cobro" }, "el último, no el primero ni el de otra venta ni el de otra cuenta");
  assert.deepEqual(cambioParaDevolver(e, "v1", "proc_stripe"), { tipoCambio: 7777, fuente: "cobro" });
  assert.deepEqual(cambioParaDevolver(e, "v1", "proc_otra"), { tipoCambio: 1450, fuente: "ajustes" });
  assert.deepEqual(cambioParaDevolver(e, undefined, "proc_fin"), { tipoCambio: 1450, fuente: "ajustes" });
  assert.equal(cambioParaDevolver({ ...e, ajustes: { monedaBase: "USD", tipoCambio: 0 } } as unknown as EstadoApp, "v1", "proc_otra"), undefined);
  /* Un cobro que sólo trae los pesos da el cambio que resulta. */
  const soloPesos = conPesos([{ ...pago("p1", "q1", 800, 0, ar("2026-09-12"), "proc_fin"), montoArs: 1_240_000 }], []);
  assert.deepEqual(cambioParaDevolver(soloPesos, "v1", "proc_fin"), { tipoCambio: 1550, fuente: "cobro" });
  /* Sin tocar lo que se mira. */
  const congelado = JSON.parse(JSON.stringify(e)) as EstadoApp;
  const antes = JSON.stringify(congelado);
  cambioParaDevolver(congelado, "v1", "proc_fin");
  assert.equal(JSON.stringify(congelado), antes);
});

test("pesos · los pesos de la devolución: monto × cambio, o los que escribió quien carga (y entonces el cambio es el que resulta)", () => {
  assert.deepEqual(pesosDeLaDevolucion(400, 1500), { montoArs: 600_000, tipoCambio: 1500 });
  assert.deepEqual(pesosDeLaDevolucion(400, 1500, 612_000), { montoArs: 612_000, tipoCambio: 1530 });
  assert.deepEqual(pesosDeLaDevolucion(333.33, 1500), { montoArs: 499_995, tipoCambio: 1500 });
  assert.deepEqual(pesosDeLaDevolucion(3, undefined, 4_000), { montoArs: 4_000, tipoCambio: 1333.3333 });
  /* Escribió algo que no es plata, o lo vació: faltan los pesos, no se usa el cambio por la espalda. */
  assert.deepEqual(pesosDeLaDevolucion(400, 1500, Number.NaN), {});
  assert.deepEqual(pesosDeLaDevolucion(400, 1500, 0), {});
  /* Sin monto o sin cambio ni pesos, no hay con qué. */
  assert.deepEqual(pesosDeLaDevolucion(0, 1500), {});
  assert.deepEqual(pesosDeLaDevolucion(400), {});
});

test("pesos · los pesos que salieron de una devolución, con todos los caminos", () => {
  const e = conPesos([cobroEnPesos("p1", "q1", 1000, 1500, ar("2026-09-12"))], []);
  const d = (extra: Partial<Devolucion>) => pesosQueSalieron(e, devolucion({ id: "d", monto: 400, fecha: ar("2026-09-20"), procesadorId: "proc_fin", ...extra }));
  assert.equal(d({ montoArs: 1 }), 1);
  assert.equal(d({ tipoCambio: 1000 }), 400_000);
  assert.equal(d({}), 600_000);
  assert.equal(d({ ventaId: "v9" }), 400 * 1450, "de otra venta: Ajustes");
  assert.ok(Number.isNaN(pesosQueSalieron({ pagos: [] }, devolucion({ id: "d", monto: 400, fecha: ar("2026-09-20"), procesadorId: "proc_fin" }))), "sin nada de dónde sacarlo");
});

test("pesos · el formulario no deja guardar sin los pesos, después del tope y antes del comprobante", () => {
  const e = conCobros([[ar("2026-10-01"), 1000]]);
  const b = { ventaId: "v1", monto: 400, fecha: ar("2026-10-05"), procesadorId: "proc_fin", tieneComprobante: false, sinPesos: true };
  assert.equal(problemaDeDevolucion(e, b), MENSAJE_PESOS_DEVOLUCION);
  assert.equal(problemaDeDevolucion(e, { ...b, sinPesos: false }), MENSAJE_COMPROBANTE_DEVOLUCION);
  assert.equal(problemaDeDevolucion(e, { ...b, sinPesos: false, tieneComprobante: true }), null);
  assert.match(problemaDeDevolucion(e, { ...b, monto: 2000 })!, /No se puede devolver más de lo cobrado/, "primero lo de más arriba en la pantalla");
  /* Una cuenta en dólares no manda sinPesos y anda como siempre. */
  assert.equal(problemaDeDevolucion(e, { ventaId: "v1", monto: 400, fecha: ar("2026-10-05"), procesadorId: "proc_stripe", tieneComprobante: true }), null);
});

test("pesos · de punta a punta con el store: lo que guarda el formulario resta de la Financiera, y si se pasa a dólares se borran los pesos", () => {
  const e = {
    ...estadoVacio(),
    equipo: [{ id: "c1", nombre: "Closer", rol: "closer", comisionRate: 0.1, activo: true, sinComision: false }],
    ventas: [{ id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: ar("2026-09-10"), moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: ar("2026-09-10"), extra: {} }],
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pendiente", esReserva: false }],
    actividad: [], gastos: [],
  } as unknown as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
  fijarAcceso(ACCESO_DUENO);
  assert.equal(acciones.registrarPago({
    cuotaId: "q1", reajuste: "pendiente",
    cobros: [{ procesadorId: "proc_financiera_ars", monto: 1000, fecha: ar("2026-09-12", "10:00:00"), tipoCambio: 1500, montoArs: 1_500_000, pagador: "Belén", cuit: "27-12345678-4" }],
  }), true);
  const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;

  /* Lo que arma el formulario: el cambio propuesto del cobro y los pesos que salen de ahí. */
  const propuesto = cambioParaDevolver(hoy(), "v1", "proc_financiera_ars");
  const pesos = pesosDeLaDevolucion(400, propuesto?.tipoCambio);
  assert.deepEqual(pesos, { montoArs: 600_000, tipoCambio: 1500 });
  const id = acciones.registrarDevolucion({ ventaId: "v1", monto: 400, fecha: ar("2026-09-20"), procesadorId: "proc_financiera_ars", noDescontarAlCloser: false, ...pesos });
  assert.ok(id);
  const guardada = hoy().devoluciones.find((x) => x.id === id)!;
  assert.equal(guardada.montoArs, 600_000);
  assert.equal(guardada.tipoCambio, 1500);
  const previoFin = { fecha: ar("2026-09-01"), saldos: [{ procesadorId: "proc_financiera_ars", monto: 0, moneda: "ARS", montoBase: 0 }] } as unknown as Parameters<typeof saldosEsperados>[1];
  const s = saldosEsperados(hoy(), previoFin, ar("2026-09-30", "23:00:00")).get("proc_financiera_ars")!;
  assert.equal(s.salio, 600_000);
  assert.equal(s.esperado, s.entro - 600_000);

  /* Corregirla para que salga por una cuenta en dólares: los pesos ya no valen y se borran. */
  assert.equal(acciones.editarDevolucion(id!, { procesadorId: "proc_stripe", montoArs: undefined, tipoCambio: undefined }), true);
  const corregida = hoy().devoluciones.find((x) => x.id === id)!;
  assert.equal(corregida.procesadorId, "proc_stripe");
  assert.equal(corregida.montoArs, undefined);
  assert.equal(corregida.tipoCambio, undefined);
  assert.equal(saldosEsperados(hoy(), previoFin, ar("2026-09-30", "23:00:00")).get("proc_financiera_ars")!.salio, 0);
});

test("pesos · el formulario pide los pesos sólo por una cuenta en pesos y los guarda al cargar y al corregir", () => {
  const fuente = readFileSync(new URL("../src/components/devoluciones/CargarDevolucion.tsx", import.meta.url), "utf8");
  assert.match(fuente, /esCuentaEnPesos\(cuentaElegida\)/, "decide por la moneda de la cuenta, como el formulario de cobros");
  assert.match(fuente, /\{enPesos && \(/, "el campo de pesos sale sólo en una cuenta en pesos");
  assert.match(fuente, /sinPesos: enPesos && !pesos\.montoArs/, "no deja guardar sin los pesos");
  assert.match(fuente, /montoArs: pesos\.montoArs, tipoCambio: pesos\.tipoCambio/, "los pesos y el cambio van en lo que se guarda");
  assert.match(fuente, /acciones\.editarDevolucion\(previa\.id, comun\)[\s\S]*acciones\.registrarDevolucion\(\{[^}]*\.\.\.comun/, "tanto al corregir como al cargar");
  assert.match(fuente, /la caja de \$\{cuenta\}/, "sigue diciendo de qué caja resta");
  assert.match(fuente, /typeof base\?\.montoArs === "number"/, "una devolución de la base trae montoArs: null y no cuenta como si tuviera los pesos");
});

test("pesos · una devolución que viene de la base con montoArs y tipoCambio en null se trata como la que no los tiene", () => {
  const e = conPesos([cobroEnPesos("p1", "q1", 1000, 1500, ar("2026-09-12", "10:00:00"))], []);
  const deLaBase = { ...devolucion({ id: "d", monto: 400, fecha: ar("2026-09-20"), procesadorId: "proc_fin" }), montoArs: null, tipoCambio: null } as unknown as Devolucion;
  assert.equal(pesosQueSalieron(e, deLaBase), 600_000);
  assert.equal(fin({ ...e, devoluciones: [deLaBase] } as EstadoApp).salio, 600_000);
});
