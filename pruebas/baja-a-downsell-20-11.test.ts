import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLAVE_DE_BAJA, corteDelFin, downsellsPosibles, marcaDeBaja, planDeBaja, problemaDeBaja, programasDespues, type AccesoDeBaja,
} from "@/lib/baja-a-downsell";
import { avisarFinesDeBaja, pasarADownsell, resumenDeBaja } from "@/lib/baja-a-downsell-servidor";
import { darAccesos } from "@/lib/accesos-servidor";
import { finDelPrograma } from "@/lib/clientes-cs";
import { claveDeCorte, PROGRAMAS_POR_DEFECTO, type Programa } from "@/lib/programas";
import type { Cuota, Producto, SeguimientoAlumno } from "@/lib/types";
import { baseEnMemoria, conServiciosFalsos, type Fila } from "./ayudas-accesos";

/* Lili (20/11): «un alumno ingresa a Hackear IA pero no puede seguir pagando: se toma lo que ya abonó y se lo pasa a la modalidad
   downsell, ajustando el programa y los accesos. Que no reinicie ni extienda el plazo de la mentoría». Yari: «el contenido grabado
   también se pierde pasado el tiempo». Datos inventados: el repositorio es público. */

const IT = "PRO-it", AI = "PRO-ai", BONOS = "PRO-bonos", BIZ = "PRO-biz";
const GENERAL = "-100111", NOVEDADES = "-100222", BOLSA = "-100333", GRUPO_BIZ = "-100999";
const ZOOM = "8400000001";

const COMPLETO: Programa = {
  id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_hackear_ai", "prod_mentoria"], plantillaId: "", plantillaNombre: "",
  wisboo: [IT, AI, BONOS], telegram: [GENERAL, NOVEDADES, BOLSA], zoom: [ZOOM], bonos: [], activo: true,
};
const DOWNSELL: Programa = { id: "downsell", nombre: "Downsell", productos: ["prod_downsell"], plantillaId: "", plantillaNombre: "", wisboo: [IT, AI], telegram: [], zoom: [], bonos: [], activo: true };
const PLUS: Programa = { ...DOWNSELL, id: "downsell-plus", nombre: "Downsell Plus+", productos: ["prod_downsell_plus"], telegram: [BOLSA] };
const MID: Programa = {
  ...DOWNSELL, id: "hackear-ia-mid", nombre: "Hackear IA MID", productos: ["prod_hackear_ia_mid"], telegram: [GENERAL, NOVEDADES], zoom: [ZOOM],
  vencen: { [claveDeCorte("telegram", GENERAL)]: 1, [claveDeCorte("telegram", NOVEDADES)]: 1, [claveDeCorte("zoom", ZOOM)]: 1 },
};
const EXTENSION: Programa = { ...MID, id: "hackear-ia-mid-extension", nombre: "Hackear IA MID · extensión", productos: ["prod_extension_mid"], sumaTiempo: true };
const BIZ_P: Programa = { ...DOWNSELL, id: "hackear-biz", nombre: "Hackear Biz", productos: ["prod_biz"], wisboo: [BIZ], telegram: [GRUPO_BIZ] };
const PROGRAMAS = [COMPLETO, BIZ_P, DOWNSELL, PLUS, MID, EXTENSION];

const prod = (id: string, nombre: string, precioLista: number, tipo: Producto["tipo"] = "downsell"): Producto => ({ id, nombre, precioLista, tipo, activo: true, orden: 0 });
const PRODUCTOS = [
  prod("prod_hackear_ai", "Hackear AI", 3000, "principal"), prod("prod_mentoria", "Mentoría", 3000, "principal"), prod("prod_biz", "Hackear Biz", 4500, "principal"),
  prod("prod_downsell", "Downsell", 497), prod("prod_downsell_plus", "Downsell Plus+", 997), prod("prod_hackear_ia_mid", "Hackear IA MID", 1497),
  prod("prod_extension_mid", "Extensión mentoría MID (+2 meses)", 1000, "upsell"),
];

const AHORA = new Date("2026-11-20T18:00:00.000Z");
const INICIO = "2026-08-03T15:00:00.000Z";
const FIN = "2027-01-10";

