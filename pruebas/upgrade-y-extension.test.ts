import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";
import { baseEnMemoria, conServiciosFalsos, type Fila } from "./ayudas-accesos";
import { darAccesos, idDeAcceso, marcasDeLaFicha } from "@/lib/accesos-servidor";
import { fichaAlFirmar } from "@/lib/contratos";
import { modeloDeBienvenida } from "@/lib/bienvenida-alumno";
import {
  PROGRAMAS_POR_DEFECTO, claveDeCorte, esProgramaDeExtension, esProgramaDownsell, programaDeProducto, programaNormal, sumarMeses, type Programa,
} from "@/lib/programas";

/* 13/11: Manuel pidió que «subirse» a la mentoría sea automático: del Plus+ al programa completo (US$ 1.500) y del MID a 2 meses más de mentoría
   grupal (US$ 1.000 de una). Lo primero es el programa completo de siempre (darAccesos da lo que falta y le levanta el corte); lo segundo es un
   programa de extensión que SUMA tiempo al corte que la persona ya tiene. */

const IT = "PRO-it", AI = "PRO-ai";
const GENERAL = "-1004341505711", NOVEDADES = "-1004338558206", BOLSA = "-1004492115716";
const persona = { nombre: "Ana Prueba", email: "ana@x.com" };

const EXTENSION: Programa = {
  id: "hackear-ia-mid-extension", nombre: "Hackear IA MID · extensión", productos: ["prod_extension_mid"], plantillaId: "", plantillaNombre: "",
  wisboo: [], telegram: [GENERAL, NOVEDADES], zoom: [], bonos: [], activo: true, sumaTiempo: true,
  vencen: { [claveDeCorte("telegram", GENERAL)]: 2, [claveDeCorte("telegram", NOVEDADES)]: 2 },
};
const COMPLETO: Programa = {
  id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_hackear_ai", "prod_upgrade_mentoria"], plantillaId: "", plantillaNombre: "",
  wisboo: [IT, AI], telegram: [GENERAL, NOVEDADES, BOLSA], zoom: [], bonos: [], activo: true,
};

const fila = (alumnoId: string, plataforma: string, recurso: string, nombre: string, estado: string, venceEn: string | null, programa: string): Fila => ({
  id: idDeAcceso(alumnoId, plataforma as "telegram", recurso), alumnoId, plataforma, recurso, recursoNombre: nombre, estado, programa, venceEn, externo: {}, error: null,
});
const de = (tablas: Record<string, Fila[]>, plataforma: string, recurso: string) => tablas.accesos_alumno.find((f) => f.plataforma === plataforma && f.recurso === recurso)!;
const diasDesdeHoy = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const cerca = (a: unknown, b: string, msg: string) => assert.ok(typeof a === "string" && Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000, `${msg}: ${String(a)} ≠ ${b}`);

/* ---------- la extensión del MID: suma tiempo ---------- */

test("extensión del MID: a quien todavía tiene la mentoría se le SUMAN 2 meses a su corte (no se vuelve a dar ni se cuenta desde hoy)", async () => {
  const venceAntes = diasDesdeHoy(10);
  const { db, tablas } = baseEnMemoria({
    accesos_alumno: [
      fila("alu_1", "telegram", GENERAL, "General", "entro", venceAntes, "hackear-ia-mid"),
      fila("alu_1", "telegram", NOVEDADES, "Novedades - Mentoría", "dado", venceAntes, "hackear-ia-mid"),
      fila("alu_1", "wisboo", IT, "Mentoría (Hackear IT)", "dado", null, "hackear-ia-mid"),
    ],
  });
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_ext", persona, programa: EXTENSION, origen: "automatico", quien: "t" }));
  assert.equal(r.extendidos, 2);
  assert.equal(r.yaEstaban, 2, "los dos grupos ya los tenía");
  assert.equal(r.dados, 0, "no se le da nada de nuevo");
  cerca(de(tablas, "telegram", GENERAL).venceEn, sumarMeses(venceAntes, 2), "General: su corte + 2 meses");
  cerca(de(tablas, "telegram", NOVEDADES).venceEn, sumarMeses(venceAntes, 2), "Novedades: su corte + 2 meses");
  assert.equal(de(tablas, "telegram", GENERAL).estado, "entro", "sigue adentro del grupo");
  assert.deepEqual((de(tablas, "telegram", GENERAL).externo as Fila).extendidoPor, ["ctr_ext"]);
  assert.equal(de(tablas, "wisboo", IT).venceEn, null, "el contenido de Wisboo no se toca");
});

