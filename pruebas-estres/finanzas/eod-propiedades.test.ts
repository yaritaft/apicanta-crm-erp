import test from "node:test";
import assert from "node:assert/strict";
import { azar, congelar, donde, mundo } from "../plata/plata-mundo";
import { CIERRE_DEL_DIA, claveEod, diasDelEod, esLaboral, preguntasDelDia, registrosEod, type RespuestaDia } from "@/lib/eod-finanzas";
import type { Chequeos } from "@/lib/finanzas-pasos";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Frente «Finanzas en pasos» · el cierre del día de Aldana (End of Day), simulado semana tras semana.

   Se simula a alguien que cierra (o no) el día durante 70 días, contestando al azar, y en cada día se comprueba:
   E1  lo que quedó en «No llegué» vuelve a preguntarse con el día en que quedó, hasta que se hace: ninguna tarea
       pendiente se pierde (dentro de los 21 días que se arrastra).
   E2  lo que se hizo (o no hacía falta) no se arrastra: una tarea de todos los días con su última respuesta «hecho» no vuelve.
   E3  responder todo lo que se pregunta deja el día siguiente sin nada de antes.
   E4  las preguntas nunca se repiten, vienen primero las de antes, y el viernes (y el fin de semana) llevan las de la semana.
   E5  los últimos días dicen la verdad: cerrado sólo si se cerró; sin cerrar sólo un día laborable, desde que se empezó a usar y que ya pasó.
   E6  con muchísimos registros sigue siendo rápido.
   ================================================================== */

const DIARIAS = ["d-banco", "d-ingresos", "d-cuotas", "d-tareas", "d-proveedores", "d-slack", "d-financiera", "d-caja", "d-pasarelas", "d-reembolsos"];
const SEMANALES = ["s-weekly", "s-kpis-reportes", "s-finanzas", "s-suscripciones", "s-mora", "s-corte-financiera", "s-informe", "s-kpis-ceo"];
const DIA_MS = 86400000;
const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaDeSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();
const aQueHora = (dia: string, hora: number) => Date.parse(`${dia}T${String(hora).padStart(2, "0")}:00:00-03:00`);

interface Dia { dia: string; preguntas: ReturnType<typeof preguntasDelDia>; cerro: boolean; respuestas: Record<string, RespuestaDia> }

function simular(semilla: number, e: EstadoApp, dias = 70) {
  const r = azar(semilla);
  let chequeos: Chequeos = {};
  let dia = sumar("2026-08-03", r.entre(0, 25));
  const historial: Dia[] = [];
  /* La primera semana a veces no se usa: el sistema «arranca» cuando se cierra el primer día. */
  for (let i = 0; i < dias; i++, dia = sumar(dia, 1)) {
    const hora = r.elige([10, 18, 21, 22, 23]);            // de noche: a las 22 de acá ya es mañana en UTC
    const ahora = aQueHora(dia, hora);
    const preguntas = preguntasDelDia(e, dia, chequeos, { ahora, esDueno: true });
    const cierra = r.si(esLaboral(dia) ? 0.8 : 0.15);
    const respuestas: Record<string, RespuestaDia> = {};
    const nuevos: Chequeos = {};
    if (cierra) {
      const hasta = r.si(0.1) ? r.entre(0, preguntas.length) : preguntas.length;   // a veces corta a la mitad
      preguntas.slice(0, hasta).forEach((p) => {
        const estado: RespuestaDia = r.elige(["hecho", "hecho", "hecho", "hecho", "hecho", "hecho", "hecho", "no-llegue", "no-llegue", "no-hacia-falta"] as const);
        respuestas[p.id] = estado;
        nuevos[claveEod(dia, p.id)] = { por: "Aldana", en: new Date(ahora).toISOString(), estado, ...(estado === "no-llegue" ? { nota: "falta el extracto" } : {}) };
      });
      if (hasta === preguntas.length) nuevos[claveEod(dia, CIERRE_DEL_DIA)] = { por: "Aldana", en: new Date(ahora).toISOString(), estado: "cerrado" };
    }
    historial.push({ dia, preguntas, cerro: Object.keys(nuevos).some((k) => k.endsWith(`|${CIERRE_DEL_DIA}`)), respuestas });
    chequeos = { ...chequeos, ...nuevos };
  }
  return { chequeos, historial };
}

const mundoFijo = (semilla: number): EstadoApp => congelar(mundo(semilla, { devoluciones: 3, gastos: 5 }).e as EstadoApp);

