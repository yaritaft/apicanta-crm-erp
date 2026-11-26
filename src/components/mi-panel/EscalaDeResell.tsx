"use client";

import React, { useMemo } from "react";
import { escalaDelMesDe, porcentajeDeCierre, textoDeEscala } from "@/lib/escala-cierre";
import { mesDeNegocio } from "@/lib/dia-negocio";
import { nombrePeriodo, rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, MiembroEquipo } from "@/lib/types";
import { Tile } from "./Tile";

/* ==================================================================
   «Tu comisión de resell» (Yari, 25/11): el % de resell sube según el %
   de cierre del mes. El closer ve acá cómo viene este mes —cuántas
   llamadas de resell tomó, cuántas cerró, qué % le toca hoy y cuánto le
   falta para el escalón que sigue— con la MISMA cuenta que usan la
   liquidación y Finanzas (lib/escala-cierre.ts). Sólo aparece para quien
   tiene una comisión con escala.
   ================================================================== */

export function EscalaDeResell({ e, miembro, ahora }: { e: EstadoApp; miembro: MiembroEquipo; ahora: number }) {
  const x = useMemo(() => escalaDelMesDe(e, miembro, mesDeNegocio(ahora), rangoDePeriodo, ahora), [e, miembro, ahora]);
  if (!x) return null;
  const { cierre, proximo } = x;
  const falta = cierre.llamadas === 0
    ? "sube con lo que cierres"
    : proximo
      ? `con ${proximo.faltan} ${proximo.faltan === 1 ? "cierre" : "cierres"} más pasás a ${porcentajeDeCierre(proximo.escalon.tasa)}`
      : "es el escalón más alto";
  return (
    <section aria-labelledby="mp-escala">
      <div className="mp-seccion">
        <h2 id="mp-escala">Tu comisión de resell</h2>
        <span>{nombrePeriodo(x.mes)}</span>
      </div>
      <div className="mp-tiles">
        <Tile rot="Llamadas de resell" valor={String(cierre.llamadas)} sub="hechas este mes" />
        <Tile rot="Cierres" valor={String(cierre.cierres)} sub="personas que compraron" />
        <Tile rot="% de cierre" valor={cierre.pct === null ? "Sin dato" : porcentajeDeCierre(cierre.pct)} sub={cierre.pct === null ? "sin llamadas este mes" : "cierres ÷ llamadas"} />
        <Tile rot="Cobrás de resell" valor={porcentajeDeCierre(x.tasa)} sub={falta} verde />
      </div>
      <p className="mp-nota-escala">La escala: {textoDeEscala(x.escala, x.base)}. Vale para todo lo que cobres de resell en el mes.</p>
    </section>
  );
}
