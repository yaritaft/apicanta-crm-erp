import { leerReunion, llamadaDe, type Grabacion, type LlamadaCandidata } from "./fathom";
import { miembroDeCloser } from "./crm";

/* ==================================================================
   El diagnóstico de Fathom (F2-04): «¿por qué no llegan las llamadas de
   los closers?». Ajustes → Fathom → «Diagnosticar» le pide a Fathom, desde
   el servidor y con la clave que ya está en Vercel, lo que esa clave ve, y
   lo cruza con las llamadas de Calendly que hay en la app. La clave nunca
   sale del servidor: acá sólo entran las respuestas de Fathom y las filas
   de la base, y sale un resumen con cuentas, nombres de quien grabó y un
   veredicto. Sin títulos ni contenido de ninguna reunión.

   Las tres causas probables (reunión del 02/10):
   (a) Fathom no se une a las llamadas de Zoom («tipo de reunión no
       soportado»): no hay grabación que traer. Lo arregla Manu.
   (b) Visibilidad: las llamadas de cada closer no están compartidas con el
       equipo de ventas, o la cuenta dueña de la clave no ve lo compartido.
   (c) La app no pedía las del equipo (sólo lo que la clave graba o le
       comparten, sin `teams[]`).
   Y una cuarta que sale de cruzar con Calendly: (d) las grabaciones llegan
   pero no se pueden atar a una llamada (el invitado entró con otro mail).

   Lógica pura, sin red ni base: se prueba con respuestas simuladas.
   ================================================================== */

export type Plataforma = "zoom" | "meet" | "teams" | "otra" | "sin-enlace";

export const NOMBRE_PLATAFORMA: Record<Plataforma, string> = {
  zoom: "Zoom", meet: "Google Meet", teams: "Microsoft Teams", otra: "Otra plataforma", "sin-enlace": "Sin enlace en Calendly",
};

/** La plataforma de una llamada de Calendly, por el enlace de la reunión. */
export function plataformaDe(enlace?: string | null): Plataforma {
  const e = (enlace ?? "").trim().toLowerCase();
  if (!e) return "sin-enlace";
  if (/(^|[/.])zoom\.(us|com)\b|zoomgov\.com/.test(e)) return "zoom";
  if (/meet\.google\.com|g\.co\/meet/.test(e)) return "meet";
  if (/teams\.microsoft\.com|teams\.live\.com/.test(e)) return "teams";
  return "otra";
}

/* ---------- lo que entra ---------- */

export interface LlamadaDiag { id: string; email?: string | null; inicia: string; anfitrion?: string | null; enlace?: string | null; estado?: string | null }
export interface MiembroDiag { nombre: string; email?: string | null; rol?: string | null; activo?: boolean }
export interface MiembroDeFathom { nombre?: string; email?: string; equipo?: string }
export interface PasadaPorEquipo { equipo: string; items: unknown[]; completo: boolean; error?: string }

export interface EntradaDiagnostico {
  ahora: number;
  /** Desde cuándo se miró (ISO). */
  desde: string;
  /** GET /meetings sin filtrar: lo que la clave ve. */
  generales: unknown[];
  generalesCompleto: boolean;
  /** GET /teams (null: no se pudo leer, por ejemplo un plan sin equipos). */
  equipos: string[] | null;
  /** GET /team_members (null: no se pudo leer). */
  miembros: MiembroDeFathom[] | null;
  /** GET /meetings?teams[]=… de cada equipo de ventas. */
  porEquipo: PasadaPorEquipo[];
  /** Cómo está la conexión (webhook) de la app. */
  conexion: { conectado: boolean; paraElEquipo: boolean | null };
  /** Las llamadas de Calendly que hay en la app desde `desde`. */
  llamadas: LlamadaDiag[];
  /** El equipo de la app (para saber quién es closer y su mail). */
  equipoApp: MiembroDiag[];
  /** Los recording_id que ya están guardados. */
  yaGuardadas: string[];
  /** Lo que no se pudo leer, en castellano y sin la clave. */
  errores: string[];
  /** Si Fathom no dejó leer ni las reuniones (clave rechazada, por ejemplo): por qué. */
  fallo?: string;
}

