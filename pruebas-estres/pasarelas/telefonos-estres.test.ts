import test from "node:test";
import assert from "node:assert/strict";
import { claveTelefono, compararTelefonos, digitosWhatsapp, normalizarTelefono, telefonoLegible } from "@/lib/telefonos";
import { claveInternacional, clavesDeTelefono, numeroParaWhatsapp, traePais, digitosDe } from "@/lib/telefonos-wpp";
import { normalizarTelefono as normalizarParaMeta } from "@/lib/capi-datos";
import { Azar, propiedad, textoLoco } from "./azar";
import { GENERADORES, argentina, claveAgenda, claveLector, colombia, espana, mexico } from "./lineas";

/* ==================================================================
   ESTRÉS · las claves de teléfono (lib/telefonos.ts y lib/telefonos-wpp.ts).

   El mismo número se escribe de decenas de formas (Argentina con 0, 15 y 9;
   México con 044 y 1; Colombia, España, Chile…); la clave tiene que ser
   la misma para todas y distinta para números distintos, en las dos
   librerías (la de teléfonos de la agenda y la del lector de WhatsApp).

   Se generan líneas al azar con su forma canónica y se las escribe de varias
   maneras. Se mira:
   - estabilidad: todas las formas dan la misma clave, y volver a pasar la
     clave por la función da la misma;
   - simetría de compararTelefonos;
   - sin colisiones: números distintos, claves distintas;
   - nada tira excepción, con basura.
   Lo que falla por un bug real queda abajo, con «BUG:» y { todo: true }.
   ================================================================== */

/* ---------- estabilidad ---------- */

test("telefonos.ts: todas las formas con «+» o «00» de una línea dan la misma clave, con o sin país, para Argentina, México, Colombia, España, Chile, Perú, Uruguay, EE.UU. y Brasil", propiedad("formas con +", 200, (az) => {
  const l = az.pick(GENERADORES)(az);
  for (const t of l.conMas) {
    for (const pais of [undefined, null, l.iso]) assert.equal(claveTelefono(t, pais), claveAgenda(l), `«${t}» (país ${pais})`);
  }
}));

test("telefonos-wpp.ts: todas las formas con «+» o «00» de una línea dan la misma clave (la de WhatsApp: Argentina con el 9)", propiedad("formas con + (wpp)", 200, (az) => {
  const l = az.pick(GENERADORES)(az);
  for (const t of l.conMas.filter((x) => !/^\+\d{1,3} 0\d/.test(x))) {
    for (const pais of [undefined, null, l.pais]) assert.equal(clavesDeTelefono(t, pais)[0], claveLector(l), `«${t}» (país ${pais})`);
  }
}));

test("telefonos.ts: con el país de la persona, las formas nacionales dan la clave de la línea", propiedad("formas nacionales", 250, (az) => {
  const l = az.pick(GENERADORES.filter((g) => g !== mexico))(az);
  for (const t of l.locales) assert.equal(claveTelefono(t, l.iso), claveAgenda(l), `«${t}» (${l.iso})`);
  /* México aparte: sin el 044/045 de marcado, que tiene su BUG más abajo. */
  const m = mexico(az);
  for (const t of m.locales) assert.equal(claveTelefono(t, "MX"), claveAgenda(m), `«${t}» (MX)`);
}));

test("telefonos-wpp.ts: con el país de la persona, las formas nacionales dan la clave de la línea (entre las candidatas, la primera)", propiedad("formas nacionales (wpp)", 250, (az) => {
  const l = az.pick(GENERADORES)(az);
  for (const t of [...l.locales, ...l.conCodigo]) {
    const claves = clavesDeTelefono(t, l.pais);
    assert.ok(claves.includes(claveLector(l)), `«${t}» (${l.pais}) dio ${JSON.stringify(claves)}`);
    assert.equal(claves[0], claveLector(l), `la más probable es la del país de la persona: «${t}»`);
  }
}));

