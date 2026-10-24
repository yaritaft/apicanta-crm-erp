"use client";

import React, { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/ui";
import { CrmTabla } from "@/components/crm-tabla/CrmTabla";
import { ResellsCs } from "@/components/cs/ResellsCs";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useUsuarioActual } from "@/lib/usuario";
import { puedeLeer } from "@/lib/permisos";
import { esDelCloser } from "@/lib/eod";
import { filasResells, resellAbierto } from "@/lib/clientes-cs";
import { useEscribirURL } from "@/lib/useParamsURL";

/* ==================================================================
   Las llamadas de venta y las de resell, cada una en su grupo.

   En el Airtable eran dos tablas con estados distintos («Booking Calls» y
   «Agendas Resells»); en la app estaban mezcladas y un resell se cargaba como
   si fuera un lead de venta, sin sus opciones (Mariano, 19/10). Ahora «Ventas»
   es la tabla de siempre, sin las llamadas de resell, y «Resell» es la agenda
   de resells de Customer Success: sus estados (varios a la vez), el Cash
   Collect, si es caso de éxito y las notas. Un closer ve sólo las suyas.
   ================================================================== */

type Grupo = "ventas" | "resell";

export function CrmConResells({ misLlamadas }: { misLlamadas?: boolean }) {
  const e = useEstado();
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const { acceso } = useAcceso();
  const yo = useUsuarioActual();
  const veResells = puedeLeer(acceso, "resells");
  const grupo: Grupo = veResells && params.get("grupo") === "resell" ? "resell" : "ventas";

  /* Las agendas de resell abiertas (ya pasaron y no tienen un resultado que las cierre): lo que hay para cerrar. */
  const porCargar = useMemo(() => {
    if (!veResells) return 0;
    const ahora = Date.now();
    const suyas = (r: { closer: string }) => !acceso?.soloLoSuyo || (yo.miembro ? esDelCloser({ anfitrion: r.closer }, yo.miembro.nombre, e.equipo) : false);
    return filasResells(e).filter((f) => suyas(f.resell) && resellAbierto(f.resell, ahora)).length;
  }, [e, veResells, acceso?.soloLoSuyo, yo.miembro]);

  if (!veResells) return <CrmTabla misLlamadas={misLlamadas} />;
  return (
    <>
      <div className="crm-grupos">
        <Tabs<Grupo>
          valor={grupo} onChange={(g) => escribir(g === "resell" ? { grupo: "resell", "por-cargar": porCargar > 0 ? "1" : null } : { grupo: null, "por-cargar": null })}
          opciones={[
            { valor: "ventas", texto: "Ventas" },
            { valor: "resell", texto: porCargar > 0 ? `Resell · ${porCargar} por cerrar` : "Resell" },
          ]}
        />
      </div>
      {grupo === "resell" ? <ResellsCs /> : <CrmTabla misLlamadas={misLlamadas} />}
    </>
  );
}