const cuota = (id: string, numero: number, monto: number, estado: Cuota["estado"] = "pendiente", extra: Partial<Cuota> = {}): Cuota =>
  ({ id, ventaId: "ven_1", numero, monto, estado, esReserva: false, vence: "2026-09-02T15:00:00.000Z", ...extra });
const acceso = (plataforma: AccesoDeBaja["plataforma"], recurso: string, programa = "hackear-ai", extra: Partial<AccesoDeBaja> = {}): AccesoDeBaja =>
  ({ id: `acc_${plataforma}_${recurso}`, plataforma, recurso, recursoNombre: `${plataforma} ${recurso}`, estado: "dado", programa, venceEn: null, ...extra });

/* ---------- a qué downsell pasa ---------- */

test("sale elegido el downsell más caro que se paga con lo que ya pagó (y nunca la extensión del MID)", () => {
  const elegido = (cobrado: number) => downsellsPosibles(PROGRAMAS, PRODUCTOS, cobrado).find((o) => o.alcanza)?.programaId;
  assert.deepEqual(downsellsPosibles(PROGRAMAS, PRODUCTOS, 825).map((o) => o.programaId), ["downsell", "downsell-plus", "hackear-ia-mid"], "del más barato al más caro, sin la extensión");
  assert.equal(elegido(825), "downsell", "pagó 825: le alcanza el Downsell (497), no el Plus+ (997)");
  assert.equal(elegido(997), "downsell-plus");
  assert.equal(elegido(2000), "hackear-ia-mid");
  assert.equal(elegido(100), "downsell", "si no le alcanza para ninguno, el más barato");
  assert.equal(downsellsPosibles(PROGRAMAS.map((p) => (p.id === "downsell-plus" ? { ...p, activo: false } : p)), PRODUCTOS, 997).some((o) => o.programaId === "downsell-plus"), false, "uno apagado no se ofrece");
});

test("qué no deja pasarlo: ya pasó, no es un programa completo, no pagó nada, ya pagó todo o no se sabe cuándo termina", () => {
  const opciones = downsellsPosibles(PROGRAMAS, PRODUCTOS, 825);
  const venta = { estado: "activa" as const, precioAcordado: 3000, extra: {} };
  const ok = { venta, origen: COMPLETO, cobrado: 825, fin: FIN, opciones };
  assert.equal(problemaDeBaja(ok), null);
  assert.match(problemaDeBaja({ ...ok, venta: { ...venta, extra: { [CLAVE_DE_BAJA]: { fin: FIN, venceEn: corteDelFin(FIN), programa: "Downsell" } } } })!, /Ya pasó/);
  assert.match(problemaDeBaja({ ...ok, origen: DOWNSELL })!, /Ya está en un downsell/);
  assert.match(problemaDeBaja({ ...ok, origen: null })!, /no es un programa/);
  assert.match(problemaDeBaja({ ...ok, cobrado: 0 })!, /no pagó nada/);
  assert.match(problemaDeBaja({ ...ok, cobrado: 3000 })!, /Ya pagó todo/);
  assert.match(problemaDeBaja({ ...ok, fin: null })!, /cuándo termina/);
  assert.match(problemaDeBaja({ ...ok, venta: { ...venta, estado: "cancelada" } })!, /dada de baja/);
});

/* ---------- el plan ---------- */

const plan = (extra: Partial<Parameters<typeof planDeBaja>[0]> = {}) => planDeBaja({
  venta: { id: "ven_1", precioAcordado: 3000 },
  cuotas: [cuota("c1", 1, 825, "pagada"), cuota("c2", 2, 1087.5), cuota("c3", 3, 1087.5)],
  pagos: [{ cuotaId: "c1", monto: 825 }],
  origen: COMPLETO, destino: DOWNSELL, precioDestino: 497, productos: PRODUCTOS,
  accesos: [
    acceso("wisboo", IT), acceso("wisboo", AI), acceso("wisboo", BONOS), acceso("telegram", GENERAL), acceso("telegram", BOLSA), acceso("zoom", ZOOM),
    acceso("wisboo", BIZ, "hackear-biz"), acceso("telegram", GRUPO_BIZ, "hackear-biz"), acceso("telegram", NOVEDADES, "hackear-ai", { estado: "quitado" }),
  ],
  inicio: INICIO, fin: FIN, programasFicha: ["HACKEAR IA"], ahora: AHORA, ...extra,
});

