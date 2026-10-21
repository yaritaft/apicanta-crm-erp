"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { num } from "@/lib/format";
import { nivelEn } from "@/lib/permisos";
import { useEstado } from "@/lib/store";
import { puedeVerWhatsapp, webinarsSinGrupo } from "@/lib/whatsapp";
import { atarGrupoAWebinar, useAhora, useLector } from "@/lib/whatsapp-cliente";
import { diaCorto } from "./fechas";
import "./whatsapp.css";

/* ==================================================================
   Los webinars que todavía no tienen su grupo de WhatsApp atado.

   Sin el grupo atado el lector no puede decir quién se unió, y Formularios
   queda con las marcas a mano. Acá se ve cuáles faltan (los próximos y los de
   los últimos 45 días) y, si el lector ya detectó un grupo cuyo nombre trae la
   fecha («Taller Online 21/10/26 #1»), se ata con un clic. Los que dicen la fecha
   COMPLETA (con el año) se atan solos al crear el webinar y una vez por día
   (api/cron/whatsapp-atar-grupos): acá quedan los que no se pueden decidir solos,
   por ejemplo un nombre sin año. Un webinar nuevo también puede atar su grupo al
   crearlo (AsistenteWebinar).
   ================================================================== */

export function AvisoGruposSinAtar() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const ve = puedeVerWhatsapp(acceso);
  const puedeAtar = nivelEn(acceso, "webinars") >= 2;
  const lector = useLector(ve);
  const ahora = useAhora(10 * 60_000);
  const [atando, setAtando] = useState<string | null>(null);

  const pendientes = useMemo(
    () => (lector.datos?.tablas ? webinarsSinGrupo(e.webinars, lector.datos.grupos ?? [], ahora) : []),
    [e.webinars, lector.datos, ahora],
  );
  if (!ve || pendientes.length === 0) return null;

  async function atar(webinarId: string, titulo: string, grupoIds: string[]) {
    setAtando(webinarId);
    let hechos = 0;
    try {
      for (const id of grupoIds) { await atarGrupoAWebinar(id, webinarId); hechos++; }
      toast(`${hechos === 1 ? "El grupo quedó atado" : `Los ${hechos} grupos quedaron atados`} a «${titulo}».`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo atar el grupo.", "err");
    } finally { setAtando(null); }
  }

  return (
    <div className="stack-2">
      {pendientes.slice(0, 3).map(({ webinar: w, sugeridos }) => (
        <div key={w.id} className="help-card wb-sin-grupo">
          <MessageCircle size={18} aria-hidden />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="help-card__title">El webinar del {diaCorto(w.fecha)} todavía no tiene grupo de WhatsApp atado</div>
            <div className="help-card__text">
              {sugeridos.length > 0
                ? <>El lector ya detectó {sugeridos.map((g) => `«${g.nombre}» (${num(g.miembros)})`).join(" y ")}, con su fecha. Sin el grupo atado no se sabe quién se unió.</>
                : <>Todavía no hay un grupo con su fecha. Cuando lo armen y el lector lo detecte, se ata acá con un clic; también se elige a mano en su ficha. Sin el grupo atado no se sabe quién se unió.</>}
            </div>
          </div>
          <div className="wb-sin-grupo__acciones">
            {puedeAtar && sugeridos.length > 0 && (
              <Button sm variante="brand" cargando={atando === w.id} onClick={() => void atar(w.id, w.titulo, sugeridos.map((g) => g.id))}>
                {sugeridos.length === 1 ? "Atar el grupo" : `Atar los ${sugeridos.length} grupos`}
              </Button>
            )}
            <Link href={`/webinars/${encodeURIComponent(w.id)}`} className="hk-btn hk-btn--secondary hk-btn--sm">Abrir la ficha</Link>
          </div>
        </div>
      ))}
      {pendientes.length > 3 && <p className="t-sm t-subtle">Y {pendientes.length - 3} más sin grupo atado. Se atan desde Ajustes → WhatsApp.</p>}
    </div>
  );
}
