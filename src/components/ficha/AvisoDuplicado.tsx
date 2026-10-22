"use client";

import React, { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { duplicadosDe } from "@/lib/duplicados";
import { personaDe, type Persona } from "@/lib/persona";
import type { EstadoApp } from "@/lib/types";
import { useAbrirFicha } from "./abrir";
import { noSonLaMismaPersona, unificarFichas } from "./unificar-cliente";

/* «Hay otra ficha con el mismo teléfono» arriba de la ficha (Lili, 22/10: Juan Camilo estaba dos veces, una con cada
   mail). Lo decide una persona: «Unificar acá» junta todo en esta ficha y el otro mail queda como otro mail; «No es la
   misma persona» no lo vuelve a proponer. Unificar trae «Deshacer». */

/* Quién puede unificar: quien edita Alumnos, Ventas, el CRM o Leads (no el closer, que ve sólo lo suyo). Lo mismo que
   pide api/personas/unificar. */
export function usePuedeUnificar(): boolean {
  const { acceso } = useAcceso();
  if (!acceso) return true;
  if (acceso.soloLoSuyo) return false;
  return (["alumnos", "ventas", "crm", "leads"] as const).some((a) => nivelEn(acceso, a) === 2);
}

/* Lo que tiene cada ficha, para elegir con qué quedarse. */
export function resumenFicha(p: Persona | null): string {
  if (!p) return "";
  const compras = p.ventas.filter((v) => v.estado !== "cancelada").length;
  return [
    p.email,
    compras ? `${compras} ${compras === 1 ? "compra" : "compras"}` : "",
    p.alumnos.length ? `${p.alumnos.length} ${p.alumnos.length === 1 ? "servicio" : "servicios"}` : "",
    p.sesiones.length ? `${p.sesiones.length} ${p.sesiones.length === 1 ? "llamada" : "llamadas"}` : "",
  ].filter(Boolean).join(" · ");
}

export function AvisoDuplicado({ e, p }: { e: EstadoApp; p: Persona }) {
  const toast = useToast();
  const abrir = useAbrirFicha();
  const puede = usePuedeUnificar();
  const [ocupado, setOcupado] = useState(false);
  const otros = duplicadosDe(e.contactos, p.contacto?.id);
  if (!p.contacto || otros.length === 0) return null;
  const principalId = p.contacto.id;

  const unificar = async (otroId: string, nombre: string) => {
    setOcupado(true);
    try {
      const { resumen, deshacer } = await unificarFichas(e, principalId, otroId);
      toast(resumen, "ok", {
        texto: "Deshacer",
        onClick: () => { void deshacer().then((r) => toast(r), (err: Error) => toast(err.message, "err")); },
      });
    } catch (err) {
      toast(`No se pudo unificar con ${nombre}: ${err instanceof Error ? err.message : "error"}`, "err");
    } finally {
      setOcupado(false);
    }
  };
  const noSon = async (otroId: string) => {
    setOcupado(true);
    try {
      await noSonLaMismaPersona(e, principalId, otroId);
      toast("Listo: no se vuelve a proponer.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo.", "err");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="aviso-duplicado" role="status">
      {otros.map(({ otro, seguro }) => {
        const op = personaDe(e, otro.id);
        return (
          <div className="aviso-duplicado__fila" key={otro.id}>
            <Users size={16} aria-hidden />
            <span className="aviso-duplicado__texto">
              <strong>{seguro ? "Parece la misma persona" : "Mismo teléfono"}: </strong>
              <button type="button" className="link" onClick={() => abrir(otro.id, "ventas")}>{otro.nombre || otro.email}</button>
              <span className="t-subtle"> · {resumenFicha(op) || otro.email}</span>
            </span>
            {puede && (
              <span className="aviso-duplicado__acciones">
                <Button sm variante="primary" disabled={ocupado} onClick={() => void unificar(otro.id, otro.nombre)}>Unificar acá</Button>
                <Button sm variante="ghost" disabled={ocupado} onClick={() => void noSon(otro.id)}>No es la misma persona</Button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
