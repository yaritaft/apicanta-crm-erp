import type { EstadoApp, ID, Meta, MetricaClave } from "./types";
import { inicioSemana, mesClave, nombreMes } from "./format";
import { calcularPyL, cashCollected, porCobrarTotal } from "./finanzas";

/* Todo lo que la app calcula vive acá: una sola fuente de verdad
   para los números del panel, finanzas, marketing y metas. */

export interface RangoMes { clave: string; etiqueta: string; desde: Date; hasta: Date }

export function ultimosMeses(n: number): RangoMes[] {
  const hoy = new Date();
  const out: RangoMes[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const desde = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0, 23, 59, 59);
    out.push({ clave: mesClave(desde), etiqueta: nombreMes(mesClave(desde)), desde, hasta });
  }
  return out;
}

/* Puente entre el DateRangePicker y todo el calculo, que ya trabajaba con
   rangos aunque se llamaran "mes". El borde derecho va al final del dia: si
   `hasta` quedara a las 00:00, un pago de esa misma tarde caeria afuera. */
export function rangoDeFechas(desde: string, hasta: string, etiqueta: string): RangoMes {
  const [ay, am, ad] = desde.split("-").map(Number);
  const [by, bm, bd] = hasta.split("-").map(Number);
  return {
    clave: `${desde}_${hasta}`,
    etiqueta,
    desde: new Date(ay, am - 1, ad),
    hasta: new Date(by, bm - 1, bd, 23, 59, 59),
  };
}

/* El periodo inmediatamente anterior, del mismo largo. Es contra lo que se
   compara: "vs. periodo anterior" tiene que significar los mismos dias, no
   "el mes pasado", o comparar 7 dias contra 30. */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const a = new Date(`${desde}T00:00:00`), b = new Date(`${hasta}T00:00:00`);
  const dias = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    desde: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - dias)),
    hasta: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)),
  };
}

const enMes = (iso: string, m: RangoMes) => {
  const d = new Date(iso).getTime();
  return d >= m.desde.getTime() && d <= m.hasta.getTime();
};

/* ---------- Finanzas ----------
   El cálculo real vive en lib/finanzas.ts; acá quedan los atajos
   que usan el panel y las metas.                                  */

export function ingresosMes(e: EstadoApp, m: RangoMes): number {
  return cashCollected(e, m);
}

export function egresosMes(e: EstadoApp, m: RangoMes): number {
  const p = calcularPyL(e, m);
  return p.totalDirectos + p.gastosOperativos + p.honorariosCeo;
}

export function porCobrar(e: EstadoApp): number {
  return porCobrarTotal(e);
}

export function mrr(e: EstadoApp): number {
  return e.alumnos.filter((a) => a.estado === "activo").reduce((a, x) => a + x.cuotaMensual, 0);
}

/* ---------- Leads y pipeline ---------- */

export function leadsMes(e: EstadoApp, m: RangoMes) {
  return e.leads.filter((l) => enMes(l.creadoEn, m));
}

export function inscriptosMes(e: EstadoApp, m: RangoMes) {
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  return e.leads.filter((l) => l.etapaId === ganada && enMes(l.actualizadoEn, m));
}

export function valorPipeline(e: EstadoApp): { bruto: number; ponderado: number } {
  const abiertas = e.etapas.filter((x) => !x.esGanada && !x.esPerdida).map((x) => x.id);
  let bruto = 0, ponderado = 0;
  for (const l of e.leads) {
    if (!abiertas.includes(l.etapaId)) continue;
    const et = e.etapas.find((x) => x.id === l.etapaId);
    bruto += l.monto;
    ponderado += l.monto * ((et?.probabilidad ?? 0) / 100);
  }
  return { bruto, ponderado };
}

export function tasaConversion(e: EstadoApp): number {
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  const cerrados = e.leads.filter((l) => {
    const et = e.etapas.find((x) => x.id === l.etapaId);
    return et?.esGanada || et?.esPerdida;
  });
  if (cerrados.length === 0) return 0;
  return (cerrados.filter((l) => l.etapaId === ganada).length / cerrados.length) * 100;
}

export function leadsSinContactar(e: EstadoApp) {
  const primera = [...e.etapas].sort((a, b) => a.orden - b.orden)[0]?.id;
  return e.leads.filter((l) => l.etapaId === primera);
}

/* ---------- Agenda ---------- */

export function sesionesSemana(e: EstadoApp) {
  const desde = inicioSemana(new Date());
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 7);
  return e.sesiones.filter((s) => {
    const d = new Date(s.inicia);
    return d >= desde && d < hasta;
  });
}

