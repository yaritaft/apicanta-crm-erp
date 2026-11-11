import { fechaDeAcreditacion, retenciones } from "./acreditacion";
import type { Arqueo, EstadoApp, Gasto, ID, Moneda, Movimiento, Traspaso } from "./types";
import { aMonedaBase, categoriaDe, fechaDePago, montoOriginal, normalizar } from "./gastos";
import { esDevolucionConfirmada, pesosQueSalieron } from "./devoluciones";

/* ==================================================================
   Movimientos entre cuentas propias.

   La plata que pasa de una cuenta a otra (Stripe deposita en Mercury, de
   Mercury a la Financiera) no es un ingreso ni un gasto: no toca el P&L
   ni el total de la caja. Pero sin registrarla no se puede controlar
   cada cuenta por separado: Stripe baja y Mercury sube sin que la app
   sepa por qué. Lo que sí cuesta un pase (lo que salió menos lo que
   llegó) queda como gasto, en «Comisiones bancarias».

   Se cargan a mano o los detecta la sincronización de las cuentas:
   - Mercury ve llegar los depósitos de Stripe, Hotmart, Whop, dLocal,
     Mercado Pago y PayPal. Antes se descartaban (no son un cliente
     pagando); ahora son la LLEGADA de un pase.
   - Stripe dice cuándo mandó cada retiro al banco: la SALIDA.
   Cada dato de ésos es una «punta». Un pase con sus dos puntas está
   conciliado; con la salida sola, está en camino y, si pasan los días,
   salió y no llegó.

   Sin React ni base: las mismas reglas las usan el servidor (el cron que
   guarda lo que encuentra) y la pantalla (el botón que busca ahora).
   ================================================================== */

/* La categoría donde cae lo que cuesta un pase. */
export const CATEGORIA_COSTO = "Comisiones bancarias";
/* Lo que puede tardar un depósito en llegar; pasado eso, «salió y no llegó». */
export const DIAS_EN_CAMINO = 7;
/* A dónde van, desde fines de octubre, los retiros de Stripe, Whop y Hotmart: a una cuenta del Bank of America que ninguna API nos deja
   leer (Yari, 28/10: queda definitivo). Un retiro de esas cuentas que sale y nadie dijo a dónde fue se anota con ese destino; como el banco
   no avisa llegadas, se da por llegado (`esperaLlegada`) en vez de quedar «salió y no llegó». */
export const DESTINO_DE_RETIROS = { cuentaId: "proc_bofa", desde: "2026-10-28", origenes: new Set<ID>(["proc_stripe", "proc_whop", "proc_hotmart"]) } as const;
export function destinoDelRetiro(origenId: ID, fechaIso: string): ID | undefined {
  return DESTINO_DE_RETIROS.origenes.has(origenId) && fechaIso.slice(0, 10) >= DESTINO_DE_RETIROS.desde ? DESTINO_DE_RETIROS.cuentaId : undefined;
}
/* El destino que se dio por supuesto (lo puso esta regla, no una persona ni el banco): si después un banco que sí avisa ve llegar esa plata,
   la llegada manda y el destino pasa a ser ése. Uno cargado a mano nunca se pisa. */
export const destinoSupuesto = (t: Pick<Traspaso, "origen" | "destinoId" | "llegadaRef">): boolean =>
  t.origen === "api" && t.destinoId === DESTINO_DE_RETIROS.cuentaId && !t.llegadaRef;

/* Las cuentas que avisan cuando les llega plata de otra cuenta propia: de
   las demás no se puede esperar la llegada, se da por hecha. */
const AVISAN_LLEGADAS = new Set<ID>(["proc_mercury"]);
/* La llegada confirmada por una persona, no por la cuenta. */
export const LLEGADA_A_MANO = "a-mano";
/* Lo mismo con la salida: alguien miró en la cuenta cuánto salió de verdad
   (la comisión del retiro de Hotmart, que ninguna API nos dice). */
export const SALIDA_A_MANO = "a-mano";

/* Las cuentas que se quedan una comisión por mandar la plata al banco
   (Hotmart: en Mercury entran 1.000 cuando en Hotmart había 1.025). Cada
   llegada suya queda con «falta la comisión del retiro» hasta que alguien
   carga cuánto salió: nada la adivina ni la atribuye sola al faltante del
   arqueo (lote E, D9). */
export const COBRAN_RETIRO: ReadonlySet<ID> = new Set<ID>(["proc_hotmart"]);
/* Las que no cobran por el envío: si salió ≠ llegó, hay algo para revisar. */
export const SIN_COSTO_DE_ENVIO: ReadonlySet<ID> = new Set<ID>(["proc_stripe", "proc_whop"]);

const DIA = 86400000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- Las puntas que ve la sincronización ---------- */

export interface Punta {
  /* Si la cuenta lo vio salir o llegar. */
  lado: "salida" | "llegada";
  /* La cuenta que lo vio. */
  cuentaId: ID;
  /* La otra cuenta, si se deduce de con quién fue el movimiento. */
  otraCuentaId?: ID;
  /* Siempre positivo, en la moneda de la cuenta que lo vio. */
  monto: number;
  moneda: Moneda;
  fecha: string;
  /* El id del movimiento en esa cuenta ("mercury:6f1c…", "stripe:po_1Q…"):
     la misma punta no entra dos veces. */
  ref: string;
  /* Lo que dice el banco de la otra parte. */
  contraparte?: string;
  /* Seguro que es un pase entre cuentas propias (un depósito de Stripe en
     Mercury). Si no, queda propuesto hasta que alguien lo confirme. */
  seguro: boolean;
  /* Sólo en una salida: el día en que la cuenta dice que la plata llega al banco (Stripe lo sabe: `arrival_date`). Hasta ese día está en camino. */
  llegaEl?: string;
}

/* Con quién fue un movimiento del banco, si es una cuenta propia. Los ids
   de las cuentas son los del catálogo (proc_<pasarela>). */