/* ---------- lo que sale ---------- */

export interface GrabadorDiag {
  nombre: string; email: string; equipo: string | null; esCloser: boolean;
  reuniones: number; atadas: number; sinAgenda: number; personales: number;
}
export interface CloserDiag {
  nombre: string; email: string | null;
  /** Llamadas de Calendly que ya pasaron (sin canceladas ni no-show). */
  llamadas: number;
  /** De esas, las que tienen una grabación atada. */
  conGrabacion: number;
  /** Reuniones que grabó él, vengan de donde vengan. */
  grabadasPorEl: number;
  /** Si figura entre los integrantes del equipo de Fathom (null: no se sabe). */
  enFathom: boolean | null;
}
export interface PlataformaDiag { plataforma: Plataforma; nombre: string; llamadas: number; conGrabacion: number }
export interface EquipoDiag { nombre: string; deVentas: boolean; reuniones: number | null; soloAhi: number | null; completo: boolean; error?: string }

export type CausaDiag = "a" | "b" | "c" | "d" | "ok" | "sin-datos" | "error";
export interface Veredicto { causa: CausaDiag; titulo: string; explicacion: string; pasos: string[]; pistas: string[] }

export interface Diagnostico {
  desde: string;
  /** Las reuniones distintas que devolvió Fathom (sin filtrar y por equipo). */
  reuniones: number;
  /** Cuántas devuelve sin filtrar y cuántas aparecen sólo al pedir por equipo. */
  sinFiltrar: number;
  soloPorEquipo: number;
  incompleto: boolean;
  equipos: EquipoDiag[];
  conexion: EntradaDiagnostico["conexion"];
  grabadores: GrabadorDiag[];
  /** El tipo de reunión que informa la API: con gente de afuera o sólo del equipo. */
  tipos: { conAfuera: number; soloInternas: number; sinDato: number };
  /** Cuántas están atadas a una agenda de Calendly y cuántas no, y por qué. */
  atado: { atadas: number; nuevas: number; yaExistian: number; sinAgenda: number; personales: number };
  plataformas: PlataformaDiag[];
  closers: CloserDiag[];
  veredicto: Veredicto;
  errores: string[];
}

/* ---------- leer una reunión ---------- */

interface ReunionDiag { g: Grabacion; equipo: string | null; tipo: "con-externos" | "solo-internos" | "sin-dato" }

const aTexto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Una reunión de GET /meetings: la grabación que leería la app y, aparte,
    el equipo de quien grabó (`recorded_by.team`) y el tipo de invitados
    (`calendar_invitees_domains_type`). null si no trae recording_id. */
export function leerReunionDiag(item: unknown): ReunionDiag | null {
  const g = leerReunion(item);
  if (!g) return null;
  const m = objeto(objeto(item).meeting ?? item);
  const tipoCrudo = aTexto(m.calendar_invitees_domains_type);
  const tipo = tipoCrudo === "one_or_more_external" ? "con-externos"
    : tipoCrudo === "only_internal" ? "solo-internos"
    : g.invitados.length === 0 ? "sin-dato"
    : g.invitados.some((i) => i.externo === true) ? "con-externos"
    : g.invitados.every((i) => i.externo === false) ? "solo-internos" : "sin-dato";
  return { g, equipo: aTexto(objeto(m.recorded_by).team), tipo };
}

/** Los integrantes de un GET /team_members (items con name, email y, a
    veces, team). */
export function leerMiembrosDeFathom(items: unknown[]): MiembroDeFathom[] {
  return items.map((x) => {
    const o = objeto(x);
    return { nombre: aTexto(o.name) ?? undefined, email: aTexto(o.email)?.toLowerCase(), equipo: aTexto(o.team) ?? undefined };
  }).filter((m) => m.email || m.nombre);
}

