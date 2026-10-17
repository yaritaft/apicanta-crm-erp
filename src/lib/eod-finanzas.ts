import type { EstadoApp } from "./types";
import { diaDeNegocio } from "./dia-negocio";
import { pasosDeFinanzas, semanaDe, type Chequeos } from "./finanzas-pasos";
import type { Chequeo, PasoCierre } from "./cierre-mes";

/* ==================================================================
   El cierre del día de Finanzas (el EOD de Aldana), como el de los closers:
   al final del día pasa por sus tareas de a una y cuenta cómo le fue.

   - Cada día se piden las tareas de todos los días (banco, ingresos, cuotas,
     Slack, la financiera, la caja, las pasarelas, los reembolsos…); los
     viernes se suman las de la semana (la weekly, el corte con la financiera,
     el informe, los KPIs al CEO…).
   - Cada una se contesta «Hecho», «No llegué» (con el motivo) o «Hoy no
     hacía falta». Lo que quedó en «No llegué» no desaparece al día siguiente:
     vuelve a preguntarse, marcado como lo que quedó pendiente, hasta que se
     haga. Lo mismo con una tarea de la semana que no se contestó el viernes.
   - Un día se cierra al terminar de contestar. Los días laborables sin
     cerrar se ven como tales.

   Se guarda con el resto de lo que se tilda en Finanzas (chequeos-finanzas):
   una fila por tarea y día, `eod|aaaa-mm-dd|<tarea>`, y una por el cierre del
   día, `eod|aaaa-mm-dd|_cierre`, con la nota del día.
   ================================================================== */

export type RespuestaDia = "hecho" | "no-llegue" | "no-hacia-falta";

export const RESPUESTAS: { id: RespuestaDia; nombre: string; sub: string }[] = [
  { id: "hecho", nombre: "Hecho", sub: "Lo hice" },
  { id: "no-llegue", nombre: "No llegué", sub: "Queda pendiente: mañana se vuelve a preguntar" },
  { id: "no-hacia-falta", nombre: "Hoy no hacía falta", sub: "No hubo nada para hacer" },
];

export const CIERRE_DEL_DIA = "_cierre";
export const claveEod = (dia: string, tarea: string) => `eod|${dia}|${tarea}`;

/* Cómo se nombra cada tarea en la fila de arriba del asistente. */
export const NOMBRE_CORTO: Record<string, string> = {
  "d-banco": "Banco", "d-ingresos": "Ingresos", "d-cuotas": "Cuotas", "d-tareas": "Tareas", "d-proveedores": "Proveedores",
  "d-slack": "Slack", "d-financiera": "Financiera", "d-caja": "Caja", "d-pasarelas": "Pasarelas", "d-reembolsos": "Reembolsos",
  "s-weekly": "Weekly", "s-kpis-reportes": "KPIs y reportes", "s-finanzas": "Finanzas", "s-suscripciones": "Suscripciones",
  "s-mora": "Por cobrar", "s-corte-financiera": "Corte", "s-informe": "Informe", "s-kpis-ceo": "KPIs al CEO",
};

const DIA_MS = 86400000;
const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaDeSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();          // 0 domingo … 6 sábado
export const esLaboral = (dia: string) => { const d = diaDeSemana(dia); return d >= 1 && d <= 5; };
/* Las tareas de la semana se piden el viernes (y el fin de semana, si se cierra el día igual). */
const tocaLaSemana = (dia: string) => { const d = diaDeSemana(dia); return d === 5 || d === 6 || d === 0; };
/** Cuántos días hacia atrás se arrastra lo que quedó sin hacer. */
const DIAS_QUE_ARRASTRA = 21;

export interface Registro { dia: string; tarea: string; estado: RespuestaDia; por?: string; en: string; nota?: string }

/** Lo contestado en los cierres del día, de más viejo a más nuevo. */
export function registrosEod(chequeos: Chequeos): Registro[] {
  const r: Registro[] = [];
  for (const [clave, c] of Object.entries(chequeos)) {
    const [tipo, dia, tarea] = clave.split("|");
    if (tipo !== "eod" || !dia || !tarea || tarea === CIERRE_DEL_DIA) continue;
    r.push({ dia, tarea, estado: (c.estado as RespuestaDia | undefined) ?? "hecho", por: c.por, en: c.en, nota: c.nota });
  }
  return r.sort((a, b) => a.dia.localeCompare(b.dia) || a.en.localeCompare(b.en));
}

/** El cierre de un día (quién y cuándo, con la nota del día), si se cerró. */
export const cierreDe = (chequeos: Chequeos, dia: string): Chequeo | undefined => chequeos[claveEod(dia, CIERRE_DEL_DIA)];

/* ---------- Qué se pregunta ---------- */

export interface PreguntaDia {
  id: string;
  paso: PasoCierre;
  cadencia: "dia" | "semana";
  /* Si quedó de un día anterior: cuándo, y qué dijo entonces. */
  desde?: string;
  notaAntes?: string;
}

