import { claveEmail } from "./contactos";
import { personaDeVenta, etapaInicialDeServicio, planDeVenta } from "./alumnos";
import { diaDeNegocio } from "./dia-negocio";
import { leerFecha } from "./registros-webinar";
import { lunesDe } from "./reportes";
import { sinTildes } from "./crm";
import {
  aNumero, ENTRE, listasCs, programasDeTexto, resellNormal, seguimientoCompleto, sumarMeses, testimonioNormal, valorDeLista, CONTRATOS,
} from "./clientes-cs";
import { configSeguimiento } from "./seguimiento";
import type { Alumno, EstadoApp, ID, Reporte, Resell, SeguimientoAlumno, Testimonio } from "./types";

/* ==================================================================
   Importar el Airtable de Customer Success.

   Lili lleva hoy tres tablas en su Airtable (Clientes, Testimonios y Agenda
   de resells) y los reportes semanales de los alumnos. Se bajan como CSV o
   Excel y esto las pasa a la app: detecta de qué tabla es cada hoja por sus
   encabezados, adivina qué columna es cada dato (se puede corregir), y arma
   el plan —qué entra, qué ya estaba, qué se descarta y por qué— antes de
   escribir nada.

   Reimportar el mismo archivo no duplica: cada fila cae siempre en el mismo
   id (el alumno por su mail, su N.º o su nombre; el testimonio, el resell y
   el reporte por lo que los identifica). Por defecto sólo completa lo que
   está vacío en la app y no pisa lo que el equipo ya cargó; se puede elegir
   que el archivo mande.

   Todo acá es puro (sin React ni base) para poder probarlo.
   ================================================================== */

export type TipoTablaCs = "clientes" | "testimonios" | "resells" | "reportes";

export const NOMBRE_TABLA_CS: Record<TipoTablaCs, string> = {
  clientes: "Clientes", testimonios: "Testimonios", resells: "Agenda de resells", reportes: "Reportes semanales",
};

export interface CampoCs { campo: string; titulo: string; alias: string[]; ayuda?: string }

const c = (campo: string, titulo: string, alias: string[], ayuda?: string): CampoCs => ({ campo, titulo, alias, ayuda });

export const CAMPOS_CLIENTES: CampoCs[] = [
  c("numero", "N.º de alumno", ["n de alumno", "numero de alumno", "nro de alumno", "nro alumno", "numero alumno", "id alumno", "n alumno", "numero"]),
  c("nombre", "Nombre y apellido", ["nombre y apellido", "nombre completo", "apellido y nombre", "alumno", "nombre", "name"], "Obligatorio."),
  c("inicio", "Fecha de inicio", ["fecha de inicio", "fecha inicio", "inicio", "start date"]),
  c("egreso", "Fecha de egreso", ["fecha de egreso", "fecha egreso", "egreso", "fecha de fin", "fin"]),
  c("edad", "Edad", ["edad", "age"]),
  c("stack", "Stack", ["stack"]),
  c("telefono", "Teléfono", ["telefono", "celular", "whatsapp", "phone", "movil", "numero de telefono"]),
  c("dni", "DNI", ["dni", "documento", "documento de identidad"]),
  c("domicilio", "Domicilio", ["domicilio", "direccion", "address"]),
  c("email", "Mail", ["mail", "email", "e-mail", "correo", "correo electronico"], "Con el mail se reconoce al alumno que ya está en la app."),
  c("programa", "Programa", ["programa", "programas", "servicio"]),
  c("plan", "Plan de pago", ["plan de pago", "plan pago", "forma de pago", "plan"]),
  c("duracion", "Duración", ["duracion", "duracion meses", "meses"]),
  c("mentor", "Sesión con el mentor", ["sesion con el mentor", "sesiones con el mentor", "sesion con mentor", "sesiones con mentor", "mentor"]),
  c("comentarios", "Comentarios", ["comentarios", "comentario", "notas", "observaciones"]),
  c("contactoInicial", "Contacto inicial", ["contacto inicial", "primer contacto", "onboarding"]),
  c("contactoSemana", "Contacto semana", ["contacto semana", "contacto de la semana", "contacto 1 semana", "contacto semanal"]),
  c("acceso", "Acceso", ["acceso", "tipo de acceso"]),
  c("followUp", "Follow-up", ["follow up", "follow-up", "followup", "seguimiento"]),
  c("reporte", "Reporte semanal", ["reporte semanal", "reporte", "reportes"]),
  c("ultimoContacto", "Último contacto", ["ultimo contacto", "ultima comunicacion", "ultimo contacto fecha"]),
  c("garantia", "Garantía", ["garantia"]),
  c("wpp", "Acceso WhatsApp", ["acceso whatsapp", "acceso wpp", "grupo whatsapp", "whatsapp acceso"]),
  c("zoom", "Acceso Zoom", ["acceso zoom", "zoom"]),
  c("wibo", "Acceso Wibo", ["acceso wibo", "wibo"]),
  c("contrato", "Contrato firmado", ["contrato firmado", "contrato"]),
  c("pais", "País", ["pais", "country"]),
  c("closer", "Closer", ["closer", "vendedor", "cerrado por"]),
  c("estadoContrato", "Estado del contrato", ["estado del contrato", "estado contrato"]),
  c("cv", "CV", ["cv corregido", "estado del cv", "estado cv", "cv", "curriculum"]),
  c("linkedin", "LinkedIn", ["linkedin corregido", "estado de linkedin", "estado linkedin", "linkedin"]),
  c("responsableCv", "Responsable del CV y LinkedIn", ["responsable del cv y linkedin", "responsable cv", "responsable"]),
];

