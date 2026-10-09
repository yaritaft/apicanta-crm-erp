import test from "node:test";
import assert from "node:assert/strict";
import { leerCSV } from "@/lib/pasarelas";
import {
  adivinarMapeoCs, CAMPOS_CLIENTES, CAMPOS_RESELLS, CAMPOS_TESTIMONIOS, detectarTipo, faltaParaImportar, filaDeEncabezados, leerFechaHora,
  leerMontoCs, leerSiNo, planificarImportacionCs, tablaDeHoja, type OpcionesImport, type PlanImportCs, type TablaImport,
} from "@/lib/importar-cs";
import type { EstadoApp } from "@/lib/types";

const OP: OpcionesImport = { modo: "completar", crearFaltantes: true, hoy: "2026-10-09", ahora: "2026-10-09T12:00:00.000Z", quien: "Importación" };

/* Las columnas de Lili, tal cual las escribió. */
const COLS_CLIENTES = "N.º de alumno,Nombre y apellido,Fecha de inicio,Fecha de egreso,Edad,Stack,Teléfono,DNI,Domicilio,Mail,Programa,Plan de pago,Duración,Sesión con el mentor,Comentarios,Contacto inicial,Contacto semana,Acceso,Follow-up,Reporte semanal,Último contacto,Garantía,Acceso WhatsApp,Acceso Zoom,Acceso Wibo,Contrato firmado,País,Closer,Estado del contrato";
const COLS_TESTIMONIOS = "Alumno,Edad,Fecha de inicio,Teléfono,Follow-up,Fecha de grabación,Con quién grabó,Resell,Estado del video,Link del video,Tecnologías,Stack,Situación previa,Situación actual,Notas,País";
const COLS_RESELLS = "Fecha y hora de agenda,Nombre completo,Mail,Teléfono,Closer,Estado,Cash Collect,Caso de éxito,Notas";

const tabla = (nombre: string, csv: string): TablaImport => {
  const t = tablaDeHoja(nombre, leerCSV(csv));
  assert.ok(t, `se reconoce la hoja ${nombre}`);
  return t;
};

/* Ana ya está en la app (de una venta, con su contacto); no tiene ficha de Customer Success. */
function estado(extra: Partial<EstadoApp> = {}): EstadoApp {
  return {
    ajustes: {},
    alumnos: [{ id: "a1", nombre: "Ana López", email: "ana@mail.com", estado: "activo", inicio: "2026-08-31T12:00:00.000Z", cohorte: "", plan: "Mentoría", extra: {}, leadId: "l1", ventaId: "v1" }],
    leads: [{ id: "l1", nombre: "Ana López", email: "ana@mail.com", contactoId: "c1" }],
    contactos: [{ id: "c1", nombre: "Ana López", email: "ana@mail.com", telefono: "+54 9 11 5555 1111" }],
    ventas: [{ id: "v1", contactoId: "l1", contactoNombre: "Ana López", productoId: "p1", closerId: "m1", estado: "activa", fecha: "2026-08-31T12:00:00.000Z", moneda: "USD" }],
    cuotas: [], productos: [{ id: "p1", nombre: "Mentoría" }], equipo: [{ id: "m1", nombre: "Mariano", rol: "closer", activo: true }],
    etapasServicio: [{ id: "e1", nombre: "Onboarding", orden: 1 }],
    reportes: [], sesiones: [], seguimientos: [], testimonios: [], resells: [],
    ...extra,
  } as unknown as EstadoApp;
}

/* Lo que hace la acción del store con el plan: reemplaza por id y deja lo demás. */
function aplicar(e: EstadoApp, p: PlanImportCs): EstadoApp {
  const reemplazar = <T extends { id: string }>(xs: readonly T[] | undefined, nuevas: readonly T[]) => {
    const ids = new Set(nuevas.map((x) => x.id));
    return [...nuevas, ...(xs ?? []).filter((x) => !ids.has(x.id))];
  };
  const porAlumno = new Set(p.seguimientos.map((s) => s.alumnoId));
  return {
    ...e,
    alumnos: reemplazar(e.alumnos, p.alumnos),
    seguimientos: [...p.seguimientos, ...(e.seguimientos ?? []).filter((s) => !porAlumno.has(s.alumnoId))],
    testimonios: reemplazar(e.testimonios, p.testimonios), resells: reemplazar(e.resells, p.resells), reportes: reemplazar(e.reportes, p.reportes),
  };
}
const escribe = (p: PlanImportCs) => p.alumnos.length + p.seguimientos.length + p.testimonios.length + p.resells.length + p.reportes.length;

