/* El % del setter en una venta, para escribirlo y leerlo (Venta.comisionSetter, supabase/comision-setter-por-venta.sql).
   Se guarda como fracción (0,025) y se escribe como porcentaje (2,5). */

/** 0,05 → «5%»; 0,025 → «2,5%». */
export const textoDeTasa = (t: number): string =>
  `${(Math.round(t * 10000) / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;

/** Lo escrito → la fracción que se guarda. Vacío: null (el de siempre). Algo que no es un número de 0 a 100: undefined. */
export function tasaDeTexto(texto: string): number | null | undefined {
  if (texto.trim() === "") return null;
  const t = texto.replace("%", "").replace(",", ".").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return n > 100 ? undefined : Math.round(n * 100) / 10000;
}

/** La fracción guardada → lo que se muestra en el cuadro para escribir («2,5»; vacío si no hay propia). */
export const textoParaEditar = (t: number | null | undefined): string =>
  typeof t === "number" && Number.isFinite(t) ? String(Math.round(t * 10000) / 100).replace(".", ",") : "";