export const CAMPOS_TESTIMONIOS: CampoCs[] = [
  c("alumno", "Alumno", ["alumno", "nombre y apellido", "nombre completo", "nombre"], "Obligatorio: con el mail, el teléfono o el nombre se busca al alumno."),
  c("email", "Mail", ["mail", "email", "e-mail", "correo"]),
  c("edad", "Edad", ["edad"]),
  c("inicio", "Fecha de inicio", ["fecha de inicio", "fecha inicio", "inicio"]),
  c("telefono", "Teléfono", ["telefono", "celular", "whatsapp"]),
  c("followUp", "Follow-up", ["follow up", "follow-up", "followup"]),
  c("fechaGrabacion", "Fecha de grabación", ["fecha de grabacion", "fecha grabacion", "grabacion", "fecha"]),
  c("conQuien", "Con quién grabó", ["con quien grabo", "con quien", "grabo con", "entrevistador"]),
  c("resell", "Resell", ["resell"]),
  c("estadoVideo", "Estado del video", ["estado del video", "estado video", "video", "estado"]),
  c("link", "Link del video", ["link del video", "link video", "link", "url"]),
  c("tecnologias", "Tecnologías", ["tecnologias", "tecnologia"]),
  c("stack", "Stack", ["stack"]),
  c("situacionPrevia", "Situación previa", ["situacion previa", "antes"]),
  c("situacionActual", "Situación actual", ["situacion actual", "ahora"]),
  c("notas", "Notas", ["notas", "comentarios", "observaciones"]),
  c("pais", "País", ["pais"]),
];

export const CAMPOS_RESELLS: CampoCs[] = [
  c("fechaHora", "Fecha y hora de agenda", ["fecha y hora de agenda", "fecha y hora", "fecha de agenda", "agenda", "fecha"], "Obligatoria."),
  c("nombre", "Nombre completo", ["nombre completo", "nombre y apellido", "nombre", "alumno"]),
  c("email", "Mail", ["mail", "email", "e-mail", "correo"]),
  c("telefono", "Teléfono", ["telefono", "celular", "whatsapp"]),
  c("closer", "Closer", ["closer", "anfitrion", "host"]),
  c("estado", "Estado", ["estado"]),
  c("cash", "Cash Collect", ["cash collect", "cash collected", "cash", "monto cobrado", "cobrado"]),
  c("caso", "Caso de éxito", ["caso de exito", "caso exito", "caso"]),
  c("notas", "Notas", ["notas", "comentarios", "observaciones"]),
];

export const CAMPOS_REPORTES: CampoCs[] = [
  c("email", "Mail", ["mail", "email", "e-mail", "correo"]),
  c("alumno", "Alumno", ["alumno", "nombre y apellido", "nombre completo", "nombre"]),
  c("semana", "Semana", ["semana", "semana del", "fecha", "fecha del reporte", "created time", "marca temporal", "timestamp"], "Obligatoria: el día de la semana que se reporta."),
  c("horas", "Horas de estudio", ["horas de estudio", "horas estudiadas", "horas"]),
  c("entrevistas", "Entrevistas", ["entrevistas"]),
  c("postulaciones", "Postulaciones", ["postulaciones", "aplicaciones"]),
  c("bloqueo", "Bloqueo", ["bloqueo", "bloqueos", "comentarios", "notas"]),
];

export const CAMPOS_DE: Record<TipoTablaCs, CampoCs[]> = {
  clientes: CAMPOS_CLIENTES, testimonios: CAMPOS_TESTIMONIOS, resells: CAMPOS_RESELLS, reportes: CAMPOS_REPORTES,
};

/* ---------- Encabezados ---------- */

const sinAcentos = (s: string) => sinTildes(s).replace(/[^a-z0-9_ ]+/g, " ").replace(/\s+/g, " ").trim();

export type MapeoCs = Record<string, number | undefined>;

/** Qué columna de la hoja es cada dato, por el nombre del encabezado: primero los nombres exactos, después los que contienen el alias. */
export function adivinarMapeoCs(campos: readonly CampoCs[], encabezados: readonly string[]): MapeoCs {
  const heads = encabezados.map(sinAcentos);
  const usadas = new Set<number>();
  const mapeo: MapeoCs = {};
  for (const exacto of [true, false]) {
    for (const { campo, alias } of campos) {
      if (mapeo[campo] !== undefined) continue;
      for (const a of alias.map(sinAcentos)) {
        const i = heads.findIndex((h, j) => !usadas.has(j) && h !== "" && (exacto ? h === a : h.includes(a) && a.length >= 6));
        if (i >= 0) { mapeo[campo] = i; usadas.add(i); break; }
      }
    }
  }
  return mapeo;
}

/** De qué tabla de Customer Success es una hoja, por sus encabezados (y por su nombre si empata). */
export function detectarTipo(encabezados: readonly string[], nombre = ""): { tipo: TipoTablaCs | null; puntos: Record<TipoTablaCs, number> } {
  const puntos = { clientes: 0, testimonios: 0, resells: 0, reportes: 0 } as Record<TipoTablaCs, number>;
  for (const t of Object.keys(CAMPOS_DE) as TipoTablaCs[]) {
    puntos[t] = Object.values(adivinarMapeoCs(CAMPOS_DE[t], encabezados)).filter((v) => v !== undefined).length;
  }
  /* El nombre de la hoja desempata: «Testimonios», «Agenda de resells», «Clientes», «Results»/«Reportes». */
  const n = sinAcentos(nombre);
  if (/testimon/.test(n)) puntos.testimonios += 2;
  if (/resell/.test(n)) puntos.resells += 2;
  if (/cliente|alumno/.test(n)) puntos.clientes += 2;
  if (/report|result/.test(n)) puntos.reportes += 2;
  const orden = (Object.keys(puntos) as TipoTablaCs[]).sort((a, b) => puntos[b] - puntos[a]);
  const mejor = orden[0];
  return { tipo: puntos[mejor] >= 3 && puntos[mejor] > puntos[orden[1]] ? mejor : null, puntos };
}

