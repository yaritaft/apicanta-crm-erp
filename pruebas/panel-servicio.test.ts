import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  coincideCartera, cuandoEs, DIAS_DE_GRACIA, etapaDelFollowUp, ETAPAS_DEL_ALUMNO, MOTOR_CARTERA, ORDEN_CARTERA, ORDEN_ETAPAS_CARTERA,
  ORDEN_LISTA, panelDeServicio, renglonesCartera, resellResuelto, VISIBLES_CARTERA, VISIBLES_LISTA, type PanelDeServicio, type SeccionServicio,
} from "@/lib/panel-servicio";
import { SOLAPAS_SERVICIO } from "@/lib/solapas-servicio";
import { filasClientes } from "@/lib/clientes-cs";
import { DE_UN_USO } from "@/lib/vistas-guardadas";
import { CONFIG_POR_DEFECTO, seguimientoVacio, situacionDe, terminoElServicio } from "@/lib/seguimiento";
import { ACCESO_DUENO, areaDeRuta, nivelDeRuta, TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import { conPanel, vistaDePanel } from "@/lib/mi-panel";
import { inicioPara, navPara } from "@/components/shell/nav";
import type { EstadoApp, SeguimientoAlumno } from "@/lib/types";

/* El «Mi panel» de Customer Success (reunión del 19/10 con Lili). Un día fijo para que los días den siempre lo mismo. */
const HOY = "2026-10-20";
const AHORA = new Date("2026-10-20T15:00:00.000Z");

const alumno = (id: string, nombre: string, inicio: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, email: `${nombre.toLowerCase().replace(/\s+/g, ".")}@mail.com`, estado: "activo", inicio: `${inicio}T12:00:00.000Z`, cohorte: "", plan: "", extra: {}, ...extra,
});
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), ...c });

/* Siete alumnos para que cada lista tenga a alguien y otros queden afuera:
   nueva (entró hace 2 días), nueva5 (hace 5, sin contrato), vence (le quedan 5 días), termino (terminó hace 10),
   historico (activo desde hace 21 meses: no es de hoy), atrasada (el contacto venció hace 10 y dejó de reportar),
   sinFirma (empezó hace 19 días sin contrato), egresada (no cuenta) y outb (figura activo pero su Follow Up ya dice OUTBOARDING). */
function estado(extra: Partial<EstadoApp> = {}): EstadoApp {
  const firmado = { contratoFirmado: "Firmado", contactoInicial: "2026-09-01" };
  return {
    ajustes: {},
    alumnos: [
      alumno("nueva", "Nueva", "2026-10-18"),
      alumno("nueva5", "Nueva Cinco", "2026-10-15"),
      alumno("vence", "Vence", "2026-07-25"),
      alumno("termino", "Termino", "2026-06-01"),
      alumno("historico", "Historico", "2025-01-10"),
      alumno("atrasada", "Atrasada", "2026-09-01"),
      alumno("sinfirma", "Sin Firma", "2026-10-01"),
      alumno("egresada", "Egresada", "2025-01-10", { estado: "graduado" }),
      alumno("outb", "Outboarding", "2026-10-10"),
    ],
    leads: [], contactos: [], ventas: [], cuotas: [], productos: [], equipo: [], etapasServicio: [], reportes: [], sesiones: [],
    seguimientos: [
      seg("vence", { ...firmado, ultimoContacto: "2026-10-15", duracionMeses: 3 }),
      seg("termino", { ...firmado, ultimoContacto: "2026-10-12", fechaEgreso: "2026-10-10" }),
      seg("atrasada", { ...firmado, ultimoContacto: "2026-09-25", reporteManual: { activo: false, completo: false, semanasSin: 4, en: "2026-10-12" } }),
      seg("sinfirma", { contactoInicial: "2026-10-02", ultimoContacto: "2026-10-15" }),
      seg("outb", { followUp: "OUTBOARDING" }),
    ],
    testimonios: [
      { id: "t1", alumnoId: "vence", followUp: "Llamada agendada", fechaGrabacion: "2026-10-05", conQuien: "Yari", link: "", creadoEn: "2026-10-05T10:00:00.000Z" },
      { id: "t2", alumnoId: "nueva", followUp: "No agendada", creadoEn: "2026-10-18T10:00:00.000Z" },
      { id: "t3", alumnoId: "nueva5", followUp: "No quiere grabar", creadoEn: "2026-10-15T10:00:00.000Z" },
    ],
    resells: [
      { id: "r1", fechaHora: "2026-10-10T15:00:00.000Z", nombre: "Atrasada", email: "atrasada@mail.com", estado: "", cancelada: false, closer: "Mariano", origen: "calendly" },
      { id: "r2", fechaHora: "2026-10-18T15:00:00.000Z", nombre: "Otra", email: "otra@mail.com", estado: "2da Agenda", cancelada: false, origen: "calendly" },
      { id: "r3", fechaHora: "2026-10-09T15:00:00.000Z", nombre: "Resuelta", email: "resuelta@mail.com", estado: "Renueva", cancelada: false, origen: "manual" },
      { id: "r4", fechaHora: "2026-10-12T15:00:00.000Z", nombre: "Cancelada", email: "cancelada@mail.com", estado: "", cancelada: true, origen: "calendly" },
      { id: "r5", fechaHora: "2026-10-25T15:00:00.000Z", nombre: "Futura", email: "futura@mail.com", estado: "", cancelada: false, origen: "calendly" },
    ],
    revisionesCv: [
      { id: "cv1", nombre: "Nueva", telefono: "", alumnoId: "nueva", estado: "En proceso" },
      { id: "cv2", nombre: "Vence", telefono: "", alumnoId: "vence", estado: "En proceso" },
      { id: "cv3", nombre: "Termino", telefono: "", alumnoId: "termino", estado: "Esperando cliente" },
      { id: "cv4", nombre: "Sin alumno", telefono: "", alumnoId: null, estado: "Con Yari" },
      { id: "cv5", nombre: "Listo", telefono: "", alumnoId: "atrasada", estado: "Terminado" },
    ],
    ...extra,
  } as unknown as EstadoApp;
}

