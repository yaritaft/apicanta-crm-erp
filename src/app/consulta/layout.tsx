import type { Metadata } from "next";

/* La consulta de los jueves: pública, pero que no la indexe ningún buscador. */
export const metadata: Metadata = {
  title: "Tu consulta para el jueves — Hackear IT",
  description: "Dejá tu consulta para la clase de los jueves.",
  robots: { index: false, follow: false },
};

export default function LayoutConsulta({ children }: { children: React.ReactNode }) {
  return children;
}