/* ---------- Leer valores ---------- */

test("un monto se lee escrito de cualquier forma", () => {
  assert.equal(leerMontoCs("1200"), 1200);
  assert.equal(leerMontoCs("US$ 1.200,50"), 1200.5);
  assert.equal(leerMontoCs("$1,200.50"), 1200.5);
  assert.equal(leerMontoCs("1.200"), 1200, "un punto con tres dígitos atrás son miles");
  assert.equal(leerMontoCs("1,200,000"), 1200000);
  assert.equal(leerMontoCs("12,5"), 12.5);
  assert.equal(leerMontoCs("12.50"), 12.5);
  assert.equal(leerMontoCs("0,5"), 0.5);
  assert.equal(leerMontoCs("USD 800"), 800);
  assert.equal(leerMontoCs("-50"), -50);
  assert.equal(leerMontoCs(""), null);
  assert.equal(leerMontoCs("pendiente"), null);
});

test("una fecha con hora se lee de un Airtable o de un Excel y queda en la hora de Argentina", () => {
  assert.equal(leerFechaHora("2026-10-07T18:30:00.000Z"), "2026-10-07T18:30:00.000Z");
  assert.equal(leerFechaHora("2026-10-07T15:30:00-03:00"), "2026-10-07T18:30:00.000Z");
  assert.equal(leerFechaHora("2026-10-07T15:30:00"), "2026-10-07T18:30:00.000Z", "sin zona: Argentina");
  assert.equal(leerFechaHora("07/10/2026 15:30"), "2026-10-07T18:30:00.000Z");
  assert.equal(leerFechaHora("7/10/2026 3:30 pm"), "2026-10-07T18:30:00.000Z");
  assert.equal(leerFechaHora("7/10/2026 12:15 AM"), "2026-10-07T03:15:00.000Z");
  assert.equal(leerFechaHora("07/10/2026"), "2026-10-07T15:00:00.000Z", "sin hora: mediodía");
  assert.equal(leerFechaHora("2026-10-07"), "2026-10-07T15:00:00.000Z");
  assert.equal(leerFechaHora("32/13/2026"), null);
  assert.equal(leerFechaHora("07/10/2026 25:99"), null);
  assert.equal(leerFechaHora(""), null);
  assert.equal(leerFechaHora("mañana"), null);
});

test("sí, no y vacío se leen en castellano", () => {
  for (const si of ["Sí", "si", "SI", "x", "X", "Tiene", "Firmado", "Corregido", "true", "1", "ok"]) assert.equal(leerSiNo(si), true, si);
  for (const no of ["No", "no", "Pendiente", "Sin acceso", "0", "false", ""]) assert.equal(leerSiNo(no), false, no);
  assert.equal(leerSiNo("quizás"), null);
});

/* ---------- Reconocer las hojas ---------- */

test("las columnas de Lili se reconocen una por una, en las tres tablas", () => {
  const m = adivinarMapeoCs(CAMPOS_CLIENTES, COLS_CLIENTES.split(","));
  const sinMapa = CAMPOS_CLIENTES.filter((c) => m[c.campo] === undefined).map((c) => c.campo);
  /* Las que no están en las 29 de Lili: el CV, el LinkedIn y su responsable. */
  assert.deepEqual(sinMapa, ["cv", "linkedin", "responsableCv"]);
  const orden = COLS_CLIENTES.split(",");
  for (const [campo, titulo] of [["numero", "N.º de alumno"], ["nombre", "Nombre y apellido"], ["email", "Mail"], ["programa", "Programa"], ["plan", "Plan de pago"], ["mentor", "Sesión con el mentor"], ["followUp", "Follow-up"], ["reporte", "Reporte semanal"], ["wpp", "Acceso WhatsApp"], ["zoom", "Acceso Zoom"], ["wibo", "Acceso Wibo"], ["acceso", "Acceso"], ["contrato", "Contrato firmado"], ["estadoContrato", "Estado del contrato"], ["ultimoContacto", "Último contacto"], ["contactoInicial", "Contacto inicial"], ["contactoSemana", "Contacto semana"]] as const) {
    assert.equal(orden[m[campo] as number], titulo, campo);
  }
  const t = adivinarMapeoCs(CAMPOS_TESTIMONIOS, COLS_TESTIMONIOS.split(","));
  assert.deepEqual(CAMPOS_TESTIMONIOS.filter((c) => t[c.campo] === undefined).map((c) => c.campo), ["email"], "sólo el mail no está en la pestaña de testimonios");
  assert.equal(COLS_TESTIMONIOS.split(",")[t.estadoVideo as number], "Estado del video");
  assert.equal(COLS_TESTIMONIOS.split(",")[t.followUp as number], "Follow-up");
  assert.equal(COLS_TESTIMONIOS.split(",")[t.fechaGrabacion as number], "Fecha de grabación");
  const r = adivinarMapeoCs(CAMPOS_RESELLS, COLS_RESELLS.split(","));
  assert.deepEqual(CAMPOS_RESELLS.filter((c) => r[c.campo] === undefined).map((c) => c.campo), []);
  assert.equal(COLS_RESELLS.split(",")[r.cash as number], "Cash Collect");
  assert.equal(COLS_RESELLS.split(",")[r.fechaHora as number], "Fecha y hora de agenda");
});

