import type { Ajustes, CampoOpcionesCrm, ColorCrm, EstadoApp, EstadoSesion, OpcionCrm, OportunidadCrm, ResultadoLlamada, Sesion, TablaCrm } from "./types";
import { entraEnTabla, esCompra, estadoAutomatico, filasCrm, opcionesDe, sinTildes, tablasDe, type FilaCrm } from "./crm";

/* ==================================================================
   Los estados de una llamada de venta: una sola fuente.

   Son dos, los del Airtable de ventas que se copiaron a la grilla:
   - Estado Pre-Call: lo que pasó antes (Confirmado, Reagendar, Sin
     Respuesta).
   - Estado de Llamada: cómo terminó (Compra Full, Seguimiento Nutrición,
     Inasistió, Lead descartado…).
   Las opciones se editan desde la grilla y quedan en Ajustes. El CRM, la
   grilla, la Agenda, la ficha, el cierre del día, el Dashboard y Webinars
   muestran y cambian estos dos con lo de este archivo: lo que se cambia
   en un lugar aparece en todos.

   Lo demás no se carga, se deduce del Estado de Llamada:
   - si la llamada se hizo, no vino o se canceló, que es lo que cuenta la
     asistencia del Dashboard (estadoDeAgenda);
   - si cerró o no, para el Informe del CRM (desenlaceDe);
   - en qué etapa queda su oportunidad (lib/etapas-auto.ts).

   Sin nada cargado, dice «Por venir» si todavía no fue y «Sin cargar» si
   ya pasó: no son estados, son el aviso de que falta.
   ================================================================== */

export const SIN_CARGAR = "Sin cargar";
export const POR_VENIR = "Por venir";
/* Una sesión que no es de venta (una 1 a 1, un testimonio) y se hizo: las
   de venta dicen cómo terminó. */
export const HECHA = "Hecha";

/* Cómo terminó, para las cuentas del Informe. */
export const CON_CIERRE = "Con cierre";
export const SIN_CIERRE = "Sin cierre";
export const NO_SE_PRESENTO = "No se presentó";
export const REPROGRAMO = "Reprogramó";
export const CANCELADA = "Cancelada";
export type Desenlace =
  | typeof CON_CIERRE | typeof SIN_CIERRE | typeof NO_SE_PRESENTO | typeof REPROGRAMO | typeof CANCELADA
  | typeof SIN_CARGAR | typeof POR_VENIR;

/* Lo que cargaba el cierre del día antes de que los estados fueran uno
   solo: vale mientras la llamada no tenga su Estado de Llamada. */
const DE_RESULTADO: Record<ResultadoLlamada, Desenlace> = {
  compro: CON_CIERRE, "no-compro": SIN_CIERRE, "no-vino": NO_SE_PRESENTO, reprogramo: REPROGRAMO,
};

/** «Reagendar»: la persona pidió otra fecha; la agenda nueva entra sola
    de Calendly. */
export const esReagendar = (estadoPreCall?: string | null) => /reagend|reprogram/.test(sinTildes(estadoPreCall ?? ""));

/* ---------- Qué dice de la agenda ---------- */

const agendaDe = (o?: OpcionCrm): EstadoSesion | undefined => o?.llamada ?? (o?.auto === "cancelada" ? "cancelada" : undefined);

/** Cómo queda la agenda (hecha, no vino, cancelada) cuando el Estado de
    Llamada pasa a `nuevo`; undefined si no la mueve. Una opción de compra
    o de seguimiento la da por hecha; «Inasistió», por que no vino;
    «Canceló», por cancelada. Vaciar el estado la devuelve a agendada si
    era ese estado el que la había marcado (lo que canceló Calendly sigue
    cancelado). */
export function estadoDeAgenda(
  s: Pick<Sesion, "estado" | "estadoLlamada" | "canceladaEn">, nuevo: string | undefined | null, opciones: OpcionCrm[],
): EstadoSesion | undefined {
  const de = (n?: string | null) => (n ? opciones.find((o) => o.nombre === n) : undefined);
  const quiere = agendaDe(de(nuevo));
  if (quiere) return quiere === s.estado ? undefined : quiere;
  if (!nuevo && s.estadoLlamada) {
    const antes = agendaDe(de(s.estadoLlamada));
    if (antes && antes === s.estado && !(s.estado === "cancelada" && s.canceladaEn)) return "agendada";
  }
  return undefined;
}

/* ---------- Qué pregunta el cierre del día ---------- */

/** Lo que falta saber según el Estado de Llamada: de una compra, la venta;
    de una que quedó en seguimiento, por qué no cerró, si hubo oferta y
    para cuándo; de una que se perdió, por qué y si hubo oferta. De una
    que no vino o se canceló, nada. */
