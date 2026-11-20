import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PARECIDO_MINIMO, buscarPorTelefono, claveDeContacto, elUnicoActivo, enlaceDelBot, etiquetaDePersona, leerInicio, mensajeParaVerificar,
  nombreEnTelegram, parecidoDeNombres, sugerirAlumnos, sugerirCuentas, telefonosDeFila, type PersonaTelegram, type TelefonosDeAlumno,
} from "@/lib/telegram-identidades";
import {
  anunciarEnLosGrupos, atarPersona, completarNombresDeCuentas, atenderPrivado, desatarPersona, olvidarTelefonos, olvidarVistas, programaDelGrupo, resumenDeIdentificacion,
  telefonosDeAlumnos, verPersona, type LlamarTelegram,
} from "@/lib/telegram-identidades-servidor";
import { quitarAccesos } from "@/lib/accesos-servidor";
import { pasarOutboardings } from "@/lib/outboarding-servidor";
import type { Programa } from "@/lib/programas";
import { conServiciosFalsos } from "./ayudas-accesos";

/* Manu (20/11): «tenemos alumnos viejos que tenemos que expulsar, pero en Telegram cuesta identificarlos». El bot ve a cada cuenta,
   y la ata a su alumno cuando entra con su link personal, comparte su número o lo ata el equipo. Al atarla, sus grupos pasan a los
   accesos con su id: «Quitar» y el outboarding la sacan también si era de antes de la app. */

/* ---------- Una base en memoria con lo que usa este módulo ---------- */

type Fila = Record<string, unknown>;

function base(inicial: Record<string, Fila[]> = {}, rpcs: Record<string, Fila[]> = {}) {
  const tablas: Record<string, Fila[]> = Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, v.map((f) => ({ ...f }))]));
  const escrituras: { tabla: string; tipo: string }[] = [];
  const constructor = (filasDe: () => Fila[], tabla: string) => {
    let filtros: ((f: Fila) => boolean)[] = [];
    let rango: [number, number] | null = null;
    let limite: number | null = null;
    let modo: "leer" | "cambiar" | "borrar" = "leer";
    let cambios: Fila = {};
    const elegidas = () => filasDe().filter((f) => filtros.every((x) => x(f)));
    const ejecutar = (): { data: Fila[]; error: null } => {
      const sel = elegidas();
      if (modo === "cambiar") { escrituras.push({ tabla, tipo: "update" }); for (const f of sel) Object.assign(f, cambios); return { data: sel, error: null }; }
      if (modo === "borrar") { escrituras.push({ tabla, tipo: "delete" }); const todas = filasDe(); for (const f of sel) todas.splice(todas.indexOf(f), 1); return { data: sel, error: null }; }
      let salida = sel;
      if (rango) salida = salida.slice(rango[0], rango[1] + 1);
      if (limite !== null) salida = salida.slice(0, limite);
      return { data: salida.map((f) => ({ ...f })), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q; },
      or: () => q,
      order: () => q,
      limit: (n: number) => { limite = n; return q; },
      range: (d: number, h: number) => { rango = [d, h]; return q; },
      update: (c: Fila) => { modo = "cambiar"; cambios = c; return q; },
      delete: () => { modo = "borrar"; return q; },
      upsert: async (v: Fila | Fila[], op?: { onConflict?: string }) => {
        const clave = op?.onConflict ?? "id";
        const todas = filasDe();
        escrituras.push({ tabla, tipo: "upsert" });
        for (const r of Array.isArray(v) ? v : [v]) {
          const i = todas.findIndex((f) => f[clave] === r[clave]);
          if (i >= 0) Object.assign(todas[i], r); else todas.push({ ...r });
        }
        return { error: null };
      },
      maybeSingle: async () => ({ data: ejecutar().data[0] ?? null, error: null }),
      then: (ok: (r: { data: Fila[]; error: null }) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, mal),
    };
    return q;
  };
  const db = {
    from: (tabla: string) => constructor(() => (tablas[tabla] ??= []), tabla),
    rpc: (nombre: string) => constructor(() => rpcs[nombre] ?? [], `rpc:${nombre}`),
  };
  return { db: db as unknown as SupabaseClient, tablas, escrituras };
}

/* ---------- Un Telegram de mentira ---------- */

function telegramFalso(miembros: Record<string, string> = {}) {
  const llamados: { metodo: string; cuerpo: Record<string, unknown> }[] = [];
  const tg: LlamarTelegram = async (metodo, cuerpo = {}) => {
    llamados.push({ metodo, cuerpo });
    if (metodo === "getChatMember") {
      const estado = miembros[`${cuerpo.chat_id}:${cuerpo.user_id}`];
      return estado ? { ok: true, result: { status: estado } } : { ok: true, result: { status: "left" } };
    }
    if (metodo === "getMe") return { ok: true, result: { id: 1, username: "ApicantaBot" } };
    return { ok: true, result: {} };
  };
  return { tg, llamados, de: (metodo: string) => llamados.filter((l) => l.metodo === metodo) };
}

beforeEach(() => { olvidarVistas(); olvidarTelefonos(); });

const GENERAL = "-1001000000001", NOVEDADES = "-1001000000002", BOLSA = "-1001000000003";
const grupos = [
  { chatId: GENERAL, titulo: "General", botEsAdmin: true }, { chatId: NOVEDADES, titulo: "Novedades - Mentoría", botEsAdmin: true },
  { chatId: BOLSA, titulo: "Bolsa de trabajo", botEsAdmin: true }, { chatId: "-1001000000009", titulo: "Sin permisos", botEsAdmin: false },
];
const programa = (id: string, chats: string[], productos: string[] = []): Programa => ({
  id, nombre: id, productos, plantillaId: "", plantillaNombre: "", wisboo: [], telegram: chats, zoom: [], bonos: [], activo: true,
});

