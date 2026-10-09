import { sinTildes } from "./crm";
import { diaAInstante, diaDeNegocio } from "./dia-negocio";
import { rachasAHoy } from "./reportes";
import { respuestaPerfil } from "./perfil";
import {
  aplicarCorreccion, CLAVES_DE_LISTAS, configSeguimiento, diasEntre, indiceDeContactos, listasPropias, proximoDe, seguimientoVacio,
  situacionDe, type SituacionSeguimiento,
} from "./seguimiento";
import { crearMotor, numeroComoValor, siNo, SI, NO, uno, varios, type ColumnaCs, type OrdenCs } from "./tabla-cs";
import type {
  Alumno, ConfigSeguimiento, Contacto, EstadoApp, ID, ListasCs, Resell, SeguimientoAlumno, Testimonio, Venta,
} from "./types";

/* ==================================================================
   Customer Success según Lili (respuesta del 09/10): la lista de Clientes con
   las 29 columnas que ella lleva hoy en su Airtable, sus Testimonios y la
   Agenda de resells.

   Todo acá es puro (sin React ni base) para poder probarlo. Lo que ya sabe
   el alumno (nombre, mail, inicio) o su venta (closer, programa, plan de
   pago) no se vuelve a cargar: sale de donde está. Lo que sólo Customer
   Success lleva vive en `seguimiento_alumnos` (una fila por alumno), en
   `testimonios` y en `resells`.
   ================================================================== */

/* ---------- Las listas de opciones ---------- */

export const LISTAS_POR_DEFECTO: ListasCs = {
  stacks: ["Frontend", "Backend", "Full Stack", "Data Engineer", "Mobile Developer"],
  programas: ["Hackear IT", "Hackear Biz", "Principals", "Principal Mastermind"],
  accesos: ["Completos", "Downsell", "Sin acceso"],
  followUps: [
    "Onboarding", ...Array.from({ length: 13 }, (_, i) => `Módulo ${i}`), "Módulo IA", "Take Home Challenge",
    "Avanzando", "No avanzando", "No contesta",
  ],
  estadosContrato: ["Enviado", "Falta firma", "Firmado y subido a Drive"],
  garantias: [],
  followUpsTestimonio: ["Llamada agendada", "No agendada", "Pendiente de agendar", "No quiere grabar"],
  estadosVideo: ["Pendiente de subir", "Subido a Drive", "No quiso grabar", "Subido a YouTube"],
  quienGraba: ["Yari", "Mariano"],
  resellsTestimonio: ["Pendiente", "Renueva", "No renueva", "Lo piensa"],
  estadosResell: ["Agendada", "Renueva", "No renueva", "Lo piensa", "No se presentó", "Cancelada"],
};

/* Las dos que no se ajustan: Firmado o Pendiente, y las sesiones con el mentor (0 a 3). */
export const CONTRATOS = ["Firmado", "Pendiente"];
export const SESIONES_MENTOR = [0, 1, 2, 3];
/* Lo que Lili contó que dura cada programa, «por ejemplo»: sólo es lo que se sugiere al cargar uno. */
export const DURACION_POR_PROGRAMA: Record<string, number> = {
  "Hackear IT": 3, "Hackear Biz": 6, Principals: 12, "Principal Mastermind": 12,
};
export const DURACION_POR_DEFECTO = 3;
/* Desde cuántas semanas sin reportar se lo da por inactivo. */
export const SEMANAS_PARA_INACTIVO = 3;

const textoLimpio = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

/** Las listas que se usan: las de Ajustes (las que tengan algo) y, de las demás, las de Lili. */
export function listasCs(c?: Pick<ConfigSeguimiento, "listas"> | null): ListasCs {
  const propias = listasPropias(c?.listas) ?? {};
  const out = {} as Record<string, string[]>;
  for (const k of CLAVES_DE_LISTAS) out[k] = propias[k] ?? [...LISTAS_POR_DEFECTO[k]];
  return out as unknown as ListasCs;
}

/** El valor de una lista que corresponde a un texto cualquiera («full stack» → «Full Stack»), o el texto tal cual. */
export function valorDeLista(texto: string, lista: readonly string[]): string {
  const t = textoLimpio(texto);
  if (!t) return "";
  const clave = (s: string) => sinTildes(s).replace(/[^a-z0-9]+/g, "");
  const k = clave(t);
  const exacta = lista.find((x) => clave(x) === k);
  if (exacta) return exacta;
  /* «Full Stack Developer» es «Full Stack»; «no quiere» es «No quiere grabar»: si una sola opción contiene al texto
     (o está contenida en él) es esa; si son varias, no se adivina y queda el texto tal cual. */
  if (k.length >= 4) {
    const cerca = lista.filter((x) => clave(x).includes(k) || (clave(x).length >= 4 && k.includes(clave(x))));
    if (cerca.length === 1) return cerca[0];
  }
  return t;
}

/* ---------- Números, días y textos que llegan de la base o de un archivo ---------- */

export function aNumero(x: unknown): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const aDia = (x: unknown): string | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
const aBool = (x: unknown): boolean => x === true || x === "true" || x === "t" || x === 1;
function aListaDeTextos(x: unknown): string[] {
  let v = x;
  if (typeof v === "string" && v.trim().startsWith("[")) { try { v = JSON.parse(v); } catch { v = []; } }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) { const t = textoLimpio(s); if (t && !out.includes(t)) out.push(t); }
  return out;
}

/* Cuántos meses se pueden poner de duración; las sesiones con el mentor; la edad: fuera de eso es un error de carga. */
export const ENTRE = { duracion: [1, 60], mentor: [0, 10], edad: [10, 99] } as const;
const dentro = (n: number | null, [min, max]: readonly [number, number]) => (n !== null && n >= min && n <= max ? n : null);

