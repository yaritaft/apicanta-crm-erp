"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Info, Pencil } from "lucide-react";
import { Ayuda, Button, Card, CardHead, Switch } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/crm/piezas";
import { EditarOpciones } from "@/components/crm/MenuColumna";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { conConfig, opcionesDe } from "@/lib/crm";
import { queMueve, revisarOcultar, type RevisionOcultar } from "@/lib/estados";
import { num } from "@/lib/format";
import type { CampoOpcionesCrm, OpcionCrm } from "@/lib/types";

/* ==================================================================
   Ajustes → CRM → Estados de llamada (F2-05: «hay una banda», Santi
   marca cuáles usa de verdad).

   Ocultar un estado no lo borra (hay historia): deja de ofrecerse al
   cargar, pero las llamadas que ya lo tienen lo siguen mostrando y lo
   que pone la app sola sigue andando. Antes de ocultarlo se revisa qué
   mueve —la Agenda, la etapa del lead y lo que pregunta el cierre del
   día— y se avisa si ocultarlo rompe algo (lib/estados.ts: revisarOcultar).
   ================================================================== */

const LISTAS: { campo: CampoOpcionesCrm; titulo: string; sub: string }[] = [
  { campo: "estadoLlamada", titulo: "Estado de Llamada", sub: "Cómo terminó la llamada: lo elige el closer en su cierre del día." },
  { campo: "estadoPreCall", titulo: "Estado Pre-Call", sub: "Lo que pasó antes de la llamada: si confirmó, si pidió otra fecha o no contestó." },
  { campo: "preCall", titulo: "Pre-Call", sub: "El seguimiento antes de la llamada: los mensajes y llamados para que se presente." },
];

