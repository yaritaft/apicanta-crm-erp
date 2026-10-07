import type { Contacto, EstadoApp, Webinar } from "./types";
import { insightsDelWebinar, metricasDeWebinar, numerosDelWebinar, personasDeWebinar, type PersonaDeWebinar } from "./webinar";
import type { AgendaDelWebinar } from "./agendas-webinar";
import { agendasDelLanzamiento, NOMBRE_LINK, NOMBRE_VIA, rendimientoPorVia } from "./vias-webinar";
import { adDe, anguloDe, filasTabla, type FilaTabla } from "./crm-tabla";
import { evaluarRegistro } from "./capi-registro";
import { respuestaPerfil, type Respuesta } from "./perfil";
import { slugUtm } from "./utm-estandar";
import { diaDeNegocio } from "./dia-negocio";
import { escribirXlsx, type HojaXlsx } from "./xlsxEscribir";
import { hojaDeTabla, type BloqueResumen, type ColumnaTabla, type TablaInforme } from "./xlsxTabla";

/* ==================================================================
   El informe del webinar: un Excel de tres hojas (reunión del 02/10, F3-05).

   Agus, una o dos semanas después de cada webinar, cruza a mano lo que
   pasó con las agendas, los anuncios y la gente, y se lo pasa a Claude.
   Yari: «generale un Excel con tres hojas: quiero bajarme el resumen de
   este webinar… en lugar de descargar tres Excel, uno solo». Todo vive en
   el mismo sistema, así que el cruce lo hace la app:

   1. «Personas»: quién se registró al webinar, qué contestó, si agendó, si
      compró. Arriba, el resumen del webinar (el embudo, la plata y el
      rendimiento de cada vía) con cómo se calcula cada número.
   2. «Agendas»: cada agenda del lanzamiento (el webinar, su clase cero y su
      Q&A) y qué pasó con ella: closer, estado, objeción, venta, anuncio.
   3. «Anuncios»: por anuncio, lo que gastó Meta en las campañas del webinar
      cruzado con lo nuestro: registros, agendas, ventas y plata.

   ESTRUCTURA FÁCIL DE AJUSTAR: cada hoja es una lista de columnas
   (COLUMNAS_PERSONAS, COLUMNAS_AGENDAS, COLUMNAS_ANUNCIOS). Para pedir una
   columna nueva o sacar una, se agrega o se borra una línea; el dibujo
   (lib/xlsxTabla.ts) no se toca. Agus todavía no pasó el ejemplo de su
   informe: cuando lo mande, se ajustan estas tres listas.

   Lógica pura: arma las tres tablas desde el estado de la app, sin React ni
   red (pruebas/informe-webinar.test.ts). `excelDelInforme` las vuelve un
   .xlsx con el escritor propio de la app (sin dependencias).
   ================================================================== */

/* ---------- Lo que se sabe de cada registro ---------- */

/* Lo que guarda cada ingreso al webinar: el de la landing (extra.registrosWebinar)
   y el de un formulario de Meta (extra.formulariosMeta). Todo el acceso a esos
   datos está en `registroDe`: si los registros pasan a una tabla propia (F3-01),
   es lo único que cambia. */
export interface RegistroDelInforme {
  origen: "Landing" | "Formulario de Meta";
  creado: string;
  utm?: Record<string, string>;
  /* El anuncio, si el formulario de Meta lo dice por nombre. */
  anuncio?: string;
  campania?: string;
  respuestas: Respuesta[];
}

interface CrudoRegistro { webinarId?: string; creado?: string; utm?: Record<string, string>; anuncio?: string; campania?: string; respuestas?: Respuesta[] }

export function registroDe(c: Contacto | undefined, webinarId: string): RegistroDelInforme | undefined {
  if (!c) return undefined;
  const lista = (clave: string) => (Array.isArray(c.extra?.[clave]) ? (c.extra[clave] as CrudoRegistro[]) : [])
    .filter((r) => r && r.webinarId === webinarId);
  const a = lista("registrosWebinar")[0];
  if (a) return { origen: "Landing", creado: a.creado ?? "", utm: a.utm, respuestas: a.respuestas ?? [] };
  const b = lista("formulariosMeta")[0];
  if (b) return { origen: "Formulario de Meta", creado: b.creado ?? "", anuncio: b.anuncio, campania: b.campania, respuestas: b.respuestas ?? [] };
  return undefined;
}

