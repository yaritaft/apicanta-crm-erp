/* LA TABLA DE EMOJIS DEL CHAT, con palabras para buscar. Traída tal cual de Blue OS (lib/emojis.ts y lib/emojis-datos.ts,
   20/10/2026): la usa el chat del equipo de la ficha para reaccionar.


   Marcos (15 sep 2026), con la foto del menú de 8 emojis de «Más reacciones»: «tendría que salir
   toda la tabla de emojis», y con la del selector del campo de escribir: «acá también y buscador
   de emojis». Sin librería (el kit no suma dependencias y no hay datos de emojis instalados): la
   tabla va a mano, agrupada como la del teclado del celular, y cada emoji con las palabras con
   las que alguien lo buscaría en español. Se busca sin tildes ni mayúsculas (`normalizarEmoji`).

   Formato compacto a propósito: «emoji palabra palabra…» por renglón.

   📚 LA TABLA COMPLETA (Marcos, 17 sep 2026: buscaba «🗿» y decía «No hay emojis»). Eran 505 a mano;
   ahora son TODOS los de Unicode que la Mac sabe dibujar (1.904), generados en `lib/emojis-datos.ts`
   por `scripts/gen-emojis.mjs`, que conserva las palabras a mano (`scripts/emojis/palabras-a-mano.json`)
   y suma el nombre en español del sistema y el de Unicode en inglés («moai»). */

import { DATOS_EMOJIS } from "./emojis-datos";

export type GrupoEmojis = { rot: string; lista: { e: string; palabras: string }[] };

const G = (rot: string, filas: string): GrupoEmojis => ({
  rot,
  lista: filas.trim().split("\n").map((f) => {
    const t = f.trim();
    const i = t.indexOf(" ");
    return i < 0 ? { e: t, palabras: "" } : { e: t.slice(0, i), palabras: t.slice(i + 1) };
  }),
});

export const GRUPOS_EMOJIS: GrupoEmojis[] = DATOS_EMOJIS.map(([rot, filas]) => G(rot, filas));

/** Sin tildes, sin mayúsculas y sin espacios de más: «Corazón» encuentra «corazon». */
export function normalizarEmoji(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Los grupos filtrados por lo que se escribió (vacío = todos). Cada palabra escrita tiene que
    aparecer en las palabras del emoji: «corazon rojo» encuentra ❤️ y no 💙. */
export function buscarEmojis(q: string): GrupoEmojis[] {
  const partes = normalizarEmoji(q).split(/\s+/).filter(Boolean);
  if (partes.length === 0) return GRUPOS_EMOJIS;
  /* 📋 PEGAR UN EMOJI ENCUENTRA ESE EMOJI (17 sep 2026): «🗿» no es una palabra, así que antes no
     coincidía con nada. Una parte con dibujo se compara contra el emoji mismo, sin el selector de
     variante (U+FE0F) ni el tono de piel: «👍🏽» encuentra 👍. */
  const esDibujo = (w: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(w);
  /* Varios pegados juntos («🗿👍») se separan por carácter visible: encuentra cualquiera de ellos. */
  const segmentos = (w: string) => (typeof Intl !== "undefined" && "Segmenter" in Intl
    ? [...new Intl.Segmenter("es", { granularity: "grapheme" }).segment(w)].map((x) => x.segment)
    : [w]);
  const conDibujo = partes.filter(esDibujo).flatMap(segmentos).filter(esDibujo).map(claveEmoji);
  const palabras = partes.filter((w) => !esDibujo(w));
  return GRUPOS_EMOJIS
    .map((g) => ({ rot: g.rot, lista: g.lista.filter((x) => {
      if (conDibujo.length && !conDibujo.includes(claveEmoji(x.e))) return false;
      const p = normalizarEmoji(`${x.palabras} ${g.rot}`);
      return palabras.every((w) => p.includes(w));
    }) }))
    .filter((g) => g.lista.length > 0);
}

/** Un emoji sin selector de variante ni tono de piel, para comparar lo pegado con la tabla. */
function claveEmoji(e: string): string {
  return e.replace(/[\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "");
}
