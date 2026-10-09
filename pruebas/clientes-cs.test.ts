import test from "node:test";
import assert from "node:assert/strict";
import {
  aplicarEscritura, coincideCliente, COLUMNAS_CLIENTES, esLlamadaDeResell, escrituraCliente, filasClientes, filasResells, filasTestimonios,
  idResell, LISTAS_POR_DEFECTO, listasCs, MOTOR_CLIENTES, MOTOR_RESELLS, MOTOR_TESTIMONIOS, planDePagoDe, programasDeTexto, reporteDeCliente,
  resellNormal, resumenClientes, seguimientoCompleto, siguienteNumero, sumarMeses, testimonioNormal, valorDeLista, valorEditableCliente,
  VISIBLES_CLIENTES, type ClaveCliente, type FilaCliente,
} from "@/lib/clientes-cs";
import { CONFIG_POR_DEFECTO, configSeguimiento, seguimientoVacio } from "@/lib/seguimiento";
import { hoyDelNegocio, lunesDelDia, sumarDias } from "@/lib/reportes";
import type { EstadoApp, SeguimientoAlumno } from "@/lib/types";

const CFG = CONFIG_POR_DEFECTO;
const HOY = hoyDelNegocio();

/* Un estado mínimo con tres alumnos: Ana (de una venta de Mentoría con closer y cuotas, con contacto y edad en la llamada),
   Beto (importado: sin venta, con closer escrito) y Eli (egresada). */
function estado(extra: Partial<EstadoApp> = {}): EstadoApp {
  const alumno = (id: string, nombre: string, extraA: Record<string, unknown> = {}) => ({
    id, nombre, email: `${nombre.toLowerCase()}@mail.com`, estado: "activo", inicio: "2026-08-31T12:00:00.000Z", cohorte: "", plan: "", extra: {}, ...extraA,
  });
  return {
    ajustes: {},
    alumnos: [
      alumno("a1", "Ana", { leadId: "l1", ventaId: "v1", plan: "Mentoría", pais: "" }),
      alumno("a2", "Beto", { pais: "Chile" }),
      alumno("a3", "Eli", { estado: "graduado", inicio: "2025-01-10T12:00:00.000Z" }),
    ],
    leads: [{ id: "l1", nombre: "Ana", email: "ana@mail.com", contactoId: "c1" }],
    contactos: [{ id: "c1", nombre: "Ana", email: "ana@mail.com", telefono: "+54 9 11 5555 1111", pais: "Argentina", tecnologias: "React y Node" }],
    ventas: [{ id: "v1", contactoId: "l1", contactoNombre: "Ana", productoId: "p1", closerId: "m1", estado: "activa", fecha: "2026-08-31T12:00:00.000Z", moneda: "USD" }],
    cuotas: [
      { id: "q0", ventaId: "v1", numero: 0, esReserva: true, estado: "pagada", monto: 100 },
      { id: "q1", ventaId: "v1", numero: 1, esReserva: false, estado: "pagada", monto: 500 },
      { id: "q2", ventaId: "v1", numero: 2, esReserva: false, estado: "pendiente", monto: 500 },
      { id: "q3", ventaId: "v1", numero: 3, esReserva: false, estado: "cancelada", monto: 500 },
    ],
    productos: [{ id: "p1", nombre: "Mentoría" }],
    equipo: [{ id: "m1", nombre: "Mariano", rol: "closer", activo: true }, { id: "m2", nombre: "Aldana", rol: "otro", activo: true }],
    etapasServicio: [{ id: "e1", nombre: "Onboarding", orden: 1 }, { id: "e2", nombre: "Módulo 1", orden: 2 }],
    reportes: [],
    sesiones: [{ id: "s1", contactoId: "c1", inicia: "2026-08-20T15:00:00.000Z", respuestas: [{ pregunta: "¿Qué edad tenés?", respuesta: "29 años" }] }],
    seguimientos: [],
    testimonios: [],
    resells: [],
    ...extra,
  } as unknown as EstadoApp;
}
const fila = (e: EstadoApp, id: string): FilaCliente => filasClientes(e, HOY).find((f) => f.id === id)!;
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CFG), ...c });

/* ---------- Las listas ---------- */

test("las listas son las de Lili y se pueden ajustar sin perder las que no se tocan", () => {
  const d = listasCs();
  assert.deepEqual(d.stacks, ["Frontend", "Backend", "Full Stack", "Data Engineer", "Mobile Developer"]);
  assert.deepEqual(d.programas, ["Hackear IT", "Hackear Biz", "Principals", "Principal Mastermind"]);
  assert.equal(d.followUps.length, 1 + 13 + 1 + 1 + 3, "onboarding, módulos 0 a 12, módulo IA, Take Home Challenge y avanzando / no avanzando / no contesta");
  assert.ok(d.followUps.includes("Módulo 12") && d.followUps.includes("Take Home Challenge"));
  assert.deepEqual(d.estadosVideo, ["Pendiente de subir", "Subido a Drive", "No quiso grabar", "Subido a YouTube"]);

  const ajustadas = listasCs({ listas: { stacks: ["  Frontend ", "frontend", "", "QA"], programas: [] } as never });
  assert.deepEqual(ajustadas.stacks, ["Frontend", "QA"], "sin repetidos ni vacíos");
  assert.deepEqual(ajustadas.programas, LISTAS_POR_DEFECTO.programas, "una lista vacía no es un ajuste");
  assert.deepEqual(ajustadas.accesos, LISTAS_POR_DEFECTO.accesos);
  /* La configuración la conserva saneada. */
  const cfg = configSeguimiento({ listas: { stacks: ["QA", "QA"], basura: ["x"] } as never });
  assert.deepEqual(cfg.listas, { stacks: ["QA"] });
  assert.equal(configSeguimiento({}).listas, undefined);
});

