import type { ConceptoPago, EstadoApp, MiembroEquipo } from "./types";
import { describirConcepto } from "./honorarios";
import { fechaLarga } from "./format";
import { rangoDePeriodo } from "./periodos";

/* ==================================================================
   Las reglas de comisión acordadas (26/10/2026). Los criterios de cada
   uno vivían en cuatro lugares que no coincidían (la reunión con Yari, la
   planilla de Angelo, Notion y los WhatsApp) y la app calculaba lo que
   tenía cargado: cada duda terminaba en una pregunta por WhatsApp. Ahora cada
   regla de comisión dice lo que se acordó (sus notas), quién lo confirmó
   y cuándo, y la liquidación avisa de las que siguen sin confirmar antes
   de cerrar el mes.
   Sólo cuentan las comisiones (porcentaje y tramo): un sueldo no se discute.
   ================================================================== */

export interface ReglaAcordada {
  miembro: MiembroEquipo;
  concepto: ConceptoPago;
  /** La regla dicha en castellano, como en «Cómo se calculó». */
  regla: string;
  /** Lo acordado, con las palabras de quien lo confirmó (las notas de la regla). */
  criterio?: string;
  /** Quién la confirmó y cuándo; null si falta confirmarla. */
  confirmada: { por: string; el: string } | null;
  /** Lo que el esquema dice que todavía no se sabe («consultar con Yari»). */
  pendiente?: string;
}

const esComision = (c: ConceptoPago) => c.tipo === "porcentaje" || c.tipo === "tramo";

/** Las comisiones de cada persona con su criterio y su confirmación. Con `periodo` («2026-10»), sólo las que valen ese mes y de quienes
 *  cobran ese mes; sin él, todas las de quienes están. Por persona y por orden del esquema. */
export function reglasAcordadas(e: EstadoApp, periodo?: string): ReglaAcordada[] {
  const rango = periodo ? rangoDePeriodo(periodo) : null;
  const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out: ReglaAcordada[] = [];
  for (const esq of e.honorarios) {
    const m = e.equipo.find((x) => x.id === esq.miembroId);
    if (!m) continue;
    const comisiones = esq.conceptos.filter(esComision);
    if (comisiones.length === 0) continue;
    /* Quien ya no está sólo cuenta si todavía cobra en ese mes. */
    if (rango && m.activo === false && !(m.hasta && m.hasta.slice(0, 10) >= dia(rango.desde))) continue;
    if (!rango && m.activo === false) continue;
    for (const c of comisiones) {
      /* Con un mes, sólo las que valen en algún día de ese mes. */
      if (rango && ((c.desde && c.desde.slice(0, 10) > dia(rango.hasta)) || (c.hasta && c.hasta.slice(0, 10) < dia(rango.desde)))) continue;
      out.push({
        miembro: m, concepto: c, regla: describirConcepto(c, e, esq.conceptos),
        criterio: c.notas?.trim() || undefined,
        confirmada: c.confirmadaPor?.trim() ? { por: c.confirmadaPor.trim(), el: c.confirmadaEl ?? "" } : null,
        pendiente: esq.pendiente?.trim() || undefined,
      });
    }
  }
  return out.sort((a, b) => a.miembro.nombre.localeCompare(b.miembro.nombre, "es"));
}

/** Las que siguen sin confirmar (o con algo «a definir» en el esquema). */
export const reglasSinConfirmar = (e: EstadoApp, periodo?: string): ReglaAcordada[] =>
  reglasAcordadas(e, periodo).filter((r) => !r.confirmada);

/** «26/10». */
export const diaDeConfirmacion = (iso?: string): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** «Confirmada por Yari el 26/10» o «Sin confirmar». */
export const selloDeRegla = (c: ReglaAcordada["confirmada"]): string =>
  c ? `Confirmada por ${c.por}${c.el ? ` el ${diaDeConfirmacion(c.el)}` : ""}` : "Sin confirmar";

/** La hoja de reglas en texto, para mandársela a Yari y que confirme (o corrija) cada una. */
export function textoDeReglas(e: EstadoApp, periodo?: string): string {
  const reglas = reglasAcordadas(e, periodo);
  const sin = reglas.filter((r) => !r.confirmada).length;
  const lineas: string[] = [
    `Reglas de comisión de Apicanta${periodo ? ` · ${periodo}` : ""}`,
    sin === 0 ? "Todas están confirmadas." : `${sin} de ${reglas.length} sin confirmar: confirmame cuáles están bien y corregime las que no.`,
    "",
  ];
  let actual = "";
  for (const r of reglas) {
    if (r.miembro.id !== actual) {
      actual = r.miembro.id;
      lineas.push(`${r.miembro.nombre}${r.miembro.puesto ? ` (${r.miembro.puesto})` : ""}`);
    }
    lineas.push(`• ${r.concepto.nombre}: ${r.regla}`);
    if (r.criterio) lineas.push(`  Lo acordado: ${r.criterio.replace(/\s*\n\s*/g, " ")}`);
    if (r.pendiente) lineas.push(`  A definir: ${r.pendiente}`);
    lineas.push(`  ${r.confirmada ? "✔" : "✘"} ${selloDeRegla(r.confirmada)}`);
    lineas.push("");
  }
  return lineas.join("\n").trimEnd();
}

/** Para mostrar en pantalla: «26 de octubre de 2026». */
export const fechaDeConfirmacion = (iso?: string): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? fechaLarga(`${iso.slice(0, 10)}T12:00:00`) : "");

/** Al guardar un esquema: una regla confirmada que cambió (su %, sobre qué se mide, sus filtros, sus fechas) deja de estar confirmada, salvo que
 *  en el mismo guardado se haya tocado a propósito la confirmación. Cambiar sólo el nombre o lo acordado (las notas) no la borra. */
export function sinConfirmarSiCambio(previos: ConceptoPago[] | undefined, nuevos: ConceptoPago[]): ConceptoPago[] {
  const sinDatosDeConfirmacion = (c: ConceptoPago) => {
    const { confirmadaPor: _p, confirmadaEl: _e, notas: _n, nombre: _nombre, ...regla } = c;
    return JSON.stringify(regla, Object.keys(regla).sort());
  };
  return nuevos.map((c) => {
    const antes = previos?.find((x) => x.id === c.id);
    if (!antes?.confirmadaPor) return c;
    const igualConfirmacion = c.confirmadaPor === antes.confirmadaPor && c.confirmadaEl === antes.confirmadaEl;
    if (!igualConfirmacion || sinDatosDeConfirmacion(antes) === sinDatosDeConfirmacion(c)) return c;
    const { confirmadaPor: _p, confirmadaEl: _e, ...resto } = c;
    return resto;
  });
}