test("cada hoja se reconoce por sus encabezados, y por el nombre si empata", () => {
  assert.equal(detectarTipo(COLS_CLIENTES.split(","), "Clientes").tipo, "clientes");
  assert.equal(detectarTipo(COLS_CLIENTES.split(",")).tipo, "clientes");
  assert.equal(detectarTipo(COLS_TESTIMONIOS.split(","), "Hoja 2").tipo, "testimonios");
  assert.equal(detectarTipo(COLS_RESELLS.split(","), "Agenda de resells").tipo, "resells");
  assert.equal(detectarTipo(["Alumno", "Semana", "Horas de estudio", "Entrevistas", "Postulaciones", "Bloqueo"], "Results").tipo, "reportes");
  assert.equal(detectarTipo(["Producto", "Precio", "Stock", "Proveedor"], "Inventario").tipo, null, "una hoja de otra cosa no se importa");
  assert.equal(detectarTipo(["Nombre", "Mail"], "Contactos").tipo, null, "con tan pocas columnas no se sabe");
});

test("los renglones vacíos de arriba no son los encabezados", () => {
  assert.equal(filaDeEncabezados([[""], ["", ""], ["Nombre", "Mail", "Edad"], ["Ana", "a@b.com", "30"]]), 2);
  const t = tablaDeHoja("Clientes", leerCSV(`\n\n${COLS_CLIENTES}\nAna,1\n`.replace("Ana,1", "1,Ana López")));
  assert.ok(t);
  assert.equal(t.filas.length, 1);
  assert.equal(t.encabezados[1], "Nombre y apellido");
  assert.equal(faltaParaImportar({ tipo: "clientes", mapeo: {} }), "Elegí qué columna es Nombre y apellido.");
  assert.equal(faltaParaImportar(t), null);
});

/* ---------- Clientes ---------- */

const FILA_ANA = '1,Ana López,31/08/2026,,29,full stack,+54 9 11 5555 1111,30.111.222,"Av. Siempre Viva 742",ana@mail.com,Hackear IT,3 cuotas,3 meses,2,"Muy activa",01/09/2026,08/09/2026,completos,módulo 2,Al día,01/10/2026,,Sí,x,,Firmado,Argentina,Mariano,firmado y subido a drive';
const CSV_CLIENTES = [
  COLS_CLIENTES,
  FILA_ANA,
  /* Beto: sin mail, con N.º; dos programas; ya egresó (el egreso es anterior a hoy). */
  '2,Beto Pérez,01/03/2025,01/09/2025,35,backend,+56 9 1111 2222,,,,"Hackear Biz, Principals",,6,,,,,sin acceso,avanzando,,,,,,,pendiente,Chile,Dante,Enviado',
  /* Sin nombre: no entra. */
  ',,,,,,,,,nadie@mail.com,,,,,,,,,,,,,,,,,,,',
  /* Cris: la edad y el mail están mal escritos; se ignoran y se avisa. */
  '3,Cris Ríos,15/09/2026,,abc,,,,,esto-no-es-un-mail,,,,,,,,,,,,,,,,,,,',
  /* Dani repite el N.º 1: no se pisa. */
  '1,Dani Díaz,10/09/2026,,28,,,,,dani@mail.com,,,,,,,,,,,,,,,,,,,',
].join("\n");

