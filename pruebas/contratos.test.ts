import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  accesosPendientes, bonosDeTexto, datosDelDocumento, datosLimpios, rotuloEvento, sesionesDeTexto,
  accesosAlFirmar, fichaAlFirmar, soloDuenos, accionesDe, cuerpoDocumento, estadoDePandadoc, fechaContrato, firmoElAlumno, leerAvisos, mensajeDelContrato,
  modalidadDeCuotas, partirNombre, problemaDeDatos, textoBonos, textoSesiones, variablesDelContrato, type DatosContrato,
} from "@/lib/contratos";
import { clavePandadoc, firmaPandadocValida } from "@/lib/pandadoc-servidor";
import { programaDeProducto, programasDe, PROGRAMAS_POR_DEFECTO, WISBOO } from "@/lib/programas";
import { idDeAcceso, mensajeDeBienvenida } from "@/lib/accesos-servidor";

/* El contrato de PandaDoc desde la venta (pedido del 20/10, el circuito de Blue OS traído a PandaDoc). */

const DATOS: DatosContrato = {
  nombre: "María José Pérez", email: "maria@ejemplo.com", telefono: "+54 9 11 5555-5555", documento: "30111222",
  domicilio: "Av. Siempre Viva 742, Córdoba", pais: "Argentina", modalidad: "Tres pagos de 1.000 USD", sesiones: 3,
  bonos: ["Revisión de LinkedIn", "Simulacro extra"], fecha: "2026-10-20",
};

test("estados de PandaDoc → los nuestros", () => {
  assert.equal(estadoDePandadoc("document.uploaded"), "creando");
  assert.equal(estadoDePandadoc("document.draft"), "borrador");
  assert.equal(estadoDePandadoc("document.sent"), "enviado");
  assert.equal(estadoDePandadoc("document.viewed"), "visto");
  assert.equal(estadoDePandadoc("document.completed"), "firmado");
  assert.equal(estadoDePandadoc("document.declined"), "rechazado");
  assert.equal(estadoDePandadoc("document.voided"), "anulado");
  assert.equal(estadoDePandadoc("algo.raro"), null);
});

test("la modalidad sale del plan de cuotas", () => {
  assert.equal(modalidadDeCuotas([{ monto: 2500 }]), "Un pago único de 2.500 USD");
  assert.equal(modalidadDeCuotas([{ monto: 1000 }, { monto: 1000 }, { monto: 1000 }]), "Tres pagos de 1.000 USD");
  assert.equal(modalidadDeCuotas([{ monto: 1400 }, { monto: 1400 }]), "Dos pagos de 1.400 USD");
  assert.equal(modalidadDeCuotas([{ monto: 300, esReserva: true }, { monto: 1100 }, { monto: 1100 }]), "Una reserva de 300 USD y dos pagos de 1.100 USD");
  assert.equal(modalidadDeCuotas([{ monto: 500 }, { monto: 1000 }, { monto: 1000 }]), "Pagos de 500 USD, 1.000 USD y 1.000 USD");
  assert.equal(modalidadDeCuotas([{ monto: 0 }]), "");
  assert.equal(modalidadDeCuotas([{ monto: 999.5 }]), "Un pago único de 999,50 USD");
});

test("sesiones, bonos y fecha en palabras", () => {
  assert.equal(textoSesiones(0), "No incluye sesiones 1 a 1 con el mentor");
  assert.equal(textoSesiones(1), "1 sesión 1 a 1 con el mentor, válida durante los primeros 3 meses del programa");
  assert.equal(textoSesiones(3), "3 sesiones 1 a 1 con el mentor, válidas durante los primeros 3 meses del programa");
  assert.equal(textoSesiones(null), "");
  assert.equal(textoBonos([]), "Sin bonos adicionales");
  assert.equal(textoBonos(["A", "B", "C"]), "A, B y C");
  assert.equal(fechaContrato("2026-10-20"), "20/10/2026");
});

test("las variables de la plantilla, con los nombres que pone Manu", () => {
  const v = Object.fromEntries(variablesDelContrato(DATOS, "Hackear AI").map((x) => [x.name, x.value]));
  assert.equal(v["Cliente.Nombre"], "María José Pérez");
  assert.equal(v["Cliente.Documento"], "30111222");
  assert.equal(v["Cliente.Domicilio"], "Av. Siempre Viva 742, Córdoba");
  assert.equal(v["Contrato.Fecha"], "20/10/2026");
  assert.equal(v["Venta.Modalidad"], "Tres pagos de 1.000 USD");
  assert.equal(v["Venta.Sesiones"], "3 sesiones 1 a 1 con el mentor, válidas durante los primeros 3 meses del programa");
  assert.equal(v["Venta.Bonos"], "Revisión de LinkedIn y Simulacro extra");
});

