"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAcceso } from "@/lib/acceso";
import { duracionTexto, puedeVerWhatsapp, puedeVincularWhatsapp, type TipoEstadoLector } from "@/lib/whatsapp";
import { useEstadoDelLector } from "./EstadoLector";

/* ==================================================================
   El aviso de que el lector de WhatsApp dejó de dar señal.

   Sólo aparece si hay un lector (alguna vez mandó un latido) y lleva más de
   15 minutos sin avisar, o sin conexión a WhatsApp (esperando que lo vinculen,
   reconectando o con la sesión cerrada). Sin lector configurado,
   o con uno que anda, no se ve nada. Lo ve quien ve los Webinars (sin estar
   limitado a lo suyo). El pedido de escanear el código y el botón a Ajustes →
   WhatsApp son sólo para quien edita Ajustes: los demás ven «Avisale a un dueño».
   ================================================================== */

/* Qué decir según por qué no anda; sin esto, es que dejó de dar señal. */
const textos = (puedeVincular: boolean): Partial<Record<TipoEstadoLector, [string, string]>> => ({
  "esperando-qr": [
    "El lector de WhatsApp necesita que lo vuelvan a vincular",
    puedeVincular
      ? "Entrá a Ajustes → WhatsApp y escaneá el código QR con el teléfono del número del lector. "
      : "Hay que escanear un código QR con el teléfono del número del lector: avisale a un dueño. ",
  ],
  "reconectando": ["El lector de WhatsApp no logra reconectarse", "El servidor está prendido, pero WhatsApp no lo deja conectar. "],
  "cerrado": ["El lector de WhatsApp perdió la sesión", "Hay que revisar el servidor del lector. "],
});

export function AvisoLectorWhatsapp() {
  const { acceso } = useAcceso();
  const ve = puedeVerWhatsapp(acceso);
  const puedeVincular = puedeVincularWhatsapp(acceso);
  const { estado, hayLector } = useEstadoDelLector(ve);
  if (!ve || !hayLector || !estado.alarma) return null;

  const [titulo, que] = textos(puedeVincular)[estado.tipo] ?? [
    `El lector de WhatsApp no da señal hace ${duracionTexto(estado.minutos ?? 0)}`,
    "Revisá que el servidor del lector esté prendido. ",
  ];
  return (
    <div className="alarma" role="alert">
      <AlertTriangle size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="alarma__titulo">{titulo}</div>
        <div className="alarma__texto">
          {que}Mientras tanto, «quién se unió al grupo» no se actualiza.{puedeVincular || estado.tipo === "esperando-qr" ? "" : " Avisale a un dueño."}
        </div>
      </div>
      {puedeVincular && <Link href="/ajustes?seccion=whatsapp" className="hk-btn hk-btn--secondary hk-btn--sm">Ver el estado</Link>}
    </div>
  );
}
