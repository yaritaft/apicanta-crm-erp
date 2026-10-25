"use client";

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, Link2, Search, UserPlus } from "lucide-react";
import { Button, Card, Empty, Input } from "@/components/ui/ui";
import { Telefono } from "@/components/ui/Telefono";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { AsistenteAlumno } from "@/components/alumnos/AsistenteAlumno";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { lunesDe } from "@/lib/reportes";
import { fechaLarga } from "@/lib/format";
import { respuestasLegibles } from "@/lib/reporte-formularios";
import { alumnoSugerido, type ReporteSinAlumno } from "@/lib/reporte-sin-codigo";
import type { Alumno, Reporte } from "@/lib/types";
import { marcarSinAlumno, useSinAlumno } from "./sin-alumno-nube";
import "./reportes-sin-alumno.css";

/* ==================================================================
   Reportes → Sin alumno (Lili, 24/10): los reportes semanales que se
   completaron sin código con un mail que no es de ningún alumno (los de
   2024 y 2025 que no están en la app, o quien compró con otro mail).
   Atarlo copia el reporte a la ficha del alumno (y su WhatsApp, si la ficha
   no tenía) y de ahí en más ese mail va solo a ese alumno; si no está en la
   app, «Crear alumno» lo da de alta con su nombre y su mail ya escritos.
   ================================================================== */

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function linkGeneralDelReporte(): string {
  return typeof window === "undefined" ? "/reporte" : `${window.location.origin}/reporte`;
}

