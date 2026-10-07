"use client";

import React from "react";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { descuentoDesde, queFalloEnElDia, type ReglaCierre, type StrikesDeCloser } from "@/lib/cierre-del-dia";
import { num } from "@/lib/format";
import { textoFecha } from "./FiltroColumna";

/* ==================================================================
   Los strikes del closer, en «Tu día» (Yari, 02/10: «que el closer vea
   cuántos tiene al abrir el EOD»). Se cuentan y se muestran aunque el
   interruptor del descuento esté apagado: así el equipo se acostumbra
   antes de que cueste plata (lib/cierre-del-dia.ts).
   ================================================================== */

const MAX_DIAS = 6;

export function CuentaDeStrikes({ strikes, regla }: { strikes: StrikesDeCloser; regla: ReglaCierre }) {
  const desde = descuentoDesde(regla);
  if (!strikes.cuentaDesde) {
    return (
      <section className="crm-eod__strikes" aria-label="Strikes">
        <p className="t-sm t-muted">Los strikes todavía no se cuentan: arrancan el día que el equipo defina la fecha de arranque del cierre del día.</p>
      </section>
    );
  }
  const hay = strikes.total > 0;
  const visibles = strikes.dias.slice(0, MAX_DIAS);
  return (
    <section className={`crm-eod__strikes${hay ? " crm-eod__strikes--hay" : ""}`} aria-label="Tus strikes">
      <div className="crm-eod__strikes-cabeza">
        <span className="crm-eod__strikes-numero t-num">{num(strikes.total)}</span>
        <span className="t-strong">
          {strikes.total === 1 ? "strike" : "strikes"}
          <InfoMetrica
            titulo="Strikes"
            ayuda="Los días en que alguna de tus llamadas no quedó cargada el mismo día: se cargó después o todavía no se cargó."
            formula={`Strikes = días desde el ${textoFecha(strikes.cuentaDesde)} en que alguna llamada de venta se cargó otro día que el suyo, o sigue sin cargar con su día ya pasado`}
            componentes={() => [
              ...strikes.dias.map((d) => ({
                concepto: textoFecha(d.dia), valor: `${num(d.tarde + d.sinCargar)} de ${num(d.llamadas)}`, nota: queFalloEnElDia(d), signo: "+" as const,
              })),
              { concepto: "Strikes", valor: num(strikes.total), signo: "=" as const },
            ]}
            periodo={`desde el ${textoFecha(strikes.cuentaDesde)}`}
          />
        </span>
      </div>
      <p className="t-sm t-muted">
        {hay
          ? "Un strike es un día en que alguna llamada no quedó cargada el mismo día."
          : `Cerraste cada día el mismo día, desde el ${textoFecha(strikes.cuentaDesde)}. Así se sigue.`}
      </p>
      {hay && (
        <ul className="crm-eod__strikes-lista">
          {visibles.map((d) => (
            <li key={d.dia}><span className="t-num t-strong">{textoFecha(d.dia)}</span> · {queFalloEnElDia(d)}</li>
          ))}
          {strikes.dias.length > visibles.length && <li className="t-subtle">y {num(strikes.dias.length - visibles.length)} más</li>}
        </ul>
      )}
      <p className={`crm-eod__strikes-regla${desde ? " crm-eod__strikes-regla--descuenta" : ""}`}>
        {desde
          ? `Está prendido el descuento: la comisión de las ventas de un día con strike no se paga (rige para las llamadas desde el ${textoFecha(desde)}).`
          : "Por ahora es sólo un aviso: no se descuenta nada."}
      </p>
    </section>
  );
}
