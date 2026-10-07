/* ==================================================================
   Ayudas compartidas de las pruebas de estrés del frente «la tabla del CRM»
   (no es una prueba: node --test sólo corre los *.test.ts).

   - Un generador con semilla (mulberry32): si una propiedad falla, el mensaje
     trae la semilla, y con ella se reproduce el mismo caso.
   - Un «mundo» al azar: llamadas, contactos, leads, ventas, cuotas, pagos y
     procesadores con la forma de los reales, con o sin estados raros
     (referencias rotas, fechas inválidas, duplicados…).
   ================================================================== */
import { construirSemilla } from "@/lib/seed";
import { filasTabla, type FilaTabla } from "@/lib/crm-tabla";
import type { Contacto, EstadoApp, Lead, Pago, Procesador, Sesion, Venta, Cuota } from "@/lib/types";

export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Azar {
  private n: () => number;
  constructor(public readonly semilla: number) { this.n = mulberry32(semilla); }
  next() { return this.n(); }
  /** Entero en [0, n). */
  int(n: number) { return Math.floor(this.n() * n); }
  entre(a: number, b: number) { return a + this.int(b - a + 1); }
  bool(p = 0.5) { return this.n() < p; }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]; }
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) { const j = this.int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  /** Entre `min` y `max` elementos distintos de `xs`. */
  algunos<T>(xs: readonly T[], min: number, max: number): T[] {
    const k = Math.min(xs.length, this.entre(min, max));
    return this.shuffle(xs).slice(0, k);
  }
}

/** Lo que se pone en un mensaje de error para volver a correr el caso. */
export const conSemilla = (r: Azar | number, msg: string) => `[semilla ${typeof r === "number" ? r : r.semilla}] ${msg}`;

/** Textos que rompen cosas: espacios, comas, %, &, =, +, tildes, mayúsculas, emoji, caracteres de URL. */
export const TEXTOS_TRAMPA: string[] = [
  "a b", "a,b", "100%", "a&b=c", "x+y", "ñandú", "Árbol", "ÁRBOL", "árbol", "Q&A", "  doble  espacio ", "con\ttab", "salto\nde linea",
  "%7C", "%zz", "%", "%%", "=", "&", "?", "#", "/", "\\", "a=b&c=d", "?solo-pais=Argentina", "😀 emoji", "日本語", "(Vacías)", "0", "00", "1e3",
  "comillas \"dobles\" y 'simples'", "a;b", "a:b", "<script>", "ü", "Straße", "İstanbul", "é", "é",
];
/** Lo mismo con una barra vertical adentro (las campañas y los ads de Meta las usan para separar partes). */
export const TEXTOS_CON_BARRA: string[] = ["VSL | Mercado saturado", "a|b", "|", "Prospecting | LAL 1% | USA", "x |y"];

const ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNÑOPQRSTUVWXYZáéíóúüñÁÉ0123456789 ,%&=+#?/-_.:;'\"()[]{}*!@$";
export function textoAzar(r: Azar, max = 12, conBarra = false): string {
  const alfabeto = conBarra ? `${ALFABETO}|` : ALFABETO;
  const n = r.int(max + 1);
  let s = "";
  for (let i = 0; i < n; i++) s += alfabeto[r.int(alfabeto.length)];
  return s;
}
export function valorAzar(r: Azar, conBarra = false): string {
  const t = r.bool(0.45) ? r.pick(conBarra && r.bool(0.4) ? TEXTOS_CON_BARRA : TEXTOS_TRAMPA) : textoAzar(r, 12, conBarra);
  return t || "x";
}

/* ---------- Fechas ---------- */

export const AHORA = Date.parse("2026-10-07T15:00:00.000Z");
export const DIA_MS = 86_400_000;
/** El día en Argentina (UTC-3, sin horario de verano), calculado a mano: el oráculo de `diaDeNegocio`. */
export const diaAR3 = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);

/* ---------- El mundo ---------- */

