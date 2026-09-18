"use client";

import React, { useMemo, useState } from "react";
import { ArrowRight, History, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Button, Card, Chip, Empty, Input, StatCard } from "@/components/ui/ui";
import { useEstado } from "@/lib/store";
import { fechaHora, fechaLarga, relativo } from "@/lib/format";
import type { AccionActividad, Actividad } from "@/lib/types";

const ICONO: Record<AccionActividad, React.ReactNode> = {
  "creo": <Plus size={13} />,
  "actualizo": <Pencil size={13} />,
  "elimino": <Trash2 size={13} />,
  "movio": <ArrowRight size={13} />,
  "importo": <Upload size={13} />,
};

const ETIQUETA_ENTIDAD: Record<string, string> = {
  lead: "Leads", alumno: "Alumnos", sesion: "Agenda", webinar: "Webinars",
  campania: "Marketing", transaccion: "Finanzas", meta: "Metas", config: "Ajustes",
};

export default function ActividadPage() {
  const e = useEstado();
  const [q, setQ] = useState("");
  const [entidad, setEntidad] = useState("todas");

  const filtrada = useMemo(() => {
    const t = q.trim().toLowerCase();
    return e.actividad.filter((a) => {
      if (entidad !== "todas" && a.entidad !== entidad) return false;
      if (!t) return true;
      return [a.detalle, a.titulo, a.actor].some((x) => x.toLowerCase().includes(t));
    });
  }, [e.actividad, q, entidad]);

  const porDia = useMemo(() => {
    const m = new Map<string, Actividad[]>();
    for (const a of filtrada) {
      const k = new Date(a.fecha).toDateString();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return [...m.entries()];
  }, [filtrada]);

  const hoy = new Date().toDateString();
  const entidades = useMemo(() => [...new Set(e.actividad.map((a) => a.entidad))], [e.actividad]);

  const deHoy = e.actividad.filter((a) => new Date(a.fecha).toDateString() === hoy).length;
  const deSemana = e.actividad.filter((a) => Date.now() - +new Date(a.fecha) < 7 * 86400000).length;

  return (
    <div className="stack-5">
      <PageHead
        titulo="Actividad"
        sub="Todo lo que se creó, editó, movió o borró, con quién lo hizo y cuándo. Nada se pierde."
      />

      <div className="grid-3">
        <StatCard hero etiqueta="Movimientos hoy" valor={String(deHoy)} contexto="cambios registrados" />
        <StatCard etiqueta="Esta semana" valor={String(deSemana)} contexto="últimos 7 días" />
        <StatCard etiqueta="Historial" valor={String(e.actividad.length)} contexto="movimientos guardados" />
      </div>

      <Card>
        <div className="toolbar">
          <Input icono={<History size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscá en el historial…" aria-label="Buscar en actividad" />
          <Chip activo={entidad === "todas"} onClick={() => setEntidad("todas")} count={e.actividad.length}>Todo</Chip>
          {entidades.map((k) => (
            <Chip key={k} activo={entidad === k} onClick={() => setEntidad(k)} count={e.actividad.filter((a) => a.entidad === k).length}>
              {ETIQUETA_ENTIDAD[k] ?? k}
            </Chip>
          ))}
        </div>

        {porDia.length === 0 ? (
          <Empty
            icono={<History size={22} />}
            titulo={q || entidad !== "todas" ? "Nada coincide" : "Sin movimientos todavía"}
            texto={q || entidad !== "todas" ? "Probá con otro texto o sacá el filtro." : "En cuanto empieces a cargar o editar cosas, cada cambio va a quedar registrado acá."}
            accion={q || entidad !== "todas" ? <Button variante="secondary" onClick={() => { setQ(""); setEntidad("todas"); }}>Limpiar filtros</Button> : undefined}
          />
        ) : (
          <div className="stack-5">
            {porDia.map(([dia, items]) => (
              <div key={dia}>
                <div className="t-label" style={{ marginBottom: 14 }}>
                  {dia === hoy ? "Hoy" : fechaLarga(new Date(dia).toISOString())}
                </div>
                <div className="timeline">
                  {items.map((a) => (
                    <div key={a.id} className="timeline__item">
                      <span className="timeline__dot">{ICONO[a.accion]}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="timeline__text">{a.detalle}</div>
                        <div className="timeline__meta">
                          {ETIQUETA_ENTIDAD[a.entidad] ?? a.entidad} · {a.actor} · {fechaHora(a.fecha)} ({relativo(a.fecha)})
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
