import test from "node:test";
import assert from "node:assert/strict";
import { conStrike, pideCierre, reglaDeCierre, strikesDe, atrasoDe, hoyDeNegocio } from "@/lib/cierre-del-dia";
import { diaDeNegocio } from "@/lib/dia-negocio";
import type { EstadoApp, Sesion, Venta } from "@/lib/types";
import {
  TIPO_NO_VENTA, TIPO_RESELL, TIPO_VENTA, clonar, conPeso, diaAR, enAR, llamada, miembro, oraculoDeStrikes, porSemillas, sumarDias,
  type Azar,
} from "./azar";

/* ==================================================================
   Propiedad 1: los strikes (lib/cierre-del-dia.ts) se cuentan una sola
   vez por llamada y por día, no son negativos y no cambian al recalcular.

   El oráculo (azar.ts: oraculoDeStrikes) está escrito aparte, a partir de lo
   que dicen los comentarios del módulo, y el día cuenta en UTC-3 a mano.
   Cada semilla arma un mes de llamadas con todos los casos de borde: las
   11 de la noche, las 00:00 de Argentina, estados con y sin marca, ventas
   cargadas por otro, canceladas, «no vino», «Reagendar», resultados viejos.
   ================================================================== */

const HOY = "2026-09-30";
const CUENTA_DESDE = "2026-09-01";

const EQUIPO = [
  miembro("mariano", "Mariano Arias", "closer"),
  miembro("dante", "Dante Barbieri", "closer"),
  miembro("yari", "Yari Taft", "ceo"),
];
/* Cómo se escribe el anfitrión en Calendly → cómo lo nombra el cierre del día. */
const ANFITRIONES: [string | undefined, string][] = [
  ["Mariano Arias", "Mariano Arias"], ["Mariano", "Mariano Arias"], ["  mariano arias ", "Mariano Arias"], ["Marianó Arias", "Mariano Arias"],
  ["Dante Barbieri", "Dante Barbieri"], ["DANTE  BARBIERI", "Dante Barbieri"],
  ["Yari Taft", "Yari Taft"],
  ["Externo Tercero", "Externo Tercero"], ["Dante B.", "Dante B."],
  [undefined, ""], ["", ""], ["   ", ""],
];
const closerOraculo = (s: Sesion) => ANFITRIONES.find(([h]) => h === s.anfitrion)?.[1] ?? "?";

function estadoAlAzar(r: Azar, ajustesCrm?: unknown): EstadoApp {
  const sesiones: Sesion[] = [];
  const ventas: Venta[] = [];
  const n = r.entre(10, 70);
  for (let i = 0; i < n; i++) {
    const dia = sumarDias("2026-08-25", r.entre(0, 37));   // algunas antes del arranque, algunas después de hoy
    const hora = r.elige([0, 0, 9, 14, 20, 23]);
    const min = r.elige([0, 30, 59]);
    const inicia = enAR(dia, hora, min, r.elige([0, 59]));
    const anf = r.elige(ANFITRIONES)[0];
    const extra: Partial<Sesion> = {
      tipo: r.elige([TIPO_VENTA, TIPO_VENTA, TIPO_VENTA, TIPO_RESELL, TIPO_NO_VENTA]),
      estado: r.elige(["hecha", "hecha", "hecha", "agendada", "no-show", "cancelada"] as const),
    };
    if (r.si(0.15)) extra.estadoPreCall = r.elige(["Reagendar", "reprogramar", "Confirmado", "Sin Respuesta"]);
    if (r.si(0.1)) extra.resultado = r.elige(["compro", "no-compro", "no-vino", "reprogramo"] as const);
    /* El estado y su marca: todas las combinaciones, incluidas las "imposibles". */
    const cargado = r.elige(["nada", "nada", "estado+marca", "estado+marca", "estado+marca", "estado-sin-marca", "marca-sin-estado"] as const);
    if (cargado !== "nada") {
      if (cargado !== "marca-sin-estado") extra.estadoLlamada = r.elige(["Compra Full", "Seguimiento Nutrición", "Dejó de Contestar", "NO Calificado"]);
      if (cargado !== "estado-sin-marca") {
        const k = r.elige([0, 0, 0, 0, 1, 2, -1, "limite-justo", "limite-pasado"] as const);
        extra.estadoLlamadaEn = k === "limite-justo" ? enAR(dia, 23, 59, 59)
          : k === "limite-pasado" ? enAR(sumarDias(dia, 1), 0, 0, 0)
          : enAR(sumarDias(dia, k), r.elige([0, 1, 8, 12, 22, 23]), r.elige([0, 15, 59]));
      }
    }
    if (r.si(0.1)) extra.ventaPorOtro = { por: "Closer", en: enAR(dia, 22) };
    const s = llamada(`s${i}`, anf, inicia, extra);
    sesiones.push(s);
    /* Una venta atada: de las que cargó el closer, de las que cargó otro, canceladas… */
    if (r.si(0.35)) {
      ventas.push({
        id: `v${i}`, sesionId: s.id, contactoNombre: `C${i}`, precioAcordado: 100, moneda: "USD", fecha: inicia, excluidoMarketing: false,
        estado: r.elige(["activa", "activa", "cancelada", "reembolsada"] as const), extra: {}, productoId: "p",
        creadoEn: enAR(sumarDias(dia, r.elige([0, 0, 1, 3, -1])), r.elige([1, 10, 23]), r.elige([0, 59])),
      } as Venta);
    }
    if (r.si(0.05)) ventas.push({ ...ventas[ventas.length - 1 > 0 ? ventas.length - 1 : 0] ?? {}, id: `vdup${i}`, sesionId: s.id, creadoEn: enAR(sumarDias(dia, 4), 10) } as Venta);
  }
  return {
    sesiones, ventas, equipo: EQUIPO,
    ajustes: { monedaBase: "USD", tipoCambio: 1, crm: ajustesCrm ?? { cierreDelDia: { cuentaDesde: CUENTA_DESDE } } },
  } as unknown as EstadoApp;
}