/* ---------- Helpers ---------- */

const redondear = (n: number) => Math.round(n * 100) / 100;
const dividir = (a: number, b: number) => (b > 0 ? redondear(a / b) : undefined);
const claveAd = (nombre: string) => slugUtm(nombre.replace(/\.(mp4|mov|m4v|webm|jpe?g|png|gif)\b/i, ""));
export const SIN_ANUNCIO = "(Sin anuncio identificado)";

const textoCriterio = (c?: boolean) => (c === undefined ? "Sin datos" : c ? "Sí" : "No");

/* ---------- Hoja 1: las personas ---------- */

export interface FilaPersona {
  p: PersonaDeWebinar;
  registro?: RegistroDelInforme;
  agendas: AgendaDelWebinar[];
  anuncio: string;
  campania: string;
  /* Lo que contestó: del registro y, si no, de su agenda. */
  respuestas: Respuesta[];
  /* Sí / No / sin datos: de la agenda si agendó; si no, del registro. */
  califica?: boolean;
  closer: string;
  estado: string;
  /* Cuántas ventas y cuánto, sólo las del webinar. */
  ventas: number;
}

export const COLUMNAS_PERSONAS: ColumnaTabla<FilaPersona>[] = [
  { titulo: "Persona", ancho: 28, valor: (f) => f.p.nombre, total: (fs) => fs.length },
  { titulo: "Email", ancho: 30, valor: (f) => f.p.email },
  { titulo: "Teléfono", ancho: 18, valor: (f) => f.p.telefono },
  { titulo: "País", ancho: 16, valor: (f) => f.p.pais },
  { titulo: "Se registró", ancho: 17, formato: "fechaHora", valor: (f) => f.registro?.creado || f.p.entro },
  { titulo: "Cómo se registró", ancho: 20, valor: (f) => f.registro?.origen ?? (f.agendas.length ? "Sólo por la agenda" : f.p.ventas.length ? "Sólo por la venta" : "") },
  { titulo: "Anuncio", ancho: 30, valor: (f) => f.anuncio },
  { titulo: "Campaña", ancho: 28, valor: (f) => f.campania },
  { titulo: "Puede invertir", ancho: 30, valor: (f) => respuestaPerfil(f.respuestas, "inversion") },
  { titulo: "Inglés", ancho: 28, valor: (f) => respuestaPerfil(f.respuestas, "ingles") },
  { titulo: "Formación", ancho: 26, valor: (f) => respuestaPerfil(f.respuestas, "formacion") },
  { titulo: "Califica", ancho: 11, formato: "si-no", valor: (f) => textoCriterio(f.califica) },
  { titulo: "Agendó", ancho: 10, formato: "si-no", valor: (f) => f.agendas.length > 0, total: (fs) => fs.filter((f) => f.agendas.length > 0).length },
  { titulo: "Agendas", ancho: 10, formato: "entero", valor: (f) => f.agendas.length, total: (fs) => fs.reduce((a, f) => a + f.agendas.length, 0) },
  { titulo: "Closer", ancho: 18, valor: (f) => f.closer },
  { titulo: "Estado de la llamada", ancho: 22, valor: (f) => f.estado },
  { titulo: "Compró", ancho: 10, formato: "si-no", valor: (f) => f.ventas > 0, total: (fs) => fs.filter((f) => f.ventas > 0).length },
  { titulo: "Facturado", ancho: 14, formato: "moneda", valor: (f) => f.p.facturado, total: (fs) => redondear(fs.reduce((a, f) => a + f.p.facturado, 0)) },
  { titulo: "Cobrado", ancho: 14, formato: "moneda", valor: (f) => f.p.cobrado, total: (fs) => redondear(fs.reduce((a, f) => a + f.p.cobrado, 0)) },
];

/* ---------- Hoja 2: las agendas ---------- */

export interface FilaAgenda {
  a: AgendaDelWebinar;
  /* La fila del CRM de esa llamada: objeción, venta, estados… Una agenda de
     un tipo que el CRM no muestra no la tiene. */
  t?: FilaTabla;
  /* El anuncio por el que vino la persona (de la agenda o de su registro). */
  ad: string;
  campania: string;
  objecion: string;
  facturado: number;
  cobrado: number;
}

