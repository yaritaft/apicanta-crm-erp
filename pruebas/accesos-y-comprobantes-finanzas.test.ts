import test from "node:test";
import assert from "node:assert/strict";
import { accesosQuitables, avisoDeAccesosQuitados, resumenDeAccesos } from "@/lib/accesos-de-devolucion";
import { nombreDeDescarga } from "@/lib/comprobantes";

/* Reunión del 21/10 (Aldana, Lili, Yari): al cargar o confirmar un reembolso, «¿Le quitamos los accesos?» (no va solo: a veces se reembolsa
   sólo para cambiar el medio de pago); y los comprobantes se bajan desde la app para pasarlos al Excel de dLocal y la Financiera. */

const acc = (plataforma: "wisboo" | "telegram" | "zoom", estado: "pendiente" | "dado" | "entro" | "fallo" | "quitado") => ({ plataforma, estado });

test("a qué tiene acceso hoy el alumno: sólo lo que se puede quitar, en el orden Wisboo, Telegram, Zoom", () => {
  const xs = [acc("zoom", "dado"), acc("wisboo", "dado"), acc("wisboo", "dado"), acc("telegram", "entro"), acc("telegram", "quitado"), acc("wisboo", "fallo"), acc("zoom", "pendiente")];
  assert.equal(resumenDeAccesos(xs), "Wisboo 2 · Telegram 1 · Zoom 1");
  assert.equal(accesosQuitables(xs).length, 4);
  assert.equal(resumenDeAccesos([acc("wisboo", "quitado"), acc("zoom", "fallo")]), "", "nada que quitar: la opción no aparece");
  assert.equal(resumenDeAccesos([]), "");
});

test("lo que se le dice a quien cargó el reembolso: cuántos accesos se quitaron, o qué hacer si alguno falló", () => {
  assert.deepEqual(avisoDeAccesosQuitados({ quitados: 4, fallaron: 0 }), { texto: "Accesos quitados: 4.", error: false });
  assert.deepEqual(avisoDeAccesosQuitados({ quitados: 0, fallaron: 0 }), { texto: "No había accesos para quitar.", error: false });
  const falla = avisoDeAccesosQuitados({ quitados: 3, fallaron: 1 });
  assert.equal(falla.error, true);
  assert.match(falla.texto, /3 quitados y 1 con error\. Mirá cuáles en la ficha → Servicio → Accesos y reintentá\./);
  assert.deepEqual(avisoDeAccesosQuitados({}), { texto: "No había accesos para quitar.", error: false });
});

test("el nombre con el que se baja un comprobante: el original, sin caracteres que un sistema de archivos rechace, con su extensión", () => {
  const c = (nombre: string, tipo = "application/pdf", ruta = "2026/10/abc.pdf") => ({ nombre, tipo, ruta });
  assert.equal(nombreDeDescarga(c("Transferencia dLocal 14-10.pdf")), "Transferencia dLocal 14-10.pdf");
  const raro = nombreDeDescarga(c("../../etc/pasa:swd?.pdf"));
  assert.ok(!/[\\/:*?"<>|]/.test(raro), `sin barras ni dos puntos: ${raro}`);
  assert.equal(raro, "_.._etc_pasa_swd_.pdf");
  assert.equal(nombreDeDescarga(c("captura", "image/png", "2026/10/x.png")), "captura.png", "sin extensión: la del tipo");
  assert.equal(nombreDeDescarga(c("captura", "image/jpeg")), "captura.jpg");
  assert.equal(nombreDeDescarga(c("", "image/webp", "2026/10/x.webp")), "comprobante.webp", "sin nombre");
  assert.equal(nombreDeDescarga(c("recibo", "application/octet-stream", "2026/10/recibo.xlsx")), "recibo.xlsx", "el tipo no dice nada: la de la ruta");
  assert.equal(nombreDeDescarga(c(".oculto.pdf")), "oculto.pdf", "no arranca con punto");
  assert.equal(nombreDeDescarga(c("IMG 2026.10.14")), "IMG 2026.10.14.pdf", "un punto en medio no es extensión");
});