test("extensión: el mismo contrato no suma dos veces («Dar los accesos» otra vez, o la pasada de cada hora)", async () => {
  const venceAntes = diasDesdeHoy(10);
  const { db, tablas } = baseEnMemoria({ accesos_alumno: [fila("alu_1", "telegram", GENERAL, "General", "entro", venceAntes, "hackear-ia-mid"), fila("alu_1", "telegram", NOVEDADES, "Novedades - Mentoría", "dado", venceAntes, "hackear-ia-mid")] });
  const dar = (contratoId: string) => conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId, persona, programa: EXTENSION, origen: "manual", quien: "t" }));
  await dar("ctr_ext");
  const una = de(tablas, "telegram", GENERAL).venceEn;
  const otra = await dar("ctr_ext");
  assert.equal(otra.extendidos, 0);
  assert.equal(de(tablas, "telegram", GENERAL).venceEn, una, "igual que después de la primera");
  /* Otro contrato de extensión, otra compra: ése sí suma. */
  await dar("ctr_ext_2");
  cerca(de(tablas, "telegram", GENERAL).venceEn, sumarMeses(String(una), 2), "una segunda extensión suma otros 2 meses");
  assert.deepEqual((de(tablas, "telegram", GENERAL).externo as Fila).extendidoPor, ["ctr_ext", "ctr_ext_2"]);
});

test("extensión: a quien ya perdió la mentoría se le vuelve a dar por 2 meses desde hoy", async () => {
  const { db, tablas } = baseEnMemoria({
    accesos_alumno: [
      fila("alu_1", "telegram", GENERAL, "General", "quitado", diasDesdeHoy(-20), "hackear-ia-mid"),
      fila("alu_1", "telegram", NOVEDADES, "Novedades - Mentoría", "quitado", diasDesdeHoy(-20), "hackear-ia-mid"),
    ],
  });
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_ext", persona, programa: EXTENSION, origen: "automatico", quien: "t" }));
  assert.equal(r.dados, 2);
  assert.equal(r.extendidos, 0, "no había nada vigente que extender");
  for (const g of [GENERAL, NOVEDADES]) {
    assert.equal(de(tablas, "telegram", g).estado, "dado", "con su link nuevo");
    cerca(de(tablas, "telegram", g).venceEn, sumarMeses(new Date(), 2), `${g}: 2 meses desde hoy`);
  }
});

test("extensión: quien ya cursa el programa completo (sin corte) la compra y no pasa nada raro: lo suyo sigue sin corte", async () => {
  const { db, tablas } = baseEnMemoria({
    accesos_alumno: [fila("alu_1", "telegram", GENERAL, "General", "entro", null, "hackear-ai"), fila("alu_1", "telegram", NOVEDADES, "Novedades - Mentoría", "entro", null, "hackear-ai")],
  });
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_ext", persona, programa: EXTENSION, origen: "automatico", quien: "t" }));
  assert.equal(r.extendidos, 0);
  assert.equal(de(tablas, "telegram", GENERAL).venceEn, null, "sigue sin vencer");
});

test("extensión dada a mano desde la ficha (sin contrato): da lo que falta pero no suma tiempo a lo que ya tiene", async () => {
  const venceAntes = diasDesdeHoy(10);
  const { db, tablas } = baseEnMemoria({ accesos_alumno: [fila("alu_1", "telegram", GENERAL, "General", "entro", venceAntes, "hackear-ia-mid")] });
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", persona, programa: EXTENSION, origen: "manual", quien: "t" }));
  assert.equal(r.extendidos, 0);
  assert.equal(de(tablas, "telegram", GENERAL).venceEn, venceAntes, "su corte no cambió");
  assert.ok(de(tablas, "telegram", NOVEDADES), "pero el grupo que le faltaba sí se le dio");
});

test("extensión: si el servicio arranca más adelante, lo ya vencido cuenta los 2 meses desde el inicio", async () => {
  const inicio = diasDesdeHoy(15);
  const { db, tablas } = baseEnMemoria({ accesos_alumno: [fila("alu_1", "telegram", GENERAL, "General", "quitado", diasDesdeHoy(-5), "hackear-ia-mid")] });
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_ext", persona, programa: { ...EXTENSION, telegram: [GENERAL] }, origen: "automatico", quien: "t", desde: inicio }));
  cerca(de(tablas, "telegram", GENERAL).venceEn, sumarMeses(inicio, 2), "2 meses desde el inicio");
});

