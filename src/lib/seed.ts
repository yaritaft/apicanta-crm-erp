import type {
  Actividad, Ajustes, Alumno, Campania, CampoPersonalizado, EstadoApp, Etapa,
  Lead, Meta, Reporte, Sesion, Transaccion, Webinar,
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
    return {
      id: id("web", i + 1),
      titulo,
      fecha: iso(dias(offset)),
      duracionMin: 75,
      estado: futuro ? "programado" : "finalizado",
      registrados,
      asistentes: futuro ? 0 : Math.round(registrados * (0.34 + r() * 0.2)),
      inversion: entre(400, 1800),
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

  /* ---------- Finanzas ---------- */
  const transacciones: Transaccion[] = [];
  let t = 0;
  /* Ingresos: cuotas de alumnos, últimos 5 meses */
  for (let m = 4; m >= 0; m--) {
    alumnos.forEach((a) => {
      const f = new Date(HOY.getFullYear(), HOY.getMonth() - m, Math.min(entre(2, 26), 28));
      if (f < new Date(a.inicio)) return;
      if (a.estado === "baja" && m === 0) return;
      transacciones.push({
        id: id("tx", ++t),
        tipo: "ingreso",
        categoria: "Cuotas",
        concepto: `Cuota ${a.plan} — ${a.nombre}`,
        monto: a.cuotaMensual,
        moneda: "USD",
        fecha: iso(f),
        estado: m === 0 && r() > 0.72 ? "pendiente" : "pagado",
        metodo: pick(AJUSTES.metodosPago),
        alumnoId: a.id,
        recurrente: true,
        creadoEn: iso(f),
        extra: {},
      });
    });
    /* Pagos únicos y mentorías sueltas */
    const puntuales = entre(2, 5);
    for (let k = 0; k < puntuales; k++) {
      const f = new Date(HOY.getFullYear(), HOY.getMonth() - m, Math.min(entre(2, 26), 28));
      transacciones.push({
        id: id("tx", ++t),
        tipo: "ingreso",
        categoria: pick(["Pago único", "Mentoría 1:1", "Workshop"]),
        concepto: `${pick(["Pago único", "Mentoría 1:1", "Workshop"])} — ${pick(NOMBRES)}`,
        monto: pick([600, 900, 1200, 2400]),
        moneda: "USD",
        fecha: iso(f),
        estado: m === 0 && r() > 0.8 ? "pendiente" : "pagado",
        metodo: pick(AJUSTES.metodosPago),
        recurrente: false,
        creadoEn: iso(f),
        extra: {},
      });
    }
    /* Egresos */
    const egresos: [string, number, string][] = [
      ["Publicidad", entre(3800, 6200), "Meta Ads — inversión del mes"],
      ["Herramientas", entre(240, 420), "Stack (Calendly, Zoom, Notion, Vercel)"],
      ["Equipo", entre(2600, 3800), "Equipo Apicanta"],
      ["Producción", entre(600, 1200), "Edición y contenido"],
      ["Impuestos", entre(900, 1600), "Impuestos y comisiones"],
    ];
    egresos.forEach(([cat, monto, concepto]) => {
      const f = new Date(HOY.getFullYear(), HOY.getMonth() - m, Math.min(entre(3, 25), 28));
      transacciones.push({
        id: id("tx", ++t),
        tipo: "egreso",
        categoria: cat,
        concepto,
        monto,
        moneda: "USD",
        fecha: iso(f),
        estado: "pagado",
        metodo: pick(AJUSTES.metodosPago),
        recurrente: true,
        creadoEn: iso(f),
        extra: {},
      });
    });
  }

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
    campanias,
    transacciones,
    metas,
    campos,
    actividad,
  };
}

export function estadoVacio(): EstadoApp {
  return {
    version: 1,
    ajustes: { ...AJUSTES, tourVisto: true },
    etapas: ETAPAS,
    leads: [], sesiones: [], webinars: [], alumnos: [], reportes: [],
    campanias: [], transacciones: [], metas: [], campos: [],
    actividad: [{
      id: "act_1", entidad: "config", entidadId: "reset", titulo: "Espacio vacío",
      accion: "creo", detalle: "Se vació el espacio de trabajo. Empezá cargando tu primer lead.",
      actor: "Apicanta", fecha: new Date().toISOString(),
    }],
  };
}