/* ---------- Puro ---------- */

test("el nombre de Telegram, y cómo se muestra una cuenta", () => {
  assert.equal(nombreEnTelegram({ first_name: " Juan ", last_name: "Pérez" }), "Juan Pérez");
  assert.equal(nombreEnTelegram({ first_name: "Cris" }), "Cris");
  assert.equal(nombreEnTelegram(undefined), "");
  assert.equal(etiquetaDePersona({ id: "1", nombre: "Juan", usuario: "jp" }), "Juan (@jp)");
  assert.equal(etiquetaDePersona({ id: "1", nombre: "", usuario: "jp" }), "@jp");
  assert.equal(etiquetaDePersona({ id: "7", nombre: "", usuario: null }), "Cuenta 7");
});

test("el parecido de nombres: el apellido pesa igual que el nombre, y el @usuario cuenta", () => {
  const p = (nombre: string, usuario: string | null = null) => ({ nombre, usuario });
  assert.equal(parecidoDeNombres(p("Juan Pérez"), "Juan Perez"), 1, "sin tildes ni mayúsculas");
  assert.equal(parecidoDeNombres(p("JUAN 🚀 PEREZ"), "Juan Pérez"), 1, "con emojis");
  assert.ok(parecidoDeNombres(p("Juan"), "Juan Pérez") < PARECIDO_MINIMO + 0.01, "sólo el nombre no alcanza");
  assert.ok(parecidoDeNombres(p("Juancho Pérez"), "Juan Pérez") >= 0.85, "Juancho ~ Juan");
  assert.ok(parecidoDeNombres(p("Dev", "juanperez88"), "Juan Pérez") >= 0.8, "el @usuario trae el nombre");
  assert.equal(parecidoDeNombres(p("Carlos Gómez"), "Juan Pérez"), 0);
  assert.equal(parecidoDeNombres(p("Juan"), ""), 0);
  assert.equal(parecidoDeNombres(p("de la Cruz"), "María de la Cruz") < 1, true, "«de la» no cuenta como palabra");
});

test("sugerir: ordena de mayor a menor y deja afuera lo que no se parece", () => {
  const alumnos = [{ nombre: "Juan Pérez" }, { nombre: "Juana Pérez" }, { nombre: "Carlos Gómez" }, { nombre: "Pedro Juan" }];
  const r = sugerirAlumnos({ nombre: "Juan Perez", usuario: null }, alumnos);
  assert.equal(r[0].alumno.nombre, "Juan Pérez");
  assert.ok(!r.some((x) => x.alumno.nombre === "Carlos Gómez"));
  const cuentas = [
    { id: "1", nombre: "Carlos", usuario: null }, { id: "2", nombre: "Juan Pérez", usuario: null }, { id: "3", nombre: "J", usuario: "juanperez" },
  ] as PersonaTelegram[];
  assert.deepEqual(sugerirCuentas("Juan Pérez", cuentas).map((x) => x.persona.id), ["2", "3"]);
});

test("el teléfono que comparte el bot se cruza con cómo está escrito en las fichas", () => {
  assert.equal(claveDeContacto("5491155556666"), "5491155556666");
  assert.equal(claveDeContacto("+54 9 11 5555-6666"), "5491155556666");
  assert.equal(claveDeContacto(""), null);
  const fila = (alumnoId: string, telefonos: string[], estado = "activo", pais = "Argentina") => telefonosDeFila({ alumnoId, nombre: alumnoId, estado, pais, telefonos });
  const alumnos = [
    fila("a_mas", ["+54 9 11 5555-6666"]), fila("a_cero15", ["011 15 5555-6666"]), fila("a_corto", ["11 5555 6666"]),
    fila("a_otro", ["11 4444 3333"]), fila("a_varios", ["11 4444 3333", "+54 9 11 5555-6666"]), fila("a_nada", []),
  ];
  const r = buscarPorTelefono("5491155556666", alumnos);
  assert.deepEqual(r.exactos.map((a) => a.alumnoId).sort(), ["a_cero15", "a_corto", "a_mas", "a_varios"], "las cuatro maneras de escribir el mismo celular");
  assert.deepEqual(r.aproximados, []);
  /* Sólo coinciden los últimos 8 dígitos (un código de país mal escrito): no se ata solo. */
  const flojo: TelefonosDeAlumno = { alumnoId: "a_flojo", nombre: "Flojo", estado: "activo", claves: ["5710000000"], colas: ["55556666"] };
  const r2 = buscarPorTelefono("5491155556666", [flojo, ...alumnos]);
  assert.deepEqual(r2.aproximados.map((a) => a.alumnoId), ["a_flojo"]);
  assert.equal(r2.exactos.includes(flojo), false);
  assert.deepEqual(buscarPorTelefono("123", alumnos), { exactos: [], aproximados: [] }, "un número corto no encuentra a nadie");
  /* Un celular mexicano con los mismos 10 dígitos que uno argentino no es el mismo número: no se ata solo, llega como aproximado. */
  const mx = buscarPorTelefono("525555556666", [fila("a_ar", ["55 5555 6666"], "activo", "Argentina"), fila("a_mx", ["55 5555 6666"], "activo", "México")]);
  assert.deepEqual(mx.exactos.map((a) => a.alumnoId), ["a_mx"], "sólo el de la ficha de México");
  assert.deepEqual(mx.aproximados.map((a) => a.alumnoId), ["a_ar"], "el de Argentina, a revisar");
});