test("telefonos.ts: con el código pero sin «+» y sin país, el largo decide (Argentina, México, Colombia y los que tienen 12 dígitos)", propiedad("código sin + sin país", 200, (az) => {
  const l = az.pick([argentina, mexico, colombia])(az);
  for (const t of l.conCodigo.filter((x) => !/^521/.test(x))) assert.equal(claveTelefono(t), claveAgenda(l), `«${t}»`);
}));

test("las dos librerías coinciden: la clave de la agenda es la del lector (salvo el 9 argentino) para toda forma con «+»", propiedad("las dos librerías", 250, (az) => {
  const l = az.pick(GENERADORES)(az);
  for (const t of l.conMas.filter((x) => !/^\+\d{1,3} 0\d/.test(x))) {
    const a = claveTelefono(t);
    const b = claveInternacional(t);
    assert.equal(a, claveAgenda(l));
    assert.equal(b, claveLector(l));
    assert.equal(l.iso === "AR" ? a!.replace(/^54/, "549") : a, b);
    /* Y para abrir el chat: los dos dan los mismos dígitos. */
    assert.equal(digitosWhatsapp(t), numeroParaWhatsapp(t));
  }
}));

test("la clave es estable: pasarla otra vez por la función (con «+») da la misma, y el e164 también", propiedad("idempotencia de la clave", 400, (az) => {
  const l = az.pick(GENERADORES)(az);
  const t = az.pick([...l.conMas, ...l.conCodigo, ...l.locales]);
  const n = normalizarTelefono(t, az.pick([l.iso, null, undefined]));
  if (n.clave) {
    assert.equal(claveTelefono("+" + n.clave), n.clave);
    assert.equal(n.e164, "+" + n.clave);
    assert.equal(claveTelefono(n.e164!), n.clave);
  }
  for (const c of clavesDeTelefono(t, l.pais)) {
    assert.equal(claveInternacional(c), c, `la clave «${c}» no es estable`);
    assert.equal(clavesDeTelefono("+" + c)[0], c);
  }
}));

test("ruido alrededor del número (espacios, guiones, puntos, paréntesis, texto) no cambia la clave", propiedad("ruido", 300, (az) => {
  const l = az.pick(GENERADORES)(az);
  const t = az.pick(l.conMas);
  /* El prefijo («+» o «00») queda entero; el ruido va entre los demás dígitos. */
  const prefijo = /^(\+|00)/.exec(t)![0];
  const resto = t.slice(prefijo.length);
  const ruido = (s: string) => [...s].map((c) => (/\d/.test(c) && az.bool(0.25) ? c + az.pick([" ", "-", ".", " - ", "  "]) : c)).join("");
  const cuerpo = ruido(resto);
  const sucio = prefijo === "+"
    ? az.pick([`Tel: +${cuerpo}`, `+${cuerpo}`, `+${cuerpo} (WhatsApp)`, `  +${cuerpo}\n`, `\t+${cuerpo}`])
    : az.pick([`00${cuerpo}`, `  00${cuerpo} (WhatsApp)`]);
  assert.equal(claveTelefono(sucio), claveTelefono(t), `sucio «${sucio}» vs «${t}»`);
  /* El lector de WhatsApp trabaja con candidatas: con un rótulo adelante («Tel: +1…») ya no ve el «+» y la primera puede ser de
     otro país, pero la buena tiene que estar entre ellas. Sin rótulo, es la primera. */
  const buena = clavesDeTelefono(t)[0];
  assert.ok(clavesDeTelefono(sucio).includes(buena), `sucio (wpp) «${JSON.stringify(sucio)}» vs «${t}»`);
  if (!/^\s*Tel:/.test(sucio)) assert.equal(clavesDeTelefono(sucio)[0], buena, `sucio (wpp) «${JSON.stringify(sucio)}» vs «${t}»`);
}));

/* ---------- simetría ---------- */