const seccion = (p: PanelDeServicio, id: SeccionServicio["id"]): SeccionServicio => p.secciones.find((s) => s.id === id)!;
const nombres = (s: SeccionServicio) => s.items.map((i) => i.nombre);

test("el panel trae las listas de la reunión (y «Arrancan o retoman», 22/10), cada una con su regla escrita", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  assert.deepEqual(p.secciones.map((s) => s.id), ["contactar", "vuelven", "nuevos", "esperanVenta", "renovar", "resells", "testimonios", "reportes", "contratos"]);
  for (const s of p.secciones) {
    assert.ok(s.regla.length > 20, `${s.id}: falta decir qué la hace aparecer`);
    assert.ok(s.verTodos?.href.startsWith("/"), `${s.id}: a dónde ir a ver la lista entera`);
  }
});

test("los activos son los que están en servicio; el que figura activo y terminó hace más de 45 días queda aparte, contado, y el egresado no cuenta", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  assert.equal(p.activos, 6, "nueva, nueva5, vence, termino, atrasada y sinfirma");
  assert.equal(p.desactualizados, 1, "historico: su contrato terminó hace casi dos años y sigue «activo»");
  assert.equal(p.enOutboarding, 1, "outb: en el Follow Up de Lili ya cerró; el estado del alumno no se toca");
  const todos = p.secciones.flatMap((s) => nombres(s));
  assert.ok(!todos.includes("Historico"), "no llena las listas de hoy");
  assert.ok(!todos.includes("Egresada"));
  assert.ok(!todos.includes("Outboarding"), "ni en Nuevos ni en ninguna otra lista");
  assert.equal(DIAS_DE_GRACIA, 45);
});

test("A contactar hoy: sólo a quien se le venció el seguimiento, con los días de atraso", () => {
  const s = seccion(panelDeServicio(estado(), HOY, AHORA), "contactar");
  assert.deepEqual(nombres(s), ["Atrasada"]);
  assert.equal(s.items[0].dias, 10);
  assert.equal(s.items[0].tono, "rojo", "una semana o más de atraso");
  assert.equal(s.items[0].cuando, "hace 10 d");
  assert.match(s.items[0].detalle, /Último contacto el 25 sep/);
});

test("Nuevos: entraron hace menos de dos semanas sin el primer contacto; el que lleva 3 días o más está en rojo y va primero", () => {
  const s = seccion(panelDeServicio(estado(), HOY, AHORA), "nuevos");
  assert.deepEqual(nombres(s), ["Nueva Cinco", "Nueva"]);
  assert.deepEqual(s.items.map((i) => i.tono), ["rojo", "ambar"]);
});