const CONTRAPARTES: [RegExp, ID, boolean][] = [
  [/\bstripe\b/i, "proc_stripe", true],
  [/\bhotmart\b/i, "proc_hotmart", true],
  [/\bwhop\b/i, "proc_whop", true],
  [/\bd[\s-]?local\b/i, "proc_dlocal", true],
  [/\bmercado\s*pago\b/i, "proc_mercadopago", true],
  [/\bpaypal\b/i, "proc_paypal", true],
  /* De Binance también puede venir un cliente pagando (el banco lo deja
     entrar como cobro a conciliar): se propone y alguien lo confirma. */
  [/\bbinance\b/i, "proc_binance", false],
  /* Las vías por las que Hotmart liquida, según Yari («creo que»): también. */
  [/\b(arx|bridge|masspay)\b/i, "proc_hotmart", false],
  /* Relay es el otro banco de Apicanta LLC («Apicanta LLC - Relay»): lo que Mercury le manda es un pase, pero se propone y alguien lo confirma
     (Aldana, 01/11: los 30.000 de Mercury a Relay no estaban en ninguna parte). */
  [/\brelay\b/i, "proc_relay", false],
];

export function cuentaDeContraparte(texto: string | undefined | null): { cuentaId: ID; seguro: boolean } | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  for (const [re, cuentaId, seguro] of CONTRAPARTES) if (re.test(t)) return { cuentaId, seguro };
  return null;
}

/* Lo que Mercury llama a nuestra cuenta de Bank of America: «Bank of America - Checking ••4…». Sólo vale mirando a Mercury: en el extracto del propio
   Bank of America el nombre del banco está en cualquier línea (comisiones, tarjeta), así que `cuentaDeContraparte` no lo incluye. Se propone, no se
   da por seguro: un cliente que paga desde su cuenta del mismo banco podría figurar igual (Aldana, 11/11: la llegada de los US$ 100 que salieron de BofA
   quedó afuera y la app los dio por llegados el día que salieron). */
const BANCO_PROPIO_EN_MERCURY = /\b(bank\s*of\s*america|bofa)\b/i;
export function cuentaDeContraparteEnMercury(texto: string | undefined | null): { cuentaId: ID; seguro: boolean } | null {
  const propia = cuentaDeContraparte(texto);
  if (propia) return propia;
  return BANCO_PROPIO_EN_MERCURY.test((texto ?? "").trim()) ? { cuentaId: "proc_bofa", seguro: false } : null;
}

/* Si una punta puede ser de ese pase: las cuentas no se contradicen (y
   coinciden en al menos una), el monto de ese lado es el mismo (un 2% de
   margen, o un dólar) y la llegada es entre un día antes y diez después
   de la salida. Devuelve qué tan lejos está (menos es mejor), o null. */
function distancia(t: Traspaso, p: Punta): number | null {
  if (t.estado === "ignorado") return null;
  /* La llegada que alguien dio por hecha a mano no es una punta: si después
     la cuenta la ve llegar, es ésa (y no un pase nuevo, que la contaría dos veces). */
  if (p.lado === "salida" ? t.salidaRef : t.llegadaRef && t.llegadaRef !== LLEGADA_A_MANO) return null;
  const [esta, otra] = p.lado === "salida" ? [t.origenId, t.destinoId] : [destinoSupuesto(t) ? undefined : t.destinoId, t.origenId];
  if (esta && esta !== p.cuentaId) return null;
  if (otra && p.otraCuentaId && otra !== p.otraCuentaId) return null;
  if (esta !== p.cuentaId && !(otra && otra === p.otraCuentaId)) return null;
  const [monto, moneda] = p.lado === "salida" ? [t.montoSale, t.monedaSale] : [t.montoLlega, t.monedaLlega];
  if (moneda !== p.moneda) return null;
  const dif = Math.abs(monto - p.monto);
  if (dif > Math.max(1, 0.02 * Math.max(monto, p.monto))) return null;
  const salio = p.lado === "salida" ? p.fecha : t.fecha;
  const llego = p.lado === "llegada" ? p.fecha : t.fechaLlega ?? t.fecha;
  const dias = (Date.parse(llego) - Date.parse(salio)) / DIA;
  if (!Number.isFinite(dias) || dias < -1.5 || dias > 10) return null;
  /* Entre dos del mismo monto, en orden: la llegada va con la salida más
     vieja que la espera, y la salida, con la primera llegada. */
  return (dif / Math.max(1, p.monto)) * 100 + (p.lado === "llegada" ? 10 - dias : dias + 1.5) / 100;
}

/* Un retiro que la cuenta dice que llega al banco otro día: el pase queda en camino hasta ese día. */
const llegaDespues = (p: Punta): boolean => Boolean(p.llegaEl) && p.llegaEl!.slice(0, 10) > p.fecha.slice(0, 10);
const idDePunta = (ref: string) => `tra_${ref.replace(/[^a-zA-Z0-9]+/g, "_")}`.slice(0, 120);
const otroDia = (a: string, b: string) => a.slice(0, 10) !== b.slice(0, 10);

export interface ResultadoPuntas {
  /* Los pases que no existían. */
  nuevos: Traspaso[];
  /* Lo que cambia en los que ya estaban: la punta que les faltaba. */
  cambios: { id: ID; cambios: Partial<Traspaso> }[];
  /* Cuántos quedaron con sus dos puntas en esta pasada. */
  conciliados: number;
}

/** Lo que hay que guardar para sumar esas puntas a los pases que ya hay:
    la que ya está no se repite, la que es de un pase existente (cargado a
    mano, o del que ya se vio la otra punta) se le ata, y el resto son pases
    nuevos. No toca `existentes`. */
