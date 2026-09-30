import type { Contacto, EstadoApp, Sesion } from "./types";
import { filasCrm, opcionesDe, sinTildes, type FilaCrm } from "./crm";
import { respuestaA } from "./calendly";
import { diaDeNegocio } from "./dia-negocio";
import { EVENTOS, leerUtm, NOMBRE_FUNNEL } from "./utm-estandar";
import { TEXTO_RESULTADO } from "./eod";

/* ==================================================================
   El CRM como una tabla fácil, como un Excel (Yari, 29/09): "lo fácil le
   gana a todo". Cada llamada con todo lo que se sabe de la persona, sin
   cargar nada a mano, y cada columna se filtra con un clic desde su
   título: se tildan los valores que se quieren ver.

   Las filas salen de las mismas agendas que el CRM de antes (lib/crm.ts)
   y suman lo que carga el closer en su EOD (lib/eod.ts) y lo que se
   deduce solo: por qué vía y con qué ad llegó, el país (del prefijo del
   teléfono) y la edad (si el formulario la pregunta).
   ================================================================== */

export interface FilaTabla {
  id: string;
  fila: FilaCrm;
  sesion: Sesion;
  personaId: string;
  nombre: string;
  llamada: string;       // ISO
  dia: string;           // aaaa-mm-dd, en Argentina
  closer: string;
  estado: string;
  resultado: string;
  objecion: string;
  oferta: string;        // Sí · No · ""
  cierre: string;        // aaaa-mm-dd
  via: string;
  ad: string;
  campania: string;
  pais: string;
  edad: string;
  tecnologias: string[];
  ingles: string;
  experiencia: string;
  formacion: string[];
  ingreso: string;
  inversion: string;
  calificada: string;    // Sí · No
  grabacion: string;
  venta: string;
  email: string;
  telefono: string;
  agendo: string;
  notas: string;
  /* Ya pasó, no se canceló y nadie cargó cómo terminó. */
  sinCargar: boolean;
}

const ESTADO: Record<string, string> = { agendada: "Agendada", hecha: "Hecha", "no-show": "No vino", cancelada: "Cancelada" };

/* ---------- El país, por el prefijo del teléfono ----------
   Los de Calendly llegan con el + y el código del país. Sin el +, no se
   adivina. El más largo primero: +1 809 es República Dominicana. */