export type Mundo = Parameters<typeof filasTabla>[0];

export interface OpcionesMundo {
  sesiones: number;
  contactos?: number;
  ventas?: number;
  pagos?: number;
  /** Referencias rotas, fechas inválidas, ids repetidos, nulls… */
  raro?: boolean;
  /** Sin cobros (quien sólo mira llamadas). */
  sinCobros?: boolean;
  /** Nombres de ad / campaña con barras verticales. */
  conBarras?: boolean;
}

const TIPOS = [
  "Asesoramiento Hackear IT", "Asesoramiento Hackear IT", "Asesoramiento Hackear IT", "Asesoramiento Hackear IT",
  "Auditoría con alumnos (Resell)", "Mock interview", "Sesión de diagnóstico",
];
const CLOSERS = ["Dante Barbieri", "Valentín Rojas", "Agustina Pérez", "Noelia Díaz", "Ñandú Ibáñez", "", "Dante", "Closer Ñ"];
const ESTADOS_LLAMADA = [
  "Compra Full", "Compra Cuotas", "Reserva", "Seguimiento de Pago", "Seguimiento Nutrición", "Califica Downsell", "Compra Downsell",
  "Llamada Interrumpida", "Dejó de Contestar", "Inasistió", "Lead descartado", "NO Calificado", "Devolución", "Estado fantasma", "",
];
const ESTADOS_PRECALL = ["Confirmado", "Reagendar", "Sin Respuesta", "Otro", ""];
const PRECALLS = ["1° Mje Enviado", "1° Llamada", "2° Mje Enviado", "2° Llamada", "COMPLETAR", ""];
const OBJECIONES = ["Precio", "Tiempo", "Lo consulta con su pareja", "No le interesa", "Ñoño", "100% seguro", "", ""];
const INGLES = ["Básico", "Intermedio", "Conversacional", "Avanzado", "Nativo", "Ninguno", "Muy bueno, ningún problema", ""];
const TECNOS = ["React", "Node", "Java", "Python", "PHP", "C#", "Go", "React\nNode", "Java;Python", "React\nReact", "Node\nPython\nNode", ""];
const FORMACION = ["Universitaria completa", "Universitaria incompleta", "Terciaria", "Secundaria", "Autodidacta", "Terciaria;Terciaria", "Curso\nTerciaria\nCurso", ""];
const INVERSION = ["Menos de $690", "Entre $690 y $1000", "Entre $1000 y $2000", "Más de $2000", "1200", ""];
const INGRESO = ["Menos de 500", "500-1000", "1000-2000", "Más de 2000", ""];
const EDADES = ["18", "25", "34", "41", "52", ""];
const ANIOS = ["Menos de 1 año", "1 año", "2 años", "3 a 5 años", "Más de 5 años", "10", ""];
const TELEFONOS = [
  "+54 9 11 5555-1234", "+5491155551234", "+1 809 555 0101", "+1 (787) 555-0199", "+598 99 123 456", "+34 600 000 000", "+1 415 555 0100",
  "0054 9 11 4444 5555", "5491155551234", "11 5555-1234", "", "+99 1234", "+", "00", "abc",
];
const PAISES_CARGADOS = ["Argentina", "México", "Colombia", " España ", "", ""];
const NOMBRES_AD = [
  "MERCADO SATURADO.mp4 - Copia 2", "MERCADO SATURADO.mp4", "Mercado Saturado - Copia", "Programador sin trabajo.mov", "Hook 3.jpg - Copia - Copia",
  "Testimonio Juan", "Carrusel", "",
];
const NOMBRES_AD_BARRA = ["VSL | Mercado saturado", "Prospecting | LAL 1% | USA", "Video 1 | Copia", "Hook | 3"];
const NOMBRES_CAMPANIA = ["Webinar Octubre", "VSL Always On", "Retargeting 30d", "Conversiones", ""];