export function conciliarPuntas(existentes: Traspaso[], puntas: Punta[], ahora: string, cuentas?: readonly { id: ID }[]): ResultadoPuntas {
  /* Sin la cuenta del banco dada de alta, nada se manda hacia ella. */
  const hayDestino = !cuentas || cuentas.some((c) => c.id === DESTINO_DE_RETIROS.cuentaId);
  const todos = existentes.map((t) => ({ ...t }));
  const deAntes = new Set(existentes.map((t) => t.id));
  const tocados = new Map<ID, Partial<Traspaso>>();
  const nuevos: Traspaso[] = [];
  let conciliados = 0;
  const vistas = new Set(todos.flatMap((t) => [t.salidaRef, t.llegadaRef]).filter((x): x is string => Boolean(x)));

  /* De la más vieja a la más nueva: la salida de un pase antes que su llegada. */
  for (const p of [...puntas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (!p.ref || !(p.monto > 0) || vistas.has(p.ref)) continue;
    vistas.add(p.ref);

    let mejor: Traspaso | undefined;
    let menor = Infinity;
    for (const t of todos) {
      const d = distancia(t, p);
      if (d !== null && d < menor) { menor = d; mejor = t; }
    }

    if (mejor) {
      const manual = mejor.origen === "manual";
      const c: Partial<Traspaso> = {};
      if (p.lado === "salida") {
        c.salidaRef = p.ref;
        if (!mejor.origenId) c.origenId = p.cuentaId;
        if (!mejor.destinoId && p.otraCuentaId) c.destinoId = p.otraCuentaId;
        /* Lo que alguien cargó a mano no se pisa: sólo se le ata la punta. */
        if (!manual) {
          if (!mejor.fechaLlega && otroDia(mejor.fecha, p.fecha)) c.fechaLlega = mejor.fecha;
          c.fecha = p.fecha;
          c.montoSale = p.monto;
        }
      } else {
        c.llegadaRef = p.ref;
        /* La cuenta lo vio llegar: ya no hace falta que alguien diga que sigue en camino. */
        if (mejor.todaviaNoLlego) c.todaviaNoLlego = false;
        if (!mejor.destinoId || destinoSupuesto(mejor)) c.destinoId = p.cuentaId;
        if (!mejor.origenId && p.otraCuentaId) c.origenId = p.otraCuentaId;
        if (otroDia(mejor.fecha, p.fecha)) c.fechaLlega = p.fecha;
        if (!manual) c.montoLlega = p.monto;
      }
      if (!mejor.contraparte && p.contraparte) c.contraparte = p.contraparte;
      /* Con las dos puntas a la vista, o con una segura, deja de ser una propuesta. */
      const lasDos = Boolean((c.salidaRef ?? mejor.salidaRef) && (c.llegadaRef ?? mejor.llegadaRef));
      if (mejor.estado === "propuesto" && (lasDos || p.seguro)) c.estado = "confirmado";
      if (lasDos) conciliados++;
      Object.assign(mejor, c);
      if (deAntes.has(mejor.id)) tocados.set(mejor.id, { ...(tocados.get(mejor.id) ?? {}), ...c });
      continue;
    }

    const salida = p.lado === "salida";
    const t: Traspaso = {
      id: idDePunta(p.ref),
      fecha: p.fecha,
      origenId: salida ? p.cuentaId : p.otraCuentaId,
      destinoId: salida ? p.otraCuentaId ?? (hayDestino ? destinoDelRetiro(p.cuentaId, p.fecha) : undefined) : p.cuentaId,
      montoSale: p.monto, monedaSale: p.moneda,
      montoLlega: p.monto, monedaLlega: p.moneda,
      estado: p.seguro ? "confirmado" : "propuesto",
      ...(salida ? { salidaRef: p.ref } : { llegadaRef: p.ref }),
      ...(salida && llegaDespues(p) ? { fechaLlega: p.llegaEl } : {}),
      contraparte: p.contraparte,
      origen: "api",
      creadoEn: ahora,
    };
    todos.push(t);
    nuevos.push(t);
  }
  return { nuevos, cambios: [...tocados.entries()].map(([id, cambios]) => ({ id, cambios })), conciliados };
}

/* ---------- Cómo está cada pase ---------- */

export type Situacion =
  | "conciliado" | "en-camino" | "no-llego" | "detectado" | "a-mano" | "por-confirmar" | "ignorado"
  | "falta-comision" | "diferencia";

export const TEXTO_SITUACION: Record<Situacion, string> = {
  "conciliado": "Conciliado",
  "en-camino": "En camino",
  "no-llego": "Salió y no llegó",
  "detectado": "Detectado",
  "a-mano": "A mano",
  "por-confirmar": "Por confirmar",
  "ignorado": "No es un pase",
  "falta-comision": "Falta la comisión",
  "diferencia": "Salió ≠ llegó",
};

export const AYUDA_SITUACION: Record<Situacion, string> = {
  "conciliado": "Se vio salir de una cuenta y llegar a la otra.",
  "en-camino": "Salió de la cuenta y todavía no se vio llegar: un depósito puede tardar unos días.",
  "no-llego": `Salió hace más de ${DIAS_EN_CAMINO} días y no se vio llegar a ninguna cuenta conectada.`,
  "detectado": "Una de las dos cuentas lo vio; la otra no avisa de sus movimientos.",
  "a-mano": "Lo cargó alguien: ninguna cuenta conectada lo vio.",
  "por-confirmar": "Parece un pase entre cuentas propias, pero no es seguro: confirmalo o descartalo.",
  "ignorado": "Alguien dijo que no es un pase entre cuentas.",
  "falta-comision": "La plata llegó, pero falta cargar cuánto salió de la cuenta de origen: ahí está lo que cobró por el retiro. Cargala a mano para que no quede una sospecha en el arqueo.",
  "diferencia": "Esta cuenta no cobra por mandar la plata al banco y salió un monto distinto del que llegó: revisalo (corregí el monto o cargá la diferencia como gasto).",
};

/** Falta verlo llegar: la sincronización lo vio salir y la cuenta de destino avisa (o todavía no se sabe a cuál fue), o alguien dijo que el banco
    todavía no lo acreditó (`todaviaNoLlego`, para cualquier cuenta y también para lo cargado a mano). Una llegada confirmada a mano cuenta como llegada. */
export const esperaLlegada = (t: Pick<Traspaso, "salidaRef" | "llegadaRef" | "destinoId"> & Partial<Pick<Traspaso, "todaviaNoLlego">>) =>
  !t.llegadaRef && (Boolean(t.todaviaNoLlego) || (Boolean(t.salidaRef) && (!t.destinoId || AVISAN_LLEGADAS.has(t.destinoId))));

type DatosDeSituacion = Pick<Traspaso, "estado" | "salidaRef" | "llegadaRef" | "fecha" | "destinoId">
  & Partial<Pick<Traspaso, "origenId" | "origen" | "montoSale" | "montoLlega" | "monedaSale" | "monedaLlega" | "gastoId" | "todaviaNoLlego">>;

/** La llegada de una cuenta que cobra por el retiro (Hotmart → Mercury) a la
    que todavía nadie le cargó cuánto salió: ni a mano (`salidaRef`), ni con
    una diferencia ya cargada como costo. Lo cargado a mano por una persona
    no entra: ya dijo los dos montos. */
export function faltaComisionDelRetiro(t: DatosDeSituacion): boolean {
  if (t.estado !== "confirmado" || !t.origenId || !COBRAN_RETIRO.has(t.origenId)) return false;
  if (t.origen !== "api" || t.salidaRef || t.gastoId) return false;
  if (t.monedaSale && t.monedaLlega && t.monedaSale !== t.monedaLlega) return false;
  return !(r2((t.montoSale ?? 0) - (t.montoLlega ?? 0)) > 0);
}

/** Una cuenta que no cobra por el envío (Stripe, Whop) y donde lo que salió
    no es lo que llegó, sin que nadie lo haya cargado como gasto. */
export function diferenciaEnEnvio(t: DatosDeSituacion): boolean {
  if (!t.origenId || !SIN_COSTO_DE_ENVIO.has(t.origenId)) return false;
  if (!t.salidaRef || !t.llegadaRef || t.gastoId) return false;
  if (t.monedaSale && t.monedaLlega && t.monedaSale !== t.monedaLlega) return false;
  return Math.abs(r2((t.montoSale ?? 0) - (t.montoLlega ?? 0))) >= 0.01;
}

export function situacionDe(t: DatosDeSituacion, ahora = Date.now()): Situacion {
  if (t.estado === "ignorado") return "ignorado";
  if (t.estado === "propuesto") return "por-confirmar";
  if (faltaComisionDelRetiro(t)) return "falta-comision";
  if (diferenciaEnEnvio(t)) return "diferencia";
  if (t.salidaRef && t.llegadaRef) return "conciliado";
  if (esperaLlegada(t)) return ahora - Date.parse(t.fecha) > DIAS_EN_CAMINO * DIA ? "no-llego" : "en-camino";
  if (t.salidaRef || t.llegadaRef) return "detectado";
  return "a-mano";
}

/** El retiro con lo que salió de verdad de la cuenta de origen: la salida
    queda confirmada a mano y la diferencia con lo que llegó es la comisión. */
export function conComisionDelRetiro(t: Traspaso, salio: number): Traspaso {
  return { ...t, montoSale: r2(salio), salidaRef: SALIDA_A_MANO };
}

/* ---------- Lo que cuesta ---------- */

/** Lo que se perdió en el camino: lo que salió menos lo que llegó, si es
    la misma moneda. Entre monedas distintas no es un costo, es el cambio. */
export function costoDe(t: Pick<Traspaso, "montoSale" | "monedaSale" | "montoLlega" | "monedaLlega">): number {
  if (t.monedaSale !== t.monedaLlega) return 0;
  return Math.max(0, r2(t.montoSale - t.montoLlega));
}

/** El tipo de cambio que dice un pase entre monedas: pesos por dólar. */
export function cambioDe(t: Pick<Traspaso, "montoSale" | "monedaSale" | "montoLlega" | "monedaLlega">): number | null {
  if (t.monedaSale === t.monedaLlega) return null;
  const [pesos, dolares] = t.monedaSale === "ARS" ? [t.montoSale, t.montoLlega] : [t.montoLlega, t.montoSale];
  return dolares > 0 && pesos > 0 ? r2(pesos / dolares) : null;
}

/* ---------- Qué falta para cargar un movimiento, y en qué pantalla se arregla ----------
   El formulario paso a paso (FormTraspaso) pregunta una cosa por pantalla: cada cosa que falta dice cuál es la suya. El primero de la lista es el
   que se muestra cuando no se puede cargar. */

export type PasoMovimiento = "de" | "a" | "sale" | "llega" | "dia" | "costo";

export function problemasDelMovimiento(b: {
  origenId?: ID; destinoId?: ID;
  /* Un cobro de Conciliación: la cuenta a la que llegó ya se sabe y la de la que salió puede quedar sin decir. */
  desdeCobro?: boolean;
  montoSale: number; montoLlega: number;
  /* Hay un costo en pesos para pasar a dólares y falta el tipo de cambio. */
  faltaTc?: boolean;
  /* El día elegido y el de hoy (aaaa-mm-dd, hora de Argentina). Un movimiento es plata que ya pasó: el calendario del navegador abre en el mes
     de hoy y es fácil marcar el 29 de noviembre queriendo decir el 29 de octubre (Aldana, 01/11). */
  dia?: string; hoy?: string;
}): { paso: PasoMovimiento; texto: string }[] {
  const out: { paso: PasoMovimiento; texto: string }[] = [];
  if (!b.origenId && !b.desdeCobro) out.push({ paso: "de", texto: "Elegí de qué cuenta salió" });
  if (!b.destinoId) out.push({ paso: "a", texto: "Elegí a qué cuenta llegó" });
  else if (b.origenId && b.origenId === b.destinoId) out.push({ paso: "a", texto: "Las dos cuentas son la misma" });
  if (!(b.montoSale > 0)) out.push({ paso: "sale", texto: "Poné cuánto salió" });
  if (!(b.montoLlega > 0)) out.push({ paso: "llega", texto: "Poné cuánto llegó" });
  if (b.dia && b.hoy && b.dia > b.hoy) out.push({ paso: "dia", texto: "Ese día todavía no llegó: revisá el mes (el calendario abre en el de hoy)" });
  if (b.faltaTc) out.push({ paso: "costo", texto: "Poné el tipo de cambio para cargar el gasto" });
  return out;
}

const nombreDe = (e: Pick<EstadoApp, "procesadores">, id?: ID) => e.procesadores.find((p) => p.id === id)?.nombre ?? "otra cuenta";

/* ---------- Un cobro que en realidad es un movimiento entre cuentas ----------
   Aldana (reunión del 19/10): dos entradas de USDT Trust (125 y 60,50) no eran ventas, eran un cambio de
   Yari con un amigo. Se asignan como movimiento entre cuentas: queda el pase (de dónde salió la otra mitad,
   o «todavía sin identificar») y el cobro queda sin venta diciendo por qué. El pase guarda el cobro como su
   llegada (`llegadaRef`), así se encuentran sin una columna nueva. */

/** La llegada de un cobro, como la guarda un pase: «trust:<referencia>». */
export const llegadaDeCobro = (m: Pick<Movimiento, "proveedor" | "referencia">): string => `${m.proveedor}:${m.referencia}`;

/** El movimiento entre cuentas que tiene a este cobro como su llegada (los descartados no cuentan). */
export const paseDelCobro = (traspasos: readonly Traspaso[] | undefined, m: Pick<Movimiento, "proveedor" | "referencia">): Traspaso | undefined => {
  const ref = llegadaDeCobro(m);
  return (traspasos ?? []).find((t) => t.llegadaRef === ref && t.estado !== "ignorado");
};

/** El cobro que es la llegada de un pase: el mismo depósito del banco, que también entró a Conciliación como un cobro más. */
export function cobroDeLaLlegada(movimientos: readonly Movimiento[] | undefined, t: Pick<Traspaso, "llegadaRef">): Movimiento | undefined {
  if (!t.llegadaRef || t.llegadaRef === LLEGADA_A_MANO) return undefined;
  return (movimientos ?? []).find((m) => llegadaDeCobro(m) === t.llegadaRef);
}

/** Un pase cuya llegada ya está conciliada con una cuota (Aldana, 13/10: un depósito de «Bridge Arx» era el pago de un alumno y quedó
 *  como pase de Hotmart a Mercury): la plata cuenta como cobro y, si además es un pase, se cuenta dos veces —Mercury de más y Hotmart de menos
 *  en el arqueo—. Devuelve el cobro con el que se pisa; los descartados no pisan nada. */
export function paseQuePisaUnCobro(movimientos: readonly Movimiento[] | undefined, t: Pick<Traspaso, "llegadaRef" | "estado">): Movimiento | undefined {
  if (t.estado === "ignorado") return undefined;
  const cobro = cobroDeLaLlegada(movimientos, t);
  return cobro?.estado === "conciliado" ? cobro : undefined;
}

/** Lo que queda escrito en el cobro sin venta cuando es un movimiento entre cuentas. */
export function motivoDelMovimiento(e: Pick<EstadoApp, "procesadores">, t: Pick<Traspaso, "origenId" | "destinoId" | "notas">): string {
  const donde = t.origenId
    ? `salió de ${nombreDe(e, t.origenId)} y llegó a ${nombreDe(e, t.destinoId)}`
    : `llegó a ${nombreDe(e, t.destinoId)} desde una cuenta que todavía no se identificó`;
  return `Movimiento entre cuentas: ${donde}. No es una venta.${t.notas?.trim() ? ` ${t.notas.trim()}` : ""}`;
}

/** De qué cuenta a cuál: "Stripe → ACH-WIRE Mercury". */
export function rutaDe(e: Pick<EstadoApp, "procesadores">, t: Pick<Traspaso, "origenId" | "destinoId">): string {
  return `${t.origenId ? nombreDe(e, t.origenId) : "Sin cuenta de salida"} → ${t.destinoId ? nombreDe(e, t.destinoId) : "Sin cuenta de llegada"}`;
}

/** El gasto con lo que costó el pase, o null si no costó nada (o si es en
    pesos y falta el tipo de cambio para pasarlo a la moneda base). */
export function gastoDelCosto(e: EstadoApp, t: Traspaso, tipoCambio = 0): Gasto | null {
  const costo = costoDe(t);
  if (!(costo > 0)) return null;
  const base = e.ajustes.monedaBase;
  const enBase = t.monedaSale === base;
  const monto = r2(aMonedaBase(costo, t.monedaSale, base, tipoCambio));
  if (!(monto > 0)) return null;
  const retiro = t.origenId !== undefined && COBRAN_RETIRO.has(t.origenId);
  return {
    id: `gas_${t.id}`.slice(0, 120),
    categoria: CATEGORIA_COSTO,
    grupo: categoriaDe(e, CATEGORIA_COSTO)?.grupo ?? "operativo",
    concepto: retiro
      ? `Comisión de retiro ${nombreDe(e, t.origenId)}`
      : `Costo de pasar plata de ${nombreDe(e, t.origenId)} a ${nombreDe(e, t.destinoId)}`,
    monto, moneda: base, fecha: t.fecha, recurrente: false,
    proveedor: retiro ? nombreDe(e, t.origenId) : undefined,
    notas: retiro
      ? `Lo que cobró ${nombreDe(e, t.origenId)} por mandar la plata a ${nombreDe(e, t.destinoId)}, cargado a mano desde la Caja. Si se borra el movimiento, se borra solo.`
      : "Lo cargó el movimiento entre cuentas (Caja). Si se borra el movimiento, se borra solo.",
    creadoEn: t.creadoEn,
    /* Sin cuenta: lo que se perdió ya está en la diferencia del pase. */
    extra: { traspasoId: t.id, ...(enBase ? {} : { montoOriginal: costo, monedaOriginal: t.monedaSale, tipoCambio }) },
  };
}

/* ---------- Para no cargar dos veces el mismo ---------- */

/** Los pases que ya hay entre esas dos cuentas, por un monto parecido y
    en esos días. */
export function parecidos(
  traspasos: Traspaso[], b: Pick<Traspaso, "origenId" | "destinoId" | "montoSale" | "fecha">, salvo?: ID,
): Traspaso[] {
  if (!b.origenId || !b.destinoId || !(b.montoSale > 0)) return [];
  return traspasos.filter((t) => t.id !== salvo && t.estado !== "ignorado"
    && (!t.origenId || t.origenId === b.origenId) && (!t.destinoId || t.destinoId === b.destinoId)
    && (t.origenId === b.origenId || t.destinoId === b.destinoId)
    && Math.abs(t.montoSale - b.montoSale) <= Math.max(1, 0.02 * b.montoSale)
    && Math.abs(Date.parse(t.fecha) - Date.parse(b.fecha)) <= 7 * DIA);
}

/* ---------- La caja, cuenta por cuenta ---------- */

const entre = (iso: string | undefined, desde: number, hasta: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return t > desde && t <= hasta;
};

/* La llegada de un pase que la sincronización vio salir y todavía no vio
   llegar no se cuenta: la plata está en el camino. */
const llego = (t: Traspaso) => !esperaLlegada(t);

/** De qué cuenta salió un gasto, si lo dice: el id exacto (`extra.cuentaId`) o el nombre que se escribió al cargarlo (`extra.cuenta`:
 *  «Mercury», «Stripe», «Financiera ARS Juan»). Un nombre vale si es el de una sola cuenta, o una palabra del nombre de una sola
 *  («Mercury» es de «ACH-WIRE Mercury»); si alcanza a dos («Financiera»), no se sabe cuál. Sin dato, undefined. */
export function cuentaDeGasto(g: { extra?: Record<string, unknown> }, procesadores: readonly { id: ID; nombre: string }[]): ID | undefined {
  const id = typeof g.extra?.cuentaId === "string" ? g.extra.cuentaId : "";
  if (id) return id;
  const dicho = normalizar(typeof g.extra?.cuenta === "string" ? g.extra.cuenta : "");
  if (!dicho) return undefined;
  const iguales = procesadores.filter((p) => normalizar(p.nombre) === dicho);
  if (iguales.length === 1) return iguales[0].id;
  if (iguales.length > 1) return undefined;
  const palabras = (t: string) => normalizar(t).split(/[^a-z0-9]+/).filter(Boolean);
  const contiene = procesadores.filter((p) => dicho.split(/[^a-z0-9]+/).filter(Boolean).every((w) => palabras(p.nombre).includes(w)));
  return contiene.length === 1 ? contiene[0].id : undefined;
}

/** Lo que cada cuenta recibió menos lo que mandó en pases, en su moneda,
    entre dos momentos (sin incluir el primero). Sólo los confirmados. */
export function pasesPorCuenta(e: Pick<EstadoApp, "traspasos">, desdeIso: string | null, hastaIso: string): Map<ID, number> {
  const desde = desdeIso ? Date.parse(desdeIso) : -Infinity;
  const hasta = Date.parse(hastaIso);
  const out = new Map<ID, number>();
  const sumar = (id: ID | undefined, n: number) => { if (id) out.set(id, r2((out.get(id) ?? 0) + n)); };
  for (const t of e.traspasos ?? []) {
    if (t.estado !== "confirmado") continue;
    if (entre(t.fecha, desde, hasta)) sumar(t.origenId, -t.montoSale);
    if (llego(t) && entre(t.fechaLlega ?? t.fecha, desde, hasta)) sumar(t.destinoId, t.montoLlega);
  }
  return out;
}

/** La plata que en ese momento había salido de una cuenta y todavía no
    había llegado a la otra, en la moneda base: al contar las cuentas no
    está en ninguna. La que llegó después vale lo que llegó; la que sigue
    viajando, lo que salió. */
export function enCamino(e: Pick<EstadoApp, "traspasos" | "ajustes">, alIso: string, tipoCambio = 0): number {
  const al = Date.parse(alIso);
  const base = e.ajustes.monedaBase;
  let total = 0;
  for (const t of e.traspasos ?? []) {
    if (t.estado !== "confirmado" || !(Date.parse(t.fecha) <= al)) continue;
    if (!llego(t)) {
      /* Lo que viaja es lo que ya no está en la cuenta de origen y todavía no está en la de destino. Si lo que costó el pase ya se cargó como gasto
         (y el total ya lo restó), lo que falta llegar es lo que va a llegar; si no, es todo lo que salió. */
      const viaja = t.gastoId && t.monedaSale === t.monedaLlega ? t.montoLlega : t.montoSale;
      total += aMonedaBase(viaja, t.monedaSale, base, tipoCambio);
    }
    else if (Date.parse(t.fechaLlega ?? t.fecha) > al) total += aMonedaBase(t.montoLlega, t.monedaLlega, base, tipoCambio);
  }
  return r2(total);
}

/* ---------- Lo que puede estar en camino al contar ----------
   Aldana (11/11): «el lunes hice cierre de caja y siempre me queda con diferencias por la plata que salió de una cuenta pero aún no llega a la otra.
   ¿Eso está bien así? Yo igual justifico todas las diferencias». No estaba bien: la app ya sabía descontar lo que viaja entre cuentas, pero sólo si
   una cuenta conectada lo había visto salir y el destino era Mercury. Un pase cargado a mano, o hacia Bank of America, Relay o la Financiera, se daba
   por llegado el mismo día que salió; el banco tarda 1 a 3 días hábiles, y al contar justo en el medio la cuenta de destino «faltaba» esa plata (y al
   contar de nuevo «sobraba»). Quien cuenta es quien sabe si ya llegó: se le pregunta ahí, y la respuesta queda en el pase. */

/** Hasta cuántos días antes del corte puede haber salido una plata que todavía no llegó (una transferencia tarda 1 a 3 días hábiles: con un fin de
    semana en el medio, 5 corridos). Los pases más viejos se dan por llegados sin preguntar. */
export const DIAS_PARA_PREGUNTAR = 5;

/** Si, al momento `alIso`, la plata del pase ya había salido y todavía no estaba en la cuenta de destino. */
export function estabaEnCamino(t: Traspaso, alIso: string): boolean {
  const al = Date.parse(alIso);
  if (t.estado !== "confirmado" || !(Date.parse(t.fecha) <= al)) return false;
  return !llego(t) || Date.parse(t.fechaLlega ?? t.fecha) > al;
}

/** Los pases sobre los que vale preguntar al contar (corte = el momento del arqueo; previo = el del arqueo anterior): lo que salió hace poco y ningún
    banco vio llegar, lo que ya figura en camino y lo que alguien dijo que sigue sin llegar (aunque sea de antes). Un depósito que un banco vio llegar no
    se pregunta: el día que llegó manda. Con `dias` = Infinity, todo lo que salió desde el arqueo anterior (para buscar cuál explica lo que no da). */
export function pasesParaPreguntar(e: Pick<EstadoApp, "traspasos">, previoIso: string | null, corteIso: string, dias = DIAS_PARA_PREGUNTAR): Traspaso[] {
  const corte = Date.parse(corteIso);
  const previo = previoIso ? Date.parse(previoIso) : -Infinity;
  return (e.traspasos ?? []).filter((t) => {
    if (t.estado !== "confirmado" || !(Date.parse(t.fecha) <= corte)) return false;
    if (t.llegadaRef && t.llegadaRef !== LLEGADA_A_MANO) return false;
    if (t.todaviaNoLlego) return true;
    const salio = Date.parse(t.fecha);
    return salio > previo && (esperaLlegada(t) || salio > corte - dias * DIA);
  }).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
}

/** Lo que cambia en un pase cuando alguien dice, al contar, que al corte la plata seguía en camino o ya había llegado. Sin cambio de día: si la
    plata salió antes del arqueo anterior y ahora llegó, el día que llegó es a más tardar el de este arqueo (así cae en la ventana de este y no en la
    del anterior, que la contó en camino). */
export function cambioDeLlegada(t: Traspaso, enCamino: boolean, previoIso: string | null, corteIso: string): Partial<Traspaso> {
  if (enCamino) return { todaviaNoLlego: true, fechaLlega: undefined, ...(t.llegadaRef === LLEGADA_A_MANO ? { llegadaRef: undefined } : {}) };
  const salioAntes = previoIso !== null && Date.parse(t.fecha) <= Date.parse(previoIso);
  const llegoAntes = Boolean(t.fechaLlega) && Date.parse(t.fechaLlega!) <= Date.parse(corteIso);
  return {
    todaviaNoLlego: false,
    llegadaRef: t.llegadaRef ?? LLEGADA_A_MANO,
    fechaLlega: llegoAntes ? t.fechaLlega : salioAntes ? corteIso : undefined,
  };
}

/** Los pases con lo que se dijo al contar (`respuestas`: id → sigue en camino): lo que hay que guardar y lo que se usa para calcular lo esperado. */
export function conLlegadasDichas(
  traspasos: readonly Traspaso[] | undefined, respuestas: ReadonlyMap<ID, boolean>, previoIso: string | null, corteIso: string,
): Traspaso[] {
  return (traspasos ?? []).map((t) => (respuestas.has(t.id) ? { ...t, ...cambioDeLlegada(t, respuestas.get(t.id)!, previoIso, corteIso) } : t));
}

export interface PistaDeLlegada {
  traspasoId: ID;
  cuentaId: ID;
  /* Lo que hay menos lo que se esperaba, en la moneda de la cuenta. */
  diferencia: number;
  /* «camino»: la cuenta marca menos justo lo que se cree llegado; «llego»: marca más justo lo que figura en camino. */
  sugiere: "camino" | "llego";
}

/** Qué pases explican lo que no da en una cuenta: si falta (o sobra) justo el monto de uno o de unos pocos (hasta tres) pases que llegan a esa cuenta,
    probablemente es plata que todavía no llegó (o que ya llegó). `preguntas` trae cómo está cada uno ahora. No cambia nada: sólo avisa. */
export function pistasDeLlegada(
  filas: readonly { cuentaId: ID; moneda: Moneda; diferencia: number }[],
  preguntas: readonly { t: Traspaso; enCamino: boolean }[],
  tolerancia = 1,
): PistaDeLlegada[] {
  const out: PistaDeLlegada[] = [];
  for (const f of filas) {
    if (!(Math.abs(f.diferencia) >= tolerancia)) continue;
    /* Falta plata (diferencia negativa): se espera algo que no llegó. Sobra: figura en camino algo que ya llegó. */
    const sugiere: PistaDeLlegada["sugiere"] = f.diferencia < 0 ? "camino" : "llego";
    const objetivo = Math.abs(f.diferencia);
    const posibles = preguntas.filter((p) => p.t.destinoId === f.cuentaId && p.t.monedaLlega === f.moneda && p.enCamino === (sugiere === "llego"));
    const margen = Math.max(tolerancia, objetivo * 0.005);
    let hallado: typeof posibles | null = null;
    const probar = (desde: number, elegidos: typeof posibles, suma: number): void => {
      if (hallado) return;
      if (elegidos.length > 0 && Math.abs(suma - objetivo) <= margen) { hallado = elegidos; return; }
      if (elegidos.length === 3) return;
      for (let i = desde; i < posibles.length; i++) probar(i + 1, [...elegidos, posibles[i]], suma + posibles[i].t.montoLlega);
    };
    probar(0, [], 0);
    for (const p of (hallado ?? []) as typeof posibles) out.push({ traspasoId: p.t.id, cuentaId: f.cuentaId, diferencia: f.diferencia, sugiere });
  }
  return out;
}

export interface SaldoEsperado {
  moneda: Moneda;
  /* Lo contado en el arqueo anterior; sin eso no hay de dónde partir. */
  anterior?: number;
  /* Lo cobrado por la cuenta, neto de su comisión. */
  entro: number;
  /* Lo que recibió menos lo que mandó en pases. */
  pases: number;
  /* Los retiros, las devoluciones y los gastos que dicen que salieron de esta cuenta. */
  salio: number;
  esperado?: number;
}

/** Lo que tendría que haber en cada cuenta, en su moneda: lo del arqueo
    anterior más lo que cobró, más o menos los pases, menos lo que se sabe
    que salió de ahí: los retiros, las devoluciones y los gastos que dicen de qué
    cuenta se pagaron (la comisión de la pasarela no vuelve, ya está descontada
    del cobro). Los gastos que no dicen la cuenta (los viejos, los sueldos) no
    se pueden poner en ninguna: `gastosSinCuenta` los cuenta aparte. */
export function saldosEsperados(
  e: Pick<EstadoApp, "procesadores" | "pagos" | "gastos" | "traspasos"> & Partial<Pick<EstadoApp, "devoluciones" | "cuotas" | "ajustes">>,
  previo: Pick<Arqueo, "fecha" | "saldos"> | undefined, hastaIso: string,
): Map<ID, SaldoEsperado> {
  const desde = previo ? Date.parse(previo.fecha) : -Infinity;
  const hasta = Date.parse(hastaIso);
  const pases = pasesPorCuenta(e, previo?.fecha ?? null, hastaIso);
  const out = new Map<ID, SaldoEsperado>();
  for (const p of e.procesadores) {
    out.set(p.id, { moneda: p.moneda ?? "USD", anterior: previo?.saldos.find((s) => s.procesadorId === p.id)?.monto, entro: 0, pases: pases.get(p.id) ?? 0, salio: 0 });
  }
  /* Un cobro de una cuenta que retiene (Hotmart) entra a la caja el día que se acredita, no el del pago. */
  const retencion = retenciones(e.procesadores);
  for (const p of e.pagos) {
    const s = p.procesadorId ? out.get(p.procesadorId) : undefined;
    if (!s || !entre(fechaDeAcreditacion(p, retencion), desde, hasta)) continue;
    if (s.moneda === "ARS") {
      /* Sin el cambio del cobro, el de Ajustes: ignorarlo dejaba la cuenta corta y el total no (un cobro de US$ 65 a la Financiera ARS, 10/10). */
      const tc = p.tipoCambio ?? (e.ajustes?.tipoCambio ?? 0);
      const bruto = p.montoArs ?? (tc > 0 ? p.monto * tc : NaN);
      if (Number.isFinite(bruto)) s.entro += bruto - (tc > 0 ? p.feeMonto * tc : 0);
    } else {
      s.entro += p.monto - p.feeMonto;
    }
  }
  /* Lo devuelto sale de la cuenta por la que se devolvió: el monto entero (en
     pesos, los pesos que fueron; si la devolución no los trae, a razón del cambio
     con el que se cobró esa venta por esa cuenta o el de Ajustes). */
  for (const d of e.devoluciones ?? []) {
    const s = d.procesadorId && esDevolucionConfirmada(d) ? out.get(d.procesadorId) : undefined;
    if (!s || !entre(d.fecha, desde, hasta)) continue;
    if (s.moneda === "ARS") {
      const ars = pesosQueSalieron(e, d);
      if (Number.isFinite(ars)) s.salio += ars;
    } else {
      s.salio += d.monto;
    }
  }
  for (const g of e.gastos) {
    const cuenta = cuentaDeGasto(g, e.procesadores) ?? "";
    const s = cuenta ? out.get(cuenta) : undefined;
    /* El costo de un pase no sale aparte: ya está en su diferencia. */
    if (!s || g.extra?.traspasoId || !entre(fechaDePago(g), desde, hasta)) continue;
    const original = montoOriginal(g);
    if (s.moneda === "ARS") {
      /* Un gasto cargado en dólares que salió de la cuenta en pesos también sale de ella, al cambio del día de Ajustes (el pago a ARCA del 10/10,
         US$ 3.311,69 desde la Financiera ARS, no la bajaba: el total sí lo restaba y la suma de las cuentas no daba). */
      if (original?.moneda === "ARS") s.salio += original.monto;
      else if ((e.ajustes?.tipoCambio ?? 0) > 0) s.salio += g.monto * e.ajustes!.tipoCambio;
    } else s.salio += g.monto;
  }
  for (const s of out.values()) {
    s.entro = r2(s.entro); s.salio = r2(s.salio);
    if (s.anterior !== undefined) s.esperado = r2(s.anterior + s.entro + s.pases - s.salio);
  }
  return out;
}

/* ---------- De un vistazo ---------- */

export interface ResumenPases { porConfirmar: number; noLlegaron: number; enCamino: number; faltaComision: number; diferencias: number }

export function resumenDePases(traspasos: Traspaso[], ahora = Date.now()): ResumenPases {
  const r: ResumenPases = { porConfirmar: 0, noLlegaron: 0, enCamino: 0, faltaComision: 0, diferencias: 0 };
  for (const t of traspasos) {
    const s = situacionDe(t, ahora);
    if (s === "por-confirmar") r.porConfirmar++;
    else if (s === "no-llego") r.noLlegaron++;
    else if (s === "en-camino") r.enCamino++;
    else if (s === "falta-comision") r.faltaComision++;
    else if (s === "diferencia") r.diferencias++;
  }
  return r;
}

/** Los gastos pagados en ese período que no dicen de qué cuenta salieron: la plata se fue de alguna cuenta y el control por cuenta no la ve.
 *  Los del cierre de la liquidación no: no son un pago, no salieron de ninguna cuenta (lib/caja.ts). */
export function gastosSinCuenta(
  e: Pick<EstadoApp, "procesadores" | "gastos">, desdeIso: string | null, hastaIso: string,
): { n: number; total: number } {
  const desde = desdeIso ? Date.parse(desdeIso) : -Infinity;
  const hasta = Date.parse(hastaIso);
  let n = 0, total = 0;
  for (const g of e.gastos) {
    if (g.extra?.traspasoId || g.extra?.liquidacionId || cuentaDeGasto(g, e.procesadores) || !entre(fechaDePago(g), desde, hasta)) continue;
    n++; total += g.monto;
  }
  return { n, total: r2(total) };
}
