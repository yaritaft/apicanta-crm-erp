import type {
  CanalOrigen, Contacto, EstadoApp, Lead, NivelIngles, Sesion, Venta, Webinar,
} from "./types";

/* ==================================================================
   Las métricas que Yari viene trackeando webinar a webinar desde 2023.
   Los nombres son los suyos: así puede comparar con su planilla.
   ================================================================== */

export interface MetricasWebinar {
  /* Inversión */
  inversionTotal: number;      // pauta + DM Ads + WhatsApp API
  /* Embudo */
  formularios: number;
  grupoWpp: number;
  asistentes: number;
  llamadas: number;
  llamadasCalificadas: number;
  ventas: number;
  /* Costos unitarios */
  cplFormulario: number;
  cplGrupo: number;
  cpLlamada: number;
  cpLlamadaCalificada: number;
  cpa: number;                 // costo por adquisición
  /* Conversiones */
  asistenciaFormulario: number; // grupo / formularios
  asistenciaTaller: number;     // asistentes / grupo
  porcentajeAgenda: number;     // llamadas / grupo
  agendaSobreAsisten: number;   // llamadas / asistentes
  convLeadVenta: number;        // ventas / grupo
  tasaCierre: number;           // ventas / llamadas calificadas
  /* Plata */
  facturado: number;
  cobrado: number;
  comisiones: number;
  /* Lo que se quedaron los procesadores de pago */
  procesador: number;
  roasRev: number;
  roasCC: number;
  beneficioRev: number;
  beneficioCC: number;
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const pctDiv = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

/* Lo que se SUMA entre webinars. Todo lo demás (costos, tasas, ROAS) se
   deriva de esto, en un solo lugar: así el total de la planilla sale con
   la misma fórmula que cada fila, y no del promedio de los porcentajes —
   el promedio de cinco ROAS no es el ROAS de los cinco. */
type Base = Pick<MetricasWebinar,
  | "inversionTotal" | "formularios" | "grupoWpp" | "asistentes" | "llamadas"
  | "llamadasCalificadas" | "ventas" | "facturado" | "cobrado" | "comisiones" | "procesador">;

const CLAVES_BASE: (keyof Base)[] = [
  "inversionTotal", "formularios", "grupoWpp", "asistentes", "llamadas",
  "llamadasCalificadas", "ventas", "facturado", "cobrado", "comisiones", "procesador",
];

function derivar(b: Base): MetricasWebinar {
  /* Profit del webinar = plata − (pauta + DM + WAPI) − comisiones − procesador */
  const descuentos = b.inversionTotal + b.comisiones + b.procesador;
  return {
    ...b,
    cplFormulario: div(b.inversionTotal, b.formularios),
    cplGrupo: div(b.inversionTotal, b.grupoWpp),
    cpLlamada: div(b.inversionTotal, b.llamadas),
    cpLlamadaCalificada: div(b.inversionTotal, b.llamadasCalificadas),
    cpa: div(b.inversionTotal, b.ventas),

    asistenciaFormulario: pctDiv(b.grupoWpp, b.formularios),
    asistenciaTaller: pctDiv(b.asistentes, b.grupoWpp),
    porcentajeAgenda: pctDiv(b.llamadas, b.grupoWpp),
    agendaSobreAsisten: pctDiv(b.llamadas, b.asistentes),
    convLeadVenta: pctDiv(b.ventas, b.grupoWpp),
    tasaCierre: pctDiv(b.ventas, b.llamadasCalificadas),

    roasRev: div(b.facturado, b.inversionTotal),
    roasCC: div(b.cobrado, b.inversionTotal),
    beneficioRev: b.facturado - descuentos,
    beneficioCC: b.cobrado - descuentos,
  };
}

export function metricasDeWebinar(e: EstadoApp, w: Webinar): MetricasWebinar {
  const inversionTotal = w.inversion + w.inversionDmAds + w.costoWhatsappApi;
  const llamadas = w.llamadasVivo + w.llamadasPosterior;

  const ventas = e.ventas.filter((v) => v.webinarId === w.id && v.estado !== "cancelada");
  const facturado = ventas.reduce((a, v) => a + v.precioAcordado, 0);

  /* De qué venta es cada cuota, sólo para las ventas de este webinar. Con
     índices y no con filter+includes anidados: la planilla recalcula esto
     para cada webinar a cada celda que se carga. */
  const idsVentas = new Set(ventas.map((v) => v.id));
  const ventaDeCuota = new Map<string, string>();
  for (const c of e.cuotas) if (idsVentas.has(c.ventaId)) ventaDeCuota.set(c.id, c.ventaId);
  const pagos = e.pagos.filter((p) => ventaDeCuota.has(p.cuotaId));
  const cobrado = pagos.reduce((a, p) => a + p.monto, 0);
  const fees = pagos.reduce((a, p) => a + p.feeMonto, 0);

  const netoPorVenta = new Map<string, number>();
  for (const p of pagos) {
    const v = ventaDeCuota.get(p.cuotaId) as string;
    netoPorVenta.set(v, (netoPorVenta.get(v) ?? 0) + (p.monto - p.feeMonto));
  }

  /* Comisiones: closer + director sobre el neto de procesador,
     salvo que la venta la haya cerrado Yari. */
  let comisiones = 0;
  for (const v of ventas) {
    const closer = e.equipo.find((x) => x.id === v.closerId);
    if (closer?.sinComision) continue;
    const neto = netoPorVenta.get(v.id) ?? 0;
    const director = e.equipo.find((x) => x.id === v.directorId);
    comisiones += neto * ((closer?.comisionRate ?? 0) + (director?.comisionRate ?? 0));
  }

  return derivar({
    inversionTotal,
    formularios: w.formularios,
    grupoWpp: w.grupoWpp,
    asistentes: w.asistentes,
    llamadas,
    llamadasCalificadas: w.llamadasCalificadas,
    ventas: ventas.length,
    facturado,
    cobrado,
    comisiones,
    procesador: fees,
  });
}

/** Los números de varios webinars juntos, como si fueran uno. */
export function sumarMetricas(ms: MetricasWebinar[]): MetricasWebinar {
  const base = Object.fromEntries(CLAVES_BASE.map((k) => [k, 0])) as Base;
  for (const m of ms) for (const k of CLAVES_BASE) base[k] += m[k];
  return derivar(base);
}

/** Todos los webinars ya pasados, del más viejo al más nuevo, con sus métricas. */
export function serieDeWebinars(e: EstadoApp) {
  return e.webinars
    .filter((w) => w.estado === "finalizado")
    .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    .map((w) => ({ webinar: w, m: metricasDeWebinar(e, w) }));
}

/* ==================================================================
   Lo que se carga a mano

   Un webinar es algo vivo: la pauta corre, el grupo se llena y las
   llamadas se agendan día a día. Estos son los números que alguien
   escribe; todo lo demás se calcula. La planilla y la ficha usan este
   mismo catálogo, así un campo nuevo aparece en los dos lados.
   ================================================================== */

export type CampoManual =
  | "inversion" | "inversionDmAds" | "costoWhatsappApi"
  | "formularios" | "grupoWpp" | "asistentes"
  | "llamadasVivo" | "llamadasPosterior" | "llamadasCanceladas"
  | "llamadasInasistidas" | "llamadasNoCalificadas" | "llamadasCalificadas";

export interface DefCampoManual {
  campo: CampoManual;
  /* Corto, para el encabezado de la planilla */
  titulo: string;
  /* Largo, para la ficha */
  largo: string;
  grupo: "Inversión" | "Captación" | "Llamadas";
  moneda: boolean;
  ayuda: string;
}

export const CAMPOS_MANUALES: DefCampoManual[] = [
  { campo: "inversion", titulo: "Pauta", largo: "Pauta de captación", grupo: "Inversión", moneda: true, ayuda: "Lo que se gastó en anuncios para que la gente se registre." },
  { campo: "inversionDmAds", titulo: "DM Ads", largo: "DM Ads", grupo: "Inversión", moneda: true, ayuda: "Los anuncios que llevan a una conversación por mensaje." },
  { campo: "costoWhatsappApi", titulo: "WhatsApp API", largo: "WhatsApp API", grupo: "Inversión", moneda: true, ayuda: "Lo que cobró WhatsApp por los mensajes y recordatorios." },
  { campo: "formularios", titulo: "Formularios", largo: "Formularios completados", grupo: "Captación", moneda: false, ayuda: "Gente que completó el formulario de registro." },
  { campo: "grupoWpp", titulo: "Grupo", largo: "Se unieron al grupo", grupo: "Captación", moneda: false, ayuda: "Los que entraron al grupo de WhatsApp." },
  { campo: "asistentes", titulo: "Asistentes", largo: "Asistieron al vivo", grupo: "Captación", moneda: false, ayuda: "Los que estuvieron en el vivo." },
  { campo: "llamadasVivo", titulo: "Llamadas en vivo", largo: "Agendadas en el vivo", grupo: "Llamadas", moneda: false, ayuda: "Llamadas agendadas durante el vivo." },
  { campo: "llamadasPosterior", titulo: "Llamadas después", largo: "Agendadas después", grupo: "Llamadas", moneda: false, ayuda: "Llamadas agendadas después del vivo, con el replay o el seguimiento." },
  { campo: "llamadasCanceladas", titulo: "Canceladas", largo: "Canceladas", grupo: "Llamadas", moneda: false, ayuda: "Llamadas que se cancelaron." },
  { campo: "llamadasInasistidas", titulo: "No asistieron", largo: "No asistieron", grupo: "Llamadas", moneda: false, ayuda: "Llamadas a las que la persona no se presentó." },
  { campo: "llamadasNoCalificadas", titulo: "No calificadas", largo: "No calificadas", grupo: "Llamadas", moneda: false, ayuda: "Llamadas hechas con gente que no calificaba para el programa." },
  { campo: "llamadasCalificadas", titulo: "Calificadas", largo: "Calificadas", grupo: "Llamadas", moneda: false, ayuda: "Llamadas hechas con gente que sí calificaba." },
];

export const CAMPO_MANUAL: Record<CampoManual, DefCampoManual> = Object.fromEntries(
  CAMPOS_MANUALES.map((c) => [c.campo, c]),
) as Record<CampoManual, DefCampoManual>;

/* ==================================================================
   La gente de un webinar

   Tres caminos traen a alguien: el contacto que se registró desde el
   webinar (origenWebinarId), el lead atribuido a él (webinarId) y la
   venta cargada con ese webinar como origen. Una misma persona puede
   venir por los tres: se junta en una sola fila, por su contacto.
   ================================================================== */

export interface PersonaDeWebinar {
  /* Clave estable de la fila: el contacto, o el lead, o la venta suelta. */
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  pais?: string;
  contactoId?: string;
  /* La oportunidad: es lo que abre /leads?ver=<id>. */
  leadId?: string;
  etapaId?: string;
  entro?: string;
  canal?: CanalOrigen;
  inglesNivel?: NivelIngles;
  aniosExperiencia?: number;
  /* Los del registro; si no hay, los de la agenda. */
  utm?: Record<string, string>;
  llamadas: Sesion[];
  /* La que importa: la próxima agendada, o si no la última que no se canceló. */
  llamada?: Sesion;
  ventas: Venta[];
  facturado: number;
  cobrado: number;
}

const conValor = (s?: string) => (s && s.trim() ? s : undefined);

export function personasDeWebinar(e: EstadoApp, webinarId: string): PersonaDeWebinar[] {
  const personas = new Map<string, PersonaDeWebinar>();
  const leadPorId = new Map(e.leads.map((l) => [l.id, l] as const));
  const contactoPorId = new Map(e.contactos.map((c) => [c.id, c] as const));
  const claveDeLead = (l: Lead) => l.contactoId ?? l.id;

  const fila = (clave: string, nombre: string): PersonaDeWebinar => {
    const previa = personas.get(clave);
    if (previa) return previa;
    const nueva: PersonaDeWebinar = { id: clave, nombre, llamadas: [], ventas: [], facturado: 0, cobrado: 0 };
    personas.set(clave, nueva);
    return nueva;
  };

  /* Lo de la persona manda sobre lo de la oportunidad: el contacto es la
     fuente de verdad desde que se separaron. Se completan huecos, no se pisa. */
  const deContacto = (p: PersonaDeWebinar, c: Contacto) => {
    p.contactoId = c.id;
    p.nombre = conValor(c.nombre) ?? p.nombre;
    p.email = conValor(c.email) ?? p.email;
    p.telefono = conValor(c.telefono) ?? p.telefono;
    p.pais = conValor(c.pais) ?? p.pais;
    p.canal = c.origenCanal ?? p.canal;
    p.inglesNivel = c.inglesNivel ?? p.inglesNivel;
    p.aniosExperiencia = c.aniosExperiencia ?? p.aniosExperiencia;
    p.utm = c.utm ?? p.utm;
    p.entro = c.creadoEn ?? p.entro;
  };
  const deLead = (p: PersonaDeWebinar, l: Lead) => {
    /* Si la persona tiene varias oportunidades, la de ESTE webinar. */
    if (!p.leadId || l.webinarId === webinarId) {
      p.leadId = l.id;
      p.etapaId = l.etapaId;
    }
    p.nombre = p.nombre || l.nombre;
    p.email = p.email ?? conValor(l.email);
    p.telefono = p.telefono ?? conValor(l.telefono);
    p.pais = p.pais ?? conValor(l.pais);
    p.inglesNivel = p.inglesNivel ?? l.inglesNivel;
    p.aniosExperiencia = p.aniosExperiencia ?? l.aniosExperiencia;
    p.entro = p.entro ?? l.creadoEn;
  };

  for (const c of e.contactos) {
    if (c.origenWebinarId === webinarId) deContacto(fila(c.id, c.nombre), c);
  }
  for (const l of e.leads) {
    if (l.webinarId !== webinarId) continue;
    const p = fila(claveDeLead(l), l.nombre);
    const c = l.contactoId ? contactoPorId.get(l.contactoId) : undefined;
    if (c && !p.contactoId) deContacto(p, c);
    deLead(p, l);
  }
  for (const v of e.ventas) {
    if (v.webinarId !== webinarId) continue;
    /* `ventas.contactoId` guarda hoy ids de LEADS (ver store.ts); se prueba
       primero como lead y después como contacto. */
    const lead = v.contactoId ? leadPorId.get(v.contactoId) : undefined;
    const contacto = !lead && v.contactoId ? contactoPorId.get(v.contactoId) : undefined;
    const clave = lead ? claveDeLead(lead) : contacto ? contacto.id : `venta:${v.id}`;
    const p = fila(clave, v.contactoNombre);
    if (contacto && !p.contactoId) deContacto(p, contacto);
    if (lead) {
      const c = lead.contactoId ? contactoPorId.get(lead.contactoId) : undefined;
      if (c && !p.contactoId) deContacto(p, c);
      if (!p.leadId) deLead(p, lead);
    }
    p.entro = p.entro ?? v.fecha;
    p.ventas.push(v);
  }

  /* Todo indexado de una pasada: con miles de llamadas, buscarlas persona
     por persona recorriendo la lista entera se nota. */
  const agrupar = <T,>(xs: T[], clave: (x: T) => string | undefined) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const k = clave(x);
      if (!k) continue;
      const lista = m.get(k);
      if (lista) lista.push(x); else m.set(k, [x]);
    }
    return m;
  };
  /* Oportunidades que la persona tenga por otro lado: sirven para encontrar
     sus llamadas y para poder abrirla en Leads. */
  const leadsPorContacto = agrupar(e.leads, claveDeLead);
  const llamadasPorContacto = agrupar(e.sesiones, (s) => s.contactoId);
  const llamadasPorLead = agrupar(e.sesiones, (s) => s.leadId);
  const cuotasPorVenta = agrupar(e.cuotas, (c) => c.ventaId);
  const cobradoPorCuota = new Map<string, number>();
  for (const pg of e.pagos) cobradoPorCuota.set(pg.cuotaId, (cobradoPorCuota.get(pg.cuotaId) ?? 0) + pg.monto);

  const ahora = Date.now();
  for (const p of personas.values()) {
    const suyos = p.contactoId ? leadsPorContacto.get(p.contactoId) ?? [] : [];
    if (!p.leadId && suyos[0]) deLead(p, suyos[0]);
    const leadIds = new Set([p.leadId, ...suyos.map((l) => l.id)].filter(Boolean) as string[]);

    const llamadas = new Map<string, Sesion>();
    for (const s of p.contactoId ? llamadasPorContacto.get(p.contactoId) ?? [] : []) llamadas.set(s.id, s);
    for (const id of leadIds) for (const s of llamadasPorLead.get(id) ?? []) llamadas.set(s.id, s);
    p.llamadas = [...llamadas.values()].sort((a, b) => +new Date(b.inicia) - +new Date(a.inicia));
    const proxima = [...p.llamadas].reverse()
      .find((s) => s.estado === "agendada" && +new Date(s.inicia) >= ahora - 3600000);
    p.llamada = proxima ?? p.llamadas.find((s) => s.estado !== "cancelada") ?? p.llamadas[0];
    if (!p.utm && p.llamada?.utm) p.utm = p.llamada.utm;

    for (const v of p.ventas) {
      if (v.estado === "cancelada") continue;
      p.facturado += v.precioAcordado;
      p.cobrado += (cuotasPorVenta.get(v.id) ?? []).reduce((a, c) => a + (cobradoPorCuota.get(c.id) ?? 0), 0);
    }
  }

  return [...personas.values()];
}
