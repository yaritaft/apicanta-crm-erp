import { claveEmail } from "./contactos";
import { diaDeNegocio } from "./dia-negocio";
import type {
  Alumno, ConfigSeguimiento, Contacto, EstadoApp, EstadoTestimonio, ID, SeguimientoAlumno, Testimonio,
} from "./types";

/* ==================================================================
   Customer Success: el seguimiento de los alumnos (F2-09, reunión del 02/10).

   Manu: «no sería una ficha por alumno, sino una lista general, un checklist:
   cuáles faltan contactar, cuáles no contestaron, a quién hablar hoy».

   Cada alumno tiene una cadencia (cada 7, 15 o 20 días). Después de cada
   contacto, el próximo toca a los tantos días. Si no contestó, se vuelve a
   intentar a los pocos días, y después de varios intentos seguidos se
   sugiere marcarlo como «dejó de contestar». Todo eso se ajusta
   (CONFIG_POR_DEFECTO o Ajustes.seguimiento): Lili todavía no contó cómo lo
   lleva hoy en sus planillas y en Airtable, y los valores se corrigen cuando
   conteste.

   Todo acá es puro (sin React ni base) para poder probarlo. Los días son
   «2026-10-07», del día del negocio (Argentina): no se mezclan con la hora.
   ================================================================== */

export const CONFIG_POR_DEFECTO: ConfigSeguimiento = {
  cadencias: [7, 15, 20],
  cadenciaPorDefecto: 15,
  reintentoDias: 3,
  intentosHastaDejar: 3,
};

/** La configuración que se usa: la de Ajustes, saneada, o la de siempre. */
export function configSeguimiento(c?: Partial<ConfigSeguimiento> | null): ConfigSeguimiento {
  const cadencias = [...new Set((c?.cadencias ?? []).map((n) => Math.round(Number(n))).filter((n) => n >= 1 && n <= 365))]
    .sort((a, b) => a - b);
  const lista = cadencias.length ? cadencias : CONFIG_POR_DEFECTO.cadencias;
  const entero = (n: unknown, min: number, max: number, defecto: number) => {
    const x = Math.round(Number(n));
    return Number.isFinite(x) && x >= min && x <= max ? x : defecto;
  };
  const porDefecto = entero(c?.cadenciaPorDefecto, 1, 365, CONFIG_POR_DEFECTO.cadenciaPorDefecto);
  return {
    cadencias: lista,
    /* La cadencia de arranque tiene que ser una de las que se pueden elegir. */
    cadenciaPorDefecto: lista.includes(porDefecto) ? porDefecto : lista[0],
    reintentoDias: entero(c?.reintentoDias, 1, 60, CONFIG_POR_DEFECTO.reintentoDias),
    intentosHastaDejar: entero(c?.intentosHastaDejar, 1, 20, CONFIG_POR_DEFECTO.intentosHastaDejar),
  };
}

/* ---------- días ---------- */

const MS_DIA = 86_400_000;
const comoUTC = (dia: string) => {
  const [a, m, d] = dia.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, (m || 1) - 1, d || 1);
};

/** «2026-10-07» más n días (n puede ser negativo). */
export function sumarDias(dia: string, n: number): string {
  return new Date(comoUTC(dia) + n * MS_DIA).toISOString().slice(0, 10);
}

/** Cuántos días pasaron entre dos días (hasta − desde). */
export const diasEntre = (desde: string, hasta: string) => Math.round((comoUTC(hasta) - comoUTC(desde)) / MS_DIA);

/** El día de hoy en el negocio. */
export const hoyDelNegocio = (ahora: Date = new Date()) => diaDeNegocio(ahora.toISOString());

/* ---------- el seguimiento de un alumno ---------- */

export const idSeguimiento = (alumnoId: ID) => `seg_${alumnoId}`;

/** El seguimiento de un alumno al que todavía no se le cargó nada. */
export function seguimientoVacio(alumnoId: ID, cfg: ConfigSeguimiento, cuando = new Date().toISOString()): SeguimientoAlumno {
  return {
    id: idSeguimiento(alumnoId), alumnoId,
    cadenciaDias: cfg.cadenciaPorDefecto,
    ultimoContacto: null, proximoContacto: null,
    intentosSinRespuesta: 0, ultimoIntento: null, dejoDeContestar: false,
    cvCorregido: false, cvCorregidoEn: null, linkedinCorregido: false, linkedinCorregidoEn: null,
    notas: "", actualizadoEn: cuando, actualizadoPor: "",
  };
}

