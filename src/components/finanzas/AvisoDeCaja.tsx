"use client";

import React from "react";
import { Vault } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { fechaLarga, money } from "@/lib/format";
import { hayQueAvisarDeCaja, type EfectoEnCaja } from "@/lib/efecto-en-caja";
import type { Moneda } from "@/lib/types";

/* ==================================================================
   «¿Esto cómo impacta en el cierre de caja?» (Aldana, 25/11), contestado
   en el formulario antes de guardar: al cargar o corregir un gasto con una
   fecha de pago vieja dice qué cierre cambia y de cuánto a cuánto pasa su
   diferencia, o que no cambia ninguno (lib/efecto-en-caja.ts).

   Y lo que faltaba (Aldana, 26/11: retiros de junio a septiembre que nunca
   se cargaron; el saldo de la app quedó más alto que el real): con la fecha
   vieja, la caja de hoy no se entera, porque parte de lo que se contó en el
   último cierre. «Que salga de la caja hoy» deja cada gasto en SU mes en el
   estado de resultados y hace que la caja lo tome hoy: baja el saldo de hoy,
   entra en el próximo cierre y no toca ninguno cerrado.

   Un pago posterior al último cierre es lo de todos los días: no dice nada.
   ================================================================== */

const dia = (iso: string) => fechaLarga(iso).replace(/ \d{4}$/, "");
const conSigno = (n: number, base: Moneda) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${money(Math.abs(n), base, Math.abs(n) % 1 > 0.004 ? 2 : 0)}`;
const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;

export interface Regularizar {
  /* Ya se eligió: lo viejo sale de la caja hoy. */
  activo: boolean;
  /* Cuántos son (los de fecha anterior al último cierre). */
  cuantos: number;
  alCambiar: (activo: boolean) => void;
}

export function AvisoDeCaja({ efecto: x, base, cuantos = 1, regularizar }: {
  efecto: EfectoEnCaja; base: Moneda;
  /* Cuántos movimientos se están cargando juntos. */
  cuantos?: number;
  /* Si se ofrece dejarlo en su mes y que la caja lo tome hoy. */
  regularizar?: Regularizar;
}) {
  const uno = cuantos <= 1;

  /* Ya elegido: se dice qué va a pasar, con la forma de volver atrás. */
  if (regularizar?.activo) {
    const k = regularizar.cuantos;
    return (
      <div className="mes-cerrado aviso-caja" role="note">
        <Vault size={16} aria-hidden />
        <div className="mes-cerrado__texto">
          <div className="mes-cerrado__titulo">{k <= 1 ? "Queda en su mes y sale de la caja hoy" : `${k} quedan en su mes y salen de la caja hoy`}</div>
          <div>
            En el estado de resultados {k <= 1 ? "resta" : "restan"} en el mes de su fecha. En la caja {k <= 1 ? "baja" : "bajan"} el saldo de hoy y {k <= 1 ? "entra" : "entran"} en el
            próximo cierre: no se toca ningún cierre ya hecho.
          </div>
          <button type="button" className="link" onClick={() => regularizar.alCambiar(false)}>Deshacer: que salga{k <= 1 ? "" : "n"} con su fecha</button>
        </div>
      </div>
    );
  }

  if (!hayQueAvisarDeCaja(x)) return null;
  const cambia = x.cierres.length > 0;
  const viejos = x.entreCierres + x.antesDelPrimero;
  const titulo = cambia
    ? x.cierres.length === 1 ? `Con esa fecha cambia el cierre de caja del ${dia(x.cierres[0].arqueo.fecha)}` : `Con esas fechas cambian ${x.cierres.length} cierres de caja ya hechos`
    : `Con ${uno ? "esa fecha" : "esas fechas"} no cambia ningún cierre de caja ni el saldo de hoy`;
  return (
    <div className="mes-cerrado aviso-caja" role="note" data-cambia={cambia || undefined}>
      <Vault size={16} aria-hidden />
      <div className="mes-cerrado__texto">
        <div className="mes-cerrado__titulo">{titulo}</div>
        {x.cierres.map((c) => (
          <div key={c.arqueo.id}>
            {uno ? "Ese día cae dentro de ese cierre" : `Cierre del ${dia(c.arqueo.fecha)}`}: su diferencia pasa de{" "}
            <b className="t-num">{conSigno(c.antes, base)}</b> a <b className="t-num">{conSigno(c.despues, base)}</b>
            {Math.abs(c.despues) < Math.abs(c.antes) ? " (queda mejor explicado)" : ""}. El saldo de hoy no se mueve.
          </div>
        ))}
        {x.entreCierres > 0 && !cambia && (
          <div>{uno ? "Ese día cae" : `${n(x.entreCierres, "cae", "caen")}`} dentro de un cierre ya hecho, pero su diferencia no se mueve.</div>
        )}
        {x.antesDelPrimero > 0 && x.primero && (
          <div>
            {uno ? "Es" : `${n(x.antesDelPrimero, "es", "son")}`} de antes del primer cierre de caja ({dia(x.primero.fecha)}). La caja parte de lo que se contó en cada cierre:
            {uno ? " sólo mueve" : " sólo mueven"} el estado de resultados de su mes.
          </div>
        )}
        {!uno && x.hoy > 0 && x.ultimo && (
          <div>{n(x.hoy, "es posterior", "son posteriores")} al último cierre ({dia(x.ultimo.fecha)}): {x.hoy === 1 ? "baja" : "bajan"} el saldo de hoy, como siempre.</div>
        )}
        {regularizar && viejos > 0 && (
          <div className="aviso-caja__opcion">
            <div>
              <b>¿Es plata que ya salió y nunca se cargó</b>, y por eso el saldo de la app quedó más alto que el real? Entonces que la caja {uno ? "lo" : "los"} tome hoy:
              {uno ? " queda" : " quedan"} en su mes en el estado de resultados, {uno ? "baja" : "bajan"} el saldo de hoy y no se toca ningún cierre ya hecho.
            </div>
            <Button sm variante="secondary" onClick={() => regularizar.alCambiar(true)}>{uno ? "Que salga de la caja hoy" : `Que ${n(viejos, "salga", "salgan")} de la caja hoy`}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