test("E1 a E4 · simulando 70 días: lo pendiente no se pierde, lo hecho no vuelve y las preguntas están en orden", () => {
  let conPendientes = 0, deAntes = 0, semanalesVencidas = 0;
  for (let semilla = 1; semilla <= 120; semilla++) {
    const e = mundoFijo(semilla);
    const { historial } = simular(semilla, e);
    /* Lo último que se contestó de cada tarea hasta cada día (lo que ve el que pregunta). */
    const ultima = new Map<string, { dia: string; estado: RespuestaDia }>();
    let primero: string | null = null;
    for (const h of historial) {
      const cual = (t: string) => donde(semilla, h.dia, t);
      const ids = h.preguntas.map((p) => p.id);
      /* E4: sin repetidas, las de antes primero, y el viernes y el fin de semana llevan todas las de la semana. */
      assert.equal(new Set(ids).size, ids.length, `${donde(semilla, h.dia)}: preguntas repetidas`);
      const marcadas = h.preguntas.map((p) => Boolean(p.desde));
      for (const p of h.preguntas) if (p.desde) assert.ok(p.desde < h.dia, `${cual(p.id)}: «desde» ${p.desde} no es anterior`);
      for (const id of DIARIAS) assert.ok(ids.includes(id), `${cual(id)}: falta una tarea de todos los días`);
      const dow = diaDeSemana(h.dia);
      if (dow === 5 || dow === 6 || dow === 0) for (const id of SEMANALES) assert.ok(ids.includes(id), `${cual(id)}: falta una de la semana`);
      for (const id of ids) assert.ok(DIARIAS.includes(id) || SEMANALES.includes(id), `${cual(id)}: pregunta desconocida`);
      /* Lo que no es de la base va antes de lo de la base. */
      const baseIds = new Set([...DIARIAS, ...(dow === 5 || dow === 6 || dow === 0 ? SEMANALES : [])]);
      const extra = h.preguntas.filter((p) => !baseIds.has(p.id)).length;
      assert.ok(h.preguntas.slice(0, extra).every((p) => !baseIds.has(p.id)), `${donde(semilla, h.dia)}: las de antes tienen que ir primero`);
      if (marcadas.some(Boolean)) deAntes++;

      for (const [t, u] of ultima) {
        const pregunta = h.preguntas.find((p) => p.id === t);
        const dentro = (Date.parse(`${h.dia}T12:00:00Z`) - Date.parse(`${u.dia}T12:00:00Z`)) / DIA_MS <= 21;
        if (u.estado === "no-llegue" && dentro) {
          /* E1: lo pendiente vuelve, con el día en que quedó. */
          assert.ok(pregunta, `${cual(t)}: quedó «No llegué» el ${u.dia} y no se volvió a preguntar`);
          assert.equal(pregunta!.desde, u.dia, `${cual(t)}: tiene que decir desde cuándo quedó`);
        } else if (u.estado !== "no-llegue" && DIARIAS.includes(t) && pregunta) {
          /* E2: lo hecho de todos los días no se arrastra. */
          assert.equal(pregunta.desde, undefined, `${cual(t)}: se hizo el ${u.dia} y vuelve como pendiente`);
        }
      }
      if (h.preguntas.some((p) => p.desde)) conPendientes++;
      if (h.preguntas.some((p) => p.desde && SEMANALES.includes(p.id) && ![...ultima.values()].some((u) => u.estado === "no-llegue"))) semanalesVencidas++;

      /* Lo contestado hoy pasa a ser «lo último» para mañana. */
      for (const [t, estado] of Object.entries(h.respuestas)) { ultima.set(t, { dia: h.dia, estado }); primero ??= h.dia; }
    }
  }
  assert.ok(conPendientes > 200 && deAntes > 200, `la simulación casi no tiene pendientes (${conPendientes}): no estresa nada`);
  assert.ok(semanalesVencidas > 0, "la simulación nunca llegó a una tarea de la semana sin contestar");
});