test("compararTelefonos: simétrico, «igual» si las claves son iguales, «no» si las dos tienen clave y es distinta, y reflexivo", propiedad("simetría", 500, (az) => {
  const a = az.pick(GENERADORES)(az), b = az.bool(0.3) ? a : az.pick(GENERADORES)(az);
  const ta = az.pick([...a.conMas, ...a.locales]), tb = az.pick([...b.conMas, ...b.locales]);
  const pa = az.pick([a.iso, null]), pb = az.pick([b.iso, null]);
  const x = compararTelefonos(ta, tb, pa, pb), y = compararTelefonos(tb, ta, pb, pa);
  assert.equal(x, y, `«${ta}» vs «${tb}»`);
  const ka = claveTelefono(ta, pa), kb = claveTelefono(tb, pb);
  if (ka && kb) assert.equal(x, ka === kb ? "igual" : "no");
  /* Un número contra sí mismo nunca es «no» (sin código de área, de 8 dígitos, queda en «parcial» a propósito). */
  assert.notEqual(compararTelefonos(ta, ta, pa, pa), "no", "un número contra sí mismo");
  if (ka) assert.equal(compararTelefonos(ta, ta, pa, pa), "igual");
}));

/* ---------- sin colisiones ---------- */

test("sin colisiones: líneas distintas dan claves distintas (en las dos librerías) y nunca «igual» ni «parcial» si las dos traen el país", propiedad("sin colisiones", 40, (az) => {
  const lineas = Array.from({ length: 60 }, () => az.pick(GENERADORES)(az));
  const porAgenda = new Map<string, string>(), porLector = new Map<string, string>();
  for (const l of lineas) {
    const canonica = `${l.iso}:${l.nacional}`;
    for (const t of [az.pick(l.conMas), az.pick(l.conMas)]) {
      const a = claveTelefono(t), b = claveInternacional(t);
      assert.ok(a && b, `«${t}» sin clave`);
      const vistaA = porAgenda.get(a!); assert.ok(vistaA === undefined || vistaA === canonica, `${a} es de ${vistaA} y de ${canonica}`); porAgenda.set(a!, canonica);
      const vistaB = porLector.get(b!); assert.ok(vistaB === undefined || vistaB === canonica, `${b} es de ${vistaB} y de ${canonica}`); porLector.set(b!, canonica);
    }
  }
  for (let i = 0; i < lineas.length; i++) for (let j = i + 1; j < lineas.length; j++) {
    const x = lineas[i], y = lineas[j];
    if (x.iso === y.iso && x.nacional === y.nacional) continue;
    assert.equal(compararTelefonos(x.conMas[0], y.conMas[0]), "no", `${x.conMas[0]} vs ${y.conMas[0]}`);
  }
}));

test("sin colisiones por los últimos 8 dígitos: dos líneas argentinas con el mismo abonado y otra área no son la misma", () => {
  assert.equal(compararTelefonos("+54 9 11 5555-1234", "+54 9 351 555-1234"), "no");
  assert.equal(compararTelefonos("+54 9 11 5555-1234", "+54 9 11 5555-1235"), "no");
  assert.equal(compararTelefonos("11 5555 1234", "+54 9 11 5555-1234"), "igual", "sin país: se compara el nacional");
  assert.equal(compararTelefonos("5555 1234", "+54 9 11 5555-1234"), "parcial", "sin código de área sólo coinciden los últimos 8");
  assert.notEqual(claveTelefono("+54 9 11 5555-1234"), claveTelefono("+54 9 11 5555-1235"));
  assert.notEqual(claveTelefono("+52 55 1234 5678"), claveTelefono("+54 9 55 1234 5678"));
});

/* ---------- basura ---------- */

