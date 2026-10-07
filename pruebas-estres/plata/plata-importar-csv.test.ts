import { azar, donde, r2 } from "./plata-mundo";
import test from "node:test";
import assert from "node:assert/strict";
import { aNumero, importarCSV } from "@/lib/pasarelas";
import { diaDeNegocio } from "@/lib/dia-negocio";

/* ==================================================================
   Frente «la plata» · el CSV de una pasarela entra con los montos que dice.

   Los reembolsos y los cobros que se importan por archivo alimentan las devoluciones y Finanzas: si el monto entra
   mal, entra mal en todas las pantallas. Se escribe el mismo archivo en los formatos que de verdad se ven (coma o
   punto y coma, punto o coma decimal, con y sin miles, con y sin comillas) y se comprueba que lo importado es lo escrito.
   ================================================================== */

type Formato = {
  nombre: string;
  delimitador: string;
  /* Cómo se escribe un monto. */
  escribir: (n: number) => string;
  comillas: boolean;
};

const miles = (n: number, punto: string, coma: string, decimales: boolean) => {
  const [ent, dec] = Math.abs(n).toFixed(2).split(".");
  const conMiles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, punto);
  return `${n < 0 ? "-" : ""}${conMiles}${decimales ? coma + dec : ""}`;
};

const FORMATOS: Formato[] = [
  { nombre: "coma, punto decimal, sin miles (Stripe)", delimitador: ",", escribir: (n) => n.toFixed(2), comillas: false },
  { nombre: "coma, punto decimal, miles con coma entre comillas", delimitador: ",", escribir: (n) => miles(n, ",", ".", true), comillas: true },
  { nombre: "tabulador, punto decimal", delimitador: "\t", escribir: (n) => n.toFixed(2), comillas: false },
  { nombre: "punto y coma, coma decimal, entre comillas", delimitador: ";", escribir: (n) => miles(n, ".", ",", true), comillas: true },
  { nombre: "punto y coma, coma decimal, sin miles (Excel en español)", delimitador: ";", escribir: (n) => n.toFixed(2).replace(".", ","), comillas: false },
  { nombre: "punto y coma, coma decimal, con miles con punto (Excel en español)", delimitador: ";", escribir: (n) => miles(n, ".", ",", true), comillas: false },
  { nombre: "punto y coma, enteros con miles con punto (pesos sin decimales)", delimitador: ";", escribir: (n) => miles(Math.round(n), ".", ",", false), comillas: false },
];

const csvDe = (f: Formato, filas: { ref: string; monto: number }[]) => {
  const q = (s: string) => (f.comillas ? `"${s}"` : s);
  return [["Fecha", "Referencia", "Monto", "Estado"].join(f.delimitador),
    ...filas.map((x) => ["10/09/2026", x.ref, q(f.escribir(x.monto)), "approved"].join(f.delimitador))].join("\n");
};

for (const f of FORMATOS) {
  test(`importar un CSV: ${f.nombre}`, () => {
    for (let semilla = 1; semilla <= 60; semilla++) {
      const r = azar(semilla);
      /* Montos de pesos y de dólares, con y sin miles. Los de «enteros» van sin centavos. */
      const filas = Array.from({ length: r.entre(1, 6) }, (_, i) => ({
        ref: `tx_${semilla}_${i}`,
        monto: f.nombre.includes("enteros") ? r.entre(1, 5_000_000) : r2(r.elige([r.plata(1, 999), r.plata(1000, 99999), r.plata(100000, 5000000)])),
      }));
      const res = importarCSV(csvDe(f, filas), "mercadopago", "proc_mercadopago");
      assert.deepEqual(
        res.movimientos.map((m) => [m.referencia, m.monto]), filas.map((x) => [x.ref, x.monto]),
        donde(semilla, f.nombre, JSON.stringify(res.descartadas)),
      );
    }
  });
}

