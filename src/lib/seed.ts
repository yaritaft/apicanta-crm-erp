import type {
  Actividad, Ajustes, Alumno, Campania, CampoPersonalizado, Cuota, Embudo, EstadoApp,
  Etapa, Gasto, Lead, Meta, MiembroEquipo, Movimiento, Pago, Procesador, Producto,
  Reporte, Sesion, Venta, Webinar,
} from "./types";
import type { EtapaServicio } from "./types";
import { inicioSemana, mesClave } from "./format";

/* PRNG determinístico: los datos de ejemplo son siempre los mismos. */
function rng(semilla: number) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const r = rng(20260918);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const entre = (a: number, b: number) => Math.round(a + r() * (b - a));
const id = (p: string, i: number) => `${p}_${String(i).padStart(4, "0")}`;


/* ---------- Catálogos: los valores reales del negocio ---------- */

/* Los "Servicios / Productos" de la planilla de Angelo, con los mismos
   nombres y en el mismo orden (hoja Configuración). La planilla no tiene
   precios de lista: los seis que ya estaban conservan el suyo y el resto
   lleva el valor más común con el que se vendió. El tipo es de la app (lo
   usa el Dashboard para contar mentorías aparte de downsells y eventos) y
   se cambia en Ajustes → Ventas. */
export const PRODUCTOS: Producto[] = [
  { id: "prod_mentoria",          nombre: "Mentoría",                    precioLista: 3000, tipo: "principal", activo: true, orden: 0 },
  { id: "prod_downsell",          nombre: "Downsell",                    precioLista: 500,  tipo: "downsell",  activo: true, orden: 1 },
  { id: "prod_resultados",        nombre: "Resultados",                  precioLista: 299,  tipo: "downsell",  activo: true, orden: 2 },
  { id: "prod_resell",            nombre: "Resell Mentoría",             precioLista: 2500, tipo: "principal", activo: true, orden: 3 },
  { id: "prod_mastermind",        nombre: "Mastermind",                  precioLista: 400,  tipo: "evento",    activo: true, orden: 4 },
  { id: "prod_prueba",            nombre: "Prueba",                      precioLista: 0,    tipo: "evento",    activo: true, orden: 5 },
  { id: "prod_cena_premaster",    nombre: "Cena - Pre Master",           precioLista: 50,   tipo: "evento",    activo: true, orden: 6 },
  { id: "prod_resell_mastermind", nombre: "Resell Mastermind Mayo 2026", precioLista: 2150, tipo: "evento",    activo: true, orden: 7 },
  { id: "prod_upsell",            nombre: "Upsell",                      precioLista: 800,  tipo: "upsell",    activo: true, orden: 8 },
  { id: "prod_cena",              nombre: "Cena",                        precioLista: 70,   tipo: "evento",    activo: true, orden: 9 },
  { id: "prod_biz",               nombre: "Hackear Biz",                 precioLista: 4500, tipo: "principal", activo: true, orden: 10 },
  { id: "prod_hackear_ai",        nombre: "Hackear AI",                  precioLista: 3000, tipo: "principal", activo: true, orden: 11 },
  { id: "prod_hackear_it",        nombre: "Hackear IT",                  precioLista: 3000, tipo: "principal", activo: true, orden: 12 },
  { id: "prod_principals",        nombre: "Principals",                  precioLista: 0,    tipo: "principal", activo: true, orden: 13 },
  { id: "prod_upgrade_ai",        nombre: "Upgrade AI",                  precioLista: 499,  tipo: "upsell",    activo: true, orden: 14 },
];

/* Las "Cuentas recaudadoras" de la planilla de Angelo, con sus nombres y
   en su orden. `automatico` es si el cobro puede entrar solo: por webhook o
   porque se le puede preguntar a la plataforma. La tasa es la que cobra
   cada una de verdad; cuando el cobro se concilia manda el fee real de la
   pasarela, y el de los medios que no se concilian se carga en Finanzas. */
export const PROCESADORES: Procesador[] = [
  { id: "proc_financiera_ars",   nombre: "Financiera ARS Juan", feeRate: 0,     activo: true, automatico: false, moneda: "ARS" },
  { id: "proc_financiera_usd",   nombre: "Financiera USD Juan", feeRate: 0,     activo: true, automatico: false },
  { id: "proc_stripe",           nombre: "Stripe",              feeRate: 0.029, activo: true, automatico: true,  proveedor: "stripe" },
  { id: "proc_mercury",          nombre: "ACH-WIRE Mercury",    feeRate: 0,     activo: true, automatico: true,  proveedor: "mercury" },
  { id: "proc_binance",          nombre: "USDT Binance",        feeRate: 0,     activo: true, automatico: true,  proveedor: "binance" },
  { id: "proc_dlocal",           nombre: "Dlocal",              feeRate: 0.050, activo: true, automatico: true,  proveedor: "dlocal" },
  { id: "proc_trust",            nombre: "USDT Trust",          feeRate: 0,     activo: true, automatico: true,  proveedor: "trust" },
  { id: "proc_mercadopago",      nombre: "Mercado Pago Yari",   feeRate: 0.062, activo: true, automatico: true,  proveedor: "mercadopago", moneda: "ARS" },
  { id: "proc_galicia_ars",      nombre: "Galicia (ARS)",       feeRate: 0,     activo: true, automatico: false, moneda: "ARS" },
  { id: "proc_galicia_usd",      nombre: "Galicia (USD)",       feeRate: 0,     activo: true, automatico: false },
  { id: "proc_hotmart",          nombre: "Hotmart",             feeRate: 0.099, activo: true, automatico: true,  proveedor: "hotmart" },
  { id: "proc_efectivo",         nombre: "Efectivo USD",        feeRate: 0,     activo: true, automatico: false },
  { id: "proc_whop",             nombre: "Whop",                feeRate: 0.030, activo: true, automatico: true,  proveedor: "whop" },
];

/* Las "Estrategias utilizadas" de la planilla de Angelo. "Lanzamiento" es
   el embudo de los webinars (todas las ventas con proyecto WEB-… vienen de
   ahí): conserva el id del viejo "Webinar" para que lo que ya apuntaba al
   embudo de webinar siga apuntando al mismo. */
export const EMBUDOS: Embudo[] = [
  { id: "emb_webinar",        nombre: "Lanzamiento",       activo: true, orden: 0, esWebinar: true },
  { id: "emb_vsl_martin",     nombre: "VSL Martin",        activo: true, orden: 1 },
  { id: "emb_vsl_landing",    nombre: "VSL Landing",       activo: true, orden: 2 },
  { id: "emb_setter",         nombre: "Setter",            activo: true, orden: 3 },
  { id: "emb_organico",       nombre: "Orgánico",          activo: true, orden: 4 },
  { id: "emb_venta_interna",  nombre: "Venta interna",     activo: true, orden: 5 },
  { id: "emb_referido",       nombre: "Referido",          activo: true, orden: 6 },
  { id: "emb_aon",            nombre: "AON",               activo: true, orden: 7 },
  { id: "emb_prueba",         nombre: "Prueba",            activo: true, orden: 8 },
  { id: "emb_cena_premaster", nombre: "CENA - PRE MASTER", activo: true, orden: 9 },
  { id: "emb_mastermind",     nombre: "Mastermind",        activo: true, orden: 10 },
  { id: "emb_cena_colombia",  nombre: "Cena Colombia",     activo: true, orden: 11 },
  { id: "emb_vsl_youtube",    nombre: "VSL YOUTUBE",       activo: true, orden: 12 },
  { id: "emb_funnel_angie",   nombre: "Funnel-Angie",      activo: true, orden: 13 },
  { id: "emb_vsl_wp",         nombre: "VSL-WP",            activo: true, orden: 14 },
];

