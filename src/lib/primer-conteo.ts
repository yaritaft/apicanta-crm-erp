import type { ID, Moneda, SaldoCuenta } from "./types";
import type { SaldoEsperado } from "./traspasos";

/* ==================================================================
   El primer conteo de una cuenta (Aldana, 21/10).

   El arqueo del 7/10 se hizo con dLocal, la Financiera USD y la Financiera ARS «en
   revisión»: quedaron en cero. Del 20/10 se contaron con sus saldos reales (US$ 40.074
   la Financiera USD, $ 11,8 millones la ARS y US$ 39.710 dLocal) y la Caja marcó
   84.855 «a explicar»: de eso, 75.276 eran lo que esas tres cuentas YA tenían el 7/10,
   que ningún arqueo había contado.

   Una cuenta que no estaba en el arqueo anterior no tiene de dónde partir: no se
   puede decir cuánto «tendría que haber». Lo que sí se sabe es cuánto se movió desde
   entonces (lo que cobró, los pases, lo que salió). Con eso, lo contado menos lo
   movido es lo que ya tenía al arqueo anterior: es su saldo de partida. Se incorpora
   al esperado del total (la caja toma esos saldos y no marca una diferencia que no es
   una diferencia) y queda dicho en cada cuenta, no escondido: «Primer conteo de la cuenta».

   Sin React ni red.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PrimerConteo {
  procesadorId: ID;
  moneda: Moneda;
  /* Lo que la cuenta ya tenía al arqueo anterior, en su moneda y en la base. */
  partida: number;
  partidaBase: number;
  /* La constancia que queda en el saldo de esa cuenta. */
  nota: string;
}

export interface ResultadoPrimerConteo {
  cuentas: PrimerConteo[];
  /* Lo que suman en la moneda base: va al esperado del total. */
  totalBase: number;
}

/** Las cuentas que se cuentan por primera vez en este arqueo (no estaban en el anterior) y su saldo de partida.
 *  `esperadas` es `saldosEsperados(...)`: de ahí salen lo que cobró, los pases y lo que salió de cada cuenta desde el arqueo anterior. */
export function primerConteo(
  saldos: readonly Pick<SaldoCuenta, "procesadorId" | "monto" | "moneda" | "montoBase">[],
  esperadas: ReadonlyMap<ID, Pick<SaldoEsperado, "anterior" | "entro" | "pases" | "salio">>,
  hayArqueoAnterior: boolean,
  dinero: (monto: number, moneda: Moneda) => string,
): ResultadoPrimerConteo {
  if (!hayArqueoAnterior) return { cuentas: [], totalBase: 0 };
  const cuentas: PrimerConteo[] = [];
  for (const s of saldos) {
    const x = esperadas.get(s.procesadorId);
    if (!x || x.anterior !== undefined) continue;
    const movido = x.entro + x.pases - x.salio;
    const partida = r2(s.monto - movido);
    /* Sin tipo de cambio propio de la cuenta: el de su saldo (lo contado en base sobre lo contado). */
    const partidaBase = s.monto === 0 ? 0 : r2(partida * (s.montoBase / s.monto));
    cuentas.push({
      procesadorId: s.procesadorId, moneda: s.moneda, partida, partidaBase,
      nota: `Primer conteo de esta cuenta: no estaba en el arqueo anterior. Lo contado (${dinero(s.monto, s.moneda)}) menos lo que se movió desde entonces (${dinero(r2(movido), s.moneda)}) da lo que ya tenía: ${dinero(partida, s.moneda)}, que se suma a lo esperado.`,
    });
  }
  return { cuentas, totalBase: r2(cuentas.reduce((a, c) => a + c.partidaBase, 0)) };
}
