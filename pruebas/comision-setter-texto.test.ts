import test from "node:test";
import assert from "node:assert/strict";
import { tasaDeTexto, textoDeTasa, textoParaEditar } from "@/lib/comision-setter";
import { puedeFijarComisionDeSetter, type MiAcceso } from "@/lib/permisos";

/* El % del setter en una venta se escribe como porcentaje (2,5) y se guarda como fracción (0,025). Vacío = el de siempre. */

test("lo escrito se vuelve la fracción que se guarda", () => {
  assert.equal(tasaDeTexto(""), null, "vacío: el de siempre");
  assert.equal(tasaDeTexto("  "), null);
  assert.equal(tasaDeTexto("0"), 0, "0 es un valor: no comisiona");
  assert.equal(tasaDeTexto("5"), 0.05);
  assert.equal(tasaDeTexto("2,5"), 0.025, "con coma");
  assert.equal(tasaDeTexto("2.5%"), 0.025, "con punto y el signo");
  assert.equal(tasaDeTexto("100"), 1);
  assert.equal(tasaDeTexto("0,35"), 0.0035);
});

test("algo que no es un porcentaje de 0 a 100 no se guarda", () => {
  for (const malo of ["abc", "-1", "101", "5 por ciento", "1,2,3", "%"]) assert.equal(tasaDeTexto(malo), undefined, malo);
});

test("se lee de vuelta igual: lo guardado vuelve a ser lo escrito", () => {
  for (const n of [0, 0.01, 0.025, 0.05, 0.1, 1]) {
    assert.equal(tasaDeTexto(textoParaEditar(n)), n, `${n}`);
  }
  assert.equal(textoParaEditar(null), "");
  assert.equal(textoParaEditar(undefined), "");
  assert.equal(textoDeTasa(0.05), "5%");
  assert.equal(textoDeTasa(0), "0%");
});

test("fijar el % de un setter lo hacen los dueños y quien tiene «Liquidación: editar», nadie más", () => {
  const a = (tipo: string, areas: MiAcceso["areas"]): MiAcceso => ({ tipo, nombre: tipo, areas, soloLoSuyo: false });
  assert.equal(puedeFijarComisionDeSetter(a("dueno", {})), true);
  assert.equal(puedeFijarComisionDeSetter(a("contenido_finanzas", { liquidacion: "editar", ventas: "editar" })), true);
  assert.equal(puedeFijarComisionDeSetter(a("contenido_finanzas", { liquidacion: "ver", ventas: "editar" })), false);
  assert.equal(puedeFijarComisionDeSetter(a("closer", { crm: "editar", ventas: "editar" })), false);
  assert.equal(puedeFijarComisionDeSetter(a("admin", { finanzas: "editar", ventas: "editar" })), false);
  assert.equal(puedeFijarComisionDeSetter(null), false);
});
