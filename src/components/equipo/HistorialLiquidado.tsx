"use client";

import React, { useState } from "react";
import { AlertTriangle, Calculator, ChevronRight, Trash2 } from "lucide-react";
import { Badge, IconButton } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { extrasPorVenir, nombrePeriodo, plata } from "@/lib/honorarios";
import { DesgloseRenglon } from "./DesgloseRenglon";

/* ==================================================================
   «Lo que se le liquidó», mes por mes, en la ficha de cada persona
   (Angelo, 06/10: «un botón de ver cómo se calculó mes a mes, que quede el
   histórico»). Cada mes cerrado se abre y muestra sus renglones, cada uno
   con su «Ver cómo se calculó»: lo que quedó guardado al cerrar.

   Arriba, lo que ya se anotó para las próximas liquidaciones (un descuento
   con su nota para quien paga, por ejemplo): se ve acá y se puede sacar.
   ================================================================== */

/* Cuántos meses se ven de entrada; el resto, con «Ver los anteriores». */
const MESES_A_LA_VISTA = 12;

export function HistorialLiquidado({ miembroId }: { miembroId: string }) {
  const e = useEstado();
  const toast = useToast();
  const base = e.ajustes.monedaBase;

  const historial = e.liquidaciones
    .filter((l) => l.estado === "cerrada" && l.resultado)
    .map((l) => ({ l, p: l.resultado!.personas.find((x) => x.miembroId === miembroId) }))
    .filter((x): x is { l: typeof x.l; p: NonNullable<typeof x.p> } => Boolean(x.p))
    .sort((a, b) => b.l.periodo.localeCompare(a.l.periodo));
  /* Lo anotado en liquidaciones que todavía no se cerraron. */
  const anotado = extrasPorVenir(e.liquidaciones, "").filter((x) => x.extra.miembroId === miembroId);

  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set(historial[0] ? [historial[0].l.id] : []));
  const [verTodos, setVerTodos] = useState(false);
  const [ver, setVer] = useState<{ clave: string; periodo: string } | null>(null);

  if (historial.length === 0 && anotado.length === 0) return null;

  const alternar = (id: string) => setAbiertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const mostrados = verTodos ? historial : historial.slice(0, MESES_A_LA_VISTA);

  return (
    <section className="stack-3">
      <h3 className="t-label">Lo que se le liquidó</h3>

      {anotado.length > 0 && (
        <div className="liq__porvenir hist-liq__aparte">
          <span className="liq__porvenir-titulo">Anotado para las próximas liquidaciones</span>
          <ul className="liq__porvenir-lista">
            {anotado.map(({ liquidacionId, periodo, extra: x }) => (
              <li key={x.id}>
                <span>
                  <b>{nombrePeriodo(periodo)}</b> · {x.concepto}: {plata(x.monto, x.moneda)}
                  {x.nota ? <span className="liq__sub"> Nota: {x.nota}</span> : null}
                </span>
                <IconButton
                  etiqueta={`Sacar lo anotado para ${nombrePeriodo(periodo)}`}
                  onClick={() => { if (!acciones.quitarExtraLiquidacion(liquidacionId, x.id)) toast("No se pudo sacar: esa liquidación ya se cerró.", "err"); }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      {historial.length > 0 && (
        <ul className="hist-liq">
          {mostrados.map(({ l, p }) => {
            const abierto = abiertos.has(l.id);
            const pagado = Boolean(l.pagos[miembroId]);
            return (
              <li key={l.id} className="hist-liq__mes">
                <button type="button" className="hist-liq__cabecera" aria-expanded={abierto} onClick={() => alternar(l.id)}>
                  <ChevronRight size={16} className="hist-liq__chevron" aria-hidden />
                  <span className="hist-liq__nombre">{nombrePeriodo(l.periodo)}</span>
                  <span className="hist-liq__total">{plata(p.total, base)}</span>
                  <Badge variante={pagado ? "success" : "neutral"}>{pagado ? "Pagado" : "Por pagar"}</Badge>
                </button>
                {abierto && (
                  <ul className="hist-liq__lineas">
                    {p.lineas.map((x) => (
                      <li key={x.clave} className="hist-liq__linea">
                        <span className="hist-liq__textos">
                          <span className="hist-liq__titulo">{x.nombre}</span>
                          <span className="hist-liq__detalle">{x.detalle}</span>
                          {x.nota && (
                            <span className="liq__notapago" role="note">
                              <AlertTriangle size={14} aria-hidden />
                              <span><b>Nota para quien paga:</b> {x.nota}</span>
                            </span>
                          )}
                          {x.tipo !== "extra" && (
                            <button type="button" className="link t-sm liq__ver" onClick={() => setVer({ clave: x.clave, periodo: l.periodo })}>
                              <Calculator size={14} aria-hidden /> Ver cómo se calculó
                            </button>
                          )}
                        </span>
                        <span className="hist-liq__monto">{plata(x.monto, x.moneda)}</span>
                      </li>
                    ))}
                    {p.lineas.length === 0 && <li className="hist-liq__detalle">Ese mes no se le liquidó nada.</li>}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {historial.length > MESES_A_LA_VISTA && !verTodos && (
        <button type="button" className="link t-sm" onClick={() => setVerTodos(true)}>
          Ver los {historial.length - MESES_A_LA_VISTA} meses anteriores
        </button>
      )}

      {ver && <DesgloseRenglon miembroId={miembroId} clave={ver.clave} periodo={ver.periodo} onCerrar={() => setVer(null)} />}
    </section>
  );
}
