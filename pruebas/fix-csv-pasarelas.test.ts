import test from "node:test";
import assert from "node:assert/strict";
import { aFecha, aNumero, importarCSV, leerCSV } from "@/lib/pasarelas";
import { leerMonto } from "@/lib/monto";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { COLUMNAS_VENTAS, leerFilasVentas } from "@/lib/angelo";

/* ==================================================================
   El CSV de una pasarela entra con los montos y las fechas que dice el archivo.

   Antes (hallazgos plata #4 y #5 de las pruebas de estrés):
   - con «;» de separador la coma también cortaba la celda: «1.234,56» entraba
     como 1,234 (Excel en español, Hotmart, Mercado Pago, o lo pegado desde una hoja
     con tabuladores);
   - «15.000» se leía como 15 y «1.500.000» como 0 (la fila se descartaba);
   - «10/09/2026» entraba como 9 de octubre, «2026-10-01» como el 30/09 en Argentina
     y una columna «(UTC)» sin zona con tres horas corridas.

   Se prueba cada pieza (leerCSV, aNumero, aFecha) y el recorrido entero con
   muestras que se parecen a lo que exporta Stripe, Mercado Pago, Hotmart y PayPal.
   ================================================================== */

/** El instante (ISO) de una hora de Argentina (UTC-3, sin horario de verano). */
const art = (a: number, m: number, d: number, h = 12, mi = 0, s = 0, ms = 0): string =>
  new Date(Date.UTC(a, m - 1, d, h + 3, mi, s, ms)).toISOString();

/** Corre `f` con la zona horaria de la máquina puesta en cada una de `zonas`. */
function enZonas<T>(zonas: string[], f: (zona: string) => T): T[] {
  const antes = process.env.TZ;
  try {
    return zonas.map((z) => { process.env.TZ = z; return f(z); });
  } finally {
    if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes;
  }
}
const ZONAS = ["America/Argentina/Buenos_Aires", "UTC", "Asia/Tokyo", "Pacific/Auckland", "America/Los_Angeles"];

/* Un generador con semilla (mulberry32), para que si algo falla se repita igual. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { entre: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)) };
}

/* ---------- leerCSV: el separador sale de la cabecera ---------- */

test("leerCSV: con «;» la coma es parte del número y no corta la celda", () => {
  const tabla = leerCSV("Fecha;Referencia;Monto;Estado\n10/09/2026;mp_1;1.234,56;approved\n11/09/2026;mp_2;1234,5;approved\n");
  assert.deepEqual(tabla, [
    ["Fecha", "Referencia", "Monto", "Estado"],
    ["10/09/2026", "mp_1", "1.234,56", "approved"],
    ["11/09/2026", "mp_2", "1234,5", "approved"],
  ]);
});

test("leerCSV: lo que se pega desde una hoja viene con tabuladores y la coma tampoco corta", () => {
  assert.deepEqual(leerCSV("Fecha\tReferencia\tMonto\n10/09/2026\tmp_1\t1.500,50\n"), [
    ["Fecha", "Referencia", "Monto"], ["10/09/2026", "mp_1", "1.500,50"],
  ]);
});

test("leerCSV: con coma, un «;» o un tabulador sueltos en un texto son texto (no corren las columnas)", () => {
  assert.deepEqual(leerCSV('id,Monto,Notas\nch_1,10.00,pagó; falta la 2da\nch_2,20.00,"con\ttab"\nch_3,30.00,a\tb'), [
    ["id", "Monto", "Notas"], ["ch_1", "10.00", "pagó; falta la 2da"], ["ch_2", "20.00", "con\ttab"], ["ch_3", "30.00", "a\tb"],
  ]);
});

test("leerCSV: comillas dobles, comillas escapadas y saltos de línea adentro de una celda, con cada separador", () => {
  for (const s of [",", ";", "\t"]) {
    const texto = [
      `"Nombre"${s}"Nota"${s}Monto`,
      `"Ruiz, Ana"${s}"dijo ""hola""\ny chau"${s}"1.500,50"`,
      `Beto${s}"a${s}b"${s}"2"`,
    ].join("\r\n");
    assert.deepEqual(leerCSV(texto), [
      ["Nombre", "Nota", "Monto"], ["Ruiz, Ana", 'dijo "hola"\ny chau', "1.500,50"], ["Beto", `a${s}b`, "2"],
    ], `separador ${JSON.stringify(s)}`);
  }
});

test("leerCSV: el BOM del principio no ensucia el primer encabezado, con o sin comillas", () => {
  assert.deepEqual(leerCSV("﻿Fecha;Monto\n1;2,5"), [["Fecha", "Monto"], ["1", "2,5"]]);
  assert.deepEqual(leerCSV('﻿"Fecha";"Monto"\n"1";"2,5"'), [["Fecha", "Monto"], ["1", "2,5"]]);
  assert.equal(leerCSV("﻿id,Amount\nx,1")[0][0], "id");
});

test("leerCSV: saltos \\r\\n, \\r y \\n, y líneas en blanco antes de la cabecera y entre filas", () => {
  assert.deepEqual(leerCSV("\n\r\n  \nFecha;Monto\r\n1;2,5\r\n\r\n3;4,5\r"), [["Fecha", "Monto"], ["1", "2,5"], ["3", "4,5"]]);
  assert.deepEqual(leerCSV("Fecha\tMonto\r1\t2,5\r3\t4,5"), [["Fecha", "Monto"], ["1", "2,5"], ["3", "4,5"]]);
});

