"use client";

import React, { useEffect, useState } from "react";
import { Copy, Mail, Map as MapaIcono } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { cabeceras } from "@/components/webinars/useYoutube";
import { BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";
import { conCodigoDelAlumno, guiaDeBienvenida, textoDeBienvenida } from "@/lib/bienvenida-alumno";
import { fechaLarga } from "@/lib/format";
import { useEstado } from "@/lib/store";
import type { Contrato } from "@/lib/contratos";
import { leerContratos } from "./cliente";

/* ==================================================================
   La bienvenida del alumno en Servicio → Contrato (Lili, 22/10): qué
   perfil cargó el closer, qué roadmap le toca y si el mail ya salió.
   Mientras el envío de mails no esté configurado (Resend), el mensaje se
   copia acá y se le manda por WhatsApp o por mail, con el link de su
   formulario semanal ya puesto.
   ================================================================== */

const MODELO = { completo: "Programa completo", downsell: "Downsell", reserva: "Reserva" } as const;

/* Su código personal (el del reporte, que también lo anota a los simulacros): con él se arman sus links. */
async function codigoDelAlumno(alumnoId: string): Promise<string | null> {
  const r = await fetch("/api/reportes/enlace", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" },
    body: JSON.stringify({ alumnoId }),
  }).catch(() => null);
  const j = (await r?.json().catch(() => ({}))) as { codigo?: string } | undefined;
  return r?.ok && j?.codigo ? j.codigo : null;
}

export function BienvenidaAlumno({ alumnoId, ventaId }: { alumnoId: string; ventaId?: string }) {
  const toast = useToast();
  const config = useEstado().ajustes.bienvenida;
  const [contrato, setContrato] = useState<Contrato | null | undefined>(undefined);
  const [copiando, setCopiando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void leerContratos({ alumnoId, ventaId }).then((r) => {
      if (!vivo) return;
      /* El último contrato que no se anuló: el que mira el alumno. */
      setContrato(r.contratos.find((c) => c.estado !== "anulado" && c.estado !== "error") ?? null);
    });
    return () => { vivo = false; };
  }, [alumnoId, ventaId]);

  if (!contrato) return null;
  const guia = guiaDeBienvenida({ reserva: contrato.datos.reserva, programa: contrato.programa, perfil: contrato.datos.perfil, config });
  if (!guia) return null;

  const copiar = async () => {
    setCopiando(true);
    const codigo = guia.modelo === "completo" ? await codigoDelAlumno(alumnoId) : null;
    const { texto } = textoDeBienvenida(conCodigoDelAlumno(guia, window.location.origin, codigo), contrato.bienvenida ? `${window.location.origin}/bienvenida/${contrato.bienvenida}` : null);
    const ok = await copiarTexto(texto);
    setCopiando(false);
    toast(ok ? "Mensaje de bienvenida copiado: pegalo en WhatsApp o en un mail." : "No se pudo copiar.", ok ? "ok" : "err");
  };

  const firmado = contrato.estado === "firmado";
  return (
    <BloqueServicio titulo="Bienvenida" extra={
      contrato.bienvenidaMailEn
        ? <span className="hs-chip hs-chip--ok">Le llegó por mail</span>
        : <span className={`hs-chip${firmado ? " hs-chip--ambar" : ""}`}>{firmado ? "Mandásela vos" : "Sale al firmar"}</span>
    }>
      <FilaServicio icono={<MapaIcono size={15} />} rotulo="Perfil y roadmap" detalle={MODELO[guia.modelo]}>
        {guia.perfil && guia.roadmap
          ? <a className="link t-sm" href={guia.roadmap} target="_blank" rel="noopener noreferrer">{guia.perfil}</a>
          : guia.perfil ? <span className="hs-guion">{guia.perfil} · falta el link en Ajustes</span>
            : <span className="hs-rojo">El closer no cargó el perfil</span>}
      </FilaServicio>
      <FilaServicio icono={<Mail size={15} />} rotulo="Mail de bienvenida"
        detalle={contrato.bienvenidaMailEn ? undefined : "Todavía no sale solo: copiá el mensaje y mandáselo por WhatsApp o mail."}>
        {contrato.bienvenidaMailEn
          ? <span className="t-num">{fechaLarga(contrato.bienvenidaMailEn)}</span>
          : <Button sm variante="secondary" icono={<Copy size={14} />} disabled={copiando} onClick={() => void copiar()}>Copiar el mensaje</Button>}
      </FilaServicio>
    </BloqueServicio>
  );
}
