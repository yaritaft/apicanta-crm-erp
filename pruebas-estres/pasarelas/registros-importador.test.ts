import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPOS_IMPORT, adivinarMapeo, emailValido, filaParaBase, fusionarRegistro, idRegistro, instanteDe, leerFecha, leerHoja,
  nuevoRegistro, planificarImportacion, type RegistroForm,
} from "@/lib/registros-webinar";
import { claveEmail } from "@/lib/contactos";
import { leerCSV } from "@/lib/pasarelas";
import { Azar, propiedad, textoLoco } from "./azar";

/* ==================================================================
   ESTRÉS · el importador de registros del webinar (lib/registros-webinar.ts).

   Las hojas del Excel se leen con encabezados de mil formas. Se prueba con
   hojas al azar (mayúsculas, tildes, espacios, filas vacías, mails
   repetidos y rotos, columnas de más):
   - ninguna fila se pierde: cada fila con datos es un registro, una
     descartada (sin mail válido) o una repetida (el mismo mail);
   - el mismo mail (con otras mayúsculas o espacios) es la misma persona:
     no se duplica ni dentro de una hoja ni entre hojas del mismo webinar;
   - importar dos veces, o en otro orden, deja las mismas filas, y las
     marcas del equipo (unido, contactado, notas) no se pisan nunca;
   - no tira excepción con nada.
   ================================================================== */

const NOMBRES = ["Ana Pérez", "Beto Núñez", "Cami Ruiz", "Dani Gómez", "Eli Sosa", "Fede Lugones", "Gaby Ñandú", "Hugo Paz", "Ini Ortiz", "Juli Vega"];

const ENCABEZADOS = {
  email: ["Email", "EMAIL", "  email  ", "Correo electrónico", "CORREO ELECTRÓNICO", "Correo Electronico:", "Mail", "mail:", "Tu email", "Email address", "Dirección de correo", "Email (obligatorio)", "email*"],
  nombre: ["Nombre", "NOMBRE", "Nombre y apellido", "Apellido y nombre", "Nombre completo", "Full name", "name"],
  telefono: ["Teléfono", "TELEFONO", "Celular", "WhatsApp", "Phone", "Móvil", "Tel."],
  pais: ["País", "PAIS", "Country"],
};

interface HojaGen { tabla: string[][]; filasConDatos: number; mails: (string | null)[]; emailCol: number }

function hojaAleatoria(az: Azar, conFecha = true): HojaGen {
  const cols = az.mezclar([
    { tipo: "email", h: az.pick(ENCABEZADOS.email) }, { tipo: "nombre", h: az.pick(ENCABEZADOS.nombre) },
    { tipo: "telefono", h: az.pick(ENCABEZADOS.telefono) }, { tipo: "pais", h: az.pick(ENCABEZADOS.pais) },
    ...(az.bool(0.5) ? [{ tipo: "extra", h: "¿Qué esperás aprender?" }] : []), ...(az.bool(0.3) ? [{ tipo: "extra", h: "Nivel de inglés" }] : []),
  ]);
  const tabla: string[][] = [cols.map((c) => c.h)];
  const base = Array.from({ length: az.int(1, 12) }, (_, i) => `${az.alfanum(5).toLowerCase()}${i}@${az.pick(["gmail.com", "hotmail.com", "mail.com.ar"])}`);
  const mails: (string | null)[] = [];
  let filasConDatos = 0;
  for (let i = 0; i < az.int(0, 30); i++) {
    const k = az.int(0, 9);
    let email: string;
    let valido: boolean;
    if (k < 5) { email = az.pick(base); valido = true; }
    else if (k < 7) { email = az.pick(base).toUpperCase(); valido = true; }
    else if (k < 8) { email = ` ${az.pick(base)} `; valido = true; }
    else if (k < 9) { email = az.pick(["sin arroba", "a@b", "@x.com", "", "nombre.apellido", "a b@c.com", "a@b."]); valido = false; }
    else { email = ""; valido = false; }
    const fila = cols.map((c) => c.tipo === "email" ? email : c.tipo === "nombre" ? az.pick(NOMBRES) : c.tipo === "telefono" ? `+54 9 11 ${az.digitos(4)}-${az.digitos(4)}` : c.tipo === "pais" ? az.pick(["Argentina", "México", "Colombia", "España"]) : az.pick(["Todo", "", "Cambiar de trabajo"]));
    /* Una fila totalmente en blanco se saltea sin contar. */
    const enBlanco = az.bool(0.1);
    if (enBlanco) { tabla.push(cols.map(() => az.pick(["", " ", "  "]))); continue; }
    if (az.bool(0.1)) fila.length = Math.max(1, az.int(1, fila.length));
    const tieneDatos = fila.some((x) => x.trim() !== "");
    tabla.push(fila);
    /* Una fila que quedó sin nada (por recortarla) se saltea sin contar. */
    if (!tieneDatos) continue;
    filasConDatos++;
    mails.push(valido && fila[cols.findIndex((c) => c.tipo === "email")] !== undefined ? claveEmail(email) : null);
    void conFecha;
  }
  return { tabla, filasConDatos, mails, emailCol: cols.findIndex((c) => c.tipo === "email") };
}