const esDeVenta = (s: Sesion) => s.tipo === TIPO_VENTA || s.tipo === TIPO_RESELL;
const NOMBRES = ["Mariano Arias", "Dante Barbieri", "Yari Taft", "Externo Tercero", "Dante B."];

test("el oráculo del día de negocio coincide con diaDeNegocio en los bordes de las 00:00 y las 23:59 de Argentina", () => {
  for (const d of ["2026-01-01", "2026-02-28", "2026-03-01", "2026-09-30", "2026-12-31"]) {
    for (const [h, m, s] of [[0, 0, 0], [0, 0, 1], [12, 0, 0], [23, 59, 59]] as const) {
      const iso = enAR(d, h, m, s);
      assert.equal(diaDeNegocio(iso), d, `${iso} debería ser ${d} en Argentina`);
      assert.equal(diaAR(iso), d);
    }
    assert.equal(diaDeNegocio(enAR(sumarDias(d, 1), 0, 0, 0)), sumarDias(d, 1));
  }
});

test("200 semillas: strikesDe coincide con el oráculo, día por día y closer por closer", () => {
  porSemillas(200, 1, (r) => {
    const e = estadoAlAzar(r);
    const orac = oraculoDeStrikes(e, closerOraculo, esDeVenta, CUENTA_DESDE, HOY);
    for (const closer of NOMBRES) {
      const got = strikesDe(e, closer, HOY);
      const esperado = [...(orac.get(closer)?.values() ?? [])].sort((a, b) => b.dia.localeCompare(a.dia));
      assert.deepEqual(got.dias, esperado.filter(conPeso), `días con strike de ${closer}`);
      assert.equal(got.total, esperado.filter(conPeso).length, `total de ${closer}`);
      assert.equal(got.diasContados, esperado.length, `días contados de ${closer}`);
    }
  });
});

test("200 semillas: forma de lo que devuelve (enteros no negativos, días únicos y ordenados, una vez por llamada)", () => {
  porSemillas(200, 1000, (r) => {
    const e = estadoAlAzar(r);
    let llamadasContadas = 0;
    for (const closer of NOMBRES) {
      const x = strikesDe(e, closer, HOY);
      assert.equal(x.total, x.dias.length);
      assert.ok(x.total >= 0 && x.diasContados >= x.total);
      const vistos = new Set<string>();
      let anterior = "9999-99-99";
      for (const d of x.dias) {
        assert.ok(Number.isInteger(d.llamadas) && Number.isInteger(d.tarde) && Number.isInteger(d.sinCargar));
        assert.ok(d.tarde >= 0 && d.sinCargar >= 0 && d.llamadas >= 1);
        assert.ok(d.tarde + d.sinCargar <= d.llamadas, `una llamada cuenta una sola vez: ${JSON.stringify(d)}`);
        assert.ok(conStrike(d));
        assert.ok(!vistos.has(d.dia), `día repetido ${d.dia}`);
        vistos.add(d.dia);
        assert.ok(d.dia < anterior, "del más nuevo al más viejo, sin empates");
        anterior = d.dia;
        assert.ok(d.dia >= CUENTA_DESDE && d.dia <= HOY);
        llamadasContadas += d.llamadas;
      }
    }
    /* Ninguna llamada entra en el cuadro de dos closers. */
    const orac = oraculoDeStrikes(e, closerOraculo, esDeVenta, CUENTA_DESDE, HOY);
    const total = [...orac.values()].flatMap((m) => [...m.values()]).filter(conPeso).reduce((a, d) => a + d.llamadas, 0);
    assert.equal(llamadasContadas, total);
  });
});

