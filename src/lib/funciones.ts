/* Interruptores de funciones que existen pero están apagadas a propósito.
   Apagar no es borrar: el código queda, y se vuelve a prender acá. */

/* Las sesiones entran sólo por Calendly (pedido de Juanchi, 22/09/2026):
   agendar a mano desde la app queda desactivado. Editar una llamada y marcar
   si se hizo o no vino sigue andando. Si algún día hace falta cargar una
   llamada que no pasó por Calendly, se prende acá. */
export const AGENDAR_A_MANO = false;
