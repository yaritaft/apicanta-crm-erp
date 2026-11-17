/* ==================================================================
   El país de una persona cuando nadie lo cargó: sale del prefijo de su
   teléfono. Vivía dentro de la tabla del CRM (lib/crm-tabla.ts), y por eso
   el CRM decía «Perú» y la ficha, Clientes y el contrato lo mostraban vacío
   (Aldana, 17/11: «me quedó sin país»). Una sola regla para todos.
   ================================================================== */

/* ---------- El país, por el prefijo del teléfono ----------
   Los de Calendly llegan con el + y el código del país. Sin el +, no se
   adivina. El más largo primero: +1 809 es República Dominicana. */
const PREFIJOS: [string, string][] = ([
  ["1809", "República Dominicana"], ["1829", "República Dominicana"], ["1849", "República Dominicana"],
  ["1787", "Puerto Rico"], ["1939", "Puerto Rico"],
  ["598", "Uruguay"], ["595", "Paraguay"], ["593", "Ecuador"], ["591", "Bolivia"],
  ["507", "Panamá"], ["506", "Costa Rica"], ["505", "Nicaragua"], ["504", "Honduras"], ["503", "El Salvador"], ["502", "Guatemala"],
  ["58", "Venezuela"], ["57", "Colombia"], ["56", "Chile"], ["55", "Brasil"], ["54", "Argentina"], ["53", "Cuba"],
  ["52", "México"], ["51", "Perú"], ["49", "Alemania"], ["44", "Reino Unido"], ["39", "Italia"], ["34", "España"],
  ["33", "Francia"], ["1", "Estados Unidos"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

export const PAISES = [...new Set(PREFIJOS.map(([, pais]) => pais))].sort((a, b) => a.localeCompare(b, "es"));

export function paisDeTelefono(tel?: string | null): string {
  const t = (tel ?? "").trim();
  if (!/^(\+|00)/.test(t)) return "";
  const n = t.replace(/^00/, "").replace(/\D/g, "");
  return PREFIJOS.find(([p]) => n.startsWith(p))?.[1] ?? "";
}

/** El país cargado y, si no hay, el del prefijo del teléfono. */
export function paisCon(cargado?: string | null, telefono?: string | null): string {
  return (cargado ?? "").trim() || paisDeTelefono(telefono);
}
