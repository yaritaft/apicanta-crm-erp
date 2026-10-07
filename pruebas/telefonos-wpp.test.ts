import test from "node:test";
import assert from "node:assert/strict";
import { claveInternacional, clavesDeTelefono, digitosDe, numeroParaWhatsapp, traePais } from "@/lib/telefonos-wpp";

/* Un mismo celular, escrito como lo escribe la gente, tiene que dar la misma
   clave que la que ve WhatsApp. Los números son inventados. */

const AR = "5491155551234";

test("Argentina: con el +54 9, sin el 9, con el 0 y el 15, con el 00", () => {
  for (const escrito of [
    "+54 9 11 5555-1234", "+5491155551234", "5491155551234", "54 9 11 5555 1234",
    "+54 11 5555-1234", "54 11 5555 1234", "541155551234",
    "011 15 5555-1234", "(011) 5555-1234", "011-5555-1234", "0 11 5555 1234",
    "0054 9 11 5555-1234", "+54 011 15 5555 1234", "+54 11 15 5555 1234",
    "5491155551234@s.whatsapp.net", "5491155551234:12@s.whatsapp.net",
  ]) {
    assert.equal(clavesDeTelefono(escrito, "Argentina")[0], AR, `«${escrito}» con país`);
    assert.ok(clavesDeTelefono(escrito).includes(AR), `«${escrito}» sin país`);
  }
});

test("Argentina: 11 5555 1234 sin código de país entra como candidato aunque no se sepa el país", () => {
  assert.deepEqual(clavesDeTelefono("11 5555-1234").slice(0, 1), [AR]);
  assert.deepEqual(clavesDeTelefono("1155551234").slice(0, 1), [AR]);
});

test("Argentina: un área de 3 y de 4 dígitos con el 15 de celular", () => {
  /* Córdoba (351) y Santa Rosa (2954). */
  assert.ok(clavesDeTelefono("0351 15 555 1234", "AR").includes("5493515551234"));
  assert.ok(clavesDeTelefono("(0351) 155-551234", "AR").includes("5493515551234"));
  assert.ok(clavesDeTelefono("02954 15 123456", "AR").includes("5492954123456"));
  assert.ok(clavesDeTelefono("+54 9 351 555 1234").includes("5493515551234"));
});

test("Argentina: sin código de área sólo se completa si se sabe que es de Argentina", () => {
  assert.deepEqual(clavesDeTelefono("15 5555-1234", "Argentina").slice(0, 1), [AR]);
  assert.deepEqual(clavesDeTelefono("5555-1234", "AR").slice(0, 1), [AR]);
  assert.ok(!clavesDeTelefono("5555-1234").includes(AR), "ocho dígitos sueltos no se completan con un área sin saber el país");
  assert.ok(!clavesDeTelefono("15 5555-1234").includes(AR), "sin saber el país, un 15 no se completa");
});

test("México: con y sin el 1 de los celulares viejos, con el 01 y el 044", () => {
  const MX = "525512345678";
  for (const escrito of ["+52 1 55 1234 5678", "+52 55 1234 5678", "+5215512345678", "525512345678", "5215512345678", "5215512345678@s.whatsapp.net"]) {
    assert.equal(claveInternacional(escrito), MX, escrito);
    assert.ok(clavesDeTelefono(escrito).includes(MX), escrito);
  }
  assert.equal(clavesDeTelefono("55 1234 5678", "México")[0], MX);
  assert.equal(clavesDeTelefono("044 55 1234 5678", "mx")[0], MX);
  assert.equal(clavesDeTelefono("01 55 1234 5678", "MX")[0], MX);
});

test("Colombia: con y sin el +57", () => {
  const CO = "573001234567";
  assert.equal(claveInternacional("+57 300 123 4567"), CO);
  assert.equal(clavesDeTelefono("300 123 4567", "Colombia")[0], CO);
  assert.equal(clavesDeTelefono("57 300 123 4567")[0], CO);
  assert.ok(clavesDeTelefono("3001234567").includes(CO), "sin país, el celular colombiano está entre los candidatos");
});