/* ---------- el diagnóstico ---------- */

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const DIA = 86_400_000;
/* Una llamada «ya pasó» a los 45 minutos de empezar: antes, la grabación todavía puede no estar. */
const YA_PASO = 45 * 60_000;
/* Pocas llamadas no dicen nada: con menos de 3 de una plataforma no se concluye. */
const MINIMO = 3;

export function diagnosticar(e: EntradaDiagnostico): Diagnostico {
  const equipoApp = e.equipoApp;
  const emailsDeLaApp = equipoApp.map((m) => ({ nombre: m.nombre, email: m.email ?? null }));
  const yaGuardadas = new Set(e.yaGuardadas);

  /* Las reuniones distintas, y en qué pasada aparecieron. */
  const porId = new Map<string, ReunionDiag>();
  const enGenerales = new Set<string>();
  for (const x of e.generales) {
    const r = leerReunionDiag(x);
    if (!r) continue;
    porId.set(r.g.recordingId, r);
    enGenerales.add(r.g.recordingId);
  }
  const equipos: EquipoDiag[] = [];
  const soloEnEquipos = new Set<string>();
  for (const p of e.porEquipo) {
    const ids = new Set<string>();
    for (const x of p.items) {
      const r = leerReunionDiag(x);
      if (!r) continue;
      ids.add(r.g.recordingId);
      if (!porId.has(r.g.recordingId)) porId.set(r.g.recordingId, r);
      if (!enGenerales.has(r.g.recordingId)) soloEnEquipos.add(r.g.recordingId);
    }
    equipos.push({
      nombre: p.equipo, deVentas: true, reuniones: p.error ? null : ids.size,
      soloAhi: p.error ? null : [...ids].filter((id) => !enGenerales.has(id)).length, completo: p.completo, error: p.error,
    });
  }
  /* Los equipos que existen y no son de ventas: sólo para que se vean. */
  for (const n of e.equipos ?? []) {
    if (!equipos.some((q) => sinTildes(q.nombre) === sinTildes(n))) equipos.push({ nombre: n, deVentas: false, reuniones: null, soloAhi: null, completo: true });
  }

  /* Los closers: quien atendió las llamadas de Calendly, con su mail de Equipo. */
  const llamadas = e.llamadas.filter((l) => {
    const t = Date.parse(l.inicia);
    return Number.isFinite(t) && t <= e.ahora - YA_PASO && l.estado !== "cancelada" && l.estado !== "no-show";
  });
  const candidatas: LlamadaCandidata[] = llamadas.map((l) => ({ id: l.id, email: l.email ?? null, inicia: l.inicia, anfitrion: l.anfitrion ?? null }));
  const closerDe = (anfitrion?: string | null): string => {
    const m = anfitrion ? miembroDeCloser(anfitrion, equipoApp) : undefined;
    return m?.nombre ?? (anfitrion?.trim() || "(sin anfitrión)");
  };
  const closers = new Map<string, CloserDiag>();
  const abrirCloser = (nombre: string): CloserDiag => {
    let c = closers.get(nombre);
    if (!c) {
      const m = equipoApp.find((x) => x.nombre === nombre);
      c = { nombre, email: m?.email?.trim().toLowerCase() || null, llamadas: 0, conGrabacion: 0, grabadasPorEl: 0, enFathom: null };
      closers.set(nombre, c);
    }
    return c;
  };
  /* Los closers activos del equipo cuentan aunque no tengan llamadas en el período. */
  for (const m of equipoApp) if (m.rol === "closer" && m.activo !== false) abrirCloser(m.nombre);
  for (const l of llamadas) abrirCloser(closerDe(l.anfitrion)).llamadas++;

  /* Cada reunión: ¿se ata a una llamada de Calendly? ¿y si no, por qué? */
  const llamadaAtada = new Map<string, string>(); // sesionId → recordingId
  const grabadores = new Map<string, GrabadorDiag>();
  const atado = { atadas: 0, nuevas: 0, yaExistian: 0, sinAgenda: 0, personales: 0 };
  const tipos = { conAfuera: 0, soloInternas: 0, sinDato: 0 };
  const internos = new Set(emailsDeLaApp.map((m) => (m.email ?? "").trim().toLowerCase()).filter(Boolean));

  for (const r of porId.values()) {
    const g = r.g;
    if (r.tipo === "con-externos") tipos.conAfuera++; else if (r.tipo === "solo-internos") tipos.soloInternas++; else tipos.sinDato++;

    const sesionId = llamadaDe(g, candidatas, emailsDeLaApp);
    const hayExternos = g.invitados.some((i) => i.email && !internos.has(i.email) && i.email !== g.grabadoPor);
    let clase: "atada" | "sinAgenda" | "personal";
    if (sesionId) {
      clase = "atada";
      atado.atadas++;
      if (yaGuardadas.has(g.recordingId)) atado.yaExistian++; else atado.nuevas++;
      if (!llamadaAtada.has(sesionId)) llamadaAtada.set(sesionId, g.recordingId);
    } else if (hayExternos) { clase = "sinAgenda"; atado.sinAgenda++; }
    else { clase = "personal"; atado.personales++; }

    const clave = g.grabadoPor ?? `nombre:${sinTildes(g.grabadoPorNombre ?? "")}`;
    let gr = grabadores.get(clave);
    if (!gr) {
      const miembro = g.grabadoPor ? equipoApp.find((m) => (m.email ?? "").trim().toLowerCase() === g.grabadoPor) : undefined;
      const esCloser = Boolean(miembro?.rol === "closer") || Boolean(g.grabadoPorNombre && [...closers.keys()].some((n) => miembroDeCloser(g.grabadoPorNombre!, [{ nombre: n }])));
      gr = { nombre: g.grabadoPorNombre ?? miembro?.nombre ?? "(sin nombre)", email: g.grabadoPor ?? "", equipo: r.equipo, esCloser, reuniones: 0, atadas: 0, sinAgenda: 0, personales: 0 };
      grabadores.set(clave, gr);
    }
    gr.reuniones++;
    if (clase === "atada") gr.atadas++; else if (clase === "sinAgenda") gr.sinAgenda++; else gr.personales++;
    if (!gr.equipo && r.equipo) gr.equipo = r.equipo;
  }

  /* Cuántas grabó cada closer y cuántas de sus llamadas tienen grabación. */
  for (const c of closers.values()) {
    c.grabadasPorEl = [...grabadores.values()].filter((g) => (c.email && g.email === c.email) || (!g.email && miembroDeCloser(g.nombre, [{ nombre: c.nombre }]))).reduce((s, g) => s + g.reuniones, 0);
    if (e.miembros && c.email) c.enFathom = e.miembros.some((m) => m.email === c.email);
  }
  const plataformas = new Map<Plataforma, PlataformaDiag>();
  for (const l of llamadas) {
    const p = plataformaDe(l.enlace);
    const fila = plataformas.get(p) ?? { plataforma: p, nombre: NOMBRE_PLATAFORMA[p], llamadas: 0, conGrabacion: 0 };
    fila.llamadas++;
    if (llamadaAtada.has(l.id)) {
      fila.conGrabacion++;
      closers.get(closerDe(l.anfitrion))!.conGrabacion++;
    }
    plataformas.set(p, fila);
  }

  const lista = [...grabadores.values()].sort((a, b) => b.reuniones - a.reuniones);
  const listaClosers = [...closers.values()].sort((a, b) => b.llamadas - a.llamadas || a.nombre.localeCompare(b.nombre, "es"));
  const listaPlataformas = [...plataformas.values()].sort((a, b) => b.llamadas - a.llamadas);
  const incompleto = !e.generalesCompleto || e.porEquipo.some((p) => !p.completo);

  const d: Diagnostico = {
    desde: e.desde, reuniones: porId.size, sinFiltrar: enGenerales.size, soloPorEquipo: soloEnEquipos.size, incompleto,
    equipos, conexion: e.conexion, grabadores: lista, tipos, atado, plataformas: listaPlataformas, closers: listaClosers,
    veredicto: { causa: "sin-datos", titulo: "", explicacion: "", pasos: [], pistas: [] }, errores: e.errores,
  };
  d.veredicto = veredictoDe(d, e, soloEnEquipos, porId);
  return d;
}

