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

/** Las cuentas para ofrecer en el selector de un cobro: las activas (por uso) y, si el cobro ya tiene una que después se apagó, también esa, marcada
 *  como apagada: sin ella el selector quedaba en blanco al corregir un cobro viejo. Una cuenta apagada no se ofrece para cobros nuevos (Aldana, 20/11). */
export function opcionesDeCuenta(
  e: Pick<EstadoApp, "procesadores" | "pagos">,
  elegidas: readonly (string | undefined)[] = [],
): { valor: string; texto: string }[] {
  const activas = cuentasPorUso(e);
  const ids = new Set(activas.map((p) => p.id));
  const apagadas = e.procesadores.filter((p) => !p.activo && elegidas.includes(p.id) && !ids.has(p.id));
  return [
    ...activas.map((p) => ({ valor: p.id, texto: p.nombre })),
    ...apagadas.map((p) => ({ valor: p.id, texto: `${p.nombre} (apagada)` })),
  ];
}