test("leerCSV: lo que está entre comillas en la cabecera no cuenta para elegir el separador", () => {
  assert.deepEqual(leerCSV('"Monto, USD";Fecha\n"1,5";2026'), [["Monto, USD", "Fecha"], ["1,5", "2026"]]);
  assert.deepEqual(leerCSV('"a;b;c",d\n1,2'), [["a;b;c", "d"], ["1", "2"]]);
});

test("leerCSV: si empatan gana el que menos se usa dentro de un texto (tabulador, «;», coma); sin ninguno, la coma", () => {
  assert.deepEqual(leerCSV("Nombre;Monto (USD, ARS)\nAna;1.500,50"), [["Nombre", "Monto (USD, ARS)"], ["Ana", "1.500,50"]]);
  assert.deepEqual(leerCSV("a\tb;c\n1\t2;3"), [["a", "b;c"], ["1", "2;3"]]);
  assert.deepEqual(leerCSV("Monto\n15"), [["Monto"], ["15"]]);
});

test("leerCSV: un CSV de coma da lo mismo que antes (comillas, escapes, saltos, filas vacías)", () => {
  const texto = [
    "id,Created date (UTC),Amount,Customer Name,Description",
    'ch_1,2026-09-10T14:30:00Z,"1,234.56","Ruiz, Ana","Mentoría ""VIP"""',
    "",
    'ch_2,2026-09-11T09:00:00Z,12.50,Beto,"línea 1\nlínea 2"',
    "ch_3,2026-09-12T09:00:00Z,,  Cami  ,",
  ].join("\n");
  assert.deepEqual(leerCSV(texto), [
    ["id", "Created date (UTC)", "Amount", "Customer Name", "Description"],
    ["ch_1", "2026-09-10T14:30:00Z", "1,234.56", "Ruiz, Ana", 'Mentoría "VIP"'],
    ["ch_2", "2026-09-11T09:00:00Z", "12.50", "Beto", "línea 1\nlínea 2"],
    ["ch_3", "2026-09-12T09:00:00Z", "", "Cami", ""],
  ]);
});

/* ---------- aNumero: la misma regla que leerMonto ---------- */

test("aNumero: un punto con exactamente tres cifras detrás, o varios puntos, es de miles (15.000 son quince mil)", () => {
  for (const [texto, n] of [
    ["15.000", 15000], ["1.500.000", 1500000], ["1.234", 1234], ["100.000", 100000], ["999.999", 999999], ["12.345.678", 12345678],
    ["1,234,567", 1234567], ["US$ 15.000", 15000], ["$ 1.500.000,50", 1500000.5], ["ARS 2.500.000", 2500000], ["1.000", 1000],
  ] as const) assert.equal(aNumero(texto), n, `«${texto}»`);
});

test("aNumero: lo que ya se leía bien da lo mismo", () => {
  for (const [texto, n] of [
    ["1.234,56", 1234.56], ["1,234.56", 1234.56], ["1234,56", 1234.56], ["1234.56", 1234.56], ["15000", 15000], ["15,5", 15.5],
    ["0,5", 0.5], ["0.5", 0.5], ["12.5", 12.5], ["100.00", 100], ["-2.500,75", -2500.75], ["$ 1.500,00", 1500], ["USD 99.99", 99.99],
    ["1,234.5", 1234.5], ["1.234,5", 1234.5], ["1.234.567,89", 1234567.89], ["1,234,567.89", 1234567.89], ["", 0], ["abc", 0],
    ["1 234,56", 1234.56], ["R$ 1.234,56", 1234.56], ["1234.567", 1234.567], ["1,5", 1.5],
  ] as const) assert.equal(aNumero(texto), n, `«${texto}»`);
});

test("aNumero: como en leerMonto, una coma sola es decimal («1,234» es uno y pico) y «0.500» es medio, no quinientos", () => {
  assert.equal(aNumero("1,234"), 1.234);
  assert.equal(aNumero("0.500"), 0.5);
  assert.equal(aNumero("0.050"), 0.05);
  assert.equal(aNumero("0,500"), 0.5);
});

test("aNumero: negativo con menos adelante o atrás (también el tipográfico) o entre paréntesis", () => {
  for (const [texto, n] of [
    ["-12.50", -12.5], ["\u221212,50", -12.5] /* el menos tipográfico */, ["12.50-", -12.5], ["(1.500,50)", -1500.5], ["(12.50)", -12.5], ["- 1.500,50", -1500.5],
    ["USD -12.50", -12.5], ["$-12.50", -12.5], ["-1.500,50", -1500.5], ["1.500,50-", -1500.5], ["($ 15.000)", -15000],
  ] as const) assert.equal(aNumero(texto), n, `«${texto}»`);
  /* Lo que sólo tiene paréntesis al lado del número no es negativo. */
  assert.equal(aNumero("12.50 (USD)"), 12.5);
  assert.equal(aNumero("(USD) 12.50"), 12.5);
  /* Y un cero con signo es 0, no -0. */
  assert.ok(Object.is(aNumero("-0,00"), 0));
  assert.ok(Object.is(aNumero("(0.00)"), 0));
});

test("aNumero: lo que no es un monto da 0 (no se inventa un número)", () => {
  for (const texto of ["2026-10-01", "12.34.56", "1,23,456", "1.2.3", "1.5.", "-", "--5", ".", ",", "N/A", "1.234,5,6", " ", "(  )"]) {
    assert.equal(aNumero(texto), 0, `«${texto}»`);
  }
});