test("Se les termina el contrato: lo ya vencido arriba y en rojo, después el que falta menos", () => {
  const s = seccion(panelDeServicio(estado(), HOY, AHORA), "renovar");
  assert.deepEqual(nombres(s), ["Termino", "Vence"]);
  assert.deepEqual(s.items.map((i) => i.tono), ["rojo", "ambar"]);
  assert.match(s.items[0].detalle, /Terminó el 10 oct/);
  assert.equal(s.items[0].cuando, "hace 10 d");
  assert.match(s.items[1].detalle, /Termina el 25 oct/);
  assert.equal(s.items[1].cuando, "en 5 d");
});

test("Resells sin cierre: la llamada ya pasó y el closer no dijo en qué quedó; a la semana, en rojo", () => {
  const s = seccion(panelDeServicio(estado(), HOY, AHORA), "resells");
  assert.deepEqual(nombres(s), ["Atrasada", "Otra"], "no entran la resuelta, la cancelada ni la que todavía no fue");
  assert.deepEqual(s.items.map((i) => i.tono), ["rojo", "ambar"]);
  assert.match(s.items[0].detalle, /con Mariano/);
  assert.equal(s.items[0].alumnoId, "atrasada", "se abre la ficha del alumno por el mail");
  assert.equal(s.items[1].alumnoId, undefined, "un mail que no es de un alumno no tiene ficha");
});

test("un resell queda resuelto con renueva, no renueva, outboarding, upgrade o vigente; 2da agenda y seguimiento lo dejan abierto", () => {
  for (const r of ["Renueva", "No renueva", "No quiere renovar", "Outboarding", "Outbording", "Upgrade a Hackear IA", "Garantía extendida", "Alumno vigente"]) assert.ok(resellResuelto(r), r);
  for (const r of ["", "2da Agenda", "Seguimiento", undefined, null]) assert.ok(!resellResuelto(r), String(r));
});

test("Testimonios: el que grabó y no tiene el link va primero (en rojo a la semana); el que no quiere grabar no se le insiste", () => {
  const s = seccion(panelDeServicio(estado(), HOY, AHORA), "testimonios");
  assert.deepEqual(nombres(s), ["Vence", "Nueva"]);
  assert.match(s.items[0].detalle, /falta el link/);
  assert.equal(s.items[0].tono, "rojo");
  assert.match(s.items[1].detalle, /agendar/);
});

test("Dejaron de reportar y Contrato sin firmar", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  assert.deepEqual(nombres(seccion(p, "reportes")), ["Atrasada"]);
  assert.match(seccion(p, "reportes").items[0].detalle, /4 semanas/);
  /* Nueva Cinco (5 días, ámbar) y Sin Firma (19 días, rojo): el más viejo primero. Nueva (2 días) todavía está a tiempo. */
  const c = seccion(p, "contratos");
  assert.deepEqual(nombres(c), ["Sin Firma", "Nueva Cinco"]);
  assert.deepEqual(c.items.map((i) => i.tono), ["rojo", "ambar"]);
});

