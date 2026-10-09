import test from "node:test";
import assert from "node:assert/strict";
import { leerCSV } from "@/lib/pasarelas";
import {
  adivinarMapeoCs, CAMPOS_CVS, detectarTipo, faltaParaImportar, planificarImportacionCs, tablaDeHoja, type OpcionesImport, type PlanImportCs, type TablaImport,
} from "@/lib/importar-cs";
import { leerDiaCv, leerLinkCv, leerTelefonoCv, revisionCvNormal } from "@/lib/revision-cv";
import { acciones, fijarAcceso } from "@/lib/store";
import type { EstadoApp, RevisionCv } from "@/lib/types";

/* Importar la base de Notion de Aldana («REVISION DE CVS»): lo que se entiende de cada columna, lo que se avisa y lo que no se adivina. El archivo de
   acá está inventado (nombres, teléfonos y links de mentira) pero tiene, fila por fila, las mismas rarezas que el export real: fechas en dos formatos y
   con typos, el teléfono escrito en «Notas», las casillas como Yes/No, los estados escritos de varias maneras, links que el export dejó como «Ver link» o
   como error, nombres repetidos y filas sin nombre. */

const OP: OpcionesImport = { modo: "completar", crearFaltantes: false, hoy: "2026-10-09", ahora: "2026-10-09T12:00:00.000Z", quien: "Importación" };

const ENCABEZADOS = "Nombre,CV recibido,Corrección 1 enviada,Corrección 2 enviada,Estado,Fecha inicio,Link Corrección,Link Loom,Notas,mensajes";
const FILAS = [
  /* 2 */ `Ana Prueba,Yes,Yes,Yes,cerrado,24 de abril de 2026,https://docs.google.com/document/d/a,https://www.loom.com/share/a,+57 300 5550100,`,
  /* 3 */ `Beto Prueba,Yes,Yes,No,esperando cliente,15/9/2026,https://docs.google.com/document/d/b,🔗 Ver link,tel:+5491155550001,msj 9/9`,
  /* 4 */ `Carla Prueba,Yes,Yes,No,Con yari,31/08/2026,#REF!,no corresponde,54 9 11 5555-0002,pedido a lili`,
  /* 5 */ `Dani Prueba,Yes,No,No,En proceso,12//2026,https://docs.google.com/document/d/d,OUTBOARDING,,`,
  /* 6 */ `Eli Prueba,No,No,No,Segunda ronda,3/10/20266,,,Falta contactar,`,
  /* 7 */ `Fede Prueba,Yes,Yes,Yes,Outboarding,21 de abril de 2026,https://docs.google.com/document/d/f,🔗 Ver link,,`,
  /* 8 */ `Ana Prueba,Yes,Yes,No,Estado raro,10/10/2026,,,,`,
  /* 9 */ `,Yes,No,No,En proceso,1/10/2026,,,,`,
];
const CSV = [ENCABEZADOS, ...FILAS].join("\n");

const tabla = (csv = CSV, nombre = "REVISION DE CVS"): TablaImport => {
  const t = tablaDeHoja(nombre, leerCSV(csv));
  assert.ok(t, "se reconoce la hoja");
  return t;
};

function estado(extra: Partial<EstadoApp> = {}): EstadoApp {
  return {
    ajustes: {}, alumnos: [], leads: [], contactos: [], ventas: [], cuotas: [], productos: [], equipo: [], etapasServicio: [], reportes: [],
    sesiones: [], seguimientos: [], testimonios: [], resells: [], revisionesCv: [], ...extra,
  } as unknown as EstadoApp;
}
/* Lo que hace la acción del store con el plan: reemplaza por id y deja lo demás. */
const aplicar = (e: EstadoApp, p: PlanImportCs): EstadoApp => {
  const ids = new Set(p.revisionesCv.map((r) => r.id));
  return { ...e, revisionesCv: [...p.revisionesCv, ...(e.revisionesCv ?? []).filter((r) => !ids.has(r.id))] };
};
const porNombre = (p: PlanImportCs, nombre: string, fila = 0): RevisionCv => p.revisionesCv.filter((r) => r.nombre === nombre)[fila];

/* ---------- Leer cada dato ---------- */