test("el caso de Lili: pagó 825 de 3.000 y pasa al Downsell → la venta vale lo que pagó, lo que falta no se cobra, se le saca la mentoría y conserva el contenido hasta el fin", () => {
  const p = plan();
  assert.equal(p.cobrado, 825);
  assert.deepEqual(p.noSeCobran.map((c) => c.id), ["c2", "c3"], "las cuotas que no pagó");
  assert.deepEqual(p.saldadas, []);
  assert.deepEqual(p.seSacan.map((x) => x.recurso).sort(), [BONOS, BOLSA, GENERAL, ZOOM].sort(), "la mentoría (grupos y Zoom) y los Bonos, que el Downsell no da");
  assert.deepEqual(p.quedan.map((x) => x.acceso.recurso), [IT, AI], "el contenido grabado");
  assert.ok(p.quedan.every((x) => x.venceEn === "2027-01-11T03:00:00.000Z"), "se corta solo el día después del fin, a la medianoche de Argentina");
  assert.equal(p.venceEn, corteDelFin(FIN));
  assert.ok(!p.seSacan.concat(p.quedan.map((x) => x.acceso)).some((x) => x.programa === "hackear-biz"), "lo de Hackear Biz no se toca");
  assert.ok(!p.seSacan.some((x) => x.estado === "quitado"), "lo ya quitado no se vuelve a quitar");
  assert.deepEqual(p.programasFicha, ["Downsell"]);
  assert.equal(p.pagoMenos, 0);
});

test("una cuota a medio pagar queda saldada en lo pagado; pagó menos que el downsell: igual queda en lo que pagó, y se avisa", () => {
  const p = plan({ cuotas: [cuota("c1", 1, 300), cuota("c2", 2, 2700)], pagos: [{ cuotaId: "c1", monto: 120 }], destino: DOWNSELL });
  assert.deepEqual(p.saldadas.map((c) => [c.id, c.monto, c.estado]), [["c1", 120, "pagada"]]);
  assert.match(p.saldadas[0].notas ?? "", /lo pagado/);
  assert.deepEqual(p.noSeCobran.map((c) => c.id), ["c2"]);
  assert.equal(p.pagoMenos, 377, "497 de lista − 120 pagados");
});

test("al MID: la mentoría que da por un mes cuenta desde el inicio de siempre; si ese mes ya pasó, se saca hoy", () => {
  const ya = plan({ destino: MID, precioDestino: 1497 });
  assert.deepEqual(ya.seSacan.map((x) => x.recurso).sort(), [BONOS, BOLSA, GENERAL, ZOOM].sort(), "empezó el 03/08: el mes de mentoría ya pasó");
  const recien = plan({ destino: MID, precioDestino: 1497, inicio: "2026-11-10T15:00:00.000Z", fin: "2027-02-10" });
  const general = recien.quedan.find((x) => x.acceso.recurso === GENERAL);
  assert.equal(general?.venceEn, "2026-12-10T15:00:00.000Z", "un mes desde el inicio, no desde hoy");
  assert.equal(recien.quedan.find((x) => x.acceso.recurso === IT)?.venceEn, corteDelFin("2027-02-10"), "el contenido, hasta el fin");
});

test("quien había subido del Plus+ al completo: lo que conserva del Plus+ también entra en el cambio", () => {
  const p = plan({ accesos: [acceso("wisboo", IT, "downsell-plus"), acceso("telegram", BOLSA, "downsell-plus"), acceso("telegram", GENERAL)] });
  assert.deepEqual(p.quedan.map((x) => x.acceso.recurso), [IT]);
  assert.deepEqual(p.seSacan.map((x) => x.recurso).sort(), [BOLSA, GENERAL].sort());
  assert.deepEqual(p.noTiene, [{ plataforma: "wisboo", recurso: AI }], "lo que el downsell da y no tiene de la app se dice, no se da solo");
});

