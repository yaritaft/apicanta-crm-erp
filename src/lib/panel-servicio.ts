import type { EstadoApp, ID } from "./types";
import { DURACION_POR_DEFECTO, estadosDeResell, filasClientes, filasResells, filasTestimonios, sumarMeses } from "./clientes-cs";
import { diasEntre, formatoDia, terminoElServicio } from "./seguimiento";
import { diasDe } from "./pausas";
import { crearMotor, uno, varios, type ColumnaCs, type OrdenCs } from "./tabla-cs";

/* ==================================================================
   «Mi panel» de Customer Success (reunión del 19/10 con Lili, Aldana y Yari).

   Lili lleva el servicio de punta a punta y hoy anda atrás de todo: de los
   alumnos, y también de los closers (que le digan si un alumno renueva o se da
   de baja) y de quien graba los testimonios. Este panel junta en una pantalla
   lo que hoy le toca hacer a ella, con las reglas a la vista:

     · A contactar hoy      el seguimiento que ya venció o toca hoy.
     · Nuevos               entraron hace poco y todavía no tienen el primer contacto.
     · Contrato por vencer  se les acaba en los próximos 30 días (o ya se acabó y siguen activos): renovar o dar de baja.
     · Resells sin cierre   la llamada de renovación ya pasó y el closer no dijo en qué quedó (más de una semana, en rojo).
     · Testimonios          por agendar la grabación, o grabados sin el link del video.
     · Reportes             alumnos que dejaron de mandar el reporte semanal.
     · Contratos            sin firmar a los pocos días de empezar.

   Todo sale de lo que la app ya tiene cargado (lib/clientes-cs.ts arma cada
   fila): este archivo ordena y no inventa otra cuenta. No guarda nada.
   ================================================================== */

/** Desde cuándo un alumno deja de ser «nuevo». */
export const DIAS_NUEVO = 14;
/** Cuántos días antes de que termine el contrato se avisa para renovar. */
export const DIAS_PARA_RENOVAR = 30;
/** Una semana: pasada la llamada de resell, el closer tiene que decir en qué quedó (Lili, 19/10). */
export const DIAS_PARA_CERRAR_RESELL = 7;
/** Cuántos días después de empezar se espera el contrato firmado. */
export const DIAS_PARA_FIRMAR = 3;
/** Hasta cuántos días después de que termina el contrato se lo sigue considerando «en servicio» (para renovarlo o darlo de baja). */
export const DIAS_DE_GRACIA = 45;
/* «Arrancan o retoman» los muestra unos días antes de que termine la demora o la pausa, para avisarle. */
export const DIAS_ANTES_DE_RETOMAR = 3;

/* Los estados con los que un resell queda resuelto: renueva (con o sin upgrade), no renueva, pasa a outboarding o sigue vigente.
   «2da Agenda» y «Seguimiento» lo dejan abierto: todavía falta una llamada o una respuesta. */
const RESELL_RESUELTO = ["upgrade a hackear ia", "no quiere renovar", "outbording", "outboarding", "garantia extendida", "alumno vigente", "renueva", "no renueva"];
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const resellResuelto = (estado: string | null | undefined): boolean => estadosDeResell(estado).some((x) => RESELL_RESUELTO.includes(sinTildes(x)));

export type TonoServicio = "rojo" | "ambar" | "neutro";

export interface ItemServicio {
  /* Único en la sección: para la lista de React. */
  clave: string;
  /* El alumno, para abrir su ficha. Un resell cuyo mail no es de un alumno no la tiene. */
  alumnoId?: ID;
  nombre: string;
  /* El programa («Hackear IT»), chico, debajo del nombre. */
  programa?: string;
  /* Lo que lo trajo acá, en una línea. */
  detalle: string;
  /* A la derecha, corto: «hace 10 d», «en 5 d», «hoy». */
  cuando: string;
  /* Para escribirle sin abrir la ficha (se copian con un toque). */
  telefono?: string;
  email?: string;
  pais?: string;
  /* Cuántos días hace (o faltan, si es negativo) del hecho que lo trae acá; sirve para ordenar y para el color. */
  dias: number | null;
  tono: TonoServicio;
}