test("un texto se pasa a la opción de la lista sin importar mayúsculas, tildes ni espacios", () => {
  assert.equal(valorDeLista("full  stack", LISTAS_POR_DEFECTO.stacks), "Full Stack");
  assert.equal(valorDeLista("MÓDULO 3", LISTAS_POR_DEFECTO.followUps), "Módulo 3");
  assert.equal(valorDeLista("Algo nuevo", LISTAS_POR_DEFECTO.stacks), "Algo nuevo", "lo que no está queda tal cual");
  assert.equal(valorDeLista("   ", LISTAS_POR_DEFECTO.stacks), "");
});

/* ---------- Normalizar lo que llega ---------- */

test("una ficha de antes, o con valores raros, se completa y se sanea", () => {
  const vieja = { id: "seg_a1", alumnoId: "a1", cadenciaDias: 7, ultimoContacto: "2026-10-01", notas: "hola" } as Partial<SeguimientoAlumno> & { alumnoId: string };
  const s = seguimientoCompleto(vieja, CFG);
  assert.equal(s.cadenciaDias, 7, "lo que había se respeta");
  assert.equal(s.notas, "hola");
  assert.deepEqual([s.numero, s.edad, s.stack, s.programas, s.accesoWhatsapp, s.reporteManual], [null, null, "", [], false, null]);

  const rara = seguimientoCompleto({
    alumnoId: "a1", numero: "12" as never, edad: "" as never, programas: '["Hackear IT","Principals"]' as never, accesoWhatsapp: "true" as never,
    fechaEgreso: "2027-01-31T10:00:00Z" as never, contactoSemana: "mañana" as never, reporteManual: { completo: 1, semanasSin: "3" } as never,
  }, CFG);
  assert.equal(s.id, "seg_a1");
  assert.equal(rara.numero, 12);
  assert.equal(rara.edad, null);
  assert.deepEqual(rara.programas, ["Hackear IT", "Principals"]);
  assert.equal(rara.accesoWhatsapp, true);
  assert.equal(rara.fechaEgreso, "2027-01-31");
  assert.equal(rara.contactoSemana, null, "una fecha que no es un día no se guarda");
  assert.deepEqual(rara.reporteManual, { completo: true, activo: true, semanasSin: 3, en: "" });
  /* Completar dos veces da lo mismo. */
  assert.deepEqual(seguimientoCompleto(rara, CFG), rara);
});

test("los testimonios del primer modelo pasan a las columnas nuevas", () => {
  const pedido = testimonioNormal({ id: "t1", alumnoId: "a1", estado: "pedido", fecha: "2026-10-01", link: "", notas: "n", creadoEn: "x" } as never);
  assert.deepEqual([pedido.followUp, pedido.estadoVideo, pedido.fechaGrabacion], ["Pendiente de agendar", "", null]);
  const grabado = testimonioNormal({ id: "t2", alumnoId: "a1", estado: "grabado", fecha: "2026-10-02" } as never);
  assert.deepEqual([grabado.followUp, grabado.estadoVideo, grabado.fechaGrabacion], ["Llamada agendada", "Pendiente de subir", "2026-10-02"]);
  const publicado = testimonioNormal({ id: "t3", alumnoId: "a1", estado: "publicado", fecha: "2026-10-03", link: " https://y.tube/x " } as never);
  assert.deepEqual([publicado.estadoVideo, publicado.link], ["Subido a YouTube", "https://y.tube/x"]);
  /* Los nuevos mandan sobre los viejos. */
  const nuevo = testimonioNormal({ id: "t4", alumnoId: "a1", estado: "pedido", followUp: "No quiere grabar", estadoVideo: "No quiso grabar" } as never);
  assert.deepEqual([nuevo.followUp, nuevo.estadoVideo], ["No quiere grabar", "No quiso grabar"]);
  assert.equal("estado" in nuevo, false, "ya no se escribe el primer modelo");
});

test("un resell tiene todas sus columnas y entiende lo que viene de la base", () => {
  const r = resellNormal({ id: "rs_x", cashCollect: "1200.5" as never, casoDeExito: "t" as never, origen: "otro" as never, cancelada: undefined });
  assert.deepEqual([r.cashCollect, r.casoDeExito, r.origen, r.cancelada, r.estado, r.sesionId], [1200.5, true, "manual", false, "", null]);
});

/* ---------- Lo que se calcula ---------- */

test("sumar meses no se pasa del fin de mes ni del año", () => {
  assert.equal(sumarMeses("2026-08-31", 3), "2026-11-30");
  assert.equal(sumarMeses("2026-09-30", 5), "2027-02-28");
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(sumarMeses("2027-12-15", 1), "2028-01-15");
  assert.equal(sumarMeses("2026-10-07", 12), "2027-10-07");
  assert.equal(sumarMeses("2024-01-31", 1), "2024-02-29", "bisiesto");
});

test("el plan de pago sale de las cuotas de la venta", () => {
  assert.equal(planDePagoDe([]), "");
  assert.equal(planDePagoDe([{ esReserva: false, estado: "pendiente" }]), "Pago único");
  assert.equal(planDePagoDe([{ esReserva: false, estado: "pagada" }, { esReserva: false, estado: "pendiente" }, { esReserva: false, estado: "cancelada" }]), "2 cuotas");
  assert.equal(planDePagoDe([{ esReserva: true, estado: "pagada" }, { esReserva: false, estado: "pendiente" }, { esReserva: false, estado: "pendiente" }, { esReserva: false, estado: "pendiente" }]), "3 cuotas + reserva");
  assert.equal(planDePagoDe([{ esReserva: true, estado: "pagada" }]), "Reserva");
});