/** Los encabezados de una hoja: la primera fila con al menos tres celdas con texto (Airtable y Excel a veces dejan renglones arriba). */
export function filaDeEncabezados(filas: readonly (readonly string[])[]): number {
  const i = filas.findIndex((f) => f.filter((x) => x.trim()).length >= 3);
  return i < 0 ? 0 : i;
}

/* ---------- Valores ---------- */

/** Dos objetos con lo mismo, sin importar el orden de las claves. */
const mismoObjeto = (a: object, b: object): boolean => {
  const orden = (o: object) => JSON.stringify(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  return orden(a) === orden(b);
};

const hashCorto = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const SI_TEXTO = /^(si|s|yes|y|true|1|x|ok|tiene|con acceso|firmado|corregido|hecho|listo|completo|completado|activo)$/;
const NO_TEXTO = /^(no|n|false|0|pendiente|sin acceso|falta|sin firmar|incompleto)$/;

/** «Sí», «x», «Tiene»… como verdadero; vacío, «No», «Pendiente»… como falso. null si no se entiende. */
export function leerSiNo(texto: string): boolean | null {
  const t = sinAcentos(texto);
  if (!t) return false;
  if (SI_TEXTO.test(t)) return true;
  if (NO_TEXTO.test(t)) return false;
  return null;
}

/** Un monto escrito de cualquier forma: «US$ 1.200,50», «$1,200.50», «1200». */
export function leerMontoCs(texto: string): number | null {
  let t = texto.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const punto = t.lastIndexOf("."), coma = t.lastIndexOf(",");
  if (punto >= 0 && coma >= 0) {
    t = punto > coma ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
  } else if (coma >= 0 || punto >= 0) {
    const sep = coma >= 0 ? "," : ".";
    const partes = t.split(sep);
    const ultima = partes[partes.length - 1];
    /* «1.200» o «1,200,000»: miles; «1,5» o «12.50»: decimales. */
    t = partes.length > 2 || (ultima.length === 3 && partes[0].replace("-", "").length <= 3 && partes[0] !== "0")
      ? partes.join("") : `${partes.slice(0, -1).join("")}.${ultima}`;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Una fecha con hora, de un Airtable (ISO con zona) o de un Excel («12/9/2026 15:30»): el instante, tomando la hora de Argentina si no dice otra. */
export function leerFechaHora(texto: string, anio = new Date().getFullYear()): string | null {
  const t = texto.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    const d = new Date(t.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}-03:00`);
    return Number.isNaN(+d) ? null : d.toISOString();
  }
  const dia = leerFecha(t, anio);
  if (!dia) return null;
  const hm = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i.exec(t);
  let h = hm ? Number(hm[1]) : 12;
  const m = hm ? Number(hm[2]) : 0;
  const ampm = hm?.[3]?.toLowerCase().replace(/[^ap]/g, "");
  if (ampm === "p" && h < 12) h += 12;
  if (ampm === "a" && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  const d = new Date(`${dia}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`);
  return Number.isNaN(+d) ? null : d.toISOString();
}

const digitos = (s: string) => s.replace(/\D/g, "");
/** Para comparar teléfonos: los últimos 9 dígitos (sin país ni el 9 de los celulares de Argentina). */
const claveTelefono = (s: string) => { const d = digitos(s); return d.length >= 8 ? d.slice(-9) : ""; };

/* ---------- Lo que entra ---------- */

export interface TablaImport {
  nombre: string;
  tipo: TipoTablaCs;
  /* Los encabezados y las filas de datos, tal cual vinieron. */
  encabezados: string[];
  filas: string[][];
  mapeo: MapeoCs;
}

export interface OpcionesImport {
  /* «completar»: sólo lo que está vacío en la app. «pisar»: lo del archivo manda. */
  modo: "completar" | "pisar";
  /* Un testimonio, un reporte o una agenda de un alumno que no está: crear al alumno (egresado) en vez de descartarlo. */
  crearFaltantes: boolean;
  hoy: string;
  /* Cuándo se importa (para las marcas de actualización). */
  ahora: string;
  quien: string;
}

export interface Descartada { tabla: TipoTablaCs; fila: number; motivo: string }

export interface PlanImportCs {
  porTabla: Record<TipoTablaCs, { filas: number; nuevas: number; actualizadas: number; iguales: number; descartadas: number }>;
  alumnos: Alumno[];
  seguimientos: SeguimientoAlumno[];
  testimonios: Testimonio[];
  resells: Resell[];
  reportes: Reporte[];
  /* Cosas a mirar que no impiden importar (un N.º repetido, un alumno elegido por el nombre). */
  avisos: string[];
  descartadas: Descartada[];
  /* Alumnos que se crearon sólo porque otra tabla los nombra. */
  alumnosCreadosPorOtraTabla: number;
}

const vacio = () => ({ filas: 0, nuevas: 0, actualizadas: 0, iguales: 0, descartadas: 0 });

/** Un valor de una fila según el mapeo, sin espacios. */
function valorDe(fila: readonly string[], mapeo: MapeoCs, campo: string): string {
  const i = mapeo[campo];
  return i === undefined ? "" : (fila[i] ?? "").trim();
}

export function planificarImportacionCs(e: EstadoApp, tablas: readonly TablaImport[], op: OpcionesImport): PlanImportCs {
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const listas = listasCs(e.ajustes.seguimiento);
  const plan: PlanImportCs = {
    porTabla: { clientes: vacio(), testimonios: vacio(), resells: vacio(), reportes: vacio() },
    alumnos: [], seguimientos: [], testimonios: [], resells: [], reportes: [], avisos: [], descartadas: [], alumnosCreadosPorOtraTabla: 0,
  };
  const descartar = (tabla: TipoTablaCs, fila: number, motivo: string) => {
    plan.descartadas.push({ tabla, fila, motivo });
    plan.porTabla[tabla].descartadas++;
  };

  /* Lo que ya hay y lo que va entrando, por si el archivo repite a alguien o una tabla nombra a quien otra trajo. */
  const alumnos = new Map<ID, Alumno>(e.alumnos.map((a) => [a.id, a]));
  const segs = new Map<ID, SeguimientoAlumno>((e.seguimientos ?? []).map((s) => [s.alumnoId, seguimientoCompleto(s, cfg)]));
  const nuevosAlumnos = new Set<ID>();
  const tocados = new Set<ID>();
  const tocadosSeg = new Set<ID>();
  const porMail = new Map<string, ID>();
  const porTelefono = new Map<string, ID[]>();
  const porNombre = new Map<string, ID[]>();
  const numeros = new Map<number, ID>();
  const indexar = (a: Alumno, s?: SeguimientoAlumno) => {
    const k = claveEmail(a.email);
    if (k && !porMail.has(k)) porMail.set(k, a.id);
    const n = sinAcentos(a.nombre);
    if (n) porNombre.set(n, [...(porNombre.get(n) ?? []).filter((x) => x !== a.id), a.id]);
    const t = claveTelefono(s?.telefono ?? "");
    if (t) porTelefono.set(t, [...(porTelefono.get(t) ?? []).filter((x) => x !== a.id), a.id]);
    if (s?.numero != null) numeros.set(s.numero, a.id);
  };
  for (const a of e.alumnos) indexar(a, segs.get(a.id));
  /* El teléfono de la persona también sirve para reconocerla. */
  const telDeContacto = new Map<string, string>();
  for (const ct of e.contactos) if (claveEmail(ct.email) && ct.telefono) telDeContacto.set(claveEmail(ct.email), ct.telefono);
  for (const a of e.alumnos) {
    const t = claveTelefono(telDeContacto.get(claveEmail(a.email)) ?? "");
    if (t) porTelefono.set(t, [...(porTelefono.get(t) ?? []).filter((x) => x !== a.id), a.id]);
  }
  let proximoNumero = Math.max(0, ...[...numeros.keys()]) + 1;

  const guardarAlumno = (a: Alumno, nuevo: boolean) => {
    alumnos.set(a.id, a);
    tocados.add(a.id);
    if (nuevo) nuevosAlumnos.add(a.id);
  };
  const guardarSeg = (s: SeguimientoAlumno) => { segs.set(s.alumnoId, s); tocadosSeg.add(s.alumnoId); };

  /* ¿De qué alumno es esta fila? Por mail; si no, por N.º o por teléfono (si la fila no trae mail o el nombre es el mismo); y sólo si
     nada de eso hay, por un nombre que sea de uno solo. */
  function buscarAlumno(d: { email: string; numero: number | null; telefono: string; nombre: string }): { id?: ID; por?: string; ambiguo?: boolean; mailDistinto?: boolean } {
    const k = claveEmail(d.email);
    if (k && porMail.has(k)) return { id: porMail.get(k), por: "mail" };
    const mismoNombre = (id: ID) => sinAcentos(alumnos.get(id)?.nombre ?? "") === sinAcentos(d.nombre);
    if (d.numero !== null && numeros.has(d.numero)) {
      const id = numeros.get(d.numero)!;
      if (!k || mismoNombre(id)) return { id, por: "N.º", mailDistinto: Boolean(k) };
    }
    const t = claveTelefono(d.telefono);
    if (t && (porTelefono.get(t)?.length ?? 0) === 1) {
      const id = porTelefono.get(t)![0];
      if (!k || mismoNombre(id)) return { id, por: "teléfono", mailDistinto: Boolean(k) };
    }
    if (!k) {
      const n = sinAcentos(d.nombre);
      const ids = n ? porNombre.get(n) ?? [] : [];
      if (ids.length === 1) return { id: ids[0], por: "nombre" };
      if (ids.length > 1) return { ambiguo: true };
    }
    return {};
  }

  /* El alumno que falta, creado con lo poco que se sabe (egresado: viene de un testimonio, un reporte o una agenda). */
  function crearAlumno(d: { nombre: string; email: string; telefono: string; pais: string; inicio: string; numero?: number | null }, estado: Alumno["estado"], clave: string): Alumno {
    const k = claveEmail(d.email);
    const lead = k ? e.leads.find((l) => claveEmail(l.email) === k) : undefined;
    const contacto = k ? e.contactos.find((ct) => claveEmail(ct.email) === k) : undefined;
    const id = `alu_cs_${hashCorto(k || clave || sinAcentos(d.nombre))}`;
    const a: Alumno = {
      id, nombre: d.nombre, email: d.email, pais: d.pais || undefined, cohorte: "", plan: "", cuotaMensual: 0, moneda: "USD",
      estado, inicio: d.inicio || op.hoy, progreso: 0, leadId: lead?.id ?? contacto?.id, notas: "", creadoEn: op.ahora, extra: {},
      etapaServicioId: etapaInicialDeServicio(e),
    };
    guardarAlumno(a, true);
    const s = seguimientoCompleto({ alumnoId: id, telefono: d.telefono }, cfg);
    guardarSeg(s);
    indexar(a, s);
    return a;
  }

  const segDe = (id: ID) => segs.get(id) ?? seguimientoCompleto({ alumnoId: id }, cfg);

  /* ---------- Clientes ---------- */
  for (const t of tablas.filter((x) => x.tipo === "clientes")) {
    t.filas.forEach((fila, i) => {
      const n = i + 2;
      const v = (campo: string) => valorDe(fila, t.mapeo, campo);
      if (fila.every((x) => !x.trim())) return;
      plan.porTabla.clientes.filas++;
      const nombre = v("nombre");
      if (!nombre) return descartar("clientes", n, "No tiene nombre.");
      let email = v("email");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { plan.avisos.push(`Clientes, fila ${n}: «${email}» no parece un mail; se ignoró.`); email = ""; }
      const numArchivo = aNumero(v("numero"));
      const numero = numArchivo !== null && Number.isInteger(numArchivo) && numArchivo >= 1 ? numArchivo : null;
      const telefono = v("telefono");

      const hallado = buscarAlumno({ email, numero, telefono, nombre });
      if (hallado.ambiguo) return descartar("clientes", n, `Hay más de un alumno que se llama «${nombre}» y la fila no trae mail: no se sabe cuál es.`);
      if (hallado.por === "nombre") plan.avisos.push(`Clientes, fila ${n}: «${nombre}» se tomó por su nombre (la fila no trae mail): revisalo.`);
      if (hallado.por === "N.º") plan.avisos.push(`Clientes, fila ${n}: «${nombre}» se tomó por su N.º ${numero}${hallado.mailDistinto ? ": el mail del archivo no es el que tiene en la app" : " (la fila no trae mail)"}.`);

      /* Lo que dice la fila. */
      const inicio = leerFecha(v("inicio")) ?? "";
      const egresoTxt = leerFecha(v("egreso")) ?? null;
      const programasTxt = v("programa");
      const programas = programasTxt
        ? [...new Set(programasTxt.split(/[,;+/\n]| y /i).map((x) => x.trim()).filter(Boolean)
          .map((x) => { const l = valorDeLista(x, listas.programas); return listas.programas.includes(l) ? l : programasDeTexto(x, listas.programas)[0] ?? l; }))]
        : [];
      const numOk = (campo: string, [min, max]: readonly [number, number]): number | null => {
        const m = /-?\d+([.,]\d+)?/.exec(v(campo));
        const x = m ? aNumero(m[0]) : null;
        if (x !== null && Number.isInteger(x) && x >= min && x <= max) return x;
        if (v(campo)) plan.avisos.push(`Clientes, fila ${n}: «${v(campo)}» no sirve como ${campo === "edad" ? "edad" : campo === "duracion" ? "duración" : "sesiones con el mentor"}; se ignoró.`);
        return null;
      };
      /* Lo que dice la fila, campo por campo: sólo entra lo que se entiende. */
      const campos: Partial<SeguimientoAlumno> = {};
      const poner = <K extends keyof SeguimientoAlumno>(k: K, x: SeguimientoAlumno[K] | null | undefined) => {
        if (x !== null && x !== undefined) campos[k] = x;
      };
      const texto = (campo: string) => v(campo) || undefined;
      poner("numero", numero);
      poner("telefono", texto("telefono"));
      if (v("edad")) poner("edad", numOk("edad", ENTRE.edad));
      if (v("stack")) poner("stack", valorDeLista(v("stack"), listas.stacks));
      poner("dni", texto("dni"));
      poner("domicilio", texto("domicilio"));
      if (programas.length) poner("programas", programas);
      poner("planDePago", texto("plan"));
      if (v("duracion")) poner("duracionMeses", numOk("duracion", ENTRE.duracion));
      poner("fechaEgreso", egresoTxt);
      if (v("mentor")) poner("sesionesMentor", numOk("mentor", [0, 10]));
      poner("notas", texto("comentarios"));
      poner("contactoInicial", leerFecha(v("contactoInicial")));
      poner("contactoSemana", leerFecha(v("contactoSemana")));
      poner("ultimoContacto", leerFecha(v("ultimoContacto")));
      if (v("acceso")) poner("acceso", valorDeLista(v("acceso"), listas.accesos));
      if (v("followUp")) poner("followUp", valorDeLista(v("followUp"), listas.followUps));
      if (v("garantia")) poner("garantia", valorDeLista(v("garantia"), listas.garantias));
      const siNoDe = (campo: string): boolean | null => {
        if (!v(campo)) return null;
        const x = leerSiNo(v(campo));
        if (x === null) plan.avisos.push(`Clientes, fila ${n}: «${v(campo)}» no se entendió como sí o no (${campo}); se ignoró.`);
        return x;
      };
      poner("accesoWhatsapp", siNoDe("wpp"));
      poner("accesoZoom", siNoDe("zoom"));
      poner("accesoWibo", siNoDe("wibo"));
      if (v("contrato")) {
        const ct = sinAcentos(v("contrato"));
        poner("contratoFirmado", /firmad/.test(ct) || SI_TEXTO.test(ct) ? "Firmado" : /pendiente|falta|sin firmar/.test(ct) || NO_TEXTO.test(ct) ? "Pendiente" : valorDeLista(v("contrato"), CONTRATOS));
      }
      if (v("estadoContrato")) poner("estadoContrato", valorDeLista(v("estadoContrato"), listas.estadosContrato));
      poner("cvCorregido", siNoDe("cv"));
      poner("linkedinCorregido", siNoDe("linkedin"));
      poner("responsableCv", texto("responsableCv"));
      poner("closerNombre", texto("closer"));
      const reporteTxt = sinAcentos(v("reporte"));
      if (reporteTxt) {
        poner("reporteManual", {
          completo: /(al dia|complet|si\b|ok|entreg)/.test(reporteTxt) && !/no complet|incomplet/.test(reporteTxt),
          activo: !/inactiv/.test(reporteTxt),
          semanasSin: Math.max(0, Number(/(\d+)\s*sem/.exec(reporteTxt)?.[1] ?? 0)),
          en: op.hoy,
        });
      }

      let alumno = hallado.id ? alumnos.get(hallado.id) : undefined;
      const eraNuevo = !alumno;
      if (!alumno) {
        const egreso = egresoTxt ?? (inicio && campos.duracionMeses ? sumarMeses(inicio, campos.duracionMeses) : null);
        alumno = crearAlumno({ nombre, email, telefono, pais: v("pais"), inicio, numero }, egreso && egreso < op.hoy ? "graduado" : "activo", `n${numero ?? ""}|${nombre}`);
        /* Un alumno nuevo del archivo con un servicio comprado: se le enlaza la venta (mismo mail), para el closer y el plan de pago. */
        const venta = e.ventas.filter((vt) => vt.estado === "activa" && claveEmail(personaDeVenta(e, vt).email) === claveEmail(email) && claveEmail(email) !== "")
          .filter((vt) => !e.alumnos.some((x) => x.ventaId === vt.id))
          .sort((x, y) => +new Date(y.fecha) - +new Date(x.fecha))[0];
        if (venta) alumnos.set(alumno.id, { ...alumno, ventaId: venta.id, plan: planDeVenta(e, venta), inicio: inicio || venta.fecha });
        else if (programas[0]) alumnos.set(alumno.id, { ...alumno, plan: programas[0] });
        alumno = alumnos.get(alumno.id)!;
      } else if (op.modo === "pisar" || !alumno.pais || !alumno.email) {
        /* Lo del alumno: sólo se completa lo que le falta (o se pisa, si se pidió). */
        const cambios: Partial<Alumno> = {};
        if (v("pais") && (op.modo === "pisar" || !alumno.pais)) cambios.pais = v("pais");
        if (email && (op.modo === "pisar" || !alumno.email)) cambios.email = email;
        if (op.modo === "pisar" && inicio) cambios.inicio = inicio;
        if (Object.keys(cambios).length) { alumno = { ...alumno, ...cambios }; guardarAlumno(alumno, false); }
      }

      /* La ficha: en «completar», sólo los campos que todavía están vacíos. */
      const base = segDe(alumno.id);
      const vacioEn = (k: keyof SeguimientoAlumno) => {
        const x = base[k];
        return x === null || x === "" || x === undefined || (Array.isArray(x) && x.length === 0) || (typeof x === "boolean" && !x);
      };
      const aplicar: Partial<SeguimientoAlumno> = {};
      for (const [k, x] of Object.entries(campos) as [keyof SeguimientoAlumno, unknown][]) {
        if (x === null || x === undefined) continue;
        if (op.modo === "pisar" || eraNuevo || vacioEn(k)) (aplicar as Record<string, unknown>)[k] = x;
      }
      /* El N.º: si ya lo tiene otro alumno, no se repite. */
      if (aplicar.numero != null && numeros.has(aplicar.numero) && numeros.get(aplicar.numero) !== alumno.id) {
        plan.avisos.push(`Clientes, fila ${n}: el N.º ${aplicar.numero} ya lo tiene otro alumno; «${nombre}» queda con el siguiente libre.`);
        delete aplicar.numero;
      }
      const resultado = seguimientoCompleto({ ...base, ...aplicar, actualizadoEn: op.ahora, actualizadoPor: op.quien }, cfg);
      if (resultado.numero === null) { resultado.numero = proximoNumero++; }
      if (resultado.numero >= proximoNumero) proximoNumero = resultado.numero + 1;
      const igual = !eraNuevo && JSON.stringify({ ...resultado, actualizadoEn: "", actualizadoPor: "" }) === JSON.stringify({ ...base, actualizadoEn: "", actualizadoPor: "" });
      /* Sólo se escribe lo que cambió: reimportar el mismo archivo no toca nada. */
      if (igual) segs.set(resultado.alumnoId, resultado); else guardarSeg(resultado);
      indexar(alumno, resultado);
      if (igual) plan.porTabla.clientes.iguales++;
      else if (eraNuevo) plan.porTabla.clientes.nuevas++;
      else plan.porTabla.clientes.actualizadas++;
    });
  }

  /* ---------- Un alumno que nombra otra tabla ---------- */
  function alumnoDeFila(tabla: TipoTablaCs, n: number, d: { nombre: string; email: string; telefono: string; pais: string; inicio: string }): Alumno | null {
    const hallado = buscarAlumno({ email: d.email, numero: null, telefono: d.telefono, nombre: d.nombre });
    if (hallado.ambiguo) { descartar(tabla, n, `Hay más de un alumno que se llama «${d.nombre}» y la fila no trae mail ni teléfono: no se sabe cuál es.`); return null; }
    if (hallado.id) {
      if (hallado.por === "nombre") plan.avisos.push(`${NOMBRE_TABLA_CS[tabla]}, fila ${n}: «${d.nombre}» se tomó por su nombre: revisalo.`);
      return alumnos.get(hallado.id) ?? null;
    }
    if (!d.nombre) { descartar(tabla, n, "No dice de qué alumno es."); return null; }
    if (!op.crearFaltantes) { descartar(tabla, n, `«${d.nombre}» no está entre los alumnos (se puede pedir que se cree).`); return null; }
    plan.alumnosCreadosPorOtraTabla++;
    return crearAlumno(d, "graduado", `${tabla}|${d.nombre}`);
  }

  /* ---------- Testimonios ---------- */
  const vistosDeAlumno = new Map<ID, number>();
  for (const t of tablas.filter((x) => x.tipo === "testimonios")) {
    t.filas.forEach((fila, i) => {
      const n = i + 2;
      const v = (campo: string) => valorDe(fila, t.mapeo, campo);
      if (fila.every((x) => !x.trim())) return;
      plan.porTabla.testimonios.filas++;
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v("email")) ? v("email") : "";
      const alumno = alumnoDeFila("testimonios", n, { nombre: v("alumno"), email, telefono: v("telefono"), pais: v("pais"), inicio: leerFecha(v("inicio")) ?? "" });
      if (!alumno) return;
      const k = (vistosDeAlumno.get(alumno.id) ?? 0) + 1;
      vistosDeAlumno.set(alumno.id, k);
      const id = `tes_cs_${alumno.id}_${k}`;
      const tec = v("tecnologias");
      const nuevo: Testimonio = {
        id, alumnoId: alumno.id,
        followUp: valorDeLista(v("followUp"), listas.followUpsTestimonio), fechaGrabacion: leerFecha(v("fechaGrabacion")) ?? null,
        conQuien: valorDeLista(v("conQuien"), listas.quienGraba), resell: valorDeLista(v("resell"), listas.resellsTestimonio),
        estadoVideo: valorDeLista(v("estadoVideo"), listas.estadosVideo), link: v("link"), tecnologias: tec,
        situacionPrevia: v("situacionPrevia"), situacionActual: v("situacionActual"), notas: v("notas"), creadoEn: op.ahora,
      };
      const ya = (e.testimonios ?? []).find((x) => x.id === id);
      const resultado = ya && op.modo === "completar"
        ? { ...nuevo, ...Object.fromEntries(Object.entries(ya).filter(([kk, vv]) => vv !== "" && vv !== null && vv !== undefined && kk !== "creadoEn" && kk !== "estado" && kk !== "fecha")), creadoEn: ya.creadoEn } as Testimonio
        : { ...nuevo, creadoEn: ya?.creadoEn ?? nuevo.creadoEn };
      if (ya && mismoObjeto(resultado, testimonioNormal(ya))) {
        plan.porTabla.testimonios.iguales++;
      } else {
        if (ya) plan.porTabla.testimonios.actualizadas++; else plan.porTabla.testimonios.nuevas++;
        plan.testimonios.push(resultado);
      }
      /* Lo que el testimonio sabe del alumno (edad, stack, teléfono) completa su ficha si está vacío. */
      const s = segDe(alumno.id);
      const completa: Partial<SeguimientoAlumno> = {};
      const edad = aNumero(v("edad"));
      if (s.edad === null && edad !== null && edad >= ENTRE.edad[0] && edad <= ENTRE.edad[1]) completa.edad = edad;
      if (!s.stack && v("stack")) completa.stack = valorDeLista(v("stack"), listas.stacks);
      if (!s.telefono && v("telefono")) completa.telefono = v("telefono");
      if (Object.keys(completa).length) { const r = seguimientoCompleto({ ...s, ...completa, actualizadoEn: op.ahora, actualizadoPor: op.quien }, cfg); guardarSeg(r); indexar(alumno, r); }
    });
  }

  /* ---------- Agenda de resells ---------- */
  const resellsActuales = (e.resells ?? []).map((r) => resellNormal(r));
  for (const t of tablas.filter((x) => x.tipo === "resells")) {
    t.filas.forEach((fila, i) => {
      const n = i + 2;
      const v = (campo: string) => valorDe(fila, t.mapeo, campo);
      if (fila.every((x) => !x.trim())) return;
      plan.porTabla.resells.filas++;
      const fechaHora = leerFechaHora(v("fechaHora"));
      if (!fechaHora) return descartar("resells", n, v("fechaHora") ? `«${v("fechaHora")}» no se entendió como fecha.` : "No tiene fecha.");
      const email = v("email");
      const mail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "";
      const dia = diaDeNegocio(fechaHora);
      /* La que ya trajo Calendly (el mismo mail ese mismo día) se completa; si no, es una nueva, siempre con el mismo id. */
      const idImportado = `rs_imp_${hashCorto(`${claveEmail(mail) || sinAcentos(v("nombre"))}|${fechaHora}`)}`;
      const existente = resellsActuales.find((r) => r.id === idImportado)
        ?? (mail ? resellsActuales.find((r) => claveEmail(r.email) === claveEmail(mail) && diaDeNegocio(r.fechaHora) === dia) : undefined);
      const id = existente?.id ?? idImportado;
      const cash = v("cash") ? leerMontoCs(v("cash")) : null;
      if (v("cash") && cash === null) plan.avisos.push(`Resells, fila ${n}: «${v("cash")}» no se entendió como monto; se ignoró.`);
      const caso = v("caso") ? leerSiNo(v("caso")) : false;
      const estadoTxt = v("estado");
      const archivo = resellNormal({
        id, sesionId: existente?.sesionId ?? null, fechaHora: existente?.fechaHora ?? fechaHora,
        nombre: v("nombre"), email: mail, telefono: v("telefono"), closer: v("closer"),
        estado: estadoTxt ? valorDeLista(estadoTxt, listas.estadosResell) : "",
        cashCollect: cash, casoDeExito: caso === true || (caso === null && Boolean(v("caso"))),
        notas: caso === null && v("caso") ? `${v("notas")}${v("notas") ? " · " : ""}Caso de éxito: ${v("caso")}`.trim() : v("notas"),
        cancelada: false, origen: existente?.origen ?? "importado",
        creadoEn: existente?.creadoEn ?? op.ahora, actualizadoEn: op.ahora, actualizadoPor: op.quien,
      });
      let resultado = archivo;
      if (existente) {
        /* Lo de Calendly (quién, cuándo, el contacto) manda; lo que lleva Customer Success se completa. */
        const sigue = op.modo === "pisar";
        resultado = resellNormal({
          ...existente,
          estado: sigue || !existente.estado ? archivo.estado || existente.estado : existente.estado,
          cashCollect: sigue || existente.cashCollect === null ? archivo.cashCollect ?? existente.cashCollect : existente.cashCollect,
          casoDeExito: sigue ? archivo.casoDeExito : existente.casoDeExito || archivo.casoDeExito,
          notas: sigue || !existente.notas ? archivo.notas || existente.notas : existente.notas,
          nombre: existente.nombre || archivo.nombre, telefono: existente.telefono || archivo.telefono, closer: existente.closer || archivo.closer,
          actualizadoEn: op.ahora, actualizadoPor: op.quien,
        });
        const igual = JSON.stringify({ ...resultado, actualizadoEn: "", actualizadoPor: "" }) === JSON.stringify({ ...existente, actualizadoEn: "", actualizadoPor: "" });
        if (igual) { plan.porTabla.resells.iguales++; return; }
        plan.porTabla.resells.actualizadas++;
      } else {
        plan.porTabla.resells.nuevas++;
      }
      plan.resells.push(resultado);
    });
  }

  /* ---------- Reportes semanales ---------- */
  const reportesActuales = new Set(e.reportes.map((r) => `${r.alumnoId}|${lunesDe(r.semanaDel)}`));
  const reportesNuevos = new Set<string>();
  for (const t of tablas.filter((x) => x.tipo === "reportes")) {
    t.filas.forEach((fila, i) => {
      const n = i + 2;
      const v = (campo: string) => valorDe(fila, t.mapeo, campo);
      if (fila.every((x) => !x.trim())) return;
      plan.porTabla.reportes.filas++;
      const dia = leerFecha(v("semana"));
      if (!dia) return descartar("reportes", n, v("semana") ? `«${v("semana")}» no se entendió como fecha.` : "No dice de qué semana es.");
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v("email")) ? v("email") : "";
      const hallado = buscarAlumno({ email, numero: null, telefono: "", nombre: v("alumno") });
      if (hallado.ambiguo) return descartar("reportes", n, `Hay más de un alumno que se llama «${v("alumno")}» y la fila no trae mail.`);
      let alumno = hallado.id ? alumnos.get(hallado.id) : undefined;
      if (!alumno) {
        if (!v("alumno") && !email) return descartar("reportes", n, "No dice de qué alumno es.");
        if (!op.crearFaltantes) return descartar("reportes", n, `«${v("alumno") || email}» no está entre los alumnos.`);
        plan.alumnosCreadosPorOtraTabla++;
        alumno = crearAlumno({ nombre: v("alumno") || email, email, telefono: "", pais: "", inicio: "" }, "graduado", `reportes|${v("alumno")}|${email}`);
      }
      const semana = lunesDe(dia);
      const clave = `${alumno.id}|${semana}`;
      if (reportesActuales.has(clave) || reportesNuevos.has(clave)) { plan.porTabla.reportes.iguales++; return; }
      reportesNuevos.add(clave);
      const num = (campo: string) => { const x = aNumero(v(campo)); return x !== null && x >= 0 ? x : undefined; };
      plan.reportes.push({
        id: `rep_cs_${alumno.id}_${semana}`, alumnoId: alumno.id, semanaDel: semana, estado: "completado", completadoEn: `${dia}T12:00:00.000Z`,
        horasEstudio: num("horas"), entrevistas: num("entrevistas"), postulaciones: num("postulaciones"), bloqueo: v("bloqueo") || undefined,
      });
      plan.porTabla.reportes.nuevas++;
    });
  }

  /* Lo que se escribe: los alumnos y las fichas que se tocaron (y las de los que se crearon). */
  plan.alumnos = [...tocados].map((id) => alumnos.get(id)!).filter(Boolean);
  plan.seguimientos = [...tocadosSeg].map((id) => segs.get(id)!).filter(Boolean);
  /* Un alumno que sólo se completó (sin cambios en su ficha) no hace falta escribirlo. */
  return plan;
}

/* ---------- Lectura de un archivo ya leído a tablas ---------- */

/** Arma una tabla del importador a partir de las filas de una hoja: detecta su tipo y adivina el mapeo. */
export function tablaDeHoja(nombre: string, filas: readonly (readonly string[])[]): TablaImport | null {
  const h = filaDeEncabezados(filas);
  const encabezados = [...(filas[h] ?? [])].map((x) => (x ?? "").trim());
  if (encabezados.filter(Boolean).length < 3) return null;
  const { tipo } = detectarTipo(encabezados, nombre);
  if (!tipo) return null;
  return {
    nombre, tipo, encabezados, filas: filas.slice(h + 1).map((f) => [...f]),
    mapeo: adivinarMapeoCs(CAMPOS_DE[tipo], encabezados),
  };
}

/** Lo que falta para poder importar una tabla (el dato obligatorio sin columna). */
export function faltaParaImportar(t: Pick<TablaImport, "tipo" | "mapeo">): string | null {
  const exige: Record<TipoTablaCs, string[]> = { clientes: ["nombre"], testimonios: ["alumno"], resells: ["fechaHora"], reportes: ["semana"] };
  const falta = exige[t.tipo].filter((k) => t.mapeo[k] === undefined).map((k) => CAMPOS_DE[t.tipo].find((x) => x.campo === k)?.titulo ?? k);
  return falta.length ? `Elegí qué columna es ${falta.join(" y ")}.` : null;
}

