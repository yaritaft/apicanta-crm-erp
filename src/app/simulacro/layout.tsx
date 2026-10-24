import type { Metadata } from "next";

/* La inscripción al simulacro de entrevista: pública, pero que no la indexe ningún buscador. */
export const metadata: Metadata = {
  title: "Simulacro de entrevista — Hackear IT",
  description: "Anotate al simulacro de entrevista del martes.",
  robots: { index: false, follow: false },
};

export default function LayoutSimulacro({ children }: { children: React.ReactNode }) {
  return children;
}
