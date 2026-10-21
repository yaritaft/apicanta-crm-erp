"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, GraduationCap, KeyRound, RotateCcw, Send, UserMinus, Video } from "lucide-react";
import { Badge, Button, Field, Select, type VarianteBadge } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import { relativo } from "@/lib/format";
import { programaDeProducto, programasDe } from "@/lib/programas";
import type { Alumno, Venta } from "@/lib/types";
import type { Acceso, EstadoAcceso, Plataforma } from "@/lib/accesos-servidor";
import { contratosPrendidos } from "./cliente";
import { mensajeDeBienvenida } from "@/lib/accesos-alumnos";
import { AccionesServicio, BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";

/* ==================================================================
   Los accesos de un alumno (el Loom de Yari), en la ficha → Servicio:
   Wisboo, Telegram y Zoom, cada uno con su estado pintado. Se ve SIEMPRE
   (Juan Cruz, 20/10: «que en la ficha salga qué onda el contrato, Zoom,
   Telegram y Wisboo»):
   - Si la app dio (o intentó dar) ese acceso, se ve lo que pasó: dado,
     entró al grupo, falló, quitado.
   - Si no, se ve lo marcado a mano en la ficha (lo del Airtable), con su
     editor de siempre (`manual`, lo pasa la vista Servicio).
   Los botones (dar accesos, reintentar, quitar, el outboarding) aparecen
   cuando los contratos y accesos están prendidos en Ajustes.
   Dos formas: «tarjeta» y «hoja» (la solapa Accesos de la ficha →
   Servicio: un bloque por plataforma con las mismas filas de la hoja).
   ================================================================== */

const ESTADO: Record<EstadoAcceso, { texto: string; variante: VarianteBadge }> = {
  pendiente: { texto: "Pendiente", variante: "neutral" },
  dado: { texto: "Con acceso", variante: "success" },
  entro: { texto: "Entró", variante: "success" },
  fallo: { texto: "Con error", variante: "danger" },
  quitado: { texto: "Quitado", variante: "neutral" },
};
const PLATAFORMAS: { clave: Plataforma; nombre: string; icono: React.ReactNode }[] = [
  { clave: "wisboo", nombre: "Wisboo", icono: <GraduationCap size={15} /> },
  { clave: "telegram", nombre: "Grupos de Telegram", icono: <Send size={15} /> },
  { clave: "zoom", nombre: "Reuniones de Zoom", icono: <Video size={15} /> },
];

/* La fila con el formato de la vista Servicio (hoja-servicio.css): ícono y rótulo a la izquierda, el estado a la derecha. */
function FilaPlataforma({ icono, rotulo, children }: { icono: React.ReactNode; rotulo: string; children: React.ReactNode }) {
  return (
    <div className="hs-fila">
      <span className="hs-fila__rot"><span className="hs-fila__ico" aria-hidden>{icono}</span><span>{rotulo}</span></span>
      <div className="hs-fila__val">{children}</div>
    </div>
  );
}

/* El estado de un acceso: un link de Telegram que todavía no se usó es ámbar (falta que entre). */
function estadoDe(x: Acceso): { texto: string; variante: VarianteBadge } {
  if (x.plataforma === "telegram" && x.estado === "dado") return { texto: "Falta que entre", variante: "warning" };
  if (x.plataforma === "telegram" && x.estado === "entro") return { texto: "Está en el grupo", variante: "success" };
  if (x.plataforma === "zoom" && x.estado === "dado") return { texto: "Inscripto", variante: "success" };
  return ESTADO[x.estado];
}

/* Debajo del nombre: cuándo y cómo se dio (o se quitó), o el error. */
function detalleDe(x: Acceso): string {
  if (x.estado === "fallo") return x.error ?? "No se pudo dar";
  if (x.estado === "quitado" && x.quitadoEn) return `Quitado ${relativo(x.quitadoEn)}`;
  if (x.estado === "entro") return `Entró${typeof x.externo.telegramUsuario === "string" ? ` como @${x.externo.telegramUsuario}` : ""}`;
  if (!x.dadoEn) return "";
  return `${x.plataforma === "telegram" ? "Link generado" : x.plataforma === "zoom" ? "Inscripto" : "Dado"} ${relativo(x.dadoEn)}${x.origen === "manual" ? " a mano" : " al firmar"}`;
}

/* El estado de una plataforma entera: lo peor manda (un error se ve aunque otro curso esté bien). */
function resumen(xs: Acceso[], plataforma: Plataforma): { texto: string; variante: VarianteBadge } {
  if (xs.some((x) => x.estado === "fallo")) return { texto: "Con error", variante: "danger" };
  const vigentes = xs.filter((x) => x.estado !== "quitado");
  if (vigentes.length === 0) return { texto: "Quitado", variante: "neutral" };
  if (plataforma === "telegram") {
    return vigentes.every((x) => x.estado === "entro")
      ? { texto: "Está en el grupo", variante: "success" }
      : { texto: "Link listo, falta que entre", variante: "warning" };
  }
  return { texto: plataforma === "zoom" ? "Inscripto" : "Con acceso", variante: "success" };
}

async function pedir(cuerpo: Record<string, unknown>) {
  const r = await fetch("/api/accesos-alumnos", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

export function AccesosAlumno({ alumno, venta, manual, forma = "tarjeta" }: {
  alumno: Alumno; venta?: Venta; forma?: "tarjeta" | "hoja";
  /* Lo marcado a mano en la ficha (Airtable), con su editor: se muestra donde la app todavía no dio nada. */
  manual?: Partial<Record<Plataforma | "whatsapp", React.ReactNode>>;
}) {
  const e = useEstado();
  const toast = useToast();
  const { esDueno } = useAcceso();
  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const [accesos, setAccesos] = useState<Acceso[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [dar, setDar] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<{ ids?: string[]; texto: string; wisboo?: boolean } | null>(null);
  const prendidos = contratosPrendidos(e.ajustes.contratos, esDueno);

  const leer = useCallback(async () => {
    if (!nube) { setAccesos([]); return; }
    const r = await nube.from("accesos_alumno").select("*").eq("alumnoId", alumno.id).order("plataforma");
    setAccesos(r.error ? [] : (r.data ?? []) as Acceso[]);
  }, [alumno.id]);
  useEffect(() => { void leer(); }, [leer]);

  const lista = accesos ?? [];
  const vigentes = lista.filter((x) => x.estado !== "quitado");
  const linksTelegram = lista.filter((x) => x.plataforma === "telegram" && x.estado === "dado" && typeof x.externo.link === "string");
  const linksZoom = lista.filter((x) => x.plataforma === "zoom" && x.estado === "dado" && typeof x.externo.joinUrl === "string");

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
    /* El servidor también marcó la ficha (Acceso, Wisboo, Zoom): que se vea sin recargar. */
    void acciones.traerFichaDe(alumno.id);
  }

  async function copiarMensaje() {
    const programa = programas.find((p) => p.id === (linksTelegram[0] ?? linksZoom[0])?.programa)?.nombre ?? "tu programa";
    const texto = mensajeDeBienvenida(alumno.nombre, programa, [
      ...linksTelegram.map((x) => ({ plataforma: "telegram" as const, nombre: x.recursoNombre, url: String(x.externo.link) })),
      ...linksZoom.map((x) => ({ plataforma: "zoom" as const, nombre: x.recursoNombre, url: String(x.externo.joinUrl) })),
    ]);
    try { await navigator.clipboard.writeText(texto); toast("Mensaje con los links copiado."); }
    catch { window.prompt("Copiá el mensaje:", texto); }
  }

  const programaSugerido = programaDeProducto(programas, venta?.productoId)?.id ?? "";
  const modales = (
    <>
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
        texto={`${quitar?.texto ?? ""}${quitar?.wisboo ? " Wisboo no deja borrar al alumno por API: queda en la tienda sin acceso." : ""}`}
        onConfirmar={() => { const q = quitar; if (q) void correr("quitar", { accion: "quitar", ids: q.ids }, (j) => `Quitados: ${String(j.quitados ?? 0)}${Number(j.fallaron) ? `, ${String(j.fallaron)} con error` : ""}.`); }}
      />
    </>
  );

  const reintentar = (x: Acceso) => (
    <Button sm variante="ghost" icono={<RotateCcw size={14} />} cargando={trabajando === x.id}
      onClick={() => void correr(x.id, { accion: "dar", programa: x.programa, solo: [{ plataforma: x.plataforma, recurso: x.recurso }] }, (j) => Number(j.fallaron) ? "Volvió a fallar." : "Listo, acceso dado.")}>
      Reintentar
    </Button>
  );

  /* ---------- La solapa Accesos de la ficha → Servicio ---------- */
  if (forma === "hoja") {
    return (
      <>
        {prendidos && (
          <AccionesServicio>
            {linksTelegram.length + linksZoom.length > 0 && <Button sm variante="ghost" icono={<Copy size={14} />} onClick={() => void copiarMensaje()}>Copiar mensaje con links</Button>}
            {vigentes.length > 0 && (
              <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom.", wisboo: true })}>Quitar todo</Button>
            )}
            <Button sm variante="primary" icono={<KeyRound size={14} />} onClick={() => setDar(programaSugerido)}>Dar accesos</Button>
          </AccionesServicio>
        )}
        {accesos === null ? <div className="skeleton" style={{ height: 132, borderRadius: 12 }} /> : PLATAFORMAS.map(({ clave, nombre, icono }) => {
          const xs = lista.filter((x) => x.plataforma === clave);
          /* Sin estado general de la plataforma (Juan Cruz, 21/10): cada fila ya dice a qué tiene acceso y a qué no. */
          return (
            <BloqueServicio key={clave} titulo={nombre}>
              {xs.length === 0
                ? (manual?.[clave] ?? <p className="hs-nada">Todavía no se le dio nada desde la app.</p>)
                : xs.map((x) => {
                  const est = estadoDe(x);
                  return (
                    <FilaServicio key={x.id} icono={icono} rotulo={x.recursoNombre || x.recurso} detalle={detalleDe(x) || undefined}>
                      <Badge variante={est.variante}>{est.texto}</Badge>
                      {prendidos && x.estado === "fallo" && reintentar(x)}
                      {prendidos && (x.estado === "dado" || x.estado === "entro") && (
                        <Button sm variante="ghost" onClick={() => setQuitar({ ids: [x.id], texto: `Se le saca «${x.recursoNombre || x.recurso}» (${nombre}).`, wisboo: x.plataforma === "wisboo" })}>Quitar</Button>
                      )}
                    </FilaServicio>
                  );
                })}
            </BloqueServicio>
          );
        })}
        {/* Los grupos de antes eran de WhatsApp: la marca del Airtable se sigue viendo y editando. */}
        {manual?.whatsapp && <BloqueServicio titulo="WhatsApp (los grupos de antes)">{manual.whatsapp}</BloqueServicio>}
        {modales}
      </>
    );
  }

  return (
    <div className="stack-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="t-label">Accesos</span>
        {prendidos && (
          <div className="row-wrap" style={{ gap: 6 }}>
            {linksTelegram.length + linksZoom.length > 0 && <Button sm variante="ghost" icono={<Copy size={14} />} onClick={() => void copiarMensaje()}>Copiar mensaje con links</Button>}
            <Button sm variante="secondary" icono={<KeyRound size={14} />} onClick={() => setDar(programaSugerido)}>Dar accesos</Button>
            {vigentes.length > 0 && (
              <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom.", wisboo: true })}>Quitar todo</Button>
            )}
          </div>
        )}
      </div>

      {accesos === null ? <div className="skeleton" style={{ height: 32 }} /> : (
        <ul className="stack-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {PLATAFORMAS.map(({ clave, nombre, icono }) => {
            const xs = lista.filter((x) => x.plataforma === clave);
            /* Sin nada de la app: lo marcado a mano en la ficha (con su editor), o «sin acceso». */
            if (xs.length === 0) {
              return (
                <li key={clave}>
                  {manual?.[clave] ?? <FilaPlataforma icono={icono} rotulo={nombre}><Badge variante="neutral">Sin acceso</Badge></FilaPlataforma>}
                </li>
              );
            }
            const r = resumen(xs, clave);
            return (
              <li key={clave} className="stack-1">
                <FilaPlataforma icono={icono} rotulo={nombre}><Badge variante={r.variante}>{r.texto}</Badge></FilaPlataforma>
                <ul className="stack-1" style={{ listStyle: "none", margin: 0, padding: "0 0 0 34px" }}>
                  {xs.map((x) => (
                    <li key={x.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="t-sm">{x.recursoNombre || x.recurso}</span>
                        {x.error && x.estado === "fallo" && <span className="t-sm" style={{ display: "block", color: "var(--danger)" }}>{x.error}</span>}
                        {x.estado !== "fallo" && (x.dadoEn || x.quitadoEn) && (
                          <span className="t-sm t-subtle" style={{ display: "block" }}>
                            {x.estado === "quitado" && x.quitadoEn ? `quitado ${relativo(x.quitadoEn)}`
                              : x.estado === "entro" ? `entró${typeof x.externo.telegramUsuario === "string" ? ` como @${x.externo.telegramUsuario}` : ""}`
                              : x.dadoEn ? `${clave === "telegram" ? "link generado" : "dado"} ${relativo(x.dadoEn)}${x.origen === "manual" ? " a mano" : " al firmar"}` : ""}
                          </span>
                        )}
                      </span>
                      <Badge variante={estadoDe(x).variante}>{estadoDe(x).texto}</Badge>
                      {prendidos && x.estado === "fallo" && (
                        <Button sm variante="ghost" icono={<RotateCcw size={14} />} cargando={trabajando === x.id}
                          onClick={() => void correr(x.id, { accion: "dar", programa: x.programa, solo: [{ plataforma: x.plataforma, recurso: x.recurso }] }, (j) => Number(j.fallaron) ? "Volvió a fallar." : "Listo, acceso dado.")}>
                          Reintentar
                        </Button>
                      )}
                      {prendidos && (x.estado === "dado" || x.estado === "entro") && (
                        <Button sm variante="ghost" onClick={() => setQuitar({ ids: [x.id], texto: `Se le saca «${x.recursoNombre || x.recurso}» (${nombre}).`, wisboo: x.plataforma === "wisboo" })}>Quitar</Button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {/* Los grupos de antes eran de WhatsApp: la marca del Airtable se sigue viendo y editando. */}
          {manual?.whatsapp && <li>{manual.whatsapp}</li>}
        </ul>
      )}

      {modales}
    </div>
  );
}