/* Los "Vendedores" y "Setters" de la planilla de Angelo, con sus nombres.
   Los porcentajes de los closers son los de su hoja Config (sobre el neto
   de procesador); los que no figuran ahí llevan el 15% por defecto. */
export const EQUIPO: MiembroEquipo[] = [
  { id: "eq_yari",     nombre: "Yari",               rol: "ceo",      comisionRate: 0,    activo: true, sinComision: true,
    notas: "Cuando figura como closer no comisiona nadie: ni closer, ni director, ni setter." },
  { id: "eq_director", nombre: "Director comercial", rol: "director", comisionRate: 0.05, activo: true, sinComision: false,
    desde: "2026-07-01T12:00:00.000Z", notas: "5% del cash collected neto de procesador." },
  { id: "eq_mariano",         nombre: "Mariano",         rol: "closer", comisionRate: 0.15, activo: true, sinComision: false },
  { id: "eq_valentin",        nombre: "Valentín",        rol: "closer", comisionRate: 0.15, activo: true, sinComision: false },
  { id: "eq_marianela",       nombre: "Marianela",       rol: "closer", comisionRate: 0.15, activo: true, sinComision: false },
  { id: "eq_martin",          nombre: "Martín",          rol: "closer", comisionRate: 0.10, activo: true, sinComision: false },
  { id: "eq_dante",           nombre: "Dante Barbieri",  rol: "closer", comisionRate: 0.10, activo: true, sinComision: false },
  { id: "eq_valentin_abadia", nombre: "Valentin Abadia", rol: "closer", comisionRate: 0.15, activo: true, sinComision: false },
  { id: "eq_daniel",          nombre: "Daniel",          rol: "setter", comisionRate: 0.10, activo: true, sinComision: false,
    notas: "10% de lo que entra en las ventas que agendó (Configuración de la planilla)." },
  { id: "eq_growth",   nombre: "Agustín Zika",   rol: "growth",   comisionRate: 0.10, activo: true, sinComision: false,
    notas: "10% del profit. No comisiona las ventas marcadas como excluidas de marketing." },
  { id: "eq_socio",    nombre: "Socio",          rol: "socio",    comisionRate: 0.10, activo: true, sinComision: false,
    notas: "10% del profit. Comisiona distinto según producto: falta definir." },
];

/* Una categoría de gasto y el renglón del P&L en el que cae. */
export interface CategoriaGasto {
  categoria: string;
  grupo: Gasto["grupo"];
  /* Lo que se lee debajo de la tarjeta al elegirla. */
  ayuda?: string;
  /* Palabras que, si aparecen en lo que se pagó, sugieren esta categoría.
     Sin tildes y en minúscula: se comparan contra el texto normalizado. */
  claves?: string[];
}

/* Las categorías del estado de resultados de Yari, en el orden de su
   planilla (hojas "Gastos_vieja" y "Dashboard P&L").

   - Los nombres que ya existían quedan tal cual aunque la planilla diga
     otra cosa ("META ADS", "Consultoría Personalizada"): los gastos se
     agrupan por este texto, y renombrar parte en dos la historia de una
     categoría. "Meta Ads", "Google Ads" y "TikTok Ads" además arman la
     inversión en publicidad del ROAS y el CAC.
   - Closers y director NO están: el ERP los calcula solo desde los
     cobros. Cargarlos como gasto los contaría dos veces.
   - La hoja nueva de gastos agrupa distinto (Software, Equipo, ADS) y
     parte Equipo en fijo, variable y bonus: eso es el "fijo / variable"
     de cada gasto, no una categoría aparte. */
export const CATEGORIAS_GASTO: CategoriaGasto[] = [
  /* Costos directos: restan antes de la utilidad bruta */
  { categoria: "Setters",                    grupo: "directo",   ayuda: "Lo que cobran los setters", claves: ["setter"] },
  { categoria: "Comisiones Financieras",     grupo: "directo",   ayuda: "Lo que cobra la financiera por los cobros en cuotas", claves: ["financiera"] },
  { categoria: "Facturas Stripe",            grupo: "directo",   ayuda: "Lo que cobra Stripe por facturar", claves: ["stripe"] },
  { categoria: "Emisión factura Financiera", grupo: "directo",   ayuda: "Lo que cuesta facturar por la financiera", claves: ["factura financiera", "facturacion financiera", "emision"] },
  { categoria: "Referidores",                grupo: "directo",   ayuda: "Comisión por clientes referidos", claves: ["referid"] },
  /* Gastos operativos */
  { categoria: "Equipo / Salarios",          grupo: "operativo", ayuda: "Sueldos del equipo no comercial: fijos, variables y bonus", claves: ["sueldo", "salario", "equipo", "bonus", "nomina"] },
  { categoria: "Contador",                   grupo: "operativo", ayuda: "Contaduría de la LLC", claves: ["contador", "contable", "contadur"] },
  { categoria: "Software",                   grupo: "operativo", ayuda: "Herramientas y suscripciones", claves: ["software", "suscripcion", "licencia", "zoom", "notion", "calendly", "vercel", "supabase", "slack", "chatgpt", "openai", "claude", "canva", "manychat", "whatsapp api", "workspace", "hosting", "dominio"] },
  { categoria: "Meta Ads",                   grupo: "operativo", ayuda: "Pauta en Facebook e Instagram", claves: ["meta", "facebook", "instagram", "pauta", "dm ads"] },
  { categoria: "Google Ads",                 grupo: "operativo", ayuda: "Pauta en Google y YouTube", claves: ["google ads", "adwords", "youtube ads"] },
  { categoria: "TikTok Ads",                 grupo: "operativo", ayuda: "Pauta en TikTok", claves: ["tiktok"] },
  { categoria: "Consultoría",                grupo: "operativo", ayuda: "Consultoría personalizada", claves: ["consultor"] },
  { categoria: "Agencia de Marketing",       grupo: "operativo", ayuda: "La agencia que lleva la pauta o el contenido", claves: ["agencia"] },
  { categoria: "Reembolsos",                 grupo: "operativo", ayuda: "Plata devuelta a clientes", claves: ["reembols", "devolucion", "refund"] },
  { categoria: "Edición de contenido",       grupo: "operativo", ayuda: "Edición de videos y contenido", claves: ["edicion", "editor"] },
  { categoria: "Filmmaker",                  grupo: "operativo", ayuda: "Grabaciones", claves: ["filmmaker", "filmaker", "grabacion", "camarografo"] },
  { categoria: "Mantenimiento LLC",          grupo: "operativo", ayuda: "Tener la LLC al día", claves: ["llc", "registered agent", "franchise"] },
  { categoria: "Gastos de evento",           grupo: "operativo", ayuda: "Producción de eventos: Mastermind, cenas", claves: ["evento", "mastermind", "cena", "salon"] },
  { categoria: "Viáticos equipo",            grupo: "operativo", ayuda: "Pasajes, hoteles y traslados", claves: ["viatico", "pasaje", "vuelo", "hotel", "uber", "traslado"] },
  { categoria: "Formaciones",                grupo: "operativo", ayuda: "Cursos y capacitaciones", claves: ["formacion", "curso", "capacitacion"] },
  { categoria: "Producción audiovisual",     grupo: "operativo", ayuda: "Estudio, equipos y producción de video", claves: ["audiovisual", "estudio"] },
  { categoria: "Comisiones bancarias",       grupo: "operativo", ayuda: "Costos de transferencias y bancos", claves: ["bancari", "banco", "wire", "transferencia", "fee transaction"] },
  { categoria: "Pendiente de revisión",      grupo: "operativo", ayuda: "Lo que todavía no sabés dónde va: revisalo después" },
  /* Honorarios del dueño: después del resultado operativo */
  { categoria: "Honorarios del CEO",         grupo: "dueno",     ayuda: "Lo que se paga el dueño", claves: ["honorario", "ceo"] },
];

