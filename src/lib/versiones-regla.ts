import type { ConceptoPago, EsquemaPago, ID, Liquidacion, MiembroEquipo, TipoConcepto } from "./types";

/* ==================================================================
   Las reglas de lo que cobra cada uno tienen historia (Yari, 20/11):

     «Si cada vez que yo te digo "las comisiones ahora se calculan así",
     vos borrás lo que tenemos y ponés otra cosa, después, cuando
     analicemos la información hacia el pasado, no va a andar bien. Que en
     cada momento de la facturación te calcule las cosas como se calculaban
     en ese momento.»

   Hasta acá, cambiar una regla la pisaba: el % nuevo valía también para
   los meses de antes (Finanzas, el resultado de cada webinar y las
   liquidaciones abiertas). Ahora cambiar cómo se calcula pide «¿desde
   cuándo?»: la regla de antes queda con su `hasta` (el día anterior) y la
   nueva arranca con su `desde`. Las dos son versiones de la misma regla
   (`versionDe`, el id de la primera) y el motor ya sabía medir cada una
   sólo en sus días. Sacar una regla tampoco la borra: deja de valer.
   Pisar sigue existiendo para lo que estaba mal cargado («Siempre fue
   así»), con el aviso de que cambia también lo de antes.
   ================================================================== */

/** «Desde cuándo vale» un cambio: desde un día (lo de antes queda como estaba) o siempre (corrige también lo de antes). */
export type DesdeCuando = { tipo: "siempre" } | { tipo: "desde"; dia: string };

const partes = (dia: string) => dia.slice(0, 10).split("-").map(Number);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** El día anterior (YYYY-MM-DD). */
export const diaAnterior = (dia: string): string => { const [a, m, d] = partes(dia); return iso(new Date(Date.UTC(a, m - 1, d - 1))); };
/** El día siguiente (YYYY-MM-DD). */
export const diaSiguiente = (dia: string): string => { const [a, m, d] = partes(dia); return iso(new Date(Date.UTC(a, m - 1, d + 1))); };
/** El primero del mes de ese día. */
export const primeroDelMes = (dia: string): string => `${dia.slice(0, 7)}-01`;
/** El primero del mes siguiente. */
export const primeroDelMesQueViene = (dia: string): string => { const [a, m] = partes(dia); return iso(new Date(Date.UTC(a, m, 1))); };

/** El id que comparten todas las versiones de una regla: el de la primera. */
export const raizDe = (c: Pick<ConceptoPago, "id" | "versionDe">): ID => c.versionDe ?? c.id;

/* Lo que no cambia cómo se calcula: el nombre, lo acordado, la confirmación, las fechas (se cambian a mano, a propósito) y el
   versionado. Los false, los vacíos y el orden de las listas tampoco. */
const NO_CALCULA = new Set(["id", "nombre", "notas", "confirmadaPor", "confirmadaEl", "desde", "hasta", "versionDe", "inicioVentas"]);

