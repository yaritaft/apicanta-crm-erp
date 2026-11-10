/* Donde va el popover. Función pura: recibe el rectángulo del botón, el alto
   que el popover ocupa entero (calendarios + pie) y la ventana, y devuelve
   dónde ponerlo.

   Antes el popover era `position: absolute` adentro de la página y confiaba en
   `scrollIntoView` para mostrarse: en una ventana baja o con zoom la página se
   desplazaba sola, el popover quedaba tapando la barra y se perdía el pie con
   el botón «Actualizar» (Mariano, 03/11 y 09/11: elegía «Máximo» o un rango y
   el CRM seguía en el 31/10, porque no veía cómo aplicarlo). Ahora es
   `position: fixed` y siempre entra en la ventana: si falta alto, lo que
   scrollea son los calendarios, y el pie con Cancelar/Actualizar queda fijo. */
export type UbicacionPopover = { left: number; top?: number; bottom?: number; maxHeight: number; maxWidth: number };

const MARGEN_POP = 8;
const SEPARACION_POP = 6;

export function ubicarPopover(
  boton: { left: number; right: number; top: number; bottom: number },
  pop: { ancho: number; alto: number },
  ventana: { ancho: number; alto: number },
  placement: "bottom" | "top" | "auto" = "auto",
): UbicacionPopover {
  const maxWidth = Math.max(0, ventana.ancho - 2 * MARGEN_POP);
  const ancho = Math.min(pop.ancho, maxWidth);
  /* Pegado al borde derecho del botón, como siempre, pero sin salirse de la ventana. */
  const left = Math.max(MARGEN_POP, Math.min(boton.right - ancho, ventana.ancho - ancho - MARGEN_POP));
  const abajo = ventana.alto - boton.bottom - SEPARACION_POP - MARGEN_POP;
  const arriba = boton.top - SEPARACION_POP - MARGEN_POP;
  const todo = ventana.alto - 2 * MARGEN_POP;
  const entra = (lugar: number) => pop.alto <= lugar;

  let lado: "bottom" | "top";
  if (placement === "bottom") lado = "bottom";
  else if (placement === "top") lado = "top";
  else lado = entra(abajo) || (!entra(arriba) && abajo >= arriba) ? "bottom" : "top";

  const lugar = lado === "bottom" ? abajo : arriba;
  /* Ni arriba ni abajo hay un lugar que valga la pena (una ventana muy baja): se
     abre sobre el botón, ocupando la ventana, antes que dejar un pedacito. */
  if (lugar < Math.min(pop.alto, 280)) return { left, top: MARGEN_POP, maxHeight: Math.max(0, todo), maxWidth };
  return lado === "bottom"
    ? { left, top: boton.bottom + SEPARACION_POP, maxHeight: Math.max(0, lugar), maxWidth }
    : { left, bottom: ventana.alto - boton.top + SEPARACION_POP, maxHeight: Math.max(0, lugar), maxWidth };
}
