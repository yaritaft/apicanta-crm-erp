import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/* «Sólo lo suyo» (el tipo Closer) y «ve los leads de todos» no pueden dejar una tabla sin decidir.

   Lo que pasó (13/11, Dante): el 26/10 se creó el permiso «ve los leads de todos» y se abrieron cinco tablas. Las grabaciones de
   Fathom y las capturas de la pre-call (que cuelgan de la llamada) ya existían con solo_lo_suyo() a secas, nadie las anotó ni como
   abiertas ni como cerradas, y un closer con el permiso veía la llamada de otro pero NO su grabación. Nada lo frenó porque la
   decisión «¿esta tabla se abre con la llamada o queda cerrada?» no estaba escrita en ningún lado.

   Ahora está escrita acá, y estas pruebas fallan si alguien:
     · crea una tabla que cuelga de una llamada ("sesionId") y no la anota como abierta o cerrada;
     · escribe una política con solo_lo_suyo() a secas en una tabla que no está anotada como cerrada a propósito;
     · deja la lista de tablas abiertas distinta entre los .sql que la definen (el último que se corre gana).
   Para abrir una tabla: agregarla a ABIERTAS_CON_LA_LLAMADA y a la lista de solo_lo_suyo_en() (tipos-cuenta.sql y los deltas), y usar
   solo_lo_suyo_en('tabla') en su política. Para dejarla cerrada: anotarla en CERRADAS_A_PROPOSITO con el motivo. */

/** Las tablas que un closer con «ve los leads de todos» ve enteras. */
const ABIERTAS_CON_LA_LLAMADA = ["leads", "contactos", "sesiones", "comentarios", "chat_lecturas", "grabaciones", "precall_capturas"];

/** Las que siguen «sólo lo suyo» (o sólo para quien no es closer) aunque el closer vea los leads de todos, y por qué. */
const CERRADAS_A_PROPOSITO: Record<string, string> = {
  ventas: "plata: el closer ve sólo sus ventas",
  cuotas: "plata",
  pagos: "plata",
  devoluciones: "plata",
  resells: "cada closer trabaja los resells de sus alumnos",
  contratos: "cuelga de la venta, no de la llamada",
  alumnos: "el closer ve los alumnos de sus ventas",
  accesos_alumno: "servicio de sus alumnos",
  seguimiento_alumnos: "servicio de sus alumnos",
  actividad: "la rama de las ventas (las de leads, contactos y llamadas ya usan solo_lo_suyo_en)",
  vistas: "las vistas del equipo son de quien dirige",
  registros_webinar: "registros de los webinars: no es del closer",
  whatsapp_costos: "costos de WhatsApp: no es del closer",
  whatsapp_grupos: "grupos de WhatsApp: no es del closer",
  whatsapp_lector: "grupos de WhatsApp: no es del closer",
  whatsapp_miembros: "grupos de WhatsApp: no es del closer",
};

/** Funciones cuyo cuerpo usa solo_lo_suyo() a secas a propósito (plata, o la función de ayuda misma). */
const FUNCIONES_CERRADAS = new Set([
  "solo_lo_suyo_en", "control_cruzado_pagos", "cuotas_guarda_del_closer", "ventas_guarda_del_closer",
  "ventas_cambio_de_baja", "ventas_sin_baja_del_closer", "ventas_setter_de_la_agenda",
]);

const archivos = ["supabase", "sql"].flatMap((d) =>
  readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => ({ ruta: `${d}/${f}`, sql: sinComentarios(readFileSync(`${d}/${f}`, "utf8")) })));