test("el programa se sugiere por el nombre del servicio, y sólo se sugiere", () => {
  assert.deepEqual(programasDeTexto("Mentoría"), ["Hackear IT"]);
  assert.deepEqual(programasDeTexto("Resell Mentoría"), ["Hackear IT"]);
  assert.deepEqual(programasDeTexto("Mastermind"), ["Principal Mastermind"]);
  assert.deepEqual(programasDeTexto("Principals"), ["Principals"]);
  assert.deepEqual(programasDeTexto("hackear biz"), ["Hackear Biz"]);
  assert.deepEqual(programasDeTexto("Upgrade AI"), []);
  assert.deepEqual(programasDeTexto(""), []);
});

test("el reporte semanal sale de los reportes; sin reportes, de lo marcado a mano; sin nada, sin datos", () => {
  const activo = { estado: "activo" as const };
  assert.deepEqual(reporteDeCliente(activo, { reporteManual: null }, true, 0), { estado: "Al día", semanasSin: 0, origen: "reportes" });
  assert.equal(reporteDeCliente(activo, { reporteManual: null }, true, 1).estado, "Atrasado");
  assert.equal(reporteDeCliente(activo, { reporteManual: null }, true, 2).estado, "Atrasado");
  assert.equal(reporteDeCliente(activo, { reporteManual: null }, true, 3).estado, "Inactivo");
  assert.equal(reporteDeCliente({ estado: "graduado" }, { reporteManual: null }, true, undefined).estado, "Sin datos", "un egresado ya no debe reporte");
  /* Los reportes mandan sobre lo marcado a mano. */
  assert.equal(reporteDeCliente(activo, { reporteManual: { completo: false, activo: false, semanasSin: 9, en: "" } }, true, 0).estado, "Al día");
  assert.deepEqual(reporteDeCliente(activo, { reporteManual: { completo: true, activo: true, semanasSin: 4, en: "" } }, false, undefined), { estado: "Al día", semanasSin: 0, origen: "manual" });
  assert.deepEqual(reporteDeCliente(activo, { reporteManual: { completo: false, activo: true, semanasSin: 2, en: "" } }, false, undefined), { estado: "Atrasado", semanasSin: 2, origen: "manual" });
  assert.equal(reporteDeCliente(activo, { reporteManual: { completo: false, activo: false, semanasSin: 0, en: "" } }, false, undefined).estado, "Inactivo");
  assert.deepEqual(reporteDeCliente(activo, { reporteManual: null }, false, undefined), { estado: "Sin datos", semanasSin: null, origen: "sin-datos" });
});

test("el N.º de alumno que sigue es el más alto más uno", () => {
  assert.equal(siguienteNumero([]), 1);
  assert.equal(siguienteNumero([{ numero: null }, { numero: 7 }, { numero: 3 }]), 8);
  assert.equal(siguienteNumero([{ numero: "12" as never }]), 13);
});

/* ---------- Las filas de Clientes ---------- */

test("un cliente que viene de una venta trae el programa, el closer, el plan de pago y el egreso sugeridos", () => {
  const f = fila(estado(), "a1");
  assert.deepEqual(f.programas, ["Hackear IT"]);
  assert.equal(f.programasSugeridos, true);
  assert.equal(f.closer, "Mariano");
  assert.equal(f.closerDeVenta, true);
  assert.equal(f.plan, "2 cuotas + reserva");
  assert.equal(f.planSugerido, true);
  assert.equal(f.duracion, 3);
  assert.equal(f.duracionSugerida, true);
  assert.equal(f.inicio, "2026-08-31");
  assert.equal(f.egreso, "2026-11-30", "inicio más 3 meses");
  assert.equal(f.egresoSugerido, true);
  assert.equal(f.telefono, "+54 9 11 5555 1111", "el teléfono es de la persona");
  assert.equal(f.pais, "Argentina", "sin país en el alumno, el del contacto");
  assert.equal(f.edad, 29);
  assert.equal(f.edadSugerida, true, "la edad que contestó al agendar");
  assert.equal(f.etapa, "Onboarding", "sin etapa, la primera");
  assert.equal(f.numero, null);
});

test("lo que Customer Success cargó manda sobre lo sugerido, y un alumno importado trae su closer escrito", () => {
  const e = estado({
    seguimientos: [
      seg("a1", { programas: ["Principals"], duracionMeses: 12, fechaEgreso: "2027-09-01", planDePago: "Pago único", edad: 31, numero: 4, telefono: "otro" }),
      seg("a2", { closerNombre: "Dante", telefono: "+56 9 1111 2222", stack: "Backend", acceso: "Completos", contratoFirmado: "Firmado", accesoZoom: true }),
    ],
  });
  const a = fila(e, "a1");
  assert.deepEqual([a.programas, a.programasSugeridos, a.duracion, a.duracionSugerida, a.egreso, a.egresoSugerido, a.plan, a.planSugerido, a.edad, a.edadSugerida, a.numero],
    [["Principals"], false, 12, false, "2027-09-01", false, "Pago único", false, 31, false, 4]);
  assert.equal(a.telefono, "+54 9 11 5555 1111", "el contacto de la app manda sobre el de la ficha");
  const b = fila(e, "a2");
  assert.deepEqual([b.closer, b.closerDeVenta, b.telefono, b.stack, b.acceso, b.contrato, b.zoom, b.wpp], ["Dante", false, "+56 9 1111 2222", "Backend", "Completos", "Firmado", true, false]);
  assert.deepEqual(b.programas, [], "Beto no tiene servicio: nada que sugerir");
  assert.equal(b.egreso, null);
  assert.equal(b.pais, "Chile");
});

