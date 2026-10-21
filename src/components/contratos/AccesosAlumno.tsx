"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, RotateCcw, UserMinus } from "lucide-react";
import { Badge, Button, Field, Select, type VarianteBadge } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import { relativo } from "@/lib/format";
import { programaDeProducto, programasDe } from "@/lib/programas";
import type { Alumno, Venta } from "@/lib/types";
import type { Acceso, EstadoAcceso, Plataforma } from "@/lib/accesos-servidor";
import { contratosPrendidos } from "./cliente";

/* ==================================================================
   Los accesos de un alumno (el Loom de Yari): qué se le dio (cursos de
   Wisboo, grupos de Telegram, reuniones de Zoom), cuándo y cómo quedó.
   - «Dar accesos»: el onboarding a mano (si falló el automático, o un
     upsell: se elige el programa nuevo y se suman sus accesos).
   - «Reintentar» lo que falló, de a uno.
   - «Quitar» uno, o «Quitar todo» (el outboarding, siempre a mano).
   ================================================================== */

const ESTADO: Record<EstadoAcceso, { texto: string; variante: VarianteBadge }> = {
  pendiente: { texto: "Pendiente", variante: "neutral" },
  dado: { texto: "Dado", variante: "info" },
  entro: { texto: "Entró", variante: "success" },
  fallo: { texto: "Con error", variante: "danger" },
  quitado: { texto: "Quitado", variante: "neutral" },
};
const PLATAFORMA: Record<Plataforma, string> = { wisboo: "Wisboo", telegram: "Telegram", zoom: "Zoom" };

