"use client";

import React, { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { hace } from "@/lib/avisos";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { ErrorConciliacion, mandarAvisoOrigen, pedirAvisoOrigen } from "@/lib/conciliacion-nube";
import type { EstadoDelAvisoOrigen } from "@/lib/conciliacion-servidor";
import type { ResumenPendientes } from "@/lib/pendientes-conciliar";

/* ==================================================================
   El botón de Finanzas para pasarle la lista al director (Aldana, 31/10:
   «le tendría que aparecer a Santi»). Ella la sigue viendo y puede
   resolverla; esto le deja a él un aviso en la campanita con lo que hay,
   que lo lleva a la misma lista en su panel. Una vez por día y por mes.
   ================================================================== */

const nombreCorto = (n: string) => n.split(/\s+/)[0] || n;

export function AvisarAlDirector({ mes, resumen }: { mes: string; resumen: ResumenPendientes }) {
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoDelAvisoOrigen | null>(null);
  const [mandando, setMandando] = useState(false);

  useEffect(() => {
    let vigente = true;
    setEstado(null);
    pedirAvisoOrigen(mes).then((e) => { if (vigente) setEstado(e); }).catch(() => { /* sin esto no se ofrece avisar: la lista sigue sirviendo */ });
    return () => { vigente = false; };
  }, [mes]);

  if (!estado || estado.directores.length === 0) return null;
  const quien = estado.directores.map(nombreCorto).join(" y ");
  const ultimo = estado.ultimo;
  const hoy = diaDeNegocio(new Date().toISOString());
  const yaHoy = ultimo ? diaDeNegocio(ultimo.creadoEn) === hoy : false;

  async function avisar() {
    setMandando(true);
    try {
      await mandarAvisoOrigen(mes, resumen);
      setEstado((e) => e && { ...e, ultimo: { creadoEn: new Date().toISOString(), leidoEn: null } });
      toast(`Listo: ${quien} lo ve en su campanita y lo resuelve desde su panel.`);
    } catch (x) {
      toast(x instanceof ErrorConciliacion ? x.message : "No se pudo mandar el aviso.", "err");
    } finally { setMandando(false); }
  }

  return (
    <div className="pc-aviso-dir">
      {ultimo && (
        <span className="pc-aviso-dir__estado t-sm t-subtle" role="status">
          {yaHoy && <Check size={14} aria-hidden />}
          Le avisaste {hace(ultimo.creadoEn)} · {ultimo.leidoEn ? "lo leyó" : "todavía no lo leyó"}
        </span>
      )}
      {!yaHoy && (
        <Button sm variante="secondary" icono={<Send size={14} />} cargando={mandando} onClick={() => void avisar()}>
          Avisarle a {quien}
        </Button>
      )}
    </div>
  );
}