test("el reporte de un cliente usa los reportes de verdad: sin ninguno, no inventa atrasos", () => {
  const sin = fila(estado(), "a1");
  assert.deepEqual(sin.reporte, { estado: "Sin datos", semanasSin: null, origen: "sin-datos" });

  const lunes = lunesDelDia(HOY);
  const e = estado({
    reportes: [
      { id: "r1", alumnoId: "a1", semanaDel: lunes, estado: "completado" },
      { id: "r2", alumnoId: "a2", semanaDel: sumarDias(lunes, -21), estado: "completado" },
    ] as never,
    seguimientos: [seg("a3", { reporteManual: { completo: true, activo: true, semanasSin: 0, en: HOY } })],
  });
  assert.equal(fila(e, "a1").reporte.estado, "Al día");
  const beto = fila(e, "a2");
  assert.equal(beto.reporte.estado, "Inactivo", "completó hace tres semanas y desde entonces nada");
  assert.ok((beto.reporte.semanasSin ?? 0) >= 3);
  const eli = fila(e, "a3").reporte;
  assert.deepEqual([eli.estado, eli.origen], ["Al día", "manual"], "sin reportes, lo marcado a mano");
});

test("el estado, la situación y el testimonio de cada cliente", () => {
  const e = estado({
    seguimientos: [seg("a2", { cadenciaDias: 7, ultimoContacto: sumarDias(HOY, -10) })],
    testimonios: [
      { id: "t1", alumnoId: "a2", estado: "pedido", fecha: null, creadoEn: "2026-09-01T10:00:00.000Z" },
      { id: "t2", alumnoId: "a2", estadoVideo: "Subido a YouTube", followUp: "Llamada agendada", creadoEn: "2026-10-01T10:00:00.000Z" },
    ] as never,
  });
  const b = fila(e, "a2");
  assert.equal(b.situacion, "vencido");
  assert.equal(b.atraso, 3);
  assert.equal(b.estadoAlumno, "Activo");
  assert.equal(b.testimonio, "Subido a YouTube", "el testimonio más nuevo");
  assert.equal(fila(e, "a1").testimonio, "Sin testimonio");
  assert.equal(fila(e, "a3").estadoAlumno, "Egresado");
  assert.equal(fila(e, "a3").situacion, "fuera");
  const r = resumenClientes(filasClientes(e, HOY));
  assert.deepEqual([r.activos, r.vencidos, r.cvPendiente, r.sinNumero], [2, 2, 2, 3], "Ana entró hace más de 15 días y nunca la contactaron; Beto, hace 10 y su cadencia es de 7");
});

test("la búsqueda encuentra por nombre, mail, teléfono, DNI, closer o N.º, sin tildes", () => {
  const e = estado({ seguimientos: [seg("a2", { dni: "30.111.222", numero: 17, telefono: "+56 9 1111 2222", closerNombre: "Agustín" })] });
  const filas = filasClientes(e, HOY);
  const buscar = (q: string) => filas.filter((f) => coincideCliente(f, q)).map((f) => f.nombre);
  assert.deepEqual(buscar("beto"), ["Beto"]);
  assert.deepEqual(buscar("30.111"), ["Beto"]);
  assert.deepEqual(buscar("1111 2222"), ["Beto"]);
  assert.deepEqual(buscar("agustin"), ["Beto"]);
  assert.deepEqual(buscar("17"), ["Beto"]);
  assert.deepEqual(buscar("mariano"), ["Ana"], "el closer de la venta");
  assert.deepEqual(buscar("  "), ["Ana", "Beto", "Eli"]);
});

/* ---------- El motor de tabla ---------- */

test("las 29 columnas de Lili van en su orden y las claves no se repiten", () => {
  const titulos = VISIBLES_CLIENTES.map((k) => MOTOR_CLIENTES.columna[k].titulo);
  assert.deepEqual(titulos.slice(0, 29), [
    "N.º de alumno", "Nombre y apellido", "Fecha de inicio", "Fecha de egreso", "Edad", "Stack", "Teléfono", "DNI", "Domicilio", "Mail", "Programa",
    "Plan de pago", "Duración", "Sesión con el mentor", "Comentarios", "Contacto inicial", "Contacto semana", "Acceso", "Follow-up", "Reporte semanal",
    "Último contacto", "Garantía", "Acceso WhatsApp", "Acceso Zoom", "Acceso Wibo", "Contrato firmado", "País", "Closer", "Estado del contrato",
  ]);
  assert.deepEqual(titulos.slice(29), ["CV", "LinkedIn", "Responsable del CV y LinkedIn"]);
  assert.equal(new Set(COLUMNAS_CLIENTES.map((c) => c.clave)).size, COLUMNAS_CLIENTES.length);
});