const UTMS = (r: Azar, conBarras: boolean): Record<string, string> | undefined => {
  const ad = r.pick(conBarras && r.bool(0.5) ? NOMBRES_AD_BARRA : NOMBRES_AD);
  const camp = conBarras && r.bool(0.4) ? r.pick(NOMBRES_AD_BARRA) : r.pick(NOMBRES_CAMPANIA);
  switch (r.int(12)) {
    case 0: return undefined;
    case 1: return {};
    case 2: case 3: case 4: return { utm_source: "meta", utm_medium: "paid", utm_campaign: camp, utm_content: ad };
    case 5: return { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20260924", utm_content: r.pick(["vivo", "replay", "seguimiento"]) };
    case 6: return { utm_source: "whatsapp", utm_medium: "email", utm_campaign: "clase0_webinar_20260924", utm_content: "vivo" };
    case 7: return { utm_source: "Webinar", utm_medium: "23-09", utm_content: "EnVivo" };
    case 8: return { utm_source: "setter", utm_medium: "outbound", utm_campaign: "setter_daniel", utm_content: "dm" };
    case 9: return { source: "meta", medium: "cpc", campaign: camp, content: ad };
    case 10: return { utm_source: "direct", utm_medium: "none" };
    default: return { utm_source: "instagram", utm_medium: "organic", utm_campaign: "vsl_organica", utm_content: "bio" };
  }
};

const iso = (ms: number) => new Date(ms).toISOString();

function respuestasAzar(r: Azar): { pregunta: string; respuesta: string }[] | undefined {
  if (r.bool(0.08)) return undefined;
  const qa: { pregunta: string; respuesta: string }[] = [];
  const poner = (pregunta: string, pool: string[]) => { if (r.bool(0.85)) qa.push({ pregunta, respuesta: r.pick(pool) }); };
  poner("¿Qué edad tenés?", EDADES);
  poner("¿Con qué lenguajes y frameworks trabajás o trabajaste?", TECNOS);
  poner("¿Cuál es tu nivel de inglés?", INGLES);
  poner("¿Hace cuántos años trabajás en programación?", ANIOS);
  poner("¿Cuál es tu nivel de formación?", FORMACION);
  poner("¿Cuánto ganás mensualmente en dólares?", INGRESO);
  poner("¿Cuánto podés invertir en vos?", INVERSION);
  poner("WhatsApp", TELEFONOS);
  poner("Instagram", ["@juan", "", "@maria_dev"]);
  return r.shuffle(qa);
}

/* La semilla de la app se arma una vez: de ella sólo se toman los ajustes y los webinars. */
let SEMILLA: EstadoApp | null = null;
const semilla = () => (SEMILLA ??= construirSemilla());

export function mundoAzar(r: Azar, o: OpcionesMundo): Mundo & Pick<EstadoApp, "pagos" | "cuotas" | "procesadores"> {
  const base = semilla();
  const raro = Boolean(o.raro);
  const nContactos = o.contactos ?? Math.max(1, Math.round(o.sesiones * 0.7));

  const contactos: Contacto[] = [];
  for (let i = 0; i < nContactos; i++) {
    const corregido = r.bool(0.1) ? { ingles: r.pick(INGLES), inversion: r.pick(INVERSION), edad: r.pick(EDADES) } : undefined;
    contactos.push({
      id: `con_${i}`, nombre: r.bool(0.05) ? "" : `${r.pick(["Ana", "Luis", "María", "José", "Ñusta", "Álvaro", "Sofía", "Zoe"])} ${r.pick(["Pérez", "García", "Núñez", "Ibáñez", "O'Brien", "Ñañez"])} ${i}`,
      email: `c${i}@ejemplo.com`, telefono: r.bool(0.8) ? r.pick(TELEFONOS) : undefined, pais: r.bool(0.5) ? r.pick(PAISES_CARGADOS) : undefined,
      tecnologias: r.bool(0.5) ? r.pick(TECNOS) : undefined, formacion: r.bool(0.5) ? r.pick(FORMACION) : undefined,
      sueldoUsd: r.bool(0.5) ? r.pick(INGRESO) : undefined, instagram: r.bool(0.3) ? "@x" : undefined,
      utm: r.bool(0.4) ? UTMS(r, Boolean(o.conBarras)) : undefined,
      creadoEn: iso(AHORA - r.int(100) * DIA_MS), extra: corregido ? { corregido } : {},
    } as unknown as Contacto);
  }
  const leads: Lead[] = [];
  const nLeads = Math.round(nContactos * 0.5);
  for (let i = 0; i < nLeads; i++) {
    leads.push({
      id: `lead_${i}`, contactoId: r.bool(0.8) ? `con_${r.int(nContactos)}` : undefined, nombre: `Lead ${i}`, email: `l${i}@ejemplo.com`,
      telefono: r.bool(0.5) ? r.pick(TELEFONOS) : undefined, pais: r.bool(0.3) ? r.pick(PAISES_CARGADOS) : undefined,
      fuente: "Meta Ads", etapaId: "et_1", monto: 0, moneda: "USD", responsable: "", etiquetas: [], creadoEn: iso(AHORA), actualizadoEn: iso(AHORA), extra: {},
    } as unknown as Lead);
  }

  const sesiones: Sesion[] = [];
  for (let i = 0; i < o.sesiones; i++) {
    const inicia = AHORA + r.entre(-90, 30) * DIA_MS + r.int(86_400) * 1000;
    const creadoEn = inicia - r.entre(0, 25) * DIA_MS - r.int(86_400) * 1000;
    const tieneContacto = r.bool(raro ? 0.7 : 0.9);
    const tieneLead = r.bool(0.4);
    const estado = r.pick(["agendada", "agendada", "hecha", "no-show", "cancelada"] as const);
    const s: Sesion = {
      id: `ses_${i}`, titulo: "Asesoramiento", invitado: r.bool(0.07) ? "" : `Invitado ${r.int(nContactos)} ${r.pick(o.conBarras ? ["Ñ", "A", "B", "|"] : ["Ñ", "A", "B"])}`,
      email: r.bool(0.85) ? `c${r.int(nContactos)}@ejemplo.com` : undefined,
      inicia: iso(inicia), duracionMin: 45, estado, tipo: r.pick(TIPOS), origen: "calendly", creadoEn: iso(creadoEn), extra: {},
      contactoId: tieneContacto ? `con_${r.int(nContactos)}` : undefined,
      leadId: tieneLead && nLeads ? `lead_${r.int(nLeads)}` : undefined,
      anfitrion: r.pick(CLOSERS), utm: UTMS(r, Boolean(o.conBarras)), respuestas: respuestasAzar(r),
      estadoLlamada: r.bool(0.45) ? r.pick(ESTADOS_LLAMADA) || undefined : undefined,
      estadoPreCall: r.bool(0.4) ? r.pick(ESTADOS_PRECALL) || undefined : undefined,
      preCall: r.bool(0.3) ? r.pick(PRECALLS) || undefined : undefined,
      objecion: r.bool(0.3) ? r.pick(OBJECIONES) || undefined : undefined,
      hizoOferta: r.bool(0.3) ? r.bool() : undefined,
      cierreEstimado: r.bool(0.2) ? iso(AHORA + r.entre(0, 30) * DIA_MS).slice(0, 10) : undefined,
      notas: r.bool(0.3) ? r.pick(["Quiere pagar en cuotas", "Ñoño llamó tarde", "100% decidido", "Llamar mañana", "  "]) : undefined,
      grabacion: r.bool(0.2) ? "https://fathom.video/x" : undefined,
      resultado: r.bool(0.1) ? r.pick(["compro", "no-compro", "no-vino", "reprogramo"] as const) : undefined,
      motivoCancelacion: estado === "cancelada" && r.bool(0.5) ? "Reprogramada" : undefined,
      ventaPorOtro: r.bool(0.05) ? { por: "x", en: iso(AHORA) } : undefined,
    } as Sesion;
    sesiones.push(s);
  }
  /* Reprogramaciones: algunas agendas dicen de cuál vienen. */
  for (let i = 0; i < sesiones.length; i++) {
    if (r.bool(0.08)) sesiones[i].reprogramadaDe = raro && r.bool(0.3) ? r.pick(["ses_no_existe", sesiones[i].id, sesiones[r.int(sesiones.length)].id]) : sesiones[r.int(sesiones.length)].id;
  }
  if (raro) {
    for (const s of sesiones) {
      if (r.bool(0.05)) s.inicia = r.pick(["", "no es una fecha", "2026-10-05", "2026-13-45T99:99:99Z"]);
      if (r.bool(0.03)) s.creadoEn = r.pick(["", "basura"]) ;
      if (r.bool(0.05)) { s.contactoId = undefined; s.leadId = undefined; s.email = undefined; s.invitado = ""; }
      if (r.bool(0.05)) s.utm = { utm_source: null, utm_medium: null, utm_campaign: null } as unknown as Record<string, string>;
      if (r.bool(0.04)) s.respuestas = [{ pregunta: "", respuesta: "" }, { pregunta: "¿Qué edad tenés?", respuesta: "" }];
    }
    if (r.bool(0.5) && sesiones.length > 2) sesiones.push({ ...sesiones[0] }); /* un id repetido */
  }

  const procesadores: Procesador[] = [
    { id: "stripe", nombre: "Stripe", feeRate: 0.03, activo: true, automatico: true, proveedor: "stripe" },
    { id: "whop", nombre: "Whop", feeRate: 0.04, activo: true, automatico: true, proveedor: "whop" },
    { id: "financiera", nombre: "Financiera", feeRate: 0.06, activo: true, automatico: false },
    { id: "trust", nombre: "Trust", feeRate: 0, activo: true, automatico: false, proveedor: "" },
    { id: "mercury", nombre: "Mercury", feeRate: 0, activo: true, automatico: false },
  ] as unknown as Procesador[];

  const nVentas = o.ventas ?? Math.round(o.sesiones * 0.4);
  const ventas: Venta[] = [];
  for (let i = 0; i < nVentas; i++) {
    const s = sesiones[r.int(sesiones.length)];
    const modo = r.int(raro ? 4 : 3);
    const persona = s.contactoId ?? s.leadId;
    ventas.push({
      id: `v_${i}`, contactoId: persona && r.bool(0.9) ? persona : undefined, contactoNombre: "x",
      productoId: r.pick(["prod_a", "prod_b", undefined]), precioAcordado: r.pick([0, 500, 1500, 2400, 12345.67]),
      moneda: r.pick(["USD", "ARS"] as const), excluidoMarketing: false,
      estado: r.pick(["activa", "activa", "activa", "reembolsada", "cancelada"] as const),
      fecha: iso((Number.isNaN(Date.parse(s.inicia)) ? AHORA : Date.parse(s.inicia)) + r.entre(-2, 70) * DIA_MS), creadoEn: iso(AHORA), extra: {},
      sesionId: modo === 0 ? undefined : modo === 3 ? `ses_borrada_${i}` : s.id,
    } as unknown as Venta);
  }

  const cuotas: Cuota[] = [];
  const pagos: Pago[] = [];
  if (!o.sinCobros) {
    for (const v of ventas) {
      const k = r.entre(0, 4);
      for (let j = 0; j < k; j++) cuotas.push({ id: `cu_${v.id}_${j}`, ventaId: v.id, numero: j + 1, monto: 100, estado: "pendiente", esReserva: false } as Cuota);
    }
    if (raro) for (let i = 0; i < 5; i++) cuotas.push({ id: `cu_huerfana_${i}`, ventaId: `v_no_existe_${i}`, numero: 1, monto: 1, estado: "pendiente", esReserva: false } as Cuota);
    const nPagos = o.pagos ?? Math.round(nVentas * 2);
    for (let i = 0; i < nPagos; i++) {
      const cuota = cuotas.length ? cuotas[r.int(cuotas.length)] : undefined;
      const sinCuota = raro && r.bool(0.1);
      pagos.push({
        id: `pg_${i}`, cuotaId: sinCuota ? r.pick(["", "cu_no_existe"]) : cuota?.id ?? "cu_no_existe",
        procesadorId: r.pick(["stripe", "whop", "financiera", "trust", "mercury", undefined, ...(raro ? ["no_existe"] : [])]),
        movimientoId: r.bool(0.3) ? `mov_${i}` : r.pick([undefined, undefined, ""]),
        comprobante: r.bool(0.3) ? { ruta: `r/${i}.png`, nombre: `${i}.png`, tipo: "image/png", tamano: 10 } : r.pick([undefined, null]),
        comprobanteLink: r.bool(0.2) ? r.pick(["https://drive.google.com/x", "texto sin link", "   ", ""]) : undefined,
        monto: 100, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: iso(AHORA), creadoEn: iso(AHORA),
        chequeado: r.bool(0.2) ? true : undefined,
      } as unknown as Pago);
    }
  }

  /* Lo que viene de la base (select *): las columnas vacías llegan como null, no como undefined. */
  if (raro) {
    const aNull = (xs: object[], claves: string[]) => {
      for (const x of xs) {
        const o = x as Record<string, unknown>;
        for (const k of claves) if (o[k] === undefined && r.bool(0.6)) o[k] = null;
      }
    };
    aNull(sesiones, ["leadId", "contactoId", "email", "canal", "utm", "respuestas", "anfitrion", "preCall", "estadoPreCall", "estadoLlamada", "grabacion",
      "resultado", "objecion", "hizoOferta", "cierreEstimado", "notas", "motivoCancelacion", "ventaPorOtro", "reprogramadaDe", "canceladaEn", "enlace", "calendlyEventoUri"]);
    aNull(contactos, ["telefono", "pais", "inglesNivel", "aniosExperiencia", "origenCanal", "utm", "tecnologias", "formacion", "sueldoUsd", "instagram", "notas"]);
    aNull(leads, ["contactoId", "telefono", "pais", "campania", "inglesNivel", "aniosExperiencia", "notas", "webinarId"]);
    aNull(ventas, ["contactoId", "productoId", "webinarId", "embudoId", "closerId", "directorId", "notas", "proyecto", "setterId", "sesionId"]);
    aNull(cuotas, ["vence", "notas", "closerId"]);
    aNull(pagos, ["procesadorId", "movimientoId", "comprobante", "comprobanteLink", "referencia", "notas", "caracteristica", "chequeado", "pagador"]);
  }

  return {
    sesiones, contactos, leads, ventas, cuotas, pagos, procesadores,
    ajustes: base.ajustes, webinars: base.webinars,
    productos: [{ id: "prod_a", nombre: "Mentoría" }, { id: "prod_b", nombre: "Downsell" }] as unknown as EstadoApp["productos"],
    ...(o.sinCobros ? {} : {}),
  } as Mundo & Pick<EstadoApp, "pagos" | "cuotas" | "procesadores">;
}

export function filasDeMundo(r: Azar, o: OpcionesMundo, ahora = AHORA): { mundo: ReturnType<typeof mundoAzar>; filas: FilaTabla[] } {
  const mundo = mundoAzar(r, o);
  const m = o.sinCobros ? (({ pagos: _p, cuotas: _c, procesadores: _pr, ...resto }) => { void _p; void _c; void _pr; return resto; })(mundo) : mundo;
  return { mundo, filas: filasTabla(m as Mundo, ahora) };
}

/** Un valor `a` es una permutación de `b` (mismos ids, mismas repeticiones). */
export const mismosIds = (a: FilaTabla[], b: FilaTabla[]) => {
  const ids = (xs: FilaTabla[]) => xs.map((f) => f.id).sort();
  return JSON.stringify(ids(a)) === JSON.stringify(ids(b));
};