test("importar Clientes: la fila de una venta completa su ficha, la nueva crea su alumno y lo malo se descarta o se avisa", () => {
  const e = estado();
  const p = planificarImportacionCs(e, [tabla("Clientes", CSV_CLIENTES)], OP);

  const c = p.porTabla.clientes;
  assert.deepEqual([c.filas, c.nuevas, c.actualizadas, c.iguales, c.descartadas], [5, 3, 1, 0, 1]);
  assert.deepEqual(p.descartadas, [{ tabla: "clientes", fila: 4, motivo: "No tiene nombre." }]);

  /* Ana: el alumno de la app (por el mail), con su ficha completa. */
  assert.equal(p.alumnos.some((a) => a.id === "a1" && a.pais === "Argentina"), true, "se completa el país que le faltaba");
  assert.equal(p.alumnos.filter((a) => a.nombre === "Ana López").length, 1, "no se duplica");
  const ana = p.seguimientos.find((s) => s.alumnoId === "a1")!;
  assert.deepEqual(
    [ana.numero, ana.edad, ana.stack, ana.telefono, ana.dni, ana.domicilio, ana.programas, ana.planDePago, ana.duracionMeses, ana.sesionesMentor, ana.notas],
    [1, 29, "Full Stack", "+54 9 11 5555 1111", "30.111.222", "Av. Siempre Viva 742", ["Hackear IT"], "3 cuotas", 3, 2, "Muy activa"],
  );
  assert.deepEqual(
    [ana.contactoInicial, ana.contactoSemana, ana.ultimoContacto, ana.acceso, ana.followUp, ana.accesoWhatsapp, ana.accesoZoom, ana.accesoWibo, ana.contratoFirmado, ana.estadoContrato, ana.closerNombre],
    ["2026-09-01", "2026-09-08", "2026-10-01", "Completos", "Módulo 2", true, true, false, "Firmado", "Firmado y subido a Drive", "Mariano"],
  );
  assert.deepEqual(ana.reporteManual, { completo: true, activo: true, semanasSin: 0, en: "2026-10-09" });

  /* Beto: no estaba, nace egresado (su egreso es anterior a hoy), con sus dos programas. */
  const beto = p.alumnos.find((a) => a.nombre === "Beto Pérez")!;
  assert.match(beto.id, /^alu_cs_/);
  assert.deepEqual([beto.estado, beto.plan, beto.pais, beto.inicio], ["graduado", "Hackear Biz", "Chile", "2025-03-01"]);
  const sb = p.seguimientos.find((s) => s.alumnoId === beto.id)!;
  assert.deepEqual([sb.numero, sb.programas, sb.duracionMeses, sb.fechaEgreso, sb.acceso, sb.followUp, sb.contratoFirmado, sb.estadoContrato, sb.closerNombre, sb.stack],
    [2, ["Hackear Biz", "Principals"], 6, "2025-09-01", "Sin acceso", "Avanzando", "Pendiente", "Enviado", "Dante", "Backend"]);

  /* Cris: lo que no se entiende se ignora y se avisa; entra igual. */
  const cris = p.alumnos.find((a) => a.nombre === "Cris Ríos")!;
  assert.equal(cris.email, "", "el mail mal escrito no entra");
  assert.equal(p.seguimientos.find((s) => s.alumnoId === cris.id)!.edad, null);
  assert.ok(p.avisos.some((a) => /fila 5.*esto-no-es-un-mail.*no parece un mail/.test(a)), p.avisos.join("\n"));
  assert.ok(p.avisos.some((a) => /fila 5.*abc.*edad/.test(a)));

  /* Dani: el N.º 1 ya es de Ana; queda con el siguiente libre. */
  const dani = p.alumnos.find((a) => a.nombre === "Dani Díaz")!;
  const sd = p.seguimientos.find((s) => s.alumnoId === dani.id)!;
  assert.ok(sd.numero !== null && sd.numero > 3, `el siguiente libre, no ${sd.numero}`);
  assert.ok(p.avisos.some((a) => /fila 6.*N\.º 1 ya lo tiene otro alumno/.test(a)));
  const numeros = p.seguimientos.map((s) => s.numero);
  assert.equal(new Set(numeros).size, numeros.length, "ningún N.º repetido");
});

