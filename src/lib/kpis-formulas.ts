import { cuotasExigibles, valorEn, type Contexto, type DefKpi, type FormatoKpi } from "./kpis";
import { gastosDePublicidad } from "./finanzas";
import { leadsCerrados } from "./metricas";
import { numerosDelWebinar } from "./webinar";
import type { Pago, Venta, Webinar } from "./types";

/* ==================================================================
   Cómo se calcula cada métrica del Dashboard, escrito.

   Angelo (06/10): «cuando hay métricas, siempre me gusta que tengan el
   ícono de información para explicar cómo se calcula, porque uno se
   confía y puede haber error». Cada fila lleva su cuenta con las palabras
   de la propia tabla, y «Con tus números» la hace con los del período que
   se está mirando.

   Los componentes no recalculan nada: son filas de la misma tabla (por
   id), evaluadas con el mismo Contexto que el número. Así lo que dice el
   modal no puede dar distinto que la celda — «Cash Collected (CC) ÷ Revenue»
   se arma con los valores de esas dos filas.
   ================================================================== */

export type SignoKpi = "+" | "−" | "×" | "÷";

/** El valor de otra fila de la tabla, por id, en el mismo corte. */
export type ValorDeFila = (id: string) => number | null;

/** Una línea de «Con tus números»: ya resuelta, con su valor. */
export interface ComponenteKpi {
  concepto: string;
  valor: number | null;
  formato: FormatoKpi;
  signo?: SignoKpi;
  nota?: string;
}

/** Lo que pide cada explicación: una fila de la tabla (por id) o un dato
 *  suelto que no es una fila (los clics de Meta, las cuotas que ya vencieron). */
export type Pieza =
  | { id: string; signo?: SignoKpi; concepto?: string; nota?: string }
  | { concepto: string; valor: number | null; formato: FormatoKpi; signo?: SignoKpi; nota?: string };

export interface ExplicacionKpi {
  /** La cuenta, con las palabras de la tabla: «Cash Collected (CC) ÷ Revenue × 100». */
  formula: string;
  /** La misma cuenta con números redondos, para ver cómo juega. */
  ejemplo?: string;
  /** Las piezas de la cuenta, con los números del corte que se mira. `v`
   *  evalúa otra fila de la tabla en este mismo corte. */
  piezas?: (c: Contexto, v: ValorDeFila) => Pieza[] | null;
}

const ref = (id: string, signo?: SignoKpi, o: { concepto?: string; nota?: string } = {}): Pieza => ({ id, signo, ...o });
const dato = (concepto: string, valor: number | null, formato: FormatoKpi, signo?: SignoKpi, nota?: string): Pieza =>
  ({ concepto, valor, formato, signo, nota });

const suma = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const cuantas = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/* Con un embudo elegido la inversión es la del embudo, no la de Finanzas. */
const inversion = (c: Contexto, signo?: SignoKpi): Pieza => {
  const inv = c.inversionEmbudo();
  return inv !== null ? dato("Inversión del embudo", inv, "moneda", signo) : ref("inv_ads", signo);
};

/* Lo mismo con cada webinar del período: una línea por webinar. */
const porWebinar = (c: Contexto, f: (w: Webinar) => number): Pieza[] | null => {
  const ws = c.webinars();
  if (ws.length === 0) return null;
  const nombre = (w: Webinar) => `${w.titulo} · ${w.fecha.slice(8, 10)}/${w.fecha.slice(5, 7)}`;
  return ws.map((w, i) => dato(nombre(w), f(w), "moneda", i === 0 ? undefined : "+"));
};

const COSTOS_DIRECTOS: Pieza[] = [
  ref("r_closers", "−"), ref("r_director", "−"), ref("r_fees", "−"), ref("r_directos", "−"),
];

/* ---------- Las explicaciones ---------- */