test("aNumero: en cripto el punto es siempre decimal (12.340 son doce y pico, no doce mil)", () => {
  assert.equal(aNumero("12.340", true), 12.34);
  assert.equal(aNumero("1.500", true), 1.5);
  assert.equal(aNumero("1,234.56", true), 1234.56);
  assert.equal(aNumero("100.00000000", true), 100);
  assert.equal(aNumero("1.234.567", true), 0, "varios puntos no es un número en ninguna convención");
  assert.equal(aNumero("1.234,56", true), 1234.56, "con coma decimal sigue siendo el mismo número");
});

test("aNumero: todo lo que no es ambiguo da lo mismo que leerMonto, el de los campos de plata de la app", () => {
  const r = azar(7);
  const miles = (n: number, sep: string) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  let probados = 0;
  for (let i = 0; i < 600; i++) {
    const centavos = r.entre(1, 99_999_999);
    const ent = Math.floor(centavos / 100);
    const dd = String(centavos % 100).padStart(2, "0");
    const esperado = Number(`${ent}.${dd}`);
    const textos = [
      `${ent}.${dd}`, `${ent},${dd}`, `${miles(ent, ".")},${dd}`, `${miles(ent, ",")}.${dd}`, `$ ${miles(ent, ".")},${dd}`, `US$ ${miles(ent, ",")}.${dd}`,
    ];
    /* Un entero sin decimales: con puntos de miles siempre; con comas, desde dos grupos (con uno solo es un decimal). */
    if (dd === "00") {
      textos.push(`${ent}`, miles(ent, "."));
      if (ent >= 1_000_000) textos.push(miles(ent, ","));
    }
    for (const t of textos) {
      assert.equal(aNumero(t), esperado, `aNumero «${t}»`);
      assert.equal(leerMonto(t), esperado, `leerMonto «${t}»`);
      probados++;
    }
  }
  assert.ok(probados > 3000, `cobertura: ${probados}`);
});

/* ---------- aFecha ---------- */

test("aFecha: dd/mm/aaaa se lee SIEMPRE día/mes/año, con el día de 1 a 12 también", () => {
  for (const dia of [1, 5, 9, 10, 12, 13, 25, 30]) {
    const dd = String(dia).padStart(2, "0");
    assert.equal(aFecha(`${dd}/09/2026`), art(2026, 9, dia), `«${dd}/09/2026»`);
  }
  assert.equal(aFecha("05/10/2026"), art(2026, 10, 5), "el 5 de octubre, no el 10 de mayo");
  assert.equal(aFecha("1/9/2026"), art(2026, 9, 1));
  assert.equal(aFecha("10/09/26"), art(2026, 9, 10), "año de dos cifras");
  assert.equal(aFecha("10-09-2026"), art(2026, 9, 10));
  assert.equal(aFecha("10.09.2026"), art(2026, 9, 10));
  assert.equal(aFecha("10/09/2026 14:30"), art(2026, 9, 10, 14, 30));
  assert.equal(aFecha("10/09/2026 14:30:05"), art(2026, 9, 10, 14, 30, 5));
  assert.equal(aFecha("10/09/2026, 14:30:05"), art(2026, 9, 10, 14, 30, 5));
  /* Con una palabra delante (Excel con el día de la semana). */
  assert.equal(aFecha("lun 10/09/2026"), art(2026, 9, 10));
  assert.equal(aFecha("mar. 06/10/2026 14:30"), art(2026, 10, 6, 14, 30));
  assert.equal(aFecha("Fecha: 2026-10-01"), "2026-10-01T15:00:00.000Z");
});

test("aFecha: sin hora es el mediodía de Argentina, así el cobro del día 1 no cae en el mes anterior", () => {
  assert.equal(aFecha("2026-10-01"), "2026-10-01T15:00:00.000Z");
  for (const texto of ["2026-10-01", "2026-01-01", "2026-12-31", "2026-3-1", "2026/10/01", "01/10/2026", "1/10/26", "2026.10.01"]) {
    const dia = diaDeNegocio(aFecha(texto));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(dia), texto);
    assert.equal(aFecha(texto).slice(11), "15:00:00.000Z", `«${texto}» a mediodía de Argentina`);
  }
  assert.equal(diaDeNegocio(aFecha("2026-10-01")), "2026-10-01");
  assert.equal(diaDeNegocio(aFecha("2026-01-01")), "2026-01-01");
  assert.equal(diaDeNegocio(aFecha("01/10/2026")), "2026-10-01");
  /* La zona de la columna no cambia el día de una fecha sin hora. */
  assert.equal(aFecha("2026-10-01", { desfase: 0 }), "2026-10-01T15:00:00.000Z");
});

test("aFecha: con hora y sin zona es la hora de Argentina, y con la hora de UTC si la columna lo dice", () => {
  assert.equal(aFecha("2026-10-01 01:00:00"), "2026-10-01T04:00:00.000Z");
  assert.equal(aFecha("2026-10-01 01:00:00", { desfase: 0 }), "2026-10-01T01:00:00.000Z");
  assert.equal(aFecha("2026-10-01T01:00:00", { desfase: 0 }), "2026-10-01T01:00:00.000Z");
  assert.equal(aFecha("2026-10-01 01:00", { desfase: 0 }), "2026-10-01T01:00:00.000Z");
  assert.equal(aFecha("2026-09-10 14:30:00.5"), art(2026, 9, 10, 14, 30, 0, 500));
  assert.equal(aFecha("2026-09-10 14:30:00.123456"), art(2026, 9, 10, 14, 30, 0, 123));
  assert.equal(aFecha("10/09/2026 14:30", { desfase: 0 }), "2026-09-10T14:30:00.000Z");
  assert.equal(aFecha("10/09/2026 14:30", { desfase: -180 }), "2026-09-10T17:30:00.000Z");
});

