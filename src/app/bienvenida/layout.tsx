import type { Metadata } from "next";

/* La bienvenida es de cada alumno (se entra con su código): que no la indexe ningún buscador. */
export const metadata: Metadata = {
  title: "Bienvenido — Apicanta",
  description: "Tus accesos al programa.",
  robots: { index: false, follow: false },
};

export default function LayoutBienvenida({ children }: { children: React.ReactNode }) {
  return children;
}