const EXPLICACIONES: Record<string, ExplicacionKpi> = {
  /* ===== Adquisición ===== */
  inv_ads: {
    formula: "Gastos cargados como Meta Ads, Google Ads y TikTok Ads con fecha del período",
    piezas: (c) => {
      if (!c.general) return null;
      const xs = gastosDePublicidad(c.e, c.m);
      return ["Meta Ads", "Google Ads", "TikTok Ads"]
        .map((cat) => ({ cat, monto: suma(xs.filter((x) => x.categoria === cat).map((x) => x.monto)) }))
        .filter((x) => x.monto > 0)
        .map((x, i) => dato(x.cat, x.monto, "moneda", i === 0 ? undefined : "+"));
    },
  },
  w_pauta: {
    formula: "Pauta de cada webinar del período (la de su planilla; si está en cero, lo que gastaron sus campañas de Meta), sumadas",
    piezas: (c) => porWebinar(c, (w) => numerosDelWebinar(c.e, w).inversion),
  },
  w_dm: {
    formula: "DM Ads de cada webinar del período (los de su planilla o, si están en cero, los de las campañas «DM» de Meta), sumados",
    piezas: (c) => porWebinar(c, (w) => numerosDelWebinar(c.e, w).inversionDmAds),
  },
  w_wapi: {
    formula: "Costo de WhatsApp API de cada webinar del período, sumado. Se carga a mano: no pasa por Meta",
    piezas: (c) => porWebinar(c, (w) => w.costoWhatsappApi),
  },
  w_inv: {
    formula: "Pauta de captación + DM Ads + WhatsApp API",
    piezas: () => [ref("w_pauta"), ref("w_dm", "+"), ref("w_wapi", "+")],
  },
  meta_gasto: { formula: "Gasto que informa Meta, sumado de todos los días del período" },
  meta_impr: { formula: "Impresiones que informa Meta, sumadas de todos los días del período" },
  meta_ctr: {
    formula: "Clics ÷ Impresiones × 100",
    piezas: (c) => [dato("Clics", c.meta()?.clicks ?? null, "cantidad"), ref("meta_impr", "÷")],
  },
  meta_cpc: {
    formula: "Gasto en Meta ÷ Clics",
    piezas: (c) => [ref("meta_gasto"), dato("Clics", c.meta()?.clicks ?? null, "cantidad", "÷")],
  },
  meta_cpm: {
    formula: "Gasto en Meta ÷ Impresiones × 1.000",
    piezas: () => [ref("meta_gasto"), ref("meta_impr", "÷")],
  },
  meta_leads: { formula: "Conversiones que Meta cuenta como lead, sumadas de todos los días del período" },
  meta_cpl: {
    formula: "Gasto en Meta ÷ Leads según Meta",
    piezas: () => [ref("meta_gasto"), ref("meta_leads", "÷")],
  },
  w_form: { formula: "Formularios completados de cada webinar del período (los de su planilla o, si están en cero, los de las campañas de Meta), sumados" },
  w_cpf: { formula: "Inversión total del webinar ÷ Formularios completados", piezas: () => [ref("w_inv"), ref("w_form", "÷")] },
  w_grupo: { formula: "Gente que entró al grupo de WhatsApp en cada webinar del período, sumada" },
  w_cpg: { formula: "Inversión total del webinar ÷ Se unieron al grupo", piezas: () => [ref("w_inv"), ref("w_grupo", "÷")] },
  w_form_grupo: { formula: "Se unieron al grupo ÷ Formularios completados × 100", piezas: () => [ref("w_grupo"), ref("w_form", "÷")] },
  personas: { formula: "Contactos creados con fecha del período, por formulario, agenda u otro canal. Con un webinar elegido, sólo los que vinieron de ese webinar" },
  leads_nuevos: { formula: "Oportunidades abiertas con fecha del período" },

  /* ===== Webinar y agenda ===== */
  w_n: { formula: "Webinars con fecha dentro del período" },
  w_asist: { formula: "Gente que estuvo en el vivo de cada webinar del período, sumada" },
  w_asist_pct: { formula: "Asistieron al vivo ÷ Se unieron al grupo × 100", piezas: () => [ref("w_asist"), ref("w_grupo", "÷")] },
  w_ll_vivo: { formula: "Llamadas agendadas durante el vivo, de cada webinar del período, sumadas" },
  w_ll_post: { formula: "Llamadas agendadas después del vivo (con el replay, el seguimiento, la clase cero o el Q&A), de cada webinar del período, sumadas" },
  w_ll_replay: { formula: "Agendas cuyo link de Calendly trae utm_content=replay, de la gente de los webinars del período" },
  w_ll_seguimiento: { formula: "Agendas cuyo link de Calendly trae utm_content=seguimiento, de la gente de los webinars del período" },
  w_ll_clase0: { formula: "Agendas con los links de la clase cero (vivo, replay y seguimiento), de la gente de los webinars del período" },
  w_ll_qa: { formula: "Agendas con los links del Q&A (vivo, replay y seguimiento), de la gente de los webinars del período" },
  w_ll: { formula: "Agendas en el vivo + Agendas después del vivo", piezas: () => [ref("w_ll_vivo"), ref("w_ll_post", "+")] },
  w_pct_agenda: { formula: "Agendas del webinar ÷ Se unieron al grupo × 100", piezas: () => [ref("w_ll"), ref("w_grupo", "÷")] },
  w_cpll: { formula: "Inversión total del webinar ÷ Agendas del webinar", piezas: () => [ref("w_inv"), ref("w_ll", "÷")] },
  w_ll_calif: { formula: "Llamadas del webinar con gente que califica: puede invertir 1.000 USD o más, tiene inglés conversacional y carrera" },
  w_cpllc: { formula: "Inversión total del webinar ÷ Llamadas calificadas", piezas: () => [ref("w_inv"), ref("w_ll_calif", "÷")] },
  ag_nuevas: { formula: "Llamadas cuya agenda se creó dentro del período (Calendly). Con un webinar elegido, las de la gente que vino de ese webinar" },
  ag_costo: {
    formula: "Inversión en publicidad ÷ Llamadas agendadas",
    piezas: () => [ref("inv_ads"), ref("ag_nuevas", "÷")],
  },
  ag_calif: { formula: "Agendas del período de gente que califica: puede invertir 1.000 USD o más, tiene inglés conversacional y carrera (lo que contestó en Calendly)" },
  ag_calif_pct: { formula: "Agendas calificadas ÷ Llamadas agendadas × 100", piezas: () => [ref("ag_calif"), ref("ag_nuevas", "÷")] },
  ag_costo_calif: { formula: "Inversión en publicidad ÷ Agendas calificadas", piezas: () => [ref("inv_ads"), ref("ag_calif", "÷")] },
  ag_hechas: { formula: "Llamadas con horario dentro del período que quedaron marcadas como hechas" },
  ag_noshow: { formula: "Llamadas con horario dentro del período que quedaron marcadas como «no vino»" },
  ag_canceladas: { formula: "Llamadas con horario dentro del período que se cancelaron" },
  ag_show: {
    formula: "Hechas ÷ (Hechas + No vinieron) × 100",
    piezas: (_c, v) => {
      const h = v("ag_hechas"), n = v("ag_noshow");
      return [ref("ag_hechas"), dato("Hechas + No vinieron", h === null || n === null ? null : h + n, "cantidad", "÷")];
    },
  },
  ag_porvenir: { formula: "Llamadas agendadas cuyo horario todavía no llegó. Es una foto de hoy" },
  pipe_abierto: { formula: "Suma del monto de los leads que todavía no están ni ganados ni perdidos. Es una foto de hoy" },
  pipe_pond: { formula: "Suma de (monto del lead × probabilidad de su etapa) de cada lead abierto. Es una foto de hoy" },
  pipe_sincontactar: { formula: "Leads que están en la primera etapa del pipeline. Es una foto de hoy" },
  pipe_cierre: {
    formula: "Ganados ÷ (Ganados + Perdidos) × 100, sobre todos los leads ya definidos",
    piezas: (c) => {
      const { ganados, perdidos } = leadsCerrados(c.e);
      return [dato("Leads ganados", ganados.length, "cantidad"), dato("Leads ganados + perdidos", ganados.length + perdidos.length, "cantidad", "÷")];
    },
  },

  /* ===== Ventas ===== */
  v_n: { formula: "Ventas con fecha del período, sin las canceladas ni las que son sólo una reserva" },
  v_principal: { formula: "Ventas del período (sin canceladas ni reservas) cuyo producto es de tipo principal: las mentorías" },
  v_downsell: { formula: "Ventas del período (sin canceladas ni reservas) cuyo producto es de tipo downsell" },
  v_upsell: { formula: "Ventas del período (sin canceladas ni reservas) cuyo producto es de tipo upsell" },
  v_1: { formula: "Ventas del período con una sola cuota, sin contar la reserva" },
  v_2: { formula: "Ventas del período con dos cuotas, sin contar la reserva" },
  v_3: { formula: "Ventas del período con tres cuotas, sin contar la reserva" },
  v_4: { formula: "Ventas del período con cuatro cuotas o más, sin contar la reserva" },
  v_fact: {
    formula: "Suma del precio acordado de las ventas con fecha del período, sin las canceladas. Entra lo que se vendió aunque todavía no se haya cobrado",
    ejemplo: "Si en el mes cerraste dos ventas de US$ 2.500 y una de US$ 5.000, el Revenue es US$ 10.000, aunque no haya entrado ningún pago.",
    piezas: (c) => {
      const tipo = (v: Venta) => (v.productoId ? c.ix.tipoProducto.get(v.productoId) : undefined);
      const grupos: [string, (t: string | undefined) => boolean][] = [
        ["Programas (principal)", (t) => t === "principal"],
        ["Downsells", (t) => t === "downsell"],
        ["Upsells", (t) => t === "upsell"],
        ["Otros productos", (t) => t !== "principal" && t !== "downsell" && t !== "upsell"],
      ];
      return grupos
        .map(([nombre, es]) => {
          const vs = c.ventas().filter((v) => es(tipo(v)));
          return { nombre, vs, monto: suma(vs.map((v) => v.precioAcordado)) };
        })
        .filter((x) => x.vs.length > 0)
        .map((x, i) => dato(x.nombre, x.monto, "moneda", i === 0 ? undefined : "+", cuantas(x.vs.length, "venta", "ventas")));
    },
  },
  v_ticket: {
    formula: "Revenue ÷ Ventas",
    ejemplo: "US$ 10.000 facturados en 3 ventas: el ticket promedio es US$ 3.333.",
    piezas: () => [ref("v_fact"), ref("v_n", "÷", { nota: "sin las canceladas ni las que son sólo reserva" })],
  },
  v_1_pct: { formula: "Ventas en 1 pago ÷ Ventas × 100", piezas: () => [ref("v_1"), ref("v_n", "÷")] },
  v_equiv: {
    formula: "Programas vendidos + (plata de Downsells y de Reservas ÷ ticket promedio del programa)",
    ejemplo: "5 programas de US$ 2.500, más 5 downsells de US$ 500 (US$ 2.500 en total): 5 + 2.500 ÷ 2.500 = 6 ventas equivalentes.",
  },
  v_ag_venta: { formula: "Ventas ÷ Llamadas agendadas × 100", piezas: () => [ref("v_n"), ref("ag_nuevas", "÷")] },
  w_cierre: {
    formula: "Ventas del webinar ÷ Llamadas calificadas del webinar × 100",
    piezas: (c) => [dato("Ventas del webinar", c.web()?.ventas ?? null, "cantidad"), ref("w_ll_calif", "÷")],
  },
  w_grupo_venta: {
    formula: "Ventas del webinar ÷ Se unieron al grupo × 100",
    piezas: (c) => [dato("Ventas del webinar", c.web()?.ventas ?? null, "cantidad"), ref("w_grupo", "÷")],
  },
  wv_vivo: { formula: "Ventas del webinar de gente que agendó en el vivo" },
  wv_replay: { formula: "Ventas del webinar de gente que agendó con el link de la grabación (utm_content=replay)" },
  wv_seguimiento: { formula: "Ventas del webinar de gente que agendó con el link de los mails o mensajes de después (utm_content=seguimiento)" },
  wv_clase0: { formula: "Ventas del webinar de gente que agendó con un link de la clase cero" },
  wv_qa: { formula: "Ventas del webinar de gente que agendó con un link del Q&A" },
  cac: {
    formula: "Inversión en publicidad ÷ Ventas",
    ejemplo: "US$ 5.000 en publicidad y 4 ventas: el CAC es US$ 1.250.",
    piezas: (c) => [inversion(c), ref("v_n", "÷")],
  },
  w_cac: {
    formula: "Inversión total del webinar ÷ Ventas del webinar",
    piezas: (c) => [ref("w_inv"), dato("Ventas del webinar", c.web()?.ventas ?? null, "cantidad", "÷")],
  },
  roas_cc: {
    formula: "Cash Collected (CC) ÷ Inversión en publicidad",
    ejemplo: "Invertiste US$ 5.000 y entraron US$ 12.500: ROAS on CC = 2,5x. Cuenta sólo la plata que ya entró.",
    piezas: (c) => [ref("c_cc"), inversion(c, "÷")],
  },
  roas_rev: {
    formula: "Revenue ÷ Inversión en publicidad",
    ejemplo: "Con los mismos US$ 5.000 y US$ 20.000 vendidos: ROAS on Revenue = 4x. Cuenta lo vendido como si todos pagaran todas las cuotas.",
    piezas: (c) => [ref("v_fact"), inversion(c, "÷")],
  },
  w_roas_cc: {
    formula: "Cobrado de las ventas del webinar ÷ Inversión total del webinar",
    piezas: (c) => [dato("Cobrado de las ventas del webinar", c.web()?.cobrado ?? null, "moneda"), ref("w_inv", "÷")],
  },
  w_roas_rev: {
    formula: "Facturado por las ventas del webinar ÷ Inversión total del webinar",
    piezas: (c) => [dato("Facturado por las ventas del webinar", c.web()?.facturado ?? null, "moneda"), ref("w_inv", "÷")],
  },

  /* ===== Cobranza ===== */
  c_cc: {
    formula: "Suma de los pagos que entraron con fecha del período, sin importar cuándo se hizo la venta",
    ejemplo: "Si en septiembre entraron tres pagos de US$ 1.000, US$ 1.500 y US$ 500, el Cash Collected (CC) de septiembre es US$ 3.000, aunque uno sea la cuota de una venta de agosto.",
    piezas: (c) => {
      const reserva = (p: Pago) => Boolean(c.ix.cuotaPorId.get(p.cuotaId)?.esReserva);
      const cuotas = c.pagos().filter((p) => !reserva(p)), reservas = c.pagos().filter(reserva);
      return [
        dato("Cuotas cobradas", suma(cuotas.map((p) => p.monto)), "moneda", undefined, cuantas(cuotas.length, "pago", "pagos")),
        dato("Reservas cobradas", suma(reservas.map((p) => p.monto)), "moneda", "+", cuantas(reservas.length, "pago", "pagos")),
      ];
    },
  },
  c_tasa: {
    formula: "Cash Collected (CC) ÷ Revenue × 100",
    ejemplo: "Facturaste US$ 10.000 y entraron US$ 6.000: la tasa de cobro es 60%.",
    piezas: () => [ref("c_cc"), ref("v_fact", "÷")],
  },
  c_reservas: { formula: "Suma de los pagos del período que son reservas o señas" },
  c_porcobrar: { formula: "Saldo de todas las cuotas pendientes de ventas activas, hayan vencido o no. Es una foto de hoy" },
  c_vencido: { formula: "Saldo de las cuotas pendientes cuyo vencimiento ya pasó. Es una foto de hoy" },
  c_vencidas: { formula: "Cuotas pendientes cuyo vencimiento ya pasó. Es una foto de hoy" },
  c_mora: {
    formula: "Cuotas vencidas sin pagar ÷ Cuotas que ya vencieron × 100 (de ventas activas, sin las canceladas)",
    ejemplo: "Si ya vencieron 40 cuotas y 6 siguen sin pagar, la tasa de mora es 15%.",
    piezas: (c) => [ref("c_vencidas"), dato("Cuotas que ya vencieron", cuotasExigibles(c).length, "cantidad", "÷", "pagadas o no")],
  },
  c_7: { formula: "Ventas distintas con al menos una cuota vencida hace 7 días o más. Es una foto de hoy" },
  c_10: { formula: "Ventas distintas con al menos una cuota vencida hace 10 días o más. Es una foto de hoy" },
  c_12: { formula: "Ventas distintas con al menos una cuota vencida hace 12 días o más. Es una foto de hoy" },
  c_15: { formula: "Ventas distintas con al menos una cuota vencida hace 15 días o más. Es una foto de hoy" },
  c_20: { formula: "Ventas distintas con al menos una cuota vencida hace 20 días o más. Es una foto de hoy" },
  c_peor: { formula: "Días de atraso de la cuota pendiente más vieja. Es una foto de hoy" },
  c_canceladas: { formula: "Ventas con fecha del período que quedaron canceladas" },
  c_cancel_pct: { formula: "Ventas canceladas ÷ Todas las ventas del período (las canceladas incluidas) × 100", piezas: (c) => [ref("c_canceladas"), dato("Todas las ventas del período", c.ventasTodas().length, "cantidad", "÷", "canceladas incluidas")] },
  c_reembolsadas: { formula: "Ventas con fecha del período marcadas como reembolsadas" },
  c_sinconciliar: { formula: "Suma de los movimientos que entraron a una pasarela y todavía no se imputaron a ninguna cuota. Es una foto de hoy" },

  /* ===== Rentabilidad ===== */
  r_fees: {
    formula: "Suma de la comisión de procesador de cada pago del período: el monto × la tasa de la cuenta recaudadora (o la comisión real, si el cobro se concilió)",
  },
  r_closers: {
    formula: "Por cada venta con cobros en el período: (lo cobrado − lo que se quedó el procesador) × % del closer en ese servicio. Si la cerró alguien que no comisiona (Yari), nadie comisiona",
    ejemplo: "Un closer cobró US$ 2.000 de un cliente y el procesador se quedó US$ 100: comisiona sobre US$ 1.900. Con un 10%, son US$ 190.",
  },
  r_director: {
    formula: "Por cada venta con cobros en el período: (lo cobrado − lo que se quedó el procesador) × % del director en ese servicio",
  },
  r_directos: { formula: "Gastos del período cargados como costos directos: setters, financieras, referidores" },
  r_bruto: {
    formula: "Cash Collected (CC) − Comisión de closers − Comisión del director − Procesadores de pago − Otros costos directos",
    ejemplo: "Cobraste US$ 10.000 y los costos directos fueron US$ 2.000: la utilidad bruta es US$ 8.000.",
    piezas: () => [ref("c_cc"), ...COSTOS_DIRECTOS],
  },
  r_opex: { formula: "Gastos del período cargados como operativos. Incluye la publicidad (Meta, Google y TikTok)" },
  r_operativo: { formula: "Utilidad bruta (cobrado) − Gastos operativos", piezas: () => [ref("r_bruto"), ref("r_opex", "−")] },
  r_growth: { formula: "Profit del negocio sin el CEO (si es positivo) × % del growth partner × la parte de lo vendido que no está excluida de marketing" },
  r_socio: { formula: "Profit del negocio sin el CEO (si es positivo) × % del socio" },
  r_ceo: { formula: "Gastos del período cargados como honorarios del dueño" },
  r_neto_cc: {
    formula: "Cash Collected (CC) − costos directos (comisiones, procesadores y otros) − Gastos operativos − Honorarios del CEO",
    ejemplo: "Entraron US$ 10.000; comisiones, procesadores y otros costos directos suman US$ 2.000; los gastos operativos, US$ 4.000, y los honorarios, US$ 1.000. Profit on CC = 10.000 − 2.000 − 4.000 − 1.000 = US$ 3.000.",
    piezas: () => [ref("c_cc"), ...COSTOS_DIRECTOS, ref("r_opex", "−"), ref("r_ceo", "−")],
  },
  r_neto_rev: {
    formula: "Revenue − costos directos (comisiones, procesadores y otros) − Gastos operativos − Honorarios del CEO",
    ejemplo: "Con los mismos costos, pero contando los US$ 16.000 que se vendieron en vez de los US$ 10.000 que entraron: 16.000 − 2.000 − 4.000 − 1.000 = US$ 9.000. Es lo que ganarías si todos pagaran todo; por eso es «en teoría».",
    piezas: () => [ref("v_fact"), ...COSTOS_DIRECTOS, ref("r_opex", "−"), ref("r_ceo", "−")],
  },
  r_margen: { formula: "Profit on Cash Collected (CC) ÷ Cash Collected (CC) × 100", piezas: () => [ref("r_neto_cc"), ref("c_cc", "÷")] },
  r_queda: { formula: "Profit on Cash Collected (CC) − Growth partner − Socio", piezas: () => [ref("r_neto_cc"), ref("r_growth", "−"), ref("r_socio", "−")] },
  e_inv: { formula: "Con un embudo elegido: lo invertido en sus webinars (pauta, DM Ads y WhatsApp API), en sus campañas de Meta y en los gastos cargados con ese embudo" },
  e_profit_cc: {
    formula: "Cash Collected (CC) − Procesadores − Comisiones (closers y director) − Inversión del embudo. Sin los gastos fijos de la empresa",
    piezas: () => [ref("c_cc"), ref("r_fees", "−"), ref("r_closers", "−"), ref("r_director", "−"), ref("e_inv", "−")],
  },
  e_profit_rev: {
    formula: "Revenue − Procesadores − Comisiones (closers y director) − Inversión del embudo. Sin los gastos fijos de la empresa",
    piezas: () => [ref("v_fact"), ref("r_fees", "−"), ref("r_closers", "−"), ref("r_director", "−"), ref("e_inv", "−")],
  },
  w_profit_cc: {
    formula: "Cobrado de las ventas del webinar − Inversión total − Comisiones − Procesadores − Otros gastos cargados a ese webinar",
    piezas: (c) => {
      const m = c.web();
      return [
        dato("Cobrado de las ventas del webinar", m?.cobrado ?? null, "moneda"),
        ref("w_inv", "−"),
        dato("Comisiones", m?.comisiones ?? null, "moneda", "−"),
        dato("Procesadores de pago", m?.procesador ?? null, "moneda", "−"),
        dato("Otros gastos del webinar", m?.otrosGastos ?? null, "moneda", "−"),
      ];
    },
  },
  w_profit_rev: {
    formula: "Facturado por las ventas del webinar − Inversión total − Comisiones − Procesadores − Otros gastos cargados a ese webinar",
    piezas: (c) => {
      const m = c.web();
      return [
        dato("Facturado por las ventas del webinar", m?.facturado ?? null, "moneda"),
        ref("w_inv", "−"),
        dato("Comisiones", m?.comisiones ?? null, "moneda", "−"),
        dato("Procesadores de pago", m?.procesador ?? null, "moneda", "−"),
        dato("Otros gastos del webinar", m?.otrosGastos ?? null, "moneda", "−"),
      ];
    },
  },

  /* ===== Servicio ===== */
  s_activos: { formula: "Alumnos que hoy tienen el estado activo" },
  s_nuevos: { formula: "Alumnos cuya fecha de inicio cae dentro del período" },
  s_mrr: { formula: "Suma de la cuota mensual de cada alumno activo" },
  s_progreso: { formula: "Promedio del progreso de los alumnos activos, sobre el total del programa" },
  s_sinreportar: { formula: "Alumnos activos que llevan dos semanas seguidas o más sin mandar su reporte semanal" },
};