test("con varios alumnos del mismo número, sólo se elige si uno solo cursa hoy", () => {
  const f = (id: string, estado: string): TelefonosDeAlumno => ({ alumnoId: id, nombre: id, estado, claves: [], colas: [] });
  assert.equal(elUnicoActivo([f("a", "activo"), f("b", "graduado")])?.alumnoId, "a");
  assert.equal(elUnicoActivo([f("a", "activo"), f("b", "activo")]), null);
  assert.equal(elUnicoActivo([f("a", "baja"), f("b", "graduado")]), null);
});

test("los links del bot: con el código del alumno o generales, y lo que llega con /start", () => {
  const codigo = "0b8c1f3e-9d2a-4b6e-8f10-3a5d7c9e1b24";
  assert.equal(enlaceDelBot("ApicantaBot", codigo), `https://t.me/ApicantaBot?start=c_${codigo}`);
  assert.equal(enlaceDelBot("@ApicantaBot"), "https://t.me/ApicantaBot?start=identificar");
  assert.equal(enlaceDelBot("ApicantaBot", "no-es-un-codigo"), "https://t.me/ApicantaBot?start=identificar");
  assert.ok(enlaceDelBot("ApicantaBot", codigo).split("start=")[1].length <= 64, "Telegram acepta hasta 64 caracteres");
  assert.deepEqual(leerInicio(`/start c_${codigo}`), { esInicio: true, codigo });
  assert.deepEqual(leerInicio(`/start@ApicantaBot c_${codigo.toUpperCase()}`), { esInicio: true, codigo });
  assert.deepEqual(leerInicio("/start identificar"), { esInicio: true, codigo: null });
  assert.deepEqual(leerInicio("/start"), { esInicio: true, codigo: null });
  assert.deepEqual(leerInicio("/start c_cualquiera"), { esInicio: true, codigo: null });
  assert.deepEqual(leerInicio("hola"), { esInicio: false, codigo: null });
  assert.deepEqual(leerInicio(undefined), { esInicio: false, codigo: null });
  const m = mensajeParaVerificar({ nombre: "ana lópez", enlace: "https://t.me/x?start=y" });
  assert.match(m, /^Hola Ana!/);
  assert.match(m, /https:\/\/t\.me\/x\?start=y/);
});

test("el grupo de un alumno que ya estaba adentro se anota con su programa", () => {
  const ia = programa("hackear-ai", [GENERAL, NOVEDADES, BOLSA]);
  const down = programa("downsell", [BOLSA]);
  assert.equal(programaDelGrupo([ia, down], down, BOLSA), "downsell", "el suyo, si ese grupo es de su programa");
  assert.equal(programaDelGrupo([ia, down], down, GENERAL), "hackear-ai", "el que tenga ese grupo");
  assert.equal(programaDelGrupo([ia, down], null, BOLSA), "hackear-ai");
  assert.equal(programaDelGrupo([ia, down], down, "-1001000000007"), "downsell", "ningún programa lo tiene: el del alumno");
  assert.equal(programaDelGrupo([ia], null, "-1001000000007"), "");
});

/* ---------- Ver a alguien ---------- */

test("verPersona: anota a quien escribe en un grupo, sin repetir y sin tomar por alumno a un administrador", async () => {
  const { db, tablas, escrituras } = base();
  const { tg, de } = telegramFalso({ [`${GENERAL}:10`]: "member", [`${GENERAL}:11`]: "administrator" });
  const ahora = new Date("2026-11-20T15:00:00Z");

  await verPersona(db, tg, { id: 10, first_name: "Juan", last_name: "Pérez", username: "jperez" }, { chatId: GENERAL, ahora });
  assert.equal(tablas.telegram_personas.length, 1);
  assert.deepEqual(
    { ...tablas.telegram_personas[0], grupos: Object.keys(tablas.telegram_personas[0].grupos as object) },
    { id: "10", usuario: "jperez", nombre: "Juan Pérez", grupos: [GENERAL], equipo: false, ultimoVisto: ahora.toISOString(), entroPor: "mensaje", primerVisto: ahora.toISOString() },
  );
  assert.equal(de("getChatMember").length, 1, "la primera vez mira si es administrador");

  /* Escribe otra vez a los 5 minutos: no se escribe nada. */
  const antes = escrituras.length;
  await verPersona(db, tg, { id: 10, first_name: "Juan", last_name: "Pérez" }, { chatId: GENERAL, ahora: new Date(ahora.getTime() + 5 * 60_000) });
  assert.equal(escrituras.length, antes);
  /* A las 7 horas sí, pero ya no pregunta si es administrador. */
  await verPersona(db, tg, { id: 10, first_name: "Juan", last_name: "Pérez" }, { chatId: GENERAL, ahora: new Date(ahora.getTime() + 7 * 3600_000) });
  assert.equal(escrituras.length, antes + 1);
  assert.equal(de("getChatMember").length, 1);

  await verPersona(db, tg, { id: 11, first_name: "Manu" }, { chatId: GENERAL, ahora });
  assert.equal(tablas.telegram_personas.find((p) => p.id === "11")?.equipo, true, "administra el grupo: no es alumno");

  /* Bots, Telegram y los admins anónimos no son personas. */
  await verPersona(db, tg, { id: 12, is_bot: true, first_name: "Otro bot" }, { chatId: GENERAL, ahora });
  await verPersona(db, tg, { id: 777000, first_name: "Telegram" }, { chatId: GENERAL, ahora });
  await verPersona(db, tg, { id: 1087968824, first_name: "Group" }, { chatId: GENERAL, ahora });
  assert.equal(tablas.telegram_personas.length, 2);
});