export function proximasSesiones(e: EstadoApp, limite = 6) {
  const ahora = Date.now();
  return e.sesiones
    .filter((s) => s.estado === "agendada" && new Date(s.inicia).getTime() >= ahora - 3600000)
    .sort((a, b) => +new Date(a.inicia) - +new Date(b.inicia))
    .slice(0, limite);
}

export function tasaShow(e: EstadoApp): number {
  const pasadas = e.sesiones.filter((s) => s.estado === "hecha" || s.estado === "no-show");
  if (pasadas.length === 0) return 0;
  return (pasadas.filter((s) => s.estado === "hecha").length / pasadas.length) * 100;
}

/* Si Meta las reporto, se usan las de Meta. Las cuentas de abajo son el
   respaldo para las campanias cargadas a mano, y no dan exactamente lo mismo:
   el CTR de Meta sale sobre impresiones servidas y redondea distinto. Entre
   un numero propio y uno que cierra contra el Ads Manager, gana el segundo.

   El CPL no viene de Meta: depende de que conversion contemos como lead, y eso
   lo decide la app. */
export function metricasCampania(c: {
  inversion: number; impresiones: number; clicks: number; leads: number;
  ctr?: number; cpc?: number; cpm?: number;
}) {
  return {
    ctr: c.ctr ?? (c.impresiones > 0 ? (c.clicks / c.impresiones) * 100 : 0),
    cpc: c.cpc ?? (c.clicks > 0 ? c.inversion / c.clicks : 0),
    cpm: c.cpm ?? (c.impresiones > 0 ? (c.inversion / c.impresiones) * 1000 : 0),
    cpl: c.leads > 0 ? c.inversion / c.leads : 0,
  };
}

/* Lo que una campania devolvio en plata.

   La cadena es venta → contacto → lead → lead.campania, y ese ultimo paso es
   por NOMBRE, no por id: hoy `campania` es texto libre en el lead. Alcanza
   mientras los nombres se escriban igual, pero se rompe si alguien renombra
   una campania en Meta. El arreglo de verdad es un `campaniaId` en el lead. */
export function negocioDeCampania(e: EstadoApp, nombre: string) {
  const leadsDeLaCampania = new Set(
    e.leads.filter((l) => l.campania === nombre).map((l) => l.id),
  );
  const ventas = e.ventas.filter(
    (v) => v.estado !== "cancelada" && v.contactoId && leadsDeLaCampania.has(v.contactoId),
  );
  const facturado = ventas.reduce((s, v) => s + v.precioAcordado, 0);
  const idsVenta = new Set(ventas.map((v) => v.id));
  const cuotas = e.cuotas.filter((c) => idsVenta.has(c.ventaId));
  const idsCuota = new Set(cuotas.map((c) => c.id));
  const cobrado = e.pagos
    .filter((p) => idsCuota.has(p.cuotaId))
    .reduce((s, p) => s + p.monto, 0);
  return { ventas: ventas.length, leads: leadsDeLaCampania.size, facturado, cobrado };
}

/* ---------- Alumnos ---------- */

export function reportesSemanaActual(e: EstadoApp) {
  const semana = inicioSemana(new Date()).getTime();
  return e.reportes.filter((r) => inicioSemana(new Date(r.semanaDel)).getTime() === semana);
}

export function semanasSinReportar(e: EstadoApp, alumnoId: string): number {
  const propios = e.reportes
    .filter((r) => r.alumnoId === alumnoId)
    .sort((a, b) => +new Date(b.semanaDel) - +new Date(a.semanaDel));
  let n = 0;
  for (const r of propios) {
    if (r.estado === "completado") break;
    n++;
  }
  return n;
}

/* ---------- Metas ---------- */

export function progresoMeta(e: EstadoApp, meta: Meta): { actual: number; pct: number } {
  const m = ultimosMeses(1)[0];
  const actual = valorMetrica(e, meta.metrica, m);
  return { actual, pct: meta.objetivo > 0 ? (actual / meta.objetivo) * 100 : 0 };
}

export function valorMetrica(e: EstadoApp, metrica: MetricaClave, m: RangoMes): number {
  switch (metrica) {
    case "ingresos": return ingresosMes(e, m);
    case "leads-nuevos": return leadsMes(e, m).length;
    case "inscriptos": return inscriptosMes(e, m).length;
    case "sesiones-hechas": return e.sesiones.filter((s) => s.estado === "hecha" && enMes(s.inicia, m)).length;
    case "alumnos-activos": return e.alumnos.filter((a) => a.estado === "activo").length;
    case "registrados-webinar": return e.webinars.filter((w) => enMes(w.fecha, m)).reduce((a, w) => a + w.registrados, 0);
    case "margen": {
      const i = ingresosMes(e, m), g = egresosMes(e, m);
      return i > 0 ? ((i - g) / i) * 100 : 0;
    }
    default: return 0;
  }
}

