"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";

/* ==================================================================
   Una conexión en Ajustes → Integraciones: una fila con el nombre, para
   qué sirve y cómo está; el detalle (claves, botones, lo que entró) se
   abre al tocarla. Antes cada conexión era una tarjeta abierta con dos
   o tres párrafos y lo que había que resolver quedaba en el medio de
   4.000 px de texto (05/11).

   Lo que pide algo («atencion») dice qué en la misma línea, en lugar de
   para qué sirve, y se abre solo.
   ================================================================== */

export type TonoConexion = "bien" | "atencion" | "apagada" | "revisando";

export interface EstadoConexion {
  tono: TonoConexion;
  /* El rótulo de la derecha: «Conectado», «Falta un permiso»… */
  texto: string;
  /* Con «atencion», lo que hay que hacer, en una línea: reemplaza al «para qué sirve». */
  detalle?: string;
}

export function Conexion({ id, titulo, que, estado, acciones, abiertaDeEntrada, children }: {
  id: string; titulo: string;
  /* Para qué sirve, en una línea. */
  que: string;
  estado: EstadoConexion;
  /* Botones que van en la cabecera abierta (Probar de nuevo, Actualizar…). */
  acciones?: React.ReactNode;
  abiertaDeEntrada?: boolean;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState<boolean | null>(null);
  /* Hasta que alguien la toca, se abre sola si pide algo. */
  const ver = abierta ?? Boolean(abiertaDeEntrada);
  const sub = estado.tono === "atencion" && estado.detalle ? estado.detalle : que;
  return (
    <section className="aj-con" id={`conexion-${id}`} data-tono={estado.tono} data-abierta={ver || undefined} aria-label={titulo}>
      <button type="button" className="aj-con__cab" aria-expanded={ver} onClick={() => setAbierta(!ver)}>
        <span className="aj-con__punto" aria-hidden />
        <span className="aj-con__textos">
          <span className="aj-con__titulo">{titulo}</span>
          <span className="aj-con__sub">{sub}</span>
        </span>
        <span className="aj-con__estado">{estado.texto}</span>
        <ChevronRight size={16} className="aj-con__chev" aria-hidden />
      </button>
      {ver && (
        <div className="aj-con__cuerpo">
          {acciones && <div className="aj-con__acciones">{acciones}</div>}
          {children}
        </div>
      )}
    </section>
  );
}