/** La ficha de un alumno completa: lo que falte (una fila de antes, o una base sin el SQL nuevo) queda vacío. */
export function seguimientoCompleto(
  s: Partial<SeguimientoAlumno> & Pick<SeguimientoAlumno, "alumnoId">, cfg: ConfigSeguimiento,
): SeguimientoAlumno {
  const base = seguimientoVacio(s.alumnoId, cfg, s.actualizadoEn);
  const dado = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as Partial<SeguimientoAlumno>;
  const m = { ...base, ...dado } as SeguimientoAlumno;
  const rm = (dado.reporteManual ?? null) as Partial<NonNullable<SeguimientoAlumno["reporteManual"]>> | null;
  return {
    ...m,
    id: m.id || base.id,
    numero: aNumero(m.numero), edad: aNumero(m.edad),
    telefono: textoLimpio(m.telefono), stack: textoLimpio(m.stack), dni: textoLimpio(m.dni), domicilio: textoLimpio(m.domicilio),
    programas: aListaDeTextos(m.programas), planDePago: textoLimpio(m.planDePago),
    duracionMeses: aNumero(m.duracionMeses), fechaEgreso: aDia(m.fechaEgreso), sesionesMentor: aNumero(m.sesionesMentor),
    contactoInicial: aDia(m.contactoInicial), contactoSemana: aDia(m.contactoSemana),
    acceso: textoLimpio(m.acceso), followUp: textoLimpio(m.followUp), garantia: textoLimpio(m.garantia),
    accesoWhatsapp: aBool(m.accesoWhatsapp), accesoZoom: aBool(m.accesoZoom), accesoWibo: aBool(m.accesoWibo),
    contratoFirmado: textoLimpio(m.contratoFirmado), estadoContrato: textoLimpio(m.estadoContrato),
    closerNombre: textoLimpio(m.closerNombre), responsableCv: textoLimpio(m.responsableCv),
    notas: typeof m.notas === "string" ? m.notas : "",
    reporteManual: rm && typeof rm === "object"
      ? {
          completo: aBool(rm.completo), activo: rm.activo === undefined ? true : aBool(rm.activo),
          semanasSin: Math.max(0, Math.round(aNumero(rm.semanasSin) ?? 0)), en: aDia(rm.en) ?? "",
        }
      : null,
  };
}

/** Un testimonio con todas sus columnas: los del primer modelo (pedido / grabado / publicado) pasan a las nuevas. */
export function testimonioNormal(t: Partial<Testimonio> & Pick<Testimonio, "id" | "alumnoId">): Testimonio {
  const viejo = t.estado;
  const followUp = textoLimpio(t.followUp) || (viejo ? (viejo === "pedido" ? "Pendiente de agendar" : "Llamada agendada") : "");
  const estadoVideo = textoLimpio(t.estadoVideo) || (viejo === "grabado" ? "Pendiente de subir" : viejo === "publicado" ? "Subido a YouTube" : "");
  const fechaGrabacion = aDia(t.fechaGrabacion) ?? (viejo === "grabado" || viejo === "publicado" ? aDia(t.fecha) : null);
  return {
    id: t.id, alumnoId: t.alumnoId, followUp, fechaGrabacion,
    conQuien: textoLimpio(t.conQuien), resell: textoLimpio(t.resell), estadoVideo, link: textoLimpio(t.link),
    tecnologias: textoLimpio(t.tecnologias), situacionPrevia: typeof t.situacionPrevia === "string" ? t.situacionPrevia : "",
    situacionActual: typeof t.situacionActual === "string" ? t.situacionActual : "",
    notas: typeof t.notas === "string" ? t.notas : "", creadoEn: t.creadoEn ?? new Date().toISOString(),
  };
}

/** Un resell con todas sus columnas. */
export function resellNormal(r: Partial<Resell> & Pick<Resell, "id">): Resell {
  return {
    id: r.id, sesionId: r.sesionId ?? null, fechaHora: typeof r.fechaHora === "string" ? r.fechaHora : new Date().toISOString(),
    nombre: textoLimpio(r.nombre), email: textoLimpio(r.email), telefono: textoLimpio(r.telefono), closer: textoLimpio(r.closer),
    estado: textoLimpio(r.estado), cashCollect: aNumero(r.cashCollect), casoDeExito: aBool(r.casoDeExito),
    notas: typeof r.notas === "string" ? r.notas : "", cancelada: aBool(r.cancelada),
    origen: r.origen === "calendly" || r.origen === "importado" ? r.origen : "manual",
    creadoEn: r.creadoEn ?? new Date().toISOString(), actualizadoEn: r.actualizadoEn ?? new Date().toISOString(),
    actualizadoPor: textoLimpio(r.actualizadoPor),
  };
}

/* ---------- Lo que se calcula de la venta y de los días ---------- */

/** El programa que sugiere el nombre de un servicio («Mentoría» es Hackear IT). Sólo una sugerencia: Customer Success la confirma. */
export function programasDeTexto(texto: string, lista: readonly string[] = LISTAS_POR_DEFECTO.programas): string[] {
  const t = sinTildes(textoLimpio(texto));
  if (!t) return [];
  const exacto = lista.find((p) => sinTildes(p) === t);
  if (exacto) return [exacto];
  const elegir = (re: RegExp, nombre: string) => (re.test(t) ? [lista.find((p) => sinTildes(p) === sinTildes(nombre)) ?? nombre] : []);
  return [
    ...elegir(/mastermind/, "Principal Mastermind"),
    ...(/mastermind/.test(t) ? [] : elegir(/principal/, "Principals")),
    ...elegir(/\bbiz\b|business/, "Hackear Biz"),
    ...elegir(/hackear\s*it|mentoria/, "Hackear IT"),
  ];
}

/** «2026-09-30» más n meses, sin pasarse del fin de mes (30/09 + 5 meses = 28/02). */
export function sumarMeses(dia: string, n: number): string {
  const [a, m, d] = dia.slice(0, 10).split("-").map(Number);
  const mes0 = (m - 1) + n;
  const anio = a + Math.floor(mes0 / 12);
  const mes = ((mes0 % 12) + 12) % 12;
  const finDeMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(d, finDeMes))).toISOString().slice(0, 10);
}

/** Cómo paga, según las cuotas de su venta: «Pago único» o «3 cuotas» (con «+ reserva» si dejó una seña). */
export function planDePagoDe(cuotas: readonly { esReserva: boolean; estado: string }[]): string {
  const regulares = cuotas.filter((c) => !c.esReserva && c.estado !== "cancelada").length;
  const reserva = cuotas.some((c) => c.esReserva && c.estado !== "cancelada");
  if (regulares === 0) return reserva ? "Reserva" : "";
  return `${regulares === 1 ? "Pago único" : `${regulares} cuotas`}${reserva ? " + reserva" : ""}`;
}

/** El próximo N.º de alumno: el más alto que hay más uno. */
export function siguienteNumero(seguimientos: readonly Pick<SeguimientoAlumno, "numero">[]): number {
  let max = 0;
  for (const s of seguimientos) { const n = aNumero(s.numero); if (n !== null && n > max) max = Math.floor(n); }
  return max + 1;
}

/** El reporte semanal de un alumno: de sus reportes si los tiene; si no, lo que se marcó a mano; si no, sin datos. */
export type EstadoReporte = "Al día" | "Atrasado" | "Inactivo" | "Sin datos";
export const ORDEN_REPORTE: EstadoReporte[] = ["Inactivo", "Atrasado", "Al día", "Sin datos"];
export interface ReporteDeCliente { estado: EstadoReporte; semanasSin: number | null; origen: "reportes" | "manual" | "sin-datos" }

