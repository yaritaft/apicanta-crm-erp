import { esDueno, nivelEn, type MiAcceso } from "./permisos";
import type { Pago } from "./types";

/* ==================================================================
   El candado de un cobro ya cargado.

   Daily con los closers (16/10): un cobro mal cargado se tiene que poder
   corregir, «salvo que ya se haya pagado la comisión; si Finanzas todavía
   no lo cerró, que se pueda editar». Se corrige en el mismo asistente de
   «Registrar pago», con los datos precargados.

   Lo corrige quien lo cargó y cualquiera que edite las ventas, hasta que:
   - Finanzas lo chequeó (el casillero de Finanzas dice «chequeado»): ya
     validó el monto, el medio y la fecha; o
   - la liquidación de ese mes se cerró: la comisión ya no se recalcula sola.
   Un cobro RECHAZADO sí se puede corregir (es justo para lo que sirve).

   Finanzas y los dueños corrigen siempre; la app sólo les avisa. Lo mismo
   decide la base (supabase/cobros-de-closers.sql): esto es la afordancia,
   no la defensa. El mes cerrado sólo lo sabe el cliente de quien ve las
   liquidaciones; para el resto lo contesta la base (mes_de_cobro_cerrado).
   ================================================================== */

export interface CandadoDeCobro {
  /* No se puede corregir ni borrar con esta cuenta. */
  bloqueado: boolean;
  /* Por qué, en una frase. También cuando no bloquea pero conviene avisar. */
  motivo?: string;
}

/** Quien corrige siempre: un dueño o quien edita Finanzas. */
export const corrigeSiempre = (a: MiAcceso | null | undefined) => esDueno(a) || nivelEn(a, "finanzas") === 2;

export function candadoDeCobro(
  pago: Pick<Pago, "chequeoFinanzas">, a: MiAcceso | null | undefined, mesCerrado = false,
): CandadoDeCobro {
  const motivo = pago.chequeoFinanzas === "chequeado"
    ? "Finanzas ya lo chequeó."
    : mesCerrado ? "La liquidación de ese mes ya se cerró: la comisión ya no se recalcula." : undefined;
  if (!motivo) return { bloqueado: false };
  return corrigeSiempre(a) ? { bloqueado: false, motivo } : { bloqueado: true, motivo };
}
