import type { EstadoApp, ID, LineaLiquidada, PersonaLiquidada } from "./types";
import { calcularLiquidacion, liquidacionVacia } from "./honorarios";
import { nombrePeriodo } from "./periodos";

/* ==================================================================
   Mi panel de quien no vende (Nahuel, 17/11: «la vista de mi panel es
   similar a la de un closer… no soy closer y no agendo llamadas, entonces
   no se contabiliza cuánto debería percibir»).

   A un socio, un mentor o cualquiera cuyo arreglo no sale de sus llamadas
   se le muestra lo que le corresponde en el mes según lo que tiene cargado
   en Equipo (su porcentaje del profit, su fijo), con la MISMA cuenta que
   la liquidación de Aldana: acá no se inventa otra fórmula. Mes cerrado,
   la foto del cierre; mes abierto, lo que va hasta hoy.

   Lo que cobra cada uno sólo lo leen los dueños (la base no se lo manda a
   nadie más): sin esos datos no hay nada que mostrar y se dice.
   ================================================================== */

export interface LoQueCorresponde {
  periodo: string;
  mes: string;
  /* El mes ya se cerró: es lo que se liquidó, no cambia. */
  cerrada: boolean;
  /* No hay nada cargado en lo que cobra (o esta cuenta no lo puede leer). */
  sinArreglo: boolean;
  persona: PersonaLiquidada | null;
  lineas: LineaLiquidada[];
  /* Todo junto en la moneda base. */
  total: number;
  /* Lo que falta definir de su arreglo, si hay. */
  pendiente?: string;
}

export function loQueLeCorresponde(e: EstadoApp, miembroId: ID, periodo: string): LoQueCorresponde {
  const guardada = e.liquidaciones.find((x) => x.periodo === periodo);
  const cerrada = guardada?.estado === "cerrada" && Boolean(guardada.resultado);
  const r = cerrada ? guardada!.resultado! : calcularLiquidacion(e, periodo, guardada ?? liquidacionVacia(periodo));
  const persona = r.personas.find((p) => p.miembroId === miembroId) ?? null;
  const tieneEsquema = e.honorarios.some((h) => h.miembroId === miembroId && h.conceptos.length > 0);
  const lineas = persona?.lineas ?? [];
  return {
    periodo, mes: nombrePeriodo(periodo), cerrada,
    sinArreglo: !persona || (lineas.length === 0 && !tieneEsquema),
    persona, lineas, total: persona?.total ?? 0, pendiente: persona?.pendiente,
  };
}