test("los programas de la ficha: sale el completo con cualquiera de sus nombres y entra el downsell; lo demás queda", () => {
  assert.deepEqual(programasDespues(["HACKEAR IA"], COMPLETO, DOWNSELL, PRODUCTOS), ["Downsell"]);
  assert.deepEqual(programasDespues(["Hackear Biz", "Hackear AI", "Mentoría"], COMPLETO, DOWNSELL, PRODUCTOS), ["Hackear Biz", "Downsell"]);
  assert.deepEqual(programasDespues([], COMPLETO, PLUS, PRODUCTOS), ["Downsell Plus+"]);
  assert.deepEqual(programasDespues(["HACKEAR IA", "DOWNSELL"], COMPLETO, DOWNSELL, PRODUCTOS), ["DOWNSELL"], "si ya decía Downsell, no se repite");
});

test("el fin no cambia: misma duración aunque el downsell dure otra cosa, con la demora de inicio incluida", () => {
  const lista = ["Hackear AI", "Downsell", "Hackear Biz"];
  const demora = [{ id: "d", tipo: "demora" as const, desde: "2026-08-03", hasta: "2026-10-10", motivo: "", creadoPor: "", creadoEn: "", autorizadoPor: "X" }];
  const antes = { programas: ["HACKEAR IA"], duracionMeses: null, fechaEgreso: "2026-11-03", pausas: demora } as unknown as SeguimientoAlumno;
  const despues = { ...antes, programas: ["Downsell"], duracionMeses: 3 } as SeguimientoAlumno;
  assert.equal(finDelPrograma("2026-08-03", antes, "Hackear AI", lista), FIN);
  assert.equal(finDelPrograma("2026-08-03", despues, "Downsell", lista), FIN);
  /* Hackear Biz dura 6 meses y el Downsell 3: sin fijar la duración, el fin se acortaría tres meses. */
  const biz = { programas: ["Hackear Biz"], duracionMeses: null, fechaEgreso: null, pausas: [] } as unknown as SeguimientoAlumno;
  assert.equal(finDelPrograma("2026-08-03", biz, "Hackear Biz", lista), "2027-02-03");
  assert.equal(finDelPrograma("2026-08-03", { ...biz, programas: ["Downsell"], duracionMeses: 6 } as SeguimientoAlumno, "Downsell", lista), "2027-02-03");
  assert.equal(finDelPrograma("2026-08-03", { ...biz, programas: ["Downsell"] } as SeguimientoAlumno, "Downsell", lista), "2026-11-03", "por eso se fija");
});

/* ---------- en la base ---------- */

function base(extra: Record<string, Fila[]> = {}) {
  return baseEnMemoria({
    alumnos: [{ id: "alu_1", nombre: "Persona Inventada", inicio: INICIO, plan: "Mentoría", ventaId: "ven_1", leadId: "lead_1", email: "persona@ejemplo.test" }],
    ventas: [{ id: "ven_1", contactoId: "lead_1", contactoNombre: "Persona Inventada", productoId: "prod_hackear_ai", precioAcordado: 3000, moneda: "USD", estado: "activa", closerId: "eq_closer", extra: {} }],
    cuotas: [cuota("c1", 1, 825, "pagada"), cuota("c2", 2, 2175)] as unknown as Fila[],
    pagos: [{ id: "p1", cuotaId: "c1", monto: 825 }],
    productos: PRODUCTOS as unknown as Fila[],
    ajustes: [{ id: 1, programas: PROGRAMAS, contratos: { estado: "encendido" }, seguimiento: null }],
    seguimiento_alumnos: [{ id: "seg_alu_1", alumnoId: "alu_1", programas: ["HACKEAR IA"], duracionMeses: null, fechaEgreso: "2026-11-03",
      pausas: [{ id: "d", tipo: "demora", desde: "2026-08-03", hasta: "2026-10-10", motivo: "", creadoPor: "", creadoEn: "", autorizadoPor: "X" }] }],
    accesos_alumno: [acceso("wisboo", IT), acceso("wisboo", AI), acceso("telegram", GENERAL), acceso("zoom", ZOOM)].map((x) => ({ ...x, alumnoId: "alu_1", externo: {} })) as unknown as Fila[],
    telegram_grupos: [{ chatId: GENERAL, titulo: "Comunidad general" }],
    tipos_cuenta: [{ id: "dueno", areas: { finanzas: "editar" } }, { id: "contenido_finanzas", areas: { finanzas: "editar" } }, { id: "customer_success", areas: { alumnos: "editar" } }],
    usuarios_permitidos: [{ email: "finanzas@ejemplo.test", rol: "contenido_finanzas" }, { email: "duena@ejemplo.test", rol: "dueno" }, { email: "cs@ejemplo.test", rol: "customer_success" }],
    equipo: [{ id: "eq_closer", email: "closer@ejemplo.test", activo: true, puesto: "Closer" }, { id: "eq_cs", email: "cs@ejemplo.test", activo: true, puesto: "Customer Success" }],
    ...extra,
  });
}