async function pedir(cuerpo: Record<string, unknown>) {
  const r = await fetch("/api/accesos-alumnos", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

export function AccesosAlumno({ alumno, venta }: { alumno: Alumno; venta?: Venta }) {
  const e = useEstado();
  const toast = useToast();
  const { esDueno } = useAcceso();
  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const [accesos, setAccesos] = useState<Acceso[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [dar, setDar] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<{ ids?: string[]; texto: string } | null>(null);

  const leer = useCallback(async () => {
    if (!nube) { setAccesos([]); return; }
    const r = await nube.from("accesos_alumno").select("*").eq("alumnoId", alumno.id).order("plataforma");
    setAccesos(r.error ? [] : (r.data ?? []) as Acceso[]);
  }, [alumno.id]);
  useEffect(() => { void leer(); }, [leer]);

  if (!contratosPrendidos(e.ajustes.contratos, esDueno)) return null;
  const lista = accesos ?? [];
  const vigentes = lista.filter((x) => x.estado !== "quitado");
  const linksTelegram = lista.filter((x) => x.plataforma === "telegram" && x.estado === "dado" && typeof x.externo.link === "string");

  async function correr(clave: string, cuerpo: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) {
    setTrabajando(clave);
    try {
      const j = await pedir({ alumnoId: alumno.id, ...cuerpo });
      toast(ok(j));
      if (typeof j.mensaje === "string" && j.mensaje) {
        try { await navigator.clipboard.writeText(j.mensaje); toast("Copié el mensaje de bienvenida con los links: pegáselo por WhatsApp."); } catch { /* sin portapapeles */ }
      }
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
    await leer();
  }

  async function copiarMensaje() {
    const pila = alumno.nombre.trim().split(/\s+/)[0] ?? "";
    const texto = [`¡Hola ${pila}! Estos son tus accesos (cada link de Telegram es personal y se usa una sola vez):`,
      ...linksTelegram.map((x) => `• ${x.recursoNombre}: ${String(x.externo.link)}`)].join("\n");
    try { await navigator.clipboard.writeText(texto); toast("Mensaje con los links copiado."); }
    catch { window.prompt("Copiá el mensaje:", texto); }
  }

  const programaSugerido = programaDeProducto(programas, venta?.productoId)?.id ?? "";
  return (
    <div className="stack-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="t-label">Accesos</span>
        <div className="row-wrap" style={{ gap: 6 }}>
          {linksTelegram.length > 0 && <Button sm variante="ghost" icono={<Copy size={14} />} onClick={() => void copiarMensaje()}>Copiar mensaje con links</Button>}
          <Button sm variante="secondary" icono={<KeyRound size={14} />} onClick={() => setDar(programaSugerido)}>Dar accesos</Button>
          {vigentes.length > 0 && (
            <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom." })}>Quitar todo</Button>
          )}
        </div>
      </div>
      {accesos === null ? <div className="skeleton" style={{ height: 32 }} /> : lista.length === 0 ? (
        <p className="t-sm t-subtle">Todavía no se le dio ningún acceso desde la app.</p>
      ) : (
        <ul className="stack-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {lista.map((x) => (
            <li key={x.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="t-sm"><span className="t-subtle">{PLATAFORMA[x.plataforma]} · </span>{x.recursoNombre || x.recurso}</span>
                {x.error && x.estado === "fallo" && <span className="t-sm" style={{ display: "block", color: "var(--danger)" }}>{x.error}</span>}
                {x.estado !== "fallo" && (x.dadoEn || x.quitadoEn) && (
                  <span className="t-sm t-subtle" style={{ display: "block" }}>
                    {x.estado === "quitado" && x.quitadoEn ? `quitado ${relativo(x.quitadoEn)}` : x.dadoEn ? `dado ${relativo(x.dadoEn)}${x.origen === "manual" ? " a mano" : " al firmar"}` : ""}
                    {x.plataforma === "telegram" && typeof x.externo.telegramUsuario === "string" ? ` · @${x.externo.telegramUsuario}` : ""}
                  </span>
                )}
              </span>
              <Badge variante={ESTADO[x.estado].variante}>{ESTADO[x.estado].texto}</Badge>
              {x.estado === "fallo" && (
                <Button sm variante="ghost" icono={<RotateCcw size={14} />} cargando={trabajando === x.id}
                  onClick={() => void correr(x.id, { accion: "dar", programa: x.programa, solo: [{ plataforma: x.plataforma, recurso: x.recurso }] }, (j) => Number(j.fallaron) ? "Volvió a fallar." : "Listo, acceso dado.")}>
                  Reintentar
                </Button>
              )}
              {(x.estado === "dado" || x.estado === "entro") && (
                <Button sm variante="ghost" onClick={() => setQuitar({ ids: [x.id], texto: `Se le saca «${x.recursoNombre || x.recurso}» (${PLATAFORMA[x.plataforma]}).` })}>Quitar</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {dar !== null && (
        <ModalForm abierto titulo="Dar accesos" onCerrar={() => setDar(null)} guardarTexto={trabajando === "dar" ? "Dando…" : "Dar accesos"}
          sub="Se le dan los cursos de Wisboo, los links a los grupos de Telegram y las reuniones de Zoom del programa. Lo que ya tenía no se repite."
          puedeGuardar={Boolean(dar) && trabajando !== "dar"}
          onGuardar={() => { const programa = dar; setDar(null); void correr("dar", { accion: "dar", programa }, (j) => `Accesos: ${String(j.dados ?? 0)} dados${Number(j.fallaron) ? `, ${String(j.fallaron)} con error` : ""}${Number(j.yaEstaban) ? `, ${String(j.yaEstaban)} ya los tenía` : ""}.`); }}>
          <Field label="Programa" ayuda="Para un upsell, elegí el programa nuevo: se suman sus accesos.">
            <Select value={dar} onChange={(ev) => setDar(ev.target.value)} placeholder="Elegí el programa"
              opciones={programas.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre }))} />
          </Field>
        </ModalForm>
      )}
      <Confirmar
        abierto={quitar !== null} onCerrar={() => setQuitar(null)} confirmarTexto="Quitar"
        titulo={quitar?.ids ? "¿Quitar este acceso?" : "¿Hacerle el outboarding?"}
        texto={`${quitar?.texto ?? ""} Wisboo no deja borrar al alumno por API: queda en la tienda sin acceso.`}
        onConfirmar={() => { const q = quitar; if (q) void correr("quitar", { accion: "quitar", ids: q.ids }, (j) => `Quitados: ${String(j.quitados ?? 0)}${Number(j.fallaron) ? `, ${String(j.fallaron)} con error` : ""}.`); }}
      />
    </div>
  );
}