test("reimportar el mismo archivo no escribe nada ni duplica", () => {
  const e0 = estado();
  const t = tabla("Clientes", CSV_CLIENTES);
  const p1 = planificarImportacionCs(e0, [t], OP);
  const e1 = aplicar(e0, p1);
  const p2 = planificarImportacionCs(e1, [t], { ...OP, ahora: "2026-10-10T12:00:00.000Z" });
  const c = p2.porTabla.clientes;
  assert.deepEqual([c.nuevas, c.actualizadas, c.iguales, c.descartadas], [0, 0, 4, 1]);
  assert.equal(escribe(p2), 0, "nada para escribir");
  const e2 = aplicar(e1, p2);
  assert.equal(e2.alumnos.length, e1.alumnos.length);
  assert.equal((e2.seguimientos ?? []).length, (e1.seguimientos ?? []).length);
});

test("por defecto sólo se completa lo vacío; si se pide, el archivo manda", () => {
  const e0 = estado();
  const t = tabla("Clientes", CSV_CLIENTES);
  let e = aplicar(e0, planificarImportacionCs(e0, [t], OP));
  /* El equipo corrige a mano el stack y el mail de Ana. */
  e = { ...e, seguimientos: (e.seguimientos ?? []).map((s) => (s.alumnoId === "a1" ? { ...s, stack: "Backend", notas: "" } : s)), alumnos: e.alumnos.map((a) => (a.id === "a1" ? { ...a, email: "ana.nueva@mail.com" } : a)) };

  const completar = planificarImportacionCs(e, [t], OP);
  const sc = completar.seguimientos.find((s) => s.alumnoId === "a1")!;
  assert.equal(sc.stack, "Backend", "lo que se corrigió en la app no se pisa");
  assert.equal(sc.notas, "Muy activa", "lo que estaba vacío se completa");
  /* Ana ahora se encuentra por su N.º 1 aunque el mail del archivo no coincide con el nuevo. */
  assert.equal(completar.alumnos.some((a) => a.nombre === "Ana López" && a.id !== "a1"), false);

  const pisar = planificarImportacionCs(e, [t], { ...OP, modo: "pisar" });
  assert.equal(pisar.seguimientos.find((s) => s.alumnoId === "a1")!.stack, "Full Stack", "el archivo manda");
});

test("una fila sin mail se busca por su N.º o por un nombre que sea de uno solo; si hay dos, no se adivina", () => {
  const e = estado({
    alumnos: [
      { id: "a1", nombre: "Ana López", email: "ana@mail.com", estado: "activo", inicio: "2026-08-31T12:00:00.000Z", extra: {} },
      { id: "a2", nombre: "Juan Gómez", email: "juan1@mail.com", estado: "activo", inicio: "2026-08-31T12:00:00.000Z", extra: {} },
      { id: "a3", nombre: "juan gómez", email: "juan2@mail.com", estado: "activo", inicio: "2026-08-31T12:00:00.000Z", extra: {} },
    ] as never,
    leads: [], contactos: [], ventas: [],
  });
  const csv = [COLS_CLIENTES, ",ANA LOPEZ,,,41,,,,,,,,,,,,,,,,,,,,,,,,", ",Juan Gómez,,,50,,,,,,,,,,,,,,,,,,,,,,,,"].join("\n");
  const p = planificarImportacionCs(e, [tabla("Clientes", csv)], OP);
  assert.equal(p.alumnos.length, 0, "no se creó nadie: Ana es Ana y Juan es ambiguo");
  assert.equal(p.seguimientos.find((s) => s.alumnoId === "a1")!.edad, 41, "ANA LOPEZ es Ana López (sin tildes ni mayúsculas)");
  assert.ok(p.avisos.some((a) => /fila 2.*por su nombre/.test(a)));
  assert.deepEqual(p.descartadas.map((d) => [d.fila, /más de un alumno/.test(d.motivo)]), [[3, true]]);
});

/* ---------- Testimonios ---------- */

const CSV_TESTIMONIOS = [
  COLS_TESTIMONIOS,
  'Ana López,29,31/08/2026,+54 911 5555-1111,Llamada agendada,05/10/2026,yari,renueva,subido a youtube,https://youtu.be/x1,"React, Node",full stack,"Sin trabajo","Dev en una fintech","Gran caso",Argentina',
  'Ana López,,,,,,Mariano,,pendiente de subir,,,,,,Segundo testimonio,',
  'Beto Pérez,35,,,no agendada,,,,,,,backend,,,,Chile',
  'Zoe Nueva,22,01/02/2026,+54 9 11 0000 1111,no quiere grabar,,,,no quiso grabar,,,,,,,Uruguay',
].join("\n");