test("el documento: firma sólo el alumno (Client) y lleva el id del contrato", () => {
  const c = cuerpoDocumento({ contratoId: "ctr_1", ventaId: "ven_1", modo: "prueba", plantillaId: "tpl", programa: "Hackear AI", datos: DATOS });
  const rec = c.recipients as Record<string, string>[];
  assert.equal(rec.length, 1);
  assert.equal(rec[0].role, "Client");
  assert.equal(rec[0].first_name, "María José");
  assert.equal(rec[0].last_name, "Pérez");
  assert.equal((c.metadata as Record<string, string>).apicanta_contrato, "ctr_1");
  assert.match(String(c.name), /^\[Prueba\] Contrato Hackear AI - María José Pérez$/);
  assert.deepEqual(partirNombre("Cher"), { first_name: "Cher", last_name: "" });
});

test("el mensaje del mail reemplaza {nombre} y {programa}", () => {
  const m = mensajeDelContrato({ estado: "encendido", asunto: "Contrato de {programa}", mensaje: "Hola {nombre}" }, DATOS, "Hackear AI");
  assert.deepEqual(m, { subject: "Contrato de Hackear AI", message: "Hola María" });
  assert.match(mensajeDelContrato(undefined, DATOS, "Hackear Biz").subject, /Hackear Biz/);
});

test("los botones según el estado (un firmado no se anula ni se reenvía: se manda otro)", () => {
  assert.deepEqual(accionesDe({ estado: "firmado", documentoId: "d" }), ["ver-pdf", "mandar-otro"]);
  assert.deepEqual(accionesDe({ estado: "firmado", documentoId: null }), ["ver-pdf", "mandar-otro"]);
  assert.ok(accionesDe({ estado: "enviado", documentoId: "d" }).includes("reenviar"));
  assert.ok(accionesDe({ estado: "visto", documentoId: "d" }).includes("anular"));
  assert.deepEqual(accionesDe({ estado: "anulado", documentoId: "d" }), ["mandar-otro"]);
  assert.deepEqual(accionesDe({ estado: "error", documentoId: null }), ["mandar-otro"]);
  assert.deepEqual(accionesDe({ estado: "creando", documentoId: null }), []);
});

test("qué falta para mandarlo, y la prueba sólo a @apicanta.com", () => {
  assert.equal(problemaDeDatos(DATOS, "produccion"), null);
  assert.match(problemaDeDatos({ ...DATOS, email: "x" }, "produccion")!, /mail válido/);
  assert.match(problemaDeDatos({ ...DATOS, documento: "" }, "produccion")!, /documento/);
  assert.match(problemaDeDatos(DATOS, "prueba")!, /@apicanta\.com/);
  assert.equal(problemaDeDatos({ ...DATOS, email: "test@apicanta.com" }, "prueba"), null);
});

test("el aviso de PandaDoc: lista de eventos, con su metadata", () => {
  const a = leerAvisos([
    { event: "document_state_changed", data: { id: "doc1", status: "document.completed", template: { id: "tpl" }, metadata: { apicanta_contrato: "ctr_1", n: 3 } } },
    { event: "recipient_completed", data: { id: "doc2", status: "document.sent", action_by: { email: "maria@ejemplo.com" } } },
    { event: "raro", data: {} },
  ]);
  assert.equal(a.length, 2);
  assert.deepEqual(a[0].metadata, { apicanta_contrato: "ctr_1" });
  assert.equal(a[0].plantillaId, "tpl");
  assert.equal(a[1].quien, "maria@ejemplo.com");
  /* El documento del aviso viaja entero: si no se le puede volver a preguntar a PandaDoc, vale ése. */
  assert.equal(a[0].detalle.status, "document.completed");
  assert.deepEqual(leerAvisos(null), []);
});

test("la firma del aviso: HMAC del cuerpo crudo, con cualquiera de las claves", () => {
  const cuerpo = '[{"event":"document_state_changed","data":{"id":"x"}}]';
  const firma = createHmac("sha256", "clave-prueba").update(cuerpo).digest("hex");
  assert.ok(firmaPandadocValida(cuerpo, firma, ["otra", "clave-prueba"]));
  assert.ok(!firmaPandadocValida(cuerpo + " ", firma, ["clave-prueba"]), "un espacio de más ya no vale");
  assert.ok(!firmaPandadocValida(cuerpo, firma, ["otra"]));
  assert.ok(!firmaPandadocValida(cuerpo, null, ["clave-prueba"]));
  assert.ok(!firmaPandadocValida(cuerpo, "zz", ["clave-prueba"]));
});

