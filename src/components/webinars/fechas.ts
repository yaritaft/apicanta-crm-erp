import { diaDeNegocio, TZ_NEGOCIO } from "@/components/ui/DateRangePicker";

/* ==================================================================
   La fecha de un webinar, en hora de Argentina.

   El vivo es a las 19 de acá, lo mire quien lo mire: alguien del equipo
   que viaja no puede ver "a las 23" y cargar mal la hora. Por eso se lee
   y se escribe siempre en el huso del negocio, y no en el de la máquina.
   ================================================================== */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const fmtHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_NEGOCIO, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const fmtLarga = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ_NEGOCIO, weekday: "long", day: "numeric", month: "long", year: "numeric",
});

/** El día ("2026-09-22") y la hora ("19:00") del vivo, en Argentina. */
export function partesArgentina(iso: string | undefined): { dia: string; hora: string } {
  const d = new Date(iso ?? "");
  if (!iso || Number.isNaN(d.getTime())) return { dia: "", hora: "" };
  return { dia: diaDeNegocio(iso), hora: fmtHora.format(d) };
}

/* Argentina no tiene horario de verano desde 2009: el huso es −03:00 fijo,
   y escribirlo así evita depender de dónde esté el navegador. */
export function isoDesdeArgentina(dia: string, hora: string): string {
  const d = new Date(`${dia}T${hora || "00:00"}:00-03:00`);
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  /* Un 31 de febrero no es un 3 de marzo: si el día no sobrevive a la
     vuelta, la fecha no existe. */
  return partesArgentina(iso).dia === dia ? iso : "";
}

/** "22 sep 2026". */
export function diaCorto(iso: string | undefined): string {
  const { dia } = partesArgentina(iso);
  if (!dia) return "—";
  const [a, m, d] = dia.split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

/** "22 sep 2026 · 19:00". */
export function diaYHora(iso: string | undefined): string {
  const { hora } = partesArgentina(iso);
  const dia = diaCorto(iso);
  return dia === "—" ? dia : `${dia} · ${hora}`;
}

/** "Martes 22 de septiembre de 2026 · 19:00 hs". */
export function fechaCompleta(iso: string | undefined): string {
  const d = new Date(iso ?? "");
  if (!iso || Number.isNaN(d.getTime())) return "Sin fecha";
  const texto = fmtLarga.format(d).replace(",", "");
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)} · ${fmtHora.format(d)} hs`;
}

/** Hoy, como día del negocio. */
export const hoyArgentina = () => diaDeNegocio(new Date().toISOString());

/** Un día del negocio corrido n días ("2026-09-22" + 14). */
export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