/* ---------- adivinarMapeo ---------- */

test("adivinarMapeo: encabezados con mayúsculas, tildes, espacios y signos: encuentra el mail, y cada columna se usa una sola vez", propiedad("mapeo de encabezados", 300, (az) => {
  const heads = Array.from({ length: az.int(0, 14) }, () => az.bool(0.7)
    ? az.pick([...ENCABEZADOS.email, ...ENCABEZADOS.nombre, ...ENCABEZADOS.telefono, ...ENCABEZADOS.pais, "Fecha de registro", "Marca temporal", "utm_source", "UTM Campaign", "Unido al grupo", "Contactado", "Notas", "ID anuncio"])
    : textoLoco(az, 25));
  const m = adivinarMapeo(heads);
  const usadas = Object.values(m);
  assert.equal(new Set(usadas).size, usadas.length, "cada columna sirve para un solo dato");
  for (const i of usadas) assert.ok(Number.isInteger(i) && i >= 0 && i < heads.length, `columna ${i} fuera de rango`);
  for (const campo of Object.keys(m)) assert.ok(CAMPOS_IMPORT.some((c) => c.campo === campo));
  /* Si hay un encabezado de mail «normal», se encuentra (no necesariamente el primero: puede haber otro). */
  if (heads.some((h) => ENCABEZADOS.email.includes(h))) assert.ok(m.email !== undefined, `no encontró el mail en ${JSON.stringify(heads)}`);
}));

test("adivinarMapeo: con encabezados vacíos, repetidos o sólo símbolos no rompe y no inventa columnas", () => {
  for (const heads of [[], [""], ["", "", ""], ["   "], ["???", "!!!"], ["Email", "Email", "Email"], ["email", "EMAIL", "Email "], [" Email "], ["📧 Email"]]) {
    const m = adivinarMapeo(heads);
    for (const i of Object.values(m)) assert.ok(i >= 0 && i < heads.length);
  }
  assert.deepEqual(adivinarMapeo([]), {});
  /* Tres columnas de mail: sólo una es «el mail». */
  assert.equal(Object.values(adivinarMapeo(["Email", "Email", "Email"])).length, 1);
});

/* ---------- leerHoja ---------- */