test("200 semillas: recalcular no cambia nada (con caché, con copias nuevas y con el orden de las llamadas mezclado)", () => {
  porSemillas(200, 2000, (r) => {
    const e = estadoAlAzar(r);
    const base = NOMBRES.map((c) => strikesDe(e, c, HOY));
    /* El mismo objeto, otra vez (pega en la caché). */
    assert.deepEqual(NOMBRES.map((c) => strikesDe(e, c, HOY)), base);
    /* Todo copiado: nada de identidad compartida. */
    const copia = clonar(e);
    assert.deepEqual(NOMBRES.map((c) => strikesDe(copia, c, HOY)), base);
    /* Llamadas y ventas en otro orden: el resultado es el mismo. */
    const mezclado = { ...clonar(e), sesiones: r.mezclar(e.sesiones), ventas: r.mezclar(e.ventas) } as EstadoApp;
    assert.deepEqual(NOMBRES.map((c) => strikesDe(mezclado, c, HOY)), base);
    /* Después de preguntar por otra fecha, volver a la primera da lo mismo (la caché no se queda con la última). */
    strikesDe(e, "Mariano Arias", "2026-09-15");
    assert.deepEqual(NOMBRES.map((c) => strikesDe(e, c, HOY)), base);
  });
});

test("200 semillas: avisar «la carga otra persona» no cambia los strikes (la marca de cuándo se cargó es la que manda)", () => {
  porSemillas(200, 3000, (r) => {
    const e = estadoAlAzar(r);
    const base = NOMBRES.map((c) => strikesDe(e, c, HOY));
    const con = { ...e, sesiones: e.sesiones.map((s) => ({ ...s, ventaPorOtro: { por: "X", en: enAR(sumarDias(diaAR(s.inicia), 5), 12) } })) } as EstadoApp;
    const sin = { ...e, sesiones: e.sesiones.map(({ ventaPorOtro: _v, ...s }) => s as Sesion) } as EstadoApp;
    assert.deepEqual(NOMBRES.map((c) => strikesDe(con, c, HOY)), base);
    assert.deepEqual(NOMBRES.map((c) => strikesDe(sin, c, HOY)), base);
  });
});

test("200 semillas: con el paso de los días los strikes sólo se suman (más tarde → los mismos días, con tarde igual y sin cargar igual o más)", () => {
  porSemillas(200, 4000, (r) => {
    const e = estadoAlAzar(r);
    const h1 = sumarDias(HOY, -r.entre(0, 12)), h2 = sumarDias(h1, r.entre(0, 15));
    for (const closer of NOMBRES) {
      const a = strikesDe(e, closer, h1), b = strikesDe(e, closer, h2);
      assert.ok(b.total >= a.total, `${closer}: de ${a.total} a ${b.total} al pasar de ${h1} a ${h2}`);
      for (const d of a.dias) {
        const igual = b.dias.find((x) => x.dia === d.dia);
        assert.ok(igual, `el día ${d.dia} con strike en ${h1} desapareció en ${h2}`);
        assert.equal(igual.tarde, d.tarde);
        assert.ok(igual.sinCargar >= d.sinCargar);
        assert.ok(igual.llamadas >= d.llamadas);
      }
    }
  });
});

test("200 semillas: una fecha de arranque más tarde sólo saca días, y no cambia los que quedan", () => {
  porSemillas(200, 5000, (r) => {
    const e = estadoAlAzar(r);
    const tarde = sumarDias(CUENTA_DESDE, r.entre(0, 25));
    const e2 = { ...e, ajustes: { ...e.ajustes, crm: { cierreDelDia: { cuentaDesde: tarde } } } } as EstadoApp;
    for (const closer of NOMBRES) {
      const a = strikesDe(e, closer, HOY), b = strikesDe(e2, closer, HOY);
      assert.deepEqual(b.dias, a.dias.filter((d) => d.dia >= tarde));
      assert.ok(b.diasContados <= a.diasContados);
    }
  });
});