function sinComentarios(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const sueltas = /solo_lo_suyo\(\)/;

test("las tablas abiertas son las mismas en todos los .sql que definen solo_lo_suyo_en()", () => {
  const listas = new Map<string, string[]>();
  for (const a of archivos) {
    for (const m of a.sql.matchAll(/\btabla in \(\s*('leads'[^)]*)\)/g)) listas.set(a.ruta, [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort());
  }
  assert.ok(listas.has("supabase/tipos-cuenta.sql") && listas.has("supabase/closer-ve-todos-los-leads.sql") && listas.has("supabase/closer-ve-las-grabaciones.sql"),
    `no encontré la lista en: ${[...listas.keys()].join(", ")}`);
  for (const [ruta, lista] of listas) assert.deepEqual(lista, [...ABIERTAS_CON_LA_LLAMADA].sort(), `la lista de ${ruta} no es la de las tablas abiertas`);
});

test("ninguna política de una tabla abierta usa solo_lo_suyo() a secas, y las de las cerradas son sólo las anotadas", () => {
  const abiertasQueSeCierran: string[] = [];
  const sinDecidir: string[] = [];
  for (const a of archivos) {
    for (const m of a.sql.matchAll(/(?:create|alter)\s+policy\s+(?:if not exists\s+)?"?\w+"?\s+on\s+(?:public\.)?"?(\w+)"?([\s\S]*?);/gi)) {
      if (!sueltas.test(m[2])) continue;
      const tabla = m[1];
      if (ABIERTAS_CON_LA_LLAMADA.includes(tabla)) abiertasQueSeCierran.push(`${tabla} (${a.ruta})`);
      else if (!(tabla in CERRADAS_A_PROPOSITO)) sinDecidir.push(`${tabla} (${a.ruta})`);
    }
  }
  assert.deepEqual(abiertasQueSeCierran, [], "estas tablas se abren con la llamada: su política tiene que usar solo_lo_suyo_en('tabla')");
  assert.deepEqual(sinDecidir, [], "política con solo_lo_suyo() a secas en una tabla que nadie decidió: ¿se abre con la llamada (ABIERTAS_CON_LA_LLAMADA y solo_lo_suyo_en) o queda cerrada a propósito (CERRADAS_A_PROPOSITO)?");
});

test("las funciones con solo_lo_suyo() a secas son las anotadas (plata o la ayuda misma): precall_puede ya no", () => {
  const nuevas: string[] = [];
  for (const a of archivos) {
    for (const m of a.sql.matchAll(/create\s+(?:or replace\s+)?function\s+(?:public\.)?(\w+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi)) {
      if (sueltas.test(m[3]) && !FUNCIONES_CERRADAS.has(m[1])) nuevas.push(`${m[1]} (${a.ruta})`);
    }
  }
  assert.deepEqual(nuevas, [], "función nueva con solo_lo_suyo() a secas: ¿corta el acceso de una tabla que se abre con la llamada? usá solo_lo_suyo_en('tabla')");
});

test("toda tabla que cuelga de una llamada (\"sesionId\") está anotada como abierta o como cerrada", () => {
  const cuelgan = new Set<string>();
  for (const a of archivos) {
    for (const m of a.sql.matchAll(/create\s+table\s+(?:if not exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi)) {
      if (/"sesionId"/.test(m[2])) cuelgan.add(m[1]);
    }
    for (const m of a.sql.matchAll(/alter\s+table\s+(?:if exists\s+)?(?:public\.)?"?(\w+)"?\s+add\s+column\s+(?:if not exists\s+)?"sesionId"/gi)) cuelgan.add(m[1]);
  }
  assert.ok(cuelgan.has("grabaciones") && cuelgan.has("precall_capturas") && cuelgan.has("ventas"), `la búsqueda no encontró las conocidas: ${[...cuelgan].join(", ")}`);
  const sinAnotar = [...cuelgan].filter((t) => !ABIERTAS_CON_LA_LLAMADA.includes(t) && !(t in CERRADAS_A_PROPOSITO)).sort();
  assert.deepEqual(sinAnotar, [], "tabla que cuelga de una llamada sin decidir: ¿un closer con «ve los leads de todos» la ve con la llamada, o es plata/ajena?");
});