test("España: nueve dígitos, con y sin el +34", () => {
  const ES = "34612345678";
  assert.equal(claveInternacional("+34 612 34 56 78"), ES);
  assert.equal(clavesDeTelefono("612 34 56 78", "España")[0], ES);
  assert.ok(clavesDeTelefono("612345678").includes(ES));
  assert.equal(clavesDeTelefono("34612345678")[0], ES);
});

test("otros países: Chile, Perú, Uruguay con el 0, Estados Unidos, Brasil con y sin el 9", () => {
  assert.equal(clavesDeTelefono("9 1234 5678", "Chile")[0], "56912345678");
  assert.equal(clavesDeTelefono("912 345 678", "Perú")[0], "51912345678");
  assert.equal(clavesDeTelefono("099 123 456", "Uruguay")[0], "59899123456");
  assert.equal(clavesDeTelefono("(305) 555-1234", "USA")[0], "13055551234");
  assert.equal(claveInternacional("+1 305 555 1234"), "13055551234");
  /* Brasil: WhatsApp tiene cuentas con y sin el 9 después del área. */
  assert.deepEqual(clavesDeTelefono("+55 11 91234-5678"), ["5511912345678"], "con el + no se adivina");
  assert.deepEqual(clavesDeTelefono("11 91234-5678", "Brasil"), ["5511912345678", "551112345678"]);
});

test("lo que no es un teléfono no da clave", () => {
  for (const x of ["", "   ", "abc", "123", "1234567", "sin teléfono", null, undefined, "12345678901234567890"]) {
    assert.deepEqual(clavesDeTelefono(x as string), [], String(x));
  }
  assert.equal(claveInternacional("123456@lid"), null, "el id interno de WhatsApp no es un teléfono");
  assert.equal(claveInternacional("120363025246125486@g.us"), null, "ni el de un grupo");
  assert.equal(claveInternacional("12345"), null);
  assert.equal(claveInternacional(null), null);
  assert.equal(claveInternacional("0" + "5491155551234"), null, "empieza con 0: no trae código de país");
});

test("dos números en el mismo campo dan las claves de los dos", () => {
  const argentinas = (xs: string[]) => xs.filter((c) => c.startsWith("549"));
  const dos = clavesDeTelefono("11 5555-1234 / 11 4444-3333", "AR");
  assert.deepEqual(argentinas(dos), [AR, "5491144443333"]);
  assert.equal(dos[0], AR, "la más probable primero");
  assert.deepEqual(clavesDeTelefono("11 5555-1234 y 11 4444-3333", "AR"), dos);
  assert.deepEqual(clavesDeTelefono("11 5555-1234\n11 4444-3333", "AR"), dos);
});

test("con el + el país no se discute, aunque la persona diga otro", () => {
  assert.deepEqual(clavesDeTelefono("+57 300 123 4567", "Argentina"), ["573001234567"]);
});

test("el país mal escrito no rompe nada: se ignora", () => {
  assert.equal(clavesDeTelefono("11 5555-1234", "marte")[0], AR);
  assert.equal(clavesDeTelefono("11 5555-1234", "")[0], AR);
});

test("una clave inventada de más no choca con otra persona: cada candidato lleva su código de país", () => {
  /* Diez dígitos sin país: cada país los lee a su manera y todos son números distintos. */
  const todas = clavesDeTelefono("3001234567");
  assert.equal(new Set(todas).size, todas.length);
  assert.ok(todas.every((c) => c.length >= 11));
});

test("traePais y numeroParaWhatsapp", () => {
  assert.equal(traePais("+54 9 11 5555-1234"), true);
  assert.equal(traePais("0054 9 11"), true);
  assert.equal(traePais("5491155551234@s.whatsapp.net"), true);
  assert.equal(traePais("11 5555-1234"), false);
  /* Con el +, la clave. Sin país y sin saber de dónde es, lo que se escribió. */
  assert.equal(numeroParaWhatsapp("+54 9 11 5555-1234"), AR);
  assert.equal(numeroParaWhatsapp("011 15 5555-1234", "Argentina"), AR);
  assert.equal(numeroParaWhatsapp("11 5555-1234"), "1155551234");
  assert.equal(numeroParaWhatsapp("11 5555-1234", "marte"), "1155551234");
  assert.equal(digitosDe("0054 9 11 5555-1234"), "5491155551234");
});
