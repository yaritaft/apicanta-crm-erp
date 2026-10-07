"use client";

import React, { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { excelDelInforme } from "@/lib/informe-webinar";
import { TIPO_XLSX } from "@/lib/xlsxEscribir";
import type { Webinar } from "@/lib/types";

/* ==================================================================
   «Descargar resumen» de un webinar (F3-05): el Excel de tres hojas
   (Personas, Agendas y Anuncios) que Agus arma a mano después de cada
   webinar. Se arma en el momento, con lo que ya tiene la app, y se baja
   en el navegador. Lo usan la ficha del webinar y la planilla.
   ================================================================== */

export function useDescargarInforme(w: Webinar) {
  const e = useEstado();
  const toast = useToast();
  const [bajando, setBajando] = useState(false);

  async function descargar() {
    if (bajando) return;
    setBajando(true);
    try {
      const { nombre, datos, informe } = await excelDelInforme(e, w);
      const url = URL.createObjectURL(new Blob([datos], { type: TIPO_XLSX }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const p = informe.personas.filas.length, ag = informe.agendas.filas.length, an = informe.anuncios.filas.length;
      toast(`Se bajó el resumen de «${w.titulo}»: ${p} ${p === 1 ? "persona" : "personas"}, ${ag} ${ag === 1 ? "agenda" : "agendas"} y ${an} ${an === 1 ? "anuncio" : "anuncios"}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo armar el Excel.", "err");
    } finally {
      setBajando(false);
    }
  }
  return { descargar, bajando };
}

/** El botón con texto, para el encabezado de la ficha. */
export function BotonInforme({ w }: { w: Webinar }) {
  const { descargar, bajando } = useDescargarInforme(w);
  return (
    <Button
      variante="secondary" icono={<Download size={16} />} onClick={() => void descargar()} cargando={bajando}
      title="Un Excel con tres hojas: las personas, las agendas y los anuncios de este webinar."
    >
      {bajando ? "Armando el Excel…" : "Descargar resumen"}
    </Button>
  );
}

/** El ícono, para la fila de la planilla. */
export function BotonInformeFila({ w }: { w: Webinar }) {
  const { descargar, bajando } = useDescargarInforme(w);
  return (
    <button
      type="button" className="planilla__bajar" disabled={bajando}
      aria-label={`Descargar el resumen de «${w.titulo}» en Excel`} title="Descargar resumen (Excel de tres hojas)"
      onClick={() => void descargar()}
    >
      <Download size={15} />
    </button>
  );
}