export const COLUMNAS_AGENDAS: ColumnaTabla<FilaAgenda>[] = [
  { titulo: "Agendó el", ancho: 17, formato: "fechaHora", valor: (f) => f.a.agendadaEn, total: (fs) => fs.length },
  { titulo: "Llamada", ancho: 17, formato: "fechaHora", valor: (f) => f.a.llamada },
  { titulo: "Persona", ancho: 26, valor: (f) => f.a.nombre },
  { titulo: "Email", ancho: 28, valor: (f) => f.t?.email },
  { titulo: "Teléfono", ancho: 18, valor: (f) => f.t?.telefono },
  { titulo: "País", ancho: 16, valor: (f) => f.t?.pais },
  { titulo: "Vía", ancho: 13, valor: (f) => NOMBRE_VIA[f.a.via] },
  { titulo: "Link", ancho: 16, valor: (f) => f.a.link ?? "" },
  { titulo: "Cuándo agendó", ancho: 14, valor: (f) => (f.a.momento === "vivo" ? "En el vivo" : "Después") },
  { titulo: "Closer", ancho: 18, valor: (f) => f.t?.closer || f.a.closer },
  { titulo: "Estado Pre-Call", ancho: 18, valor: (f) => f.t?.estadoPreCall },
  { titulo: "Estado de Llamada", ancho: 24, valor: (f) => f.t?.estadoLlamada || f.t?.aviso || f.a.estado },
  { titulo: "Cancelada", ancho: 11, formato: "si-no", valor: (f) => f.a.cancelada },
  { titulo: "Califica", ancho: 10, formato: "si-no", valor: (f) => f.a.calificada },
  { titulo: "Puede invertir", ancho: 30, valor: (f) => f.t?.inversion },
  { titulo: "Inglés", ancho: 24, valor: (f) => f.t?.ingles },
  { titulo: "Formación", ancho: 24, valor: (f) => f.t?.formacion.join(", ") },
  { titulo: "Objeción", ancho: 22, valor: (f) => f.objecion },
  { titulo: "¿Hizo oferta?", ancho: 12, valor: (f) => f.t?.oferta },
  { titulo: "Venta", ancho: 26, valor: (f) => f.t?.venta },
  { titulo: "Facturado", ancho: 14, formato: "moneda", valor: (f) => f.facturado, total: (fs) => redondear(fs.reduce((a, f) => a + f.facturado, 0)) },
  { titulo: "Cobrado", ancho: 14, formato: "moneda", valor: (f) => f.cobrado, total: (fs) => redondear(fs.reduce((a, f) => a + f.cobrado, 0)) },
  { titulo: "Anuncio", ancho: 30, valor: (f) => f.ad },
  { titulo: "Ángulo", ancho: 26, valor: (f) => anguloDe(f.ad) },
  { titulo: "Campaña", ancho: 28, valor: (f) => f.campania },
  { titulo: "UTMs", ancho: 40, valor: (f) => f.a.utm },
  { titulo: "Notas", ancho: 36, valor: (f) => f.t?.notas },
];

/* ---------- Hoja 3: los anuncios ---------- */

export interface FilaAnuncio {
  anuncio: string;
  campanias: string[];
  /* Lo de Meta, de las campañas del webinar. */
  gasto: number;
  impresiones: number;
  clicks: number;
  leadsMeta: number;
  /* Lo nuestro, atribuido por el nombre del anuncio. */
  registros: number;
  agendas: number;
  calificadas: number;
  ventas: number;
  facturado: number;
  cobrado: number;
  objeciones: string;
}

