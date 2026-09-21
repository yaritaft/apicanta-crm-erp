import type {
  Actividad, Ajustes, Alumno, Campania, CampoPersonalizado, Cuota, Embudo, EstadoApp,
  Etapa, Gasto, Lead, Meta, MiembroEquipo, Movimiento, Pago, Procesador, Producto,
  Reporte, Sesion, Venta, Webinar,
} from "./types";
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

export const PRODUCTOS: Producto[] = [
  { id: "prod_mentoria",   nombre: "Mentoría (Hackear IT)", precioLista: 3000, tipo: "principal", activo: true, orden: 0 },
  { id: "prod_downsell",   nombre: "Downsell",               precioLista: 500, tipo: "downsell",  activo: true, orden: 1 },
  { id: "prod_resell",     nombre: "Resell Mentoría",       precioLista: 2500, tipo: "principal", activo: true, orden: 2 },
  { id: "prod_upsell",     nombre: "Upsell",                 precioLista: 800, tipo: "upsell",    activo: true, orden: 3 },
  { id: "prod_biz",        nombre: "Hackear Biz",           precioLista: 4500, tipo: "principal", activo: true, orden: 4 },
  { id: "prod_mastermind", nombre: "Mastermind",               precioLista: 0, tipo: "evento",    activo: true, orden: 5 },
];

/* Los medios de pago reales del negocio. `automatico` es si el cobro
   puede entrar solo: por webhook o porque se le puede preguntar a la
   plataforma. Los demás se cargan a mano o pegando su planilla. */
export const PROCESADORES: Procesador[] = [
  { id: "proc_stripe",           nombre: "Stripe",               feeRate: 0.029, activo: true, automatico: true,  proveedor: "stripe" },
  { id: "proc_hotmart",          nombre: "Hotmart",              feeRate: 0.099, activo: true, automatico: true,  proveedor: "hotmart" },
  { id: "proc_whop",             nombre: "Whop",                 feeRate: 0.030, activo: true, automatico: true,  proveedor: "whop" },
  { id: "proc_dlocal",           nombre: "dLocal",               feeRate: 0.050, activo: true, automatico: true,  proveedor: "dlocal" },
  { id: "proc_mercadopago",      nombre: "Mercado Pago (Yari)",  feeRate: 0.062, activo: true, automatico: true,  proveedor: "mercadopago" },
  { id: "proc_mercury",          nombre: "ACH / Wire (Mercury)", feeRate: 0,     activo: true, automatico: true,  proveedor: "mercury" },
  { id: "proc_binance",          nombre: "USDT (Binance)",       feeRate: 0,     activo: true, automatico: true,  proveedor: "binance" },
  { id: "proc_trust",            nombre: "USDT (Trust)",         feeRate: 0,     activo: true, automatico: true,  proveedor: "trust" },
  { id: "proc_financiera_usd",   nombre: "Financiera USD (Juan)", feeRate: 0,    activo: true, automatico: false },
  { id: "proc_financiera_ars",   nombre: "Financiera ARS (Juan)", feeRate: 0,    activo: true, automatico: false },
  { id: "proc_galicia_usd",      nombre: "Galicia (USD)",        feeRate: 0,     activo: true, automatico: false },
  { id: "proc_galicia_ars",      nombre: "Galicia (ARS)",        feeRate: 0,     activo: true, automatico: false },
  { id: "proc_efectivo",         nombre: "Efectivo USD",         feeRate: 0,     activo: true, automatico: false },
];

export const EMBUDOS: Embudo[] = [
  { id: "emb_webinar",     nombre: "Webinar",             activo: true, orden: 0 },
  { id: "emb_evergreen",   nombre: "Evergreen / VSL",     activo: true, orden: 1 },
  { id: "emb_setter",      nombre: "Setter IA",           activo: true, orden: 2 },
  { id: "emb_evento",      nombre: "Evento",              activo: true, orden: 3 },
  { id: "emb_lanzamiento", nombre: "Lanzamiento interno", activo: true, orden: 4 },
  { id: "emb_youtube",     nombre: "YouTube orgánico",    activo: true, orden: 5 },
  { id: "emb_directo",     nombre: "Directo / Conocido",  activo: true, orden: 6 },
];

