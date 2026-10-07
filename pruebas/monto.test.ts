import test from "node:test";
import assert from "node:assert/strict";
import { escribirEnCampo, escribirMonto, leerMonto, mismoMonto, textoDeMonto, type OpcionesMonto } from "@/lib/monto";

/* Lo que hace el campo cuando alguien teclea: mete la tecla en el cursor y
   deja que escribirEnCampo la acomode. */
function teclear(estado: { texto: string; cursor: number }, tecla: string, o: OpcionesMonto = {}) {
  const crudo = estado.texto.slice(0, estado.cursor) + tecla + estado.texto.slice(estado.cursor);
  return escribirEnCampo(crudo, estado.cursor + tecla.length, { ...o, anterior: estado.texto, tecla });
}
function escribir(texto: string, o: OpcionesMonto = {}) {
  let e = { texto: "", cursor: 0 };
  for (const t of texto) e = teclear(e, t, o);
  return e;
}
/* Borrar con la tecla de retroceso: saca el carácter de antes del cursor. */
function retroceso(estado: { texto: string; cursor: number }, o: OpcionesMonto = {}) {
  const crudo = estado.texto.slice(0, estado.cursor - 1) + estado.texto.slice(estado.cursor);
  return escribirEnCampo(crudo, estado.cursor - 1, { ...o, anterior: estado.texto });
}
const pegar = (texto: string, o: OpcionesMonto = {}) => escribirEnCampo(texto, texto.length, { ...o, anterior: "", pegado: true });

test("a medida que se escribe, los puntos de miles aparecen solos", () => {
  assert.deepEqual(escribir("1"), { texto: "1", cursor: 1 });
  assert.deepEqual(escribir("1234"), { texto: "1.234", cursor: 5 });
  assert.deepEqual(escribir("1234567"), { texto: "1.234.567", cursor: 9 });
  assert.equal(escribir("100000").texto, "100.000");
});

test("la coma es el decimal y se pueden escribir dos cifras", () => {
  assert.equal(escribir("1234,").texto, "1.234,");
  assert.equal(escribir("1234,5").texto, "1.234,5");
  assert.equal(escribir("1234,50").texto, "1.234,50");
  assert.equal(escribir("1234,507").texto, "1.234,50", "la tercera cifra decimal no entra");
});

test("el punto que se teclea también es decimal, y una segunda coma no suma", () => {
  assert.equal(escribir("12.5").texto, "12,5");
  assert.equal(escribir("1234.50").texto, "1.234,50");
  assert.equal(escribir("12,5,").texto, "12,5");
  assert.equal(escribir("12,5.").texto, "12,5");
  assert.equal(escribir("12,5,6").texto, "12,56");
});

test("empezar con coma o con ceros", () => {
  assert.equal(escribir(",").texto, "0,");
  assert.deepEqual(escribir(",5"), { texto: "0,5", cursor: 3 });
  assert.equal(escribir("05").texto, "5");
  assert.equal(escribir("007").texto, "7");
  assert.equal(escribir("0").texto, "0");
  assert.equal(escribir("00").texto, "0");
  assert.equal(escribir("0,05").texto, "0,05");
});

test("los números enteros no dejan escribir decimales", () => {
  assert.equal(escribir("1234,5", { decimales: 0 }).texto, "12.345");
  assert.equal(escribir("12.5", { decimales: 0 }).texto, "125");
});

test("un tipo de cambio deja cuatro decimales", () => {
  assert.equal(escribir("1578,68507", { decimales: 4 }).texto, "1.578,6850");
});

test("el signo menos sólo entra si se lo permite", () => {
  assert.equal(escribir("-1234").texto, "1.234");
  assert.equal(escribir("-1234", { negativos: true }).texto, "-1.234");
  assert.equal(escribir("-", { negativos: true }).texto, "-");
  assert.equal(escribir("-1234,5", { negativos: true }).texto, "-1.234,5");
});

test("borrar no rompe los puntos y el cursor queda donde estaba", () => {
  /* Sobre un punto de miles: se corre el cursor y el número queda igual. */
  assert.deepEqual(retroceso({ texto: "1.234", cursor: 2 }), { texto: "1.234", cursor: 1 });
  /* Una cifra del medio. */
  assert.deepEqual(retroceso({ texto: "1.234.567", cursor: 5 }), { texto: "123.567", cursor: 3 });
  /* La última. */
  assert.deepEqual(retroceso({ texto: "1.234", cursor: 5 }), { texto: "123", cursor: 3 });
  /* Todo. */
  assert.deepEqual(retroceso({ texto: "5", cursor: 1 }), { texto: "", cursor: 0 });
  /* La coma: los decimales vuelven a ser enteros. */
  assert.equal(retroceso({ texto: "12,50", cursor: 3 }).texto, "1.250");
});