const COLUMNAS_ANUNCIOS: ColumnaTabla<FilaAnuncio>[] = [
  { titulo: "Anuncio", ancho: 36, valor: (f) => f.anuncio },
  { titulo: "Campaña", ancho: 34, valor: (f) => f.campanias.join(" · ") },
  { titulo: "Gasto", ancho: 13, formato: "moneda", valor: (f) => f.gasto, total: (fs) => redondear(fs.reduce((a, f) => a + f.gasto, 0)) },
  { titulo: "Impresiones", ancho: 13, formato: "entero", valor: (f) => f.impresiones, total: (fs) => fs.reduce((a, f) => a + f.impresiones, 0) },
  { titulo: "Clicks", ancho: 10, formato: "entero", valor: (f) => f.clicks, total: (fs) => fs.reduce((a, f) => a + f.clicks, 0) },
  { titulo: "Leads según Meta", ancho: 12, formato: "entero", valor: (f) => f.leadsMeta, total: (fs) => fs.reduce((a, f) => a + f.leadsMeta, 0) },
  { titulo: "Costo por lead", ancho: 13, formato: "moneda", valor: (f) => dividir(f.gasto, f.leadsMeta), total: (fs) => dividir(fs.reduce((a, f) => a + f.gasto, 0), fs.reduce((a, f) => a + f.leadsMeta, 0)) },
  { titulo: "Registros (nuestros)", ancho: 13, formato: "entero", valor: (f) => f.registros, total: (fs) => fs.reduce((a, f) => a + f.registros, 0) },
  { titulo: "Agendas", ancho: 10, formato: "entero", valor: (f) => f.agendas, total: (fs) => fs.reduce((a, f) => a + f.agendas, 0) },
  { titulo: "Costo por agenda", ancho: 13, formato: "moneda", valor: (f) => dividir(f.gasto, f.agendas), total: (fs) => dividir(fs.reduce((a, f) => a + f.gasto, 0), fs.reduce((a, f) => a + f.agendas, 0)) },
  { titulo: "Agendas calificadas", ancho: 13, formato: "entero", valor: (f) => f.calificadas, total: (fs) => fs.reduce((a, f) => a + f.calificadas, 0) },
  { titulo: "Ventas", ancho: 9, formato: "entero", valor: (f) => f.ventas, total: (fs) => fs.reduce((a, f) => a + f.ventas, 0) },
  { titulo: "Costo por venta", ancho: 13, formato: "moneda", valor: (f) => dividir(f.gasto, f.ventas), total: (fs) => dividir(fs.reduce((a, f) => a + f.gasto, 0), fs.reduce((a, f) => a + f.ventas, 0)) },
  { titulo: "Facturado", ancho: 14, formato: "moneda", valor: (f) => f.facturado, total: (fs) => redondear(fs.reduce((a, f) => a + f.facturado, 0)) },
  { titulo: "Cobrado", ancho: 14, formato: "moneda", valor: (f) => f.cobrado, total: (fs) => redondear(fs.reduce((a, f) => a + f.cobrado, 0)) },
  { titulo: "ROAS on CC", ancho: 11, formato: "decimal", valor: (f) => dividir(f.cobrado, f.gasto), total: (fs) => dividir(fs.reduce((a, f) => a + f.cobrado, 0), fs.reduce((a, f) => a + f.gasto, 0)) },
  { titulo: "Objeciones", ancho: 34, valor: (f) => f.objeciones },
];

/* ---------- Armar las tres tablas ---------- */

export interface InformeWebinar {
  /* "Resumen webinar 23-09-2026 - Título.xlsx" */
  nombreArchivo: string;
  personas: TablaInforme<FilaPersona>;
  agendas: TablaInforme<FilaAgenda>;
  anuncios: TablaInforme<FilaAnuncio>;
}

const dma = (dia: string) => dia.split("-").reverse().join("-");
const sinCaracteresDeArchivo = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

/** Cuánto se facturó y cobró de cada venta (las canceladas no cuentan). */
function plataPorVenta(e: EstadoApp): Map<string, { facturado: number; cobrado: number }> {
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const cobrado = new Map<string, number>();
  for (const p of e.pagos) {
    const v = ventaDeCuota.get(p.cuotaId);
    if (v) cobrado.set(v, (cobrado.get(v) ?? 0) + p.monto);
  }
  return new Map(e.ventas.filter((v) => v.estado !== "cancelada")
    .map((v) => [v.id, { facturado: v.precioAcordado, cobrado: cobrado.get(v.id) ?? 0 }] as const));
}

