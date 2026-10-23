"use client";

import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId } from "@/lib/store";
import { conQuien, conSesion } from "@/lib/bonos";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import type { SeguimientoAlumno, SesionUnoAUno } from "@/lib/types";

/* ==================================================================
   Anotar (o corregir) una sesión 1 a 1 de un alumno: el día, con quién,
   qué se habló y el link de la grabación (reunión del 21/10 con Lili:
   «que si me voy de vacaciones alguien sepa cuántas tomó y cuántas le
   faltan»). Se guarda en su ficha de seguimiento, con historial y Deshacer.
   ================================================================== */

/* «Mentor» es quien da las sesiones del contrato: Yari, un socio o un closer. Las viejas que dicen «Yari» se siguen mostrando. */
const CON = ["Mentor", "Lili"];

export function FormSesionUnoAUno({ alumnoId, nombre, sesion, con, onCerrar }: {
  alumnoId: string; nombre: string; sesion?: SesionUnoAUno; con?: string; onCerrar: () => void;
}) {
  const toast = useToast();
  const [b, setB] = useState({
    fecha: sesion?.fecha ?? hoyDelNegocio(), con: sesion?.con ?? con ?? "Mentor", notas: sesion?.notas ?? "", grabacion: sesion?.grabacion ?? "",
  });
  const set = <K extends keyof typeof b>(k: K, v: string) => setB((x) => ({ ...x, [k]: v }));
  const linkOk = !b.grabacion.trim() || /^https?:\/\/\S+$/i.test(b.grabacion.trim());
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha);

  function escribir(borrar: boolean) {
    const ahora = new Date().toISOString();
    const nueva: SesionUnoAUno = {
      id: sesion?.id ?? nuevoId("ses1a1"), fecha: b.fecha, con: b.con.trim() || "Mentor", notas: b.notas.trim(), grabacion: b.grabacion.trim(),
      creadoEn: sesion?.creadoEn ?? ahora, creadoPor: sesion?.creadoPor ?? "",
    };
    const que = `Sesión 1 a 1 con ${conQuien(nueva.con)} del ${formatoDia(nueva.fecha, hoyDelNegocio())}`;
    const antes = acciones.guardarSeguimiento(alumnoId, (s: SeguimientoAlumno, quien: string): SeguimientoAlumno => ({
      ...s, sesionesUnoAUno: conSesion(s.sesionesUnoAUno, { ...nueva, creadoPor: nueva.creadoPor || quien }, borrar),
      actualizadoEn: ahora, actualizadoPor: quien,
    }), () => `${que}: ${borrar ? "borrada" : sesion ? "corregida" : "anotada"}.`);
    if (!antes) return;
    toast(`${que} ${borrar ? "borrada" : sesion ? "corregida" : "anotada"} para ${nombre}.`, "ok", {
      texto: "Deshacer", onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el cambio de las sesiones 1 a 1 de ${nombre}.`),
    });
    onCerrar();
  }

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={sesion ? "Corregir la sesión 1 a 1" : "Anotar una sesión 1 a 1"}
      sub={`${nombre}. Las del mentor cuentan contra las que incluye el contrato; las de Lili quedan anotadas aparte.`}
      puedeGuardar={fechaOk && linkOk} onGuardar={() => escribir(false)}
    >
      <div className="form-grid">
        <Field label="Día"><Input type="date" value={b.fecha} onChange={(ev) => set("fecha", ev.target.value)} /></Field>
        <Field label="Con quién">
          <Select value={b.con} aria-label="Con quién" opciones={b.con && !CON.includes(b.con) ? [b.con, ...CON] : CON} onChange={(ev) => set("con", ev.target.value)} />
        </Field>
        <Field label="Qué se habló" span2><Textarea rows={4} value={b.notas} onChange={(ev) => set("notas", ev.target.value)} placeholder="Lo importante de la sesión, para quien la lea después" /></Field>
        <Field label="Link de la grabación" span2 error={linkOk ? undefined : "Tiene que empezar con http:// o https://"}>
          <Input value={b.grabacion} onChange={(ev) => set("grabacion", ev.target.value)} placeholder="https://…" error={!linkOk} />
        </Field>
        {sesion && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Button variante="ghost" sm icono={<Trash2 size={14} />} onClick={() => escribir(true)}>Borrar esta sesión</Button>
          </div>
        )}
      </div>
    </ModalForm>
  );
}
