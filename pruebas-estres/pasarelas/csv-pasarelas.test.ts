import test from "node:test";
import assert from "node:assert/strict";
import { aNumero, importarCSV, leerCSV } from "@/lib/pasarelas";
import { leerMonto } from "@/lib/monto";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { Azar, propiedad, textoLoco, fechaIso } from "./azar";

/* ==================================================================
   ESTRÉS · el CSV de las pasarelas (lib/pasarelas.ts).

   Propiedades con datos al azar (generador con semilla: si algo falla, el
   mensaje trae la semilla) y casos de borde:
   - leerCSV / aNumero / importarCSV no tiran excepción con basura.
   - leerCSV: lo que se escribe con comillas vuelve igual.
   - aNumero: el mismo número en formato es y en vuelve igual.
   - importarCSV: cada fila es un cobro o está descartada, no se pierde
     ninguna; nada raro entra como cobro; importar dos veces (o con las filas
     en otro orden) da lo mismo cuando hay referencia.
   - Un reembolso (estado «refunded», monto negativo) NUNCA entra como cobro.

   Lo que falla por un bug real queda abajo, con «BUG:» y { todo: true }.
   ================================================================== */

/* ---------- leerCSV ---------- */

test("leerCSV: basura al azar no tira excepción y no devuelve filas vacías", propiedad("leerCSV no rompe", 400, (az) => {
  const texto = textoLoco(az, 400) + (az.bool(0.3) ? '"' + textoLoco(az, 50) : "");
  const filas = leerCSV(texto);
  assert.ok(Array.isArray(filas));
  for (const f of filas) {
    assert.ok(Array.isArray(f) && f.length >= 1);
    assert.ok(f.every((c) => typeof c === "string"));
    assert.ok(f.some((c) => c !== ""), "no debe devolver filas con todas las celdas vacías");
    assert.ok(f.every((c) => c === c.trim()), "las celdas salen sin espacios en los bordes");
  }
}));

test("leerCSV: un string gigante (2 MB) con comillas sin cerrar no se cuelga ni tira nada", () => {
  const t0 = Date.now();
  const gigante = 'id,"' + "x,".repeat(1_000_000);
  const filas = leerCSV(gigante);
  assert.ok(filas.length <= 2);
  assert.ok(Date.now() - t0 < 3000, "tiene que ser lineal");
});

test("leerCSV: lo escrito con comillas vuelve igual (comas, comillas y saltos de línea adentro)", propiedad("ida y vuelta del CSV", 300, (az) => {
  const piezas = ["a", "b c", "1,5", '"', "x\ny", "x\r\ny", ";", "\t", "ñ", "é", "00123", "0", "-", "=", "1.234,56", 'di"jo', ",,,", "😀"];
  const celda = (): string => {
    const s = Array.from({ length: az.int(1, 4) }, () => az.pick(piezas)).join(az.pick(["", " ", "-"]));
    return s.trim();
  };
  const filasN = az.int(1, 8), cols = az.int(1, 6);
  const tabla: string[][] = Array.from({ length: filasN }, () => Array.from({ length: cols }, () => (az.bool(0.15) ? "" : celda())));
  /* Una fila entera vacía se descarta a propósito. */
  const esperada = tabla.filter((f) => f.some((c) => c !== ""));
  const quote = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const sep = az.pick([",", ";", "\t"]);
  const fin = az.pick(["\n", "\r\n"]);
  const texto = tabla.map((f) => f.map(quote).join(sep)).join(fin);
  /* Dentro de comillas, un salto de línea se conserva tal cual (incluido el \r\n). */
  assert.deepEqual(leerCSV(texto), esperada);
}));

/* ---------- aNumero ---------- */

test("aNumero: nunca devuelve NaN ni Infinity, con lo que sea", propiedad("aNumero finito", 600, (az) => {
  const n = aNumero(textoLoco(az, 60));
  assert.ok(Number.isFinite(n), `dio ${n}`);
}));

test("aNumero: casos de borde (enormes, vacío, sólo signos, 400 dígitos)", () => {
  assert.equal(aNumero(""), 0);
  assert.equal(aNumero("---"), 0);
  assert.equal(aNumero("."), 0);
  assert.equal(aNumero(","), 0);
  assert.equal(aNumero("9".repeat(400)), 0, "se pasa de Number: no es un número usable");
  assert.ok(aNumero("-0") === 0, "-0 es cero (no es positivo: la fila se descarta)");
  assert.ok(Number.isFinite(aNumero("1e400")));
});