test("el día de inicio: «24 de abril de 2026» y día/mes/año (el día primero); lo dudoso no se adivina", () => {
  const hoy = "2026-10-09";
  assert.equal(leerDiaCv("24 de abril de 2026", hoy), "2026-04-24");
  assert.equal(leerDiaCv("3 de Septiembre de 2026", hoy), "2026-09-03");
  assert.equal(leerDiaCv("21 de setiembre de 2026", hoy), "2026-09-21");
  assert.equal(leerDiaCv("31/08/2026", hoy), "2026-08-31");
  assert.equal(leerDiaCv("15/9/2026", hoy), "2026-09-15", "el día va primero");
  assert.equal(leerDiaCv("3-10-2026", hoy), "2026-10-03");
  assert.equal(leerDiaCv("2026-04-24", hoy), "2026-04-24");
  assert.equal(leerDiaCv("2026-04-24T15:00:00.000Z", hoy), "2026-04-24");
  /* Typos y cosas imposibles: nada de adivinar. */
  for (const dudosa of ["12//2026", "3/10/20266", "31/04/2026", "30/02/2026", "13/13/2026", "1/1/0206", "24 de abrill de 2026", "24 de abril", "10/2026", "mañana", "", "   "]) {
    assert.equal(leerDiaCv(dudosa, hoy), null, `«${dudosa}»`);
  }
  /* Un año que no puede ser (muy viejo o más allá del año que viene). */
  assert.equal(leerDiaCv("1/1/2010", hoy), null);
  assert.equal(leerDiaCv("1/1/2028", hoy), null);
  assert.equal(leerDiaCv("1/1/2027", hoy), "2027-01-01", "hasta el año que viene sí");
});

test("el teléfono se reconoce escrito de cualquier forma, sin el «tel:», y un texto que no es un teléfono no lo es", () => {
  assert.equal(leerTelefonoCv("+57 300 5550100"), "+57 300 5550100");
  assert.equal(leerTelefonoCv("tel:+5491155550001"), "+5491155550001");
  assert.equal(leerTelefonoCv("54 9 11 5555-0002"), "54 9 11 5555-0002");
  assert.equal(leerTelefonoCv("(011) 5555-0000"), "(011) 5555-0000");
  for (const no of ["", "Falta contactar", "pedido a lili", "msj 9/9", "123456", "1234567890123456", "llamar al +54 9 11 5555-0000", "sin tel"]) {
    assert.equal(leerTelefonoCv(no), null, `«${no}»`);
  }
});

test("un link es una dirección: lo que Notion exportó como etiqueta o como error no lo es, y se distingue por qué", () => {
  assert.deepEqual(leerLinkCv("https://docs.google.com/document/d/abc"), { link: "https://docs.google.com/document/d/abc" });
  assert.deepEqual(leerLinkCv("  http://x.com/a  "), { link: "http://x.com/a" });
  assert.deepEqual(leerLinkCv("[Ver link](https://www.loom.com/share/abc)"), { link: "https://www.loom.com/share/abc" }, "un export en Markdown");
  assert.deepEqual(leerLinkCv(""), { link: "", motivo: "vacio" });
  assert.deepEqual(leerLinkCv("🔗 Ver link"), { link: "", motivo: "sin-direccion" });
  assert.deepEqual(leerLinkCv("Ver link"), { link: "", motivo: "sin-direccion" });
  for (const raro of ["#REF!", "no corresponde", "OUTBOARDING", "www.sin-protocolo.com", "ftp://x.com"]) {
    assert.deepEqual(leerLinkCv(raro), { link: "", motivo: "no-es-link" }, raro);
  }
});

/* ---------- Reconocer la hoja ---------- */

test("la hoja de Aldana se reconoce como Revisión de CVs, con todas sus columnas, y no se confunde con las de Lili", () => {
  const t = tabla();
  assert.equal(t.tipo, "cvs");
  const campos = Object.keys(t.mapeo).filter((k) => t.mapeo[k] !== undefined).sort();
  assert.deepEqual(campos, ["correccion1", "correccion2", "cvRecibido", "estado", "inicio", "linkCorreccion", "linkLoom", "mensajes", "nombre", "notas"]);
  assert.equal(t.mapeo.nombre, 0);
  assert.equal(t.mapeo.mensajes, 9);
  /* Sin el nombre de la hoja también. */
  assert.equal(detectarTipo(ENCABEZADOS.split(",")).tipo, "cvs");
  /* Una hoja de clientes de Lili sigue siendo de clientes. */
  const clientes = "N.º de alumno,Nombre y apellido,Fecha de inicio,Teléfono,Mail,Programa,Plan de pago,Acceso,Follow-up,Comentarios".split(",");
  assert.equal(detectarTipo(clientes, "Clientes").tipo, "clientes");
  assert.equal(detectarTipo("Fecha y hora de agenda,Nombre completo,Mail,Teléfono,Closer,Estado,Cash Collect,Caso de éxito,Notas".split(",")).tipo, "resells");
});