test("el generador toca de todo: días con strike por tarde y por sin cargar, ventas que cuentan, borde de medianoche (si falla, el generador dejó de estresar algo)", () => {
  let diasConStrike = 0, tarde = 0, sinCargar = 0, diasLimpios = 0, conVentaTarde = 0, bordeJusto = 0, bordePasado = 0, ventaPorOtro = 0;
  porSemillas(200, 1, (r) => {
    const e = estadoAlAzar(r);
    const orac = oraculoDeStrikes(e, closerOraculo, esDeVenta, CUENTA_DESDE, HOY);
    for (const dias of orac.values()) for (const d of dias.values()) {
      if (conPeso(d)) { diasConStrike++; tarde += d.tarde; sinCargar += d.sinCargar; } else diasLimpios++;
    }
    for (const s of e.sesiones) {
      if (s.ventaPorOtro) ventaPorOtro++;
      if (!s.estadoLlamada && !s.estadoLlamadaEn && e.ventas.some((v) => v.sesionId === s.id && v.estado !== "cancelada" && diaAR(v.creadoEn) > diaAR(s.inicia))) conVentaTarde++;
      if (s.estadoLlamadaEn && diaAR(s.estadoLlamadaEn) === diaAR(s.inicia) && s.estadoLlamadaEn.slice(11, 19) === "02:59:59") bordeJusto++;
      if (s.estadoLlamadaEn && diaAR(s.estadoLlamadaEn) === sumarDias(diaAR(s.inicia), 1) && s.estadoLlamadaEn.slice(11, 19) === "03:00:00") bordePasado++;
    }
  });
  assert.ok(diasConStrike > 500 && diasLimpios > 500, `días con strike ${diasConStrike}, limpios ${diasLimpios}`);
  assert.ok(tarde > 300 && sinCargar > 300, `tarde ${tarde}, sin cargar ${sinCargar}`);
  assert.ok(conVentaTarde > 50 && ventaPorOtro > 100, `venta tardía ${conVentaTarde}, aviso ${ventaPorOtro}`);
  assert.ok(bordeJusto > 5 && bordePasado > 5, `bordes ${bordeJusto}/${bordePasado}`);
});

test("sin fecha de arranque, o con un interruptor prendido a medias, no hay strikes ni errores", () => {
  const r = crearAzarFijo(7);
  const e = estadoAlAzar(r, undefined);
  const sinCrm = { ...e, ajustes: { monedaBase: "USD", tipoCambio: 1 } } as EstadoApp;
  assert.deepEqual(strikesDe(sinCrm, "Mariano Arias", HOY), { cuentaDesde: undefined, dias: [], total: 0, diasContados: 0 });
  for (const crm of [{}, { cierreDelDia: {} }, { cierreDelDia: { cuentaDesde: "ayer" } }, { cierreDelDia: { cuentaDesde: "2026-9-1" } }, { cierreDelDia: { cuentaDesde: "" } }, { cierreDelDia: null }]) {
    const x = { ...e, ajustes: { monedaBase: "USD", tipoCambio: 1, crm } } as unknown as EstadoApp;
    assert.equal(strikesDe(x, "Mariano Arias", HOY).total, 0, JSON.stringify(crm));
  }
  /* Sin closer (cadena vacía) tampoco. */
  assert.equal(strikesDe(e, "", HOY).total, 0);
  assert.equal(reglaDeCierre(undefined).descuenta, false);
});

test("hoyDeNegocio: el día de Argentina, también cerca de la medianoche", () => {
  assert.equal(hoyDeNegocio(Date.parse("2026-09-30T02:59:59Z")), "2026-09-29");
  assert.equal(hoyDeNegocio(Date.parse("2026-09-30T03:00:00Z")), "2026-09-30");
  assert.equal(hoyDeNegocio(Date.parse("2026-12-31T23:59:59Z")), "2026-12-31");
  assert.equal(hoyDeNegocio(Date.parse("2027-01-01T02:59:59Z")), "2026-12-31");
});

function crearAzarFijo(semilla: number): Azar {
  let res!: Azar;
  porSemillas(1, semilla, (r) => { res = r; });
  return res;
}