const HOY = new Date();
const dias = (n: number) => {
  const d = new Date(HOY);
  d.setDate(d.getDate() + n);
  return d;
};
const iso = (d: Date) => d.toISOString();

export const ETAPAS: Etapa[] = [
  { id: "et_nuevo", nombre: "Nuevo", variante: "info", probabilidad: 10, orden: 0 },
  { id: "et_contactado", nombre: "Contactado", variante: "brand", probabilidad: 25, orden: 1 },
  { id: "et_sesion", nombre: "Sesión agendada", variante: "accent", probabilidad: 50, orden: 2 },
  { id: "et_propuesta", nombre: "Propuesta", variante: "warning", probabilidad: 70, orden: 3 },
  { id: "et_inscripto", nombre: "Inscripto", variante: "success", probabilidad: 100, esGanada: true, orden: 4 },
  { id: "et_perdido", nombre: "Perdido", variante: "danger", probabilidad: 0, esPerdida: true, orden: 5 },
];

/* El pipeline de servicio: el camino de un alumno desde que compra hasta que
   termina. Los ids son fijos porque supabase/alumnos-servicio.sql siembra
   estas mismas: la base y la semilla tienen que hablar de las mismas etapas. */
export const ETAPAS_SERVICIO: EtapaServicio[] = [
  { id: "ets_nueva",      nombre: "Venta nueva",       color: "info",    orden: 0, creadoEn: "2026-09-22T12:00:00.000Z" },
  { id: "ets_onboarding", nombre: "Onboarding",        color: "accent",  orden: 1, creadoEn: "2026-09-22T12:00:00.000Z" },
  { id: "ets_servicio",   nombre: "En servicio",       color: "brand",   orden: 2, creadoEn: "2026-09-22T12:00:00.000Z" },
  { id: "ets_trabajo",    nombre: "Consiguió trabajo", color: "success", orden: 3, creadoEn: "2026-09-22T12:00:00.000Z" },
  { id: "ets_finalizado", nombre: "Finalizado",        color: "neutral", orden: 4, creadoEn: "2026-09-22T12:00:00.000Z" },
];

/* En qué etapa del servicio cae cada alumno de ejemplo: el que recién empezó
   está en onboarding, el que se fue o terminó en finalizado, y a los que ya
   van por el final les tocó conseguir trabajo. */
function etapaDeEjemplo(a: Alumno): string {
  if (a.estado === "baja") return "ets_finalizado";
  if (a.estado === "graduado") return r() > 0.4 ? "ets_trabajo" : "ets_finalizado";
  const dias = (HOY.getTime() - new Date(a.inicio).getTime()) / 86400000;
  if (dias < 45) return "ets_onboarding";
  if (a.progreso >= 80) return "ets_trabajo";
  return "ets_servicio";
}

export const AJUSTES: Ajustes = {
  negocio: "Hackear IT",
  responsable: "Yari Taft",
  monedaBase: "USD",
  tipoCambio: 1450,
  fuentes: ["Meta Ads", "Webinar", "Orgánico", "Referido", "YouTube", "Instagram", "LinkedIn"],
  categoriasIngreso: ["Cuotas", "Pago único", "Mentoría 1:1", "Workshop", "Afiliados"],
  categoriasEgreso: ["Publicidad", "Herramientas", "Equipo", "Impuestos", "Producción", "Otros"],
  planes: ["Hackear IT Full", "Hackear IT Express", "Mentoría 1:1"],
  tiposSesion: ["Sesión de diagnóstico", "Cierre de venta", "Onboarding", "Mentoría", "Mock interview"],
  metodosPago: ["Stripe", "PayPal", "Transferencia", "Mercado Pago", "Cripto"],
  metaAccountId: "",
  metaToken: "",
  calendlyUser: "",
  calendlyToken: "",
  tema: "dark",
  tourVisto: false,
  /* Los "Proyectos" de la planilla de Angelo, tal cual. */
  proyectos: ["MENT", "DOWN", "WEB-1/10", "WEB-29/10", "WEB-17/9", "RESULTADOS", "WEB-12/11", "WEB-26/11", "RESELL", "WEB-17/12", "WEB-27/8", "WEB-06/08", "WEB-14/01/26", "WEB-28/01/26", "WEB-09/02/26", "WEB-25/02/26", "WEB-05/03/26", "WEB-18/03/26", "WEB-30/03/26", "WEB-13/04/26", "Entrada 24/25 Mayo", "WEB-20/04/26", "WEB-27/04/26", "Prueba", "Cena", "Resell Master May-26", "Upsell", "Hackear Biz", "Principals", "RESERVA", "AI"],
  comisionReferidor: 0.1,
  reglasUtm: [],
};

const PILA_NOMBRES = [
  "Martín", "Sofía", "Lucas", "Camila", "Nicolás", "Valentina", "Tomás", "Julieta",
  "Federico", "Micaela", "Joaquín", "Agustina", "Iván", "Rocío", "Matías", "Brenda",
  "Gonzalo", "Daniela", "Franco", "Luciana", "Emiliano", "Paula", "Ramiro", "Antonella",
  "Diego", "Florencia", "Santiago", "Carla", "Bruno", "Marina", "Ezequiel", "Abril",
  "Facundo", "Guadalupe", "Leandro", "Ariana", "Maximiliano", "Belén", "Nahuel", "Melina",
];
const PILA_APELLIDOS = [
  "Quiroga", "Benítez", "Ferreyra", "Ocampo", "Bravo", "Rojas", "Aguirre", "Sandoval",
  "Paz", "Duarte", "Navarro", "Reyes", "Cardozo", "Villalba", "Peralta", "Cáceres",
  "Miranda", "Arce", "Olivera", "Godoy", "Sosa", "Maldonado", "Leiva", "Ruiz",
  "Salgado", "Ibarra", "Coronel", "Medina", "Vega", "Suárez", "Correa", "Domínguez",
  "Ríos", "Molina", "Núñez", "Castillo", "Ponce", "Acosta", "Figueroa", "Ortiz",
];

/* Combina nombre y apellido para que no se repita ninguna persona. */
const NOMBRES: string[] = (() => {
  const out: string[] = [];
  for (let k = 0; k < PILA_APELLIDOS.length; k++) {
    for (let j = 0; j < PILA_NOMBRES.length; j++) {
      out.push(`${PILA_NOMBRES[(j + k) % PILA_NOMBRES.length]} ${PILA_APELLIDOS[(j * 7 + k) % PILA_APELLIDOS.length]}`);
    }
  }
  return [...new Set(out)];
})();

const PAISES = ["Argentina", "Colombia", "México", "Chile", "Perú", "Uruguay", "Ecuador"];

function email(nombre: string, i: number) {
  const [n, a] = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" ");
  return `${n}.${a}${i % 3 === 0 ? i : ""}@gmail.com`;
}

/* ---------- Webinars ---------- */
const TITULOS_WEBINAR = [
  "Cómo conseguir tu primer trabajo remoto en USA",
  "El sistema de entrevistas que usan las big tech",
  "De LATAM a USA: pasar de $800 a $5.000 por mes",
  "Los 3 errores que te dejan afuera en la primera ronda",
  "Armá tu CV para el mercado americano",
];