test("aFecha: con zona se respeta, y da exactamente lo que daba new Date() en las fechas ISO que ya andaban", () => {
  for (const dia of ["2026-09-10", "2026-09-30", "2026-10-01", "2026-12-31", "2027-01-01"]) {
    for (const hora of ["00:00:00", "01:00:00", "03:00:00", "14:30:00", "23:59:59", "14:30"]) {
      /* Los decimales sólo van después de los segundos. */
      const zonas = ["Z", "+00:00", "-03:00", "+05:30", "-0300", "+0000", ...(hora.length > 5 ? [".123Z", ".9999Z"] : [])];
      for (const zona of zonas) {
        const t = `${dia}T${hora}${zona}`;
        assert.equal(aFecha(t), new Date(t).toISOString(), t);
        assert.equal(aFecha(t, { desfase: 0 }), new Date(t).toISOString(), `${t} con la columna en UTC`);
      }
      for (const zona of ["Z", " UTC", "+00:00", " -03:00", "-0300"]) {
        const t = `${dia} ${hora}${zona}`;
        assert.equal(aFecha(t), new Date(t).toISOString(), t);
      }
    }
  }
  assert.equal(aFecha("2026-09-10T14:30:00-03"), "2026-09-10T17:30:00.000Z", "zona de sólo horas");
  assert.equal(aFecha("10/09/2026 14:30:00 -03:00"), "2026-09-10T17:30:00.000Z");
  assert.equal(aFecha("10/09/2026 14:30:00Z"), "2026-09-10T14:30:00.000Z");
  assert.equal(aFecha("10/09/2026 14:30:00 UTC"), "2026-09-10T14:30:00.000Z");
  assert.equal(aFecha("2026-09-10 14:30:00 GMT-3"), "2026-09-10T17:30:00.000Z");
  /* Un nombre de zona suelto («ART») no es una zona que se sepa leer: vale la hora de Argentina. */
  assert.equal(aFecha("10/09/2026 14:30:00 ART"), "2026-09-10T17:30:00.000Z");
});

test("aFecha: a. m. / p. m. (Excel en español con reloj de 12 horas)", () => {
  assert.equal(aFecha("10/09/2026 2:30 PM"), art(2026, 9, 10, 14, 30));
  assert.equal(aFecha("10/09/2026 2:30:00 p. m."), art(2026, 9, 10, 14, 30));
  assert.equal(aFecha("10/09/2026 2:30:00 p. m."), art(2026, 9, 10, 14, 30), "con espacio duro");
  assert.equal(aFecha("10/09/2026 12:05 AM"), art(2026, 9, 10, 0, 5));
  assert.equal(aFecha("10/09/2026 12:30 p. m."), art(2026, 9, 10, 12, 30));
  assert.equal(aFecha("10/09/2026 11:59 a. m."), art(2026, 9, 10, 11, 59));
  assert.equal(aFecha("2026-09-10 02:30 pm"), art(2026, 9, 10, 14, 30));
});

test("aFecha: un día que no existe no se corre al mes siguiente, y con el «mes» pasado de 12 es mes/día", () => {
  for (const texto of ["31/02/2026", "31/04/2026", "00/09/2026", "2026-02-30", "10/09/2026 25:00", "10/09/2026 14:61"]) {
    const r = aFecha(texto);
    assert.ok(Math.abs(Date.parse(r) - Date.now()) < 10_000, `«${texto}» no es una fecha: se toma el momento de la importación y no «${r}»`);
  }
  assert.equal(aFecha("09/13/2026"), art(2026, 9, 13), "no puede ser el mes 13: es mes/día");
  assert.equal(aFecha("12/25/2026"), art(2026, 12, 25));
  assert.equal(aFecha("12/25/2026 14:30"), art(2026, 12, 25, 14, 30));
});

test("aFecha: con mesPrimero las barras son mes/día/año, y lo que no existe así sigue siendo el otro orden", () => {
  assert.equal(aFecha("09/10/2026", { mesPrimero: true }), art(2026, 9, 10));
  assert.equal(aFecha("09/10/2026"), art(2026, 10, 9), "sin la pista, día/mes");
  assert.equal(aFecha("09-13-2026 14:30", { mesPrimero: true }), art(2026, 9, 13, 14, 30));
  assert.equal(aFecha("13/09/2026", { mesPrimero: true }), art(2026, 9, 13), "no hay mes 13: es día/mes");
  assert.equal(aFecha("2026-09-10", { mesPrimero: true }), art(2026, 9, 10), "aaaa-mm-dd no cambia");
});

test("aFecha: lo que da el mismo instante en cualquier máquina (la zona de la compu no cambia el día del cobro)", () => {
  const textos = [
    "2026-10-01", "2026-9-1", "10/09/2026", "05/10/2026", "01/10/2026", "10/09/26", "2026-09-10 14:30:00", "10/09/2026 14:30", "10/09/2026 2:30 p. m.",
    "2026-09-10T14:30:00Z", "2026-09-10T14:30:00-03:00", "2026-10-01 01:00:00", "09/13/2026",
  ];
  for (const t of textos) {
    for (const desfase of [-180, 0]) {
      const porZona = enZonas(ZONAS, () => aFecha(t, { desfase }));
      assert.ok(porZona.every((x) => x === porZona[0]), `«${t}» (${desfase}) cambia con la zona: ${porZona.join(" | ")}`);
    }
  }
});