export function reporteDeCliente(
  alumno: Pick<Alumno, "estado">, seg: Pick<SeguimientoAlumno, "reporteManual">, tuvoReportes: boolean, racha: number | undefined,
): ReporteDeCliente {
  if (tuvoReportes) {
    /* La racha sólo existe para quien debe reportar (activos y pausados). */
    if (racha === undefined) return { estado: "Sin datos", semanasSin: null, origen: "reportes" };
    return {
      estado: racha === 0 ? "Al día" : racha >= SEMANAS_PARA_INACTIVO ? "Inactivo" : "Atrasado",
      semanasSin: racha, origen: "reportes",
    };
  }
  const m = seg.reporteManual;
  if (!m) return { estado: "Sin datos", semanasSin: null, origen: "sin-datos" };
  return {
    estado: !m.activo ? "Inactivo" : m.completo ? "Al día" : "Atrasado",
    semanasSin: m.completo ? 0 : m.semanasSin, origen: "manual",
  };
}

/* ---------- La fila de un cliente ---------- */

export interface FilaCliente {
  /* El id del alumno. */
  id: ID;
  alumno: Alumno;
  seg: SeguimientoAlumno;
  /* ¿Ya tiene su fila de seguimiento en la base? */
  tieneSeg: boolean;
  contacto?: Contacto;
  venta?: Venta;

  numero: number | null;
  nombre: string;
  email: string;
  telefono: string;
  pais: string;
  edad: number | null;
  edadSugerida: boolean;
  stack: string;
  dni: string;
  domicilio: string;
  inicio: string;
  egreso: string | null;
  egresoSugerido: boolean;
  programas: string[];
  programasSugeridos: boolean;
  plan: string;
  planSugerido: boolean;
  duracion: number | null;
  duracionSugerida: boolean;
  mentor: number | null;
  comentarios: string;
  contactoInicial: string | null;
  contactoSemana: string | null;
  acceso: string;
  followUp: string;
  garantia: string;
  wpp: boolean;
  zoom: boolean;
  wibo: boolean;
  contrato: string;
  estadoContrato: string;
  closer: string;
  /* El closer sale de la venta: se cambia desde la venta, no acá. */
  closerDeVenta: boolean;
  reporte: ReporteDeCliente;
  ultimoContacto: string | null;
  proximo: string;
  atraso: number;
  situacion: SituacionSeguimiento;
  cadencia: number;
  intentos: number;
  cv: boolean;
  linkedin: boolean;
  responsableCv: string;
  estadoAlumno: string;
  etapa: string;
  /* Cómo viene su testimonio: el estado del video, o dónde va la llamada, o «Sin testimonio». */
  testimonio: string;
}

export const ESTADO_ALUMNO_TEXTO: Record<Alumno["estado"], string> = {
  activo: "Activo", pausado: "Pausado", graduado: "Egresado", baja: "Baja",
};
export const SIN_TESTIMONIO = "Sin testimonio";

const edadDeTexto = (t: string | undefined): number | null => {
  const m = /\d{1,3}/.exec(t ?? "");
  return dentro(m ? Number(m[0]) : null, ENTRE.edad);
};

/** Una fila por alumno, con todo lo que Customer Success lleva (y lo que se sabe de su venta y de la persona). */
export function filasClientes(e: EstadoApp, hoy: string): FilaCliente[] {
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const listas = listasCs(e.ajustes.seguimiento);
  const contactoDe = indiceDeContactos(e);
  const segPorAlumno = new Map((e.seguimientos ?? []).map((s) => [s.alumnoId, s] as const));
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const equipo = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));
  const productos = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
  const etapas = new Map((e.etapasServicio ?? []).map((x) => [x.id, x.nombre] as const));
  const primeraEtapa = [...(e.etapasServicio ?? [])].sort((a, b) => a.orden - b.orden)[0]?.nombre ?? "";
  const rachas = rachasAHoy(e);
  const conReportes = new Set(e.reportes.map((r) => r.alumnoId));

  const cuotasDe = new Map<ID, { esReserva: boolean; estado: string }[]>();
  for (const c of e.cuotas) {
    const l = cuotasDe.get(c.ventaId);
    if (l) l.push(c); else cuotasDe.set(c.ventaId, [c]);
  }
  /* La edad que contestó al agendar, si la cuenta puede leer las llamadas (Customer Success no): la última de cada persona. */
  const ultimaLlamada = new Map<ID, { inicia: string; respuestas?: { pregunta: string; respuesta: string }[] }>();
  for (const s of e.sesiones) {
    if (!s.contactoId || !s.respuestas?.length) continue;
    const antes = ultimaLlamada.get(s.contactoId);
    if (!antes || s.inicia > antes.inicia) ultimaLlamada.set(s.contactoId, s);
  }
  const testimonioDe = new Map<ID, Testimonio>();
  for (const t0 of e.testimonios ?? []) {
    const t = testimonioNormal(t0);
    const antes = testimonioDe.get(t.alumnoId);
    if (!antes || t.creadoEn > antes.creadoEn) testimonioDe.set(t.alumnoId, t);
  }

  return e.alumnos.map((a): FilaCliente => {
    const guardado = segPorAlumno.get(a.id);
    const seg = seguimientoCompleto(guardado ?? { alumnoId: a.id }, cfg);
    const contacto = contactoDe(a);
    const venta = a.ventaId ? ventas.get(a.ventaId) : undefined;
    const inicio = diaDeNegocio(a.inicio) || "";
    const producto = venta?.productoId ? productos.get(venta.productoId) ?? "" : "";

    const programasSug = seg.programas.length ? [] : programasDeTexto(producto || a.plan, listas.programas);
    const programas = seg.programas.length ? seg.programas : programasSug;
    const duracionSug = seg.duracionMeses === null && programas.length
      ? DURACION_POR_PROGRAMA[programas[0]] ?? DURACION_POR_DEFECTO : null;
    const duracion = seg.duracionMeses ?? duracionSug;
    const egresoPropio = seg.fechaEgreso;
    const egreso = egresoPropio ?? (inicio && duracion !== null ? sumarMeses(inicio, duracion) : null);

    const planSug = seg.planDePago ? "" : venta ? planDePagoDe(cuotasDe.get(venta.id) ?? []) : "";
    const llamada = contacto ? ultimaLlamada.get(contacto.id) : undefined;
    const edadSug = seg.edad === null ? edadDeTexto(respuestaPerfil(llamada?.respuestas, "edad")) : null;

    const closerVenta = venta?.closerId ? equipo.get(venta.closerId) ?? "" : "";
    const proximo = proximoDe(seg, a);
    const atraso = diasEntre(proximo, hoy);
    const testimonio = testimonioDe.get(a.id);

    return {
      id: a.id, alumno: a, seg, tieneSeg: Boolean(guardado), contacto, venta,
      numero: seg.numero, nombre: a.nombre, email: a.email,
      telefono: (contacto?.telefono ?? "").trim() || seg.telefono,
      pais: (a.pais ?? "").trim() || (contacto?.pais ?? "").trim(),
      edad: seg.edad ?? edadSug, edadSugerida: seg.edad === null && edadSug !== null,
      stack: seg.stack, dni: seg.dni, domicilio: seg.domicilio,
      inicio, egreso, egresoSugerido: egresoPropio === null && egreso !== null,
      programas, programasSugeridos: programasSug.length > 0,
      plan: seg.planDePago || planSug, planSugerido: !seg.planDePago && planSug !== "",
      duracion, duracionSugerida: duracionSug !== null,
      mentor: seg.sesionesMentor, comentarios: seg.notas,
      contactoInicial: seg.contactoInicial, contactoSemana: seg.contactoSemana,
      acceso: seg.acceso, followUp: seg.followUp, garantia: seg.garantia,
      wpp: seg.accesoWhatsapp, zoom: seg.accesoZoom, wibo: seg.accesoWibo,
      contrato: seg.contratoFirmado, estadoContrato: seg.estadoContrato,
      closer: closerVenta || seg.closerNombre, closerDeVenta: closerVenta !== "",
      reporte: reporteDeCliente(a, seg, conReportes.has(a.id), rachas.get(a.id)),
      ultimoContacto: seg.ultimoContacto, proximo, atraso,
      situacion: situacionDe(a.estado, seg.dejoDeContestar, atraso), cadencia: seg.cadenciaDias, intentos: seg.intentosSinRespuesta,
      cv: seg.cvCorregido, linkedin: seg.linkedinCorregido, responsableCv: seg.responsableCv,
      estadoAlumno: ESTADO_ALUMNO_TEXTO[a.estado] ?? a.estado,
      etapa: (a.etapaServicioId ? etapas.get(a.etapaServicioId) : undefined) ?? primeraEtapa,
      testimonio: testimonio ? testimonio.estadoVideo || testimonio.followUp || SIN_TESTIMONIO : SIN_TESTIMONIO,
    };
  });
}

