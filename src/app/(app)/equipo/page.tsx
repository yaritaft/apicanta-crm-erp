"use client";

import React from "react";
import { Lock } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Card, Empty, Tabs } from "@/components/ui/ui";
import { LiquidacionMes } from "@/components/equipo/Liquidacion";
import { ListaEquipo } from "@/components/equipo/ListaEquipo";
import { FichaMiembro } from "@/components/equipo/FichaMiembro";
import { AccesosApp } from "@/components/equipo/Accesos";
import { useAccesos, useNivelAcceso } from "@/lib/acceso";
import { useParamsURL } from "@/lib/useParamsURL";

/* ==================================================================
   Equipo y honorarios: quién es quién, con qué entra a la app, cuánto
   cobra y la liquidación de cada mes. Sólo para los dueños.

   Esconder la sección es comodidad: lo que la protege es la base. Las
   tablas `honorarios` y `liquidaciones` sólo se leen con es_dueno(), así
   que para cualquier otro llegan vacías aunque las pida por la API.

   En la URL: ?seccion= (liquidacion, equipo, accesos), ?mes=2026-09 y
   ?persona=<id> para la ficha abierta. No se usa ?vista= porque es de la
   ficha global de personas.
   ================================================================== */

type Seccion = "liquidacion" | "equipo" | "accesos";
const SECCIONES: Seccion[] = ["liquidacion", "equipo", "accesos"];

export default function EquipoYHonorarios() {
  const acceso = useNivelAcceso();
  const [p, cambiar] = useParamsURL({ seccion: "liquidacion", persona: "" });
  const seccion = (SECCIONES as string[]).includes(p.seccion) ? (p.seccion as Seccion) : "liquidacion";
  const accesos = useAccesos(acceso.esDueno);

  const cabecera = (
    <PageHead
      titulo="Equipo y honorarios"
      sub="Quién es quién, con qué entra a la app y cuánto cobra: el fijo, los variables y sobre qué se mide cada uno. La liquidación de cada mes se calcula sola. Sólo la ven los dueños."
    />
  );

  if (acceso.cargando) {
    return (
      <div className="stack-5" aria-busy="true">
        {cabecera}
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  if (!acceso.esDueno) {
    return (
      <div className="stack-5">
        {cabecera}
        <Card>
          <Empty
            icono={<Lock size={22} />} titulo="Esta sección es de los dueños"
            texto="Lo que cobra cada uno y los accesos a la app los ven y los cambian sólo los dueños. Si necesitás algo de acá, pediselo a ellos."
          />
        </Card>
      </div>
    );
  }

  const ver = (id: string) => cambiar({ persona: id });

  return (
    <div className="stack-5">
      {cabecera}
      <Tabs
        valor={seccion} onChange={(v) => cambiar({ seccion: v })}
        opciones={[
          { valor: "liquidacion", texto: "Liquidación del mes" },
          { valor: "equipo", texto: "Equipo y lo que cobra" },
          { valor: "accesos", texto: "Accesos a la app" },
        ]}
      />
      {seccion === "liquidacion" && <LiquidacionMes onVerPersona={ver} />}
      {seccion === "equipo" && <ListaEquipo accesos={accesos} onVer={ver} />}
      {seccion === "accesos" && <AccesosApp accesos={accesos} onVerMiembro={ver} />}
      {p.persona && <FichaMiembro key={p.persona} miembroId={p.persona} accesos={accesos} onCerrar={() => cambiar({ persona: null })} />}
    </div>
  );
}