test("Contrato sin firmar: el que ya recibió el contrato aparece desde el día en que se mandó (Santiago Bancalari, 23/10)", () => {
  /* Nueva (empezó hace 2 días) lo abrió ayer y no lo firmó: antes esperaba al tercer día y no aparecía. */
  const pendientes = [
    { alumnoId: "nueva", ventaId: null, estado: "visto", enviadoEn: "2026-10-19T16:37:29.436Z", vistoEn: "2026-10-19T16:46:30.432Z" },
    /* Atado por la venta, sin abrir, mandado hace 4 días: en rojo. */
    { alumnoId: null, ventaId: "ven_vence", estado: "enviado", enviadoEn: "2026-10-16T13:00:00.000Z", vistoEn: null },
    /* De nadie que esté en Servicio: no aparece. */
    { alumnoId: null, ventaId: "ven_otro", estado: "enviado", enviadoEn: "2026-10-20T13:00:00.000Z", vistoEn: null },
    /* El firmado no está pendiente aunque venga la fila (Atrasada tiene «Firmado» en su ficha). */
    { alumnoId: "atrasada", ventaId: null, estado: "visto", enviadoEn: "2026-10-18T13:00:00.000Z", vistoEn: null },
  ];
  const e = estado();
  e.alumnos = e.alumnos.map((a) => (a.id === "vence" ? { ...a, ventaId: "ven_vence" } : a));
  e.seguimientos = (e.seguimientos ?? []).map((s) => (s.alumnoId === "vence" ? { ...s, contratoFirmado: "" } : s));
  const c = seccion(panelDeServicio(e, HOY, AHORA, pendientes), "contratos");
  const de = (n: string) => c.items.find((i) => i.nombre === n);
  assert.ok(de("Nueva"), "aparece al otro día de mandarlo");
  assert.equal(de("Nueva")!.detalle, "Le mandamos el contrato el 19 oct · lo abrió el 19 oct y no lo firmó");
  assert.deepEqual([de("Nueva")!.tono, de("Nueva")!.cuando], ["ambar", "hace 1 d"]);
  assert.equal(de("Vence")!.detalle, "Le mandamos el contrato el 16 oct · todavía no lo abrió");
  assert.equal(de("Vence")!.tono, "rojo", "a los 3 días de mandado");
  assert.equal(de("Atrasada"), undefined);
  /* Los de antes siguen igual. */
  assert.ok(de("Sin Firma") && de("Nueva Cinco"));
  assert.match(c.regla, /Les mandamos el contrato y no lo firmaron/);
});

test("el resumen de arriba cuenta lo que está en rojo", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  /* contactar 1 + nuevos 1 + renovar 1 + resells 1 + testimonios 1 + reportes 1 + contratos 1 */
  assert.equal(p.urgentes, 7);
});

test("CV y LinkedIn: cuántas revisiones siguen en curso por estado, y las que no tienen alumno", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  assert.equal(p.cvs.enCurso, 4, "las terminadas no cuentan");
  assert.deepEqual(p.cvs.porEstado[0], { estado: "En proceso", n: 2 }, "el estado con más va primero");
  assert.equal(p.cvs.sinAlumno, 1);
});

test("cada lista trae a todos, lo más urgente arriba, para poder buscarlos y paginarlos en la pantalla", () => {
  const muchos = Array.from({ length: 12 }, (_, i) => alumno(`a${i}`, `Alumno ${String(i).padStart(2, "0")}`, "2026-10-19"));
  const s = seccion(panelDeServicio(estado({ alumnos: muchos as never, seguimientos: [], testimonios: [], resells: [], revisionesCv: [] }), HOY, AHORA), "nuevos");
  assert.equal(s.total, 12);
  assert.equal(s.items.length, 12, "no se recorta: la pantalla muestra de a 25");
  assert.equal(s.rojos, 0, "entraron ayer: están a tiempo");
});

test("lo urgente se cuenta sobre toda la lista", () => {
  const atrasadas = Array.from({ length: 12 }, (_, i) => alumno(`b${i}`, `Atrasada ${String(i).padStart(2, "0")}`, "2026-06-01"));
  const seguimientos = atrasadas.map((a) => seg(a.id, { contratoFirmado: "Firmado", contactoInicial: "2026-06-02", ultimoContacto: "2026-09-01", duracionMeses: 12 }));
  const p = panelDeServicio(estado({ alumnos: atrasadas as never, seguimientos, testimonios: [], resells: [], revisionesCv: [] }), HOY, AHORA);
  const s = seccion(p, "contactar");
  assert.equal(s.total, 12);
  assert.equal(s.items.length, 12);
  assert.equal(s.rojos, 12);
  assert.equal(p.urgentes, 12);
});

test("outboarding y caso de éxito, con o sin tildes y en mayúsculas o minúsculas, son «terminó el servicio»; lo demás no", () => {
  for (const f of ["OUTBOARDING", "Outboarding", "outbording", "CASO DE EXITO", "Caso de Éxito", " caso de éxito "]) assert.ok(terminoElServicio(f), f);
  for (const f of ["", "RESERVA", "Roadmap", "Avanzando", "Módulo 3", "MAS ENTREVISTAS", "No contesta", undefined, null]) assert.ok(!terminoElServicio(f), String(f));
  /* En la lista de seguimiento ya no le toca el contacto, aunque el alumno siga «activo» y tenga el atraso vencido. */
  assert.equal(situacionDe("activo", false, 30, "OUTBOARDING"), "fuera");
  assert.equal(situacionDe("activo", false, 30, "Avanzando"), "vencido");
  assert.equal(situacionDe("activo", false, 30), "vencido", "sin Follow Up, como siempre");
});