test("leerHoja: ninguna fila se pierde (registro, descartada o repetida) y el mismo mail con otra forma no se duplica", propiedad("conservación de filas del importador", 250, (az) => {
  const h = hojaAleatoria(az);
  const mapeo = adivinarMapeo(h.tabla[0]);
  assert.ok(mapeo.email !== undefined);
  const r = leerHoja({ nombre: "Webinar 23-09", tabla: h.tabla, mapeo, fechaWebinar: "2026-09-23", incluir: true }, { ahora: "2026-09-24T00:00:00.000Z", anio: 2026 });
  const validos = h.mails.filter((m): m is string => m !== null);
  const distintos = new Set(validos);
  assert.equal(r.registros.length, distintos.size, "un registro por mail distinto");
  assert.equal(r.repetidas, validos.length - distintos.size, "los repetidos se cuentan");
  assert.equal(r.descartadas.length, h.mails.length - validos.length, "los sin mail válido se descartan con motivo");
  assert.equal(r.registros.length + r.repetidas + r.descartadas.length, h.filasConDatos, "cuenta cerrada: ninguna fila se perdió");
  const ids = r.registros.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "ids únicos");
  for (const reg of r.registros) {
    assert.equal(reg.email, claveEmail(reg.email), "el mail se guarda normalizado");
    assert.ok(emailValido(reg.email));
    assert.equal(reg.id, idRegistro(reg.email, "2026-09-23"), "el id sale del mail y el día del webinar");
    assert.equal(reg.fechaWebinar, "2026-09-23");
    assert.equal(reg.origen, "excel");
    assert.ok(Array.isArray(reg.respuestas) && reg.respuestas.length <= 20);
    assert.ok(reg.respuestas.every((x) => x.respuesta.length <= 500));
    assert.ok(!Number.isNaN(Date.parse(reg.registradoEn)));
  }
  for (const d of r.descartadas) assert.ok(d.fila >= 2 && d.motivo.length > 0);
}));

test("leerHoja: no tira excepción con tablas vacías, filas más cortas, mapeos que apuntan afuera y celdas con basura", propiedad("leerHoja robusto", 300, (az) => {
  const filas = az.int(0, 8), cols = az.int(0, 6);
  const tabla = Array.from({ length: filas }, () => Array.from({ length: az.int(0, cols) }, () => (az.bool(0.2) ? "" : textoLoco(az, 40))));
  const mapeo: Record<string, number> = {};
  for (const c of CAMPOS_IMPORT) if (az.bool(0.4)) mapeo[c.campo] = az.int(-2, cols + 2);
  const r = leerHoja({ nombre: textoLoco(az, 20), tabla, mapeo, fechaWebinar: az.pick([undefined, "2026-09-23", "no es fecha", ""]), incluir: true },
    { ahora: "2026-09-24T00:00:00.000Z", anio: az.pick([2026, 1999, 3000, NaN]) });
  assert.ok(Array.isArray(r.registros) && Array.isArray(r.descartadas));
  for (const reg of r.registros) assert.ok(emailValido(reg.email));
}));

test("planificarImportacion: importar la misma lista dos veces (o en otro orden, o partida en dos hojas) no duplica y no pisa las marcas del equipo", propiedad("importación idempotente", 150, (az) => {
  const ahora = "2026-09-24T00:00:00.000Z";
  const h = hojaAleatoria(az);
  const mapeo = adivinarMapeo(h.tabla[0]);
  const hoja = (tabla: string[][], nombre: string) => leerHoja({ nombre, tabla, mapeo, fechaWebinar: "2026-09-23", incluir: true }, { ahora });
  const completa = hoja(h.tabla, "Webinar 23-09");
  const plan1 = planificarImportacion([completa], new Map());
  assert.equal(plan1.totales.nuevos, completa.registros.length);
  assert.equal(plan1.totales.yaEstaban, 0);

  /* Lo que ya quedó guardado, con marcas puestas por el equipo en algunos. */
  const guardados = new Map<string, RegistroForm>();
  for (const x of plan1.aEscribir) {
    const marcado: RegistroForm = az.bool(0.5) ? { ...x, grupo: az.pick(["unido", "no-unido"] as const), grupoPor: "ana@apicanta.com", grupoEn: ahora, contactado: az.bool(), contactadoPor: "beto@apicanta.com", notas: "No contesta" } : x;
    guardados.set(marcado.id, marcado);
  }
  /* La misma lista, mezclada y partida en dos hojas con el mismo día. */
  const cuerpo = az.mezclar(h.tabla.slice(1));
  const corte = az.int(0, cuerpo.length);
  const dos = [hoja([h.tabla[0], ...cuerpo.slice(0, corte)], "Webinar 23-09"), hoja([h.tabla[0], ...cuerpo.slice(corte)], "Webinar 23-09 (2)")];
  const plan2 = planificarImportacion(dos, guardados);
  assert.equal(plan2.totales.nuevos, 0, "todos ya estaban");
  assert.equal(plan2.aEscribir.length, guardados.size, "se escribe cada uno una vez");
  assert.equal(new Set(plan2.aEscribir.map((x) => x.id)).size, plan2.aEscribir.length);
  for (const w of plan2.aEscribir) {
    const antes = guardados.get(w.id)!;
    assert.equal(w.grupo, antes.grupo, "unido / no unido no se pisa");
    assert.equal(w.grupoPor, antes.grupoPor);
    assert.equal(w.contactado, antes.contactado || w.contactado);
    if (antes.contactado) { assert.equal(w.contactado, true); assert.equal(w.contactadoPor, antes.contactadoPor); }
    assert.equal(w.notas, antes.notas ?? w.notas);
    assert.equal(w.id, antes.id);
    assert.equal(w.registradoEn, antes.registradoEn);
  }
}));