test("¿firmó el alumno? (aunque falte otro firmante)", () => {
  assert.ok(firmoElAlumno({ status: "document.completed" }));
  assert.ok(firmoElAlumno({ status: "document.sent", recipients: [{ role: "Client", has_completed: true }, { role: "Sales Rep", has_completed: false }] }));
  assert.ok(!firmoElAlumno({ status: "document.viewed", recipients: [{ role: "Client", has_completed: false }] }));
});

test("la clave de producción de PandaDoc nunca sale fuera de la app publicada", () => {
  const antes = { e: process.env.VERCEL_ENV, p: process.env.PANDADOC_API_KEY, s: process.env.PANDADOC_SANDBOX_KEY };
  try {
    process.env.PANDADOC_API_KEY = "prod"; process.env.PANDADOC_SANDBOX_KEY = "sand";
    delete process.env.VERCEL_ENV;
    assert.equal(clavePandadoc("produccion"), null);
    assert.deepEqual(clavePandadoc("prueba"), { clave: "sand", modo: "prueba" });
    process.env.VERCEL_ENV = "production";
    assert.deepEqual(clavePandadoc("produccion"), { clave: "prod", modo: "produccion" });
    assert.deepEqual(clavePandadoc("prueba"), { clave: "sand", modo: "prueba" }, "en producción también se pueden hacer contratos de prueba");
  } finally {
    for (const [k, v] of [["VERCEL_ENV", antes.e], ["PANDADOC_API_KEY", antes.p], ["PANDADOC_SANDBOX_KEY", antes.s]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("los programas: Mentoría y el upgrade son Hackear AI, con Bonos; Downsell con IT y AI", () => {
  const ps = programasDe(undefined);
  assert.equal(ps, PROGRAMAS_POR_DEFECTO);
  assert.equal(programaDeProducto(ps, "prod_mentoria")?.id, "hackear-ai");
  assert.equal(programaDeProducto(ps, "prod_upgrade_ai")?.id, "hackear-ai");
  assert.ok(programaDeProducto(ps, "prod_mentoria")!.wisboo.includes(WISBOO.bonos));
  assert.deepEqual(programaDeProducto(ps, "prod_downsell")!.wisboo, [WISBOO.hackearIt, WISBOO.hackearAi]);
  assert.equal(programaDeProducto(ps, "prod_cena"), null);
  /* Principals y Principals Mastermind, misma plantilla. */
  const pr = ps.find((p) => p.id === "principals")!, pm = ps.find((p) => p.id === "principals-mastermind")!;
  assert.equal(pr.plantillaId, pm.plantillaId);
  /* Lo guardado en Ajustes manda, y se lee sin confiar. */
  const guardados = programasDe({ programas: [{ id: "x", nombre: "X", productos: ["p1", 3] } as never, { nombre: "sin id" } as never] });
  assert.equal(guardados.length, 1);
  assert.deepEqual(guardados[0].productos, ["p1"]);
});

test("accesos: id estable por alumno, plataforma y recurso; el mensaje con los links", () => {
  assert.equal(idDeAcceso("alu_1", "telegram", "-1001234"), "acc_alu_1_telegram_-1001234");
  assert.equal(idDeAcceso("alu_1", "wisboo", "PRO-1"), idDeAcceso("alu_1", "wisboo", "PRO-1"));
  const m = mensajeDeBienvenida("María José Pérez", "Hackear AI", [
    { plataforma: "telegram", nombre: "Comunidad", url: "https://t.me/+abc" },
    { plataforma: "zoom", nombre: "Consultas IA (Hackear AI) - ZOOM", url: "https://zoom.us/w/1" },
  ]);
  assert.match(m, /^¡Hola María! Ya sos parte de Hackear AI\./);
  assert.match(m, /• Comunidad: https:\/\/t\.me\/\+abc/);
  /* Zoom no le manda mail: sus links van en el mensaje, sin el « - ZOOM» del nombre. */
  assert.match(m, /Tus clases en vivo por Zoom[^\n]*\n• Consultas IA \(Hackear AI\): https:\/\/zoom\.us\/w\/1/);
});

test("el relleno: variables que la plantilla tiene y campos con «merge field» (las dos formas de armarla)", async () => {
  const { relleno } = await import("@/lib/contratos");
  const vars = variablesDelContrato(DATOS, "Hackear AI");
  const plantilla = {
    tokens: [{ name: "Venta.Modalidad" }],
    fields: [
      { merge_field: "Cliente.Nombre", type: "text" }, { merge_field: "Contrato.Fecha", type: "date" },
      { merge_field: null, type: "signature" }, { merge_field: "Otro.Campo", type: "text" },
    ],
  };
  const r = relleno(vars, plantilla, DATOS.fecha);
  assert.deepEqual(r.tokens, [{ name: "Venta.Modalidad", value: "Tres pagos de 1.000 USD" }]);
  assert.deepEqual(r.fields, { "Cliente.Nombre": { value: "María José Pérez" }, "Contrato.Fecha": { value: "2026-10-20T12:00:00.000Z" } });
  /* Sin el detalle de la plantilla van todas las variables (las que no existen, PandaDoc las ignora). */
  const c = cuerpoDocumento({ contratoId: "c", modo: "produccion", plantillaId: "t", programa: "Hackear AI", datos: DATOS });
  assert.equal((c.tokens as unknown[]).length, vars.length);
  assert.equal("fields" in c, false);
});

test("la fecha de inicio del servicio: sin dato es la del contrato; si arranca después, va esa (Manu, 20/10)", async () => {
  const { relleno } = await import("@/lib/contratos");
  const sin = Object.fromEntries(variablesDelContrato(DATOS, "Hackear AI").map((x) => [x.name, x.value]));
  assert.equal(sin["Contrato.Inicio"], "20/10/2026");
  const conInicio = variablesDelContrato({ ...DATOS, inicio: "2026-10-27" }, "Hackear AI");
  assert.equal(Object.fromEntries(conInicio.map((x) => [x.name, x.value]))["Contrato.Inicio"], "27/10/2026");
  /* Como campo de fecha con «merge field», va su propio día (no el del contrato). */
  const r = relleno(conInicio, { fields: [{ merge_field: "Contrato.Inicio", type: "date" }] }, DATOS.fecha);
  assert.deepEqual(r.fields, { "Contrato.Inicio": { value: "2026-10-27T12:00:00.000Z" } });
});

test("el aviso de producción se conecta solo una vez, y nunca si alguien lo desconectó", async () => {
  const { conectarAvisoSolo } = await import("@/lib/contratos");
  assert.equal(conectarAvisoSolo({ enProduccion: true, hayClave: true, hayFila: false }), true);
  assert.equal(conectarAvisoSolo({ enProduccion: true, hayClave: true, hayFila: true }), false, "ya conectado, o desconectado a mano");
  assert.equal(conectarAvisoSolo({ enProduccion: false, hayClave: true, hayFila: false }), false, "en local o en una versión de prueba, nunca");
  assert.equal(conectarAvisoSolo({ enProduccion: true, hayClave: false, hayFila: false }), false);
});

test("la bienvenida: PandaDoc manda al alumno a su página apenas firma", async () => {
  const { destinatario, esCodigoBienvenida } = await import("@/lib/contratos");
  const d = destinatario(DATOS, "https://apicanta-erp.vercel.app/bienvenida/abc");
  assert.deepEqual(d.redirect, { url: "https://apicanta-erp.vercel.app/bienvenida/abc", is_enabled: true });
  assert.equal("redirect" in destinatario(DATOS, null), false);
  const c = cuerpoDocumento({ contratoId: "c", modo: "produccion", plantillaId: "t", programa: "Hackear AI", datos: DATOS, despuesDeFirmar: "https://x/bienvenida/y" });
  assert.equal(((c.recipients as Record<string, unknown>[])[0].redirect as { url: string }).url, "https://x/bienvenida/y");
  assert.ok(esCodigoBienvenida("A".repeat(32)));
  assert.ok(!esCodigoBienvenida("corto"));
  assert.ok(!esCodigoBienvenida("../../etc/passwd-aaaaaaaaaaaaaaaaaaaaa"));
});

test("la bienvenida: qué ve el alumno en cada momento (y nunca su mail ni su documento)", async () => {
  const { armarBienvenida } = await import("@/lib/contratos");
  const contrato = { estado: "firmado" as const, accesosEn: "2026-10-21T00:00:00Z", destinatario: { nombre: "María José Pérez", email: "maria@ejemplo.com" } };
  const accesos = [
    { plataforma: "telegram" as const, estado: "dado" as const, recursoNombre: "Comunidad Hackear AI", externo: { link: "https://t.me/+abc" } },
    { plataforma: "telegram" as const, estado: "entro" as const, recursoNombre: "Avisos", externo: { link: "https://t.me/+def" } },
    { plataforma: "wisboo" as const, estado: "dado" as const, recursoNombre: "Mentoría (Hackear AI)", externo: { usuarioId: "u1" } },
    { plataforma: "wisboo" as const, estado: "fallo" as const, recursoNombre: "Bonos", externo: {} },
    { plataforma: "zoom" as const, estado: "quitado" as const, recursoNombre: "Clase vieja", externo: {} },
  ];
  const b = armarBienvenida({ contrato, programa: "Hackear AI", accesos, linkWisboo: "https://wisboo/magic", accesosAutomaticos: true });
  assert.equal(b.fase, "listo");
  assert.equal(b.nombre, "María");
  assert.deepEqual(b.telegram, [{ nombre: "Comunidad Hackear AI", adentro: false, url: "https://t.me/+abc" }, { nombre: "Avisos", adentro: true, url: null }]);
  assert.deepEqual(b.wisboo, { url: "https://wisboo/magic", cursos: ["Mentoría (Hackear AI)"] });
  assert.deepEqual(b.zoom, [], "lo quitado no se muestra");
  assert.equal(b.faltaAlgo, true);
  assert.ok(!JSON.stringify(b).includes("maria@ejemplo.com"));
  assert.equal(armarBienvenida({ contrato: { ...contrato, estado: "enviado" }, programa: "X", accesos, linkWisboo: null, accesosAutomaticos: true }).fase, "firmar");
  assert.equal(armarBienvenida({ contrato: { ...contrato, accesosEn: null }, programa: "X", accesos: [], linkWisboo: null, accesosAutomaticos: true }).fase, "preparando");
  assert.equal(armarBienvenida({ contrato: { ...contrato, accesosEn: null }, programa: "X", accesos: [], linkWisboo: null, accesosAutomaticos: false }).fase, "sin-accesos", "apagados: no hay nada que esperar");
  assert.equal(armarBienvenida({ contrato, programa: "X", accesos: [], linkWisboo: null, accesosAutomaticos: true }).fase, "sin-accesos");
  /* Después del outboarding (todo quitado) no se le promete nada: sus accesos ya no están activos. */
  assert.equal(armarBienvenida({ contrato, programa: "X", accesos: accesos.map((x) => ({ ...x, estado: "quitado" as const })), linkWisboo: null, accesosAutomaticos: true }).fase, "terminado");
});

test("Contratos: quién los manda y cuándo se dan los accesos al firmar, según Ajustes", () => {
  assert.equal(accesosAlFirmar("apagado", "produccion"), false);
  assert.equal(accesosAlFirmar(undefined, "prueba"), false);
  /* En prueba, sólo los contratos de prueba (sandbox). */
  assert.equal(accesosAlFirmar("prueba", "prueba"), true);
  assert.equal(accesosAlFirmar("prueba", "produccion"), false);
  /* Sólo dueños: contratos de verdad con accesos, como encendido. */
  assert.equal(accesosAlFirmar("duenos", "produccion"), true);
  assert.equal(accesosAlFirmar("encendido", "produccion"), true);
  assert.equal(soloDuenos("prueba"), true);
  assert.equal(soloDuenos("duenos"), true);
  assert.equal(soloDuenos("encendido"), false);
  assert.equal(soloDuenos("apagado"), false);
});

test("Contratos: lo que el contrato firmado deja en la ficha de Customer Success", () => {
  assert.deepEqual(fichaAlFirmar({ sesiones: 2 }, "Hackear AI", []), {
    contratoFirmado: "Firmado", estadoContrato: "Firmado en PandaDoc", sesionesMentor: 2, programas: ["Hackear AI"],
  });
  /* Sin sesiones 1 a 1 y con el programa ya cargado a mano: sólo se marca firmado. */
  assert.deepEqual(fichaAlFirmar({ sesiones: 0 }, "Hackear AI", ["Hackear IT"]), { contratoFirmado: "Firmado", estadoContrato: "Firmado en PandaDoc" });
  assert.deepEqual(fichaAlFirmar({}, "Downsell", null), { contratoFirmado: "Firmado", estadoContrato: "Firmado en PandaDoc", programas: ["Downsell"] });
});

test("sin sesiones 1 a 1, la plantilla sin el punto «Sesiones personalizadas» (Lili, 23/10: Santiago Ayala Restrepo las reclamaba)", async () => {
  const { plantillaDelContrato, programaNormal } = await import("@/lib/programas");
  const { textoSesiones } = await import("@/lib/contratos");
  const programa = programaNormal({
    id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_mentoria"], plantillaId: "PROG", plantillaNombre: "Contrato de Mentoría - Hackear AI",
    plantillaReservaId: "RES", plantillaReservaNombre: "Contrato de reserva - Hackear AI",
    plantillaSinSesionesId: "SIN", plantillaSinSesionesNombre: "Contrato de Mentoría - Hackear AI (sin sesiones)",
  })!;
  assert.deepEqual(plantillaDelContrato(programa, false, 0), { id: "SIN", nombre: "Contrato de Mentoría - Hackear AI (sin sesiones)" });
  assert.deepEqual(plantillaDelContrato(programa, false, 2), { id: "PROG", nombre: "Contrato de Mentoría - Hackear AI" }, "con sesiones, la de siempre");
  assert.deepEqual(plantillaDelContrato(programa, false, null), { id: "PROG", nombre: "Contrato de Mentoría - Hackear AI" }, "sin decir cuántas, la de siempre");
  assert.deepEqual(plantillaDelContrato(programa, true, 0), { id: "RES", nombre: "Contrato de reserva - Hackear AI" }, "la reserva manda");
  /* Sin la plantilla cargada en Ajustes, sale la de siempre con «No incluye» (como hasta hoy). */
  const sinCargar = programaNormal({ id: "hackear-ai", nombre: "Hackear AI", plantillaId: "PROG", plantillaNombre: "Contrato de Mentoría - Hackear AI" })!;
  assert.equal(plantillaDelContrato(sinCargar, false, 0).id, "PROG");
  assert.equal(textoSesiones(0), "No incluye sesiones 1 a 1 con el mentor");
});

test("sin sesiones: un documento mandado a mano se reconoce, y «Corregir» no cruza de 0 a tener sesiones (es otra plantilla)", async () => {
  const { cambiaLaPlantilla, programaDePlantilla, programaNormal } = await import("@/lib/programas");
  const ai = programaNormal({ id: "hackear-ai", nombre: "Hackear AI", plantillaId: "PROG", plantillaNombre: "Mentoría", plantillaReservaId: "RES", plantillaSinSesionesId: "SIN" })!;
  const biz = programaNormal({ id: "biz", nombre: "Hackear Biz", plantillaId: "BIZ", plantillaNombre: "Biz" })!;
  const programas = [ai, biz];
  assert.deepEqual(programaDePlantilla(programas, "SIN"), { programa: ai, tipo: "sinSesiones" });
  assert.deepEqual(programaDePlantilla(programas, "PROG"), { programa: ai, tipo: "programa" });
  assert.deepEqual(programaDePlantilla(programas, "RES"), { programa: ai, tipo: "reserva" });
  assert.equal(programaDePlantilla(programas, "OTRA"), null);
  assert.equal(programaDePlantilla(programas, ""), null);
  /* De 0 a 2 o de 2 a 0: otra plantilla, se frena. Entre cantidades o sin tocar las sesiones, se corrige. */
  assert.equal(cambiaLaPlantilla(ai, false, 0, 2), true);
  assert.equal(cambiaLaPlantilla(ai, false, 2, 0), true);
  assert.equal(cambiaLaPlantilla(ai, false, 1, 3), false);
  assert.equal(cambiaLaPlantilla(ai, false, 0, 0), false);
  assert.equal(cambiaLaPlantilla(ai, true, 0, 2), false, "la reserva siempre sale con la suya");
  assert.equal(cambiaLaPlantilla(biz, false, 0, 2), false, "un programa sin plantilla sin sesiones usa siempre la misma");
});

test("contrato de la reserva (Manu, 21/10): su plantilla, sólo el monto y sin accesos", async () => {
  const { armarBienvenida, modalidadDeReserva } = await import("@/lib/contratos");
  const { plantillaDelContrato, programaNormal } = await import("@/lib/programas");
  const programa = programaNormal({
    id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_mentoria"], plantillaId: "PROG", plantillaNombre: "Contrato de Mentoría - Hackear AI",
    plantillaReservaId: "RES", plantillaReservaNombre: "Contrato de reserva - Hackear AI",
  })!;
  assert.deepEqual(plantillaDelContrato(programa, true), { id: "RES", nombre: "Contrato de reserva - Hackear AI" });
  assert.deepEqual(plantillaDelContrato(programa, false), { id: "PROG", nombre: "Contrato de Mentoría - Hackear AI" });
  /* Un programa sin contrato de reserva cargado (los guardados de antes no traen el campo). */
  const viejo = programaNormal({ id: "biz", nombre: "Hackear Biz", plantillaId: "BIZ", plantillaNombre: "Biz" })!;
  assert.deepEqual(plantillaDelContrato(viejo, true), { id: "", nombre: "" });

  /* [Venta.Modalidad] = sólo el monto: «El Cliente paga una reserva de 300 USD mediante el link…». */
  assert.equal(modalidadDeReserva(300), "300 USD");
  assert.equal(modalidadDeReserva(1500.5, "USD"), "1.500,50 USD");
  assert.equal(modalidadDeReserva(0), "");
  assert.equal(problemaDeDatos({ ...DATOS, reserva: true, modalidad: "" }, "produccion"), "Falta el monto de la reserva.");
  assert.equal(problemaDeDatos({ ...DATOS, reserva: true, modalidad: "300 USD", sesiones: null, inicio: undefined }, "produccion"), null);

  /* Firmada la reserva, la bienvenida no espera accesos: reservó su lugar. */
  const contrato = { estado: "firmado" as const, accesosEn: null, destinatario: { nombre: "Juan Cruz" }, datos: { reserva: true } };
  assert.equal(armarBienvenida({ contrato, programa: "Hackear AI", accesos: [], linkWisboo: null, accesosAutomaticos: true }).fase, "reserva");
  assert.equal(armarBienvenida({ contrato: { ...contrato, estado: "enviado" }, programa: "Hackear AI", accesos: [], linkWisboo: null, accesosAutomaticos: true }).fase, "firmar");
});

/* ---------- Los contratos que el equipo manda a mano desde PandaDoc (23/10) ---------- */

test("un contrato mandado a mano desde PandaDoc: quién firma y lo que dicen sus variables", () => {
  const det = {
    recipients: [
      { email: "Yari@Apicanta.com", first_name: "Yari", last_name: "", role: "Sender", recipient_type: "signer" },
      { email: "Ana.Perez@Gmail.com ", first_name: null, last_name: null, role: "Client", recipient_type: "signer", phone: "" },
    ],
    tokens: [
      { name: "Cliente.Nombre", value: "Ana Pérez" }, { name: "Cliente.Documento", value: "30.111.222" },
      { name: "Cliente.Domicilio", value: "Calle 1, Córdoba" }, { name: "Contrato.Fecha", value: "22/10/2026" },
      { name: "Contrato.Inicio", value: "3/11/2026" }, { name: "Venta.Modalidad", value: "Una reserva de 300 USD y dos pagos de 1.000 USD" },
      { name: "Venta.Sesiones", value: "2 sesiones 1 a 1 con el mentor, válidas durante los primeros 3 meses del programa" },
      { name: "Venta.Bonos", value: "Bolsa de trabajo, Simulacros y Inglés" }, { name: "Cliente.Pais", value: "" },
    ],
  };
  const { destinatario, datos } = datosDelDocumento(det);
  /* Sin nombre en el firmante, sale de la variable; el mail, en minúscula. */
  assert.deepEqual(destinatario, { nombre: "Ana Pérez", email: "ana.perez@gmail.com", telefono: "" });
  assert.equal(datos.fecha, "2026-10-22");
  assert.equal(datos.inicio, "2026-11-03");
  assert.equal(datos.sesiones, 2);
  assert.deepEqual(datos.bonos, ["Bolsa de trabajo", "Simulacros", "Inglés"]);
  assert.equal(datos.documento, "30.111.222");
  /* Lo vacío no se inventa. */
  assert.equal("pais" in datos, false);
  assert.equal("telefono" in datos, false);
});

test("el documento todavía sin firmante (el aviso llega antes): nada que leer, y no rompe", () => {
  assert.deepEqual(datosDelDocumento({ recipients: [], tokens: [] }), { destinatario: { nombre: "", email: "", telefono: "" }, datos: {} });
  assert.deepEqual(datosDelDocumento(null).destinatario.email, "");
  /* Un campo con «merge field» también vale (si la plantilla lo usa en vez de la variable). */
  const r = datosDelDocumento({ recipients: [{ email: "b@x.com", first_name: "Beto", last_name: "Gómez", role: "Client" }], fields: [{ merge_field: "Contrato.Inicio", value: "2026-11-10T12:00:00.000Z" }] });
  assert.equal(r.datos.inicio, "2026-11-10");
  /* El perfil, si la plantilla tiene [Cliente.Perfil]: decide el roadmap del mail de bienvenida. Uno inventado, no. */
  assert.equal(datosDelDocumento({ tokens: [{ name: "Cliente.Perfil", value: "full stack" }] }).datos.perfil, "Full Stack");
  assert.equal(datosDelDocumento({ tokens: [{ name: "Cliente.Perfil", value: "Data-Engineer" }] }).datos.perfil, "Data Engineer");
  assert.equal("perfil" in datosDelDocumento({ tokens: [{ name: "Cliente.Perfil", value: "Backend" }] }).datos, false);
  assert.equal(Object.fromEntries(variablesDelContrato({ ...DATOS, perfil: "AI Engineer" }, "Hackear AI").map((x) => [x.name, x.value]))["Cliente.Perfil"], "AI Engineer");
  /* Así lo escribe el equipo a mano en PandaDoc: año de dos cifras. */
  assert.equal(datosDelDocumento({ tokens: [{ name: "Contrato.Inicio", value: "22/10/26" }] }).datos.inicio, "2026-10-22");
  assert.equal(r.destinatario.nombre, "Beto Gómez");
});

test("sesiones y bonos en palabras → de vuelta a datos (lo inverso de textoSesiones y textoBonos)", () => {
  assert.equal(sesionesDeTexto("No incluye sesiones 1 a 1 con el mentor"), 0);
  assert.equal(sesionesDeTexto("1 sesión 1 a 1 con el mentor, válida durante los primeros 3 meses del programa"), 1);
  assert.equal(sesionesDeTexto("Tres sesiones"), null);
  assert.deepEqual(bonosDeTexto("Sin bonos adicionales"), []);
  assert.deepEqual(bonosDeTexto("Bolsa de trabajo"), ["Bolsa de trabajo"]);
  assert.deepEqual(bonosDeTexto("A y B"), ["A", "B"]);
});

test("¿le faltan los accesos? firmó antes de que se cargara la venta, o quedó marcado sin dar nada", () => {
  const ev = (detalle: Record<string, unknown>, cuando = "2026-10-22T13:05:45Z") => ({ evento: "accesos", detalle, cuando });
  const espera = "Todavía no está cargada su venta: los accesos se dan solos apenas se cargue (o con «Dar los accesos»).";
  /* Firmado sin accesos todavía: falta, con el motivo si lo hay. */
  assert.deepEqual(accesosPendientes({ estado: "firmado", accesosEn: null }, []), { pendiente: true, motivo: null });
  assert.deepEqual(accesosPendientes({ estado: "firmado", accesosEn: null }, [ev({ dados: 0, motivo: espera })]), { pendiente: true, motivo: espera });
  /* Los de antes del 23/10: marcados como hechos con «0 dados» y el motivo. */
  const viejo = ev({ dados: 0, motivo: "El contrato no tiene alumno: los accesos se dan a mano desde su servicio." });
  assert.equal(accesosPendientes({ estado: "firmado", accesosEn: "2026-10-22T13:05:46Z" }, [viejo]).pendiente, true);
  /* Se dieron (aunque uno falle o ya estuviera): no falta nada; lo puntual se hace en la solapa Accesos. */
  assert.equal(accesosPendientes({ estado: "firmado", accesosEn: "x" }, [viejo, ev({ dados: 3, fallaron: 0, yaEstaban: 0 }, "2026-10-23T10:00:00Z")]).pendiente, false);
  assert.equal(accesosPendientes({ estado: "firmado", accesosEn: "x" }, [ev({ dados: 0, fallaron: 1, yaEstaban: 0 })]).pendiente, false);
  assert.equal(accesosPendientes({ estado: "firmado", accesosEn: "x" }, [ev({ dados: 0, yaEstaban: 2 })]).pendiente, false);
  /* La reserva no da accesos, y sin firmar no se habla de accesos. */
  assert.equal(accesosPendientes({ estado: "firmado", accesosEn: null, datos: { reserva: true } }, []).pendiente, false);
  assert.equal(accesosPendientes({ estado: "visto", accesosEn: null }, []).pendiente, false);
});

test("los datos limpios: mail en minúscula, fechas válidas y la reserva sólo si es true", () => {
  const d = datosLimpios({ nombre: "  Ana ", email: " ANA@X.COM ", fecha: "22/10/2026", inicio: "2026-11-03", reserva: "si" as unknown as boolean });
  assert.equal(d.nombre, "Ana");
  assert.equal(d.email, "ana@x.com");
  assert.match(d.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(d.inicio, "2026-11-03");
  assert.equal("reserva" in d, false);
});

test("el historial no dice «Se dieron los accesos» cuando no se dio nada", () => {
  assert.equal(rotuloEvento({ evento: "accesos", detalle: { dados: 0, motivo: "Todavía no está cargada su venta" } }), "Los accesos todavía no se dieron");
  assert.equal(rotuloEvento({ evento: "accesos", detalle: { dados: 8, fallaron: 3 } }), "Se dieron los accesos");
  assert.equal(rotuloEvento({ evento: "accesos", detalle: { dados: 0, fallaron: 3 } }), "Se dieron los accesos");
  assert.equal(rotuloEvento({ evento: "firmado", detalle: {} }), "Lo firmó");
});
