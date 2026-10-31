"use client";

import { Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import type { Venta } from "@/lib/types";

/* Elegir la estrategia de una venta que no la tiene, ahí donde se la ve (la lista de Ventas y su ficha), sin abrir el formulario
   entero (Aldana, 31/10: «esas 8 ventas sin estrategia: no tenemos formas de asignarle estrategia»). Guarda sólo ese campo:
   un UPDATE de una columna, no la fila entera. Si la cuenta no puede, la base lo frena y el aviso trae «Pedir permiso». */
export function EstrategiaRapida({ venta }: { venta: Venta }) {
  const e = useEstado();
  const toast = useToast();
  return (
    /* Dentro de una fila o de un encabezado que se abren al tocarlos: el desplegable no tiene que abrir también la ficha. */
    <span style={{ display: "inline-block", minWidth: 170 }} onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
      <Select value="" placeholder="Elegir estrategia" aria-label={`Estrategia de la venta de ${venta.contactoNombre}`} error
        opciones={e.embudos.filter((x) => x.activo).sort((a, b) => a.orden - b.orden).map((x) => ({ valor: x.id, texto: x.nombre }))}
        onChange={(ev) => {
          const embudo = e.embudos.find((x) => x.id === ev.target.value);
          if (!embudo) return;
          acciones.actualizarParcial<Venta>("ventas", venta.id, { embudoId: embudo.id }, venta.contactoNombre, `Estrategia: ${embudo.nombre}.`);
          toast(`Venta de ${venta.contactoNombre}: estrategia ${embudo.nombre}.`);
        }} />
    </span>
  );
}
