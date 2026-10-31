"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelDeLiquidacion } from "@/lib/permisos";
import { LimiteDeError } from "@/components/ui/LimiteDeError";
import { ListaCobros } from "@/components/cobros/ListaCobros";
import { LiquidacionMes } from "@/components/equipo/Liquidacion";
import { CajaVista } from "@/components/finanzas/vistas/CajaVista";
import { ConciliacionVista } from "@/components/finanzas/vistas/ConciliacionVista";
import { DetalleVista } from "@/components/finanzas/vistas/DetalleVista";
import { ResultadosVista } from "@/components/finanzas/vistas/ResultadosVista";
import { PendientesDeConciliar } from "@/components/conciliacion/PendientesDeConciliar";
import { diasDeLaSemana, diasDelRango, semanaDe } from "@/lib/finanzas-pasos";
import { diaDeNegocio } from "@/lib/dia-negocio";
import type { Cadencia, Herramienta } from "@/lib/cierre-mes";

/* ==================================================================
   Las pantallas de siempre, adentro del paso: Conciliación, los cobros, la
   mora, la Caja, los gastos, las devoluciones, la liquidación y el P&L. Son
   las mismas pantallas (con sus botones y sus filtros): sólo cambia dónde se
   abren. La ruta de cada una sigue funcionando.
   ================================================================== */

const ultimoDia = (mes: string) => String(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0).getDate()).padStart(2, "0");

/** El período con el que trabaja la herramienta: el del paso, y el mes en curso cuando el paso es de un día o una semana. */
function periodoDe(cadencia: Cadencia, periodo: string, mesActual: string) {
  if (cadencia === "rango") return { preset: "custom", ...diasDelRango(periodo) };
  const mes = cadencia === "mes" ? periodo : mesActual;
  return { preset: "custom", desde: `${mes}-01`, hasta: `${mes}-${ultimoDia(mes)}` };
}

/** La pantalla de siempre adentro del paso. Si esa parte falla, se cae ella sola con su detalle: los demás pasos siguen andando. */
export function HerramientaDelPaso(props: { h: Herramienta; cadencia: Cadencia; periodo: string; ahora: number }) {
  return (
    <LimiteDeError nombre="esta parte" reinicia={`${props.h.tipo}|${props.cadencia}|${props.periodo}`}>
      <HerramientaInterna {...props} />
    </LimiteDeError>
  );
}

function HerramientaInterna({ h, cadencia, periodo, ahora }: { h: Herramienta; cadencia: Cadencia; periodo: string; ahora: number }) {
  const e = useEstado();
  const router = useRouter();
  const { acceso, esDueno: esDuenoDeVerdad } = useAcceso();
  const hoy = diaDeNegocio(new Date(ahora).toISOString());
  const rango = useMemo(() => periodoDe(cadencia, periodo, hoy.slice(0, 7)), [cadencia, periodo, hoy]);

  switch (h.tipo) {
    case "conciliacion":
      return <ConciliacionVista embebido rangoFijo={rango} />;
    case "caja":
      return <CajaVista embebido rangoFijo={rango} />;
    case "mora":
      return <DetalleVista embebido seccion="cobros" rangoFijo={rango} />;
    case "gastos":
      return <DetalleVista embebido seccion="gastos" rangoFijo={rango} />;
    case "fijos":
      return <DetalleVista embebido seccion="fijos" rangoFijo={rango} />;
    case "devoluciones":
      return <DetalleVista embebido seccion="devoluciones" rangoFijo={rango} />;
    case "resultados":
      return <ResultadosVista embebido rangoFijo={rango} />;
    case "origen":
      /* Es una lista de un mes: el del paso, o el en curso cuando el paso es de un día o una semana. */
      return <PendientesDeConciliar mes={cadencia === "mes" ? periodo : hoy.slice(0, 7)} />;
    case "liquidacion":
      return (
        <LiquidacionMes
          onVerPersona={esDuenoDeVerdad ? (id) => router.push(`/equipo?seccion=equipo&persona=${id}`) : undefined}
          soloMirar={nivelDeLiquidacion(acceso) < 2}
        />
      );
    case "cobros": {
      /* Hoy y la semana miran lo reciente (45 días y la semana); el mes, el mes entero. */
      const delPeriodo = cadencia === "mes" || cadencia === "rango";
      const desde = delPeriodo ? rango.desde : cadencia === "semana" ? diasDeLaSemana(semanaDe(hoy)).desde : diaDeNegocio(new Date(ahora - 45 * 86400000).toISOString());
      const hasta = delPeriodo ? rango.hasta : cadencia === "semana" ? diasDeLaSemana(semanaDe(hoy)).hasta : hoy;
      return (
        <ListaCobros
          e={e} desde={desde} hasta={hasta} busca=""
          filtros={{ vendedor: "", setter: "", servicio: "", estrategia: "", proyecto: "", cuenta: "" }}
          hayFiltros={false} onLimpiar={() => undefined}
        />
      );
    }
  }
}