const E_VARIOS = () => estado({
  alumnos: [
    { id: "a1", nombre: "Ana", email: "ana@mail.com", estado: "activo", inicio: "2026-08-31T12:00:00.000Z", extra: {}, pais: "Argentina" },
    { id: "a2", nombre: "Beto", email: "beto@mail.com", estado: "activo", inicio: "2026-06-01T12:00:00.000Z", extra: {}, pais: "Chile" },
    { id: "a3", nombre: "Cris", email: "cris@mail.com", estado: "pausado", inicio: "2026-09-10T12:00:00.000Z", extra: {}, pais: "México" },
    { id: "a4", nombre: "Dani", email: "dani@mail.com", estado: "activo", inicio: "2026-07-15T12:00:00.000Z", extra: {}, pais: "" },
  ] as never,
  ventas: [], cuotas: [], leads: [], contactos: [], sesiones: [],
  seguimientos: [
    seg("a1", { programas: ["Hackear IT", "Principals"], duracionMeses: 3, edad: 30, sesionesMentor: 2, followUp: "Módulo 3" }),
    seg("a2", { programas: ["Hackear Biz"], duracionMeses: 6, edad: 25, sesionesMentor: 0, followUp: "Módulo 10", accesoWhatsapp: true }),
    seg("a3", { programas: ["Hackear IT"], duracionMeses: 12, edad: 41, sesionesMentor: 3 }),
    seg("a4", { programas: [], edad: null }),
  ],
});

test("los filtros por columna: elegir valores, excluirlos, texto y fechas", () => {
  const filas = filasClientes(E_VARIOS(), HOY);
  const ver = (f: Parameters<typeof MOTOR_CLIENTES.pasaFiltros>[1]) => filas.filter((x) => MOTOR_CLIENTES.pasaFiltros(x, f)).map((x) => x.nombre);
  assert.deepEqual(ver({ pais: { modo: "solo", valores: ["Argentina", "Chile"] } }), ["Ana", "Beto"]);
  assert.deepEqual(ver({ pais: { modo: "sin", valores: ["Argentina"] } }), ["Beto", "Cris", "Dani"]);
  assert.deepEqual(ver({ pais: { modo: "solo", valores: ["(Vacías)"] } }), ["Dani"]);
  /* Programa: una fila con varios valores aparece tildando cualquiera. */
  assert.deepEqual(ver({ programa: { modo: "solo", valores: ["Principals"] } }), ["Ana"]);
  assert.deepEqual(ver({ programa: { modo: "solo", valores: ["Hackear IT"] } }), ["Ana", "Cris"]);
  assert.deepEqual(ver({ programa: { modo: "solo", valores: ["(Vacías)"] } }), ["Dani"]);
  assert.deepEqual(ver({ nombre: { modo: "solo", valores: [], contiene: "AN" } }), ["Ana", "Dani"], "«contiene», sin mayúsculas");
  assert.deepEqual(ver({ nombre: { modo: "solo", valores: [], noContiene: "an" } }), ["Beto", "Cris"]);
  assert.deepEqual(ver({ inicio: { modo: "solo", valores: [], desde: "2026-07-01", hasta: "2026-09-05" } }), ["Ana", "Dani"]);
  assert.deepEqual(ver({ wpp: { modo: "solo", valores: ["Sí"] } }), ["Beto"]);
  assert.deepEqual(ver({ duracion: { modo: "solo", valores: ["3 meses", "12 meses"] } }), ["Ana", "Cris"]);
  assert.deepEqual(ver({ mentor: { modo: "solo", valores: ["0 sesiones"] } }), ["Beto"]);
  /* Varios filtros a la vez se combinan. */
  assert.deepEqual(ver({ programa: { modo: "solo", valores: ["Hackear IT"] }, estadoAlumno: { modo: "solo", valores: ["Activo"] } }), ["Ana"]);
});

test("los filtros viajan en el link, con el nombre de su tabla, y un valor raro no los rompe", () => {
  const f = { pais: { modo: "solo" as const, valores: ["Argentina", "A|B"] }, nombre: { modo: "solo" as const, valores: [], contiene: "ana" }, inicio: { modo: "solo" as const, valores: [], desde: "2026-01-01" } };
  const q = new URLSearchParams();
  for (const [k, fc] of Object.entries(f)) for (const [p, v] of Object.entries(MOTOR_CLIENTES.filtroAURL(k as ClaveCliente, fc))) if (v) q.set(p, v);
  assert.ok(q.has("solo-cli_pais") && q.has("con-cli_nombre") && q.has("desde-cli_inicio"), [...q.keys()].join(","));
  assert.deepEqual(MOTOR_CLIENTES.filtrosDeURL(q), f, "va y vuelve igual, también con un «|» adentro");
  /* Las demás tablas y el CRM no ven esos parámetros, y una columna que no existe se ignora. */
  assert.deepEqual(MOTOR_TESTIMONIOS.filtrosDeURL(q), {});
  assert.deepEqual(MOTOR_CLIENTES.filtrosDeURL(new URLSearchParams("solo-cli_constructor=x&solo-cli___proto__=y&solo-cli_noExiste=z&solo-pais=Chile")), {});
  assert.equal(MOTOR_CLIENTES.esColumna("constructor"), false);
  assert.equal(MOTOR_CLIENTES.esColumna("toString"), false);
  /* Una fecha mal escrita no entra. */
  assert.deepEqual(MOTOR_CLIENTES.filtrosDeURL(new URLSearchParams("desde-cli_inicio=ayer")), {});
  /* Un filtro de texto sobre una columna que no es de fecha no se toma por «desde». */
  assert.deepEqual(MOTOR_CLIENTES.filtrosDeURL(new URLSearchParams("desde-cli_pais=2026-01-01")), {});
});

