/* ==================================================================
   Lo que la base NO dejó guardar.

   La app guarda primero en pantalla y después manda a la base. Si la base
   rechaza una fila (un candado de closers, un permiso), la cola la descarta
   y vuelve a traer todo. Hasta el 17/11 nadie más se enteraba: el asistente
   de ventas dijo «la venta quedó registrada» de una venta que la base había
   rechazado (Mariano cerró un lead que era de Dante) y el contrato falló con
   «No encuentro esa venta».

   Acá queda anotado qué fila se rechazó y por qué, para que quien la cargó
   lo diga con todas las letras en vez de dar por hecho que se guardó.
   ================================================================== */

/* Los mensajes que escriben nuestros candados (supabase/*.sql) ya están en castellano y dicen qué pasó: se muestran tal cual.
   Cualquier otro (el «new row violates row-level security policy» de Postgres) no le dice nada a nadie. */
const DE_UN_CANDADO = /^(Este cobro|Ese cobro|Un pago de la pasarela|Esta venta|Tu tipo de cuenta)/;

/** El motivo para mostrar, si la base lo dijo en castellano. */
export function motivoDeLaBase(mensaje?: string | null): string | undefined {
  const m = (mensaje ?? "").trim();
  return DE_UN_CANDADO.test(m) ? m : undefined;
}

const SIN_MOTIVO = "tu tipo de cuenta no puede guardarla";
const TOPE = 200;
const rechazos = new Map<string, string>();

/** Anota que la base rechazó esas filas. Guarda las últimas 200. */
export function anotarRechazo(tabla: string, ids: readonly (string | undefined)[], motivo?: string): void {
  for (const id of ids) {
    if (!id) continue;
    rechazos.delete(`${tabla}:${id}`);
    rechazos.set(`${tabla}:${id}`, motivo ?? SIN_MOTIVO);
  }
  while (rechazos.size > TOPE) rechazos.delete(rechazos.keys().next().value as string);
}

/** Por qué la base rechazó esa fila, o null si no la rechazó. */
export function rechazoDe(tabla: string, id: string): string | null {
  return rechazos.get(`${tabla}:${id}`) ?? null;
}

/** Si se vuelve a guardar y entra, deja de estar rechazada. */
export function olvidarRechazo(tabla: string, ids: readonly (string | undefined)[]): void {
  for (const id of ids) if (id) rechazos.delete(`${tabla}:${id}`);
}

/** Cómo se le dice a quien cargó una venta que la base no la guardó. */
export function avisoDeVentaRechazada(nombre: string, motivo: string): string {
  const porque = motivo.replace(/\.$/, "");
  return `La venta de ${nombre} NO se guardó y no se mandó nada: ${porque.charAt(0).toLowerCase()}${porque.slice(1)}. Avisale a un dueño antes de volver a cargarla.`;
}