test("«contar desde»: arranca de cero, nadie figura vencido por un contacto o un ingreso anterior a esa fecha", () => {
  const sinContacto = [...estado().alumnos, alumno("viejo", "Viejo", "2026-07-01")];
  const seguimientos = [...(estado().seguimientos ?? []), seg("viejo", { contratoFirmado: "Firmado", contactoInicial: "2026-07-02", duracionMeses: 12 })];
  const base = { alumnos: sinContacto as never, seguimientos, testimonios: [], resells: [], revisionesCv: [] };
  const antes = seccion(panelDeServicio(estado(base), HOY, AHORA), "contactar");
  assert.ok(nombres(antes).includes("Viejo") && nombres(antes).includes("Atrasada"), "sin fecha de arranque les tocaba desde el 16/07 y desde el 10/10");
  const conArranque = panelDeServicio(estado({ ...base, ajustes: { seguimiento: { contarDesde: HOY } } as never }), HOY, AHORA);
  const despues = seccion(conArranque, "contactar");
  assert.deepEqual(nombres(despues), [], "a todos les toca el 04/11: 15 días desde hoy");
  /* El resto de las listas no cambia. */
  assert.equal(conArranque.activos, panelDeServicio(estado(base), HOY, AHORA).activos);
});

test("sin datos, el panel no se rompe: todo en cero", () => {
  const p = panelDeServicio(estado({ alumnos: [], seguimientos: [], testimonios: [], resells: [], revisionesCv: [] }), HOY, AHORA);
  assert.equal(p.activos, 0);
  assert.equal(p.urgentes, 0);
  assert.ok(p.secciones.every((s) => s.total === 0 && s.items.length === 0));
});

test("cada fila trae a quién escribirle: teléfono y mail para copiar, y el programa", () => {
  const e = estado({
    contactos: [{ id: "c1", nombre: "Atrasada", email: "atrasada@mail.com", telefono: "+54 9 11 5555 1111", pais: "Argentina" }] as never,
    leads: [{ id: "l1", nombre: "Atrasada", email: "atrasada@mail.com", contactoId: "c1" }] as never,
  });
  e.alumnos = e.alumnos.map((a) => (a.id === "atrasada" ? { ...a, leadId: "l1" } : a));
  const i = seccion(panelDeServicio(e, HOY, AHORA), "contactar").items[0];
  assert.equal(i.nombre, "Atrasada");
  assert.equal(i.telefono, "+54 9 11 5555 1111");
  assert.equal(i.email, "atrasada@mail.com");
});

test("«cuándo»: hoy, hace N d o en N d, corto para la derecha de la fila", () => {
  assert.equal(cuandoEs(0), "hoy");
  assert.equal(cuandoEs(10), "hace 10 d");
  assert.equal(cuandoEs(-5), "en 5 d");
});

test("cada lista dice qué mostrar cuando no hay nadie", () => {
  const p = panelDeServicio(estado({ alumnos: [], seguimientos: [], testimonios: [], resells: [], revisionesCv: [] }), HOY, AHORA);
  for (const s of p.secciones) assert.ok(s.vacio.length > 15, s.id);
});

const rutasDe = (a: MiAcceso) => navPara(a).flatMap((g) => g.items.map((i) => i.href));
const acceso = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("el panel de Lili vive en «Mi panel»: Customer Success lo ve y arranca ahí, y los dueños lo miran «como» ella", () => {
  assert.equal(areaDeRuta("/mi-panel"), "crm", "sigue siendo del CRM para los closers...");
  assert.ok(nivelDeRuta(acceso("customer_success"), "/mi-panel") >= 1, "...y además lo ve quien ve Alumnos");
  assert.ok(rutasDe(acceso("customer_success")).includes("/mi-panel"));
  assert.equal(inicioPara(acceso("customer_success")), "/mi-panel", "arranca en lo que le toca hoy");
  assert.ok(!rutasDe(acceso("customer_success")).includes("/mi-panel/servicio"), "ya no hay una pantalla aparte");
  assert.ok(rutasDe(ACCESO_DUENO).includes("/mi-panel") && !rutasDe(ACCESO_DUENO).includes("/mi-panel/servicio"));
  /* Quien no ve ni el CRM ni Alumnos no entra. */
  assert.equal(nivelDeRuta(acceso("marketing"), "/mi-panel"), 0);
  assert.equal(nivelDeRuta(acceso("admin"), "/mi-panel"), 0);
});