export function informeDelWebinar(e: EstadoApp, webinar: Webinar): InformeWebinar {
  const w = numerosDelWebinar(e, webinar);
  const dia = diaDeNegocio(w.fecha);
  const contactos = new Map(e.contactos.map((c) => [c.id, c] as const));
  const plata = plataPorVenta(e);

  /* --- Las agendas del lanzamiento, con la fila del CRM de cada una --- */
  const delLanzamiento = agendasDelLanzamiento(e, webinar);
  const filasCrm = new Map(filasTabla(e).map((t) => [t.sesion.id, t] as const));
  const sesiones = new Map(e.sesiones.map((s) => [s.id, s] as const));
  const agendas: FilaAgenda[] = [...delLanzamiento]
    .sort((a, b) => Date.parse(a.agendadaEn) - Date.parse(b.agendadaEn))
    .map((a) => {
      const t = filasCrm.get(a.id);
      const v = t?.fila.venta ? plata.get(t.fila.venta.id) : undefined;
      const sesion = sesiones.get(a.id);
      const { ad, campania } = t ? { ad: t.ad, campania: t.campania } : adDe(sesion ?? {}, contactos.get(a.contactoId ?? ""));
      return { a, t, ad, campania, objecion: t?.objecion ?? sesion?.objecion ?? "", facturado: v?.facturado ?? 0, cobrado: v?.cobrado ?? 0 };
    });

  /* --- La gente --- */
  const agendasPorPersona = new Map<string, AgendaDelWebinar[]>();
  for (const a of delLanzamiento) if (a.contactoId) agendasPorPersona.set(a.contactoId, [...(agendasPorPersona.get(a.contactoId) ?? []), a]);
  const personas: FilaPersona[] = personasDeWebinar(e, webinar.id).map((p) => {
    const c = p.contactoId ? contactos.get(p.contactoId) : undefined;
    const registro = registroDe(c, webinar.id);
    const suyas = (p.contactoId ? agendasPorPersona.get(p.contactoId) ?? [] : [])
      .sort((x, y) => Date.parse(x.agendadaEn) - Date.parse(y.agendadaEn));
    const ultima = [...suyas].reverse().find((a) => !a.cancelada) ?? suyas[suyas.length - 1];
    const crm = ultima ? filasCrm.get(ultima.id) : undefined;
    /* Lo que contestó: el registro y, si el formulario no preguntó, la agenda. */
    const respuestas = registro?.respuestas.length ? registro.respuestas : (crm?.sesion.respuestas ?? []);
    const { ad, campania } = registro?.utm
      ? adDe({ utm: registro.utm }, null)
      : { ad: registro?.anuncio ?? "", campania: registro?.campania ?? "" };
    const deAgenda = crm ? { ad: crm.ad, campania: crm.campania } : { ad: "", campania: "" };
    const anuncio = ad || deAgenda.ad || (c?.origenAdId ? e.ads.find((x) => x.id === c.origenAdId)?.nombre ?? "" : "");
    return {
      p, registro, agendas: suyas,
      anuncio, campania: campania || deAgenda.campania,
      respuestas,
      califica: ultima ? ultima.calificada : respuestas.length ? evaluarRegistro(respuestas).calificada : undefined,
      closer: crm?.closer ?? ultima?.closer ?? "",
      estado: crm?.estadoLlamada || crm?.aviso || ultima?.estado || "",
      ventas: p.ventas.filter((v) => v.estado !== "cancelada").length,
    };
  }).sort((a, b) => (a.registro?.creado || a.p.entro || "").localeCompare(b.registro?.creado || b.p.entro || ""));

  /* --- Los anuncios: Meta por un lado y lo nuestro por el otro, unidos por el nombre --- */
  const filasAd = new Map<string, FilaAnuncio & { nombres: Map<string, number>; objs: Map<string, number>; ventasVistas: Set<string> }>();
  const deAd = (nombre: string) => {
    const k = nombre ? claveAd(nombre) : "";
    let f = filasAd.get(k);
    if (!f) {
      f = {
        anuncio: nombre || SIN_ANUNCIO, campanias: [], gasto: 0, impresiones: 0, clicks: 0, leadsMeta: 0,
        registros: 0, agendas: 0, calificadas: 0, ventas: 0, facturado: 0, cobrado: 0, objeciones: "",
        nombres: new Map(), objs: new Map(), ventasVistas: new Set(),
      };
      filasAd.set(k, f);
    }
    /* El nombre que se muestra: el más usado entre los que llegaron. */
    if (nombre) {
      f.nombres.set(nombre, (f.nombres.get(nombre) ?? 0) + 1);
      f.anuncio = [...f.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    return f;
  };
  const adsPorId = new Map(e.ads.map((a) => [a.id, a] as const));
  const campaniaPorId = new Map(e.campaigns.map((c) => [c.id, c.nombre] as const));
  for (const { insight: i } of insightsDelWebinar(e, webinar)) {
    const ad = adsPorId.get(i.adId);
    if (!ad) continue;
    const f = deAd(ad.nombre);
    const camp = campaniaPorId.get(ad.campaignId) ?? "";
    if (camp && !f.campanias.includes(camp)) f.campanias.push(camp);
    f.gasto += i.inversion; f.impresiones += i.impresiones; f.clicks += i.clicks; f.leadsMeta += i.leads;
  }
  for (const f of personas) if (f.registro) deAd(f.anuncio).registros++;
  for (const fa of agendas) {
    if (fa.a.cancelada) continue;
    const f = deAd(fa.ad);
    f.agendas++;
    if (fa.a.calificada) f.calificadas++;
    if (fa.objecion) f.objs.set(fa.objecion, (f.objs.get(fa.objecion) ?? 0) + 1);
    const vid = fa.t?.fila.venta?.id;
    /* Una venta se cuenta una vez aunque la persona tenga dos agendas. */
    if (vid && plata.has(vid) && !f.ventasVistas.has(vid)) {
      f.ventasVistas.add(vid);
      f.ventas++; f.facturado += fa.facturado; f.cobrado += fa.cobrado;
    }
  }
  const anuncios: FilaAnuncio[] = [...filasAd.values()]
    .map(({ nombres: _n, objs, ventasVistas: _v, ...f }) => ({
      ...f,
      gasto: redondear(f.gasto), facturado: redondear(f.facturado), cobrado: redondear(f.cobrado),
      objeciones: [...objs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([o, n]) => `${o} (${n})`).join(", "),
    }))
    .sort((a, b) => b.gasto - a.gasto || b.agendas - a.agendas || a.anuncio.localeCompare(b.anuncio, "es"));

  /* --- El resumen de arriba de la primera hoja --- */
  const m = metricasDeWebinar(e, webinar);
  const vias = rendimientoPorVia(e, webinar);
  const resumen: BloqueResumen[] = [
    {
      titulo: "Plata",
      filas: [
        { etiqueta: "Inversión total", valor: m.inversionTotal, formato: "moneda", nota: "Pauta + DM Ads + WhatsApp API." },
        { etiqueta: "   Pauta de captación", valor: w.inversion, formato: "moneda", nota: "Lo cargado a mano; si está en cero, lo que gastaron las campañas «[WEBINAR dd/mm]» de Meta." },
        { etiqueta: "   DM Ads", valor: w.inversionDmAds, formato: "moneda", nota: "Lo cargado a mano; si está en cero, las campañas «DM …» de Meta de los días previos." },
        { etiqueta: "   WhatsApp API", valor: w.costoWhatsappApi, formato: "moneda", nota: "Lo cargado a mano." },
        { etiqueta: "Facturado (Revenue)", valor: m.facturado, formato: "moneda", nota: "Suma del precio acordado de las ventas del webinar (sin las canceladas)." },
        { etiqueta: "Cobrado (Cash Collected)", valor: m.cobrado, formato: "moneda", nota: "Suma de los cobros que ya entraron de esas ventas." },
        { etiqueta: "ROAS on Revenue", valor: redondear(m.roasRev), formato: "decimal", nota: "Facturado ÷ Inversión total." },
        { etiqueta: "ROAS on CC", valor: redondear(m.roasCC), formato: "decimal", nota: "Cobrado ÷ Inversión total." },
        { etiqueta: "Profit on Cash Collected (CC)", valor: redondear(m.beneficioCC), formato: "moneda", nota: "Cobrado − inversión − comisiones − costo de procesadores − gastos cargados al webinar." },
      ],
    },
    {
      titulo: "Embudo",
      filas: [
        { etiqueta: "Formularios", valor: m.formularios, formato: "entero", nota: "Cargado a mano o contado solo desde los registros de la landing y los formularios de Meta." },
        { etiqueta: "Se unieron al grupo", valor: m.grupoWpp, formato: "entero", nota: "Cargado a mano." },
        { etiqueta: "Asistieron al vivo", valor: m.asistentes, formato: "entero", nota: "Vistas del vivo en YouTube, o lo cargado a mano." },
        { etiqueta: "Llamadas agendadas", valor: m.llamadas, formato: "entero", nota: "Las agendadas en el vivo + las de después (sin canceladas)." },
        { etiqueta: "Llamadas calificadas", valor: m.llamadasCalificadas, formato: "entero", nota: "Pueden invertir 1000 USD o más, inglés conversacional y carrera." },
        { etiqueta: "Ventas", valor: m.ventas, formato: "entero", nota: "Ventas del webinar, sin las canceladas." },
        { etiqueta: "Costo por formulario", valor: dividir(m.inversionTotal, m.formularios), formato: "moneda", nota: "Inversión total ÷ formularios." },
        { etiqueta: "Costo por llamada agendada", valor: dividir(m.inversionTotal, m.llamadas), formato: "moneda", nota: "Inversión total ÷ llamadas agendadas." },
        { etiqueta: "Costo por llamada calificada", valor: dividir(m.inversionTotal, m.llamadasCalificadas), formato: "moneda", nota: "Inversión total ÷ llamadas calificadas." },
        { etiqueta: "CPA (costo por venta)", valor: dividir(m.inversionTotal, m.ventas), formato: "moneda", nota: "Inversión total ÷ ventas." },
        { etiqueta: "Tasa de cierre", valor: m.tasaCierre / 100, formato: "porcentaje", nota: "Ventas ÷ llamadas calificadas." },
      ],
    },
    {
      titulo: "Rendimiento por vía de agenda",
      filas: [
        ...vias.grupos.flatMap((g) => g.filas.map((f) => ({
          etiqueta: `${NOMBRE_VIA[g.via]} · ${NOMBRE_LINK[g.via][f.link]}`,
          valor: f.n.agendas, formato: "entero" as const,
          nota: `agendas; ${f.n.calificadas} calificadas, ${f.n.canceladas} canceladas, ${f.n.ventas} ventas (facturado ${f.n.facturado}, cobrado ${f.n.cobrado}).`,
        }))),
        { etiqueta: "Ventas de gente que no agendó por un link del lanzamiento", valor: vias.sinAgenda.ventas, formato: "entero", nota: `facturado ${vias.sinAgenda.facturado}, cobrado ${vias.sinAgenda.cobrado}.` },
      ],
    },
  ];

  const titulo = w.titulo || "Webinar";
  return {
    nombreArchivo: `${sinCaracteresDeArchivo(`Resumen webinar ${dma(dia)} ${titulo}`)}.xlsx`,
    personas: {
      nombre: "Personas", titulo: `${titulo} · ${dma(dia)}`,
      subtitulo: "Hoja 1 de 3. Quién se registró al webinar, qué contestó, si agendó y si compró. Las fechas son en hora de Argentina.",
      bloques: resumen, columnas: COLUMNAS_PERSONAS, filas: personas, etiquetaTotal: "Total", colorPestania: "3B3A8F",
      sinFilas: "Todavía no hay personas atadas a este webinar.",
    },
    agendas: {
      nombre: "Agendas", titulo: `${titulo} · ${dma(dia)}`,
      subtitulo: "Hoja 2 de 3. Cada agenda del lanzamiento (el webinar, su clase cero y su Q&A) y qué pasó con ella. Sin las que se sacaron a mano del webinar.",
      columnas: COLUMNAS_AGENDAS, filas: agendas, etiquetaTotal: "Total", colorPestania: "1A7F5A",
      sinFilas: "Todavía no hay agendas de Calendly con los links de este webinar.",
    },
    anuncios: {
      nombre: "Anuncios", titulo: `${titulo} · ${dma(dia)}`,
      subtitulo: "Hoja 3 de 3. Gasto de Meta de las campañas del webinar cruzado con lo nuestro, por nombre de anuncio. «Sin anuncio identificado» junta lo que no vino de un anuncio o no dice cuál.",
      columnas: COLUMNAS_ANUNCIOS, filas: anuncios, etiquetaTotal: "Total", colorPestania: "B7791F",
      sinFilas: "No hay anuncios de las campañas «[WEBINAR dd/mm]» de este webinar: ¿está conectada la cuenta de Meta?",
    },
  };
}

/** Las tres hojas, listas para escribir. */
export const hojasDelInforme = (i: InformeWebinar): HojaXlsx[] => [hojaDeTabla(i.personas), hojaDeTabla(i.agendas), hojaDeTabla(i.anuncios)];

/** El Excel del informe, con sus tres hojas. */
export async function excelDelInforme(e: EstadoApp, webinar: Webinar) {
  const informe = informeDelWebinar(e, webinar);
  const datos = await escribirXlsx({ hojas: hojasDelInforme(informe) });
  return { nombre: informe.nombreArchivo, datos, informe };
}