test("E3 · contestar todo lo que se pregunta deja el día siguiente sin nada de antes", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const e = mundoFijo(semilla);
    const r = azar(semilla * 5 + 1);
    const { chequeos, historial } = simular(semilla, e, 40);
    const ultimoDia = historial[historial.length - 1].dia;
    const dia = sumar(ultimoDia, 1 + r.entre(0, 6));
    const preguntas = preguntasDelDia(e, dia, chequeos, { ahora: aQueHora(dia, 20), esDueno: true });
    const todo: Chequeos = { ...chequeos };
    for (const p of preguntas) todo[claveEod(dia, p.id)] = { por: "Aldana", en: new Date(aQueHora(dia, 20)).toISOString(), estado: r.elige(["hecho", "no-hacia-falta"] as const) };
    todo[claveEod(dia, CIERRE_DEL_DIA)] = { por: "Aldana", en: new Date(aQueHora(dia, 20)).toISOString(), estado: "cerrado" };
    const manana = sumar(dia, 1);
    const sigue = preguntasDelDia(e, manana, todo, { ahora: aQueHora(manana, 20), esDueno: true });
    assert.deepEqual(sigue.filter((p) => p.desde).map((p) => `${p.id}@${p.desde}`), [], `${donde(semilla, dia)}: queda algo de antes después de contestar todo`);
  }
});

test("E5 · los últimos días dicen la verdad: cerrado sólo si se cerró, sin cerrar sólo un día laborable ya pasado y desde que se usa", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const e = mundoFijo(semilla);
    const { chequeos, historial } = simular(semilla, e, 30);
    const r = azar(semilla + 4000);
    const ahora = aQueHora(sumar(historial[historial.length - 1].dia, r.entre(0, 3)), r.elige([9, 22, 23]));
    const dias = diasDelEod(chequeos, ahora, 7);
    assert.equal(dias.length, 7);
    const hoy = dias[dias.length - 1].dia;
    const empezo = Object.keys(chequeos).map((k) => k.split("|")[1]).sort()[0];
    dias.forEach((d, i) => {
      const cual = donde(semilla, d.dia, d.estado);
      if (i > 0) assert.equal(d.dia, sumar(dias[i - 1].dia, 1), `${cual}: los días tienen que ser seguidos`);
      const cerro = Boolean(chequeos[claveEod(d.dia, CIERRE_DEL_DIA)]);
      assert.equal(d.estado === "cerrado", cerro, `${cual}: cerrado ⇔ tiene su cierre`);
      if (d.estado === "sin-cerrar") assert.ok(esLaboral(d.dia) && d.dia < hoy && d.dia >= empezo && !cerro, cual);
      if (d.estado === "hoy") assert.ok(d.dia === hoy && !cerro, cual);
      assert.ok(d.hechas >= 0 && d.noLlegue >= 0 && d.noHaciaFalta >= 0, cual);
    });
    assert.equal(hoy, new Date(ahora - 3 * 3600000).toISOString().slice(0, 10), `${donde(semilla)}: «hoy» es el día de Argentina aunque en UTC ya sea mañana`);
  }
});

test("E6 · con meses de registros sigue siendo rápido y no se rompe con claves raras", () => {
  const e = mundoFijo(1);
  const chequeos: Chequeos = {};
  for (let d = 0; d < 400; d++) {
    const dia = sumar("2025-09-01", d);
    for (const t of [...DIARIAS, ...SEMANALES]) chequeos[claveEod(dia, t)] = { por: "Aldana", en: `${dia}T20:00:00.000Z`, estado: d % 3 === 0 ? "no-llegue" : "hecho", nota: "x".repeat(40) };
    chequeos[claveEod(dia, CIERRE_DEL_DIA)] = { por: "Aldana", en: `${dia}T20:05:00.000Z`, estado: "cerrado" };
  }
  /* Claves que no son del cierre del día, o rotas: se ignoran sin tirar. */
  Object.assign(chequeos, { "mes|2026-10|m-profit": { en: "2026-10-01T00:00:00.000Z" }, "eod": { en: "x" }, "eod||": { en: "x" }, "eod|2026-10-01": { en: "x" }, "eod|no-es-fecha|d-slack": { en: "2026-10-01T00:00:00.000Z" } });
  const antes = performance.now();
  const hoy = Date.parse("2026-10-16T22:30:00-03:00");
  assert.doesNotThrow(() => registrosEod(chequeos));
  const preguntas = preguntasDelDia(e, "2026-10-16", chequeos, { ahora: hoy, esDueno: true });
  const dias = diasDelEod(chequeos, hoy, 7);
  const ms = performance.now() - antes;
  assert.ok(preguntas.length >= 18 && dias.length === 7);
  assert.ok(ms < 1500, `con ${Object.keys(chequeos).length} registros tardó ${ms.toFixed(0)} ms`);
});