test("lo que venga en una celda no tira error: el monto es un número y la fecha es una fecha", () => {
  const alfabeto = "0123456789,.;\t \n\r\"-/:()TZ+apmUTCGMt$€\u2212";
  const r = azar(99);
  const texto = (largo: number) => Array.from({ length: r.entre(0, largo) }, () => alfabeto[r.entre(0, alfabeto.length - 1)]).join("");
  for (let i = 0; i < 4000; i++) {
    const s = texto(24);
    for (const cripto of [false, true]) {
      const n = aNumero(s, cripto);
      assert.ok(Number.isFinite(n) && !Object.is(n, -0), `aNumero «${s}» = ${n}`);
    }
    for (const opciones of [{}, { desfase: 0, mesPrimero: true }]) assert.ok(!Number.isNaN(Date.parse(aFecha(s, opciones))), `aFecha «${s}»`);
    assert.ok(Array.isArray(leerCSV(s)));
    importarCSV(`Fecha,Referencia,Monto,Fee,Estado\n${s},${texto(5)},${texto(8)},${texto(5)},${texto(5)}\n${texto(30)}`, "stripe", "p");
  }
});

/* ---------- importarCSV con muestras de cada pasarela ---------- */

const resumen = (r: ReturnType<typeof importarCSV>) => ({
  cobros: r.movimientos.map((m) => [m.referencia, m.monto, m.fee, m.neto, m.fecha]),
  reembolsos: r.reembolsos.map((x) => [x.referencia, x.monto, x.fecha]),
});

test("Stripe con coma, punto decimal y fechas ISO con zona: da exactamente lo mismo que antes", () => {
  const csv = [
    "id,Created date (UTC),Amount,Amount Refunded,Currency,Fee,Net,Status,Customer Email,Customer Name,Description",
    "ch_1,2026-09-10T14:30:00Z,1500.00,0.00,usd,45.00,1455.00,Paid,Ana@Mail.com,Ana Ruiz,Mentoría",
    "ch_2,2026-09-30T23:59:59.999Z,12.50,0.00,usd,0.66,11.84,Paid,beto@mail.com,Beto,Curso",
    "ch_3,2026-10-01T03:00:00-03:00,2500,0,usd,72.50,2427.50,Paid,cami@mail.com,Cami,Mentoría",
    "ch_4,2026-10-02T10:00:00+0000,99.99,10.00,usd,3.20,96.79,Paid,dani@mail.com,Dani,Curso",
    'ch_5,2026-10-02T11:00:00Z,"1,234.56",0,usd,36.10,,Failed,eli@mail.com,Eli,Curso',
    "ch_6,2026-10-03T11:00:00Z,300.00,300.00,usd,9.00,0.00,Refunded,fede@mail.com,Fede,Curso",
  ].join("\n");
  const esperado = {
    movimientos: [
      { referencia: "ch_1", monto: 1500, fee: 45, neto: 1455, fecha: "2026-09-10T14:30:00.000Z", moneda: "USD", clienteEmail: "ana@mail.com", clienteNombre: "Ana Ruiz", descripcion: "Mentoría" },
      { referencia: "ch_2", monto: 12.5, fee: 0.66, neto: 11.84, fecha: "2026-09-30T23:59:59.999Z", moneda: "USD", clienteEmail: "beto@mail.com", clienteNombre: "Beto", descripcion: "Curso" },
      { referencia: "ch_3", monto: 2500, fee: 72.5, neto: 2427.5, fecha: "2026-10-01T06:00:00.000Z", moneda: "USD", clienteEmail: "cami@mail.com", clienteNombre: "Cami", descripcion: "Mentoría" },
      { referencia: "ch_4", monto: 99.99, fee: 3.2, neto: 96.79, fecha: "2026-10-02T10:00:00.000Z", moneda: "USD", clienteEmail: "dani@mail.com", clienteNombre: "Dani", descripcion: "Curso" },
    ],
    reembolsos: [
      ["reembolso:ch_4", 10, "2026-10-02T10:00:00.000Z", ["ch_4"]],
      ["reembolso:ch_6", 300, "2026-10-03T11:00:00.000Z", ["ch_6"]],
    ],
    descartadas: [
      { fila: 6, motivo: 'Estado "Failed".' },
      { fila: 7, motivo: 'Estado "Refunded": no entra como cobro, se propone como devolución.', reembolso: true },
    ],
  };
  /* En cualquier zona horaria de la máquina. */
  for (const r of enZonas(ZONAS, () => importarCSV(csv, "stripe", "proc_stripe"))) {
    assert.deepEqual(r.movimientos.map((m) => ({
      referencia: m.referencia, monto: m.monto, fee: m.fee, neto: m.neto, fecha: m.fecha, moneda: m.moneda,
      clienteEmail: m.clienteEmail, clienteNombre: m.clienteNombre, descripcion: m.descripcion,
    })), esperado.movimientos);
    assert.deepEqual(r.reembolsos.map((x) => [x.referencia, x.monto, x.fecha, x.referenciasCobro]), esperado.reembolsos);
    assert.deepEqual(r.descartadas, esperado.descartadas);
  }
});