export type PreguntaEod = "venta" | "seguimiento" | "perdida" | "nada";

export function preguntaDe(o?: OpcionCrm): PreguntaEod {
  if (!o) return "nada";
  if (esCompra(o)) return "venta";
  if (o.oportunidad === "perdida") return "perdida";
  if (o.llamada === "hecha" && !o.oportunidad) return "seguimiento";
  return "nada";
}

/* ---------- Cómo terminó ---------- */

/** Con cierre, sin cierre, no se presentó… deducido de sus estados.
    `cargada` es la opción del Estado de Llamada que alguien cargó (no la
    automática). */
export function desenlaceDe(
  s: Pick<Sesion, "estado" | "estadoPreCall" | "resultado">, cargada: OpcionCrm | undefined, o: { venta: boolean; paso: boolean },
): Desenlace {
  if (o.venta || esCompra(cargada)) return CON_CIERRE;
  if (s.estado === "cancelada") return CANCELADA;
  if (s.estado === "no-show" || cargada?.llamada === "no-show") return NO_SE_PRESENTO;
  if (cargada && (cargada.llamada === "hecha" || cargada.oportunidad === "perdida" || cargada.oportunidad === "devolucion")) return SIN_CIERRE;
  if (s.resultado) return DE_RESULTADO[s.resultado];
  if (esReagendar(s.estadoPreCall)) return REPROGRAMO;
  return o.paso ? SIN_CARGAR : POR_VENIR;
}

/* ---------- Cómo se ve ---------- */

export interface EstadoVisible {
  /* Lo que se lee: la opción o, sin opción, «Sin cargar» / «Por venir».
     Vacío si no hay nada que decir (pidió otra fecha: lo dice su Estado
     Pre-Call, «Reagendar», y la agenda nueva entra sola). */
  texto: string;
  /* La opción del Estado de Llamada, cargada o automática. */
  opcion?: OpcionCrm;
  color: ColorCrm;
  /* La puso la app sola (no vino, canceló, segunda agenda). */
  auto: boolean;
  /* No hay opción: `texto` es sólo el aviso. */
  vacio: boolean;
  desenlace: Desenlace;
  /* Ya pasó y nadie cargó cómo terminó. */
  sinCargar: boolean;
  /* Es una llamada de venta: lleva los dos estados del Airtable. */
  deVenta: boolean;
}

/* El color de los avisos (no son opciones: no tienen el suyo). */
export const COLOR_AVISO: Record<string, ColorCrm> = {
  [SIN_CARGAR]: "amarillo1", [POR_VENIR]: "azul1", [HECHA]: "verde2", [CON_CIERRE]: "verde2", [SIN_CIERRE]: "naranja1",
  [NO_SE_PRESENTO]: "rojo1", [REPROGRAMO]: "gris1", [CANCELADA]: "gris2",
};

/** El Estado de Llamada tal cual se ve. `auto` es el que pone la app
    mientras nadie cargue otro (lib/crm: estadoAutomatico). */
export function estadoDe(
  s: Pick<Sesion, "estado" | "estadoLlamada" | "estadoPreCall" | "resultado" | "inicia">,
  o: { opciones: OpcionCrm[]; auto?: string; deVenta?: boolean; venta?: boolean; ahora?: number },
): EstadoVisible {
  const deVenta = o.deVenta ?? true;
  const paso = Date.parse(s.inicia) <= (o.ahora ?? Date.now());
  const cargada = s.estadoLlamada ? o.opciones.find((x) => x.nombre === s.estadoLlamada) : undefined;
  const desenlace = desenlaceDe(s, cargada, { venta: Boolean(o.venta), paso });
  const nombre = s.estadoLlamada || o.auto || "";
  const base = { desenlace, sinCargar: desenlace === SIN_CARGAR, deVenta };
  if (nombre) {
    const opcion = cargada ?? o.opciones.find((x) => x.nombre === nombre);
    return { ...base, texto: nombre, opcion, color: opcion?.color ?? "gris1", auto: !s.estadoLlamada, vacio: false };
  }
  /* Una que no es de venta y se marcó hecha: no hay más que decir. */
  const texto = !deVenta && s.estado === "hecha" ? HECHA : desenlace === REPROGRAMO ? "" : desenlace;
  return { ...base, sinCargar: texto === SIN_CARGAR, texto, color: COLOR_AVISO[texto] ?? "gris1", auto: true, vacio: true };
}

/* ---------- De cualquier llamada de la app ---------- */

