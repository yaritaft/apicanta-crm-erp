"use client";

import React, { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { hayNube, nube } from "@/lib/supabase";
import { num } from "@/lib/format";
import { armarPaquete, resumenDeDescarga, type GrabacionDeTranscripcion, type LlamadaParaTranscribir } from "@/lib/transcripciones";
import { crearZip } from "@/lib/zip";

/* ==================================================================
   «Descargar transcripciones»: las de Fathom de todas las llamadas que se
   ven, juntas en un .zip (lib/transcripciones). Se piden a la base con la
   sesión de quien mira, de a tandas: el closer baja sólo las de sus
   llamadas, el director y los dueños las de todos (la tabla lo decide).
   ================================================================== */

const COLUMNAS = "sesionId, titulo, shareUrl, grabadaDesde, grabadaHasta, grabadoPorNombre, resumen, transcripcion";

export function DescargarTranscripciones({ llamadas, nombreArchivo, texto = "Descargar transcripciones", sm = true }: { llamadas: LlamadaParaTranscribir[]; nombreArchivo: string; texto?: string; sm?: boolean }) {
  const toast = useToast();
  const [avance, setAvance] = useState<string | null>(null);

  async function bajar() {
    if (!hayNube || !nube) { toast("Las transcripciones se bajan desde la app publicada, no desde la copia local.", "err"); return; }
    if (llamadas.length === 0) { toast("No hay llamadas para bajar con este filtro.", "err"); return; }
    try {
      /* Primero cuáles tienen transcripción (liviano) y después sólo esas, de a pocas: cada una pesa. */
      setAvance("Buscando…");
      const ids = llamadas.map((l) => l.sesionId);
      const conTrans = new Set<string>();
      for (let i = 0; i < ids.length; i += 60) {
        const r = await nube.from("grabaciones").select("sesionId").in("sesionId", ids.slice(i, i + 60)).not("transcripcion", "is", null);
        if (r.error) throw new Error(r.error.message);
        for (const g of (r.data ?? []) as { sesionId: string }[]) conTrans.add(g.sesionId);
      }
      const grabaciones = new Map<string, GrabacionDeTranscripcion[]>();
      const lista = [...conTrans];
      for (let i = 0; i < lista.length; i += 12) {
        setAvance(`Trayendo ${num(Math.min(i + 12, lista.length))} de ${num(lista.length)}…`);
        const r = await nube.from("grabaciones").select(COLUMNAS).in("sesionId", lista.slice(i, i + 12));
        if (r.error) throw new Error(r.error.message);
        for (const g of (r.data ?? []) as GrabacionDeTranscripcion[]) {
          if (g.sesionId) grabaciones.set(g.sesionId, [...(grabaciones.get(g.sesionId) ?? []), g]);
        }
      }
      const paquete = armarPaquete(llamadas, grabaciones);
      if (paquete.conTranscripcion === 0) {
        toast(`Ninguna de estas ${num(paquete.total)} llamadas tiene transcripción todavía. ${paquete.linkSinTranscripcion
          ? `${num(paquete.linkSinTranscripcion)} tienen el link de Fathom y la app las está trayendo (tarda unos minutos).` : "No tienen link de Fathom."}`, "err");
        return;
      }
      setAvance("Armando el archivo…");
      const zip = await crearZip(paquete.archivos);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreArchivo.endsWith(".zip") ? nombreArchivo : `${nombreArchivo}.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(resumenDeDescarga(paquete));
    } catch (err) {
      toast(err instanceof Error ? `No se pudieron bajar: ${err.message}` : "No se pudieron bajar las transcripciones.", "err");
    } finally {
      setAvance(null);
    }
  }

  return (
    <Button sm={sm} variante="secondary" icono={<FileText size={15} />} cargando={avance !== null} disabled={avance !== null} onClick={() => void bajar()}
      title="Baja en un .zip la transcripción de Fathom de cada llamada que ves (un archivo por llamada, todas juntas en uno y un índice), para llevarlas a Claude">
      {avance ?? texto}
    </Button>
  );
}
