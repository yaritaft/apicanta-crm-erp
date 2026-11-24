import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conLoQueIncluye, incluyeAlPrograma, programaDeProducto, programaNormal, programasDe, programasPropios, PROGRAMAS_POR_DEFECTO, WISBOO, type Programa } from "@/lib/programas";
import { guiaDeBienvenida, modeloDeBienvenida, textoDeBienvenida } from "@/lib/bienvenida-alumno";
import { problemaDeDatos, type DatosContrato } from "@/lib/contratos";
import { accesosQueFaltan, resumenDelPrograma } from "@/lib/accesos-que-faltan";
import { rangoDePreset } from "@/components/ui/DateRangePicker";

/* Lili, 24/11: «Los alumnos que renuevan en Principals deben tener acceso en Wisboo a Hackear IT, Hackear IA, Bonos y Principals;
   Telegram: Novedades, General, Contenido recomendado, Bolsa de trabajo, Hackear IA y Principals; Zoom: las tres salas (igual que
   Hackear IA). Necesito ver que tenga todos esos accesos y cómo se envía el mail de bienvenida, poder reenviarlo.» Brando Sánchez
   firmó Principals y recibió sólo el curso y el grupo de Principals, sin mail. LA RAÍZ: Principals tenía su lista suelta; ahora
   INCLUYE Hackear AI y todo lo que da, muestra o cuenta accesos lo lee sumado. */