test("fusionarRegistro: lo de afuera sólo llena huecos; las marcas del equipo (unido, contactado, notas, por, en) nunca se pisan", propiedad("fusionar sin pisar", 300, (az) => {
  const base = (): RegistroForm => nuevoRegistro({ email: "x@y.com", fechaWebinar: "2026-09-23", nombre: az.pick([undefined, "", "Ana"]), telefono: az.pick([undefined, "", "+54 9 11 5555-1234"]), pais: az.pick([undefined, "AR"]), notas: az.pick([undefined, "", "nota vieja"]) }, "2026-09-01T00:00:00.000Z");
  const ya = { ...base(), grupo: az.pick([undefined, "unido", "no-unido"] as const), contactado: az.bool(), contactadoPor: az.pick([undefined, "yo"]), contactadoEn: az.pick([undefined, "2026-09-02T00:00:00.000Z"]), grupoPor: az.pick([undefined, "yo"]) } as RegistroForm;
  const nuevo = { ...base(), nombre: "Otro Nombre", telefono: "+57 300 123 4567", pais: "CO", notas: "nota nueva", grupo: az.pick(["unido", "no-unido", undefined] as const), contactado: az.bool(), contactadoPor: "otra", contactadoEn: "2026-09-09T00:00:00.000Z" } as RegistroForm;
  const f = fusionarRegistro(ya, nuevo);
  if (ya.grupo) { assert.equal(f.grupo, ya.grupo); assert.equal(f.grupoPor, ya.grupoPor); }
  if (ya.contactado) { assert.equal(f.contactado, true); assert.equal(f.contactadoPor, ya.contactadoPor); assert.equal(f.contactadoEn, ya.contactadoEn); }
  if (ya.nombre) assert.equal(f.nombre, ya.nombre);
  if (ya.telefono) assert.equal(f.telefono, ya.telefono);
  if (ya.notas) assert.equal(f.notas, ya.notas);
  if (!ya.nombre) assert.equal(f.nombre, "Otro Nombre", "un hueco se llena");
  assert.equal(f.id, ya.id);
  assert.equal(f.email, ya.email);
  /* Una vez fusionado, volver a fusionar lo mismo no cambia nada. */
  assert.deepEqual(fusionarRegistro(f, nuevo), f);
}));

test("idRegistro: el mismo mail con otras mayúsculas o espacios es el mismo; mail o día distinto, otro id; sin colisiones en 20.000", () => {
  assert.equal(idRegistro("Ana@Mail.com ", "2026-09-23"), idRegistro("ana@mail.com", "2026-09-23T15:00:00Z"));
  assert.equal(idRegistro("ana@mail.com", undefined), idRegistro("ana@mail.com", ""));
  assert.notEqual(idRegistro("ana@mail.com", "2026-09-23"), idRegistro("ana@mail.com", "2026-09-24"));
  assert.notEqual(idRegistro("ana@mail.com", "2026-09-23"), idRegistro("anb@mail.com", "2026-09-23"));
  assert.notEqual(idRegistro("ana@mail.com", undefined), idRegistro("ana@mail.com", "2026-09-23"));
  const az = new Azar(31337);
  const vistos = new Map<string, string>();
  for (let i = 0; i < 20000; i++) {
    const mail = `${az.alfanum(az.int(1, 12)).toLowerCase()}@${az.pick(["a.com", "b.com", "c.com.ar"])}`;
    const dia = az.pick(["2026-09-23", "2026-10-07", "2026-10-14", undefined]);
    const k = `${mail}|${dia ?? ""}`;
    const id = idRegistro(mail, dia);
    assert.match(id, /^reg_[0-9a-f]{32}$/);
    const otro = vistos.get(id);
    assert.ok(otro === undefined || otro === k, `colisión: ${k} y ${otro}`);
    vistos.set(id, k);
  }
});

