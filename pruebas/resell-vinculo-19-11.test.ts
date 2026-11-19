import test from "node:test";
import assert from "node:assert/strict";
import { filasResells, familiaDePrograma, familiasDePrograma, familiasParaFiltrar, FOLLOW_UP_NO_SE_CONCRETO, LISTAS_POR_DEFECTO, opcionesDePrograma, resellNormal, SIN_PROGRAMA, testimonioNoSeGraba } from "@/lib/clientes-cs";
import { alumnoDeResell, indiceDeAlumnos } from "@/lib/resell-alumno";
import { destinoDeResell } from "@/lib/resell-ficha";
import { estadoDelTestimonio, resumenDeTestimonios, filasDeTestimonios } from "@/lib/testimonios-panel";
import { panelDeServicio, partesPorPrograma } from "@/lib/panel-servicio";
import { CONFIG_POR_DEFECTO, seguimientoVacio } from "@/lib/seguimiento";
import { estadoVacio } from "@/lib/seed";
import type { EstadoApp, Resell, SeguimientoAlumno } from "@/lib/types";

/* Lo de Liliana del 19/11 (WhatsApp a Juan):
   1. «Nicolás González está en llamada de resell el 6/10 y falta el resultado. Al hacer clic para entrar a su ficha desde la lista de resell me
      salta "no encontramos a esta persona", y si lo busco en alumnos su ficha está pero no tiene vinculada la llamada de resell».
      Agendó con un Gmail y es alumno con un Hotmail. Su cuenta (Customer Success) no puede leer las llamadas, así que abrir la ficha por el id de
      la llamada no resolvía. El SQL, en pruebas-estres/sql/sql-resells-vinculo-alumno.test.ts.
   2. En Testimonios → Follow up: «No se graba, porque no se concretó» y poder eliminar el testimonio cargado.
   3. Filtrar a los alumnos por el programa contratado.
   4. «Se les termina el contrato» de Mi panel, separado por programa. */

/* ---------- 1. De quién es la llamada ---------- */

const CONTACTO = "lea_cal_ed90619f";
const nicolas = () => {
  const e = estadoVacio() as EstadoApp;
  e.contactos = [{ id: CONTACTO, nombre: "Nicolás González", email: "nicogmartres1@gmail.com", extra: {} } as never];
  e.alumnos = [{ id: "alu_cs_e6tn3z", nombre: "Nicolás González", email: "nicogmartres1@hotmail.com", leadId: CONTACTO, estado: "baja", plan: "Hackear IT", inicio: "2024-11-22T15:00:00Z", extra: {} } as never];
  return e;
};
const resell = (extra: Partial<Resell> = {}): Resell => resellNormal({
  id: "rs_imp_1fr5jc7", nombre: "Nicolás González", email: "nicogmartres1@gmail.com", sesionId: "cal_8ca46871", fechaHora: "2026-10-07T22:00:00Z", estado: "2da Agenda, Seguimiento", origen: "importado", ...extra,
});

test("Nicolás: el Gmail de la llamada lo une con su alumno (Hotmail) por la persona, sin leer las llamadas", () => {
  const e = nicolas();
  e.resells = [resell()];
  const f = filasResells(e)[0];
  assert.equal(f.alumno?.id, "alu_cs_e6tn3z", "antes: undefined → «No encontramos a esta persona» y su ficha sin la llamada de resell");
});

test("el vínculo que guarda la base manda; si ese alumno ya no existe, se calcula como siempre", () => {
  const e = nicolas();
  const ix = indiceDeAlumnos(e);
  assert.equal(alumnoDeResell(ix, { email: "otro@mail.com", alumnoId: "alu_cs_e6tn3z" })?.id, "alu_cs_e6tn3z", "el mail no coincide pero la base ya sabe de quién es");
  assert.equal(alumnoDeResell(ix, { email: "nicogmartres1@gmail.com", alumnoId: "alu_borrado" })?.id, "alu_cs_e6tn3z", "un vínculo a un alumno que se unificó o se borró no deja la llamada huérfana");
  assert.equal(alumnoDeResell(ix, { email: "otro@mail.com", alumnoId: null }), undefined, "sin ningún camino, no se inventa");
});

test("un mail vacío no se une a un alumno sin mail", () => {
  const e = nicolas();
  e.alumnos = [...e.alumnos, { id: "alu_sin_mail", nombre: "Sin mail", email: "", estado: "activo", extra: {} } as never];
  const ix = indiceDeAlumnos(e);
  assert.equal(alumnoDeResell(ix, { email: "" }), undefined);
  assert.equal(alumnoDeResell(ix, { email: "   " }), undefined);
});

test("de una persona con dos alumnos, el activo", () => {
  const e = nicolas();
  e.alumnos = [
    { id: "vieja", nombre: "N", email: "n1@x.com", leadId: CONTACTO, estado: "baja", inicio: "2026-11-01T00:00:00Z", extra: {} } as never,
    { id: "activa", nombre: "N", email: "n2@x.com", leadId: CONTACTO, estado: "activo", inicio: "2025-01-01T00:00:00Z", extra: {} } as never,
  ];
  assert.equal(alumnoDeResell(indiceDeAlumnos(e), { email: "nicogmartres1@gmail.com" })?.id, "activa");
});