export function EstadosDeLlamada() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "ajustes");
  const [revisando, setRevisando] = useState<{ campo: CampoOpcionesCrm; titulo: string; nombre: string; revision: RevisionOcultar } | null>(null);
  const [editando, setEditando] = useState<{ campo: CampoOpcionesCrm; titulo: string; ancla: HTMLElement } | null>(null);

  /* Cuántas llamadas tiene cada estado. */
  const usos = useMemo(() => {
    const m: Record<CampoOpcionesCrm, Map<string, number>> = { estadoLlamada: new Map(), estadoPreCall: new Map(), preCall: new Map() };
    for (const s of e.sesiones) {
      for (const campo of Object.keys(m) as CampoOpcionesCrm[]) {
        const v = s[campo];
        if (v) m[campo].set(v, (m[campo].get(v) ?? 0) + 1);
      }
    }
    return m;
  }, [e.sesiones]);

  /* Guarda la lista del campo con ese estado oculto o a la vista. */
  const poner = (campo: CampoOpcionesCrm, titulo: string, nombre: string, oculta: boolean) => {
    const lista = opcionesDe(e.ajustes, campo).map((o): OpcionCrm => {
      if (o.nombre !== nombre) return o;
      const { oculta: _antes, ...resto } = o;
      void _antes;
      return oculta ? { ...resto, oculta: true } : resto;
    });
    acciones.configurarCrm(
      conConfig(e.ajustes, { opciones: { ...(e.ajustes.crm?.opciones ?? {}), [campo]: lista } }), [],
      oculta ? `Se ocultó «${nombre}» de ${titulo}: ya no se ofrece al cargar.` : `Se volvió a mostrar «${nombre}» en ${titulo}.`,
    );
  };

  return (
    <div className="stack-4">
      <Ayuda titulo="Ocultar no borra nada" icono={<Info size={18} />}>
        Un estado oculto no se ofrece al cargar una llamada, pero las llamadas que ya lo tienen lo siguen mostrando, con su color, y lo que
        pone la app sola sigue andando. Antes de ocultarlo ves qué mueve (la Agenda, la etapa del lead y lo que pregunta el cierre del día) y
        si ocultarlo rompe algo. Se puede volver a mostrar cuando quieras. Santi marca cuáles usa de verdad y el resto se oculta desde acá.
      </Ayuda>
      {!puede && <p className="t-sm t-subtle">Sólo lo cambian quienes editan Ajustes.</p>}

      {LISTAS.map(({ campo, titulo, sub }) => {
        const lista = opcionesDe(e.ajustes, campo);
        const ocultas = lista.filter((o) => o.oculta).length;
        return (
          <Card key={campo}>
            <CardHead
              titulo={titulo}
              sub={`${sub} ${ocultas ? `${num(lista.length - ocultas)} a la vista y ${num(ocultas)} ${ocultas === 1 ? "oculto" : "ocultos"}.` : `${num(lista.length)} a la vista.`}`}
              acciones={puede && (
                <Button sm variante="secondary" icono={<Pencil size={14} />} onClick={(ev) => setEditando({ campo, titulo, ancla: ev.currentTarget })}>
                  Nombres, colores y orden
                </Button>
              )}
            />
            <div className="est-lista" role="list">
              {lista.map((o) => {
                const n = usos[campo].get(o.nombre) ?? 0;
                const mueve = queMueve(o, campo);
                return (
                  <div key={o.nombre} role="listitem" className={`est-fila${o.oculta ? " est-fila--oculta" : ""}`}>
                    <span className="est-fila__nombre"><Chip texto={o.nombre} color={o.color} /></span>
                    <span className="est-fila__mueve">
                      {mueve.length > 0
                        ? <ul>{mueve.map((m) => <li key={m}>{m}</li>)}</ul>
                        : <span className="t-subtle">No mueve nada más: es una etiqueta.</span>}
                    </span>
                    <span className="est-fila__usos t-sm t-subtle t-num">{n === 0 ? "Sin llamadas" : `${num(n)} ${n === 1 ? "llamada" : "llamadas"}`}</span>
                    <label className="est-fila__vista">
                      <Switch
                        checked={!o.oculta} etiqueta={`${o.nombre}: a la vista`}
                        onChange={(v) => {
                          if (!puede) return;
                          if (v) { poner(campo, titulo, o.nombre, false); toast(`«${o.nombre}» vuelve a ofrecerse.`); return; }
                          setRevisando({ campo, titulo, nombre: o.nombre, revision: revisarOcultar(e.ajustes, campo, o.nombre, n) });
                        }}
                      />
                      <span className="t-sm">{o.oculta ? <><EyeOff size={13} aria-hidden /> Oculto</> : <><Eye size={13} aria-hidden /> A la vista</>}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {revisando && (
        <Modal
          abierto onCerrar={() => setRevisando(null)} titulo={`Ocultar «${revisando.nombre}»`}
          sub={`${LISTAS.find((l) => l.campo === revisando.campo)?.titulo}: deja de ofrecerse al cargar, pero no se borra.`}
          pie={revisando.revision.bloquea ? (
            <><span className="spacer" /><Button variante="primary" onClick={() => setRevisando(null)}>Entendido</Button></>
          ) : (
            <>
              <Button variante="ghost" onClick={() => setRevisando(null)}>Cancelar</Button>
              <span className="spacer" />
              <Button
                variante="primary" icono={<EyeOff size={16} />}
                onClick={() => { poner(revisando.campo, revisando.titulo, revisando.nombre, true); toast(`«${revisando.nombre}» ya no se ofrece. Sigue en las llamadas que lo tienen.`); setRevisando(null); }}
              >
                Ocultar
              </Button>
            </>
          )}
        >
          <div className="stack-4">
            {revisando.revision.bloquea && (
              <div className="est-aviso est-aviso--rompe" role="alert">
                <AlertTriangle size={18} aria-hidden />
                <div><strong>No se puede ocultar</strong><p>{revisando.revision.bloquea}</p></div>
              </div>
            )}
            <section>
              <h4 className="info-titulo">Qué mueve hoy</h4>
              {revisando.revision.mueve.length > 0
                ? <ul className="est-modal__lista">{revisando.revision.mueve.map((m) => <li key={m}>{m}</li>)}</ul>
                : <p className="t-sm t-subtle">No mueve nada más: es una etiqueta.</p>}
            </section>
            {!revisando.revision.bloquea && revisando.revision.avisos.length > 0 && (
              <section>
                <h4 className="info-titulo">Qué cambia si la ocultás</h4>
                <ul className="est-modal__lista">{revisando.revision.avisos.map((m) => <li key={m}>{m}</li>)}</ul>
              </section>
            )}
            {!revisando.revision.bloquea && revisando.revision.avisos.length === 0 && (
              <p className="t-sm t-muted">No rompe nada: sólo deja de ofrecerse al cargar.</p>
            )}
          </div>
        </Modal>
      )}

      {editando && (
        <EditarOpciones
          campo={editando.campo} titulo={editando.titulo} ancla={editando.ancla} onCerrar={() => setEditando(null)}
          ajustes={e.ajustes} sesiones={e.sesiones}
        />
      )}
    </div>
  );
}
