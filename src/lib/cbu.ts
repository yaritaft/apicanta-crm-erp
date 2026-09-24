/* ==================================================================
   CBU y CVU: 22 dígitos con dos dígitos verificadores (el 8.º y el
   22.º), así un número mal copiado del comprobante se ve antes de
   guardarlo. Un CVU (billetera virtual) empieza con 000.
   ================================================================== */

const soloDigitos = (texto: string) => texto.replace(/[\s.-]/g, "");

function verificador(digitos: string, pesos: number[]): number {
  const suma = pesos.reduce((a, p, i) => a + p * Number(digitos[i]), 0);
  return (10 - (suma % 10)) % 10;
}

export function validarCbu(texto: string): boolean {
  const d = soloDigitos(texto);
  if (!/^\d{22}$/.test(d)) return false;
  return verificador(d.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]) === Number(d[7])
    && verificador(d.slice(8, 21), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) === Number(d[21]);
}

const BANCOS: Record<string, string> = {
  "007": "Galicia", "011": "Nación", "014": "Provincia", "015": "ICBC", "017": "BBVA",
  "027": "Supervielle", "029": "Ciudad", "034": "Patagonia", "044": "Hipotecario",
  "072": "Santander", "150": "HSBC", "191": "Credicoop", "285": "Macro",
};

export function bancoDeCbu(texto: string): string {
  const d = soloDigitos(texto);
  if (!/^\d{22}$/.test(d)) return "";
  if (d.startsWith("000")) return "Billetera virtual";
  return BANCOS[d.slice(0, 3)] ?? "";
}
