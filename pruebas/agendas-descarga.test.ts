import test from "node:test";
import assert from "node:assert/strict";
import { clasesDe, crmDeDescarga, csvDeDescarga, tablaDeDescarga, type FilaDescarga } from "@/lib/agendas-descarga";
import { construirSemilla } from "@/lib/seed";
import { COLUMNAS, filasTabla } from "@/lib/crm-tabla";
import { NO_SE_PRESENTO, REPROGRAMO } from "@/lib/estados";
import type { EstadoApp, Sesion } from "@/lib/types";

/* Bajar las agendas de un webinar para un broadcast (Santi, 23/10): los que no vinieron, los que pidieron otra
   fecha y los que cancelaron, una vez por persona y con el teléfono listo para pegar en WhatsApp. */

const sesion = (p: Partial<Sesion> & { id: string }): Sesion => ({
  titulo: "Llamada", invitado: "Ana Pérez", inicia: "2026-10-22T15:00:00.000Z", duracionMin: 30, estado: "agendada", tipo: "Llamada",
  origen: "calendly", creadoEn: "2026-10-21T12:00:00.000Z", extra: {}, ...p,
});

test("no vino: por el estado de la agenda o por el Estado de Llamada; una cancelada no", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estado: "no-show" })), ["no-vino"]);
  assert.deepEqual(clasesDe(sesion({ id: "b" }), NO_SE_PRESENTO), ["no-vino"]);
  assert.deepEqual(clasesDe(sesion({ id: "c", estado: "cancelada" }), NO_SE_PRESENTO), ["cancelo"]);
});

test("reagendó: pidió otra fecha (Pre-Call), tiene la agenda de después o la cancelaron por reprogramar", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estadoPreCall: "Reagendar" })), ["reagendo"]);
  assert.deepEqual(clasesDe(sesion({ id: "b" }), REPROGRAMO), ["reagendo"]);
  assert.deepEqual(clasesDe(sesion({ id: "c", reprogramadaDe: "x" })), ["reagendo"]);
  /* La vieja, cancelada «Reprogramada», es una reagenda y no una cancelación. */
  assert.deepEqual(clasesDe(sesion({ id: "d", estado: "cancelada", motivoCancelacion: "Reprogramada" })), ["reagendo"]);
});

test("pidió reagendar y no vino: entra en las dos listas", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estado: "no-show", estadoPreCall: "Reagendar" })), ["no-vino", "reagendo"]);
});

test("una agenda normal no es de ninguna lista", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estadoPreCall: "Confirmado" })), []);
});

test("la descarga trae una fila por persona (la agenda más nueva), con el teléfono con «+» y la hora argentina", () => {
  const ana = { nombre: "Ana Pérez", email: "ana@mail.com", telefono: "54 9 11 3438-0201", pais: "Argentina" };
  const filas: FilaDescarga[] = [
    { s: sesion({ id: "vieja", contactoId: "c1", estado: "cancelada", motivoCancelacion: "Reprogramada", creadoEn: "2026-10-20T10:00:00.000Z" }), estado: "Cancelada", clases: ["reagendo"], persona: ana },
    { s: sesion({ id: "nueva", contactoId: "c1", reprogramadaDe: "vieja", anfitrion: "Dante", inicia: "2026-10-23T22:00:00.000Z" }), estado: "Por venir", clases: ["reagendo"], persona: ana, extra: ["Después"] },
    { s: sesion({ id: "otra", contactoId: "c2", invitado: "Beto", email: "beto@mail.com", estado: "no-show" }), estado: "Inasistió", clases: ["no-vino"], extra: ["En el vivo"] },
  ];
  const { tabla, personas } = tablaDeDescarga(filas, ["Momento"]);
  assert.equal(personas, 2);
  assert.deepEqual(tabla[0], ["Nombre", "Teléfono", "Email", "País", "Estado de llamada", "Qué pasó", "Closer", "Agendó el", "Llamada el", "Momento"]);
  /* La más próxima primero; Ana quedó con su agenda nueva, no con la cancelada. */
  assert.equal(tabla[1][0], "Ana Pérez");
  assert.equal(tabla[1][1], "+5491134380201");
  assert.equal(tabla[1][2], "ana@mail.com");
  assert.equal(tabla[1][4], "Por venir");
  assert.equal(tabla[1][5], "Reagendaron");
  assert.equal(tabla[1][6], "Dante");
  assert.equal(tabla[1][9], "Después");
  assert.equal(tabla[1][8], "2026-10-23 19:00");
  assert.equal(tabla[2][0], "Beto");
  assert.equal(tabla[2][1], "");
  assert.equal(tabla[2][5], "No vinieron");
});