interface Opciones { ahora?: number; esDueno: boolean }

/** Las tareas de un día: lo de todos los días, lo de la semana si toca, y lo que quedó pendiente de antes (primero). */
export function preguntasDelDia(e: EstadoApp, dia: string, chequeos: Chequeos, { ahora = Date.now(), esDueno }: Opciones): PreguntaDia[] {
  const diarias = pasosDeFinanzas(e, "dia", dia, { ahora, esDueno, chequeos: {} }).map((paso): PreguntaDia => ({ id: paso.id, paso, cadencia: "dia" }));
  const semanales = pasosDeFinanzas(e, "semana", semanaDe(dia), { ahora, esDueno, chequeos: {} }).map((paso): PreguntaDia => ({ id: paso.id, paso, cadencia: "semana" }));
  const todas = new Map([...diarias, ...semanales].map((p) => [p.id, p] as const));
  const base = tocaLaSemana(dia) ? [...diarias, ...semanales] : diarias;
  const hay = new Map(base.map((p) => [p.id, p] as const));

  const registros = registrosEod(chequeos).filter((r) => r.dia < dia);
  const reciente = sumarDias(dia, -DIAS_QUE_ARRASTRA);
  const ultima = new Map<string, Registro>();
  for (const r of registros) ultima.set(r.tarea, r);                      // de más viejo a más nuevo: queda la última
  const deAntes: PreguntaDia[] = [];

  /* Lo que quedó en «No llegué» y nadie hizo después. */
  for (const [tarea, r] of ultima) {
    if (r.estado !== "no-llegue" || r.dia < reciente) continue;
    const marca = { desde: r.dia, notaAntes: r.nota };
    const ya = hay.get(tarea);
    if (ya) Object.assign(ya, marca);
    else if (todas.has(tarea)) deAntes.push({ ...todas.get(tarea)!, ...marca });
  }

  /* Una tarea de la semana que el viernes pasado no se contestó (porque el día no se cerró). Sólo si ya se venía cerrando. */
  if (!tocaLaSemana(dia) && registros.length > 0) {
    let viernes = sumarDias(dia, -1);
    while (diaDeSemana(viernes) !== 5) viernes = sumarDias(viernes, -1);
    const lunes = sumarDias(viernes, -4);
    if (registros[0].dia <= viernes) {
      for (const p of semanales) {
        if (deAntes.some((x) => x.id === p.id)) continue;
        const contestada = registros.some((r) => r.tarea === p.id && r.dia >= lunes);
        if (!contestada) deAntes.push({ ...p, desde: viernes });
      }
    }
  }

  const orden = new Map([...diarias, ...semanales].map((p, i) => [p.id, i] as const));
  deAntes.sort((a, b) => (a.desde! < b.desde! ? -1 : a.desde! > b.desde! ? 1 : orden.get(a.id)! - orden.get(b.id)!));
  return [...deAntes, ...base];
}

/** Lo que dejó pendiente (y ya se vio): lo que vuelve a preguntarse hoy. */
export const pendientesDeAntes = (e: EstadoApp, dia: string, chequeos: Chequeos, o: Opciones): PreguntaDia[] =>
  preguntasDelDia(e, dia, chequeos, o).filter((p) => p.desde);

/* ---------- Los días ---------- */

export type EstadoDelDia = "cerrado" | "hoy" | "sin-cerrar" | "descanso";
export interface DiaDelEod { dia: string; estado: EstadoDelDia; cierre?: Chequeo; hechas: number; noLlegue: number; noHaciaFalta: number }

/** Los últimos días hasta hoy: cuáles se cerraron y cuáles no (desde que se empezó a usar; antes no se le reclama nada). */
export function diasDelEod(chequeos: Chequeos, ahora: number, cuantos = 7): DiaDelEod[] {
  const hoy = diaDeNegocio(new Date(ahora).toISOString());
  const todos = Object.keys(chequeos).map((k) => k.split("|")).filter((p) => p[0] === "eod").map((p) => p[1]).sort();
  const empezo = todos[0] ?? hoy;
  const registros = registrosEod(chequeos);
  const out: DiaDelEod[] = [];
  for (let i = cuantos - 1; i >= 0; i--) {
    const dia = sumarDias(hoy, -i);
    const cierre = cierreDe(chequeos, dia);
    const propios = registros.filter((r) => r.dia === dia);
    const estado: EstadoDelDia = cierre ? "cerrado" : dia === hoy ? "hoy" : esLaboral(dia) && dia >= empezo ? "sin-cerrar" : "descanso";
    out.push({
      dia, estado, cierre,
      hechas: propios.filter((r) => r.estado === "hecho").length,
      noLlegue: propios.filter((r) => r.estado === "no-llegue").length,
      noHaciaFalta: propios.filter((r) => r.estado === "no-hacia-falta").length,
    });
  }
  return out;
}