test("escribir en el medio deja el cursor después de lo que se escribió", () => {
  const e = teclear({ texto: "1.234", cursor: 1 }, "9");
  assert.deepEqual(e, { texto: "19.234", cursor: 2 });
  const f = teclear({ texto: "1.234", cursor: 3 }, "9");
  assert.equal(f.texto, "12.934");
  assert.equal(f.cursor, 4);
  /* Entre los decimales. */
  const g = teclear({ texto: "12,50", cursor: 3 }, "7");
  assert.deepEqual(g, { texto: "12,75", cursor: 4 });
});

test("un número pegado de afuera se entiende como lo escribió quien lo copió", () => {
  assert.equal(pegar("1234.56").texto, "1.234,56");
  assert.equal(pegar("1.234,56").texto, "1.234,56");
  assert.equal(pegar("1,234.56").texto, "1.234,56", "formato de Estados Unidos");
  assert.equal(pegar("1.234").texto, "1.234", "un punto con tres cifras detrás son miles");
  assert.equal(pegar("1.234.567").texto, "1.234.567");
  assert.equal(pegar("12.5").texto, "12,5");
  assert.equal(pegar("$ 1.500").texto, "1.500");
  assert.equal(pegar("US$ 2.000,25").texto, "2.000,25");
  assert.equal(pegar("1234").texto, "1.234");
  assert.equal(pegar("abc").texto, "");
});

test("textoDeMonto: cómo se ve un monto que viene de afuera", () => {
  assert.equal(textoDeMonto(1234.5), "1.234,5");
  assert.equal(textoDeMonto(1234567), "1.234.567");
  assert.equal(textoDeMonto(0), "0");
  assert.equal(textoDeMonto(-1500.25), "-1.500,25");
  assert.equal(textoDeMonto(0.5), "0,5");
  assert.equal(textoDeMonto(1578.685), "1.578,685");
  assert.equal(textoDeMonto("1234,5"), "1.234,5");
  assert.equal(textoDeMonto("1.234,5"), "1.234,5");
  assert.equal(textoDeMonto("1234,50"), "1.234,50", "no pierde el cero de atrás");
  assert.equal(textoDeMonto("12,"), "12,");
  assert.equal(textoDeMonto(""), "");
  assert.equal(textoDeMonto("  "), "");
  assert.equal(textoDeMonto(null), "");
  assert.equal(textoDeMonto(undefined), "");
  assert.equal(textoDeMonto(Number.NaN), "");
});

test("lo que se ve en el campo se lee igual con leerMonto", () => {
  for (const n of [0, 1, 5.5, 99.99, 1000, 1234.56, 145000, 1500000.5, 0.01, 7_654_321.25]) {
    assert.equal(leerMonto(textoDeMonto(n)), n, `${n} -> ${textoDeMonto(n)}`);
  }
  /* Y lo que se escribe tecla por tecla. */
  for (const t of ["1234567", "1234,5", "999999,99", "10", "100", "1000"]) {
    assert.equal(leerMonto(escribir(t).texto), leerMonto(t), t);
  }
});

test("leerMonto sigue leyendo lo que escribe cada uno", () => {
  assert.equal(leerMonto("145.000"), 145000);
  assert.equal(leerMonto("1.500,50"), 1500.5);
  assert.equal(leerMonto("1500,5"), 1500.5);
  assert.equal(leerMonto("1500.5"), 1500.5);
  assert.equal(leerMonto("US$ 25.000"), 25000);
  assert.ok(Number.isNaN(leerMonto("")));
  assert.equal(escribirMonto(1234.5), "1234,5");
});

test("mismoMonto: no pisa lo que se está escribiendo", () => {
  assert.ok(mismoMonto("1234,5", "1.234,5"));
  assert.ok(mismoMonto(12, "12,"), "una coma sin decimales todavía es el mismo número");
  assert.ok(mismoMonto("", 0), "vacío y 0 son lo mismo para un campo que guarda 0");
  assert.ok(mismoMonto(null, ""));
  assert.ok(!mismoMonto(12, "12,5"));
  assert.ok(!mismoMonto("", 5));
});
