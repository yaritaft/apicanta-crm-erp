import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import { sinAdornos, type PersonaTelegram } from "@/lib/telegram-identidades";

/* ==================================================================
   Lo que comparten las pantallas de «Quién es quién en Telegram»: la
   ficha del alumno (Accesos → Telegram) y Ajustes → Contratos y accesos.
   Las cuentas se leen directo de la base con la sesión de quien mira (las
   ve quien ve Alumnos); lo que escribe va por /api/telegram/identidades.
   ================================================================== */

export async function pedirIdentidades(cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch("/api/telegram/identidades", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

/** De dónde salen las cuentas. Se puede cambiar para mirar las pantallas con datos de ejemplo (sin base). */
export const origen = {
  cuentasDelAlumno: (alumnoId: string): Promise<PersonaTelegram[]> => cuentasDelAlumno(alumnoId),
  cuentasSueltas: (): Promise<PersonaTelegram[]> => cuentasSueltas(),
};

/** Las cuentas de Telegram atadas a un alumno. */
async function cuentasDelAlumno(alumnoId: string): Promise<PersonaTelegram[]> {
  if (!nube) return [];
  const r = await nube.from("telegram_personas").select("*").eq("alumnoId", alumnoId);
  return r.error ? [] : ((r.data ?? []) as PersonaTelegram[]);
}

/** Las cuentas que el bot vio y todavía no sabe de quién son (sin las del equipo), la más reciente primero. */
async function cuentasSueltas(): Promise<PersonaTelegram[]> {
  if (!nube) return [];
  const r = await nube.from("telegram_personas").select("*").is("alumnoId", null).eq("equipo", false).order("ultimoVisto", { ascending: false }).limit(2000);
  return r.error ? [] : ((r.data ?? []) as PersonaTelegram[]);
}

/** ¿Esta cuenta coincide con lo que se busca? Por nombre, @usuario, id o los dígitos de su número. */
export function coincideBusqueda(p: PersonaTelegram, busqueda: string): boolean {
  const q = sinAdornos(busqueda).replace(/^@/, "");
  if (!q) return true;
  const digitos = busqueda.replace(/\D/g, "");
  return sinAdornos(`${p.nombre} ${p.usuario ?? ""}`).includes(q) || p.id === busqueda.trim() || (digitos.length >= 4 && (p.telefono ?? "").includes(digitos));
}

/** El final de su número, para reconocerla sin mostrarlo entero. */
export const finDeTelefono = (p: Pick<PersonaTelegram, "telefono">): string | null => (p.telefono && p.telefono.length >= 4 ? `…${p.telefono.slice(-4)}` : null);

/** Cuántos grupos tiene la cuenta adentro, en texto. */
export function enCuantosGrupos(p: Pick<PersonaTelegram, "grupos">): string {
  const n = Object.keys(p.grupos ?? {}).length;
  return n === 0 ? "no se la ve en ningún grupo" : n === 1 ? "está en 1 grupo" : `está en ${n} grupos`;
}
