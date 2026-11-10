import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ubicarPopover } from "@/lib/ubicar-popover";

/* Mariano (03/11 y 09/11): en el CRM elegía «Máximo» o un rango y la tabla seguía en el 31/10. El
   popover del selector de fechas vivía adentro de la página y dependía de que ésta se desplazara
   sola: en su ventana quedaba tapando la barra y sin el pie con «Actualizar», y no veía cómo aplicar.
   Ahora el popover es fijo y siempre entra en la ventana: el pie (lo último del popover) tiene que
   quedar a la vista en CUALQUIER ventana y en cualquier lugar donde esté el botón. */

const POP = { ancho: 674, alto: 399 }; // dos calendarios + presets + pie, como se dibuja hoy
const MARGEN = 8;

function caja(botonTop: number, botonLeft: number, ventana: { ancho: number; alto: number }, placement?: "bottom" | "top" | "auto", pop = POP) {
  const boton = { left: botonLeft, right: botonLeft + 190, top: botonTop, bottom: botonTop + 38 };
  const u = ubicarPopover(boton, pop, ventana, placement);
  const alto = Math.min(pop.alto, u.maxHeight);
  const ancho = Math.min(pop.ancho, u.maxWidth);
  const top = u.top ?? ventana.alto - (u.bottom as number) - alto;
  return { u, boton, top, bottom: top + alto, left: u.left, right: u.left + ancho, alto };
}

test("en una ventana normal el popover va abajo del botón, pegado a su borde derecho", () => {
  const c = caja(160, 700, { ancho: 1440, alto: 900 });
  assert.equal(c.top, c.boton.bottom + 6);
  assert.equal(c.right, c.boton.right);
  assert.equal(c.alto, POP.alto);
});

test("si el botón está abajo y no entra, se abre hacia arriba", () => {
  const c = caja(700, 700, { ancho: 1440, alto: 900 });
  assert.ok(c.bottom <= c.boton.top - 6 + 0.001, "queda arriba del botón");
  assert.ok(c.top >= MARGEN, "y no se sale por arriba");
});

test("una ventana más baja que el popover: el popover se achica, no se sale (el pie queda a la vista)", () => {
  const ventana = { ancho: 1100, alto: 360 };
  const c = caja(150, 600, ventana);
  assert.ok(c.alto < POP.alto, "se achicó");
  assert.ok(c.top >= MARGEN && c.bottom <= ventana.alto - MARGEN + 0.001, `entra en ${ventana.alto}px: ${c.top}–${c.bottom}`);
});

test("el borde izquierdo y derecho tampoco se salen (ventana angosta, botón a la izquierda o a la derecha)", () => {
  for (const [ancho, left] of [[420, 10], [420, 300], [800, 20], [1440, 1300]] as const) {
    const c = caja(120, left, { ancho, alto: 900 });
    assert.ok(c.left >= MARGEN, `ancho ${ancho}, botón en ${left}: left ${c.left}`);
    assert.ok(c.right <= ancho - MARGEN + 0.001, `ancho ${ancho}, botón en ${left}: right ${c.right}`);
  }
});

test("barrido: en ninguna ventana ni posición del botón el popover (y su pie) queda fuera de la pantalla", () => {
  let casos = 0;
  for (const alto of [240, 300, 360, 420, 480, 560, 640, 720, 800, 900, 1080, 1400]) {
    for (const ancho of [320, 390, 600, 768, 960, 1100, 1440, 1920]) {
      for (const placement of ["auto", "bottom", "top"] as const) {
        for (let top = 0; top <= alto - 38; top += Math.max(10, Math.floor(alto / 14))) {
          for (const left of [0, Math.floor(ancho / 3), Math.max(0, ancho - 190)]) {
            const c = caja(top, left, { ancho, alto }, placement);
            const donde = `ventana ${ancho}x${alto}, botón en (${left},${top}), ${placement}`;
            casos++;
            assert.ok(c.top >= MARGEN - 0.001, `${donde}: sale por arriba (${c.top})`);
            assert.ok(c.bottom <= alto - MARGEN + 0.001, `${donde}: sale por abajo (${c.bottom})`);
            assert.ok(c.left >= MARGEN - 0.001, `${donde}: sale por la izquierda (${c.left})`);
            assert.ok(c.right <= ancho - MARGEN + 0.001, `${donde}: sale por la derecha (${c.right})`);
            assert.ok(c.u.maxHeight > 0, `${donde}: sin alto`);
          }
        }
      }
    }
  }
  assert.ok(casos > 3000, `se probaron ${casos} casos`);
});

test("el selector sigue fijo y colgado de <body>: ningún contenedor lo recorta ni lo corre", () => {
  const tsx = readFileSync(new URL("../src/components/ui/DateRangePicker.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(tsx, /createPortal\(/, "el popover va por un portal");
  assert.doesNotMatch(tsx.replace(/\/\*[\s\S]*?\*\//g, ""), /scrollIntoView/, "scrollIntoView desplazaba la página entera");
  const pop = css.match(/\.dp-pop \{[^}]*\}/)?.[0] ?? "";
  assert.match(pop, /position: fixed/, ".dp-pop es fijo");
  assert.match(css.match(/\.dp-foot \{[^}]*\}/)?.[0] ?? "", /flex: none/, "el pie no se achica: lo que scrollea es el cuerpo");
});
