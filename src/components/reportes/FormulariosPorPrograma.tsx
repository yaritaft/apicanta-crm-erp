"use client";

import React, { useMemo, useState } from "react";
import { BellRing, Copy, ExternalLink, Send } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { nube } from "@/lib/supabase";
import {
  ATAJO_DE, CON_RECORDATORIO, DIA_Y_HORA_DEL_RECORDATORIO, FORMULARIOS, formularioQueSeLePide, linkDelPrograma, type IdFormulario,
} from "@/lib/reporte-formularios";
import "./formularios-programa.css";

/* ==================================================================
   El formulario semanal de cada programa, arriba de Formularios de alumnos
   (Lili, 26/10: Manu pidió que el de Hackear Biz deje el Google Form). Antes
   el formulario ya estaba en la app, pero no había dónde ver su link para
   pasarlo ni sabía nadie que la app podía mandarlo: seguía saliendo el
   Google Form. Acá está, por programa: a cuántos alumnos se les pide, el
   link para el grupo (entra directo a las preguntas), si les llega solo los
   lunes y «Mandárselo ahora» a cada uno con su link personal.
   ================================================================== */

const MAX_POR_VEZ = 50;

async function avisar(alumnoIds: string[]): Promise<{ enviados: number; fallaron: number; error?: string }> {
  const sesion = nube ? (await nube.auth.getSession()).data.session : null;
  const r = await fetch("/api/reportes/avisar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(sesion ? { Authorization: `Bearer ${sesion.access_token}` } : {}) },
    body: JSON.stringify({ alumnoIds, accion: "enviar" }),
  });
  const j = (await r.json().catch(() => ({}))) as { enviados?: number; fallaron?: number; error?: string };
  return r.ok ? { enviados: j.enviados ?? 0, fallaron: j.fallaron ?? 0 } : { enviados: 0, fallaron: alumnoIds.length, error: j.error ?? `Error ${r.status}` };
}

export function FormulariosPorPrograma() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puede = Boolean(nube) && puedeEditar(acceso, "alumnos");
  const [mandar, setMandar] = useState<IdFormulario | null>(null);
  const [mandando, setMandando] = useState<IdFormulario | null>(null);

  const porFormulario = useMemo(() => {
    const segs = new Map((e.seguimientos ?? []).map((s) => [s.alumnoId, s] as const));
    const out: Record<IdFormulario, string[]> = { "hackear-biz": [], "hackear-it": [] };
    for (const a of e.alumnos) {
      const id = formularioQueSeLePide(a, segs.get(a.id));
      if (id) out[id].push(a.id);
    }
    return out;
  }, [e.alumnos, e.seguimientos]);

  const copiar = async (id: IdFormulario) => {
    const ok = await copiarTexto(linkDelPrograma(window.location.origin, id));
    toast(ok ? `Link de ${FORMULARIOS[id].programa} copiado: pegalo en el grupo en lugar del Google Form.` : "No se pudo copiar.", ok ? "ok" : "err");
  };

  const confirmar = async () => {
    const id = mandar;
    if (!id) return;
    setMandar(null);
    setMandando(id);
    const ids = porFormulario[id];
    let enviados = 0, fallaron = 0, error: string | undefined;
    for (let i = 0; i < ids.length; i += MAX_POR_VEZ) {
      const r = await avisar(ids.slice(i, i + MAX_POR_VEZ));
      enviados += r.enviados; fallaron += r.fallaron; error ??= r.error;
    }
    setMandando(null);
    toast(error ? `No se pudo mandar: ${error}` : `Le llegó su link por mail a ${enviados}${fallaron ? `; ${fallaron} sin mail válido o con error (miralos en Por alumno)` : ""}.`, error || fallaron ? "err" : "ok");
  };

  return (
    <section className="fpp" aria-label="El formulario semanal de cada programa">
      {(Object.keys(FORMULARIOS) as IdFormulario[]).map((id) => {
        const f = FORMULARIOS[id];
        const n = porFormulario[id].length;
        const solo = CON_RECORDATORIO.includes(id);
        return (
          <article key={id} className="fpp__prog">
            <div className="fpp__cab">
              <span className="fpp__nombre">{f.programa}</span>
              <span className="fpp__n">{n === 1 ? "1 alumno lo completa" : `${n} alumnos lo completan`} · {f.preguntas.length} preguntas</span>
            </div>
            <div className={`fpp__estado${solo ? " fpp__estado--ok" : ""}`}>
              <BellRing size={14} aria-hidden />
              {solo
                ? <span>Les llega solo por mail <b>{DIA_Y_HORA_DEL_RECORDATORIO}</b>, a quien todavía no lo completó</span>
                : <span>Sin recordatorio automático: su formulario es provisorio</span>}
            </div>
            <div className="fpp__acciones">
              <Button sm variante="secondary" icono={<Copy size={14} />} onClick={() => void copiar(id)}>Copiar link para el grupo</Button>
              <a className="hk-btn hk-btn--ghost hk-btn--sm" href={`/reporte?p=${ATAJO_DE[id]}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Ver el formulario</a>
              {puede && n > 0 && (
                <Button sm variante="ghost" icono={<Send size={14} />} cargando={mandando === id} onClick={() => setMandar(id)}>Mandárselo ahora</Button>
              )}
              {solo && <Badge variante="success">Automático</Badge>}
            </div>
          </article>
        );
      })}
      <Confirmar
        abierto={mandar !== null} onCerrar={() => setMandar(null)} confirmarTexto="Mandar"
        titulo={mandar ? `¿Mandarles el formulario de ${FORMULARIOS[mandar].programa}?` : ""}
        texto={mandar ? `A cada uno de los ${porFormulario[mandar].length} alumnos le llega por mail su link personal (entra directo, sin poner sus datos). Lo que contesten queda en su ficha y acá.` : ""}
        onConfirmar={() => void confirmar()}
      />
    </section>
  );
}
