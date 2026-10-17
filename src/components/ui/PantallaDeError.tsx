"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/ui";

/* Lo que se ve cuando una pantalla (o una parte) no se pudo abrir: dice qué pasó en palabras, deja reintentar o recargar,
   y trae el detalle técnico a mano para mandarlo. La usan el error de la app (app/(app)/error.tsx) y LimiteDeError. */
export function PantallaDeError({ titulo, error, onReintentar, compacta = false }: {
  titulo: string;
  error: { message?: string; digest?: string; name?: string };
  onReintentar: () => void;
  compacta?: boolean;
}) {
  const detalle = [error.name && error.name !== "Error" ? error.name : "", error.message ?? "", error.digest ? `(código ${error.digest})` : ""].filter(Boolean).join(": ");
  return (
    <div className="empty" role="alert" style={compacta ? { padding: "var(--space-5)" } : { minHeight: "50vh", justifyContent: "center" }}>
      <span className="empty__ico"><AlertTriangle size={22} aria-hidden /></span>
      <span className="empty__title">{titulo}</span>
      <p className="empty__text">
        Pasa a veces cuando se publicó una versión nueva mientras tenías la app abierta: recargá la página y debería abrir.
        Si sigue igual, mandá el detalle de abajo para que se arregle.
      </p>
      <div className="row-wrap" style={{ justifyContent: "center", marginTop: 4 }}>
        <Button variante="primary" icono={<RefreshCw size={16} />} onClick={() => window.location.reload()}>Recargar la página</Button>
        <Button variante="secondary" onClick={onReintentar}>Reintentar</Button>
      </div>
      {detalle && (
        <details className="t-sm t-subtle" style={{ maxWidth: "60ch", marginTop: 8, textAlign: "left" }}>
          <summary style={{ cursor: "pointer" }}>Detalle técnico</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 6 }}>{detalle}</pre>
        </details>
      )}
    </div>
  );
}