export function construirSemilla(): EstadoApp {
  const webinars: Webinar[] = TITULOS_WEBINAR.map((titulo, i) => {
    const offset = [-52, -38, -24, -10, 9][i];
    const registrados = entre(220, 900);
    const futuro = offset > 0;
    const asistentes = futuro ? 0 : Math.round(registrados * (0.34 + r() * 0.2));
    const grupoWpp = futuro ? 0 : Math.round(registrados * (0.70 + r() * 0.08));
    const llamadasVivo = futuro ? 0 : Math.round(grupoWpp * (0.04 + r() * 0.04));
    const llamadasPosterior = futuro ? 0 : Math.round(llamadasVivo * (0.2 + r() * 0.4));
    const totalLlamadas = llamadasVivo + llamadasPosterior;
    return {
      id: id("web", i + 1),
      titulo,
      fecha: iso(dias(offset)),
      duracionMin: 75,
      estado: futuro ? "programado" : "finalizado",
      registrados,
      asistentes,
      inversion: entre(2800, 8500),
      formularios: registrados,
      grupoWpp,
      llamadasVivo,
      llamadasPosterior,
      llamadasCanceladas: Math.round(totalLlamadas * r() * 0.1),
      llamadasInasistidas: Math.round(totalLlamadas * (0.1 + r() * 0.15)),
      llamadasNoCalificadas: Math.round(totalLlamadas * r() * 0.12),
      llamadasCalificadas: Math.round(totalLlamadas * (0.5 + r() * 0.25)),
      inversionDmAds: futuro ? 0 : entre(120, 320),
      costoWhatsappApi: futuro ? 0 : entre(80, 260),
      enlaceRegistro: `https://hackearit.com/webinar/${i + 1}`,
      enlaceReplay: futuro ? undefined : `https://hackearit.com/replay/${i + 1}`,
      notas: "",
      creadoEn: iso(dias(offset - 21)),
      extra: {},
    };
  });

  /* ---------- Leads ---------- */
  const pesosEtapa: [string, number][] = [
    ["et_nuevo", 0.22], ["et_contactado", 0.2], ["et_sesion", 0.16],
    ["et_propuesta", 0.12], ["et_inscripto", 0.18], ["et_perdido", 0.12],
  ];
  function etapaPorPeso(): string {
    const x = r();
    let acc = 0;
    for (const [e, p] of pesosEtapa) { acc += p; if (x <= acc) return e; }
    return "et_nuevo";
  }

  const leads: Lead[] = [];
  for (let i = 0; i < 124; i++) {
    const nombre = NOMBRES[i % NOMBRES.length];
    const creado = dias(-entre(1, 95));
    const etapaId = etapaPorPeso();
    const fuente = pick(AJUSTES.fuentes);
    leads.push({
      id: id("lead", i + 1),
      nombre,
      email: email(nombre, i + 1),
      telefono: `+54 9 11 ${entre(3000, 6999)}-${entre(1000, 9999)}`,
      pais: pick(PAISES),
      fuente,
      campania: fuente === "Meta Ads" ? pick(["Remoto-USA-Frío", "Retargeting-Webinar", "Lookalike-Alumnos"]) : undefined,
      etapaId,
      monto: pick([1800, 2400, 2400, 3600, 4800]),
      moneda: "USD",
      responsable: pick(["Yari Taft", "Yari Taft", "Equipo Apicanta"]),
      notas: "",
      etiquetas: r() > 0.7 ? [pick(["prioridad", "seguimiento", "referido"])] : [],
      webinarId: fuente === "Webinar" ? pick(webinars.filter((w) => w.estado === "finalizado")).id : undefined,
      creadoEn: iso(creado),
      actualizadoEn: iso(new Date(Date.now() - entre(20, 14 * 24 * 60) * 60000)),
      extra: {},
    });
  }

  /* ---------- Alumnos (vienen de leads inscriptos) ---------- */
  const inscriptos = leads.filter((l) => l.etapaId === "et_inscripto");
  const alumnos: Alumno[] = inscriptos.map((l, i) => {
    const inicio = dias(-entre(20, 160));
    const estado = r() > 0.86 ? pick(["pausado", "graduado", "baja"] as const) : "activo";
    return {
      id: id("alu", i + 1),
      nombre: l.nombre,
      email: l.email,
      pais: l.pais,
      cohorte: `C${entre(4, 9)}`,
      plan: pick(AJUSTES.planes),
      cuotaMensual: pick([450, 600, 600, 900]),
      moneda: "USD" as const,
      estado,
      inicio: iso(inicio),
      progreso: estado === "graduado" ? 100 : entre(15, 92),
      leadId: l.id,
      notas: "",
      creadoEn: iso(inicio),
      extra: {},
    };
  });
  for (const a of alumnos) a.etapaServicioId = etapaDeEjemplo(a);

  /* ---------- Reportes semanales ---------- */
  const reportes: Reporte[] = [];
  const semanaActual = inicioSemana(HOY);
  alumnos.forEach((a, ai) => {
    for (let s = 0; s < 6; s++) {
      const semana = new Date(semanaActual);
      semana.setDate(semana.getDate() - s * 7);
      if (new Date(a.inicio) > semana) continue;
      const activo = a.estado === "activo" || a.estado === "graduado";
      const x = r();
      const estado = !activo ? "no-enviado" : s === 0 ? (x > 0.55 ? "completado" : "pendiente") : x > 0.25 ? "completado" : "vencido";
      reportes.push({
        id: id("rep", reportes.length + 1),
        alumnoId: a.id,
        semanaDel: iso(semana),
        estado,
        completadoEn: estado === "completado" ? iso(new Date(semana.getTime() + 86400000 * entre(1, 5))) : undefined,
        horasEstudio: estado === "completado" ? entre(4, 26) : undefined,
        entrevistas: estado === "completado" ? entre(0, 3) : undefined,
        postulaciones: estado === "completado" ? entre(0, 14) : undefined,
        bloqueo: estado === "completado" && r() > 0.72 ? pick(["System design", "Inglés técnico", "Algoritmos", "Ansiedad en la entrevista"]) : undefined,
      });
      void ai;
    }
  });

  /* ---------- Sesiones (agenda) ---------- */
  const sesiones: Sesion[] = [];
  const candidatos = leads.filter((l) => ["et_sesion", "et_propuesta", "et_inscripto"].includes(l.etapaId));
  candidatos.forEach((l, i) => {
    const offset = entre(-30, 12);
    const inicia = dias(offset);
    inicia.setHours(entre(9, 18), pick([0, 30]), 0, 0);
    const pasada = offset < 0;
    sesiones.push({
      id: id("ses", i + 1),
      titulo: pick(AJUSTES.tiposSesion),
      leadId: l.id,
      invitado: l.nombre,
      email: l.email,
      inicia: iso(inicia),
      duracionMin: pick([30, 45, 60]),
      estado: pasada ? (r() > 0.78 ? "no-show" : "hecha") : "agendada",
      tipo: pick(AJUSTES.tiposSesion),
      enlace: `https://calendly.com/hackearit/evento-${i + 1}`,
      origen: r() > 0.35 ? "calendly" : "manual",
      notas: "",
      creadoEn: iso(dias(offset - entre(2, 9))),
      extra: {},
    });
  });
  alumnos.slice(0, 8).forEach((a, i) => {
    const inicia = dias(entre(0, 10));
    inicia.setHours(entre(10, 19), 0, 0, 0);
    sesiones.push({
      id: id("ses", sesiones.length + 1),
      titulo: "Mentoría",
      alumnoId: a.id,
      invitado: a.nombre,
      email: a.email,
      inicia: iso(inicia),
      duracionMin: 45,
      estado: "agendada",
      tipo: "Mentoría",
      enlace: `https://calendly.com/hackearit/mentoria-${i + 1}`,
      origen: "calendly",
      notas: "",
      creadoEn: iso(dias(-entre(1, 6))),
      extra: {},
    });
  });

  sesiones.push(...agendasDeEjemplo(leads, webinars));

  /* ---------- Campañas Meta ---------- */
  const campanias: Campania[] = [
    { nombre: "Remoto-USA-Frío", objetivo: "Conversiones", estado: "activa" as const, inv: 4200 },
    { nombre: "Retargeting-Webinar", objetivo: "Conversiones", estado: "activa" as const, inv: 1650 },
    { nombre: "Lookalike-Alumnos", objetivo: "Clientes potenciales", estado: "activa" as const, inv: 2380 },
    { nombre: "Video-Testimonios", objetivo: "Reproducciones", estado: "pausada" as const, inv: 890 },
    { nombre: "Webinar-Octubre", objetivo: "Clientes potenciales", estado: "finalizada" as const, inv: 1240 },
  ].map((c, i) => {
    const impresiones = entre(90000, 420000);
    const clicks = Math.round(impresiones * (0.011 + r() * 0.02));
    return {
      id: id("camp", i + 1),
      nombre: c.nombre,
      plataforma: "Meta",
      objetivo: c.objetivo,
      estado: c.estado,
      inversion: c.inv,
      impresiones,
      clicks,
      leads: Math.round(clicks * (0.06 + r() * 0.07)),
      desde: iso(dias(-entre(40, 90))),
      hasta: c.estado === "finalizada" ? iso(dias(-12)) : undefined,
      creadoEn: iso(dias(-entre(45, 95))),
      extra: {},
    };
  });

  /* ---------- Ventas, cuotas, pagos y gastos ---------- */
  const ventas: Venta[] = [];
  const cuotas: Cuota[] = [];
  const pagos: Pago[] = [];
  const gastos: Gasto[] = [];
  let nv = 0, nc = 0, np = 0, ng = 0;

  const closers = EQUIPO.filter((x) => x.rol === "closer");
  const webinarsPasados = webinars.filter((w) => w.estado === "finalizado");

  /* Una venta por alumno, más algunas sueltas por mes */
  function crearVenta(nombre: string, cuando: Date, productoId: string, precio: number, opciones: {
    webinarId?: string; embudoId?: string; contactoId?: string; porYari?: boolean;
  } = {}) {
    const porYari = opciones.porYari ?? r() > 0.86;
    const venta: Venta = {
      id: id("ven", ++nv),
      contactoId: opciones.contactoId,
      contactoNombre: nombre,
      productoId,
      webinarId: opciones.webinarId,
      embudoId: opciones.embudoId ?? "emb_webinar",
      precioAcordado: precio,
      moneda: "USD",
      closerId: porYari ? "eq_yari" : pick(closers).id,
      directorId: porYari ? undefined : "eq_director",
      excluidoMarketing: porYari,
      estado: r() > 0.96 ? "cancelada" : "activa",
      fecha: iso(cuando),
      notas: "",
      creadoEn: iso(cuando),
      extra: {},
    };
    ventas.push(venta);

    /* Plan de cuotas: 1 a 4 pagos, a veces con reserva */
    const plan = pick([1, 1, 2, 3, 3, 4]);
    const conReserva = plan > 1 && r() > 0.5;
    const montoReserva = conReserva ? pick([200, 300, 500]) : 0;
    const resto = precio - montoReserva;
    const porCuota = Math.round(resto / plan);

    if (conReserva) {
      cuotas.push({
        id: id("cuo", ++nc), ventaId: venta.id, numero: 0, monto: montoReserva,
        vence: iso(cuando), estado: "pagada", esReserva: true,
      });
    }
    for (let k = 1; k <= plan; k++) {
      const vence = new Date(cuando);
      vence.setMonth(vence.getMonth() + (k - 1));
      const pasada = vence <= HOY;
      /* Algunas cuotas vencidas quedan impagas: eso alimenta la mora */
      const pagada = pasada && r() > 0.16;
      cuotas.push({
        id: id("cuo", ++nc), ventaId: venta.id, numero: k,
        monto: k === plan ? resto - porCuota * (plan - 1) : porCuota,
        vence: iso(vence),
        estado: venta.estado === "cancelada" && !pasada ? "cancelada" : pagada ? "pagada" : "pendiente",
        esReserva: false,
      });
    }

    /* Pagos de las cuotas pagadas; a veces una cuota se paga con dos métodos */
    for (const c of cuotas.filter((x) => x.ventaId === venta.id && x.estado === "pagada")) {
      const partido = r() > 0.85;
      const trozos = partido ? [Math.round(c.monto * 0.6), c.monto - Math.round(c.monto * 0.6)] : [c.monto];
      for (const monto of trozos) {
        const proc = pick(PROCESADORES.filter((x) => x.activo));
        const fecha = new Date(c.vence ?? venta.fecha);
        fecha.setDate(fecha.getDate() + entre(0, 6));
        pagos.push({
          id: id("pag", ++np), cuotaId: c.id, procesadorId: proc.id,
          monto, moneda: "USD", feeRate: proc.feeRate,
          feeMonto: Math.round(monto * proc.feeRate * 100) / 100,
          fecha: iso(fecha > HOY ? HOY : fecha),
          referencia: `${proc.nombre.slice(0, 3).toUpperCase()}-${entre(10000, 99999)}`,
          creadoEn: iso(fecha > HOY ? HOY : fecha),
        });
      }
    }
  }

  alumnos.forEach((a) => {
    const lead = leads.find((l) => l.id === a.leadId);
    crearVenta(a.nombre, new Date(a.inicio), "prod_mentoria", pick([2500, 3000, 3000]), {
      contactoId: a.leadId,
      webinarId: lead?.webinarId ?? pick(webinarsPasados).id,
      embudoId: lead?.fuente === "Webinar" ? "emb_webinar" : pick(EMBUDOS).id,
    });
    /* La venta que lo trajo: la ficha del alumno la muestra y lleva a ella. */
    a.ventaId = ventas[ventas.length - 1]?.id;
  });

  /* El volumen real del negocio: entre 30 y 45 ventas por mes, con la mezcla
     de productos que sale del P&L (mayoría mentoría, algo de downsell y resell). */
  for (let m = 4; m >= 0; m--) {
    const diaTope = m === 0 ? Math.max(HOY.getDate() - 1, 1) : 28;
    /* El mes en curso va a mitad de camino: no inventamos ventas del futuro. */
    const cuantas = m === 0 ? Math.round(entre(30, 44) * (HOY.getDate() / 30)) : entre(30, 44);
    for (let k = 0; k < cuantas; k++) {
      const f = new Date(HOY.getFullYear(), HOY.getMonth() - m, Math.min(entre(1, diaTope), 28));
      const prod = pick([
        "prod_mentoria", "prod_mentoria", "prod_mentoria", "prod_mentoria",
        "prod_mentoria", "prod_mentoria", "prod_mentoria",
        "prod_downsell", "prod_resell", "prod_upsell", "prod_biz",
      ]);
      const base = PRODUCTOS.find((x) => x.id === prod)?.precioLista ?? 500;
      /* Los closers cierran entre 2.500 y 3.000 la mentoría */
      const precio = prod === "prod_mentoria" ? pick([2500, 2500, 3000, 3000]) : base;
      crearVenta(pick(NOMBRES), f, prod, precio, {
        embudoId: pick(["emb_webinar", "emb_webinar", "emb_webinar", "emb_vsl_martin", "emb_mastermind", "emb_venta_interna", "emb_setter"]),
        webinarId: r() > 0.35 ? pick(webinarsPasados).id : undefined,
      });
    }
  }

  /* Las mentorías vendidas en los últimos diez días ya tienen su alumno
     esperando en «Venta nueva»: es lo que hace solo, desde ahora, registrar
     una venta. Sin esto la primera columna del pipeline de servicio arranca
     vacía en la demo y no se entiende para qué está. */
  ventas
    .filter((v) => !v.contactoId && v.estado === "activa" && v.productoId === "prod_mentoria"
      && HOY.getTime() - new Date(v.fecha).getTime() <= 10 * 86400000)
    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha))
    .slice(0, 4)
    .forEach((v, k) => {
      const regulares = cuotas.filter((c) => c.ventaId === v.id && !c.esReserva);
      alumnos.push({
        id: id("alu", alumnos.length + 1),
        nombre: v.contactoNombre,
        email: email(v.contactoNombre, 900 + k),
        pais: pick(PAISES),
        cohorte: "",
        plan: PRODUCTOS.find((p) => p.id === v.productoId)?.nombre ?? "",
        cuotaMensual: regulares.length > 1 ? regulares[0].monto : 0,
        moneda: "USD",
        estado: "activo",
        inicio: v.fecha,
        progreso: 0,
        notas: "",
        creadoEn: v.fecha,
        extra: {},
        etapaServicioId: k === 3 ? "ets_onboarding" : "ets_nueva",
        ventaId: v.id,
      });
    });

  /* Gastos: los de cada webinar y los del mes */
  webinarsPasados.forEach((w) => {
    gastos.push({
      id: id("gas", ++ng), categoria: "Meta Ads", grupo: "operativo",
      concepto: `Pauta de captación — ${w.titulo}`, monto: w.inversion, moneda: "USD",
      fecha: w.fecha, webinarId: w.id, recurrente: false, proveedor: "Meta",
      creadoEn: w.fecha, extra: {},
    });
    gastos.push({
      id: id("gas", ++ng), categoria: "Meta Ads", grupo: "operativo",
      concepto: `DM Ads — ${w.titulo}`, monto: w.inversionDmAds, moneda: "USD",
      fecha: w.fecha, webinarId: w.id, recurrente: false, proveedor: "Meta",
      creadoEn: w.fecha, extra: {},
    });
    gastos.push({
      id: id("gas", ++ng), categoria: "Software", grupo: "operativo",
      concepto: `WhatsApp API — ${w.titulo}`, monto: w.costoWhatsappApi, moneda: "USD",
      fecha: w.fecha, webinarId: w.id, recurrente: false, proveedor: "Meta",
      creadoEn: w.fecha, extra: {},
    });
  });

  for (let m = 4; m >= 0; m--) {
    const fijos: [string, Gasto["grupo"], number, string][] = [
      ["Equipo / Salarios", "operativo", entre(6500, 8200), "Equipo (sin comisiones)"],
      ["Software",          "operativo", entre(780, 1150),  "Stack (Calendly, Zoom, Notion, Vercel, Supabase)"],
      ["Contador",          "operativo", entre(60, 95),     "Contaduría"],
      ["Edición de contenido","operativo", entre(480, 760), "Edición y contenido"],
      ["Consultoría",       "operativo", entre(0, 2000),    "Consultoría personalizada"],
      ["Honorarios del CEO","dueno",     entre(8000, 11000),"Honorarios del CEO"],
    ];
    fijos.forEach(([categoria, grupo, monto, concepto]) => {
      if (monto === 0) return;
      const f = new Date(HOY.getFullYear(), HOY.getMonth() - m, Math.min(entre(3, 25), 28));
      gastos.push({
        id: id("gas", ++ng), categoria, grupo, concepto, monto, moneda: "USD",
        fecha: iso(f), recurrente: true, creadoEn: iso(f), extra: {},
      });
    });
  }


  /* ---------- Movimientos de pasarela ----------
     Lo que se ve en la bandeja de conciliación: plata que ya entró a
     Stripe, PayPal, Hotmart o Whop y todavía no está atada a una cuota.
     Se arma a propósito con los tres casos que aparecen en la realidad:
     el calce exacto, el cobro partido y el que no es de nadie.          */
  const movimientos: Movimiento[] = [];
  let nm = 0;

  const conPasarela = PROCESADORES.filter((p) => p.proveedor);
  const refDe = (prov: string, i: number) => {
    const n = String(1000000 + i * 7919).slice(0, 7);
    return prov === "stripe" ? `pi_3Q${n}Lx` : prov === "paypal" ? `8XJ${n}A` : `${prov.toUpperCase()}-${n}`;
  };

  function moverPasarela(datos: {
    monto: number; fecha: string; nombre?: string; email?: string;
    descripcion?: string; proc?: Procesador;
  }): Movimiento {
    const proc = datos.proc ?? pick(conPasarela);
    const fee = Math.round(datos.monto * proc.feeRate * 100) / 100;
    const m: Movimiento = {
      id: id("mov", ++nm),
      proveedor: proc.proveedor ?? "manual",
      procesadorId: proc.id,
      referencia: refDe(proc.proveedor ?? "manual", nm),
      monto: datos.monto,
      moneda: "USD",
      fee,
      neto: Math.round((datos.monto - fee) * 100) / 100,
      fecha: datos.fecha,
      clienteNombre: datos.nombre,
      clienteEmail: datos.email,
      descripcion: datos.descripcion,
      estado: "pendiente",
      origen: "demo",
      creadoEn: datos.fecha,
    };
    movimientos.push(m);
    return m;
  }

  /* Cuotas pendientes recientes: la plata ya entró, falta imputarla. */
  const pendientesRecientes = cuotas
    .filter((c) => {
      if (c.estado !== "pendiente" || !c.vence) return false;
      const d = new Date(c.vence).getTime();
      return d > HOY.getTime() - 32 * 86400000 && d <= HOY.getTime() + 3 * 86400000;
    })
    .slice(0, 14);

  pendientesRecientes.forEach((c, i) => {
    const venta = ventas.find((v) => v.id === c.ventaId);
    if (!venta || venta.estado === "cancelada") return;
    const lead = leads.find((l) => l.id === venta.contactoId);
    const cuando = new Date(c.vence ?? venta.fecha);
    cuando.setDate(cuando.getDate() + entre(0, 4));
    const fecha = iso(cuando > HOY ? HOY : cuando);
    const producto = PRODUCTOS.find((p) => p.id === venta.productoId)?.nombre ?? "Mentoría";

    if (i % 5 === 3) {
      /* Cobro partido: dos movimientos para una sola cuota. */
      const mitad = Math.round(c.monto * 0.5);
      moverPasarela({ monto: mitad, fecha, nombre: venta.contactoNombre, email: lead?.email, descripcion: producto });
      moverPasarela({ monto: c.monto - mitad, fecha, nombre: venta.contactoNombre, email: lead?.email, descripcion: producto });
    } else if (i % 7 === 5) {
      /* Entró de más: paga la cuota y adelanta parte de la que viene. */
      moverPasarela({ monto: c.monto + entre(40, 120), fecha, nombre: venta.contactoNombre, email: lead?.email, descripcion: producto });
    } else {
      moverPasarela({ monto: c.monto, fecha, nombre: venta.contactoNombre, email: lead?.email, descripcion: producto });
    }
  });

  /* Ruido real: cobros que no son de ninguna venta cargada. */
  const sueltos: [string, number, string][] = [
    ["Comunidad — suscripción mensual", 59, "whop"],
    ["Comunidad — suscripción mensual", 59, "whop"],
    ["Masterclass entrevistas", 97, "hotmart"],
  ];
  sueltos.forEach(([concepto, monto, prov], i) => {
    const f = dias(-entre(2, 20));
    moverPasarela({
      monto, fecha: iso(f), nombre: pick(NOMBRES), descripcion: concepto,
      proc: PROCESADORES.find((p) => p.proveedor === prov),
    });
    void i;
  });

  /* Los pagos ya registrados también dejan su movimiento, conciliado:
     así la bandeja muestra historial y no sólo pendientes. */
  pagos.slice(0, 40).forEach((pago) => {
    const proc = PROCESADORES.find((p) => p.id === pago.procesadorId);
    if (!proc?.proveedor) return;
    const cuota = cuotas.find((c) => c.id === pago.cuotaId);
    const venta = ventas.find((v) => v.id === cuota?.ventaId);
    const m: Movimiento = {
      id: id("mov", ++nm),
      proveedor: proc.proveedor,
      procesadorId: proc.id,
      referencia: pago.referencia ?? refDe(proc.proveedor, nm),
      monto: pago.monto,
      moneda: "USD",
      fee: pago.feeMonto,
      neto: Math.round((pago.monto - pago.feeMonto) * 100) / 100,
      fecha: pago.fecha,
      clienteNombre: venta?.contactoNombre,
      descripcion: PRODUCTOS.find((p) => p.id === venta?.productoId)?.nombre,
      estado: "conciliado",
      pagoId: pago.id,
      cuotaId: pago.cuotaId,
      ventaId: venta?.id,
      conciliadoEn: pago.fecha,
      conciliadoPor: "Apicanta",
      origen: "demo",
      creadoEn: pago.fecha,
    };
    movimientos.push(m);
    pago.movimientoId = m.id;
  });

  /* ---------- Metas ---------- */
  const periodo = mesClave(HOY);
  const metas: Meta[] = [
    { id: "meta_1", nombre: "Facturación del mes", metrica: "ingresos", objetivo: 26000, unidad: "moneda", periodo, creadoEn: iso(dias(-30)) },
    { id: "meta_2", nombre: "Leads nuevos", metrica: "leads-nuevos", objetivo: 45, unidad: "cantidad", periodo, creadoEn: iso(dias(-30)) },
    { id: "meta_3", nombre: "Inscripciones", metrica: "inscriptos", objetivo: 10, unidad: "cantidad", periodo, creadoEn: iso(dias(-30)) },
    { id: "meta_4", nombre: "Sesiones hechas", metrica: "sesiones-hechas", objetivo: 30, unidad: "cantidad", periodo, creadoEn: iso(dias(-30)) },
  ];

  const campos: CampoPersonalizado[] = [];

  const actividad: Actividad[] = [
    { id: "act_1", entidad: "config", entidadId: "seed", titulo: "Datos de ejemplo", accion: "importo", detalle: "Se cargó el espacio de trabajo con datos de ejemplo para que puedas probar todo.", actor: "Apicanta", fecha: iso(HOY) },
  ];

  return {
    version: 1,
    ajustes: AJUSTES,
    etapas: ETAPAS,
    etapasServicio: ETAPAS_SERVICIO,
    leads,
    sesiones,
    webinars,
    alumnos,
    reportes,
    contactos: [],
    campanias,
    campaigns: [], adsets: [], ads: [], adInsights: [],
    metas,
    campos,
    actividad,
    productos: PRODUCTOS,
    procesadores: PROCESADORES,
    embudos: EMBUDOS,
    equipo: EQUIPO,
    ventas,
    cuotas,
    pagos,
    gastos,
    movimientos,
    comentarios: [],
    honorarios: [], liquidaciones: [],
  };
}