/* ---------- el veredicto ---------- */

function veredictoDe(d: Diagnostico, e: EntradaDiagnostico, soloEnEquipos: Set<string>, porId: Map<string, ReunionDiag>): Veredicto {
  const pistas: string[] = [];
  const f = new Date(d.desde);
  const desde = Number.isFinite(f.getTime()) ? `${f.getUTCDate()}/${f.getUTCMonth() + 1}` : "?";
  const conLlamadas = d.closers.filter((c) => c.llamadas > 0);
  const sinNada = conLlamadas.filter((c) => c.llamadas >= 2 && c.conGrabacion === 0 && c.grabadasPorEl === 0);
  const nombres = (cs: CloserDiag[]) => cs.map((c) => c.nombre).join(", ");

  /* Pistas que valen sea cual sea la causa. */
  if (d.conexion.conectado && d.conexion.paraElEquipo === false) {
    pistas.push("El webhook quedó sólo para lo que graba la cuenta de la clave y lo que le comparten, sin lo del equipo: las llamadas nuevas de los closers no llegan solas. Se arregla con Desconectar y Conectar (si Fathom acepta el alcance de equipo, que pide plan Team).");
  } else if (!d.conexion.conectado) {
    pistas.push("Fathom no está conectado en la app (sin webhook): lo nuevo no llega solo, sólo con «Traer lo anterior».");
  }
  const sinMail = d.closers.filter((c) => !c.email && c.nombre !== "(sin anfitrión)");
  if (sinMail.length) pistas.push(`Falta el mail en Equipo de ${nombres(sinMail)}: sin él no se saben cuáles de las grabaciones son suyas.`);
  const fueraDeFathom = d.closers.filter((c) => c.enFathom === false);
  if (fueraDeFathom.length) pistas.push(`No figuran entre los integrantes del equipo de Fathom: ${nombres(fueraDeFathom)}.`);
  if (e.equipos && e.equipos.length === 0) pistas.push("Fathom no devuelve ningún equipo: la cuenta de la clave no tiene equipos (o el plan no los incluye).");
  if (e.equipos === null) pistas.push("No se pudo leer la lista de equipos de Fathom.");
  if (d.incompleto) pistas.push("Fathom devolvió tantas reuniones (o pidió esperar) que no se leyeron todas: las cuentas pueden estar por debajo de lo real.");

  const pasoManu = "Manu: que las llamadas de cada closer estén compartidas con el equipo de ventas en Fathom, y que la cuenta dueña de la clave (la de Yari) sea Admin con acceso a todo lo compartido. Además, confirmar cómo se llama exactamente el equipo (para FATHOM_EQUIPOS en Vercel, si no se llama «Sales» o «Ventas»).";

  /* Fathom no contestó: no se puede decir nada de las causas. */
  if (e.fallo) {
    return {
      causa: "error", titulo: "No se pudo leer lo que Fathom devuelve", explicacion: e.fallo,
      pasos: ["Si dice que no aceptó la clave: crear una clave nueva en Fathom (Ajustes → API, desde la cuenta de Yari) y cambiar FATHOM_API_KEY en Vercel."], pistas,
    };
  }

  /* Sin llamadas de Calendly no hay con qué comparar. */
  if (conLlamadas.length === 0) {
    return {
      causa: "sin-datos", titulo: "No hay llamadas de Calendly para comparar",
      explicacion: d.reuniones === 0
        ? `La clave no ve ninguna reunión de Fathom desde el ${desde}, y en la app no hay llamadas de Calendly en ese período.`
        : `La clave ve ${d.reuniones} reuniones desde el ${desde}, pero en la app no hay llamadas de Calendly ya pasadas en ese período para cruzarlas.`,
      pasos: ["Revisar que Calendly esté conectado y trayendo las llamadas (Ajustes → Calendly)."], pistas,
    };
  }

  /* Nada de nada: la clave no ve ninguna reunión. */
  if (d.reuniones === 0) {
    return {
      causa: "b", titulo: "Causa (b), visibilidad: la clave no ve ninguna grabación",
      explicacion: `Hay ${conLlamadas.reduce((s, c) => s + c.llamadas, 0)} llamadas de Calendly desde el ${desde} y Fathom no le devuelve ninguna reunión a la clave. O la cuenta dueña de la clave no tiene acceso a lo compartido, o no hay nada compartido, o Fathom no se está uniendo a ninguna llamada (causa a).`,
      pasos: [pasoManu, "Si en Fathom se ven grabaciones de closers desde la cuenta de Yari y acá no, probar con una clave nueva creada desde esa cuenta (Fathom → Ajustes → API)."], pistas,
    };
  }

  /* (c) Aparecen al pedir por equipo y no sin filtrar. */
  const closersEnEquipos = [...soloEnEquipos].map((id) => porId.get(id)!).filter((r) => d.grabadores.some((g) => g.esCloser && (g.email ? g.email === r.g.grabadoPor : g.nombre === r.g.grabadoPorNombre)));
  if (soloEnEquipos.size > 0 && (closersEnEquipos.length > 0 || sinNada.length > 0)) {
    return {
      causa: "c", titulo: "Causa (c): la app no pedía las llamadas del equipo",
      explicacion: `Sin filtrar, Fathom devuelve ${d.sinFiltrar} reuniones; pidiendo por equipo de ventas aparecen ${soloEnEquipos.size} más${closersEnEquipos.length ? ` (${closersEnEquipos.length} grabadas por closers)` : ""}. Esas son las «Team Calls» que decía Yari. «Traer lo anterior» ahora pide también por equipo, así que tocándolo se traen.`,
      pasos: ["Tocar «Traer lo anterior» y mirar cuántas se atan.", "Si el webhook está para lo propio nada más: Desconectar y Conectar, así lo nuevo también llega por equipo."], pistas,
    };
  }

  /* (d) Fathom devuelve grabaciones de los closers, pero no se atan. */
  const noSeAtan = conLlamadas.filter((c) => c.grabadasPorEl > 0 && c.conGrabacion < c.llamadas / 2);
  const sinAgendaDeClosers = d.grabadores.filter((g) => g.esCloser).reduce((s, g) => s + g.sinAgenda, 0);
  if (noSeAtan.length > 0 && sinAgendaDeClosers > 0) {
    return {
      causa: "d", titulo: "Las grabaciones llegan, pero no se atan a una llamada",
      explicacion: `Fathom sí devuelve reuniones de ${nombres(noSeAtan)}, pero ${sinAgendaDeClosers} tienen invitados de afuera y ninguna llamada de Calendly con ese mail a menos de 4 horas. El invitado probablemente entró a Zoom con otro mail que el de Calendly, o la llamada se movió de hora.`,
      pasos: ["En el cierre del día, «Buscar en Fathom» deja atarla a mano (busca entre las que grabó el closer).", "Si pasa seguido: decidir si guardar también las de equipo que no se pueden atar (hoy se descartan)."], pistas,
    };
  }

  /* (a) y (b): hay closers con llamadas y sin ninguna grabación visible. */
  if (sinNada.length > 0) {
    const zoom = d.plataformas.find((p) => p.plataforma === "zoom");
    const otras = d.plataformas.filter((p) => p.plataforma !== "zoom" && p.plataforma !== "sin-enlace");
    const otrasGrabadas = otras.reduce((s, p) => s + p.conGrabacion, 0);
    const otrasTotal = otras.reduce((s, p) => s + p.llamadas, 0);
    const zoomSolo = Boolean(zoom && zoom.llamadas >= MINIMO && zoom.conGrabacion === 0);
    if (zoomSolo && otrasGrabadas > 0) {
      return {
        causa: "a", titulo: "Causa (a): Fathom no se está uniendo a las llamadas de Zoom",
        explicacion: `De las ${zoom!.llamadas} llamadas de Zoom desde el ${desde}, ninguna tiene grabación; de las de otras plataformas, ${otrasGrabadas} de ${otrasTotal} sí. Sin grabación hecha, la API no tiene nada que traer: no es de la app ni de la visibilidad. Sin grabación de ${nombres(sinNada)}.`,
        pasos: ["Manu: arreglar en la configuración de Fathom con Zoom el «tipo de reunión no soportado» (que el bot o la app de Fathom pueda unirse a las reuniones de Zoom de cada closer).", "Después de arreglarlo, hacer una llamada de prueba y volver a tocar «Diagnosticar»."], pistas,
      };
    }
    const todoZoom = Boolean(zoom && zoom.llamadas >= MINIMO && zoom.llamadas >= (zoom.llamadas + otrasTotal) * 0.8);
    return {
      causa: "b", titulo: "Causa (b), visibilidad: las llamadas de los closers no le llegan a la clave",
      explicacion: `${nombres(sinNada)} ${sinNada.length === 1 ? "tuvo" : "tuvieron"} llamadas de Calendly desde el ${desde} y Fathom no le devuelve a la clave ninguna reunión grabada por ${sinNada.length === 1 ? "esa persona" : "ellos"}, mientras sí ve las de ${d.grabadores.filter((g) => !g.esCloser).slice(0, 3).map((g) => g.nombre).join(", ") || "otras personas"}. Lo más probable: sus llamadas no están compartidas con el equipo de ventas, o la cuenta de la clave no ve lo compartido.${todoZoom ? " Ojo: casi todas sus llamadas son de Zoom, así que también puede ser la causa (a): Fathom sin unirse a Zoom. Se separan mirando en Fathom si esas reuniones existen." : ""}`,
      pasos: [pasoManu, ...(todoZoom ? ["Manu: mirar en Fathom (con la cuenta de un closer) si una llamada reciente de Zoom aparece grabada: si no, es (a)."] : [])], pistas,
    };
  }

  /* Todo bien (o casi). */
  const total = conLlamadas.reduce((s, c) => s + c.llamadas, 0);
  const con = conLlamadas.reduce((s, c) => s + c.conGrabacion, 0);
  return {
    causa: "ok", titulo: "Las llamadas de los closers llegan",
    explicacion: `${con} de ${total} llamadas de Calendly desde el ${desde} tienen su grabación atada${d.atado.nuevas ? `; ${d.atado.nuevas} reuniones más se guardarían con «Traer lo anterior»` : ""}. Lo que falta son llamadas que no se grabaron o que todavía no terminaron de procesarse en Fathom.`,
    pasos: d.atado.nuevas ? ["Tocar «Traer lo anterior» para guardar las que faltan."] : [], pistas,
  };
}

/** La ventana que mira el diagnóstico: desde el día antes de la primera
    llamada de Calendly, pero no más de 45 días atrás (alcanza para ver el
    problema sin pedirle de más a Fathom). */
export function desdeDelDiagnostico(primeraLlamada: string | null | undefined, ahora: number): string {
  const piso = ahora - 45 * DIA;
  const primera = Date.parse(primeraLlamada ?? "");
  return new Date(Number.isFinite(primera) ? Math.max(primera - DIA, piso) : piso).toISOString();
}
