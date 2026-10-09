"use client";

import React, { useState } from "react";
import { Field, Input, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { configSeguimiento } from "@/lib/seguimiento";
import { LISTAS_POR_DEFECTO, listasCs } from "@/lib/clientes-cs";
import type { ListasCs } from "@/lib/types";

/* Ajustar Customer Success: las cadencias del seguimiento y las listas de opciones de cada columna (stack, programa,
   follow-up…). Una opción por renglón. Cambia lo que viene: no mueve lo ya cargado. */

const LISTAS: { clave: keyof ListasCs; titulo: string; ayuda: string }[] = [
  { clave: "stacks", titulo: "Stack", ayuda: "Frontend, Backend, Full Stack…" },
  { clave: "programas", titulo: "Programa", ayuda: "Hackear IT, Hackear Biz, Principals…" },
  { clave: "accesos", titulo: "Acceso", ayuda: "Completos, downsell, sin acceso" },
  { clave: "followUps", titulo: "Follow-up de los clientes", ayuda: "Onboarding, módulos, avanzando, no contesta…" },
  { clave: "estadosContrato", titulo: "Estado del contrato", ayuda: "Enviado, falta firma, firmado y subido a Drive" },
  { clave: "garantias", titulo: "Garantía", ayuda: "Opcional: se sugieren al escribirla" },
  { clave: "followUpsTestimonio", titulo: "Follow-up de los testimonios", ayuda: "Si se agendó la llamada de grabación" },
  { clave: "estadosVideo", titulo: "Estado del video", ayuda: "Pendiente de subir, subido a Drive…" },
  { clave: "quienGraba", titulo: "Con quién grabó", ayuda: "Yari, Mariano" },
  { clave: "resellsTestimonio", titulo: "Resell del testimonio", ayuda: "Cómo salió el pitch de renovación" },
  { clave: "estadosResell", titulo: "Estado de la agenda de resells", ayuda: "Agendada, renueva, no renueva…" },
];

export function AjustarCs({ onCerrar }: { onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const actuales = listasCs(e.ajustes.seguimiento);
  const [cadencias, setCadencias] = useState(cfg.cadencias.join(", "));
  const [porDefecto, setPorDefecto] = useState(String(cfg.cadenciaPorDefecto));
  const [reintento, setReintento] = useState(String(cfg.reintentoDias));
  const [intentos, setIntentos] = useState(String(cfg.intentosHastaDejar));
  const [listas, setListas] = useState<Record<string, string>>(
    () => Object.fromEntries(LISTAS.map((l) => [l.clave, actuales[l.clave].join("\n")])),
  );

  const nueva = configSeguimiento({
    cadencias: cadencias.split(/[,\s]+/).filter(Boolean).map(Number),
    cadenciaPorDefecto: Number(porDefecto), reintentoDias: Number(reintento), intentosHastaDejar: Number(intentos),
  });

  function guardar() {
    /* Sólo se guarda lo que difiere de las listas de siempre: el resto sigue las de Lili si algún día cambian. */
    const propias: Partial<ListasCs> = {};
    for (const l of LISTAS) {
      const items = (listas[l.clave] ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
      const base = LISTAS_POR_DEFECTO[l.clave];
      if (items.join("\n") !== base.join("\n")) propias[l.clave] = items;
    }
    acciones.configurarSeguimiento({ ...nueva, listas: propias });
    toast("Customer Success ajustado.");
    onCerrar();
  }

  return (
    <ModalForm abierto onCerrar={onCerrar} titulo="Ajustar Customer Success" ancho onGuardar={guardar}
      sub="Las cadencias del seguimiento y las listas de cada columna. Cambia lo que viene: no mueve lo ya cargado.">
      <div className="cs-ficha">
        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Seguimiento</h3>
          <div className="form-grid">
            <Field label="Cadencias (en días)" ayuda="Separadas por coma. De entrada: 7, 15 y 20." span2>
              <Input value={cadencias} onChange={(ev) => setCadencias(ev.target.value)} placeholder="7, 15, 20" />
            </Field>
            <Field label="Cadencia de arranque" ayuda="La que tiene un alumno al que todavía no se le eligió una.">
              <Input type="number" min={1} value={porDefecto} onChange={(ev) => setPorDefecto(ev.target.value)} />
            </Field>
            <Field label="Si no contestó, probar de nuevo en (días)">
              <Input type="number" min={1} value={reintento} onChange={(ev) => setReintento(ev.target.value)} />
            </Field>
            <Field label="Intentos sin respuesta para sugerir «dejó de contestar»" span2>
              <Input type="number" min={1} value={intentos} onChange={(ev) => setIntentos(ev.target.value)} />
            </Field>
          </div>
          <p className="t-sm t-subtle" style={{ margin: 0 }}>
            Quedan así: cadencias {nueva.cadencias.join(", ")} · arranque cada {nueva.cadenciaPorDefecto} · reintento a los {nueva.reintentoDias} días · sugerir con {nueva.intentosHastaDejar} intentos.
          </p>
        </section>
        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Listas de opciones</h3>
          <div className="form-grid">
            {LISTAS.map((l) => (
              <Field key={l.clave} label={l.titulo} ayuda={`${l.ayuda}. Una por renglón.`}>
                <Textarea rows={5} value={listas[l.clave] ?? ""} onChange={(ev) => setListas((x) => ({ ...x, [l.clave]: ev.target.value }))} />
              </Field>
            ))}
          </div>
        </section>
      </div>
    </ModalForm>
  );
}
