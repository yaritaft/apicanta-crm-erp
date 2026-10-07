import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASILLEROS, COLUMNAS_DE_CONTROL, COLUMNAS_QUE_PONE_LA_BASE, cambiosDeChequeo, casilleroDe, chequeoDe, conChequeo,
  conComprobanteNuevo, conciliacionDe, controlDeCobro, controlPorVenta, etiquetaDeControl, pasaControl, primerNombre,
  puedeCambiarComprobante, puedeUsarCasillero, quienEs, resumenDeControl, FILTROS_CONTROL,
} from "@/lib/control-cobros";
import { TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import { cashCollected } from "@/lib/finanzas";
import { rangoDeFechas } from "@/lib/metricas";
import { construirSemilla } from "@/lib/seed";
import type { Comprobante, EstadoApp, Pago } from "@/lib/types";

const pago = (extra: Partial<Pago> = {}): Pago => ({
  id: "p1", cuotaId: "c1", procesadorId: "proc_x", monto: 500, moneda: "USD", feeRate: 0, feeMonto: 0,
  fecha: "2026-10-05T15:00:00.000Z", creadoEn: "2026-10-05T15:00:00.000Z", ...extra,
});

const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("un cobro sin ninguna marca está pendiente: el cobro que ya existía no se da por chequeado", () => {
  const c = controlDeCobro(pago());
  assert.equal(c.estado, "pendiente");
  assert.deepEqual(c.chequeos, []);
  assert.equal(c.deAntes, false);
});

test("con uno de los dos casilleros alcanza para que no quede pendiente", () => {
  const conDirector = controlDeCobro(pago({ chequeoDirector: "chequeado", chequeoDirectorPor: "santi@x.com", chequeoDirectorEn: "2026-10-06T12:00:00.000Z" }));
  assert.equal(conDirector.estado, "chequeado");
  assert.equal(conDirector.chequeos.length, 1);
  const conFinanzas = controlDeCobro(pago({ chequeoFinanzas: "chequeado" }));
  assert.equal(conFinanzas.estado, "chequeado");
  const los2 = controlDeCobro(pago({
    chequeoDirector: "chequeado", chequeoDirectorEn: "2026-10-06T12:00:00.000Z",
    chequeoFinanzas: "chequeado", chequeoFinanzasEn: "2026-10-06T10:00:00.000Z",
  }));
  assert.equal(los2.estado, "chequeado");
  assert.deepEqual(los2.chequeos.map((x) => x.casillero), ["finanzas", "director"], "del primero al último");
});

test("lo que ya estaba marcado no se pierde: el sí/no de antes sigue contando como chequeado, sin quién ni cuándo", () => {
  const viejo = controlDeCobro(pago({ chequeado: true }));
  assert.equal(viejo.estado, "chequeado");
  assert.equal(viejo.deAntes, true);
  assert.deepEqual(viejo.chequeos, []);
  /* Si además lo chequeó alguien, ya no es «de antes»: tiene dueño. */
  const nuevo = controlDeCobro(pago({ chequeado: true, chequeoFinanzas: "chequeado" }));
  assert.equal(nuevo.deAntes, false);
});

test("un rechazo manda sobre los chequeos y sobre el sí/no de antes, hasta que se arregle", () => {
  const c = controlDeCobro(pago({ chequeado: true, chequeoDirector: "chequeado", chequeoFinanzas: "rechazado", chequeoFinanzasNota: "es de otro cliente" }));
  assert.equal(c.estado, "rechazado");
  assert.equal(c.rechazos[0].casillero, "finanzas");
  assert.equal(c.rechazos[0].nota, "es de otro cliente");
});

test("un valor raro en la base no cuenta como casillero lleno", () => {
  assert.equal(controlDeCobro(pago({ chequeoDirector: "ok" as never })).estado, "pendiente");
  assert.equal(chequeoDe(pago({ chequeoDirector: "ok" as never }), "director"), undefined);
});

test("la pastilla lleva el dato adentro", () => {
  const nombre = (por?: string) => (por === "santi@x.com" ? "Santiago Burghiani" : por === "aldana@x.com" ? "Aldana Ruiz" : por ?? "");
  assert.deepEqual(
    (({ texto, tono }) => ({ texto, tono }))(etiquetaDeControl(controlDeCobro(pago()), nombre)),
    { texto: "Sin chequear", tono: "warning" });
  assert.equal(etiquetaDeControl(controlDeCobro(pago({ chequeoDirector: "chequeado", chequeoDirectorPor: "santi@x.com" })), nombre).texto, "Chequeado · Santiago");
  const rechazado = etiquetaDeControl(controlDeCobro(pago({
    chequeoFinanzas: "rechazado", chequeoFinanzasPor: "aldana@x.com", chequeoFinanzasEn: "2026-10-06T12:00:00.000Z", chequeoFinanzasNota: "no se lee",
  })), nombre);
  assert.equal(rechazado.texto, "Rechazado · Aldana");
  assert.equal(rechazado.tono, "danger");
  assert.match(rechazado.detalle, /Rechazado por finanzas \(Aldana Ruiz\)/);
  assert.match(rechazado.detalle, /no se lee/);
  assert.equal(etiquetaDeControl(controlDeCobro(pago({ chequeado: true })), nombre).texto, "Chequeado · de antes");
  assert.equal(etiquetaDeControl(controlDeCobro(pago({ chequeado: true, movimientoId: "m1" })), nombre).texto, "Chequeado · pasarela");
});

test("quién puede chequear: el director por su casillero, finanzas por el suyo, el closer ninguno", () => {
  assert.equal(casilleroDe(acceso("dueno")), "finanzas");
  assert.equal(casilleroDe(acceso("equipo")), "finanzas");
  assert.equal(casilleroDe(acceso("admin")), "finanzas");
  assert.equal(casilleroDe(acceso("director")), "director");
  for (const t of ["closer", "setter", "marketing"]) assert.equal(casilleroDe(acceso(t)), null, t);
  assert.equal(casilleroDe(null), null);

  assert.equal(puedeUsarCasillero(acceso("director"), "director"), true);
  assert.equal(puedeUsarCasillero(acceso("director"), "finanzas"), false, "el director no ve Finanzas");
  assert.equal(puedeUsarCasillero(acceso("admin"), "finanzas"), true);
  assert.equal(puedeUsarCasillero(acceso("closer"), "director"), false, "el closer edita Ventas pero sólo las suyas");
  assert.equal(puedeUsarCasillero(acceso("closer"), "finanzas"), false);
  /* Subir otro comprobante sí lo puede quien edita los cobros: el closer, para arreglar uno rechazado. */
  assert.equal(puedeCambiarComprobante(acceso("closer")), true);
  assert.equal(puedeCambiarComprobante(acceso("setter")), false);
});

test("chequear, rechazar y quitar: lo que se ve acá es lo que se manda a la base", () => {
  const en = "2026-10-06T14:00:00.000Z";
  const base = pago();

  const chequeado = conChequeo(base, "director", "chequeado", { por: "santi@x.com", en, nota: "  ok  " });
  assert.equal(chequeado.chequeoDirector, "chequeado");
  assert.equal(chequeado.chequeoDirectorPor, "santi@x.com");
  assert.equal(chequeado.chequeoDirectorEn, en);
  assert.equal(chequeado.chequeoDirectorNota, "ok");
  assert.equal(chequeado.chequeoFinanzas, undefined, "el otro casillero no se toca");
  assert.deepEqual(cambiosDeChequeo("director", "chequeado", { por: "santi@x.com", en, nota: "ok" }), {
    chequeoDirector: "chequeado", chequeoDirectorPor: "santi@x.com", chequeoDirectorEn: en, chequeoDirectorNota: "ok",
  });

  const rechazado = conChequeo(chequeado, "finanzas", "rechazado", { por: "aldana@x.com", en, nota: "no coincide el monto" });
  assert.equal(controlDeCobro(rechazado).estado, "rechazado");
  assert.equal(rechazado.chequeoDirector, "chequeado", "el rechazo de uno no borra el chequeo del otro");

  const sinElDelDirector = conChequeo(rechazado, "director", null, { en });
  assert.equal(sinElDelDirector.chequeoDirector, undefined);
  assert.equal(sinElDelDirector.chequeoDirectorPor, undefined);
  assert.equal(sinElDelDirector.chequeoDirectorEn, undefined);
  assert.deepEqual(cambiosDeChequeo("director", null, { en }), {
    chequeoDirector: null, chequeoDirectorPor: null, chequeoDirectorEn: null, chequeoDirectorNota: null,
  }, "null borra la columna");
});

test("chequear o rechazar no toca ningún número: el cash collected, las comisiones y el profit salen igual", () => {
  const e = construirSemilla() as EstadoApp;
  const m = rangoDeFechas("2020-01-01", "2030-12-31", "todo");
  const antes = cashCollected(e, m);
  const en = "2026-10-06T14:00:00.000Z";
  const pagos = e.pagos.map((p, i) => {
    const c = CASILLEROS[i % 2];
    return conChequeo(p, c, i % 3 === 0 ? "rechazado" : "chequeado", { por: "x@x.com", en, nota: "n" });
  });
  assert.equal(cashCollected({ ...e, pagos }, m), antes);
  assert.deepEqual(pagos.map((p) => [p.monto, p.feeMonto, p.fecha, p.cuotaId]), e.pagos.map((p) => [p.monto, p.feeMonto, p.fecha, p.cuotaId]));
});

test("los cobros que ya existen quedan pendientes y los números de control cierran: cada cobro está en un solo estado", () => {
  const e = construirSemilla() as EstadoApp;
  const marcados = e.pagos.map((p, i) => (i % 4 === 0 ? { ...p, chequeado: true } : i % 4 === 1 ? { ...p, chequeoDirector: "chequeado" as const } : i % 4 === 2 ? { ...p, chequeoFinanzas: "rechazado" as const } : p));
  const r = resumenDeControl(e.procesadores, marcados);
  assert.equal(r.total, marcados.length);
  assert.equal(r.pendientes + r.chequeados + r.rechazados, r.total);
  assert.equal(r.chequeados, marcados.filter((_, i) => i % 4 === 0 || i % 4 === 1).length, "lo que estaba marcado sigue marcado");
  assert.equal(r.rechazados, marcados.filter((_, i) => i % 4 === 2).length);
  assert.equal(r.pendientes, marcados.filter((_, i) => i % 4 === 3).length);
  /* Sin marcas, todos pendientes. */
  assert.equal(resumenDeControl(e.procesadores, e.pagos).pendientes, e.pagos.length);
  /* Los filtros de la lista cuentan lo mismo que el resumen. */
  assert.equal(marcados.filter((p) => pasaControl(p, e.procesadores, "sin-chequear")).length, r.pendientes);
  assert.equal(marcados.filter((p) => pasaControl(p, e.procesadores, "chequeados")).length, r.chequeados);
  assert.equal(marcados.filter((p) => pasaControl(p, e.procesadores, "rechazados")).length, r.rechazados);
  assert.equal(marcados.filter((p) => pasaControl(p, e.procesadores, "todos")).length, r.total);
  assert.deepEqual(FILTROS_CONTROL.includes("todos") && FILTROS_CONTROL.includes("sin-chequear"), true);
});

test("el control de cada venta suma lo de sus cobros", () => {
  const e = construirSemilla() as EstadoApp;
  const marcados = e.pagos.map((p, i) => (i % 3 === 0 ? { ...p, chequeoFinanzas: "chequeado" as const } : i % 3 === 1 ? { ...p, chequeoDirector: "rechazado" as const } : p));
  const por = controlPorVenta({ pagos: marcados, cuotas: e.cuotas });
  let total = 0, pendientes = 0, rechazados = 0;
  for (const x of por.values()) { total += x.total; pendientes += x.pendientes; rechazados += x.rechazados; }
  const r = resumenDeControl(e.procesadores, marcados);
  assert.equal(total, r.total);
  assert.equal(pendientes, r.pendientes);
  assert.equal(rechazados, r.rechazados);
});

test("conciliado, sin conciliar o a mano", () => {
  const procs = [{ id: "stripe", proveedor: "stripe" as const }, { id: "financiera" }];
  assert.equal(conciliacionDe(procs, pago({ procesadorId: "stripe", movimientoId: "m1" })), "conciliado");
  assert.equal(conciliacionDe(procs, pago({ procesadorId: "stripe" })), "sin-conciliar");
  assert.equal(conciliacionDe(procs, pago({ procesadorId: "financiera" })), "a-mano", "la Financiera no tiene pasarela: se prueba con el comprobante");
  assert.equal(conciliacionDe(procs, pago({ procesadorId: "borrada" })), "a-mano");
  /* Un cobro atado a la pasarela no le falta comprobante: la prueba es la pasarela. */
  assert.equal(pasaControl(pago({ movimientoId: "m1" }), procs, "sin-comprobante"), false);
  assert.equal(pasaControl(pago(), procs, "sin-comprobante"), true);
  assert.equal(pasaControl(pago({ comprobanteLink: "https://drive.example.com/x" }), procs, "sin-comprobante"), false);
});

const archivo = (ruta: string): Comprobante => ({ ruta, nombre: `${ruta}.pdf`, tipo: "application/pdf", tamanio: 1000, subidoEn: "2026-10-06T10:00:00.000Z" });

test("otro comprobante vuelve el cobro a pendiente; el primero no reinicia nada", () => {
  const chequeado = pago({ comprobante: archivo("a"), chequeoDirector: "chequeado", chequeoDirectorPor: "santi@x.com", chequeoFinanzas: "rechazado", chequeado: true });
  const otro = conComprobanteNuevo(chequeado, archivo("b"));
  assert.equal(otro.reinicia, true);
  assert.equal(controlDeCobro(otro.pago).estado, "pendiente", "ni los casilleros ni el sí/no de antes valen contra otro comprobante");
  assert.equal(otro.pago.comprobante?.ruta, "b");
  assert.equal(otro.cambios.chequeoDirector, null);
  assert.equal(otro.cambios.chequeoFinanzas, null);
  assert.equal(otro.cambios.chequeado, null);
  for (const k of COLUMNAS_DE_CONTROL) assert.ok(k in otro.cambios, `${k} va en blanco a la base`);

  /* El mismo archivo otra vez: nada cambia. */
  const igual = conComprobanteNuevo(chequeado, archivo("a"));
  assert.equal(igual.reinicia, false);
  assert.equal(controlDeCobro(igual.pago).estado, "rechazado");

  /* Agregar el primero, o un archivo a un cobro que sólo traía el link de la planilla, no reinicia. */
  const sin = conComprobanteNuevo(pago({ chequeado: true }), archivo("a"));
  assert.equal(sin.reinicia, false);
  assert.equal(controlDeCobro(sin.pago).estado, "chequeado");
  const conLink = conComprobanteNuevo(pago({ comprobanteLink: "https://x.example.com", chequeado: true }), archivo("a"));
  assert.equal(conLink.reinicia, false);

  /* Un cobro atado a la pasarela conserva su marca: se prueba con ella. */
  const conciliado = conComprobanteNuevo(pago({ comprobante: archivo("a"), movimientoId: "m1", chequeado: true }), archivo("b"));
  assert.equal(conciliado.pago.chequeado, true);
  assert.ok(!("chequeado" in conciliado.cambios));
});

test("quién es quién: el correo de la base se lee como el nombre del equipo", () => {
  const equipo = [{ nombre: "Santiago Burghiani", email: "Santi@Apicanta.com" }, { nombre: "Aldana Ruiz" }];
  assert.equal(quienEs(equipo, "santi@apicanta.com"), "Santiago Burghiani");
  assert.equal(quienEs(equipo, "otro@x.com"), "otro@x.com", "sin nadie en Equipo con ese correo, el correo");
  assert.equal(quienEs(equipo, "Yari Taft"), "Yari Taft", "sin nube va el responsable de Ajustes, tal cual");
  assert.equal(quienEs(equipo, ""), "");
  assert.equal(quienEs(equipo, undefined), "");
  assert.equal(primerNombre("Santiago Burghiani"), "Santiago");
  assert.equal(primerNombre("aldana@x.com"), "aldana");
});

test("el SQL del control cruzado tiene todas las columnas que la app guarda", () => {
  const sql = readFileSync(new URL("../supabase/control-cruzado.sql", import.meta.url), "utf8");
  for (const k of COLUMNAS_QUE_PONE_LA_BASE) assert.ok(sql.includes(`"${k}"`), `falta ${k} en supabase/control-cruzado.sql`);
  /* Lo que el trigger protege de un closer. */
  assert.match(sql, /create trigger\s+control_cruzado_pagos/i);
  assert.match(sql, /solo_lo_suyo/);
});
