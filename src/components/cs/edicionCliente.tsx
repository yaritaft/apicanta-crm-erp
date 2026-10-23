"use client";

import React, { useMemo } from "react";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { PAISES } from "@/lib/crm-tabla";
import { formatoDia, textoDeAtraso } from "@/lib/seguimiento";
import {
  aplicarEscritura, CONTRATOS, escrituraCliente, listasCs, MOTOR_CLIENTES, OPCIONES_ESTADO_ALUMNO, SESIONES_MENTOR,
  type ClaveCliente, type FilaCliente,
} from "@/lib/clientes-cs";
import type { Alumno, ColorCrm, OpcionCrm } from "@/lib/types";
import { Pastilla } from "./pastillas";
import { NADA, Recorte } from "./TablaCs";

/* ==================================================================
   Cómo se muestra y se corrige cada dato de Customer Success de un alumno.
   Lo mismo en la grilla de Clientes del programa (una celda) y en la ficha de
   la persona (una fila «rótulo · dato»): se guarda igual, con su aviso y
   «Deshacer», y se dibuja igual.
   ================================================================== */

const opciones = (xs: readonly string[], color: ColorCrm = "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color }));

/** Las opciones de cada dato, las sugerencias al escribir y el guardado. `filas` son todos los alumnos (para sugerir lo ya cargado). */
export function useEdicionCliente(filas: readonly FilaCliente[], hoy: string) {
  const e = useEstado();
  const toast = useToast();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);

  const opcionesDe = (clave: ClaveCliente): OpcionCrm[] | undefined => {
    switch (clave) {
      case "stack": return opciones(listas.stacks);
      case "acceso": return opciones(listas.accesos);
      case "followUp": return opciones(listas.followUps);
      case "contrato": return opciones(CONTRATOS);
      case "estadoContrato": return opciones(listas.estadosContrato);
      case "mentor": return opciones(SESIONES_MENTOR.map((n) => `${n} ${n === 1 ? "sesión" : "sesiones"}`));
      case "estadoAlumno": return opciones(OPCIONES_ESTADO_ALUMNO.map((o) => o.texto));
      default: return undefined;
    }
  };
  const sugerenciasDe = (clave: ClaveCliente): string[] | undefined => {
    const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    if (clave === "pais") return PAISES;
    if (clave === "plan") return unicos(["Pago único", ...filas.map((f) => f.plan)]);
    if (clave === "garantia") return unicos([...listas.garantias, ...filas.map((f) => f.garantia)]);
    if (clave === "closer") return unicos(e.equipo.filter((m) => m.rol === "closer" && m.activo).map((m) => m.nombre));
    if (clave === "responsableCv") return unicos([...e.equipo.map((m) => m.nombre), ...filas.map((f) => f.responsableCv)]);
    return undefined;
  };

  const guardar = (f: FilaCliente, clave: ClaveCliente, valor: string) => {
    const w = escrituraCliente(f, clave, valor, listas);
    const titulo = MOTOR_CLIENTES.columna[clave].titulo;
    if (w.tipo === "no") { toast(w.motivo, "err"); return; }
    if (w.tipo === "seguimiento" || w.tipo === "correccion") {
      const cuando = new Date().toISOString();
      const descripcion = w.tipo === "seguimiento" ? w.detalle : `${w.que === "cv" ? "CV" : "LinkedIn"} ${w.corregido ? "corregido" : "marcado como pendiente"}.`;
      const antes = acciones.guardarSeguimiento(f.id, (s, quien) => aplicarEscritura(s, w, hoy, quien, cuando), () => descripcion);
      if (!antes) return;
      toast(`${titulo} de ${f.nombre}: ${valor.trim() || "vacío"}.`, "ok", {
        texto: "Deshacer", onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el cambio de ${titulo} de ${f.nombre}.`),
      });
      return;
    }
    /* Lo del alumno (o de la persona): se guarda en el alumno y se corrige en todos lados. */
    const previo = Object.fromEntries(Object.keys(w.tipo === "alumno" ? w.cambios : w.alumno).map((k) => [k, (f.alumno as unknown as Record<string, unknown>)[k]]));
    const cambios = w.tipo === "alumno" ? w.cambios : w.alumno;
    if (Object.keys(cambios).length) acciones.actualizar<Alumno>("alumnos", f.id, cambios, f.nombre, w.detalle);
    if (w.tipo === "persona") acciones.corregirPersona(w.id, w.cambios);
    toast(`${titulo} de ${f.nombre}: ${valor.trim() || "vacío"}.`, "ok", {
      texto: "Deshacer",
      onClick: () => {
        if (Object.keys(previo).length) acciones.actualizar<Alumno>("alumnos", f.id, previo as Partial<Alumno>, f.alumno.nombre, `Se deshizo el cambio de ${titulo}.`);
      },
    });
  };

  return { listas, opcionesDe, sugerenciasDe, guardar };
}

/** Lo que se ve de un dato (una fecha corta, una pastilla, lo sugerido en gris). */
export function contenidoCliente(clave: ClaveCliente, f: FilaCliente, hoy: string): React.ReactNode {
  const sug = (txt: string, sugerido: boolean) => (txt ? <span className={sugerido ? "cs-sugerido" : undefined} title={sugerido ? "Sugerido: todavía no se cargó" : undefined}>{txt}</span> : NADA);
  switch (clave) {
    case "numero": return f.numero === null ? NADA : <span className="t-num">{f.numero}</span>;
    case "inicio": return f.inicio ? <span className="t-num">{formatoDia(f.inicio, hoy)}</span> : NADA;
    case "egreso": return f.egreso ? <span className={`t-num${f.egresoSugerido ? " cs-sugerido" : ""}`} title={f.egresoSugerido ? "Calculado: inicio más duración" : undefined}>{formatoDia(f.egreso, hoy)}</span> : NADA;
    case "contactoInicial": case "contactoSemana": case "ultimoContacto": {
      const d = clave === "contactoInicial" ? f.contactoInicial : clave === "contactoSemana" ? f.contactoSemana : f.ultimoContacto;
      return d ? <span className="t-num">{formatoDia(d, hoy)}</span> : NADA;
    }
    case "proximo": return f.situacion === "fuera" ? NADA : f.situacion === "reserva" ? <span className="t-sm t-subtle">Reserva · todavía no arrancó</span> : (
      <span className="stack-1"><span className="t-num">{formatoDia(f.proximo, hoy)}</span><span className="t-sm t-subtle">{f.situacion === "no-contesta" ? "Dejó de contestar" : textoDeAtraso(f.atraso)}</span></span>
    );
    case "edad": return f.edad === null ? NADA : sug(String(f.edad), f.edadSugerida);
    case "duracion": return f.duracion === null ? NADA : sug(`${f.duracion} ${f.duracion === 1 ? "mes" : "meses"}`, f.duracionSugerida);
    case "mentor": return f.mentor === null ? NADA : <span className="t-num">{f.mentor} {f.mentor === 1 ? "sesión" : "sesiones"}</span>;
    case "programa": return f.programas.length
      ? <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>{f.programas.map((p) => <Pastilla key={p} texto={p} tono="neutra" tenue={f.programasSugeridos} title={f.programasSugeridos ? "Sugerido por el servicio que compró: confirmalo en la ficha" : p} />)}</span>
      : NADA;
    case "plan": return sug(f.plan, f.planSugerido);
    case "contrato": return f.contrato
      ? <Pastilla texto={f.contrato} tenue={f.contratoSugerido} title={f.contratoSugerido ? "Sugerido: a las reservas y al Downsell de antes del 22/09 no se les hacía contrato" : f.contrato} />
      : NADA;
    case "stack": case "acceso": case "followUp": case "estadoContrato": case "estadoAlumno": case "etapa": case "testimonio":
      return <Pastilla texto={(f as unknown as Record<string, string>)[clave] ?? ""} tono={clave === "etapa" ? "neutra" : undefined} />;
    case "reporte": return <Pastilla texto={f.reporte.estado} title={f.reporte.origen === "reportes" ? "Según sus reportes semanales" : f.reporte.origen === "manual" ? "Marcado a mano en la ficha" : "Todavía no hay reportes"} />;
    case "semanasSin": return f.reporte.semanasSin === null ? NADA : <span className="t-num">{f.reporte.semanasSin}</span>;
    case "cadencia": return <span>Cada {f.cadencia} días</span>;
    case "cv": return <Pastilla texto={f.cv ? "Corregido" : "Pendiente"} />;
    case "linkedin": return <Pastilla texto={f.linkedin ? "Corregido" : "Pendiente"} />;
    case "wpp": return <Pastilla texto={f.wpp ? "Sí" : "No"} tono={f.wpp ? "ok" : "neutra"} />;
    case "zoom": return <Pastilla texto={f.zoom ? "Sí" : "No"} tono={f.zoom ? "ok" : "neutra"} />;
    case "wibo": return <Pastilla texto={f.wibo ? "Sí" : "No"} tono={f.wibo ? "ok" : "neutra"} />;
    case "comentarios": return <Recorte texto={f.comentarios} />;
    default: {
      const v = (f as unknown as Record<string, unknown>)[clave];
      return <Recorte texto={typeof v === "string" ? v : ""} />;
    }
  }
}