export const ETIQUETA_METRICA: Record<MetricaClave, string> = {
  "ingresos": "Ingresos del mes",
  "leads-nuevos": "Leads nuevos",
  "inscriptos": "Inscriptos",
  "sesiones-hechas": "Sesiones hechas",
  "alumnos-activos": "Alumnos activos",
  "margen": "Margen",
  "registrados-webinar": "Registrados a webinars",
};

/* ---------- Variación entre dos números ---------- */

export function variacion(actual: number, previo: number): number {
  if (previo === 0) return actual > 0 ? 100 : 0;
  return ((actual - previo) / previo) * 100;
}

/* ---------- Campañas desde la jerarquía de Meta ----------

   Reemplaza la lectura de `campanias`, que guardaba UN número por campaña y
   por eso el filtro de fechas no podía recortar el gasto.

   Acá el gasto se arma sumando las filas de `ad_insights` que caen dentro del
   rango, subiendo de anuncio a campaña. Eso es lo que hace que "últimos 7
   días" devuelva el gasto de esos 7 días. */

export interface FilaCampania {
  id: ID;
  nombre: string;
  objetivo: string;
  estado: string;
  inversion: number;
  impresiones: number;
  clicks: number;
  clicksEnlace: number;
  leads: number;
  ctr: number;
  cpm: number;
  cpc: number;
  ctrEnlace: number;
  cpcEnlace: number;
  cpl: number;
  /* Cuántos días y cuántos anuncios aportaron. Un CPL bajísimo con un solo día
     de datos no es un CPL bajo, es una muestra chica. */
  dias: number;
  anuncios: number;
}

export function campaniasDelRango(
  e: EstadoApp, desde: string, hasta: string,
): FilaCampania[] {
  /* De anuncio a campaña. */
  const campaniaDe = new Map(e.ads.map((a) => [a.id, a.campaignId]));

  type Acum = {
    inversion: number; impresiones: number; clicks: number;
    clicksEnlace: number; leads: number;
    dias: Set<string>; anuncios: Set<string>;
  };
  const vacio = (): Acum => ({
    inversion: 0, impresiones: 0, clicks: 0, clicksEnlace: 0, leads: 0,
    dias: new Set(), anuncios: new Set(),
  });

  const por = new Map<ID, Acum>();
  for (const i of e.adInsights) {
    /* Comparacion de strings ISO: ordenan igual que las fechas y no arrastran
       husos, que es de donde salen los errores de un dia. */
    if (i.dia < desde || i.dia > hasta) continue;
    const c = campaniaDe.get(i.adId);
    if (!c) continue;
    const a = por.get(c) ?? vacio();
    a.inversion += i.inversion;
    a.impresiones += i.impresiones;
    a.clicks += i.clicks;
    a.clicksEnlace += i.clicksEnlace ?? 0;
    a.leads += i.leads;
    a.dias.add(i.dia);
    a.anuncios.add(i.adId);
    por.set(c, a);
  }

  return e.campaigns
    .filter((c) => por.has(c.id))
    .map((c) => {
      const a = por.get(c.id)!;
      /* Las derivadas se RECALCULAN sobre los totales del rango; no se
         promedian las diarias. El promedio de siete CTR no es el CTR de la
         semana: un dia con tres impresiones pesaria igual que uno con treinta
         mil. */
      return {
        id: c.id, nombre: c.nombre, objetivo: c.objetivo, estado: c.estado,
        inversion: a.inversion, impresiones: a.impresiones, clicks: a.clicks,
        clicksEnlace: a.clicksEnlace, leads: a.leads,
        ctr: a.impresiones > 0 ? (a.clicks / a.impresiones) * 100 : 0,
        cpm: a.impresiones > 0 ? (a.inversion / a.impresiones) * 1000 : 0,
        cpc: a.clicks > 0 ? a.inversion / a.clicks : 0,
        ctrEnlace: a.impresiones > 0 ? (a.clicksEnlace / a.impresiones) * 100 : 0,
        cpcEnlace: a.clicksEnlace > 0 ? a.inversion / a.clicksEnlace : 0,
        cpl: a.leads > 0 ? a.inversion / a.leads : 0,
        dias: a.dias.size, anuncios: a.anuncios.size,
      };
    });
}

/* El primer dia con datos. Sirve de `minDate` del selector, para que "Máximo"
   no arranque en enero cuando la sincronizacion empieza en septiembre. */
export function primerDiaConDatos(e: EstadoApp): string | null {
  let min: string | null = null;
  for (const i of e.adInsights) if (!min || i.dia < min) min = i.dia;
  return min;
}