/** Desde cuándo se cuenta la cadencia: el último contacto o, si nunca lo hubo, cuando entró. */
export const baseDeCadencia = (s: Pick<SeguimientoAlumno, "ultimoContacto">, alumno: Pick<Alumno, "inicio">): string =>
  s.ultimoContacto ?? diaDeNegocio(alumno.inicio);

/** Cuándo toca el próximo contacto: el que se cargó o, si no hay, base + cadencia. */
export function proximoDe(s: Pick<SeguimientoAlumno, "ultimoContacto" | "proximoContacto" | "cadenciaDias">, alumno: Pick<Alumno, "inicio">): string {
  return s.proximoContacto ?? sumarDias(baseDeCadencia(s, alumno), s.cadenciaDias);
}

/** «Lo contacté»: queda como último contacto hoy y el próximo toca a la cadencia. Corta la racha de «no contestó». */
export function aplicarContacto(s: SeguimientoAlumno, hoy: string, quien = "", cuando = new Date().toISOString()): SeguimientoAlumno {
  return {
    ...s, ultimoContacto: hoy, proximoContacto: sumarDias(hoy, s.cadenciaDias),
    intentosSinRespuesta: 0, ultimoIntento: null, dejoDeContestar: false,
    actualizadoEn: cuando, actualizadoPor: quien,
  };
}

/** «No contestó»: cuenta un intento y se vuelve a probar a los pocos días. No cuenta como contacto. */
export function aplicarNoContesto(s: SeguimientoAlumno, hoy: string, cfg: ConfigSeguimiento, quien = "", cuando = new Date().toISOString()): SeguimientoAlumno {
  return {
    ...s, intentosSinRespuesta: s.intentosSinRespuesta + 1, ultimoIntento: hoy,
    proximoContacto: sumarDias(hoy, cfg.reintentoDias),
    actualizadoEn: cuando, actualizadoPor: quien,
  };
}

/** Cambiar la cadencia recalcula el próximo desde el último contacto (o el ingreso). */
export function aplicarCadencia(s: SeguimientoAlumno, dias: number, alumno: Pick<Alumno, "inicio">, quien = "", cuando = new Date().toISOString()): SeguimientoAlumno {
  const cambiada = { ...s, cadenciaDias: dias };
  return { ...cambiada, proximoContacto: sumarDias(baseDeCadencia(cambiada, alumno), dias), actualizadoEn: cuando, actualizadoPor: quien };
}

/** «Dejó de contestar»: sale de la lista del día. Al volver a marcarlo como contactado, vuelve. */
export function aplicarDejoDeContestar(s: SeguimientoAlumno, dejo: boolean, quien = "", cuando = new Date().toISOString()): SeguimientoAlumno {
  return { ...s, dejoDeContestar: dejo, actualizadoEn: cuando, actualizadoPor: quien };
}

/** Marcar o desmarcar el CV o el LinkedIn corregido; guarda el día en que se corrigió. */
export function aplicarCorreccion(
  s: SeguimientoAlumno, que: "cv" | "linkedin", corregido: boolean, hoy: string, quien = "", cuando = new Date().toISOString(),
): SeguimientoAlumno {
  return que === "cv"
    ? { ...s, cvCorregido: corregido, cvCorregidoEn: corregido ? hoy : null, actualizadoEn: cuando, actualizadoPor: quien }
    : { ...s, linkedinCorregido: corregido, linkedinCorregidoEn: corregido ? hoy : null, actualizadoEn: cuando, actualizadoPor: quien };
}

/* ---------- la lista ---------- */

export type SituacionSeguimiento =
  /* Ya pasó el día en que tocaba. */
  | "vencido"
  /* Toca hoy. */
  | "hoy"
  /* Todavía falta. */
  | "al-dia"
  /* Marcado como «dejó de contestar»: no se lo persigue. */
  | "no-contesta"
  /* Pausado, egresado o dado de baja: no entra al seguimiento. */
  | "fuera";

export interface FilaSeguimiento {
  id: ID;
  alumno: Alumno;
  /* Null si todavía no se le cargó nada: se muestra con la cadencia de arranque. */
  seguimiento: SeguimientoAlumno | null;
  contacto?: Contacto;
  pais: string;
  aniosExperiencia?: number;
  tecnologias: string;
  cadenciaDias: number;
  ultimoContacto: string | null;
  proximoContacto: string;
  /* Días de atraso: más de 0 es vencido, 0 es hoy y menos de 0, lo que falta. */
  atraso: number;
  situacion: SituacionSeguimiento;
  intentosSinRespuesta: number;
  /* Ya van varios intentos seguidos sin respuesta: se sugiere marcarlo como «dejó de contestar». */
  sugerirDejoDeContestar: boolean;
  dejoDeContestar: boolean;
  cvCorregido: boolean;
  linkedinCorregido: boolean;
  /* El testimonio más reciente, si hay. */
  testimonio: Testimonio | null;
}