test("importar Testimonios: se busca al alumno por su teléfono o su nombre, las listas se llevan a sus opciones y uno puede tener más de uno", () => {
  const eClientes = estado();
  const conBeto = aplicar(eClientes, planificarImportacionCs(eClientes, [tabla("Clientes", CSV_CLIENTES)], OP));
  const p = planificarImportacionCs(conBeto, [tabla("Testimonios", CSV_TESTIMONIOS)], OP);
  const c = p.porTabla.testimonios;
  assert.deepEqual([c.filas, c.nuevas, c.descartadas], [4, 4, 0]);

  const ana = p.testimonios.filter((t) => t.alumnoId === "a1");
  assert.deepEqual(ana.map((t) => t.id).sort(), ["tes_cs_a1_1", "tes_cs_a1_2"]);
  const t1 = ana.find((t) => t.id === "tes_cs_a1_1")!;
  assert.deepEqual(
    [t1.followUp, t1.fechaGrabacion, t1.conQuien, t1.resell, t1.estadoVideo, t1.link, t1.tecnologias, t1.situacionPrevia, t1.situacionActual, t1.notas],
    ["Llamada agendada", "2026-10-05", "Yari", "Renueva", "Subido a YouTube", "https://youtu.be/x1", "React, Node", "Sin trabajo", "Dev en una fintech", "Gran caso"],
  );
  assert.equal(ana.find((t) => t.id === "tes_cs_a1_2")!.estadoVideo, "Pendiente de subir");
  assert.equal("estado" in t1, false);

  /* Zoe no estaba: se crea como egresada con lo que trae el testimonio. */
  const zoe = p.alumnos.find((a) => a.nombre === "Zoe Nueva")!;
  assert.deepEqual([zoe.estado, zoe.pais, zoe.inicio], ["graduado", "Uruguay", "2026-02-01"]);
  assert.equal(p.alumnosCreadosPorOtraTabla, 1);
  assert.equal(p.seguimientos.find((s) => s.alumnoId === zoe.id)!.edad, 22, "la edad del testimonio completa su ficha");
});

test("un testimonio de un alumno que no está se descarta si no se pidió crearlo, y reimportar no duplica", () => {
  const e = estado();
  const t = tabla("Testimonios", CSV_TESTIMONIOS);
  const sin = planificarImportacionCs(e, [t], { ...OP, crearFaltantes: false });
  assert.deepEqual(sin.testimonios.map((x) => x.alumnoId), ["a1", "a1"], "sólo los de Ana");
  assert.deepEqual(sin.descartadas.map((d) => d.fila), [4, 5]);
  assert.match(sin.descartadas[0].motivo, /no está entre los alumnos/);

  const p1 = planificarImportacionCs(e, [t], OP);
  const e1 = aplicar(e, p1);
  const p2 = planificarImportacionCs(e1, [t], OP);
  assert.equal(p2.porTabla.testimonios.nuevas, 0);
  assert.equal(p2.porTabla.testimonios.iguales, 4);
  assert.equal(p2.testimonios.length, 0, "nada que escribir");
  assert.equal((e1.testimonios ?? []).length, 4);
  /* No se crean alumnos de nuevo: Zoe ya está (por su nombre). */
  assert.equal(p2.alumnosCreadosPorOtraTabla, 0);
  assert.equal(p2.alumnos.length, 0);
});

test("lo que el equipo corrigió en un testimonio no se pisa al reimportar", () => {
  const e0 = estado();
  const t = tabla("Testimonios", CSV_TESTIMONIOS);
  let e = aplicar(e0, planificarImportacionCs(e0, [t], OP));
  e = { ...e, testimonios: (e.testimonios ?? []).map((x) => (x.id === "tes_cs_a1_1" ? { ...x, estadoVideo: "Subido a Drive", link: "https://drive/nuevo" } : x)) };
  const p = planificarImportacionCs(e, [t], OP);
  assert.equal(p.testimonios.find((y) => y.id === "tes_cs_a1_1"), undefined, "no hay nada vacío que completar: queda como lo dejó el equipo");
  const pisar = planificarImportacionCs(e, [t], { ...OP, modo: "pisar" });
  assert.equal(pisar.testimonios.find((y) => y.id === "tes_cs_a1_1")!.estadoVideo, "Subido a YouTube");
});

/* ---------- Agenda de resells ---------- */

