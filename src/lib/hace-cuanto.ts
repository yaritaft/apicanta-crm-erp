/** «hace 3 horas», «hace 1 día», «hace 2 días»: lo que lleva esperando algo, en la voz de la pantalla. */
export function haceCuanto(horas: number): string {
  if (horas < 1) return "recién";
  if (horas < 24) { const h = Math.floor(horas); return `hace ${h} ${h === 1 ? "hora" : "horas"}`; }
  const d = Math.floor(horas / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
