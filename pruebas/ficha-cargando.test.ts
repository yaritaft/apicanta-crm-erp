import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* 24/10: el link a una ficha abierto en frío llega antes que los datos de la nube; mientras cargan, la ficha decía «No encontramos
   a esta persona. Puede que la hayan borrado». Ahora espera: sólo dice que no existe cuando la base ya llegó. */
test("la ficha no dice «no encontramos» mientras la nube todavía está cargando", () => {
  const s = readFileSync("src/components/ficha/FichaPersona.tsx", "utf8");
  assert.match(s, /useSync\(\)\.estado === "cargando"/);
  const cargando = s.indexOf("Cargando su ficha");
  const noEsta = s.indexOf("No encontramos a esta persona");
  assert.ok(cargando > 0 && noEsta > cargando, "primero se pregunta si está cargando");
});
