import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import {
  COLOR_COBROS, COMPROBANTE_FALTA, COMPROBANTE_SI, CONCILIADO_A_MANO, CONCILIADO_NO, CONCILIADO_SI, SIN_COBROS, SIN_VENTA, valoresComprobante, valoresConciliado,
} from "@/lib/crm-tabla";
import type { CobrosDeVenta } from "@/lib/control-cobros";

/* ==================================================================
   La celda «Comprobante» / «Conciliado» que se dibuja es la misma que el
   valor por el que se filtra y se ordena la columna: mismo caso, mismo
   color. (Se dibuja a texto con react-dom/server; el único arreglo es que
   el cargador de pruebas no conoce `next/link`, que sólo trae la ficha.)
   ================================================================== */

registerHooks({
  resolve(esp, ctx, siguiente) {
    if (/^next\/(link|navigation|image|dynamic|headers)$/.test(esp)) return siguiente(`${esp}.js`, ctx);
    return siguiente(esp, ctx);
  },
});

const TONO: Record<string, string> = { amarillo1: "warning", verde1: "success", gris1: "neutral" };

async function dibujar() {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { CeldaCobros } = await import("@/components/crm-tabla/CeldaCobros");
  return (clave: "comprobante" | "conciliado", cobros: CobrosDeVenta | null) => renderToStaticMarkup(React.createElement(CeldaCobros, { clave, cobros, onAbrir: () => undefined }));
}

test("la celda de cada llamada dice lo mismo que el valor de su columna (caso y color) para toda cuenta posible", async () => {
  const dibujo = await dibujar();
  let casos = 0;
  for (let total = 0; total <= 4; total++) for (let sinComp = 0; sinComp <= total; sinComp++) for (let conc = 0; conc <= total; conc++) for (let sinConc = 0; sinConc <= total - conc; sinConc++) {
    const c: CobrosDeVenta = { total, conPrueba: total - sinComp, sinComprobante: sinComp, conciliados: conc, sinConciliar: sinConc, aMano: total - conc - sinConc, pendientes: total, chequeados: 0, rechazados: 0, cobrado: 0, cargaron: [] };
    for (const [clave, valor] of [["comprobante", valoresComprobante(c)[0]], ["conciliado", valoresConciliado(c)[0]]] as const) {
      const html = dibujo(clave, c);
      const ctx = `${clave} ${JSON.stringify(c)} → ${valor}`;
      const tono = /hk-badge--(\w+)/.exec(html)?.[1];
      if (valor === SIN_COBROS) assert.ok(!tono && html.includes("Sin cobros"), ctx);
      else assert.equal(tono, TONO[COLOR_COBROS[valor]], `${ctx}: color de la celda (${html})`);
      if (valor === COMPROBANTE_FALTA) assert.ok(html.includes("Falta"), ctx);
      if (valor === COMPROBANTE_SI) assert.ok(!html.includes("Falta") && (html.includes("Sí") || html.includes("Todos")), ctx);
      if (valor === CONCILIADO_NO) assert.ok(html.includes("Sin conciliar"), ctx);
      if (valor === CONCILIADO_SI) assert.ok(html.includes("Sí"), ctx);
      if (valor === CONCILIADO_A_MANO) assert.ok(html.includes("A mano"), ctx);
      /* La cantidad que dice la celda es la de la cuenta. */
      if (valor === COMPROBANTE_FALTA && total > 1) assert.ok(html.includes(`Falta ${sinComp} de ${total}`), ctx);
      if (valor === CONCILIADO_NO && total > 1) assert.ok(html.includes(`Sin conciliar ${sinConc} de ${total}`), ctx);
      casos++;
    }
  }
  assert.ok(casos > 200);
  /* Sin venta no hay nada que mostrar, y es el valor «Sin venta» de la columna. */
  for (const clave of ["comprobante", "conciliado"] as const) assert.ok(dibujo(clave, null).includes("—"));
  assert.equal(valoresComprobante(null)[0], SIN_VENTA);
});
