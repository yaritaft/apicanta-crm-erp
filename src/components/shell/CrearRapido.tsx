"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Users, CalendarDays, Video, GraduationCap, Wallet, Megaphone, Target, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

const OPCIONES = [
  { icono: Users, texto: "Lead", ayuda: "Alguien que mostró interés", ir: "/leads?nuevo=1" },
  { icono: CalendarDays, texto: "Sesión", ayuda: "Una llamada agendada", ir: "/agenda?nuevo=1" },
  { icono: Video, texto: "Webinar", ayuda: "Una clase en vivo", ir: "/webinars?nuevo=1" },
  { icono: GraduationCap, texto: "Alumno", ayuda: "Alguien que ya se inscribió", ir: "/alumnos?nuevo=1" },
  { icono: Wallet, texto: "Movimiento", ayuda: "Un ingreso o un gasto", ir: "/finanzas?nuevo=1" },
  { icono: Megaphone, texto: "Campaña", ayuda: "Una campaña de Meta", ir: "/marketing?nuevo=1" },
  { icono: Target, texto: "Meta", ayuda: "Un objetivo del mes", ir: "/metas?nuevo=1" },
];

export function CrearRapido({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const router = useRouter();
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="¿Qué querés crear?" sub="Elegí y te llevo al formulario ya abierto.">
      <div className="stack-2">
        {OPCIONES.map((o) => {
          const Ico = o.icono;
          return (
            <button
              key={o.texto} type="button"
              onClick={() => { onCerrar(); router.push(o.ir); }}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%",
                padding: "12px 14px", background: "var(--surface-200)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                cursor: "pointer", textAlign: "left", transition: "border-color 150ms ease-out",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <span style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10, background: "var(--brand-soft)", color: "var(--brand)", flex: "none" }}>
                <Ico size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, color: "var(--ink)" }}>{o.texto}</span>
                <span className="t-sm t-subtle" style={{ display: "block" }}>{o.ayuda}</span>
              </span>
              <ChevronRight size={18} color="var(--ink-subtle)" />
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