/* ---------- Plus+ → programa completo ---------- */

test("Plus+ → mentoría (US$ 1.500): se le da lo que le faltaba, lo que tenía queda como estaba y la ficha pasa a «Completos»", async () => {
  const { db, tablas } = baseEnMemoria({
    accesos_alumno: [
      fila("alu_1", "wisboo", IT, "Mentoría (Hackear IT)", "dado", null, "downsell-plus"),
      fila("alu_1", "wisboo", AI, "Mentoría (Hackear AI)", "dado", null, "downsell-plus"),
      fila("alu_1", "telegram", BOLSA, "Bolsa de trabajo", "entro", null, "downsell-plus"),
    ],
  });
  const antes = marcasDeLaFicha(tablas.accesos_alumno as never);
  assert.equal(antes.acceso, "Downsell");
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_up", persona, programa: COMPLETO, origen: "automatico", quien: "t" }));
  assert.equal(r.fallaron, 0);
  assert.equal(r.yaEstaban, 3, "Wisboo (2) y la bolsa de trabajo ya los tenía");
  assert.equal(r.dados, 2, "General y Novedades son lo que le faltaba");
  assert.equal(de(tablas, "telegram", BOLSA).estado, "entro", "no se le toca el grupo donde ya estaba");
  assert.equal(marcasDeLaFicha(tablas.accesos_alumno as never).acceso, "Completos");
});

/* ---------- los programas, los productos y la ficha ---------- */

test("los programas de fábrica: «Upgrade a mentoría» va al programa completo y la extensión es un programa que suma tiempo", () => {
  const completo = PROGRAMAS_POR_DEFECTO.find((p) => p.id === "hackear-ai")!;
  assert.ok(completo.productos.includes("prod_upgrade_mentoria"));
  assert.equal(programaDeProducto(PROGRAMAS_POR_DEFECTO, "prod_upgrade_mentoria")?.id, "hackear-ai");
  const ext = PROGRAMAS_POR_DEFECTO.find((p) => p.id === "hackear-ia-mid-extension")!;
  assert.equal(ext.sumaTiempo, true);
  assert.deepEqual(ext.wisboo, []);
  assert.equal(programaDeProducto(PROGRAMAS_POR_DEFECTO, "prod_extension_mid")?.id, "hackear-ia-mid-extension");
  assert.equal(programaNormal({ ...EXTENSION })!.sumaTiempo, true);
  assert.equal(programaNormal({ id: "x", nombre: "X", sumaTiempo: "si" })!.sumaTiempo, false, "sólo un true de verdad");
  assert.equal(programaNormal({ id: "x", nombre: "X" })!.sumaTiempo, false);
  assert.equal(esProgramaDeExtension("hackear-ia-mid-extension"), true);
  assert.equal(esProgramaDeExtension("hackear-ia-mid") || esProgramaDeExtension("hackear-ai") || esProgramaDeExtension(null), false);
  assert.equal(esProgramaDownsell("hackear-ia-mid-extension"), true, "para la ficha es un downsell: no es el programa completo");
});

test("la extensión no manda mail de bienvenida ni pide el perfil: la persona ya los tuvo", () => {
  assert.equal(modeloDeBienvenida({ programa: "hackear-ia-mid-extension" }), null);
  assert.equal(modeloDeBienvenida({ programa: "hackear-ia-mid" }), "downsell");
  assert.equal(modeloDeBienvenida({ programa: "hackear-ai" }), "completo");
});

test("la ficha al firmar: quien sube de un downsell al programa completo suma el programa; lo demás queda igual", () => {
  assert.deepEqual(fichaAlFirmar({}, "Hackear AI", ["Downsell Plus+"]).programas, ["Downsell Plus+", "Hackear AI"], "Plus+ → mentoría");
  assert.deepEqual(fichaAlFirmar({}, "Hackear AI", ["Hackear IA MID"]).programas, ["Hackear IA MID", "Hackear AI"], "MID → mentoría");
  assert.deepEqual(fichaAlFirmar({}, "Hackear AI", ["Downsell Plus+", "Hackear AI"]).programas, undefined, "ya lo tiene: no se repite");
  assert.deepEqual(fichaAlFirmar({}, "Hackear AI", []).programas, ["Hackear AI"], "sin programa cargado, el del contrato (como siempre)");
  assert.equal(fichaAlFirmar({}, "Hackear AI", ["Hackear Biz"]).programas, undefined, "un Biz que compra IA lo carga Lili (no se toca)");
  assert.equal(fichaAlFirmar({}, "Hackear IA MID · extensión", ["Hackear IA MID"]).programas, undefined, "la extensión no agrega programa");
  assert.equal(fichaAlFirmar({}, "Downsell Plus+", ["Downsell"]).programas, undefined, "de un downsell a otro no se agrega");
  assert.equal(fichaAlFirmar({}, "Hackear AI", ["Downsell"]).contratoFirmado, "Firmado");
});