const CSV_RESELLS = [
  COLS_RESELLS,
  /* Ya la trajo Calendly (Ana, ese día): se completa el estado, el cash y el caso. */
  '07/10/2026 15:30,Ana López,ANA@mail.com,,,renueva,"US$ 1.200,50",Sí,"Renovó por 6 meses"',
  /* Nueva, con un caso de éxito que es un link y no un sí/no. */
  '12/10/2026 11:00,Luis Soto,luis@mail.com,+54 9 11 2222 3333,Mariano,no renueva,,https://caso.example/luis,',
  /* Sin fecha: no entra. */
  ',Nadie,nadie@mail.com,,,,,,',
  /* Fecha ilegible: no entra. */
  'pronto,Otro,otro@mail.com,,,,,,',
].join("\n");

test("importar la Agenda de resells: la que ya trajo Calendly se completa, las nuevas se crean y no se duplican", () => {
  const e = estado({
    resells: [{ id: "rs_ses1", sesionId: "ses1", fechaHora: "2026-10-07T18:30:00.000Z", nombre: "Ana López", email: "ana@mail.com", telefono: "+54 9 11 5555 1111", closer: "Mariano", estado: "", cashCollect: null, casoDeExito: false, notas: "", cancelada: false, origen: "calendly", creadoEn: "2026-10-01T10:00:00.000Z", actualizadoEn: "2026-10-01T10:00:00.000Z", actualizadoPor: "" }] as never,
  });
  const t = tabla("Agenda de resells", CSV_RESELLS);
  const p = planificarImportacionCs(e, [t], OP);
  const c = p.porTabla.resells;
  assert.deepEqual([c.filas, c.nuevas, c.actualizadas, c.descartadas], [4, 1, 1, 2]);
  assert.deepEqual(p.descartadas.map((d) => d.fila), [4, 5]);

  const ana = p.resells.find((r) => r.id === "rs_ses1")!;
  assert.deepEqual([ana.estado, ana.cashCollect, ana.casoDeExito, ana.notas], ["Renueva", 1200.5, true, "Renovó por 6 meses"]);
  assert.deepEqual([ana.origen, ana.sesionId, ana.closer, ana.telefono, ana.fechaHora], ["calendly", "ses1", "Mariano", "+54 9 11 5555 1111", "2026-10-07T18:30:00.000Z"], "lo de Calendly manda");

  const luis = p.resells.find((r) => r.nombre === "Luis Soto")!;
  assert.match(luis.id, /^rs_imp_/);
  assert.deepEqual([luis.origen, luis.estado, luis.fechaHora, luis.closer, luis.casoDeExito], ["importado", "No renueva", "2026-10-12T14:00:00.000Z", "Mariano", true]);
  assert.match(luis.notas, /Caso de éxito: https:\/\/caso\.example\/luis/, "lo que no es sí o no queda en las notas");

  const e1 = aplicar(e, p);
  const p2 = planificarImportacionCs(e1, [t], OP);
  assert.deepEqual([p2.porTabla.resells.nuevas, p2.porTabla.resells.actualizadas, p2.porTabla.resells.iguales], [0, 0, 2]);
  assert.equal(escribe(p2), 0);
});

test("en la agenda, lo que Customer Success ya cargó no se pisa salvo que se pida", () => {
  const ya = { id: "rs_ses1", sesionId: "ses1", fechaHora: "2026-10-07T18:30:00.000Z", nombre: "Ana López", email: "ana@mail.com", telefono: "", closer: "", estado: "No renueva", cashCollect: 300, casoDeExito: false, notas: "Lo pensó mejor", cancelada: false, origen: "calendly", creadoEn: "x", actualizadoEn: "x", actualizadoPor: "" };
  const e = estado({ resells: [ya] as never });
  const t = tabla("Agenda de resells", CSV_RESELLS);
  const completar = planificarImportacionCs(e, [t], OP).resells.find((r) => r.id === "rs_ses1")!;
  assert.deepEqual([completar.estado, completar.cashCollect, completar.notas], ["No renueva", 300, "Lo pensó mejor"], "lo cargado se respeta");
  assert.equal(completar.casoDeExito, true, "lo que estaba sin marcar se completa");
  const pisar = planificarImportacionCs(e, [t], { ...OP, modo: "pisar" }).resells.find((r) => r.id === "rs_ses1")!;
  assert.deepEqual([pisar.estado, pisar.cashCollect, pisar.casoDeExito], ["Renueva", 1200.5, true]);
});