test("aNumero: el mismo importe con dos decimales en formato es, en y plano da el mismo número", propiedad("aNumero es/en", 600, (az) => {
  const centavos = az.int(0, 99_999_999_999);
  const entero = Math.floor(centavos / 100), dec = String(centavos % 100).padStart(2, "0");
  const esperado = Number(`${entero}.${dec}`);
  const miles = (s: string, sep: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const formas = [
    `${miles(String(entero), ".")},${dec}`,
    `${miles(String(entero), ",")}.${dec}`,
    `${entero}.${dec}`,
    `${entero},${dec}`,
    `US$ ${miles(String(entero), ".")},${dec}`,
    `$${miles(String(entero), ",")}.${dec} USD`,
  ];
  for (const f of formas) assert.equal(aNumero(f), esperado, `«${f}» tendría que dar ${esperado}`);
  if (centavos > 0) assert.equal(aNumero(`-${formas[0]}`), -esperado);
}));

/* ---------- importarCSV ---------- */

const ESTADOS_PAGADOS = ["paid", "succeeded", "Aprobado", "approved", "complete", "completed", "Completo", "APPROVED", ""];
const ESTADOS_REEMBOLSO = [
  "refunded", "Refunded", "REFUNDED", "Partially refunded", "reembolsado", "Reembolsado", "Reembolso", "devuelto", "Devolución",
  "chargeback", "Chargeback", "charge_back", "charge back", "contracargo", "Contracargo",
];
const ESTADOS_RECHAZADOS = ["failed", "Failed", "canceled", "cancelled", "Cancelado", "rechazado", "Rechazada", "denied", "expired", "pending", "dispute"];

interface FilaGen { ref: string; estado: string; monto: string; tipo: "cobro" | "reembolso" | "rechazada" | "sinmonto" }

function csvAleatorio(az: Azar): { texto: string; filas: FilaGen[]; encabezado: string[] } {
  const cab = az.pick([
    ["id", "Created date (UTC)", "Amount", "Fee", "Currency", "Customer Email", "Customer Name", "Status", "Description"],
    ["ID", "FECHA", "MONTO", "COMISIÓN", "MONEDA", "EMAIL", "NOMBRE", "ESTADO", "PRODUCTO"],
    ["﻿Transaction ID", "Date", "Gross", "Fee", "Currency", "From Email Address", "Name", "Status", "Item Title"],
    ["transaction", "approval_date", "total_value", "commission", "currency_code", "buyer_email", "buyer_name", "transaction_status", "product_name"],
  ]);
  const sep = az.pick([",", ";", "\t"]);
  const n = az.int(1, 40);
  const filas: FilaGen[] = [];
  const lineas: string[] = [cab.join(sep)];
  for (let i = 0; i < n; i++) {
    const k = az.int(0, 9);
    const tipo: FilaGen["tipo"] = k < 6 ? "cobro" : k < 8 ? "reembolso" : k < 9 ? "rechazada" : "sinmonto";
    const monto = (az.int(1, 500000) / 100).toFixed(2);
    const negativo = tipo === "reembolso" && az.bool(0.4);
    const montoTxt = tipo === "sinmonto" ? az.pick(["0", "0.00", "", "-", "abc"]) : negativo ? `-${monto}` : monto;
    const estado = tipo === "cobro" ? az.pick(ESTADOS_PAGADOS) : tipo === "reembolso" ? (negativo && az.bool() ? az.pick(ESTADOS_PAGADOS) : az.pick(ESTADOS_REEMBOLSO)) : tipo === "rechazada" ? az.pick(ESTADOS_RECHAZADOS) : az.pick(ESTADOS_PAGADOS);
    const ref = `ch_${az.alfanum(10)}_${i}`;
    const fecha = az.pick([fechaIso(az), fechaIso(az).slice(0, 10) + " 10:30:00", `${String(az.int(1, 28)).padStart(2, "0")}/${String(az.int(1, 12)).padStart(2, "0")}/2026`]);
    const celdas = [ref, fecha, montoTxt, (az.int(0, 3000) / 100).toFixed(2), az.pick(["usd", "USD", "ars", "ARS"]), `Persona${i}@Mail.COM`, `Persona ${i}`, estado, az.pick(["Mentoría", "Curso, con coma", ""])];
    filas.push({ ref, estado, monto: montoTxt, tipo });
    lineas.push(celdas.map((c) => (/[,;\t"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(sep));
  }
  return { texto: lineas.join(az.pick(["\n", "\r\n"])), filas, encabezado: cab };
}

test("importarCSV: basura al azar no tira excepción y devuelve la forma de siempre", propiedad("importarCSV no rompe", 400, (az) => {
  const proveedor = az.pick(["stripe", "hotmart", "whop", "dlocal", "mercadopago", "mercury", "binance", "trust", "manual"] as const);
  const texto = az.bool(0.5) ? textoLoco(az, 300) : `${textoLoco(az, 60)}\n${textoLoco(az, 200)}\n${textoLoco(az, 200)}`;
  const r = importarCSV(texto, proveedor, az.bool() ? "proc_x" : undefined, az.pick([0, 0.03, -1, NaN, 5]));
  assert.ok(Array.isArray(r.movimientos) && Array.isArray(r.reembolsos) && Array.isArray(r.descartadas));
  for (const m of r.movimientos) {
    assert.ok(Number.isFinite(m.monto) && m.monto > 0, `monto ${m.monto}`);
    assert.ok(Number.isFinite(m.fee), `fee ${m.fee}`);
    assert.ok(Number.isFinite(m.neto), `neto ${m.neto}`);
    assert.ok(m.referencia !== "");
    assert.ok(!Number.isNaN(Date.parse(m.fecha)), `fecha ${m.fecha}`);
  }
}));

test("importarCSV: sin filas, sólo encabezado o vacío da «no tiene filas» y no rompe", () => {
  for (const t of ["", "\n", "id,amount", "id,amount\n", "﻿", "   "]) {
    const r = importarCSV(t, "stripe", undefined);
    assert.equal(r.movimientos.length, 0);
    assert.equal(r.reembolsos.length, 0);
  }
});

test("importarCSV: cada fila es un cobro o está descartada (no se pierde ninguna) y lo que entra es válido", propiedad("conservación de filas", 300, (az) => {
  const { texto, filas } = csvAleatorio(az);
  const r = importarCSV(texto, "stripe", "proc_stripe", az.pick([0, 0.029]));
  assert.equal(r.movimientos.length + r.descartadas.length, filas.length, "cobros + descartadas = filas con datos");
  const refs = new Set<string>();
  for (const m of r.movimientos) {
    assert.ok(m.monto > 0 && Number.isFinite(m.monto));
    assert.ok(m.fee >= 0 && Number.isFinite(m.fee));
    assert.ok(["USD", "ARS"].includes(m.moneda));
    assert.ok(m.clienteEmail === undefined || m.clienteEmail === m.clienteEmail.toLowerCase(), "el mail se guarda en minúsculas");
    assert.ok(!Number.isNaN(Date.parse(m.fecha)));
    assert.equal(refs.has(m.referencia), false, "no repite referencias dentro del archivo");
    refs.add(m.referencia);
    assert.equal(m.procesadorId, "proc_stripe");
  }
  for (const re of r.reembolsos) {
    assert.ok(re.monto > 0 && Number.isFinite(re.monto));
    assert.ok(re.referencia !== "");
    assert.ok(!Number.isNaN(Date.parse(re.fecha)));
  }
  for (const d of r.descartadas) assert.ok(d.fila >= 2 && d.fila <= filas.length + 1, `fila ${d.fila} fuera del archivo`);
}));

test("importarCSV: un reembolso (estado devuelto o monto negativo) NUNCA entra como cobro", propiedad("reembolso no es cobro", 400, (az) => {
  const { texto, filas } = csvAleatorio(az);
  const r = importarCSV(texto, "stripe", "proc_stripe");
  const comoCobro = new Set(r.movimientos.map((m) => m.referencia));
  const comoReembolso = new Set(r.reembolsos.map((x) => x.referencia));
  for (const f of filas) {
    const esReembolso = f.tipo === "reembolso";
    if (esReembolso) {
      assert.equal(comoCobro.has(f.ref), false, `«${f.ref}» (estado «${f.estado}», monto ${f.monto}) entró como cobro`);
      assert.ok(comoReembolso.has(`reembolso:${f.ref}`), `«${f.ref}» tendría que proponerse como devolución`);
    }
    if (f.tipo === "rechazada" || f.tipo === "sinmonto") assert.equal(comoCobro.has(f.ref), false, `«${f.ref}» (estado «${f.estado}», monto ${f.monto}) no es un cobro`);
  }
  for (const x of r.reembolsos) assert.ok(x.referencia.startsWith("reembolso:"));
}));

test("importarCSV: con referencia, importar dos veces o con las filas en otro orden deja lo mismo", propiedad("idempotencia del CSV", 200, (az) => {
  const { texto } = csvAleatorio(az);
  const a = importarCSV(texto, "stripe", "proc_stripe", 0.029);
  const b = importarCSV(texto, "stripe", "proc_stripe", 0.029);
  assert.deepEqual(a, b, "el mismo archivo dos veces");

  const filas = leerCSV(texto);
  const encabezado = filas[0];
  const mezcladas = [encabezado, ...az.mezclar(filas.slice(1))];
  const quote = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const c = importarCSV(mezcladas.map((f) => f.map(quote).join(",")).join("\n"), "stripe", "proc_stripe", 0.029);
  const porRef = <T extends { referencia: string }>(xs: T[]) => [...xs].sort((x, y) => x.referencia.localeCompare(y.referencia));
  assert.deepEqual(porRef(c.movimientos), porRef(a.movimientos), "cobros iguales con las filas mezcladas");
  assert.deepEqual(porRef(c.reembolsos), porRef(a.reembolsos), "reembolsos iguales con las filas mezcladas");
}));

test("importarCSV: un cobro devuelto en parte entra entero y lo devuelto se propone aparte", () => {
  const csv = "id,Created (UTC),Amount,Amount Refunded,Currency,Status,Customer Email\nch_1,2026-09-01 10:00:00,100.00,30.00,usd,Paid,A@B.com";
  const r = importarCSV(csv, "stripe", "proc_stripe");
  assert.equal(r.movimientos.length, 1);
  assert.equal(r.movimientos[0].monto, 100);
  assert.equal(r.reembolsos.length, 1);
  assert.equal(r.reembolsos[0].monto, 30);
  assert.equal(r.reembolsos[0].referencia, "reembolso:ch_1");
  assert.deepEqual(r.reembolsos[0].referenciasCobro, ["ch_1"]);
});

test("importarCSV: lo devuelto nunca supera lo cobrado y el estado «refunded» sin monto devuelto propone todo", () => {
  const csv = "id,Date,Amount,Amount Refunded,Status\nch_1,2026-09-01,100,500,Paid\nch_2,2026-09-01,80,,Refunded";
  const r = importarCSV(csv, "stripe", undefined);
  assert.equal(r.reembolsos.find((x) => x.referencia === "reembolso:ch_1")?.monto, 100, "no se devuelve más de lo cobrado");
  assert.equal(r.reembolsos.find((x) => x.referencia === "reembolso:ch_2")?.monto, 80);
  assert.equal(r.movimientos.length, 1);
});

test("importarCSV: columnas en otro orden, con mayúsculas y con BOM se reconocen igual", () => {
  const a = importarCSV("id,Date,Amount,Fee,Customer Email\nch_1,2026-09-01,100,3,A@B.com", "stripe", undefined);
  const b = importarCSV("﻿CUSTOMER EMAIL,FEE,AMOUNT,DATE,ID\nA@B.com,3,100,2026-09-01,ch_1", "stripe", undefined);
  assert.deepEqual(a.movimientos, b.movimientos);
});

test("fechas dd/mm/aaaa con día de 13 a 31 se leen bien (el control del BUG de abajo)", propiedad("dd/mm con día > 12", 200, (az) => {
  const antes = process.env.TZ;
  process.env.TZ = "America/Argentina/Buenos_Aires";
  try {
    const d = az.int(13, 28), m = az.int(1, 12), a = az.int(2024, 2027);
    const sep = az.pick(["/", "-"]);
    const r = importarCSV(`id,Fecha,Monto\nx1,${String(d).padStart(2, "0")}${sep}${String(m).padStart(2, "0")}${sep}${a},100`, "manual", undefined);
    assert.equal(diaArgentina(r.movimientos[0].fecha), `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  } finally { if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes; }
}));

/* ==================================================================
   BUGS de verdad (cada uno con su repro mínimo). { todo: true }: se corren
   y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: una fecha sólo con día («2026-10-01») se lee como medianoche UTC y cae en el día anterior de Argentina", { todo: true }, () => {
  /* aFecha: new Date("2026-10-01") = 00:00 UTC = 21:00 del 30/09 en Argentina. El pago toma
     esa fecha (pagoDesdeMovimiento: fecha = mov.fecha) y las finanzas usan diaArgentina():
     un cobro del 1 de octubre queda en septiembre. La rama dd/mm/aaaa sí pone el mediodía. */
  const r = importarCSV("id,date,amount\nx1,2026-10-01,100", "manual", undefined);
  assert.equal(diaArgentina(r.movimientos[0].fecha), "2026-10-01");
  const dm = importarCSV("id,date,amount\nx2,01/10/2026,100", "manual", undefined);
  assert.equal(diaArgentina(dm.movimientos[0].fecha), "2026-10-01", "la rama dd/mm/aaaa sí lo hace bien (referencia)");
});

test("BUG: «Created (UTC)» de Stripe se lee en la zona horaria de quien importa, no en UTC", { todo: true }, () => {
  /* El export dice «(UTC)» pero new Date("2026-09-01 02:00:00") (con espacio) es hora LOCAL.
     Importado desde un navegador de Argentina (UTC−3), el instante corre 3 horas y los cobros
     entre las 00:00 y las 03:00 UTC caen un día después. */
  const antes = process.env.TZ;
  process.env.TZ = "America/Argentina/Buenos_Aires";
  try {
    const r = importarCSV("id,Created (UTC),Amount\nch_1,2026-09-01 02:00:00,100", "stripe", undefined);
    assert.equal(r.movimientos[0].fecha, "2026-09-01T02:00:00.000Z");
  } finally {
    if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes;
  }
});

test("BUG: sin columna de referencia el id sale del número de fila: el mismo archivo con una fila nueva arriba duplica todo", { todo: true }, () => {
  /* referencia = `${proveedor}-${fecha}-${monto}-${i}`: la «i» es la posición. Un extracto
     (Galicia, la financiera: «Otro (planilla)») que se baja de nuevo con movimientos nuevos
     arriba cambia la «i» de todos los viejos, la referencia ya no es la misma y
     importarMovimientos (que dedupe por referencia) los vuelve a cargar. */
  const viejo = "Fecha,Monto,Nombre\n2026-09-01,500,Ana\n2026-09-02,700,Beto";
  const nuevo = "Fecha,Monto,Nombre\n2026-09-03,100,Cami\n2026-09-01,500,Ana\n2026-09-02,700,Beto";
  const a = new Set(importarCSV(viejo, "manual", undefined).movimientos.map((m) => m.referencia));
  const b = importarCSV(nuevo, "manual", undefined).movimientos.map((m) => m.referencia);
  const repetidos = b.filter((r) => a.has(r)).length;
  assert.equal(repetidos, 2, "los dos cobros que ya estaban tienen que seguir con la misma referencia");
});

test("BUG: los estados en español «pendiente», «expirado», «fallido», «anulado», «en disputa» entran como cobro", { todo: true }, () => {
  /* RECHAZADOS sólo conoce «pending|expired|dispute|fail» en inglés (y cancel/rechaz en
     español). Un informe de Hotmart en español con esos estados mete cobros que no se cobraron. */
  const entran: string[] = [];
  for (const estado of ["Pendiente", "Expirado", "Fallido", "Anulado", "En disputa", "Vencido", "Esperando pago"]) {
    const r = importarCSV(`id,Fecha,Monto,Estado\nHP1,2026-09-01,100,${estado}`, "hotmart", undefined);
    if (r.movimientos.length) entran.push(estado);
  }
  assert.deepEqual(entran, [], "estas filas no son plata cobrada");
});

test("BUG: Stripe en ARS convertido a USD: el monto es el convertido pero la moneda sale de la columna «Currency» original (ARS)", { todo: true }, () => {
  /* Los alias de monto empiezan por «converted amount» (a propósito), pero los de moneda por
     «currency» y no «converted currency»: 120 USD quedan anotados como 120 ARS. Lo mismo con
     «Amount Refunded» vs «Converted Amount Refunded». */
  const csv = "id,Created (UTC),Amount,Currency,Converted Amount,Converted Currency,Fee\nch_1,2026-09-01 10:00:00,150000.00,ars,120.00,usd,3.50";
  const m = importarCSV(csv, "stripe", undefined).movimientos[0];
  assert.equal(m.monto, 120);
  assert.equal(m.moneda, "USD");
});

test("BUG: aNumero lee «1.500» como 1,5 (lo que escribe alguien de acá es mil quinientos)", { todo: true }, () => {
  /* leerMonto (lib/monto.ts, el de los formularios) ya resuelve «un solo punto con tres cifras
     detrás = miles»; aNumero (el del CSV) no, y en un extracto en pesos sin decimales la
     diferencia es de mil veces. */
  assert.equal(leerMonto("1.500"), 1500);
  assert.equal(aNumero("1.500"), 1500);
  assert.equal(aNumero("150.000"), 150000);
});

test("BUG: leerCSV corta en TODAS las comas, puntos y comas y tabuladores a la vez: un CSV con «;» y coma decimal, o lo pegado de una planilla en es-AR, pierde los decimales y corre las columnas", { todo: true }, () => {
  /* Con «;» de separador y «1234,56» sin comillas (lo que exporta Excel en español), o con «1.234,56» pegado de una hoja
     de cálculo (tabuladores), la coma del número parte la celda: 1234,56 queda en 1234 (los centavos pasan a ser otra
     columna), 1.500,00 queda en 1,5 y el nombre cae en la columna de la referencia. aNumero() está pensada para «1.234,56»
     pero ese texto nunca le llega. Habría que elegir UN separador mirando el encabezado. */
  const puntoYComa = "Fecha;Monto;Nombre;Referencia\n2026-09-01;1234,56;Ana Pérez;TR-1\n2026-09-02;1.500,00;Beto;TR-2";
  const m = importarCSV(puntoYComa, "manual", undefined).movimientos;
  assert.deepEqual(m.map((x) => [x.referencia, x.monto, x.clienteNombre]), [["TR-1", 1234.56, "Ana Pérez"], ["TR-2", 1500, "Beto"]]);
  const pegado = "Fecha\tMonto\tNombre\n2026-09-01\t1.234,56\tAna Pérez";
  const p = importarCSV(pegado, "manual", undefined).movimientos;
  assert.deepEqual(p.map((x) => [x.monto, x.clienteNombre]), [[1234.56, "Ana Pérez"]]);
  assert.deepEqual(leerCSV("a;b\n1;2,5"), [["a", "b"], ["1", "2,5"]]);
});

test("BUG: una fecha que no se entiende («27.01.2024» con puntos, «N/A», «pendiente») entra con la fecha de HOY, sin avisar", { todo: true }, () => {
  /* aFecha() devuelve new Date() cuando ni new Date(texto) ni la rama dd/mm/aaaa (que sólo acepta «/» y «-», no «.») la
     entienden: el cobro queda en el día en que se importó, no se descarta ni se avisa en las filas salteadas. */
  const antes = process.env.TZ;
  process.env.TZ = "America/Argentina/Buenos_Aires";
  try {
    const hoy = diaArgentina(new Date().toISOString());
    const conHoy: string[] = [];
    for (const texto of ["27.01.2024", "N/A", "pendiente", "sin fecha", "31/02/2026"]) {
      const r = importarCSV(`id,Fecha,Monto\nx1,${texto},100`, "manual", undefined);
      if (r.movimientos.length && diaArgentina(r.movimientos[0].fecha) === hoy && r.descartadas.length === 0) conHoy.push(texto);
    }
    assert.deepEqual(conHoy, [], "una fecha ilegible tendría que descartar la fila (o avisarlo), no tomar la de hoy");
  } finally { if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes; }
});

test("BUG: una fecha dd/mm/aaaa con día de 1 a 12 («05/10/2026», «12-09-2026», «01.10.2026») se lee como mm/dd: el 5 de octubre queda como el 10 de mayo", { todo: true }, () => {
  /* aFecha() prueba primero new Date(texto): V8 acepta «05/10/2026» (y «05-10-2026») como mes/día de EE.UU. y devuelve
     el 10 de mayo; la rama dd/mm/aaaa («el formato de los reportes en español») sólo se alcanza con días de 13 a 31,
     que son los que new Date rechaza. La mitad de las fechas de cada mes de un CSV en español quedan en otro mes, sin aviso. */
  const antes = process.env.TZ;
  process.env.TZ = "America/Argentina/Buenos_Aires";
  try {
    const mal: string[] = [];
    for (const [texto, esperado] of [["05/10/2026", "2026-10-05"], ["12/09/2026", "2026-09-12"], ["01-10-2026", "2026-10-01"], ["01.10.2026", "2026-10-01"], ["3/4/2026", "2026-04-03"]] as const) {
      const r = importarCSV(`id,Fecha,Monto\nx1,${texto},100`, "manual", undefined);
      const dia = diaArgentina(r.movimientos[0].fecha);
      if (dia !== esperado) mal.push(`${texto} → ${dia} (esperado ${esperado})`);
    }
    assert.deepEqual(mal, []);
  } finally { if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes; }
});