const PREFIJOS: [string, string][] = ([
  ["1809", "República Dominicana"], ["1829", "República Dominicana"], ["1849", "República Dominicana"],
  ["1787", "Puerto Rico"], ["1939", "Puerto Rico"],
  ["598", "Uruguay"], ["595", "Paraguay"], ["593", "Ecuador"], ["591", "Bolivia"],
  ["507", "Panamá"], ["506", "Costa Rica"], ["505", "Nicaragua"], ["504", "Honduras"], ["503", "El Salvador"], ["502", "Guatemala"],
  ["58", "Venezuela"], ["57", "Colombia"], ["56", "Chile"], ["55", "Brasil"], ["54", "Argentina"], ["53", "Cuba"],
  ["52", "México"], ["51", "Perú"], ["49", "Alemania"], ["44", "Reino Unido"], ["39", "Italia"], ["34", "España"],
  ["33", "Francia"], ["1", "Estados Unidos"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

export function paisDeTelefono(tel?: string | null): string {
  const t = (tel ?? "").trim();
  if (!/^(\+|00)/.test(t)) return "";
  const n = t.replace(/^00/, "").replace(/\D/g, "");
  return PREFIJOS.find(([p]) => n.startsWith(p))?.[1] ?? "";
}

/* ---------- Por qué vía y con qué ad ---------- */

/* {utm_source} o {source}: los contactos guardan las dos formas. */
const utmDe = (u: Record<string, string> | undefined | null, k: string) => u?.[`utm_${k}`] ?? u?.[k] ?? "";
const esPauta = (u: Record<string, string> | undefined | null) =>
  /^(meta|facebook|fb|instagram|ig)$/i.test(utmDe(u, "source")) && /^(paid|cpc|ads?|pauta)$/i.test(utmDe(u, "medium"));

/** "Webinar · vivo", "Clase cero · replay", "VSL", "Setter"… */
export function viaDe(s: Pick<Sesion, "utm">, f: Pick<FilaCrm, "funnel">): string {
  const l = leerUtm(s.utm);
  if (l.funnel && EVENTOS.includes(l.funnel)) {
    const link = /^(vivo|replay|seguimiento)$/i.test(l.contenido ?? "") ? l.contenido!.toLowerCase()
      : l.momento === "vivo" ? "vivo" : l.momento === "despues" ? "después" : "";
    return link ? `${NOMBRE_FUNNEL[l.funnel]} · ${link}` : NOMBRE_FUNNEL[l.funnel];
  }
  if (utmDe(s.utm, "source") === "direct") return "Directo";
  return f.funnel || "Sin UTMs";
}

/** El ad: el de la agenda si vino de la pauta; si no, el de cómo llegó la
 *  persona la primera vez (el formulario del webinar, por ejemplo). */
export function adDe(s: Pick<Sesion, "utm">, c?: Pick<Contacto, "utm"> | null): { ad: string; campania: string } {
  if (esPauta(s.utm)) return { ad: utmDe(s.utm, "content"), campania: utmDe(s.utm, "campaign") };
  if (esPauta(c?.utm)) return { ad: utmDe(c?.utm, "content"), campania: utmDe(c?.utm, "campaign") };
  return { ad: "", campania: "" };
}

/* ---------- Las filas ---------- */

export function filasTabla(
  e: Pick<EstadoApp, "sesiones" | "contactos" | "ajustes" | "webinars" | "ventas" | "productos" | "leads">,
  ahora = Date.now(),
): FilaTabla[] {
  const contactos = new Map(e.contactos.map((c) => [c.id, c]));
  const estados = opcionesDe(e.ajustes, "estadoLlamada");
  const deEstado = new Map(estados.map((o) => [o.nombre, o]));
  return filasCrm(e).map((f) => {
    const s = f.sesion;
    const c = contactos.get(s.contactoId ?? "") ?? contactos.get(s.leadId ?? "");
    const qa = s.respuestas ?? [];
    const { ad, campania } = adDe(s, c);
    const paso = Date.parse(s.inicia) <= ahora;
    /* Lo que cargó el closer manda; si no, lo que se sabe: la venta, que no
       vino, el Estado de Llamada del CRM de antes. */
    const op = deEstado.get(s.estadoLlamada ?? "");
    const resultado = s.resultado ? TEXTO_RESULTADO[s.resultado]
      : f.venta ? TEXTO_RESULTADO.compro
        : s.estado === "cancelada" ? "Cancelada"
          : s.estado === "no-show" || op?.llamada === "no-show" ? TEXTO_RESULTADO["no-vino"]
            : op?.oportunidad && op.oportunidad !== "perdida" && op.oportunidad !== "devolucion" ? TEXTO_RESULTADO.compro
              : op?.llamada === "hecha" || op?.oportunidad === "perdida" ? TEXTO_RESULTADO["no-compro"]
                : paso ? "Sin cargar" : "Por venir";
    return {
      id: f.id, fila: f, sesion: s, personaId: f.personaId,
      nombre: f.nombre, llamada: s.inicia, dia: diaDeNegocio(s.inicia), closer: f.closer,
      estado: ESTADO[s.estado] ?? s.estado,
      resultado,
      objecion: s.objecion ?? "",
      oferta: s.hizoOferta === true ? "Sí" : s.hizoOferta === false ? "No" : "",
      cierre: s.cierreEstimado ?? "",
      via: viaDe(s, f),
      ad, campania,
      pais: c?.pais?.trim() || paisDeTelefono(f.telefono),
      edad: respuestaA(qa, /(\bedad\b|cuantos anos tenes|que edad)/) ?? "",
      tecnologias: f.lenguajes,
      ingles: f.ingles,
      experiencia: f.anios,
      formacion: f.formacion,
      ingreso: f.ingreso,
      inversion: f.inversion,
      calificada: f.calificada,
      grabacion: f.grabacion,
      venta: f.venta?.texto ?? "",
      email: f.email,
      telefono: f.telefono,
      agendo: s.creadoEn,
      notas: f.notas,
      sinCargar: resultado === "Sin cargar",
    };
  });
}

/* ---------- Las columnas ---------- */

export type ClaveColumna =
  | "llamada" | "nombre" | "closer" | "estado" | "resultado" | "objecion" | "oferta" | "cierre"
  | "via" | "ad" | "campania" | "pais" | "edad" | "tecnologias" | "ingles" | "experiencia" | "formacion"
  | "ingreso" | "inversion" | "calificada" | "grabacion" | "venta" | "email" | "telefono" | "agendo" | "notas";

export interface ColumnaTabla {
  clave: ClaveColumna;
  titulo: string;
  grupo: "Llamada" | "Resultado" | "Origen" | "Perfil" | "Contacto";
  /* Los valores por los que se filtra (una lista: una fila con varios
     lenguajes aparece tildando cualquiera de ellos). */
  valores: (f: FilaTabla) => string[];
  /* Cómo se ordena; si falta, por el primer valor. */
  orden?: (f: FilaTabla) => string | number;
  /* El orden de los valores en el filtro, si no es el alfabético. */
  ordenValores?: string[];
  ancho?: number;
}

export const VACIAS = "(Vacías)";
const uno = (x: string) => [x || VACIAS];
const varios = (xs: string[]) => (xs.length ? xs : [VACIAS]);

export const ORDEN_RESULTADO = ["Con cierre", "Sin cierre", "No se presentó", "Reprogramó", "Sin cargar", "Por venir", "Cancelada"];

export const COLUMNAS: ColumnaTabla[] = [
  { clave: "llamada", titulo: "Llamada", grupo: "Llamada", valores: (f) => [f.dia], orden: (f) => f.llamada, ancho: 150 },
  { clave: "nombre", titulo: "Persona", grupo: "Llamada", valores: (f) => uno(f.nombre), ancho: 220 },
  { clave: "closer", titulo: "Closer", grupo: "Llamada", valores: (f) => uno(f.closer), ancho: 150 },
  { clave: "estado", titulo: "Estado", grupo: "Llamada", valores: (f) => [f.estado], ordenValores: ["Agendada", "Hecha", "No vino", "Cancelada"], ancho: 110 },
  { clave: "resultado", titulo: "Resultado", grupo: "Resultado", valores: (f) => [f.resultado], ordenValores: ORDEN_RESULTADO,
    orden: (f) => ORDEN_RESULTADO.indexOf(f.resultado), ancho: 140 },
  { clave: "objecion", titulo: "Objeción", grupo: "Resultado", valores: (f) => uno(f.objecion), ancho: 170 },
  { clave: "oferta", titulo: "¿Oferta?", grupo: "Resultado", valores: (f) => uno(f.oferta), ancho: 100 },
  { clave: "cierre", titulo: "Cierre estimado", grupo: "Resultado", valores: (f) => uno(f.cierre), ancho: 140 },
  { clave: "venta", titulo: "Venta", grupo: "Resultado", valores: (f) => [f.venta ? "Con venta" : "Sin venta"], orden: (f) => f.venta, ancho: 190 },
  { clave: "via", titulo: "Vía", grupo: "Origen", valores: (f) => uno(f.via), ancho: 170 },
  { clave: "ad", titulo: "Ad", grupo: "Origen", valores: (f) => uno(f.ad), ancho: 200 },
  { clave: "campania", titulo: "Campaña", grupo: "Origen", valores: (f) => uno(f.campania), ancho: 200 },
  { clave: "pais", titulo: "País", grupo: "Perfil", valores: (f) => uno(f.pais), ancho: 130 },
  { clave: "edad", titulo: "Edad", grupo: "Perfil", valores: (f) => uno(f.edad), ancho: 90 },
  { clave: "tecnologias", titulo: "Tecnologías", grupo: "Perfil", valores: (f) => varios(f.tecnologias), orden: (f) => f.tecnologias.join(", "), ancho: 220 },
  { clave: "ingles", titulo: "Inglés", grupo: "Perfil", valores: (f) => uno(f.ingles), ancho: 200 },
  { clave: "experiencia", titulo: "Experiencia", grupo: "Perfil", valores: (f) => uno(f.experiencia), ancho: 130 },
  { clave: "formacion", titulo: "Formación", grupo: "Perfil", valores: (f) => varios(f.formacion), orden: (f) => f.formacion.join(", "), ancho: 200 },
  { clave: "ingreso", titulo: "Gana por mes", grupo: "Perfil", valores: (f) => uno(f.ingreso), ancho: 170 },
  { clave: "inversion", titulo: "Puede invertir", grupo: "Perfil", valores: (f) => uno(f.inversion), ancho: 240 },
  { clave: "calificada", titulo: "Calificada", grupo: "Perfil", valores: (f) => [f.calificada], ancho: 110 },
  { clave: "grabacion", titulo: "Grabación", grupo: "Resultado", valores: (f) => [f.grabacion ? "Con grabación" : "Sin grabación"], ancho: 120 },
  { clave: "email", titulo: "Email", grupo: "Contacto", valores: (f) => uno(f.email), ancho: 220 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Contacto", valores: (f) => uno(f.telefono), ancho: 160 },
  { clave: "agendo", titulo: "Agendó el", grupo: "Llamada", valores: (f) => [diaDeNegocio(f.agendo)], orden: (f) => f.agendo, ancho: 150 },
  { clave: "notas", titulo: "Notas", grupo: "Resultado", valores: (f) => [f.notas ? "Con notas" : "Sin notas"], ancho: 260 },
];

export const COLUMNA: Record<ClaveColumna, ColumnaTabla> = Object.fromEntries(COLUMNAS.map((c) => [c.clave, c])) as Record<ClaveColumna, ColumnaTabla>;

export const VISIBLES_POR_DEFECTO: ClaveColumna[] = [
  "llamada", "nombre", "closer", "resultado", "objecion", "oferta", "cierre", "via", "ad", "pais",
  "tecnologias", "ingles", "ingreso", "inversion", "calificada", "grabacion", "venta",
];

/* ---------- Filtrar ----------
   Como en Excel: en la lista de cada columna se destilda lo que no se
   quiere ver ("sin") o, con un clic, se deja sólo un valor ("solo"). Van
   en el link: ?solo-pais=Argentina|México, ?sin-resultado=Por venir. */

export interface FiltroColumna { modo: "solo" | "sin"; valores: string[] }
export type FiltrosTabla = Partial<Record<ClaveColumna, FiltroColumna>>;

/** Si un valor se ve con el filtro de su columna. */
export const seVe = (valor: string, fc?: FiltroColumna) =>
  !fc || !fc.valores.length || (fc.modo === "solo" ? fc.valores.includes(valor) : !fc.valores.includes(valor));

export function pasaFiltros(f: FilaTabla, filtros: FiltrosTabla, salvo?: ClaveColumna): boolean {
  for (const [k, fc] of Object.entries(filtros) as [ClaveColumna, FiltroColumna][]) {
    if (k === salvo || !fc?.valores.length) continue;
    const col = COLUMNA[k];
    if (!col) continue;
    /* Una fila con varios valores (lenguajes) se ve si alguno se ve. */
    if (!col.valores(f).some((v) => seVe(v, fc))) return false;
  }
  return true;
}

const SEP = "|";
export const PREFIJOS_FILTRO = ["solo-", "sin-"] as const;

/** Los filtros de la URL. */
export function filtrosDeURL(params: URLSearchParams): FiltrosTabla {
  const out: FiltrosTabla = {};
  for (const [k, v] of params.entries()) {
    const m = /^(solo|sin)-(.+)$/.exec(k);
    if (!m || !(m[2] in COLUMNA)) continue;
    const valores = v.split(SEP).filter(Boolean);
    if (valores.length) out[m[2] as ClaveColumna] = { modo: m[1] as "solo" | "sin", valores };
  }
  return out;
}

/** Lo que hay que escribir en la URL para dejar una columna con este filtro. */
export function filtroAURL(clave: ClaveColumna, fc: FiltroColumna | null): Record<string, string | null> {
  return {
    [`solo-${clave}`]: fc?.modo === "solo" && fc.valores.length ? fc.valores.join(SEP) : null,
    [`sin-${clave}`]: fc?.modo === "sin" && fc.valores.length ? fc.valores.join(SEP) : null,
  };
}

export function coincideBusqueda(f: FilaTabla, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [f.nombre, f.email, f.telefono, f.closer, f.notas].some((x) => sinTildes(x ?? "").includes(t));
}

/** Los valores de una columna para su filtro, con cuántas filas tiene cada
 *  uno según los DEMÁS filtros (como en Excel: lo que ya está filtrado en
 *  otra columna no aparece). */
export function opcionesDeColumna(filas: FilaTabla[], filtros: FiltrosTabla, clave: ClaveColumna): { valor: string; cuenta: number }[] {
  const col = COLUMNA[clave];
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    if (!pasaFiltros(f, filtros, clave)) continue;
    for (const v of new Set(col.valores(f))) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  }
  /* Lo elegido sigue en la lista aunque no quede ninguna fila con eso. */
  for (const v of filtros[clave]?.valores ?? []) if (!cuenta.has(v)) cuenta.set(v, 0);
  const orden = col.ordenValores;
  return [...cuenta.entries()]
    .map(([valor, n]) => ({ valor, cuenta: n }))
    .sort((a, b) => {
      if (a.valor === VACIAS) return 1;
      if (b.valor === VACIAS) return -1;
      if (orden) {
        const ia = orden.indexOf(a.valor), ib = orden.indexOf(b.valor);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }
      /* Las fechas, de la más nueva a la más vieja. */
      if (clave === "llamada" || clave === "agendo" || clave === "cierre") return b.valor.localeCompare(a.valor);
      return a.valor.localeCompare(b.valor, "es", { numeric: true });
    });
}

/* ---------- Por qué no se cierra ---------- */

export interface NumerosResumen {
  llamadas: number;
  /* Las que ya pasaron y no se cancelaron. */
  pasaron: number;
  presentaron: number;
  cierres: number;
  sinCierre: number;
  noVino: number;
  sinCargar: number;
  /* Cierres sobre los que se presentaron. */
  pctCierre: number | null;
  objeciones: { objecion: string; n: number }[];
}

const SE_PRESENTO = new Set([TEXTO_RESULTADO.compro, TEXTO_RESULTADO["no-compro"]]);

export function resumenDe(filas: FilaTabla[]): NumerosResumen {
  const r: NumerosResumen = { llamadas: filas.length, pasaron: 0, presentaron: 0, cierres: 0, sinCierre: 0, noVino: 0, sinCargar: 0, pctCierre: null, objeciones: [] };
  const obj = new Map<string, number>();
  for (const f of filas) {
    if (f.resultado !== "Cancelada" && f.resultado !== "Por venir") r.pasaron++;
    if (SE_PRESENTO.has(f.resultado)) r.presentaron++;
    if (f.resultado === TEXTO_RESULTADO.compro) r.cierres++;
    if (f.resultado === TEXTO_RESULTADO["no-compro"]) {
      r.sinCierre++;
      obj.set(f.objecion || "Sin objeción cargada", (obj.get(f.objecion || "Sin objeción cargada") ?? 0) + 1);
    }
    if (f.resultado === TEXTO_RESULTADO["no-vino"]) r.noVino++;
    if (f.sinCargar) r.sinCargar++;
  }
  r.pctCierre = r.presentaron > 0 ? (r.cierres / r.presentaron) * 100 : null;
  r.objeciones = [...obj.entries()].map(([objecion, n]) => ({ objecion, n })).sort((a, b) => b.n - a.n || a.objecion.localeCompare(b.objecion));
  return r;
}

export interface FilaDimension extends NumerosResumen { valor: string }

/** Los mismos números abiertos por una columna: por país, por tecnología,
 *  por ad… Una fila con varios lenguajes cuenta en cada uno. */
export function porDimension(filas: FilaTabla[], clave: ClaveColumna): FilaDimension[] {
  const col = COLUMNA[clave];
  const grupos = new Map<string, FilaTabla[]>();
  for (const f of filas) for (const v of new Set(col.valores(f))) grupos.set(v, [...(grupos.get(v) ?? []), f]);
  return [...grupos.entries()]
    .map(([valor, fs]) => ({ valor, ...resumenDe(fs) }))
    .sort((a, b) => (a.valor === VACIAS ? 1 : b.valor === VACIAS ? -1 : b.presentaron - a.presentaron || b.llamadas - a.llamadas));
}

/* Las columnas que tienen sentido para abrir el análisis. */
export const DIMENSIONES: ClaveColumna[] = ["objecion", "pais", "edad", "tecnologias", "ingreso", "inversion", "ingles", "experiencia", "ad", "via", "closer", "calificada"];