test("quién tiene el panel de servicio: lo dice su puesto en Equipo (Customer Success Manager), no su rol de ventas", () => {
  assert.equal(vistaDePanel({ rol: "otro", puesto: "Customer Success Manager" }), "servicio");
  assert.equal(vistaDePanel({ rol: "otro", puesto: "Content manager · Asistente de finanzas" }), "otro");
  assert.equal(vistaDePanel({ rol: "closer", puesto: "Closer de ventas" }), "closer");
  assert.equal(vistaDePanel({ rol: "otro" }), "otro");
  assert.equal(conPanel({ rol: "otro", puesto: "Customer Success Manager", activo: true }), true, "un dueño la puede elegir en «ver como»");
  assert.equal(conPanel({ rol: "otro", puesto: "Customer Success Manager", activo: false }), false);
  assert.equal(conPanel({ rol: "otro", puesto: "COO", activo: true }), false);
});

test("la etapa del recorrido sale del Follow Up del Airtable de Lili, sin inventar estados", () => {
  const casos: [string, string][] = [
    ["", "sin"], ["OUTBOARDING", "outboarding"], ["CASO DE EXITO", "exito"], ["(USD) GANANCIA MAYOR", "exito"],
    ["AGENDA PARA RESELL", "renovacion"], ["RENOVACION - SUBIR NIVEL", "renovacion"],
    ["PAUSO MENTORÍA", "riesgo"], ["Devolución", "riesgo"], ["No contesta", "riesgo"], ["LIMITACIONES", "riesgo"], ["EXCUSAS - LENTO", "riesgo"],
    ["Edicion CV y Likendin", "busqueda"], ["MAS ENTREVISTAS", "busqueda"], ["Take Home Challenge", "busqueda"], ["POCAS ENTREVISTAS", "busqueda"],
    ["RESERVA", "iniciando"], ["Demora inicio", "iniciando"], ["Onboarding", "iniciando"],
    ["Roadmap", "cursando"], ["Módulo 1", "cursando"], ["Python", "cursando"], ["Avanzando", "cursando"], ["Algo nuevo", "cursando"],
  ];
  for (const [f, etapa] of casos) assert.equal(etapaDelFollowUp(f), etapa, f);
  assert.equal(new Set(ETAPAS_DEL_ALUMNO.map((x) => x.id)).size, ETAPAS_DEL_ALUMNO.length);
});

test("la cartera trae a todos los alumnos y marca quién está en servicio", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  assert.equal(p.cartera.length, 9, "los nueve alumnos del ejemplo, egresados y cerrados incluidos");
  const en = p.cartera.filter((f) => f.enServicio).map((f) => f.id).sort();
  assert.deepEqual(en, ["atrasada", "nueva", "nueva5", "sinfirma", "termino", "vence"]);
  const outb = p.cartera.find((f) => f.id === "outb")!;
  assert.equal(outb.etapa, "outboarding");
  assert.equal(outb.proximo, "", "al que cerró no le toca seguimiento");
  assert.equal(p.cartera.find((f) => f.id === "egresada")!.enServicio, false);
});

test("los números del servicio salen de los mismos datos", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  assert.equal(p.numeros.enServicio, p.activos);
  assert.deepEqual(p.numeros.reportando, { si: 0, de: 1 }, "Atrasada es la única con el dato del reporte, y está inactiva");
  /* Contactos en los últimos 30 días: vence (15/10), termino (12/10), atrasada (25/09) y sinfirma (15/10). */
  assert.deepEqual(p.numeros.contactados30, { si: 4, de: 6 });
  assert.equal(p.numeros.casosDeExito, 0);
  assert.equal(p.numeros.testimoniosConVideo, 0);
  assert.equal(p.numeros.renovacionesMes, 1, "«Resuelta» renovó el 09/10, este mes; la cancelada y las abiertas no cuentan");
});

/* ---------- La Cartera como tabla (TablaCs, 21/10) ---------- */

