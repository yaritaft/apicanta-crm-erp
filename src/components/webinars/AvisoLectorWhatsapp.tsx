"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { duracionTexto } from "@/lib/whatsapp";
import { useEstadoDelLector } from "./EstadoLector";

/* ==================================================================
   El aviso de que el lector de WhatsApp dejó de dar señal.

   Sólo aparece si hay un lector (alguna vez mandó un latido) y lleva más de
   15 minutos sin avisar, o sin conexión a WhatsApp. Sin lector configurado,
   o con uno que anda, no se ve nada. Lo ve quien ve los Webinars.
   ================================================================== */

export function AvisoLectorWhatsapp() {
  const { acceso } = useAcceso();
  const ve = nivelEn(acceso, "webinars") >= 1;
  const { estado, hayLector } = useEstadoDelLector(ve);
  if (!ve || !hayLector || !estado.alarma) return null;

  const sinWhatsapp = estado.tipo === "desconectado";
  return (
    <div className="alarma" role="alert">
      <AlertTriangle size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="alarma__titulo">
          {sinWhatsapp
            ? "El lector de WhatsApp perdió la conexión"
            : `El lector de WhatsApp no da señal hace ${duracionTexto(estado.minutos ?? 0)}`}
        </div>
        <div className="alarma__texto">
          {sinWhatsapp
            ? "Hay que escanear el QR de nuevo. "
            : "Revisá que el servidor del lector esté prendido. "}
          Mientras tanto, «quién se unió al grupo» no se actualiza.
        </div>
      </div>
      <Link href="/ajustes?seccion=whatsapp" className="hk-btn hk-btn--secondary hk-btn--sm">Ver el estado</Link>
    </div>
  );
}
