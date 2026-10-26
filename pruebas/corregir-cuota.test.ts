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

test("corregir una cuota a lo ya cobrado la deja pagada (Demian, 24/10: pagó 976 por Stripe y la cuota era de 979 por el redondeo)", () => {
  const { cuota, venta } = pendienteSinCobros();
  const e0 = estado();
  const proc = e0.procesadores[0]?.id;
  const cobrado = Math.round((cuota.monto - 3) * 100) / 100;
  assert.equal(acciones.registrarPago({ cuotaId: cuota.id, cobros: [{ procesadorId: proc, monto: cobrado, fecha: "2026-10-23" }], reajuste: "pendiente" }), true);
  assert.equal(estado().cuotas.find((c) => c.id === cuota.id)!.estado, "pendiente", "le faltan 3");
  assert.equal(acciones.corregirCuota(cuota.id, { monto: cobrado - 1 }, "menos de lo cobrado"), null, "menos de lo cobrado, no");
  assert.ok(acciones.corregirCuota(cuota.id, { monto: cobrado }, "diferencia de redondeo: Stripe le cobra 976 por mes"));
  const e = estado();
  const c = e.cuotas.find((x) => x.id === cuota.id)!;
  assert.deepEqual([c.monto, c.estado], [cobrado, "pagada"]);
  assert.equal(e.ventas.find((v) => v.id === venta.id)!.precioAcordado, Math.round((venta.precioAcordado - 3) * 100) / 100, "el total de la venta baja los 3");
});

/* La raíz (25/10): al cargar el pago de 976 la única salida era dejar 3 pendientes o pasarlos a una cuota nueva.
   Ahora, al registrarlo, la diferencia se puede dar por no cobrada y la cuota queda cerrada en el momento. */
test("registrar un pago corto con «saldar»: la cuota queda pagada en lo cobrado y la venta baja la diferencia, con el motivo", () => {
  const { cuota, venta } = pendienteSinCobros();
  const proc = estado().procesadores[0]?.id;
  const cobrado = Math.round((cuota.monto - 3) * 100) / 100;
  const pagosAntes = estado().pagos.length;
  assert.equal(acciones.registrarPago({ cuotaId: cuota.id, cobros: [{ procesadorId: proc, monto: cobrado, fecha: "2026-10-23" }], reajuste: "saldar", motivo: "  " }), false, "sin motivo no se salda");
  assert.equal(estado().pagos.length, pagosAntes, "y no queda el pago a medias");
  assert.equal(acciones.registrarPago({ cuotaId: cuota.id, cobros: [{ procesadorId: proc, monto: cobrado, fecha: "2026-10-23" }], reajuste: "saldar", motivo: "redondeo del plan" }), true);
  const e = estado();
  const c = e.cuotas.find((x) => x.id === cuota.id)!;
  assert.deepEqual([c.monto, c.estado], [cobrado, "pagada"]);
  assert.match(c.notas ?? "", /no se cobra: redondeo del plan/);
  const v = e.ventas.find((x) => x.id === venta.id)!;
  assert.equal(v.precioAcordado, Math.round((venta.precioAcordado - 3) * 100) / 100, "el total de la venta baja los 3");
  const plan = e.cuotas.filter((x) => x.ventaId === venta.id && x.estado !== "cancelada").reduce((t, x) => t + Math.round(x.monto * 100), 0);
  assert.equal(plan, Math.round(v.precioAcordado * 100), "las cuotas siguen sumando el precio de la venta");
  assert.equal(e.cuotas.filter((x) => x.ventaId === venta.id).length, estado().cuotas.filter((x) => x.ventaId === venta.id).length);
  assert.ok(e.actividad.some((a) => /no se cobra/.test(a.detalle ?? "") && /redondeo del plan/.test(a.detalle ?? "")), "queda en la actividad con el motivo");
});

test("el asistente de pago ofrece «no se cobra» y la cuota cobrada en parte, «Dar por saldada»", () => {
  const pago = readFileSync("src/components/cobros/RegistrarPago.tsx", "utf8");
  assert.match(pago, /saldar: "No se cobra: la cuota queda saldada"/);
  assert.match(pago, /Escribí por qué no se cobra la diferencia/);
  const acc = readFileSync("src/components/cobros/AccionesDeCuota.tsx", "utf8");
  assert.match(acc, /Dar por saldada/);
  assert.match(acc, /Falta escribir por qué/, "el botón apagado dice qué le falta");
});

/* Mariano, 26/10: Oscar Abad tenía 2 cuotas de 1.500, pagó 1.000 de la segunda y el resto lo paga en 7 días.
   No había forma de decirlo: el asistente proponía pasar los 500 a una cuota nueva un mes más tarde. */