function huella(c: ConceptoPago): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (NO_CALCULA.has(k) || v === undefined || v === null || v === false || v === "") continue;
    if (Array.isArray(v)) { if (v.length) out[k] = [...v].map(String).sort(); continue; }
    out[k] = v;
  }
  return JSON.stringify(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/** Si dos versiones de una regla calculan lo mismo (aunque cambie el nombre, lo acordado o la confirmación). */
export const mismoCalculo = (a: ConceptoPago, b: ConceptoPago): boolean => huella(a) === huella(b);

/** Si en un cambio de día a mitad de mes la regla se reparte bien entre las dos versiones: un fijo se prorratea y un % mide sus días.
 *  Un bono, un tramo o una tarifa por pieza se cuentan por mes entero: el cambio va el primero de un mes. */
export const seParteEnElMes = (tipo: TipoConcepto | null | undefined): boolean => tipo === "porcentaje" || tipo === "fijo";

const vale = (c: Pick<ConceptoPago, "desde" | "hasta">, dia: string) =>
  (!c.desde || c.desde.slice(0, 10) <= dia) && (!c.hasta || c.hasta.slice(0, 10) >= dia);

/** Las versiones de la misma regla que `c`, de la más vieja a la más nueva. */
export function versionesDe(conceptos: ConceptoPago[], c: Pick<ConceptoPago, "id" | "versionDe">): ConceptoPago[] {
  const r = raizDe(c);
  return conceptos.filter((x) => raizDe(x) === r).sort((a, b) => (a.desde ?? "").localeCompare(b.desde ?? ""));
}

export interface ReglaConHistoria {
  /** La que vale hoy; si ninguna, la próxima que va a valer; si tampoco, la última que valió. */
  actual: ConceptoPago;
  /** Las que ya no valen, de la más nueva a la más vieja. */
  anteriores: ConceptoPago[];
  /** Las que todavía no empezaron (además de `actual`, si es una de ésas). */
  proximas: ConceptoPago[];
}

/** Lo que cobra alguien, una regla por renglón (en el orden en que aparecen), cada una con sus versiones de antes y las que vienen. */
export function reglasConHistoria(conceptos: ConceptoPago[], hoy: string): ReglaConHistoria[] {
  const orden: ID[] = [];
  for (const c of conceptos) if (!orden.includes(raizDe(c))) orden.push(raizDe(c));
  return orden.map((r) => {
    const vs = conceptos.filter((x) => raizDe(x) === r).sort((a, b) => (a.desde ?? "").localeCompare(b.desde ?? ""));
    const actual = vs.find((x) => vale(x, hoy))
      ?? vs.find((x) => x.desde && x.desde.slice(0, 10) > hoy)
      ?? vs[vs.length - 1];
    return {
      actual,
      anteriores: vs.filter((x) => x !== actual && x.hasta && x.hasta.slice(0, 10) < hoy).reverse(),
      proximas: vs.filter((x) => x !== actual && x.desde && x.desde.slice(0, 10) > hoy),
    };
  });
}

/** Si la regla ya valió algún día (empezó hoy o antes): cambiarla así tocaría lo de antes. */
export const yaValio = (c: Pick<ConceptoPago, "desde">, hoy: string): boolean => !c.desde || c.desde.slice(0, 10) <= hoy;

/* La regla, cortada el día anterior a `dia`. null: no valía ningún día antes (empezaba ese día o después), así que no queda nada de ella. */
function cortada(c: ConceptoPago, dia: string): ConceptoPago | null {
  const ant = diaAnterior(dia);
  if (c.desde && c.desde.slice(0, 10) > ant) return null;
  if (c.hasta && c.hasta.slice(0, 10) <= ant) return c;
  return { ...c, hasta: ant };
}

/* La nueva versión de `antes`, con lo que dice `nuevo`, desde `dia`. */
function nuevaVersion(antes: ConceptoPago, nuevo: ConceptoPago, dia: string, id: ID): ConceptoPago {
  const { confirmadaPor: _p, confirmadaEl: _e, inicioVentas: _i, ...resto } = nuevo;
  const v: ConceptoPago = { ...resto, id, versionDe: raizDe(antes), desde: dia };
  if (nuevo.hasta && nuevo.hasta.slice(0, 10) >= dia) v.hasta = nuevo.hasta; else delete v.hasta;
  /* «Sólo ventas cerradas desde el inicio»: el inicio es el de la regla, no el día del cambio. Sin inicio, la regla no hacía nada. */
  if (v.soloVentasDesdeInicio) {
    const inicio = antes.inicioVentas ?? antes.desde;
    if (inicio && inicio.slice(0, 10) < dia) v.inicioVentas = inicio.slice(0, 10);
    else if (!inicio) delete v.soloVentasDesdeInicio;
  }
  return v;
}

/** Aplica un cambio a lo que cobra alguien sin perder cómo era antes.
 *  `previos`: lo que había; `nuevos`: cómo queda (lo que armó el asistente o el cuadro de comisiones).
 *  - «Siempre» (estaba mal cargada): se pisa, como antes.
 *  - Desde un día: la regla que cambió cómo se calcula queda como estaba hasta el día anterior y su versión nueva arranca ese día (con
 *    el mismo fin que tenía, si tenía uno); la que se sacó deja de valer el día anterior (no se borra), y con ella las versiones suyas
 *    que venían después; la que se agregó arranca ese día. Si de la de antes no queda ningún día (empezaba ese día o después), la
 *    nueva la reemplaza con el mismo id.
 *  Lo que no cambia el cálculo (el nombre, lo acordado, la confirmación, las fechas puestas a mano) se guarda tal cual. */
export function conVersiones(previos: ConceptoPago[], nuevos: ConceptoPago[], cuando: DesdeCuando, nuevoId: () => ID): ConceptoPago[] {
  if (cuando.tipo === "siempre") return nuevos;
  const dia = cuando.dia.slice(0, 10);
  const porId = new Map(nuevos.map((c) => [c.id, c] as const));
  const previosIds = new Set(previos.map((c) => c.id));
  /* Las reglas que se sacaron: sus versiones que venían después también dejan de valer. */
  const sacadas = new Set(previos.filter((p) => !porId.has(p.id)).map(raizDe));
  const out: ConceptoPago[] = [];

  for (const p of previos) {
    const n = porId.get(p.id);
    if (n && mismoCalculo(p, n)) {
      if (!sacadas.has(raizDe(p))) { out.push(n); continue; }
      const q = cortada(n, dia);
      if (q) out.push(q);
      continue;
    }
    const queda = cortada(p, dia);
    if (queda) out.push(queda);
    if (!n) continue;
    if (queda) { out.push(nuevaVersion(p, n, dia, nuevoId())); continue; }
    const v = nuevaVersion(p, n, dia, p.id);
    if (p.versionDe) v.versionDe = p.versionDe; else delete v.versionDe;
    out.push(v);
  }
  for (const n of nuevos) {
    if (previosIds.has(n.id)) continue;
    out.push({ ...n, desde: n.desde && n.desde.slice(0, 10) > dia ? n.desde : dia });
  }
  /* Las versiones de antes de una regla que cambió desde un día anterior a su inicio (se corrió la fecha para atrás): se acortan hasta
     el día anterior, o se van si empezaban después. Así nunca valen dos versiones de la misma regla el mismo día. */
  const corridas = previos.filter((p) => {
    const n = porId.get(p.id);
    return n && !mismoCalculo(p, n) && p.desde && p.desde.slice(0, 10) >= dia;
  });
  if (corridas.length === 0) return out;
  const antesDe = new Map(corridas.map((p) => [raizDe(p), (p.desde ?? "").slice(0, 10)] as const));
  return out.flatMap((c) => {
    const inicio = antesDe.get(raizDe(c));
    /* Sólo las que empezaban antes que la que se corrió (las de antes); la nueva y las que vienen después, como están. */
    if (inicio === undefined || (c.desde ?? "").slice(0, 10) >= inicio || !previosIds.has(c.id)) return [c];
    if (corridas.some((p) => p.id === c.id)) return [c];
    const q = cortada(c, dia);
    return q ? [q] : [];
  });
}

/** Saca una versión que estaba mal cargada y deshace el cambio: la versión de antes vuelve a valer hasta donde llegaba la que se saca. */
export function sinVersion(conceptos: ConceptoPago[], c: ConceptoPago): ConceptoPago[] {
  const resto = conceptos.filter((x) => x.id !== c.id);
  if (!c.desde) return resto;
  const anterior = diaAnterior(c.desde);
  return resto.map((x) => {
    if (raizDe(x) !== raizDe(c) || !x.hasta || x.hasta.slice(0, 10) !== anterior) return x;
    if (c.hasta) return { ...x, hasta: c.hasta };
    const { hasta: _h, ...abierta } = x;
    return abierta;
  });
}

/** La versión que deja de valer justo antes de que empiece `c` (la que se recupera si `c` se saca por mal cargada). */
export function versionAnterior(conceptos: ConceptoPago[], c: ConceptoPago): ConceptoPago | undefined {
  if (!c.desde) return undefined;
  const anterior = diaAnterior(c.desde);
  return conceptos.find((x) => x.id !== c.id && raizDe(x) === raizDe(c) && x.hasta?.slice(0, 10) === anterior);
}

/** Los meses ya cerrados en los que cae ese día o algo después («2026-10»): lo que se pagó ahí no cambia. */
export function mesesCerradosDesde(liquidaciones: Pick<Liquidacion, "periodo" | "estado">[], dia: string): string[] {
  const mes = dia.slice(0, 7);
  return liquidaciones.filter((l) => l.estado === "cerrada" && l.periodo >= mes).map((l) => l.periodo).sort();
}

export interface CambioDeRegla {
  miembro: MiembroEquipo;
  /** El nombre de la versión más nueva. */
  nombre: string;
  /** Todas las versiones, de la más vieja a la más nueva. */
  versiones: ConceptoPago[];
  /** El día del último cambio (el inicio de la versión más nueva). */
  ultimo: string;
}

/** Las reglas que cambiaron alguna vez (tienen más de una versión), el último cambio primero. */
export function cambiosDeReglas(e: { honorarios: EsquemaPago[]; equipo: MiembroEquipo[] }): CambioDeRegla[] {
  const out: CambioDeRegla[] = [];
  for (const esq of e.honorarios) {
    const m = e.equipo.find((x) => x.id === esq.miembroId);
    if (!m) continue;
    const raices = [...new Set(esq.conceptos.map(raizDe))];
    for (const r of raices) {
      const vs = esq.conceptos.filter((c) => raizDe(c) === r).sort((a, b) => (a.desde ?? "").localeCompare(b.desde ?? ""));
      if (vs.length < 2) continue;
      const ultima = vs[vs.length - 1];
      out.push({ miembro: m, nombre: ultima.nombre, versiones: vs, ultimo: (ultima.desde ?? "").slice(0, 10) });
    }
  }
  return out.sort((a, b) => b.ultimo.localeCompare(a.ultimo) || a.miembro.nombre.localeCompare(b.miembro.nombre, "es"));
}
