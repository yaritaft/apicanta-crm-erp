"use client";

import React, { useMemo } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { ventasParaAtar, webinarsQueFaltan } from "@/lib/atar-webinars";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Las ventas del webinar que no tienen su webinar: sin eso, el profit y
   el ROAS de cada webinar salen vacíos. Dice cuántas hay y por qué se
   sabe de cuál son, y las ata con un clic (lib/atar-webinars.ts).
   ================================================================== */

export function AtarVentas({ e }: { e: EstadoApp }) {
  const toast = useToast();
  const { atar, faltan } = useMemo(() => {
    const faltan = webinarsQueFaltan(e);
    return { atar: ventasParaAtar(e), faltan };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.ventas, e.webinars, e.sesiones, e.contactos, e.embudos]);
  if (atar.length === 0 && faltan.length === 0) return null;

  const cuenta = (m: string) => atar.filter((a) => a.motivo === m).length;
  const motivos = [
    cuenta("proyecto") && `${cuenta("proyecto")} por el proyecto WEB-`,
    cuenta("utm") && `${cuenta("utm")} por los UTMs de quien compró`,
    cuenta("fecha") && `${cuenta("fecha")} del embudo de webinar por la fecha (del último vivo antes de la venta)`,
  ].filter(Boolean);
  const ventasDeFaltan = faltan.reduce((a, w) => a + w.ventas, 0);
  const n = (k: number, uno: string, varios: string) => (k === 1 ? `una ${uno}` : `${k} ${varios}`);

  return (
    <div className="help-card" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <Link2 size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="help-card__title">
          {atar.length > 0
            ? `${atar.length === 1 ? "Una venta" : `${atar.length} ventas`} del webinar sin su webinar`
            : `${ventasDeFaltan === 1 ? "Una venta" : `${ventasDeFaltan} ventas`} de webinars que no están cargados`}
        </div>
        <div className="help-card__text">
          Sin el webinar atado, su profit y su ROAS salen vacíos.
          {motivos.length > 0 && <> Se sabe de cuál son: {motivos.join(", ")}.</>}
          {faltan.length > 0 && (
            <> Además, la planilla nombra {faltan.length === 1 ? "un webinar que no está cargado" : `${faltan.length} webinars que no están cargados`}
            ({faltan[0].proyecto}{faltan.length > 1 ? ` a ${faltan[faltan.length - 1].proyecto}` : ""}): se {faltan.length === 1 ? "crea finalizado" : "crean finalizados"}, con {n(ventasDeFaltan, "venta", "ventas")}, y le{faltan.length === 1 ? "" : "s"} cargás la pauta y el embudo.</>
          )}
        </div>
      </div>
      <Button variante="secondary" icono={<Link2 size={16} />} onClick={() => {
        const r = acciones.atarVentasAWebinars();
        toast(`${r.ventas === 1 ? "Una venta atada" : `${r.ventas} ventas atadas`} a su webinar${r.webinars ? ` y ${r.webinars === 1 ? "un webinar creado" : `${r.webinars} webinars creados`}` : ""}.`);
      }}>
        Atar las ventas
      </Button>
    </div>
  );
}