type EstadoParaLlamadas = Pick<EstadoApp, "sesiones" | "contactos" | "ajustes" | "webinars"> & Partial<Pick<EstadoApp, "ventas" | "productos" | "leads">>;

/* Las filas del CRM se arman una vez por versión del estado (el store lo
   reemplaza entero en cada cambio): cada pastilla lo consulta sin volver
   a recorrer las llamadas. */
const POR_APP = new WeakMap<object, { filas: Map<string, FilaCrm>; opciones: OpcionCrm[]; tablas: TablaCrm[] }>();

function contexto(e: EstadoParaLlamadas) {
  let c = POR_APP.get(e);
  if (!c) {
    c = {
      filas: new Map(filasCrm(e).map((f) => [f.id, f])),
      opciones: opcionesDe(e.ajustes, "estadoLlamada"),
      tablas: tablasDe(e.ajustes),
    };
    POR_APP.set(e, c);
  }
  return c;
}

/** Si es una llamada de venta (entra en una tabla del CRM): las demás (una
    1 a 1, un testimonio) sólo dicen si se hicieron. */
export function esDeVenta(e: EstadoParaLlamadas, s: Pick<Sesion, "tipo">): boolean {
  return contexto(e).tablas.some((t) => entraEnTabla(s, t));
}

/** El estado de una llamada, igual en toda la app. */
export function estadoVisible(e: EstadoParaLlamadas, s: Sesion, ahora = Date.now()): EstadoVisible {
  const c = contexto(e);
  const fila = c.filas.get(s.id);
  const auto = fila ? (fila.estadoAuto ? fila.estadoLlamada : "") : estadoAutomatico(s, c.opciones, false);
  return estadoDe(s, {
    opciones: c.opciones, auto, ahora,
    deVenta: Boolean(fila) || c.tablas.some((t) => entraEnTabla(s, t)),
    venta: Boolean(fila?.venta),
  });
}

/* ==================================================================
   Ocultar un estado (F2-05: «hay una banda», Santi marca cuáles usa).

   Un estado oculto no se ofrece al cargar (SelectorOpciones lo saca de la
   lista), pero no se borra: las llamadas que ya lo tienen lo siguen
   mostrando con su color, y lo que pone la app sola (los «auto» y el estado
   de compra de una venta) sigue andando. Antes de ocultar uno se revisa qué
   mueve: la Agenda, la etapa del lead y lo que pregunta el cierre del día.
   ================================================================== */

/** Las opciones que se ofrecen al cargar: las que no están ocultas, y la que
 *  la llamada ya tiene aunque lo esté (se sigue viendo y sigue elegida). */
export const ofrecidas = (opciones: OpcionCrm[], actual?: string): OpcionCrm[] =>
  opciones.filter((o) => !o.oculta || o.nombre === actual);

/** El estado de compra que corresponde a una venta: el de su tipo (al
 *  contado, en cuotas, con reserva, downsell) o, si no hay, el primero de
 *  compra. Prefiere los que no están ocultos. */
export function opcionDeCompraPara(opciones: OpcionCrm[], tipo: OportunidadCrm): OpcionCrm | undefined {
  const visibles = opciones.filter((o) => !o.oculta);
  return visibles.find((o) => o.oportunidad === tipo) ?? visibles.find((o) => esCompra(o))
    ?? opciones.find((o) => o.oportunidad === tipo) ?? opciones.find((o) => esCompra(o));
}

const DE_COMPRA: Partial<Record<OportunidadCrm, string>> = {
  "compra-full": "al contado", "compra-cuotas": "en cuotas", reserva: "con reserva", downsell: "de downsell",
};

const DE_OPORTUNIDAD: Partial<Record<OportunidadCrm, string>> = {
  perdida: "de oportunidad perdida", devolucion: "de devolución",
};

/** Lo que mueve un estado, en castellano: la Agenda, la etapa del lead y lo
 *  que pregunta el cierre del día. */
