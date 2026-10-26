"use client";

import "./contrato-ficha.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileSignature, RefreshCw } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { useEstado } from "@/lib/store";
import { accionesDe, contratosAMostrar, estaPendiente, quePasoConElContrato, ROTULO_ESTADO, type Contrato } from "@/lib/contratos";
import { programasDe } from "@/lib/programas";
import type { Persona } from "@/lib/persona";
import { contratosPrendidos, leerContratosDe, pedirContrato } from "./cliente";

/* ==================================================================
   El contrato a la vista en la ficha, en TODAS las solapas (Mariano, 26/10: «creo que le puse enviar contrato, pero me dice que no
   llegó nada. ¿Cómo me doy cuenta si lo hice bien, o si llegó?»). El contrato de Jacob no salió —PandaDoc estaba en su tope— y
   la ficha del closer no decía nada: la tarjeta del contrato vive adentro de la venta y la solapa Servicio no era suya.
   Acá, abajo de la oportunidad: el estado de cada contrato en palabras (no salió / le llegó / lo abrió / firmó), a quién le llegó, y
   «Volver a intentar» al lado del que no salió. Se vuelve a leer solo mientras espera algo y al volver a la ventana.
   ================================================================== */

const REFRESCO_MS = 15_000;
/* Una compra sin contrato se avisa sólo si es reciente: las de antes se firmaron en papel o por otro lado. */
const DIAS_SIN_CONTRATO = 14;

/** Los contratos de una persona (por su lead, su contacto y sus ventas). `refrescar` cambia cuando se cambia de solapa. */
export function useContratosDe(p: Persona | null | undefined, refrescar?: string) {
  const [contratos, setContratos] = useState<Contrato[] | null>(null);
  const leadIds = useMemo(() => (p ? [...new Set([p.clave, p.contacto?.id, ...p.leads.map((l) => l.id)].filter(Boolean) as string[])] : []), [p]);
  const ventaIds = useMemo(() => (p ? p.ventas.map((v) => v.id) : []), [p]);
  const claves = `${leadIds.join(",")}|${ventaIds.join(",")}`;

  const leer = useCallback(async () => {
    if (!claves.replace("|", "")) { setContratos([]); return; }
    setContratos(await leerContratosDe({ leadIds, ventaIds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claves]);
  useEffect(() => { void leer(); }, [leer, refrescar]);

  const hayPendiente = (contratos ?? []).some((c) => estaPendiente(c.estado));
  useEffect(() => {
    if (!hayPendiente) return;
    const t = window.setInterval(() => { if (!document.hidden) void leer(); }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [hayPendiente, leer]);
  useEffect(() => {
    const alVolver = () => { if (!document.hidden) void leer(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [leer]);

  return { contratos, recargar: leer };
}

export function SeccionContrato({ p, contratos, recargar, onVerVentas }: {
  p: Persona; contratos: Contrato[] | null; recargar: () => Promise<void>;
  /* Lleva a la solapa Ventas, donde está la tarjeta completa del contrato (corregir, anular, subir uno firmado…). */
  onVerVentas: () => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const { esDueno } = useAcceso();
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const prendidos = contratosPrendidos(e.ajustes.contratos, esDueno);
  if (contratos === null) return null;

  const lista = contratosAMostrar(contratos);
  /* Una compra reciente sin contrato: el closer tiene que saberlo, no suponerlo. */
  const corte = Date.now() - DIAS_SIN_CONTRATO * 86_400_000;
  const ventaSinContrato = prendidos && contratos.length === 0
    ? p.ventas.find((v) => v.estado === "activa" && new Date(v.fecha).getTime() > corte) : undefined;
  if (lista.length === 0 && !ventaSinContrato) return null;

  const nombreDe = (c: Contrato) => {
    const n = programas.find((x) => x.id === c.programa)?.nombre ?? c.plantillaNombre;
    return c.datos?.reserva ? `Reserva de ${n}` : n;
  };

  async function volverAIntentar(c: Contrato) {
    setTrabajando(c.id);
    try {
      await pedirContrato({ accion: "mandar", id: c.id });
      toast(`Listo: el contrato salió para ${c.destinatario?.email || "su mail"}.`);
    } catch (err) {
      toast(`Sigue sin salir: ${err instanceof Error ? err.message : "no se pudo"}`, "err");
    }
    setTrabajando(null);
    await recargar();
  }

  return (
    <section className="stack-2 ctr-ficha" aria-label="Contrato">
      <div className="t-label">Contrato</div>
      {ventaSinContrato && (
        <div className="ctr-ficha__fila ctr-ficha__fila--aviso">
          <p className="t-sm" style={{ margin: 0 }}>Todavía no se le mandó el contrato.</p>
          <Button sm variante="secondary" icono={<FileSignature size={14} />} onClick={onVerVentas}>Mandarlo desde Ventas</Button>
        </div>
      )}
      {lista.map((c) => {
        const r = ROTULO_ESTADO[c.estado];
        const falla = c.estado === "error";
        return (
          <div key={c.id} className={`ctr-ficha__fila${falla ? " ctr-ficha__fila--error" : ""}`}>
            <div className="row-wrap" style={{ gap: 6, alignItems: "center" }}>
              {falla && <AlertTriangle size={14} aria-hidden style={{ color: "var(--danger)" }} />}
              <Badge variante={r.tono}>{r.texto}</Badge>
              <span className="t-sm t-strong">{nombreDe(c)}</span>
            </div>
            <p className="t-sm t-muted" style={{ margin: 0 }}>{quePasoConElContrato(c)}</p>
            {falla && c.error && <p className="t-sm ctr-ficha__motivo">{c.error}</p>}
            {falla && (
              <div className="row-wrap" style={{ gap: 6 }}>
                {accionesDe(c).includes("mandar") ? (
                  <Button sm variante="primary" icono={<RefreshCw size={14} />} cargando={trabajando === c.id} disabled={!prendidos} onClick={() => void volverAIntentar(c)}>
                    Volver a intentar
                  </Button>
                ) : (
                  <Button sm variante="secondary" icono={<FileSignature size={14} />} onClick={onVerVentas}>Mandarlo de nuevo desde Ventas</Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