test("importar el mismo CSV dos veces da los mismos movimientos y los mismos reembolsos, con las mismas referencias", () => {
  const r = azar(9);
  for (let i = 0; i < 80; i++) {
    const filas = Array.from({ length: r.entre(2, 8) }, (_, j) => {
      const monto = r.plata(50, 3000);
      const estado = r.elige(["succeeded", "succeeded", "Refunded", "failed", "pending"]);
      return `ch_${i}_${j},2026-09-${String(r.entre(1, 28)).padStart(2, "0")} 10:00:00,${monto.toFixed(2)},usd,${estado},${r.si(0.3) ? (monto / 2).toFixed(2) : ""},cli${j}@mail.com`;
    });
    const csv = ["id,Created date (UTC),Amount,Currency,Status,Amount Refunded,Customer Email", ...filas].join("\n");
    const a = importarCSV(csv, "stripe", "proc_stripe"), b = importarCSV(csv, "stripe", "proc_stripe");
    assert.deepEqual(a, b, `vuelta ${i}`);
    /* Un cobro devuelto no entra como cobro: se propone como devolución, con el id del cobro. */
    for (const x of a.reembolsos) assert.ok(x.referencia.startsWith("reembolso:ch_"), x.referencia);
    const idsCobro = new Set(a.movimientos.map((m) => m.referencia));
    for (const x of a.reembolsos.filter((y) => y.motivo === undefined)) assert.ok(x.monto > 0 && x.fechaDelCobro === true, `vuelta ${i}`);
    assert.equal(idsCobro.size, a.movimientos.length, "una referencia dos veces");
  }
});

test("aNumero lee los montos de acá y de allá cuando el separador no deja dudas", () => {
  for (const [texto, n] of [
    ["1.234,56", 1234.56], ["1,234.56", 1234.56], ["15000", 15000], ["15,5", 15.5], ["0,5", 0.5], ["12.5", 12.5], ["-2.500,75", -2500.75],
    ["$ 1.500,00", 1500], ["USD 99.99", 99.99], ["", 0], ["abc", 0],
  ] as const) assert.equal(aNumero(texto), n, `«${texto}»`);
});

/* ---------- Las fechas del archivo ---------- */


const fechaDe = (cabecera: string, valor: string) =>
  importarCSV(`${cabecera},Referencia,Monto\n${valor},x1,100.00\n`, "stripe", "proc_stripe").movimientos[0]?.fecha;

test("las fechas que no dejan dudas entran bien: con zona horaria, con hora, y dd/mm/aaaa con el día mayor a 12", () => {
  assert.equal(fechaDe("Fecha", "2026-09-10T14:30:00Z"), "2026-09-10T14:30:00.000Z");
  assert.equal(fechaDe("Fecha", "2026-09-10T14:30:00-03:00"), "2026-09-10T17:30:00.000Z");
  assert.equal(diaDeNegocio(fechaDe("Fecha", "13/09/2026")), "2026-09-13");
  assert.equal(diaDeNegocio(fechaDe("Fecha", "25/12/2026")), "2026-12-25");
});

test("BUG: dd/mm/aaaa con el día de 1 a 12 se lee como mm/dd/aaaa (el 10/09 entra como 9 de octubre)", () => {
  for (const dia of [1, 5, 9, 10, 12]) {
    const texto = `${String(dia).padStart(2, "0")}/09/2026`;
    assert.equal(diaDeNegocio(fechaDe("Fecha", texto)), `2026-09-${String(dia).padStart(2, "0")}`, `«${texto}» es el ${dia} de septiembre`);
  }
  assert.equal(diaDeNegocio(fechaDe("Fecha", "05/10/2026")), "2026-10-05", "«05/10/2026» es el 5 de octubre, no el 10 de mayo");
});

test("BUG: una fecha sin hora (2026-10-01) se lee a medianoche UTC: en Argentina es el 30/09 y el cobro del 1° cae en el mes anterior", () => {
  assert.equal(diaDeNegocio(fechaDe("Fecha", "2026-10-01")), "2026-10-01");
  assert.equal(diaDeNegocio(fechaDe("Fecha", "2026-01-01")), "2026-01-01");
});

test("BUG: una columna «(UTC)» sin zona se lee con la hora de acá: el cobro de las 01:00 UTC del 1/10 (22:00 del 30/09 en Argentina) entra en octubre", () => {
  assert.equal(fechaDe("Created date (UTC)", "2026-10-01 01:00:00"), "2026-10-01T01:00:00.000Z");
});
