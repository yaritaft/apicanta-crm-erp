"use client";

import React, { useState } from "react";
import { Users } from "lucide-react";
import { Button, Switch } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { noSonElMismoAlumno, repetidosDe, type AlumnoRepetido } from "@/lib/alumnos-repetidos";
import { claveEmail } from "@/lib/contactos";
import { money } from "@/lib/format";
import type { Alumno, EstadoApp } from "@/lib/types";
import { unificarAlumnos } from "./unificar-cliente";

/* «Mismo teléfono que otro alumno» arriba del servicio (Lili, 23/10: Mariano cargó la venta de Saul Rivas Martínez como
   «Edgar» y quedaron dos alumnos). Queda siempre el que no tenía venta, que es el que tiene lo de Servicio; se lleva la
   venta del otro y, si se elige, la persona de la venta toma su nombre y su mail. */

export function AvisoAlumnoRepetido({ e, alumno, puede }: { e: EstadoApp; alumno: Alumno; puede: boolean }) {
  const toast = useToast();
  const [unir, setUnir] = useState<AlumnoRepetido | null>(null);
  const [corregir, setCorregir] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const pares = repetidosDe(e, alumno.id);
  if (pares.length === 0) return null;

  const describir = (a: Alumno) => {
    const v = a.ventaId ? e.ventas.find((x) => x.id === a.ventaId) : undefined;
    const producto = v?.productoId ? e.productos.find((x) => x.id === v.productoId)?.nombre : undefined;
    const closer = v?.closerId ? e.equipo.find((m) => m.id === v.closerId)?.nombre : undefined;
    return v ? `con su venta${producto ? ` de ${producto}` : ""} (${money(v.precioAcordado, v.moneda)}${closer ? `, ${closer}` : ""})` : "cargado sin venta";
  };
  const noSon = (p: AlumnoRepetido) => {
    const marcar = (a: Alumno, otro: string) =>
      acciones.actualizar<Alumno>("alumnos", a.id, { extra: { ...(a.extra ?? {}), noEsElMismoAlumno: [...new Set([...noSonElMismoAlumno(a), otro])] } }, a.nombre,
        "Tiene el mismo teléfono o mail que otro alumno, pero no son la misma persona.");
    marcar(p.conVenta, p.sinVenta.id);
    marcar(p.sinVenta, p.conVenta.id);
    toast("Listo: no se vuelve a proponer.");
  };
  const confirmar = async () => {
    if (!unir) return;
    setOcupado(true);
    try {
      const resumen = await unificarAlumnos(e, unir.sinVenta.id, unir.conVenta.id, corregir);
      toast(resumen);
      setUnir(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo unir.", "err");
    } finally {
      setOcupado(false);
    }
  };
  const distintos = (p: AlumnoRepetido) => p.conVenta.nombre.trim() !== p.sinVenta.nombre.trim() || claveEmail(p.conVenta.email) !== claveEmail(p.sinVenta.email);

  return (
    <div className="aviso-duplicado" role="status">
      {pares.map((p) => {
        const otro = p.conVenta.id === alumno.id ? p.sinVenta : p.conVenta;
        return (
          <div className="aviso-duplicado__fila" key={`${p.conVenta.id}:${p.sinVenta.id}`}>
            <Users size={16} aria-hidden />
            <span className="aviso-duplicado__texto">
              <strong>Mismo {p.por === "telefono" ? "teléfono" : "mail"} que otro alumno: </strong>
              {otro.nombre}<span className="t-subtle"> · {describir(otro)}</span>
            </span>
            {puede && (
              <span className="aviso-duplicado__acciones">
                <Button sm variante="primary" onClick={() => { setCorregir(distintos(p)); setUnir(p); }}>Es la misma persona: unir</Button>
                <Button sm variante="ghost" onClick={() => noSon(p)}>No es la misma persona</Button>
              </span>
            )}
          </div>
        );
      })}
      {unir && (
        <ModalForm
          abierto onCerrar={() => setUnir(null)} titulo={`Unir a ${unir.sinVenta.nombre}`}
          sub={`Queda «${unir.sinVenta.nombre}», con todo lo de Servicio, y se lleva la venta de «${unir.conVenta.nombre}». La ficha de «${unir.conVenta.nombre}» desaparece.`}
          guardarTexto={ocupado ? "Uniendo…" : "Unir"} puedeGuardar={!ocupado} onGuardar={() => void confirmar()}
        >
          {distintos(unir) && (
            <div className="devol-opcion">
              <div>
                <div className="t-strong">Corregir también la persona de la venta</div>
                <div className="t-sm t-subtle">
                  «{unir.conVenta.nombre}{unir.conVenta.email ? ` · ${unir.conVenta.email}` : ""}» pasa a
                  «{unir.sinVenta.nombre}{unir.sinVenta.email ? ` · ${unir.sinVenta.email}` : ""}», en el CRM y en la venta. Si el mail
                  cambia, el viejo queda como otro mail de la persona.
                </div>
              </div>
              <Switch checked={corregir} onChange={setCorregir} etiqueta="Corregir también la persona de la venta" />
            </div>
          )}
        </ModalForm>
      )}
    </div>
  );
}
