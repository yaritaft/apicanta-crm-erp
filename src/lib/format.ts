import type { Moneda } from "./types";

/* Formato argentino: punto para miles, coma para decimales. */

export function num(n: number, decimales = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

export function money(n: number, moneda: Moneda = "USD", decimales = 0): string {
  if (!Number.isFinite(n)) return "—";
  const signo = n < 0 ? "−" : "";
  const prefijo = moneda === "USD" ? "US$" : "$";
  return `${signo}${prefijo} ${num(Math.abs(n), decimales)}`;
}

export function pct(n: number, decimales = 1): string {
  if (!Number.isFinite(n)) return "—";
  const signo = n < 0 ? "−" : "";
  return `${signo}${num(Math.abs(n), decimales)}%`;
}

export function delta(n: number, decimales = 1): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0%";
  return `${n > 0 ? "+" : "−"}${num(Math.abs(n), decimales)}%`;
}

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export function fecha(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function fechaLarga(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export function fechaHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fecha(iso)} · ${hh}:${mm}`;
}

export function hora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function relativo(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (Math.abs(min) < 1) return "recién";
  if (min > 0) {
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const dias = Math.round(h / 24);
    if (dias === 1) return "ayer";
    if (dias < 30) return `hace ${dias} días`;
    const meses = Math.round(dias / 30);
    return meses === 1 ? "hace 1 mes" : `hace ${meses} meses`;
  }
  const a = Math.abs(min);
  if (a < 60) return `en ${a} min`;
  const h = Math.round(a / 60);
  if (h < 24) return `en ${h} h`;
  const dias = Math.round(h / 24);
  return dias === 1 ? "mañana" : `en ${dias} días`;
}

/* ISO date (yyyy-mm-dd) para inputs type="date" */
export function isoDia(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ISO datetime-local para inputs type="datetime-local" */
export function isoMinuto(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${isoDia(iso)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}

export function mesClave(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function nombreMes(clave: string): string {
  const [a, m] = clave.split("-").map(Number);
  return `${MESES[m - 1]} ${String(a).slice(2)}`;
}

export function mismaSemana(a: string | Date, b: string | Date): boolean {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return inicioSemana(da).getTime() === inicioSemana(db).getTime();
}

export function inicioSemana(d: Date): Date {
  const x = new Date(d);
  const dia = (x.getDay() + 6) % 7; // lunes = 0
  x.setDate(x.getDate() - dia);
  x.setHours(0, 0, 0, 0);
  return x;
}
