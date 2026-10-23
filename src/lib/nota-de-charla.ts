/* La nota de una charla de seguimiento (components/ficha/NotaDeCharla.tsx): qué fue, lo que hablaron y a quién del
   equipo avisarle, como un mensaje del chat de la ficha. Las menciones van al final como «@Nombre Apellido»: es lo que
   lee la base para dejarle el aviso a cada uno (supabase/avisos.sql). */

export const TIPOS_DE_NOTA = ["Charla", "Queja", "Sugerencia", "Agradecimiento", "Otro"] as const;
export type TipoDeNota = (typeof TIPOS_DE_NOTA)[number];

export function textoDeNota(tipo: TipoDeNota, texto: string, avisarA: readonly string[]): string {
  const cuerpo = texto.trim();
  const cabeza = `📞 ${tipo} de seguimiento${cuerpo ? `: ${cuerpo}` : ""}`;
  const menciones = [...new Set(avisarA.map((n) => n.trim()).filter(Boolean))].map((n) => `@${n}`).join(" ");
  return menciones ? `${cabeza}\n${menciones}` : cabeza;
}
