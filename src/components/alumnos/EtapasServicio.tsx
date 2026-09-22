"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Info, Plus, Settings2, Trash2 } from "lucide-react";
import { Ayuda, Badge, Button, Card, CardHead, Field, IconButton, Input, Select, Tag } from "@/components/ui/ui";
import { Confirmar, Modal, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import type { EtapaServicio } from "@/lib/types";
import { COLORES_ETAPA, NOMBRE_COLOR } from "./comun";

/* ==================================================================
   Ajustes → Etapas → Pipeline de servicio.

   Las columnas del tablero de alumnos: se agregan, se renombran, se
   ordenan (con las flechas o arrastrando) y se borran. Borrar una etapa
   con alumnos pregunta a cuál pasan: si no, quedarían colgados de una
   columna que ya no existe.
   ================================================================== */

type Form = { id?: string; nombre: string; color: EtapaServicio["color"] };

export function EtapasServicio() {
  const e = useEstado();
  const toast = useToast();
  const etapas = etapasDeServicio(e);
  const [form, setForm] = useState<Form | null>(null);
  const [borrar, setBorrar] = useState<EtapaServicio | null>(null);
  const [destino, setDestino] = useState("");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  /* "Estar en una etapa" es aparecer en esa columna: los que no tienen etapa
     se cuentan en la primera, que es donde se los ve. */
  const cuantos = (id: string) => e.alumnos.filter((a) => etapaDelAlumno(etapas, a)?.id === id).length;
  const enBorrar = borrar ? cuantos(borrar.id) : 0;

  function subirBajar(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= etapas.length) return;
    const ids = etapas.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    acciones.ordenarEtapasServicio(ids);
  }

  function soltar(sobreId: string) {
    const origen = arrastrando;
    setArrastrando(null);
    setSobre(null);
    if (!origen || origen === sobreId) return;
    const desde = etapas.findIndex((x) => x.id === origen);
    const hasta = etapas.findIndex((x) => x.id === sobreId);
    const ids = etapas.map((x) => x.id).filter((x) => x !== origen);
    /* Bajando, cae después de la etapa de destino; subiendo, antes: así
       queda exactamente donde se la soltó. */
    const i = ids.indexOf(sobreId);
    ids.splice(desde < hasta ? i + 1 : i, 0, origen);
    acciones.ordenarEtapasServicio(ids);
  }

  function guardar() {
    if (!form) return;
    const nombre = form.nombre.trim();
    if (!nombre) { toast("Ponele un nombre a la etapa.", "err"); return; }
    if (etapas.some((x) => x.id !== form.id && x.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      toast("Ya hay una etapa con ese nombre.", "err");
      return;
    }
    if (form.id) {
      acciones.editarEtapaServicio(form.id, { nombre, color: form.color });
      toast("Etapa actualizada.");
    } else {
      acciones.crearEtapaServicio({ nombre, color: form.color });
      toast(`Etapa «${nombre}» creada al final del pipeline.`);
    }
    setForm(null);
  }

  function pedirBorrar(et: EtapaServicio) {
    const i = etapas.findIndex((x) => x.id === et.id);
    /* Por defecto, a la etapa que sigue: quien estaba ahí ya había pasado por
       las anteriores. Si es la última, a la de antes. */
    setDestino((etapas[i + 1] ?? etapas[i - 1])?.id ?? "");
    setBorrar(et);
  }

  function confirmarBorrado() {
    if (!borrar) return;
    const a = etapas.find((x) => x.id === destino);
    acciones.eliminarEtapaServicio(borrar.id, destino || undefined);
    toast(enBorrar > 0 && a
      ? `Se eliminó «${borrar.nombre}». ${enBorrar === 1 ? "El alumno pasó" : `Los ${enBorrar} alumnos pasaron`} a «${a.nombre}».`
      : `Se eliminó «${borrar.nombre}».`);
    setBorrar(null);
  }

  return (
    <div className="stack-4">
      <Card>
        <CardHead
          titulo="Etapas del servicio"
          sub="Las columnas del pipeline de alumnos, en orden: por dónde pasa cada alumno desde que compra hasta que termina."
          acciones={
            <Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setForm({ nombre: "", color: "brand" })}>
              Nueva etapa
            </Button>
          }
        />
        <div className="stack-2">
          {etapas.map((et, i) => {
            const n = cuantos(et.id);
            return (
              <div
                key={et.id}
                className={`agenda-item etapa-fila${sobre === et.id ? " etapa-fila--sobre" : ""}${arrastrando === et.id ? " etapa-fila--arrastrando" : ""}`}
                onDragOver={(ev) => { if (!arrastrando) return; ev.preventDefault(); if (sobre !== et.id) setSobre(et.id); }}
                onDrop={(ev) => { ev.preventDefault(); soltar(et.id); }}
              >
                <span className="etapa-fila__flechas">
                  <IconButton etiqueta={`Subir «${et.nombre}»`} onClick={() => subirBajar(i, -1)} disabled={i === 0} style={{ height: 18 }}>
                    <ChevronUp size={14} />
                  </IconButton>
                  <IconButton etiqueta={`Bajar «${et.nombre}»`} onClick={() => subirBajar(i, 1)} disabled={i === etapas.length - 1} style={{ height: 18 }}>
                    <ChevronDown size={14} />
                  </IconButton>
                </span>
                <span
                  className="etapa-fila__asa" draggable title="Arrastrá para cambiar el orden"
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData("text/plain", et.id);
                    ev.dataTransfer.effectAllowed = "move";
                    setArrastrando(et.id);
                  }}
                  onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                >
                  <GripVertical size={16} />
                </span>
                <span className="etapa-fila__nombre">
                  <Badge variante={et.color}>{et.nombre}</Badge>
                  {i === 0 && <Tag>Entran acá</Tag>}
                </span>
                <span className="t-sm t-subtle t-num">{n} {n === 1 ? "alumno" : "alumnos"}</span>
                <span style={{ display: "flex", gap: 2 }}>
                  <IconButton etiqueta={`Editar «${et.nombre}»`} onClick={() => setForm({ id: et.id, nombre: et.nombre, color: et.color })}>
                    <Settings2 size={15} />
                  </IconButton>
                  <IconButton
                    etiqueta={etapas.length <= 1 ? "Tiene que quedar al menos una etapa" : `Eliminar «${et.nombre}»`}
                    disabled={etapas.length <= 1} onClick={() => pedirBorrar(et)}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Ayuda titulo="Cómo se usan" icono={<Info size={18} />}>
        Cada venta que registrás crea su alumno en la <strong>primera etapa</strong>, así que conviene que sea la de
        recién comprado. Si borrás una etapa que tiene alumnos, te preguntamos a cuál pasan: nadie queda afuera del
        tablero. Los alumnos se mueven desde <strong>Alumnos → Pipeline</strong>.
      </Ayuda>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar}
          titulo={form.id ? "Editar etapa" : "Nueva etapa"}
          sub="El nombre es el que se ve arriba de la columna, en el pipeline de alumnos."
          guardarTexto={form.id ? "Guardar" : "Crear etapa"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <Field label="Nombre">
            <Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Preparación de entrevistas" autoFocus />
          </Field>
          <Field label="Color" ayuda="Cómo se ve el cartelito y el punto de la columna.">
            <Select
              value={form.color} onChange={(ev) => setForm({ ...form, color: ev.target.value as EtapaServicio["color"] })}
              opciones={COLORES_ETAPA.map((x) => ({ valor: x, texto: NOMBRE_COLOR[x] }))}
            />
            <div style={{ marginTop: 8 }}><Badge variante={form.color}>{form.nombre.trim() || "Vista previa"}</Badge></div>
          </Field>
        </ModalForm>
      )}

      {/* Sin alumnos adentro alcanza con confirmar; con alumnos, hay que decir
          a dónde van. */}
      <Confirmar
        abierto={borrar !== null && enBorrar === 0} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar la etapa «${borrar?.nombre ?? ""}»?`}
        texto="No tiene alumnos, así que no se mueve a nadie. La columna deja de aparecer en el pipeline."
        onConfirmar={confirmarBorrado}
      />
      <Modal
        abierto={borrar !== null && enBorrar > 0} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar la etapa «${borrar?.nombre ?? ""}»?`}
        sub={`Tiene ${enBorrar} ${enBorrar === 1 ? "alumno" : "alumnos"}. Elegí a qué etapa ${enBorrar === 1 ? "pasa" : "pasan"} antes de borrarla.`}
        pie={
          <>
            <Button variante="ghost" onClick={() => setBorrar(null)}>Cancelar</Button>
            <span className="spacer" />
            <Button variante="danger" onClick={confirmarBorrado} disabled={!destino}>
              {enBorrar === 1 ? "Pasarlo y eliminar" : "Pasarlos y eliminar"}
            </Button>
          </>
        }
      >
        <Field label={enBorrar === 1 ? "Pasa a" : "Pasan a"}>
          <Select
            value={destino} onChange={(ev) => setDestino(ev.target.value)} aria-label="Etapa a la que pasan los alumnos"
            opciones={etapas.filter((x) => x.id !== borrar?.id).map((x) => ({ valor: x.id, texto: x.nombre }))}
          />
        </Field>
      </Modal>
    </div>
  );
}
