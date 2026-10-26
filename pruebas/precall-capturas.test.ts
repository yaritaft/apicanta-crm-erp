import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nombreDePegada, nombreSeguro, problemaDeCaptura, rutaDeCaptura, tamanioLegible } from "@/lib/precall";

/* Las capturas de la pre-call de cada llamada (Santi, 26/10): el chat del setter para la comisión y la prueba de
   que el closer escribió cuando la llamada se cancela. */

const archivo = (name: string, type: string, size = 1000) => ({ name, type, size });

test("sólo se suben imágenes, no vacías y de hasta 8 MB (1,5 MB sin nube)", () => {
  assert.equal(problemaDeCaptura(archivo("chat.png", "image/png"), 8 * 1024 * 1024), null);
  assert.equal(problemaDeCaptura(archivo("foto.heic", "", 5000), 8 * 1024 * 1024), null, "un .heic sin tipo se reconoce por la extensión");
  assert.match(problemaDeCaptura(archivo("recibo.pdf", "application/pdf"), 8 * 1024 * 1024) ?? "", /imagen/);
  assert.match(problemaDeCaptura(archivo("vacia.png", "image/png", 0), 8 * 1024 * 1024) ?? "", /vacía/);
  assert.match(problemaDeCaptura(archivo("enorme.png", "image/png", 9 * 1024 * 1024), 8 * 1024 * 1024) ?? "", /máximo es 8,0 MB/);
});

test("la ruta lleva la llamada como carpeta (es la que mira la política de la base) y un nombre sin tildes ni símbolos", () => {
  assert.equal(nombreSeguro("Chat con José Ñandú (1).png"), "Chat-con-Jose-Nandu-1-.png");
  assert.equal(nombreSeguro("???"), "captura");
  assert.equal(rutaDeCaptura("cal_123", "Chat Ana.png", "uuid-1"), "cal_123/uuid-1-Chat-Ana.png");
  assert.equal(rutaDeCaptura("cal_123", "x".repeat(200) + ".png", "u").split("/").length, 2, "una barra en el nombre no cambia de carpeta");
  assert.equal(rutaDeCaptura("cal_123", "../otra/llamada.png", "u").split("/")[0], "cal_123");
});

test("una captura pegada («image.png») recibe un nombre con el momento; una con nombre propio lo conserva", () => {
  const ahora = new Date(2026, 9, 26, 9, 5, 7);
  assert.equal(nombreDePegada({ name: "image.png", type: "image/png" }, ahora), "captura-2026-10-26-090507.png");
  assert.equal(nombreDePegada({ name: "", type: "image/jpeg" }, ahora), "captura-2026-10-26-090507.jpg");
  assert.equal(nombreDePegada({ name: "Captura de pantalla 2026-10-26.png", type: "image/png" }, ahora), "Captura de pantalla 2026-10-26.png");
});

test("el tamaño se lee fácil", () => {
  assert.equal(tamanioLegible(500), "500 B");
  assert.equal(tamanioLegible(2048), "2 KB");
  assert.equal(tamanioLegible(3.5 * 1024 * 1024), "3,5 MB");
});

/* El SQL: el bucket es privado y las tres cosas (la tabla y los archivos) pasan por la misma función de permisos. */
test("supabase/precall-capturas.sql: bucket privado, RLS prendida y los archivos con la misma regla que la tabla", () => {
  const sql = readFileSync("supabase/precall-capturas.sql", "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /values \('precall', 'precall', false,/, "el bucket no es público");
  for (const p of ["precall_ver", "precall_subir", "precall_borrar", "precall_archivos_ver", "precall_archivos_subir", "precall_archivos_borrar"]) {
    assert.match(sql, new RegExp(`create policy ${p} on`), p);
  }
  assert.doesNotMatch(sql, /for update/i, "una captura no se reemplaza");
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\]/, "la carpeta del archivo es la llamada");
});