/* ---------- Reportes semanales ---------- */

const CSV_REPORTES = [
  "Alumno,Mail,Semana,Horas de estudio,Entrevistas,Postulaciones,Bloqueo",
  "Ana López,ana@mail.com,08/10/2026,12,1,5,Nada",
  "Ana López,ana@mail.com,06/10/2026,9,,,",
  "Ana López,ana@mail.com,01/10/2026,10,2,8,",
  "Sin Alumno,,07/10/2026,3,,,",
  "Ana López,ana@mail.com,algún día,1,,,",
].join("\n");

test("importar Reportes: cada uno cae en el lunes de su semana, uno por alumno y semana, y no duplica", () => {
  const e = estado();
  const t = tabla("Results", CSV_REPORTES);
  assert.equal(t.tipo, "reportes");
  const p = planificarImportacionCs(e, [t], { ...OP, crearFaltantes: false });
  const c = p.porTabla.reportes;
  /* El 08/10/2026 (jueves) y el 06/10 (martes) son de la semana del lunes 05/10; el 01/10 es de la del 28/09. */
  assert.deepEqual([c.filas, c.nuevas, c.iguales, c.descartadas], [5, 2, 1, 2]);
  assert.deepEqual(p.reportes.map((r) => [r.alumnoId, r.semanaDel, r.horasEstudio, r.entrevistas, r.postulaciones, r.bloqueo, r.estado]).sort(),
    [["a1", "2026-09-28", 10, 2, 8, undefined, "completado"], ["a1", "2026-10-05", 12, 1, 5, "Nada", "completado"]].sort());
  assert.deepEqual(p.reportes.map((r) => r.id).sort(), ["rep_cs_a1_2026-09-28", "rep_cs_a1_2026-10-05"]);
  assert.equal(p.descartadas.length, 2);
  assert.match(p.descartadas.find((d) => d.fila === 5)!.motivo, /no está entre los alumnos/);
  assert.match(p.descartadas.find((d) => d.fila === 6)!.motivo, /no se entendió como fecha/);

  const e1 = aplicar(e, p);
  const p2 = planificarImportacionCs(e1, [t], { ...OP, crearFaltantes: false });
  assert.deepEqual([p2.porTabla.reportes.nuevas, p2.porTabla.reportes.iguales], [0, 3]);
  assert.equal(p2.reportes.length, 0);
});

test("un reporte que ya estaba cargado (por la app) para esa semana no se vuelve a cargar", () => {
  const e = estado({ reportes: [{ id: "r_viejo", alumnoId: "a1", semanaDel: "2026-10-06", estado: "completado" }] as never });
  const p = planificarImportacionCs(e, [tabla("Results", CSV_REPORTES)], { ...OP, crearFaltantes: false });
  assert.deepEqual(p.reportes.map((r) => r.semanaDel), ["2026-09-28"], "la semana del 05/10 ya tenía reporte (cargado un martes)");
});

/* ---------- Varias tablas juntas ---------- */

test("las tres tablas juntas: el testimonio y la agenda encuentran a quien trajo Clientes en la misma importación", () => {
  const e = estado();
  const p = planificarImportacionCs(e, [tabla("Clientes", CSV_CLIENTES), tabla("Testimonios", CSV_TESTIMONIOS), tabla("Agenda de resells", CSV_RESELLS)], OP);
  const beto = p.alumnos.find((a) => a.nombre === "Beto Pérez")!;
  assert.ok(p.testimonios.some((t) => t.alumnoId === beto.id), "el testimonio de Beto va con el alumno que se acaba de crear");
  assert.equal(p.alumnos.filter((a) => a.nombre === "Beto Pérez").length, 1);
  assert.equal(p.alumnosCreadosPorOtraTabla, 1, "sólo Zoe, que no estaba en Clientes");
  assert.equal(new Set(p.alumnos.map((a) => a.id)).size, p.alumnos.length);
  assert.equal(new Set(p.seguimientos.map((s) => s.alumnoId)).size, p.seguimientos.length, "una ficha por alumno");
  const e1 = aplicar(e, p);
  const p2 = planificarImportacionCs(e1, [tabla("Clientes", CSV_CLIENTES), tabla("Testimonios", CSV_TESTIMONIOS), tabla("Agenda de resells", CSV_RESELLS)], OP);
  assert.equal(escribe(p2), 0, "la segunda vez no hay nada para escribir");
});