test("el vínculo se conserva al normalizar y no se manda vacío", () => {
  assert.equal(resell({ alumnoId: "a1", contactoId: "c1" }).alumnoId, "a1");
  assert.equal(resell({ alumnoId: "a1", contactoId: "c1" }).contactoId, "c1");
  assert.equal("alumnoId" in resell(), false, "sin vínculo no se manda null: no pisa el de la base");
  assert.equal("alumnoId" in resell({ alumnoId: null }), false);
});

test("a dónde abre el nombre: el alumno; si no, la persona; nunca un id que esta cuenta no puede resolver", () => {
  /* La cuenta de Customer Success no lee las llamadas: e.sesiones viene vacío. */
  const e = nicolas();
  const r = resell();
  const f = filasResells({ ...e, resells: [r] })[0];
  assert.deepEqual(destinoDeResell(e, r, f.alumno), { id: "alu_cs_e6tn3z", vista: "servicio", hoja: "testimonio" });

  /* Sin alumno (no es de la app): la llamada no se puede leer → la persona, por el contacto que guardó la base o por el mail. */
  e.alumnos = [];
  assert.deepEqual(destinoDeResell(e, r, undefined), { id: CONTACTO, vista: "llamadas" }, "el mail del contacto coincide");
  assert.deepEqual(destinoDeResell(e, { ...r, email: "otro@mail.com", contactoId: CONTACTO }, undefined), { id: CONTACTO, vista: "llamadas" }, "el contacto que guardó la base");

  /* Antes se abría el id de la llamada y quedaba «No encontramos a esta persona». */
  assert.equal(destinoDeResell(e, { email: "nadie@x.com", sesionId: "cal_que_no_leo" }, undefined), null);
  assert.equal(destinoDeResell(e, { email: "", sesionId: null }, undefined), null);

  /* Un closer sí lee la llamada: abre por ahí, como siempre. */
  e.sesiones = [{ id: "cal_8ca46871", contactoId: CONTACTO, leadId: CONTACTO, email: "nicogmartres1@gmail.com", inicia: "2026-10-07T22:00:00Z", estado: "hecha", respuestas: [], extra: {} } as never];
  assert.deepEqual(destinoDeResell(e, r, undefined), { id: "cal_8ca46871", vista: "llamadas" });
});

/* ---------- 2. Testimonio: «No se graba, porque no se concretó» ---------- */

test("el Follow-up nuevo está en la lista y cierra el testimonio sin pedir nada", () => {
  assert.ok(LISTAS_POR_DEFECTO.followUpsTestimonio.includes(FOLLOW_UP_NO_SE_CONCRETO));
  assert.equal(FOLLOW_UP_NO_SE_CONCRETO, "No se graba, porque no se concretó");
  assert.deepEqual(testimonioNoSeGraba(FOLLOW_UP_NO_SE_CONCRETO), { motivo: "no-se-concreto" });
  assert.deepEqual(testimonioNoSeGraba("no se graba, porque no se concreto"), { motivo: "no-se-concreto" }, "mayúsculas y tildes no importan");
  assert.deepEqual(testimonioNoSeGraba("No quiere grabar"), { motivo: "no-quiere" });
  assert.deepEqual(testimonioNoSeGraba("", "No quiso grabar"), { motivo: "no-quiere" });
  assert.equal(testimonioNoSeGraba("Llamada agendada"), null);
  assert.equal(testimonioNoSeGraba("Pendiente de agendar"), null);
  assert.equal(testimonioNoSeGraba(undefined), null);
});

test("en Mi panel es su propio estado: ni «agendado» ni «falta el link», aunque tenga fecha", () => {
  const t = { link: "", followUp: FOLLOW_UP_NO_SE_CONCRETO, estadoVideo: "", fechaGrabacion: "2026-10-28" };
  assert.equal(estadoDelTestimonio(t, "2026-11-19"), "no-se-concreto", "con fecha vieja y sin link sería «Falta el link»");
  assert.equal(estadoDelTestimonio({ ...t, fechaGrabacion: "2026-12-01" }, "2026-11-19"), "no-se-concreto", "y con fecha futura, «Agendado»");
  assert.equal(estadoDelTestimonio({ ...t, followUp: "No quiere grabar" }, "2026-11-19"), "no-quiere", "lo de siempre no cambia");
  const filas = filasDeTestimonios([{ id: "t", alumnoId: "a", ...t, conQuien: "", resell: "", creadoEn: "2026-10-29T00:00:00Z" } as never], [{ id: "a", nombre: "Ana" }], "2026-11-19");
  const r = resumenDeTestimonios(filas);
  assert.equal(r.porEstado["no-se-concreto"], 1);
  assert.equal(r.total, 1);
});

/* ---------- 3 y 4. El programa contratado ---------- */

