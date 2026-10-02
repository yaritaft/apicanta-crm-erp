"use client";

import React, { useState } from "react";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { evaluarAgenda, textoEvaluacion } from "@/lib/calificacion";
import { EDITOR, PAISES, perfilDe, valorParaGuardar, type ClaveColumna, type DatoPerfil, type FilaTabla } from "@/lib/crm-tabla";
import { corregidoDe } from "@/lib/perfil";
import type { Persona } from "@/lib/persona";

/* ==================================================================
   Quién es la persona: el país y lo que contestó al agendar (edad,
   tecnologías, inglés, experiencia, formación, cuánto gana y cuánto puede
   invertir). Cada dato una sola vez en la ficha, y se corrige con un clic,
   igual que en la tabla del CRM: la corrección es de la persona y vale
   para todas sus llamadas (lib/perfil.ts). Abajo, si califica y por qué.
   ================================================================== */

export function PerfilPersona({ p, filas }: {
  p: Persona;
  /* Sus llamadas como filas del CRM, de la más nueva a la más vieja. */
  filas: FilaTabla[];
}) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "contactos");
  const [editando, setEditando] = useState<ClaveColumna | null>(null);
  const c = p.contacto;
  const lead = p.leads[0];

  const perfil = perfilDe(filas, c, lead);
  if (!puede && !perfil.some((d) => d.valor)) return null;

  const guardar = (d: DatoPerfil, escrito: string) => {
    const valor = valorParaGuardar(d.clave, escrito);
    if (valor.split("\n").join(", ") === d.valor) return;
    const antes = d.campo === "pais" ? c?.pais ?? lead?.pais ?? "" : corregidoDe(c, lead)?.[d.campo] ?? "";
    acciones.corregirPerfil(p.clave, d.campo, valor);
    toast(valor ? `${d.titulo} de ${p.nombre}: ${valor.split("\n").join(", ")}.` : `${d.titulo} de ${p.nombre}: volvió a lo que contestó.`, "ok",
      { texto: "Deshacer", onClick: () => { acciones.corregirPerfil(p.clave, d.campo, antes, `${p.nombre}: se deshizo el cambio de ${d.titulo}.`); } });
  };

  /* Si califica, con su última llamada (y lo corregido). */
  const ultima = filas[0];
  const evaluacion = ultima ? evaluarAgenda(ultima.sesion, c ?? lead) : null;

  return (
    <section className="ficha-ll__bloque">
      <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
        <span className="t-label">Quién es</span>
        {evaluacion?.calificada && <Badge variante="warning"><Star size={12} fill="currentColor" />Agenda calificada</Badge>}
      </div>
      <dl className="ficha-ll__datos ficha-ll__datos--perfil">
        {perfil.filter((d) => d.valor || puede).map((d) => (
          <div key={d.clave}>
            <dt>{d.titulo}</dt>
            <dd>
              {puede ? (
                <CeldaEditable
                  editor={EDITOR[d.clave] ?? "texto"} valor={d.valor} titulo={d.titulo} abierta={editando === d.clave}
                  onAbrir={() => setEditando(d.clave)} onCerrar={() => setEditando((x) => (x === d.clave ? null : x))}
                  onGuardar={(v) => guardar(d, v)} sugerencias={d.clave === "pais" ? PAISES : undefined}
                  className={`ficha__editable${d.corregido ? " crm-t__editable--corregida" : ""}`}
                  ayuda={d.corregido ? `${d.titulo} corregido a mano. Vaciá el dato para volver a lo que contestó al agendar.` : undefined}
                >
                  {d.valor ? <span>{d.valor}</span> : <span className="t-subtle">Agregar</span>}
                </CeldaEditable>
              ) : d.valor}
            </dd>
          </div>
        ))}
      </dl>
      {evaluacion && !evaluacion.calificada && <p className="t-sm t-subtle" style={{ margin: 0 }}>{textoEvaluacion(evaluacion)}</p>}
    </section>
  );
}