test("ordenar por una o por varias columnas, con lo vacío siempre al final", () => {
  const filas = filasClientes(E_VARIOS(), HOY);
  const orden = (os: { clave: ClaveCliente; desc: boolean }[]) => MOTOR_CLIENTES.ordenarFilas(filas, os).map((x) => x.nombre);
  assert.deepEqual(orden([{ clave: "edad", desc: false }]), ["Beto", "Ana", "Cris", "Dani"], "de menor a mayor; Dani no tiene edad: al final");
  assert.deepEqual(orden([{ clave: "edad", desc: true }]), ["Cris", "Ana", "Beto", "Dani"], "de mayor a menor; lo vacío sigue al final");
  assert.deepEqual(orden([{ clave: "inicio", desc: true }]), ["Cris", "Ana", "Dani", "Beto"]);
  assert.deepEqual(orden([{ clave: "estadoAlumno", desc: false }, { clave: "nombre", desc: true }]), ["Dani", "Beto", "Ana", "Cris"]);
  assert.deepEqual(orden([{ clave: "duracion", desc: false }]), ["Ana", "Beto", "Cris", "Dani"], "3, 6 y 12 meses (numérico, no «12» antes que «3»)");
  /* Con el orden propio de una lista: los módulos como se cargaron, no alfabético. */
  assert.deepEqual(MOTOR_CLIENTES.ordenarFilas(filas, [{ clave: "followUp", desc: false }], { followUp: LISTAS_POR_DEFECTO.followUps }).map((x) => x.nombre), ["Ana", "Beto", "Cris", "Dani"]);
  const q = MOTOR_CLIENTES.ordenesAURL([{ clave: "edad", desc: true }, { clave: "nombre", desc: false }], [{ clave: "inicio", desc: true }]);
  assert.equal(q, "-edad,nombre");
  assert.deepEqual(MOTOR_CLIENTES.ordenesDeURL(q, [{ clave: "inicio", desc: true }]), [{ clave: "edad", desc: true }, { clave: "nombre", desc: false }]);
  assert.equal(MOTOR_CLIENTES.ordenesAURL([{ clave: "inicio", desc: true }], [{ clave: "inicio", desc: true }]), null, "el orden de siempre no va en el link");
  assert.deepEqual(MOTOR_CLIENTES.ordenesDeURL("constructor,-nombre", [{ clave: "inicio", desc: true }]), [{ clave: "nombre", desc: true }]);
});

test("los valores de cada filtro cuentan lo que dejan los demás filtros, como en Excel", () => {
  const filas = filasClientes(E_VARIOS(), HOY);
  const sinFiltro = MOTOR_CLIENTES.opcionesDeColumna(filas, {}, "pais");
  assert.deepEqual(sinFiltro.map((o) => [o.valor, o.cuenta]), [["Argentina", 1], ["Chile", 1], ["México", 1], ["(Vacías)", 1]]);
  /* Con los activos nada más, México (Cris está pausada) queda en 0 y no aparece; el propio filtro de País no recorta su lista. */
  const conEstado = MOTOR_CLIENTES.opcionesDeColumna(filas, { estadoAlumno: { modo: "solo", valores: ["Activo"] }, pais: { modo: "solo", valores: ["México"] } }, "pais");
  assert.deepEqual(conEstado.map((o) => [o.valor, o.cuenta]), [["Argentina", 1], ["Chile", 1], ["México", 0], ["(Vacías)", 1]], "lo elegido sigue en la lista aunque no quede nada");
  const programas = MOTOR_CLIENTES.opcionesDeColumna(filas, {}, "programa");
  assert.deepEqual(programas.map((o) => [o.valor, o.cuenta]), [["Hackear Biz", 1], ["Hackear IT", 2], ["Principals", 1], ["(Vacías)", 1]]);
});

/* ---------- Corregir en la celda ---------- */

const LISTAS = listasCs();
const f1 = () => fila(estado(), "a1");
const f2 = () => fila(estado(), "a2");

test("corregir un número valida el rango y deja vacío si se vacía", () => {
  assert.deepEqual(escrituraCliente(f1(), "edad", "29", LISTAS), { tipo: "seguimiento", cambios: { edad: 29 }, detalle: "Edad: 29." });
  assert.deepEqual(escrituraCliente(f1(), "edad", "", LISTAS), { tipo: "seguimiento", cambios: { edad: null }, detalle: "Edad: vacío." });
  for (const malo of ["abc", "5", "150", "29.5"]) assert.equal(escrituraCliente(f1(), "edad", malo, LISTAS).tipo, "no", malo);
  assert.deepEqual(escrituraCliente(f1(), "duracion", "6", LISTAS).tipo, "seguimiento");
  assert.equal(escrituraCliente(f1(), "duracion", "0", LISTAS).tipo, "no");
  assert.equal(escrituraCliente(f1(), "duracion", "61", LISTAS).tipo, "no");
  assert.deepEqual((escrituraCliente(f1(), "mentor", "2 sesiones", LISTAS) as { cambios: unknown }).cambios, { sesionesMentor: 2 });
  assert.deepEqual((escrituraCliente(f1(), "mentor", "1 sesión", LISTAS) as { cambios: unknown }).cambios, { sesionesMentor: 1 });
  assert.deepEqual((escrituraCliente(f1(), "mentor", "", LISTAS) as { cambios: unknown }).cambios, { sesionesMentor: null });
  assert.equal(escrituraCliente(f1(), "mentor", "mucho", LISTAS).tipo, "no");
  assert.equal(escrituraCliente(f1(), "numero", "0", LISTAS).tipo, "no");
  assert.deepEqual((escrituraCliente(f1(), "numero", "42", LISTAS) as { cambios: unknown }).cambios, { numero: 42 });
});

