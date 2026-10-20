import type { EstadoApp, Procesador } from "./types";

/* Las cuentas recaudadoras para elegir al cargar un cobro: las activas, las más usadas primero.

   Whop es la segunda cuenta de la empresa (129 cobros) pero quedaba al fondo de una lista de 16 (el orden de la base), y Mariano
   (closer, 19/10) creyó que faltaba. Se cuenta con los cobros que ve quien carga (un closer, los suyos: justo las que usa); a igual
   uso, por nombre. Una función sola para el asistente de venta y para «Registrar pago», así no se desordenan entre sí. */
export function cuentasPorUso(e: Pick<EstadoApp, "procesadores" | "pagos">): Procesador[] {
  const uso = new Map<string, number>();
  for (const x of e.pagos ?? []) if (x.procesadorId) uso.set(x.procesadorId, (uso.get(x.procesadorId) ?? 0) + 1);
  return e.procesadores
    .filter((p) => p.activo)
    .sort((a, b) => (uso.get(b.id) ?? 0) - (uso.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre, "es"));
}