export function queMueve(o: OpcionCrm, campo: CampoOpcionesCrm): string[] {
  const out: string[] = [];
  if (campo === "estadoPreCall") {
    if (esReagendar(o.nombre)) out.push("En el cierre del día vale como «pidió otra fecha»: la agenda nueva entra sola");
    return out;
  }
  if (campo !== "estadoLlamada") return out;
  if (o.llamada === "hecha") out.push("Marca la llamada como hecha en la Agenda");
  if (o.llamada === "no-show") out.push("Marca que no vino en la Agenda");
  if (o.auto === "cancelada") out.push("Se pone sola si la llamada se canceló y no volvió a agendar (la marca cancelada)");
  if (o.auto === "no-show") out.push("Se pone sola cuando la llamada queda como que no vino");
  if (o.auto === "segunda") out.push("Se pone sola si la persona ya había agendado antes");
  switch (o.oportunidad) {
    case "compra-full": case "compra-cuotas": case "reserva": case "downsell":
      out.push(`Es una compra ${DE_COMPRA[o.oportunidad]}: el cierre del día pide cargar la venta y, con la venta, el lead pasa a Inscripto`);
      break;
    case "perdida": out.push("Pasa el lead a Perdido (salvo que ya haya comprado)"); break;
    case "devolucion": out.push("Pasa el lead a Perdido aunque haya comprado"); break;
  }
  const que = preguntaDe(o);
  if (que === "seguimiento") out.push("El cierre del día pregunta por qué no cerró, si hizo la oferta y para cuándo lo estima");
  if (que === "perdida") out.push("El cierre del día pregunta por qué se perdió y si hizo la oferta");
  return out;
}

export interface RevisionOcultar {
  /* Lo que mueve hoy el estado (queMueve). */
  mueve: string[];
  /* Por qué no se puede ocultar: ocultarlo dejaría al cierre del día sin
     algo que necesita. null: se puede. */
  bloquea: string | null;
  /* Lo que cambia si se oculta, para confirmar. */
  avisos: string[];
  /* Cuántas llamadas lo tienen hoy. */
  usos: number;
}

/** Qué pasa si se oculta un estado: qué mueve, si rompe algo y qué cambia.
 *  `usos`: cuántas llamadas lo tienen cargado. */
export function revisarOcultar(a: Pick<Ajustes, "crm">, campo: CampoOpcionesCrm, nombre: string, usos = 0): RevisionOcultar {
  const lista = opcionesDe(a, campo);
  const o = lista.find((x) => x.nombre === nombre);
  if (!o) return { mueve: [], bloquea: null, avisos: [], usos };
  const otras = lista.filter((x) => x.nombre !== nombre && !x.oculta);
  const queda = (f: (x: OpcionCrm) => boolean) => otras.some(f);
  const avisos: string[] = [];
  let bloquea: string | null = null;

  if (campo === "estadoLlamada") {
    if (esCompra(o)) {
      if (!queda((x) => esCompra(x))) {
        bloquea = "Es el último estado de compra que queda a la vista: sin uno, el cierre del día no puede ofrecer «Cargar la venta». Dejá visible por lo menos uno.";
      } else if (o.oportunidad && DE_COMPRA[o.oportunidad] && !queda((x) => x.oportunidad === o.oportunidad)) {
        const en = opcionDeCompraPara(lista.map((x) => (x.nombre === nombre ? { ...x, oculta: true } : x)), o.oportunidad);
        avisos.push(`Las ventas ${DE_COMPRA[o.oportunidad]} van a dejar la llamada como «${en?.nombre ?? "—"}»: ya no hay un estado de compra propio para ellas.`);
      }
    }
    if (preguntaDe(o) === "seguimiento" && !queda((x) => preguntaDe(x) === "seguimiento")) {
      bloquea = "Es el último estado de seguimiento que queda a la vista: sin uno, el cierre del día no tiene cómo dejar una llamada en seguimiento (por qué no cerró, la oferta y para cuándo).";
    }
    for (const op of ["perdida", "devolucion"] as const) {
      if (o.oportunidad === op && !queda((x) => x.oportunidad === op)) {
        avisos.push(`Ya no habría ningún estado ${DE_OPORTUNIDAD[op]}: nadie podría marcar así una llamada y pasar el lead a Perdido.`);
      }
    }
    for (const llamada of ["hecha", "no-show"] as const) {
      if (o.llamada === llamada && !queda((x) => x.llamada === llamada)) {
        avisos.push(llamada === "hecha"
          ? "Ya no habría ningún estado que marque la llamada como hecha en la Agenda."
          : "Ya no habría ningún estado que marque a mano que no vino: sólo quedaría el que pone solo Calendly.");
      }
    }
    if (o.auto) avisos.push("Se sigue poniendo sola cuando corresponde; lo que cambia es que nadie podrá elegirla a mano.");
  }
  if (campo === "estadoPreCall" && esReagendar(o.nombre) && !queda((x) => esReagendar(x.nombre))) {
    bloquea = "El cierre del día usa «Reagendar» para las llamadas en las que la persona pidió otra fecha: sin ese estado no hay cómo dejarlas. Dejalo a la vista.";
  }
  if (usos > 0) avisos.push(`${usos === 1 ? "Una llamada lo tiene" : `${usos} llamadas lo tienen`} cargado: siguen mostrándolo igual, con su color.`);
  return { mueve: queMueve(o, campo), bloquea, avisos, usos };
}