test("corregir un día exige un día válido; el último contacto recalcula el próximo", () => {
  assert.deepEqual((escrituraCliente(f1(), "contactoInicial", "2026-10-05", LISTAS) as { cambios: unknown }).cambios, { contactoInicial: "2026-10-05" });
  assert.deepEqual((escrituraCliente(f1(), "contactoInicial", "", LISTAS) as { cambios: unknown }).cambios, { contactoInicial: null });
  assert.equal(escrituraCliente(f1(), "contactoInicial", "5/10", LISTAS).tipo, "no");
  const u = escrituraCliente(f1(), "ultimoContacto", "2026-10-01", LISTAS);
  assert.deepEqual((u as { cambios: unknown }).cambios, { ultimoContacto: "2026-10-01", proximoContacto: null, intentosSinRespuesta: 0, ultimoIntento: null });
  assert.equal(escrituraCliente(f1(), "inicio", "", LISTAS).tipo, "no", "el inicio no se puede dejar vacío");
  assert.deepEqual(escrituraCliente(f1(), "inicio", "2026-09-01", LISTAS), { tipo: "alumno", cambios: { inicio: "2026-09-01" }, detalle: "Fecha de inicio: 2026-09-01." });
});

test("lo de la persona se corrige en todos lados; el teléfono, donde está", () => {
  const n = escrituraCliente(f1(), "nombre", "  Ana María  ", LISTAS);
  assert.deepEqual(n, { tipo: "persona", id: "l1", cambios: { nombre: "Ana María" }, alumno: { nombre: "Ana María" }, detalle: "Nombre: Ana María." });
  assert.equal(escrituraCliente(f1(), "nombre", "  ", LISTAS).tipo, "no");
  assert.equal(escrituraCliente(f1(), "email", "no-es-mail", LISTAS).tipo, "no");
  assert.equal(escrituraCliente(f1(), "email", "nuevo@mail.com", LISTAS).tipo, "persona");
  /* Ana tiene contacto: su teléfono es del contacto. Beto no: es de la ficha. */
  assert.deepEqual(escrituraCliente(f1(), "telefono", "+54 11 4444", LISTAS), { tipo: "persona", id: "c1", cambios: { telefono: "+54 11 4444" }, alumno: {}, detalle: "Teléfono: +54 11 4444." });
  assert.deepEqual(escrituraCliente(f2(), "telefono", "+56 2 222", LISTAS), { tipo: "seguimiento", cambios: { telefono: "+56 2 222" }, detalle: "Teléfono: +56 2 222." });
});

test("el closer sale de la venta: sin venta se escribe, con venta se rechaza", () => {
  assert.equal(escrituraCliente(f1(), "closer", "Dante", LISTAS).tipo, "no");
  assert.deepEqual((escrituraCliente(f2(), "closer", "Dante", LISTAS) as { cambios: unknown }).cambios, { closerNombre: "Dante" });
});

test("las listas se corrigen con la opción de la lista; el contrato sólo con sus dos valores", () => {
  assert.deepEqual((escrituraCliente(f1(), "stack", "full stack", LISTAS) as { cambios: unknown }).cambios, { stack: "Full Stack" });
  assert.deepEqual((escrituraCliente(f1(), "followUp", "módulo 4", LISTAS) as { cambios: unknown }).cambios, { followUp: "Módulo 4" });
  assert.deepEqual((escrituraCliente(f1(), "acceso", "", LISTAS) as { cambios: unknown }).cambios, { acceso: "" });
  assert.deepEqual((escrituraCliente(f1(), "contrato", "firmado", LISTAS) as { cambios: unknown }).cambios, { contratoFirmado: "Firmado" });
  assert.equal(escrituraCliente(f1(), "contrato", "quizás", LISTAS).tipo, "no");
  assert.deepEqual((escrituraCliente(f1(), "estadoContrato", "falta firma", LISTAS) as { cambios: unknown }).cambios, { estadoContrato: "Falta firma" });
  assert.deepEqual((escrituraCliente(f1(), "comentarios", "  hola\nchau ", LISTAS) as { cambios: unknown }).cambios, { notas: "  hola\nchau " }, "las notas se guardan como se escribieron");
});

test("los accesos, el CV y el LinkedIn se prenden y apagan", () => {
  assert.deepEqual((escrituraCliente(f1(), "wpp", "Sí", LISTAS) as { cambios: unknown }).cambios, { accesoWhatsapp: true });
  assert.deepEqual((escrituraCliente(f1(), "zoom", "No", LISTAS) as { cambios: unknown }).cambios, { accesoZoom: false });
  assert.deepEqual(escrituraCliente(f1(), "cv", "Sí", LISTAS), { tipo: "correccion", que: "cv", corregido: true });
  assert.deepEqual(escrituraCliente(f1(), "linkedin", "No", LISTAS), { tipo: "correccion", que: "linkedin", corregido: false });
  const base = seg("a1", {});
  const con = aplicarEscritura(base, escrituraCliente(f1(), "cv", "Sí", LISTAS), "2026-10-07", "Lili", "2026-10-07T10:00:00.000Z");
  assert.deepEqual([con.cvCorregido, con.cvCorregidoEn, con.actualizadoPor], [true, "2026-10-07", "Lili"]);
  const wpp = aplicarEscritura(base, escrituraCliente(f1(), "wpp", "Sí", LISTAS), "2026-10-07", "Lili", "2026-10-07T10:00:00.000Z");
  assert.deepEqual([wpp.accesoWhatsapp, wpp.actualizadoEn], [true, "2026-10-07T10:00:00.000Z"]);
});

test("lo que se calcula no se corrige a mano y dice por qué", () => {
  for (const k of ["semanasSin", "proximo", "cadencia", "etapa", "testimonio"] as ClaveCliente[]) {
    const w = escrituraCliente(f1(), k, "x", LISTAS);
    assert.equal(w.tipo, "no", k);
    assert.match((w as { motivo: string }).motivo, /.{20,}/);
  }
});

