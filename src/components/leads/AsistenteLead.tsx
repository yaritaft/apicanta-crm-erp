"use client";

import React, { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { Asistente, Pregunta } from "@/components/ui/Asistente";
import { Field, Input, Select, Textarea } from "@/components/ui/ui";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useEstado } from "@/lib/store";
import { claveEmail } from "@/lib/contactos";
import { useUsuarioActual } from "@/lib/usuario";
import type { Lead, Moneda } from "@/lib/types";

/* ==================================================================
   Alta (y edición) de un lead en dos pasos, con el formato del asistente
   de venta: primero la persona (nombre, email, teléfono, país) y después
   la oportunidad (etapa, fuente, inglés, experiencia, valor, campaña,
   responsable y notas). Sólo el nombre es obligatorio.
   ================================================================== */

export type BorradorLead = Omit<Lead, "id"> & { id?: string };

export const ORDEN_INGLES = ["ninguno", "basico", "intermedio", "conversacional", "nativo"] as const;
export const ETIQUETA_INGLES: Record<string, string> = {
  ninguno: "Ninguno", basico: "Básico", intermedio: "Intermedio",
  conversacional: "Conversacional", nativo: "Nativo",
};

const PASOS = [
  { id: "persona", titulo: "Persona" },
  { id: "oportunidad", titulo: "Oportunidad" },
];