test("la cartera como tabla: los alumnos de la base (de una etapa si se eligió) o los de la lista de «Para hoy», en su orden", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  const enServicio = p.cartera.filter((f) => f.enServicio);
  const todos = renglonesCartera(enServicio);
  assert.deepEqual(todos.map((r) => r.id).sort(), enServicio.map((f) => f.id).sort(), "uno por alumno de la base");
  assert.ok(todos.every((r) => r.alumnoId === r.id && r.fila && !r.item));

  const etapa = enServicio[0].etapa;
  assert.ok(renglonesCartera(enServicio, undefined, etapa).every((r) => r.fila?.etapa === etapa), "sólo los de la etapa elegida");

  const nuevos = seccion(p, "nuevos");
  const deLista = renglonesCartera(p.cartera, nuevos);
  assert.deepEqual(deLista.map((r) => r.id), nuevos.items.map((i) => i.clave), "la lista trae a los suyos, en su orden");
  assert.ok(deLista.every((r) => r.item && r.fila), "con lo que pasa y con los datos de su ficha");
  assert.deepEqual(MOTOR_CARTERA.ordenarFilas(deLista, ORDEN_LISTA).map((r) => r.id), deLista.map((r) => r.id), "sin orden elegido, el de la lista");
});

test("la cartera como tabla: de entrada el último que ingresó arriba (Lili, 22/10); se busca por nombre, teléfono o lo que pasa", () => {
  const p = panelDeServicio(estado(), HOY, AHORA);
  const filas = renglonesCartera(p.cartera);
  const ordenadas = MOTOR_CARTERA.ordenarFilas(filas, ORDEN_CARTERA, ORDEN_ETAPAS_CARTERA);
  for (let i = 1; i < ordenadas.length; i++) {
    const a = ordenadas[i - 1], b = ordenadas[i];
    if (a.fila?.inicio && b.fila?.inicio) assert.ok(a.fila.inicio >= b.fila.inicio, `${a.nombre} antes que ${b.nombre}: ingresó después`);
  }
  const uno = filas[0];
  assert.ok(coincideCartera(uno, uno.nombre.toUpperCase()));
  assert.ok(!coincideCartera(uno, "nadie se llama así"));
  const conTarea = renglonesCartera(p.cartera, seccion(p, "contactar"))[0];
  if (conTarea?.item) assert.ok(coincideCartera(conTarea, conTarea.item.detalle.slice(0, 8)), "busca también en «qué pasa»");
  /* Las columnas de entrada existen en el motor (un nombre mal escrito dejaría una columna en blanco). */
  for (const k of [...VISIBLES_CARTERA, ...VISIBLES_LISTA]) assert.ok(MOTOR_CARTERA.esColumna(k), k);
});

