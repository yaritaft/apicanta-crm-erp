/* La app corta los meses con la hora del navegador, que acá es la de Argentina (UTC-3, sin horario de verano).
   Se fija antes de cargar nada para que las pruebas den lo mismo en cualquier máquina. */
process.env.TZ = "America/Argentina/Buenos_Aires";
export {};