test("con las columnas como las escribió Aldana en su mensaje (con teléfono aparte), también se reconoce cada una", () => {
  const e = ["Nombre", "CV Recibido", "1° Corrección", "2° Corrección", "Estado", "Fecha de inicio", "Link de corrección", "Link de Loom", "Numero de telefono", "Notas"];
  const m = adivinarMapeoCs(CAMPOS_CVS, e);
  assert.deepEqual(CAMPOS_CVS.map((c) => c.campo).filter((c) => m[c] !== undefined).sort(),
    ["correccion1", "correccion2", "cvRecibido", "estado", "inicio", "linkCorreccion", "linkLoom", "nombre", "notas", "telefono"]);
  assert.equal(m.telefono, 8);
  assert.equal(m.notas, 9);
  assert.equal(detectarTipo(e, "REVISION DE CVS").tipo, "cvs");
  assert.equal(faltaParaImportar({ tipo: "cvs", mapeo: { ...m, nombre: undefined } }), "Elegí qué columna es Nombre.");
  assert.equal(faltaParaImportar({ tipo: "cvs", mapeo: m }), null);
});

/* ---------- El plan ---------- */

test("el plan: qué entra, qué se descarta y cada dato leído como corresponde", () => {
  const p = planificarImportacionCs(estado(), [tabla()], OP);
  assert.deepEqual(p.porTabla.cvs, { filas: 8, nuevas: 7, actualizadas: 0, iguales: 0, descartadas: 1 });
  assert.deepEqual(p.descartadas, [{ tabla: "cvs", fila: 9, motivo: "No tiene nombre." }], "la que no tiene nombre se descarta, con su número de fila");
  assert.equal(p.revisionesCv.length, 7);
  assert.equal(escribeSoloCvs(p), true, "no se crea ningún alumno ni se toca nada más");
  assert.equal(new Set(p.revisionesCv.map((r) => r.id)).size, 7, "ids distintos, incluso con el nombre repetido");
  assert.ok(p.revisionesCv.every((r) => r.id.startsWith("cv_imp_") && r.origen === "importado" && r.actualizadoPor === "Importación"));

  const ana = porNombre(p, "Ana Prueba", 0);
  assert.deepEqual([ana.estado, ana.fechaInicio, ana.telefono, ana.notas, ana.linkCorreccion, ana.linkLoom, ana.cvRecibido, ana.correccion1, ana.correccion2, ana.mensajes],
    ["Cerrado", "2026-04-24", "+57 300 5550100", "", "https://docs.google.com/document/d/a", "https://www.loom.com/share/a", true, true, true, ""],
    "el estado con su nombre de la lista, el día largo, el teléfono que estaba en Notas, Yes como Sí");
  const beto = porNombre(p, "Beto Prueba");
  assert.deepEqual([beto.estado, beto.fechaInicio, beto.telefono, beto.linkLoom, beto.correccion2, beto.mensajes],
    ["Esperando cliente", "2026-09-15", "+5491155550001", "", false, "msj 9/9"], "el día va primero; el «Ver link» queda vacío; el «tel:» se saca");
  const carla = porNombre(p, "Carla Prueba");
  assert.deepEqual([carla.estado, carla.fechaInicio, carla.linkCorreccion, carla.linkLoom, carla.telefono, carla.mensajes],
    ["Con Yari", "2026-08-31", "", "", "54 9 11 5555-0002", "pedido a lili"], "«Con yari» pasa a «Con Yari»; «#REF!» y «no corresponde» no son links");
  const dani = porNombre(p, "Dani Prueba");
  assert.deepEqual([dani.fechaInicio, dani.linkLoom, dani.linkCorreccion, dani.telefono, dani.estado], [null, "", "https://docs.google.com/document/d/d", "", "En proceso"], "una fecha con un typo entra sin fecha");
  const eli = porNombre(p, "Eli Prueba");
  assert.deepEqual([eli.fechaInicio, eli.telefono, eli.notas, eli.cvRecibido, eli.estado], [null, "", "Falta contactar", false, "Segunda ronda"], "una nota que no es un teléfono se queda como nota");
  assert.equal(porNombre(p, "Fede Prueba").estado, "Outboarding");
  const otra = porNombre(p, "Ana Prueba", 1);
  assert.deepEqual([otra.estado, otra.fechaInicio], ["Estado raro", "2026-10-10"], "un estado que no está en la lista se importa tal cual");
  assert.notEqual(otra.id, ana.id);
});