test("pago parcial con el resto prometido: la cuota queda con lo que falta, vence el día prometido y no se mueve nada más", () => {
  const { cuota, venta } = pendienteSinCobros();
  const proc = estado().procesadores[0]?.id;
  const otras = estado().cuotas.filter((c) => c.ventaId === venta.id && c.id !== cuota.id).map((c) => [c.id, c.monto, c.vence]);
  const cobrado = Math.round(cuota.monto * 0.66 * 100) / 100;
  const falta = Math.round((cuota.monto - cobrado) * 100) / 100;
  const venceAntes = (cuota.vence ?? "").slice(0, 10);
  assert.equal(acciones.registrarPago({ cuotaId: cuota.id, cobros: [{ procesadorId: proc, monto: cobrado, fecha: "2026-10-26" }], reajuste: "pendiente", venceSaldo: "2026-11-02" }), true);
  const e = estado();
  const c = e.cuotas.find((x) => x.id === cuota.id)!;
  assert.deepEqual([c.estado, c.monto], ["pendiente", cuota.monto], "sigue pendiente por el mismo monto");
  assert.equal((c.vence ?? "").slice(0, 10), "2026-11-02", "pasa a vencer el día que dijo que paga");
  assert.match(c.notas ?? "", new RegExp(`pagó ${cobrado} de ${cuota.monto} y el resto \\(${falta}\\) lo paga el 2026-11-02`));
  assert.deepEqual(
    e.cuotas.filter((x) => x.ventaId === venta.id && x.id !== cuota.id).map((x) => [x.id, x.monto, x.vence]), otras,
    "las demás cuotas no cambian y no nace una cuota nueva",
  );
  assert.equal(e.ventas.find((v) => v.id === venta.id)!.precioAcordado, venta.precioAcordado, "el valor de la venta no cambia");
  assert.ok(e.actividad.some((a) => /el cliente los paga el 2026-11-02/.test(a.detalle ?? "") && new RegExp(`vencía el ${venceAntes}`).test(a.detalle ?? "")));

  // Cuando llega el resto, se carga en la misma cuota y queda cobrada.
  assert.equal(acciones.registrarPago({ cuotaId: cuota.id, cobros: [{ procesadorId: proc, monto: falta, fecha: "2026-11-02" }], reajuste: "pendiente" }), true);
  const final = estado().cuotas.find((x) => x.id === cuota.id)!;
  assert.deepEqual([final.estado, final.monto], ["pagada", cuota.monto]);
});

test("sin fecha prometida (o la misma que ya tenía) el vencimiento no se toca", () => {
  const { cuota } = pendienteSinCobros();
  const proc = estado().procesadores[0]?.id;
  const antes = cuota.vence;
  assert.equal(acciones.registrarPago({ cuotaId: cuota.id, cobros: [{ procesadorId: proc, monto: 10, fecha: "2026-10-26" }], reajuste: "pendiente" }), true);
  const c = estado().cuotas.find((x) => x.id === cuota.id)!;
  assert.equal(c.vence, antes);
  assert.ok(!/lo paga el/.test(c.notas ?? ""));
});

test("el asistente propone dejar el resto en la cuota con fecha, y no repartirlo en otras cuotas", () => {
  const pago = readFileSync("src/components/cobros/RegistrarPago.tsx", "utf8");
  assert.match(pago, /pendiente: "Lo paga después: el resto queda en esta cuota"/);
  assert.match(pago, /¿Cuándo paga el resto\?/);
  assert.match(pago, /\? "saldar" : "pendiente"\)/, "por defecto el resto queda pendiente (antes se repartía solo en las otras cuotas)");
  assert.match(pago, /venceSaldo: saldo > 0\.01 && reajuste === "pendiente" \? venceSaldo : undefined/);
});

test("la ayuda «¿Cambió cómo paga?» cubre cada caso con el botón que existe de verdad", () => {
  const ayuda = readFileSync("src/components/cobros/AyudaDeCuotas.tsx", "utf8");
  const pago = readFileSync("src/components/cobros/RegistrarPago.tsx", "utf8");
  const acc = readFileSync("src/components/cobros/AccionesDeCuota.tsx", "utf8");
  const ficha = readFileSync("src/components/ficha/TarjetaVenta.tsx", "utf8");
  const pagina = readFileSync("src/app/(app)/ventas/page.tsx", "utf8");
  assert.match(pagina, /<AyudaDeCuotas \/>/, "el botón está en Ventas");
  /* Cada botón que la ayuda nombra tiene que estar escrito igual en la pantalla donde se toca. */
  for (const texto of ["Lo paga después: el resto queda en esta cuota", "No se cobra: la cuota queda saldada", "Repartirlo en las cuotas que siguen",
    "Sumarlo a la próxima cuota", "Pasarlo a una cuota nueva"]) {
    assert.ok(ayuda.includes(texto), `la ayuda nombra «${texto}»`);
    assert.ok(pago.includes(texto), `el asistente tiene «${texto}»`);
  }
  for (const boton of ["Cambiar fecha", "Incobrable", "Dar por saldada", "Corregir monto", "Quitar cuota", "Volver a cobrar"]) {
    assert.ok(ayuda.includes(boton) && acc.includes(boton), `«${boton}» está en la ayuda y en la cuota`);
  }
  for (const boton of ["Eliminar este pago"]) assert.ok(ayuda.includes(boton) && pago.includes(boton));
  for (const boton of ["Marcar reembolsada", "Cargar una devolución", "Corregir"]) assert.ok(ayuda.includes(boton) && (ficha.includes(boton) || ficha.includes("devolución")), boton);
});
