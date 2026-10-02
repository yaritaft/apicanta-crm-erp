"use client";

import React from "react";
import { CloudOff, Lock } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Card, CardHead, Empty, Tabs } from "@/components/ui/ui";
import { CuadroComisiones } from "@/components/finanzas/CuadroComisiones";
import { LiquidacionMes } from "@/components/equipo/Liquidacion";
import { ListaEquipo } from "@/components/equipo/ListaEquipo";
import { FichaMiembro } from "@/components/equipo/FichaMiembro";
import { AccesosApp } from "@/components/equipo/Accesos";
import { TiposCuenta } from "@/components/equipo/TiposCuenta";
import { useAccesos, useNivelAcceso } from "@/lib/acceso";
import { useEstado, useSelector, useSync } from "@/lib/store";
import { useParamsURL } from "@/lib/useParamsURL";
import { CopiarLink } from "@/components/ui/Filtros";

/* ==================================================================
   Equipo y honorarios: quién es quién, con qué entra a la app, cuánto
   cobra y la liquidación de cada mes. Sólo para los dueños.

   Esconder la sección es comodidad: lo que la protege es la base. Las
   tablas `honorarios` y `liquidaciones` sólo se leen con es_dueno(), así
   que para cualquier otro llegan vacías aunque las pida por la API.

   Tampoco se guardan en la copia del navegador (store.ts): se traen de la
   base cada vez. Hasta que llegan, la sección espera; mostrarla vacía diría
   "Sin cargar" de todos.

   En la URL: ?seccion= (liquidacion, equipo, comisiones, accesos, tipos), ?mes=2026-09 y
   ?persona=<id> para la ficha abierta. No se usa ?vista= porque es de la
   ficha global de personas.
   ================================================================== */

type Seccion = "liquidacion" | "equipo" | "comisiones" | "accesos" | "tipos";
const SECCIONES: Seccion[] = ["liquidacion", "equipo", "comisiones", "accesos", "tipos"];

export default function EquipoYHonorarios() {
  const acceso = useNivelAcceso();
  const [p, cambiar] = useParamsURL({ seccion: "liquidacion", persona: "" });
  const seccion = (SECCIONES as string[]).includes(p.seccion) ? (p.seccion as Seccion) : "liquidacion";
  const accesos = useAccesos(acceso.esDueno);
  const sync = useSync();
  const hayEsquemas = useSelector((e) => e.honorarios.length > 0);

  const cabecera = (
    <PageHead
      titulo="Equipo y honorarios"
      sub="Quién es quién, con qué entra a la app y cuánto cobra: el fijo, los variables y sobre qué se mide cada uno. La liquidación de cada mes se calcula sola. Sólo la ven los dueños."
      acciones={acceso.esDueno ? <CopiarLink sm={false} /> : undefined}
    />
  );

  if (acceso.cargando || sync.estado === "cargando") {
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

  if (sync.estado === "error" && !hayEsquemas) {
    return (
      <div className="stack-5">
        {cabecera}
        <Card>
          <Empty
            icono={<CloudOff size={22} />} titulo="No llegó lo que cobra cada uno"
            texto="Esta sección no se guarda en el navegador: se trae de la base cada vez, y esta vez no se pudo. Revisá la conexión y recargá la página."
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
          { valor: "comisiones", texto: "Comisiones" },
          { valor: "accesos", texto: "Accesos a la app" },
          { valor: "tipos", texto: "Tipos de cuenta" },
        ]}
      />
      {seccion === "liquidacion" && <LiquidacionMes onVerPersona={ver} />}
      {seccion === "equipo" && <ListaEquipo accesos={accesos} onVer={ver} />}
      {seccion === "comisiones" && <Comisiones onVer={ver} />}
      {seccion === "accesos" && <AccesosApp accesos={accesos} onVerMiembro={ver} />}
      {seccion === "tipos" && <TiposCuenta accesos={accesos} />}
      {p.persona && <FichaMiembro key={p.persona} miembroId={p.persona} accesos={accesos} onCerrar={() => cambiar({ persona: null })} />}
    </div>
  );
}

/* El % de cada uno que vende, agenda o dirige, servicio por servicio. Lo
   mismo que se ve en Finanzas → Detalle → Comisiones, pero acá se cambia. */
function Comisiones({ onVer }: { onVer: (id: string) => void }) {
  const e = useEstado();
  return (
    <Card>
      <CardHead
        titulo="Cómo comisiona cada uno"
        sub="El % que cobra cada persona de lo que entra de sus ventas, neto de procesador. El general vale para todo; si un servicio comisiona distinto, se le pone su propio %. De acá salen la liquidación y lo que resta Finanzas."
      />
      <CuadroComisiones e={e} editable onVerPersona={onVer} />
    </Card>
  );
}