const escribeSoloCvs = (p: PlanImportCs) => p.alumnos.length + p.seguimientos.length + p.testimonios.length + p.resells.length + p.reportes.length === 0;

test("una línea en blanco en el medio del archivo se ignora: no cuenta ni descarta nada", () => {
  const conBlanco = `${ENCABEZADOS}\nAna Prueba,Yes,No,No,En proceso,1/10/2026,,,,\n,,,,,,,,,\n\nBeto Prueba,Yes,No,No,En proceso,2/10/2026,,,,`;
  const p = planificarImportacionCs(estado(), [tabla(conBlanco)], OP);
  assert.deepEqual(p.porTabla.cvs, { filas: 2, nuevas: 2, actualizadas: 0, iguales: 0, descartadas: 0 });
});

test("los avisos juntan lo dudoso con sus filas, en vez de un renglón por cada una", () => {
  const avisos = planificarImportacionCs(estado(), [tabla()], OP).avisos.join("\n");
  assert.match(avisos, /2 fechas de inicio no se entendieron \(filas 5, 6\)/);
  assert.match(avisos, /en 2 filas «Loom de Yari» viene como «Ver link»[^\n]*\(filas 3, 7\)/);
  assert.match(avisos, /Documento de corrección: «#REF!» no es una dirección \(fila 4\)/);
  assert.match(avisos, /Loom de Yari: «no corresponde» no es una dirección \(fila 4\)/);
  assert.match(avisos, /Loom de Yari: «OUTBOARDING» no es una dirección \(fila 5\)/);
  assert.match(avisos, /«Estado raro» no está en la lista de estados \(1 fila\)/);
  assert.match(avisos, /1 nombre aparece más de una vez \(filas 2, 8\)/);
  assert.match(avisos, /el teléfono de 3 filas estaba escrito en «Notas»/);
  assert.equal(planificarImportacionCs(estado(), [tabla(`${ENCABEZADOS}\nAna Prueba,Yes,No,No,En proceso,1/10/2026,,,,`)], OP).avisos.length, 0, "un archivo sin rarezas no avisa nada");
});

test("reimportar el mismo archivo no duplica ni reescribe: todo ya estaba", () => {
  const primero = planificarImportacionCs(estado(), [tabla()], OP);
  const e = aplicar(estado(), primero);
  const otra = planificarImportacionCs(e, [tabla()], { ...OP, ahora: "2026-10-10T09:00:00.000Z" });
  assert.deepEqual(otra.porTabla.cvs, { filas: 8, nuevas: 0, actualizadas: 0, iguales: 7, descartadas: 1 });
  assert.equal(otra.revisionesCv.length, 0, "no hay nada para escribir");
  /* Un nombre repetido el mismo día no se confunde con el otro. */
  const dobles = `${ENCABEZADOS}\nLuz Prueba,Yes,No,No,En proceso,1/10/2026,,,,\nLuz Prueba,Yes,No,No,En proceso,1/10/2026,,,,`;
  const d = planificarImportacionCs(estado(), [tabla(dobles)], OP);
  assert.equal(d.revisionesCv.length, 2);
  assert.equal(planificarImportacionCs(aplicar(estado(), d), [tabla(dobles)], OP).porTabla.cvs.iguales, 2);
});

test("por defecto sólo se completa lo vacío: lo que el equipo ya cargó no se pisa, y las casillas no se apagan", () => {
  const e = aplicar(estado(), planificarImportacionCs(estado(), [tabla()], OP));
  const beto = porNombre(planificarImportacionCs(estado(), [tabla()], OP), "Beto Prueba");
  /* Yari/Aldana ya corrigieron a Beto en la app. */
  const editado: RevisionCv = { ...beto, estado: "Con Yari", notas: "mi nota", telefono: "", linkLoom: "https://www.loom.com/share/manual", correccion2: true };
  const e2 = { ...e, revisionesCv: e.revisionesCv!.map((r) => (r.id === beto.id ? editado : r)) } as EstadoApp;
  const p = planificarImportacionCs(e2, [tabla()], { ...OP, ahora: "2026-10-11T00:00:00.000Z" });
  const b = p.revisionesCv.find((r) => r.id === beto.id)!;
  assert.deepEqual([b.estado, b.notas, b.linkLoom, b.correccion2], ["Con Yari", "mi nota", "https://www.loom.com/share/manual", true], "lo cargado a mano queda");
  assert.equal(b.telefono, "+5491155550001", "lo que estaba vacío se completa con el archivo");
  assert.deepEqual([p.porTabla.cvs.actualizadas, p.porTabla.cvs.iguales], [1, 6]);
  /* Con «el archivo manda», gana lo que trae (pero lo que el archivo no trae no se borra). */
  const pisa = planificarImportacionCs(e2, [tabla()], { ...OP, modo: "pisar", ahora: "2026-10-11T00:00:00.000Z" });
  const bp = pisa.revisionesCv.find((r) => r.id === beto.id)!;
  assert.deepEqual([bp.estado, bp.correccion2, bp.linkLoom, bp.notas], ["Esperando cliente", false, "https://www.loom.com/share/manual", "mi nota"]);
});

test("una revisión que ya estaba con otro id (cargada a mano) se encuentra por nombre y teléfono, o por nombre y día, y se completa en vez de duplicarse", () => {
  const manual = (id: string, extra: Partial<RevisionCv>) => revisionCvNormal({ id, origen: "manual", ...extra });
  const e = estado({ revisionesCv: [
    manual("cv_a_mano_1", { nombre: "Beto  PRUEBA", telefono: "+54 9 11 5555-0001" }),
    manual("cv_a_mano_2", { nombre: "Dani Prueba", fechaInicio: null }),
    manual("cv_a_mano_3", { nombre: "Carla Prueba", fechaInicio: "2026-08-31" }),
  ] });
  const p = planificarImportacionCs(e, [tabla()], OP);
  assert.deepEqual(p.porTabla.cvs, { filas: 8, nuevas: 5, actualizadas: 2, iguales: 0, descartadas: 1 }, "Beto (por teléfono) y Carla (por nombre y día); Dani no, porque no tenía día");
  assert.deepEqual(p.revisionesCv.filter((r) => ["cv_a_mano_1", "cv_a_mano_3"].includes(r.id)).map((r) => [r.id, r.origen, r.estado]),
    [["cv_a_mano_1", "manual", "Esperando cliente"], ["cv_a_mano_3", "manual", "Con Yari"]], "siguen siendo suyas, completadas");
  assert.equal(p.revisionesCv.filter((r) => r.nombre === "Dani Prueba").length, 1);
  assert.notEqual(p.revisionesCv.find((r) => r.nombre === "Dani Prueba")!.id, "cv_a_mano_2");
});

test("se ata al alumno de la app sólo si se sabe de quién es (por el teléfono, o por el nombre si es uno solo); no se crea ninguno", () => {
  const alumno = (id: string, nombre: string) => ({ id, nombre, email: "", estado: "activo", inicio: "2026-08-31T12:00:00.000Z", cohorte: "", plan: "", extra: {} });
  const e = estado({
    alumnos: [alumno("al_beto", "Beto Prueba"), alumno("al_c1", "Carla Prueba"), alumno("al_c2", "Carla Prueba"), alumno("al_otro", "Otra Persona")] as never,
    seguimientos: [{ id: "seg_al_otro", alumnoId: "al_otro", telefono: "+57 300 5550100" }] as never,
  });
  const p = planificarImportacionCs(e, [tabla()], OP);
  const id = (n: string, fila = 0) => porNombre(p, n, fila).alumnoId;
  assert.equal(id("Beto Prueba"), "al_beto", "por el nombre, que es único");
  assert.equal(id("Ana Prueba", 0), "al_otro", "por el teléfono, aunque el nombre no coincida");
  assert.equal(id("Carla Prueba"), null, "dos alumnos con ese nombre: no se adivina");
  assert.equal(id("Dani Prueba"), null, "no hay ningún alumno así: queda sin atar");
  assert.match(p.avisos.join("\n"), /1 revisión no se ató a un alumno porque hay más de uno con ese nombre o teléfono \(fila 4\)/);
  assert.equal(p.alumnos.length + p.seguimientos.length, 0, "no se tocó ni se creó ningún alumno");
  /* Lo ya atado no se suelta al reimportar. */
  const e2 = aplicar(e, p);
  const q = planificarImportacionCs(e2, [tabla()], OP);
  assert.equal(q.porTabla.cvs.iguales, 7);
});

test("con una columna de teléfono propia, el teléfono sale de ahí y las notas quedan como notas", () => {
  const csv = "Nombre,CV recibido,Estado,Numero de telefono,Notas\nGabi Prueba,Yes,En proceso,+54 9 11 5555-0000,Pidió más tiempo\nHugo Prueba,No,En proceso,,+54 9 11 6666-0000";
  const p = planificarImportacionCs(estado(), [tabla(csv)], OP);
  const gabi = porNombre(p, "Gabi Prueba"), hugo = porNombre(p, "Hugo Prueba");
  assert.deepEqual([gabi.telefono, gabi.notas], ["+54 9 11 5555-0000", "Pidió más tiempo"]);
  assert.deepEqual([hugo.telefono, hugo.notas], ["+54 9 11 6666-0000", ""], "sin teléfono en su columna, se busca en las notas");
});

test("una casilla que no se entiende queda en No y se avisa; la lista de estados ajustada manda sobre los nombres", () => {
  const csv = `${ENCABEZADOS}\nIra Prueba,quizás,Yes,No,revisando,1/10/2026,,,,`;
  const e = estado({ ajustes: { seguimiento: { listas: { estadosCv: ["Nuevo", "Revisando", "Terminado"] } } } as never });
  const p = planificarImportacionCs(e, [tabla(csv)], OP);
  const ira = porNombre(p, "Ira Prueba");
  assert.deepEqual([ira.cvRecibido, ira.correccion1, ira.estado], [false, true, "Revisando"], "«revisando» es «Revisando» en su lista");
  assert.match(p.avisos.join("\n"), /fila 2 una casilla no se entendió \(ni Sí ni No\): quedó en No/);
  assert.doesNotMatch(p.avisos.join("\n"), /no está en la lista de estados/);
});

/* ---------- La acción del almacén ---------- */

test("el almacén escribe el lote con las revisiones, las reemplaza por id y deja las demás", () => {
  fijarAcceso(null);
  const estadoActual = () => JSON.parse(acciones.exportar()) as EstadoApp;
  const a = revisionCvNormal({ id: "cv_lote_1", nombre: "Lote Uno", estado: "En proceso" });
  const b = revisionCvNormal({ id: "cv_lote_2", nombre: "Lote Dos", estado: "Con Yari" });
  acciones.importarClientesCs({ alumnos: [], seguimientos: [], testimonios: [], resells: [], reportes: [], revisionesCv: [a, b], detalle: "Se importaron dos revisiones." });
  assert.deepEqual((estadoActual().revisionesCv ?? []).filter((r) => r.id.startsWith("cv_lote_")).map((r) => r.id).sort(), ["cv_lote_1", "cv_lote_2"]);
  acciones.importarClientesCs({ alumnos: [], seguimientos: [], testimonios: [], resells: [], reportes: [], revisionesCv: [{ ...a, estado: "Cerrado" }], detalle: "Se corrigió una." });
  const filas = (estadoActual().revisionesCv ?? []).filter((r) => r.id.startsWith("cv_lote_"));
  assert.equal(filas.length, 2, "no se duplicó");
  assert.equal(filas.find((r) => r.id === "cv_lote_1")!.estado, "Cerrado");
  assert.equal(filas.find((r) => r.id === "cv_lote_2")!.estado, "Con Yari");
  /* Un lote de antes (sin revisiones) sigue andando. */
  acciones.importarClientesCs({ alumnos: [], seguimientos: [], testimonios: [], resells: [], reportes: [], detalle: "Sin revisiones." });
  assert.equal((estadoActual().revisionesCv ?? []).filter((r) => r.id.startsWith("cv_lote_")).length, 2);
  acciones.borrarRevisionCv("cv_lote_1");
  acciones.borrarRevisionCv("cv_lote_2");
});