test("en la base: el resumen antes de confirmar dice qué se saca hoy, qué conserva y hasta cuándo, y no toca nada", async () => {
  const b = base();
  const r = await resumenDeBaja(b.db, "alu_1");
  assert.equal(r.problema, null);
  assert.equal(r.cobrado, 825);
  assert.equal(r.fin, FIN);
  assert.equal(r.inicio, "2026-08-03");
  assert.equal(r.opciones.find((o) => o.alcanza)?.programaId, "downsell");
  const p = r.planes.downsell;
  assert.deepEqual(p.seSacan.map((x) => x.nombre).sort(), [`telegram ${GENERAL}`, `zoom ${ZOOM}`].sort());
  assert.deepEqual(p.quedan.map((x) => x.nombre), [`wisboo ${IT}`, `wisboo ${AI}`]);
  assert.deepEqual(p.noSeCobran, [{ numero: 2, esReserva: false, monto: 2175 }]);
  assert.deepEqual(p.aMano.hoy.map((x) => x.nombre), ["PRO-bonos", `Grupo de Telegram ${NOVEDADES}`, `Grupo de Telegram ${BOLSA}`], "lo del programa que la app no dio: a mano");
  assert.equal(b.escritos.length, 0, "el ensayo no escribe nada");
});

test("en la base: lo hace todo junto, sin mover el inicio ni el fin, y avisa a Finanzas y al closer (no a quien lo hizo)", async () => {
  const b = base();
  const pedidos: string[][] = [];
  const quitar = async (_db: unknown, a: { alumnoId: string; ids?: string[]; quien: string }) => {
    pedidos.push(a.ids ?? []);
    return { quitados: a.ids?.length ?? 0, fallaron: 0, accesos: [] };
  };
  const r = await pasarADownsell(b.db, { alumnoId: "alu_1", programaId: "downsell", motivo: "No puede seguir pagando", quien: "cs@ejemplo.test", ahora: AHORA, quitar: quitar as never });
  const venta = b.tablas.ventas[0];
  assert.equal(venta.productoId, "prod_downsell");
  assert.equal(venta.precioAcordado, 825);
  const marca = marcaDeBaja(venta as never)!;
  assert.equal(marca.desdePrograma, "Hackear AI");
  assert.equal(marca.precioAnterior, 3000);
  assert.equal(marca.fin, FIN);
  assert.equal(marca.dia, "2026-11-20");
  const c2 = b.tablas.cuotas.find((c) => c.id === "c2")!;
  assert.equal(c2.estado, "cancelada");
  assert.match(String(c2.notas), /^Incobrable: Pasó a Downsell por falta de pago \(No puede seguir pagando\)/, "queda como incobrable, con el motivo");
  const alumno = b.tablas.alumnos[0];
  assert.equal(alumno.inicio, INICIO, "el inicio no se mueve");
  assert.equal(alumno.plan, "Downsell");
  const seg = b.tablas.seguimiento_alumnos[0];
  assert.deepEqual(seg.programas, ["Downsell"]);
  assert.equal(seg.duracionMeses, 3, "la duración queda fija en la del programa que pagó");
  assert.deepEqual(pedidos, [[`acc_telegram_${GENERAL}`, `acc_zoom_${ZOOM}`]], "se saca la mentoría");
  const it = b.tablas.accesos_alumno.find((x) => x.recurso === IT)!;
  assert.equal(it.programa, "downsell");
  assert.equal(it.venceEn, corteDelFin(FIN));
  const avisos = b.tablas.avisos ?? [];
  assert.deepEqual(avisos.map((x) => x.para).sort(), ["closer@ejemplo.test", "finanzas@ejemplo.test"], "Finanzas (no los dueños) y el closer; quien lo hizo no");
  assert.match(String(avisos[0].cuerpo), /Sigue hasta el 10\/01\/2027 \(el inicio no cambia\)/);
  assert.equal((b.tablas.actividad ?? []).length, 1);
  assert.equal(r.detalle, String(avisos[0].cuerpo).split(" Sus accesos")[0]);
  await assert.rejects(pasarADownsell(b.db, { alumnoId: "alu_1", programaId: "downsell", motivo: "otra vez", quien: "cs@ejemplo.test", quitar: quitar as never }), /Ya pasó a Downsell/, "no se pasa dos veces");
  await assert.rejects(pasarADownsell(base().db, { alumnoId: "alu_1", programaId: "downsell", motivo: " ", quien: "x", quitar: quitar as never }), /por qué/);
});