export interface SeccionServicio {
  id: "contactar" | "vuelven" | "nuevos" | "renovar" | "resells" | "testimonios" | "reportes" | "contratos";
  titulo: string;
  /* El nombre para la tarjeta chica de arriba, donde el título entero no entra. */
  corto: string;
  /* La regla, en una línea: qué hace que alguien aparezca acá. */
  regla: string;
  total: number;
  /* Cuántos de todos (no sólo de los que se muestran) están en rojo. */
  rojos: number;
  /* Todos los de la lista, lo más urgente arriba. */
  items: ItemServicio[];
  /* Qué decir cuando no hay nadie. */
  vacio: string;
  /* A dónde se va a ver la lista entera. */
  verTodos?: { texto: string; href: string };
}

export interface PanelDeServicio {
  hoy: string;
  /* Alumnos en servicio (activos y con el contrato vigente o recién terminado): la base de todo. */
  activos: number;
  /* Figuran como activos pero su Follow Up ya dice «outboarding» o «caso de éxito» (como en el Airtable de Lili): terminaron el programa y no entran al panel. */
  enOutboarding: number;
  /* Figuran como activos, no están en outboarding y su contrato terminó hace más de `DIAS_DE_GRACIA` días: no entran al panel; Lili los actualiza (Follow Up, egreso o estado). */
  desactualizados: number;
  secciones: SeccionServicio[];
  /* La revisión de CV y LinkedIn (Aldana): cuántas siguen en curso, por estado. */
  cvs: { enCurso: number; porEstado: { estado: string; n: number }[]; sinAlumno: number };
  /* Cuántas cosas están en rojo entre todas las listas, para el resumen de arriba. */
  urgentes: number;
  /* Todos los alumnos, una fila cada uno, para la cartera (la tabla de abajo). */
  cartera: FilaCartera[];
  /* Los números del servicio (como «Tus números» de Blue OS). */
  numeros: NumerosDeServicio;
}

/* ---------- La cartera: los alumnos por etapa del recorrido (como el pipeline de activación de Blue OS) ----------
   La etapa sale del Follow Up que Lili lleva en su Airtable (OUTBOARDING, RESERVA, Roadmap, Módulo 1, MAS ENTREVISTAS…):
   no se inventa otro estado, se agrupan los suyos. Un Follow Up que no se reconoce cae en «Cursando». */

export type EtapaAlumnoId = "iniciando" | "cursando" | "busqueda" | "renovacion" | "riesgo" | "exito" | "outboarding" | "sin";

export const ETAPAS_DEL_ALUMNO: { id: EtapaAlumnoId; label: string; ayuda: string; riesgo?: boolean }[] = [
  { id: "iniciando", label: "Iniciando", ayuda: "Reserva, onboarding o demora para arrancar: la primera semana define si ejecuta." },
  { id: "cursando", label: "Cursando", ayuda: "En el Roadmap o en algún módulo del programa." },
  { id: "busqueda", label: "Búsqueda laboral", ayuda: "CV y LinkedIn, entrevistas o Take Home Challenge." },
  { id: "renovacion", label: "Renovación", ayuda: "Con la llamada de resell agendada o subiendo de nivel." },
  { id: "riesgo", label: "En riesgo", ayuda: "Pausó la mentoría, no contesta, pidió devolución o se traba.", riesgo: true },
  { id: "exito", label: "Caso de éxito", ayuda: "Consiguió el trabajo o una mejora de sueldo." },
  { id: "outboarding", label: "Outboarding", ayuda: "Cerrando el programa." },
  { id: "sin", label: "Sin follow up", ayuda: "Todavía no tiene el Follow Up cargado." },
];

/** La etapa del recorrido según el Follow Up del Airtable de Lili. */
export function etapaDelFollowUp(followUp: string | null | undefined): EtapaAlumnoId {
  const f = sinTildes(followUp ?? "");
  if (!f) return "sin";
  if (f.startsWith("outboarding") || f.startsWith("outbording")) return "outboarding";
  if (f.includes("caso de exito") || f.includes("ganancia mayor")) return "exito";
  if (f.includes("resell") || f.includes("renovacion")) return "renovacion";
  if (["no contesta", "no responde", "no avanzando", "pauso", "pausa", "devolucion", "limitaciones", "excusas", "no aplica", "lento", "no tiene resultados", "sin resultados"].some((x) => f.includes(x))) return "riesgo";
  if (["edicion cv", "linkedin", "likendin", "entrevistas", "take home"].some((x) => f.includes(x))) return "busqueda";
  if (["reserva", "onboarding", "demora"].some((x) => f.includes(x))) return "iniciando";
  return "cursando";
}

