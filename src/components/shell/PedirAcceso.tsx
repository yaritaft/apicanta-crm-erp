"use client";

import React, { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { Button, Input } from "@/components/ui/ui";
import { pedirAcceso, type PedidoDeAcceso } from "@/lib/pedir-acceso";

/* «Pedir acceso» (Juan Cruz, 26/10): en la pantalla que no se ve y en el aviso «esta pantalla es para mirar». El
   pedido le llega a cada dueño en la campanita (lib/pedir-acceso.ts). Cuando se lo dan, la app lee el tipo de cuenta
   al entrar: hay que recargar la página para verlo. */

type Fase = "listo" | "escribiendo" | "mandando" | "hecho";

function useEnvio(pedido: Omit<PedidoDeAcceso, "mensaje">) {
  const [fase, setFase] = useState<Fase>("listo");
  const [error, setError] = useState("");
  const mandar = async (mensaje?: string) => {
    setFase("mandando"); setError("");
    const r = await pedirAcceso({ ...pedido, mensaje });
    if (r.ok) setFase("hecho");
    else { setError(r.error); setFase(mensaje === undefined ? "listo" : "escribiendo"); }
  };
  return { fase, setFase, error, mandar };
}

/** En la pantalla bloqueada: el botón, y un renglón opcional para decir para qué lo necesita. */
export function PedirAccesoPantalla({ pedido }: { pedido: Omit<PedidoDeAcceso, "mensaje"> }) {
  const { fase, setFase, error, mandar } = useEnvio(pedido);
  const [mensaje, setMensaje] = useState("");

  if (fase === "hecho") {
    return (
      <p className="t-sm" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }}>
        <Check size={16} aria-hidden /> Listo: les avisé a los dueños. Cuando te lo den, recargá la página.
      </p>
    );
  }
  if (fase === "listo") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <Button variante="brand" icono={<BellRing size={16} />} onClick={() => setFase("escribiendo")}>Pedir acceso</Button>
        {error && <span className="t-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</span>}
      </div>
    );
  }
  return (
    <form
      style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, width: 380, maxWidth: "100%" }}
      onSubmit={(ev) => { ev.preventDefault(); void mandar(mensaje); }}
    >
      <Input
        autoFocus maxLength={240} value={mensaje} aria-label="Para qué lo necesitás (opcional)"
        placeholder="¿Para qué lo necesitás? (opcional)"
        onChange={(ev) => setMensaje(ev.target.value)}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <Button variante="ghost" onClick={() => setFase("listo")} disabled={fase === "mandando"}>Cancelar</Button>
        <Button type="submit" variante="brand" icono={<BellRing size={16} />} cargando={fase === "mandando"}>Mandar pedido</Button>
      </div>
      {error && <span className="t-sm" role="alert" style={{ color: "var(--danger)", textAlign: "center" }}>{error}</span>}
    </form>
  );
}

/** En el aviso de «esta pantalla es para mirar»: un solo clic, sin mensaje. */
export function PedirPermisoParaEditar({ pedido }: { pedido: Omit<PedidoDeAcceso, "mensaje" | "quiere"> }) {
  const { fase, error, mandar } = useEnvio({ ...pedido, quiere: "editar" });
  if (fase === "hecho") return <span className="t-sm" role="status" style={{ marginLeft: "auto" }}><Check size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Pedido enviado a los dueños</span>;
  return (
    <>
      {error && <span className="t-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</span>}
      <button type="button" className="link" disabled={fase === "mandando"} onClick={() => void mandar("")}>
        {fase === "mandando" ? "Mandando…" : "Pedir permiso para editar"}
      </button>
    </>
  );
}