test("si después le dan un downsell (firma el contrato o «Dar accesos»), lo que recibe no pasa del fin del programa que pagó", async () => {
  const b = base({ ventas: [{ id: "ven_1", estado: "activa", productoId: "prod_downsell", extra: { [CLAVE_DE_BAJA]: { fin: FIN, venceEn: corteDelFin(FIN), programa: "Downsell" } } }], accesos_alumno: [] });
  await conServiciosFalsos(() => darAccesos(b.db, {
    alumnoId: "alu_1", programa: DOWNSELL, origen: "automatico", quien: "Al firmar el contrato", persona: { nombre: "Persona Inventada", email: "persona@ejemplo.test" },
  }));
  const dados = b.tablas.accesos_alumno.filter((x) => x.estado === "dado");
  assert.equal(dados.length, 2);
  assert.ok(dados.every((x) => x.venceEn === corteDelFin(FIN)), "el Downsell no se corta nunca, salvo para quien bajó por falta de pago");
  const sinBaja = base({ accesos_alumno: [] });
  await conServiciosFalsos(() => darAccesos(sinBaja.db, {
    alumnoId: "alu_1", programa: DOWNSELL, origen: "automatico", quien: "Al firmar el contrato", persona: { nombre: "Persona Inventada", email: "persona@ejemplo.test" },
  }));
  assert.ok(sinBaja.tablas.accesos_alumno.every((x) => x.venceEn === null), "a quien compró el Downsell de entrada no se le corta");
  const contratos = readFileSync("src/lib/contratos-servidor.ts", "utf8");
  assert.match(contratos, /if \(inicio && !delPrograma\?\.sumaTiempo && !baja\)/, "firmar el contrato del downsell no le mueve el inicio");
});

test("el día que termina, si su contenido no lo había dado la app, Customer Success recibe el aviso de sacarlo a mano (una vez)", async () => {
  const marca = { dia: "2026-11-20", fin: FIN, venceEn: corteDelFin(FIN), programa: "Downsell", aManoAlFin: ["Hackear IT", "Hackear AI"] };
  /* La base en memoria no filtra por puesto (`or`): el equipo es sólo Customer Success. */
  const b = base({ ventas: [{ id: "ven_1", contactoId: "lead_1", contactoNombre: "Persona Inventada", extra: { [CLAVE_DE_BAJA]: marca } }], equipo: [{ id: "eq_cs", email: "cs@ejemplo.test", activo: true, puesto: "Customer Success" }] });
  assert.equal(await avisarFinesDeBaja(b.db, new Date("2027-01-10T20:00:00.000Z")), 0, "todavía no terminó");
  assert.equal(await avisarFinesDeBaja(b.db, new Date("2027-01-11T04:00:00.000Z")), 1);
  const avisos = b.tablas.avisos ?? [];
  assert.deepEqual(avisos.map((x) => x.para), ["cs@ejemplo.test"]);
  assert.match(String(avisos[0].cuerpo), /sacale a mano Hackear IT, Hackear AI/);
  await avisarFinesDeBaja(b.db, new Date("2027-01-11T05:00:00.000Z"));
  assert.equal((b.tablas.avisos ?? []).length, 1, "la pasada siguiente no lo repite");
  assert.equal(await avisarFinesDeBaja(b.db, new Date("2027-01-25T05:00:00.000Z")), 0, "pasada la semana, no se avisa de nuevo");
});

test("los programas de fábrica: el Downsell no da la mentoría y el MID la corta al mes", () => {
  const de = (id: string) => PROGRAMAS_POR_DEFECTO.find((p) => p.id === id)!;
  assert.deepEqual(de("downsell").telegram, []);
  assert.deepEqual(de("downsell").zoom, []);
});