export interface FilaCartera {
  id: ID;
  nombre: string;
  programa: string;
  followUp: string;
  etapa: EtapaAlumnoId;
  estadoAlumno: string;
  /* Activo, no cerró (outboarding o caso de éxito) y su contrato no terminó hace más de `DIAS_DE_GRACIA` días. */
  enServicio: boolean;
  inicio: string;
  egreso: string | null;
  ultimoContacto: string | null;
  /* Vacío si no le toca seguimiento (no está activo o ya cerró). */
  proximo: string;
  atraso: number;
  reporte: string;
  telefono: string;
  email: string;
  pais: string;
}

export interface NumerosDeServicio {
  enServicio: number;
  /* De los que están en servicio y tienen el dato del reporte (semanal o el del Airtable), cuántos siguen reportando (no están inactivos). */
  reportando: { si: number; de: number };
  /* De los que están en servicio, cuántos tuvieron un contacto en los últimos 30 días. */
  contactados30: { si: number; de: number };
  casosDeExito: number;
  testimoniosConVideo: number;
  /* Resells de este mes que renovaron (renueva o upgrade). */
  renovacionesMes: number;
}

const tonoPorDias = (dias: number, rojoDesde: number): TonoServicio => (dias >= rojoDesde ? "rojo" : dias >= 0 ? "ambar" : "neutro");

function seccion(
  base: Omit<SeccionServicio, "total" | "rojos" | "items">, todos: ItemServicio[], orden: (a: ItemServicio, b: ItemServicio) => number,
): SeccionServicio {
  const items = [...todos].sort(orden);
  return { ...base, total: items.length, rojos: items.filter((i) => i.tono === "rojo").length, items };
}

/** Lo más viejo (más días) primero, y a igual cantidad por nombre. */
const masViejoPrimero = (a: ItemServicio, b: ItemServicio) => (b.dias ?? -1e9) - (a.dias ?? -1e9) || a.nombre.localeCompare(b.nombre, "es");
/** Lo que está por venir primero (menos días), y lo ya vencido antes de todo. */
const masCercanoPrimero = (a: ItemServicio, b: ItemServicio) => (a.dias ?? 1e9) - (b.dias ?? 1e9) || a.nombre.localeCompare(b.nombre, "es");

/** «hoy», «hace 10 d» o «en 5 d»: lo corto que va a la derecha de cada fila. */
export const cuandoEs = (dias: number): string => (dias === 0 ? "hoy" : dias > 0 ? `hace ${dias} d` : `en ${-dias} d`);

/** Los datos de contacto de una fila de Clientes, para escribirle sin abrir la ficha. */
const contactoDe = (c: { telefono: string; email: string; pais: string; programas: string[] }) => ({
  telefono: c.telefono || undefined, email: c.email || undefined, pais: c.pais || undefined, programa: c.programas.join(" · ") || undefined,
});