test("Stripe de verdad: «Created date (UTC)» sin zona es hora de UTC, no la de la compu", () => {
  const csv = [
    "id,Created date (UTC),Amount,Fee,Net,Currency,Status",
    "ch_a,2026-10-01 01:00:00,100.00,3.20,96.80,usd,Paid",
    "ch_b,2026-09-10 14:30,50.00,1.75,48.25,usd,Paid",
    "ch_c,2026-10-01,70.00,2.00,68.00,usd,Paid",
  ].join("\n");
  for (const r of enZonas(ZONAS, () => importarCSV(csv, "stripe", "proc_stripe"))) {
    assert.deepEqual(r.movimientos.map((m) => [m.referencia, m.fecha]), [
      ["ch_a", "2026-10-01T01:00:00.000Z"], ["ch_b", "2026-09-10T14:30:00.000Z"], ["ch_c", "2026-10-01T15:00:00.000Z"],
    ]);
    /* El cobro de la 01:00 UTC del 1/10 es de las 22:00 del 30/09 en Argentina: cuenta en septiembre. */
    assert.equal(diaDeNegocio(r.movimientos[0].fecha), "2026-09-30");
    /* Y el del día 1 sin hora cuenta el día 1 (antes caía el 30/09). */
    assert.equal(diaDeNegocio(r.movimientos[2].fecha), "2026-10-01");
  }
});

test("el encabezado de la columna de fechas dice en qué hora están: (UTC), GMT-3, o nada (Argentina)", () => {
  const fecha = (cabecera: string) => importarCSV(`${cabecera},Referencia,Monto\n2026-10-01 01:00:00,x1,100.00\n`, "stripe", "p").movimientos[0].fecha;
  for (const c of ["Created date (UTC)", "Created (UTC)", "Date(UTC)", "Fecha (utc)", "fecha_utc", "Fecha (GMT)"]) assert.equal(fecha(c), "2026-10-01T01:00:00.000Z", c);
  for (const c of ["Fecha (GMT-3)", "Fecha (UTC-3)", "Fecha (UTC-03:00)"]) assert.equal(fecha(c), "2026-10-01T04:00:00.000Z", c);
  assert.equal(fecha("Fecha (UTC+2)"), "2026-09-30T23:00:00.000Z");
  for (const c of ["Fecha", "Date", "Fecha de aprobación", "Created date"]) assert.equal(fecha(c), "2026-10-01T04:00:00.000Z", c);
});

test("Mercado Pago: «;» de separador, coma decimal, puntos de miles y fechas dd/mm/aaaa", () => {
  /* Como lo guarda Excel en español: con el BOM al principio y \r\n. */
  const csv = "\uFEFF" + [
    "Fecha de aprobación;Número de operación;Valor de la transacción;Comisión;Valor neto recibido;Moneda;Estado;Email del comprador;Medio de pago",
    "10/09/2026 14:30:00;12345678901;1.500,50;-61,52;1.438,98;ARS;approved;Ana@Mail.com;Visa",
    "01/10/2026 00:05:00;12345678902;15.000;-615,00;14.385,00;ARS;approved;beto@mail.com;Mastercard",
    "05/10/2026;12345678903;1.500.000;-61.500,00;1.438.500,00;ARS;approved;cami@mail.com;Transferencia",
    "06/10/2026 09:00:00;12345678904;-2.000,00;;;ARS;refunded;dani@mail.com;Visa",
    "07/10/2026 09:00:00;12345678905;0,00;;;ARS;approved;eli@mail.com;Visa",
  ].join("\r\n");
  for (const r of enZonas(ZONAS, () => importarCSV(csv, "mercadopago", "proc_mercadopago"))) {
    assert.deepEqual(resumen(r), {
      cobros: [
        ["12345678901", 1500.5, 61.52, 1438.98, art(2026, 9, 10, 14, 30)],
        ["12345678902", 15000, 615, 14385, art(2026, 10, 1, 0, 5)],
        ["12345678903", 1500000, 61500, 1438500, art(2026, 10, 5)],
      ],
      reembolsos: [["reembolso:12345678904", 2000, art(2026, 10, 6, 9)]],
    });
    assert.deepEqual(r.movimientos.map((m) => [m.moneda, m.clienteEmail, m.metodo]), [
      ["ARS", "ana@mail.com", "Visa"], ["ARS", "beto@mail.com", "Mastercard"], ["ARS", "cami@mail.com", "Transferencia"],
    ]);
    assert.deepEqual(r.descartadas.map((d) => [d.fila, Boolean(d.reembolso)]), [[5, true], [6, false]]);
    /* El cobro de las 00:05 del 1/10 (Argentina) es de octubre y el de las 14:30 del 10/09, de septiembre. */
    assert.deepEqual(r.movimientos.map((m) => diaDeNegocio(m.fecha)), ["2026-09-10", "2026-10-01", "2026-10-05"]);
  }
});

test("un cobro devuelto en parte, en un archivo con «;»: entra entero y lo devuelto se propone aparte con su monto", () => {
  const csv = "id;Fecha;Importe;Importe reembolsado;Moneda;Estado\nch_1;10/09/2026;1.500,00;300,50;ARS;Paid\nch_2;11/09/2026;15.000;0,00;ARS;Paid\n";
  const r = importarCSV(csv, "manual", undefined);
  assert.deepEqual(resumen(r), {
    cobros: [["ch_1", 1500, 0, 1500, art(2026, 9, 10)], ["ch_2", 15000, 0, 15000, art(2026, 9, 11)]],
    reembolsos: [["reembolso:ch_1", 300.5, art(2026, 9, 10)]],
  });
});