test("verPersona: al salir del grupo deja de figurar adentro, y cambiar de nombre la pone al día", async () => {
  const { db, tablas } = base();
  const { tg } = telegramFalso({ [`${GENERAL}:10`]: "member" });
  await verPersona(db, tg, { id: 10, first_name: "Juan" }, { chatId: GENERAL, entroPor: "otro" });
  await verPersona(db, tg, { id: 10, first_name: "Juan" }, { chatId: NOVEDADES, entroPor: "otro" });
  assert.deepEqual(Object.keys(tablas.telegram_personas[0].grupos as object).sort(), [GENERAL, NOVEDADES].sort());
  assert.equal(tablas.telegram_personas[0].entroPor, "otro");
  await verPersona(db, tg, { id: 10, first_name: "Juan" }, { chatId: GENERAL, adentro: false });
  assert.deepEqual(Object.keys(tablas.telegram_personas[0].grupos as object), [NOVEDADES]);
  await verPersona(db, tg, { id: 10, first_name: "Juan Pablo", username: "jp" }, { chatId: BOLSA });
  assert.equal(tablas.telegram_personas[0].nombre, "Juan Pablo");
  assert.equal(tablas.telegram_personas[0].usuario, "jp");
  assert.equal(tablas.telegram_personas[0].entroPor, "otro", "cómo se la vio la primera vez no cambia");
});

/* ---------- Atar ---------- */

const alumnosDe = (...ids: string[]) => ids.map((id) => ({ id, nombre: `Alumno ${id}`, ventaId: null }));

test("atarPersona: sus grupos pasan a los accesos con su id, y lo que ya existía se completa", async () => {
  const { db, tablas } = base({
    telegram_grupos: grupos, alumnos: alumnosDe("alu_1"),
    ajustes: [{ id: 1, programas: [programa("hackear-ai", [GENERAL, NOVEDADES]), programa("downsell", [BOLSA])] }],
    telegram_personas: [{ id: "10", usuario: "jp", nombre: "Juan", alumnoId: null, grupos: { [GENERAL]: "2026-11-01T00:00:00Z" }, equipo: false }],
    /* Le dieron un link a Novedades hace un mes y nadie vio que entrara. */
    accesos_alumno: [{ id: "acc_alu_1_telegram_novedades", alumnoId: "alu_1", plataforma: "telegram", recurso: NOVEDADES, recursoNombre: "Novedades", estado: "dado", externo: { link: "https://t.me/+abc" }, programa: "hackear-ai" }],
  });
  const { tg } = telegramFalso({ [`${NOVEDADES}:10`]: "member", [`${BOLSA}:10`]: "left" });
  const r = await atarPersona(db, tg, { personaId: "10", alumnoId: "alu_1", vinculo: "manual", quien: "equipo@ejemplo.com" });

  assert.deepEqual(r.grupos.map((g) => g.chatId).sort(), [GENERAL, NOVEDADES].sort(), "donde estaba, y los que el bot comprobó; Bolsa no, y el grupo sin permisos no se mira");
  const filas = tablas.accesos_alumno;
  assert.equal(filas.length, 2);
  const general = filas.find((f) => f.recurso === GENERAL)!;
  assert.equal(general.estado, "entro");
  assert.equal(general.programa, "hackear-ai");
  assert.equal(general.recursoNombre, "General");
  assert.equal(general.origen, "manual");
  assert.match(String(general.quien), /Identificación de Telegram \(equipo@ejemplo\.com\)/);
  assert.deepEqual(general.externo, { telegramUserId: 10, telegramUsuario: "jp", identificado: "manual", creadoPorIdentificacion: true });
  const novedades = filas.find((f) => f.recurso === NOVEDADES)!;
  assert.equal(novedades.estado, "entro", "el link que nadie vio usar queda confirmado");
  assert.deepEqual(novedades.externo, { link: "https://t.me/+abc", telegramUserId: 10, telegramUsuario: "jp", identificado: "manual" });
  assert.equal(novedades.id, "acc_alu_1_telegram_novedades", "no se duplica");
  const p = tablas.telegram_personas[0];
  assert.equal(p.alumnoId, "alu_1");
  assert.equal(p.vinculo, "manual");
  assert.equal(p.vinculadoPor, "equipo@ejemplo.com");
  assert.deepEqual(Object.keys(p.grupos as object).sort(), [GENERAL, NOVEDADES].sort());
  assert.equal(tablas.seguimiento_alumnos, undefined, "no toca la ficha de Customer Success");

  /* Atarla otra vez no cambia nada. */
  const antes = JSON.stringify(tablas.accesos_alumno);
  await atarPersona(db, tg, { personaId: "10", alumnoId: "alu_1", vinculo: "manual", quien: "equipo@ejemplo.com" });
  assert.equal(JSON.stringify(tablas.accesos_alumno), antes);
});

test("atarPersona: un alumno de un Downsell queda en el programa de su venta; sin cuenta o sin alumno, avisa", async () => {
  const { db, tablas } = base({
    telegram_grupos: grupos,
    alumnos: [{ id: "alu_d", nombre: "Dani", ventaId: "ven_1" }],
    ventas: [{ id: "ven_1", productoId: "prod_down" }],
    ajustes: [{ id: 1, programas: [programa("hackear-ai", [BOLSA], ["prod_ia"]), programa("downsell", [BOLSA], ["prod_down"])] }],
    telegram_personas: [{ id: "20", usuario: null, nombre: "Dani", alumnoId: null, grupos: { [BOLSA]: "x" }, equipo: false }],
  });
  const { tg } = telegramFalso();
  await atarPersona(db, tg, { personaId: "20", alumnoId: "alu_d", vinculo: "telefono", quien: "Bot" });
  assert.equal(tablas.accesos_alumno[0].programa, "downsell");
  await assert.rejects(atarPersona(db, tg, { personaId: "99", alumnoId: "alu_d", vinculo: "manual", quien: "x" }), /No encuentro esa cuenta/);
  await assert.rejects(atarPersona(db, tg, { personaId: "20", alumnoId: "alu_nadie", vinculo: "manual", quien: "x" }), /No encuentro a ese alumno/);
});