export function panelDeServicio(e: EstadoApp, hoy: string, ahora: Date = new Date()): PanelDeServicio {
  const clientes = filasClientes(e, hoy);
  const figuranActivos = clientes.filter((c) => c.alumno.estado === "activo");
  /* En la app siguen «activos» pero en el Follow Up de Lili ya cerraron: el estado se deja como está y lo actualiza ella. */
  const enOutboarding = figuranActivos.filter((c) => terminoElServicio(c.followUp)).length;
  const activosTodos = figuranActivos.filter((c) => !terminoElServicio(c.followUp));
  /* Los que figuran activos pero terminaron hace mucho (casi todos, histórico cargado del Airtable) no son trabajo de hoy. */
  const vencidoHaceMucho = (c: (typeof activosTodos)[number]) => {
    /* Sin fecha de fin ni duración se cuenta lo normal del programa (3 meses): así el que empezó hace un año y quedó «activo» por no tener el dato no llena el panel. */
    const fin = c.egreso ?? (c.inicio ? sumarMeses(c.inicio, DURACION_POR_DEFECTO) : null);
    return fin !== null && diasEntre(hoy, fin) < -DIAS_DE_GRACIA;
  };
  const activos = activosTodos.filter((c) => !vencidoHaceMucho(c));
  const desactualizados = activosTodos.length - activos.length;

  /* ---------- Arrancan o retoman (demora de inicio y pausas, lib/pausas.ts) ----------
     El día en que termina la demora o la pausa hay que hablarle para que arranque: aparece unos días antes y queda hasta
     que alguien lo contacta (o pasa una semana). Mientras está en pausa no le toca el contacto de seguimiento. */
  const vuelve = new Map<ID, { tipo: "demora" | "pausa"; hasta: string; dias: number }>();
  for (const c of activos) {
    for (const p of c.seg.pausas ?? []) {
      const d = diasEntre(p.hasta, hoy);
      if (d < -DIAS_ANTES_DE_RETOMAR || d > 7) continue;
      if (c.ultimoContacto && c.ultimoContacto >= p.hasta) continue;
      vuelve.set(c.id, { tipo: p.tipo, hasta: p.hasta, dias: diasDe(p) });
    }
  }
  const vuelven = activos.filter((c) => vuelve.has(c.id)).map((c): ItemServicio => {
    const v = vuelve.get(c.id)!;
    const d = diasEntre(v.hasta, hoy);
    const cuando = d === 0 ? "hoy" : d < 0 ? `el ${formatoDia(v.hasta, hoy)}` : `desde el ${formatoDia(v.hasta, hoy)}`;
    return {
      clave: c.id, alumnoId: c.id, nombre: c.nombre, dias: d, cuando: cuandoEs(d), ...contactoDe(c),
      detalle: v.tipo === "demora" ? `Arranca ${cuando} (demora de inicio de ${v.dias} días)` : `Retoma ${cuando} después de ${v.dias} días de pausa`,
      tono: d >= 3 ? "rojo" : d >= 0 ? "ambar" : "neutro",
    };
  });

  /* ---------- A contactar hoy ---------- */
  const contactar = activos.filter((c) => (c.situacion === "vencido" || c.situacion === "hoy") && !vuelve.has(c.id)).map((c): ItemServicio => ({
    clave: c.id, alumnoId: c.id, nombre: c.nombre, dias: c.atraso, cuando: cuandoEs(c.atraso), ...contactoDe(c),
    detalle: `${c.ultimoContacto ? `Último contacto el ${formatoDia(c.ultimoContacto, hoy)}` : "Sin contacto registrado"}${c.intentos > 0 ? ` · ${c.intentos} ${c.intentos === 1 ? "intento" : "intentos"} sin respuesta` : ""}`,
    tono: tonoPorDias(c.atraso, 7),
  }));

  /* ---------- Nuevos sin el primer contacto ---------- */
  const nuevos = activos.filter((c) => c.inicio && !c.contactoInicial && diasEntre(c.inicio, hoy) >= 0 && diasEntre(c.inicio, hoy) <= DIAS_NUEVO)
    .map((c): ItemServicio => {
      const d = diasEntre(c.inicio, hoy);
      return {
        clave: c.id, alumnoId: c.id, nombre: c.nombre, dias: d, cuando: cuandoEs(d), ...contactoDe(c),
        detalle: `Entró el ${formatoDia(c.inicio, hoy)}${c.plan ? ` · ${c.plan}` : ""} · falta el primer contacto`,
        tono: d >= 3 ? "rojo" : "ambar",
      };
    });

  /* ---------- El contrato por vencer (renovar o dar de baja) ---------- */
  const renovar = activos.filter((c) => c.egreso && diasEntre(hoy, c.egreso) <= DIAS_PARA_RENOVAR).map((c): ItemServicio => {
    const quedan = diasEntre(hoy, c.egreso as string);
    return {
      clave: c.id, alumnoId: c.id, nombre: c.nombre, ...contactoDe(c),
      /* Para ordenar: lo ya vencido arriba. */
      dias: quedan, cuando: cuandoEs(-quedan),
      detalle: quedan < 0 ? `Terminó el ${formatoDia(c.egreso, hoy)} y sigue activo: ¿renueva o baja?` : `Termina el ${formatoDia(c.egreso, hoy)}: hay que hablar para renovar`,
      tono: quedan < 0 ? "rojo" : quedan <= 7 ? "ambar" : "neutro",
    };
  });

  /* ---------- Resells ---------- */
  const resells = filasResells(e);
  const ahoraMs = ahora.getTime();
  const sinCierre: ItemServicio[] = resells
    .filter((f) => !f.resell.cancelada && new Date(f.resell.fechaHora).getTime() <= ahoraMs && !resellResuelto(f.resell.estado))
    .map((f): ItemServicio => {
      const d = diasEntre(f.dia, hoy);
      const cliente = f.alumno ? clientes.find((c) => c.id === f.alumno?.id) : undefined;
      return {
        clave: f.id, alumnoId: f.alumno?.id, nombre: f.resell.nombre || f.alumno?.nombre || f.resell.email || "Sin nombre", dias: d, cuando: cuandoEs(d),
        ...(cliente ? contactoDe(cliente) : {}),
        telefono: cliente?.telefono || f.resell.telefono || undefined, email: cliente?.email || f.resell.email || undefined,
        detalle: `Llamada del ${formatoDia(f.dia, hoy)}${f.resell.closer ? ` con ${f.resell.closer}` : ""} · el closer no dijo en qué quedó`,
        tono: d >= DIAS_PARA_CERRAR_RESELL ? "rojo" : "ambar",
      };
    });

  /* ---------- Testimonios ---------- */
  const filasTes = filasTestimonios(e, clientes);
  const porAgendar: ItemServicio[] = [];
  const sinLink: ItemServicio[] = [];
  for (const f of filasTes) {
    const t = f.testimonio;
    const nombre = f.nombre || "Alumno sin ficha";
    const noQuiere = sinTildes(t.followUp) === "no quiere grabar" || sinTildes(t.estadoVideo) === "no quiso grabar";
    if (noQuiere) continue;
    const grabado = Boolean(t.fechaGrabacion) && String(t.fechaGrabacion) <= hoy;
    if (grabado && !t.link.trim()) {
      const d = diasEntre(String(t.fechaGrabacion), hoy);
      sinLink.push({
        clave: `${t.id}:link`, alumnoId: f.cliente?.id, nombre, dias: d, cuando: cuandoEs(d), ...(f.cliente ? contactoDe(f.cliente) : {}),
        detalle: `Grabó el ${formatoDia(String(t.fechaGrabacion), hoy)}${t.conQuien ? ` con ${t.conQuien}` : ""} · falta el link del video${t.estadoVideo ? ` (${t.estadoVideo.toLowerCase()})` : ""}`,
        tono: d >= DIAS_PARA_CERRAR_RESELL ? "rojo" : "ambar",
      });
    } else if (!t.fechaGrabacion && ["no agendada", "pendiente de agendar", ""].includes(sinTildes(t.followUp))) {
      const d = f.cliente ? diasEntre(f.cliente.inicio || hoy, hoy) : 0;
      porAgendar.push({
        clave: `${t.id}:agendar`, alumnoId: f.cliente?.id, nombre, dias: d, cuando: "sin agendar", ...(f.cliente ? contactoDe(f.cliente) : {}),
        detalle: "Falta agendar la llamada de grabación", tono: "ambar",
      });
    }
  }

  /* ---------- Reportes semanales ---------- */
  const reportes = activos.filter((c) => c.reporte.estado === "Inactivo" && !c.pausa).map((c): ItemServicio => ({
    clave: c.id, alumnoId: c.id, nombre: c.nombre, dias: c.reporte.semanasSin, ...contactoDe(c),
    cuando: c.reporte.semanasSin ? `${c.reporte.semanasSin} sem` : "inactivo",
    detalle: c.reporte.semanasSin ? `${c.reporte.semanasSin} ${c.reporte.semanasSin === 1 ? "semana" : "semanas"} sin mandar el reporte` : "Marcado como inactivo en su reporte",
    tono: "rojo",
  }));

  /* ---------- Contratos sin firmar ---------- */
  const contratos = activos.filter((c) => c.contrato !== "Firmado" && c.inicio && diasEntre(c.inicio, hoy) >= DIAS_PARA_FIRMAR).map((c): ItemServicio => {
    const d = diasEntre(c.inicio, hoy);
    return {
      clave: c.id, alumnoId: c.id, nombre: c.nombre, dias: d, cuando: cuandoEs(d), ...contactoDe(c),
      detalle: `Empezó el ${formatoDia(c.inicio, hoy)} · falta firmar el contrato${c.estadoContrato ? ` (${c.estadoContrato.toLowerCase()})` : ""}`,
      tono: d >= 14 ? "rojo" : "ambar",
    };
  });

  const secciones: SeccionServicio[] = [
    seccion({ id: "contactar", titulo: "A contactar hoy", corto: "Contactar", regla: "Su próximo contacto de seguimiento ya venció o toca hoy.", vacio: "Nadie para contactar hoy. La lista se llena a medida que vencen los días de cada alumno.", verTodos: { texto: "Ver la lista completa", href: "/alumnos?seccion=hoy" } }, contactar, masViejoPrimero),
    seccion({ id: "vuelven", titulo: "Arrancan o retoman", corto: "Retoman", regla: "Termina su demora de inicio o su pausa: hablale para que arranque.", vacio: "Nadie termina una pausa ni una demora de inicio en estos días.", verTodos: { texto: "Ver Clientes del programa", href: "/alumnos?seccion=clientes" } }, vuelven, masViejoPrimero),
    seccion({ id: "nuevos", titulo: "Alumnos nuevos", corto: "Nuevos", vacio: "No entró nadie nuevo sin su primer contacto.", regla: `Entraron en los últimos ${DIAS_NUEVO} días y todavía no tienen el primer contacto.`, verTodos: { texto: "Ver Clientes del programa", href: "/alumnos?seccion=clientes" } }, nuevos, masViejoPrimero),
    seccion({ id: "renovar", titulo: "Se les termina el contrato", corto: "Renovar", vacio: "Ningún contrato por vencer en los próximos 30 días.", regla: `Les quedan ${DIAS_PARA_RENOVAR} días o menos (o ya terminó y siguen activos): renovar o dar de baja.`, verTodos: { texto: "Ver Clientes del programa", href: "/alumnos?seccion=clientes" } }, renovar, masCercanoPrimero),
    seccion({ id: "resells", titulo: "Resells sin cierre", corto: "Resells", vacio: "Todos los resells ya tienen su resultado.", regla: `La llamada ya pasó y el closer no dijo en qué quedó. A los ${DIAS_PARA_CERRAR_RESELL} días queda en rojo.`, verTodos: { texto: "Ver la agenda de resells", href: "/alumnos?seccion=resells" } }, sinCierre, masViejoPrimero),
    seccion({ id: "testimonios", titulo: "Testimonios", corto: "Testimonios", vacio: "No hay testimonios pendientes.", regla: "Grabaron y falta el link del video, o falta agendar la llamada de grabación.", verTodos: { texto: "Ver testimonios", href: "/alumnos?seccion=testimonios" } }, [...sinLink, ...porAgendar], masViejoPrimero),
    seccion({ id: "reportes", titulo: "Dejaron de reportar", corto: "Reportes", vacio: "Todos al día con su reporte semanal.", regla: "Tres semanas o más sin mandar el reporte semanal.", verTodos: { texto: "Ver los formularios", href: "/reportes" } }, reportes, masViejoPrimero),
    seccion({ id: "contratos", titulo: "Contrato sin firmar", corto: "Contratos", vacio: "Todos los contratos están firmados.", regla: `Empezaron hace ${DIAS_PARA_FIRMAR} días o más y el contrato sigue sin firmar.`, verTodos: { texto: "Ver Clientes del programa", href: "/alumnos?seccion=clientes" } }, contratos, masViejoPrimero),
  ];

  /* La revisión de CV y LinkedIn, para que Lili sepa en qué anda Aldana sin preguntarle. */
  const cvs = e.revisionesCv ?? [];
  const abiertos = cvs.filter((r) => ["en proceso", "esperando cliente", "segunda ronda", "con yari"].includes(sinTildes(r.estado)));
  const porEstado = new Map<string, number>();
  for (const r of abiertos) porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1);

  const urgentes = secciones.reduce((n, s) => n + s.rojos, 0);
  /* ---------- La cartera y los números ---------- */
  const enServicio = new Set(activos.map((c) => c.id));
  const cartera = clientes.map((c): FilaCartera => ({
    id: c.id, nombre: c.nombre, programa: c.programas.join(" · "), followUp: c.followUp, etapa: etapaDelFollowUp(c.followUp),
    estadoAlumno: c.estadoAlumno, enServicio: enServicio.has(c.id), inicio: c.inicio, egreso: c.egreso, ultimoContacto: c.ultimoContacto,
    proximo: c.situacion === "fuera" ? "" : c.proximo, atraso: c.atraso, reporte: c.reporte.estado, telefono: c.telefono, email: c.email, pais: c.pais,
  }));
  const conReporte = activos.filter((c) => c.reporte.estado !== "Sin datos");
  const mes = hoy.slice(0, 7);
  const numeros: NumerosDeServicio = {
    enServicio: activos.length,
    reportando: { si: conReporte.filter((c) => c.reporte.estado !== "Inactivo").length, de: conReporte.length },
    contactados30: { si: activos.filter((c) => c.ultimoContacto && diasEntre(c.ultimoContacto, hoy) <= 30).length, de: activos.length },
    casosDeExito: clientes.filter((c) => etapaDelFollowUp(c.followUp) === "exito").length,
    testimoniosConVideo: (e.testimonios ?? []).filter((t) => String((t as { link?: string }).link ?? "").trim()).length,
    renovacionesMes: resells.filter((f) => f.dia.startsWith(mes) && estadosDeResell(f.resell.estado).some((x) => /renueva|upgrade/.test(sinTildes(x)) && !/no renueva|no quiere/.test(sinTildes(x)))).length,
  };

  return {
    hoy, activos: activos.length, enOutboarding, desactualizados, secciones, urgentes, cartera, numeros,
    cvs: { enCurso: abiertos.length, porEstado: [...porEstado].map(([estado, n]) => ({ estado, n })).sort((a, b) => b.n - a.n), sinAlumno: cvs.filter((r) => !r.alumnoId).length },
  };
}

