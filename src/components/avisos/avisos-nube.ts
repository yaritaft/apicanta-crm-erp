"use client";

import { nube } from "@/lib/supabase";
import { AVISOS_A_MOSTRAR, avisarCambioDeAvisos, type Aviso } from "@/lib/avisos";

/* Los avisos desde el navegador: la RLS de supabase/avisos.sql recorta a los de quien entró. */

export async function leerAvisos(): Promise<Aviso[] | null> {
  if (!nube) return null;
  const r = await nube.from("avisos").select("*").order("creadoEn", { ascending: false }).limit(AVISOS_A_MOSTRAR);
  return r.error ? null : ((r.data ?? []) as Aviso[]);
}

export async function marcarLeidos(ids: string[]): Promise<void> {
  if (!nube || ids.length === 0) return;
  await nube.from("avisos").update({ leidoEn: new Date().toISOString() }).in("id", ids).is("leidoEn", null);
  avisarCambioDeAvisos();
}

export async function marcarTodosLeidos(): Promise<void> {
  if (!nube) return;
  await nube.from("avisos").update({ leidoEn: new Date().toISOString() }).is("leidoEn", null);
  avisarCambioDeAvisos();
}

/** Leer el chat de una ficha apaga los avisos de esa ficha (components/ficha/ChatEquipo). */
export async function marcarLeidosDeLaFicha(contactoId: string): Promise<void> {
  if (!nube || !contactoId) return;
  const r = await nube.from("avisos").update({ leidoEn: new Date().toISOString() }).eq("contactoId", contactoId).is("leidoEn", null).select("id");
  if ((r.data?.length ?? 0) > 0) avisarCambioDeAvisos();
}
