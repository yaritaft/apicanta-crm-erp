import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarMovimientos, nubeServidor, referenciasCompletas } from "./servidor";
import { hayClaves, listar, procesadorDe, type MovimientoApi } from "./pasarelas-api";
import { nombrePasarela } from "./pasarelas";
import { diaDeNegocio } from "./dia-negocio";
import { avisosDeCaida, hayQueAvisar, siguienteEstado, type EstadoPasarela, type Revision } from "./pasarelas-estado";
import type { ProveedorPasarela } from "./types";

/* ==================================================================
   Traer los cobros nuevos de una o más pasarelas AHORA y dejar anotado
   cuándo se revisó cada una (lib/pasarelas-estado.ts).

   Lo usan el cron de cada 5 minutos (Whop y Hotmart, que no avisan por
   webhook: antes un cobro tardaba hasta una hora en aparecer) y el botón
   «Buscar pagos nuevos» del selector de pagos. Mira sólo los últimos días
   (pocos pedidos a la pasarela) y guarda sin pisar lo que ya estaba: lo
   conciliado sigue conciliado. Lo devuelto, los pases entre cuentas y el
   banco siguen en el cron completo de cada hora (api/pasarelas/sync).
   ================================================================== */

/** Lo que dejó una revisión, sin datos de clientes: cuántos entraron y cómo quedó la pasarela. */
export interface ResultadoAlDia {
  proveedor: ProveedorPasarela;
  ok: boolean;
  nuevos: number;
  error?: string;
  estado: EstadoPasarela | null;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

/** La fecha del cobro más nuevo de una lista (para «último cobro»). */
export function cobroMasNuevo(cobros: Pick<MovimientoApi, "fecha">[]): string | undefined {
  const t = cobros.reduce((m, x) => Math.max(m, Date.parse(x.fecha) || 0), 0);
  return t > 0 ? new Date(t).toISOString() : undefined;
}

export async function leerEstado(db: SupabaseClient, proveedor: ProveedorPasarela): Promise<EstadoPasarela | null> {
  const r = await db.from("pasarelas_estado").select("*").eq("proveedor", proveedor).maybeSingle();
  return r.error ? null : ((r.data ?? null) as EstadoPasarela | null);
}

/** Anota una revisión y, si la pasarela lleva más de una hora fallando seguido, les avisa a los dueños por la campanita. Nunca rompe a
 *  quien la llama: sin la tabla todavía (no se corrió supabase/pasarelas-estado.sql), no hace nada. */
export async function anotarRevision(db: SupabaseClient, proveedor: ProveedorPasarela, r: Revision, ahora = Date.now()): Promise<EstadoPasarela | null> {
  try {
    const previo = await db.from("pasarelas_estado").select("*").eq("proveedor", proveedor).maybeSingle();
    if (previo.error) return null;
    const est = siguienteEstado((previo.data ?? null) as EstadoPasarela | null, proveedor, r, ahora);
    const u = await db.from("pasarelas_estado").upsert(est, { onConflict: "proveedor" });
    if (u.error) { console.error(`[pasarelas] no se pudo anotar la revisión de ${proveedor}:`, u.error.message); return null; }
    if (hayQueAvisar(est, ahora)) {
      const duenos = await db.from("usuarios_permitidos").select("email").eq("rol", "dueno");
      const mails = ((duenos.data ?? []) as { email?: string | null }[]).map((x) => x.email ?? "");
      const filas = avisosDeCaida(est, nombrePasarela(proveedor), mails, diaDeNegocio(new Date(ahora).toISOString()).replace(/-/g, ""), hash);
      if (filas.length) {
        const g = await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
        if (g.error) console.error(`[pasarelas] no se pudo avisar la caída de ${proveedor}:`, g.error.message);
      }
    }
    return est;
  } catch (err) {
    console.error(`[pasarelas] no se pudo anotar la revisión de ${proveedor}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Pregunta a cada pasarela por los cobros de los últimos `dias`, guarda los nuevos y anota la revisión. Las pasarelas sin claves se saltean. */
export async function traerCobrosAhora(
  proveedores: ProveedorPasarela[], o: { dias: number; fuente: Revision["fuente"] },
): Promise<ResultadoAlDia[]> {
  const db = nubeServidor();
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - o.dias * 86400_000);
  const conClaves = proveedores.filter((p) => hayClaves(p));
  return Promise.all(conClaves.map(async (proveedor): Promise<ResultadoAlDia> => {
    let ok = true;
    let error: string | undefined;
    let nuevos = 0;
    let ultimoCobro: string | undefined;
    try {
      /* Whop manda quién pagó y la comisión en el detalle de cada pago: se pide sólo para los que en la base están incompletos. */
      const completos = proveedor === "whop" ? await referenciasCompletas("whop") : null;
      const cobros = await listar(proveedor, desde, hasta, {
        avisos: [], revisionRapida: true,
        necesitaDetalle: completos ? (m) => !completos.has(m.referencia) : undefined,
      });
      ultimoCobro = cobroMasNuevo(cobros);
      const g = await guardarMovimientos(cobros.map((m) => ({ ...m, procesadorId: procesadorDe(m.proveedor), origen: "api" })));
      nuevos = g.guardados;
      if (g.error) { ok = false; error = `Se trajeron los cobros pero no se pudieron guardar: ${g.error}`; }
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : "Error desconocido.";
    }
    const estado = db ? await anotarRevision(db, proveedor, { ok, error, ultimoCobro, nuevos, fuente: o.fuente }) : null;
    return { proveedor, ok, nuevos, error, estado };
  }));
}
