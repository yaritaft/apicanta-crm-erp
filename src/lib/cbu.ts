/* ==================================================================
   CBU y CVU: los 22 números que identifican una cuenta en Argentina.

   Van en dos bloques, cada uno con su dígito verificador al final:
   el primero (8) es el banco (3), la sucursal (4) y el verificador;
   el segundo (14) es la cuenta (13) y su verificador. El CVU de una
   billetera virtual tiene la misma forma, con "000" donde va el banco.

   Con los tres primeros números se sabe de qué banco transfirió el
   cliente: es lo que la Financiera mira para encontrar la plata.
   ================================================================== */

const PESOS_BLOQUE_1 = [7, 1, 3, 9, 7, 1, 3];
const PESOS_BLOQUE_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];

/* Por el código de entidad del BCRA (los tres primeros números). Sólo los
   que se sabe seguro: un banco equivocado en el reporte confunde más que
   una celda vacía. */
const BANCOS: Record<string, string> = {
  "007": "Galicia",
  "011": "Nación",
  "014": "Provincia de Buenos Aires",
  "015": "ICBC",
  "017": "BBVA",
  "020": "Bancor (Córdoba)",
  "027": "Supervielle",
  "029": "Ciudad",
  "034": "Patagonia",
  "044": "Hipotecario",
  "045": "Banco de San Juan",
  "065": "Municipal de Rosario",
  "072": "Santander",
  "083": "Banco del Chubut",
  "086": "Banco de Santa Cruz",
  "093": "Banco de La Pampa",
  "094": "Banco de Corrientes",
  "097": "Banco Provincia del Neuquén",
  "143": "Brubank",
  "150": "HSBC",
  "191": "Credicoop",
  "198": "Banco de Valores",
  "268": "Banco de Tierra del Fuego",
  "285": "Macro",
  "299": "Comafi",
  "300": "BICE",
  "301": "Banco Piano",
  "311": "Nuevo Banco del Chaco",
  "315": "Banco de Formosa",
  "321": "Banco de Santiago del Estero",
  "322": "Industrial",
  "330": "Nuevo Banco de Santa Fe",
  "386": "Nuevo Banco de Entre Ríos",
  "389": "Banco Columbia",
};

/** El código de entidad de Banco Macro: la Financiera las marca aparte. */
export const CODIGO_MACRO = "285";

/** Los números del CBU/CVU, sin los espacios ni los guiones con que se pegó. */
export function limpiarCbu(texto: string): string {
  return (texto ?? "").replace(/[\s-]/g, "");
}

function verificador(digitos: string, pesos: number[]): number {
  let suma = 0;
  for (let i = 0; i < pesos.length; i++) suma += Number(digitos[i]) * pesos[i];
  return (10 - (suma % 10)) % 10;
}

/** Si es un CBU o CVU de verdad: 22 números y los dos verificadores bien. */
export function validarCbu(texto: string): boolean {
  const d = limpiarCbu(texto);
  if (!/^\d{22}$/.test(d)) return false;
  return verificador(d.slice(0, 7), PESOS_BLOQUE_1) === Number(d[7])
    && verificador(d.slice(8, 21), PESOS_BLOQUE_2) === Number(d[21]);
}

/** El banco de un CBU por sus tres primeros números, "Billetera virtual"
 *  si es un CVU, o "" si no se sabe. Anda mientras se escribe: no pide
 *  que el CBU esté completo ni que sus verificadores den. */
export function bancoDeCbu(texto: string): string {
  const d = limpiarCbu(texto);
  if (!/^\d{3,22}$/.test(d)) return "";
  if (d.startsWith("000")) return "Billetera virtual";
  return BANCOS[d.slice(0, 3)] ?? "";
}

/** "0070123100000000123459" → "00701231 00000000123459": los dos bloques,
 *  que es como se lee en voz alta. Lo que no es un CBU queda como vino. */
export function formatearCbu(texto: string): string {
  const d = limpiarCbu(texto);
  return /^\d{22}$/.test(d) ? `${d.slice(0, 8)} ${d.slice(8)}` : (texto ?? "").trim();
}