test("desatarPersona: lo que se creó al atarla se borra y lo que ya existía pierde el id (para no sacar a la persona equivocada)", async () => {
  const { db, tablas } = base({
    alumnos: alumnosDe("alu_1"),
    telegram_personas: [{ id: "10", alumnoId: "alu_1", vinculo: "manual", grupos: {} }],
    accesos_alumno: [
      { id: "a1", alumnoId: "alu_1", plataforma: "telegram", recurso: GENERAL, estado: "entro", externo: { telegramUserId: 10, telegramUsuario: "jp", identificado: "manual", creadoPorIdentificacion: true } },
      { id: "a2", alumnoId: "alu_1", plataforma: "telegram", recurso: NOVEDADES, estado: "entro", externo: { link: "https://t.me/+abc", telegramUserId: 10, identificado: "manual" } },
      { id: "a3", alumnoId: "alu_1", plataforma: "telegram", recurso: BOLSA, estado: "entro", externo: { telegramUserId: 77 } },
    ],
  });
  await desatarPersona(db, "10");
  assert.deepEqual(tablas.accesos_alumno.map((f) => f.id), ["a2", "a3"], "el creado al atar, borrado");
  assert.deepEqual(tablas.accesos_alumno[0].externo, { link: "https://t.me/+abc" });
  assert.equal(tablas.accesos_alumno[0].estado, "dado", "vuelve a ser un link que nadie vio usar");
  assert.deepEqual(tablas.accesos_alumno[1].externo, { telegramUserId: 77 }, "el de otra cuenta no se toca");
  assert.equal(tablas.telegram_personas[0].alumnoId, null);
  assert.equal(tablas.telegram_personas[0].vinculo, null);
  await assert.rejects(desatarPersona(db, "99"), /No encuentro esa cuenta/);
});

/* ---------- El chat del bot ---------- */

const CODIGO = "0b8c1f3e-9d2a-4b6e-8f10-3a5d7c9e1b24";
const mensaje = (extra: Record<string, unknown>) => ({ chat: { id: 555, type: "private" }, from: { id: 10, first_name: "Juan", username: "jp" }, ...extra });
const telefonos = (...f: Parameters<typeof telefonosDeFila>[0][]) => async () => f.map(telefonosDeFila);
const textoEnviado = (llamados: { metodo: string; cuerpo: Record<string, unknown> }[]) => String(llamados.filter((l) => l.metodo === "sendMessage").at(-1)?.cuerpo.text ?? "");
const tecladoEnviado = (llamados: { metodo: string; cuerpo: Record<string, unknown> }[]) => llamados.filter((l) => l.metodo === "sendMessage").at(-1)?.cuerpo.reply_markup as Record<string, unknown>;

function mundo(extra: Record<string, Fila[]> = {}) {
  return base({
    telegram_grupos: grupos, alumnos: [{ id: "alu_1", nombre: "Juan Pérez", ventaId: null }, { id: "alu_2", nombre: "Ana Gómez", ventaId: null }],
    ajustes: [{ id: 1, programas: [programa("hackear-ai", [GENERAL, NOVEDADES])] }], reporte_codigos: [{ alumnoId: "alu_1", codigo: CODIGO }], ...extra,
  });
}
const PEREZ = { alumnoId: "alu_1", nombre: "Juan Pérez", estado: "activo", pais: "Argentina", telefonos: ["+54 9 11 5555-6666"] };