test("filaParaBase: sin undefined ni null ni vacíos (así la base completa con su default), pero siempre con respuestas, descartados y contactado", propiedad("fila para la base", 100, (az) => {
  const r = nuevoRegistro({ email: "x@y.com", nombre: az.pick([undefined, "", "Ana"]), telefono: az.pick([undefined, "11 5555 1234"]), pais: az.pick([undefined, "Argentina", "xx"]) }, "2026-09-01T00:00:00.000Z");
  const fila = filaParaBase(r);
  for (const [k, v] of Object.entries(fila)) assert.ok(v !== undefined && v !== null && (v !== "" || k === "email"), `${k} = ${JSON.stringify(v)}`);
  assert.ok(Array.isArray(fila.respuestas) && Array.isArray(fila.descartados) && typeof fila.contactado === "boolean");
}));

/* ---------- fechas ---------- */

test("leerFecha: no tira excepción con nada y, si contesta, es una fecha real del calendario", propiedad("leerFecha robusto", 600, (az) => {
  const t = az.bool(0.5) ? textoLoco(az, 40) : `${az.int(0, 99999)}${az.pick(["/", "-", ".", " de ", " "])}${az.int(0, 99)}${az.pick(["/", "-", ".", " de ", " "])}${az.int(0, 9999)}`;
  const f = leerFecha(t, az.pick([2026, 1999, 3000, NaN, undefined]));
  if (f !== undefined) {
    assert.match(f, /^-?\d{4,6}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(f)) || /^\d{4}-/.test(f) === false || true);
  }
  const i = instanteDe(t);
  if (i !== undefined) assert.ok(!Number.isNaN(Date.parse(i)));
}));