/* ---------- Agendas de Calendly: el CRM ----------
   Como llegan las de verdad: el tipo de evento, el closer, los UTMs del
   webinar y lo que contestaron en el formulario, con las mismas preguntas.
   Las que ya pasaron traen lo que carga el equipo (Pre-Call, Estado de
   Llamada, notas, grabación). Van con su propio generador para no cambiar
   el resto de los datos de ejemplo. */

const PREGUNTA = {
  telefono: "Numero de telefono (Whatsapp)",
  lenguajes: "Con que lenguajes y frameworks trabajas o trabajaste ?",
  ingles: "Cuál es tu nivel de ingles?",
  formacion: "Cuál es tu nivel de formación?",
  anios: "Hace cuantos años trabajas en programación?",
  gana: "Cuánto ganas mensualmente en dólares?",
  inversion: "En el caso que veas claridad en la llamada sobre cómo conseguir un trabajo que te pague de 3000 USD a 6000 USD de forma garantizada qué situación te define mejor?",
};
const ANIOS = ["1 año", "2 a 4 años", "2 a 4 años", "2 a 4 años", "5 años o mas", "5 años o mas", "5 años o mas", "Unos meses"];
const INGLES = [
  "Nivel básico NO CONVERSACIONAL", "Nivel básico NO CONVERSACIONAL", "Nivel básico NO CONVERSACIONAL",
  "Conversacional aunque cometo errores", "Conversacional aunque cometo errores",
  "Muy bueno, ningún problema con el inglés", "Muy bueno, ningún problema con el inglés", "Nada, 0 ingles",
];
const LENGUAJES = [
  "Javascript / Typescript", "Javascript / Typescript", "Javascript / Typescript", "React", "Python + Django",
  "Java + Spring", "C# + .NET", "Angular", "NodeJS / Express / NestJs", "PHP + Laravel",
];
const FORMACION = ["Universitaria completa", "Universitaria avanzada incompleta", "Autodidacta", "Bootcamp", "Cursos", "Terciario / Tecnicatura"];
const GANA = ["Menos de 500 USD", "Entre 500 - 1500 USD", "Entre 500 - 1500 USD", "Entre 1500 - 2500 USD", "Entre 2500 - 5000 USD", "Más de 5000 USD"];
const INVERSION = [
  "Puedo invertir en mí menos de 600 USD", "Puedo invertir en mí de 600 a 1000 USD",
  "Puedo invertir en mí de 1000 a 2000 USD", "Puedo invertir en mí de 1000 a 2000 USD", "Puedo invertir en mí más de 2000 USD",
];
const CLOSERS_CALENDLY = ["Dante Barbieri", "Valentín Abadía", "Mariano Arias"];
const NOTAS_LLAMADA = [
  "Sin ahorros por ahora, quiere empezar el mes que viene",
  "Paga la primera cuota esta semana",
  "Muchas dudas con el inglés, se trabajaron las objeciones y cerró en la llamada",
  "Gana 1600 USD, quiere dar el salto a una empresa de afuera",
  "Pocas herramientas pero muchas ganas, se compromete a juntar la reserva",
  "Dejó la seña, quedamos en hablar el viernes para el resto",
  "Le falta confianza, lo vemos en el seguimiento",
  "3 cuotas, paga la segunda a fin de mes",
  "Semi-senior estancado, miedo a quedarse sin trabajo",
  "Muy seco en la llamada, cree que puede solo",
  "Lo tiene que hablar con la pareja",
];
const ESTADOS_HECHA = [
  "Compra Full", "Compra Cuotas", "Compra Cuotas", "Reserva", "Seguimiento de Pago",
  "Seguimiento Nutrición", "Seguimiento Nutrición", "Seguimiento Nutrición", "Califica Downsell",
  "Compra Downsell", "Llamada Interrumpida", "NO Calificado", "Lead descartado",
];

