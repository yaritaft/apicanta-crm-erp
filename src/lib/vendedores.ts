import type { ID, MiembroEquipo } from "./types";

/* ==================================================================
   Quién puede figurar como vendedor de una venta: UNA sola regla para
   todas las pantallas que lo eligen (el asistente de «Cargar venta»,
   editar una venta, la ficha de Servicio y los resells).

   Aparece quien sigue activo y vende: por su rol en Equipo (Closer o CEO)
   o porque se lo prendieron a mano en su ficha («Aparece como vendedor al
   cargar una venta»), que manda sobre el rol en los dos sentidos. La
   lista es LA MISMA para todos: no depende de quién está cargando. Antes
   cada pantalla armaba la suya y el asistente escondía a Yari a todos
   menos a ella misma; Aldana, que carga las ventas que cierra Yari, no la
   encontraba (22/11). Para sumar o sacar a alguien no hace falta tocar
   código: se hace desde Equipo.

   Ojo: no es lo mismo que «a quién se le pide cargar una venta» o «a
   quién se le pasa una llamada» (lib/pedidos-de-venta.ts y
   lib/pasar-llamadas.ts): ésos son quienes tienen panel de closer.
   ================================================================== */

/** Los roles de Equipo que venden si nadie dijo otra cosa en la ficha. */
export const ROLES_QUE_VENDEN: readonly string[] = ["closer", "ceo"];

/** Lo que diría el rol solo, sin lo que se prendió o apagó a mano. */
export function vendePorRol(m: Pick<MiembroEquipo, "rol">): boolean {
  return ROLES_QUE_VENDEN.includes(m.rol);
}

/** Si esta persona del equipo aparece como vendedor (activa o no): lo de su ficha y, sin dato, su rol. */
export function vende(m: Pick<MiembroEquipo, "rol" | "apareceComoVendedor">): boolean {
  return m.apareceComoVendedor ?? vendePorRol(m);
}

/** Lo que se guarda al prender o apagar el interruptor: si coincide con el rol, nada (null), así un cambio de rol después manda. */
export function datoAlPrender(m: Pick<MiembroEquipo, "rol">, prendido: boolean): boolean | null {
  return prendido === vendePorRol(m) ? null : prendido;
}

/** Los vendedores para elegir, por nombre: los activos que venden.
 *  `elegido`: el vendedor que la venta ya tiene; si hoy no aparecería (se
 *  fue o se lo apagaron), igual se ofrece, para no perderlo al editarla. */
export function vendedores(equipo: readonly MiembroEquipo[], elegido?: ID | null): MiembroEquipo[] {
  return equipo
    .filter((m) => (m.activo && vende(m)) || (Boolean(elegido) && m.id === elegido))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Los nombres de los vendedores, para los campos de texto con sugerencias (Servicio, resells). */
export function nombresDeVendedores(equipo: readonly MiembroEquipo[]): string[] {
  return vendedores(equipo).map((m) => m.nombre);
}
