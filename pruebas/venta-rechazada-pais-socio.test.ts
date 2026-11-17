/* 17/11/2026, tres cosas del mismo día:
   1. Mariano cargó la venta de un lead que era de Dante: la base la rechazó y la app dijo que había quedado (lib/rechazos.ts).
   2. Aldana: «me quedó sin país». El país por prefijo del teléfono lo sabía sólo la tabla del CRM (lib/pais-de-telefono.ts).
   3. Nahuel: su panel era el de un closer. Ahora ve lo que le corresponde, con la cuenta de la liquidación (lib/panel-socio.ts). */
import test from "node:test";
import assert from "node:assert/strict";
import { anotarRechazo, avisoDeVentaRechazada, motivoDeLaBase, olvidarRechazo, rechazoDe } from "@/lib/rechazos";
import { paisCon, paisDeTelefono, PAISES } from "@/lib/pais-de-telefono";
import * as crmTabla from "@/lib/crm-tabla";
import { personaDe } from "@/lib/persona";
import { conPanel, vistaDePanel } from "@/lib/mi-panel";
import { loQueLeCorresponde } from "@/lib/panel-socio";
import { calcularLiquidacion, liquidacionVacia } from "@/lib/honorarios";
import { construirSemilla as inicial } from "@/lib/seed";
import type { EstadoApp } from "@/lib/types";

test("el motivo de un candado de la base se muestra tal cual; el de Postgres, no", () => {
  assert.equal(motivoDeLaBase("Tu tipo de cuenta no puede atar una venta a la llamada de otro."), "Tu tipo de cuenta no puede atar una venta a la llamada de otro.");
  assert.equal(motivoDeLaBase("Este cobro ya lo chequeó otra persona."), "Este cobro ya lo chequeó otra persona.");
  assert.equal(motivoDeLaBase('new row violates row-level security policy for table "ventas"'), undefined);
  assert.equal(motivoDeLaBase(null), undefined);
});

test("una fila rechazada queda anotada con su motivo hasta que entra", () => {
  assert.equal(rechazoDe("ventas", "v1"), null);
  anotarRechazo("ventas", ["v1", undefined], "Tu tipo de cuenta no puede atar una venta a la llamada de otro.");
  anotarRechazo("cuotas", ["c1"]);
  assert.equal(rechazoDe("ventas", "v1"), "Tu tipo de cuenta no puede atar una venta a la llamada de otro.");
  assert.ok(rechazoDe("cuotas", "c1"), "sin motivo de la base, uno genérico");
  assert.equal(rechazoDe("cuotas", "v1"), null, "es por tabla");
  olvidarRechazo("ventas", ["v1"]);
  assert.equal(rechazoDe("ventas", "v1"), null);
});

test("el aviso de una venta rechazada dice que NO se guardó (nunca «quedó registrada»)", () => {
  const aviso = avisoDeVentaRechazada("Kevin", "Tu tipo de cuenta no puede atar una venta a la llamada de otro.");
  assert.match(aviso, /La venta de Kevin NO se guardó/);
  assert.match(aviso, /tu tipo de cuenta no puede atar una venta a la llamada de otro\./);
  assert.doesNotMatch(aviso, /quedó registrada/);
});

test("el país sale del prefijo del teléfono cuando nadie lo cargó, y lo cargado manda", () => {
  assert.equal(paisDeTelefono("+51 932 622 044"), "Perú");
  assert.equal(paisCon("", "+51 932 622 044"), "Perú");
  assert.equal(paisCon(null, "+54 9 11 4526-0101"), "Argentina");
  assert.equal(paisCon("México", "+51 932 622 044"), "México", "lo que alguien cargó no se pisa");
  assert.equal(paisCon("", "932 622 044"), "", "sin el + no se adivina");
  assert.equal(crmTabla.paisDeTelefono, paisDeTelefono, "el CRM usa la misma regla");
  assert.equal(crmTabla.PAISES, PAISES);
});

test("la ficha de una persona sin país cargado muestra el de su teléfono", () => {
  const e = inicial();
  const lead = { ...e.leads[0], id: "lea_kevin", contactoId: undefined, nombre: "Kevin", email: "kevin@ejemplo.test", telefono: "+51 932 622 044", pais: undefined };
  const p = personaDe({ ...e, leads: [lead] } as EstadoApp, "lea_kevin");
  assert.equal(p?.pais, "Perú");
  const conPais = personaDe({ ...e, leads: [{ ...lead, pais: "Chile" }] } as EstadoApp, "lea_kevin");
  assert.equal(conPais?.pais, "Chile");
});

test("el socio tiene panel, y no es el del closer", () => {
  assert.equal(vistaDePanel({ rol: "socio", puesto: "Socio de Yari · IT Mentor" }), "otro");
  assert.equal(conPanel({ rol: "socio", activo: true, puesto: "Socio de Yari · IT Mentor" }), true);
  assert.equal(conPanel({ rol: "socio", activo: false }), false);
});

test("lo que le corresponde al socio es lo mismo que dice la liquidación del mes", () => {
  const e = inicial();
  const socio = e.equipo.find((m) => m.rol === "socio");
  assert.ok(socio, "la demo trae un socio");
  const periodo = "2026-10";
  const d = loQueLeCorresponde(e, socio.id, periodo);
  const r = calcularLiquidacion(e, periodo, e.liquidaciones.find((x) => x.periodo === periodo) ?? liquidacionVacia(periodo));
  const enLiquidacion = r.personas.find((p) => p.miembroId === socio.id);
  assert.equal(d.total, enLiquidacion?.total ?? 0);
  assert.deepEqual(d.lineas.map((l) => [l.clave, l.monto]), (enLiquidacion?.lineas ?? []).map((l) => [l.clave, l.monto]));
  assert.equal(d.mes.toLowerCase(), "octubre 2026");
  /* Sin nada cargado en lo que cobra (lo que le llega a quien no es dueño), se dice en vez de mostrar un cero. */
  const sin = loQueLeCorresponde({ ...e, honorarios: [], liquidaciones: [] }, "eq_no_existe", periodo);
  assert.equal(sin.sinArreglo, true);
});