test("cada lista de «Para hoy» abre la ficha en una solapa que existe, y cada solapa de la vista Servicio se puede pedir por link", () => {
  const panel = readFileSync("src/components/mi-panel/PanelServicio.tsx", "utf8");
  const hojas = /HOJA_DE_LISTA[^=]*=\s*\{([^}]*)\}/.exec(panel)?.[1] ?? "";
  const pedidas = [...hojas.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(pedidas.length >= 5, "el mapa de listas a solapas está");
  for (const h of pedidas) assert.ok((SOLAPAS_SERVICIO as readonly string[]).includes(h), `la solapa «${h}» existe`);

  /* La solapa es de la ficha abierta: no se recuerda con la pantalla (si no, volver a Resells traía «?hoja=testimonio» sin ficha). */
  assert.ok(DE_UN_USO.has("hoja") && DE_UN_USO.has("ficha"));
  const hoja = readFileSync("src/components/ficha/HojaServicio.tsx", "utf8");
  const dibujadas = new Set([...hoja.matchAll(/solapa === "([a-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...dibujadas].sort(), [...SOLAPAS_SERVICIO].sort(), "las solapas que dibuja la ficha son las que acepta ?hoja");
  for (const [archivo, solapa] of [["src/components/cs/RevisionCvCs.tsx", "cv"], ["src/components/cs/TestimoniosCs.tsx", "testimonio"], ["src/components/cs/ResellsCs.tsx", "testimonio"], ["src/components/alumnos/Seguimiento.tsx", "seguimiento"]]) {
    assert.match(readFileSync(archivo, "utf8"), new RegExp(`abrirFicha\\([^)]*hoja: "${solapa}"`), `${archivo} abre la ficha en «${solapa}»`);
  }
});

test("la ficha no se cierra con la Escape que un campo usó para cancelar su edición, y «Se les termina el contrato» abre en «¿Renueva?»", () => {
  /* Next monta React en `document`: el stopPropagation del campo no frena al oyente de la ficha en el mismo nodo. */
  const ficha = readFileSync("src/components/ficha/FichaPersona.tsx", "utf8");
  assert.match(ficha, /if \(ev\.defaultPrevented\) return;/);
  const celda = readFileSync("src/components/crm-tabla/CeldaEditable.tsx", "utf8");
  assert.match(celda, /ev\.key === "Escape"\) \{ ev\.preventDefault\(\)/, "el campo marca la tecla como usada");
  const panel = readFileSync("src/components/mi-panel/PanelServicio.tsx", "utf8");
  assert.match(panel, /renovar: "programa"/);
  const hoja = readFileSync("src/components/ficha/HojaServicio.tsx", "utf8");
  assert.match(hoja, /solapa === "programa" && porRenovar/, "el bloque «¿Renueva?» va en Programa");
  assert.match(hoja, /guardar\(f, "followUp", "OUTBOARDING"\)/, "«No renueva» deja el Follow Up como en el Airtable (y sale de la lista)");
});


/* ---------- Demora de inicio y pausas (Lili, 22/10) ---------- */

test("en pausa no toca el contacto ni cuenta como que dejó de reportar; el día que retoma aparece en «Arrancan o retoman»", () => {
  const pausa = (id: string, desde: string, hasta: string) => ({ id, tipo: "pausa" as const, desde, hasta, motivo: "Viaje", creadoEn: "", creadoPor: "" });
  /* Atrasada (contacto vencido hace 10 días, sin reportar) está en pausa hasta el 01/11. */
  const enPausa = estado({
    seguimientos: [
      seg("atrasada", { contratoFirmado: "Firmado", contactoInicial: "2026-09-01", ultimoContacto: "2026-09-25", pausas: [pausa("p1", "2026-10-10", "2026-11-01")],
        reporteManual: { activo: false, completo: false, semanasSin: 4, en: "2026-10-12" } }),
      seg("sinfirma", { contactoInicial: "2026-10-02", ultimoContacto: "2026-10-15", pausas: [pausa("p2", "2026-10-05", "2026-10-20")] }),
    ],
  });
  const p = panelDeServicio(enPausa, HOY, AHORA);
  assert.ok(!nombres(seccion(p, "contactar")).includes("Atrasada"), "en pausa: el próximo contacto es el día que retoma");
  assert.ok(!nombres(seccion(p, "reportes")).includes("Atrasada"), "en pausa no se le pide el reporte");
  assert.equal(p.cartera.find((f) => f.id === "atrasada")?.proximo, "2026-11-01");
  /* Sin Firma retoma hoy: está en «Arrancan o retoman» y no repetida en «A contactar hoy». */
  assert.deepEqual(nombres(seccion(p, "vuelven")), ["Sin Firma"]);
  assert.match(seccion(p, "vuelven").items[0].detalle, /Retoma hoy después de 15 días de pausa/);
  assert.ok(!nombres(seccion(p, "contactar")).includes("Sin Firma"));
  /* Ya la contactaron el día que retomó: sale de la lista. */
  const contactada = estado({ seguimientos: [seg("sinfirma", { contactoInicial: "2026-10-02", ultimoContacto: "2026-10-20", pausas: [pausa("p2", "2026-10-05", "2026-10-20")] })] });
  assert.equal(seccion(panelDeServicio(contactada, HOY, AHORA), "vuelven").total, 0);
});

test("la demora de inicio corre el fin del programa y el día del recorrido", () => {
  const e = estado({
    seguimientos: [seg("nueva", { duracionMeses: 3, pausas: [{ id: "d1", tipo: "demora", desde: "2026-10-18", hasta: "2026-12-18", motivo: "", creadoEn: "", creadoPor: "" }] })],
  });
  const f = filasClientes(e, HOY).find((x) => x.id === "nueva")!;
  assert.equal(f.inicioReal, "2026-12-18");
  assert.equal(f.egreso, "2027-03-18");
  assert.equal(f.pausa?.tipo, "demora", "hasta el 18/12 está en la demora");
  assert.equal(panelDeServicio(e, HOY, AHORA).cartera.find((x) => x.id === "nueva")?.egreso, "2027-03-18");
});