export const seguimientoDelAlumno = (e: Pick<EstadoApp, "seguimientos">, alumnoId: ID) =>
  (e.seguimientos ?? []).find((s) => s.alumnoId === alumnoId) ?? null;

/* La persona detrás de cada alumno, por todos los caminos que hay (el lead, el
   contacto o, como último recurso, el mail), armada una sola vez para toda la
   lista: con cientos de alumnos y miles de leads, buscar uno por uno se nota. */
function indiceDeContactos(e: EstadoApp) {
  const porId = new Map(e.contactos.map((c) => [c.id, c] as const));
  const lead = new Map(e.leads.map((l) => [l.id, l] as const));
  const porMail = new Map<string, Contacto>();
  for (const c of e.contactos) {
    const k = claveEmail(c.email);
    if (k && !porMail.has(k)) porMail.set(k, c);
  }
  return (a: Alumno): Contacto | undefined => {
    if (a.leadId) {
      const l = lead.get(a.leadId);
      const c = (l ? porId.get(l.contactoId ?? l.id) : undefined) ?? porId.get(a.leadId);
      if (c) return c;
    }
    const k = claveEmail(a.email);
    return k ? porMail.get(k) : undefined;
  };
}

/** La situación de un alumno según cuándo le toca el próximo contacto. */
export function situacionDe(estado: Alumno["estado"], dejoDeContestar: boolean, atraso: number): SituacionSeguimiento {
  if (estado !== "activo") return "fuera";
  if (dejoDeContestar) return "no-contesta";
  return atraso > 0 ? "vencido" : atraso === 0 ? "hoy" : "al-dia";
}

/** Una fila por alumno, con lo del contacto, el seguimiento y el último testimonio. */
export function filasDeSeguimiento(e: EstadoApp, hoy: string): FilaSeguimiento[] {
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const contactoDe = indiceDeContactos(e);
  const seg = new Map((e.seguimientos ?? []).map((s) => [s.alumnoId, s] as const));
  const testimonio = new Map<ID, Testimonio>();
  for (const t of e.testimonios ?? []) {
    const antes = testimonio.get(t.alumnoId);
    if (!antes || t.creadoEn > antes.creadoEn) testimonio.set(t.alumnoId, t);
  }
  return e.alumnos.map((a): FilaSeguimiento => {
    const s = seg.get(a.id) ?? null;
    const base = s ?? seguimientoVacio(a.id, cfg);
    const contacto = contactoDe(a);
    const proximo = proximoDe(base, a);
    const atraso = diasEntre(proximo, hoy);
    return {
      id: a.id, alumno: a, seguimiento: s, contacto,
      pais: (contacto?.pais || a.pais || "").trim(),
      aniosExperiencia: contacto?.aniosExperiencia,
      tecnologias: (contacto?.tecnologias ?? "").trim(),
      cadenciaDias: base.cadenciaDias,
      ultimoContacto: base.ultimoContacto,
      proximoContacto: proximo,
      atraso,
      situacion: situacionDe(a.estado, base.dejoDeContestar, atraso),
      intentosSinRespuesta: base.intentosSinRespuesta,
      sugerirDejoDeContestar: !base.dejoDeContestar && base.intentosSinRespuesta >= cfg.intentosHastaDejar,
      dejoDeContestar: base.dejoDeContestar,
      cvCorregido: base.cvCorregido,
      linkedinCorregido: base.linkedinCorregido,
      testimonio: testimonio.get(a.id) ?? null,
    };
  });
}

/** A quién contactar hoy: los que ya les toca (o se pasaron), con lo más vencido arriba. */
export function aContactarHoy(filas: FilaSeguimiento[]): FilaSeguimiento[] {
  return filas
    .filter((f) => f.situacion === "vencido" || f.situacion === "hoy")
    .sort((x, y) => y.atraso - x.atraso
      /* A igual atraso, primero el que más intentos sin respuesta lleva, y después por nombre. */
      || y.intentosSinRespuesta - x.intentosSinRespuesta
      || x.alumno.nombre.localeCompare(y.alumno.nombre, "es"));
}