test("el texto que se edita en una celda es lo cargado, no lo sugerido", () => {
  const sugerida = f1();
  assert.equal(valorEditableCliente(sugerida, "edad"), "", "la edad que sugiere la llamada no se edita como si fuera un dato");
  assert.equal(valorEditableCliente(sugerida, "duracion"), "");
  assert.equal(valorEditableCliente(sugerida, "plan"), "");
  assert.equal(valorEditableCliente(sugerida, "egreso"), "");
  assert.equal(valorEditableCliente(sugerida, "inicio"), "2026-08-31");
  assert.equal(valorEditableCliente(sugerida, "wpp"), "No");
  const cargada = fila(estado({ seguimientos: [seg("a1", { edad: 33, duracionMeses: 6, planDePago: "Pago único", fechaEgreso: "2027-02-28", numero: 5, sesionesMentor: 2 })] }), "a1");
  assert.deepEqual(["edad", "duracion", "plan", "egreso", "numero", "mentor"].map((k) => valorEditableCliente(cargada, k as ClaveCliente)), ["33", "6", "Pago único", "2027-02-28", "5", "2 sesiones"]);
});

/* ---------- Testimonios ---------- */

test("los testimonios traen de la ficha del cliente la edad, el inicio, el teléfono, el stack y el país", () => {
  const e = estado({
    seguimientos: [seg("a1", { stack: "Backend", edad: 33 })],
    testimonios: [
      { id: "t1", alumnoId: "a1", followUp: "Llamada agendada", fechaGrabacion: "2026-10-02", conQuien: "Yari", resell: "Renueva", estadoVideo: "Subido a Drive", link: "https://d/1", tecnologias: "", situacionPrevia: "Sin trabajo", situacionActual: "Dev en X", notas: "", creadoEn: "2026-10-02T10:00:00.000Z" },
      { id: "t2", alumnoId: "borrado", estado: "pedido", creadoEn: "2026-10-03T10:00:00.000Z" },
    ] as never,
  });
  const filas = filasTestimonios(e, filasClientes(e, HOY));
  const t1 = filas.find((f) => f.id === "t1")!;
  assert.deepEqual([t1.nombre, t1.edad, t1.inicio, t1.telefono, t1.stack, t1.pais], ["Ana", 33, "2026-08-31", "+54 9 11 5555 1111", "Backend", "Argentina"]);
  assert.equal(t1.tecnologias, "React y Node", "sin tecnologías en el testimonio, las de la persona");
  const t2 = filas.find((f) => f.id === "t2")!;
  assert.equal(t2.nombre, "");
  assert.equal(t2.testimonio.followUp, "Pendiente de agendar", "uno del primer modelo se lee");
  assert.equal(filas.length, 2);
  /* Se filtra por estado del video. */
  const ver = MOTOR_TESTIMONIOS.pasaFiltros;
  assert.equal(ver(t1, { estadoVideo: { modo: "solo", valores: ["Subido a Drive"] } }), true);
  assert.equal(ver(t2, { estadoVideo: { modo: "solo", valores: ["Subido a Drive"] } }), false);
  assert.equal(MOTOR_TESTIMONIOS.columnas.length, 16);
});

/* ---------- Agenda de resells ---------- */

test("una llamada es de resell por el nombre del evento o por el utm_source", () => {
  assert.equal(esLlamadaDeResell({ tipo: "Llamada de Auditoría" }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Resell Mentoría 1:1" }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento", utm: { utm_source: "Resell" } }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento", utm: { source: "resell-ig" } }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento", titulo: "Llamada con Ana", utm: { utm_source: "meta" } }), false);
  assert.equal(esLlamadaDeResell({}), false);
  assert.equal(idResell("ses_9"), "rs_ses_9");
});

test("la agenda de resells muestra «Agendada» o «Cancelada» hasta que Customer Success le pone estado", () => {
  const e = estado({
    resells: [
      { id: "r1", fechaHora: "2026-10-07T18:30:00.000Z", nombre: "Ana", email: "ANA@mail.com", estado: "", cancelada: false, origen: "calendly" },
      { id: "r2", fechaHora: "2026-10-08T02:30:00.000Z", nombre: "Otro", email: "otro@mail.com", estado: "", cancelada: true, origen: "calendly" },
      { id: "r3", fechaHora: "2026-10-09T15:00:00.000Z", nombre: "Beto", email: "beto@mail.com", estado: "Renueva", cashCollect: 1200, casoDeExito: true, origen: "manual" },
    ] as never,
  });
  const filas = filasResells(e);
  assert.deepEqual(filas.map((f) => f.estado), ["Agendada", "Cancelada", "Renueva"]);
  assert.equal(filas[0].alumno?.id, "a1", "el mail es de un alumno (sin importar mayúsculas)");
  assert.equal(filas[1].alumno, undefined);
  assert.equal(filas[1].dia, "2026-10-07", "las 23:30 de Argentina todavía son el 7");
  assert.equal(MOTOR_RESELLS.columnas.length, 9);
  assert.equal(MOTOR_RESELLS.pasaFiltros(filas[2], { caso: { modo: "solo", valores: ["Sí"] } }), true);
  assert.equal(MOTOR_RESELLS.pasaFiltros(filas[0], { caso: { modo: "solo", valores: ["Sí"] } }), false);
  assert.deepEqual(MOTOR_RESELLS.ordenarFilas(filas, [{ clave: "cash", desc: true }]).map((f) => f.id), ["r3", "r1", "r2"], "lo sin cash, al final");
});