test("con basura: nada tira, las claves tienen de 8 a 15 dígitos y los links de WhatsApp sólo dígitos", propiedad("basura de teléfonos", 800, (az) => {
  const largo = az.int(5, 18);
  let s = az.pick(["", "+", "00", "+", ""]);
  for (let j = 0; j < largo; j++) s += String(az.int(0, 9)) + (az.bool(0.2) ? az.pick(["", " ", "-", ".", "(", ")", " - ", "/", "x"]) : "");
  if (az.bool(0.2)) s = textoLoco(az, 40);
  const pais = az.pick([null, undefined, "", "AR", "MX", "CO", "ES", "Argentina", "México", "Colombia", "España", "US", "BR", "xx", "Narnia", "UY", "CL", "PE", "\u0000", "🇦🇷"]);
  const n = normalizarTelefono(s, pais);
  assert.equal(typeof n.nacional, "string");
  if (n.clave !== undefined) {
    assert.match(n.clave, /^\d{8,15}$/);
    assert.equal(claveTelefono("+" + n.clave), n.clave, `idempotencia de «${s}» (${pais})`);
    assert.match(digitosWhatsapp(s, pais), /^\d+$/);
  }
  for (const c of clavesDeTelefono(s, pais)) {
    assert.match(c, /^\d{8,15}$/);
    assert.equal(claveInternacional(c), c, `idempotencia wpp de «${s}» (${pais})`);
  }
  const cl = claveInternacional(s);
  if (cl !== null) assert.match(cl, /^\d{8,15}$/);
  assert.equal(typeof telefonoLegible(s, pais), "string");
  assert.equal(typeof numeroParaWhatsapp(s, pais), "string");
  assert.equal(typeof traePais(s), "boolean");
  assert.equal(typeof digitosDe(s), "string");
  const y = compararTelefonos(s, "+54 9 11 5555-1234", pais, null);
  assert.equal(y, compararTelefonos("+54 9 11 5555-1234", s, null, pais));
}));

test("casos de borde: vacío, nulo, sólo signos, largos de 6 y 16 dígitos, ids de WhatsApp (@lid, @g.us, @s.whatsapp.net)", () => {
  for (const x of [null, undefined, "", " ", "+", "00", "+++", "abc", "-", "()", "123456", "1".repeat(16), "+" + "1".repeat(16), "0".repeat(10)]) {
    assert.equal(claveTelefono(x as string), undefined, `«${x}»`);
    assert.equal(clavesDeTelefono(x as string).length, 0, `«${x}» (wpp)`);
    assert.equal(claveInternacional(x as string), null, `«${x}» (wpp, internacional)`);
  }
  assert.equal(claveInternacional("5491155551234@s.whatsapp.net"), "5491155551234");
  assert.equal(claveInternacional("5491155551234:12@s.whatsapp.net"), "5491155551234");
  assert.equal(claveInternacional("1203630252461254@lid"), null);
  assert.equal(claveInternacional("120363025246125486@g.us"), null);
  assert.equal(traePais("5491155551234@s.whatsapp.net"), true);
  assert.equal(traePais("011 5555 1234"), false);
});

test("dos números en un mismo campo dan las claves de los dos, sin repetir", propiedad("dos números", 100, (az) => {
  const a = argentina(az), b = az.pick([colombia, espana, mexico])(az);
  const sep = az.pick([" / ", ", ", "; ", "\n", " | ", " y ", " o "]);
  const claves = clavesDeTelefono(`${a.conMas[0]}${sep}${b.conMas[0]}`);
  assert.ok(claves.includes(claveLector(a)), JSON.stringify(claves));
  assert.ok(claves.includes(claveLector(b)), JSON.stringify(claves));
  assert.equal(new Set(claves).size, claves.length);
}));

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: telefonos.ts: con el país de la persona, un número con su código pero sin «+» y de 11 dígitos (ES, CL, PE, UY, US…) se queda sin clave", { todo: true }, () => {
  /* `trae = dado && digitos.startsWith(dado.cc) && digitos.length > 11`: el umbral de 11 deja afuera a los países
     cuyo número internacional mide justo 11 (34+9, 56+9, 51+9, 598+8, 1+10). Sin país sí se reconoce
     (claveTelefono("34614033853") = «34614033853»): pasar el país empeora el resultado. Pasa con los
     números que un Excel deja sin el «+» (registros-webinar.ts → telefonoNormDe). */
  for (const [t, pais, esperada] of [
    ["34614033853", "ES", "34614033853"], ["56940415078", "CL", "56940415078"], ["51916835805", "PE", "51916835805"],
    ["59897051413", "UY", "59897051413"], ["14780387587", "US", "14780387587"],
  ] as const) {
    assert.equal(claveTelefono(t), esperada, `sin país «${t}»`);
    assert.equal(claveTelefono(t, pais), esperada, `con país ${pais} «${t}»`);
  }
});

