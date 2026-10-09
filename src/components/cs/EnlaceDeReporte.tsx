"use client";

import React, { useState } from "react";
import { Copy, Mail } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { nube } from "@/lib/supabase";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";

/* ==================================================================
   El link del reporte semanal de un cliente (reunión del 07/10): «no te llegó
   el mail» se resuelve copiando un mensaje y pegándolo en su WhatsApp, o
   mandándole el aviso por mail desde acá. El link es siempre el mismo
   (/reporte) y cada alumno entra con su código (un UUID).
   Las rutas están en app/api/reportes/{enlace,avisar}.
   ================================================================== */

async function pedir(ruta: string, cuerpo: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const sesion = nube ? (await nube.auth.getSession()).data.session : null;
  const r = await fetch(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(sesion ? { Authorization: `Bearer ${sesion.access_token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return { ok: r.ok, status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

export function EnlaceDeReporte({ alumnoId, email }: { alumnoId: string; email: string }) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const [ocupado, setOcupado] = useState<"copiar" | "mail" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!nube) {
    return <p className="t-sm t-subtle" style={{ margin: 0 }}>El link de reporte con código necesita la nube: acá, en la demo, no se genera.</p>;
  }
  if (!puedeEditar(acceso, "alumnos")) return null;

  const copiar = async () => {
    setOcupado("copiar");
    try {
      const r = await pedir("/api/reportes/enlace", { alumnoId });
      if (!r.ok) { toast(String(r.json.error ?? "No se pudo armar el link."), "err"); return; }
      await navigator.clipboard.writeText(String(r.json.mensaje ?? r.json.enlace ?? ""));
      toast("Copiado: pegalo en su WhatsApp. El mensaje trae su link y su código.", "ok");
    } catch {
      toast("No se pudo copiar. Probá de nuevo.", "err");
    } finally { setOcupado(null); }
  };

  const mandar = async () => {
    setOcupado("mail");
    try {
      const r = await pedir("/api/reportes/avisar", { alumnoIds: [alumnoId], accion: "enviar" });
      if (!r.ok) { toast(String(r.json.error ?? "No se pudo mandar el aviso."), "err"); return; }
      const res = (r.json.resultados as { ok: boolean; error?: string }[] | undefined)?.[0];
      if (res && !res.ok) { toast(res.error ?? "No se pudo mandar el aviso.", "err"); return; }
      setAviso(`Aviso enviado a ${email}.`);
      toast("Aviso enviado por mail.", "ok");
    } catch {
      toast("No se pudo mandar el aviso. Probá de nuevo.", "err");
    } finally { setOcupado(null); }
  };

  return (
    <div className="stack-2" style={{ marginTop: 8 }}>
      <div className="row-wrap">
        <Button icono={<Copy size={14} aria-hidden />} onClick={copiar} cargando={ocupado === "copiar"} sm>Copiar mensaje con su link</Button>
        <Button icono={<Mail size={14} aria-hidden />} onClick={mandar} cargando={ocupado === "mail"} disabled={!email.trim()} sm>Mandar aviso por mail</Button>
      </div>
      <span className="t-sm t-subtle">
        {aviso ?? "El link es siempre el mismo y cada alumno entra con su código: el mensaje ya lo trae. Si no le llegó el mail, pegale el mensaje en su WhatsApp."}
      </span>
    </div>
  );
}
