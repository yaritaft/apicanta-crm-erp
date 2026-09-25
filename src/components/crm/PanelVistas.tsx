"use client";

import React, { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Search, Settings, Sheet } from "lucide-react";
import { acciones, useEstado } from "@/lib/store";
import { useToast } from "@/components/ui/Toast";
import { conConfig, entraEnTabla, sinTildes, type SeccionVistas, type VistaCrm } from "@/lib/crm";
import type { Sesion, TablaCrm } from "@/lib/types";
import { Flotante } from "./piezas";
import { usePreferencia, type VistaPropia } from "./useVistas";

/* ==================================================================
   La barra de vistas de la izquierda, como la de Airtable: crear una,
   encontrarla, y la lista — Todas, cada closer con sus días, el setter
   y los lanzamientos. Las secciones se pliegan.
   ================================================================== */

export function PanelVistas({ secciones, propias, activa, onElegir, onCrear, tabla, tablas, sesiones }: {
  secciones: SeccionVistas[];
  propias: VistaPropia[];
  activa: string;
  onElegir: (id: string) => void;
  onCrear: (nombre: string) => void;
  tabla: TablaCrm;
  tablas: TablaCrm[];
  sesiones: Sesion[];
}) {
  const [q, setQ] = useState("");
  const [creando, setCreando] = useState<string | null>(null);
  const [plegadas, setPlegadas] = usePreferencia<string[]>("secciones-plegadas", []);
  const [config, setConfig] = useState(false);
  const engranaje = useRef<HTMLButtonElement>(null);

  const todas: SeccionVistas[] = useMemo(() => [
    ...(propias.length ? [{ id: "propias", titulo: "Mis vistas", vistas: propias }] : []),
    ...secciones,
  ], [propias, secciones]);

  const t = sinTildes(q.trim());
  const filtradas = t
    ? todas.map((s) => ({ ...s, vistas: s.vistas.filter((v) => sinTildes(`${s.titulo ?? ""} ${v.nombre}`).includes(t)) })).filter((s) => s.vistas.length > 0)
    : todas;

  const alternar = (id: string) => setPlegadas(plegadas.includes(id) ? plegadas.filter((x) => x !== id) : [...plegadas, id]);

  return (
    <aside className="crm-vistas" aria-label="Vistas">
      <div className="crm-vistas__arriba">
        {creando === null ? (
          <button type="button" className="crm-vistas__crear" onClick={() => setCreando("")}>
            <Plus size={16} aria-hidden />Crear nuevo...
          </button>
        ) : (
          <form className="crm-vistas__nueva" onSubmit={(ev) => { ev.preventDefault(); if (creando.trim()) { onCrear(creando.trim()); setCreando(null); } }}>
            <input
              autoFocus className="crm-input" value={creando} placeholder="Nombre de la vista"
              aria-label="Nombre de la vista nueva"
              onChange={(ev) => setCreando(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Escape") setCreando(null); }}
              onBlur={() => { if (!creando.trim()) setCreando(null); }}
            />
            <span className="crm-vistas__ayuda">Arranca como la vista que estás mirando. Enter para crearla.</span>
          </form>
        )}
        <div className="crm-vistas__buscar">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Encontrar una vista" aria-label="Encontrar una vista" />
          <button ref={engranaje} type="button" className="crm-icono" aria-label="Qué agendas entran en cada tabla"
            title="Qué agendas entran en cada tabla" onClick={() => setConfig((v) => !v)}>
            <Settings size={16} aria-hidden />
          </button>
        </div>
      </div>

      <nav className="crm-vistas__lista">
        {filtradas.map((s) => {
          if (!s.titulo) return s.vistas.map((v) => <ItemVista key={v.id} v={v} activa={v.id === activa} onElegir={onElegir} />);
          const abierta = t !== "" || !plegadas.includes(s.id);
          return (
            <div key={s.id} className="crm-seccion">
              <button type="button" className="crm-seccion__cabeza" onClick={() => alternar(s.id)} aria-expanded={abierta}>
                {abierta ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                {s.marca && <Marca {...s.marca} />}
                <span className="crm-seccion__titulo">{s.titulo}</span>
              </button>
              {abierta && (
                <div className="crm-seccion__vistas">
                  {s.vistas.map((v) => <ItemVista key={v.id} v={v} activa={v.id === activa} onElegir={onElegir} />)}
                </div>
              )}
            </div>
          );
        })}
        {filtradas.length === 0 && <p className="crm-vistas__nada">Ninguna vista se llama así.</p>}
      </nav>

      {config && <ConfigTablas ancla={engranaje.current} onCerrar={() => setConfig(false)} tabla={tabla} tablas={tablas} sesiones={sesiones} />}
    </aside>
  );
}

function Marca({ color, forma }: { color: string; forma: "punto" | "cuadrado" }) {
  return <span className={`crm-marca crm-marca--${forma}`} style={{ background: color }} aria-hidden />;
}

function ItemVista({ v, activa, onElegir }: { v: VistaCrm; activa: boolean; onElegir: (id: string) => void }) {
  return (
    <button
      type="button" className={`crm-vista${activa ? " crm-vista--activa" : ""}`}
      aria-current={activa ? "page" : undefined} onClick={() => onElegir(v.id)}
    >
      <Sheet size={16} className="crm-vista__icono" aria-hidden />
      {v.marca && <Marca {...v.marca} />}
      <span className="crm-vista__nombre">{v.nombre}</span>
    </button>
  );
}

/* ---------- Qué agendas entran en cada tabla ----------
   Los tipos de evento de Calendly que existen, y en qué tabla cae cada
   uno. Queda en ajustes.crm para todo el equipo. */

function ConfigTablas({ ancla, onCerrar, tabla, tablas, sesiones }: {
  ancla: HTMLElement | null; onCerrar: () => void; tabla: TablaCrm; tablas: TablaCrm[]; sesiones: Sesion[];
}) {
  const toast = useToast();
  const e = useEstado();
  const tipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sesiones) if (s.origen === "calendly" && s.calendlyInvitadoUri && s.tipo) m.set(s.tipo, (m.get(s.tipo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [sesiones]);
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(tipos.filter(([t]) => entraEnTabla({ tipo: t }, tabla)).map(([t]) => t)));
  const enOtra = (t: string) => tablas.find((x) => x.id !== tabla.id && entraEnTabla({ tipo: t }, x));

  function guardar() {
    const nuevas = tablas.map((x) => {
      if (x.id === tabla.id) return { ...x, tipos: [...elegidos] };
      /* Un tipo va a una sola tabla: si se sumó acá, sale de la otra. */
      const suyos = tipos.map(([t]) => t).filter((t) => entraEnTabla({ tipo: t }, x) && !elegidos.has(t));
      return { ...x, tipos: suyos };
    });
    acciones.configurarCrm(conConfig(e.ajustes, { tablas: nuevas }), [], `Cambió qué agendas entran en «${tabla.nombre}».`);
    toast(`Listo: «${tabla.nombre}» muestra ${elegidos.size} ${elegidos.size === 1 ? "tipo" : "tipos"} de agenda.`);
    onCerrar();
  }

  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} className="crm-pop--herr" ancho={380}>
      <div className="crm-pop__titulo">Qué agendas entran en «{tabla.nombre}»</div>
      <p className="crm-pop__nota">Los tipos de evento de Calendly. Una agenda nueva de un tipo tildado aparece sola en esta tabla.</p>
      <div className="crm-pop__lista">
        {tipos.map(([t, n]) => {
          const on = elegidos.has(t);
          const otra = enOtra(t);
          return (
            <button key={t} type="button" className="crm-pop__item" onClick={() => setElegidos((s) => { const x = new Set(s); if (on) x.delete(t); else x.add(t); return x; })}>
              <span className={`crm-tilde${on ? " crm-tilde--on" : ""}`}>{on && <Check size={12} strokeWidth={3} aria-hidden />}</span>
              <span className="crm-pop__texto">{t}</span>
              <span className="crm-pop__cuenta">{!on && otra ? `en ${otra.nombre}` : n}</span>
            </button>
          );
        })}
        {tipos.length === 0 && <p className="crm-pop__nota">Todavía no llegó ninguna agenda de Calendly.</p>}
      </div>
      <div className="crm-pop__botones">
        <button type="button" className="crm-boton crm-boton--quieto" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="crm-boton crm-boton--azul" onClick={guardar}>Guardar</button>
      </div>
    </Flotante>
  );
}
