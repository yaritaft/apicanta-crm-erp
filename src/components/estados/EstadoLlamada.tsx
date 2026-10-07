"use client";

import React, { useCallback, useState } from "react";
import { SelectorOpciones } from "@/components/crm/Editores";
import { Chip } from "@/components/crm/piezas";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado, type CambiosLlamada } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { esCompra, opcionesDe } from "@/lib/crm";
import { estadoVisible, type EstadoVisible } from "@/lib/estados";
import type { CampoOpcionesCrm, ColorCrm, OpcionCrm, Sesion } from "@/lib/types";

/* ==================================================================
   Los estados de una llamada, iguales en toda la app (lib/estados.ts):
   la pastilla con el color de su opción y, con un clic, la lista para
   cambiarla. Los usan el CRM, la Agenda, la ficha y el cierre del día.

   El cambio se guarda en la llamada, por el mismo camino que la grilla
   (store.editarLlamadas): el Estado de Llamada además deja la agenda
   como hecha, que no vino o cancelada, y mueve la etapa de la
   oportunidad. Por eso lo que se cambia en una pantalla aparece en las
   otras.
   ================================================================== */

export const TITULO_ESTADO: Record<CampoOpcionesCrm, string> = {
  estadoLlamada: "Estado de Llamada", estadoPreCall: "Estado Pre-Call", preCall: "Pre-Call",
};

const VACIAR = "Vaciar";

/** La pastilla sola. `tenue`: lo puso la app o es sólo el aviso de que
    falta (Sin cargar, Por venir). */
export function PastillaEstado({ texto, color, tenue, grande }: { texto: string; color: ColorCrm; tenue?: boolean; grande?: boolean }) {
  return <span className={`estado${tenue ? " estado--tenue" : ""}`}><Chip texto={texto} color={color} grande={grande} /></span>;
}

/** El Estado de Llamada de una llamada, sólo para leer. `vacio`: lo que
    dice si no hay nada que decir. */
export function EstadoDeLlamada({ ver, grande, vacio = "—" }: { ver: EstadoVisible; grande?: boolean; vacio?: string }) {
  if (!ver.texto) return <span className="t-subtle">{vacio}</span>;
  return <PastillaEstado texto={ver.texto} color={ver.color} tenue={ver.auto || ver.vacio} grande={grande} />;
}

/** Cambia uno de los estados de una llamada y avisa, con «Deshacer». Si
    queda como una compra y la venta no está cargada, ofrece cargarla. */
export function useCambiarEstado() {
  const e = useEstado();
  const toast = useToast();
  return useCallback((s: Sesion, campo: CampoOpcionesCrm, valor: string, o: { conVenta?: boolean; alVender?: () => void; callado?: boolean } = {}) => {
    const antes = s[campo] ?? "";
    if (antes === valor) return;
    const titulo = TITULO_ESTADO[campo];
    const nombre = s.invitado?.trim() || "la llamada";
    /* Deshacer la deja tal cual estaba: también cómo había quedado la agenda. */
    /* Y la marca de cuándo se cargó por primera vez, para que deshacer no la corra. */
    const marca = campo === "estadoLlamada" ? "estadoLlamadaEn" : campo === "estadoPreCall" ? "estadoPreCallEn" : null;
    const previo: CambiosLlamada = {
      [campo]: antes, ...(marca ? { [marca]: s[marca] } : {}),
      ...(campo === "estadoLlamada" ? { estado: s.estado, resultado: s.resultado } : {}),
    };
    const { etapas, movidos } = acciones.editarLlamadas([{
      id: s.id, cambios: { [campo]: valor },
      detalle: valor ? `${nombre}: ${titulo} → ${valor}.` : `${nombre}: se vació ${titulo}.`,
    }]);
    if (o.callado) return;
    const deshacer = () => { acciones.editarLlamadas([{ id: s.id, cambios: previo, detalle: `${nombre}: se deshizo el cambio de ${titulo}.` }], etapas); };
    const opcion = campo === "estadoLlamada" ? opcionesDe(e.ajustes, "estadoLlamada").find((x) => x.nombre === valor) : undefined;
    if (esCompra(opcion) && !o.conVenta && o.alVender) {
      toast(`${nombre}: ${valor}. ¿Cargás la venta?`, "info", { texto: "Cargar la venta", onClick: o.alVender });
      return;
    }
    const movio = movidos.map((m) => (m.etapa ? ` La oportunidad pasó a ${m.etapa}.` : "")).join("");
    toast(`${titulo} de ${nombre}: ${valor || "vacío"}.${movio}`, "ok", { texto: "Deshacer", onClick: deshacer });
  }, [e.ajustes, toast]);
}

