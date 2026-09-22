"use client";

import { useSearchParams } from "next/navigation";
import { FichaPersona } from "./FichaPersona";
import { useCerrarFicha, useVistaFicha } from "./abrir";

/* Está montada en el layout de la app: si la URL trae ?ficha=<id>, la
   ficha se abre encima de la pantalla que sea. */
export function FichaGlobal() {
  const params = useSearchParams();
  const cerrar = useCerrarFicha();
  const cambiarVista = useVistaFicha();
  const id = params.get("ficha");
  if (!id) return null;
  return (
    <FichaPersona
      key={id}
      id={id}
      vista={params.get("vista") === "servicio" ? "servicio" : "ventas"}
      ventaResaltada={params.get("venta")}
      onCerrar={cerrar}
      onVista={cambiarVista}
    />
  );
}
