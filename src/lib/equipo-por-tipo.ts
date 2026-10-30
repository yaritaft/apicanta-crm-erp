import type { EstadoApp, LineaLiquidada, PersonaLiquidada } from "./types";

/* ==================================================================
   El equipo por tipo de pago (Aldana, 28/10): «dejaría los fijos y los de
   comisión por separado... que traiga los saldos de la parte donde calcula
   las comisiones, lo mismo con los bonos». Es la misma liquidación, mirada
   así:

     Fijos y bonos · comisiones de closers (y setters) · comisiones de
     directores · comisión del socio · externos (por pieza o por sesión)

   Cada línea de la liquidación va a un solo grupo: el sueldo base y los
   bonos, a «fijos»; la comisión, al grupo de su rol; lo que se paga por
   pieza (filmmaker, editores), a «externos». Una persona puede estar en dos
   grupos (Agustín: su base en fijos y su comisión en directores; Daniel: su
   base y su comisión de setter). Las cifras son las de la liquidación: lo
   que se cambia en una persona se cambia acá solo.
   ================================================================== */

export type GrupoDeEquipo = "fijos" | "closers" | "directores" | "socio" | "externos";

export const GRUPOS_DE_EQUIPO: { id: GrupoDeEquipo; titulo: string; ayuda: string }[] = [
  { id: "fijos", titulo: "Fijos y bonos", ayuda: "El sueldo base y los bonos de cada uno." },
  { id: "closers", titulo: "Comisiones de closers y setters", ayuda: "Sobre el cash post pasarelas de lo que cierra o agenda cada uno; con sus devoluciones y descuentos." },
  { id: "directores", titulo: "Comisiones de directores", ayuda: "La del director comercial (cash post pasarelas) y la del director de marketing (su profit)." },
  { id: "socio", titulo: "Comisión del socio", ayuda: "Sale de su profit, después de la comisión del director de marketing: no entra en los costos con que se calcula." },
  { id: "externos", titulo: "Externos", ayuda: "Se pagan por pieza o por sesión: filmmaker y editores." },
];

/* Las categorías de gasto de quienes cobran por pieza. */
const CATEGORIAS_EXTERNAS = new Set(["Filmmaker", "Edición de contenido"]);

export interface PiezaDePago { nombre: string; monto: number }
export interface FilaDeEquipo {
  miembroId: string;
  nombre: string;
  puesto?: string;
  /* Cómo se compone, línea por línea (sin las que dan cero). */
  partes: PiezaDePago[];
  total: number;
  /* Falta definir o cargar algo de lo suyo. */
  pendiente?: string;
}
export interface GrupoCalculado { id: GrupoDeEquipo; titulo: string; ayuda: string; filas: FilaDeEquipo[]; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A qué grupo va una línea de una persona. */
export function grupoDeLinea(rol: string | undefined, categoria: string, l: Pick<LineaLiquidada, "tipo">): GrupoDeEquipo {
  if (rol === "otro" && CATEGORIAS_EXTERNAS.has(categoria)) return "externos";
  if (l.tipo === "fijo" || l.tipo === "bono") return "fijos";
  switch (rol) {
    case "closer": case "setter": return "closers";
    case "director": case "growth": return "directores";
    case "socio": return "socio";
    default: return "fijos";
  }
}

export interface EquipoPorTipo {
  grupos: GrupoCalculado[];
  /* Todo lo que se paga, en la moneda base. */
  total: number;
  /* Lo que de eso entra en los costos con que se calculan las comisiones sobre el profit: todo menos esas mismas comisiones. */
  enLosCostos: number;
  /* Cuántos del equipo no tienen nada para pagar este mes. */
  sinNada: number;
}

export function equipoPorTipo(personas: PersonaLiquidada[], equipo: EstadoApp["equipo"]): EquipoPorTipo {
  const porGrupo = new Map<GrupoDeEquipo, Map<string, FilaDeEquipo>>(GRUPOS_DE_EQUIPO.map((g) => [g.id, new Map()]));
  let enLosCostos = 0;
  let sinNada = 0;
  for (const p of personas) {
    const rol = equipo.find((m) => m.id === p.miembroId)?.rol;
    const lineas = p.lineas.filter((l) => Math.abs(l.montoBase) >= 0.005);
    if (lineas.length === 0) { sinNada++; continue; }
    for (const l of lineas) {
      const filas = porGrupo.get(grupoDeLinea(rol, p.categoriaGasto, l))!;
      const fila = filas.get(p.miembroId) ?? { miembroId: p.miembroId, nombre: p.nombre, puesto: p.puesto, partes: [], total: 0, ...(p.pendiente ? { pendiente: p.pendiente } : {}) };
      fila.partes.push({ nombre: l.nombre, monto: l.montoBase });
      fila.total = r2(fila.total + l.montoBase);
      filas.set(p.miembroId, fila);
      /* El resto del mes anterior ya estaba en los costos de ese mes: no vuelve a contar (lib/honorarios.ts, «resto:»). */
      if (l.base !== "profit" && !l.clave.startsWith("resto:")) enLosCostos += l.montoBase;
    }
  }
  const grupos = GRUPOS_DE_EQUIPO.map((g) => {
    const filas = [...porGrupo.get(g.id)!.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
    return { ...g, filas, total: r2(filas.reduce((a, f) => a + f.total, 0)) };
  }).filter((g) => g.filas.length > 0);
  return { grupos, total: r2(grupos.reduce((a, g) => a + g.total, 0)), enLosCostos: r2(enLosCostos), sinNada };
}
