"use client";

import React from "react";
import { CloudOff, Lock } from "lucide-react";
import { Card, CardHead, Empty, Tabs } from "@/components/ui/ui";
import { CuadroComisiones } from "@/components/finanzas/CuadroComisiones";
import { LiquidacionMes } from "@/components/equipo/Liquidacion";
import { ListaEquipo } from "@/components/equipo/ListaEquipo";
import { FichaMiembro } from "@/components/equipo/FichaMiembro";
import { AccesosApp } from "@/components/equipo/Accesos";
import { TiposCuenta } from "@/components/equipo/TiposCuenta";
import { ReglasAcordadas } from "@/components/equipo/Reglas";
import { reglasSinConfirmar } from "@/lib/reglas";
import { useEstadoDeClosers } from "@/components/closers/EstadoDeClosers";
import { useAcceso, useAccesos } from "@/lib/acceso";
import { nivelDeLiquidacion, puedeArmarElEquipo } from "@/lib/permisos";
import { useEstado, useSelector, useSync } from "@/lib/store";
import { useParamsURL } from "@/lib/useParamsURL";
import { CopiarLink } from "@/components/ui/Filtros";
import "@/components/finanzas/visual/visual.css";

/* ==================================================================
   Equipo y honorarios: quién es quién, con qué entra a la app, cuánto
   cobra y la liquidación de cada mes. Sólo para los dueños.

   Esconder la sección es comodidad: lo que la protege es la base. Las
   tablas `honorarios` y `liquidaciones` sólo se leen con es_dueno(), así
   que para cualquier otro llegan vacías aunque las pida por la API.

   Tampoco se guardan en la copia del navegador (store.ts): se traen de la
   base cada vez. Hasta que llegan, la sección espera; mostrarla vacía diría
   "Sin cargar" de todos.

   Quien tiene el permiso «Liquidación» (Aldana: el cierre de comisiones, 26/10)
   entra a «Liquidación del mes», «Comisiones» y «Reglas». Con «ver» sólo mira;
   con «editar» carga lo que falta, cierra el mes, marca quién cobró y además arma
   el equipo: altas, bajas y lo que cobra cada uno (11/11), menos lo suyo. Los
   accesos a la app y los tipos de cuenta siguen siendo de los dueños. La base lo
   dice igual (supabase/permiso-liquidacion.sql y equipo-liquidacion-edita.sql).

   En la URL: ?seccion= (liquidacion, equipo, comisiones, reglas, accesos, tipos), ?mes=2026-09 y
   ?persona=<id> para la ficha abierta. No se usa ?vista= porque es de la
   ficha global de personas.
   ================================================================== */

type Seccion = "liquidacion" | "equipo" | "comisiones" | "reglas" | "accesos" | "tipos";
const SECCIONES: Seccion[] = ["liquidacion", "equipo", "comisiones", "reglas", "accesos", "tipos"];
const SECCIONES_DE_LIQUIDACION: Seccion[] = ["liquidacion", "comisiones", "reglas"];

export default function EquipoYHonorarios() {
  const acceso = useAcceso();
  const nivelLiq = nivelDeLiquidacion(acceso.acceso);
  const [p, cambiar] = useParamsURL({ seccion: "liquidacion", persona: "" });
  /* Quien no es dueño sólo tiene la liquidación y las comisiones. */
  const armaElEquipo = puedeArmarElEquipo(acceso.acceso);
  const permitidas = acceso.esDueno ? SECCIONES : armaElEquipo ? [...SECCIONES_DE_LIQUIDACION, "equipo" as Seccion] : SECCIONES_DE_LIQUIDACION;
  const seccion = (permitidas as string[]).includes(p.seccion) ? (p.seccion as Seccion) : "liquidacion";
  const accesos = useAccesos(acceso.esDueno);
  /* Si cada closer va a ver sus llamadas (su correo en Equipo y su nombre en Calendly): se avisa en la solapa. */
  const closers = useEstadoDeClosers(accesos.lista);
  const sync = useSync();
  const hayEsquemas = useSelector((e) => e.honorarios.length > 0);
  /* Las reglas de comisión que todavía nadie confirmó: se avisan en la solapa. */
  const sinConfirmar = useSelector((e) => reglasSinConfirmar(e).length);

  const cabecera = <h1 className="sr-only">Equipo y honorarios</h1>;

  if (acceso.cargando || sync.estado === "cargando") {
    return (
      <div className="stack-5" aria-busy="true">
        {cabecera}
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  if (nivelLiq === 0) {
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
    <div className="stack-4">
      {/* El nombre de la pantalla ya está en la barra de arriba. */}
      <h1 className="sr-only">Equipo y honorarios</h1>
      <div className="fz-barra">
      <Tabs
        valor={seccion} onChange={(v) => cambiar({ seccion: v })}
        opciones={[
          { valor: "liquidacion", texto: "Liquidación del mes" },
          ...(armaElEquipo ? [{ valor: "equipo" as Seccion, texto: "Equipo y lo que cobra" }] : []),
          { valor: "comisiones", texto: "Comisiones" },
          {
            valor: "reglas" as Seccion,
            texto: sinConfirmar > 0
              ? <>Reglas<span className="tab-aviso" title={`${sinConfirmar === 1 ? "Una regla sin confirmar" : `${sinConfirmar} reglas sin confirmar`}`}>{sinConfirmar}</span></>
              : "Reglas",
          },
          ...(acceso.esDueno ? [
            {
              valor: "accesos" as Seccion,
              texto: closers.sinVer > 0
                ? <>Accesos a la app<span className="tab-aviso" title={`${closers.sinVer === 1 ? "Un closer no va" : `${closers.sinVer} closers no van`} a ver nada`}>{closers.sinVer}</span></>
                : "Accesos a la app",
            },
            { valor: "tipos" as Seccion, texto: "Tipos de cuenta" },
          ] : []),
        ]}
      />
      {acceso.esDueno && <div className="fz-barra__der"><CopiarLink variante="ghost" /></div>}
      </div>
      {seccion === "liquidacion" && <LiquidacionMes onVerPersona={armaElEquipo ? ver : undefined} soloMirar={nivelLiq < 2} onVerReglas={() => cambiar({ seccion: "reglas" })} />}
      {seccion === "equipo" && <ListaEquipo accesos={accesos} onVer={ver} conAccesos={acceso.esDueno} />}
      {seccion === "comisiones" && <Comisiones onVer={armaElEquipo ? ver : undefined} editable={armaElEquipo} />}
      {seccion === "reglas" && <ReglasAcordadas editable={acceso.esDueno} onEditar={acceso.esDueno ? ver : undefined} />}
      {seccion === "accesos" && <AccesosApp accesos={accesos} closers={closers} onVerMiembro={ver} />}
      {seccion === "tipos" && <TiposCuenta accesos={accesos} />}
      {armaElEquipo && p.persona && <FichaMiembro key={p.persona} miembroId={p.persona} accesos={accesos} onCerrar={() => cambiar({ persona: null })} />}
    </div>
  );
}

/* El % de cada uno que vende, agenda o dirige, servicio por servicio. Lo
   mismo que se ve en Finanzas → Detalle → Comisiones, pero acá se cambia. */
function Comisiones({ onVer, editable }: { onVer?: (id: string) => void; editable: boolean }) {
  const e = useEstado();
  return (
    <Card>
      <CardHead
        titulo="Cómo comisiona cada uno"
        sub="El % de lo que entra de sus ventas, neto de procesador. De acá salen la liquidación y lo que resta Finanzas."
      />
      <CuadroComisiones e={e} editable={editable} onVerPersona={onVer} />
    </Card>
  );
}