test("un solo nombre por programa: «HACKEAR IA» y «Hackear AI» son lo mismo; el viejo, el Downsell y el nuevo no", () => {
  const casos: [string, string][] = [
    ["HACKEAR IA", "Hackear AI"], ["Hackear AI", "Hackear AI"], ["hackear ai", "Hackear AI"], ["Upgrade AI", "Hackear AI"],
    ["Hackear IT", "Hackear IT"], ["Hackear IT Full", "Hackear IT"], ["Mentoría", "Hackear IT"], ["Resell Mentoría", "Hackear IT"],
    ["DOWNSELL", "Downsell"], ["Downsell", "Downsell"], ["Downsell Plus+", "Downsell Plus+"], ["Hackear IA MID", "Hackear IA MID"],
    ["Hackear Biz", "Hackear Biz"], ["Principals", "Principals"], ["Principal Mastermind", "Principal Mastermind"],
    ["  Upsell ", "Upsell"], ["", ""],
  ];
  for (const [crudo, esperado] of casos) assert.equal(familiaDePrograma(crudo), esperado, `«${crudo}»`);
  assert.deepEqual(familiasDePrograma("Hackear Biz · HACKEAR IA"), ["Hackear Biz", "Hackear AI"]);
  assert.deepEqual(familiasDePrograma(["HACKEAR IA", "Hackear AI"]), ["Hackear AI"], "sin repetir");
  assert.deepEqual(familiasParaFiltrar(""), [SIN_PROGRAMA]);
  assert.deepEqual(familiasParaFiltrar(undefined), [SIN_PROGRAMA]);
});

test("las opciones del filtro: cuántos de cada uno, los de siempre primero y «Sin programa» al final", () => {
  const o = opcionesDePrograma(["HACKEAR IA", "Hackear AI", "Hackear IT", "DOWNSELL", "", "Hackear Biz · HACKEAR IA", "Algo nuevo"]);
  assert.deepEqual(o.map((x) => x.programa), ["Hackear IT", "Hackear AI", "Downsell", "Hackear Biz", "Algo nuevo", SIN_PROGRAMA]);
  assert.equal(o.find((x) => x.programa === "Hackear AI")?.n, 3, "dos escritos distinto y uno que cursa dos");
  assert.equal(o.find((x) => x.programa === SIN_PROGRAMA)?.n, 1);
});

const HOY = "2026-11-19";
const AHORA = new Date("2026-11-19T15:00:00.000Z");
const alumno = (id: string, nombre: string, inicio: string) => ({ id, nombre, email: `${id}@mail.com`, estado: "activo", inicio: `${inicio}T12:00:00.000Z`, cohorte: "", plan: "", extra: {} });
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), ...c });

test("«Se les termina el contrato» se separa por programa, con los vencidos aparte", () => {
  const firmado = { contratoFirmado: "Firmado", contactoInicial: "2026-09-01", ultimoContacto: "2026-11-10" };
  const e = {
    ajustes: {}, leads: [], contactos: [], ventas: [], cuotas: [], productos: [], equipo: [], etapasServicio: [], reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [],
    alumnos: [alumno("viejo1", "Viejo Uno", "2026-08-01"), alumno("viejo2", "Viejo Dos", "2026-08-01"), alumno("nuevo", "Nuevo", "2026-08-01"), alumno("down", "Down", "2026-08-01"), alumno("lejos", "Lejos", "2026-08-01")],
    seguimientos: [
      seg("viejo1", { ...firmado, programas: ["Hackear IT"], fechaEgreso: "2026-11-25" }),
      seg("viejo2", { ...firmado, programas: ["Hackear IT"], fechaEgreso: "2026-11-10" }),
      seg("nuevo", { ...firmado, programas: ["HACKEAR IA"], fechaEgreso: "2026-12-01" }),
      seg("down", { ...firmado, programas: ["DOWNSELL"], fechaEgreso: "2026-11-30" }),
      seg("lejos", { ...firmado, programas: ["Hackear AI"], fechaEgreso: "2027-03-01" }),
    ],
  } as unknown as EstadoApp;
  const s = panelDeServicio(e, HOY, AHORA).secciones.find((x) => x.id === "renovar")!;
  assert.equal(s.total, 4, "el que termina en marzo no entra");
  assert.deepEqual(s.porPrograma?.map((x) => [x.programa, x.n, x.rojos]), [["Hackear IT", 2, 1], ["Hackear AI", 1, 0], ["Downsell", 1, 0]],
    "el viejo (uno ya terminó: en rojo), el nuevo (escrito «HACKEAR IA») y el Downsell, cada uno en su grupo");
});

test("partesPorPrograma: el que cursa dos cuenta en los dos y el que no tiene ninguno va a «Sin programa»", () => {
  const p = partesPorPrograma([
    { programa: "Hackear Biz · HACKEAR IA", tono: "rojo" }, { programa: undefined, tono: "ambar" }, { programa: "Hackear IT", tono: "neutro" },
  ]);
  assert.deepEqual(p.map((x) => [x.programa, x.n, x.rojos]), [["Hackear IT", 1, 0], ["Hackear AI", 1, 1], ["Hackear Biz", 1, 1], [SIN_PROGRAMA, 1, 0]]);
});
