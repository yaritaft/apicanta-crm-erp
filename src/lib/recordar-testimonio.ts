"use client";

import { nube } from "@/lib/supabase";

/* «Recordar» un testimonio sin completar (Lili, 19/11: «ya no sé de qué manera recordar que me lo completen»). Lo hace la base
   (supabase/testimonio-completo.sql, recordar_testimonio): le escribe un aviso en la campanita a quien grabó y a quien lo sigue
   (Santi si grabó un closer, Manu si grabó Yari), con lo que falta y cuántos días pasaron. Uno por testimonio y por día. */

export interface ResultadoRecordatorio {
  /* Los nombres de a quienes les llegó el aviso (los de hoy). */
  avisados: string[];
  /* Ya se había recordado hoy: no se manda otro. */
  yaHoy: boolean;
}

async function mandar(funcion: "recordar_testimonio" | "recordar_resell", parametro: Record<string, string>): Promise<ResultadoRecordatorio> {
  if (!nube) throw new Error("Los recordatorios salen por la nube: acá, sin conexión, no se pueden mandar.");
  const r = await nube.rpc(funcion, parametro);
  if (r.error) throw new Error(r.error.message);
  const d = (r.data ?? {}) as Partial<ResultadoRecordatorio>;
  return { avisados: Array.isArray(d.avisados) ? d.avisados : [], yaHoy: Boolean(d.yaHoy) };
}

export const recordarTestimonio = (testimonioId: string) => mandar("recordar_testimonio", { p_testimonio: testimonioId });

/** Lo mismo para una llamada de resell que ya pasó y no dice en qué quedó (supabase/resell-recordar.sql): le llega a quien la tomó y a quien lo sigue. */
export const recordarResell = (resellId: string) => mandar("recordar_resell", { p_resell: resellId });
