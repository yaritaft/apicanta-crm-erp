"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelDeRuta } from "@/lib/permisos";
import { useParamsURL } from "@/lib/useParamsURL";
import { useRangoURL } from "@/lib/useRango";
import { useChequeos } from "@/lib/chequeos-finanzas";
import { olvidarVistaDe } from "@/lib/recordarVistas";
import { moverPeriodo, nombrePeriodo, esPeriodo } from "@/lib/periodos";
import { mesDeNegocio } from "@/lib/dia-negocio";
import { avanceDeFinanzas, claveChequeo, pasosDeFinanzas } from "@/lib/finanzas-pasos";
import type { Cadencia, PasoCierre } from "@/lib/cierre-mes";
import { Camino } from "./Camino";
import "./cierre.css";

/* ==================================================================
   Finanzas, en pasos: la lista de pasos del mes, uno abajo del otro como la
   Bandeja de Blue OS, con las pantallas de siempre (conciliar, validar cobros,
   caja, gastos, liquidación) adentro de cada paso. También se puede mirar de
   tal día a tal día.

   El End of Day (el cierre del día de Aldana) y el P&L tienen su lugar propio
   en el menú, abajo de Finanzas (Juan Cruz, 16/10): los links de antes
   (?cad=eod, ?cad=resultados, ?periodo=…) llevan ahí.
   ================================================================== */

type Vista = "mes" | "rango";

export function FinanzasHub() {
  const e = useEstado();
  const { acceso, esDueno } = useAcceso();
  const { chequeos, marcar, desmarcar, error, limpiarError } = useChequeos();
  const toast = useToast();
  useEffect(() => { if (error) { toast(error); limpiarError(); } }, [error, limpiarError, toast]);
  const [v, cambiar] = useParamsURL({ cad: "", mes: "", paso: "", mostrar: "", periodo: "", desde: "", hasta: "" });
  /* «De tal día a tal día»: el mismo selector de fechas que usa el resto de la app (y que se guarda en el link). */
  const [rangoSel, setRango] = useRangoURL("u30");

  /* El reloj corre cada minuto: un mes que termina no se queda «en curso». */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);

  /* Un link de antes al resumen (con ?periodo=…) abre los resultados. */
  const router = useRouter();
  const vista: Vista = v.cad === "rango" ? "rango" : "mes";
  const cadencia: Cadencia = vista;
  /* Los links de cuando esto tenía pestañas: el cierre del día y los resultados se mudaron a su propio lugar. */
  const alEod = v.cad === "eod";
  const alPyL = v.cad === "resultados" || Boolean(v.periodo && v.cad !== "rango");
  const sobra = Boolean(v.cad) && v.cad !== "mes" && v.cad !== "rango" && !alEod && !alPyL;
  useEffect(() => {
    if (alEod) { olvidarVistaDe("/finanzas"); router.replace("/finanzas/end-of-day"); }
    else if (alPyL) {
      const q = new URLSearchParams();
      for (const k of ["periodo", "desde", "hasta"] as const) if (v[k]) q.set(k, v[k]);
      olvidarVistaDe("/finanzas");
      router.replace(`/finanzas/resultados${q.size ? `?${q}` : ""}`);
    } else if (sobra) cambiar({ cad: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alEod, alPyL, sobra]);
  const hoyMes = mesDeNegocio(ahora);
  const mes = esPeriodo(v.mes) ? v.mes : hoyMes;
  const periodo = cadencia === "rango" ? `${rangoSel.desde}_${rangoSel.hasta}` : mes;

  const pasos = useMemo(() => pasosDeFinanzas(e, cadencia, periodo, { ahora, esDueno, chequeos }), [e, cadencia, periodo, ahora, esDueno, chequeos]);
  const { listos, total } = avanceDeFinanzas(pasos, esDueno);

  const abrir = (id: string | null, p?: PasoCierre) => cambiar({ paso: id, mostrar: p?.herramienta?.tipo === "cobros" ? p.herramienta.mostrar : null });
  const elegirVista = (x: Vista) => cambiar({ cad: x === "mes" ? null : x, paso: null, mostrar: null, periodo: null, desde: null, hasta: null });
  const marcarPaso = (p: PasoCierre) => marcar(claveChequeo(cadencia, periodo, p.id));
  const desmarcarPaso = (p: PasoCierre) => desmarcar(claveChequeo(cadencia, periodo, p.id));

  if (alEod || alPyL) return null;

  return (
    <div className="cm">
      <div className="cm-barra">
        {vista === "mes" ? (
          <div className="cm-mes">
            <Button sm variante="secondary" icono={<ChevronLeft size={15} />} aria-label="Mes anterior" onClick={() => cambiar({ mes: moverPeriodo(mes, -1), paso: null })} />
            <span className="cm-mes__nombre">{nombrePeriodo(mes)}</span>
            <Button sm variante="secondary" icono={<ChevronRight size={15} />} aria-label="Mes siguiente" disabled={mes >= hoyMes} onClick={() => cambiar({ mes: moverPeriodo(mes, 1), paso: null })} />
            <Button sm variante="ghost" onClick={() => elegirVista("rango")}>Otras fechas</Button>
          </div>
        ) : (
          <div className="cm-mes">
            <DateRangePicker value={rangoSel} minDate={null} onApply={(r) => setRango(r, { paso: null })} footerNota="Días calendario · zona horaria de Argentina" />
            <Button sm variante="ghost" onClick={() => elegirVista("mes")}>Volver al mes</Button>
          </div>
        )}
        <span className="cm-conteo cm-barra__der" aria-live="polite">
          <b>{listos}</b> de {total} pasos listos
        </span>
      </div>

      <Camino
        pasos={pasos} cadencia={cadencia} periodo={periodo} ahora={ahora}
        abierto={pasos.some((p) => p.id === v.paso) ? v.paso : null}
        onAbrir={(id) => abrir(id, pasos.find((p) => p.id === id))}
        agrupar esDueno={esDueno} soloMirar={nivelDeRuta(acceso, "/finanzas") < 2}
        marcar={marcarPaso} desmarcar={desmarcarPaso}
      />
    </div>
  );
}
