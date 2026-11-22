import type { ID, MiembroEquipo } from "./types";

/* ==================================================================
   Quién puede figurar como vendedor de una venta: UNA sola regla para
   todas las pantallas que lo eligen (el asistente de «Cargar venta»,
   editar una venta, la ficha de Servicio y los resells).

   Vende quien tiene en Equipo un rol de venta (Closer o CEO) y sigue
   activo. La lista es LA MISMA para todos: no depende de quién está
   cargando. Antes cada pantalla armaba la suya y el asistente escondía a
   Yari a todos menos a ella misma; Aldana, que carga las ventas que cierra
   Yari, no la encontraba (22/11). Para sumar a alguien que vende alcanza
   con ponerle rol «Closer» en Equipo: no hace falta tocar código.

   Ojo: no es lo mismo que «a quién se le pide cargar una venta» o «a
   quién se le pasa una llamada» (lib/pedidos-de-venta.ts y
   lib/pasar-llamadas.ts): ésos son quienes tienen panel de closer.
   ================================================================== */

/** Los roles de Equipo que venden. */
export const ROLES_QUE_VENDEN: readonly string[] = ["closer", "ceo"];

/** Si esta persona del equipo puede ser el vendedor de una venta (activa o no). */
export function vende(m: Pick<MiembroEquipo, "rol">): boolean {
  return ROLES_QUE_VENDEN.includes(m.rol);
}

/** Los vendedores para elegir, por nombre: los que venden y siguen activos.
 *  `elegido`: el vendedor que la venta ya tiene; si hoy no está activo (se
 *  fue), igual se ofrece, para no perderlo al editarla. */
export function vendedores(equipo: readonly MiembroEquipo[], elegido?: ID | null): MiembroEquipo[] {
  return equipo
    .filter((m) => vende(m) && (m.activo || (Boolean(elegido) && m.id === elegido)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Los nombres de los vendedores, para los campos de texto con sugerencias (Servicio, resells). */
export function nombresDeVendedores(equipo: readonly MiembroEquipo[]): string[] {
  return vendedores(equipo).map((m) => m.nombre);
}
