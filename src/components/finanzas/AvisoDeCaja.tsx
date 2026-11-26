"use client";

import React from "react";
import { Vault } from "lucide-react";
import { fechaLarga, money } from "@/lib/format";
import { hayQueAvisarDeCaja, type EfectoEnCaja } from "@/lib/efecto-en-caja";
import type { Moneda } from "@/lib/types";

/* ==================================================================
   «¿Esto cómo impacta en el cierre de caja?» (Aldana, 25/11), contestado
   en el formulario antes de guardar: al cargar o corregir un gasto con una
   fecha de pago vieja dice qué cierre cambia y de cuánto a cuánto pasa su
   diferencia, o que no cambia ninguno (lib/efecto-en-caja.ts).

   Un pago posterior al último cierre es lo de todos los días: no dice nada.
   ================================================================== */

const dia = (iso: string) => fechaLarga(iso).replace(/ \d{4}$/, "");
const conSigno = (n: number, base: Moneda) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${money(Math.abs(n), base, Math.abs(n) % 1 > 0.004 ? 2 : 0)}`;
const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;

export function AvisoDeCaja({ efecto: x, base, cuantos = 1 }: { efecto: EfectoEnCaja; base: Moneda; /* Cuántos movimientos se están cargando juntos. */ cuantos?: number }) {
  if (!hayQueAvisarDeCaja(x)) return null;
  const uno = cuantos <= 1;
  const cambia = x.cierres.length > 0;
  const titulo = cambia
    ? x.cierres.length === 1 ? `Cambia el cierre de caja del ${dia(x.cierres[0].arqueo.fecha)}` : `Cambia ${x.cierres.length} cierres de caja ya hechos`
    : "No cambia ningún cierre de caja";
  return (
    <div className="mes-cerrado aviso-caja" role="note" data-cambia={cambia || undefined}>
      <Vault size={16} aria-hidden />
      <div className="mes-cerrado__texto">
        <div className="mes-cerrado__titulo">{titulo}</div>
        {x.cierres.map((c) => (
          <div key={c.arqueo.id}>
            {uno ? "Ese día cae dentro de ese cierre" : `Cierre del ${dia(c.arqueo.fecha)}`}: su diferencia pasa de{" "}
            <b className="t-num">{conSigno(c.antes, base)}</b> a <b className="t-num">{conSigno(c.despues, base)}</b>
            {Math.abs(c.despues) < Math.abs(c.antes) ? " (queda mejor explicado)" : ""}.
          </div>
        ))}
        {x.entreCierres > 0 && !cambia && (
          <div>{uno ? "Ese día cae" : `${n(x.entreCierres, "cae", "caen")}`} dentro de un cierre ya hecho, pero su diferencia no se mueve.</div>
        )}
        {x.antesDelPrimero > 0 && x.primero && (
          <div>
            {uno ? "Se pagó" : `${n(x.antesDelPrimero, "se pagó", "se pagaron")}`} antes del primer cierre de caja ({dia(x.primero.fecha)}): lo que se contó ese día ya venía sin esa plata.
            {uno ? " Sólo se mueve el estado de resultados de su mes." : " Sólo mueven el estado de resultados de su mes."}
          </div>
        )}
        {!uno && x.hoy > 0 && x.ultimo && (
          <div>{n(x.hoy, "es posterior", "son posteriores")} al último cierre ({dia(x.ultimo.fecha)}): {x.hoy === 1 ? "baja" : "bajan"} el saldo de hoy y {x.hoy === 1 ? "entra" : "entran"} en el próximo cierre, como siempre.</div>
        )}
        <div className="aviso-caja__regla">
          {x.hoy === 0 || uno ? "No toca el saldo de hoy: " : ""}cada cierre parte de lo que se contó en el anterior, así que sólo se mueve el cierre que cubre el día del pago.
        </div>
      </div>
    </div>
  );
}
