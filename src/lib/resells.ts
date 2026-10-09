/* ==================================================================
   La agenda de resells de Customer Success, del lado de Calendly.

   Una llamada de «auditoría» o «resell» (el evento al que agenda un alumno para
   renovar) no sólo es una llamada del CRM: también es una fila de la agenda de
   Customer Success (tabla `resells`, supabase/customer-success-lili.sql), que no
   lee las llamadas de venta. La escribe el servidor cuando entra la agenda
   (lib/calendly-sync.ts). Es puro y sin dependencias pesadas, así lo pueden
   usar el webhook, el cron y las pruebas.
   ================================================================== */

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Si una llamada de Calendly es de resell: el evento se llama «auditoría» o «resell», o llegó con el utm_source «Resell». */
export function esLlamadaDeResell(s: { tipo?: string | null; titulo?: string | null; utm?: Record<string, string> | null }): boolean {
  if (/(auditor|resell)/.test(sinTildes(`${s.tipo ?? ""} ${s.titulo ?? ""}`))) return true;
  const src = s.utm?.utm_source ?? s.utm?.source ?? "";
  return /resell/.test(sinTildes(src));
}

/** «rs_<id de la llamada>»: una llamada de Calendly, un resell. */
export const idResell = (sesionId: string) => `rs_${sesionId}`;

/* Lo mínimo que se le pide a la base: sirve la de Supabase y una de mentira en las pruebas. */
interface TablaResells {
  select(columnas: string): { eq(c: string, v: string): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } };
  upsert(fila: Record<string, unknown>, opciones: { defaultToNull: boolean }): PromiseLike<{ error: { message: string } | null }>;
  update(cambios: Record<string, unknown>): { eq(c: string, v: string): PromiseLike<{ error: { message: string } | null }> };
  delete(): { eq(c: string, v: string): PromiseLike<{ error: { message: string } | null }> };
}
export interface BaseDeResells { from(tabla: "resells"): TablaResells }

export interface AgendaDeResell {
  sesionId: string;
  /* Inicio del evento, ISO. */
  fechaHora: string;
  nombre: string;
  email: string;
  telefono: string;
  /* El anfitrión de Calendly (el closer), tal cual. */
  closer: string;
  cancelada: boolean;
  /* La llamada que reprogramó esta, si la hay: su fila de resell le pasa lo que Customer Success cargó. */
  reprogramadaDe?: string;
  ahora: string;
}

/** Lo que Customer Success lleva en cada resell: no lo escribe Calendly nunca, y una reprogramación lo hereda. */
const DE_CUSTOMER_SUCCESS = ["estado", "cashCollect", "casoDeExito", "notas"] as const;

/**
 * Guarda la agenda de un resell. Sólo escribe lo que viene de Calendly (cuándo, quién, el contacto y si se canceló): lo que
 * cargó Customer Success (estado, cash collect, caso de éxito, notas) no se toca, porque el upsert de una sola fila con las
 * columnas que se mandan deja las demás como están.
 *
 * - Una agenda activa se crea o se actualiza (si el alumno la mueve, cambia la hora).
 * - Una cancelada sólo actualiza la que ya existe: no crea una fila de «Cancelada» de algo que nunca se vio activo ni resucita la
 *   que se borró al heredarse.
 * - Una reprogramación (la nueva agenda dice cuál reemplaza) hereda lo que Customer Success ya había cargado en la anterior, y la
 *   anterior se borra: queda una sola fila por cita.
 *
 * Nunca falla hacia afuera: si la tabla todavía no existe (falta correr el SQL) o la base rechaza algo, devuelve el motivo y la
 * entrada de la agenda sigue su camino.
 */
export async function registrarResell(db: BaseDeResells, a: AgendaDeResell): Promise<{ hecho: boolean; motivo?: string }> {
  try {
    const t = db.from("resells");
    const id = idResell(a.sesionId);

    if (a.cancelada) {
      const r = await t.update({ cancelada: true, actualizadoEn: a.ahora }).eq("id", id);
      return r.error ? { hecho: false, motivo: r.error.message } : { hecho: true };
    }

    const fila: Record<string, unknown> = {
      id, sesionId: a.sesionId, fechaHora: a.fechaHora, nombre: a.nombre, email: a.email, telefono: a.telefono,
      closer: a.closer, cancelada: false, origen: "calendly", actualizadoEn: a.ahora,
    };

    /* Una reprogramación hereda lo cargado en la anterior (sólo la primera vez que entra la nueva). */
    const viejoId = a.reprogramadaDe ? idResell(a.reprogramadaDe) : undefined;
    if (viejoId && viejoId !== id) {
      const ya = await t.select("id").eq("id", id).limit(1);
      if (!ya.error && (ya.data ?? []).length === 0) {
        const v = await t.select(["id", ...DE_CUSTOMER_SUCCESS].join(",")).eq("id", viejoId).limit(1);
        const vieja = (v.data?.[0] ?? null) as Record<string, unknown> | null;
        if (!v.error && vieja) {
          for (const k of DE_CUSTOMER_SUCCESS) if (vieja[k] !== undefined && vieja[k] !== null) fila[k] = vieja[k];
          const r = await t.upsert(fila, { defaultToNull: false });
          if (r.error) return { hecho: false, motivo: r.error.message };
          await t.delete().eq("id", viejoId);
          return { hecho: true };
        }
      }
    }

    const r = await t.upsert(fila, { defaultToNull: false });
    return r.error ? { hecho: false, motivo: r.error.message } : { hecho: true };
  } catch (e) {
    return { hecho: false, motivo: e instanceof Error ? e.message : "error" };
  }
}