export const EQUIPO: MiembroEquipo[] = [
  { id: "eq_yari",     nombre: "Yari Taft",      rol: "ceo",      comisionRate: 0,    activo: true, sinComision: true,
    notas: "Cuando figura como closer no comisiona nadie: ni closer, ni director, ni setter." },
  { id: "eq_director", nombre: "Director comercial", rol: "director", comisionRate: 0.05, activo: true, sinComision: false,
    notas: "5% del cash collected neto de procesador." },
  { id: "eq_closer_1", nombre: "Closer 1",       rol: "closer",   comisionRate: 0.10, activo: true, sinComision: false },
  { id: "eq_closer_2", nombre: "Closer 2",       rol: "closer",   comisionRate: 0.10, activo: true, sinComision: false },
  { id: "eq_closer_3", nombre: "Closer 3",       rol: "closer",   comisionRate: 0.15, activo: true, sinComision: false },
  { id: "eq_growth",   nombre: "Agustín Zika",   rol: "growth",   comisionRate: 0.10, activo: true, sinComision: false,
    notas: "10% del profit. No comisiona las ventas marcadas como excluidas de marketing." },
  { id: "eq_socio",    nombre: "Socio",          rol: "socio",    comisionRate: 0.10, activo: true, sinComision: false,
    notas: "10% del profit. Comisiona distinto según producto: falta definir." },
];

/* Las categorías tal cual salen del P&L que usa Yari */
export const CATEGORIAS_GASTO: { categoria: string; grupo: Gasto["grupo"] }[] = [
  { categoria: "Comisiones Financieras", grupo: "directo" },
  { categoria: "Facturas Stripe",        grupo: "directo" },
  { categoria: "Referidores",            grupo: "directo" },
  { categoria: "Equipo / Salarios",      grupo: "operativo" },
  { categoria: "Contador",               grupo: "operativo" },
  { categoria: "Software",               grupo: "operativo" },
  { categoria: "Meta Ads",               grupo: "operativo" },
  { categoria: "Google Ads",             grupo: "operativo" },
  { categoria: "TikTok Ads",             grupo: "operativo" },
  { categoria: "Consultoría",            grupo: "operativo" },
  { categoria: "Agencia de Marketing",   grupo: "operativo" },
  { categoria: "Reembolsos",             grupo: "operativo" },
  { categoria: "Edición de contenido",   grupo: "operativo" },
  { categoria: "Filmmaker",              grupo: "operativo" },
  { categoria: "Mantenimiento LLC",      grupo: "operativo" },
  { categoria: "Gastos de evento",       grupo: "operativo" },
  { categoria: "Viáticos equipo",        grupo: "operativo" },
  { categoria: "Formaciones",            grupo: "operativo" },
  { categoria: "Producción audiovisual", grupo: "operativo" },
  { categoria: "Comisiones bancarias",   grupo: "operativo" },
  { categoria: "Honorarios del CEO",     grupo: "dueno" },
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
        embudoId: pick(["emb_webinar", "emb_webinar", "emb_webinar", "emb_evergreen", "emb_evento", "emb_lanzamiento", "emb_setter"]),
        webinarId: r() > 0.35 ? pick(webinarsPasados).id : undefined,
      });
    }
  }

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
  };
}

export function estadoVacio(): EstadoApp {
  return {
    version: 1,
    ajustes: { ...AJUSTES, tourVisto: true },
    etapas: ETAPAS,
    leads: [], sesiones: [], webinars: [], alumnos: [], reportes: [],
    contactos: [], campanias: [], campaigns: [], adsets: [], ads: [], adInsights: [],
    metas: [], campos: [],
    productos: PRODUCTOS, procesadores: PROCESADORES, embudos: EMBUDOS, equipo: EQUIPO,
    ventas: [], cuotas: [], pagos: [], gastos: [], movimientos: [],
    actividad: [{
      id: "act_1", entidad: "config", entidadId: "reset", titulo: "Espacio vacío",
      accion: "creo", detalle: "Se vació el espacio de trabajo. Empezá cargando tu primer lead.",
      actor: "Apicanta", fecha: new Date().toISOString(),
    }],
  };
}