/** Un estado que se cambia con un clic: la pastilla y, al abrirla, las
    opciones del Airtable con su buscador. Sin `onElegir` se guarda sola en
    la llamada; con `onElegir`, quien la usa decide (el cierre del día junta
    todo y guarda al pasar a la siguiente). */
export function EstadoEditable({ sesion, campo, valor, onElegir, conVenta, alVender, vacio, grande, soloLeer, bloque }: {
  sesion: Sesion;
  campo: CampoOpcionesCrm;
  /* Lo elegido y todavía sin guardar (el cierre del día); si falta, lo de la llamada. */
  valor?: string;
  onElegir?: (valor: string) => void;
  conVenta?: boolean;
  alVender?: () => void;
  /* Lo que dice cuando no hay nada (el Estado de Llamada dice solo «Sin cargar» o «Por venir»). */
  vacio?: string;
  grande?: boolean;
  soloLeer?: boolean;
  /* A lo ancho, como un campo de formulario. */
  bloque?: boolean;
}) {
  const e = useEstado();
  const { acceso } = useAcceso();
  const cambiar = useCambiarEstado();
  const [ancla, setAncla] = useState<HTMLButtonElement | null>(null);
  const [abierto, setAbierto] = useState(false);
  const puede = !soloLeer && puedeEditar(acceso, "sesiones");
  const titulo = TITULO_ESTADO[campo];
  const opciones = opcionesDe(e.ajustes, campo);

  /* Lo que hay: del Estado de Llamada, el visible (el cargado, el automático o el aviso). */
  const cargado = valor ?? sesion[campo] ?? "";
  let pastilla: React.ReactNode;
  if (campo === "estadoLlamada") {
    const ver = estadoVisible(e, valor === undefined ? sesion : { ...sesion, estadoLlamada: valor || undefined });
    pastilla = ver.texto ? <EstadoDeLlamada ver={ver} grande={grande} /> : <span className="estado__vacio">{vacio ?? "Sin estado"}</span>;
  } else if (cargado) {
    pastilla = <PastillaEstado texto={cargado} color={opciones.find((o) => o.nombre === cargado)?.color ?? "gris1"} grande={grande} />;
  } else {
    pastilla = <span className="estado__vacio">{vacio ?? "—"}</span>;
  }
  if (!puede) return <span className="estado-fijo" title={titulo}>{pastilla}</span>;

  const lista: OpcionCrm[] = cargado ? [...opciones, { nombre: VACIAR, color: "gris1" }] : opciones;
  const elegir = (n: string) => {
    const nuevo = n === VACIAR ? "" : n;
    setAbierto(false);
    if (onElegir) onElegir(nuevo);
    else cambiar(sesion, campo, nuevo, { conVenta, alVender });
  };
  return (
    <>
      <button
        ref={setAncla} type="button" className={`estado-boton${bloque ? " estado-boton--bloque" : ""}${abierto ? " estado-boton--abierto" : ""}`}
        aria-haspopup="listbox" aria-expanded={abierto} aria-label={`${titulo}: ${cargado || "sin cargar"}. Cambiar`} title={`Cambiar ${titulo.toLowerCase()}`}
        onClick={(ev) => { ev.stopPropagation(); setAbierto((v) => !v); }}
        onKeyDown={(ev) => ev.stopPropagation()}
      >
        {pastilla}
      </button>
      {abierto && (
        <SelectorOpciones
          ancla={ancla} opciones={lista} valor={cargado} ancho={Math.max(230, ancla?.offsetWidth ?? 0)}
          onElegir={elegir} onCerrar={() => setAbierto(false)}
        />
      )}
    </>
  );
}
