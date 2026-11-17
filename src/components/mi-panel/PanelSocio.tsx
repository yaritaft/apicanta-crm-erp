"use client";

import React, { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { DesgloseRenglon } from "@/components/equipo/DesgloseRenglon";
import { useEstado } from "@/lib/store";
import { money } from "@/lib/format";
import { loQueLeCorresponde } from "@/lib/panel-socio";
import type { MiembroEquipo } from "@/lib/types";
import { Cifra } from "./Tile";
import { clic } from "./util";

/* ==================================================================
   Mi panel de quien no vende: un socio, un mentor (Nahuel, 17/11). No
   lleva llamadas ni cierre del día, así que no se le muestra el panel del
   closer: se le muestra lo que le corresponde en el mes y de dónde sale
   cada renglón, con la cuenta de la liquidación (lib/panel-socio.ts).
   Cada renglón abre «cómo se calculó», el mismo que ve Administración.
   ================================================================== */

export function PanelSocio({ miembro, periodo, viendoOtro }: { miembro: MiembroEquipo; periodo: string; viendoOtro: boolean }) {
  const e = useEstado();
  const d = useMemo(() => loQueLeCorresponde(e, miembro.id, periodo), [e, miembro.id, periodo]);
  const [ver, setVer] = useState<string | null>(null);
  const base = e.ajustes.monedaBase || "USD";
  const te = viendoOtro ? "le" : "te";

  if (d.sinArreglo) {
    return (
      <section className="mp-card" aria-label="Lo que corresponde este mes">
        <span className="mp-cap">Lo que {te} corresponde · {d.mes}</span>
        <span className="mp-nota" style={{ marginTop: 8 }}>
          {viendoOtro ? "Todavía no tiene cargado cómo cobra." : "Todavía no está cargado cómo cobrás."} Se carga en Equipo → Honorarios; cuando esté, acá aparece el monto del mes y de dónde sale.
        </span>
      </section>
    );
  }

  return (
    <>
      <div className="mp-arriba">
        <div className="mp-columna">
          <div className="mp-card mp-card--hero">
            <span className="mp-cap">Lo que {te} corresponde · {d.mes}</span>
            <span className="mp-cifra"><Cifra texto={money(d.total, base, 2)} /></span>
            <span className="mp-nota">{d.cerrada ? "Mes cerrado: es lo que se liquidó." : "En lo que va del mes. Se termina de definir cuando Administración cierra la liquidación."}</span>
            {/* La nota interna de lo que falta definir es de Administración (Equipo → Honorarios): acá sólo se avisa que hay algo por confirmar. */}
            {d.pendiente && <span className="mp-nota mp-nota--aviso">Hay algo de {viendoOtro ? "su" : "tu"} arreglo por confirmar: el monto puede cambiar.</span>}
          </div>
        </div>
        <section className="mp-card mp-card--sin-relleno" aria-label="De dónde sale">
          <div className="mp-cap-fila" style={{ padding: "18px 20px 6px" }}><span className="mp-cap">De dónde sale</span><span className="mp-cuenta">{d.lineas.length}</span></div>
          <div className="mp-lista">
            {d.lineas.map((l) => (
              <div key={l.clave} className="mp-lista__fila mp-lista__fila--clic mp-lista__fila--socio" {...clic(() => setVer(l.clave))} aria-label={`${l.nombre}: ver cómo se calculó`}>
                <div style={{ minWidth: 0 }}>
                  <div className="mp-lista__nombre">{l.nombre}</div>
                  <div className="t-sm t-subtle" style={{ whiteSpace: "normal" }}>{l.falta ? `Falta: ${l.falta}` : l.detalle}</div>
                </div>
                <span className="mp-lista__hora" style={{ textAlign: "right", color: l.monto < 0 ? "var(--danger)" : undefined }}>{money(l.monto, l.moneda, 2)}</span>
                <ChevronRight size={16} className="mp-ir" aria-hidden />
              </div>
            ))}
          </div>
        </section>
      </div>
      {ver && <DesgloseRenglon miembroId={miembro.id} clave={ver} periodo={d.periodo} onCerrar={() => setVer(null)} />}
    </>
  );
}
