/* Las solapas de la vista Servicio de la ficha (components/ficha/HojaServicio). También van en la URL (?hoja=cv): quien toca a
   alguien en CVs, Testimonios o una lista del panel abre su ficha justo en esa parte, y el link la reabre igual. Sin ?hoja,
   «Programa». Viven acá, sin React, para que las pruebas las lean. */
export const SOLAPAS_SERVICIO = ["programa", "contrato", "accesos", "datos", "seguimiento", "testimonio", "cv", "reportes", "historial", "chat"] as const;
export type SolapaServicio = (typeof SOLAPAS_SERVICIO)[number];
export const esSolapaServicio = (x: string | null | undefined): x is SolapaServicio => (SOLAPAS_SERVICIO as readonly string[]).includes(x ?? "");