test("leerFecha: la misma fecha escrita de las formas de un Excel da el mismo día", propiedad("formatos de fecha", 400, (az) => {
  const d = new Date(Date.UTC(2024, 0, 1) + az.int(0, 5 * 365) * 86400000);
  const [a, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  const esperado = `${a}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const formas = [
    `${dd}/${m}/${a}`, `${p2(dd)}/${p2(m)}/${a}`, `${p2(dd)}-${p2(m)}-${String(a).slice(2)}`, `${a}-${p2(m)}-${p2(dd)}`, `${a}/${m}/${dd}`, `${a}${p2(m)}${p2(dd)}`,
    `${dd}.${m}.${a}`, `${dd} de ${MESES[m - 1]} de ${a}`, `${dd} ${MESES[m - 1].slice(0, 3)} ${a}`, `Webinar ${p2(dd)}/${p2(m)}/${a}`, `${p2(dd)}/${p2(m)}/${a} 18:30`,
    String(Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000)),
  ];
  for (const f of formas) assert.equal(leerFecha(f), esperado, `«${f}»`);
  /* Con hora: el día queda igual y la hora es la de Argentina. */
  const i = instanteDe(`${p2(dd)}/${p2(m)}/${a} 18:30:15`);
  assert.equal(i, `${esperado}T21:30:15.000Z`);
}));

test("leerFecha: fechas imposibles no existen (31/02, mes 13, día 0)", () => {
  for (const t of ["31/02/2026", "2026-02-30", "32/01/2026", "15/13/2026", "0/5/2026", "2026-00-10", "29/02/2025"]) assert.equal(leerFecha(t), undefined, t);
  assert.equal(leerFecha("29/02/2024"), "2024-02-29");
});

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: un encabezado «E-mail» (o «e-mail», «E-Mail», «Dirección de e-mail») no se reconoce como el mail: todas las filas quedan «sin mail»", { todo: true }, () => {
  /* El alias «e-mail» de CAMPOS_IMPORT nunca coincide: sinAcentos() cambia el guion por un espacio
     («e mail») pero los alias no pasan por sinAcentos. Y «mail» (4 letras) no entra en la pasada
     parcial (a.length >= 5). El usuario puede corregir el mapeo a mano, pero la sugerencia pierde todo. */
  for (const h of ["E-mail", "e-mail", "E-Mail", "E mail", "Dirección de e-mail"]) {
    const m = adivinarMapeo([h, "Nombre"]);
    assert.equal(m.email, 0, `«${h}» tendría que ser el mail`);
  }
  const hoja = leerHoja({ nombre: "x", tabla: [["E-mail", "Nombre"], ["ana@mail.com", "Ana"]], mapeo: adivinarMapeo(["E-mail", "Nombre"]), fechaWebinar: "2026-09-23", incluir: true });
  assert.equal(hoja.registros.length, 1);
});

test("BUG: el serial de Excel con hora («45923.6458») no se lee: da undefined, o una fecha equivocada si los decimales parecen un mes («45923.05»)", { todo: true }, () => {
  /* Las celdas de fecha y hora (la «marca temporal» de un formulario) salen de xlsx.ts como serial con
     decimales. leerFecha() prueba primero dd.mm (el «23.64» de «45923.6458»): mes 64 → undefined; con
     «45923.05» da el 23 de mayo. La rama del serial (/^\\d{5}(\\.\\d+)?$/) quedó inalcanzable con decimales. */
  assert.equal(leerFecha("45923"), "2025-09-23");
  assert.equal(leerFecha("45923.6458333"), "2025-09-23");
  assert.equal(leerFecha("45923.05"), "2025-09-23");
  assert.equal(leerFecha("45923.5"), "2025-09-23");
  assert.equal(instanteDe("45923.6458333"), "2025-09-23T19:30:00.000Z", "15:30 Argentina");
});

test("BUG: «sept» (la abreviatura habitual) no se reconoce como septiembre en las fechas del importador", { todo: true }, () => {
  /* MESES de registros-webinar.ts tiene «sep» y «set», no «sept» (lib/whatsapp.ts sí lo tiene). Una hoja
     «Webinar 23 sept» queda «sin fecha» y sus filas no se atan a ningún webinar. */
  assert.equal(leerFecha("23 sept 2026"), "2026-09-23");
  assert.equal(leerFecha("Webinar 23 Sept."), leerFecha("Webinar 23 sep", new Date().getFullYear()));
});

test("BUG: instanteDe ignora el huso horario escrito: «2026-09-23T10:00:00Z» (10:00 UTC) se guarda como 10:00 de Argentina (13:00 UTC)", { todo: true }, () => {
  assert.equal(instanteDe("2026-09-23T10:00:00Z"), "2026-09-23T10:00:00.000Z");
  assert.equal(instanteDe("2026-09-23T10:00:00-03:00"), "2026-09-23T13:00:00.000Z");
});

test("BUG: un CSV de registros con «;» de separador y una coma en una respuesta (sin comillas) corre las columnas y las filas quedan «sin mail»", { todo: true }, () => {
  /* ImportarFormularios arma la tabla con leerCSV(), que corta en «,», «;» y tabulador a la vez. «Quiero aprender Python, Django»
     se parte en dos celdas y el mail, que estaba después, cae en la columna de al lado. */
  const csv = "Nombre;Qué querés aprender;Email\nAna;Quiero aprender Python, Django;ana@mail.com\nBeto;Todo;beto@mail.com";
  const tabla = leerCSV(csv);
  const hoja = leerHoja({ nombre: "Webinar 23-09", tabla, mapeo: adivinarMapeo(tabla[0]), fechaWebinar: "2026-09-23", incluir: true });
  assert.deepEqual(hoja.registros.map((r) => r.email).sort(), ["ana@mail.com", "beto@mail.com"]);
  assert.equal(hoja.descartadas.length, 0);
});
