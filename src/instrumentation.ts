/* Corre una vez al arrancar el servidor (y cada función de Vercel): lo mismo que en el navegador, el software en hora de Argentina. */
export async function register() {
  const { instalarHoraArgentina } = await import("@/lib/hora-argentina");
  instalarHoraArgentina();
}