test("BUG: telefonos.ts: el 044 / 045 mexicano de marcado (y el 01) dan una clave equivocada (se pegan al código del país)", { todo: true }, () => {
  /* nacionalMexicano(n) mira /^4[45]/ sobre `n` (que todavía trae el cero de adelante: «0447011632767») y no
     sobre `x`, ya sin ceros: la regla sólo se cumple si falta el 0. «044 70 1163 2767» da 52447011632767. */
  for (const t of ["044 70 1163 2767", "045 70 1163 2767", "044 7011632767", "01 70 1163 2767"]) {
    assert.equal(claveTelefono(t, "MX"), "527011632767", `«${t}»`);
  }
});

test("BUG: telefonos-wpp.ts: «+598 097…», «+593 099…», «+595 098…», «+58 0414…», «+55 011…» (el cero de marcado después del código) dan una clave equivocada", { todo: true }, () => {
  /* internacional() sólo limpia la troncal en Argentina y México; para el resto devuelve los dígitos como están.
     En telefonos.ts sí se saca (canonico → replace(/^0+/)): las dos librerías no coinciden. Con una clave
     equivocada, el lector de WhatsApp dice «no se unió» de alguien que sí está en el grupo. */
  for (const [t, esperada] of [
    ["+598 097051413", "59897051413"], ["+593 0906354406", "593906354406"], ["+595 0937052354", "595937052354"],
    ["+58 04721256994", "584721256994"], ["+55 011927715661", "5511927715661"],
  ] as const) {
    assert.equal(claveTelefono(t), esperada, `telefonos.ts «${t}»`);
    assert.equal(clavesDeTelefono(t)[0], esperada, `telefonos-wpp.ts «${t}»`);
  }
});

test("BUG: telefonos-wpp.ts: «00 34 612 345 678» (con un espacio después del 00) no se entiende como internacional: sin clave, «ilegible»", { todo: true }, () => {
  /* clavesDeUno exige /^\s*00\d/ (el 00 pegado al código). telefonos.ts sí lo acepta (/^(\+|00)/). */
  for (const [t, esperada] of [["00 34 612 345 678", "34612345678"], ["00 54 9 11 5555 1234", "5491155551234"], ["00 57 300 123 4567", "573001234567"]] as const) {
    assert.ok(claveTelefono(t), `telefonos.ts entiende «${t}»`);
    assert.deepEqual(clavesDeTelefono(t), [esperada], `telefonos-wpp.ts «${t}»`);
  }
});

test("BUG: el teléfono para la Conversions API de Meta (capi-datos.ts) no le pone el código de país a los argentinos escritos con 0 y 15 (o con el 9) ni a los brasileños de 11 dígitos: el hash no coincide con el de Meta", { todo: true }, () => {
  /* normalizarTelefono (capi-datos.ts) sólo antepone el código si quedan 10 dígitos o menos: «011 15 5555-1234»
     (12 sin el 0), «9 11 5555-1234» (11) y un celular de Brasil «11 91234-5678» (11) quedan sin el código de país
     («111555551234»); Meta hashea «5491155551234» / «5511912345678». Pasa con la mitad de los formatos argentinos
     locales y con todos los brasileños. Hay una clave mejor hecha en telefonos.ts (claveTelefono). */
  const mal: string[] = [];
  for (const [t, pais, cc] of [["011 15 5555-1234", "Argentina", "54"], ["0 11 15 5555 1234", "Argentina", "54"], ["9 11 5555-1234", "Argentina", "54"], ["(011) 15-5555-1234", "Argentina", "54"], ["02966 15 30-4084", "Argentina", "54"], ["11 91234-5678", "Brasil", "55"], ["(11) 91234-5678", "Brasil", "55"]] as const) {
    const d = normalizarParaMeta(t, pais);
    if (!d.startsWith(cc)) mal.push(`«${t}» (${pais}) quedó «${d}»`);
  }
  assert.deepEqual(mal, []);
});