test("Hotmart en portugués de Brasil: «;», coma decimal y dd/mm/aaaa con y sin hora", () => {
  const csv = [
    "transaction;approval_date;total_value;commission;currency_code;status;buyer_email;buyer_name;product_name;payment_type",
    "HP17093348;10/09/2026 14:30:00;1.234,56;123,46;USD;approved;maria@exemplo.com.br;Maria Souza;Curso;credit_card",
    "HP17093349;11/09/2026 09:05;15.000,00;1.500,00;USD;approved;joao@exemplo.com.br;João Lima;Mentoria;pix",
    "HP17093350;12/09/2026;99,90;9,99;USD;approved;ana@exemplo.com.br;Ana Costa;Curso;pix",
  ].join("\n");
  const r = importarCSV(csv, "hotmart", "proc_hotmart");
  assert.deepEqual(resumen(r).cobros, [
    ["HP17093348", 1234.56, 123.46, 1111.1, art(2026, 9, 10, 14, 30)],
    ["HP17093349", 15000, 1500, 13500, art(2026, 9, 11, 9, 5)],
    ["HP17093350", 99.9, 9.99, 89.91, art(2026, 9, 12)],
  ]);
  assert.deepEqual(r.movimientos.map((m) => [m.clienteNombre, m.clienteEmail, m.descripcion, m.metodo]), [
    ["Maria Souza", "maria@exemplo.com.br", "Curso", "credit_card"], ["João Lima", "joao@exemplo.com.br", "Mentoria", "pix"],
    ["Ana Costa", "ana@exemplo.com.br", "Curso", "pix"],
  ]);
  assert.deepEqual(r.descartadas, []);
});

test("PayPal: todo entre comillas, miles con coma, fee en negativo y un reembolso suelto", () => {
  const csv = [
    '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","Transaction ID","Reference Txn ID"',
    '"10/09/2026","14:30:00","PDT","Ana Ruiz","Payment","Completed","USD","1,500.00","-58.80","1,441.20","Ana@Mail.com","1AB23456CD789012E",""',
    '"11/09/2026","09:00:00","PDT","Beto Paz","Payment","Completed","USD","99.99","-3.50","96.49","beto@mail.com","2BC34567DE890123F",""',
    '"12/09/2026","10:00:00","PDT","Ana Ruiz","Refund","Completed","USD","-500.00","0.00","-500.00","ana@mail.com","3CD45678EF901234G","1AB23456CD789012E"',
  ].join("\r\n");
  const r = importarCSV(csv, "manual", undefined);
  assert.deepEqual(resumen(r), {
    cobros: [
      ["1AB23456CD789012E", 1500, 58.8, 1441.2, art(2026, 9, 10)],
      ["2BC34567DE890123F", 99.99, 3.5, 96.49, art(2026, 9, 11)],
    ],
    reembolsos: [["reembolso:3CD45678EF901234G", 500, art(2026, 9, 12)]],
  });
  assert.deepEqual(r.reembolsos[0].referenciasCobro, ["3CD45678EF901234G", "1AB23456CD789012E"]);
  assert.equal(r.movimientos[0].clienteEmail, "ana@mail.com");
});

test("lo que se pega desde Excel (tabuladores, coma decimal, puntos de miles) entra con lo que dice la hoja", () => {
  const csv = "Fecha\tReferencia\tMonto\tEstado\n10/09/2026\tmp_1\t1.500,50\tapproved\n11/09/2026\tmp_2\t15.000\tapproved\n";
  assert.deepEqual(resumen(importarCSV(csv, "manual", undefined)).cobros, [
    ["mp_1", 1500.5, 0, 1500.5, art(2026, 9, 10)],
    ["mp_2", 15000, 0, 15000, art(2026, 9, 11)],
  ]);
});

test("el mismo cobro escrito de tres maneras (Stripe, Excel en español, pegado de una hoja) entra igual", () => {
  const r = azar(42);
  const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  for (let k = 0; k < 60; k++) {
    const filas = Array.from({ length: r.entre(1, 6) }, (_, i) => {
      const monto = r.entre(1, 500_000_000);               // en centavos
      const fee = r.entre(0, Math.min(monto, 3_000_000));
      return { ref: `tx_${k}_${i}`, monto, fee, dia: r.entre(1, 28), mes: r.entre(1, 12), hora: r.entre(0, 23), min: r.entre(0, 59) };
    });
    const ing = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
    const es = (c: number) => `${miles(Math.floor(c / 100))},${String(c % 100).padStart(2, "0")}`;
    const dd = (n: number) => String(n).padStart(2, "0");
    const stripe = ["id,Created date (UTC),Amount,Fee,Net,Currency,Status", ...filas.map((f) =>
      /* La misma hora, con la zona de Argentina escrita en el ISO. */
      `${f.ref},2026-${dd(f.mes)}-${dd(f.dia)}T${dd(f.hora)}:${dd(f.min)}:00-03:00,${ing(f.monto)},${ing(f.fee)},${ing(f.monto - f.fee)},usd,Paid`)].join("\n");
    const excel = ["Fecha;Referencia;Monto;Fee;Neto;Moneda;Estado", ...filas.map((f) =>
      `${dd(f.dia)}/${dd(f.mes)}/2026 ${dd(f.hora)}:${dd(f.min)}:00;${f.ref};${es(f.monto)};${es(f.fee)};${es(f.monto - f.fee)};USD;approved`)].join("\r\n");
    const pegado = ["Fecha\tReferencia\tMonto\tFee\tNeto\tMoneda\tEstado", ...filas.map((f) =>
      `${f.dia}/${f.mes}/2026 ${f.hora}:${dd(f.min)}\t${f.ref}\t${es(f.monto)}\t${es(f.fee)}\t${es(f.monto - f.fee)}\tUSD\tapproved`)].join("\n");
    const a = resumen(importarCSV(stripe, "stripe", "p")).cobros;
    assert.equal(a.length, filas.length, `semilla ${k}: el de Stripe perdió filas`);
    assert.deepEqual(resumen(importarCSV(excel, "mercadopago", "p")).cobros, a, `semilla ${k}: Excel en español`);
    assert.deepEqual(resumen(importarCSV(pegado, "manual", "p")).cobros, a, `semilla ${k}: pegado de una hoja`);
  }
});

