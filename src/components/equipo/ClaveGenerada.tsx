"use client";

import React from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/* La clave recién generada, lista para mandar. Se ve una sola vez: no
   queda guardada en la app. Si se pierde, se genera otra. */
export function ClaveGenerada({ nombre, email, clave, onCerrar }: {
  nombre: string; email: string; clave: string; onCerrar: () => void;
}) {
  const toast = useToast();
  const sitio = typeof window !== "undefined" ? window.location.origin : "";
  const mensaje = [
    `Hola ${nombre.split(" ")[0] || ""}, ya tenés acceso a Apicanta.`,
    `Entrá en ${sitio} con:`,
    `Correo: ${email}`,
    `Clave: ${clave}`,
  ].join("\n");

  const copiar = async (texto: string, aviso: string) => {
    try { await navigator.clipboard.writeText(texto); toast(aviso); }
    catch { toast("No pude copiar. Seleccioná el texto y copialo a mano.", "err"); }
  };

  return (
    <Modal
      abierto onCerrar={onCerrar} titulo={`Acceso de ${nombre || email}`}
      sub="La clave se muestra una sola vez. Si se pierde, se genera otra y la de antes deja de andar."
      pie={
        <>
          <Button variante="ghost" onClick={onCerrar}>Listo</Button>
          <span className="spacer" />
          <Button variante="primary" icono={<Copy size={16} />} onClick={() => copiar(mensaje, "Mensaje copiado: pegáselo por WhatsApp.")}>
            Copiar el mensaje
          </Button>
        </>
      }
    >
      <div className="stack-3">
        <dl className="dl">
          <dt>Correo</dt><dd>{email}</dd>
          <dt>Clave</dt>
          <dd>
            <code className="clave-generada">{clave}</code>{" "}
            <button type="button" className="link t-sm" onClick={() => copiar(clave, "Clave copiada.")}>Copiar</button>
          </dd>
        </dl>
        <pre className="clave-mensaje">{mensaje}</pre>
      </div>
    </Modal>
  );
}