/* ---------- La Cartera como tabla ----------
   Con el mismo armazón que Clientes, Testimonios, Resells y CVs (components/cs/TablaCs): cada título filtra como un Excel y
   ordena, la tabla corre adentro de su tarjeta con el encabezado fijo y va de a 50 por hoja, las columnas se eligen y todo viaja
   en el link (Juan Cruz, 21/10: «que tenga deslizante y hojas, igual que todas las otras tablas»). Un renglón es un alumno de la
   cartera o, con una lista de «Para hoy» elegida, una tarea de esa lista (con qué pasa y cuándo). */
export interface RenglonCartera {
  id: string;
  /* El alumno, para abrir su ficha. Un resell cuyo mail no es de un alumno no lo tiene. */
  alumnoId?: ID;
  nombre: string;
  programa: string;
  fila?: FilaCartera;
  item?: ItemServicio;
}

export type ClaveCartera =
  | "nombre" | "programa" | "detalle" | "cuando" | "followUp" | "etapa" | "estado" | "inicio" | "egreso" | "ultimoContacto" | "proximo"
  | "reporte" | "telefono" | "email";

const etapaDe = (r: RenglonCartera) => ETAPAS_DEL_ALUMNO.find((x) => x.id === r.fila?.etapa);

export const COLUMNAS_CARTERA: ColumnaCs<RenglonCartera, ClaveCartera>[] = [
  { clave: "nombre", titulo: "Alumno", grupo: "Alumno", valores: (r) => uno(r.nombre), orden: (r) => sinTildes(r.nombre), ancho: 240 },
  { clave: "programa", titulo: "Programa", grupo: "Alumno", valores: (r) => varios(r.programa.split(" · ").filter(Boolean)), ancho: 150 },
  { clave: "detalle", titulo: "Qué pasa", grupo: "Para hoy", ayuda: "Lo que lo trajo a la lista de «Para hoy»", valores: (r) => uno(r.item?.detalle), ancho: 340 },
  { clave: "cuando", titulo: "Cuándo", grupo: "Para hoy", valores: (r) => uno(r.item?.cuando), orden: (r) => r.item?.dias ?? "", numerica: true, ancho: 110 },
  { clave: "followUp", titulo: "Follow up", grupo: "Seguimiento", valores: (r) => uno(r.fila?.followUp),
    orden: (r) => `${String(ETAPAS_DEL_ALUMNO.findIndex((x) => x.id === r.fila?.etapa)).padStart(2, "0")} ${sinTildes(r.fila?.followUp || "~")}`, ancho: 170 },
  { clave: "etapa", titulo: "Etapa", grupo: "Seguimiento", ayuda: "La etapa del recorrido, según su Follow Up", valores: (r) => uno(etapaDe(r)?.label), ancho: 140 },
  { clave: "estado", titulo: "Estado del alumno", grupo: "Seguimiento", valores: (r) => uno(r.fila?.estadoAlumno), ancho: 140 },
  { clave: "inicio", titulo: "Inicio", grupo: "Fechas", valores: (r) => uno(r.fila?.inicio), fecha: true, ancho: 100 },
  { clave: "egreso", titulo: "Vence", grupo: "Fechas", valores: (r) => uno(r.fila?.egreso), fecha: true, ancho: 104 },
  { clave: "ultimoContacto", titulo: "Último contacto", grupo: "Fechas", valores: (r) => uno(r.fila?.ultimoContacto), fecha: true, ancho: 130 },
  { clave: "proximo", titulo: "Próximo", grupo: "Fechas", ayuda: "Cuándo le toca el próximo contacto de seguimiento", valores: (r) => uno(r.fila?.proximo), fecha: true, ancho: 104 },
  { clave: "reporte", titulo: "Reporte", grupo: "Seguimiento", valores: (r) => uno(r.fila?.reporte), ancho: 130 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Contacto", valores: (r) => uno(r.fila?.telefono || r.item?.telefono), ancho: 190 },
  { clave: "email", titulo: "Mail", grupo: "Contacto", valores: (r) => uno(r.fila?.email || r.item?.email), ancho: 220 },
];

export const MOTOR_CARTERA = crearMotor(COLUMNAS_CARTERA, "car");
export const VISIBLES_CARTERA: ClaveCartera[] = ["nombre", "programa", "followUp", "inicio", "egreso", "ultimoContacto", "proximo", "telefono"];
export const VISIBLES_LISTA: ClaveCartera[] = ["nombre", "programa", "detalle", "cuando", "telefono"];
/* Sin orden elegido: la cartera por fecha de ingreso, del más nuevo al más viejo (Lili, 22/10); una lista, en el suyo (lo más
   atrasado primero). */
export const ORDEN_CARTERA: OrdenCs<ClaveCartera>[] = [{ clave: "inicio", desc: true }, { clave: "nombre", desc: false }];
export const ORDEN_LISTA: OrdenCs<ClaveCartera>[] = [];
export const ORDEN_ETAPAS_CARTERA = { etapa: ETAPAS_DEL_ALUMNO.map((x) => x.label) };

export function coincideCartera(r: RenglonCartera, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [r.nombre, r.programa, r.fila?.followUp, r.fila?.telefono, r.fila?.email, r.item?.detalle, r.item?.telefono, r.item?.email]
    .some((x) => sinTildes(x ?? "").includes(t));
}

/** Los renglones de la cartera: los de la lista elegida o los alumnos de la base (en servicio o todos), de una etapa si se eligió. */
export function renglonesCartera(cartera: readonly FilaCartera[], lista?: SeccionServicio, etapa?: EtapaAlumnoId): RenglonCartera[] {
  if (lista) {
    const porId = new Map(cartera.map((f) => [f.id, f] as const));
    return lista.items.map((i) => {
      const fila = i.alumnoId ? porId.get(i.alumnoId) : undefined;
      return { id: i.clave, alumnoId: i.alumnoId, nombre: i.nombre, programa: fila?.programa || i.programa || "", fila, item: i };
    });
  }
  return cartera.filter((f) => !etapa || f.etapa === etapa).map((f) => ({ id: f.id, alumnoId: f.id, nombre: f.nombre, programa: f.programa, fila: f }));
}