export function ReportesSinAlumno({ lista, cargando, releer }: ReturnType<typeof useSinAlumno>) {
  const e = useEstado();
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "alumnos");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscando, setBuscando] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [creando, setCreando] = useState<ReporteSinAlumno | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const quien = e.equipo.find((m) => m.id === acceso?.miembroId)?.nombre ?? "";

  const telefonoDe = useMemo(() => {
    const m = new Map((e.seguimientos ?? []).map((s) => [s.alumnoId, s.telefono] as const));
    return (id: string) => m.get(id);
  }, [e.seguimientos]);

  async function atar(f: ReporteSinAlumno, alumno: Pick<Alumno, "id" | "nombre">) {
    setOcupado(f.id);
    try {
      /* El de esa semana se reemplaza (como cuando lo manda con su código). */
      const semana = lunesDe(f.semanaDel);
      const ya = (e.reportes ?? []).find((r) => r.alumnoId === alumno.id && lunesDe(r.semanaDel) === semana);
      const datos: Partial<Reporte> = { ...f.reporte, estado: "completado", completadoEn: f.actualizadoEn };
      let reporteId: string;
      if (ya) { acciones.actualizarSilencioso<Reporte>("reportes", ya.id, datos); reporteId = ya.id; }
      else reporteId = acciones.crear<Reporte>("reportes", { ...datos, alumnoId: alumno.id, semanaDel: f.semanaDel, estado: "completado" }, `Reporte de ${alumno.nombre}`);
      /* Su WhatsApp, si la ficha no lo tenía: es para lo que Lili lo pidió (rescatar el contacto para el seguimiento). */
      if (f.telefono && !(telefonoDe(alumno.id) ?? "").trim()) {
        acciones.guardarSeguimiento(alumno.id, (s) => ({ ...s, telefono: f.telefono }), () => `WhatsApp del reporte semanal: ${f.telefono}`);
      }
      await marcarSinAlumno(f.id, { estado: "atado", alumnoId: alumno.id, reporteId, atadoPor: quien });
      toast(`Listo: el reporte de la semana del ${fechaLarga(f.semanaDel)} quedó en la ficha de ${alumno.nombre}. Los próximos de ${f.email} van solos.`);
      setBuscando(null); setBusca("");
      releer();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo atar.", "err");
    } finally { setOcupado(null); }
  }

  async function descartar(f: ReporteSinAlumno) {
    setOcupado(f.id);
    try {
      await marcarSinAlumno(f.id, { estado: "descartado", atadoPor: quien });
      toast(`Descartado el reporte de ${f.nombre} ${f.apellido}.`);
      releer();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo descartar.", "err");
    } finally { setOcupado(null); }
  }

  const resultados = useMemo(() => {
    const q = normal(busca.trim());
    if (q.length < 2) return [];
    return e.alumnos.filter((a) => normal(`${a.nombre} ${a.email}`).includes(q)).slice(0, 6);
  }, [e.alumnos, busca]);

  if (cargando) return <Card><p className="t-sm t-subtle" role="status">Cargando…</p></Card>;

  return (
    <div className="stack-4">
      <div className="rep-barra">
        <span className="t-sm t-subtle">
          Los completaron sin su código con un mail que no es de ningún alumno. Atalo al alumno (o crealo) y su reporte pasa a la ficha:
          los próximos de ese mail van solos.
        </span>
      </div>
      {lista.length === 0 ? (
        <Card>
          <Empty icono={<ClipboardList size={22} />} titulo="No hay reportes sin alumno"
            texto="Cuando alguien complete el reporte sin código con un mail que no está en la app, aparece acá para atarlo." />
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          <ul className="rsa-lista">
            {lista.map((f) => {
              const sugerido = alumnoSugerido(f, e.alumnos, telefonoDe);
              const respuestas = abierto === f.id ? respuestasLegibles(f.formulario, f.reporte.respuestas) : [];
              return (
                <li key={f.id} className="rsa-fila">
                  <div className="rsa-fila__quien">
                    <span className="t-strong">{`${f.nombre} ${f.apellido}`.trim() || "Sin nombre"}</span>
                    <span className="t-sm t-subtle">{f.email} · {f.programa || "Sin programa"} · semana del {fechaLarga(f.semanaDel)}</span>
                    <Telefono valor={f.telefono} compacto />
                  </div>
                  {puede && (
                    <div className="rsa-fila__acciones">
                      {sugerido && (
                        <Button sm variante="primary" icono={<Link2 size={14} />} disabled={ocupado === f.id} onClick={() => void atar(f, sugerido.alumno)}
                          title={`Tiene el mismo ${sugerido.por} que ${sugerido.alumno.nombre}`}>
                          Es {sugerido.alumno.nombre} (mismo {sugerido.por})
                        </Button>
                      )}
                      <Button sm variante={sugerido ? "ghost" : "secondary"} icono={<Search size={14} />} onClick={() => { setBuscando(buscando === f.id ? null : f.id); setBusca(""); }}>
                        {sugerido ? "Es otro alumno" : "Atar a un alumno"}
                      </Button>
                      <Button sm variante="ghost" icono={<UserPlus size={14} />} onClick={() => setCreando(f)}>Crear alumno</Button>
                      <Button sm variante="ghost" disabled={ocupado === f.id} onClick={() => void descartar(f)}>Descartar</Button>
                    </div>
                  )}
                  {buscando === f.id && (
                    <div className="rsa-buscar">
                      <Input icono={<Search size={16} />} value={busca} onChange={(ev) => setBusca(ev.target.value)} autoFocus placeholder="Buscá al alumno por nombre o mail" aria-label="Buscar alumno" />
                      {busca.trim().length >= 2 && (
                        <ul className="rsa-buscar__lista">
                          {resultados.length === 0 && <li className="t-sm t-subtle">Nadie coincide. Si no está en la app, tocá «Crear alumno».</li>}
                          {resultados.map((a) => (
                            <li key={a.id}>
                              <button type="button" className="rsa-buscar__op" disabled={ocupado === f.id} onClick={() => void atar(f, a)}>
                                <span className="t-strong">{a.nombre}</span><span className="t-sm t-subtle">{a.email || "Sin mail"}{a.plan ? ` · ${a.plan}` : ""}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <button type="button" className="link t-sm rsa-fila__ver" onClick={() => setAbierto(abierto === f.id ? null : f.id)} aria-expanded={abierto === f.id}>
                    {abierto === f.id ? "Ocultar sus respuestas" : "Ver sus respuestas"}
                  </button>
                  {respuestas.length > 0 && (
                    <dl className="rsa-respuestas">
                      {respuestas.map((x) => (
                        <div key={x.id}><dt>{x.etiqueta}</dt><dd>{x.respuesta}</dd></div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {creando && createPortal(
        <AsistenteAlumno
          persona={{ nombre: `${creando.nombre} ${creando.apellido}`.trim(), email: creando.email }}
          onCerrar={() => setCreando(null)}
          onAbrirAlumno={(id) => {
            /* Ya era alumno (lo encontró por la venta, su persona del CRM o el mail): el reporte es suyo. */
            const f = creando; setCreando(null);
            const a = e.alumnos.find((x) => x.id === id);
            if (a) void atar(f, a);
            abrirFicha(id, "servicio");
          }}
          onListo={(id, nombre) => { const f = creando; setCreando(null); void atar(f, { id, nombre }); }}
        />,
        document.body,
      )}
    </div>
  );
}