test("un archivo que viene mes/día/año (Mercury, PayPal en inglés) se lee así entero si alguna fecha lo dice sin dudas", () => {
  const archivo = (fechas: string[]) => ["Date (UTC),Description,Amount,Status", ...fechas.map((f, i) => `${f},Pago ${i},100.00,Sent`)].join("\n");
  const dias = (fechas: string[]) => importarCSV(archivo(fechas), "mercury", "p").movimientos.map((m) => diaDeNegocio(m.fecha));
  /* El 09-13 sólo puede ser mes/día: todo el archivo lo es. */
  assert.deepEqual(dias(["09-10-2026", "09-13-2026", "10-02-2026"]), ["2026-09-10", "2026-09-13", "2026-10-02"]);
  assert.deepEqual(dias(["09/10/2026", "09/13/2026"]), ["2026-09-10", "2026-09-13"]);
  /* El 13-09 sólo puede ser día/mes. */
  assert.deepEqual(dias(["10-09-2026", "13-09-2026", "02-10-2026"]), ["2026-09-10", "2026-09-13", "2026-10-02"]);
  /* Sin ninguna pista, día/mes: la regla de acá. */
  assert.deepEqual(dias(["10-09-2026", "02-10-2026"]), ["2026-09-10", "2026-10-02"]);
  /* Dos pistas contrarias no se pueden: queda día/mes y la fecha imposible se lee como se puede. */
  assert.deepEqual(dias(["10-09-2026", "13-09-2026", "09-13-2026"]), ["2026-09-10", "2026-09-13", "2026-09-13"]);
  /* Las fechas ISO no dicen nada del orden de las otras. */
  assert.deepEqual(dias(["2026-09-13", "10-09-2026"]), ["2026-09-13", "2026-09-10"]);
});

test("cripto: en Binance «12.340» son doce y pico; en cualquier otra pasarela, doce mil", () => {
  const csv = [
    "Date(UTC),Coin,Network,Amount,Fee,Transaction ID,Status",
    "2026-09-10 14:30:00,USDT,TRX,12.340,0.500,abc123,Completed",
    "2026-09-11 09:00:00,USDT,TRX,1.500,0.500,def456,Completed",
  ].join("\n");
  assert.deepEqual(resumen(importarCSV(csv, "binance", "p")).cobros, [
    ["abc123", 12.34, 0.5, 11.84, "2026-09-10T14:30:00.000Z"],
    ["def456", 1.5, 0.5, 1, "2026-09-11T09:00:00.000Z"],
  ]);
  assert.deepEqual(resumen(importarCSV(csv, "trust", "p")).cobros.map((c) => c[1]), [12.34, 1.5]);
  assert.deepEqual(resumen(importarCSV(csv, "manual", "p")).cobros.map((c) => [c[1], c[2]]), [[12340, 0.5], [1500, 0.5]]);
});

test("una fila sin referencia se identifica por su fecha y su monto ya bien leídos, así reimportar no duplica", () => {
  const csv = "Fecha;Monto;Estado\n10/09/2026;1.500,50;approved\n";
  const una = importarCSV(csv, "mercadopago", "p").movimientos[0];
  assert.equal(una.referencia, "mercadopago-2026-09-10-1500.5-1");
  assert.equal(importarCSV(csv, "mercadopago", "p").movimientos[0].referencia, una.referencia);
});

/* ---------- Las otras pantallas que leen CSV con leerCSV ---------- */

test("la hoja Ventas de la planilla en CSV con «;» (Excel en español) lee los montos y no corre las columnas", () => {
  const celdas = (valores: Record<string, string>) => COLUMNAS_VENTAS.map((c) => valores[c] ?? "");
  const valores = {
    "Fecha del pago": "10/09/2026", "Nombre Completo": "Ana Ruiz", Email: "ana@mail.com", "Servicio adquirido": "Mentoría",
    "Valor total de la venta": "2.500,00", "Monto abonado USD": "1.234,56", "Nombre del setter": "Santi",
    "Observaciones / Plan de pagos": "pagó la 1ra; falta la 2da",
  };
  /* Con «;» el texto con «;» va entre comillas, como lo guarda Excel. */
  const conPuntoYComa = [COLUMNAS_VENTAS.join(";"), celdas({ ...valores, "Observaciones / Plan de pagos": `"${valores["Observaciones / Plan de pagos"]}"` }).join(";")].join("\r\n");
  /* Con coma (Google Sheets) el «;» va suelto y los montos con punto decimal. */
  const conComa = [COLUMNAS_VENTAS.join(","), celdas({ ...valores, "Valor total de la venta": "2500.00", "Monto abonado USD": "1234.56" }).join(",")].join("\n");
  for (const texto of [conPuntoYComa, conComa]) {
    const { filas, faltan } = leerFilasVentas(leerCSV(texto));
    assert.deepEqual(faltan, []);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].montoUsd, 1234.56);
    assert.equal(filas[0].valorTotal, 2500);
    assert.equal(filas[0].setter, "Santi", "las columnas siguientes no se corren");
    assert.equal(filas[0].observaciones, "pagó la 1ra; falta la 2da");
    assert.equal(diaDeNegocio(filas[0].fecha), "2026-09-10");
  }
});