test("sin persona ni mail, cada agenda es una fila (no se juntan a ciegas)", () => {
  const f = (id: string): FilaDescarga => ({ s: sesion({ id, invitado: id, email: undefined }), estado: "", clases: [] });
  assert.equal(tablaDeDescarga([f("a"), f("b")]).personas, 2);
});

test("el CSV lleva la marca de Excel y comillas donde hacen falta", () => {
  const csv = csvDeDescarga([["Nombre", "Nota"], ["Pérez, Ana", 'dijo "hola"']]);
  assert.ok(csv.startsWith("﻿Nombre,Nota"));
  assert.ok(csv.includes('"Pérez, Ana","dijo ""hola"""'));
});

/* La raíz del pedido de Santi: las agendas de un webinar existían pero no se encontraban. Estas guardas atan los tres caminos
   para que nadie los saque sin darse cuenta. */
import { readFileSync } from "node:fs";
const fuente = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("la lista de Webinars lleva a las agendas del webinar (ancla #agendas que existe en la ficha)", () => {
  assert.match(fuente("src/app/(app)/webinars/page.tsx"), /\/webinars\/\$\{encodeURIComponent\(filtrados\[0\]\.id\)\}#agendas/);
  assert.match(fuente("src/components/webinars/AgendasWebinar.tsx"), /id="agendas"/);
});

test("la tarjeta de agendas del webinar filtra y baja el CSV; la Agenda filtra por webinar y baja el CSV", () => {
  const tarjeta = fuente("src/components/webinars/AgendasWebinar.tsx");
  assert.match(tarjeta, /tablaDeDescarga/);
  for (const c of ["no-vino", "reagendo", "cancelo"]) assert.ok(tarjeta.includes(`"${c}"`) || tarjeta.includes(c), c);
  const agenda = fuente("src/app/(app)/agenda/page.tsx");
  assert.match(agenda, /const FACETAS: Faceta\[\] = \[[^\]]*"webinar"/);
  assert.match(agenda, /tablaDeDescarga/);
  /* Las dos bajan también lo del CRM (la venta, lo cobrado), según lo que ve quien descarga (Santi, 24/10). */
  for (const pantalla of [tarjeta, agenda]) {
    assert.match(pantalla, /tablaDeDescarga\([^)]*crmDeDescarga\(/);
    assert.match(pantalla, /puedeLeer\(acceso, "pagos"\)/);
  }
});

/* ---------- Santi (24/10): «¿hay manera que en el csv me descargue datos como cash collected, producto y todo eso?» ----------
   La descarga suma todas las columnas del CRM, con lo que dice cada celda, más el valor de la venta y lo que falta. */


test("con la venta: producto, lo cobrado (número), el valor y lo que falta, y las columnas del CRM sin repetir", () => {
  const base = construirSemilla() as EstadoApp;
  const ahora = Date.parse("2026-10-24T18:00:00.000Z");
  /* Una agenda con su venta de 3.000 y un cobro de 1.000 (como la seña y la primera cuota). */
  /* Una llamada que el CRM muestra, sin venta todavía. */
  const libre = filasTabla(base, ahora).find((f) => f.ventaIds.length === 0 && f.sesion.estado !== "cancelada")!.sesion;
  const s0 = { ...libre, contactoId: libre.contactoId ?? libre.leadId ?? "lea_csv" };
  const producto = base.productos[0];
  const procesador = base.procesadores[0];
  const e = {
    ...base,
    sesiones: base.sesiones.map((s) => (s.id === s0.id ? s0 : s)),
    ventas: [{ ...base.ventas[0], id: "v_csv", contactoId: s0.contactoId, contactoNombre: s0.invitado, sesionId: s0.id, productoId: producto.id, precioAcordado: 3000, moneda: "USD", estado: "activa", fecha: s0.inicia }, ...base.ventas],
    cuotas: [{ id: "c_csv", ventaId: "v_csv", numero: 1, monto: 3000, vence: s0.inicia, estado: "pendiente", esReserva: false }, ...base.cuotas],
    pagos: [{ id: "p_csv", cuotaId: "c_csv", procesadorId: procesador.id, monto: 1000, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: s0.inicia, creadoEn: s0.inicia }, ...base.pagos],
  } as EstadoApp;
  const conVenta = filasTabla(e, ahora).find((f) => f.sesion.id === s0.id && f.ventaIds.includes("v_csv"));
  assert.ok(conVenta && (conVenta.cobrado ?? 0) > 0, "la agenda tiene su venta cobrada");
  const crm = crmDeDescarga(e, { ventas: true, cobros: true }, ahora);
  const { tabla } = tablaDeDescarga([{ s: conVenta.sesion, estado: "Compra Full", clases: [], extra: ["Después", "Replay"] }], ["Momento", "Vía"], crm);
  const [cab, fila] = tabla;
  const de = (t: string) => fila[cab.indexOf(t)];
  for (const t of ["Producto", "Cobrado (CC)", "Valor de la venta", "Falta cobrar", "Venta", "Conciliado", "Ad", "Campaña", "Gana por mes", "Notas"]) {
    assert.ok(cab.includes(t), `falta la columna ${t}`);
  }
  assert.equal(de("Producto"), conVenta.productos.join(", "));
  assert.equal(Number(de("Cobrado (CC)")), conVenta.cobrado, "lo cobrado sale como número, para sumarlo");
  const valor = conVenta.ventaIds.reduce((a, id) => a + (e.ventas.find((v) => v.id === id)?.precioAcordado ?? 0), 0);
  assert.equal(Number(de("Valor de la venta")), valor);
  assert.equal(Number(de("Falta cobrar")), Math.max(0, Math.round((valor - (conVenta.cobrado ?? 0)) * 100) / 100));
  assert.equal(cab.indexOf("Valor de la venta"), cab.indexOf("Cobrado (CC)") + 1, "el valor va al lado de lo cobrado");
  assert.equal(new Set(cab).size, cab.length, "ninguna columna se repite (la «Vía» del webinar, el mail, el teléfono)");
  /* Una agenda que el CRM no muestra (un evento que no es de sus tablas) trae lo de su persona: la llamada con venta,
     aunque después haya tenido otra sin venta. */
  const otra = { ...s0, id: "ses_fuera_del_crm", titulo: "Evento que no es del CRM", tipo: "otro" } as typeof s0;
  const { tabla: [, filaOtra] } = tablaDeDescarga([{ s: otra, estado: "", clases: [] }], ["Momento", "Vía"], crm);
  assert.equal(filaOtra[cab.indexOf("Producto")], conVenta.productos.join(", "), "la de su persona");
  /* Una columna nueva del CRM sale sola: todas las del catálogo están, salvo las que ya iban. */
  const yaIban = ["Llamada", "Persona", "Closer", "Estado de Llamada", "Email", "Teléfono", "País", "Agendó el", "Vía"];
  for (const c of COLUMNAS) if (!yaIban.includes(c.titulo)) assert.ok(cab.includes(c.titulo), `la columna del CRM «${c.titulo}» no salió`);
});

test("quien no ve ventas ni cobros (un setter) baja lo del CRM sin la plata", () => {
  const e = construirSemilla() as EstadoApp;
  const s = e.sesiones[0];
  const { tabla } = tablaDeDescarga([{ s, estado: "", clases: [] }], [], crmDeDescarga(e, { ventas: false, cobros: false }));
  for (const t of ["Producto", "Venta", "Cobrado (CC)", "Valor de la venta", "Falta cobrar", "Conciliado", "Chequeo"]) {
    assert.ok(!tabla[0].includes(t), `un setter no tendría que ver «${t}»`);
  }
  assert.ok(tabla[0].includes("Ad") && tabla[0].includes("Gana por mes"), "lo del origen y el perfil sí");
});

test("una agenda sin venta: lo de la venta dice «Sin venta» y los números quedan vacíos", () => {
  const e = construirSemilla() as EstadoApp;
  const sin = filasTabla(e).find((f) => f.ventaIds.length === 0)!;
  const { tabla: [cab, fila] } = tablaDeDescarga([{ s: sin.sesion, estado: "", clases: [] }], [], crmDeDescarga(e, { ventas: true, cobros: true }));
  assert.equal(fila[cab.indexOf("Producto")], "Sin venta");
  assert.equal(fila[cab.indexOf("Cobrado (CC)")], "");
  assert.equal(fila[cab.indexOf("Valor de la venta")], "");
  assert.equal(fila[cab.indexOf("Falta cobrar")], "");
});
