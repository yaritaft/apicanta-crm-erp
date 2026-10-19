import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { enlaceWhatsapp, numeroParaCopiar } from "@/lib/contacto-telefono";
import { COLUMNAS_SUMADAS, COLUMNA, VISIBLES_POR_DEFECTO } from "@/lib/crm-tabla";

/* Dante y Mariano (closers, 19/10): el teléfono y el mail de cada lead tienen que estar a mano en el
   cierre del día y en la tabla de llamadas, y tocar el número lo copia. Antes cada pantalla armaba el
   enlace de WhatsApp a su manera (o no mostraba el dato): ahora todo pasa por un solo lugar. */

test("el chat de WhatsApp sale del número con su código de país", () => {
  assert.equal(enlaceWhatsapp("+54 9 11 5750-5283"), "https://wa.me/5491157505283");
  assert.equal(enlaceWhatsapp("+54 11 5750-5283"), "https://wa.me/5491157505283", "el 9 de los celulares argentinos se agrega");
  assert.equal(enlaceWhatsapp("+52 55 1234 5678"), "https://wa.me/525512345678");
});

test("sin código de país, el de la persona completa el número; sin país no se inventa", () => {
  assert.equal(enlaceWhatsapp("11 5750-5283", "Argentina"), "https://wa.me/5491157505283");
  assert.equal(enlaceWhatsapp("11 5750-5283"), "https://wa.me/1157505283");
});

test("vacío o demasiado corto no arma un enlace", () => {
  assert.equal(enlaceWhatsapp(""), null);
  assert.equal(enlaceWhatsapp(null), null);
  assert.equal(enlaceWhatsapp("   "), null);
  assert.equal(enlaceWhatsapp("123"), null);
});

test("dos números en el mismo campo: el chat es del primero", () => {
  assert.equal(enlaceWhatsapp("+54 9 11 5750-5283 / +54 9 11 4526-0101"), "https://wa.me/5491157505283");
});

test("lo que se copia se pega directo en WhatsApp: con el + y el código de país si se sabe", () => {
  assert.equal(numeroParaCopiar("+54 9 11 5750-5283"), "+5491157505283");
  assert.equal(numeroParaCopiar("11 5750-5283", "Argentina"), "+5491157505283");
  assert.equal(numeroParaCopiar("11 5750-5283"), "11 5750-5283", "sin país se copia tal cual está cargado");
  assert.equal(numeroParaCopiar(""), "");
  assert.equal(numeroParaCopiar("+54 9 11 1111-1111 / +54 9 11 2222-2222"), "+54 9 11 1111-1111 / +54 9 11 2222-2222");
});

test("el teléfono y el mail se ven de entrada en la tabla, y quien ya tenía sus columnas los recibe una vez", () => {
  const i = VISIBLES_POR_DEFECTO.indexOf("nombre");
  assert.deepEqual(VISIBLES_POR_DEFECTO.slice(i + 1, i + 3), ["telefono", "email"], "justo después de la persona");
  const x = COLUMNAS_SUMADAS.find((s) => s.id === "contacto-1910");
  assert.ok(x, "la suma para quien ya guardó su lista");
  assert.deepEqual(x.claves, ["telefono", "email"]);
  for (const k of x.claves) assert.ok(COLUMNA[k], k);
  assert.equal(new Set(COLUMNAS_SUMADAS.map((s) => s.id)).size, COLUMNAS_SUMADAS.length, "ids repetidos");
});

/* La raíz: nadie vuelve a armar un wa.me a mano con los dígitos tal cual. */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test("ninguna pantalla arma el enlace a WhatsApp por su cuenta", () => {
  const sueltos = archivos("src")
    .filter((p) => !p.endsWith("lib/contacto-telefono.ts"))
    .filter((p) => /https:\/\/wa\.me\//.test(readFileSync(p, "utf8")));
  assert.deepEqual(sueltos, [], "usar enlaceWhatsapp() de lib/contacto-telefono.ts");
});

test("el cierre del día muestra el teléfono y el mail de cada persona", () => {
  const eod = readFileSync("src/components/crm-tabla/Eod.tsx", "utf8");
  assert.match(eod, /<Telefono valor=\{f\?\.telefono\}/);
  assert.match(eod, /<Correo valor=\{f\?\.email\}/);
});

test("la tabla de llamadas, la grilla y la ficha usan el mismo teléfono", () => {
  assert.match(readFileSync("src/components/crm-tabla/CrmTabla.tsx", "utf8"), /<Telefono valor=\{f\.telefono\}/);
  assert.match(readFileSync("src/components/crm/Grilla.tsx", "utf8"), /<Telefono valor=/);
  assert.match(readFileSync("src/components/ficha/FichaPersona.tsx", "utf8"), /enlaceWhatsapp\(/);
});