/* ---------- Las columnas de Clientes ---------- */

export type ClaveCliente =
  | "numero" | "nombre" | "inicio" | "egreso" | "edad" | "stack" | "telefono" | "dni" | "domicilio" | "email"
  | "programa" | "plan" | "duracion" | "mentor" | "comentarios" | "contactoInicial" | "contactoSemana" | "acceso"
  | "followUp" | "reporte" | "ultimoContacto" | "garantia" | "wpp" | "zoom" | "wibo" | "contrato" | "pais" | "closer"
  | "estadoContrato" | "cv" | "linkedin" | "responsableCv" | "semanasSin" | "proximo" | "cadencia" | "estadoAlumno"
  | "etapa" | "testimonio";

const meses = (n: number | null) => (n === null ? "" : `${n} ${n === 1 ? "mes" : "meses"}`);
const sesiones = (n: number | null) => (n === null ? "" : `${n} ${n === 1 ? "sesión" : "sesiones"}`);
const comentarios = (f: FilaCliente) => (f.comentarios.trim() ? "Con comentarios" : "Sin comentarios");

export const COLUMNAS_CLIENTES: ColumnaCs<FilaCliente, ClaveCliente>[] = [
  { clave: "numero", titulo: "N.º de alumno", grupo: "Datos", valores: (f) => numeroComoValor(f.numero), orden: (f) => f.numero ?? "", numerica: true, ancho: 90 },
  { clave: "nombre", titulo: "Nombre y apellido", grupo: "Datos", valores: (f) => uno(f.nombre), orden: (f) => sinTildes(f.nombre), ancho: 220 },
  { clave: "inicio", titulo: "Fecha de inicio", grupo: "Programa", valores: (f) => uno(f.inicio), fecha: true, ancho: 120 },
  { clave: "egreso", titulo: "Fecha de egreso", grupo: "Programa", valores: (f) => uno(f.egreso), fecha: true, ancho: 120,
    ayuda: "Si no se cargó, es el inicio más la duración del programa." },
  { clave: "edad", titulo: "Edad", grupo: "Datos", valores: (f) => numeroComoValor(f.edad), orden: (f) => f.edad ?? "", numerica: true, ancho: 80 },
  { clave: "stack", titulo: "Stack", grupo: "Programa", valores: (f) => uno(f.stack), ancho: 140 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Datos", valores: (f) => uno(f.telefono), ancho: 150 },
  { clave: "dni", titulo: "DNI", grupo: "Datos", valores: (f) => uno(f.dni), ancho: 110 },
  { clave: "domicilio", titulo: "Domicilio", grupo: "Datos", valores: (f) => uno(f.domicilio), ancho: 220 },
  { clave: "email", titulo: "Mail", grupo: "Datos", valores: (f) => uno(f.email), ancho: 220 },
  { clave: "programa", titulo: "Programa", grupo: "Programa", valores: (f) => varios(f.programas), ancho: 190,
    ayuda: "Puede estar en más de un programa. Si no se cargó, se sugiere el que corresponde al servicio que compró." },
  { clave: "plan", titulo: "Plan de pago", grupo: "Programa", valores: (f) => uno(f.plan), ancho: 150,
    ayuda: "Lo acordado con el closer. Si no se cargó, sale de las cuotas de su venta." },
  { clave: "duracion", titulo: "Duración", grupo: "Programa", valores: (f) => uno(meses(f.duracion)), orden: (f) => f.duracion ?? "", numerica: true, ancho: 100 },
  { clave: "mentor", titulo: "Sesión con el mentor", grupo: "Programa", valores: (f) => uno(sesiones(f.mentor)), orden: (f) => f.mentor ?? "", numerica: true, ancho: 130 },
  { clave: "comentarios", titulo: "Comentarios", grupo: "Seguimiento", valores: (f) => [comentarios(f)], texto: (f) => f.comentarios, ancho: 260 },
  { clave: "contactoInicial", titulo: "Contacto inicial", grupo: "Seguimiento", valores: (f) => uno(f.contactoInicial), fecha: true, ancho: 120 },
  { clave: "contactoSemana", titulo: "Contacto semana", grupo: "Seguimiento", valores: (f) => uno(f.contactoSemana), fecha: true, ancho: 120 },
  { clave: "acceso", titulo: "Acceso", grupo: "Programa", valores: (f) => uno(f.acceso), ancho: 120 },
  { clave: "followUp", titulo: "Follow-up", grupo: "Seguimiento", valores: (f) => uno(f.followUp), ancho: 150 },
  { clave: "reporte", titulo: "Reporte semanal", grupo: "Seguimiento", valores: (f) => [f.reporte.estado], ancho: 130,
    ayuda: "Sale de los reportes semanales del alumno; si todavía no tiene ninguno cargado, de lo que se marcó a mano en su ficha." },
  { clave: "ultimoContacto", titulo: "Último contacto", grupo: "Seguimiento", valores: (f) => uno(f.ultimoContacto), fecha: true, ancho: 120 },
  { clave: "garantia", titulo: "Garantía", grupo: "Programa", valores: (f) => uno(f.garantia), ancho: 140 },
  { clave: "wpp", titulo: "Acceso WhatsApp", grupo: "Accesos", valores: (f) => siNo(f.wpp), ancho: 110 },
  { clave: "zoom", titulo: "Acceso Zoom", grupo: "Accesos", valores: (f) => siNo(f.zoom), ancho: 100 },
  { clave: "wibo", titulo: "Acceso Wibo", grupo: "Accesos", valores: (f) => siNo(f.wibo), ancho: 100 },
  { clave: "contrato", titulo: "Contrato firmado", grupo: "Contrato", valores: (f) => uno(f.contrato), ancho: 130 },
  { clave: "pais", titulo: "País", grupo: "Datos", valores: (f) => uno(f.pais), ancho: 130 },
  { clave: "closer", titulo: "Closer", grupo: "Programa", valores: (f) => uno(f.closer), ancho: 140,
    ayuda: "Quién lo cerró: sale de la venta del alumno." },
  { clave: "estadoContrato", titulo: "Estado del contrato", grupo: "Contrato", valores: (f) => uno(f.estadoContrato), ancho: 170 },
  { clave: "cv", titulo: "CV", grupo: "CV y LinkedIn", valores: (f) => [f.cv ? "Corregido" : "Pendiente"], ancho: 100 },
  { clave: "linkedin", titulo: "LinkedIn", grupo: "CV y LinkedIn", valores: (f) => [f.linkedin ? "Corregido" : "Pendiente"], ancho: 100 },
  { clave: "responsableCv", titulo: "Responsable del CV y LinkedIn", grupo: "CV y LinkedIn", valores: (f) => uno(f.responsableCv), ancho: 150 },
  { clave: "semanasSin", titulo: "Semanas sin reportar", grupo: "Seguimiento", valores: (f) => numeroComoValor(f.reporte.semanasSin),
    orden: (f) => f.reporte.semanasSin ?? "", numerica: true, ancho: 120 },
  { clave: "proximo", titulo: "Próximo contacto", grupo: "Seguimiento", valores: (f) => uno(f.situacion === "fuera" ? "" : f.proximo), fecha: true, ancho: 130,
    ayuda: "Último contacto (o el ingreso) más la cadencia del alumno." },
  { clave: "cadencia", titulo: "Cadencia", grupo: "Seguimiento", valores: (f) => [`Cada ${f.cadencia} días`], orden: (f) => f.cadencia, numerica: true, ancho: 110 },
  { clave: "estadoAlumno", titulo: "Estado del alumno", grupo: "Seguimiento", valores: (f) => [f.estadoAlumno], ancho: 120 },
  { clave: "etapa", titulo: "Etapa del servicio", grupo: "Seguimiento", valores: (f) => uno(f.etapa), ancho: 150 },
  { clave: "testimonio", titulo: "Testimonio", grupo: "Seguimiento", valores: (f) => [f.testimonio], ancho: 150 },
];

/* Las que se ven de entrada: las 29 de Lili, en su orden, y al final el CV y el LinkedIn. */
export const VISIBLES_CLIENTES: ClaveCliente[] = [
  "numero", "nombre", "inicio", "egreso", "edad", "stack", "telefono", "dni", "domicilio", "email", "programa", "plan", "duracion", "mentor",
  "comentarios", "contactoInicial", "contactoSemana", "acceso", "followUp", "reporte", "ultimoContacto", "garantia", "wpp", "zoom", "wibo",
  "contrato", "pais", "closer", "estadoContrato", "cv", "linkedin", "responsableCv",
];
export const ORDEN_CLIENTES: OrdenCs<ClaveCliente>[] = [{ clave: "inicio", desc: true }];

export const MOTOR_CLIENTES = crearMotor(COLUMNAS_CLIENTES, "cli");

export function coincideCliente(f: FilaCliente, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [f.nombre, f.email, f.telefono, f.dni, f.pais, f.closer, f.comentarios, f.numero === null ? "" : String(f.numero)]
    .some((x) => sinTildes(x ?? "").includes(t));
}

/* ---------- Corregir en la celda ---------- */

export type EditorCliente = "texto" | "largo" | "fecha" | "opciones" | "sugerencias" | "si-no" | "ficha";

/* Cómo se corrige cada columna. Las que no están no se tocan desde la tabla (salen de los reportes, de la venta o de los días). */
export const EDITOR_CLIENTE: Partial<Record<ClaveCliente, EditorCliente>> = {
  numero: "texto", nombre: "texto", inicio: "fecha", egreso: "fecha", edad: "texto", stack: "opciones", telefono: "texto", dni: "texto",
  domicilio: "texto", email: "texto", programa: "ficha", plan: "sugerencias", duracion: "texto", mentor: "opciones", comentarios: "largo",
  contactoInicial: "fecha", contactoSemana: "fecha", acceso: "opciones", followUp: "opciones", reporte: "ficha", ultimoContacto: "fecha",
  garantia: "sugerencias", wpp: "si-no", zoom: "si-no", wibo: "si-no", contrato: "opciones", pais: "sugerencias", closer: "sugerencias",
  estadoContrato: "opciones", cv: "si-no", linkedin: "si-no", responsableCv: "sugerencias", estadoAlumno: "opciones",
};

/* Por qué una columna no se corrige a mano: lo dice al pasar el mouse. */
export const POR_QUE_NO_CLIENTE: Partial<Record<ClaveCliente, string>> = {
  semanasSin: "Se calcula con los reportes semanales (o con lo que se marcó a mano en la ficha).",
  proximo: "Se calcula: último contacto más la cadencia. Se corrige con «Lo contacté» y «No contestó».",
  cadencia: "Se elige en «A contactar hoy» o en la ficha del cliente.",
  etapa: "Se cambia en el pipeline de servicio.",
  testimonio: "Se carga en la pestaña Testimonios.",
};

export type EscrituraCliente =
  | { tipo: "seguimiento"; cambios: Partial<SeguimientoAlumno>; detalle: string }
  | { tipo: "alumno"; cambios: Partial<Alumno>; detalle: string }
  /* El nombre, el mail o el teléfono son de la persona: se corrigen en todos lados (acciones.corregirPersona). */
  | { tipo: "persona"; id: ID; cambios: { nombre?: string; email?: string; telefono?: string }; alumno: Partial<Alumno>; detalle: string }
  | { tipo: "correccion"; que: "cv" | "linkedin"; corregido: boolean }
  | { tipo: "no"; motivo: string };

export const OPCIONES_ESTADO_ALUMNO: { valor: Alumno["estado"]; texto: string }[] = [
  { valor: "activo", texto: "Activo" }, { valor: "pausado", texto: "Pausado" },
  { valor: "graduado", texto: "Egresado" }, { valor: "baja", texto: "Baja" },
];

const esDia = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const esMail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** Qué se guarda al corregir una celda. `valor` es lo que escribió la persona (o la opción elegida). */
export function escrituraCliente(f: FilaCliente, clave: ClaveCliente, valor: string, listas: ListasCs): EscrituraCliente {
  const v = valor.trim();
  const titulo = MOTOR_CLIENTES.columna[clave].titulo;
  const seg = (cambios: Partial<SeguimientoAlumno>, texto = v): EscrituraCliente =>
    ({ tipo: "seguimiento", cambios, detalle: `${titulo}: ${texto || "vacío"}.` });
  const numero = (rango: readonly [number, number], campo: keyof SeguimientoAlumno, nombre: string, texto = v): EscrituraCliente => {
    if (!texto) return seg({ [campo]: null } as Partial<SeguimientoAlumno>);
    const n = aNumero(texto);
    if (n === null || !Number.isInteger(n) || n < rango[0] || n > rango[1]) return { tipo: "no", motivo: `${nombre}: poné un número entre ${rango[0]} y ${rango[1]}.` };
    return seg({ [campo]: n } as Partial<SeguimientoAlumno>, String(n));
  };
  const dia = (campo: keyof SeguimientoAlumno): EscrituraCliente => {
    if (!v) return seg({ [campo]: null } as Partial<SeguimientoAlumno>);
    if (!esDia(v)) return { tipo: "no", motivo: `${titulo}: la fecha tiene que ser un día válido.` };
    return seg({ [campo]: v } as Partial<SeguimientoAlumno>, v);
  };

  switch (clave) {
    case "nombre":
      if (!v) return { tipo: "no", motivo: "El alumno tiene que tener nombre." };
      return { tipo: "persona", id: f.alumno.leadId ?? f.id, cambios: { nombre: v }, alumno: { nombre: v }, detalle: `Nombre: ${v}.` };
    case "email":
      if (v && !esMail(v)) return { tipo: "no", motivo: "Ese mail no parece válido." };
      return { tipo: "persona", id: f.alumno.leadId ?? f.id, cambios: { email: v }, alumno: { email: v }, detalle: `Mail: ${v || "vacío"}.` };
    case "telefono":
      /* Si la persona tiene contacto en la app, el teléfono es suyo; si no (un alumno importado), de la ficha. */
      return f.contacto
        ? { tipo: "persona", id: f.contacto.id, cambios: { telefono: v }, alumno: {}, detalle: `Teléfono: ${v || "vacío"}.` }
        : seg({ telefono: v });
    case "inicio":
      if (!v) return { tipo: "no", motivo: "La fecha de inicio no se puede dejar vacía." };
      if (!esDia(v)) return { tipo: "no", motivo: "La fecha de inicio tiene que ser un día válido." };
      return { tipo: "alumno", cambios: { inicio: diaAInstante(v) }, detalle: `Fecha de inicio: ${v}.` };
    case "pais": return { tipo: "alumno", cambios: { pais: v || undefined }, detalle: `País: ${v || "vacío"}.` };
    case "estadoAlumno": {
      const o = OPCIONES_ESTADO_ALUMNO.find((x) => x.texto === v || x.valor === v);
      return o ? { tipo: "alumno", cambios: { estado: o.valor }, detalle: `Estado del alumno: ${o.texto}.` } : { tipo: "no", motivo: "Elegí uno de los estados." };
    }
    case "numero": {
      /* No se vacía: cada alumno tiene el suyo («Numerar» se lo da a los que todavía no tienen). */
      if (!v) return { tipo: "no", motivo: "El N.º de alumno no se deja vacío: cada alumno tiene el suyo (el botón «Numerar» se lo da a los que no tienen)." };
      if (!Number.isInteger(Number(v)) || Number(v) < 1) return { tipo: "no", motivo: "El N.º de alumno tiene que ser un número entero desde 1." };
      return seg({ numero: Number(v) });
    }
    case "edad": return numero(ENTRE.edad, "edad", "Edad");
    case "duracion": return numero(ENTRE.duracion, "duracionMeses", "Duración (meses)");
    case "mentor": {
      /* Se elige «2 sesiones»; también sirve escribir «2». */
      const n = /\d+/.exec(v);
      return numero(ENTRE.mentor, "sesionesMentor", "Sesiones con el mentor", n ? n[0] : v);
    }
    case "egreso": return dia("fechaEgreso");
    case "contactoInicial": return dia("contactoInicial");
    case "contactoSemana": return dia("contactoSemana");
    case "ultimoContacto": {
      const r = dia("ultimoContacto");
      /* Corregir el último contacto recalcula el próximo (sale del último más la cadencia) y corta la racha de «no contestó». */
      return r.tipo === "seguimiento" ? { ...r, cambios: { ...r.cambios, proximoContacto: null, intentosSinRespuesta: 0, ultimoIntento: null } } : r;
    }
    case "stack": return seg({ stack: valorDeLista(v, listas.stacks) });
    case "dni": return seg({ dni: v });
    case "domicilio": return seg({ domicilio: v });
    case "plan": return seg({ planDePago: v });
    case "comentarios": return seg({ notas: valor }, v ? "con texto" : "vacío");
    case "acceso": return seg({ acceso: valorDeLista(v, listas.accesos) });
    case "followUp": return seg({ followUp: valorDeLista(v, listas.followUps) });
    case "garantia": return seg({ garantia: valorDeLista(v, listas.garantias) });
    case "contrato": {
      const c = valorDeLista(v, CONTRATOS);
      return !v || CONTRATOS.includes(c) ? seg({ contratoFirmado: c }) : { tipo: "no", motivo: "El contrato está «Firmado» o «Pendiente»." };
    }
    case "estadoContrato": return seg({ estadoContrato: valorDeLista(v, listas.estadosContrato) });
    case "responsableCv": return seg({ responsableCv: v });
    case "wpp": return seg({ accesoWhatsapp: v === SI }, v === SI ? "Sí" : "No");
    case "zoom": return seg({ accesoZoom: v === SI }, v === SI ? "Sí" : "No");
    case "wibo": return seg({ accesoWibo: v === SI }, v === SI ? "Sí" : "No");
    case "cv": return { tipo: "correccion", que: "cv", corregido: v === SI || v === "Corregido" };
    case "linkedin": return { tipo: "correccion", que: "linkedin", corregido: v === SI || v === "Corregido" };
    case "closer":
      return f.closerDeVenta
        ? { tipo: "no", motivo: "El closer sale de la venta del alumno: se cambia desde la venta." }
        : seg({ closerNombre: v });
    default:
      return { tipo: "no", motivo: POR_QUE_NO_CLIENTE[clave] ?? "Esta columna no se corrige acá." };
  }
}

/** El texto que se edita de una celda. */
export function valorEditableCliente(f: FilaCliente, clave: ClaveCliente): string {
  switch (clave) {
    case "numero": return f.numero === null ? "" : String(f.numero);
    case "edad": return f.edad === null || f.edadSugerida ? "" : String(f.edad);
    case "duracion": return f.seg.duracionMeses === null ? "" : String(f.seg.duracionMeses);
    case "mentor": return f.mentor === null ? "" : sesiones(f.mentor);
    case "inicio": return f.inicio;
    case "egreso": return f.seg.fechaEgreso ?? "";
    case "plan": return f.seg.planDePago;
    case "comentarios": return f.comentarios;
    case "telefono": return f.telefono;
    case "pais": return f.pais;
    case "closer": return f.closer;
    case "estadoAlumno": return f.estadoAlumno;
    case "wpp": return f.wpp ? SI : NO;
    case "zoom": return f.zoom ? SI : NO;
    case "wibo": return f.wibo ? SI : NO;
    case "cv": return f.cv ? SI : NO;
    case "linkedin": return f.linkedin ? SI : NO;
    default: {
      const x = (f as unknown as Record<string, unknown>)[clave];
      return typeof x === "string" ? x : "";
    }
  }
}

/** Aplica una escritura de `seguimiento` o una corrección a la ficha, dejando quién y cuándo. */
export function aplicarEscritura(s: SeguimientoAlumno, w: EscrituraCliente, hoy: string, quien: string, cuando: string): SeguimientoAlumno {
  if (w.tipo === "seguimiento") return { ...s, ...w.cambios, actualizadoEn: cuando, actualizadoPor: quien };
  if (w.tipo === "correccion") return aplicarCorreccion(s, w.que, w.corregido, hoy, quien, cuando);
  return s;
}

/* ---------- Testimonios ---------- */

export interface FilaTestimonio {
  /* El id del testimonio. */
  id: ID;
  testimonio: Testimonio;
  alumno?: Alumno;
  cliente?: FilaCliente;
  nombre: string;
  edad: number | null;
  inicio: string;
  telefono: string;
  stack: string;
  pais: string;
  tecnologias: string;
}

export function filasTestimonios(e: Pick<EstadoApp, "testimonios">, clientes: readonly FilaCliente[]): FilaTestimonio[] {
  const porAlumno = new Map(clientes.map((c) => [c.id, c] as const));
  return [...(e.testimonios ?? [])].map((t0) => {
    const t = testimonioNormal(t0);
    const c = porAlumno.get(t.alumnoId);
    return {
      id: t.id, testimonio: t, alumno: c?.alumno, cliente: c,
      nombre: c?.nombre ?? "", edad: c?.edad ?? null, inicio: c?.inicio ?? "", telefono: c?.telefono ?? "",
      stack: c?.stack ?? "", pais: c?.pais ?? "",
      tecnologias: t.tecnologias || (c?.contacto?.tecnologias ?? "").trim(),
    };
  });
}

export type ClaveTestimonio =
  | "alumno" | "edad" | "inicio" | "telefono" | "followUp" | "fechaGrabacion" | "conQuien" | "resell" | "estadoVideo" | "link"
  | "tecnologias" | "stack" | "previa" | "actual" | "notas" | "pais";

const conTexto = (t: string, con: string, sin: string) => (t.trim() ? con : sin);

export const COLUMNAS_TESTIMONIOS: ColumnaCs<FilaTestimonio, ClaveTestimonio>[] = [
  { clave: "alumno", titulo: "Alumno", grupo: "Alumno", valores: (f) => uno(f.nombre || "Alumno borrado"), orden: (f) => sinTildes(f.nombre), ancho: 220 },
  { clave: "edad", titulo: "Edad", grupo: "Alumno", valores: (f) => numeroComoValor(f.edad), orden: (f) => f.edad ?? "", numerica: true, ancho: 80,
    ayuda: "Sale de la ficha del cliente." },
  { clave: "inicio", titulo: "Fecha de inicio", grupo: "Alumno", valores: (f) => uno(f.inicio), fecha: true, ancho: 120, ayuda: "Sale de la ficha del cliente." },
  { clave: "telefono", titulo: "Teléfono", grupo: "Alumno", valores: (f) => uno(f.telefono), ancho: 150, ayuda: "Sale de la ficha del cliente." },
  { clave: "followUp", titulo: "Follow-up", grupo: "Testimonio", valores: (f) => uno(f.testimonio.followUp), ancho: 170,
    ayuda: "Si ya se agendó la llamada de grabación, si no se agendó, si está pendiente de agendar o si no quiere grabar." },
  { clave: "fechaGrabacion", titulo: "Fecha de grabación", grupo: "Testimonio", valores: (f) => uno(f.testimonio.fechaGrabacion), fecha: true, ancho: 130 },
  { clave: "conQuien", titulo: "Con quién grabó", grupo: "Testimonio", valores: (f) => uno(f.testimonio.conQuien), ancho: 130 },
  { clave: "resell", titulo: "Resell", grupo: "Testimonio", valores: (f) => uno(f.testimonio.resell), ancho: 120,
    ayuda: "Cómo salió el pitch de renovación que se hace después de la llamada del testimonio." },
  { clave: "estadoVideo", titulo: "Estado del video", grupo: "Testimonio", valores: (f) => uno(f.testimonio.estadoVideo), ancho: 160 },
  { clave: "link", titulo: "Link del video", grupo: "Testimonio", valores: (f) => [conTexto(f.testimonio.link, "Con link", "Sin link")], texto: (f) => f.testimonio.link, ancho: 120 },
  { clave: "tecnologias", titulo: "Tecnologías", grupo: "Perfil", valores: (f) => uno(f.tecnologias), ancho: 180 },
  { clave: "stack", titulo: "Stack", grupo: "Perfil", valores: (f) => uno(f.stack), ancho: 140, ayuda: "Sale de la ficha del cliente." },
  { clave: "previa", titulo: "Situación previa", grupo: "Perfil", valores: (f) => [conTexto(f.testimonio.situacionPrevia, "Con texto", "Sin texto")], texto: (f) => f.testimonio.situacionPrevia, ancho: 240 },
  { clave: "actual", titulo: "Situación actual", grupo: "Perfil", valores: (f) => [conTexto(f.testimonio.situacionActual, "Con texto", "Sin texto")], texto: (f) => f.testimonio.situacionActual, ancho: 240 },
  { clave: "notas", titulo: "Notas", grupo: "Perfil", valores: (f) => [conTexto(f.testimonio.notas, "Con notas", "Sin notas")], texto: (f) => f.testimonio.notas, ancho: 240 },
  { clave: "pais", titulo: "País", grupo: "Alumno", valores: (f) => uno(f.pais), ancho: 130, ayuda: "Sale de la ficha del cliente." },
];

export const VISIBLES_TESTIMONIOS: ClaveTestimonio[] = COLUMNAS_TESTIMONIOS.map((c) => c.clave);
export const ORDEN_TESTIMONIOS: OrdenCs<ClaveTestimonio>[] = [{ clave: "fechaGrabacion", desc: true }];
export const MOTOR_TESTIMONIOS = crearMotor(COLUMNAS_TESTIMONIOS, "tes");

export function coincideTestimonio(f: FilaTestimonio, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [f.nombre, f.telefono, f.tecnologias, f.testimonio.notas, f.testimonio.situacionPrevia, f.testimonio.situacionActual, f.testimonio.link]
    .some((x) => sinTildes(x ?? "").includes(t));
}

/* ---------- Agenda de resells ---------- */

export interface FilaResell {
  /* El id del resell. */
  id: ID;
  resell: Resell;
  /* El día de la agenda en Argentina («2026-10-07»). */
  dia: string;
  /* «Agendada», «Cancelada» o lo que se cargó. */
  estado: string;
  /* Si el mail es de un alumno de la app. */
  alumno?: Alumno;
}

export function filasResells(e: Pick<EstadoApp, "resells" | "alumnos">): FilaResell[] {
  const porMail = new Map<string, Alumno>();
  for (const a of e.alumnos) {
    const k = a.email.trim().toLowerCase();
    if (k && !porMail.has(k)) porMail.set(k, a);
  }
  return (e.resells ?? []).map((r0) => {
    const r = resellNormal(r0);
    return {
      id: r.id, resell: r, dia: diaDeNegocio(r.fechaHora) || "",
      estado: r.estado || (r.cancelada ? "Cancelada" : "Agendada"),
      alumno: r.email ? porMail.get(r.email.trim().toLowerCase()) : undefined,
    };
  });
}

export type ClaveResell = "fechaHora" | "nombre" | "email" | "telefono" | "closer" | "estado" | "cash" | "caso" | "notas";

export const COLUMNAS_RESELLS: ColumnaCs<FilaResell, ClaveResell>[] = [
  { clave: "fechaHora", titulo: "Fecha y hora de agenda", grupo: "Agenda", valores: (f) => uno(f.dia), orden: (f) => f.resell.fechaHora, fecha: true, ancho: 170 },
  { clave: "nombre", titulo: "Nombre completo", grupo: "Agenda", valores: (f) => uno(f.resell.nombre), orden: (f) => sinTildes(f.resell.nombre), ancho: 220 },
  { clave: "email", titulo: "Mail", grupo: "Agenda", valores: (f) => uno(f.resell.email), ancho: 220 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Agenda", valores: (f) => uno(f.resell.telefono), ancho: 150 },
  { clave: "closer", titulo: "Closer", grupo: "Agenda", valores: (f) => uno(f.resell.closer), ancho: 140 },
  { clave: "estado", titulo: "Estado", grupo: "Resultado", valores: (f) => [f.estado], ancho: 140 },
  { clave: "cash", titulo: "Cash Collect", grupo: "Resultado", valores: (f) => numeroComoValor(f.resell.cashCollect), orden: (f) => f.resell.cashCollect ?? "", numerica: true, ancho: 120 },
  { clave: "caso", titulo: "Caso de éxito", grupo: "Resultado", valores: (f) => siNo(f.resell.casoDeExito), ancho: 110 },
  { clave: "notas", titulo: "Notas", grupo: "Resultado", valores: (f) => [conTexto(f.resell.notas, "Con notas", "Sin notas")], texto: (f) => f.resell.notas, ancho: 260 },
];

export const VISIBLES_RESELLS: ClaveResell[] = COLUMNAS_RESELLS.map((c) => c.clave);
export const ORDEN_RESELLS: OrdenCs<ClaveResell>[] = [{ clave: "fechaHora", desc: true }];
export const MOTOR_RESELLS = crearMotor(COLUMNAS_RESELLS, "res");

export function coincideResell(f: FilaResell, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [f.resell.nombre, f.resell.email, f.resell.telefono, f.resell.closer, f.resell.notas].some((x) => sinTildes(x ?? "").includes(t));
}

/* Cuáles llamadas de Calendly son de resell y cómo se llama su fila: viven en lib/resells.ts (lo usa también el servidor). */
export { esLlamadaDeResell, idResell } from "./resells";

/* ---------- Lo que se cuenta arriba de la tabla ---------- */

export interface ResumenClientes {
  activos: number;
  vencidos: number;
  cvPendiente: number;
  linkedinPendiente: number;
  sinNumero: number;
}

export function resumenClientes(filas: readonly FilaCliente[]): ResumenClientes {
  const activas = filas.filter((f) => f.alumno.estado === "activo");
  return {
    activos: activas.length,
    vencidos: activas.filter((f) => f.situacion === "vencido").length,
    cvPendiente: activas.filter((f) => !f.cv).length,
    linkedinPendiente: activas.filter((f) => !f.linkedin).length,
    sinNumero: filas.filter((f) => f.numero === null).length,
  };
}