test("el bot: «/start» sin nada pide el número con el botón de Telegram", async () => {
  const { db, tablas } = mundo();
  const { tg, llamados } = telegramFalso();
  assert.equal(await atenderPrivado(db, tg, mensaje({ text: "/start identificar" })), "pedir");
  assert.match(textoEnviado(llamados), /Compartir mi número/);
  assert.deepEqual(tecladoEnviado(llamados), { keyboard: [[{ text: "Compartir mi número", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
  assert.equal(tablas.telegram_personas[0].entroPor, "bot", "queda anotada aunque todavía no se sepa quién es");
  assert.equal(await atenderPrivado(db, tg, mensaje({ text: "hola" })), "ayuda");
  assert.equal((await atenderPrivado(db, tg, { chat: { id: 1 }, text: "/start" })), "ignorado", "sin remitente");
  assert.equal((await atenderPrivado(db, tg, mensaje({ from: { id: 9, is_bot: true }, text: "/start" }))), "ignorado");
});

test("el bot: el número compartido que coincide con una sola ficha ata la cuenta y deja sus grupos listos para sacarla", async () => {
  const { db, tablas } = mundo();
  const { tg, llamados } = telegramFalso({ [`${GENERAL}:10`]: "member", [`${NOVEDADES}:10`]: "member" });
  const r = await atenderPrivado(db, tg, mensaje({ contact: { phone_number: "5491155556666", user_id: 10, first_name: "Juan" } }), { telefonos: telefonos(PEREZ, { ...PEREZ, alumnoId: "alu_2", nombre: "Ana Gómez", telefonos: ["11 4444 3333"] }) });
  assert.equal(r, "telefono");
  assert.equal(tablas.telegram_personas[0].alumnoId, "alu_1");
  assert.equal(tablas.telegram_personas[0].vinculo, "telefono");
  assert.equal(tablas.telegram_personas[0].telefono, "5491155556666");
  assert.deepEqual(tablas.accesos_alumno.map((f) => f.recurso).sort(), [GENERAL, NOVEDADES].sort());
  assert.match(textoEnviado(llamados), /Listo, Juan! Tu cuenta de Telegram quedó verificada/);
  assert.deepEqual(tecladoEnviado(llamados), { remove_keyboard: true });

  /* Si vuelve a compartirlo: ya estaba. */
  assert.equal(await atenderPrivado(db, tg, mensaje({ contact: { phone_number: "5491155556666", user_id: 10 } }), { telefonos: telefonos(PEREZ) }), "ya");
  assert.match(textoEnviado(llamados), /ya estaba verificada/);
});

test("el bot: el contacto de otra persona no sirve (Telegram deja mandar el de cualquiera)", async () => {
  const { db, tablas } = mundo();
  const { tg, llamados } = telegramFalso();
  const r = await atenderPrivado(db, tg, mensaje({ contact: { phone_number: "5491155556666", user_id: 99, first_name: "Otro" } }), { telefonos: telefonos(PEREZ) });
  assert.equal(r, "ajeno");
  assert.equal(tablas.telegram_personas[0].alumnoId, undefined);
  assert.equal(tablas.telegram_personas[0].telefono, undefined, "tampoco se guarda su número");
  assert.match(textoEnviado(llamados), /no es el tuyo/);
});

test("el bot: dos fichas con el mismo número — se ata a la que cursa; si cursan las dos, lo decide una persona", async () => {
  const dos = [PEREZ, { ...PEREZ, alumnoId: "alu_2", nombre: "Juan Pérez (viejo)", estado: "graduado" }];
  const a = mundo();
  const ta = telegramFalso({ [`${GENERAL}:10`]: "member" });
  assert.equal(await atenderPrivado(a.db, ta.tg, mensaje({ contact: { phone_number: "5491155556666", user_id: 10 } }), { telefonos: telefonos(...dos) }), "telefono");
  assert.equal(a.tablas.telegram_personas[0].alumnoId, "alu_1");

  const b = mundo();
  const tb = telegramFalso();
  const cursan = [PEREZ, { ...PEREZ, alumnoId: "alu_2", nombre: "Juana Pérez" }];
  assert.equal(await atenderPrivado(b.db, tb.tg, mensaje({ contact: { phone_number: "5491155556666", user_id: 10 } }), { telefonos: telefonos(...cursan) }), "revisar");
  assert.equal(b.tablas.telegram_personas[0].alumnoId, undefined, "no se ata solo");
  assert.deepEqual(b.tablas.telegram_personas[0].posibles, [{ alumnoId: "alu_1", motivo: "varios" }, { alumnoId: "alu_2", motivo: "varios" }]);
  assert.equal(b.tablas.accesos_alumno, undefined);
  assert.match(textoEnviado(tb.llamados), /Lo revisa el equipo/);
});

test("el bot: si sólo coinciden los últimos dígitos no se ata solo, y si no está en ninguna ficha lo dice", async () => {
  const { db, tablas } = mundo();
  const { tg, llamados } = telegramFalso();
  const mal = { ...PEREZ, telefonos: ["+57 11 5555-6666"] };
  assert.equal(await atenderPrivado(db, tg, mensaje({ contact: { phone_number: "5491155556666", user_id: 10 } }), { telefonos: telefonos(mal) }), "revisar");
  assert.deepEqual(tablas.telegram_personas[0].posibles, [{ alumnoId: "alu_1", motivo: "ultimos-digitos" }]);
  assert.equal(tablas.telegram_personas[0].alumnoId, undefined);

  const otra = mundo();
  const t2 = telegramFalso();
  assert.equal(await atenderPrivado(otra.db, t2.tg, mensaje({ contact: { phone_number: "5491100000000", user_id: 10 } }), { telefonos: telefonos(PEREZ) }), "no-encontrado");
  assert.match(textoEnviado(t2.llamados), /no lo encuentro entre los alumnos/);
  assert.deepEqual(otra.tablas.telegram_personas[0].posibles, []);
  assert.equal(llamados.length > 0, true);
});

test("el bot: el link personal (con el código del reporte) la ata sin pedir el número; un código que no existe, no", async () => {
  const { db, tablas } = mundo();
  const { tg, llamados } = telegramFalso({ [`${GENERAL}:10`]: "member" });
  assert.equal(await atenderPrivado(db, tg, mensaje({ text: `/start c_${CODIGO}` })), "codigo");
  assert.equal(tablas.telegram_personas[0].alumnoId, "alu_1");
  assert.equal(tablas.telegram_personas[0].vinculo, "codigo");
  assert.equal(tablas.accesos_alumno.length, 1);
  assert.match(textoEnviado(llamados), /Listo, Juan!/);
  assert.equal(await atenderPrivado(db, tg, mensaje({ text: `/start c_${CODIGO}` })), "ya");

  const otra = mundo();
  const t2 = telegramFalso();
  assert.equal(await atenderPrivado(otra.db, t2.tg, mensaje({ text: "/start c_11111111-2222-4333-8444-555555555555" })), "codigo-malo");
  assert.match(textoEnviado(t2.llamados), /Ese link no es válido/);
  assert.equal(otra.tablas.telegram_personas[0].alumnoId, undefined);
});

/* ---------- Quitar ---------- */

test("quitar: un alumno de antes, ya reconocido, se saca del grupo por su id; y uno con el link sin usar, por la cuenta atada", async () => {
  await conServiciosFalsos(async () => {
    const { db, tablas } = base({
      alumnos: alumnosDe("alu_1", "alu_2"),
      telegram_personas: [{ id: "10", alumnoId: "alu_1", grupos: { [GENERAL]: "x", [NOVEDADES]: "x" } }, { id: "30", alumnoId: "alu_2", grupos: { [GENERAL]: "x" } }],
      accesos_alumno: [
        { id: "g1", alumnoId: "alu_1", plataforma: "telegram", recurso: GENERAL, recursoNombre: "General", estado: "entro", externo: { telegramUserId: 10 } },
        /* A alu_2 le dieron un link que nadie vio usar; después alguien ató su cuenta. */
        { id: "g2", alumnoId: "alu_2", plataforma: "telegram", recurso: GENERAL, recursoNombre: "General", estado: "dado", externo: { link: "https://t.me/+zzz" } },
      ],
    });
    const llamados: { metodo: string; cuerpo: Record<string, unknown> }[] = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      llamados.push({ metodo: String(url).split("/").pop()!, cuerpo: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const r1 = await quitarAccesos(db, { alumnoId: "alu_1", quien: "Manu" });
      assert.deepEqual({ q: r1.quitados, f: r1.fallaron }, { q: 1, f: 0 });
      assert.deepEqual(llamados.map((l) => `${l.metodo}:${l.cuerpo.user_id}`), ["banChatMember:10", "unbanChatMember:10"], "sale del grupo y puede volver si algún día vuelve");
      assert.deepEqual(Object.keys(tablas.telegram_personas.find((p) => p.id === "10")!.grupos as object), [NOVEDADES], "deja de figurar adentro de ese grupo");

      llamados.length = 0;
      const r2 = await quitarAccesos(db, { alumnoId: "alu_2", quien: "Manu" });
      assert.deepEqual({ q: r2.quitados, f: r2.fallaron }, { q: 1, f: 0 });
      assert.deepEqual(llamados.map((l) => `${l.metodo}:${l.cuerpo.user_id ?? l.cuerpo.invite_link}`), ["revokeChatInviteLink:https://t.me/+zzz", "banChatMember:30", "unbanChatMember:30"]);
    } finally { globalThis.fetch = antes; }
  });
});

test("quitar: si no se sabe quién es en Telegram, el error dice dónde identificarlo (y no lo da por sacado)", async () => {
  await conServiciosFalsos(async () => {
    const { db, tablas } = base({
      alumnos: alumnosDe("alu_1"),
      accesos_alumno: [{ id: "g1", alumnoId: "alu_1", plataforma: "telegram", recurso: GENERAL, recursoNombre: "General", estado: "entro", externo: {} }],
    });
    const r = await quitarAccesos(db, { alumnoId: "alu_1", quien: "Manu" });
    assert.deepEqual({ q: r.quitados, f: r.fallaron }, { q: 0, f: 1 });
    assert.match(String(tablas.accesos_alumno[0].error), /Buscar en los grupos/);
    assert.equal(tablas.accesos_alumno[0].estado, "entro");
  });
});

/* ---------- Pedirles que se identifiquen ---------- */

test("anunciar: deja el botón del bot sólo en los grupos donde es administrador, y cuenta los que fallaron", async () => {
  const { db } = base({ telegram_grupos: grupos });
  const llamados: { metodo: string; cuerpo: Record<string, unknown> }[] = [];
  const tg: LlamarTelegram = async (metodo, cuerpo = {}) => {
    llamados.push({ metodo, cuerpo });
    if (metodo === "getMe") return { ok: true, result: { username: "ApicantaBot" } };
    return cuerpo.chat_id === BOLSA ? { ok: false, description: "Forbidden: bot is not a member of the supergroup chat" } : { ok: true };
  };
  const r = await anunciarEnLosGrupos(db, tg);
  assert.deepEqual(r.enviados.map((g) => g.titulo), ["General", "Novedades - Mentoría"]);
  assert.deepEqual(r.fallaron.map((g) => [g.titulo, g.error]), [["Bolsa de trabajo", "Forbidden: bot is not a member of the supergroup chat"]]);
  const envio = llamados.find((l) => l.metodo === "sendMessage")!;
  assert.match(String(envio.cuerpo.text), /compartí tu número/);
  assert.deepEqual(envio.cuerpo.reply_markup, { inline_keyboard: [[{ text: "Verificar mi cuenta", url: "https://t.me/ApicantaBot?start=identificar" }]] });

  const sinEl = await anunciarEnLosGrupos(db, tg, [GENERAL]);
  assert.deepEqual(sinEl.enviados.map((g) => g.chatId), [GENERAL], "sólo los grupos pedidos");
});

/* ---------- Los datos ---------- */

test("los teléfonos de los alumnos se piden de a 1.000 y se guardan 5 minutos", async () => {
  const filas = Array.from({ length: 1500 }, (_, i) => ({ alumnoId: `a${String(i).padStart(4, "0")}`, nombre: `A ${i}`, estado: "activo", pais: "Argentina", telefonos: ["11 5555 6666"] }));
  const { db, escrituras } = base({}, { telefonos_de_alumnos: filas });
  const uno = await telefonosDeAlumnos(db, 1_000);
  assert.equal(uno.length, 1500, "la segunda página también");
  assert.deepEqual(uno[0].claves, ["5491155556666"]);
  const otra = await telefonosDeAlumnos(db, 1_000 + 60_000);
  assert.equal(otra, uno, "guardados");
  assert.notEqual(await telefonosDeAlumnos(db, 1_000 + 6 * 60_000), uno, "a los 6 minutos se vuelven a pedir");
  assert.equal(escrituras.length, 0);
});

test("el resumen de Ajustes cuenta alumnos activos con acceso a Telegram, los reconocidos y las cuentas sueltas", async () => {
  const { db } = base({
    alumnos: [
      { id: "a1", estado: "activo" }, { id: "a2", estado: "activo" }, { id: "a3", estado: "activo" }, { id: "a4", estado: "activo" }, { id: "a5", estado: "baja" },
    ],
    /* a1 y a2 tienen la marca del Airtable; a3 tiene un link de la app; a4 no tiene nada; a5 no cursa. */
    seguimiento_alumnos: [{ id: "s1", alumnoId: "a1", accesoWhatsapp: true }, { id: "s2", alumnoId: "a2", accesoWhatsapp: true }, { id: "s5", alumnoId: "a5", accesoWhatsapp: true }],
    accesos_alumno: [{ id: "x", alumnoId: "a3", plataforma: "telegram", estado: "dado" }, { id: "y", alumnoId: "a4", plataforma: "telegram", estado: "quitado" }],
    telegram_personas: [
      { id: "1", alumnoId: "a1", equipo: false, posibles: [] }, { id: "2", alumnoId: "a3", equipo: false, posibles: [] },
      { id: "3", alumnoId: null, equipo: false, posibles: [{ alumnoId: "a2", motivo: "varios" }] }, { id: "4", alumnoId: null, equipo: false, posibles: [] },
      { id: "5", alumnoId: null, equipo: true, posibles: [] },
    ],
  });
  assert.deepEqual(await resumenDeIdentificacion(db), { conAcceso: 3, identificados: 2, sueltas: 2, porRevisar: 1 });
});

/* ---------- El outboarding automático con los alumnos de antes ---------- */

test("el outboarding automático saca a un alumno de antes ya reconocido y avisa que Wisboo y Zoom se sacan a mano", async () => {
  const ficha = (alumnoId: string) => ({ id: `seg_${alumnoId}`, alumnoId, followUp: "OUTBOARDING", programas: [], duracionMeses: 3, fechaEgreso: null, pausas: [] });
  const { db, tablas } = base({
    accesos_alumno: [
      { alumnoId: "alu_viejo", estado: "entro", plataforma: "telegram" }, { alumnoId: "alu_nuevo", estado: "entro", plataforma: "telegram" },
    ],
    seguimiento_alumnos: [ficha("alu_viejo"), ficha("alu_nuevo")],
    ajustes: [{ id: 1, seguimiento: {} }],
    alumnos: [
      { id: "alu_viejo", nombre: "Vera Vieja", inicio: "2026-07-01", plan: "", ventaId: null, leadId: null },
      { id: "alu_nuevo", nombre: "Nico Nuevo", inicio: "2026-07-01", plan: "", ventaId: null, leadId: null },
    ],
    productos: [], equipo: [{ email: "liliana@apicanta.com", activo: true }],
  });
  const quitar = (async (_db: unknown, a: { alumnoId: string }) => a.alumnoId === "alu_viejo"
    ? { quitados: 2, fallaron: 0, accesos: [{ plataforma: "telegram", estado: "quitado" }, { plataforma: "telegram", estado: "quitado" }] }
    : { quitados: 3, fallaron: 0, accesos: [{ plataforma: "wisboo", estado: "quitado" }, { plataforma: "telegram", estado: "quitado" }, { plataforma: "zoom", estado: "quitado" }] }
  ) as unknown as Parameters<typeof pasarOutboardings>[2];
  await pasarOutboardings(db, new Date("2026-10-26T15:00:00.000Z"), quitar);
  const avisos = tablas.avisos as Fila[];
  const de = (nombre: string) => String(avisos.find((x) => String(x.titulo).includes(nombre))?.cuerpo);
  assert.match(de("Vera Vieja"), /se le sacaron 2 accesos \(Telegram\)\./);
  assert.match(de("Vera Vieja"), /Wisboo y Zoom no figuran en la app: si los tiene de antes, sacáselos a mano/);
  assert.match(de("Nico Nuevo"), /se le sacaron 3 accesos \(Wisboo, Telegram y Zoom\)\./);
  assert.doesNotMatch(de("Nico Nuevo"), /no figuran/);
});

test("las cuentas que sólo tienen el id reciben su nombre y @usuario de Telegram, una vez", async () => {
  const { db, tablas } = base({
    telegram_personas: [
      { id: "10", nombre: "", usuario: null, grupos: { [GENERAL]: "x" } },
      { id: "11", nombre: "Ya tiene", usuario: "ya", grupos: { [GENERAL]: "x" } },
      { id: "12", nombre: "", usuario: null, grupos: { [GENERAL]: "x", [NOVEDADES]: "x" } },
      { id: "13", nombre: "", usuario: null, grupos: {} },
    ],
  });
  const preguntados: string[] = [];
  const tg: LlamarTelegram = async (metodo, cuerpo = {}) => {
    preguntados.push(`${metodo}:${cuerpo.chat_id}:${cuerpo.user_id}`);
    /* A la 12 no la encuentra en el primer grupo, sí en el segundo; la 10 es una cuenta borrada. */
    if (cuerpo.user_id === 12 && cuerpo.chat_id === GENERAL) return { ok: false, description: "user not found" };
    const usuario = cuerpo.user_id === 10 ? { id: 10, first_name: "" } : { id: 12, first_name: "Marta", last_name: "Díaz", username: "mdiaz" };
    return { ok: true, result: { status: "member", user: usuario } };
  };
  assert.equal(await completarNombresDeCuentas(db, tg), 2);
  assert.deepEqual(tablas.telegram_personas.map((p) => [p.id, p.nombre, p.usuario]), [
    ["10", "(sin nombre)", null], ["11", "Ya tiene", "ya"], ["12", "Marta Díaz", "mdiaz"], ["13", "", null],
  ]);
  assert.deepEqual(preguntados, [`getChatMember:${GENERAL}:10`, `getChatMember:${GENERAL}:12`, `getChatMember:${NOVEDADES}:12`], "la 13 no está en ningún grupo: no se pregunta");
  preguntados.length = 0;
  assert.equal(await completarNombresDeCuentas(db, tg), 0, "la segunda pasada ya no pregunta por las completas");
});
