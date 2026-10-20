import { nube } from "./supabase";
import type { RespuestaDeSaldos } from "./saldos-reales";

/* El saldo real de las cuentas que se leen solas, pedido al servidor con la sesión de quien mira (lib/saldos-reales.ts).
   `al`: un momento pasado (ISO); sin él, ahora. Sin la nube (la app local) no hay a quién preguntarle. */
export async function traerSaldosReales(al?: string): Promise<RespuestaDeSaldos> {
  if (!nube) throw new Error("Los saldos reales se leen con la app en la nube: acá no hay a quién preguntarle.");
  const sesion = (await nube.auth.getSession()).data.session;
  const r = await fetch(`/api/pasarelas/saldos${al ? `?al=${encodeURIComponent(al)}` : ""}`, {
    headers: sesion ? { Authorization: `Bearer ${sesion.access_token}` } : {}, cache: "no-store",
  });
  const data = (await r.json().catch(() => ({}))) as Partial<RespuestaDeSaldos> & { error?: string };
  if (!r.ok) throw new Error(data.error ?? "No se pudieron leer los saldos.");
  return { saldos: data.saldos ?? [], errores: data.errores ?? [], sinConexion: data.sinConexion ?? [], soloHoy: data.soloHoy ?? [] };
}