test("al firmar la extensión no se mueve el inicio del alumno ni se manda a otro lado: el código lo dice", () => {
  const f = readFileSync(new URL("../src/lib/contratos-servidor.ts", import.meta.url), "utf8");
  assert.match(f, /if \(inicio && !delPrograma\?\.sumaTiempo\) await db\.from\("alumnos"\)\.update\(\{ inicio \}\)/);
  assert.match(f, /extendidos: r\.extendidos/);
});

/* ---------- la migración, en un Postgres de verdad ---------- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

const VIEJA = "7uUS5z4i2f3FAPXwuNHkUC";
const MID_DE_PRODUCCION = {
  id: "hackear-ia-mid", nombre: "Hackear IA MID", productos: ["prod_hackear_ia_mid"], plantillaId: VIEJA, plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX",
  wisboo: [IT, AI], telegram: [GENERAL, "-1004393795361", NOVEDADES, "-1003990857017"], zoom: ["84681899646", "84967094264", "83449857065"], bonos: [],
  vencen: {
    [`telegram:${GENERAL}`]: 1, "telegram:-1004393795361": 1, [`telegram:${NOVEDADES}`]: 1, "telegram:-1003990857017": 1,
    "zoom:84681899646": 1, "zoom:84967094264": 1, "zoom:83449857065": 1,
  },
  activo: true,
};
/* Los programas guardados después de downsells-y-cortes.sql (12/11). */
const PROGRAMAS_DE_ANTES = [
  { id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_hackear_ai", "prod_upgrade_ai"], plantillaId: "u8", plantillaNombre: "Mentoría", wisboo: [IT, AI], telegram: [GENERAL], zoom: [], bonos: [], activo: true },
  { id: "downsell", nombre: "Downsell", productos: ["prod_downsell"], plantillaId: VIEJA, plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX", wisboo: [IT, AI], telegram: [], zoom: [], bonos: [], activo: true },
  { id: "downsell-plus", nombre: "Downsell Plus+", productos: ["prod_downsell_plus"], plantillaId: VIEJA, plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX", wisboo: [IT, AI], telegram: [BOLSA], zoom: [], bonos: [], activo: true },
  MID_DE_PRODUCCION,
];

async function banco(programas: unknown = PROGRAMAS_DE_ANTES): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec(`
    create table public.productos (id text primary key, nombre text not null, "precioLista" numeric not null default 0, tipo text not null, activo boolean not null default true, orden integer not null default 0);
    alter table public.ajustes alter column id type smallint using 1;
    alter table public.ajustes add column programas jsonb;
    insert into public.productos (id, nombre, "precioLista", tipo, orden) values ('prod_downsell', 'Downsell', 497, 'downsell', 7), ('prod_hackear_ia_mid', 'Hackear IA MID', 1497, 'downsell', 16);
  `);
  await db.query(`insert into public.ajustes (id, programas) values (1, $1::jsonb)`, [JSON.stringify(programas)]);
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}
const leer = async (b: Banco) => (await b.servicio<{ programas: Programa[] }>(`select programas from public.ajustes where id = 1`))[0].programas;

test("migración: plantillas nuevas, «Upgrade a mentoría» en el programa completo y la extensión del MID con sus 7 cortes de 2 meses", { skip: saltear }, async () => {
  const b = await banco();
  const sql = sqlDe("upgrade-y-extension.sql");
  await b.ejecutar(sql);
  await b.ejecutar(sql); // dos veces: no duplica nada
  const programas = await leer(b);
  assert.deepEqual(programas.map((p) => p.id), ["hackear-ai", "downsell", "downsell-plus", "hackear-ia-mid", "hackear-ia-mid-extension"]);
  const por = (id: string) => programas.find((p) => p.id === id)!;
  assert.equal(por("downsell").plantillaId, "NpaqVwphyLkLP4WFB2226W");
  assert.equal(por("downsell-plus").plantillaId, "YafMsyG856QgbFmZKrghQR");
  assert.equal(por("hackear-ia-mid").plantillaId, "44j8yGqtQymeNs2pGbocqV");
  assert.match(por("hackear-ia-mid").plantillaNombre, /MID/);
  assert.deepEqual(por("hackear-ai").productos, ["prod_hackear_ai", "prod_upgrade_ai", "prod_upgrade_mentoria"], "el upgrade se suma, una sola vez");
  assert.equal(por("hackear-ai").plantillaId, "u8", "el programa completo no cambia de contrato");

  const ext = por("hackear-ia-mid-extension");
  assert.equal(ext.plantillaId, "46sU6pEnUQFf86XmmmHbrU");
  assert.deepEqual(ext.productos, ["prod_extension_mid"]);
  assert.equal(ext.sumaTiempo, true);
  assert.deepEqual(ext.wisboo, [], "el contenido no se vuelve a dar ni se corta");
  assert.deepEqual(ext.telegram, MID_DE_PRODUCCION.telegram, "los mismos grupos que el MID");
  assert.deepEqual(ext.zoom, MID_DE_PRODUCCION.zoom, "y las mismas reuniones");
  const normal = programaNormal(ext)!;
  assert.equal(Object.keys(normal.vencen ?? {}).length, 7);
  for (const n of Object.values(normal.vencen ?? {})) assert.equal(n, 2);
  assert.ok(!Object.keys(normal.vencen ?? {}).some((k) => k.startsWith("wisboo:")));

  const prod = await b.servicio<{ id: string; precio: string; tipo: string }>(`select id, "precioLista"::text as precio, tipo from public.productos where id in ('prod_upgrade_mentoria','prod_extension_mid') order by id`);
  assert.deepEqual(prod.map((p) => [p.id, Number(p.precio), p.tipo]), [["prod_extension_mid", 1000, "upsell"], ["prod_upgrade_mentoria", 1500, "upsell"]]);

  const respaldo = await b.servicio<{ programas: Programa[] }>(`select programas from respaldo.ajustes_programas_1311`);
  assert.equal(respaldo.length, 1, "el respaldo se guarda una sola vez");
  assert.deepEqual(respaldo[0].programas, PROGRAMAS_DE_ANTES, "y es el de antes");
});

test("migración: una plantilla que alguien eligió a mano no se pisa, y si los grupos del MID cambiaron la extensión los sigue", { skip: saltear }, async () => {
  const propios = [
    PROGRAMAS_DE_ANTES[0],
    { ...PROGRAMAS_DE_ANTES[1], plantillaId: "mia", plantillaNombre: "La mía" },
    PROGRAMAS_DE_ANTES[2],
    { ...MID_DE_PRODUCCION, telegram: [GENERAL], zoom: [], vencen: { [`telegram:${GENERAL}`]: 1, [`wisboo:${IT}`]: 3 } },
  ];
  const b = await banco(propios);
  await b.ejecutar(sqlDe("upgrade-y-extension.sql"));
  const programas = await leer(b);
  const por = (id: string) => programas.find((p) => p.id === id)!;
  assert.equal(por("downsell").plantillaId, "mia", "no se pisa lo elegido a mano");
  assert.equal(por("downsell-plus").plantillaId, "YafMsyG856QgbFmZKrghQR");
  const ext = por("hackear-ia-mid-extension");
  assert.deepEqual(ext.telegram, [GENERAL]);
  assert.deepEqual(ext.zoom, []);
  assert.deepEqual(ext.vencen, { [`telegram:${GENERAL}`]: 2 }, "sólo los cortes de mentoría: el de Wisboo del MID no pasa a la extensión");
});

test("migración: sin el programa del MID avisa y no inventa la extensión; sin lista guardada no toca nada", { skip: saltear }, async () => {
  const sinMid = await banco(PROGRAMAS_DE_ANTES.slice(0, 3));
  await sinMid.ejecutar(sqlDe("upgrade-y-extension.sql"));
  assert.ok(!(await leer(sinMid)).some((p) => p.id === "hackear-ia-mid-extension"));
  const sinLista = await banco(null);
  await assert.rejects(() => sinLista.ejecutar(sqlDe("upgrade-y-extension.sql")), /ajustes\.programas no está guardado como lista/);
});