/** La explicación de una fila. Las que se arman por categoría o por etapa
 *  (los gastos, el pipeline de servicio) no están una por una: se explican por
 *  su prefijo. null: esa fila no tiene más que decir que su ayuda. */
export function explicacionDe(def: DefKpi): ExplicacionKpi | null {
  const e = EXPLICACIONES[def.id];
  if (e) return e;
  if (def.id.startsWith("r_cat:")) return { formula: `Gastos cargados como «${def.etiqueta}» con fecha del período, sin los honorarios del dueño ni los retiros` };
  if (def.id.startsWith("s_etapa:")) return { formula: `Alumnos que hoy están en la etapa «${def.etiqueta}» del pipeline de servicio. Es una foto de hoy` };
  return null;
}

/** Las piezas de la cuenta con los valores del corte, listas para dibujar.
 *  `porId` es el catálogo entero: cada pieza que es una fila se evalúa con
 *  la misma función y el mismo contexto que la celda de esa fila. */
export function componentesDe(def: DefKpi, c: Contexto, porId: Map<string, DefKpi>): ComponenteKpi[] | null {
  const v: ValorDeFila = (id) => { const d = porId.get(id); return d ? valorEn(d, c) : null; };
  const piezas = explicacionDe(def)?.piezas?.(c, v);
  if (!piezas || piezas.length === 0) return null;
  const out: ComponenteKpi[] = [];
  for (const p of piezas) {
    if ("valor" in p) { out.push(p); continue; }
    const d = porId.get(p.id);
    if (!d) continue;
    out.push({ concepto: p.concepto ?? d.etiqueta, valor: v(p.id), formato: d.formato, signo: p.signo, nota: p.nota });
  }
  return out;
}