/* Ajustes → Programas tal como está en producción el 24/11 (sólo lo que importa acá), con el «incluye» que se agrega. */
const GENERAL = "-1004341505711", CONTENIDO = "-1004393795361", NOVEDADES = "-1004338558206", BOLSA = "-1004492115716", GRUPO_IA = "-1003990857017", GRUPO_PRINCIPALS = "-1003910580644";
const JUEVES = "84681899646", MIERCOLES = "84967094264", MARTES = "83449857065";
const EN_PRODUCCION = [
  { id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_mentoria", "prod_upgrade_ai"], plantillaId: "u8", plantillaNombre: "Hackear AI",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi, WISBOO.bonos], telegram: [GENERAL, CONTENIDO, NOVEDADES, BOLSA, GRUPO_IA], zoom: [JUEVES, MIERCOLES, MARTES], bonos: [], activo: true },
  { id: "principals", nombre: "Principals", productos: ["prod_principals"], plantillaId: "LA8", plantillaNombre: "Principals",
    wisboo: [WISBOO.principals], telegram: [GRUPO_PRINCIPALS], zoom: [], bonos: [], incluye: ["hackear-ai"], activo: true },
  { id: "hackear-ia-mid", nombre: "Hackear IA MID", productos: ["prod_hackear_ia_mid"], plantillaId: "7u", plantillaNombre: "Downsell",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [GENERAL], zoom: [MARTES], bonos: [], vencen: { [`telegram:${GENERAL}`]: 1, [`zoom:${MARTES}`]: 1 }, activo: true },
];
const ajustes = { programas: EN_PRODUCCION as unknown as Programa[] };
const principals = () => programasDe(ajustes).find((p) => p.id === "principals")!;

test("Principals da todo lo de Hackear AI más lo suyo: los 4 cursos, los 6 grupos y las 3 salas que pidió Lili", () => {
  const p = principals();
  assert.deepEqual(p.wisboo, [WISBOO.principals, WISBOO.hackearIt, WISBOO.hackearAi, WISBOO.bonos]);
  assert.deepEqual([...p.telegram].sort(), [GENERAL, CONTENIDO, NOVEDADES, BOLSA, GRUPO_IA, GRUPO_PRINCIPALS].sort());
  assert.deepEqual([...p.zoom].sort(), [JUEVES, MIERCOLES, MARTES].sort());
  assert.deepEqual(p.incluye, ["hackear-ai"]);
  /* El de la venta de Brando (prod_principals) es este, con todo. */
  assert.equal(programaDeProducto(programasDe(ajustes), "prod_principals")?.telegram.length, 6);
  /* Hackear AI no cambia. */
  assert.equal(programasDe(ajustes).find((x) => x.id === "hackear-ai")!.telegram.length, 5);
});

test("si Hackear AI suma un grupo, Principals lo da también sin tocarlo (no hay copia que se desfase)", () => {
  const conNuevo = EN_PRODUCCION.map((p) => (p.id === "hackear-ai" ? { ...p, telegram: [...p.telegram, "-100nuevo"] } : p));
  const p = programasDe({ programas: conNuevo as unknown as Programa[] }).find((x) => x.id === "principals")!;
  assert.ok(p.telegram.includes("-100nuevo"));
});

test("el editor de Ajustes ve cada programa con SU lista: guardar no copia lo de Hackear AI adentro de Principals", () => {
  const propio = programasPropios(ajustes).find((p) => p.id === "principals")!;
  assert.deepEqual(propio.wisboo, [WISBOO.principals]);
  assert.deepEqual(propio.telegram, [GRUPO_PRINCIPALS]);
  assert.deepEqual(propio.incluye, ["hackear-ai"]);
});

test("se incluye de segunda mano, sin repetir y sin colgarse con un círculo; lo que corta el incluido no corta lo que el otro da sin corte", () => {
  const base = { productos: [], plantillaId: "", plantillaNombre: "", bonos: [], activo: true, zoom: [] as string[] };
  const a: Programa = { ...base, id: "a", nombre: "A", wisboo: ["w1"], telegram: ["t1"], incluye: ["b"] };
  const b: Programa = { ...base, id: "b", nombre: "B", wisboo: ["w2"], telegram: ["t1", "t2"], incluye: ["c"], vencen: { "telegram:t2": 1, "telegram:t1": 2 } };
  const c: Programa = { ...base, id: "c", nombre: "C", wisboo: ["w3"], telegram: [], incluye: ["a"] };
  const [A, B, C] = conLoQueIncluye([a, b, c]);
  assert.deepEqual(A.wisboo, ["w1", "w2", "w3"]);
  assert.deepEqual(A.telegram, ["t1", "t2"]);
  assert.deepEqual(A.incluye, ["b", "c"]);
  assert.deepEqual(A.vencen, { "telegram:t2": 1 }, "t1 lo da A sin corte: no hereda el de B; t2 sólo viene de B y sí");
  assert.deepEqual(B.wisboo, ["w2", "w3", "w1"]);
  assert.deepEqual(C.incluye, ["a", "b"]);
  assert.ok(incluyeAlPrograma(C, "b"));
  assert.ok(!incluyeAlPrograma(b, "a"), "el que no incluye no incluye");
});

test("de la base se lee el «incluye» y uno que se incluye a sí mismo no cuenta; los de siempre ya traen Principals con Hackear AI", () => {
  assert.deepEqual(programaNormal({ id: "x", nombre: "X", incluye: ["x", "hackear-ai", "hackear-ai", 3] })?.incluye, ["hackear-ai"]);
  assert.equal(programaNormal({ id: "x", nombre: "X", incluye: ["x"] })?.incluye, undefined);
  assert.deepEqual(PROGRAMAS_POR_DEFECTO.find((p) => p.id === "principals")?.incluye, ["hackear-ai"]);
});

test("Principals tiene mail de bienvenida (el del programa completo) y el closer tiene que cargar el perfil", () => {
  const p = principals();
  assert.equal(modeloDeBienvenida({ programa: "principals", incluye: p.incluye }), "completo");
  assert.equal(modeloDeBienvenida({ programa: "principals", incluye: [] }), null, "sin incluir Hackear AI, como antes");
  assert.equal(modeloDeBienvenida({ programa: "principals", incluye: p.incluye, reserva: true }), "reserva");
  const datos: Partial<DatosContrato> = { nombre: "Brando Sánchez", email: "b@mail.com", documento: "1", domicilio: "Calle 1" };
  assert.match(problemaDeDatos(datos, "produccion", undefined, p) ?? "", /perfil del alumno/);
  assert.equal(problemaDeDatos({ ...datos, perfil: "Full Stack" }, "produccion", undefined, p), null);
});

test("el mail de Principals nombra los 4 cursos, los 6 grupos (Principals al final) y las 3 clases", () => {
  const g = guiaDeBienvenida({ programa: "principals", perfil: "Full Stack", config: { soporte: { nombre: "Liliana", whatsapp: "+54 9 11 5555-0001" } }, delPrograma: principals() })!;
  assert.equal(g.modelo, "completo");
  assert.deepEqual(g.accesos!.cursos.map((c) => c.nombre), ["Hackear IT", "Hackear IA", "Bonos", "Principals"]);
  assert.deepEqual(g.accesos!.grupos.map((c) => c.nombre), ["General", "Novedades", "Bolsa de trabajo", "Contenido recomendado", "Hackear IA", "Principals"]);
  assert.deepEqual(g.accesos!.clases.map((c) => c.dia), ["martes", "miercoles", "jueves"]);
  const { texto } = textoDeBienvenida(g, "https://apicanta-erp.vercel.app/bienvenida/abc");
  assert.match(texto, /4\. Principals/);
  assert.match(texto, /– Principals: grupo exclusivo de los alumnos de Principals\./);
  assert.match(texto, /Martes 18:00/);
  assert.match(texto, /Miércoles 18:00/);
  assert.match(texto, /Jueves 18:00/);
  assert.match(texto, /7\. Aprovechá los bonos disponibles/);
});

test("Brando: la solapa Accesos dice lo que le falta (11) y, dado todo, «Tiene todo»", () => {
  const p = principals();
  const tiene = [
    { plataforma: "telegram" as const, recurso: GRUPO_PRINCIPALS, estado: "entro" },
    { plataforma: "wisboo" as const, recurso: WISBOO.principals, estado: "dado" },
  ];
  const faltan = accesosQueFaltan(p, tiene, { [`telegram:${GENERAL}`]: "General" });
  assert.equal(faltan.length, 11);
  assert.deepEqual(faltan.filter((x) => x.plataforma === "wisboo").map((x) => x.nombre), ["Mentoría (Hackear IT)", "Mentoría (Hackear AI)", "Bonos"]);
  assert.equal(faltan.find((x) => x.recurso === GENERAL)?.nombre, "General", "con el título del grupo");
  assert.equal(faltan.find((x) => x.recurso === NOVEDADES)?.nombre, "Novedades", "sin título, el nombre del mail");
  assert.equal(faltan.find((x) => x.recurso === MARTES)?.nombre, "Simulacros y tema nuevo");
  const r = resumenDelPrograma(p, tiene, faltan);
  assert.equal(r.da, "4 cursos, 6 grupos y 3 reuniones");
  assert.equal(r.tieneTodo, false);

  /* Se le da todo: un grupo queda con el link sin usar, uno falló y uno se le quitó a propósito. */
  const todo = [
    ...p.wisboo.map((recurso) => ({ plataforma: "wisboo" as const, recurso, estado: "dado" })),
    ...p.telegram.map((recurso) => ({ plataforma: "telegram" as const, recurso, estado: recurso === BOLSA ? "dado" : "entro" })),
    ...p.zoom.map((recurso) => ({ plataforma: "zoom" as const, recurso, estado: recurso === JUEVES ? "quitado" : "dado" })),
  ];
  assert.deepEqual(accesosQueFaltan(p, todo), [], "lo quitado a propósito no se reclama");
  const fin = resumenDelPrograma(p, todo, []);
  assert.equal(fin.tieneTodo, true);
  assert.equal(fin.sinEntrar, 1);
  const conError = todo.map((x) => (x.recurso === MARTES ? { ...x, estado: "fallo" } : x));
  assert.equal(resumenDelPrograma(p, conError, []).tieneTodo, false);
  assert.deepEqual(accesosQueFaltan(null, tiene), [], "sin programa no se reclama nada");
});

test("Mariano: «Máximo» está en la Agenda y la lista de atajos no se corta (sin alto máximo ni scroll propio)", () => {
  const max = rangoDePreset("max", "2025-01-10", true, undefined, "2027-02-01");
  assert.deepEqual(max, { preset: "max", desde: "2025-01-10", hasta: "2027-02-01" });
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const rail = /\.dp-rail\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(rail, "existe la regla del rail");
  assert.doesNotMatch(rail, /max-height/, "con un alto máximo, los últimos atajos (Máximo) quedan escondidos");
  assert.doesNotMatch(rail, /overflow-y:\s*auto/);
});

/* ---------- Dar lo que falta a quien renueva de Hackear AI a Principals (lo que pasó con Brando y Juan Ignacio) ---------- */

import { baseEnMemoria, conServiciosFalsos, type Fila } from "./ayudas-accesos";
import { darAccesos, idDeAcceso } from "@/lib/accesos-servidor";

test("renovó a Principals: lo de Hackear AI pasa a Principals, no se repite, y en Telegram identificado no se le manda link al grupo donde ya está", async () => {
  const p = principals();
  const fila = (plataforma: string, recurso: string, estado: string, programa: string): Fila => ({
    id: idDeAcceso("alu_b", plataforma as "telegram", recurso), alumnoId: "alu_b", plataforma, recurso, recursoNombre: recurso, estado, programa, venceEn: null, externo: {}, error: null,
  });
  const { db, tablas } = baseEnMemoria({
    accesos_alumno: [fila("wisboo", WISBOO.hackearIt, "dado", "hackear-ai"), fila("telegram", GRUPO_PRINCIPALS, "entro", "principals")],
    telegram_personas: [{ id: "777", usuario: "brando", alumnoId: "alu_b", grupos: { [GRUPO_PRINCIPALS]: "2026-11-24T22:00:00.000Z" } }],
    telegram_grupos: [],
  });
  const links: string[] = [];
  const r = await conServiciosFalsos(async () => {
    const falso = globalThis.fetch;
    globalThis.fetch = (async (entrada: string | URL, init?: RequestInit) => {
      const url = String(entrada);
      if (url.includes("/getChatMember")) {
        const chat = String(JSON.parse(String(init?.body ?? "{}")).chat_id);
        const json = { ok: true, result: { status: chat === GENERAL ? "member" : "left" } };
        return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/createChatInviteLink")) links.push(String(JSON.parse(String(init?.body ?? "{}")).chat_id));
      return falso(entrada, init);
    }) as typeof fetch;
    try {
      return await darAccesos(db, { alumnoId: "alu_b", persona: { nombre: "Brando Sánchez", email: "b@x.com" }, programa: p, origen: "manual", quien: "t" });
    } finally { globalThis.fetch = falso; }
  });
  const de = (pl: string, rec: string) => tablas.accesos_alumno.find((f) => f.plataforma === pl && f.recurso === rec);
  assert.equal(de("wisboo", WISBOO.hackearIt)?.programa, "principals", "lo que tenía de Hackear AI ahora es de Principals");
  assert.equal(r.yaEstaban, 2, "Hackear IT y el grupo de Principals no se vuelven a dar");
  assert.equal(de("telegram", GENERAL)?.estado, "entro", "ya estaba en General: se anota adentro");
  assert.equal((de("telegram", GENERAL)?.externo as Record<string, unknown>).telegramUsuario, "brando");
  assert.ok(!links.includes(GENERAL), "y no se le genera link");
  assert.deepEqual([...links].sort(), [CONTENIDO, NOVEDADES, BOLSA, GRUPO_IA].sort(), "a los otros cuatro, link");
  assert.ok(GENERAL in (tablas.telegram_personas[0].grupos as Record<string, string>), "la cuenta cuenta también ese grupo");
  assert.equal(tablas.accesos_alumno.filter((f) => f.plataforma === "wisboo").length, 4);
});