export function AsistenteLead({ inicial, onCerrar, onGuardar }: {
  inicial: BorradorLead;
  onCerrar: () => void;
  onGuardar: (datos: BorradorLead) => void;
}) {
  const e = useEstado();
  const abrirFicha = useAbrirFicha();
  const [f, setF] = useState<BorradorLead>(inicial);
  const [paso, setPaso] = useState(0);
  const set = (cambios: Partial<BorradorLead>) => setF((x) => ({ ...x, ...cambios }));

  /* Un lead nuevo queda a cargo de quien lo carga, si es del equipo. */
  const yo = useUsuarioActual();
  useEffect(() => {
    if (!yo.miembro || f.id) return;
    setF((x) => (x.responsable ? x : { ...x, responsable: yo.miembro!.nombre }));
  }, [yo.miembro, f.id]);

  /* Si el email ya es de alguien, mejor abrir su ficha que duplicarlo. */
  const yaExiste = useMemo(() => {
    const clave = claveEmail(f.email);
    if (f.id || !clave || !clave.includes("@")) return null;
    return e.contactos.find((c) => claveEmail(c.email) === clave)
      ?? e.leads.find((l) => claveEmail(l.email) === clave) ?? null;
  }, [e.contactos, e.leads, f.email, f.id]);

  /* El responsable es alguien del equipo; si el lead traía otro nombre
     (de una importación), se conserva como opción. */
  const responsables = useMemo(() => {
    const nombres = e.equipo.filter((x) => x.activo).map((x) => x.nombre);
    if (f.responsable && !nombres.includes(f.responsable)) nombres.unshift(f.responsable);
    return nombres;
  }, [e.equipo, f.responsable]);

  const problema = paso === 0 && f.nombre.trim().length < 2 ? "Escribí el nombre y apellido" : null;

  return (
    <Asistente
      etiqueta={f.id ? `Editar a ${f.nombre}` : "Nuevo lead"}
      pasos={PASOS} actual={paso} onCambiarPaso={setPaso}
      problema={problema}
      onCerrar={onCerrar}
      terminarTexto={f.id ? "Guardar cambios" : "Crear lead"}
      onTerminar={() => onGuardar({ ...f, nombre: f.nombre.trim(), email: f.email.trim() })}
    >
      {paso === 0 ? (
        <>
          <Pregunta
            texto={f.id ? "¿Quién es?" : "¿Quién es la persona?"}
            sub="Sólo el nombre es obligatorio. El resto lo completás cuando lo tengas."
          />
          <div className="form-grid">
            <Field label="Nombre y apellido" span2>
              <Input value={f.nombre} onChange={(ev) => set({ nombre: ev.target.value })} placeholder="Martín Quiroga" />
            </Field>
            <Field label="Email">
              <Input type="email" value={f.email} onChange={(ev) => set({ email: ev.target.value })} placeholder="martin@gmail.com" />
            </Field>
            <Field label="Teléfono">
              <Input value={f.telefono ?? ""} onChange={(ev) => set({ telefono: ev.target.value })} placeholder="+54 9 11 5555-5555" />
            </Field>
            <Field label="País" span2>
              <Input value={f.pais ?? ""} onChange={(ev) => set({ pais: ev.target.value })} placeholder="Argentina" />
            </Field>
          </div>
          {yaExiste && (
            <div className="help-card">
              <UserRound size={18} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="help-card__title">Ese email ya es de {yaExiste.nombre}</div>
                <div className="help-card__text">
                  Si es la misma persona, abrí su ficha en vez de cargarla de nuevo.{" "}
                  <button type="button" className="link" onClick={() => { onCerrar(); abrirFicha(yaExiste.id); }}>Abrir su ficha</button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <Pregunta texto="¿En qué anda?" sub="Dónde está en el pipeline, de dónde vino y cuánto vale si cierra." />
          <div className="form-grid">
            <Field label="Etapa">
              <Select value={f.etapaId} onChange={(ev) => set({ etapaId: ev.target.value })}
                opciones={[...e.etapas].sort((a, b) => a.orden - b.orden).map((x) => ({ valor: x.id, texto: x.nombre }))} />
            </Field>
            <Field label="Fuente">
              <Select value={f.fuente} onChange={(ev) => set({ fuente: ev.target.value })} opciones={e.ajustes.fuentes} placeholder="Elegí una" />
            </Field>
            <Field label="Inglés" ayuda="Conversacional es el corte para una entrevista en USA.">
              <Select
                value={f.inglesNivel ?? ""} placeholder="Sin evaluar"
                onChange={(ev) => set({ inglesNivel: (ev.target.value || undefined) as Lead["inglesNivel"] })}
                opciones={ORDEN_INGLES.map((n) => ({ valor: n, texto: ETIQUETA_INGLES[n] }))}
              />
            </Field>
            <Field label="Años de experiencia" ayuda="Vacío es «no sabemos»; 0 es «sin experiencia».">
              <Input
                type="number" min={0} value={f.aniosExperiencia ?? ""}
                onChange={(ev) => set({ aniosExperiencia: ev.target.value === "" ? undefined : Number(ev.target.value) })}
              />
            </Field>
            <Field label="Valor" ayuda="Cuánto vale si cierra.">
              <Input type="number" min={0} value={f.monto} onChange={(ev) => set({ monto: Number(ev.target.value) })} />
            </Field>
            <Field label="Moneda">
              <Select value={f.moneda} onChange={(ev) => set({ moneda: ev.target.value as Moneda })} opciones={["USD", "ARS"]} />
            </Field>
            <Field label="Campaña" ayuda="Si vino de un anuncio, cuál.">
              <Input value={f.campania ?? ""} onChange={(ev) => set({ campania: ev.target.value })} placeholder="[V2][WEBINAR 23/09]" />
            </Field>
            <Field label="Responsable">
              <Select value={f.responsable} placeholder="Sin asignar" onChange={(ev) => set({ responsable: ev.target.value })}
                opciones={responsables} />
            </Field>
            <Field label="Notas" span2 ayuda="Lo que hablaron, qué necesita, cuándo volver a escribirle.">
              <Textarea value={f.notas ?? ""} onChange={(ev) => set({ notas: ev.target.value })} rows={3} />
            </Field>
            <CamposExtra
              campos={e.campos} entidad="lead" valores={f.extra}
              onChange={(k, v) => set({ extra: { ...f.extra, [k]: v } })}
            />
          </div>
        </>
      )}
    </Asistente>
  );
}