export interface ResumenSeguimiento {
  /* Alumnos activos en seguimiento. */
  activos: number;
  vencidos: number;
  hoy: number;
  alDia: number;
  noContestan: number;
  sinCv: number;
  sinLinkedin: number;
}

export function resumenDeSeguimiento(filas: FilaSeguimiento[]): ResumenSeguimiento {
  const activas = filas.filter((f) => f.situacion !== "fuera");
  const cuenta = (p: (f: FilaSeguimiento) => boolean) => activas.filter(p).length;
  return {
    activos: activas.length,
    vencidos: cuenta((f) => f.situacion === "vencido"),
    hoy: cuenta((f) => f.situacion === "hoy"),
    alDia: cuenta((f) => f.situacion === "al-dia"),
    noContestan: cuenta((f) => f.situacion === "no-contesta"),
    sinCv: cuenta((f) => !f.cvCorregido),
    sinLinkedin: cuenta((f) => !f.linkedinCorregido),
  };
}

/* ---------- filtros de la lista ---------- */

export type SiNo = "" | "si" | "no";

export interface FiltrosSeguimiento {
  q: string;
  situacion: SituacionSeguimiento | "";
  cv: SiNo;
  linkedin: SiNo;
  /* 0 = todas. */
  cadencia: number;
  pais: string;
  /* «sin» = nunca se le pidió. */
  testimonio: EstadoTestimonio | "sin" | "";
}

export const SIN_FILTROS: FiltrosSeguimiento = { q: "", situacion: "", cv: "", linkedin: "", cadencia: 0, pais: "", testimonio: "" };

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filtrarSeguimiento(filas: FilaSeguimiento[], f: FiltrosSeguimiento): FilaSeguimiento[] {
  const t = sinTildes(f.q.trim());
  const pais = sinTildes(f.pais.trim());
  return filas.filter((x) => {
    if (f.situacion && x.situacion !== f.situacion) return false;
    if (f.cv && (f.cv === "si") !== x.cvCorregido) return false;
    if (f.linkedin && (f.linkedin === "si") !== x.linkedinCorregido) return false;
    if (f.cadencia && x.cadenciaDias !== f.cadencia) return false;
    if (pais && sinTildes(x.pais) !== pais) return false;
    if (f.testimonio && (f.testimonio === "sin" ? x.testimonio !== null : x.testimonio?.estado !== f.testimonio)) return false;
    if (!t) return true;
    return [x.alumno.nombre, x.alumno.email, x.pais, x.tecnologias, x.alumno.cohorte, x.alumno.plan]
      .some((v) => v && sinTildes(v).includes(t));
  });
}

/** Los países que aparecen en la lista, para el filtro. */
export const paisesDeSeguimiento = (filas: FilaSeguimiento[]): string[] =>
  [...new Set(filas.map((f) => f.pais).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

/* ---------- testimonios ---------- */

export const ESTADOS_TESTIMONIO: EstadoTestimonio[] = ["pedido", "grabado", "publicado"];

export const TEXTO_TESTIMONIO: Record<EstadoTestimonio, string> = {
  pedido: "Pedido", grabado: "Grabado", publicado: "Publicado",
};

/** Cuántos testimonios hay en cada estado. */
export function cuentaDeTestimonios(ts: Testimonio[]): Record<EstadoTestimonio, number> {
  const out: Record<EstadoTestimonio, number> = { pedido: 0, grabado: 0, publicado: 0 };
  for (const t of ts) out[t.estado] += 1;
  return out;
}

/** Los testimonios con el nombre del alumno, los más nuevos arriba. */
export function testimoniosConAlumno(e: Pick<EstadoApp, "testimonios" | "alumnos">): { testimonio: Testimonio; alumno: Alumno | undefined }[] {
  const alumnos = new Map(e.alumnos.map((a) => [a.id, a] as const));
  return [...(e.testimonios ?? [])]
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.creadoEn.localeCompare(a.creadoEn))
    .map((t) => ({ testimonio: t, alumno: alumnos.get(t.alumnoId) }));
}

/* ---------- cómo se lee en pantalla ---------- */

/** «Hace 3 días», «Hoy», «En 5 días» para el atraso de un próximo contacto. */
export function textoDeAtraso(atraso: number): string {
  if (atraso === 0) return "Hoy";
  if (atraso > 0) return atraso === 1 ? "Venció ayer" : `Vencido hace ${atraso} días`;
  return atraso === -1 ? "Mañana" : `En ${-atraso} días`;
}
