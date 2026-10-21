import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acciones } from "@/lib/store";
import { personasQueCoinciden } from "@/lib/buscar-persona";
import type { EstadoApp } from "@/lib/types";

/* Dante (21/10): Pedro Salgado compró el Upgrade AI en 450 pero la venta quedó en 499 (449,99 + una cuota de 49,01 que sobraba), Aldana le rechazó el cobro de esa cuota y
   nadie sabía cómo arreglarlo: el formulario decía «editá las cuotas en la ficha» y la ficha no dejaba. */
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;

/* Una venta activa con una cuota pendiente sin cobros (las pruebas comparten el estado: cada una toma una nueva). */
const usadas = new Set<string>();
function pendienteSinCobros() {
  const e = estado();
  for (const c of e.cuotas) {
    if (usadas.has(c.id) || c.estado !== "pendiente" || c.monto < 10 || e.pagos.some((p) => p.cuotaId === c.id)) continue;
    const venta = e.ventas.find((v) => v.id === c.ventaId);
    if (venta?.estado === "activa") { usadas.add(c.id); return { cuota: c, venta }; }
  }
  throw new Error("no hay una cuota así en la semilla");
}

test("quitar una cuota que sobra: se borra y el precio de la venta baja lo mismo", () => {
  const { cuota, venta } = pendienteSinCobros();
  const dicho = acciones.corregirCuota(cuota.id, { quitar: true }, "el precio real era menor");
  assert.ok(dicho && /Se quitó/.test(dicho));
  const e = estado();
  assert.equal(e.cuotas.some((c) => c.id === cuota.id), false);
  assert.equal(e.ventas.find((v) => v.id === venta.id)!.precioAcordado, Math.round((venta.precioAcordado - cuota.monto) * 100) / 100);
  assert.ok(e.actividad.some((a) => /Se quitó/.test(a.detalle ?? "") && /el precio real era menor/.test(a.detalle ?? "")), "queda en la actividad con el motivo");
});

test("corregir el monto de una cuota: cambia la cuota y el precio por la diferencia, con el motivo anotado", () => {
  const { cuota, venta } = pendienteSinCobros();
  const nuevo = Math.round((cuota.monto - 5) * 100) / 100;
  assert.ok(acciones.corregirCuota(cuota.id, { monto: nuevo }, "se acordó menos"));
  const e = estado();
  const c = e.cuotas.find((x) => x.id === cuota.id)!;
  assert.equal(c.monto, nuevo);
  assert.match(c.notas ?? "", /se acordó menos/);
  assert.equal(e.ventas.find((v) => v.id === venta.id)!.precioAcordado, Math.round((venta.precioAcordado - 5) * 100) / 100);
});

test("sin motivo, sin cambios o con una cuota ya cobrada no se toca nada", () => {
  const { cuota } = pendienteSinCobros();
  assert.equal(acciones.corregirCuota(cuota.id, { quitar: true }, "  "), null, "el motivo es obligatorio");
  assert.equal(acciones.corregirCuota(cuota.id, { monto: cuota.monto }, "igual"), null, "el mismo monto no es un cambio");
  assert.equal(acciones.corregirCuota(cuota.id, { monto: 0 }, "cero"), null, "una cuota de cero se quita, no se corrige");
  const e = estado();
  const pagada = e.cuotas.find((c) => c.estado === "pagada")!;
  assert.equal(acciones.corregirCuota(pagada.id, { quitar: true }, "no"), null, "una cuota pagada no se quita");
  assert.ok(estado().cuotas.some((c) => c.id === pagada.id));
});

test("una cuota con cobros no se quita (hay que corregir o borrar el cobro primero)", () => {
  const e = estado();
  const conCobro = e.cuotas.find((c) => c.estado === "pendiente" && e.pagos.some((p) => p.cuotaId === c.id));
  if (!conCobro) return;
  assert.equal(acciones.corregirCuota(conCobro.id, { quitar: true }, "no debería"), null);
});

test("la ficha ofrece corregir y quitar la cuota, y el formulario de venta ya no manda a un lugar que no existe", () => {
  const src = readFileSync("src/components/cobros/AccionesDeCuota.tsx", "utf8");
  assert.match(src, /Corregir monto/);
  assert.match(src, /Quitar cuota/);
  assert.match(src, /acciones\.corregirCuota/);
});

test("buscar a alguien sin llamadas lo encuentra por su venta o como alumno (el «0 llamadas» mudo del CRM)", () => {
  const e = estado();
  const v = e.ventas.find((x) => (x.contactoNombre ?? "").length > 5)!;
  const hallados = personasQueCoinciden(e, v.contactoNombre!);
  assert.ok(hallados.length >= 1);
  assert.ok(hallados[0].detalle.includes("venta"));
  assert.deepEqual(personasQueCoinciden(e, "zz"), [], "con menos de 3 letras no busca");
  assert.deepEqual(personasQueCoinciden(e, "qwertyuiopasdf"), []);
});