function agendasDeEjemplo(leads: Lead[], webinars: Webinar[]): Sesion[] {
  const g = rng(20260925);
  const elegir = <T,>(xs: readonly T[]): T => xs[Math.floor(g() * xs.length)];
  const rango = (a: number, b: number) => Math.round(a + g() * (b - a));
  const ahora = HOY.getTime();
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const codigo = (n: number) => Array.from({ length: n }, () => letras[Math.floor(g() * letras.length)]).join("");
  const diaMes = (d: Date) => {
    const p = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" }).formatToParts(d);
    return `${(p.find((x) => x.type === "day")?.value ?? "").padStart(2, "0")}-${(p.find((x) => x.type === "month")?.value ?? "").padStart(2, "0")}`;
  };
  const finalizados = webinars.filter((w) => w.estado === "finalizado").sort((a, b) => b.fecha.localeCompare(a.fecha));

  /* Qué agendas hay: por webinar (en el vivo y después), por VSL, por el
     setter y las de auditoría de los resells. */
  type Plan = { tipo: string; canal: Sesion["canal"]; utm: Record<string, string>; desde: number; hasta: number };
  const planes: Plan[] = [];
  const [ultimo, anterior] = finalizados;
  const offset = (iso: string) => (new Date(iso).getTime() - ahora) / 86400000;
  if (ultimo) {
    const d = offset(ultimo.fecha);
    for (let i = 0; i < 46; i++) {
      const vivo = i < 30;
      planes.push({
        tipo: "Llamada de Asesoramiento - Webinar - Team", canal: "webinar",
        utm: { utm_source: "Webinar", utm_medium: diaMes(new Date(ultimo.fecha)), utm_content: vivo ? "EnVivo" : "PostWebinar" },
        desde: vivo ? d : d + 1, hasta: vivo ? d + 0.1 : -0.5,
      });
    }
  }
  if (anterior) {
    const d = offset(anterior.fecha);
    for (let i = 0; i < 22; i++) {
      planes.push({
        tipo: "Llamada de Asesoramiento - Webinar - Team", canal: "webinar",
        utm: { utm_source: "Webinar", utm_medium: diaMes(new Date(anterior.fecha)), utm_content: i < 15 ? "EnVivo" : "PostWebinar" },
        desde: d, hasta: d + 5,
      });
    }
  }
  for (let i = 0; i < 9; i++) {
    planes.push({
      tipo: "Llamada de Asesoramiento - VSL - Team", canal: "vsl",
      utm: i % 3 === 0 ? { utm_source: "YT", utm_medium: "Bio" } : { utm_source: "Landing-Organic", utm_medium: elegir(["IG", "YT"]) },
      desde: -8, hasta: -0.2,
    });
  }
  for (let i = 0; i < 7; i++) {
    planes.push({ tipo: "Llamada de Asesoramiento - Setter", canal: "setter", utm: { utm_source: "setter-ia", utm_medium: "IG" }, desde: -7, hasta: -0.2 });
  }
  for (let i = 0; i < 6; i++) {
    planes.push({ tipo: "Llamada de Auditoría", canal: "otro", utm: { utm_source: "Resell" }, desde: -12, hasta: -0.5 });
  }

  const personas = leads.slice(20, 20 + planes.length);
  const salida: Sesion[] = [];
  planes.forEach((p, i) => {
    const l = personas[i % personas.length];
    const agendo = new Date(ahora + rango(p.desde * 1440, p.hasta * 1440) * 60000);
    const inicia = new Date(agendo.getTime() + rango(20, 96) * 3600000);
    inicia.setUTCMinutes(0, 0, 0);
    inicia.setUTCHours(rango(12, 23));
    if (inicia.getTime() < agendo.getTime() + 2 * 3600000) inicia.setUTCDate(inicia.getUTCDate() + 1);
    const pasada = inicia.getTime() < ahora;
    const x = g();
    const estado: Sesion["estado"] = !pasada ? (x > 0.95 ? "cancelada" : "agendada") : x > 0.84 ? "no-show" : x > 0.8 ? "cancelada" : "hecha";
    const lenguajes = [...new Set([elegir(LENGUAJES), ...(g() > 0.55 ? [elegir(LENGUAJES)] : [])])];
    const formacion = [...new Set([elegir(FORMACION), ...(g() > 0.6 ? [elegir(FORMACION)] : [])])];
    const respuestas = p.tipo === "Llamada de Auditoría"
      ? [{ pregunta: PREGUNTA.telefono, respuesta: l.telefono ?? "" }]
      : [
          { pregunta: PREGUNTA.telefono, respuesta: l.telefono ?? "" },
          { pregunta: PREGUNTA.lenguajes, respuesta: lenguajes.join("\n") },
          { pregunta: PREGUNTA.ingles, respuesta: elegir(INGLES) },
          { pregunta: PREGUNTA.formacion, respuesta: formacion.join("\n") },
          { pregunta: PREGUNTA.anios, respuesta: elegir(ANIOS) },
          { pregunta: PREGUNTA.gana, respuesta: elegir(GANA) },
          { pregunta: PREGUNTA.inversion, respuesta: elegir(INVERSION) },
        ];
    const s: Sesion = {
      id: `cal_demo_${String(i + 1).padStart(3, "0")}`,
      titulo: p.tipo, tipo: p.tipo, leadId: l.id,
      invitado: l.nombre, email: l.email,
      inicia: inicia.toISOString(), duracionMin: 45, estado,
      enlace: `https://meet.google.com/${codigo(3).toLowerCase()}-${codigo(4).toLowerCase()}-${codigo(3).toLowerCase()}`,
      origen: "calendly", notas: "", creadoEn: agendo.toISOString(), extra: {},
      canal: p.canal, utm: p.utm, respuestas, anfitrion: elegir(CLOSERS_CALENDLY),
      calendlyInvitadoUri: `https://api.calendly.com/scheduled_events/demo/invitees/${i + 1}`,
    };
    /* Lo que ya cargó el equipo: el seguimiento antes de la llamada y, si
       pasó, cómo salió. */
    const horas = (inicia.getTime() - ahora) / 3600000;
    if (estado !== "cancelada" && horas < 48) {
      s.preCall = horas < 0 ? elegir(["2° Mje Enviado", "2° Mje Enviado", "2° Mje Enviado", "1° Mje Enviado", "2° Llamada"]) : elegir(["1° Mje Enviado", "1° Mje Enviado", "1° Llamada"]);
      s.estadoPreCall = horas < 0 ? (estado === "no-show" ? "Reagendar" : "Confirmado") : g() > 0.5 ? "Confirmado" : undefined;
    }
    if (estado === "hecha") {
      s.estadoLlamada = elegir(ESTADOS_HECHA);
      s.grabacion = `https://fathom.video/share/${codigo(20)}`;
      if (g() > 0.2) s.notas = elegir(NOTAS_LLAMADA);
    }
    if (estado === "no-show" && g() > 0.5) s.estadoPreCall = "Sin Respuesta";
    if (estado === "cancelada") s.canceladaEn = new Date(Math.min(ahora, inicia.getTime()) - 3600000 * 5).toISOString();
    salida.push(s);
  });

  /* Alguien que vuelve a agendar (la segunda sale «2da Agenda (auto)») y
     una reprogramación (la vieja no se ve: la reemplaza la nueva). */
  const vuelve = salida.find((s) => s.estado === "hecha" && s.canal === "webinar");
  if (vuelve) {
    const inicia = new Date(ahora + 26 * 3600000); inicia.setUTCMinutes(0, 0, 0);
    salida.push({ ...vuelve, id: "cal_demo_vuelve", inicia: inicia.toISOString(), estado: "agendada", creadoEn: new Date(ahora - 5 * 3600000).toISOString(), preCall: "1° Mje Enviado", estadoPreCall: undefined, estadoLlamada: undefined, grabacion: undefined, notas: "", calendlyInvitadoUri: undefined });
  }
  const mueve = salida.find((s) => s.estado === "agendada" && s.canal === "webinar");
  if (mueve) {
    const vieja: Sesion = { ...mueve, id: "cal_demo_reprogramada", estado: "cancelada", motivoCancelacion: "Reprogramada", canceladaEn: new Date(ahora - 30 * 3600000).toISOString(), inicia: new Date(new Date(mueve.inicia).getTime() - 24 * 3600000).toISOString(), calendlyInvitadoUri: undefined };
    mueve.reprogramadaDe = vieja.id;
    salida.push(vieja);
  }
  return salida;
}

export function estadoVacio(): EstadoApp {
  return {
    version: 1,
    ajustes: { ...AJUSTES, tourVisto: true },
    etapas: ETAPAS,
    etapasServicio: ETAPAS_SERVICIO,
    leads: [], sesiones: [], webinars: [], alumnos: [], reportes: [],
    contactos: [], campanias: [], campaigns: [], adsets: [], ads: [], adInsights: [],
    metas: [], campos: [],
    productos: PRODUCTOS, procesadores: PROCESADORES, embudos: EMBUDOS, equipo: EQUIPO,
    ventas: [], cuotas: [], pagos: [], gastos: [], movimientos: [], comentarios: [],
    honorarios: [], liquidaciones: [],
    actividad: [{
      id: "act_1", entidad: "config", entidadId: "reset", titulo: "Espacio vacío",
      accion: "creo", detalle: "Se vació el espacio de trabajo. Empezá cargando tu primer lead.",
      actor: "Apicanta", fecha: new Date().toISOString(),
    }],
  };
}
