import test from "node:test";
import assert from "node:assert/strict";
import { claveTelefono, compararTelefonos, digitosWhatsapp, normalizarTelefono, telefonoLegible } from "@/lib/telefonos";

test("el mismo celular argentino escrito de ocho formas da la misma clave", () => {
  const formas = [
    "+54 9 11 5123-4567", "5491151234567", "54 11 5123 4567", "011 15 5123-4567",
    "(011) 15-5123-4567", "11 5123 4567", "1151234567", "0054 9 11 51234567",
  ];
  for (const f of formas) assert.equal(claveTelefono(f, "AR"), "541151234567", f);
});

test("sin país conocido, lo argentino se reconoce igual cuando el número lo dice", () => {
  assert.equal(claveTelefono("+54 9 11 5123-4567"), "541151234567");
  assert.equal(claveTelefono("5491151234567"), "541151234567");
  assert.equal(normalizarTelefono("11 5123 4567").clave, undefined, "10 dígitos sin país ni «+»: no hay clave completa");
  assert.equal(normalizarTelefono("11 5123 4567").nacional, "1151234567");
  assert.equal(normalizarTelefono("011 15 5123 4567").nacional, "1151234567", "con el 0 y el 15 de marcado");
});

test("celulares del interior (área de 3 y 4 dígitos) con el 15", () => {
  assert.equal(claveTelefono("0351 15 612 3456", "AR"), "543516123456");
  assert.equal(claveTelefono("+54 9 351 612 3456"), "543516123456");
  assert.equal(claveTelefono("02966 15 41 2345", "AR"), "542966412345");
});

test("otros países: México con y sin el 1 viejo, Colombia, España, Estados Unidos", () => {
  assert.equal(claveTelefono("+52 1 55 1234 5678"), "525512345678");
  assert.equal(claveTelefono("+52 55 1234 5678"), "525512345678");
  assert.equal(claveTelefono("55 1234 5678", "MX"), "525512345678");
  assert.equal(claveTelefono("+57 300 123 4567"), "573001234567");
  assert.equal(claveTelefono("300 123 4567", "CO"), "573001234567");
  assert.equal(claveTelefono("+34 612 34 56 78"), "34612345678");
  assert.equal(claveTelefono("+1 (305) 555-0123"), "13055550123");
});

test("comparar: igual, parcial (sin código de área) y no", () => {
  assert.equal(compararTelefonos("+54 9 11 5123-4567", "11 5123 4567"), "igual", "con y sin código de país");
  assert.equal(compararTelefonos("+54 9 11 5123-4567", "011 15 5123 4567"), "igual", "con el 15");
  assert.equal(compararTelefonos("+54 9 11 5123-4567", "5123-4567"), "parcial", "sin código de área puede ser de otra zona");
  assert.equal(compararTelefonos("+54 9 11 5123-4567", "+54 9 351 612 3456"), "no");
  assert.equal(compararTelefonos("+54 9 11 5123-4567", "+52 55 1234 5678"), "no");
  assert.equal(compararTelefonos("+54 9 11 5123-4567", ""), "no");
  assert.equal(compararTelefonos("123", "123"), "no", "no es un teléfono");
});

test("el link de WhatsApp: los celulares argentinos llevan el 9", () => {
  assert.equal(digitosWhatsapp("011 15 5123-4567", "AR"), "5491151234567");
  assert.equal(digitosWhatsapp("+52 55 1234 5678"), "525512345678");
  assert.equal(digitosWhatsapp("", "AR"), "");
});

test("legible", () => {
  assert.equal(telefonoLegible("5491151234567"), "+54 9 11 5123 4567");
});
